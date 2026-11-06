/**
 * Motor de movimento determinístico sobre o motor de engenharia verificado.
 * Estado transitório de apresentação: nunca escreve na montagem nem em nenhum plano autoritativo.
 * Tempo de simulação separado do frame rate: `step(dtS)` é puro em relação ao relógio dado.
 */
import type { Assembly } from '../contracts';
import type { MotionFrame } from '../contracts';
import {
  evaluateActuators, evaluateConfiguration, referenceConfiguration, solveForwardKinematics,
  loopResiduals, CLOSURE_TOLERANCE_M,
} from './engineering-bridge';

export type MotionReject = { ok: false; code: string; message: string };
export type MotionAccept = { ok: true; durationS: number };
export type PlaybackState = 'idle' | 'playing' | 'paused' | 'reversed' | 'finished';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeInOut = (t: number) => t * t * (3 - 2 * t); // smoothstep: interpolação controlada, repetível

export class LivingMotionEngine {
  private assembly: Assembly;
  private from: Record<string, number>;
  private to: Record<string, number>;
  private fromActuators: Record<string, number> | null = null;
  private toActuators: Record<string, number> | null = null;
  private durationS = 0;
  private timeS = 0;
  private speed = 1;
  private direction: 1 | -1 = 1;
  state: PlaybackState = 'idle';
  private generation = 0;
  private disposed = false;
  readonly reducedMotion: boolean;

  constructor(assembly: Assembly, opts: { reducedMotion?: boolean } = {}) {
    this.assembly = structuredClone(assembly);
    this.from = referenceConfiguration(this.assembly);
    this.to = { ...this.from };
    this.reducedMotion = opts.reducedMotion ?? false;
  }

  get generationToken() { return this.generation; }
  get currentTimeS() { return this.timeS; }
  get totalDurationS() { return this.durationS; }
  get progress() { return this.durationS > 0 ? clamp01(this.timeS / this.durationS) : 0; }

  private assertAlive(gen?: number): void {
    if (this.disposed) throw new Error('LIVING_MOTION_DISPOSED');
    if (gen !== undefined && gen !== this.generation) throw new Error('LIVING_MOTION_STALE');
  }

  /** Configuração actual interpolada (função pura do tempo de simulação). */
  configuration(): Record<string, number> {
    if (this.durationS <= 0) return { ...this.to };
    const t = easeInOut(this.progress);
    // Interpolar ACTUADORES e deixar o solver fechar os laços em cada instante: interpolar ângulos
    // de juntas dependentes quebraria o fecho (residual medido de ~5e-6 m nessa abordagem).
    if (this.fromActuators && this.toActuators) {
      try {
        const values: Record<string, number> = {};
        for (const k of Object.keys(this.toActuators)) values[k] = (this.fromActuators[k] ?? 0) + ((this.toActuators[k] ?? 0) - (this.fromActuators[k] ?? 0)) * t;
        const solved = evaluateActuators(this.assembly, values);
        if (solved.status === 'ok') { const out: Record<string, number> = {}; for (const j of solved.joints) out[j.jointId] = j.value; return out; }
      } catch { /* sem solver de actuadores para esta montagem: cai para interpolação de juntas */ }
    }
    const out: Record<string, number> = {};
    for (const k of Object.keys(this.to)) out[k] = (this.from[k] ?? 0) + ((this.to[k] ?? 0) - (this.from[k] ?? 0)) * t;
    return out;
  }

  frame(gen?: number): MotionFrame {
    this.assertAlive(gen);
    return evaluateConfiguration(this.assembly, this.configuration());
  }

  /** Fecho de laço na configuração actual: residual máximo (m). */
  closureResidualM(gen?: number): number {
    this.assertAlive(gen);
    const state = solveForwardKinematics(this.assembly, this.configuration());
    return Math.max(0, ...loopResiduals(this.assembly, state).map(r => r.residualM));
  }
  closureOk(gen?: number): boolean { return this.closureResidualM(gen) <= Math.max(CLOSURE_TOLERANCE_M, 1e-6); }

