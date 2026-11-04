import { describe, expect, it } from 'vitest';
import { Box3, Matrix4, Mesh, Vector3, type Object3D } from 'three';
import { applySpatialOperationV2, validateSpatialPlanV2, type SpatialPlanV2 } from '../src/universal-spatial/contracts-v2';
import { compileSpatialPlanV2 } from '../src/universal-spatial/geometry-compiler-v2';
import { maxDepth, validateHierarchy } from '../src/universal-spatial/reconstruction/hierarchy';
import { classifyRelations } from '../src/universal-spatial/reconstruction/relations';
import { reconstructStructure, type EvidenceView } from '../src/universal-spatial/reconstruction/engine';
import { makeView, rasterise, viewDirections, type Tri } from '../src/universal-spatial/reconstruction/silhouette';

const T = (position: number[] = [0, 0, 0], rotationRad: number[] = [0, 0, 0], scale: number[] = [1, 1, 1]) => ({ position, rotationRad, scale });
const mat = { profile: 'neutral', color: '#999999', roughness: 0.5, metalness: 0, clearcoat: 0 };
const box = (key: string, d: number[], at: number[] = [0, 0, 0]) => ({ type: 'shape', key, operator: 'box', parameters: { dimensions: d }, transform: T(at), repeat: null, material: mat });
const prov = { geometry: 'design_approximation', transform: 'design_approximation', material: 'design_approximation', evidence: 't' };
const comp = (id: string, parentId: string | null, transform: ReturnType<typeof T>, geometry: object) => ({ id, label: id, parentId, transform, provenance: prov, geometry });
const mk = (components: object[], relations: object[] = []): SpatialPlanV2 => validateSpatialPlanV2({ contract: 'unfold.spatial-plan.v2', source: { kind: 'image', sha256: 'c'.repeat(64) }, title: 'T', units: 'unitless', presentationProfile: 'neutral', unknowns: [], constraints: [], relations, components });
// a three-level chain: a base, an arm that is rotated and hangs off it, a tool at the end of the arm. Local transforms only.
const chain = (armScale = 1, toolScale = 1): SpatialPlanV2 => mk([
  comp('base', null, T([0, 0.5, 0]), box('base-s', [3, 1, 2])),
  comp('arm', 'base', T([0, 0.5, 0], [0, 0, 0.5], [armScale, armScale, armScale]), box('arm-s', [0.5, 2.4, 0.5], [0, 1.2, 0])),
  comp('tool', 'arm', T([0, 2.4, 0], [0, 0, -0.3], [toolScale, toolScale, toolScale]), box('tool-s', [1.2, 0.5, 1.2], [0, 0.25, 0])),
], [{ id: 'arm-on-base', fromId: 'arm', toId: 'base', kind: 'attached_to', origin: 'inferred', evidence: 'x' }, { id: 'tool-on-arm', fromId: 'tool', toId: 'arm', kind: 'attached_to', origin: 'inferred', evidence: 'x' }]);

const worldOf = (plan: SpatialPlanV2) => { const c = compileSpatialPlanV2(plan); c.root.updateMatrixWorld(true); const tris = new Map<string, Tri[]>(), worlds = new Map<string, Matrix4>(); c.root.traverse((o: Object3D) => { if (o.userData.spatialComponentRoot) worlds.set(o.userData.spatialEntityId, o.matrixWorld.clone()); if (!(o instanceof Mesh) || typeof o.userData.spatialEntityId !== 'string') return; const id = o.userData.spatialEntityId, pos = o.geometry.getAttribute('position'), idx = o.geometry.index, n = idx ? idx.count : pos.count, l = tris.get(id) ?? []; const v = (i: number) => new Vector3().fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld); for (let i = 0; i + 2 < n; i += 3) l.push([v(i), v(i + 1), v(i + 2)]); tris.set(id, l); }); return { tris, worlds }; };
const evidenceFor = (truth: SpatialPlanV2, dirs: Vector3[], calibrated = true): EvidenceView[] => {
  const all = [...worldOf(truth).tris.values()].flat(), b = new Box3(); for (const t of all) for (const p of t) b.expandByPoint(p); const centre = b.getCenter(new Vector3()), half = b.getSize(new Vector3()).length() / 2 * 1.05;
  return dirs.map((d, i) => { const view = makeView(d, centre, half, 96); return { view, mask: rasterise(all, view), calibrated, source: 'rendered' as const, label: `v${i}` }; });
};
const six = () => viewDirections(6).map((d) => d.clone().applyAxisAngle(new Vector3(0, 1, 0), 0.3));

