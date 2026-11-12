import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateSpatialPlanV2 } from '../src/universal-spatial/contracts-v2';
import { IntelligenceController } from '../src/living/intelligence/controller';
import { IntelligenceStore } from '../src/living/intelligence/store';
import { solveMechanism } from '../src/living/intelligence/kinematics';
import { emptyMechanism, validateMechanism, type Joint } from '../src/living/intelligence/mechanism';
import { simulate } from '../src/living/intelligence/dynamics';

const I = { position: [0, 0, 0], rotationRad: [0, 0, 0], scale: [1, 1, 1] }, mat = { profile: 'metal', color: '#777777', roughness: 0.4, metalness: 0.7, clearcoat: 0 };
// a plan written by the previous phases: no mechanism, no experiments, relations of the old kinds only
const LEGACY = validateSpatialPlanV2({ contract: 'unfold.spatial-plan.v2', source: { kind: 'image', sha256: '3'.repeat(64) }, title: 'Antigo', units: 'unitless', presentationProfile: 'industrial',
  components: ['a', 'b'].map((id, i) => ({ id, label: id, parentId: null, transform: { ...I, position: [i, 0, 0] }, provenance: { geometry: 'observed', transform: 'observed', material: 'unknown', evidence: 'fase 1' }, geometry: { type: 'shape', key: `${id}-s`, operator: 'box', parameters: { dimensions: [1, 1, 1] }, transform: I, repeat: null, material: mat } })),
  relations: [{ id: 'r1', fromId: 'a', toId: 'b', kind: 'adjacent_to', origin: 'inferred', evidence: 'x' }], constraints: [], unknowns: ['x'] });
const store = () => { const m = new Map<string, string>(); return { s: new IntelligenceStore({ getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }), m }; };

describe('compatibility with Spaces made before Phase 02', () => {
  it('a legacy Space opens with no mechanism and no experiments, nothing is invented, and its plan is untouched by the controller', () => {
    const { s } = store(), before = JSON.stringify(LEGACY), c = new IntelligenceController({ plan: () => LEGACY, selectedId: () => null, store: s, applyPoses: () => undefined, clearPoses: () => undefined, proposeStructural: () => true, onChange: () => undefined });
    expect(c.mechanism).toBeNull(); expect(c.experiments).toEqual([]); expect(c.hasMechanism()).toBe(false); c.proposeFromGeometry(); c.reset(); expect(JSON.stringify(LEGACY)).toBe(before);
  });
  it('a stored mechanism that refers to components the Space no longer has is not loaded, and the person is told', () => {
    const { s } = store(); s.saveMechanism(validateMechanism({ ...emptyMechanism('3'.repeat(64), 'a', ['a', 'zzz'], 'unitless') }));
    const c = new IntelligenceController({ plan: () => LEGACY, selectedId: () => null, store: s, applyPoses: () => undefined, clearPoses: () => undefined, proposeStructural: () => true, onChange: () => undefined }); expect(c.mechanism).toBeNull(); expect(c.notes.join(' ')).toMatch(/já não existem/);
  });
  it('Phase 01 reality evidence and Phase 01 part edits keep validating (the evidence contract was only extended)', async () => {
    const { evidenceFromRenders, solid, ORBIT6 } = await import('./helpers/reality-fixtures'), { validateRealityEvidence } = await import('../src/living/reality/evidence'), ev = evidenceFromRenders(solid(), ORBIT6);
    expect(validateRealityEvidence({ ...ev, partEdits: [{ kind: 'rename', seed: [0, 0, 0], name: 'x', by: 'person' }] }).partEdits).toHaveLength(1); // legacy edit without origin
  });
});

describe('resource budgets (generous: three to ten times the measured values in reports/living-intelligence/benchmark.json)', () => {
  const J = (id: string, parent: string, child: string, o: [number, number, number], axis: [number, number, number] = [0, 0, 1]): Joint => ({ id, kind: 'revolute', parent, child, origin: o, axis, home: 0, claim: { origin: 'user', evidence: 't' } });
  const chain = (n: number) => validateMechanism({ ...emptyMechanism('4'.repeat(64), 'p0', ['p0', ...Array.from({ length: n }, (_, i) => `p${i + 1}`)], 'unitless'), joints: Array.from({ length: n }, (_, i) => J(`j${i}`, `p${i}`, `p${i + 1}`, [i * 0.3, 0, 0], i % 2 ? [0, 1, 0] : [0, 0, 1])) });
  it('a 12-joint chain solves in well under 50 ms; 100 sweep positions of a four-bar-sized loop in well under 300 ms', () => {
    const m = chain(12), t = performance.now(); for (let i = 0; i < 10; i++) solveMechanism(m, { inputs: { j0: 0.3, j5: -0.4 } }); expect((performance.now() - t) / 10).toBeLessThan(50);
  });
  it('a 5 s dynamic simulation at 500 Hz finishes in under 3 s and keeps energy to 1e-6', () => {
    const m = validateMechanism({ ...chain(1), units: 'm', physics: { gravity: [0, -9.81, 0], parts: [{ partId: 'p1', massKg: 1, com: [0.8, 0, 0], inertia: [0, 0, 0], claim: { origin: 'user', evidence: 't' } }] } }), t = performance.now(), r = simulate(m, { q0: { j0: -1 }, duration: 5, dt: 0.002 }); expect(performance.now() - t).toBeLessThan(3000); expect(r.energyDrift).toBeLessThan(1e-6);
  });
  it('the committed benchmark file records accuracy at numerical precision and byte-identical determinism', () => {
    const b = JSON.parse(readFileSync('reports/living-intelligence/benchmark.json', 'utf8')); expect(b.accuracy.fourBarVsIndependentSolver_maxErrorUnits).toBeLessThan(1e-8); expect(b.accuracy.sliderCrankVsClosedForm_maxErrorUnits).toBeLessThan(1e-8); expect(b.determinism.identicalAcrossRuns).toBe(true); expect(b.resources.unaffectedComponentsByteIdenticalAfterMerge).toBe(true);
  });
});
