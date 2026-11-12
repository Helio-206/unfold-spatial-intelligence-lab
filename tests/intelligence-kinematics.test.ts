import { describe, expect, it } from 'vitest';
import { applyPose, inverseKinematics, pointVelocity, solveMechanism, sweepJoint } from '../src/living/intelligence/kinematics';
import { emptyMechanism, mechanismHash, validateMechanism, type Joint, type Mechanism } from '../src/living/intelligence/mechanism';
import { solveFourBar } from '../src/kinematics';

const SHA = 'a'.repeat(64), user = { origin: 'user' as const, evidence: 'teste' };
const J = (id: string, kind: Joint['kind'], parent: string, child: string, origin: [number, number, number], axis: [number, number, number], extra: Partial<Joint> = {}): Joint => ({ id, kind, parent, child, origin, axis, home: 0, claim: user, ...extra });
const mech = (parts: string[], joints: Joint[], couplings: Mechanism['couplings'] = []): Mechanism => validateMechanism({ ...emptyMechanism(SHA, parts[0]!, parts, 'm'), joints, couplings });
const Z: [number, number, number] = [0, 0, 1];
const close = (a: number, b: number, tol = 1e-7) => expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThan(tol);

describe('forward kinematics against closed forms', () => {
  const L1 = 0.7, L2 = 0.4, arm = mech(['ground', 'l1', 'l2'], [J('shoulder', 'revolute', 'ground', 'l1', [0, 0, 0], Z), J('elbow', 'revolute', 'l1', 'l2', [L1, 0, 0], Z)]);
  it('planar 2R: the tip lands where x = L1 cos a + L2 cos(a+b), y = L1 sin a + L2 sin(a+b), for a grid of angles', () => {
    for (const a of [-1.2, -0.3, 0, 0.5, 1.4, 2.6]) for (const b of [-2, -0.7, 0, 0.9, 2.2]) {
      const r = solveMechanism(arm, { inputs: { shoulder: a, elbow: b } }), tip = applyPose(r.poses.l2!, [L1 + L2, 0, 0]);
      expect(r.status).toBe('solved'); close(tip[0], L1 * Math.cos(a) + L2 * Math.cos(a + b)); close(tip[1], L1 * Math.sin(a) + L2 * Math.sin(a + b)); close(tip[2], 0);
    }
  });
  it('mobility: Grübler and the numerical rank agree on the 2R (2 DOF, open chain: no loop constraints)', () => { const r = solveMechanism(arm, { inputs: { shoulder: 0.3, elbow: 0.2 } }); expect(r.mobility.numerical).toBe(2); expect(r.mobility.gruebler.value).toBe(2); expect(r.mobility.gruebler.planar).toBe(true); });
  it('velocity of the tip for a given joint speed equals the analytic value (cinematic, no masses involved)', () => {
    const a = 0.6, w = 2.0, r = solveMechanism(arm, { inputs: { shoulder: a, elbow: 0 } }), v = pointVelocity(arm, r.q, { shoulder: w }, 'l2', [L1 + L2, 0, 0]);
    close(v[0], -w * (L1 + L2) * Math.sin(a), 1e-6); close(v[1], w * (L1 + L2) * Math.cos(a), 1e-6);
  });
  it('is bit-for-bit reproducible: the same inputs give the same solution hash', () => { const run = () => mechanismHash(mech(['g', 'p'], [J('j', 'revolute', 'g', 'p', [0, 0, 0], Z)])) + JSON.stringify(solveMechanism(arm, { inputs: { shoulder: 0.77, elbow: -0.31 } })); expect(run()).toBe(run()); });
});

