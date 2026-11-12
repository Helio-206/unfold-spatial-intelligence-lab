import { Matrix4, Vector3 } from 'three';
import { forwardPoses, type JointValues } from './kinematics';
import { basisOf, type Mechanism, type Vec3 } from './mechanism';

/**
 * Rigid-body dynamics of TREE-structured mechanisms (open chains), from the generalised-coordinate equations M(q) q'' + C(q, q') q' + G(q) = tau - damping.
 * It runs ONLY when the parameters it needs were provided: gravity, and mass + centre of mass + principal inertia for every moving part. Otherwise it refuses and
 * lists what is missing, so no result can be mistaken for a physical prediction made on guessed numbers. Closed loops, contacts, friction other than the
 * given viscous damping, flexibility and impacts are NOT modelled; a result is "simulated under these stated conditions", never "physically validated".
 * Integration: classical RK4 with a fixed step -> reproducible.
 */
export type DynamicsRequirement = { ok: true } | { ok: false; missing: string[]; hasLoops: boolean };
export type DynamicsState = { q: number[]; qd: number[]; t: number };
export type DynamicsSetup = { ids: string[]; M: (q: number[]) => number[][]; G: (q: number[]) => number[]; energy: (q: number[], qd: number[]) => { kinetic: number; potential: number; total: number } };

function movableChain(m: Mechanism): { ids: string[]; parents: Map<string, string | null> } {
  const ids = m.joints.filter((j) => j.kind !== 'fixed').map((j) => j.id).sort(); return { ids, parents: new Map() };
}
export function dynamicsRequirements(m: Mechanism): DynamicsRequirement {
  const missing: string[] = []; if (!m.physics.gravity) missing.push('vetor da gravidade (use [0,-9.81,0] ou outro, e a unidade de comprimento)');
  const moving = new Set(m.joints.filter((j) => j.kind !== 'fixed').map((j) => j.child)); const have = new Set(m.physics.parts.map((p) => p.partId));
  for (const p of moving) if (!have.has(p)) missing.push(`massa, centro de massa e inércia da parte «${p}»`);
  if (m.units !== 'm') missing.push('unidades em metros (o plano é sem unidade: massas em kg e comprimentos têm de ter a mesma escala)');
  const hasLoops = m.joints.length > m.parts.length - 1 || m.couplings.length > 0;
  return missing.length || hasLoops ? { ok: false, missing: [...missing, ...(hasLoops ? ['o motor dinâmico só trata cadeias abertas (sem laços fechados nem acoplamentos)'] : [])], hasLoops } : { ok: true };
}

