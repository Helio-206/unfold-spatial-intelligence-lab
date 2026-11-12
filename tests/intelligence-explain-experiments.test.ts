import { describe, expect, it } from 'vitest';
import { explainBlocked, explainEffect, explainMechanism, jointCategory } from '../src/living/intelligence/explain';
import { compareExperiments, HYPOTHETICAL_PREFIX, parameterOptions, reproduce, runExperiment } from '../src/living/intelligence/experiment';
import { IntelligenceStore } from '../src/living/intelligence/store';
import { emptyMechanism, validateMechanism, withEvent, type Joint, type Mechanism } from '../src/living/intelligence/mechanism';
import { solveFourBar } from '../src/kinematics';

const SHA = 'd'.repeat(64), Z: [number, number, number] = [0, 0, 1], user = { origin: 'user' as const, evidence: 'indicado' }, ai = { origin: 'ai' as const, evidence: 'o modelo viu um pino', model: 'muse-spark', proposalId: 'p1' }, ext = { origin: 'extracted' as const, evidence: 'forma cilíndrica' };
const J = (id: string, parent: string, child: string, o: [number, number, number], extra: Partial<Joint> = {}): Joint => ({ id, kind: 'revolute', parent, child, origin: o, axis: Z, home: 0, claim: user, ...extra });
const mem = (parts: string[], joints: Joint[], units: 'm' | 'unitless' = 'unitless', couplings: Mechanism['couplings'] = []) => validateMechanism({ ...emptyMechanism(SHA, parts[0]!, parts, units), joints, couplings });
const lengths = { ground: 4, crank: 1.2, coupler: 3.6, rocker: 3.2 }, c0 = solveFourBar({ lengths, inputAngleRad: 0.4, branch: 'plus' }).coordinates!;
const fourBar = (limits?: { min: number; max: number }) => mem(['ground', 'crank', 'coupler', 'rocker'], [J('a', 'ground', 'crank', [0, 0, 0], limits ? { limits } : {}), J('d', 'ground', 'rocker', [4, 0, 0]), J('b', 'crank', 'coupler', [c0.crankCouplerJoint.x, c0.crankCouplerJoint.y, 0]), J('c', 'coupler', 'rocker', [c0.couplerRockerJoint.x, c0.couplerRockerJoint.y, 0])]);

