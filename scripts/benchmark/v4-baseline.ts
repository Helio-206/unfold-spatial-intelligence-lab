// V4 phase A experiments that need no external resource.
//   E1  Does V3 move the silhouette toward the SOURCE image? (V2 / V3 against the lungs illustration, best view)
//   E2  Multi-view visual hull against a GROUND-TRUTH solid: what a classical reconstruction recovers from K calibrated silhouettes
//   E3  Silhouette-driven refinement of the plan's component placement (analysis by synthesis), with a held-out view
//   npx tsx scripts/benchmark/v4-baseline.ts reports/fidelity-v4
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Box3, Matrix4, Mesh, Vector3, type Object3D } from 'three';
import { validateSpatialPlanV2, type SpatialPlanV2 } from '../../src/universal-spatial/contracts-v2';
import { compileSpatialPlanV2 } from '../../src/universal-spatial/geometry-compiler-v2';
import { compileWithRouter } from '../../src/universal-spatial/fidelity/router';
import { implicitShapesOf, unionFieldCulled } from '../../src/universal-spatial/fidelity/sdf';
import { carve, gridFor, makeView, maskIoU, rasterise, viewDirections, type Tri, type View } from '../../src/universal-spatial/reconstruction/silhouette';

const out = resolve(process.argv[2] ?? 'reports/fidelity-v4');
const plan = async (file: string) => validateSpatialPlanV2(JSON.parse(await readFile(resolve(file), 'utf8')).plan);
const byEntity = (root: Object3D): Map<string, Tri[]> => {
  root.updateMatrixWorld(true); const map = new Map<string, Tri[]>();
  root.traverse((o) => {
    if (!(o instanceof Mesh) || typeof o.userData.spatialEntityId !== 'string') return;
    const id = o.userData.spatialEntityId as string, g = o.geometry, pos = g.getAttribute('position'), idx = g.index, n = idx ? idx.count : pos.count, list = map.get(id) ?? [];
    const v = (i: number) => new Vector3().fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld);
    for (let i = 0; i + 2 < n; i += 3) list.push([v(i), v(i + 1), v(i + 2)]); map.set(id, list);
  });
  return map;
};
const all = (m: Map<string, Tri[]>) => [...m.values()].flat();
const bboxOf = (tris: Tri[]) => { const b = new Box3(); for (const t of tris) for (const p of t) b.expandByPoint(p); return b; };
const round = (n: number, d = 3) => +n.toFixed(d);

// ---------------------------------------------------------------------------------------------------- E1
async function readPgm(path: string) {
  const t = (await readFile(path, 'utf8')).split(/\s+/).filter(Boolean); const w = Number(t[1]), h = Number(t[2]);
  return { w, h, data: Uint8Array.from(t.slice(4).map((v) => (Number(v) > 0 ? 1 : 0))) };
}
/** Silhouette of `tris` seen along (az, el), orthographic, rendered at 256 px and cropped to its own bounding box, then fitted into the source bounding box by height. */
function fitted(tris: Tri[], az: number, el: number, src: { w: number; h: number; data: Uint8Array }): Uint8Array {
  const box = bboxOf(tris), centre = box.getCenter(new Vector3()), half = box.getSize(new Vector3()).length() / 2 * 1.05, res = 384;
  const dir = new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)), view = makeView(dir, centre, half, res), mask = rasterise(tris, view);
  let x0 = res, x1 = -1, y0 = res, y1 = -1; for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) if (mask[y * res + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (x1 < 0) return new Uint8Array(src.w * src.h);
  const bh = y1 - y0 + 1, bw = x1 - x0 + 1, k = src.h / bh, outW = Math.round(bw * k), offset = Math.round((src.w - outW) / 2), result = new Uint8Array(src.w * src.h);
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) { const sx = x - offset; if (sx < 0 || sx >= outW) continue; const mx = x0 + Math.floor(sx / k), my = y1 - Math.floor(y / k); /* image y grows downward, view y upward */ if (mask[my * res + mx]) result[y * src.w + x] = 1; }
  return result;
}
function bestView(tris: Tri[], src: { w: number; h: number; data: Uint8Array }) {
  let best = { iou: -1, azDeg: 0, elDeg: 0 };
  for (let az = -60; az <= 60; az += 6) for (const el of [-10, 0, 10, 20]) { const s = maskIoU(fitted(tris, (az * Math.PI) / 180, (el * Math.PI) / 180, src), src.data); if (s > best.iou) best = { iou: s, azDeg: az, elDeg: el }; }
  return { iou: round(best.iou), azDeg: best.azDeg, elDeg: best.elDeg };
}

