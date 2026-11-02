/**
 * Runtime de movimento determinístico: sessões de comandos, amostragem em instantes arbitrários e reprodução.
 *
 * Princípios:
 *  - Cada comando devolve uma sessão nova; a anterior não muda. Uma sessão fechada recusa tudo.
 *  - Um comando só entra se toda a trajectória (extremos e pontos intermédios) for válida. Uma trajectória com um ponto
 *    bloqueado é recusada inteira, com o instante do primeiro ponto inválido. Nunca se executa um movimento a meio.
 *  - A amostragem é uma função pura do instante: `sampleEngineeringMotion(session, t)` não depende de amostras anteriores,
 *    da ordem das chamadas nem do ecrã. O tempo do reprodutor avança com os passos que a chamada der, não com FPS.
 *  - Alterar um parâmetro cria uma sessão nova com a montagem validada de novo; a comparação antes/depois usa as mesmas
 *    entradas (mesmos valores dos actuadores) nas duas montagens.
 */
import { assertAssembly, validateAssembly, type Assembly, type AssemblyIssue, type Vec3 } from '../contracts/assembly.v1';
import type { Provenance } from '../../core';
import type { MotionFrame } from '../contracts/motion-frame.v1';
import { evaluateActuators } from './engine';
import { referenceConfiguration } from './forward-kinematics';

/** Número de intervalos em que a trajectória é verificada, além dos extremos (ver `commandMove`). */
export const TRAJECTORY_STEPS = 50;

export type ActuatorValues = Record<string, number>;
type Segment = { startS: number; endS: number; from: ActuatorValues; to: ActuatorValues };

export type EngineeringSession = {
  readonly assembly: Assembly;
  readonly start: ActuatorValues;
  readonly segments: readonly Segment[];
  readonly durationS: number;
  closed: boolean;
};

export type MoveCommand = { targets: Record<string, number>; durationS?: number };
export type MoveResult =
  | { ok: true; session: EngineeringSession; durationS: number; startS: number }
  | { ok: false; code: string; message: string; blockedCode: string | null; firstInvalidTimeS: number | null };

export type ParameterPatch =
  | { kind: 'actuator_max_rate'; actuatorId: string; value: number; unit: 'm/s' | 'rad/s'; provenance: Provenance }
  | { kind: 'joint_origin'; jointId: string; translationM: Vec3; provenance: Provenance }
  | { kind: 'joint_limits'; jointId: string; min: number; max: number; provenance: Provenance }
  | { kind: 'point_position'; partId: string; pointId: string; positionM: Vec3; provenance: Provenance };
export type ParameterResult =
  | { ok: true; session: EngineeringSession; before: MotionFrame; after: MotionFrame; maxPartDisplacementM: number | null }
  | { ok: false; code: string; message: string; issues: AssemblyIssue[] };

export type Playback = { readonly session: EngineeringSession; readonly timeS: number; readonly playing: boolean; readonly speed: number };

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function assertOpen(session: EngineeringSession): void {
  if (session.closed) throw new Error('ENGINE_SESSION_CLOSED: a sessão já foi fechada.');
}

/** Valores de referência dos actuadores: curso para cilindros, ângulo de referência para accionamentos rotativos. */
function referenceValuesOf(assembly: Assembly): ActuatorValues {
  const config = referenceConfiguration(assembly);
  const values: ActuatorValues = {};
  for (const actuator of assembly.actuators) {
    values[actuator.id] = actuator.kind === 'hydraulic_cylinder' ? actuator.referenceStroke.value : config[actuator.jointId]!;
  }
  return values;
}

export function createEngineeringSession(assembly: Assembly): EngineeringSession {
  assertAssembly(assembly);
  const copy = structuredClone(assembly);
  return { assembly: copy, start: referenceValuesOf(copy), segments: [], durationS: 0, closed: false };
}

export function closeEngineeringSession(session: EngineeringSession): void {
  session.closed = true;
}

/** Valores dos actuadores no fim da sessão (o alvo do último comando, ou a referência). */
function endValues(session: EngineeringSession): ActuatorValues {
  const last = session.segments[session.segments.length - 1];
  return { ...(last ? last.to : session.start) };
}

/** Valores dos actuadores no instante `t` (linear por segmento; depois do fim, mantém-se o último alvo). */
function valuesAt(session: EngineeringSession, t: number): ActuatorValues {
  for (const segment of session.segments) {
    if (t <= segment.endS) {
      const span = segment.endS - segment.startS;
      const alpha = span > 0 ? Math.min(1, Math.max(0, (t - segment.startS) / span)) : 1;
      const out: ActuatorValues = {};
      for (const id of Object.keys(segment.to)) out[id] = segment.from[id]! + alpha * (segment.to[id]! - segment.from[id]!);
      return out;
    }
  }
  return endValues(session);
}

/** Taxa máxima de um actuador (m/s ou rad/s), ou `null` se a montagem não a conhece. */
function maxRateOf(assembly: Assembly, actuatorId: string): number | null {
  const actuator = assembly.actuators.find((item) => item.id === actuatorId)!;
  return actuator.maxRate ? actuator.maxRate.value : null;
}