/** builds M(q), G(q) and the energy for an open chain with the given physics */
export function buildDynamics(m: Mechanism): DynamicsSetup {
  const req = dynamicsRequirements(m); if (!req.ok) throw new Error(`DYNAMICS_PARAMETERS_MISSING: ${req.missing.join('; ')}`);
  const { ids } = movableChain(m), joints = ids.map((id) => m.joints.find((j) => j.id === id)!), g = new Vector3(...m.physics.gravity!);
  // for each physical part: which joints move it (ancestors in the tree, found by walking parent links)
  const parentJoint = new Map(m.joints.map((j) => [j.child, j])), chainOf = (part: string): string[] => { const out: string[] = []; let p = part; for (let guard = 0; guard < 64; guard++) { const j = parentJoint.get(p); if (!j) break; out.push(j.id); p = j.parent; } return out; };
  const withQ = (q: number[]): JointValues => Object.fromEntries(ids.map((id, i) => [id, q[i]!]));
  const kin = (q: number[]) => {
    const qq = withQ(q), poses = forwardPoses(m, qq), D = (part: string) => new Matrix4().fromArray(poses[part]!), n = ids.length;
    const jointFrame = (j: (typeof joints)[number]) => { const P = D(j.parent); return { o: new Vector3(...j.origin).applyMatrix4(P), a: new Vector3(...j.axis).normalize().applyMatrix4(new Matrix4().extractRotation(P)) }; };
    return { poses, D, n, jointFrame, qq };
  };
  const partTerms = (q: number[]) => {
    const k = kin(q), terms: Array<{ m: number; Jv: Vector3[]; Jw: Vector3[]; Iw: Matrix4; c: Vector3 }> = [];
    for (const p of m.physics.parts) {
      const D = k.D(p.partId), c = new Vector3(...p.com).applyMatrix4(D), R = new Matrix4().extractRotation(D), chain = new Set(chainOf(p.partId)), Jv: Vector3[] = [], Jw: Vector3[] = [];
      joints.forEach((j) => { if (!chain.has(j.id)) { Jv.push(new Vector3()); Jw.push(new Vector3()); return; } const f = k.jointFrame(j); if (j.kind === 'prismatic') { Jv.push(f.a.clone()); Jw.push(new Vector3()); } else { Jv.push(f.a.clone().cross(c.clone().sub(f.o))); Jw.push(f.a.clone()); } });
      const Ib = new Matrix4().set(p.inertia[0], 0, 0, 0, 0, p.inertia[1], 0, 0, 0, 0, p.inertia[2], 0, 0, 0, 0, 1), Iw = R.clone().multiply(Ib).multiply(R.clone().transpose());
      terms.push({ m: p.massKg, Jv, Jw, Iw, c });
    }
    return terms;
  };
  const M = (q: number[]): number[][] => { const n = ids.length, out = Array.from({ length: n }, () => new Array<number>(n).fill(0)); for (const t of partTerms(q)) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out[i]![j]! += t.m * t.Jv[i]!.dot(t.Jv[j]!) + t.Jw[i]!.clone().applyMatrix4(t.Iw).dot(t.Jw[j]!); return out; };
  const G = (q: number[]): number[] => { const out = new Array<number>(ids.length).fill(0); for (const t of partTerms(q)) for (let i = 0; i < ids.length; i++) out[i]! -= t.m * g.dot(t.Jv[i]!); return out; };
  const energy = (q: number[], qd: number[]) => { const Mq = M(q); let T = 0; for (let i = 0; i < qd.length; i++) for (let j = 0; j < qd.length; j++) T += 0.5 * qd[i]! * Mq[i]![j]! * qd[j]!; let U = 0; for (const t of partTerms(q)) U -= t.m * g.dot(t.c); return { kinetic: T, potential: U, total: T + U }; };
  return { ids, M, G, energy };
}
const solve = (A: number[][], b: number[]): number[] => { const n = b.length, M = A.map((r, i) => [...r, b[i]!]); for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r; if (Math.abs(M[p]![c]!) < 1e-15) throw new Error('DYNAMICS_SINGULAR_MASS_MATRIX'); [M[c], M[p]] = [M[p]!, M[c]!]; for (let r = c + 1; r < n; r++) { const f = M[r]![c]! / M[c]![c]!; for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!; } } const x = new Array<number>(n).fill(0); for (let r = n - 1; r >= 0; r--) { let s = M[r]![n]!; for (let k = r + 1; k < n; k++) s -= M[r]![k]! * x[k]!; x[r] = s / M[r]![r]!; } return x; };