describe('explanations come from the engines, with the category of each statement', () => {
  it('categories: user-stated and person-accepted joints are "user", an unaccepted AI proposal is "ai", a heuristic extraction is "hypothesis"; accepting keeps the AI origin in the claim', () => {
    let m = mem(['g', 'a', 'b', 'c'], [J('j1', 'g', 'a', [0, 0, 0]), J('j2', 'a', 'b', [1, 0, 0], { claim: ai }), J('j3', 'b', 'c', [2, 0, 0], { claim: ext })]);
    expect(['j1', 'j2', 'j3'].map((id) => jointCategory(m, id))).toEqual(['user', 'ai', 'hypothesis']);
    m = withEvent(withEvent(m, { kind: 'proposed', target: 'j2', by: 'ai' }), { kind: 'accepted', target: 'j2', by: 'person' }); expect(jointCategory(m, 'j2')).toBe('user'); expect(m.joints.find((j) => j.id === 'j2')!.claim.origin).toBe('ai'); expect(m.events.map((e) => `${e.kind}:${e.by}`)).toEqual(['proposed:ai', 'accepted:person']);
    const statements = explainMechanism(m); expect(statements.find((s) => s.id === 'joint-j2')!.text).toMatch(/Aceite por si \(proposta de IA muse-spark\)/); expect(statements.find((s) => s.id === 'joint-j3')!.category).toBe('hypothesis'); expect(statements.find((s) => s.id === 'basis')!.category).toBe('hypothesis');
    const dof = statements.find((s) => s.id === 'mobility')!; expect(dof.category).toBe('computed'); expect(dof.refs.equation).toMatch(/Σ/); expect(dof.refs.source).toBe('solveMechanism');
  });
  it('"why can\'t it turn further": a joint limit is found by actually trying the motion, and the numbers in the statement are the solver\'s', () => {
    const m = fourBar({ min: -0.6, max: 1.1 }), r = explainBlocked(m, 'a', 2.0); expect(r.cause).toBe('limit'); expect(r.reachedValue).toBeGreaterThan(1.0); expect(r.reachedValue).toBeLessThanOrEqual(1.1 + 1e-9); expect(r.statements[0]!.category).toBe('computed'); expect(r.statements[0]!.text).toMatch(/limite/); expect(r.statements[0]!.refs.values!.alcançado).toBeCloseTo(r.reachedValue, 9);
  });
  it('a loop that cannot close is reported as such (with the solver\'s residual, and without claiming a formal proof)', () => {
    const non = { ground: 4, crank: 1.5, coupler: 2.5, rocker: 2.2 }, n0 = solveFourBar({ lengths: non, inputAngleRad: 0.1, branch: 'plus' }).coordinates!;
    const m = mem(['g', 'cr', 'co', 'ro'], [J('a', 'g', 'cr', [0, 0, 0]), J('d', 'g', 'ro', [4, 0, 0]), J('b', 'cr', 'co', [n0.crankCouplerJoint.x, n0.crankCouplerJoint.y, 0]), J('c', 'co', 'ro', [n0.couplerRockerJoint.x, n0.couplerRockerJoint.y, 0])]), r = explainBlocked(m, 'a', 3.5);
    expect(r.cause).toBe('loop'); expect(r.statements[0]!.text).toMatch(/não é uma prova formal/); expect(r.reachedValue).toBeLessThan(3.0); expect(solveFourBar({ lengths: non, inputAngleRad: 0.1 + r.attemptedValue, branch: 'plus' }).status).toBe('impossible');
  });
  it('a collision between boxes stops the motion and names the two parts; a fixed joint says it has no motion; an unknown joint is "unknown"', () => {
    const arm = mem(['ground', 'a', 'wall'], [J('j1', 'ground', 'a', [0, 0, 0])]), boxes = [{ part: 'wall', center: [0, -1.5, 0] as [number, number, number], half: [2, 0.2, 1] as [number, number, number] }, { part: 'a', center: [1, 0, 0] as [number, number, number], half: [1, 0.1, 0.1] as [number, number, number] }];
    const r = explainBlocked(arm, 'j1', -1.5, { boxes }); expect(r.cause).toBe('collision'); expect(r.statements[0]!.refs.components).toEqual(['a', 'wall']); expect(r.reachedValue).toBeGreaterThan(-1.3);
    expect(explainBlocked(mem(['g', 'p'], [J('f', 'g', 'p', [0, 0, 0], { kind: 'fixed' })]), 'f', 1).cause).toBe('not_movable'); expect(explainBlocked(arm, 'zzz', 1).statements[0]!.category).toBe('unknown');
    expect(explainBlocked(arm, 'j1', -0.5, { boxes }).cause).toBe('movable');
  });
  it('"what happens if I increase this angle": consequences follow from the solve, followers are listed, forces are explicitly unknown, validity is stated', () => {
    const r = explainEffect(fourBar(), 'a', 0.6); expect(r.status).toBe('solved'); const follows = r.statements.filter((s) => s.id.startsWith('follows-')).map((s) => s.id); expect(follows).toEqual(expect.arrayContaining(['follows-b', 'follows-c', 'follows-d']));
    expect(r.statements.find((s) => s.id === 'no-forces')!.category).toBe('unknown'); const bad = explainEffect(fourBar({ min: -1, max: 0.2 }), 'a', 0.6); expect(bad.status).toBe('limit_violated'); expect(bad.statements[0]!.text).toMatch(/viola 1 limite/);
  });
});

