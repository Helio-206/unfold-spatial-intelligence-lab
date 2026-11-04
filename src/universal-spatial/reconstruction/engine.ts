import { Box3, Matrix4, Mesh, Vector3, type Object3D } from 'three';
import { applySpatialOperationV2, type SpatialOperationV2, type SpatialPlanV2 } from '../contracts-v2';
import { compileSpatialPlanV2, disposeCompiledSpatialPlan } from '../geometry-compiler-v2';
import { fitHierarchical, type HPart, type HResult, type Unresolved } from './hierarchical-fit';
import { validateHierarchy, type HierarchyIssue } from './hierarchy';
import { classifyRelations, enforced, summary, type RelationFinding } from './relations';
import { makeView, maskIoU, rasterise, type Tri, type View } from './silhouette';
import { findUnexplained, type UnexplainedReport } from './unexplained';

/**
 * Structural Reconstruction engine (hierarchical). It PROPOSES; it never modifies the plan it is given and never touches a Space.
 * Before anything is fitted it decides whether fitting is justified, and when it is not it says why and returns the plan as it is.
 *
 *   input   a plan, evidence views (calibrated silhouettes), limits, and the relation hypotheses a person confirmed
 *   output  `proposal`: typed set-transform operations in each part's LOCAL frame + evidence text, or `refused` with reasons; always the relation findings,
 *           the hypotheses for review and the parts it could not resolve
 */
export type EvidenceView = { view: View; mask: Uint8Array; /** pose and intrinsics are known and usable (rendered views: yes; a photograph: only if calibrated) */ calibrated: boolean; source: 'rendered' | 'photo'; label?: string };
export type Limits = { minIndependentViews: number; minSeparationDeg: number; maxComponents: number; maxEvaluations: number; maxMs: number; minImprovement: number; maxJointResidual: number };
export const DEFAULT_LIMITS: Limits = { minIndependentViews: 3, minSeparationDeg: 20, maxComponents: 48, maxEvaluations: 40_000, maxMs: 60_000, minImprovement: 0.01, maxJointResidual: 0.005 };
export type RefusalCode = 'HIERARCHY_INVALID' | 'TRANSFORM_INCONSISTENT' | 'NO_VIEWS' | 'VIEWS_NOT_CALIBRATED' | 'TOO_FEW_INDEPENDENT_VIEWS' | 'VIEWS_NOT_DISTINCT' | 'VIEW_MISMATCH' | 'EMPTY_EVIDENCE' | 'TOO_MANY_COMPONENTS' | 'NO_STRUCTURAL_SUPPORT' | 'CONTRADICTORY_RELATIONS' | 'CONTRADICTORY_CONSTRAINTS' | 'NO_IMPROVEMENT' | 'NO_GENERALISATION' | 'COST_EXCEEDED' | 'RESULT_INVALID';
export type Refusal = { code: RefusalCode; detail: string };
export type EngineOptions = { /** rotation corrections in the local frame (default on); `false` reproduces the translation-and-scale-only engine of Phase C */ rotation?: boolean; limits?: Partial<Limits>; /** ids of hypotheses (`hyp-a-b`) or relations (`rel-...`) a person confirmed in review */ confirmed?: ReadonlySet<string>; /** explicit human override: declared relations that the geometry contradicts do not block the fit (they are still never enforced) */ allowContradicted?: boolean; now?: () => number };
export type Proposal = { operations: SpatialOperationV2[]; changed: string[]; evidence: string; fitIouBefore: number; fitIouAfter: number; heldOut: { before: number; after: number } | null };
export type Outcome = {
  status: 'proposal' | 'refused'; refusals: Refusal[]; proposal: Proposal | null;
  hierarchyIssues: HierarchyIssue[]; relations: RelationFinding[]; relationSummary: ReturnType<typeof summary>; hypotheses: RelationFinding[]; unresolved: Unresolved[]; /** what the evidence shows and the plan does not draw (after the fit when there is a proposal); candidates are flags, never components */ unexplained: UnexplainedReport | null;
  checks: { transformConsistencyMax: number | null; worldConsistencyAfterMax: number | null; idsPreserved: boolean | null; sourcePreserved: boolean | null; hierarchyPreserved: boolean | null; jointResidualMax: number | null };
  metrics: { components: number; independentViews: number; ms: number; evaluations: number; aborted: string | null };
};

