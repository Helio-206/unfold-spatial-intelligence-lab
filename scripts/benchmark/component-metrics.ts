// Component-recovery metrics shared by the component experiments: labelled voxels of a reconstruction vs the ground-truth glTF node structure.
import { Vector3 } from 'three';
import type { Grid, Tri } from '../../src/universal-spatial/reconstruction/silhouette';
import { samplePoints } from '../../src/universal-spatial/reconstruction/multiview-metrics';

const comb2 = (n: number) => (n * (n - 1)) / 2;
export type GtPart = { tris: Tri[] };
/** label each occupied voxel with the GT part owning the nearest GT surface sample */
export function gtVoxelLabels(parts: GtPart[], grid: Grid, occupancy: Uint8Array, mask: Uint8Array | Uint16Array, maxDist = Infinity): Int32Array {
  const per = (t: Tri) => new Vector3().crossVectors(t[1].clone().sub(t[0]), t[2].clone().sub(t[0])).length() / 2, areas = parts.map((p) => p.tris.reduce((s, t) => s + per(t), 0)), total = areas.reduce((s, v) => s + v, 0);
  const pts: Array<{ p: Vector3; part: number }> = []; parts.forEach((gp, gi) => { const n = Math.max(0, Math.round((areas[gi]! / total) * 24000)); if (n) for (const q of samplePoints(gp.tris, n, gi + 7)) pts.push({ p: q, part: gi }); });
  const cell = grid.size * 3, hash = new Map<string, Array<{ p: Vector3; part: number }>>(), key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  for (const q of pts) { const k = key(Math.floor(q.p.x / cell), Math.floor(q.p.y / cell), Math.floor(q.p.z / cell)); (hash.get(k) ?? hash.set(k, []).get(k)!).push(q); }
  const nearest = (x: number, y: number, z: number): number => { let best = -1, bd = Infinity; const lim = maxDist * maxDist; const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    for (let r = 0; r < 8 && best < 0; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) { if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue; for (const q of hash.get(key(cx + dx, cy + dy, cz + dz)) ?? []) { const d = (q.p.x - x) ** 2 + (q.p.y - y) ** 2 + (q.p.z - z) ** 2; if (d < bd) { bd = d; best = q.part; } } }
    return bd <= lim ? best : -1; };
  const [nx, ny, nz] = grid.cells, out = new Int32Array(occupancy.length).fill(-1);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const id = i + nx * (j + ny * k); if (occupancy[id] && mask[id]) out[id] = nearest(grid.min.x + (i + 0.5) * grid.size, grid.min.y + (j + 0.5) * grid.size, grid.min.z + (k + 0.5) * grid.size); }
  return out;
}
export type ComponentScore = { gtSignificantParts: number; ourParts: number; ari: number; weightedBestIoU: number; gtPartsRecovered: number; purity: number };
export function scoreLabels(gtLab: Int32Array, ourLab: ArrayLike<number>): ComponentScore {
  const cont = new Map<string, number>(), rowS = new Map<number, number>(), colS = new Map<number, number>(); let n = 0;
  for (let id = 0; id < gtLab.length; id++) if (gtLab[id]! >= 0 && ourLab[id]) { const g = gtLab[id]!, o = ourLab[id]!; n++; cont.set(`${g}|${o}`, (cont.get(`${g}|${o}`) ?? 0) + 1); rowS.set(g, (rowS.get(g) ?? 0) + 1); colS.set(o, (colS.get(o) ?? 0) + 1); }
  let sumC = 0, sumR = 0, sumK = 0; for (const v of cont.values()) sumC += comb2(v); for (const v of rowS.values()) sumR += comb2(v); for (const v of colS.values()) sumK += comb2(v);
  const expected = (sumR * sumK) / comb2(n), maxIdx = (sumR + sumK) / 2, ari = maxIdx - expected ? (sumC - expected) / (maxIdx - expected) : 1;
  let wIoU = 0, wTot = 0, recovered = 0, significant = 0;
  for (const [g, gv] of rowS) { if (gv < 0.03 * n) continue; significant++; let best = 0; for (const [o, ov] of colS) { const inter = cont.get(`${g}|${o}`) ?? 0, iou = inter / (gv + ov - inter); if (iou > best) best = iou; } wIoU += best * gv; wTot += gv; if (best >= 0.5) recovered++; }
  let pure = 0; for (const [o] of colS) { let m = 0; for (const [g] of rowS) m = Math.max(m, cont.get(`${g}|${o}`) ?? 0); pure += m; }
  return { gtSignificantParts: significant, ourParts: colS.size, ari: +ari.toFixed(3), weightedBestIoU: +(wTot ? wIoU / wTot : 0).toFixed(3), gtPartsRecovered: recovered, purity: +(n ? pure / n : 0).toFixed(3) };
}
