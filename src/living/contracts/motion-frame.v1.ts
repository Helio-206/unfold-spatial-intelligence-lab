/**
 * `unfold.motion-frame.v1` — um instantâneo determinístico de uma montagem em movimento.
 *
 * É o que o motor de engenharia produz e o que o renderer e o cinema consomem. O renderer NÃO resolve relações de
 * engenharia: desenha `parts[].translationM/rotation` e mostra `measurements`, `warnings` e `status` tal como vêm.
 *
 * Mesmos dados de entrada (montagem efectiva, comandos, instante) → mesmo quadro, byte a byte: nada aqui depende do
 * relógio, de aleatoriedade ou do histórico. `inputDigest` identifica essa entrada.
 *
 * Convenções: as da montagem (`unfold.assembly.v1`): SI, eixos direitos, +X frente, +Y cima, +Z direita, quaterniões [x,y,z,w].
 * Todas as poses estão expressas no referencial `worldFrameId`.
 */
import type { EvidenceRef } from '../../core';
import { ID_PATTERN, type Quat, type Vec3 } from './assembly.v1';

export const MOTION_FRAME_SCHEMA = 'unfold.motion-frame.v1' as const;

/**
 * ok: poses resolvidas e válidas.
 * blocked: o movimento pedido não é válido (limite, curso, laço impossível, colisão, comando recusado). `poseBasis`
 *   diz que pose se mostra: a última válida ou a de referência. Nunca é uma pose inventada.
 * invalid_assembly: a montagem não passa as verificações de configuração; não há poses.
 */
export const MOTION_FRAME_STATUSES = ['ok', 'blocked', 'invalid_assembly'] as const;
export type MotionFrameStatus = (typeof MOTION_FRAME_STATUSES)[number];
export const POSE_BASES = ['solved', 'held_last_valid', 'reference', 'none'] as const;
export type PoseBasis = (typeof POSE_BASES)[number];

export type PartTransform = { partId: string; translationM: Vec3; rotation: Quat };

export type JointState = {
  jointId: string;
  value: number;
  unit: 'rad' | 'm';
  /** commanded: dado por um actuador; dependent: resolvido pelo fecho de um laço; passive: não accionado nem determinado (valor de referência). */
  kind: 'commanded' | 'dependent' | 'passive';
};

export type ActuatorState = {
  actuatorId: string;
  kind: 'hydraulic_cylinder' | 'rotary_drive';
  /** Curso (m) ou ângulo (rad) pedido neste instante, depois do perfil de movimento. */
  value: number;
  unit: 'm' | 'rad';
  /** Comprimento pino a pino (m), só em cilindros. */
  lengthM: number | null;
  withinLimits: boolean;
  /** Só calculada com um modelo físico suportado e todos os parâmetros presentes (ver `forceStatus`). */
  forceN: number | null;
  forceStatus: 'computed' | 'unknown';
  forceReason: string | null;
};

export type Measurement = {
  id: string;
  label: string;
  status: 'computed' | 'unknown';
  value: number | null;
  unit: 'm' | 'rad' | 'N' | 'none';
  /** Como se obteve (ou por que é desconhecida). */
  method: string;
  subjectIds: string[];
};

export type FrameWarning = { code: string; severity: 'info' | 'warning'; message: string; subjectIds: string[] };

export type SolverStatus = 'solved' | 'blocked' | 'invalid_assembly';

export type SolverInfo = {
  id: string;
  version: string;
  method: string;
  status: SolverStatus;
  /** Maior distância (m) entre pontos que deviam coincidir (restrições de fecho). */
  closureResidualM: number | null;
  toleranceM: number;
  /** Pressupostos numéricos e físicos em vigor. Nunca vazio. */
  assumptions: string[];
};

export type ContactRecord = {
  kind: 'part_part' | 'part_ground';
  partIds: string[];
  shapeIds: string[];
  /** Profundidade de penetração (m) quando calculada; null quando só se sabe que há sobreposição. */
  depthM: number | null;
};

export type CollisionReport = {
  checked: boolean;
  /** Formas verificadas e formas saltadas (e porquê): a cobertura é explícita, nunca implícita. */
  shapesChecked: string[];
  shapesSkipped: Array<{ shapeId: string; reason: string }>;
  groundPlaneChecked: boolean;
  contacts: ContactRecord[];
};

export type BlockedInfo = {
  code: string;
  message: string;
  subjectIds: string[];
  /** Instante (s) do primeiro estado inválido numa trajectória, quando aplicável. */
  firstInvalidTimeS: number | null;
};

export type MotionFrame = {
  schema: typeof MOTION_FRAME_SCHEMA;
  assemblyId: string;
  /** SHA-256 da montagem efectiva (com os parâmetros aprovados aplicados), serialização canónica. */
  assemblyDigest: string;
  /** SHA-256 da entrada completa: montagem efectiva + comandos + instante. */
  inputDigest: string;
  /** Índice na sequência gerada, ou null para uma avaliação pontual. */
  index: number | null;
  timestampS: number;
  worldFrameId: string;
  status: MotionFrameStatus;
  poseBasis: PoseBasis;
  parts: PartTransform[];
  joints: JointState[];
  actuators: ActuatorState[];
  measurements: Measurement[];
  solver: SolverInfo;
  collisions: CollisionReport;
  warnings: FrameWarning[];
  blocked: BlockedInfo | null;
  evidence: EvidenceRef[];
};

