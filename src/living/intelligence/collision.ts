import { Matrix4, Vector3 } from 'three';
import { forwardPoses, type JointValues } from './kinematics';
import type { Mechanism, Vec3 } from './mechanism';

/**
 * Collision detection between parts using ORIENTED BOUNDING BOXES (separating-axis test on the 15 candidate axes). It is an approximation of the parts' shapes and says so:
 * a reported collision means the boxes overlap (the parts MAY touch); "no collision" means the boxes are separated, which does prove the parts are, whatever their shape
 * inside the boxes. Pairs joined by a joint are not tested unless asked (they touch by design).
 */
export type PartBox = { part: string; center: Vec3; half: Vec3 };
export type Collision = { a: string; b: string; penetration: number; axis: Vec3 };
export type CollisionReport = { collisions: Collision[]; pairsTested: number; method: 'oriented-bounding-boxes'; limitation: string };

type Obb = { c: Vector3; ax: Vector3[]; h: number[] };
const obb = (box: PartBox, pose: Matrix4): Obb => { const R = new Matrix4().extractRotation(pose); return { c: new Vector3(...box.center).applyMatrix4(pose), ax: [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)].map((v) => v.applyMatrix4(R)), h: [...box.half] }; };
function sat(A: Obb, B: Obb): { penetration: number; axis: Vector3 } | null {
  const t = B.c.clone().sub(A.c), axes: Vector3[] = [...A.ax, ...B.ax]; for (const a of A.ax) for (const b of B.ax) { const x = a.clone().cross(b); if (x.lengthSq() > 1e-12) axes.push(x.normalize()); }
  let min = Infinity, best = new Vector3(1, 0, 0);
  for (const L of axes) { const ra = A.h.reduce((s, h, i) => s + h * Math.abs(A.ax[i]!.dot(L)), 0), rb = B.h.reduce((s, h, i) => s + h * Math.abs(B.ax[i]!.dot(L)), 0), overlap = ra + rb - Math.abs(t.dot(L)); if (overlap <= 1e-12) return null; if (overlap < min) { min = overlap; best = L.clone(); } }
  return { penetration: min, axis: best };
}
export function checkCollisions(m: Mechanism, q: JointValues, boxes: PartBox[], options: { includeJoined?: boolean } = {}): CollisionReport {
  const poses = forwardPoses(m, q), joined = new Set(m.joints.flatMap((j) => [`${j.parent}|${j.child}`, `${j.child}|${j.parent}`])), items = [...boxes].sort((a, b) => (a.part < b.part ? -1 : 1)).map((b) => ({ b, o: obb(b, new Matrix4().fromArray(poses[b.part] ?? new Matrix4().elements)) })), out: Collision[] = []; let tested = 0;
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) { const a = items[i]!, b = items[j]!; if (!options.includeJoined && joined.has(`${a.b.part}|${b.b.part}`)) continue; tested++; const r = sat(a.o, b.o); if (r) out.push({ a: a.b.part, b: b.b.part, penetration: r.penetration, axis: [r.axis.x, r.axis.y, r.axis.z] }); }
  return { collisions: out, pairsTested: tested, method: 'oriented-bounding-boxes', limitation: 'Caixas orientadas, não as malhas: uma colisão indicada pode ser só as caixas a sobrepor-se; a ausência de colisão entre caixas separadas é prova de separação.' };
}
