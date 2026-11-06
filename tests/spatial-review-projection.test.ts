import { describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { validateSpatialPlanV2, type SpatialPlanV2 } from '../src/universal-spatial/contracts-v2';
import { projectReviewedPlan, type SpatialReviewRecord } from '../src/universal-spatial/review-v1';
import { classifyRelations } from '../src/universal-spatial/reconstruction/relations';
import { reconstructStructure, type EvidenceView } from '../src/universal-spatial/reconstruction/engine';
import { makeView, rasterise, viewDirections, type Tri } from '../src/universal-spatial/reconstruction/silhouette';
import { compileSpatialPlanV2 } from '../src/universal-spatial/geometry-compiler-v2';
import { Box3, Mesh, type Object3D } from 'three';
import { ExperimentalV4 } from '../src/living/spatial-space/experimental-v4';
import { spatialPlanFingerprintV2, SpatialApiError } from '../src/universal-spatial/api-client';
import type { PlanSpaceLayer } from '../src/living/spatial-space/layer';
import type { SpatialOperationV2 } from '../src/universal-spatial/contracts-v2';

const T = (position: number[] = [0, 0, 0]) => ({ position, rotationRad: [0, 0, 0], scale: [1, 1, 1] });
const mat = { profile: 'neutral', color: '#999999', roughness: 0.5, metalness: 0, clearcoat: 0 };
const box = (key: string, d: number[]) => ({ type: 'shape', key, operator: 'box', parameters: { dimensions: d }, transform: T(), repeat: null, material: mat });
const prov = { geometry: 'inferred', transform: 'inferred', material: 'inferred', evidence: 'fixture' };
const comp = (id: string, at: number[], d: number[]) => ({ id, label: id, parentId: null, transform: T(at), provenance: prov, geometry: box(`${id}-s`, d) });
const planWithRelation = (): SpatialPlanV2 => validateSpatialPlanV2({
  contract: 'unfold.spatial-plan.v2', source: { kind: 'image', sha256: 'c'.repeat(64) }, title: 'T', units: 'unitless', presentationProfile: 'neutral', unknowns: [], constraints: [],
  components: [comp('base', [0, 0.5, 0], [3, 1, 2]), comp('column', [0, 1.75, 0], [0.5, 1.5, 0.5])],
  relations: [{ id: 'col-on-base', fromId: 'column', toId: 'base', kind: 'attached_to', origin: 'inferred', evidence: 'declared' }],
});
const planNoRelation = (): SpatialPlanV2 => validateSpatialPlanV2({
  contract: 'unfold.spatial-plan.v2', source: { kind: 'image', sha256: 'c'.repeat(64) }, title: 'T', units: 'unitless', presentationProfile: 'neutral', unknowns: [], constraints: [],
  components: [comp('base', [0, 0.5, 0], [3, 1, 2]), comp('column', [0, 1.75, 0], [0.5, 1.5, 0.5])], relations: [],
});

let seq = 0;
const record = (plan: SpatialPlanV2, decisions: Array<{ subjectId: string; decision: string; correctedValue?: object }>): SpatialReviewRecord => ({
  contract: 'unfold.spatial-review.v1', reviewId: 'review-fixture', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  reviewRevision: decisions.length, source: { kind: plan.source.kind, sha256: plan.source.sha256, byteVerified: false },
  planFingerprint: 'f'.repeat(64), planRevision: 0, componentIds: plan.components.map((c) => c.id), unknowns: [],
  subjects: [
    { subjectId: 'rel-col-on-base', kind: 'relation', original: { kind: 'attached_to', fromId: 'column', toId: 'base' }, statementClass: 'model_inference', geometrySupport: 'supported', uncertainty: 'fixture', evidenceIds: ['plan-geometry'] },
    { subjectId: 'hyp-base-column', kind: 'hypothesis', original: { kind: 'detected_contact', fromId: 'base', toId: 'column' }, statementClass: 'detected_geometry', geometrySupport: 'supported', uncertainty: 'fixture', evidenceIds: ['plan-geometry'] },
  ],
  evidence: [{ evidenceId: 'plan-geometry', kind: 'plan', sha256: 'f'.repeat(64), byteVerified: true, note: '' }],
  decisions: decisions.map((d) => ({ decisionId: `d-${seq++}`, subjectId: d.subjectId, decision: d.decision as never, correctedValue: (d.correctedValue ?? null) as never, planRevision: 0, evidenceIds: ['plan-geometry'], reviewer: { displayName: 'Fixture', authenticated: false as const, attribution: 'client_asserted_unverified' as const }, at: '2026-01-01T00:00:00.000Z', reviewRevision: seq, note: '' })),
  reviewerAuthentication: { authenticated: false, limitation: 'fixture' }, limitations: [],
});

const worldOf = (plan: SpatialPlanV2) => { const c = compileSpatialPlanV2(plan); c.root.updateMatrixWorld(true); const tris = new Map<string, Tri[]>(); c.root.traverse((o: Object3D) => { if (!(o instanceof Mesh) || typeof o.userData.spatialEntityId !== 'string') return; const id = o.userData.spatialEntityId, pos = o.geometry.getAttribute('position'), idx = o.geometry.index, n = idx ? idx.count : pos.count, l = tris.get(id) ?? []; const v = (i: number) => new Vector3().fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld); for (let i = 0; i + 2 < n; i += 3) l.push([v(i), v(i + 1), v(i + 2)]); tris.set(id, l); }); return tris; };
const parts = (plan: SpatialPlanV2) => [...worldOf(plan)].map(([id, tris]) => ({ id, tris }));
const evidenceFor = (truth: SpatialPlanV2): EvidenceView[] => {
  const all = [...worldOf(truth).values()].flat(), b = new Box3(); for (const t of all) for (const p of t) b.expandByPoint(p); const centre = b.getCenter(new Vector3()), half = b.getSize(new Vector3()).length() / 2 * 1.05;
  return viewDirections(6).map((d) => d.clone().applyAxisAngle(new Vector3(0, 1, 0), 0.3)).map((d, i) => { const view = makeView(d, centre, half, 96); return { view, mask: rasterise(all, view), calibrated: true, source: 'rendered' as const, label: `v${i}` }; });
};