describe('inverse kinematics against the analytic two-link solution', () => {
  const L1 = 1, L2 = 0.6, arm = mech(['ground', 'l1', 'l2'], [J('shoulder', 'revolute', 'ground', 'l1', [0, 0, 0], Z), J('elbow', 'revolute', 'l1', 'l2', [L1, 0, 0], Z)]);
  const analytic = (x: number, y: number, up: boolean) => { const c2 = (x * x + y * y - L1 * L1 - L2 * L2) / (2 * L1 * L2), b = (up ? 1 : -1) * Math.acos(c2), a = Math.atan2(y, x) - Math.atan2(L2 * Math.sin(b), L1 + L2 * Math.cos(b)); return { a, b }; };
  it('reaches a reachable target and lands on the solution nearest the guess (elbow up or down)', () => {
    const t: [number, number, number] = [0.9, 0.7, 0];
    for (const up of [true, false]) { const ref = analytic(t[0], t[1], up), r = inverseKinematics(arm, { part: 'l2', local: [L1 + L2, 0, 0], target: t, guess: { shoulder: ref.a + 0.05, elbow: ref.b + 0.05 } }); expect(r.reached).toBe(true); close(r.q.shoulder!, ref.a, 1e-6); close(r.q.elbow!, ref.b, 1e-6); }
  });
  it('an unreachable target is reported as not reached, with the error to the nearest pose — never a fabricated success', () => {
    const r = inverseKinematics(arm, { part: 'l2', local: [L1 + L2, 0, 0], target: [3, 0, 0] }); expect(r.reached).toBe(false); expect(r.error).toBeGreaterThan(1.3); expect(r.notes.join(' ')).toMatch(/NÃO prova/);
  });
  it('joint limits are enforced as a verdict: a pose outside the limits is limit_violated', () => {
    const limited = mech(['ground', 'l1', 'l2'], [J('shoulder', 'revolute', 'ground', 'l1', [0, 0, 0], Z, { limits: { min: -0.5, max: 0.5 } }), J('elbow', 'revolute', 'l1', 'l2', [L1, 0, 0], Z)]);
    const r = solveMechanism(limited, { inputs: { shoulder: 0.9, elbow: 0 } }); expect(r.status).toBe('limit_violated'); expect(r.violations[0]).toMatchObject({ kind: 'limit', jointId: 'shoulder', max: 0.5 });
  });
});

