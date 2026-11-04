// V4 Structural Reconstruction benchmark. Categories are NEVER mixed in a conclusion:
//   A  known geometry, rendered views: independent CC0 meshes (Khronos Lantern, AntiqueCamera) -> calibrated silhouettes (the ONLY evidence given to the fitter)
//   B  real multi-view photographs: none available (see PHASE-B.md); nothing here pretends otherwise
//   C  plans produced by Meta: no ground truth exists for them; they are only used for structural-integrity statistics (not fidelity)
//   D  hand-built or synthetically degraded plans: the plans being fitted, and the lungs/microscope degradation experiments
// npx tsx scripts/benchmark/v4-benchmark.ts <dir with Lantern.glb and AntiqueCamera.glb> reports/fidelity-v4/benchmark
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { Box3, Mesh, Vector3, type Object3D } from 'three';
import { applySpatialOperationV2, validateSpatialPlanV2, type SpatialPlanV2 } from '../../src/universal-spatial/contracts-v2';
import { compileSpatialPlanV2 } from '../../src/universal-spatial/geometry-compiler-v2';
import { buildConstraints, placedGap, type PartGeometry, type Placed } from '../../src/universal-spatial/reconstruction/constraints';
import { fitPlacement } from '../../src/universal-spatial/reconstruction/fit';
import { derivePlacements, fitStructured, forestOf, placeTris, type Params } from '../../src/universal-spatial/reconstruction/structural-fit';
import { readGlbParts } from '../../src/universal-spatial/reconstruction/glb-geometry';
import { makeView, maskIoU, rasterise, viewDirections, type Tri, type View } from '../../src/universal-spatial/reconstruction/silhouette';
import { cameraPlan, lanternPlan } from './v4-benchmark-plans';
import { replyFromPlan } from '../../tests/fixtures/spatial-v2/handauthored';

const [assetDir, outDir] = [resolve(process.argv[2] ?? '.'), resolve(process.argv[3] ?? 'reports/fidelity-v4/benchmark')];
await mkdir(resolve(outDir, 'plans'), { recursive: true });
const round = (n: number, d = 3) => +n.toFixed(d), mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);

const trisByEntity = (root: Object3D) => {
  root.updateMatrixWorld(true); const map = new Map<string, Tri[]>();
  root.traverse((o) => { if (!(o instanceof Mesh) || typeof o.userData.spatialEntityId !== 'string') return; const id = o.userData.spatialEntityId as string, pos = o.geometry.getAttribute('position'), idx = o.geometry.index, n = idx ? idx.count : pos.count, l = map.get(id) ?? []; const v = (i: number) => new Vector3().fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld); for (let i = 0; i + 2 < n; i += 3) l.push([v(i), v(i + 1), v(i + 2)]); map.set(id, l); });
  return map;
};
const boxOf = (tris: Tri[]) => { const b = new Box3(); for (const t of tris) for (const p of t) b.expandByPoint(p); return b; };
const rotate = (d: Vector3, y: number, x: number) => d.clone().applyAxisAngle(new Vector3(0, 1, 0), y).applyAxisAngle(new Vector3(1, 0, 0), x);

/** Largest connected region of ground-truth pixels that the drawing does not cover, as a fraction of the ground-truth area. */
function uncoveredBlob(gt: Uint8Array, drawn: Uint8Array, res: number): number {
  const miss = new Uint8Array(gt.length); let area = 0; for (let k = 0; k < gt.length; k++) { area += gt[k]!; miss[k] = gt[k]! & ~drawn[k]! & 1; }
  let best = 0; for (let k = 0; k < miss.length; k++) { if (!miss[k]) continue; let size = 0; const stack = [k]; miss[k] = 0; while (stack.length) { const c = stack.pop()!; size++; const x = c % res, y = (c - x) / res; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= res || ny >= res) continue; const n = ny * res + nx; if (miss[n]) { miss[n] = 0; stack.push(n); } } } best = Math.max(best, size); }
  return best / Math.max(1, area);
}

type Scene = { name: string; category: string; gt: Tri[]; gtGroups: Record<string, Tri[]>; mapping: Record<string, string[]>; plan: SpatialPlanV2; sha: string; licence: string };
type Variant = 'input' | 'silhouette-only' | 'structural';

