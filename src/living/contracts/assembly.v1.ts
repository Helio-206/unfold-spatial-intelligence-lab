/**
 * `unfold.assembly.v1` — o contrato partilhado de uma montagem articulada.
 *
 * Quem produz (reconstrução, importação, fixtures) escreve montagens neste formato; quem consome (motor de engenharia,
 * renderer, cinema) lê-as daqui. O motor é o único que resolve relações de engenharia; este ficheiro só descreve dados
 * e valida a sua forma.
 *
 * Convenções (fixas na v1, não configuráveis):
 *  - Sistema de eixos direito: +X para a frente da máquina, +Y para cima, +Z para o lado direito do operador.
 *  - Unidades SI: comprimentos em metros, ângulos em radianos, tempo em segundos. Outra unidade é recusada, nunca convertida.
 *  - Rotação positiva em torno de um eixo segue a regra da mão direita. Quaterniões como [x, y, z, w], unitários.
 *  - Cada parte tem o seu referencial local. A pose de uma parte filha obtém-se por
 *      T_filha = T_pai · origem_da_junta · movimento(eixo, q)
 *    com a origem da junta expressa no referencial do pai e o eixo no referencial da junta (o da filha em q = 0).
 *  - Todo o número da montagem tem proveniência (Core). Um valor nunca é promovido por ser lido ou calculado:
 *    `fixture`/`synthetic` continuam a ser exemplo, `human_entered` continua `unreviewed` até alguém o confirmar.
 *  - `null` significa desconhecido, nunca zero.
 */
import { isOrigin, isValidation, type EvidenceRef, type Provenance } from '../../core';

export const ASSEMBLY_SCHEMA = 'unfold.assembly.v1' as const;

export type Vec3 = [number, number, number];
/** [x, y, z, w], unitário. */
export type Quat = [number, number, number, number];

export const ASSEMBLY_UNITS = ['m', 'rad', 's', 'm/s', 'rad/s', 'kg', 'Pa', 'N', 'none'] as const;
export type AssemblyUnit = (typeof ASSEMBLY_UNITS)[number];

/** Um escalar com unidade e proveniência. */
export type Quantity = { value: number; unit: AssemblyUnit; provenance: Provenance };

export type Pose = {
  translationM: Vec3;
  rotation: Quat;
  provenance: { translationM: Provenance; rotation: Provenance };
};

export type SourceDocument = {
  id: string;
  kind: 'datasheet' | 'drawing' | 'user_input' | 'fixture' | 'other';
  title: string;
  uri?: string;
  sha256?: string;
};

export type CoordinateFrame = {
  id: string;
  /** null só no referencial do mundo. */
  parentFrameId: string | null;
  kind: 'world' | 'static';
  /** Pose deste referencial no do pai. */
  pose: Pose;
  description: string;
};

export const PART_ROLES = ['chassis', 'upper_body', 'boom', 'stick', 'bucket', 'cylinder_barrel', 'cylinder_rod', 'link', 'other'] as const;
export type PartRole = (typeof PART_ROLES)[number];

export const POINT_ROLES = ['pin', 'anchor', 'tool_tip', 'reference'] as const;
export type PointRole = (typeof POINT_ROLES)[number];
/** Ponto nomeado no referencial local de uma parte: pinos, ancoragens, ponta da ferramenta. */
export type Point = { id: string; role: PointRole; positionM: Vec3; provenance: Provenance };

export type BoxShape = { id: string; kind: 'box'; halfExtentsM: Vec3; pose: Pose; purpose: ShapePurpose; provenance: Provenance };
/** Cilindro com o eixo ao longo do X local da forma. */
export type CylinderShape = { id: string; kind: 'cylinder'; radiusM: number; halfLengthM: number; pose: Pose; purpose: ShapePurpose; provenance: Provenance };
export type Shape = BoxShape | CylinderShape;
export const SHAPE_PURPOSES = ['visual', 'collision', 'both'] as const;
export type ShapePurpose = (typeof SHAPE_PURPOSES)[number];

export type Part = {
  id: string;
  label: string;
  role: PartRole;
  points: Point[];
  shapes: Shape[];
  /** null = desconhecida. O motor nunca assume massa. */
  massKg: Quantity | null;
  provenance: Provenance;
};

