/**
 * Cinemática directa de uma montagem `unfold.assembly.v1`.
 *
 * Dada uma configuração (valor de cada junta móvel), calcula a pose de cada parte no referencial do mundo. Nada aqui
 * resolve relações de engenharia (cilindros, fecho de laços): isso é a fase 2. Uma configuração que não fecha os laços
 * ou que sai dos limites produz uma pose correcta para os valores dados; quem decide se é válida é o motor (engine.ts).
 *
 * Regra: a pose de uma parte filha é `T_pai · origem_da_junta · movimento(q)`, aplicada exactamente uma vez em cada junta.
 */

import type { Assembly, Joint } from '../contracts/assembly.v1';
import { applyRigid, composeRigid, IDENTITY_RIGID, quatAngle, quatFromAxisAngle, rigidFromPose, type Rigid } from './transform-math';

export type Configuration = Record<string, number>;

export class EngineInputError extends Error {
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'EngineInputError';
  }
}

export type KinematicState = {
  /** Referenciais estáticos e do mundo, resolvidos. */
  frames: Map<string, Rigid>;
  /** Transformação de cada parte no mundo (= referencial de cada parte). */
  parts: Map<string, Rigid>;
  /** Transformação de cada junta no mundo, com o movimento aplicado. */
  joints: Map<string, Rigid>;
};

const WORLD_POSE_TOLERANCE = 1e-12;

/** O motor só lê a montagem; quem a chama tem de ter validado a forma (assertAssembly). */
export function resolveFrames(assembly: Assembly): Map<string, Rigid> {
  const world = assembly.frames.find((frame) => frame.kind === 'world');
  if (!world) throw new EngineInputError('ENGINE_NO_WORLD_FRAME', 'A montagem não tem referencial do mundo.');
  const identity = rigidFromPose(world.pose);
  if (Math.hypot(...identity.t) > WORLD_POSE_TOLERANCE || quatAngle(identity.q, [0, 0, 0, 1]) > WORLD_POSE_TOLERANCE) {
    throw new EngineInputError('ENGINE_WORLD_POSE_NOT_IDENTITY', 'O referencial do mundo tem de ser a identidade; a pose de um referencial estático é relativa ao pai.');
  }
  const byId = new Map(assembly.frames.map((frame) => [frame.id, frame]));
  const resolved = new Map<string, Rigid>([[world.id, IDENTITY_RIGID]]);
  for (const frame of assembly.frames) {
    const chain: string[] = [];
    let cursor: string | null = frame.id;
    while (cursor !== null && !resolved.has(cursor)) {
      if (chain.includes(cursor)) throw new EngineInputError('ENGINE_FRAME_CYCLE', `Ciclo nos referenciais em ${cursor}.`);
      const node = byId.get(cursor);
      if (!node) throw new EngineInputError('ENGINE_UNKNOWN_FRAME', `Referencial ${cursor} desconhecido.`);
      chain.push(cursor);
      cursor = node.parentFrameId;
    }
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      const id = chain[i]!;
      const node = byId.get(id)!;
      resolved.set(id, composeRigid(resolved.get(node.parentFrameId!)!, rigidFromPose(node.pose)));
    }
  }
  return resolved;
}

/** Valores de referência de cada junta móvel (rad ou m). Falha se uma junta móvel não tem referência. */
export function referenceConfiguration(assembly: Assembly): Configuration {
  const config: Configuration = {};
  for (const joint of assembly.joints) {
    if (joint.type === 'fixed') continue;
    if (!joint.referenceValue) throw new EngineInputError('ENGINE_MISSING_REFERENCE', `A junta ${joint.id} não tem valor de referência.`);
    config[joint.id] = joint.referenceValue.value;
  }
  return config;
}

/** Movimento de uma junta para um valor: rotação em torno do eixo (revolute) ou translação ao longo do eixo (prismatic). */
export function jointMotion(joint: Joint, value: number): Rigid {
  if (joint.type === 'fixed') return IDENTITY_RIGID;
  if (joint.type === 'revolute') return { t: [0, 0, 0], q: quatFromAxisAngle(joint.axis, value) };
  return { t: [joint.axis[0] * value, joint.axis[1] * value, joint.axis[2] * value], q: [0, 0, 0, 1] };
}