describe('hierarchy validation', () => {
  it('composes world transforms from LOCAL ones, down any depth, and matches the compiled scene', () => {
    const plan = chain(), report = validateHierarchy(plan), compiled = worldOf(plan).worlds;
    expect(report.ok).toBe(true); expect(report.order).toEqual(['base', 'arm', 'tool']); expect(maxDepth(report)).toBe(2);
    for (const id of report.order) expect(report.frames.get(id)!.world.elements.every((v, i) => Math.abs(v - compiled.get(id)!.elements[i]!) < 1e-9)).toBe(true);
    expect(report.frames.get('tool')!.local.elements).not.toEqual(report.frames.get('tool')!.world.elements); // local is not world
  });

  it('reports cycles, missing parents, self parents, duplicate ids and contradictory relations; never throws, never repairs', () => {
    const raw = (components: object[], relations: object[] = []) => ({ ...chain(), components, relations } as unknown as SpatialPlanV2), c = chain().components;
    const codes = (plan: SpatialPlanV2) => validateHierarchy(plan).issues.map((i) => i.code);
    expect(codes(raw([{ ...c[0], parentId: 'tool' }, c[1], c[2]]))).toContain('CYCLE');
    expect(codes(raw([c[0], { ...c[1], parentId: 'ghost' }, c[2]]))).toContain('MISSING_PARENT');
    expect(codes(raw([c[0], { ...c[1], parentId: 'arm' }, c[2]]))).toContain('SELF_PARENT');
    expect(codes(raw([c[0], c[1], { ...c[2], id: 'arm' }]))).toContain('DUPLICATE_ID');
    expect(codes(raw([...c], [{ id: 'r1', fromId: 'arm', toId: 'base', kind: 'contains', origin: 'inferred', evidence: 'x' }]))).toContain('RELATION_CONTRADICTS_HIERARCHY');
    expect(codes(raw([...c], [{ id: 'r1', fromId: 'arm', toId: 'tool', kind: 'contains', origin: 'inferred', evidence: 'x' }, { id: 'r2', fromId: 'tool', toId: 'arm', kind: 'contains', origin: 'inferred', evidence: 'x' }]))).toContain('RELATION_MUTUAL_CONTAINMENT');
    expect(codes(raw([...c], [{ id: 'r1', fromId: 'arm', toId: 'ghost', kind: 'attached_to', origin: 'inferred', evidence: 'x' }]))).toContain('RELATION_UNKNOWN_COMPONENT');
    expect(validateHierarchy(raw([{ ...c[0], parentId: 'tool' }, c[1], c[2]])).order).toEqual([]);
  });
});