describe('reviewed-relationship projection (E1.1)', () => {
  it('a rejected supported relation is NOT enforced by the solver, and the original plan is untouched', () => {
    const plan = planWithRelation(), before = JSON.stringify(plan);
    const reviewed = record(plan, [{ subjectId: 'rel-col-on-base', decision: 'reject' }]);
    const projection = projectReviewedPlan(plan, reviewed);
    expect(projection.plan.relations).toEqual([]);
    expect(JSON.stringify(plan)).toBe(before); // the original keeps its relation; only the projection drops it
    const findings = classifyRelations(projection.plan, parts(projection.plan), { span: 4 });
    expect(findings.find((f) => f.id === 'rel-col-on-base')).toBeUndefined();
    expect(findings.every((f) => !f.enforced)).toBe(true);
    // And the engine consequently refuses for lack of structural support instead of fitting on the rejected joint.
    const outcome = reconstructStructure(projection.plan, evidenceFor(plan), { confirmed: new Set(projection.gate.enforcedSubjectIds) });
    expect(outcome.refusals.map((r) => r.code)).toContain('NO_STRUCTURAL_SUPPORT');
  });

  it('a corrected relation changes solver semantics: the corrected type/endpoints are what gets evaluated', () => {
    const plan = planWithRelation();
    const reviewed = record(plan, [{ subjectId: 'rel-col-on-base', decision: 'correct', correctedValue: { kind: 'adjacent_to', fromId: 'column', toId: 'base' } }]);
    const projection = projectReviewedPlan(plan, reviewed);
    expect(projection.plan.relations[0]).toMatchObject({ kind: 'adjacent_to', fromId: 'column', toId: 'base', origin: 'user_provided' });
    // adjacent_to is not an enforced attach relation for the solver: the correction genuinely changes semantics.
    expect(classifyRelations(projection.plan, parts(projection.plan), { span: 4 }).every((f) => !f.enforced)).toBe(true);
    expect(plan.relations[0]).toMatchObject({ kind: 'attached_to', origin: 'inferred' }); // original preserved
  });

  it('a corrected hypothesis becomes a real relation in the projection; a deferred one stays unconfirmed and unenforced', () => {
    const plan = planNoRelation();
    const corrected = projectReviewedPlan(plan, record(plan, [{ subjectId: 'hyp-base-column', decision: 'correct', correctedValue: { kind: 'attached_to', fromId: 'base', toId: 'column' } }]));
    expect(corrected.plan.relations).toHaveLength(1);
    expect(classifyRelations(corrected.plan, parts(corrected.plan), { span: 4 }).some((f) => f.enforced)).toBe(true);

    const deferred = projectReviewedPlan(plan, record(plan, [{ subjectId: 'hyp-base-column', decision: 'defer' }]));
    expect(deferred.plan.relations).toEqual([]);
    expect(deferred.gate.enforcedSubjectIds).toEqual([]);
    expect(classifyRelations(deferred.plan, parts(deferred.plan), { span: 4 }).every((f) => !f.enforced)).toBe(true);
    const outcome = reconstructStructure(deferred.plan, evidenceFor(plan), { confirmed: new Set(deferred.gate.enforcedSubjectIds) });
    expect(outcome.refusals.map((r) => r.code)).toContain('NO_STRUCTURAL_SUPPORT');
  });

  it('an unrepresentable correction fails explicitly instead of silently keeping the original relation', () => {
    const plan = planWithRelation();
    const reviewed = record(plan, [{ subjectId: 'rel-col-on-base', decision: 'correct', correctedValue: { kind: 'attached_to', fromId: 'column', toId: 'ghost' } }]);
    expect(() => projectReviewedPlan(plan, reviewed)).toThrow(/REVIEW_CORRECTION_UNSUPPORTED/);
    const badKind = record(plan, [{ subjectId: 'rel-col-on-base', decision: 'correct', correctedValue: { kind: 'invented_kind', fromId: 'column', toId: 'base' } }]);
    expect(() => projectReviewedPlan(plan, badKind)).toThrow(/REVIEW_CORRECTION_UNSUPPORTED/);
  });

  it('a review bound to another source is rejected', () => {
    const plan = planWithRelation();
    const foreign = record(plan, []); foreign.source = { kind: 'image', sha256: 'd'.repeat(64), byteVerified: false };
    expect(() => projectReviewedPlan(plan, foreign)).toThrow(/REVIEW_BINDING_MISMATCH/);
  });
});