export const JOINT_TYPES = ['fixed', 'revolute', 'prismatic'] as const;
export type JointType = (typeof JOINT_TYPES)[number];
export const MOTION_NAMES = ['raise', 'lower', 'extend', 'retract', 'curl', 'dump', 'swing_left', 'swing_right'] as const;
export type MotionName = (typeof MOTION_NAMES)[number];

export type Joint = {
  id: string;
  type: JointType;
  parentPartId: string;
  childPartId: string;
  /** Pose da junta (= referencial da filha em q = 0) no referencial do pai. */
  origin: Pose;
  /** Eixo unitário no referencial da junta. Ignorado em `fixed`. */
  axis: Vec3;
  /** Obrigatório em revolute/prismatic. rad ou m, conforme o tipo. */
  limits: { min: Quantity; max: Quantity } | null;
  /** Valor da junta na configuração de referência da montagem. */
  referenceValue: Quantity | null;
  /** Nomes do movimento para q crescente / decrescente («raise» = o braço sobe). Para juntas accionadas por pedidos em linguagem natural. */
  motion: { positive: MotionName; negative: MotionName } | null;
  provenance: Provenance;
};

/** Um ponto de uma parte, referido por id. */
export type PointRef = { partId: string; pointId: string };

/** A v1 só tem fecho de laço por pinos: dois pontos de partes diferentes têm de coincidir em qualquer configuração. */
export type Constraint = {
  id: string;
  kind: 'coincident_points';
  a: PointRef;
  b: PointRef;
  provenance: Provenance;
};

export type Hydraulics = {
  boreDiameter: Quantity | null;
  rodDiameter: Quantity | null;
  supplyPressure: Quantity | null;
};

export type CylinderDrive = {
  /** A junta de rotação cujo ângulo este cilindro determina. */
  jointId: string;
  /** direct_triangle: base na parte-pai da junta, haste na parte-filha. two_link_chain: haste ligada a um balancé de duas barras. */
  transmission: 'direct_triangle' | 'two_link_chain';
  /** Restrições de fecho do laço, por ordem: haste → pino do laço [, barra final → parte accionada]. */
  constraintIds: string[];
  /** Barras intermédias, por ordem de montagem (vazio no triângulo directo). */
  linkPartIds: string[];
};

export type HydraulicCylinder = {
  id: string;
  label: string;
  kind: 'hydraulic_cylinder';
  barrelPartId: string;
  rodPartId: string;
  /** A junta prismática barril → haste. O seu valor é o curso (extensão da haste a partir do comprimento fechado). */
  slideJointId: string;
  stroke: { min: Quantity; max: Quantity };
  referenceStroke: Quantity;
  /** m/s. null = desconhecida; sem ela, uma duração tem de ser dada no comando. */
  maxRate: Quantity | null;
  hydraulics: Hydraulics;
  drives: CylinderDrive;
  provenance: Provenance;
};

export type RotaryDrive = {
  id: string;
  label: string;
  kind: 'rotary_drive';
  jointId: string;
  /** rad/s. */
  maxRate: Quantity | null;
  provenance: Provenance;
};

export type Actuator = HydraulicCylinder | RotaryDrive;

export type CollisionPolicy = {
  /** Plano do chão (y = yM), ou null para não verificar o chão. */
  groundPlane: { yM: number; ignorePartIds: string[] } | null;
  /** Pares que não se verificam além dos ligados por uma junta ou por um pino. */
  ignorePairs: Array<[string, string]>;
  /** `block`: um contacto invalida a configuração. `warn`: só aparece nos avisos. */
  onContact: 'block' | 'warn';
};

export type Assembly = {
  schema: typeof ASSEMBLY_SCHEMA;
  id: string;
  title: string;
  /** Redundante de propósito: uma montagem noutras unidades é recusada em vez de convertida em silêncio. */
  units: { length: 'm'; angle: 'rad'; time: 's' };
  sources: SourceDocument[];
  frames: CoordinateFrame[];
  /** A parte raiz e onde está: pose no referencial `frameId`. */
  root: { partId: string; frameId: string; pose: Pose };
  parts: Part[];
  joints: Joint[];
  constraints: Constraint[];
  actuators: Actuator[];
  collision: CollisionPolicy;
  /** Notas de proveniência da montagem inteira. */
  provenance: Provenance;
};