// ---------------------------------------------------------------------------------------------------------------------
export type MotionFrameIssue = { path: string; message: string };
export type MotionFrameValidation = { ok: boolean; issues: MotionFrameIssue[] };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const vec = (value: unknown, n: number) => Array.isArray(value) && value.length === n && value.every(finite);
const SHA256 = /^[a-f0-9]{64}$/;

/** Validação da forma de um quadro (para quem consome, sem confiar no produtor). */
export function validateMotionFrame(value: unknown): MotionFrameValidation {
  const issues: MotionFrameIssue[] = [];
  const bad = (path: string, message: string) => { issues.push({ path, message }); };
  if (!isObject(value)) return { ok: false, issues: [{ path: '$', message: 'O quadro tem de ser um objecto.' }] };
  if (value.schema !== MOTION_FRAME_SCHEMA) bad('$.schema', `schema tem de ser ${MOTION_FRAME_SCHEMA}.`);
  if (typeof value.assemblyId !== 'string' || !ID_PATTERN.test(value.assemblyId)) bad('$.assemblyId', 'id inválido.');
  for (const key of ['assemblyDigest', 'inputDigest'] as const) if (typeof value[key] !== 'string' || !SHA256.test(value[key] as string)) bad(`$.${key}`, 'SHA-256 em hexadecimal.');
  if (value.index !== null && !(Number.isInteger(value.index) && (value.index as number) >= 0)) bad('$.index', 'Inteiro ≥ 0 ou null.');
  if (!finite(value.timestampS) || (value.timestampS as number) < 0) bad('$.timestampS', 'Instante finito ≥ 0 (s).');
  if (typeof value.worldFrameId !== 'string') bad('$.worldFrameId', 'Falta o referencial.');
  if (!(MOTION_FRAME_STATUSES as readonly unknown[]).includes(value.status)) bad('$.status', 'Estado desconhecido.');
  if (!(POSE_BASES as readonly unknown[]).includes(value.poseBasis)) bad('$.poseBasis', 'Base da pose desconhecida.');
  const parts = Array.isArray(value.parts) ? value.parts : (bad('$.parts', 'Falta a lista.'), []);
  const seen = new Set<string>();
  parts.forEach((part: unknown, i: number) => {
    const path = `$.parts[${i}]`;
    if (!isObject(part) || typeof part.partId !== 'string') { bad(path, 'Parte inválida.'); return; }
    if (seen.has(part.partId)) bad(`${path}.partId`, 'partId duplicado.'); seen.add(part.partId);
    if (!vec(part.translationM, 3)) bad(`${path}.translationM`, 'Vector de 3 números finitos (m).');
    if (!vec(part.rotation, 4) || Math.abs(Math.hypot(...(part.rotation as number[])) - 1) > 1e-6) bad(`${path}.rotation`, 'Quaternião unitário [x,y,z,w].');
  });
  if (value.status === 'invalid_assembly' && parts.length > 0) bad('$.parts', 'Uma montagem inválida não tem poses.');
  if (value.status === 'ok' && value.poseBasis !== 'solved') bad('$.poseBasis', 'Um quadro ok tem poseBasis "solved".');
  if (value.status === 'ok' && value.blocked !== null) bad('$.blocked', 'Um quadro ok não tem bloqueio.');
  if (value.status !== 'ok' && !isObject(value.blocked)) bad('$.blocked', 'Um quadro bloqueado explica porquê.');
  for (const key of ['joints', 'actuators', 'measurements', 'warnings', 'evidence'] as const) if (!Array.isArray(value[key])) bad(`$.${key}`, 'Falta a lista.');
  (Array.isArray(value.measurements) ? value.measurements : []).forEach((m: unknown, i: number) => {
    if (!isObject(m) || typeof m.id !== 'string') { bad(`$.measurements[${i}]`, 'Medida inválida.'); return; }
    if (m.status === 'computed' && !finite(m.value)) bad(`$.measurements[${i}].value`, 'Uma medida calculada tem valor finito.');
    if (m.status === 'unknown' && m.value !== null) bad(`$.measurements[${i}].value`, 'Uma medida desconhecida tem value null.');
  });
  (Array.isArray(value.actuators) ? value.actuators : []).forEach((a: unknown, i: number) => {
    if (isObject(a) && a.forceStatus === 'unknown' && a.forceN !== null) bad(`$.actuators[${i}].forceN`, 'Força desconhecida tem forceN null.');
    if (isObject(a) && a.forceStatus === 'computed' && !finite(a.forceN)) bad(`$.actuators[${i}].forceN`, 'Força calculada tem valor finito.');
  });
  const solver = value.solver;
  if (!isObject(solver) || typeof solver.id !== 'string' || !Array.isArray(solver.assumptions) || solver.assumptions.length === 0) bad('$.solver', 'O solver identifica-se e declara os pressupostos.');
  if (!isObject(value.collisions) || typeof value.collisions.checked !== 'boolean' || !Array.isArray(value.collisions.contacts)) bad('$.collisions', 'Relatório de colisões inválido.');
  return { ok: issues.length === 0, issues };
}
