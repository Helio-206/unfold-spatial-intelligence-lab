/**
 * Motor de engenharia (fase 1): avalia uma configuração de uma montagem e devolve um `unfold.motion-frame.v1`.
 *
 * Fronteiras:
 *  - Entrada inválida (montagem, valores de junta) é recusada antes do cálculo, com erro tipado.
 *  - Configuração fisicamente inválida (fora dos limites, laço que não fecha) devolve um quadro `blocked` explícito.
 *    As poses mostradas são as de referência (`poseBasis: "reference"`), nunca as da configuração recusada.
 *  - O motor não lê relógio, aleatoriedade nem estado anterior: o mesmo input dá o mesmo quadro, byte a byte.
 */
import { canonicalize, sha256Hex } from '../../core';
import { assertAssembly, type Assembly, type Vec3 } from '../contracts/assembly.v1';
import type { ActuatorState, FrameWarning, JointState, Measurement, MotionFrame, PartTransform } from '../contracts/motion-frame.v1';
import { MOTION_FRAME_SCHEMA } from '../contracts/motion-frame.v1';
import {
  jointLimitViolations, loopResiduals, referenceConfiguration, solveForwardKinematics, validateConfiguration, worldPoint,
  type Configuration, type KinematicState,
} from './forward-kinematics';
import { canonicalQuat, distance } from './transform-math';
import { solveActuatorConfiguration } from './actuator-solver';
import { notEvaluatedCollisions, primitiveCollisionBackend, type CollisionBackend } from './collision';

export const ENGINE_ID = 'unfold.engineering.forward-kinematics';
export const ENGINE_VERSION = '0.1.0';
/**
 * Tolerância de fecho dos laços de pinos, em metros. Com comprimentos da ordem de 1 a 10 m e aritmética de dupla precisão, o
 * erro de arredondamento de uma cadeia de transformações fica entre 1e-15 e 1e-14 m. 1e-9 m deixa cinco ordens de grandeza
 * de margem e continua a apanhar qualquer deslocamento de um pino de um micrómetro ou mais.
 */
export const CLOSURE_TOLERANCE_M = 1e-9;

const ASSUMPTIONS = [
  'Corpos rígidos, juntas ideais: sem folga, elasticidade nem desgaste.',
  'Ângulos em rad, comprimentos em m, aritmética de dupla precisão (IEEE 754).',
  'Cada quadro avalia-se a partir da configuração; nunca se integra a partir do quadro anterior.',
  `Fecho de laços aceite até ${CLOSURE_TOLERANCE_M} m (ver CLOSURE_TOLERANCE_M).`,
  'Força, pressão e capacidade de carga não são calculadas: a montagem não tem parâmetros hidráulicos (diâmetros e pressão são null).',
  'Colisões: caixas contra caixas (SAT) e contra o plano do chão; cilindros só contra o chão. Cada forma indica se foi verificada, com a razão.',
];

export type EvaluationOptions = {
  timestampS?: number;
  index?: number | null;
  /** Avisos do solver de cilindros (ambiguidade, singularidade) que acompanham um quadro ok. */
  warnings?: MotionFrame['warnings'];
  /** Descrição do método quando o quadro vem do solver de actuadores. */
  method?: string;
  /** Verificador de colisões. Por omissão, o primitivo. */
  collisionBackend?: CollisionBackend;
};

export function assemblyDigest(assembly: Assembly): string {
  return sha256Hex(canonicalize(assembly));
}

function inputDigestOf(digest: string, config: Configuration, timestampS: number, index: number | null): string {
  const configuration = Object.keys(config).sort().map((id) => [id, config[id]!]);
  return sha256Hex(canonicalize({ assembly: digest, configuration, timestampS, index }));
}

const jointKinds = (assembly: Assembly): Map<string, JointState['kind']> => {
  const kinds = new Map<string, JointState['kind']>();
  for (const actuator of assembly.actuators) {
    if (actuator.kind === 'rotary_drive') kinds.set(actuator.jointId, 'commanded');
    else { kinds.set(actuator.slideJointId, 'commanded'); kinds.set(actuator.drives.jointId, 'dependent'); }
  }
  return kinds;
};

function partsOf(assembly: Assembly, state: KinematicState): PartTransform[] {
  return assembly.parts.map((part) => {
    const t = state.parts.get(part.id)!;
    const translationM: Vec3 = [t.t[0], t.t[1], t.t[2]];
    return { partId: part.id, translationM, rotation: canonicalQuat(t.q) };
  }).sort((a, b) => (a.partId < b.partId ? -1 : a.partId > b.partId ? 1 : 0));
}