/**
 * Pede um movimento: os actuadores passam dos valores actuais para os alvos, em linha recta no espaço dos actuadores, cada
 * um à sua velocidade máxima (a duração é a do mais lento). A trajectória é verificada em `TRAJECTORY_STEPS` intervalos
 * iguais: um ponto bloqueado recusa o comando inteiro. A verificação é por amostragem: entre dois pontos verificados a
 * configuração não é examinada; o intervalo é fino o bastante para que a montagem actual (limites monótonos no curso) não
 * esconda um bloqueio. Se uma montagem tiver um bloqueio mais estreito, ele não é visto — isso fica documentado, não escondido.
 */
export function commandMove(session: EngineeringSession, command: MoveCommand): MoveResult {
  assertOpen(session);
  const known = new Set(session.assembly.actuators.map((actuator) => actuator.id));
  const current = endValues(session);
  for (const [id, target] of Object.entries(command.targets)) {
    if (!known.has(id)) return { ok: false, code: 'COMMAND_UNKNOWN_ACTUATOR', message: `O actuador ${id} não existe na montagem.`, blockedCode: null, firstInvalidTimeS: null };
    if (!finite(target)) return { ok: false, code: 'COMMAND_INVALID_TARGET', message: `Alvo não finito para ${id}.`, blockedCode: null, firstInvalidTimeS: null };
  }
  if (command.durationS !== undefined && (!finite(command.durationS) || command.durationS <= 0)) {
    return { ok: false, code: 'COMMAND_INVALID_DURATION', message: 'A duração, se for dada, tem de ser finita e positiva.', blockedCode: null, firstInvalidTimeS: null };
  }
  const to: ActuatorValues = { ...current, ...command.targets };
  const changed = Object.keys(to).filter((id) => to[id] !== current[id]);
  if (changed.length === 0) return { ok: false, code: 'COMMAND_NO_CHANGE', message: 'Nenhum actuador muda de valor.', blockedCode: null, firstInvalidTimeS: null };

  let duration = command.durationS ?? 0;
  if (command.durationS === undefined) {
    for (const id of changed) {
      const rate = maxRateOf(session.assembly, id);
      if (rate === null) return { ok: false, code: 'COMMAND_NO_RATE', message: `Sem velocidade máxima para ${id}: a duração não se pode calcular. Dê uma duração explícita.`, blockedCode: null, firstInvalidTimeS: null };
      duration = Math.max(duration, Math.abs(to[id]! - current[id]!) / rate);
    }
  }

  // Extremo final: a configuração de destino tem de ser válida.
  const end = evaluateActuators(session.assembly, to, { timestampS: session.durationS + duration });
  if (end.status !== 'ok') {
    return { ok: false, code: 'TARGET_BLOCKED', message: `O alvo não é uma configuração válida: ${end.blocked?.message ?? ''}`, blockedCode: end.blocked?.code ?? null, firstInvalidTimeS: null };
  }
  // Pontos intermédios.
  for (let k = 1; k < TRAJECTORY_STEPS; k += 1) {
    const alpha = k / TRAJECTORY_STEPS;
    const values: ActuatorValues = {};
    for (const id of Object.keys(to)) values[id] = current[id]! + alpha * (to[id]! - current[id]!);
    const t = session.durationS + duration * alpha;
    const frame = evaluateActuators(session.assembly, values, { timestampS: t });
    if (frame.status !== 'ok') {
      return { ok: false, code: 'TRAJECTORY_BLOCKED', message: `A trajectória fica inválida a ${t.toFixed(3)} s: ${frame.blocked?.message ?? ''}`, blockedCode: frame.blocked?.code ?? null, firstInvalidTimeS: t };
    }
  }

  const segment: Segment = { startS: session.durationS, endS: session.durationS + duration, from: current, to };
  const next: EngineeringSession = { assembly: session.assembly, start: session.start, segments: [...session.segments, segment], durationS: segment.endS, closed: false };
  return { ok: true, session: next, durationS: duration, startS: segment.startS };
}

/** Quadro no instante `t`: a pose e as medidas vêm da cinemática directa com os valores interpolados. */
export function sampleEngineeringMotion(session: EngineeringSession, timeS: number): MotionFrame {
  assertOpen(session);
  if (!finite(timeS) || timeS < 0) throw new Error(`ENGINE_INVALID_TIMESTAMP: o instante tem de ser finito e ≥ 0 (recebido ${String(timeS)}).`);
  return evaluateActuators(session.assembly, valuesAt(session, timeS), { timestampS: timeS });
}

export function sessionDurationS(session: EngineeringSession): number { return session.durationS; }

// ---------------------------------------------------------------------------------------------------------------------
// Reprodutor. Estado imutável: cada operação devolve um reprodutor novo. O tempo só muda com passos dados pela chamada.
// ---------------------------------------------------------------------------------------------------------------------
export function createPlayback(session: EngineeringSession): Playback {
  return { session, timeS: 0, playing: false, speed: 1 };
}

export function play(playback: Playback): Playback {
  return { ...playback, playing: playback.timeS < playback.session.durationS };
}