function evaluate(scene: Scene, plan: SpatialPlanV2, placements: Map<string, Placed>, pivots: Map<string, Vector3>, tris: Map<string, Tri[]>, contacts: Array<{ a: string; b: string; gap: number }>, span: number, held: View[], heldGt: Uint8Array[]) {
  const placed = [...tris].flatMap(([id, t]) => placeTris(t, pivots.get(id)!, placements.get(id) ?? { s: 1, d: new Vector3() })), res = held[0]!.res;
  const masks = held.map((v) => rasterise(placed, v)), ious = masks.map((m, i) => maskIoU(m, heldGt[i]!));
  let miss = 0, excess = 0, area = 0; masks.forEach((m, i) => { for (let k = 0; k < m.length; k++) { area += heldGt[i]![k]!; if (heldGt[i]![k] && !m[k]) miss++; if (!heldGt[i]![k] && m[k]) excess++; } });
  const blob = Math.max(...masks.map((m, i) => uncoveredBlob(heldGt[i]!, m, res)));
  // placement against the asset's own parts
  const partErr = Object.entries(scene.mapping).map(([node, all]) => [node, all.filter((id) => tris.has(id))] as const).filter(([, ids]) => ids.length).map(([node, ids]) => {
    const g = boxOf(scene.gtGroups[node]!), p = boxOf(ids.flatMap((id) => placeTris(tris.get(id)!, pivots.get(id)!, placements.get(id) ?? { s: 1, d: new Vector3() })));
    const sg = g.getSize(new Vector3()), sp = p.getSize(new Vector3());
    return { part: node, centreErrPctSpan: round(100 * g.getCenter(new Vector3()).distanceTo(p.getCenter(new Vector3())) / span, 2), sizeErrPct: round(100 * Math.max(...sg.toArray().map((v, i) => Math.abs(sp.getComponent(i) - v) / Math.max(v, 1e-9))), 1) };
  });
  // relations between parts, independent of any global shift: offsets between the centres of the mapped parts, against the same offsets in the asset
  const centres = Object.entries(scene.mapping).map(([node, all]) => { const ids = all.filter((id) => tris.has(id)); return ids.length ? { gt: boxOf(scene.gtGroups[node]!).getCenter(new Vector3()), plan: boxOf(ids.flatMap((id) => placeTris(tris.get(id)!, pivots.get(id)!, placements.get(id) ?? { s: 1, d: new Vector3() }))).getCenter(new Vector3()) } : null; }).filter((c): c is { gt: Vector3; plan: Vector3 } => !!c);
  const relErrs: number[] = []; for (let i = 0; i < centres.length; i++) for (let j = i + 1; j < centres.length; j++) relErrs.push(centres[i]!.gt.clone().sub(centres[j]!.gt).sub(centres[i]!.plan.clone().sub(centres[j]!.plan)).length() / span);
  const byId = new Map(plan.components.map((c) => [c.id, c]));
  const contactRows = contacts.map((c) => { const mk = (id: string): PartGeometry => ({ id, origin: pivots.get(id)!, tris: tris.get(id)! }); const after = placedGap(mk(c.a), mk(c.b), placements.get(c.a) ?? { s: 1, d: new Vector3() }, placements.get(c.b) ?? { s: 1, d: new Vector3() }); return { pair: `${c.a}~${c.b}`, gapBeforePctSpan: round(100 * c.gap / span, 2), gapAfterPctSpan: round(100 * after / span, 2), broken: after > Math.max(0.02 * span, 2 * c.gap + 0.01 * span) }; });
  void byId;
  return { heldOutIouMean: round(mean(ious)), heldOutIouMin: round(Math.min(...ious)), missedPct: round(100 * miss / area, 1), excessPct: round(100 * excess / area, 1), largestUncoveredBlobPct: round(100 * blob, 2), partErrors: partErr, meanCentreErrPctSpan: round(mean(partErr.map((p) => p.centreErrPctSpan)), 2), contacts: contactRows, contactsBroken: contactRows.filter((c) => c.broken).length, relationErrPctSpan: round(100 * mean(relErrs), 2) };
}