function jointStates(assembly: Assembly, config: Configuration): JointState[] {
  const kinds = jointKinds(assembly);
  return assembly.joints
    .filter((joint) => joint.type !== 'fixed')
    .map((joint) => ({ jointId: joint.id, value: config[joint.id]!, unit: joint.type === 'prismatic' ? 'm' : 'rad', kind: kinds.get(joint.id) ?? 'passive' }) as JointState)
    .sort((a, b) => (a.jointId < b.jointId ? -1 : a.jointId > b.jointId ? 1 : 0));
}

function actuatorStates(assembly: Assembly, config: Configuration, state: KinematicState | null): ActuatorState[] {
  return assembly.actuators.map((actuator) => {
    if (actuator.kind === 'rotary_drive') {
      const joint = assembly.joints.find((item) => item.id === actuator.jointId)!;
      const value = config[actuator.jointId]!;
      const withinLimits = !joint.limits || (value >= joint.limits.min.value && value <= joint.limits.max.value);
      return {
        actuatorId: actuator.id, kind: 'rotary_drive', value, unit: 'rad', lengthM: null, withinLimits,
        forceN: null, forceStatus: 'unknown', forceReason: 'Sem modelo de binário: o accionamento não tem parâmetros de potência nem de inércia na montagem.',
      };
    }
    const value = config[actuator.slideJointId]!;
    const withinLimits = value >= actuator.stroke.min.value && value <= actuator.stroke.max.value;
    const lengthM = state
      ? distance(state.parts.get(actuator.barrelPartId)!.t, state.parts.get(actuator.rodPartId)!.t)
      : null;
    return {
      actuatorId: actuator.id, kind: 'hydraulic_cylinder', value, unit: 'm', lengthM, withinLimits,
      forceN: null, forceStatus: 'unknown',
      forceReason: 'Sem parâmetros hidráulicos: diâmetros e pressão de alimentação são desconhecidos (null) nesta montagem.',
    };
  });
}

