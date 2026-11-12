// Living Intelligence benchmarks: accuracy against analytic/independent references, determinism, and resource use. Writes reports/living-intelligence/benchmark.json.
//   npx tsx scripts/benchmark/intelligence-bench.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyPose, solveMechanism, sweepJoint } from '../../src/living/intelligence/kinematics';
import { simulate } from '../../src/living/intelligence/dynamics';
import { emptyMechanism, validateMechanism, type Joint } from '../../src/living/intelligence/mechanism';
import { solveFourBar } from '../../src/kinematics';
import { applySpatialOperationV2, validateSpatialPlanV2 } from '../../src/universal-spatial/contracts-v2';

const SHA = 'a'.repeat(64), user = { origin: 'user' as const, evidence: 'bench' }, Z: [number, number, number] = [0, 0, 1];
const J = (id: string, kind: Joint['kind'], parent: string, child: string, origin: [number, number, number], axis: [number, number, number] = Z): Joint => ({ id, kind, parent, child, origin, axis, home: 0, claim: user });
const mech = (parts: string[], joints: Joint[], units: 'm' | 'unitless' = 'unitless', physics?: unknown) => validateMechanism({ ...emptyMechanism(SHA, parts[0]!, parts, units), joints, ...(physics ? { physics } : {}) });
const time = <T>(f: () => T, n = 1): { ms: number; out: T } => { const t = performance.now(); let out!: T; for (let i = 0; i < n; i++) out = f(); return { ms: (performance.now() - t) / n, out }; };
const report: Record<string, unknown> = { generatedBy: 'scripts/benchmark/intelligence-bench.ts', node: process.version };

// accuracy ------------------------------------------------------------------------------------------------
const L1 = 0.7, L2 = 0.4, arm = mech(['g', 'l1', 'l2'], [J('s', 'revolute', 'g', 'l1', [0, 0, 0]), J('e', 'revolute', 'l1', 'l2', [L1, 0, 0])]); let fk = 0;
for (let a = -3; a <= 3; a += 0.25) for (let b = -3; b <= 3; b += 0.25) { const tip = applyPose(solveMechanism(arm, { inputs: { s: a, e: b } }).poses.l2!, [L1 + L2, 0, 0]); fk = Math.max(fk, Math.hypot(tip[0] - (L1 * Math.cos(a) + L2 * Math.cos(a + b)), tip[1] - (L1 * Math.sin(a) + L2 * Math.sin(a + b)))); }
const lengths = { ground: 4, crank: 1.2, coupler: 3.6, rocker: 3.2 }, c0 = solveFourBar({ lengths, inputAngleRad: 0.4, branch: 'plus' }).coordinates!;
const fb = mech(['g', 'cr', 'co', 'ro'], [J('a', 'revolute', 'g', 'cr', [0, 0, 0]), J('d', 'revolute', 'g', 'ro', [4, 0, 0]), J('b', 'revolute', 'cr', 'co', [c0.crankCouplerJoint.x, c0.crankCouplerJoint.y, 0]), J('c', 'revolute', 'co', 'ro', [c0.couplerRockerJoint.x, c0.couplerRockerJoint.y, 0])]);
let fbErr = 0; for (const s of sweepJoint(fb, 'a', 0, 2.4, 48, {}, [{ id: 'cj', part: 'co', local: [c0.couplerRockerJoint.x, c0.couplerRockerJoint.y, 0] }])) { const r = solveFourBar({ lengths, inputAngleRad: 0.4 + s.value, branch: 'plus' }).coordinates!.couplerRockerJoint; fbErr = Math.max(fbErr, Math.hypot(s.markers.cj![0] - r.x, s.markers.cj![1] - r.y)); }
const r = 0.5, l = 1.6, t0 = 0.3, x0 = r * Math.cos(t0) + Math.sqrt(l * l - r * r * Math.sin(t0) ** 2), sc = mech(['g', 'cr', 'rod', 'p'], [J('o', 'revolute', 'g', 'cr', [0, 0, 0]), J('p', 'revolute', 'cr', 'rod', [r * Math.cos(t0), r * Math.sin(t0), 0]), J('w', 'revolute', 'rod', 'p', [x0, 0, 0]), J('s', 'prismatic', 'g', 'p', [0, 0, 0], [1, 0, 0])]);
let scErr = 0, guess; for (let k = 0; k <= 72; k++) { const t = t0 + (k / 72) * 2 * Math.PI, res = solveMechanism(sc, { inputs: { o: t - t0 }, ...(guess ? { guess } : {}) }); guess = res.q; scErr = Math.max(scErr, Math.abs(applyPose(res.poses.p!, [x0, 0, 0])[0] - (r * Math.cos(t) + Math.sqrt(l * l - r * r * Math.sin(t) ** 2)))); }
const K = (k: number) => { let a = 1, b = Math.sqrt(1 - k * k); for (let i = 0; i < 40; i++) [a, b] = [(a + b) / 2, Math.sqrt(a * b)]; return Math.PI / (2 * a); };
const pend = mech(['g', 'rod'], [J('pivot', 'revolute', 'g', 'rod', [0, 0, 0])], 'm', { gravity: [0, -9.81, 0], parts: [{ partId: 'rod', massKg: 0.5, com: [0.8, 0, 0], inertia: [0, 0, 0], claim: user }] });
const pendulum = [0.1, 1, 2.5].map((th) => { const s = simulate(pend, { q0: { pivot: -Math.PI / 2 + th }, duration: 12, dt: 0.002 }), ts = s.samples.map((x) => x.t), xs = s.samples.map((x) => x.q[0]! + Math.PI / 2), z: number[] = []; for (let i = 1; i < xs.length; i++) if (xs[i - 1]! < 0 && xs[i]! >= 0) z.push(ts[i - 1]! + (ts[i]! - ts[i - 1]!) * (-xs[i - 1]! / (xs[i]! - xs[i - 1]!))); const T = 4 * Math.sqrt(0.8 / 9.81) * K(Math.sin(th / 2)), meas = (z.at(-1)! - z[0]!) / (z.length - 1); return { amplitudeRad: th, periodRelativeError: Math.abs(meas - T) / T, energyDrift: s.energyDrift }; });
report.accuracy = { forwardKinematics2R_maxErrorUnits: fk, fourBarVsIndependentSolver_maxErrorUnits: fbErr, sliderCrankVsClosedForm_maxErrorUnits: scErr, pendulumVsEllipticPeriod: pendulum };