describe('relation status', () => {
  const parts = (plan: SpatialPlanV2) => [...worldOf(plan).tris].map(([id, tris]) => ({ id, tris }));
  const two = (relations: object[], gap = 0) => mk([comp('a', null, T([0, 0.5, 0]), box('a-s', [1, 1, 1])), comp('b', null, T([1 + gap, 0.5, 0]), box('b-s', [1, 1, 1]))], relations);
  const rel = (origin: string) => [{ id: 'ab', fromId: 'b', toId: 'a', kind: 'attached_to', origin, evidence: 'x' }];
  it('separates declared+supported, declared+contradicted, detected-only and human-confirmed', () => {
    const find = (plan: SpatialPlanV2, confirmed?: Set<string>) => classifyRelations(plan, parts(plan), { span: 3, ...(confirmed ? { confirmed } : {}) });
    expect(find(two(rel('inferred')))[0]).toMatchObject({ status: 'declared_supported', enforced: true });
    expect(find(two(rel('inferred'), 1.5))[0]).toMatchObject({ status: 'declared_contradicted', enforced: false });
    expect(find(two([]))[0]).toMatchObject({ status: 'detected_hypothesis', enforced: false });
    expect(find(two([]), new Set(['hyp-a-b']))[0]).toMatchObject({ status: 'human_confirmed', enforced: true });
    expect(find(two(rel('user_provided')))[0]).toMatchObject({ status: 'human_confirmed', enforced: true });
  });
  it('a detected contact is never promoted by itself, and two far parts are never related', () => {
    expect(classifyRelations(two([]), parts(two([])), { span: 3 }).every((f) => !f.enforced)).toBe(true);
    expect(classifyRelations(two([], 5), parts(two([], 5)), { span: 8 })).toEqual([]);
  });
});

