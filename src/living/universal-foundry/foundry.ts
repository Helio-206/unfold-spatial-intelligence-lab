/**
 * The compile seam of the Universal Foundry. It has the call shape of `compileSpatialPlanV2` (so `PlanSpaceLayer` takes it as its `compile`), draws the V2 scene
 * first, and then replaces each component's content with generated geometry fitted to the component's own bounds, a few components per frame (`upgrade`). Component
 * ids, hierarchy, transforms and provenance stay exactly the plan's; nothing is written back to the plan.
 */
import { BufferGeometry, Mesh, Vector3, type Group, type Material, type Object3D } from 'three';
import type { SpatialPlanV2 } from '../../universal-spatial/contracts-v2';
import { compileSpatialPlanV2, type CompiledSpatialPlanV2 } from '../../universal-spatial/geometry-compiler-v2';
import { DEFAULT_ROUTER_LIMITS, type RouterReport, type RoutingDecision } from '../../universal-spatial/fidelity/types';
import { boundsOf, context, interpret, type InterpretOptions, type Interpretation } from './interpret';
import { createUniversalMaterials, type UniversalMaterials } from './materials';
import { makeLod, rng, topologyReport } from './ops';
import type { VisualRecipe } from './recipe';
import type { ImageEvidence } from './evidence';

export type FoundryResult = CompiledSpatialPlanV2 & {
  report: RouterReport; recipe: VisualRecipe | null; materials: UniversalMaterials | null;
  upgrade(budgetTriangles?: number): string[]; readyCount(): number; retire(): void;
  /** synchronous full build (tests, exports); the product path uses upgrade() */
  buildAll(): string[];
};
export type FoundryOptions = InterpretOptions & { evidence?: ImageEvidence | null; lod?: number; maxWorkMs?: number };

const count = (o: Object3D) => { let t = 0, m = 0; const seen = new Set<BufferGeometry>(); o.traverse((x) => { if (!(x instanceof Mesh)) return; m++; const g = x.geometry as BufferGeometry; seen.add(g); t += (g.index ? g.index.count : g.getAttribute('position').count) / 3; }); let bytes = 0; for (const g of seen) { for (const a of Object.values(g.attributes)) bytes += (a as { array: { byteLength: number } }).array.byteLength; if (g.index) bytes += g.index.array.byteLength; } return { triangles: Math.round(t), meshes: m, bytes }; };
const disposeOld = (o: Object3D) => o.traverse((x) => { if (!(x instanceof Mesh)) return; (x.geometry as BufferGeometry).dispose(); for (const m of Array.isArray(x.material) ? x.material : [x.material as Material]) m.dispose(); });