const results: Record<string, unknown> = {};
const lungsPlan = await plan('reports/fidelity-v3/fixtures/lungs-like.json'), src = await readPgm(resolve(out, 'lungs-source-mask.pgm'));
const v2 = byEntity(compileSpatialPlanV2(lungsPlan).root), v3 = byEntity(compileWithRouter(lungsPlan, { limits: { maxGridCells: 96 } }).root);
results.E1_lungs_vs_source_image = { note: 'Source: reports/acceptance/inputs/lungs.webp (illustration). Plan: HAND-AUTHORED reproduction (not Meta output). Silhouette IoU after fitting by height; best of 91 views.', V2: bestView(all(v2), src), V3: bestView(all(v3), src) };
console.log('E1', JSON.stringify(results.E1_lungs_vs_source_image));

// ---------------------------------------------------------------------------------------------------- E2
type Case = { name: string; file: string; origin: string };
const CASES: Case[] = [
  { name: 'lungs-like', file: 'reports/fidelity-v3/fixtures/lungs-like.json', origin: 'hand-authored reproduction' },
  { name: 'microscope-like', file: 'reports/fidelity-v3/fixtures/microscope-like.json', origin: 'hand-authored reproduction' },
  { name: 'excavator (saved Meta plan)', file: 'reports/universal-spatial-v2/evidence/live-image-plan.json', origin: 'saved Meta plan, old repair step' },
  { name: 'harp (saved Meta plan)', file: 'reports/universal-spatial-v2/evidence/blind-harp-plan.json', origin: 'saved Meta plan, old repair step' },
];
const e2: Record<string, unknown> = {};
for (const c of CASES) {
  const p = await plan(c.file), compiled = compileSpatialPlanV2(p), tris = byEntity(compiled.root);
  // ground-truth solid: the plan's own implicit shapes (components without a distance field are left out of this experiment, listed below)
  const groups = new Map<string, Matrix4>(); compiled.root.traverse((o) => { if (o.userData.spatialComponentRoot) groups.set(o.userData.spatialEntityId as string, o.matrixWorld.clone()); });
  const solids = p.components.map((comp) => { const sh = implicitShapesOf(comp.geometry); return 'code' in sh || !sh.length ? null : { id: comp.id, field: unionFieldCulled(sh, 0), inv: groups.get(comp.id)!.clone().invert() }; }).filter((s): s is NonNullable<typeof s> => !!s);
  const skipped = p.components.filter((comp) => !solids.some((s) => s.id === comp.id)).map((comp) => comp.id), kept = new Map([...tris].filter(([id]) => solids.some((s) => s.id === id)));
  const box = bboxOf(all(kept)), centre = box.getCenter(new Vector3()), half = box.getSize(new Vector3()).length() / 2 * 1.02, N = 96, grid = gridFor(centre, half, N), pt = new Vector3();
  const gtOwner = new Int16Array(N ** 3).fill(-1); // which component owns each ground-truth voxel (first hit)
  for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { pt.set(grid.min.x + (i + 0.5) * grid.size, grid.min.y + (j + 0.5) * grid.size, grid.min.z + (k + 0.5) * grid.size); for (let s = 0; s < solids.length; s++) { const q = pt.clone().applyMatrix4(solids[s]!.inv); if (solids[s]!.field(q.x, q.y, q.z) < 0) { gtOwner[i + N * (j + N * k)] = s; break; } } }
  const gtCount = gtOwner.reduce((s, v) => s + (v >= 0 ? 1 : 0), 0), rows: Array<Record<string, unknown>> = [];
  for (const K of [1, 3, 6, 12, 24]) {
    const views: View[] = viewDirections(K).map((d) => makeView(d, centre, half, 192)), masks = views.map((v) => rasterise(all(kept), v)), hull = carve(grid, views, masks);
    let inter = 0, hullCount = 0; const retained = new Array(solids.length).fill(0), total = new Array(solids.length).fill(0);
    for (let n = 0; n < hull.length; n++) { hullCount += hull[n]!; if (gtOwner[n]! >= 0) { total[gtOwner[n]!]++; if (hull[n]) { inter++; retained[gtOwner[n]!]++; } } }
    const union = gtCount + hullCount - inter, MIN = 200, perComponent = solids.map((s, i) => ({ id: s.id, voxels: total[i], retained: round(retained[i] / Math.max(1, total[i]), 3) })).filter((x) => x.voxels >= MIN), worst = perComponent.reduce((a, b) => (b.retained < a.retained ? b : a)); // parts with fewer exclusive voxels are thinner than the grid can judge: not scored
    rows.push({ views: K, volumeIoU: round(inter / union), excessVolumePct: round((100 * (hullCount - inter)) / gtCount, 1), worstComponentRetained: { id: worst.id, retained: worst.retained }, scoredComponents: perComponent.length });
  }
  e2[c.name] = { origin: c.origin, groundTruth: 'the plan\'s own implicit solids (a plan is the ground truth here, NOT a photographed real object)', components: p.components.length, skippedWithoutDistanceField: skipped, grid: N, rows };
  console.log('E2', c.name, rows.map((r) => `${r.views}v IoU ${r.volumeIoU} +${r.excessVolumePct}%`).join(' | '));
}
results.E2_visual_hull_vs_ground_truth = e2;