export type SimulationInput = { q0: JointValues; qd0?: JointValues; torques?: JointValues; damping?: JointValues; duration: number; dt: number; sampleEvery?: number };
export type SimulationResult = { status: 'simulated' | 'insufficient_parameters' | 'unstable'; missing: string[]; ids: string[]; samples: Array<{ t: number; q: number[]; qd: number[]; kinetic: number; potential: number; total: number }>; energyDrift: number; limitations: string[]; basis: 'confirmed' | 'hypothesis' | 'mixed' };
const LIMITS = ['Corpos rígidos, cadeia aberta; sem contactos, impactos, atrito (excepto o amortecimento viscoso indicado) nem flexibilidade.', 'Resultado simulado sob os parâmetros indicados; não é uma validação física.'];
export function simulate(m: Mechanism, input: SimulationInput): SimulationResult {
  const req = dynamicsRequirements(m), basis = basisOf(m); if (!req.ok) return { status: 'insufficient_parameters', missing: req.missing, ids: [], samples: [], energyDrift: 0, limitations: LIMITS, basis };
  const D = buildDynamics(m), n = D.ids.length, h = 1e-6, tau = D.ids.map((id) => input.torques?.[id] ?? 0), damp = D.ids.map((id) => input.damping?.[id] ?? 0);
  const accel = (q: number[], qd: number[]): number[] => {
    const Mq = D.M(q), dM: number[][][] = []; for (let k = 0; k < n; k++) { const qp = [...q], qm = [...q]; qp[k]! += h; qm[k]! -= h; const a = D.M(qp), b = D.M(qm); dM.push(a.map((row, i) => row.map((v, j) => (v - b[i]![j]!) / (2 * h)))); }
    const c = new Array<number>(n).fill(0); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) c[i]! += (dM[k]![i]![j]! - 0.5 * dM[i]![j]![k]!) * qd[j]! * qd[k]!;
    const G = D.G(q); return solve(Mq, tau.map((t, i) => t - c[i]! - G[i]! - damp[i]! * qd[i]!));
  };
  let q = D.ids.map((id) => input.q0[id] ?? m.joints.find((j) => j.id === id)!.home), qd = D.ids.map((id) => input.qd0?.[id] ?? 0), t = 0; const steps = Math.round(input.duration / input.dt), every = input.sampleEvery ?? 1, samples: SimulationResult['samples'] = [];
  const snap = () => { const e = D.energy(q, qd); samples.push({ t, q: [...q], qd: [...qd], kinetic: e.kinetic, potential: e.potential, total: e.total }); };
  snap();
  for (let s = 1; s <= steps; s++) {
    const f = (qq: number[], vv: number[]) => ({ dq: vv, dv: accel(qq, vv) }), add = (a: number[], b: number[], k: number) => a.map((v, i) => v + k * b[i]!);
    const k1 = f(q, qd), k2 = f(add(q, k1.dq, input.dt / 2), add(qd, k1.dv, input.dt / 2)), k3 = f(add(q, k2.dq, input.dt / 2), add(qd, k2.dv, input.dt / 2)), k4 = f(add(q, k3.dq, input.dt), add(qd, k3.dv, input.dt));
    q = q.map((v, i) => v + (input.dt / 6) * (k1.dq[i]! + 2 * k2.dq[i]! + 2 * k3.dq[i]! + k4.dq[i]!)); qd = qd.map((v, i) => v + (input.dt / 6) * (k1.dv[i]! + 2 * k2.dv[i]! + 2 * k3.dv[i]! + k4.dv[i]!)); t = s * input.dt;
    if (q.some((v) => !Number.isFinite(v))) return { status: 'unstable', missing: [], ids: D.ids, samples, energyDrift: NaN, limitations: LIMITS, basis };
    if (s % every === 0 || s === steps) snap();
  }
  const e0 = samples[0]!.total, scale = Math.max(1e-12, Math.abs(e0) + Math.abs(samples[0]!.kinetic) + 1e-9), drift = Math.max(...samples.map((s) => Math.abs(s.total - e0))) / scale;
  return { status: 'simulated', missing: [], ids: D.ids, samples, energyDrift: drift, limitations: LIMITS, basis };
}
/** torque each joint must supply to hold the configuration still (gravity compensation); needs the same parameters as the simulation */
export function staticTorques(m: Mechanism, q: JointValues): { ok: boolean; missing: string[]; torques: Record<string, number> } {
  const req = dynamicsRequirements(m); if (!req.ok) return { ok: false, missing: req.missing, torques: {} };
  const D = buildDynamics(m), G = D.G(D.ids.map((id) => q[id] ?? m.joints.find((j) => j.id === id)!.home)); return { ok: true, missing: [], torques: Object.fromEntries(D.ids.map((id, i) => [id, G[i]!])) };
}
export type { Vec3 };