const empty = (): Outcome['checks'] => ({ transformConsistencyMax: null, worldConsistencyAfterMax: null, idsPreserved: null, sourcePreserved: null, hierarchyPreserved: null, jointResidualMax: null });
const worldTris = (root: Object3D) => { root.updateMatrixWorld(true); const map = new Map<string, Tri[]>(), worlds = new Map<string, Matrix4>(); root.traverse((o) => { if (o.userData.spatialComponentRoot) worlds.set(o.userData.spatialEntityId as string, o.matrixWorld.clone()); if (!(o instanceof Mesh) || typeof o.userData.spatialEntityId !== 'string') return; const id = o.userData.spatialEntityId as string, pos = o.geometry.getAttribute('position'), idx = o.geometry.index, n = idx ? idx.count : pos.count, l = map.get(id) ?? []; const v = (i: number) => new Vector3().fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld); for (let i = 0; i + 2 < n; i += 3) l.push([v(i), v(i + 1), v(i + 2)]); map.set(id, l); }); return { map, worlds }; };
const matrixDiff = (a: Matrix4, b: Matrix4) => a.elements.reduce((m, v, i) => Math.max(m, Math.abs(v - b.elements[i]!)), 0);

/** Views that are calibrated, share one resolution and point in genuinely different directions (greedy, by angle). */
export function independentViews(evidence: EvidenceView[], minSeparationDeg: number): EvidenceView[] {
  const picked: EvidenceView[] = [], cos = Math.cos((minSeparationDeg * Math.PI) / 180);
  for (const e of evidence) if (e.calibrated && picked.every((p) => p.view.direction.dot(e.view.direction) < cos)) picked.push(e);
  return picked;
}
const spread = (views: EvidenceView[]) => { // three directions that are almost coplanar leave depth unconstrained along the normal of that plane
  if (views.length < 3) return 0; let best = 0; for (let i = 0; i < views.length; i++) for (let j = i + 1; j < views.length; j++) for (let k = j + 1; k < views.length; k++) best = Math.max(best, Math.abs(new Vector3().crossVectors(views[i]!.view.direction, views[j]!.view.direction).dot(views[k]!.view.direction))); return best;
};

/** Parts (local and world frames, world-space triangles) and span of a valid plan, as the engine reads it. Returns null when the hierarchy is invalid. */
export function readParts(plan: SpatialPlanV2): { parts: HPart[]; span: number } | null {
  const hierarchy = validateHierarchy(plan); if (!hierarchy.ok) return null;
  const compiled = compileSpatialPlanV2(plan), { map: tris } = worldTris(compiled.root); disposeCompiledSpatialPlan(compiled.root);
  const box = new Box3(); for (const t of tris.values()) for (const x of t) for (const p of x) box.expandByPoint(p);
  const parts = hierarchy.order.map((id) => { const f = hierarchy.frames.get(id)!, tt = tris.get(id) ?? [], b = new Box3(); for (const t of tt) for (const p of t) b.expandByPoint(p); return { id, parentId: f.parentId, position: f.position, rotation: f.rotation, scale: f.scale, local: f.local, world: f.world, tris: tt, pivot: b.isEmpty() ? new Vector3() : b.getCenter(new Vector3()) }; });
  return { parts, span: Math.max(...box.getSize(new Vector3()).toArray(), 1e-9) };
}