export function pause(playback: Playback): Playback {
  return { ...playback, playing: false };
}

export function seek(playback: Playback, timeS: number): Playback {
  if (!finite(timeS) || timeS < 0) throw new Error(`ENGINE_INVALID_TIMESTAMP: o instante tem de ser finito e ≥ 0 (recebido ${String(timeS)}).`);
  const clamped = Math.min(timeS, playback.session.durationS);
  return { ...playback, timeS: clamped, playing: playback.playing && clamped < playback.session.durationS };
}

/** Avança `dtS` segundos reais (velocidade × dtS de tempo de movimento). Para no fim. */
export function advance(playback: Playback, dtS: number): Playback {
  if (!finite(dtS) || dtS < 0) throw new Error(`ENGINE_INVALID_STEP: o passo tem de ser finito e ≥ 0 (recebido ${String(dtS)}).`);
  if (!finite(playback.speed) || playback.speed <= 0) throw new Error(`ENGINE_INVALID_SPEED: a velocidade tem de ser finita e > 0 (recebida ${String(playback.speed)}).`);
  if (!playback.playing) return playback;
  const duration = playback.session.durationS;
  const next = Math.min(duration, playback.timeS + dtS * playback.speed);
  return { ...playback, timeS: next, playing: next < duration };
}

export function samplePlayback(playback: Playback): MotionFrame {
  return sampleEngineeringMotion(playback.session, playback.timeS);
}

// ---------------------------------------------------------------------------------------------------------------------
// Alteração de parâmetros: a montagem muda, é validada de novo, e a comparação antes/depois usa os mesmos valores.
// ---------------------------------------------------------------------------------------------------------------------
function applyPatch(assembly: Assembly, patch: ParameterPatch): { ok: true } | { ok: false; code: string; message: string } {
  if (patch.kind === 'actuator_max_rate') {
    const actuator = assembly.actuators.find((item) => item.id === patch.actuatorId);
    if (!actuator) return { ok: false, code: 'PARAMETER_UNKNOWN_TARGET', message: `O actuador ${patch.actuatorId} não existe.` };
    (actuator as { maxRate: unknown }).maxRate = { value: patch.value, unit: patch.unit, provenance: patch.provenance };
    return { ok: true };
  }
  if (patch.kind === 'joint_origin') {
    const joint = assembly.joints.find((item) => item.id === patch.jointId);
    if (!joint) return { ok: false, code: 'PARAMETER_UNKNOWN_TARGET', message: `A junta ${patch.jointId} não existe.` };
    joint.origin.translationM = [...patch.translationM] as Vec3;
    joint.origin.provenance.translationM = patch.provenance;
    return { ok: true };
  }
  if (patch.kind === 'joint_limits') {
    const joint = assembly.joints.find((item) => item.id === patch.jointId);
    if (!joint) return { ok: false, code: 'PARAMETER_UNKNOWN_TARGET', message: `A junta ${patch.jointId} não existe.` };
    const unit = joint.type === 'prismatic' ? 'm' : 'rad';
    joint.limits = { min: { value: patch.min, unit, provenance: patch.provenance }, max: { value: patch.max, unit, provenance: patch.provenance } };
    return { ok: true };
  }
  const part = assembly.parts.find((item) => item.id === patch.partId);
  const point = part?.points.find((item) => item.id === patch.pointId);
  if (!point) return { ok: false, code: 'PARAMETER_UNKNOWN_TARGET', message: `O ponto ${patch.partId}.${patch.pointId} não existe.` };
  point.positionM = [...patch.positionM] as Vec3;
  point.provenance = patch.provenance;
  return { ok: true };
}

export function evaluateParameterChange(session: EngineeringSession, patch: ParameterPatch): ParameterResult {
  assertOpen(session);
  const patched = structuredClone(session.assembly);
  const applied = applyPatch(patched, patch);
  if (!applied.ok) return { ok: false, code: applied.code, message: applied.message, issues: [] };
  const check = validateAssembly(patched);
  if (!check.ok) return { ok: false, code: 'PARAMETER_INVALID', message: `A alteração deixa a montagem inválida: ${check.issues.slice(0, 3).map((i) => `${i.path} ${i.code}`).join('; ')}.`, issues: check.issues };

  const values = endValues(session);
  const time = session.durationS;
  const before = evaluateActuators(session.assembly, values, { timestampS: time });
  const after = evaluateActuators(patched, values, { timestampS: time });
  let maxPartDisplacementM: number | null = null;
  if (before.status === 'ok' && after.status === 'ok') {
    maxPartDisplacementM = 0;
    for (const part of before.parts) {
      const other = after.parts.find((item) => item.partId === part.partId)!;
      const d = Math.hypot(...part.translationM.map((v, i) => v - other.translationM[i]!));
      maxPartDisplacementM = Math.max(maxPartDisplacementM, d);
    }
  }
  // A sessão nova começa nos valores que a comparação usou: a máquina não salta de volta para a referência.
  const next: EngineeringSession = { assembly: patched, start: values, segments: [], durationS: 0, closed: false };
  return { ok: true, session: next, before, after, maxPartDisplacementM };
}

