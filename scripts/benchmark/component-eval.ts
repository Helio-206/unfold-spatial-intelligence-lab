// Component recovery on the PRODUCT PATH: cached perspective renders (exact alpha) -> intakeOrbit -> buildModel -> labels vs the GT glTF node structure.
// Variants are label functions over the same model so a method is adopted only when it beats the baseline on development AND acceptance assets.
//   npx tsx scripts/benchmark/component-eval.ts [--variant name,name] [--assets A,B]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Box3, Vector3 } from 'three';
import { readGlbParts } from '../../src/universal-spatial/reconstruction/glb-geometry';
import type { Tri } from '../../src/universal-spatial/reconstruction/silhouette';
import { samplePoints, chamfer, geometryPoints } from '../../src/universal-spatial/reconstruction/multiview-metrics';
import { reconstructHull } from '../../src/universal-spatial/reconstruction/multiview';
import { intakeOrbit, type IntakeImage } from '../../src/living/reality/intake';
import { buildModel, viewsOf, type RealityModel } from '../../src/living/reality/model';
import { VARIANTS } from './component-variants';
import { applyPartEdits, segmentParts, type PartEdit } from '../../src/universal-spatial/reconstruction/parts';
import { gtVoxelLabels, scoreLabels } from './component-metrics';

const W = 480, H = 360, FILL = 0.55, arg = (n: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1]! : null);
const GT = (arg('--gt') ?? 'nodes') as 'nodes' | 'shells', only = arg('--assets')?.split(',') ?? null, variants = (arg('--variant')?.split(',') ?? ['baseline']);
const manifest = JSON.parse(readFileSync(resolve('reports/reality-engine/benchmark/manifest.json'), 'utf8')) as { assets: Array<{ id: string; split: string }> };
const frames = (id: string, set: string, n: number): IntakeImage[] => {
  const buf = gunzipSync(readFileSync(resolve('scripts/benchmark/cache', `${id}.${set}.rgba.gz`))), sz = W * H * 4;
  return Array.from({ length: n }, (_, i) => { const data = new Uint8ClampedArray(buf.subarray(i * sz, (i + 1) * sz)), mask = new Uint8Array(W * H); for (let k = 0; k < mask.length; k++) mask[k] = data[k * 4 + 3]! > 127 ? 1 : 0; return { name: `${id}-${i}`, rgba: { width: W, height: H, data }, mask, maskSource: 'confirmed' as const }; });
};
/** physical shells: connected components (shared/welded vertices) of every node's triangles */
const shellsOf = (nodes: Array<{ tris: Tri[] }>): Array<{ tris: Tri[] }> => {
  const out: Array<{ tris: Tri[] }> = [];
  for (const n of nodes) {
    const q = (v: Vector3) => `${Math.round(v.x * 2e4)},${Math.round(v.y * 2e4)},${Math.round(v.z * 2e4)}`, parent = n.tris.map((_, i) => i), find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]!]!; x = parent[x]!; } return x; }, first = new Map<string, number>();
    n.tris.forEach((t, i) => t.forEach((v) => { const k = q(v), f = first.get(k); if (f === undefined) first.set(k, i); else { const a = find(f), b = find(i); if (a !== b) parent[b] = a; } }));
    const groups = new Map<number, Tri[]>(); n.tris.forEach((t, i) => { const r = find(i); (groups.get(r) ?? groups.set(r, []).get(r)!).push(t); }); for (const g of groups.values()) out.push({ tris: g });
  }
  return out;
};
const rows: Array<Record<string, unknown>> = [];
for (const asset of manifest.assets) {
  if (only && !only.includes(asset.id)) continue;
  const parts = readGlbParts(new Uint8Array(readFileSync(resolve('reports/reality-engine/benchmark/assets', asset.id, `${asset.id}.glb`)))), tris: Tri[] = parts.flatMap((p) => p.tris);
  const box = new Box3(); for (const t of tris) for (const p of t) box.expandByPoint(p); const c = box.getCenter(new Vector3()), height = box.getSize(new Vector3()).y;
  const norm = (ts: Tri[], mirror: 0 | 1 | 2): Tri[] => ts.map((t) => t.map((p) => { const q = p.clone().sub(c).multiplyScalar(FILL / height); if (mirror === 1) q.x = -q.x; if (mirror === 2) q.z = -q.z; return q; }) as Tri);
  const photos = frames(asset.id, 'turn8', 8), intake = intakeOrbit(photos, { elevationDeg: 20 });
  if (!intake.evidence) { console.log(asset.id, 'REFUSED'); continue; }
  const model = buildModel(intake.evidence), hullPts = geometryPoints(reconstructHull(viewsOf(intake.evidence), { frame: model.frame, cells: intake.evidence.cells }).geometry, 3000, 3);
  // direction/handedness is not a component question: pick the GT orientation (identity or one mirror) closest to the reconstruction
  let best = { m: 0 as 0 | 1 | 2, d: Infinity, shift: new Vector3() }; const cen = (a: Vector3[]) => a.reduce((s, v) => s.add(v), new Vector3()).multiplyScalar(1 / a.length);
  for (const m of [0, 1, 2] as const) { const g = samplePoints(norm(tris, m), 4000, 2), shift = cen(g).sub(cen(hullPts)), d = chamfer(hullPts.map((q) => q.clone().add(shift)), g).symmetric; if (d < best.d) best = { m, d, shift }; }
  const gtParts = (GT === 'shells' ? shellsOf(parts) : parts).map((p) => ({ tris: norm(p.tris, best.m).map((t) => t.map((q) => q.clone().sub(best.shift)) as Tri) }));
  const gtLab = gtVoxelLabels(gtParts, model.solid.grid, model.solid.occupancy, model.solid.occupancy, Number(arg('--near') ?? Infinity) * model.solid.grid.size);
  const row: Record<string, unknown> = { id: asset.id, split: asset.split, gtParts: gtParts.length, mirror: best.m };
  for (const v of variants) {
    if (v.startsWith('assisted')) { // ORACLE-SIMULATED user (reference known): greedy best correction among merges and axis-plane splits, at most K edits. Not a real user.
      const K = Number(v.split('-')[1] ?? 4), grid = model.solid.grid, occ = model.solid.occupancy, base = segmentParts(occ, grid); let cur = applyPartEdits(base, occ, grid, []), best = scoreLabels(gtLab, cur.labels).ari; const edits: PartEdit[] = [];
      const seedOf = (id: string): [number, number, number] | null => { const part = cur.parts.find((p) => p.id === id); if (!part) return null; const [nx, ny] = grid.cells, l = part.label; let bd = Infinity, o: [number, number, number] | null = null; for (let i = 0; i < cur.labels.length; i++) if (cur.labels[i] === l) { const x = grid.min.x + ((i % nx) + 0.5) * grid.size, y = grid.min.y + ((Math.floor(i / nx) % ny) + 0.5) * grid.size, z = grid.min.z + (Math.floor(i / (nx * ny)) + 0.5) * grid.size, d = (x - part.centroid.x) ** 2 + (y - part.centroid.y) ** 2 + (z - part.centroid.z) ** 2; if (d < bd) { bd = d; o = [x, y, z]; } } return o; };
      for (let step = 0; step < K; step++) {
        let cand: { edit: PartEdit; ari: number } | null = null;
        for (const [a, b] of cur.adjacency) { const sa = seedOf(a), sb = seedOf(b); if (!sa || !sb) continue; const e: PartEdit = { kind: 'merge', seeds: [sa, sb] }, r = applyPartEdits(base, occ, grid, [...edits, e]), ari = scoreLabels(gtLab, r.labels).ari; if (!cand || ari > cand.ari) cand = { edit: e, ari }; }
        for (const part of cur.parts) { const sd = seedOf(part.id); if (!sd) continue; for (const [axis, ax] of [['x', 0], ['y', 1], ['z', 2]] as const) for (const f of [0.25, 0.4, 0.5, 0.6, 0.75]) { const lo = [part.min.x, part.min.y, part.min.z][ax]!, hi = [part.max.x, part.max.y, part.max.z][ax]!, e: PartEdit = { kind: 'split', seed: sd, axis, at: lo + f * (hi - lo) }, r = applyPartEdits(base, occ, grid, [...edits, e]); if (r.reports.at(-1)!.applied) { const ari = scoreLabels(gtLab, r.labels).ari; if (!cand || ari > cand.ari) cand = { edit: e, ari }; } } }
        if (!cand || cand.ari < best + 0.01) break; edits.push(cand.edit); best = cand.ari; cur = applyPartEdits(base, occ, grid, edits);
      }
      row[v] = { ...scoreLabels(gtLab, cur.labels), edits: edits.length }; continue;
    }
    const labels = VARIANTS[v]!(model, intake.evidence, photos); row[v] = scoreLabels(gtLab, labels);
  }
  if (process.env.CONT) { for (const v of variants) { const labels = VARIANTS[v]!(model, intake.evidence, photos), c = new Map<string, number>(); for (let i = 0; i < gtLab.length; i++) if (gtLab[i]! >= 0) c.set(`gt${gtLab[i]}→${v}${labels[i]}`, (c.get(`gt${gtLab[i]}→${v}${labels[i]}`) ?? 0) + 1); console.log(asset.id, v, [...c.entries()].sort().map(([k, n]) => `${k}:${n}`).join('  ')); } console.log('gt names', parts.map((p, i) => `${i}:${(p as { name?: string }).name ?? '?'}(${p.tris.length})`).join(' ')); }
  rows.push(row); console.log(JSON.stringify(row));
}
const agg = Object.fromEntries(variants.map((v) => [v, Object.fromEntries(['development', 'acceptance'].map((s) => { const r = rows.filter((x) => x.split === s), sc = r.map((x) => x[v] as ReturnType<typeof scoreLabels>); return [s, { assets: r.length, recovered: sc.reduce((n, x) => n + x.gtPartsRecovered, 0), significant: sc.reduce((n, x) => n + x.gtSignificantParts, 0), meanARI: +(sc.reduce((n, x) => n + x.ari, 0) / Math.max(1, sc.length)).toFixed(3), meanWeightedIoU: +(sc.reduce((n, x) => n + x.weightedBestIoU, 0) / Math.max(1, sc.length)).toFixed(3), meanPurity: +(sc.reduce((n, x) => n + x.purity, 0) / Math.max(1, sc.length)).toFixed(3) }]; }))]));
console.log(JSON.stringify(agg, null, 1));
if (!only) writeFileSync(resolve(`reports/reality-engine/benchmark/components-product${GT === 'shells' ? '-shells' : ''}.json`), JSON.stringify({ note: 'Product path (8 perspective renders at 20 deg elevation, exact-alpha masks, assumed poses) vs GT glTF nodes. Recovered = GT part (>=3% voxels) matched with IoU >= 0.5.', variants, aggregate: agg, rows }, null, 2) + '\n');
if (process.env.CONT) { /* debug: contingency of last asset */ }