async function runScene(scene: Scene, K: number, tag: string, opts: { dropComponents?: string[] } = {}) {
  const plan = opts.dropComponents ? validateSpatialPlanV2({ ...scene.plan, components: scene.plan.components.filter((c) => !opts.dropComponents!.includes(c.id)) }) : scene.plan;
  const compiled = compileSpatialPlanV2(plan), tris = trisByEntity(compiled.root), box = boxOf(scene.gt), centre = box.getCenter(new Vector3()), half = box.getSize(new Vector3()).length() / 2 * 1.05, span = Math.max(...box.getSize(new Vector3()).toArray());
  const roots = plan.components.filter((c) => c.parentId === null), pivots = new Map(roots.map((c) => [c.id, boxOf(tris.get(c.id)!).getCenter(new Vector3())]));
  const parts: PartGeometry[] = roots.map((c) => ({ id: c.id, origin: pivots.get(c.id)!, tris: tris.get(c.id)! }));
  const fitViews = viewDirections(K).map((d) => makeView(d, centre, half, 128)), targets = fitViews.map((v) => rasterise(scene.gt, v));
  const heldViews = viewDirections(12).map((d) => makeView(rotate(d, 0.31, 0.2), centre, half, 128)), heldGt = heldViews.map((v) => rasterise(scene.gt, v));
  const constraints = buildConstraints(plan, parts, span), contacts = constraints.attach.map((c) => ({ a: c.a, b: c.b, gap: c.gap }));
  const identity = new Map<string, Placed>(); const out: Record<string, unknown> = { tag, fitViews: K, components: plan.components.map((c) => c.id), constraints: { attach: constraints.attach.map((c) => ({ id: c.id, a: c.a, b: c.b, source: c.source, gapPctSpan: round(100 * c.gap / span, 2) })), notes: constraints.notes } };
  out.input = evaluate(scene, plan, identity, pivots, tris, contacts, span, heldViews, heldGt);
  const r0 = process.memoryUsage();
  let t0 = performance.now(); const free = fitPlacement(parts, fitViews, targets, { maxShift: 0.3 * span }), freeMs = performance.now() - t0;
  out.silhouetteOnly = { ...evaluate(scene, plan, free.placements, pivots, tris, contacts, span, heldViews, heldGt), fitIouBefore: round(free.iouBefore), fitIouAfter: round(free.iouAfter), ms: Math.round(freeMs) };
  t0 = performance.now(); const fit = fitStructured(parts, constraints, fitViews, targets, { span }), structMs = performance.now() - t0, r1 = process.memoryUsage();
  const forest = forestOf(parts, constraints);
  out.structural = { ...evaluate(scene, plan, fit.placements, pivots, tris, contacts, span, heldViews, heldGt), fitIouBefore: round(fit.iouBefore), fitIouAfter: round(fit.iouAfter), ms: Math.round(structMs), evaluations: fit.evaluations, roots: forest.roots, free: forest.free, cycleEdges: fit.cycleEdges, maxJointResidualPctSpan: round(100 * Math.max(0, ...fit.residuals.map((x) => x.after)), 4), rssDeltaMB: round((r1.rss - r0.rss) / 1048576, 1), heapDeltaMB: round((r1.heapUsed - r0.heapUsed) / 1048576, 1) };
  // ---- typed proposals (set-transform per component) applied through the real contract; provenance says what this is
  const apply = (placements: Map<string, Placed>, label: string, held: number) => {
    let next = plan; for (const c of roots) { const pl = placements.get(c.id); if (!pl) continue; const piv = pivots.get(c.id)!, pos0 = new Vector3(...c.transform.position), pos = pos0.clone().addScaledVector(piv.clone().sub(pos0), 1 - pl.s).add(pl.d);
      next = applySpatialOperationV2(next, { contract: 'unfold.spatial-operation.v2', operationId: `v4-${label}-${tag}-${c.id}`.slice(0, 80), kind: 'set-transform', componentId: c.id, nodeKey: null, value: { ...c.transform, position: pos.toArray().map((n) => round(n, 5)) as [number, number, number], scale: c.transform.scale.map((x) => round(x * pl.s, 5)) as [number, number, number] } }, { origin: 'inferred', evidence: `Structural solver (${label}) fitted to ${K} calibrated silhouettes of a CC0 reference; held-out silhouette IoU ${held.toFixed(3)}. Basis: inferred. Category D plan, category A evidence.` }); }
    return next;
  };
  out.plans = { structural: apply(fit.placements, 'structural', (out.structural as { heldOutIouMean: number }).heldOutIouMean), silhouetteOnly: apply(free.placements, 'silhouette-only', (out.silhouetteOnly as { heldOutIouMean: number }).heldOutIouMean), input: plan };
  return out;
}