// ---------------------------------------------------------------------------------------------------- E3
/** Coordinate descent over per-component 2D scale/translation in the image plane (front view), scoring silhouette IoU with the source mask. */
function refine(entities: Map<string, Tri[]>, srcMask: { w: number; h: number; data: Uint8Array }, azRad: number, elRad: number) {
  const ids = [...entities.keys()], params = new Map(ids.map((id) => [id, { s: 1, dx: 0, dy: 0 }])), box = bboxOf([...entities.values()].flat()), span = Math.max(...box.getSize(new Vector3()).toArray());
  const dir = new Vector3(Math.sin(azRad) * Math.cos(elRad), Math.sin(elRad), Math.cos(azRad) * Math.cos(elRad)), basis = makeView(dir, box.getCenter(new Vector3()), 1, 2);
  const apply = (): Tri[] => ids.flatMap((id) => { const q = params.get(id)!, tris = entities.get(id)!, cb = bboxOf(tris).getCenter(new Vector3()); return tris.map((t) => t.map((p) => { const d = p.clone().sub(cb), inPlane = d.clone().sub(basis.direction.clone().multiplyScalar(d.dot(basis.direction))), rest = d.clone().sub(inPlane); return cb.clone().add(rest).add(inPlane.multiplyScalar(q.s)).addScaledVector(basis.right, q.dx * span).addScaledVector(basis.up, q.dy * span); }) as Tri); });
  const score = () => maskIoU(fitted(apply(), azRad, elRad, srcMask), srcMask.data), start = score(); let best = start;
  for (let sweep = 0; sweep < 3; sweep++) for (const id of ids) for (const key of ['s', 'dx', 'dy'] as const) for (const step of key === 's' ? [0.1, -0.1, 0.05, -0.05] : [0.04, -0.04, 0.02, -0.02]) {
    const q = params.get(id)!, old = q[key]; q[key] = old + step; if (q.s < 0.6 || q.s > 1.6 || Math.abs(q.dx) > 0.25 || Math.abs(q.dy) > 0.25) { q[key] = old; continue; }
    const s = score(); if (s > best + 1e-4) best = s; else q[key] = old;
  }
  return { start, end: best, params: Object.fromEntries([...params].map(([id, q]) => [id, { scale: round(q.s, 2), dx: round(q.dx, 3), dy: round(q.dy, 3) }])), apply };
}
{
  const v2best = bestView(all(v2), src), az = (v2best.azDeg * Math.PI) / 180, el = (v2best.elDeg * Math.PI) / 180, r = refine(v2, src, az, el);
  // held-out check: the refinement only saw ONE view of an illustration, so a different view of the SAME plan must not become worse than the plan itself is
  const side = (tris: Tri[]) => { const b = bboxOf(tris), views = [0.5, 1.0].map((a) => makeView(new Vector3(Math.sin(a), 0, Math.cos(a)), b.getCenter(new Vector3()), 3, 128)); return views.map((v) => rasterise(tris, v)); };
  const base = side(all(v2)), refined = side(r.apply()), drift = base.map((m, i) => round(1 - maskIoU(m, refined[i]!)));
  results.E3_silhouette_refinement_lungs = { note: 'Hypothesis-level proposal: moves/scales components in the image plane of the best view to fit the source silhouette. One view of one illustration under-constrains depth and parts hidden by others.', view: v2best, iouBefore: round(r.start), iouAfter: round(r.end), proposedChanges: r.params, silhouetteDriftInOtherViews_1_minusIoU: drift };
  console.log('E3', JSON.stringify({ before: round(r.start), after: round(r.end), drift }));
}
await writeFile(resolve(out, 'baseline-results.json'), `${JSON.stringify({ generatedBy: 'scripts/benchmark/v4-baseline.ts', results }, null, 2)}\n`);
