/**
 * Colisões: interface neutra de motor e um verificador primitivo determinístico (caixas e planos do chão).
 *
 * O que se verifica, e o que não:
 *  - Caixas contra o plano do chão (política `collision.groundPlane`), e caixas contra caixas de partes não ligadas por
 *    juntas e não listadas em `ignorePairs`. Caixas com `purpose: "visual"` não entram.
 *  - Cilindros: só o contacto com o chão é calculado (exacto). Entre peças são saltados, com a razão. Um cilindro nunca
 *    aparece como verificado por inteiro.
 *  - Nada é dito sobre formas que não estão no relatório: `shapesChecked` e `shapesSkipped` cobrem todas as formas.
 *
 * Uma implementação futura (um adaptador Rapier, por exemplo) implementa `CollisionBackend` e produz o mesmo relatório.
 */
import type { Assembly, Joint, Shape, Vec3 } from '../contracts/assembly.v1';
import type { MotionFrame } from '../contracts/motion-frame.v1';
import type { KinematicState } from './forward-kinematics';
import { applyRigid, composeRigid, rigidFromPose, rotateVector, type Rigid } from './transform-math';

export type CollisionReport = MotionFrame['collisions'];
export type CollisionInput = { assembly: Assembly; state: KinematicState };
export interface CollisionBackend {
  readonly name: string;
  readonly version: string;
  check(input: CollisionInput): CollisionReport;
}

/** Tolerância de contacto: uma penetração abaixo de 1e-9 m é encosto, não colisão. */
export const CONTACT_TOLERANCE_M = 1e-9;

export type BoxShape = { world: Rigid; half: Vec3 };

const AXES: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

/**
 * Sobreposição de duas caixas orientadas, pelo teste de eixos de separação (SAT). Devolve a menor sobreposição nos
 * eixos testados como profundidade, que é uma estimativa conservadora da penetração.
 */
export function boxesOverlap(a: BoxShape, b: BoxShape): { overlap: boolean; depthM: number } {
  const axesA = AXES.map((axis) => rotateVector(a.world.q, axis));
  const axesB = AXES.map((axis) => rotateVector(b.world.q, axis));
  const candidates: Vec3[] = [...axesA, ...axesB];
  for (const u of axesA) for (const v of axesB) { const c = cross(u, v); if (len(c) > 1e-9) candidates.push([c[0] / len(c), c[1] / len(c), c[2] / len(c)]); }
  const delta: Vec3 = [b.world.t[0] - a.world.t[0], b.world.t[1] - a.world.t[1], b.world.t[2] - a.world.t[2]];
  let depth = Infinity;
  for (const L of candidates) {
    const rA = a.half.reduce((sum, h, i) => sum + h * Math.abs(dot(axesA[i]!, L)), 0);
    const rB = b.half.reduce((sum, h, i) => sum + h * Math.abs(dot(axesB[i]!, L)), 0);
    const overlap = rA + rB - Math.abs(dot(delta, L));
    if (overlap <= CONTACT_TOLERANCE_M) return { overlap: false, depthM: 0 };
    depth = Math.min(depth, overlap);
  }
  return { overlap: true, depthM: depth };
}

/** Ponto mais baixo de uma caixa (y mínimo dos oito cantos). */
function lowestBoxY(shape: BoxShape): number {
  let min = Infinity;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const local: Vec3 = [sx * shape.half[0], sy * shape.half[1], sz * shape.half[2]];
    min = Math.min(min, applyRigid(shape.world, local)[1]);
  }
  return min;
}

/** Ponto mais baixo de um cilindro com o eixo local X: centro − h|u_y| − r·sqrt(1 − u_y²). */
function lowestCylinderY(world: Rigid, radiusM: number, halfLengthM: number): number {
  const u = rotateVector(world.q, [1, 0, 0]);
  return world.t[1] - halfLengthM * Math.abs(u[1]) - radiusM * Math.sqrt(Math.max(0, 1 - u[1] * u[1]));
}

function jointedPairs(assembly: Assembly): Set<string> {
  return new Set(assembly.joints.map((joint: Joint) => [joint.parentPartId, joint.childPartId].sort().join('|')));
}

