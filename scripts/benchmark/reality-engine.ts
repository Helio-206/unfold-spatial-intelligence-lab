// Reality Engine benchmark: multi-view reconstruction vs independent 3D ground truth (Khronos assets, licences in manifest.json).
// Inputs are RENDERED silhouettes with known cameras (category A). They are NOT photographs: this measures the geometry engine, not perception.
//   node scripts/benchmark/fetch-reality-assets.mjs && npx tsx scripts/benchmark/reality-engine.ts [outDir] [--quick]
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Box3, Vector3 } from 'three';
import { readGlbParts } from '../../src/universal-spatial/reconstruction/glb-geometry';
import { makeView, rasterise, type Tri } from '../../src/universal-spatial/reconstruction/silhouette';
import { leaveOneOutIoU, orbitDirection, reconstructHull, refinePoses, type Frame, type SilhouetteView } from '../../src/universal-spatial/reconstruction/multiview';
import { chamfer, geometryPoints, nearestDistances, samplePoints } from '../../src/universal-spatial/reconstruction/multiview-metrics';

const out = resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'reports/reality-engine/benchmark/results'), quick = process.argv.includes('--quick');
await mkdir(out, { recursive: true });
const manifest = JSON.parse(await readFile(resolve('reports/reality-engine/benchmark/manifest.json'), 'utf8')) as { assets: Array<{ id: string; kind: string; category: string; split: string; sha256: string; licence: string[] }> };
const RES = 160, CELLS = quick ? 64 : 96, POINTS = 6000; // CELLS 96 = the product setting
const round = (n: number, d = 4) => +n.toFixed(d);
const mean = (x: number[]) => (x.length ? x.reduce((s, v) => s + v, 0) / x.length : NaN);
const iou = (a: Uint8Array, b: Uint8Array) => { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { i += a[k]! & b[k]!; u += a[k]! | b[k]!; } return u ? i / u : 1; };

/** View sets: fixed, declared in advance (not tuned per asset). */
const sets: Record<string, Array<[number, number]>> = {
  '1-view': [[0, 0]],
  '2-view': [[0, 0], [90, 0]],
  '3-view-ortho': [[0, 0], [90, 0], [0, 90]],
  '6-view': [[0, 0], [90, 0], [180, 0], [270, 0], [0, 60], [180, 60]],
  '12-view': [[0, 0], [60, 0], [120, 0], [180, 0], [240, 0], [300, 0], [30, 35], [90, 35], [150, 35], [210, 35], [270, 35], [330, 35]],
};
const heldOutPoses: Array<[number, number]> = [[20, 10], [75, 20], [130, 5], [200, 25], [255, 15], [310, 30], [45, 70], [160, -20]];
const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