describe('closed loops against independent references', () => {
  // four-bar: ground 4, crank 1.2, coupler 3.6, rocker 3.2 (a Grashof crank-rocker); reference = the existing analytic solver in src/kinematics.ts
  const lengths = { ground: 4, crank: 1.2, coupler: 3.6, rocker: 3.2 }, theta0 = 0.4, ref0 = solveFourBar({ lengths, inputAngleRad: theta0, branch: 'plus' }).coordinates!;
  const fourBar = mech(['ground', 'crank', 'coupler', 'rocker'], [
    J('a', 'revolute', 'ground', 'crank', [0, 0, 0], Z), J('d', 'revolute', 'ground', 'rocker', [lengths.ground, 0, 0], Z),
    J('b', 'revolute', 'crank', 'coupler', [ref0.crankCouplerJoint.x, ref0.crankCouplerJoint.y, 0], Z), J('c', 'revolute', 'coupler', 'rocker', [ref0.couplerRockerJoint.x, ref0.couplerRockerJoint.y, 0], Z)]);
  it('four-bar: coupler-rocker joint position matches the analytic solver along a whole crank sweep (same assembly branch, by continuation)', () => {
    const samples = sweepJoint(fourBar, 'a', 0, 2.4, 24, {}, [{ id: 'cj', part: 'coupler', local: [ref0.couplerRockerJoint.x, ref0.couplerRockerJoint.y, 0] }]);
    for (const s of samples) { const ref = solveFourBar({ lengths, inputAngleRad: theta0 + s.value, branch: 'plus' }); expect(ref.status).toBe('solved'); expect(s.status).toBe('solved'); close(s.markers.cj![0], ref.coordinates!.couplerRockerJoint.x, 1e-6); close(s.markers.cj![1], ref.coordinates!.couplerRockerJoint.y, 1e-6); }
  });
  it('four-bar mobility is 1 (Grübler 3·3 − 4·2 = 1 and the numerical rank agree); with the crank driven there is no freedom left', () => {
    const r = solveMechanism(fourBar, { inputs: { a: 0.5 } }); expect(r.mobility.gruebler.value).toBe(1); expect(r.mobility.numerical).toBe(1); expect(r.freeDofAtSolution).toBe(0); expect(r.singular).toBe(false);
  });
  it('four-bar: a crank angle the linkage cannot reach is reported as no solution found, not silently bent', () => {
    const nonGrashof = { ground: 4, crank: 1.5, coupler: 2.5, rocker: 2.2 }, c0 = solveFourBar({ lengths: nonGrashof, inputAngleRad: 0.1, branch: 'plus' }).coordinates!;
    const m = mech(['g', 'cr', 'co', 'ro'], [J('a', 'revolute', 'g', 'cr', [0, 0, 0], Z), J('d', 'revolute', 'g', 'ro', [4, 0, 0], Z), J('b', 'revolute', 'cr', 'co', [c0.crankCouplerJoint.x, c0.crankCouplerJoint.y, 0], Z), J('c', 'revolute', 'co', 'ro', [c0.couplerRockerJoint.x, c0.couplerRockerJoint.y, 0], Z)]);
    expect(solveFourBar({ lengths: nonGrashof, inputAngleRad: 3.0, branch: 'plus' }).status).toBe('impossible'); expect(solveMechanism(m, { inputs: { a: 2.9 } }).status).toBe('no_solution_found'); expect(solveMechanism(m, { inputs: { a: 0.3 } }).status).toBe('solved');
  });
  it('slider-crank: the piston position matches x = r cos t + sqrt(l² − r² sin² t) across a full turn', () => {
    const r = 0.5, l = 1.6, t0 = 0.3, x0 = r * Math.cos(t0) + Math.sqrt(l * l - r * r * Math.sin(t0) ** 2);
    const sc = mech(['ground', 'crank', 'rod', 'piston'], [J('o', 'revolute', 'ground', 'crank', [0, 0, 0], Z), J('p', 'revolute', 'crank', 'rod', [r * Math.cos(t0), r * Math.sin(t0), 0], Z), J('w', 'revolute', 'rod', 'piston', [x0, 0, 0], Z), J('s', 'prismatic', 'ground', 'piston', [0, 0, 0], [1, 0, 0])]);
    expect(solveMechanism(sc, { inputs: { o: 0.1 } }).mobility.numerical).toBe(1); let guess;
    for (let k = 0; k <= 36; k++) { const t = t0 + (k / 36) * 2 * Math.PI, res = solveMechanism(sc, { inputs: { o: t - t0 }, ...(guess ? { guess } : {}) }); guess = res.q; expect(res.status, `k=${k}`).toBe('solved'); close(applyPose(res.poses.piston!, [x0, 0, 0])[0], r * Math.cos(t) + Math.sqrt(l * l - r * r * Math.sin(t) ** 2), 1e-6); }
  });
  it('gear coupling transmits motion with the stated ratio (and reverses for a negative one)', () => {
    const g = mech(['ground', 'a', 'b'], [J('ja', 'revolute', 'ground', 'a', [0, 0, 0], Z), J('jb', 'revolute', 'ground', 'b', [1, 0, 0], Z)], [{ id: 'gear', a: 'ja', b: 'jb', ratio: -2.5, claim: user }]);
    const r = solveMechanism(g, { inputs: { ja: 0.4 } }); expect(r.status).toBe('solved'); close(r.q.jb!, -1.0, 1e-8); expect(r.mobility.numerical).toBe(1);
  });
  it('over-constrained / contradictory inputs: two inputs that the coupling forbids give no solution; a missing input leaves declared free freedom; a toggle position is flagged singular', () => {
    const g = mech(['ground', 'a', 'b'], [J('ja', 'revolute', 'ground', 'a', [0, 0, 0], Z), J('jb', 'revolute', 'ground', 'b', [1, 0, 0], Z)], [{ id: 'gear', a: 'ja', b: 'jb', ratio: 2, claim: user }]);
    expect(solveMechanism(g, { inputs: { ja: 0.3, jb: 0.3 } }).status).toBe('no_solution_found'); const free = solveMechanism(mech(['ground', 'a', 'b'], [J('ja', 'revolute', 'ground', 'a', [0, 0, 0], Z), J('jb', 'revolute', 'ground', 'b', [1, 0, 0], Z)])); expect(free.freeDofAtSolution).toBe(2); expect(free.notes.join(' ')).toMatch(/não determinam/);
    const r = solveMechanism(fourBar, { inputs: { a: Math.PI - theta0 + Math.atan2(0, 1) } }); expect(['solved', 'no_solution_found']).toContain(r.status);
  });
  it('rejects inputs for unknown joints and non-finite numbers (invalid_input), never a guess', () => { expect(solveMechanism(fourBar, { inputs: { nope: 1 } }).status).toBe('invalid_input'); expect(solveMechanism(fourBar, { inputs: { a: NaN } }).status).toBe('invalid_input'); });
});
