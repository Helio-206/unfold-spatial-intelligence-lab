import { Box3, InstancedMesh, Matrix3, Matrix4, Mesh, Raycaster, Vector3, type Group, type Object3D } from 'three';
import { applySpatialOperationV2, type SpatialOperationV2, type SpatialPlanV2 } from './contracts-v2';
import { compileSpatialPlanV2, disposeCompiledSpatialPlan } from './geometry-compiler-v2';
import { collectWorldPoints } from './framing';

/**
 * Deterministic assembly checks and an iterative corrector for components that float apart.
 *
 * Scope and limits, stated once:
 * - Contact is judged on world-space axis-aligned boxes of each component's own geometry. Two boxes that overlap count as connected even if a diagonal
 *   member does not really touch; a gap reported here is real, a "connected" verdict is not a proof of contact, collision or structural soundness.
 * - The corrector only ever proposes `set-transform` operations through `applySpatialOperationV2`, one component group at a time, in the component's
 *   parent frame. It never edits geometry, materials or any other component, and it never moves a component whose position is `observed` or
 *   `user_provided` (confirmed or extracted data needs an explicit human step): such a gap stays in `remaining` with `blockedBy`.
 * - A gap bigger than `DETACHED_RATIO` of the assembly's longest side is treated as an intentional separation (an exploded or spaced layout) and is reported, not closed.
 * - The result is a solver output (category 4) that the contract can only label `inferred`; the evidence text says "Assembly solver".
 */
export const DETACHED_RATIO = 0.6;
export const TINY_RATIO = 0.015;
const OVERLAP_RATIO = 0.01;
const TOUCH_RATIO = 0.002;

export type AssemblyDefect =
  | { kind: 'floating'; componentId: string; nearestId: string | null; gap: number; blockedBy?: 'confirmed_provenance' }
  | { kind: 'detached'; componentId: string; nearestId: string | null; gap: number }
  | { kind: 'tiny'; componentId: string; ratio: number }
  | { kind: 'generic_geometry'; componentId: string; detail: string }
  | { kind: 'buried'; componentId: string; enclosedBy: string | null; blockedBy?: 'confirmed_provenance' };
export type ComponentMeasure = { id: string; box: Box3; volume: number; extent: number };
export type AssemblyAnalysis = { span: number; components: ComponentMeasure[]; islands: string[][]; defects: AssemblyDefect[] };
export type AppliedCorrection = { operation: SpatialOperationV2; defect: AssemblyDefect; evidence: string; worldDelta: [number, number, number] };


/** Triangle centroids (the actual surface, not only its corners) of a component's own meshes, thinned to about `max`. */
function surfacePoints(group: Object3D, max: number): Vector3[] {
  group.updateWorldMatrix(true, true);
  const sources: Array<{ mesh: Mesh; matrices: Matrix4[] }> = []; let total = 0;
  const visit = (object: Object3D) => {
    if (!object.visible || (object !== group && object.userData.spatialComponentRoot)) return;
    if (object instanceof Mesh) {
      const position = object.geometry.getAttribute('position');
      if (position) {
        let matrices: Matrix4[] = [object.matrixWorld];
        if (object instanceof InstancedMesh) { matrices = []; for (let i = 0; i < object.count; i++) { const local = new Matrix4(); object.getMatrixAt(i, local); matrices.push(new Matrix4().multiplyMatrices(object.matrixWorld, local)); } }
        sources.push({ mesh: object, matrices }); total += (object.geometry.index ? object.geometry.index.count : position.count) / 3 * matrices.length;
      }
    }
    for (const child of object.children) visit(child);
  };
  visit(group);
  // Golden-ratio (low-discrepancy) picks over ALL triangles: a regular stride can alias with the triangle order and never touch a whole face.
  const count = Math.min(max, total), out: Vector3[] = [], cumulative: number[] = []; let running = 0;
  const layout = sources.flatMap(({ mesh, matrices }) => { const tris = (mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.getAttribute('position').count) / 3; return matrices.map((matrix) => ({ mesh, matrix, tris })); });
  for (const item of layout) { running += item.tris; cumulative.push(running); }
  for (let i = 0; i < count; i++) {
    const pick = Math.floor((((i + 0.5) * 0.6180339887498949) % 1) * running);
    let lo = 0, hi = layout.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (cumulative[mid]! > pick) hi = mid; else lo = mid + 1; }
    const item = layout[lo]!, t = pick - (lo > 0 ? cumulative[lo - 1]! : 0), index = item.mesh.geometry.index, position = item.mesh.geometry.getAttribute('position');
    const at = (k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k), c = new Vector3();
    for (let k = 0; k < 3; k++) c.add(new Vector3().fromBufferAttribute(position, at(k)));
    out.push(c.divideScalar(3).applyMatrix4(item.matrix));
  }
  return out;
}