const results: Array<Record<string, unknown>> = [];
for (const asset of manifest.assets) {
  const file = resolve('reports/reality-engine/benchmark/assets', asset.id, `${asset.id}.glb`);
  const bytes = new Uint8Array(await readFile(file));
  if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error(`SHA_MISMATCH ${asset.id}`);
  const tris: Tri[] = readGlbParts(bytes).flatMap((p) => p.tris);
  const box = new Box3(); for (const t of tris) for (const p of t) box.expandByPoint(p);
  const centre = box.getCenter(new Vector3()), diag = box.getSize(new Vector3()).length();
  const frame: Frame = { centre, half: 0.5 * diag * 1.08 };
  const gtPts = samplePoints(tris, POINTS, 11);
  const render = (az: number, el: number, id: string, source: 'given' | 'assumed' = 'given'): SilhouetteView => ({ id, res: RES, mask: rasterise(tris, makeView(orbitDirection(az, el), centre, frame.half, RES)), azimuthDeg: az, elevationDeg: el, azimuthSource: source });
  const held = heldOutPoses.map(([a, e], i) => ({ pose: [a, e] as [number, number], mask: rasterise(tris, makeView(orbitDirection(a, e), centre, frame.half, RES)), id: `held${i}` }));
  const row: Record<string, unknown> = { id: asset.id, kind: asset.kind, category: asset.category, split: asset.split, triangles: tris.length, diagonal: round(diag, 3), sets: {} as Record<string, unknown> };
  for (const [name, poses] of Object.entries(sets)) {
    const views = poses.map(([a, e], i) => render(a, e, `${name}-${i}`));
    const hull = reconstructHull(views, { frame, cells: CELLS });
    const hullTris: Tri[] = []; { const p = hull.geometry.getAttribute('position'), idx = hull.geometry.index!; for (let i = 0; i < idx.count; i += 3) hullTris.push([0, 1, 2].map((k) => new Vector3(p.getX(idx.getX(i + k)), p.getY(idx.getX(i + k)), p.getZ(idx.getX(i + k)))) as Tri); }
    const hullPts = geometryPoints(hull.geometry, POINTS, 11), c = chamfer(hullPts, gtPts);
    const heldIoU = held.map((h) => iou(rasterise(hullTris, makeView(orbitDirection(h.pose[0], h.pose[1]), centre, frame.half, RES)), h.mask));
    // support vs accuracy: error of hull vertices grouped by how many views have a contour through them
    const pos = hull.geometry.getAttribute('position'), verts: Vector3[] = []; for (let i = 0; i < pos.count; i++) verts.push(new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
    const d = nearestDistances(verts, gtPts), by: Record<string, number[]> = { one: [], multi: [] };
    verts.forEach((_, i) => (hull.vertexSupport[i]! >= 2 ? by.multi! : by.one!).push(d[i]! / diag));
    const loo = leaveOneOutIoU(views, { frame, cells: 64 });
    // same views with deliberately wrong poses (+-12 deg alternating): the consistency check must notice
    const wrong = views.map((v, i) => ({ ...v, azimuthDeg: v.azimuthDeg + (i % 2 ? 12 : -12) }));
    const looWrong = leaveOneOutIoU(wrong, { frame, cells: 64 });
    (row.sets as Record<string, unknown>)[name] = {
      looIoUMean: loo.length ? round(mean(loo)) : null, looIoUMeanWrongPoses: looWrong.length ? round(mean(looWrong)) : null,
      views: poses.length, accuracyPct: round((c.accuracy / diag) * 100, 3), completenessPct: round((c.completeness / diag) * 100, 3), chamferPct: round((c.symmetric / diag) * 100, 3), p95AccuracyPct: round((c.p95Accuracy / diag) * 100, 3),
      heldOutIoUMean: round(mean(heldIoU)), heldOutIoUMin: round(Math.min(...heldIoU)),
      supportedFraction: round(hull.stats.supportedFraction), errorSupport1Pct: round(mean(by.one!) * 100, 3), errorSupport2PlusPct: round(mean(by.multi!) * 100, 3), nVertsSupport1: by.one!.length, nVertsSupport2Plus: by.multi!.length,
      depthObserved: hull.stats.depthObserved, clipped: hull.stats.clippedByFrame, triangles: hull.geometry.index ? hull.geometry.index.count / 3 : 0, ms: Math.round(hull.stats.ms),
    };
  }
  // camera estimation: nominal turntable azimuths with deterministic +-8 deg error on the 8-view orbit; refine and compare with the truth
  const truthAz = Array.from({ length: 8 }, (_, i) => i * 45), noise = [7, -8, 6, -5, 8, -7, 5, -6].map((v, i) => v * (hash(asset.id + i).charCodeAt(0) % 2 ? 1 : -1));
  const nominal = truthAz.map((a, i) => ({ ...render(a, i % 2 ? 20 : 0, `p${i}`, 'assumed'), azimuthDeg: a + noise[i]! }));
  const t0 = performance.now(), ref = refinePoses(nominal, { frame, cells: quick ? 48 : 64 });
  row.pose = {
    meanAzimuthErrorBeforeDeg: round(mean(nominal.map((v, i) => Math.abs(v.azimuthDeg - truthAz[i]!))), 2), meanAzimuthErrorAfterDeg: round(mean(ref.views.map((v, i) => Math.abs(v.azimuthDeg - truthAz[i]!))), 2),
    consistencyBefore: round(ref.consistencyBefore), consistencyAfter: round(ref.consistencyAfter), identifiableViews: ref.views.filter((v) => v.identifiable).length, ms: Math.round(performance.now() - t0), notes: ref.notes.length,
  };
  results.push(row);
  console.log(asset.id, asset.split, JSON.stringify((row.sets as Record<string, Record<string, unknown>>)['6-view']), JSON.stringify(row.pose));
}
const rss = process.memoryUsage().rss;
await writeFile(resolve(out, 'results.json'), JSON.stringify({ generatedBy: 'scripts/benchmark/reality-engine.ts', note: 'RENDERED views of independent CC0/CC-BY geometry (category A). Not photographs. Distances are percentages of the asset bounding-box diagonal.', res: RES, cells: CELLS, points: POINTS, peakRssMB: Math.round(rss / 1048576), results }, null, 2) + '\n');
console.log('peak RSS MB', Math.round(rss / 1048576));