// ---------------------------------------------------------------------------------------------------------------------
// Validação da forma. Só estrutura, referências, unidades e proveniência; a validade geométrica (fecho dos laços,
// planaridade, referência dentro dos limites) é do motor, que sabe resolver as relações.
// ---------------------------------------------------------------------------------------------------------------------

export type AssemblyIssueCode =
  | 'NOT_AN_OBJECT' | 'SCHEMA_MISMATCH' | 'MISSING_FIELD' | 'INVALID_ID' | 'DUPLICATE_ID' | 'INVALID_NUMBER' | 'INVALID_UNIT'
  | 'INVALID_PROVENANCE' | 'INVALID_QUATERNION' | 'INVALID_ENUM' | 'UNKNOWN_REFERENCE' | 'INVALID_TREE' | 'INVALID_LIMITS'
  | 'INVALID_ACTUATOR' | 'INVALID_CONSTRAINT' | 'INVALID_FRAME';
export type AssemblyIssue = { code: AssemblyIssueCode; path: string; message: string };
export type AssemblyValidation = { ok: boolean; issues: AssemblyIssue[] };

export class AssemblyContractError extends Error {
  readonly code = 'ASSEMBLY_CONTRACT_INVALID';
  constructor(readonly issues: AssemblyIssue[]) {
    super(`unfold.assembly.v1 inválido: ${issues.slice(0, 3).map((issue) => `${issue.path}: ${issue.code}`).join('; ')}${issues.length > 3 ? ` (+${issues.length - 3})` : ''}`);
    this.name = 'AssemblyContractError';
  }
}

export const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
export const QUATERNION_TOLERANCE = 1e-6;
export const AXIS_TOLERANCE = 1e-6;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isVec = (value: unknown, length: number): value is number[] => Array.isArray(value) && value.length === length && value.every(isFiniteNumber);
const isIso = (value: unknown): boolean => typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));

