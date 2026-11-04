import { describe, expect, it } from 'vitest';
import { validateSpatialPlanV2, type SpatialPlanV2 } from '../src/universal-spatial/contracts-v2';
import { decide, decideAll, initialSpaceReview, pruneSpatialPlan, removedIds, reviewBlockers, reviewRecord } from '../src/living/spatial-space/review';

const id = { position: [0, 0, 0], rotationRad: [0, 0, 0], scale: [1, 1, 1] };
const mat = { profile: 'metal', color: '#777777', roughness: 0.4, metalness: 0.7, clearcoat: 0 };
const component = (name: string, parentId: string | null) => ({ id: name, label: name.toUpperCase(), parentId, transform: id, provenance: { geometry: 'inferred', transform: 'inferred', material: 'design_approximation', evidence: 'test' },
  geometry: { type: 'shape', key: `${name}-shell`, operator: 'box', parameters: { dimensions: [1, 1, 1] }, transform: id, repeat: null, material: mat } });
const plan = (): SpatialPlanV2 => validateSpatialPlanV2({
  contract: 'unfold.spatial-plan.v2', source: { kind: 'text', sha256: 'a'.repeat(64) }, title: 'T', units: 'unitless', presentationProfile: 'neutral',
  components: [component('base', null), component('arm', 'base'), component('hand', 'arm'), component('lamp', null)],
  relations: [{ id: 'r1', fromId: 'arm', toId: 'base', kind: 'attached_to', origin: 'inferred', evidence: 'x' }, { id: 'r2', fromId: 'lamp', toId: 'base', kind: 'adjacent_to', origin: 'inferred', evidence: 'x' }],
  constraints: [{ id: 'c1', kind: 'aligned', componentIds: ['arm', 'hand'], axis: 'x', tolerance: 0.1 }, { id: 'c2', kind: 'aligned', componentIds: ['base', 'lamp'], axis: 'y', tolerance: 0.1 }], unknowns: [],
});

describe('space review', () => {
  it('blocks the build until every component has a decision and the plan is acknowledged', () => {
    const p = plan();
    expect(reviewBlockers(p, initialSpaceReview())).toEqual(['4 componentes sem decisão', 'falta confirmar que é uma concepção da IA, não uma medição']);
    const all = decideAll(p, initialSpaceReview(), 'keep');
    expect(reviewBlockers(p, all)).toEqual(['falta confirmar que é uma concepção da IA, não uma medição']);
    expect(reviewBlockers(p, { ...all, acknowledged: true })).toEqual([]);
    expect(reviewBlockers(p, { ...decideAll(p, initialSpaceReview(), 'reject'), acknowledged: true })).toEqual(['é preciso manter pelo menos um componente']);
  });

  it('removes a rejected component together with what hangs from it, and the relations and constraints that named them', () => {
    const p = plan();
    const review = { ...decideAll(p, initialSpaceReview(), 'keep'), acknowledged: true };
    const r = decide(review, 'arm', 'reject');
    expect([...removedIds(p, r)].sort()).toEqual(['arm', 'hand']);
    const pruned = pruneSpatialPlan(p, removedIds(p, r));
    expect(pruned.components.map((c) => c.id)).toEqual(['base', 'lamp']);
    expect(pruned.relations.map((x) => x.id)).toEqual(['r2']);
    expect(pruned.constraints.map((x) => x.id)).toEqual(['c2']);
    expect(pruned.unknowns.join(' ')).toMatch(/ARM, HAND/);
  });

  it('never promotes provenance: kept components stay inferred', () => {
    const p = plan();
    const pruned = pruneSpatialPlan(p, new Set(['lamp']));
    expect(pruned.components.every((c) => c.provenance.geometry === 'inferred' && c.provenance.transform === 'inferred')).toBe(true);
    expect(pruneSpatialPlan(p, new Set())).toBe(p);
  });

  it('records the reviewer as an unverified browser claim', () => {
    const p = plan();
    const record = reviewRecord(p, decide({ ...decideAll(p, initialSpaceReview(), 'keep'), acknowledged: true }, 'arm', 'reject'));
    expect(record.reviewer).toBe('client_asserted_unverified');
    expect(record.rejected).toEqual(['arm']);
    expect(record.removedWithAncestor).toEqual(['hand']);
  });
});
