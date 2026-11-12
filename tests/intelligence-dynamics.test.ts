import { describe, expect, it } from 'vitest';
import { simulate, staticTorques, dynamicsRequirements } from '../src/living/intelligence/dynamics';
import { checkCollisions } from '../src/living/intelligence/collision';
import { solveMechanism } from '../src/living/intelligence/kinematics';
import { emptyMechanism, validateMechanism, type Joint, type Mechanism } from '../src/living/intelligence/mechanism';

const SHA = 'b'.repeat(64), user = { origin: 'user' as const, evidence: 'teste' }, Z: [number, number, number] = [0, 0, 1], g = 9.81;
const J = (id: string, parent: string, child: string, origin: [number, number, number]): Joint => ({ id, kind: 'revolute', parent, child, origin, axis: Z, home: 0, claim: user });
const withPhysics = (m: Mechanism, parts: Mechanism['physics']['parts']): Mechanism => validateMechanism({ ...m, units: 'm', physics: { gravity: [0, -g, 0], parts } });
const pendulum = (L: number, mass: number) => withPhysics(validateMechanism({ ...emptyMechanism(SHA, 'ground', ['ground', 'rod'], 'm'), joints: [J('pivot', 'ground', 'rod', [0, 0, 0])] }), [{ partId: 'rod', massKg: mass, com: [L, 0, 0], inertia: [0, 0, 0], claim: user }]);
/** complete elliptic integral of the first kind by the arithmetic-geometric mean (independent of the simulator) */
const K = (k: number) => { let a = 1, b = Math.sqrt(1 - k * k); for (let i = 0; i < 40; i++) { [a, b] = [(a + b) / 2, Math.sqrt(a * b)]; } return Math.PI / (2 * a); };
const period = (ts: number[], xs: number[]) => { const z: number[] = []; for (let i = 1; i < xs.length; i++) if (xs[i - 1]! < 0 && xs[i]! >= 0) z.push(ts[i - 1]! + (ts[i]! - ts[i - 1]!) * (-xs[i - 1]! / (xs[i]! - xs[i - 1]!))); return z.length >= 2 ? (z.at(-1)! - z[0]!) / (z.length - 1) : NaN; };

