import { Matrix4, Quaternion, Vector3 } from 'three';
import { basisOf, type Joint, type Mechanism, type Vec3 } from './mechanism';

/**
 * General rigid-body kinematics for mechanisms made of revolute, prismatic and fixed joints, tree-shaped or with closed loops.
 * Part poses are DISPLACEMENTS from the rest pose: world = D_part(q) * rest. A joint with axis (o, a) in rest coordinates contributes the screw motion
 * T(o) R(a, q - home) T(-o) (revolute) or T(a (q - home)) (prismatic); D_child = D_parent * J(q). Closed loops are solved as constraint residuals (damped
 * Gauss-Newton), mobility is the numerical rank deficiency of the constraints (with the Gruebler-Kutzbach count next to it, never instead of it).
 * Deterministic: fixed start list, fixed step sizes, no randomness, double precision; same inputs -> same bits.
 */
export type JointValues = Record<string, number>;
export type Pose = number[]; // Matrix4 elements, column-major
export type Violation = { kind: 'limit'; jointId: string; value: number; min: number; max: number } | { kind: 'inputs'; detail: string };
export type SolveStatus = 'solved' | 'limit_violated' | 'no_solution_found' | 'invalid_input';
export type MobilityReport = { numerical: number; gruebler: { value: number; formula: string; planar: boolean }; variables: number; constraintRank: number; note: string };
export type SolveResult = {
  status: SolveStatus; q: JointValues; poses: Record<string, Pose>; residual: number; iterations: number; trace: Array<{ iteration: number; residual: number }>;
  mobility: MobilityReport; violations: Violation[];
  /** instantaneous freedom left once the inputs are fixed: > 0 means the configuration is singular (or the inputs under-determine it) */ freeDofAtSolution: number;
  singular: boolean; unreachableParts: string[]; notes: string[]; basis: 'confirmed' | 'hypothesis' | 'mixed';
};
export type SolveOptions = { inputs?: JointValues; guess?: JointValues; tolerance?: number; maxIterations?: number; /** extra residuals: a point on a part must reach a world position */ targets?: Array<{ part: string; local: Vec3; world: Vec3 }>; /** weight pulling free variables to the guess (min-norm solution) */ regularisation?: number };

const IDENT = new Matrix4();
const jointMatrix = (j: Joint, q: number): Matrix4 => {
  if (j.kind === 'fixed') return IDENT.clone();
  const a = new Vector3(...j.axis).normalize(), d = q - j.home;
  if (j.kind === 'prismatic') return new Matrix4().makeTranslation(a.x * d, a.y * d, a.z * d);
  const o = new Vector3(...j.origin);
  return new Matrix4().makeTranslation(o.x, o.y, o.z).multiply(new Matrix4().makeRotationAxis(a, d)).multiply(new Matrix4().makeTranslation(-o.x, -o.y, -o.z));
};

type Graph = { order: Array<{ joint: Joint; from: string; to: string; inverse: boolean }>; tree: Set<string>; loops: Joint[]; reached: Set<string> };
function buildGraph(m: Mechanism): Graph {
  const joints = [...m.joints].sort((a, b) => (a.id < b.id ? -1 : 1)), reached = new Set<string>([m.ground]), order: Graph['order'] = [], tree = new Set<string>(), queue = [m.ground];
  while (queue.length) { const p = queue.shift()!; for (const j of joints) { if (tree.has(j.id)) continue; if (j.parent === p && !reached.has(j.child)) { reached.add(j.child); tree.add(j.id); order.push({ joint: j, from: j.parent, to: j.child, inverse: false }); queue.push(j.child); } else if (j.child === p && !reached.has(j.parent)) { reached.add(j.parent); tree.add(j.id); order.push({ joint: j, from: j.child, to: j.parent, inverse: true }); queue.push(j.parent); } } }
  // a joint can be walked against its direction (child -> parent) with the inverse screw motion, so connectivity does not depend on how the author oriented a joint
  const loops = joints.filter((j) => !tree.has(j.id) && reached.has(j.parent) && reached.has(j.child));
  return { order, tree, loops, reached };
}
const step = (e: Graph['order'][number], q: number): Matrix4 => { const J = jointMatrix(e.joint, q); return e.inverse ? J.invert() : J; };
export function forwardPoses(m: Mechanism, q: JointValues, g = buildGraph(m)): Record<string, Pose> {
  const D = new Map<string, Matrix4>([[m.ground, IDENT.clone()]]);
  for (const e of g.order) D.set(e.to, D.get(e.from)!.clone().multiply(step(e, q[e.joint.id] ?? e.joint.home)));
  const out: Record<string, Pose> = {}; for (const p of m.parts) out[p] = [...(D.get(p) ?? IDENT).elements]; return out;
}
export const applyPose = (pose: Pose, p: Vec3): Vec3 => { const v = new Vector3(...p).applyMatrix4(new Matrix4().fromArray(pose)); return [v.x, v.y, v.z]; };