export function reconstructStructure(plan: SpatialPlanV2, evidence: EvidenceView[], options: EngineOptions = {}): Outcome {
  const limits: Limits = { ...DEFAULT_LIMITS, ...options.limits }, now = options.now ?? (() => performance.now()), t0 = now();
  const refused = (refusals: Refusal[], partial: Partial<Outcome> = {}): Outcome => ({ status: 'refused', refusals, proposal: null, hierarchyIssues: [], relations: [], relationSummary: summary([]), hypotheses: [], unresolved: [], unexplained: null, checks: empty(), metrics: { components: plan.components.length, independentViews: 0, ms: now() - t0, evaluations: 0, aborted: null }, ...partial });

  // ---- eligibility that needs no geometry
  const hierarchy = validateHierarchy(plan);
  if (!hierarchy.ok) return refused([{ code: 'HIERARCHY_INVALID', detail: hierarchy.issues.map((i) => `${i.code}: ${i.detail}`).join(' | ') }], { hierarchyIssues: hierarchy.issues });
  if (plan.components.length > limits.maxComponents) return refused([{ code: 'TOO_MANY_COMPONENTS', detail: `${plan.components.length} components, limit ${limits.maxComponents}` }]);
  if (!evidence.length) return refused([{ code: 'NO_VIEWS', detail: 'no evidence views were given' }]);
  const calibrated = evidence.filter((e) => e.calibrated);
  if (!calibrated.length) return refused([{ code: 'VIEWS_NOT_CALIBRATED', detail: `${evidence.length} view(s), none with usable pose and intrinsics` }]);
  const res = calibrated[0]!.view.res; if (calibrated.some((e) => e.view.res !== res || e.mask.length !== res * res)) return refused([{ code: 'VIEW_MISMATCH', detail: 'views and masks do not share one resolution' }]);
  if (calibrated.some((e) => e.mask.reduce((s, v) => s + v, 0) === 0)) return refused([{ code: 'EMPTY_EVIDENCE', detail: 'a view has an empty silhouette' }]);
  const views = independentViews(calibrated, limits.minSeparationDeg);
  if (views.length < limits.minIndependentViews) return refused([{ code: calibrated.length >= limits.minIndependentViews ? 'VIEWS_NOT_DISTINCT' : 'TOO_FEW_INDEPENDENT_VIEWS', detail: `${views.length} independent view(s) (separated by at least ${limits.minSeparationDeg} degrees) out of ${calibrated.length} calibrated, ${limits.minIndependentViews} needed` }], { metrics: { components: plan.components.length, independentViews: views.length, ms: now() - t0, evaluations: 0, aborted: null } });
  if (spread(views) < 0.15) return refused([{ code: 'VIEWS_NOT_DISTINCT', detail: 'the views are nearly coplanar: depth along the normal of their plane is unconstrained' }], { metrics: { components: plan.components.length, independentViews: views.length, ms: now() - t0, evaluations: 0, aborted: null } });

  // ---- geometry as given
  const compiled = compileSpatialPlanV2(plan), { map: tris, worlds } = worldTris(compiled.root); disposeCompiledSpatialPlan(compiled.root);
  let consistency = 0; for (const id of hierarchy.order) consistency = Math.max(consistency, matrixDiff(hierarchy.frames.get(id)!.world, worlds.get(id)!));
  const checks = empty(); checks.transformConsistencyMax = consistency;
  if (consistency > 1e-5) return refused([{ code: 'TRANSFORM_INCONSISTENT', detail: `world matrices composed from the local transforms differ from the compiled scene by ${consistency.toExponential(2)}` }], { checks });
  const box = new Box3(); for (const t of tris.values()) for (const x of t) for (const p of x) box.expandByPoint(p); const span = Math.max(...box.getSize(new Vector3()).toArray(), 1e-9);
  const parts: HPart[] = hierarchy.order.map((id) => { const f = hierarchy.frames.get(id)!, tt = tris.get(id) ?? [], b = new Box3(); for (const t of tt) for (const p of t) b.expandByPoint(p); return { id, parentId: f.parentId, position: f.position, rotation: f.rotation, scale: f.scale, local: f.local, world: f.world, tris: tt, pivot: b.isEmpty() ? new Vector3() : b.getCenter(new Vector3()) }; });
  const relations = classifyRelations(plan, parts.map((p) => ({ id: p.id, tris: p.tris })), { span, ...(options.confirmed ? { confirmed: options.confirmed } : {}) });
  const relationSummary = summary(relations), hypotheses = relations.filter((r) => r.status === 'detected_hypothesis'), enf = enforced(relations);
  const unexplainedAsGiven = findUnexplained(views, parts.map((p) => ({ id: p.id, tris: p.tris })));
  const base = { unexplained: unexplainedAsGiven as UnexplainedReport | null, hierarchyIssues: hierarchy.issues, relations, relationSummary, hypotheses, checks, metrics: { components: plan.components.length, independentViews: views.length, ms: 0, evaluations: 0, aborted: null as string | null } };
  const edges = plan.components.filter((c) => c.parentId !== null).length;
  if (plan.components.length > 1 && edges === 0 && enf.length === 0) return refused([{ code: 'NO_STRUCTURAL_SUPPORT', detail: `no parent link and no enforced relation between ${plan.components.length} parts (${hypotheses.length} contact hypothesis(es) await review): nothing says how they hold together, so fitting would move them freely` }], base);
  const contradicted = relations.filter((r) => r.status === 'declared_contradicted');
  if (contradicted.length && !options.allowContradicted) return refused([{ code: 'CONTRADICTORY_RELATIONS', detail: `${contradicted.length} declared relation(s) disagree with the plan's own geometry: ${contradicted.map((r) => `${r.a}~${r.b}`).slice(0, 6).join(', ')}${contradicted.length > 6 ? ', ...' : ''}. They need the assembly solver or a person before structure can be trusted.` }], base);

  // ---- fit
  const fitViews = views.map((e) => e.view), targets = views.map((e) => e.mask), hold = views.length >= 4 ? Math.max(1, Math.floor(views.length / 4)) : 0, maxShift = 0.3 * span;
  const common = { span, maxShift, maxEvaluations: limits.maxEvaluations, maxMs: limits.maxMs, now, ...(options.rotation === false ? { rotation: false as const } : {}) };
  let heldOut: Proposal['heldOut'] = null;
  if (hold) { // does the result generalise? fit without some views and look at them
    const keep = views.length - hold, partial = fitHierarchical(parts, enf, fitViews.slice(0, keep), targets.slice(0, keep), common), held = (matrices: Map<string, Matrix4> | null) => fitViews.slice(keep).reduce((s, v, i) => { const t = parts.flatMap((p) => { const m = matrices ? matrices.get(p.id)!.clone().multiply(p.world.clone().invert()) : null; return m ? p.tris.map((x) => x.map((q) => q.clone().applyMatrix4(m)) as Tri) : p.tris; }); return s + maskIoU(rasterise(t, v), targets[keep + i]!); }, 0) / hold;
    heldOut = { before: held(null), after: held(partial.worlds) };
    if (partial.aborted) return refused([{ code: 'COST_EXCEEDED', detail: `cross-check stopped (${partial.aborted})` }], { ...base, metrics: { ...base.metrics, ms: now() - t0, evaluations: partial.evaluations, aborted: partial.aborted } });
    if (heldOut.after < heldOut.before - 1e-6) return refused([{ code: 'NO_GENERALISATION', detail: `fitted on ${keep} view(s), the ${hold} view(s) left out got worse (IoU ${heldOut.before.toFixed(3)} -> ${heldOut.after.toFixed(3)})` }], { ...base, metrics: { ...base.metrics, ms: now() - t0, evaluations: partial.evaluations, aborted: null } });
  }
  const fit: HResult = fitHierarchical(parts, enf, fitViews, targets, common);
  const metrics = { ...base.metrics, ms: now() - t0, evaluations: fit.evaluations, aborted: fit.aborted };
  if (fit.aborted) return refused([{ code: 'COST_EXCEEDED', detail: `fit stopped (${fit.aborted}) after ${fit.evaluations} evaluations` }], { ...base, unresolved: fit.unresolved, metrics });
  const jointMax = Math.max(0, ...fit.residuals.map((r) => r.after)); checks.jointResidualMax = jointMax;
  if (jointMax > limits.maxJointResidual) return refused([{ code: 'CONTRADICTORY_CONSTRAINTS', detail: `enforced joints could not all be kept (largest residual ${(100 * jointMax).toFixed(2)} % of the span, limit ${(100 * limits.maxJointResidual).toFixed(2)} %)` }], { ...base, unresolved: fit.unresolved, metrics });
  if (fit.iouAfter < fit.iouBefore + limits.minImprovement || !fit.changed.length) return refused([{ code: 'NO_IMPROVEMENT', detail: `silhouette agreement on the given views ${fit.iouBefore.toFixed(3)} -> ${fit.iouAfter.toFixed(3)} (needs at least +${limits.minImprovement}); the plan is left as it is` }], { ...base, unresolved: fit.unresolved, metrics });

  // ---- typed operations, in LOCAL frames, applied to a COPY to prove they are valid before anything is offered
  const evidenceText = `Hierarchical structural solver fitted to ${views.length} independent calibrated silhouette view(s) (${[...new Set(views.map((v) => v.source))].join(', ')}); fit IoU ${fit.iouBefore.toFixed(3)} -> ${fit.iouAfter.toFixed(3)}${heldOut ? `, left-out views ${heldOut.before.toFixed(3)} -> ${heldOut.after.toFixed(3)}` : ''}. ${enf.length} enforced relation(s), ${hypotheses.length} unconfirmed contact hypothesis(es) not enforced. Basis: inferred.`;
  const operations: SpatialOperationV2[] = fit.changed.map((id) => { const c = plan.components.find((k) => k.id === id)!, l = fit.local.get(id)!, r = (n: number) => Math.round(n * 1e6) / 1e6; return { contract: 'unfold.spatial-operation.v2', operationId: `v4h-${id}`.slice(0, 80), kind: 'set-transform', componentId: id, nodeKey: null, value: { ...c.transform, position: l.position.toArray().map(r) as [number, number, number], rotationRad: l.rotationRad.toArray().map(r) as [number, number, number], scale: l.scale.toArray().map(r) as [number, number, number] } } as SpatialOperationV2; });
  let next = plan; try { for (const op of operations) next = applySpatialOperationV2(next, op, { origin: 'inferred', evidence: evidenceText }); } catch (error) { return refused([{ code: 'RESULT_INVALID', detail: error instanceof Error ? error.message : 'the operations do not apply' }], { ...base, unresolved: fit.unresolved, metrics }); }
  const after = validateHierarchy(next), nextCompiled = compileSpatialPlanV2(next), nw = worldTris(nextCompiled.root).worlds; disposeCompiledSpatialPlan(nextCompiled.root);
  let worldDiff = 0; for (const p of parts) worldDiff = Math.max(worldDiff, matrixDiff(fit.worlds.get(p.id)!, nw.get(p.id)!));
  checks.worldConsistencyAfterMax = worldDiff; checks.idsPreserved = JSON.stringify(next.components.map((c) => c.id)) === JSON.stringify(plan.components.map((c) => c.id)); checks.sourcePreserved = JSON.stringify(next.source) === JSON.stringify(plan.source);
  checks.hierarchyPreserved = after.ok && next.components.every((c, i) => c.parentId === plan.components[i]!.parentId);
  if (!after.ok || worldDiff > 1e-5 || !checks.idsPreserved || !checks.sourcePreserved || !checks.hierarchyPreserved) return refused([{ code: 'RESULT_INVALID', detail: `the proposed operations would not reproduce the fitted placement (hierarchy ok ${after.ok}, world mismatch ${worldDiff.toExponential(2)}, ids ${checks.idsPreserved}, source ${checks.sourcePreserved}, parents ${checks.hierarchyPreserved})` }], { ...base, unresolved: fit.unresolved, checks, metrics });
  const fitted = findUnexplained(views, parts.map((p) => { const m = fit.worlds.get(p.id)!.clone().multiply(p.world.clone().invert()); return { id: p.id, tris: p.tris.map((t) => t.map((q) => q.clone().applyMatrix4(m)) as Tri) }; }));
  return { status: 'proposal', refusals: [], proposal: { operations, changed: fit.changed, evidence: evidenceText, fitIouBefore: fit.iouBefore, fitIouAfter: fit.iouAfter, heldOut }, ...base, unexplained: fitted, unresolved: fit.unresolved, checks, metrics };
}

export { makeView };