function measurementsOf(assembly: Assembly, state: KinematicState, residuals: Array<{ constraintId: string; residualM: number }>, computed: boolean): Measurement[] {
  const unknown = (id: string, label: string, unit: Measurement['unit'], subjectIds: string[]): Measurement => ({
    id, label, status: 'unknown', value: null, unit, method: 'não calculada: a configuração pedida está bloqueada', subjectIds,
  });
  const out: Measurement[] = [];
  const tip = assembly.parts.flatMap((part) => part.points.filter((point) => point.role === 'tool_tip').map((point) => ({ part, point })))[0];
  if (tip) {
    const subject = [tip.part.id];
    const coordinates = computed ? worldPoint(assembly, state, tip.part.id, tip.point.id) : null;
    (['x', 'y', 'z'] as const).forEach((axis, i) => {
      out.push(computed
        ? { id: `tip.${axis}`, label: `Ponta da ferramenta, ${axis}`, status: 'computed', value: coordinates![i]!, unit: 'm', method: 'Ponto tool_tip transformado pela pose da parte (cinemática directa)', subjectIds: subject }
        : unknown(`tip.${axis}`, `Ponta da ferramenta, ${axis}`, 'm', subject));
    });
  }
  for (const actuator of assembly.actuators) {
    if (actuator.kind !== 'hydraulic_cylinder') continue;
    const id = `cylinder.${actuator.id}.length`;
    const subjectIds = [actuator.barrelPartId, actuator.rodPartId];
    out.push(computed
      ? { id, label: `Comprimento de ${actuator.label}`, status: 'computed', value: distance(state.parts.get(actuator.barrelPartId)!.t, state.parts.get(actuator.rodPartId)!.t), unit: 'm', method: 'Distância entre a origem do barril e a origem da haste (pinos de base e de haste)', subjectIds }
      : unknown(id, `Comprimento de ${actuator.label}`, 'm', subjectIds));
  }
  for (const residual of residuals) {
    const constraint = assembly.constraints.find((item) => item.id === residual.constraintId)!;
    out.push({
      id: `closure.${residual.constraintId}`, label: `Fecho do laço ${residual.constraintId}`, status: 'computed', value: residual.residualM, unit: 'm',
      method: 'Distância entre os dois pontos coincidentes da restrição, no mundo', subjectIds: [constraint.a.partId, constraint.b.partId],
    });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Avalia uma configuração. Lança `AssemblyContractError` se a montagem for inválida e `EngineInputError` se os valores
 * forem inválidos; devolve sempre um quadro válido, `ok` ou `blocked`.
 */
export function evaluateConfiguration(assembly: Assembly, config: Configuration, options: EvaluationOptions = {}): MotionFrame {
  assertAssembly(assembly);
  validateConfiguration(assembly, config);
  const timestampS = options.timestampS ?? 0;
  if (!Number.isFinite(timestampS) || timestampS < 0) throw new Error('ENGINE_INVALID_TIMESTAMP: o instante tem de ser finito e ≥ 0.');
  const index = options.index ?? null;
  const digest = assemblyDigest(assembly);

  const requested = solveForwardKinematics(assembly, config);
  const residuals = loopResiduals(assembly, requested);
  const maxResidual = residuals.reduce((max, r) => Math.max(max, r.residualM), 0);
  const limits = jointLimitViolations(assembly, config);
  const reasons: Array<{ code: string; message: string; subjectIds: string[] }> = [];
  if (limits.length > 0) reasons.push({ code: 'JOINT_LIMIT_EXCEEDED', message: `Fora dos limites: ${limits.map((l) => `${l.jointId}=${l.value}`).join(', ')}.`, subjectIds: limits.map((l) => l.jointId) });
  if (maxResidual > CLOSURE_TOLERANCE_M) {
    const open = residuals.filter((r) => r.residualM > CLOSURE_TOLERANCE_M).map((r) => r.constraintId);
    reasons.push({ code: 'LOOP_CLOSURE_VIOLATED', message: `Os pinos não coincidem (resíduo ${maxResidual} m): ${open.join(', ')}.`, subjectIds: open });
  }

  // Colisões na configuração pedida. Com a política `block`, um contacto recusa a configuração; com `warn`, é só um aviso.
  const backend = options.collisionBackend ?? primitiveCollisionBackend;
  const collisions = backend.check({ assembly, state: requested });
  // A profundidade pode ser desconhecida (null, válido no contrato): formata-se sem assumir um número.
  const depthText = (d: number | null) => (d === null ? 'profundidade desconhecida' : `${d.toFixed(4)} m`);
  const contactText = collisions.contacts.map((c) => (c.kind === 'part_ground' ? `${c.partIds[0]} abaixo do chão (${depthText(c.depthM)})` : `${c.partIds[0]} com ${c.partIds[1]} (${depthText(c.depthM)})`));
  const contactSubjects = [...new Set(collisions.contacts.flatMap((c) => c.partIds))].sort();
  const extraWarnings: FrameWarning[] = [];
  if (collisions.contacts.length > 0) {
    if (assembly.collision.onContact === 'block') reasons.push({ code: 'COLLISION', message: `Colisão: ${contactText.join('; ')}.`, subjectIds: contactSubjects });
    else extraWarnings.push({ code: 'COLLISION', severity: 'warning', message: `Contacto (política warn): ${contactText.join('; ')}.`, subjectIds: contactSubjects });
  }

  const blocked = reasons.length > 0;
  const reference = blocked ? solveForwardKinematics(assembly, referenceConfiguration(assembly)) : requested;
  const base = {
    schema: MOTION_FRAME_SCHEMA, assemblyId: assembly.id, assemblyDigest: digest, inputDigest: inputDigestOf(digest, config, timestampS, index),
    index, timestampS, worldFrameId: assembly.frames.find((frame) => frame.kind === 'world')!.id,
    parts: partsOf(assembly, reference), joints: jointStates(assembly, config), actuators: actuatorStates(assembly, config, blocked ? null : requested),
    measurements: measurementsOf(assembly, requested, residuals, !blocked),
    solver: {
      id: ENGINE_ID, version: ENGINE_VERSION, method: options.method ?? 'Cinemática directa sobre a árvore de juntas (rígidos e quaterniões)',
      status: blocked ? 'blocked' : 'solved', closureResidualM: maxResidual, toleranceM: CLOSURE_TOLERANCE_M, assumptions: [...ASSUMPTIONS],
    },
    collisions,
    warnings: [...(options.warnings ?? []), ...extraWarnings],
    evidence: assembly.sources.map((source) => ({ sourceId: source.id, locator: 'assembly' })),
  };
  if (!blocked) return { ...base, status: 'ok', poseBasis: 'solved', blocked: null } as MotionFrame;
  return {
    ...base,
    status: 'blocked', poseBasis: 'reference',
    blocked: { code: reasons[0]!.code, message: reasons.map((r) => r.message).join(' '), subjectIds: [...new Set(reasons.flatMap((r) => r.subjectIds))].sort(), firstInvalidTimeS: null },
  } as MotionFrame;
}

/** Quadro da pose de referência (todas as juntas nos valores de referência da montagem). */
export function evaluateReferencePose(assembly: Assembly, options: EvaluationOptions = {}): MotionFrame {
  assertAssembly(assembly);
  return evaluateConfiguration(assembly, referenceConfiguration(assembly), options);
}

/**
 * Quadro a partir dos valores dos actuadores (curso dos cilindros, ângulo do accionamento rotativo). Resolve as juntas com o
 * solver de cilindros e verifica o resultado pela cinemática directa. Se o solver não tem solução, o quadro é `blocked` com
 * o código do solver e as poses mostradas são as de referência.
 */
export function evaluateActuators(assembly: Assembly, values: Record<string, number>, options: EvaluationOptions = {}): MotionFrame {
  assertAssembly(assembly);
  const outcome = solveActuatorConfiguration(assembly, values);
  if (outcome.ok) {
    const warnings = outcome.warnings.map((w) => ({ code: w.code, severity: 'warning' as const, message: w.message, subjectIds: w.subjectIds }));
    return evaluateConfiguration(assembly, outcome.config, { ...options, warnings: [...(options.warnings ?? []), ...warnings], method: 'Solver de cilindros: forma fechada (triângulo) e bissecção (balancé de duas barras), verificado por cinemática directa' });
  }
  return blockedFromSolver(assembly, values, outcome, options);
}

function blockedFromSolver(assembly: Assembly, values: Record<string, number>, failure: { code: string; message: string; subjectIds: string[] }, options: EvaluationOptions): MotionFrame {
  const reference = solveForwardKinematics(assembly, referenceConfiguration(assembly));
  const timestampS = options.timestampS ?? 0;
  const index = options.index ?? null;
  const digest = assemblyDigest(assembly);
  const actuators: ActuatorState[] = assembly.actuators.map((actuator) => {
    const value = values[actuator.id]!;
    if (actuator.kind === 'rotary_drive') {
      const joint = assembly.joints.find((item) => item.id === actuator.jointId)!;
      const withinLimits = !joint.limits || (value >= joint.limits.min.value && value <= joint.limits.max.value);
      return { actuatorId: actuator.id, kind: 'rotary_drive', value, unit: 'rad', lengthM: null, withinLimits, forceN: null, forceStatus: 'unknown', forceReason: 'Sem modelo de binário: o accionamento não tem parâmetros de potência nem de inércia na montagem.' };
    }
    return {
      actuatorId: actuator.id, kind: 'hydraulic_cylinder', value, unit: 'm', lengthM: null,
      withinLimits: value >= actuator.stroke.min.value && value <= actuator.stroke.max.value,
      forceN: null, forceStatus: 'unknown', forceReason: 'Sem parâmetros hidráulicos: diâmetros e pressão de alimentação são desconhecidos (null) nesta montagem.',
    };
  });
  return {
    schema: MOTION_FRAME_SCHEMA, assemblyId: assembly.id, assemblyDigest: digest,
    inputDigest: inputDigestOf(digest, Object.fromEntries(Object.entries(values)), timestampS, index),
    index, timestampS, worldFrameId: assembly.frames.find((frame) => frame.kind === 'world')!.id,
    status: 'blocked', poseBasis: 'reference',
    parts: partsOf(assembly, reference), joints: [], actuators,
    measurements: measurementsOf(assembly, reference, [], false),
    solver: { id: ENGINE_ID, version: ENGINE_VERSION, method: 'Solver de cilindros (recusou a configuração)', status: 'blocked', closureResidualM: null, toleranceM: CLOSURE_TOLERANCE_M, assumptions: [...ASSUMPTIONS] },
    collisions: notEvaluatedCollisions(assembly),
    warnings: options.warnings ?? [],
    evidence: assembly.sources.map((source) => ({ sourceId: source.id, locator: 'assembly' })),
    blocked: { code: failure.code, message: failure.message, subjectIds: [...new Set(failure.subjectIds)].sort(), firstInvalidTimeS: null },
  } as MotionFrame;
}