/** rotation vector (axis * angle) of the residual rotation. The antisymmetric part of R alone is NOT enough: it vanishes at 180 degrees, which would let a loop that is closed except for a half turn pass as closed. */
const rotResidual = (E: Matrix4): Vec3 => { const q = new Quaternion().setFromRotationMatrix(E); if (q.w < 0) { q.x = -q.x; q.y = -q.y; q.z = -q.z; q.w = -q.w; } const s = Math.hypot(q.x, q.y, q.z); if (s < 1e-12) return [2 * q.x, 2 * q.y, 2 * q.z]; const ang = 2 * Math.atan2(s, q.w); return [(q.x / s) * ang, (q.y / s) * ang, (q.z / s) * ang]; };
function gruebler(m: Mechanism): MobilityReport['gruebler'] {
  const n = m.parts.length, js = m.joints, planar = js.length > 0 && js.every((j) => j.kind === 'fixed' || true) && (() => { const ref = js.find((j) => j.kind !== 'fixed'); if (!ref) return false; const a0 = new Vector3(...ref.axis).normalize(); return js.every((j) => j.kind === 'fixed' || (j.kind === 'revolute' ? Math.abs(new Vector3(...j.axis).normalize().dot(a0)) > 1 - 1e-9 : Math.abs(new Vector3(...j.axis).normalize().dot(a0)) < 1e-9)); })();
  const dof = planar ? 3 : 6, f = js.reduce((s, j) => s + (j.kind === 'fixed' ? 0 : 1), 0), fixed = js.filter((j) => j.kind === 'fixed').length, couplings = m.couplings.length;
  const value = dof * (n - 1) - (dof * js.length - f) - couplings;
  return { value, planar, formula: `${dof}·(${n}−1) − (${dof}·${js.length} − ${f}) − ${couplings} acoplamento(s) = ${value}${fixed ? ` (${fixed} junta(s) fixa(s) contadas como ${dof} restrições)` : ''}` };
}

function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length, M = A.map((r, i) => [...r, b[i]!]);
  for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r; if (Math.abs(M[p]![c]!) < 1e-14) return null; [M[c], M[p]] = [M[p]!, M[c]!]; for (let r = c + 1; r < n; r++) { const f = M[r]![c]! / M[c]![c]!; for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!; } }
  const x = new Array<number>(n).fill(0); for (let r = n - 1; r >= 0; r--) { let s = M[r]![n]!; for (let k = r + 1; k < n; k++) s -= M[r]![k]! * x[k]!; x[r] = s / M[r]![r]!; } return x;
}
/** rank of a matrix by Gaussian elimination with complete scaling; tolerance relative to the largest entry */
export function rankOf(rows: number[][], relTol = 1e-7): number {
  const A = rows.map((r) => [...r]), nr = A.length, nc = nr ? A[0]!.length : 0; let max = 0; for (const r of A) for (const v of r) max = Math.max(max, Math.abs(v)); if (max === 0) return 0; const tol = relTol * max; let rank = 0;
  for (let c = 0; c < nc && rank < nr; c++) { let p = rank; for (let r = rank + 1; r < nr; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[p]![c]!)) p = r; if (Math.abs(A[p]![c]!) <= tol) continue; [A[rank], A[p]] = [A[p]!, A[rank]!]; for (let r = rank + 1; r < nr; r++) { const f = A[r]![c]! / A[rank]![c]!; for (let k = c; k < nc; k++) A[r]![k]! -= f * A[rank]![k]!; } rank++; }
  return rank;
}

