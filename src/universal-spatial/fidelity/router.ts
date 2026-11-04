import { Box3, Group, InstancedMesh, Matrix4, Mesh, Vector3, type BufferGeometry, type Object3D } from 'three';
import type { SpatialPlanV2 } from '../contracts-v2';
import { compileSpatialPlanV2, type CompiledSpatialPlanV2 } from '../geometry-compiler-v2';
import { buildContinuousComponent, disposeObject, type NeighbourField } from './continuous-surface';
import { implicitShapesOf, type ImplicitShape } from './sdf';
import { DEFAULT_ROUTER_LIMITS, type AssetApproval, type AssetProposal, type GeometryFamily, type RouterLimits, type RouterReport, type RoutingDecision } from './types';

/**
 * Adaptive Geometry Router (prototype). `compileWithRouter(plan, options)` returns what `compileSpatialPlanV2(plan)` returns plus a report. It starts from the
 * V2 compile (so groups, hierarchy, userData and every failure mode are exactly V2's), then replaces, component by component, the V2 meshes with another
 * family's drawing where a rule or a request says so AND the result is within limits. Anything else stays V2. The plan is read, never written.
 * Contract and rules: `./CONTRACT.md`.
 */
export type AssetOffer = { proposal: AssetProposal; scene: Object3D };
export type RouterOptions = {
  limits?: Partial<RouterLimits>;
  /** `auto`: continuous surface where it helps (curved primitives or parts that join others); `v2_only`: never leave V2; `continuous_all`: every eligible component. */
  policy?: 'auto' | 'v2_only' | 'continuous_all';
  /** per component, what the host asks for; honoured only if possible, otherwise V2 with the reason recorded */
  requests?: Record<string, GeometryFamily>;
  /** meshes on offer. They draw nothing unless approved. */
  assets?: AssetOffer[];
  approvals?: AssetApproval[];
};
export type RoutedPlan = CompiledSpatialPlanV2 & { report: RouterReport };

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
    const fields: NeighbourField[] = neighbours.map((o) => ({ id: o.id, shapes: shapes.get(o.id)!, toLocal: new Matrix4().multiplyMatrices(inverseSelf, groups.get(o.id)!.matrixWorld) }));
    const t0 = performance.now();
    let result: ReturnType<typeof buildContinuousComponent>;
    try { result = buildContinuousComponent({ key: c.geometry.key, geometry: c.geometry, entityId: c.id, neighbours: fields, span, limits }); } catch (error) { result = { fallback: 'EXCEPTION' }; void error; }
    if ('fallback' in result) { decision.reason = `Stays on V2: ${result.fallback.toLowerCase().replace(/_/g, ' ')}.`; decision.fallback = { from: 'continuous_surface', code: result.fallback }; continue; }
    const g = groups.get(c.id)!, old = g.children[0]!, oldM = measure(old);
    decision.used = 'continuous_surface'; decision.triangles = result.triangles;
    decision.reason = `Continuous surface: ${[...(curved ? ['curved primitives'] : []), ...(result.blendedWith.length ? [`joins to ${result.blendedWith.join(', ')} (blend ${result.blendRadius.toFixed(3)})`] : [])].join('; ')}.`;
    pending.push({ componentId: c.id, group: g, old, next: result.group, family: 'continuous_surface', triangles: result.triangles, bytes: result.bytes, meshes: result.group.children.length, oldTriangles: oldM.triangles, oldBytes: oldM.bytes, oldMeshes: oldM.meshes, ms: performance.now() - t0, decision });
  }

  // ---- approved meshes (a proposal without an approval draws nothing)
  const approvedIds = new Set<string>(), notApproved: string[] = [];
  for (const offer of options.assets ?? []) {
    const approvals = (options.approvals ?? []).filter((a) => a.proposalId === offer.proposal.id);
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
      for (const node of p.nodes as Object3D[]) { const copy = node.clone(true); copy.matrixAutoUpdate = true; new Matrix4().multiplyMatrices(inverse, fit).multiply(node.matrixWorld).decompose(copy.position, copy.quaternion, copy.scale); copy.traverse((o) => { if (o instanceof Mesh) { o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone(); o.userData = { ...o.userData, spatialEntityId: p.id, spatialSubcomponentKey: byId.get(p.id)!.geometry.key, geometryFamily: 'mesh_asset', assetId: offer.proposal.id, materialProfile: 'neutral' }; o.castShadow = true; o.receiveShadow = true; } }); holder.add(copy); }
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

  const total = measure(root), perFamily: RouterReport['perFamily'] = { procedural_v2: { components: 0, triangles: 0, ms: 0 }, continuous_surface: { components: 0, triangles: 0, ms: 0 }, mesh_asset: { components: 0, triangles: 0, ms: 0 } };
  const msOf = new Map(pending.map((p) => [p.componentId, p.ms]));
  for (const d of decisions.values()) { const f = perFamily[d.used]; f.components++; f.triangles += d.triangles; f.ms += d.used === 'procedural_v2' ? 0 : msOf.get(d.componentId) ?? 0; }
  const report: RouterReport = { planSource: { kind: plan.source.kind, sha256: plan.source.sha256 }, decisions: plan.components.map((c) => decisions.get(c.id)!), proposalsNotApproved: notApproved, limits, totals: { triangles: total.triangles, meshes: total.meshes, geometryBytes: total.bytes, ms: performance.now() - started }, perFamily, fallbacks: [...decisions.values()].filter((d) => d.fallback).length };
  void approvedIds;
  return { root, stats: { ...compiled.stats, meshCount: total.meshes, triangleCount: total.triangles, geometryBytes: total.bytes }, report };
}

export const createAdaptiveGeometryRouter = (options: RouterOptions = {}) => ({ compile: (plan: SpatialPlanV2) => compileWithRouter(plan, options) });
