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

const ACTUATOR_KINDS = ['hydraulic_cylinder', 'rotary_drive'] as const;
const MEASUREMENT_UNITS = ['m', 'rad', 'N', 'none'] as const;
const SOLVER_STATUSES = ['solved', 'blocked', 'invalid_assembly'] as const;
const CONTACT_KINDS = ['part_part', 'part_ground'] as const;
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const stringList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const oneOf = (list: readonly unknown[], v: unknown) => list.includes(v);

/** Validação de um quadro inteiro (para quem consome, sem confiar no produtor): forma, enums, unidades, números finitos e coerência entre estados. */
export function validateMotionFrame(value: unknown): MotionFrameValidation {
  const issues: MotionFrameIssue[] = [];
  const bad = (path: string, message: string) => { issues.push({ path, message }); };
  if (!isObject(value)) return { ok: false, issues: [{ path: '$', message: 'O quadro tem de ser um objecto.' }] };
  if (value.schema !== MOTION_FRAME_SCHEMA) bad('$.schema', `schema tem de ser ${MOTION_FRAME_SCHEMA}.`);
  if (typeof value.assemblyId !== 'string' || !ID_PATTERN.test(value.assemblyId)) bad('$.assemblyId', 'id inválido.');
  for (const key of ['assemblyDigest', 'inputDigest'] as const) if (typeof value[key] !== 'string' || !SHA256.test(value[key] as string)) bad(`$.${key}`, 'SHA-256 em hexadecimal.');
  if (value.index !== null && !(Number.isInteger(value.index) && (value.index as number) >= 0)) bad('$.index', 'Inteiro ≥ 0 ou null.');
  if (!finite(value.timestampS) || (value.timestampS as number) < 0) bad('$.timestampS', 'Instante finito ≥ 0 (s).');
  if (!nonEmpty(value.worldFrameId)) bad('$.worldFrameId', 'Falta o referencial.');
  if (!oneOf(MOTION_FRAME_STATUSES, value.status)) bad('$.status', 'Estado desconhecido.');
  if (!oneOf(POSE_BASES, value.poseBasis)) bad('$.poseBasis', 'Base da pose desconhecida.');

  const array = (key: string): unknown[] => { const v = value[key]; if (!Array.isArray(v)) { bad(`$.${key}`, 'Falta a lista.'); return []; } return v; };
  const each = (key: string, check: (item: Record<string, unknown>, path: string) => void, idKey?: string) => {
    const seen = new Set<string>();
    array(key).forEach((item, i) => {
      const path = `$.${key}[${i}]`;
      if (!isObject(item)) { bad(path, 'Registo inválido (esperava-se um objecto).'); return; }
      check(item, path);
      if (idKey && typeof item[idKey] === 'string') { if (seen.has(item[idKey] as string)) bad(`${path}.${idKey}`, `${idKey} duplicado.`); seen.add(item[idKey] as string); }
    });
  };
  const text = (item: Record<string, unknown>, path: string, key: string) => { if (!nonEmpty(item[key])) bad(`${path}.${key}`, 'Texto obrigatório.'); };

  each('parts', (part, path) => {
    text(part, path, 'partId');
    if (!vec(part.translationM, 3)) bad(`${path}.translationM`, 'Vector de 3 números finitos (m).');
    if (!vec(part.rotation, 4) || Math.abs(Math.hypot(...(part.rotation as number[])) - 1) > 1e-6) bad(`${path}.rotation`, 'Quaternião unitário [x,y,z,w].');
  }, 'partId');
  each('joints', (joint, path) => {
    text(joint, path, 'jointId');
    if (!finite(joint.value)) bad(`${path}.value`, 'Valor finito.');
    if (!oneOf(['rad', 'm'], joint.unit)) bad(`${path}.unit`, 'Unidade rad ou m.');
    if (!oneOf(['commanded', 'dependent', 'passive'], joint.kind)) bad(`${path}.kind`, 'kind desconhecido.');
  }, 'jointId');
  each('actuators', (a, path) => {
    text(a, path, 'actuatorId');
    if (!oneOf(ACTUATOR_KINDS, a.kind)) bad(`${path}.kind`, 'kind desconhecido.');
    if (!finite(a.value)) bad(`${path}.value`, 'Valor finito.');
    if (!oneOf(['m', 'rad'], a.unit)) bad(`${path}.unit`, 'Unidade m ou rad.');
    if (typeof a.withinLimits !== 'boolean') bad(`${path}.withinLimits`, 'Booleano.');
    if (a.kind === 'hydraulic_cylinder') {
      if (a.unit !== 'm') bad(`${path}.unit`, 'Um cilindro é medido em m (curso).');
      if (!finite(a.lengthM) || (a.lengthM as number) <= 0) bad(`${path}.lengthM`, 'Um cilindro tem comprimento finito > 0.');
    } else if (a.kind === 'rotary_drive') {
      if (a.unit !== 'rad') bad(`${path}.unit`, 'Um accionamento rotativo é medido em rad.');
      if (a.lengthM !== null) bad(`${path}.lengthM`, 'Só os cilindros têm comprimento.');
    }
    if (!oneOf(['computed', 'unknown'], a.forceStatus)) bad(`${path}.forceStatus`, 'forceStatus desconhecido.');
    else if (a.forceStatus === 'computed') {
      if (!finite(a.forceN)) bad(`${path}.forceN`, 'Força calculada tem valor finito.');
      if (a.forceReason !== null) bad(`${path}.forceReason`, 'Força calculada não tem razão de desconhecida.');
    } else {
      if (a.forceN !== null) bad(`${path}.forceN`, 'Força desconhecida tem forceN null.');
      if (!nonEmpty(a.forceReason)) bad(`${path}.forceReason`, 'Força desconhecida explica porquê.');
    }
  }, 'actuatorId');
  each('measurements', (m, path) => {
    text(m, path, 'id'); text(m, path, 'label'); text(m, path, 'method');
    if (!oneOf(MEASUREMENT_UNITS, m.unit)) bad(`${path}.unit`, 'Unidade desconhecida.');
    if (!stringList(m.subjectIds)) bad(`${path}.subjectIds`, 'Lista de strings.');
    if (m.status === 'computed') { if (!finite(m.value)) bad(`${path}.value`, 'Uma medida calculada tem valor finito.'); }
    else if (m.status === 'unknown') { if (m.value !== null) bad(`${path}.value`, 'Uma medida desconhecida tem value null.'); }
    else bad(`${path}.status`, 'Estado desconhecido.');
  }, 'id');
  each('warnings', (w, path) => {
    text(w, path, 'code'); text(w, path, 'message');
    if (!oneOf(['info', 'warning'], w.severity)) bad(`${path}.severity`, 'Severidade desconhecida.');
    if (!stringList(w.subjectIds)) bad(`${path}.subjectIds`, 'Lista de strings.');
  });
  each('evidence', (e, path) => {
    text(e, path, 'sourceId');
    for (const key of ['locator', 'excerpt'] as const) if (e[key] !== undefined && typeof e[key] !== 'string') bad(`${path}.${key}`, 'String quando presente.');
  });

  const solver = value.solver;
  let solverStatus: unknown;
  if (!isObject(solver)) bad('$.solver', 'Falta o solver.');
  else {
    solverStatus = solver.status;
    for (const key of ['id', 'version', 'method'] as const) text(solver, '$.solver', key);
    if (!oneOf(SOLVER_STATUSES, solver.status)) bad('$.solver.status', 'Estado desconhecido.');
    if (solver.closureResidualM !== null && (!finite(solver.closureResidualM) || (solver.closureResidualM as number) < 0)) bad('$.solver.closureResidualM', 'Número finito ≥ 0 ou null.');
    if (!finite(solver.toleranceM) || (solver.toleranceM as number) <= 0) bad('$.solver.toleranceM', 'Tolerância finita > 0 (m).');
    if (!Array.isArray(solver.assumptions) || solver.assumptions.length === 0 || solver.assumptions.some((a: unknown) => !nonEmpty(a))) bad('$.solver.assumptions', 'O solver declara pressupostos (lista não vazia de textos).');
  }

  const collisions = value.collisions;
  if (!isObject(collisions)) bad('$.collisions', 'Falta o relatório de colisões.');
  else {
    if (typeof collisions.checked !== 'boolean') bad('$.collisions.checked', 'Booleano.');
    if (typeof collisions.groundPlaneChecked !== 'boolean') bad('$.collisions.groundPlaneChecked', 'Booleano.');
    if (!stringList(collisions.shapesChecked)) bad('$.collisions.shapesChecked', 'Lista de strings.');
    if (!Array.isArray(collisions.shapesSkipped)) bad('$.collisions.shapesSkipped', 'Falta a lista.');
    else collisions.shapesSkipped.forEach((skipped: unknown, i: number) => {
      const path = `$.collisions.shapesSkipped[${i}]`;
      if (!isObject(skipped)) { bad(path, 'Registo inválido (esperava-se um objecto).'); return; }
      text(skipped, path, 'shapeId'); text(skipped, path, 'reason');
    });
    if (!Array.isArray(collisions.contacts)) bad('$.collisions.contacts', 'Falta a lista.');
    else collisions.contacts.forEach((contact: unknown, i: number) => {
      const path = `$.collisions.contacts[${i}]`;
      if (!isObject(contact)) { bad(path, 'Registo inválido (esperava-se um objecto).'); return; }
      if (!oneOf(CONTACT_KINDS, contact.kind)) bad(`${path}.kind`, 'kind desconhecido.');
      if (!stringList(contact.partIds) || (contact.kind === 'part_part' && contact.partIds.length !== 2) || (contact.kind === 'part_ground' && contact.partIds.length !== 1)) bad(`${path}.partIds`, 'part_part tem 2 partes, part_ground tem 1.');
      if (!stringList(contact.shapeIds)) bad(`${path}.shapeIds`, 'Lista de strings.');
      if (contact.depthM !== null && (!finite(contact.depthM) || (contact.depthM as number) < 0)) bad(`${path}.depthM`, 'Número finito ≥ 0 ou null.');
    });
  }

  // blocked: null ou um registo completo.
  const blocked = value.blocked;
  const hasBlocked = blocked !== null && blocked !== undefined;
  if (blocked === undefined) bad('$.blocked', 'Falta o campo (null quando não há bloqueio).');
  else if (blocked !== null) {
    if (!isObject(blocked)) bad('$.blocked', 'Registo inválido (esperava-se um objecto ou null).');
    else {
      text(blocked, '$.blocked', 'code'); text(blocked, '$.blocked', 'message');
      if (!stringList(blocked.subjectIds)) bad('$.blocked.subjectIds', 'Lista de strings.');
      if (blocked.firstInvalidTimeS !== null && (!finite(blocked.firstInvalidTimeS) || (blocked.firstInvalidTimeS as number) < 0)) bad('$.blocked.firstInvalidTimeS', 'Número finito ≥ 0 ou null.');
    }
  }

  // Coerência entre status, poseBasis, blocked, solver.status e poses.
  const parts = Array.isArray(value.parts) ? value.parts : [];
  const { status, poseBasis } = value;
  if (status === 'ok') {
    if (poseBasis !== 'solved') bad('$.poseBasis', 'Um quadro ok tem poseBasis "solved".');
    if (hasBlocked) bad('$.blocked', 'Um quadro ok não tem bloqueio.');
    if (solverStatus !== undefined && solverStatus !== 'solved') bad('$.solver.status', 'Um quadro ok tem solver.status "solved".');
  } else if (status === 'blocked') {
    if (poseBasis === 'solved') bad('$.poseBasis', 'Um quadro bloqueado não tem uma pose "solved".');
    if (!hasBlocked) bad('$.blocked', 'Um quadro bloqueado explica porquê.');
    if (solverStatus !== undefined && solverStatus !== 'blocked') bad('$.solver.status', 'Um quadro bloqueado tem solver.status "blocked".');
  } else if (status === 'invalid_assembly') {
    if (poseBasis !== 'none') bad('$.poseBasis', 'Uma montagem inválida não tem pose (poseBasis "none").');
    if (parts.length > 0) bad('$.parts', 'Uma montagem inválida não tem poses.');
    if (!hasBlocked) bad('$.blocked', 'Uma montagem inválida explica porquê.');
    if (solverStatus !== undefined && solverStatus !== 'invalid_assembly') bad('$.solver.status', 'Uma montagem inválida tem solver.status "invalid_assembly".');
  }
  if (poseBasis === 'none' && parts.length > 0) bad('$.parts', 'poseBasis "none" não tem poses.');
  if ((poseBasis === 'solved' || poseBasis === 'held_last_valid' || poseBasis === 'reference') && parts.length === 0) bad('$.parts', `poseBasis "${String(poseBasis)}" tem poses.`);
  return { ok: issues.length === 0, issues };
}