export function solveMechanism(m: Mechanism, options: SolveOptions = {}): SolveResult {
  const g = buildGraph(m), movable = [...m.joints].filter((j) => j.kind !== 'fixed').sort((a, b) => (a.id < b.id ? -1 : 1)), ids = movable.map((j) => j.id), inputs = options.inputs ?? {}, notes: string[] = [];
  const unreachable = m.parts.filter((p) => !g.reached.has(p)), basis = basisOf(m);
  const bad = Object.keys(inputs).filter((k) => !ids.includes(k) || !Number.isFinite(inputs[k]!));
  const emptyMob: MobilityReport = { numerical: 0, gruebler: gruebler(m), variables: ids.length, constraintRank: 0, note: '' };
  if (bad.length) return { status: 'invalid_input', q: {}, poses: forwardPoses(m, {}, g), residual: NaN, iterations: 0, trace: [], mobility: emptyMob, violations: [{ kind: 'inputs', detail: `entradas desconhecidas ou não finitas: ${bad.join(', ')}` }], freeDofAtSolution: 0, singular: false, unreachableParts: unreachable, notes, basis };
  if (unreachable.length) notes.push(`Partes sem ligação ao chão ficam no sítio: ${unreachable.join(', ')}.`);
  const tol = options.tolerance ?? 1e-9, maxIter = options.maxIterations ?? 80, reg = options.regularisation ?? 1e-9;
  const homeQ = Object.fromEntries(ids.map((id) => [id, m.joints.find((j) => j.id === id)!.home])) as JointValues, guess0 = { ...homeQ, ...(options.guess ?? {}) };
  const inputIds = ids.filter((id) => id in inputs), targets = options.targets ?? [];
  const residual = (x: number[], withInputs: boolean): number[] => {
    const q: JointValues = {}; ids.forEach((id, i) => (q[id] = x[i]!)); const D = new Map<string, Matrix4>([[m.ground, IDENT.clone()]]);
    for (const e of g.order) D.set(e.to, D.get(e.from)!.clone().multiply(step(e, q[e.joint.id] ?? 0)));
    const r: number[] = [];
    for (const j of g.loops) { const E = D.get(j.child)!.clone().invert().multiply(D.get(j.parent)!).multiply(jointMatrix(j, q[j.id] ?? 0)), t = new Vector3().setFromMatrixPosition(E), w = rotResidual(E); r.push(t.x, t.y, t.z, ...w); }
    for (const c of m.couplings) { const a = m.joints.find((j) => j.id === c.a)!, b = m.joints.find((j) => j.id === c.b)!; r.push((q[c.b]! - b.home) - c.ratio * (q[c.a]! - a.home)); }
    for (const t of targets) { const p = new Vector3(...t.local).applyMatrix4(D.get(t.part) ?? IDENT); r.push(p.x - t.world[0], p.y - t.world[1], p.z - t.world[2]); }
    if (withInputs) for (const id of inputIds) r.push(q[id]! - inputs[id]!);
    return r;
  };
  const jac = (x: number[], withInputs: boolean): number[][] => { const r0 = residual(x, withInputs), J = r0.map(() => new Array<number>(x.length).fill(0)); for (let k = 0; k < x.length; k++) { const h = 1e-7 * (1 + Math.abs(x[k]!)), xp = [...x], xm = [...x]; xp[k] = x[k]! + h; xm[k] = x[k]! - h; const rp = residual(xp, withInputs), rm = residual(xm, withInputs); for (let i = 0; i < r0.length; i++) J[i]![k] = (rp[i]! - rm[i]!) / (2 * h); } return J; };
  const norm = (r: number[]) => r.reduce((s, v) => Math.max(s, Math.abs(v)), 0);
  const attempt = (start: number[]) => {
    let x = [...start], lambda = 1e-3; const trace: SolveResult['trace'] = []; let r = residual(x, true), n = norm(r);
    for (let it = 0; it < maxIter; it++) {
      trace.push({ iteration: it, residual: n }); if (n < tol) return { x, n, it, trace };
      const J = jac(x, true), nv = x.length, A = Array.from({ length: nv }, () => new Array<number>(nv).fill(0)), b = new Array<number>(nv).fill(0);
      for (let i = 0; i < J.length; i++) for (let a = 0; a < nv; a++) { b[a]! -= J[i]![a]! * r[i]!; for (let c = 0; c < nv; c++) A[a]![c]! += J[i]![a]! * J[i]![c]!; }
      let improved = false;
      for (let tries = 0; tries < 12 && !improved; tries++) { const D = A.map((row, i) => row.map((v, c) => (i === c ? v + lambda + reg : v))), step = solveLinear(D, b); if (!step) { lambda *= 10; continue; } const xn = x.map((v, i) => v + step[i]!), rn = residual(xn, true), nn = norm(rn); if (nn < n) { x = xn; r = rn; n = nn; lambda = Math.max(lambda / 5, 1e-12); improved = true; } else lambda *= 8; }
      if (!improved) break;
    }
    trace.push({ iteration: trace.length, residual: n }); return { x, n, it: trace.length - 1, trace };
  };
  // deterministic start list: the guess, the home pose, then fixed offsets of the home pose (so a singular start does not decide the outcome)
  const starts: number[][] = [ids.map((id) => guess0[id]!), ids.map((id) => homeQ[id]!)]; for (const off of [0.35, -0.35, 0.9, -0.9, 1.7, -1.7]) starts.push(ids.map((id, i) => homeQ[id]! + off * (i % 2 ? -1 : 1) * (m.joints.find((j) => j.id === id)!.kind === 'prismatic' ? 0.1 : 1)));
  let best = attempt(starts[0]!); for (let s = 1; s < starts.length && best.n >= tol; s++) { const a = attempt(starts[s]!); if (a.n < best.n) best = a; }
  const q: JointValues = {}; ids.forEach((id, i) => (q[id] = best.x[i]!)); const converged = best.n < tol, poses = forwardPoses(m, q, g);
  // mobility from the constraints alone (loop closures + couplings), at the solution; local freedom with the inputs fixed
  const Jc = ids.length ? jac(best.x, false) : [], rc = Jc.length ? rankOf(Jc) : 0, Jall = ids.length ? jac(best.x, true) : [], rAll = Jall.length ? rankOf(Jall) : 0, mob = ids.length - rc, free = ids.length - rAll;
  const mobility: MobilityReport = { numerical: mob, gruebler: gruebler(m), variables: ids.length, constraintRank: rc, note: mob === m.joints.length * 0 + gruebler(m).value ? 'A contagem de Grübler-Kutzbach e o rank numérico coincidem nesta configuração.' : 'A contagem de Grübler-Kutzbach e o rank numérico diferem: a geometria é especial (eixos paralelos/coincidentes) ou há restrições redundantes; vale o rank numérico nesta configuração.' };
  const violations: Violation[] = []; for (const j of movable) if (j.limits && (q[j.id]! < j.limits.min - 1e-9 || q[j.id]! > j.limits.max + 1e-9)) violations.push({ kind: 'limit', jointId: j.id, value: q[j.id]!, min: j.limits.min, max: j.limits.max });
  const status: SolveStatus = !converged ? 'no_solution_found' : violations.length ? 'limit_violated' : 'solved';
  if (!converged) notes.push('Não encontrei uma configuração que cumpra todas as restrições a partir de várias partidas determinísticas. Isto NÃO prova que seja impossível; indica que as entradas, os limites ou a geometria das juntas são contraditórios ou inalcançáveis.');
  if (converged && free > 0) notes.push(`Com as entradas fixas sobram ${free} grau(s) de liberdade instantâneo(s): ${inputIds.length < mob ? 'as entradas não determinam a configuração (a solução devolvida é a mais próxima da partida)' : 'configuração singular (a junta de entrada perde controlo sobre o mecanismo)'}.`);
  return { status, q, poses, residual: best.n, iterations: best.it, trace: best.trace, mobility, violations, freeDofAtSolution: converged ? free : 0, singular: converged && free > 0 && inputIds.length >= mob, unreachableParts: unreachable, notes, basis };
}