const scenes: Scene[] = [];
for (const [name, file, mapping, plan, licence] of [
  ['Lantern', 'Lantern.glb', { Body: ['pole', 'base', 'arm', 'bracket'], Chain: ['chain'], Lantern: ['lantern'] }, lanternPlan, 'CC0-1.0 (Khronos glTF-Sample-Assets/Models/Lantern, artist sbtron, owner Microsoft)'],
  ['AntiqueCamera', 'AntiqueCamera.glb', { camera: ['camera'], tripod: ['head', 'leg-a', 'leg-b', 'leg-c'] }, cameraPlan, 'CC0-1.0 (Khronos glTF-Sample-Assets/Models/AntiqueCamera, Maximillan Kamps / UX3D; UX3D logo excluded)'],
] as const) {
  const bytes = new Uint8Array(await readFile(resolve(assetDir, file))), sha = createHash('sha256').update(bytes).digest('hex'), parts = readGlbParts(bytes);
  scenes.push({ name, category: 'A (ground truth: independent CC0 mesh) + D (hand-built plan)', gt: parts.flatMap((p) => p.tris), gtGroups: Object.fromEntries(parts.map((p) => [p.name.replace(/^\/?[^/]*\//, '') || p.name, p.tris])), mapping: mapping as unknown as Record<string, string[]>, plan: plan(sha), sha, licence });
}
// group names in the lantern asset are paths such as /Lantern/LanternPole_Body: map them to the short names used above
for (const s of scenes) { const g: Record<string, Tri[]> = {}; for (const [k, v] of Object.entries(s.gtGroups)) { const short = Object.keys(s.mapping).find((m) => k.toLowerCase().endsWith(m.toLowerCase())) ?? k; g[short] = v; } s.gtGroups = g; }

const results: Record<string, unknown> = { generatedBy: 'scripts/benchmark/v4-benchmark.ts', categories: { A: 'known geometry rendered to calibrated silhouettes (CC0 meshes)', B: 'real multi-view photographs: NONE available', C: 'Meta-produced plans: no ground truth, not used for fidelity', D: 'hand-built / degraded plans' }, scenes: {} as Record<string, unknown> };
for (const s of scenes) {
  const rows: Record<string, unknown>[] = []; let main: Record<string, unknown> | null = null;
  for (const K of [1, 2, 3, 6, 12]) { const r = await runScene(s, K, `k${K}`); const { plans, ...rest } = r; rows.push(rest); if (K === 6) main = r; console.log(s.name, `K=${K}`, 'held-out IoU input', (r.input as { heldOutIouMean: number }).heldOutIouMean, 'sil-only', (r.silhouetteOnly as { heldOutIouMean: number; contactsBroken: number }).heldOutIouMean, 'broken', (r.silhouetteOnly as { contactsBroken: number }).contactsBroken, '| structural', (r.structural as { heldOutIouMean: number }).heldOutIouMean, 'broken', (r.structural as { contactsBroken: number }).contactsBroken); }
  const plans = (main as { plans: { structural: SpatialPlanV2; silhouetteOnly: SpatialPlanV2; input: SpatialPlanV2 } }).plans;
  for (const [k, p] of Object.entries(plans)) await writeFile(resolve(outDir, 'plans', `${s.name}-${k}.json`), `${JSON.stringify(replyFromPlan(p), null, 1)}\n`);
  // failure case F1: a structural part missing from the plan (cannot be invented)
  const missingId = s.name === 'Lantern' ? 'bracket' : 'head', missing = await runScene(s, 6, `missing-${missingId}`, { dropComponents: [missingId] }); const { plans: _drop, ...missingRest } = missing;
  console.log(s.name, 'F1 missing', missingId, 'structural held-out', (missing.structural as { heldOutIouMean: number }).heldOutIouMean, 'blob', (missing.structural as { largestUncoveredBlobPct: number }).largestUncoveredBlobPct);
  (results.scenes as Record<string, unknown>)[s.name] = { category: s.category, licence: s.licence, glbSha256: s.sha, components: s.plan.components.length, kSweep: rows, failureMissingComponent: { missing: missingId, ...missingRest } };
}
await writeFile(resolve(outDir, 'benchmark-results.json'), `${JSON.stringify(results, null, 2)}\n`);