  /**
   * Pede movimento por valores de actuador (curso/ângulo). Rejeita fail-closed:
   * actuador desconhecido, valor fora do curso, ou trajectória que viole limites/fecho (amostrada).
   */
  moveToActuators(targets: Record<string, number>, durationS = 2): MotionAccept | MotionReject {
    if (this.disposed) return { ok: false, code: 'DISPOSED', message: 'Motor encerrado.' };
    for (const [id, value] of Object.entries(targets)) {
      const a = this.assembly.actuators.find(x => x.id === id);
      if (!a) return { ok: false, code: 'UNKNOWN_ACTUATOR', message: `Actuador desconhecido: ${id}.` };
      if (!Number.isFinite(value)) return { ok: false, code: 'INVALID_VALUE', message: `Valor inválido para ${id}.` };
      if (a.kind === 'hydraulic_cylinder' && (value < a.stroke.min.value || value > a.stroke.max.value))
        return { ok: false, code: 'STROKE_OUT_OF_RANGE', message: `${a.label}: curso ${value} fora de [${a.stroke.min.value}, ${a.stroke.max.value}] m.` };
    }
    let targetFrame: MotionFrame;
    try { targetFrame = evaluateActuators(this.assembly, { ...this.actuatorValues(), ...targets }); }
    catch (e) { return { ok: false, code: 'ENGINE_REJECTED', message: e instanceof Error ? e.message : String(e) }; }
    if (targetFrame.status !== 'ok') return { ok: false, code: targetFrame.blocked?.code ?? 'BLOCKED', message: targetFrame.blocked?.message ?? 'Configuração bloqueada pelo motor.' };
    const targetConfig: Record<string, number> = {};
    for (const j of targetFrame.joints) targetConfig[j.jointId] = j.value;
    // Amostragem da trajectória nos ACTUADORES (20 pontos): quem fecha os laços é o solver em cada
    // amostra — interpolar ângulos de juntas dependentes quebraria o fecho por construção.
    const startActuators = this.actuatorValues();
    const endActuators = { ...startActuators, ...targets };
    for (let i = 1; i < 20; i++) {
      const t = i / 20; const values: Record<string, number> = {};
      for (const k of Object.keys(endActuators)) values[k] = (startActuators[k] ?? 0) + ((endActuators[k] ?? 0) - (startActuators[k] ?? 0)) * t;
      let sample: MotionFrame;
      try { sample = evaluateActuators(this.assembly, values); } catch { return { ok: false, code: 'TRAJECTORY_BLOCKED', message: 'A trajectória não é resolvível pelo motor.' }; }
      if (sample.status !== 'ok') return { ok: false, code: sample.blocked?.code ?? 'TRAJECTORY_BLOCKED', message: sample.blocked?.message ?? 'A trajectória é bloqueada pelo motor.' };
    }
    const start = this.configuration();
    this.fromActuators = startActuators; this.toActuators = endActuators;
    this.from = start; this.to = targetConfig;
    this.durationS = Math.max(0.1, durationS);
    this.timeS = this.reducedMotion ? this.durationS : 0;
    this.direction = 1;
    this.state = this.reducedMotion ? 'finished' : 'playing';
    this.generation++;
    return { ok: true, durationS: this.durationS };
  }

  actuatorValues(): Record<string, number> {
    const f = evaluateConfiguration(this.assembly, this.configuration());
    const out: Record<string, number> = {};
    for (const a of f.actuators) out[a.actuatorId] = a.value;
    return out;
  }

  play() { if (!this.disposed && this.durationS > 0) { this.direction = 1; this.state = 'playing'; } }
  pause() { if (this.state === 'playing' || this.state === 'reversed') this.state = 'paused'; }
  resume() { if (this.state === 'paused') this.state = this.direction === 1 ? 'playing' : 'reversed'; }
  reverse() { if (!this.disposed && this.durationS > 0) { this.direction = -1; this.state = 'reversed'; } }
  setSpeed(v: number) { if (Number.isFinite(v) && v > 0 && v <= 4) this.speed = v; }
  get currentSpeed() { return this.speed; }

  /** Avanço determinístico: dt do chamador, nunca do relógio de ecrã directamente. */
  step(dtS: number, gen?: number): MotionFrame {
    this.assertAlive(gen);
    if ((this.state === 'playing' || this.state === 'reversed') && Number.isFinite(dtS) && dtS > 0) {
      this.timeS += dtS * this.speed * this.direction;
      if (this.timeS >= this.durationS) { this.timeS = this.durationS; this.state = 'finished'; }
      if (this.timeS <= 0) { this.timeS = 0; this.state = 'idle'; }
    }
    return this.frame(gen);
  }

  seek(timeS: number) { this.timeS = Math.min(this.durationS, Math.max(0, timeS)); if (this.state === 'finished' && this.timeS < this.durationS) this.state = 'paused'; }

  reset() {
    this.generation++;
    this.fromActuators = null; this.toActuators = null;
    this.from = referenceConfiguration(this.assembly); this.to = { ...this.from };
    this.durationS = 0; this.timeS = 0; this.state = 'idle'; this.direction = 1;
  }

  /** Substituição de cena: invalida callbacks pendentes por geração. */
  replaceAssembly(assembly: Assembly) { this.assembly = structuredClone(assembly); this.reset(); }
  cancel() { this.generation++; this.pause(); }
  dispose() { this.disposed = true; this.generation++; this.state = 'idle'; }
  get isDisposed() { return this.disposed; }
}