// ---------------------------------------------------------------------------------------------------- inverse kinematics, sweeps, velocities
export type IkRequest = { part: string; local: Vec3; target: Vec3; /** joints allowed to move; default: every movable joint */ joints?: string[]; guess?: JointValues };
export type IkResult = SolveResult & { reached: boolean; achieved: Vec3; error: number };
/** Inverse kinematics as a constrained solve: the free joints are the variables, the unmoved ones are fixed at their guess. Multiple solutions exist (elbow up/down): the one nearest the guess is returned. */
export function inverseKinematics(m: Mechanism, req: IkRequest, options: { tolerance?: number } = {}): IkResult {
  const movable = m.joints.filter((j) => j.kind !== 'fixed').map((j) => j.id), free = new Set(req.joints ?? movable), guess = { ...Object.fromEntries(m.joints.map((j) => [j.id, j.home])), ...(req.guess ?? {}) };
  const inputs: JointValues = {}; for (const id of movable) if (!free.has(id)) inputs[id] = guess[id]!;
  const r = solveMechanism(m, { inputs, guess, targets: [{ part: req.part, local: req.local, world: req.target }], tolerance: options.tolerance ?? 1e-9, regularisation: 1e-6 });
  const achieved = applyPose(r.poses[req.part]!, req.local), error = Math.hypot(achieved[0] - req.target[0], achieved[1] - req.target[1], achieved[2] - req.target[2]);
  return { ...r, reached: r.status === 'solved' && error < 1e-6, achieved, error };
}
export type SweepSample = { value: number; status: SolveStatus; q: JointValues; residual: number; markers: Record<string, Vec3> };
/** Moves one joint through a range with continuation (each solve starts from the previous one), recording marker trajectories. Same inputs -> same samples. */
export function sweepJoint(m: Mechanism, jointId: string, from: number, to: number, steps: number, others: JointValues = {}, markers: Array<{ id: string; part: string; local: Vec3 }> = []): SweepSample[] {
  const out: SweepSample[] = []; let guess: JointValues | undefined;
  for (let i = 0; i <= steps; i++) { const v = from + ((to - from) * i) / Math.max(1, steps), r = solveMechanism(m, { inputs: { ...others, [jointId]: v }, ...(guess ? { guess } : {}) }); if (r.status === 'solved' || r.status === 'limit_violated') guess = r.q; out.push({ value: v, status: r.status, q: r.q, residual: r.residual, markers: Object.fromEntries(markers.map((k) => [k.id, applyPose(r.poses[k.part]!, k.local)])) }); }
  return out;
}
/** Kinematic velocity of a point for given joint speeds (a CINEMATIC quantity: it needs no mass or force, and says nothing about the forces that would produce it). */
export function pointVelocity(m: Mechanism, q: JointValues, qdot: JointValues, part: string, local: Vec3): Vec3 {
  const h = 1e-6, at = (s: number) => { const qq = { ...q }; for (const id of Object.keys(qdot)) qq[id] = (q[id] ?? 0) + s * qdot[id]!; return applyPose(forwardPoses(m, qq)[part]!, local); }, a = at(h), b = at(-h);
  return [(a[0] - b[0]) / (2 * h), (a[1] - b[1]) / (2 * h), (a[2] - b[2]) / (2 * h)];
}