export function validateAssembly(value: unknown): AssemblyValidation {
  const issues: AssemblyIssue[] = [];
  const add = (code: AssemblyIssueCode, path: string, message: string) => { issues.push({ code, path, message }); };
  if (!isObject(value)) { add('NOT_AN_OBJECT', '$', 'A montagem tem de ser um objecto.'); return { ok: false, issues }; }
  if (value.schema !== ASSEMBLY_SCHEMA) add('SCHEMA_MISMATCH', '$.schema', `schema tem de ser ${ASSEMBLY_SCHEMA}.`);

  const provenanceOk = (path: string, provenance: unknown): provenance is Provenance => {
    if (!isObject(provenance)) { add('INVALID_PROVENANCE', path, 'Falta a proveniência.'); return false; }
    if (!isOrigin(provenance.origin)) { add('INVALID_PROVENANCE', `${path}.origin`, 'origin desconhecida.'); return false; }
    if (!isValidation(provenance.validation)) { add('INVALID_PROVENANCE', `${path}.validation`, 'validation desconhecida.'); return false; }
    if (!isIso(provenance.recordedAt)) { add('INVALID_PROVENANCE', `${path}.recordedAt`, 'recordedAt tem de ser uma data ISO.'); return false; }
    if ((provenance.validation === 'verified' || provenance.validation === 'corrected') && typeof provenance.authorizationId !== 'string') {
      add('INVALID_PROVENANCE', `${path}.authorizationId`, 'Um valor confirmado precisa de authorizationId.'); return false;
    }
    if (provenance.evidence !== undefined && (!Array.isArray(provenance.evidence) || provenance.evidence.some((ref: EvidenceRef) => !isObject(ref) || typeof ref.sourceId !== 'string'))) {
      add('INVALID_PROVENANCE', `${path}.evidence`, 'evidence tem de ser uma lista de {sourceId}.'); return false;
    }
    return true;
  };
  const idOk = (path: string, id: unknown, seen: Set<string>): id is string => {
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) { add('INVALID_ID', path, 'id inválido.'); return false; }
    if (seen.has(id)) { add('DUPLICATE_ID', path, `id duplicado: ${id}.`); return false; }
    seen.add(id); return true;
  };
  const quantityOk = (path: string, q: unknown, units: readonly AssemblyUnit[]): q is Quantity => {
    if (!isObject(q)) { add('INVALID_NUMBER', path, 'Falta a quantidade.'); return false; }
    if (!isFiniteNumber(q.value)) add('INVALID_NUMBER', `${path}.value`, 'Valor finito em falta.');
    if (!units.includes(q.unit as AssemblyUnit)) add('INVALID_UNIT', `${path}.unit`, `A unidade tem de ser ${units.join(' ou ')}.`);
    return provenanceOk(`${path}.provenance`, q.provenance) && isFiniteNumber(q.value) && units.includes(q.unit as AssemblyUnit);
  };
  const optionalQuantity = (path: string, q: unknown, units: readonly AssemblyUnit[]) => { if (q !== null) quantityOk(path, q, units); };
  // Uma taxa máxima tem de ser positiva: com zero ou negativa, a duração de um movimento não existe ou não faz sentido.
  const positiveRate = (path: string, q: unknown) => { if (isObject(q) && isFiniteNumber(q.value) && q.value <= 0) add('INVALID_NUMBER', `${path}.value`, 'A velocidade máxima tem de ser positiva.'); };
  const poseOk = (path: string, pose: unknown) => {
    if (!isObject(pose)) { add('MISSING_FIELD', path, 'Falta a pose.'); return; }
    if (!isVec(pose.translationM, 3)) add('INVALID_NUMBER', `${path}.translationM`, 'Vector de 3 números finitos (m).');
    if (!isVec(pose.rotation, 4)) add('INVALID_QUATERNION', `${path}.rotation`, 'Quaternião [x,y,z,w].');
    else if (Math.abs(Math.hypot(...(pose.rotation as number[])) - 1) > QUATERNION_TOLERANCE) add('INVALID_QUATERNION', `${path}.rotation`, 'O quaternião tem de ser unitário.');
    if (!isObject(pose.provenance)) add('INVALID_PROVENANCE', `${path}.provenance`, 'Falta a proveniência da pose.');
    else { provenanceOk(`${path}.provenance.translationM`, pose.provenance.translationM); provenanceOk(`${path}.provenance.rotation`, pose.provenance.rotation); }
  };
  const enumOk = (path: string, v: unknown, allowed: readonly string[]) => { if (!allowed.includes(v as string)) add('INVALID_ENUM', path, `Valor fora de {${allowed.join(', ')}}.`); };
  const list = (path: string, v: unknown): unknown[] => { if (!Array.isArray(v)) { add('MISSING_FIELD', path, 'Falta a lista.'); return []; } return v; };

  if (typeof value.id !== 'string' || !ID_PATTERN.test(value.id)) add('INVALID_ID', '$.id', 'id inválido.');
  if (typeof value.title !== 'string' || !value.title.trim()) add('MISSING_FIELD', '$.title', 'Falta o título.');
  const units = value.units;
  if (!isObject(units) || units.length !== 'm' || units.angle !== 'rad' || units.time !== 's') add('INVALID_UNIT', '$.units', 'A v1 só aceita {length:"m", angle:"rad", time:"s"}.');
  provenanceOk('$.provenance', value.provenance);

  const sourceIds = new Set<string>();
  list('$.sources', value.sources).forEach((source, i) => {
    const path = `$.sources[${i}]`;
    if (!isObject(source)) { add('MISSING_FIELD', path, 'Fonte inválida.'); return; }
    idOk(`${path}.id`, source.id, sourceIds);
    enumOk(`${path}.kind`, source.kind, ['datasheet', 'drawing', 'user_input', 'fixture', 'other']);
    if (typeof source.title !== 'string' || !source.title.trim()) add('MISSING_FIELD', `${path}.title`, 'Falta o título da fonte.');
  });

  // Referenciais.
  const frameIds = new Set<string>();
  const frames = list('$.frames', value.frames);
  frames.forEach((frame, i) => {
    const path = `$.frames[${i}]`;
    if (!isObject(frame)) { add('INVALID_FRAME', path, 'Referencial inválido.'); return; }
    idOk(`${path}.id`, frame.id, frameIds);
    enumOk(`${path}.kind`, frame.kind, ['world', 'static']);
    poseOk(`${path}.pose`, frame.pose);
    if (typeof frame.description !== 'string') add('MISSING_FIELD', `${path}.description`, 'Falta a descrição.');
  });
  const worlds = frames.filter((frame) => isObject(frame) && frame.kind === 'world');
  if (worlds.length !== 1) add('INVALID_FRAME', '$.frames', 'Tem de haver exactamente um referencial do mundo.');
  frames.forEach((frame, i) => {
    if (!isObject(frame)) return;
    const path = `$.frames[${i}].parentFrameId`;
    if (frame.kind === 'world') { if (frame.parentFrameId !== null) add('INVALID_FRAME', path, 'O mundo não tem pai.'); }
    else if (typeof frame.parentFrameId !== 'string' || !frameIds.has(frame.parentFrameId)) add('UNKNOWN_REFERENCE', path, 'Pai desconhecido.');
  });

  // Toda a cadeia de pais tem de chegar ao mundo: um ciclo (A → B → A, ou um referencial pai de si próprio) nunca chega.
  const parentFrame = new Map<string, string | null>();
  for (const frame of frames) if (isObject(frame) && typeof frame.id === 'string' && !parentFrame.has(frame.id)) parentFrame.set(frame.id, typeof frame.parentFrameId === 'string' ? frame.parentFrameId : null);
  const reachesWorld = new Map<string, boolean>();
  const worldId = (worlds[0] as { id?: string } | undefined)?.id;
  for (const start of parentFrame.keys()) {
    const chain: string[] = []; let cursor: string | null | undefined = start; let ok = false;
    while (cursor !== null && cursor !== undefined) {
      if (cursor === worldId) { ok = true; break; }
      if (reachesWorld.has(cursor)) { ok = reachesWorld.get(cursor)!; break; }
      if (chain.includes(cursor)) break;
      chain.push(cursor); cursor = parentFrame.get(cursor);
    }
    for (const id of chain) reachesWorld.set(id, ok);
    if (!ok && !reachesWorld.has(start)) reachesWorld.set(start, false);
  }
  frames.forEach((frame, i) => {
    if (isObject(frame) && typeof frame.id === 'string' && frame.kind === 'static' && reachesWorld.get(frame.id) === false) add('INVALID_FRAME', `$.frames[${i}].parentFrameId`, `A cadeia de pais de ${frame.id} não chega ao mundo (ciclo ou pai em falta).`);
  });

  // Partes.
  const partIds = new Set<string>();
  const pointsByPart = new Map<string, Set<string>>();
  list('$.parts', value.parts).forEach((part, i) => {
    const path = `$.parts[${i}]`;
    if (!isObject(part)) { add('MISSING_FIELD', path, 'Parte inválida.'); return; }
    const ok = idOk(`${path}.id`, part.id, partIds);
    if (typeof part.label !== 'string' || !part.label.trim()) add('MISSING_FIELD', `${path}.label`, 'Falta o nome.');
    enumOk(`${path}.role`, part.role, PART_ROLES);
    provenanceOk(`${path}.provenance`, part.provenance);
    if (part.massKg === undefined) add('MISSING_FIELD', `${path}.massKg`, 'massKg é null quando desconhecida.');
    else optionalQuantity(`${path}.massKg`, part.massKg, ['kg']);
    const points = new Set<string>();
    list(`${path}.points`, part.points).forEach((point, j) => {
      const pointPath = `${path}.points[${j}]`;
      if (!isObject(point)) { add('MISSING_FIELD', pointPath, 'Ponto inválido.'); return; }
      idOk(`${pointPath}.id`, point.id, points);
      enumOk(`${pointPath}.role`, point.role, POINT_ROLES);
      if (!isVec(point.positionM, 3)) add('INVALID_NUMBER', `${pointPath}.positionM`, 'Vector de 3 números finitos (m).');
      provenanceOk(`${pointPath}.provenance`, point.provenance);
    });
    const shapes = new Set<string>();
    list(`${path}.shapes`, part.shapes).forEach((shape, j) => {
      const shapePath = `${path}.shapes[${j}]`;
      if (!isObject(shape)) { add('MISSING_FIELD', shapePath, 'Forma inválida.'); return; }
      idOk(`${shapePath}.id`, shape.id, shapes);
      enumOk(`${shapePath}.purpose`, shape.purpose, SHAPE_PURPOSES);
      enumOk(`${shapePath}.kind`, shape.kind, ['box', 'cylinder']);
      if (shape.kind === 'box' && (!isVec(shape.halfExtentsM, 3) || (shape.halfExtentsM as number[]).some((v) => v <= 0))) add('INVALID_NUMBER', `${shapePath}.halfExtentsM`, 'Três meias-dimensões positivas (m).');
      if (shape.kind === 'cylinder' && (!isFiniteNumber(shape.radiusM) || shape.radiusM <= 0 || !isFiniteNumber(shape.halfLengthM) || shape.halfLengthM <= 0)) add('INVALID_NUMBER', `${shapePath}`, 'radiusM e halfLengthM positivos (m).');
      poseOk(`${shapePath}.pose`, shape.pose);
      provenanceOk(`${shapePath}.provenance`, shape.provenance);
    });
    if (ok) pointsByPart.set(part.id as string, points);
  });

  // Raiz.
  const root = value.root;
  if (!isObject(root)) add('MISSING_FIELD', '$.root', 'Falta a raiz.');
  else {
    if (typeof root.partId !== 'string' || !partIds.has(root.partId)) add('UNKNOWN_REFERENCE', '$.root.partId', 'Parte raiz desconhecida.');
    if (typeof root.frameId !== 'string' || !frameIds.has(root.frameId)) add('UNKNOWN_REFERENCE', '$.root.frameId', 'Referencial da raiz desconhecido.');
    else if (reachesWorld.get(root.frameId) === false) add('INVALID_FRAME', '$.root.frameId', 'O referencial da raiz não chega ao mundo.');
    poseOk('$.root.pose', root.pose);
  }

  // Juntas e árvore.
  const jointIds = new Set<string>();
  const jointsById = new Map<string, Record<string, unknown>>();
  const parentOf = new Map<string, string>();
  list('$.joints', value.joints).forEach((joint, i) => {
    const path = `$.joints[${i}]`;
    if (!isObject(joint)) { add('MISSING_FIELD', path, 'Junta inválida.'); return; }
    if (idOk(`${path}.id`, joint.id, jointIds)) jointsById.set(joint.id as string, joint);
    enumOk(`${path}.type`, joint.type, JOINT_TYPES);
    for (const key of ['parentPartId', 'childPartId'] as const) if (typeof joint[key] !== 'string' || !partIds.has(joint[key] as string)) add('UNKNOWN_REFERENCE', `${path}.${key}`, 'Parte desconhecida.');
    if (joint.parentPartId === joint.childPartId) add('INVALID_TREE', path, 'Uma junta não liga uma parte a si própria.');
    poseOk(`${path}.origin`, joint.origin);
    if (!isVec(joint.axis, 3) || Math.abs(Math.hypot(...(joint.axis as number[])) - 1) > AXIS_TOLERANCE) add('INVALID_NUMBER', `${path}.axis`, 'Eixo unitário.');
    provenanceOk(`${path}.provenance`, joint.provenance);
    const unit: AssemblyUnit = joint.type === 'prismatic' ? 'm' : 'rad';
    if (joint.type === 'fixed') {
      if (joint.limits !== null) add('INVALID_LIMITS', `${path}.limits`, 'Uma junta fixa não tem limites.');
    } else if (!isObject(joint.limits)) add('INVALID_LIMITS', `${path}.limits`, 'Limites obrigatórios.');
    else {
      const min = quantityOk(`${path}.limits.min`, joint.limits.min, [unit]); const max = quantityOk(`${path}.limits.max`, joint.limits.max, [unit]);
      if (min && max && (joint.limits.min as Quantity).value >= (joint.limits.max as Quantity).value) add('INVALID_LIMITS', `${path}.limits`, 'min tem de ser menor que max.');
    }
    if (joint.referenceValue !== null && joint.referenceValue !== undefined) {
      if (quantityOk(`${path}.referenceValue`, joint.referenceValue, [unit]) && isObject(joint.limits) && isObject(joint.limits.min) && isObject(joint.limits.max)) {
        const v = (joint.referenceValue as Quantity).value;
        if (v < (joint.limits.min as Quantity).value || v > (joint.limits.max as Quantity).value) add('INVALID_LIMITS', `${path}.referenceValue`, 'O valor de referência está fora dos limites.');
      }
    } else if (joint.referenceValue === undefined) add('MISSING_FIELD', `${path}.referenceValue`, 'referenceValue é null quando desconhecido.');
    if (joint.motion !== null) {
      if (!isObject(joint.motion)) add('INVALID_ENUM', `${path}.motion`, 'motion é {positive, negative} ou null.');
      else { enumOk(`${path}.motion.positive`, joint.motion.positive, MOTION_NAMES); enumOk(`${path}.motion.negative`, joint.motion.negative, MOTION_NAMES); }
    }
    if (typeof joint.childPartId === 'string') {
      if (parentOf.has(joint.childPartId)) add('INVALID_TREE', `${path}.childPartId`, `${joint.childPartId} já tem junta-pai.`);
      else if (typeof joint.parentPartId === 'string') parentOf.set(joint.childPartId, joint.parentPartId);
    }
  });
  const rootId = isObject(root) && typeof root.partId === 'string' ? root.partId : null;
  for (const id of partIds) {
    if (id === rootId) { if (parentOf.has(id)) add('INVALID_TREE', '$.root.partId', 'A raiz não pode ter junta-pai.'); continue; }
    let cursor: string | undefined = id; const visited = new Set<string>();
    while (cursor !== undefined && cursor !== rootId && !visited.has(cursor)) { visited.add(cursor); cursor = parentOf.get(cursor); }
    if (cursor !== rootId) add('INVALID_TREE', '$.joints', `${id} não chega à raiz pela árvore de juntas.`);
  }

  // Restrições (fecho de laços).
  const constraintIds = new Set<string>();
  list('$.constraints', value.constraints).forEach((constraint, i) => {
    const path = `$.constraints[${i}]`;
    if (!isObject(constraint)) { add('INVALID_CONSTRAINT', path, 'Restrição inválida.'); return; }
    idOk(`${path}.id`, constraint.id, constraintIds);
    if (constraint.kind !== 'coincident_points') add('INVALID_CONSTRAINT', `${path}.kind`, 'A v1 só tem coincident_points.');
    provenanceOk(`${path}.provenance`, constraint.provenance);
    for (const side of ['a', 'b'] as const) {
      const ref = constraint[side];
      if (!isObject(ref) || typeof ref.partId !== 'string' || typeof ref.pointId !== 'string' || !pointsByPart.get(ref.partId)?.has(ref.pointId)) add('UNKNOWN_REFERENCE', `${path}.${side}`, 'Ponto desconhecido.');
    }
    if (isObject(constraint.a) && isObject(constraint.b) && constraint.a.partId === constraint.b.partId) add('INVALID_CONSTRAINT', path, 'Os dois pontos são da mesma parte.');
  });

  // Actuadores.
  const actuatorIds = new Set<string>();
  const stroke = (path: string, q: unknown) => quantityOk(path, q, ['m']);
  list('$.actuators', value.actuators).forEach((actuator, i) => {
    const path = `$.actuators[${i}]`;
    if (!isObject(actuator)) { add('INVALID_ACTUATOR', path, 'Actuador inválido.'); return; }
    idOk(`${path}.id`, actuator.id, actuatorIds);
    provenanceOk(`${path}.provenance`, actuator.provenance);
    if (typeof actuator.label !== 'string' || !actuator.label.trim()) add('MISSING_FIELD', `${path}.label`, 'Falta o nome.');
    const revolute = (key: string, v: unknown) => { const joint = typeof v === 'string' ? jointsById.get(v) : undefined; if (!joint) add('UNKNOWN_REFERENCE', `${path}.${key}`, 'Junta desconhecida.'); return joint; };
    if (actuator.kind === 'rotary_drive') {
      const joint = revolute('jointId', actuator.jointId);
      if (joint && joint.type !== 'revolute') add('INVALID_ACTUATOR', `${path}.jointId`, 'Um accionamento rotativo precisa de uma junta revolute.');
      optionalQuantity(`${path}.maxRate`, actuator.maxRate, ['rad/s']);
      positiveRate(`${path}.maxRate`, actuator.maxRate);
    } else if (actuator.kind === 'hydraulic_cylinder') {
      for (const key of ['barrelPartId', 'rodPartId'] as const) if (typeof actuator[key] !== 'string' || !partIds.has(actuator[key] as string)) add('UNKNOWN_REFERENCE', `${path}.${key}`, 'Parte desconhecida.');
      const slide = revolute('slideJointId', actuator.slideJointId);
      if (slide && (slide.type !== 'prismatic' || slide.parentPartId !== actuator.barrelPartId || slide.childPartId !== actuator.rodPartId)) add('INVALID_ACTUATOR', `${path}.slideJointId`, 'A junta tem de ser prismática, do barril para a haste.');
      if (!isObject(actuator.stroke)) add('INVALID_ACTUATOR', `${path}.stroke`, 'Falta o curso.');
      else { const lo = stroke(`${path}.stroke.min`, actuator.stroke.min); const hi = stroke(`${path}.stroke.max`, actuator.stroke.max); if (lo && hi && (actuator.stroke.min as Quantity).value >= (actuator.stroke.max as Quantity).value) add('INVALID_LIMITS', `${path}.stroke`, 'min tem de ser menor que max.'); }
      stroke(`${path}.referenceStroke`, actuator.referenceStroke);
      optionalQuantity(`${path}.maxRate`, actuator.maxRate, ['m/s']);
      positiveRate(`${path}.maxRate`, actuator.maxRate);
      if (!isObject(actuator.hydraulics)) add('MISSING_FIELD', `${path}.hydraulics`, 'hydraulics tem campos null quando desconhecidos.');
      else {
        optionalQuantity(`${path}.hydraulics.boreDiameter`, actuator.hydraulics.boreDiameter, ['m']);
        optionalQuantity(`${path}.hydraulics.rodDiameter`, actuator.hydraulics.rodDiameter, ['m']);
        optionalQuantity(`${path}.hydraulics.supplyPressure`, actuator.hydraulics.supplyPressure, ['Pa']);
      }
      const drives = actuator.drives;
      if (!isObject(drives)) add('INVALID_ACTUATOR', `${path}.drives`, 'Falta a relação accionada.');
      else {
        const driven = revolute('drives.jointId', drives.jointId);
        if (driven && driven.type !== 'revolute') add('INVALID_ACTUATOR', `${path}.drives.jointId`, 'O cilindro determina uma junta revolute.');
        enumOk(`${path}.drives.transmission`, drives.transmission, ['direct_triangle', 'two_link_chain']);
        const ids = Array.isArray(drives.constraintIds) ? drives.constraintIds : [];
        if (!Array.isArray(drives.constraintIds) || ids.some((id) => typeof id !== 'string' || !constraintIds.has(id))) add('UNKNOWN_REFERENCE', `${path}.drives.constraintIds`, 'Restrição desconhecida.');
        const links = Array.isArray(drives.linkPartIds) ? drives.linkPartIds : [];
        if (!Array.isArray(drives.linkPartIds) || links.some((id) => typeof id !== 'string' || !partIds.has(id))) add('UNKNOWN_REFERENCE', `${path}.drives.linkPartIds`, 'Parte desconhecida.');
        if (drives.transmission === 'direct_triangle' && (ids.length !== 1 || links.length !== 0)) add('INVALID_ACTUATOR', `${path}.drives`, 'direct_triangle: uma restrição e nenhuma barra.');
        if (drives.transmission === 'two_link_chain' && (ids.length !== 2 || links.length !== 2)) add('INVALID_ACTUATOR', `${path}.drives`, 'two_link_chain: duas restrições e duas barras.');
      }
    } else add('INVALID_ACTUATOR', `${path}.kind`, 'kind tem de ser hydraulic_cylinder ou rotary_drive.');
  });

  // Colisão.
  const collision = value.collision;
  if (!isObject(collision)) add('MISSING_FIELD', '$.collision', 'Falta a política de colisão.');
  else {
    enumOk('$.collision.onContact', collision.onContact, ['block', 'warn']);
    if (collision.groundPlane !== null) {
      if (!isObject(collision.groundPlane) || !isFiniteNumber(collision.groundPlane.yM) || !Array.isArray(collision.groundPlane.ignorePartIds) || collision.groundPlane.ignorePartIds.some((id: unknown) => typeof id !== 'string' || !partIds.has(id))) add('UNKNOWN_REFERENCE', '$.collision.groundPlane', 'Plano do chão inválido.');
    }
    if (!Array.isArray(collision.ignorePairs) || collision.ignorePairs.some((pair: unknown) => !Array.isArray(pair) || pair.length !== 2 || pair.some((id) => typeof id !== 'string' || !partIds.has(id)))) add('UNKNOWN_REFERENCE', '$.collision.ignorePairs', 'Par inválido.');
  }
  return { ok: issues.length === 0, issues };
}

export function assertAssembly(value: unknown): Assembly {
  const result = validateAssembly(value);
  if (!result.ok) throw new AssemblyContractError(result.issues);
  return value as Assembly;
}