// determinism -----------------------------------------------------------------------------------------------
const run = () => JSON.stringify([solveMechanism(fb, { inputs: { a: 0.9 } }), sweepJoint(fb, 'a', 0, 2, 20), simulate(pend, { q0: { pivot: -1 }, duration: 3, dt: 0.004 })]);
report.determinism = { identicalAcrossRuns: run() === run() && run() === run() };

// resources -------------------------------------------------------------------------------------------------
const chain = (n: number) => mech(['p0', ...Array.from({ length: n }, (_, i) => `p${i + 1}`)], Array.from({ length: n }, (_, i) => J(`j${i}`, 'revolute', `p${i}`, `p${i + 1}`, [i * 0.3, 0, 0], i % 2 ? [0, 1, 0] : Z)));
const big = (n: number) => validateSpatialPlanV2({ contract: 'unfold.spatial-plan.v2', source: { kind: 'text', sha256: SHA }, title: 'B', units: 'unitless', presentationProfile: 'neutral', components: Array.from({ length: n }, (_, i) => ({ id: `c${i}`, label: `c${i}`, parentId: null, transform: { position: [i, 0, 0], rotationRad: [0, 0, 0], scale: [1, 1, 1] }, provenance: { geometry: 'inferred', transform: 'inferred', material: 'inferred', evidence: 'b' }, geometry: { type: 'shape', key: `c${i}-s`, operator: 'box', parameters: { dimensions: [1, 1, 1] }, transform: { position: [0, 0, 0], rotationRad: [0, 0, 0], scale: [1, 1, 1] }, repeat: null, material: { profile: 'metal', color: '#777777', roughness: 0.4, metalness: 0.7, clearcoat: 0 } } })), relations: [], constraints: [], unknowns: [] });
const solve4 = time(() => solveMechanism(fb, { inputs: { a: 0.9 } }), 200), chain12 = chain(12), solve12 = time(() => solveMechanism(chain12, { inputs: { j0: 0.3, j5: -0.4 } }), 20), sweep = time(() => sweepJoint(fb, 'a', 0, 2.4, 100), 5);
const dyn = time(() => simulate(pend, { q0: { pivot: -1 }, duration: 5, dt: 0.002 }), 3), plan100 = big(80), merge = time(() => applySpatialOperationV2(plan100, { contract: 'unfold.spatial-operation.v2', operationId: 'm', kind: 'merge-components', componentId: 'c0', nodeKey: null, value: { sourceIds: ['c1', 'c2', 'c3'] } }, { origin: 'user_provided', evidence: 'b' }), 20), remove = time(() => applySpatialOperationV2(plan100, { contract: 'unfold.spatial-operation.v2', operationId: 'r', kind: 'remove-component', componentId: 'c40', nodeKey: null, value: { children: 'reparent' } }, { origin: 'user_provided', evidence: 'b' }), 20);
const merged = merge.out, untouched = plan100.components.filter((c) => !['c0', 'c1', 'c2', 'c3'].includes(c.id)).every((c) => JSON.stringify(merged.components.find((x) => x.id === c.id)) === JSON.stringify(c));
report.resources = { fourBarSolveMs: solve4.ms, chain12Joints2InputsSolveMs: solve12.ms, fourBarSweep100PositionsMs: sweep.ms, pendulumDynamics5sAt500HzMs: dyn.ms, structuralMergeOf4In80Components_ms: merge.ms, structuralRemoveIn80Components_ms: remove.ms, unaffectedComponentsByteIdenticalAfterMerge: untouched, heapMB: Math.round(process.memoryUsage().heapUsed / 1e6) };
mkdirSync(resolve('reports/living-intelligence'), { recursive: true }); writeFileSync(resolve('reports/living-intelligence/benchmark.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