describe('structural reconstruction engine', () => {
  const unchanged = (plan: SpatialPlanV2, copy: string) => expect(JSON.stringify(plan)).toBe(copy);
  it('refuses, with a reason and the plan untouched, when fitting is not justified', () => {
    const truth = chain(), good = evidenceFor(truth, six()), input = chain(1.4), copy = JSON.stringify(input);
    const code = (o: ReturnType<typeof reconstructStructure>) => o.refusals.map((r) => r.code);
    expect(code(reconstructStructure(input, []))).toEqual(['NO_VIEWS']);
    expect(code(reconstructStructure(input, evidenceFor(truth, six(), false)))).toEqual(['VIEWS_NOT_CALIBRATED']);
    expect(code(reconstructStructure(input, good.slice(0, 2)))).toEqual(['TOO_FEW_INDEPENDENT_VIEWS']);
    const near = [new Vector3(0, 0, 1), new Vector3(0.05, 0, 1), new Vector3(0, 0.05, 1)]; expect(code(reconstructStructure(input, evidenceFor(truth, near)))).toEqual(['VIEWS_NOT_DISTINCT']);
    const flat = [new Vector3(1, 0, 0), new Vector3(0, 0, 1), new Vector3(1, 0, 1)]; expect(code(reconstructStructure(input, evidenceFor(truth, flat)))).toEqual(['VIEWS_NOT_DISTINCT']);
    expect(code(reconstructStructure(input, good, { limits: { maxEvaluations: 5 } }))).toEqual(['COST_EXCEEDED']);
    expect(code(reconstructStructure(chain(), good))).toEqual(['NO_IMPROVEMENT']); // a plan that already matches is left alone
    const cyc = { ...input, components: input.components.map((c, i) => (i === 0 ? { ...c, parentId: 'tool' } : c)) } as unknown as SpatialPlanV2; expect(code(reconstructStructure(cyc, good))).toEqual(['HIERARCHY_INVALID']);
    for (const o of [reconstructStructure(input, []), reconstructStructure(input, good.slice(0, 2))]) { expect(o.proposal).toBeNull(); expect(o.status).toBe('refused'); }
    unchanged(input, copy);
  });

  it('does not fit two unrelated parts that only touch: the contact is a hypothesis for review, not a constraint', () => {
    const truth = mk([comp('a', null, T([0, 0.5, 0]), box('a-s', [1, 1, 1])), comp('b', null, T([1, 0.5, 0]), box('b-s', [1, 1, 1]))]), out = reconstructStructure(truth, evidenceFor(truth, six()));
    expect(out.refusals.map((r) => r.code)).toEqual(['NO_STRUCTURAL_SUPPORT']); expect(out.hypotheses.map((h) => h.id)).toEqual(['hyp-a-b']);
  });

  it('refuses a plan whose declared relations disagree with its own geometry, unless a person overrides', () => {
    const bad = mk([comp('a', null, T([0, 0.5, 0]), box('a-s', [1, 1, 1])), comp('b', 'a', T([3, 0, 0]), box('b-s', [1, 1, 1]))], [{ id: 'ab', fromId: 'b', toId: 'a', kind: 'attached_to', origin: 'inferred', evidence: 'x' }]);
    const out = reconstructStructure(bad, evidenceFor(bad, six())); expect(out.refusals[0]!.code).toBe('CONTRADICTORY_RELATIONS'); expect(out.relationSummary.declared_contradicted).toBe(1);
    expect(reconstructStructure(bad, evidenceFor(bad, six()), { allowContradicted: true }).refusals.map((r) => r.code)).not.toContain('CONTRADICTORY_RELATIONS');
  });

  it('proposes local-frame corrections for a three-level hierarchy, without duplicating a parent transform into its children', () => {
    const truth = chain(), input = chain(1.35), copy = JSON.stringify(input), out = reconstructStructure(input, evidenceFor(truth, six()), { limits: { minImprovement: 0.005 } });
    expect(out.status, JSON.stringify(out.refusals)).toBe('proposal'); const p = out.proposal!;
    expect(p.fitIouAfter).toBeGreaterThan(p.fitIouBefore); unchanged(input, copy); // the engine never edits the plan
    expect(out.checks.worldConsistencyAfterMax!).toBeLessThan(1e-5); expect(out.checks.idsPreserved && out.checks.sourcePreserved && out.checks.hierarchyPreserved).toBe(true); expect(out.checks.jointResidualMax!).toBeLessThan(0.005);
    // apply through the real contract: provenance, hierarchy and the resulting WORLD placement of the deepest part
    let next = input; for (const op of p.operations) next = applySpatialOperationV2(next, op, { origin: 'inferred', evidence: p.evidence });
    expect(next.components.map((c) => c.parentId)).toEqual(['base' === next.components[0]!.id ? null : null, 'base', 'arm']);
    expect(next.components.filter((c) => p.changed.includes(c.id)).every((c) => c.provenance.transform === 'inferred')).toBe(true);
    const err = (plan: SpatialPlanV2) => worldOf(plan).worlds.get('tool')!.elements.reduce((m, v, i) => Math.max(m, Math.abs(v - worldOf(truth).worlds.get('tool')!.elements[i]!)), 0);
    expect(err(next)).toBeLessThan(err(input)); // the tool, a grandchild, ends up closer to where it really is
    const local = (plan: SpatialPlanV2, id: string) => plan.components.find((c) => c.id === id)!.transform;
    expect(Math.abs(local(next, 'arm').scale[0]! - local(truth, 'arm').scale[0]!)).toBeLessThan(Math.abs(local(input, 'arm').scale[0]! - local(truth, 'arm').scale[0]!)); // the correction is on the part that is wrong, in its own frame
  });

  it('a contact hypothesis becomes a joint only when a person confirms it; then the joint is kept exactly (parentless parts)', () => {
    const plan = (k: number) => mk([comp('base', null, T([0, 0.5, 0]), box('base-s', [3, 1, 2])), comp('column', null, T([0, 1 + 0.75 * k, 0]), box('column-s', [0.5 * k, 1.5 * k, 0.5 * k]))]);
    const truth = plan(1.6), input = plan(1), ev = evidenceFor(truth, six()), copy = JSON.stringify(input);
    const open = reconstructStructure(input, ev); expect(open.refusals[0]!.code).toBe('NO_STRUCTURAL_SUPPORT'); expect(open.hypotheses.map((h) => h.id)).toEqual(['hyp-base-column']); expect(open.relationSummary.human_confirmed).toBe(0);
    const confirmed = reconstructStructure(input, ev, { confirmed: new Set(['hyp-base-column']), limits: { minImprovement: 0.005 } });
    expect(confirmed.status, JSON.stringify(confirmed.refusals)).toBe('proposal'); expect(confirmed.relationSummary.human_confirmed).toBe(1); expect(confirmed.checks.jointResidualMax!).toBeLessThan(1e-6); expect(confirmed.checks.worldConsistencyAfterMax!).toBeLessThan(1e-5);
    expect(JSON.stringify(input)).toBe(copy);
  });
});