export function compileFoundry(plan: SpatialPlanV2, options: FoundryOptions = {}): FoundryResult {
  const started = performance.now(), compiled = compileSpatialPlanV2(plan), root = compiled.root; root.updateMatrixWorld(true);
  const groups = new Map<string, Group>(); root.traverse((o) => { if (o.userData.spatialComponentRoot) groups.set(o.userData.spatialEntityId as string, o as Group); });
  const decisions = new Map<string, RoutingDecision>(), base = (id: string): RoutingDecision => ({ componentId: id, requested: 'universal_foundry', used: 'procedural_v2', reason: 'Stays on V2: no applicable visual recipe.', fallback: { from: 'universal_foundry', code: 'NO_RECIPE' }, planGeometryOrigin: plan.components.find((c) => c.id === id)!.provenance.geometry, representation: 'derived_from_plan', assetId: null, triangles: 0 });
  for (const c of plan.components) decisions.set(c.id, base(c.id));
  const limits = { ...DEFAULT_ROUTER_LIMITS, maxTriangles: options.maxTriangles ?? 220_000 };

  // bounds per component, then the recipe
  const bounds = new Map<string, ReturnType<typeof boundsOf>>(), partSizes = new Map<string, number>();
  for (const c of plan.components) { const g = groups.get(c.id)!; const b = boundsOf(g, g.children[0]!); bounds.set(c.id, b); const s = b.local.getSize(new Vector3()); partSizes.set(c.id, s.x * s.y * s.z); }
  const objectBox = [...bounds.values()].reduce((acc, b) => acc.union(b.world), bounds.values().next().value!.world.clone().makeEmpty()), objectSize = objectBox.getSize(new Vector3());
  const interpretation: Interpretation | null = interpret(plan, objectSize, partSizes, options);
  const lib = interpretation ? createUniversalMaterials() : null, lod = makeLod(options.lod ?? 1);
  const waiting: string[] = interpretation ? plan.components.map((c) => c.id) : [], recipe = interpretation?.recipe ?? null;
  for (const id of waiting) { const d = decisions.get(id)!; d.pending = true; d.fallback = null; d.reason = 'Drawn by V2 until the Foundry builds it.'; }
  const siblings = plan.components.map((c) => { const b = bounds.get(c.id)!.world; return { id: c.id, role: interpretation?.roles.get(c.id) ?? 'generic', box: b.clone(), centre: b.getCenter(new Vector3()), size: b.getSize(new Vector3()) }; });
  const msOf = new Map<string, number>(); let retired = false;

  const buildOne = (id: string): boolean => {
    if (!interpretation || !lib || !recipe) return false;
    const c = plan.components.find((x) => x.id === id)!, g = groups.get(id)!, role = interpretation.roles.get(id)!, part = recipe.parts.find((p) => p.componentId === id)!, b = bounds.get(id)!, d = decisions.get(id)!;
    const t0 = performance.now(), ctx = context(id, c.label, role, part, b.local, b.world, g.matrixWorld.clone().invert(), objectSize, recipe, siblings.filter((s) => s.id !== id), rng(recipe.seed * 7919 + [...id].reduce((a, ch) => a + ch.charCodeAt(0), 0)), lod);
    const own = plan.components.find((x) => x.id === id)!.geometry; const shape = (function first(n: typeof own): typeof own | null { return n.type === 'shape' ? n : n.children.map(first).find(Boolean) ?? null; })(own); if (shape && shape.type === 'shape' && shape.material.profile !== 'glass') ctx.own = shape.material.color;
    const old = g.children[0]!;
    let next: Group;
    try { next = interpretation.family.build(role, ctx).build(lib, c.geometry.key, { spatialEntityId: id, spatialSubcomponentKey: c.geometry.key, foundryRole: role }); } catch (e) { d.used = 'procedural_v2'; d.fallback = { from: 'universal_foundry', code: 'BUILD_ERROR' }; d.reason = `Stays on V2: the ${role} generator failed (${(e as Error).message}).`; delete d.pending; return false; }
    next.userData.spatialSubcomponentKey = c.geometry.key;
    const m = count(next);
    if (!m.meshes || [...next.children].some((x) => x instanceof Mesh && !(x.geometry as BufferGeometry).getAttribute('position').count)) { disposeOld(next); d.fallback = { from: 'universal_foundry', code: 'EMPTY_GEOMETRY' }; d.reason = 'Stays on V2: the generator produced no geometry.'; delete d.pending; return false; }
    if (count(root).triangles + m.triangles - count(old).triangles > limits.maxTriangles) { disposeOld(next); d.fallback = { from: 'universal_foundry', code: 'SCENE_BUDGET' }; d.reason = 'Stays on V2: the scene would exceed its triangle budget.'; delete d.pending; return false; }
    g.remove(old); g.add(next); g.children.splice(0, 0, g.children.pop()!); disposeOld(old);
    d.used = 'universal_foundry'; d.fallback = null; delete d.pending; d.triangles = m.triangles; d.reason = `${recipe.category}/${recipe.archetype}: ${role}${part.roleKnown === 'unknown' ? ' (no recognised role: plain solid, inferred)' : ''}; details: ${part.details.join(', ')}.`;
    msOf.set(id, performance.now() - t0); return true;
  };
  const summarise = (): Pick<RouterReport, 'totals' | 'perFamily' | 'fallbacks'> => {
    const total = count(root), perFamily: RouterReport['perFamily'] = { procedural_v2: { components: 0, triangles: 0, ms: 0 }, continuous_surface: { components: 0, triangles: 0, ms: 0 }, mesh_asset: { components: 0, triangles: 0, ms: 0 }, universal_foundry: { components: 0, triangles: 0, ms: 0 } };
    for (const d of decisions.values()) { const f = perFamily[d.used]; f.components++; f.triangles += d.triangles; f.ms += msOf.get(d.componentId) ?? 0; }
    return { totals: { triangles: total.triangles, meshes: total.meshes, geometryBytes: total.bytes, ms: performance.now() - started }, perFamily, fallbacks: [...decisions.values()].filter((d) => d.fallback).length };
  };
  const report: RouterReport = { planSource: { kind: plan.source.kind, sha256: plan.source.sha256 }, decisions: plan.components.map((c) => decisions.get(c.id)!), proposalsNotApproved: [], pending: [...waiting], service: null, limits, ...summarise() };
  const upgrade = (budgetTriangles = Infinity): string[] => {
    if (retired) return []; const changed: string[] = [], slice = performance.now(); let spent = 0;
    while (waiting.length) {
      if (changed.length && (spent >= budgetTriangles || performance.now() - slice >= (options.maxWorkMs ?? 14))) break;
      const id = waiting.shift()!; report.pending = [...waiting];
      if (buildOne(id)) { changed.push(id); spent += decisions.get(id)!.triangles; }
    }
    root.updateMatrixWorld(true); Object.assign(report, summarise()); return changed;
  };
  const result: FoundryResult = {
    root, stats: compiled.stats, report, recipe, materials: lib, upgrade, readyCount: () => (retired ? 0 : waiting.length), retire: () => { retired = true; waiting.length = 0; report.pending = []; },
    buildAll: () => { const all: string[] = []; while (waiting.length) all.push(...upgrade()); return all; },
  };
  return result;
}
export { topologyReport };