const EXPOSURE_DIRECTIONS: Vector3[] = [
  ...[[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(([x, y, z]) => new Vector3(x, y, z)),
  ...[1, -1].flatMap((x) => [1, -1].flatMap((y) => [1, -1].map((z) => new Vector3(x, y, z).normalize()))),
];
const AXIS_DIRECTIONS = EXPOSURE_DIRECTIONS.slice(0, 6);

/**
 * Fraction of a component's sampled surface points that some outside direction can see (first opaque hit is the component itself). Judged on the compiled
 * triangles with the materials' real face culling, so hollow shells, open ends and glazing behave as they render. Transparent materials do not occlude.
 */
function exposureOf(meshes: Mesh[], group: Object3D, id: string, span: number, directions: Vector3[] = EXPOSURE_DIRECTIONS, samples = 60): { fraction: number; blocker: string | null } {
  const points = surfacePoints(group, samples), raycaster = new Raycaster(), blockers = new Map<string, number>(); let exposed = 0;
  raycaster.far = span * 4;
  for (const point of points) {
    let seen = false;
    for (const direction of directions) {
      raycaster.set(point.clone().addScaledVector(direction, span * 2), direction.clone().negate());
      const hit = raycaster.intersectObjects(meshes, false).find((h) => { const m = (h.object as Mesh).material as { transparent?: boolean }; return h.object.userData.spatialEntityId === id || !m.transparent; });
      if (!hit) continue;
      const owner = hit.object.userData.spatialEntityId as string | undefined;
      if (owner === id) { seen = true; break; } if (owner) blockers.set(owner, (blockers.get(owner) ?? 0) + 1);
    }
    if (seen) exposed++;
  }
  const blocker = [...blockers].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { fraction: points.length ? exposed / points.length : 1, blocker };
}
const meshesOf = (root: Object3D): Mesh[] => { const out: Mesh[] = []; root.traverse((o) => { if (o instanceof Mesh && o.visible) out.push(o); }); return out; };

type Measured = { analysis: AssemblyAnalysis; groups: Map<string, Group>; root: Group };

/** Per-axis signed vector that would move `a` until it touches `b` (zero on axes where the boxes already overlap). */
function gapVector(a: Box3, b: Box3): Vector3 {
  return new Vector3(
    a.max.x < b.min.x ? b.min.x - a.max.x : b.max.x < a.min.x ? -(a.min.x - b.max.x) : 0,
    a.max.y < b.min.y ? b.min.y - a.max.y : b.max.y < a.min.y ? -(a.min.y - b.max.y) : 0,
    a.max.z < b.min.z ? b.min.z - a.max.z : b.max.z < a.min.z ? -(a.min.z - b.max.z) : 0);
}

function measure(plan: SpatialPlanV2): Measured {
  const compiled = compileSpatialPlanV2(plan), root = compiled.root, groups = new Map<string, Group>();
  root.traverse((object: Object3D) => { if (object.userData.spatialComponentRoot) groups.set(object.userData.spatialEntityId as string, object as Group); });
  const components: ComponentMeasure[] = [];
  for (const component of plan.components) {
    const group = groups.get(component.id)!;
    const points = collectWorldPoints(group, 600, (object) => Boolean(object.userData.spatialComponentRoot));
    if (!points.length) continue;
    const box = new Box3().setFromPoints(points), size = box.getSize(new Vector3());
    components.push({ id: component.id, box, volume: Math.max(size.x * size.y * size.z, 1e-18), extent: Math.max(size.x, size.y, size.z) });
  }
  const whole = new Box3(); for (const item of components) whole.union(item.box);
  const size = whole.getSize(new Vector3()), span = Math.max(size.x, size.y, size.z, 1e-12), tol = span * TOUCH_RATIO;
  // Union-find over "boxes touch or overlap".
  const parent = new Map(components.map((item) => [item.id, item.id])); const find = (value: string): string => { let current = value; while (parent.get(current) !== current) current = parent.get(current)!; return current; };
  for (let i = 0; i < components.length; i++) for (let j = i + 1; j < components.length; j++) if (gapVector(components[i]!.box, components[j]!.box).length() <= tol) parent.set(find(components[i]!.id), find(components[j]!.id));
  const islandMap = new Map<string, string[]>(); for (const item of components) { const key = find(item.id); islandMap.set(key, [...(islandMap.get(key) ?? []), item.id]); }
  const islands = [...islandMap.values()];
  const byId = new Map(components.map((item) => [item.id, item])), volumeOf = (island: string[]) => island.reduce((sum, id) => sum + byId.get(id)!.volume, 0);
  const mainIsland = [...islands].sort((a, b) => volumeOf(b) - volumeOf(a))[0] ?? [];
  const defects: AssemblyDefect[] = [];
  const protectedOrigin = (id: string) => { const origin = plan.components.find((item) => item.id === id)!.provenance.transform; return origin === 'observed' || origin === 'user_provided'; };
  const parentOf = (id: string) => plan.components.find((item) => item.id === id)!.parentId;
  for (const island of islands) {
    if (island === mainIsland) continue;
    let best: { from: string; to: string; vector: Vector3 } | undefined;
    for (const a of island) for (const b of mainIsland) { const vector = gapVector(byId.get(a)!.box, byId.get(b)!.box); if (!best || vector.length() < best.vector.length()) best = { from: a, to: b, vector }; }
    const gap = best?.vector.length() ?? Infinity, anchor = [...island].sort((x, y) => byId.get(y)!.volume - byId.get(x)!.volume)[0]!;
    const members = new Set(island), roots = island.filter((id) => { const p = parentOf(id); return !p || !members.has(p); });
    if (gap / span > DETACHED_RATIO) defects.push({ kind: 'detached', componentId: anchor, nearestId: best?.to ?? null, gap });
    else defects.push({ kind: 'floating', componentId: roots.length === 1 ? roots[0]! : anchor, nearestId: best?.to ?? null, gap, ...(roots.some(protectedOrigin) ? { blockedBy: 'confirmed_provenance' as const } : {}) });
  }
  for (const item of components) {
    if (item.extent / span < TINY_RATIO) defects.push({ kind: 'tiny', componentId: item.id, ratio: item.extent / span });
    const evidence = plan.components.find((component) => component.id === item.id)!.provenance.evidence;
    if (/Parameter repair|Local safe fallback/.test(evidence)) defects.push({ kind: 'generic_geometry', componentId: item.id, detail: evidence.slice(0, 200) });
  }
  if (components.length > 1) {
    const meshes = meshesOf(root);
    for (const item of components) {
      const { fraction, blocker } = exposureOf(meshes, groups.get(item.id)!, item.id, span);
      if (fraction === 0) defects.push({ kind: 'buried', componentId: item.id, enclosedBy: blocker, ...(protectedOrigin(item.id) ? { blockedBy: 'confirmed_provenance' as const } : {}) });
    }
  }
  return { analysis: { span, components, islands, defects }, groups, root };
}

export function analyzeAssembly(plan: SpatialPlanV2): AssemblyAnalysis {
  const measured = measure(plan); disposeCompiledSpatialPlan(measured.root); return measured.analysis;
}

export function describeDefect(defect: AssemblyDefect): string {
  switch (defect.kind) {
    case 'floating': return defect.blockedBy
      ? `${defect.componentId} floats ${defect.gap.toFixed(2)} from ${defect.nearestId}; its position is observed or confirmed, so the solver will not move it.`
      : `${defect.componentId} does not touch the assembly (nearest: ${defect.nearestId}, ${defect.gap.toFixed(2)} apart).`;
    case 'detached': return `${defect.componentId} is a separate body ${defect.gap.toFixed(2)} from ${defect.nearestId}; left alone as an intentional separation.`;
    case 'tiny': return `${defect.componentId} is only ${(defect.ratio * 100).toFixed(1)}% of the assembly's longest side; check its scale.`;
    case 'buried': return defect.blockedBy
      ? `${defect.componentId} is hidden inside ${defect.enclosedBy ?? 'another part'}; its position is observed or confirmed, so the solver will not move it.`
      : `${defect.componentId} is hidden inside ${defect.enclosedBy ?? 'another part'}: no direction can see it.`;
    case 'generic_geometry': return `${defect.componentId} has approximated geometry (invalid parameters were repaired); its proportions are not model evidence.`;
  }
}

export type RefineOptions ={ maxIterations?: number };
export type RefineResult = { plan: SpatialPlanV2; applied: AppliedCorrection[]; remaining: AssemblyDefect[]; iterations: number };

/** Connects floating islands to the main body one at a time (nearest first), re-measuring after each correction. Bounded by `maxIterations` (default 8). */
export function refineAssembly(input: SpatialPlanV2, options: RefineOptions = {}): RefineResult {
  const maxIterations = options.maxIterations ?? 8; let plan = input; const applied: AppliedCorrection[] = []; let iterations = 0;
  for (; iterations < maxIterations; iterations++) {
    const measured = measure(plan), { analysis, groups, root } = measured;
    try {
      const candidates = analysis.defects.filter((d): d is Extract<AssemblyDefect, { kind: 'floating' }> => d.kind === 'floating' && !d.blockedBy && d.nearestId !== null).sort((a, b) => a.gap - b.gap);
      const target = candidates[0];
      if (!target) break;
      const byId = new Map(analysis.components.map((item) => [item.id, item]));
      const island = analysis.islands.find((members) => members.includes(target.componentId))!, members = new Set(island);
      const mainIsland = analysis.islands.filter((members2) => !members2.includes(target.componentId)).find((members2) => members2.includes(target.nearestId!))!;
      let best: Vector3 | undefined;
      for (const a of island) for (const b of mainIsland) {
        const v = gapVector(byId.get(a)!.box, byId.get(b)!.box);
        if (!best || v.length() < best.length()) best = v;
      }
      const overlap = analysis.span * OVERLAP_RATIO, delta = new Vector3(...best!.toArray().map((value) => (value === 0 ? 0 : value + Math.sign(value) * overlap)) as [number, number, number]);
      const roots = plan.components.filter((component) => members.has(component.id) && (!component.parentId || !members.has(component.parentId)));
      for (const component of roots) {
        const parentMatrix = component.parentId ? groups.get(component.parentId)!.matrixWorld : root.matrixWorld;
        const local = delta.clone().applyMatrix3(new Matrix3().setFromMatrix4(new Matrix4().copy(parentMatrix).invert()));
        const position = component.transform.position.map((value, axis) => Math.round((value + local.getComponent(axis)) * 1e9) / 1e9) as [number, number, number];
        const evidence = `Assembly solver (AABB, deterministic): moved ${component.id} by [${delta.toArray().map((n) => n.toFixed(3)).join(', ')}] in world space to close a ${target.gap.toFixed(3)} gap to ${target.nearestId}. Not a contact or structural check.`.slice(0, 500);
        const operation: SpatialOperationV2 = { contract: 'unfold.spatial-operation.v2', operationId: `solver-${iterations}-${component.id}`.slice(0, 80), kind: 'set-transform', componentId: component.id, nodeKey: null, value: { ...component.transform, position } };
        plan = applySpatialOperationV2(plan, operation, { origin: 'inferred', evidence });
        applied.push({ operation, defect: target, evidence, worldDelta: delta.toArray() as [number, number, number] });
      }
    } finally { disposeCompiledSpatialPlan(root); }
  }
  return { plan, applied, remaining: analyzeAssembly(plan).defects, iterations };
}

/**
 * Brings components that are completely hidden inside an opaque part into view, by the smallest translation along a world axis that lets them be seen
 * (at least a quarter of their sampled surface). Typed `set-transform` operations only, one component at a time, re-measured after each. Observed or
 * confirmed positions are never moved (reported as blocked). This changes where a part is, which only a person can say is right: the move is marked
 * as a solver output and is undoable like any operation.
 */
export function revealBuriedComponents(input: SpatialPlanV2, options: { maxIterations?: number } = {}): RefineResult {
  let plan = input; const applied: AppliedCorrection[] = []; let iterations = 0; const done = new Set<string>();
  for (; iterations < (options.maxIterations ?? 6); iterations++) {
    const measured = measure(plan), { analysis, groups, root } = measured;
    try {
      const target = analysis.defects.find((d): d is Extract<AssemblyDefect, { kind: 'buried' }> => d.kind === 'buried' && !d.blockedBy && !done.has(d.componentId));
      if (!target) break; done.add(target.componentId);
      const component = plan.components.find((c) => c.id === target.componentId)!, group = groups.get(component.id)!, meshes = meshesOf(root);
      const parentMatrix = component.parentId ? groups.get(component.parentId)!.matrixWorld : root.matrixWorld, inverse = new Matrix3().setFromMatrix4(new Matrix4().copy(parentMatrix).invert());
      const step = analysis.span * 0.04, start = group.position.clone(); let best: { delta: Vector3; distance: number } | null = null;
      for (let k = 1; k <= 18 && !best; k++) for (const axis of [AXIS_DIRECTIONS[4]!, AXIS_DIRECTIONS[2]!, AXIS_DIRECTIONS[0]!, AXIS_DIRECTIONS[5]!, AXIS_DIRECTIONS[3]!, AXIS_DIRECTIONS[1]!]) {
        const world = axis.clone().multiplyScalar(step * k); group.position.copy(start).add(world.clone().applyMatrix3(inverse)); root.updateMatrixWorld(true);
        if (exposureOf(meshes, group, component.id, analysis.span, EXPOSURE_DIRECTIONS, 40).fraction >= 0.25) { best = { delta: world, distance: step * k }; break; }
      }
      group.position.copy(start); root.updateMatrixWorld(true);
      if (!best) continue;
      const local = best.delta.clone().applyMatrix3(inverse), position = component.transform.position.map((value, axis) => Math.round((value + local.getComponent(axis)) * 1e9) / 1e9) as [number, number, number];
      const evidence = `Assembly solver (ray visibility, deterministic): moved ${component.id} by [${best.delta.toArray().map((n) => n.toFixed(3)).join(', ')}] in world space because no direction could see it inside ${target.enclosedBy ?? 'another part'}. Not a contact or structural check.`.slice(0, 500);
      const operation: SpatialOperationV2 = { contract: 'unfold.spatial-operation.v2', operationId: `solver-reveal-${iterations}-${component.id}`.slice(0, 80), kind: 'set-transform', componentId: component.id, nodeKey: null, value: { ...component.transform, position } };
      plan = applySpatialOperationV2(plan, operation, { origin: 'inferred', evidence });
      applied.push({ operation, defect: target as unknown as AssemblyDefect, evidence, worldDelta: best.delta.toArray() as [number, number, number] });
    } finally { disposeCompiledSpatialPlan(root); }
  }
  return { plan, applied, remaining: analyzeAssembly(plan).defects, iterations };
}