describe('experiments: reproducible, versioned, honest about missing parameters', () => {
  const pend = (hyp = false) => validateMechanism({ ...mem(['ground', 'rod'], [J('pivot', 'ground', 'rod', [0, 0, 0])], 'm'), physics: { gravity: [0, -9.81, 0], parts: [{ partId: 'rod', massKg: 0.5, com: [0.8, 0, 0], inertia: [0, 0, 0], claim: { origin: 'user', evidence: `${hyp ? HYPOTHETICAL_PREFIX + ' ' : ''}massa indicada` } }] } });
  it('the same experiment on the same object reproduces bit for bit; a changed object does not "reproduce", it is another experiment', () => {
    const m = fourBar(), e = runExperiment(m, { kind: 'sweep', joint: 'a', from: 0, to: 1.5, steps: 15, markers: [{ id: 'cj', part: 'coupler', local: [c0.couplerRockerJoint.x, c0.couplerRockerJoint.y, 0] }] }, { id: 'e1', name: 'varrimento', planFingerprint: 'fp1' });
    expect(e.result.status).toBe('solved'); expect(e.result.series).toHaveLength(16); expect(reproduce(e, m, 'fp1')).toEqual({ reproduced: true }); const changed = validateMechanism({ ...m, joints: m.joints.map((j) => (j.id === 'a' ? { ...j, limits: { min: -1, max: 1 } } : j)) });
    expect(reproduce(e, changed, 'fp1')).toMatchObject({ reproduced: false, reason: 'object_changed' }); expect(reproduce(e, m, 'fp2')).toMatchObject({ reproduced: false, reason: 'object_changed' });
    expect(e.objectVersion.mechanismHash).toMatch(/^[a-f0-9]{64}$/); expect(e.limitations.join(' ')).toMatch(/rígidos/);
  });
  it('a sweep that leaves the valid range says where, and a pose violating limits is recorded as a violation, not as a success', () => {
    const e = runExperiment(fourBar({ min: -0.5, max: 0.8 }), { kind: 'sweep', joint: 'a', from: 0, to: 1.5, steps: 15 }, { id: 'e2', name: 'excede', planFingerprint: 'fp' }); expect(e.result.status).toBe('limit_violated'); expect(e.result.summary.firstInvalidAt).toBeGreaterThan(0.79); expect(e.result.violations[0]).toMatch(/posições inválidas/);
  });
  it('dynamics without parameters does not run as physics: it lists what is missing and the three honest ways forward', () => {
    const bare = mem(['ground', 'rod'], [J('pivot', 'ground', 'rod', [0, 0, 0])]), e = runExperiment(bare, { kind: 'dynamics', q0: { pivot: 0 }, duration: 1, dt: 0.01 }, { id: 'e3', name: 'queda', planFingerprint: 'fp' });
    expect(e.result.status).toBe('insufficient_parameters'); expect(e.result.series).toHaveLength(0); expect(e.result.missing.length).toBeGreaterThan(1); const o = parameterOptions(bare); expect(o.ok).toBe(false); expect(o.options).toHaveLength(3); expect(o.options.join(' ')).toMatch(/HIPOTÉTICA/);
  });
  it('with parameters it simulates; with assumed parameters the experiment is labelled HYPOTHETICAL everywhere; two configurations compare with their object versions stated', () => {
    const real = runExperiment(pend(), { kind: 'dynamics', q0: { pivot: -1.2 }, duration: 2, dt: 0.005 }, { id: 'r', name: 'real', planFingerprint: 'fp' }), hyp = runExperiment(pend(true), { kind: 'dynamics', q0: { pivot: -1.2 }, duration: 2, dt: 0.005 }, { id: 'h', name: 'hipótese', planFingerprint: 'fp' });
    expect(real.result.status).toBe('simulated'); expect(real.hypothetical).toBe(false); expect(hyp.hypothetical).toBe(true); expect(hyp.limitations[0]).toMatch(/^HIPOTÉTICO:/); expect(real.limitations.join(' ')).toMatch(/não é uma validação física/);
    const cmp = compareExperiments(real, hyp); expect(cmp.sameObjectVersion).toBe(false); expect(cmp.notes.join(' ')).toMatch(/hipotética/); expect(reproduce(real, pend(), 'fp')).toEqual({ reproduced: true });
  });
  it('persistence: experiments and the mechanism round-trip through storage; foreign or corrupt data is refused; the store is bounded', () => {
    const map = new Map<string, string>(), storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) }, st = new IntelligenceStore(storage), m = fourBar();
    expect(st.saveMechanism(m)).toBe(true); const back = st.loadMechanism(SHA); expect(back.ok && back.value.joints.length).toBe(4); expect(st.loadMechanism('e'.repeat(64))).toEqual({ ok: false, reason: 'absent' });
    const e = runExperiment(m, { kind: 'pose', inputs: { a: 0.3 } }, { id: 'p1', name: 'pose', planFingerprint: 'fp' }); expect(st.saveExperiment(e)).toBe(true); const list = st.loadExperiments(SHA); expect(list.ok && list.value[0]!.resultHash).toBe(e.resultHash);
    map.set(`unfold.experiments.v1:${SHA}`, '{broken'); expect(st.loadExperiments(SHA)).toEqual({ ok: false, reason: 'corrupt' }); map.set(`unfold.mechanism.v1:${SHA}`, JSON.stringify({ ...m, planSha256: 'f'.repeat(64) })); expect(st.loadMechanism(SHA)).toEqual({ ok: false, reason: 'foreign' });
    map.delete(`unfold.experiments.v1:${SHA}`); for (let i = 0; i < 50; i++) st.saveExperiment({ ...e, id: `x${i}` }); const all = st.loadExperiments(SHA); expect(all.ok && all.value.length).toBe(40);
  });
});