function ignoredPairs(assembly: Assembly): Set<string> {
  return new Set(assembly.collision.ignorePairs.map((pair) => [...pair].sort().join('|')));
}

export const primitiveCollisionBackend: CollisionBackend = {
  name: 'unfold.primitive-collisions',
  version: '0.1.0',
  check({ assembly, state }: CollisionInput): CollisionReport {
    const shapesChecked: string[] = [];
    const shapesSkipped: Array<{ shapeId: string; reason: string }> = [];
    const contacts: CollisionReport['contacts'] = [];
    const jointed = jointedPairs(assembly);
    const ignored = ignoredPairs(assembly);
    const groundIgnored = new Set(assembly.collision.groundPlane?.ignorePartIds ?? []);

    type Placed = { partId: string; shape: Shape; world: Rigid };
    const placed: Placed[] = [];
    for (const part of [...assembly.parts].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
      const partWorld = state.parts.get(part.id)!;
      for (const shape of [...part.shapes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
        if (shape.purpose === 'visual') { shapesSkipped.push({ shapeId: shape.id, reason: 'Forma visual: não participa na verificação de colisões.' }); continue; }
        placed.push({ partId: part.id, shape, world: composeRigid(partWorld, rigidFromPose(shape.pose)) });
      }
    }

    // Chão.
    const ground = assembly.collision.groundPlane;
    for (const item of placed) {
      if (ground && !groundIgnored.has(item.partId)) {
        const lowest = item.shape.kind === 'box'
          ? lowestBoxY({ world: item.world, half: item.shape.halfExtentsM })
          : lowestCylinderY(item.world, item.shape.radiusM, item.shape.halfLengthM);
        const depth = ground.yM - lowest;
        if (depth > CONTACT_TOLERANCE_M) contacts.push({ kind: 'part_ground', partIds: [item.partId], shapeIds: [item.shape.id], depthM: depth });
      }
    }

    // Pares de caixas.
    const boxes = placed.filter((item) => item.shape.kind === 'box');
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]!; const b = boxes[j]!;
        if (a.partId === b.partId) continue;
        const key = [a.partId, b.partId].sort().join('|');
        if (jointed.has(key) || ignored.has(key)) continue;
        const result = boxesOverlap({ world: a.world, half: (a.shape as Extract<Shape, { kind: 'box' }>).halfExtentsM }, { world: b.world, half: (b.shape as Extract<Shape, { kind: 'box' }>).halfExtentsM });
        if (result.overlap) contacts.push({ kind: 'part_part', partIds: [a.partId, b.partId], shapeIds: [a.shape.id, b.shape.id], depthM: result.depthM });
      }
    }

    for (const item of placed) {
      if (item.shape.kind === 'box') shapesChecked.push(item.shape.id);
      else shapesSkipped.push({ shapeId: item.shape.id, reason: 'Cilindro: só o contacto com o chão é calculado; a colisão entre peças não está implementada para cilindros.' });
    }

    contacts.sort((a, b) => (a.kind + a.partIds.join('|') + a.shapeIds.join('|') < b.kind + b.partIds.join('|') + b.shapeIds.join('|') ? -1 : 1));
    return {
      checked: true,
      shapesChecked: shapesChecked.sort(),
      shapesSkipped: shapesSkipped.sort((a, b) => (a.shapeId < b.shapeId ? -1 : a.shapeId > b.shapeId ? 1 : 0)),
      groundPlaneChecked: ground !== null,
      contacts,
    };
  },
};

/** Relatório para quando não há configuração resolvida para verificar (o solver de actuadores recusou). */
export function notEvaluatedCollisions(assembly: Assembly): CollisionReport {
  return {
    checked: false, shapesChecked: [],
    shapesSkipped: assembly.parts.flatMap((part) => part.shapes.map((shape) => ({ shapeId: shape.id, reason: 'Sem configuração resolvida: não há posição para verificar colisões.' }))),
    groundPlaneChecked: false, contacts: [],
  };
}
