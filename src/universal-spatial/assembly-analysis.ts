import { Box3, Matrix3, Matrix4, Vector3, type Group, type Object3D } from 'three';
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
  | { kind: 'generic_geometry'; componentId: string; detail: string };
export type ComponentMeasure = { id: string; box: Box3; volume: number; extent: number };
export type AssemblyAnalysis = { span: number; components: ComponentMeasure[]; islands: string[][]; defects: AssemblyDefect[] };
export type AppliedCorrection = { operation: SpatialOperationV2; defect: AssemblyDefect; evidence: string; worldDelta: [number, number, number] };

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
