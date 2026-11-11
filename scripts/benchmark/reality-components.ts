// Component understanding vs the ground truth's own part structure (glTF nodes). The hull's voxels are labelled by the GT part owning the nearest surface point;
// the reconstruction's parts are compared with that labelling (adjusted Rand index, volume-weighted best IoU per GT part, purity of our parts).
// GT node structure is the asset author's, not a perfect semantic truth: it is the best independent reference available.
//   npx tsx scripts/benchmark/reality-components.ts [outFile]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Box3, Vector3 } from 'three';
import { readGlbParts } from '../../src/universal-spatial/reconstruction/glb-geometry';
import { makeView, rasterise, type Tri } from '../../src/universal-spatial/reconstruction/silhouette';
import { orbitDirection } from '../../src/universal-spatial/reconstruction/multiview';
import { samplePoints } from '../../src/universal-spatial/reconstruction/multiview-metrics';
import { buildModel, FRAME_HALF_PER_DIAGONAL } from '../../src/living/reality/model';
import { encodeMask, type RealityEvidence } from '../../src/living/reality/evidence';

const manifest = JSON.parse(readFileSync(resolve('reports/reality-engine/benchmark/manifest.json'), 'utf8')) as { assets: Array<{ id: string; split: string }> };
const POSES: Array<[number, number]> = [[0, 0], [60, 0], [120, 0], [180, 0], [240, 0], [300, 0], [30, 35], [90, 35], [150, 35], [210, 35], [270, 35], [330, 35], [0, 70], [180, 70]];
const rows: Array<Record<string, unknown>> = [];
const comb2 = (n: number) => (n * (n - 1)) / 2;
for (const a of manifest.assets) {
  const parts = readGlbParts(new Uint8Array(readFileSync(resolve('reports/reality-engine/benchmark/assets', a.id, `${a.id}.glb`))));
  const tris: Tri[] = parts.flatMap((p) => p.tris), owner: number[] = parts.flatMap((p, i) => p.tris.map(() => i));
  const box = new Box3(); for (const t of tris) for (const p of t) box.expandByPoint(p); const c = box.getCenter(new Vector3()), diag = box.getSize(new Vector3()).length(), half = FRAME_HALF_PER_DIAGONAL * diag;
  const ev: RealityEvidence = { contract: 'unfold.reality-evidence.v1', mode: 'orbit', res: 160, colourRes: 16, cells: 96, frame: { centre: [c.x, c.y, c.z], half }, views: POSES.map(([az, el], i) => ({ id: `v${i}`, name: 'x', azimuthDeg: az, elevationDeg: el, azimuthSource: 'given' as const, maskRle: encodeMask(rasterise(tris, makeView(orbitDirection(az, el), c, half, 160))) })), assumptions: [] };
  const model = buildModel(ev, { parts: { persistence: Number(process.env.P ?? 0.4), minVoxels: Number(process.env.MV ?? 30) } }), grid = model.solid.grid, [nx, ny, nz] = grid.cells;
  // surface samples carrying their GT part
  const per = tris.map((t) => new Vector3().crossVectors(t[1].clone().sub(t[0]), t[2].clone().sub(t[0])).length() / 2), total = per.reduce((s, v) => s + v, 0);
  const pts: Array<{ p: Vector3; part: number }> = []; parts.forEach((gp, gi) => { const area = gp.tris.reduce((s, _t, k) => s + per[owner.indexOf(gi) + k]!, 0), n = Math.max(0, Math.round((area / total) * 20000)); for (const q of samplePoints(gp.tris, n, gi + 3)) pts.push({ p: q, part: gi }); });
  const cell = grid.size * 3, hash = new Map<string, Array<{ p: Vector3; part: number }>>(), key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  for (const q of pts) { const k = key(Math.floor(q.p.x / cell), Math.floor(q.p.y / cell), Math.floor(q.p.z / cell)); (hash.get(k) ?? hash.set(k, []).get(k)!).push(q); }
  const nearestPart = (x: number, y: number, z: number): number => { let best = -1, bd = Infinity; const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    for (let r = 0; r < 6 && best < 0; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) { if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue; const b = hash.get(key(cx + dx, cy + dy, cz + dz)); if (b) for (const q of b) { const d = (q.p.x - x) ** 2 + (q.p.y - y) ** 2 + (q.p.z - z) ** 2; if (d < bd) { bd = d; best = q.part; } } }
    return best; };
  const gtLab = new Int32Array(model.solid.occupancy.length).fill(-1), ourLab = model.solid.labels; let n = 0;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const id = i + nx * (j + ny * k); if (!model.solid.occupancy[id] || !ourLab[id]) continue; gtLab[id] = nearestPart(grid.min.x + (i + 0.5) * grid.size, grid.min.y + (j + 0.5) * grid.size, grid.min.z + (k + 0.5) * grid.size); n++; }
  // contingency
  const cont = new Map<string, number>(), rowS = new Map<number, number>(), colS = new Map<number, number>();
  for (let id = 0; id < gtLab.length; id++) if (gtLab[id]! >= 0 && ourLab[id]) { const g = gtLab[id]!, o = ourLab[id]!; cont.set(`${g}|${o}`, (cont.get(`${g}|${o}`) ?? 0) + 1); rowS.set(g, (rowS.get(g) ?? 0) + 1); colS.set(o, (colS.get(o) ?? 0) + 1); }
  let sumC = 0; for (const v of cont.values()) sumC += comb2(v); let sumR = 0; for (const v of rowS.values()) sumR += comb2(v); let sumK = 0; for (const v of colS.values()) sumK += comb2(v);
  const expected = (sumR * sumK) / comb2(n), maxIdx = (sumR + sumK) / 2, ari = maxIdx - expected ? (sumC - expected) / (maxIdx - expected) : 1;
  // volume-weighted best IoU per GT part (only parts holding >= 3% of the voxels)
  let wIoU = 0, wTot = 0, recovered = 0, significant = 0;
  for (const [g, gv] of rowS) { if (gv < 0.03 * n) continue; significant++; let best = 0; for (const [o, ov] of colS) { const inter = cont.get(`${g}|${o}`) ?? 0, iou = inter / (gv + ov - inter); if (iou > best) best = iou; } wIoU += best * gv; wTot += gv; if (best >= 0.5) recovered++; }
  let pure = 0; for (const [o, ov] of colS) { let m = 0; for (const [g] of rowS) m = Math.max(m, cont.get(`${g}|${o}`) ?? 0); pure += m; }
  rows.push({ id: a.id, split: a.split, gtParts: parts.length, gtSignificantParts: significant, ourParts: model.parts.length, ari: +ari.toFixed(3), weightedBestIoU: +(wTot ? wIoU / wTot : 0).toFixed(3), gtPartsRecovered: recovered, purity: +(pure / n).toFixed(3) });
  console.log(JSON.stringify(rows.at(-1)));
}
writeFileSync(resolve(process.argv[2] ?? 'reports/reality-engine/benchmark/components.json'), JSON.stringify({ note: 'Reconstruction parts vs the GT glTF node structure, ortho 14 views, known cameras. ARI = adjusted Rand index over hull voxels; recovered = GT parts (>=3% of voxels) matched with IoU >= 0.5.', rows }, null, 2) + '\n');
