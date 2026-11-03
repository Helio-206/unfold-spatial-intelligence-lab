/**
 * Transformações rígidas (translação + quaterniões [x, y, z, w]) para o motor de engenharia.
 * Só álgebra: sem estado, sem dependência do contrato. Convenção: rotação positiva segue a regra da mão direita.
 * `composeRigid(A, B)` é A·B: aplica primeiro B (expresso no referencial de A) e depois A.
 */
import type { Quat, Vec3 } from '../contracts/assembly.v1';

export type Rigid = { t: Vec3; q: Quat };

export class EngineDomainError extends Error {
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'EngineDomainError';
  }
}

export const IDENTITY_QUAT: Quat = [0, 0, 0, 1];
export const IDENTITY_RIGID: Rigid = { t: [0, 0, 0], q: IDENTITY_QUAT };

export function normalizeQuat(q: readonly number[]): Quat {
  const n = Math.hypot(q[0]!, q[1]!, q[2]!, q[3]!);
  if (!(n > 0) || !Number.isFinite(n)) throw new EngineDomainError('ENGINE_DEGENERATE_QUATERNION', 'Quaternião nulo ou não finito.');
  return [q[0]! / n, q[1]! / n, q[2]! / n, q[3]! / n];
}

/** Forma canónica: w ≥ 0 (q e −q são a mesma rotação). Assim a serialização é estável. */
export function canonicalQuat(q: readonly number[]): Quat {
  const u = normalizeQuat(q);
  const flip = u[3] < 0 || (u[3] === 0 && (u[2] < 0 || (u[2] === 0 && (u[1] < 0 || (u[1] === 0 && u[0] < 0)))));
  return (flip ? [-u[0], -u[1], -u[2], -u[3]] : u).map((v) => (Object.is(v, -0) ? 0 : v)) as Quat;
}

export function quatFromAxisAngle(axis: Vec3, angle: number): Quat {
  const n = Math.hypot(axis[0], axis[1], axis[2]);
  if (!(n > 0)) throw new EngineDomainError('ENGINE_DEGENERATE_AXIS', 'Eixo nulo.');
  const s = Math.sin(angle / 2) / n;
  return normalizeQuat([axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)]);
}

export function quatMultiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a; const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function quatConjugate([x, y, z, w]: Quat): Quat { return [-x, -y, -z, w]; }

export function rotateVector(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  // v' = v + 2w(u×v) + 2u×(u×v), com u = (x,y,z).
  const cx = y * v[2] - z * v[1]; const cy = z * v[0] - x * v[2]; const cz = x * v[1] - y * v[0];
  const dx = y * cz - z * cy; const dy = z * cx - x * cz; const dz = x * cy - y * cx;
  return [v[0] + 2 * (w * cx + dx), v[1] + 2 * (w * cy + dy), v[2] + 2 * (w * cz + dz)];
}

/** A·B: primeiro B, depois A. */
export function composeRigid(a: Rigid, b: Rigid): Rigid {
  const moved = rotateVector(a.q, b.t);
  return { t: [a.t[0] + moved[0], a.t[1] + moved[1], a.t[2] + moved[2]], q: canonicalQuat(quatMultiply(a.q, b.q)) };
}

export function rigidInverse(r: Rigid): Rigid {
  const qi = quatConjugate(r.q);
  const rt = rotateVector(qi, r.t);
  return { t: [-rt[0], -rt[1], -rt[2]], q: canonicalQuat(qi) };
}

/**
 * Ângulo (rad) da rotação relativa entre duas orientações; invariante ao sinal de q.
 * Usa atan2 sobre a parte vetorial do quaterniável relativo, não acos(produto interno): perto de zero, acos perde
 * precisão (um erro de 1e-10 rad aparecia como 0, e um de 1e-16 como ~1e-8).
 */
export function quatAngle(a: readonly number[], b: readonly number[]): number {
  const rel = quatMultiply(quatConjugate(normalizeQuat(a)), normalizeQuat(b));
  return 2 * Math.atan2(Math.hypot(rel[0], rel[1], rel[2]), Math.abs(rel[3]));
}

export function rigidFromPose(pose: { translationM: Vec3; rotation: Quat }): Rigid {
  return { t: [pose.translationM[0], pose.translationM[1], pose.translationM[2]], q: canonicalQuat(pose.rotation) };
}

export function applyRigid(r: Rigid, p: Vec3): Vec3 {
  const v = rotateVector(r.q, p);
  return [v[0] + r.t[0], v[1] + r.t[1], v[2] + r.t[2]];
}

export function distance(a: Vec3, b: Vec3): number { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