/** Recusa entradas antes de qualquer cálculo: juntas desconhecidas, fixas, em falta ou não finitas. */
export function validateConfiguration(assembly: Assembly, config: Configuration): void {
  const joints = new Map(assembly.joints.map((joint) => [joint.id, joint]));
  for (const [id, value] of Object.entries(config)) {
    const joint = joints.get(id);
    if (!joint) throw new EngineInputError('ENGINE_UNKNOWN_JOINT', `A junta ${id} não existe na montagem.`);
    if (joint.type === 'fixed') throw new EngineInputError('ENGINE_FIXED_JOINT_VALUE', `A junta ${id} é fixa e não aceita valor.`);
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new EngineInputError('ENGINE_NON_FINITE_VALUE', `Valor não finito para ${id}.`);
  }
  for (const joint of assembly.joints) {
    if (joint.type !== 'fixed' && !Object.hasOwn(config, joint.id)) throw new EngineInputError('ENGINE_MISSING_JOINT_VALUE', `Falta o valor da junta ${joint.id}.`);
  }
}

export type LimitViolation = { jointId: string; value: number; min: number; max: number };

/** Juntas fora dos limites, com o valor pedido. Os limites são inclusivos. */
export function jointLimitViolations(assembly: Assembly, config: Configuration): LimitViolation[] {
  const violations: LimitViolation[] = [];
  for (const joint of assembly.joints) {
    if (joint.type === 'fixed' || !joint.limits) continue;
    const value = config[joint.id]!;
    const min = joint.limits.min.value; const max = joint.limits.max.value;
    if (value < min || value > max) violations.push({ jointId: joint.id, value, min, max });
  }
  return violations;
}

/** Calcula a transformação de cada parte. Assume a configuração já validada e a montagem já validada. */
export function solveForwardKinematics(assembly: Assembly, config: Configuration): KinematicState {
  validateConfiguration(assembly, config);
  const frames = resolveFrames(assembly);
  const rootFrame = frames.get(assembly.root.frameId);
  if (!rootFrame) throw new EngineInputError('ENGINE_UNKNOWN_FRAME', 'A raiz aponta para um referencial desconhecido.');
  const parts = new Map<string, Rigid>([[assembly.root.partId, composeRigid(rootFrame, rigidFromPose(assembly.root.pose))]]);
  const joints = new Map<string, Rigid>();

  // Travessia determinística: as juntas de cada pai por ordem de id, e a fila por ordem de chegada.
  const childrenOf = new Map<string, Joint[]>();
  for (const joint of [...assembly.joints].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    childrenOf.set(joint.parentPartId, [...(childrenOf.get(joint.parentPartId) ?? []), joint]);
  }
  const queue = [assembly.root.partId];
  for (let head = 0; head < queue.length; head += 1) {
    const parent = parts.get(queue[head]!)!;
    for (const joint of childrenOf.get(queue[head]!) ?? []) {
      if (parts.has(joint.childPartId)) throw new EngineInputError('ENGINE_INVALID_TREE', `A parte ${joint.childPartId} seria calculada duas vezes.`);
      const jointWorld = composeRigid(composeRigid(parent, rigidFromPose(joint.origin)), jointMotion(joint, config[joint.id] ?? 0));
      joints.set(joint.id, jointWorld);
      parts.set(joint.childPartId, jointWorld);
      queue.push(joint.childPartId);
    }
  }
  if (parts.size !== assembly.parts.length) {
    const missing = assembly.parts.map((part) => part.id).filter((id) => !parts.has(id));
    throw new EngineInputError('ENGINE_UNREACHABLE_PART', `Partes sem caminho até à raiz: ${missing.join(', ')}.`);
  }
  return { frames, parts, joints };
}

/** Ponto de uma parte no mundo, a partir do seu identificador. */
export function worldPoint(assembly: Assembly, state: KinematicState, partId: string, pointId: string): [number, number, number] {
  const part = assembly.parts.find((item) => item.id === partId);
  const point = part?.points.find((item) => item.id === pointId);
  const transform = state.parts.get(partId);
  if (!point || !transform) throw new EngineInputError('ENGINE_UNKNOWN_POINT', `Ponto ${partId}.${pointId} desconhecido.`);
  return applyRigid(transform, point.positionM);
}

/** Distância entre os dois pontos de cada restrição de fecho (zero quando o laço fecha). */
export function loopResiduals(assembly: Assembly, state: KinematicState): Array<{ constraintId: string; residualM: number }> {
  return assembly.constraints.map((constraint) => {
    const a = worldPoint(assembly, state, constraint.a.partId, constraint.a.pointId);
    const b = worldPoint(assembly, state, constraint.b.partId, constraint.b.pointId);
    return { constraintId: constraint.id, residualM: Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) };
  });
}

