import { Box3, Group, InstancedMesh, Matrix4, Mesh, Vector3, type BufferGeometry, type Object3D } from 'three';
import type { SpatialPlanV2 } from '../contracts-v2';
import { compileSpatialPlanV2, type CompiledSpatialPlanV2 } from '../geometry-compiler-v2';
import { assembleContinuous, disposeObject } from './continuous-surface';
import { jobKey, runContinuousJob, type ContinuousJob } from './continuous-job';
import type { ContinuousService } from './continuous-service';
import { markShared, type AssetOffer } from './assets';
import { implicitShapesOf, type ImplicitShape } from './sdf';
import { DEFAULT_ROUTER_LIMITS, type AssetApproval, type GeometryFamily, type RouterLimits, type RouterReport, type RoutingDecision } from './types';

/**
 * Adaptive Geometry Router (prototype). `compileWithRouter(plan, options)` returns what `compileSpatialPlanV2(plan)` returns plus a report. It starts from the
 * V2 compile (so groups, hierarchy, userData and every failure mode are exactly V2's), then replaces, component by component, the V2 meshes with another
 * family's drawing where a rule or a request says so AND the result is within limits. Anything else stays V2. The plan is read, never written.
 * Contract and rules: `./CONTRACT.md`.
 */
export type { AssetOffer } from './assets';
export type RouterOptions = {
  limits?: Partial<RouterLimits>;
  /** `auto`: continuous surface where it helps (curved primitives or parts that join others); `v2_only`: never leave V2; `continuous_all`: every eligible component. */
  policy?: 'auto' | 'v2_only' | 'continuous_all';
  /** per component, what the host asks for; honoured only if possible, otherwise V2 with the reason recorded */
  requests?: Record<string, GeometryFamily>;
  /** meshes on offer. They draw nothing unless approved. */
  assets?: AssetOffer[];
  approvals?: AssetApproval[];
  /** Off-main-thread computation with a cache. Without it the continuous surfaces are computed inline, synchronously. With it a cache miss draws V2 now and `service.onReady` tells the host to rebuild. */
  service?: ContinuousService;
};
/**
 * `upgrade()` is the only thing that happens after `compileWithRouter` returns. It looks in the service's cache for the components that were drawn by V2
 * while they were computed off the main thread, and swaps ONLY their meshes inside the component groups that already exist: same groups, same ids, same
 * transforms, same hierarchy, nothing recreated. It returns the ids whose meshes changed. A result can only be used by the compile that asked for it
 * (the key is a hash of that component's geometry and of its partners' placement), and `retire()` ends that right: after it, `upgrade()` does nothing.
 */
export type RoutedPlan = CompiledSpatialPlanV2 & { report: RouterReport; /** `budgetTriangles`: stop after the component that reaches it (at least one is always swapped), so the GPU upload of a big arrival can be spread over frames */ upgrade(budgetTriangles?: number): string[]; /** results already in the cache that `upgrade` has not swapped yet */ readyCount(): number; retire(): void };
export const upgradeOnReady = (service: ContinuousService, layer: { upgradeGeometry(): unknown }): (() => void) => service.onReady(() => { layer.upgradeGeometry(); });

const CURVED = new Set(['sphere', 'ellipsoid', 'cylinder', 'cone', 'torus', 'tube']);
type Pending = { componentId: string; group: Object3D; old: Object3D; next: Object3D; family: GeometryFamily; triangles: number; bytes: number; meshes: number; oldTriangles: number; oldBytes: number; oldMeshes: number; ms: number; decision: RoutingDecision };

function measure(object: Object3D): { triangles: number; meshes: number; bytes: number } {
  const geometries = new Set<BufferGeometry>(); let triangles = 0, meshes = 0;
  object.traverse((o) => { if (!(o instanceof Mesh)) return; meshes++; geometries.add(o.geometry); const g = o.geometry, tri = (g.index ? g.index.count : g.getAttribute('position').count) / 3; triangles += tri * (o instanceof InstancedMesh ? o.count : 1); });
  let bytes = 0; for (const g of geometries) { for (const a of Object.values(g.attributes)) bytes += (a as { array: ArrayLike<number> & { byteLength: number } }).array.byteLength; if (g.index) bytes += g.index.array.byteLength; }
  return { triangles, meshes, bytes };
}