describe('ExperimentalV4 review binding and preview revalidation (E1.1)', () => {
  const operation: SpatialOperationV2 = { contract: 'unfold.spatial-operation.v2', operationId: 'op-1', kind: 'set-transform', componentId: 'base', nodeKey: null, value: { position: [0, 0, 0], rotationRad: [0, 0, 0], scale: [1, 1, 1] } };
  const gate = (reviewRevision: number) => ({ reviewRevision, eligible: true, enforcedSubjectIds: [], correctedValues: {}, rejectedSubjectIds: [], deferredSubjectIds: [], pendingSubjectIds: [], allowContradicted: false, blockers: [] });
  const fakeLayer = (plan: SpatialPlanV2) => ({ explanationVersion: 0, currentPlan: plan, isBusy: false, proposeSolverEdit: vi.fn(() => true) });
  const stubFetch = (revision: number) => vi.fn(async (_input: unknown, init?: { body?: unknown }) => {
    // Emulates the real server: a pinned reviewRevision that no longer matches is a 409.
    const requested = JSON.parse(String(init?.body ?? '{}')) as { reviewRevision?: number };
    if (requested.reviewRevision !== undefined && requested.reviewRevision !== revision) return new Response(JSON.stringify({ error: { code: 'SPATIAL_REVIEW_REVISION_CONFLICT', message: 'changed' } }), { status: 409, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ contract: 'unfold.spatial-review.v1', review: { contract: 'unfold.spatial-review.v1', reviewId: 'r1', planFingerprint: 'x', source: { sha256: 'c'.repeat(64) } }, gate: gate(revision) }), { status: 200, headers: { 'content-type': 'application/json' } });
  });

  it('preview refuses when the review changed after the Worker finished (test 6)', async () => {
    const plan = planWithRelation(), layer = fakeLayer(plan), fingerprint = await spatialPlanFingerprintV2(plan);
    const v4 = new ExperimentalV4(() => layer as never as PlanSpaceLayer);
    (v4 as never as { ready: unknown }).ready = { layer, version: 0, source: plan.source.sha256, operations: [operation], evidence: 'fixture', reviewId: 'r1', reviewRevision: 3, planFingerprint: fingerprint };
    vi.stubGlobal('fetch', stubFetch(4)); // the review moved on since the run
    await expect(v4.preview()).resolves.toBe(false);
    expect(layer.proposeSolverEdit).not.toHaveBeenCalled();
    vi.stubGlobal('fetch', stubFetch(3)); // unchanged: preview proceeds
    (v4 as never as { ready: unknown }).ready = { layer, version: 0, source: plan.source.sha256, operations: [operation], evidence: 'fixture', reviewId: 'r1', reviewRevision: 3, planFingerprint: fingerprint };
    await expect(v4.preview()).resolves.toBe(true);
    expect(layer.proposeSolverEdit).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('a missing review makes a run fail closed before any Worker work (test 8)', async () => {
    const plan = planWithRelation(), layer = fakeLayer(plan);
    const v4 = new ExperimentalV4(() => layer as never as PlanSpaceLayer);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'SPATIAL_REVIEW_NOT_FOUND', message: 'missing' } }), { status: 404, headers: { 'content-type': 'application/json' } })));
    const evidence = { source: 'rendered' as const, note: 'fixture', views: [] };
    const failure = await v4.run({ sourceSha256: plan.source.sha256, evidence: evidence as never, reviewId: 'missing-review' }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SpatialApiError); expect((failure as SpatialApiError).code).toBe('SPATIAL_REVIEW_NOT_FOUND');
    vi.unstubAllGlobals();
  });
});