describe('dynamics against analytic solutions', () => {
  it.each([0.1, 1.0, 2.5])('simple pendulum (amplitude %f rad): the simulated period matches T = 4 sqrt(L/g) K(sin(theta0/2)) to < 0.01%', (theta0) => {
    const L = 0.8, m = pendulum(L, 0.5), r = simulate(m, { q0: { pivot: -Math.PI / 2 + theta0 }, duration: 12, dt: 0.002 });
    expect(r.status).toBe('simulated'); const T = 4 * Math.sqrt(L / g) * K(Math.sin(theta0 / 2)), meas = period(r.samples.map((s) => s.t), r.samples.map((s) => s.q[0]! + Math.PI / 2));
    expect(Math.abs(meas - T) / T).toBeLessThan(1e-4); expect(r.energyDrift).toBeLessThan(1e-6);
  });
  it('double pendulum: energy is conserved and the trajectory matches an independent Lagrangian integration of the textbook equations', () => {
    const l1 = 1, l2 = 0.7, m1 = 0.6, m2 = 0.4;
    const m = withPhysics(validateMechanism({ ...emptyMechanism(SHA, 'ground', ['ground', 'a', 'b'], 'm'), joints: [J('j1', 'ground', 'a', [0, 0, 0]), J('j2', 'a', 'b', [l1, 0, 0])] }), [{ partId: 'a', massKg: m1, com: [l1, 0, 0], inertia: [0, 0, 0], claim: user }, { partId: 'b', massKg: m2, com: [l1 + l2, 0, 0], inertia: [0, 0, 0], claim: user }]);
    // our angles: absolute angle of link 1 = q1 (from +x), link 2 = q1 + q2. Textbook angles from the downward vertical: phi = angle + pi/2.
    const q1 = -Math.PI / 2 + 1.2, q2 = 0.9, dt = 0.001, T = 2, r = simulate(m, { q0: { j1: q1, j2: q2 }, duration: T, dt });
    const acc = (p1: number, p2: number, w1: number, w2: number) => { const d = p1 - p2, den = 2 * m1 + m2 - m2 * Math.cos(2 * d); const a1 = (-g * (2 * m1 + m2) * Math.sin(p1) - m2 * g * Math.sin(p1 - 2 * p2) - 2 * Math.sin(d) * m2 * (w2 * w2 * l2 + w1 * w1 * l1 * Math.cos(d))) / (l1 * den), a2 = (2 * Math.sin(d) * (w1 * w1 * l1 * (m1 + m2) + g * (m1 + m2) * Math.cos(p1) + w2 * w2 * l2 * m2 * Math.cos(d))) / (l2 * den); return [a1, a2] as const; };
    let s = [q1 + Math.PI / 2, q1 + q2 + Math.PI / 2, 0, 0]; const f = (x: number[]) => { const [a1, a2] = acc(x[0]!, x[1]!, x[2]!, x[3]!); return [x[2]!, x[3]!, a1, a2]; };
    for (let i = 0; i < T / dt; i++) { const k1 = f(s), k2 = f(s.map((v, j) => v + (dt / 2) * k1[j]!)), k3 = f(s.map((v, j) => v + (dt / 2) * k2[j]!)), k4 = f(s.map((v, j) => v + dt * k3[j]!)); s = s.map((v, j) => v + (dt / 6) * (k1[j]! + 2 * k2[j]! + 2 * k3[j]! + k4[j]!)); }
    const last = r.samples.at(-1)!; expect(Math.abs(last.q[0]! + Math.PI / 2 - s[0]!)).toBeLessThan(1e-4); expect(Math.abs(last.q[0]! + last.q[1]! + Math.PI / 2 - s[1]!)).toBeLessThan(1e-4); expect(r.energyDrift).toBeLessThan(1e-5);
  });
  it('static torque to hold a horizontal rod equals m g L (gravity compensation, closed form)', () => { const t = staticTorques(pendulum(0.8, 0.5), { pivot: 0 }); expect(t.ok).toBe(true); expect(Math.abs(t.torques.pivot! - 0.5 * g * 0.8)).toBeLessThan(1e-6); });
  it('a constant torque equal to the gravity torque keeps the rod at rest (equilibrium), a larger one accelerates it by tau/I', () => {
    const L = 0.8, mass = 0.5, m = pendulum(L, mass), hold = simulate(m, { q0: { pivot: 0 }, torques: { pivot: mass * g * L }, duration: 1, dt: 0.002 }); expect(Math.abs(hold.samples.at(-1)!.q[0]!)).toBeLessThan(1e-9);
    const free = withPhysics(validateMechanism({ ...emptyMechanism(SHA, 'ground', ['ground', 'rod'], 'm'), joints: [J('pivot', 'ground', 'rod', [0, 0, 0])] }), [{ partId: 'rod', massKg: 2, com: [0, 0, 0], inertia: [0, 0, 0.5], claim: user }]);
    const r = simulate(free, { q0: { pivot: 0 }, torques: { pivot: 3 }, duration: 1, dt: 0.001 }); expect(Math.abs(r.samples.at(-1)!.q[0]! - 0.5 * (3 / 0.5))).toBeLessThan(1e-6); // theta = tau t^2 / (2 I)
  });
  it('without the parameters it refuses and says exactly what is missing — no simulation on guessed numbers', () => {
    const bare = validateMechanism({ ...emptyMechanism(SHA, 'ground', ['ground', 'rod'], 'unitless'), joints: [J('pivot', 'ground', 'rod', [0, 0, 0])] }), r = simulate(bare, { q0: {}, duration: 1, dt: 0.01 });
    expect(r.status).toBe('insufficient_parameters'); expect(r.missing.join(' ')).toMatch(/gravidade/); expect(r.missing.join(' ')).toMatch(/«rod»/); expect(r.missing.join(' ')).toMatch(/metros/); expect(r.samples).toHaveLength(0);
    expect(dynamicsRequirements(validateMechanism({ ...pendulum(1, 1), couplings: [] })).ok).toBe(true);
  });
  it('reproducible: two runs give identical samples', () => { const m = pendulum(0.8, 0.5), a = simulate(m, { q0: { pivot: -1 }, duration: 2, dt: 0.005 }), b = simulate(m, { q0: { pivot: -1 }, duration: 2, dt: 0.005 }); expect(JSON.stringify(a)).toBe(JSON.stringify(b)); });
});

describe('collision detection (oriented boxes) and its stated limits', () => {
  const arm = validateMechanism({ ...emptyMechanism(SHA, 'ground', ['ground', 'a', 'b'], 'm'), joints: [J('j1', 'ground', 'a', [0, 0, 0])] });
  const boxes = [{ part: 'ground', center: [0, -1.5, 0] as [number, number, number], half: [2, 0.2, 1] as [number, number, number] }, { part: 'a', center: [1, 0, 0] as [number, number, number], half: [1, 0.1, 0.1] as [number, number, number] }];
  it('a rod swinging down into the base box collides at the angle where their boxes first overlap; above it, no collision', () => {
    expect(checkCollisions(arm, { j1: 0 }, boxes, { includeJoined: true }).collisions).toHaveLength(0);
    // the rod tip (length 2, thickness 0.1) reaches y = -1.3 (top of the base) when 2 sin(theta) = 1.2 -> theta = -asin(0.6) minus the half thickness effect: check the sign change
    const hit = checkCollisions(arm, { j1: -1.2 }, boxes, { includeJoined: true }); expect(hit.collisions).toHaveLength(1); expect(hit.collisions[0]).toMatchObject({ a: 'a', b: 'ground' }); expect(hit.method).toBe('oriented-bounding-boxes');
  });
  it('joined parts are not reported unless asked (they touch by design)', () => { expect(checkCollisions(arm, { j1: -1.2 }, boxes).collisions).toHaveLength(0); expect(solveMechanism(arm, { inputs: { j1: -1.2 } }).status).toBe('solved'); });
});