export function compileWithRouter(plan: SpatialPlanV2, options: RouterOptions = {}): RoutedPlan {
  const started = performance.now(), limits: RouterLimits = { ...DEFAULT_ROUTER_LIMITS, ...options.limits }, policy = options.policy ?? 'auto';
  const compiled = compileSpatialPlanV2(plan), root = compiled.root; root.updateMatrixWorld(true);
  const groups = new Map<string, Object3D>(); root.traverse((o) => { if (o.userData.spatialComponentRoot) groups.set(o.userData.spatialEntityId as string, o); });
  const byId = new Map(plan.components.map((c) => [c.id, c])), decisions = new Map<string, RoutingDecision>(), pending: Pending[] = [];
  const base = (id: string, requested: GeometryFamily | null): RoutingDecision => ({ componentId: id, requested, used: 'procedural_v2', reason: 'Default: the V2 compiler.', fallback: null, planGeometryOrigin: byId.get(id)!.provenance.geometry, representation: 'derived_from_plan', assetId: null, triangles: 0 });
  for (const c of plan.components) decisions.set(c.id, base(c.id, options.requests?.[c.id] ?? null));
  const v2Triangles = (id: string) => { const g = groups.get(id)!; return measure(g.children[0]!).triangles; };
  for (const c of plan.components) decisions.get(c.id)!.triangles = v2Triangles(c.id);

  // ---- world bounds and implicit shapes per component (only components whose every shape has a field can take part in blending)
  const shapes = new Map<string, ImplicitShape[]>(), worldBox = new Map<string, Box3>();
  for (const c of plan.components) {
    const found = implicitShapesOf(c.geometry); const g = groups.get(c.id)!;
    if (!('code' in found) && found.length) { shapes.set(c.id, found); const b = new Box3(); for (const s of found) b.union(s.box); worldBox.set(c.id, b.applyMatrix4(g.matrixWorld)); }
  }
  const whole = new Box3(); for (const b of worldBox.values()) whole.union(b); const span = Math.max(...whole.getSize(new Vector3()).toArray(), 1e-12);

  // ---- continuous surface
  const neededKeys = new Set<string>(), pendingIds: string[] = [], waiting: Array<{ componentId: string; group: Object3D; job: ContinuousJob; decision: RoutingDecision; curved: boolean; ms: number }> = [];
  if (policy !== 'v2_only') for (const c of plan.components) {
    const decision = decisions.get(c.id)!, requested = options.requests?.[c.id] ?? null;
    if (requested === 'procedural_v2' || requested === 'mesh_asset') { if (requested === 'procedural_v2') decision.reason = 'Requested: V2.'; continue; }
    const own = implicitShapesOf(c.geometry);
    if ('code' in own) { decision.reason = `Stays on V2: operator without a distance field (${own.detail}).`; if (requested === 'continuous_surface') decision.fallback = { from: 'continuous_surface', code: own.code }; continue; }
    const myBox = worldBox.get(c.id)!, tolerance = span * 0.03;
    const neighbours = plan.components.filter((o) => o.id !== c.id && shapes.has(o.id) && (o.id === c.parentId || o.parentId === c.id || myBox.clone().expandByScalar(tolerance).intersectsBox(worldBox.get(o.id)!)))
      .sort((a, b) => worldBox.get(a.id)!.distanceToPoint(myBox.getCenter(new Vector3())) - worldBox.get(b.id)!.distanceToPoint(myBox.getCenter(new Vector3()))).slice(0, 4);
    const curved = own.some((s) => CURVED.has(s.operator));
    if (policy === 'auto' && requested !== 'continuous_surface' && !curved && !neighbours.length) { decision.reason = 'Stays on V2: flat parts with nothing to blend into, so the surface would be the same.'; continue; }
    const inverseSelf = groups.get(c.id)!.matrixWorld.clone().invert();
    const base = { entityId: c.id, geometry: c.geometry, neighbours: neighbours.map((o) => ({ id: o.id, geometry: o.geometry, toLocal: new Matrix4().multiplyMatrices(inverseSelf, groups.get(o.id)!.matrixWorld).elements.slice() })), maxTriangles: limits.maxTriangles, maxGridCells: limits.maxGridCells };
    const job: ContinuousJob = { ...base, key: jobKey(base) }; neededKeys.add(job.key);
    const t0 = performance.now();
    let result = options.service ? options.service.get(job.key) : undefined, origin: 'cache' | 'computed' = 'cache';
    if (!result && !options.service) { try { result = runContinuousJob(job); } catch { result = { ok: false, code: 'EXCEPTION' }; } origin = 'computed'; }
    if (!result) { // worker path, miss: V2 now, the host rebuilds when the service says ready
      const state = options.service!.request(job);
      if (state === 'rejected') { decision.reason = 'Stays on V2: the computation queue is full.'; decision.fallback = { from: 'continuous_surface', code: 'QUEUE_FULL' }; }
      else { decision.reason = 'Stays on V2 for now: continuous surface is being computed off the main thread.'; decision.pending = true; pendingIds.push(c.id); waiting.push({ componentId: c.id, group: groups.get(c.id)!, job, decision, curved, ms: 0 }); }
      continue;
    }
    if (!result.ok) { decision.reason = `Stays on V2: ${result.code.toLowerCase().replace(/_/g, ' ')}.`; decision.fallback = { from: 'continuous_surface', code: result.code }; continue; }
    const curvedNote = curved, g = groups.get(c.id)!, old = g.children[0]!, oldM = measure(old), next = assembleContinuous(result, c.id, c.geometry.key);
    decision.used = 'continuous_surface'; decision.triangles = result.triangles; decision.deviation = result.deviation; decision.blendedWith = result.blendedWith; decision.computed = origin;
    decision.reason = `Continuous surface: ${[...(curvedNote ? ['curved primitives'] : []), ...(result.blendedWith.length ? [`joins to ${result.blendedWith.join(', ')} (blend ${result.blendRadius.toFixed(3)})`] : [])].join('; ') || 'smooth surface'}.`;
    pending.push({ componentId: c.id, group: g, old, next, family: 'continuous_surface', triangles: result.triangles, bytes: result.bytes, meshes: next.children.length, oldTriangles: oldM.triangles, oldBytes: oldM.bytes, oldMeshes: oldM.meshes, ms: origin === 'computed' ? performance.now() - t0 : 0, decision });
    void result;
  }
  options.service?.retain(neededKeys);

  // ---- approved meshes (a proposal without an approval draws nothing)
  const approvedIds = new Set<string>(), notApproved: string[] = [];
  for (const offer of options.assets ?? []) {
    const approvals = (options.approvals ?? []).filter((a) => a.proposalId === offer.proposal.id);
    if (offer.disposed) { for (const m of offer.proposal.mapping) if (byId.has(m.componentId) && approvals.some((a) => a.componentIds.includes(m.componentId))) { const d = decisions.get(m.componentId)!; d.fallback = { from: 'mesh_asset', code: 'ASSET_DISPOSED' }; d.reason = 'Stays on V2: the mesh offer was already disposed.'; } continue; }
    const componentIds = new Set(approvals.flatMap((a) => a.componentIds).filter((id) => byId.has(id) && offer.proposal.mapping.some((m) => m.componentId === id)));
    if (!componentIds.size) { notApproved.push(offer.proposal.id); for (const m of offer.proposal.mapping) if (byId.has(m.componentId)) { const d = decisions.get(m.componentId)!; if (d.requested === 'mesh_asset') { d.fallback = { from: 'mesh_asset', code: 'ASSET_NOT_APPROVED' }; d.reason = 'Stays on V2: a mesh is on offer but no person has approved it for this component.'; } } continue; }
    const t0 = performance.now(); offer.scene.updateMatrixWorld(true);
    const parts = [...componentIds].map((id) => ({ id, nodes: offer.proposal.mapping.find((m) => m.componentId === id)!.nodePaths.map((p) => { let found: Object3D | undefined; offer.scene.traverse((o) => { if (!found && o.name === p) found = o; }); return found; }) }));
    if (parts.some((p) => p.nodes.some((n) => !n))) { for (const p of parts) { const d = decisions.get(p.id)!; d.fallback = { from: 'mesh_asset', code: 'ASSET_NODE_MISSING' }; d.reason = 'Stays on V2: the approved mapping names a node the mesh does not have.'; } continue; }
    const assetBox = new Box3(), targetBox = new Box3(); for (const p of parts) { for (const n of p.nodes as Object3D[]) assetBox.union(new Box3().setFromObject(n)); targetBox.union(new Box3().setFromObject(groups.get(p.id)!.children[0]!)); }
    const aSize = assetBox.getSize(new Vector3()), tSize = targetBox.getSize(new Vector3()), scale = Math.max(...tSize.toArray()) / Math.max(...aSize.toArray(), 1e-12);
    const fit = new Matrix4().makeTranslation(...targetBox.getCenter(new Vector3()).toArray()).multiply(new Matrix4().makeScale(scale, scale, scale)).multiply(new Matrix4().makeTranslation(...assetBox.getCenter(new Vector3()).multiplyScalar(-1).toArray()));
    for (const p of parts) {
      const g = groups.get(p.id)!, holder = new Group(); holder.name = `${byId.get(p.id)!.geometry.key}:asset`; holder.userData.spatialSubcomponentKey = byId.get(p.id)!.geometry.key;
      const inverse = g.matrixWorld.clone().invert();
      for (const node of p.nodes as Object3D[]) { const copy = node.clone(true); copy.matrixAutoUpdate = true; new Matrix4().multiplyMatrices(inverse, fit).multiply(node.matrixWorld).decompose(copy.position, copy.quaternion, copy.scale); copy.traverse((o) => { if (o instanceof Mesh) { o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone(); o.userData = { ...o.userData, spatialEntityId: p.id, spatialSubcomponentKey: byId.get(p.id)!.geometry.key, geometryFamily: 'mesh_asset', assetId: offer.proposal.id, materialProfile: 'neutral' }; o.castShadow = true; o.receiveShadow = true; markShared(o); } }); holder.add(copy); }
      const m = measure(holder), old = g.children[0]!, oldM = measure(old), d = decisions.get(p.id)!;
      const existing = pending.findIndex((x) => x.componentId === p.id); if (existing >= 0) { disposeObject(pending[existing]!.next); pending.splice(existing, 1); }
      d.used = 'mesh_asset'; d.representation = 'external_asset'; d.assetId = offer.proposal.id; d.triangles = m.triangles; d.fallback = null; d.reason = `Approved mesh ${offer.proposal.id} (${offer.proposal.license.spdx}), fitted rigidly to the component's bounds.`; approvedIds.add(p.id);
      pending.push({ componentId: p.id, group: g, old, next: holder, family: 'mesh_asset', triangles: m.triangles, bytes: m.bytes, meshes: m.meshes, oldTriangles: oldM.triangles, oldBytes: oldM.bytes, oldMeshes: oldM.meshes, ms: (performance.now() - t0) / parts.length, decision: d });
    }
  }

  // ---- budget: the most expensive replacements go back to V2 until the scene fits
  const v2 = measure(root); let triangles = v2.triangles, meshes = v2.meshes, bytes = v2.bytes;
  for (const p of pending) { triangles += p.triangles - p.oldTriangles; meshes += p.meshes - p.oldMeshes; bytes += p.bytes - p.oldBytes; }
  const over = () => triangles > limits.maxTriangles || meshes > limits.maxMeshes || bytes > limits.maxGeometryBytes;
  const keep = [...pending].sort((a, b) => b.triangles - a.triangles);
  for (const p of keep) { if (!over()) break; triangles -= p.triangles - p.oldTriangles; meshes -= p.meshes - p.oldMeshes; bytes -= p.bytes - p.oldBytes; disposeObject(p.next); p.decision.used = 'procedural_v2'; p.decision.representation = 'derived_from_plan'; p.decision.assetId = null; p.decision.fallback = { from: p.family, code: 'SCENE_BUDGET' }; p.decision.reason = 'Stays on V2: the scene would exceed its triangle, mesh or memory budget.'; p.decision.triangles = p.oldTriangles; p.family = 'procedural_v2'; }
  for (const p of pending) { if (p.family === 'procedural_v2') continue; p.group.remove(p.old); p.group.add(p.next); p.group.children.splice(0, 0, p.group.children.pop()!); disposeObject(p.old); }
  root.updateMatrixWorld(true);

  const msOf = new Map(pending.map((p) => [p.componentId, p.ms]));
  const summarise = (): Pick<RouterReport, 'totals' | 'perFamily' | 'fallbacks'> => {
    const total = measure(root), perFamily: RouterReport['perFamily'] = { procedural_v2: { components: 0, triangles: 0, ms: 0 }, continuous_surface: { components: 0, triangles: 0, ms: 0 }, mesh_asset: { components: 0, triangles: 0, ms: 0 } };
    for (const d of decisions.values()) { const f = perFamily[d.used]; f.components++; f.triangles += d.triangles; f.ms += d.used === 'procedural_v2' ? 0 : msOf.get(d.componentId) ?? 0; }
    return { totals: { triangles: total.triangles, meshes: total.meshes, geometryBytes: total.bytes, ms: performance.now() - started }, perFamily, fallbacks: [...decisions.values()].filter((d) => d.fallback).length };
  };
  const report: RouterReport = { planSource: { kind: plan.source.kind, sha256: plan.source.sha256 }, decisions: plan.components.map((c) => decisions.get(c.id)!), proposalsNotApproved: notApproved, pending: pendingIds, service: options.service?.stats() ?? null, limits, ...summarise() };
  void approvedIds;

  let retired = false;
  const upgrade = (budgetTriangles = Infinity): string[] => {
    if (retired || !options.service || !waiting.length) return [];
    const changed: string[] = []; let spent = 0;
    for (const w of [...waiting]) {
      if (spent >= budgetTriangles) break;
      const result = options.service.get(w.job.key); if (!result) continue;
      waiting.splice(waiting.indexOf(w), 1); pendingIds.splice(pendingIds.indexOf(w.componentId), 1); delete w.decision.pending;
      const c = byId.get(w.componentId)!;
      if (!result.ok) { w.decision.reason = `Stays on V2: ${result.code.toLowerCase().replace(/_/g, ' ')}.`; w.decision.fallback = { from: 'continuous_surface', code: result.code }; continue; }
      const old = w.group.children[0]!, oldM = measure(old), next = assembleContinuous(result, c.id, c.geometry.key), now = measure(root);
      if (now.triangles + result.triangles - oldM.triangles > limits.maxTriangles || now.meshes + next.children.length - oldM.meshes > limits.maxMeshes || now.bytes + result.bytes - oldM.bytes > limits.maxGeometryBytes) {
        disposeObject(next); w.decision.fallback = { from: 'continuous_surface', code: 'SCENE_BUDGET' }; w.decision.reason = 'Stays on V2: the scene would exceed its triangle, mesh or memory budget.'; continue;
      }
      w.group.remove(old); w.group.add(next); w.group.children.splice(0, 0, w.group.children.pop()!); disposeObject(old);
      const own = implicitShapesOf(c.geometry), blended = result.blendedWith.length ? `; joins to ${result.blendedWith.join(', ')} (blend ${result.blendRadius.toFixed(3)})` : '';
      w.decision.used = 'continuous_surface'; w.decision.triangles = result.triangles; w.decision.deviation = result.deviation; w.decision.blendedWith = result.blendedWith; w.decision.computed = 'computed'; w.decision.fallback = null;
      w.decision.reason = `Continuous surface: ${[...(w.curved ? ['curved primitives'] : [])].concat(blended ? [blended.slice(2)] : []).join('; ') || 'smooth surface'}.`; void own;
      msOf.set(c.id, result.ms); changed.push(c.id); spent += result.triangles;
    }
    root.updateMatrixWorld(true);
    Object.assign(report, summarise(), { service: options.service.stats() });
    return changed;
  };
  return { root, stats: { ...compiled.stats, meshCount: report.totals.meshes, triangleCount: report.totals.triangles, geometryBytes: report.totals.geometryBytes }, report, upgrade, readyCount: () => (retired || !options.service ? 0 : waiting.filter((w) => options.service!.has(w.job.key)).length), retire: () => { retired = true; } };
}

export const createAdaptiveGeometryRouter = (options: RouterOptions = {}) => ({ compile: (plan: SpatialPlanV2) => compileWithRouter(plan, options) });
