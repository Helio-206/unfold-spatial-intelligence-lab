/**
 * Structure of a reconstruction, MEASURED from it (never asserted): which parts touch and over how much surface, which pairs are mirror images of each other,
 * which elongated parts are parallel, and for every part and every view how much of it that view actually sees (so occlusion is explicit: a part seen by fewer
 * than two views is reported as insufficiently observed). These are the verifiable relations a later functional engine can start from; none of them is a
 * constraint the solver enforces, and none names what a part IS.
 */
import { Vector3 } from 'three';
import { orbitDirection, viewProjector } from '../../universal-spatial/reconstruction/multiview';
import type { RealityModel } from './model';

export type Contact = { a: string; b: string; /** shared face area as a fraction of the smaller part's surface */ areaFraction: number };
export type Symmetry = { a: string; b: string; axis: 'x' | 'y' | 'z'; iou: number };
export type Alignment = { a: string; b: string; angleDeg: number; elongationA: number; elongationB: number };
export type Visibility = { partId: string; perView: Array<{ viewId: string; visible: number }>; observedViews: number; status: 'observed' | 'weakly_observed' | 'unobserved' };
export type Structure = { contacts: Contact[]; symmetries: Symmetry[]; alignments: Alignment[]; visibility: Visibility[] };

export const STRUCTURE_THRESHOLDS = { mirrorIoU: 0.6, parallelDeg: 8, minElongation: 2, minVisible: 0.05, minViews: 2, minVoxels: 40 } as const;

export function analyseStructure(model: RealityModel): Structure {
  const { grid, occupancy, labels } = model.solid, [nx, ny, nz] = grid.cells, T = STRUCTURE_THRESHOLDS;
  const idOf = (label: number) => `part-${label}`, at = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  const inside = (i: number, j: number, k: number) => i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz;
  const ids = new Set(model.parts.map((p) => p.id));
  // surface voxels and per-part voxel lists
  const surface: Array<{ i: number; j: number; k: number; label: number }> = [], voxels = new Map<number, Array<[number, number, number]>>();
  const surfaceCount = new Map<number, number>(), contactCount = new Map<string, number>();
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const l = labels[at(i, j, k)]!; if (!l || !occupancy[at(i, j, k)]) continue;
    (voxels.get(l) ?? voxels.set(l, []).get(l)!).push([i, j, k]);
    let exposed = false;
    for (const [di, dj, dk] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
      const a = i + di, b = j + dj, c = k + dk;
      if (!inside(a, b, c) || !occupancy[at(a, b, c)]) exposed = true;
      else { const o = labels[at(a, b, c)]!; if (o && o !== l && l < o) contactCount.set(`${l}|${o}`, (contactCount.get(`${l}|${o}`) ?? 0) + 1); }
    }
    if (exposed) { surface.push({ i, j, k, label: l }); surfaceCount.set(l, (surfaceCount.get(l) ?? 0) + 1); }
  }
  const contacts: Contact[] = [];
  for (const [key, n] of [...contactCount.entries()].sort()) {
    const [l, o] = key.split('|').map(Number) as [number, number]; if (!ids.has(idOf(l)) || !ids.has(idOf(o))) continue;
    const denom = Math.max(1, Math.min((surfaceCount.get(l) ?? 0) + n, (surfaceCount.get(o) ?? 0) + n));
    contacts.push({ a: idOf(l), b: idOf(o), areaFraction: +Math.min(1, n / denom).toFixed(3) });
  }
  // mirror symmetry: reflect A about the plane midway between the two centroids along each world axis, compare with B
  const key3 = (i: number, j: number, k: number) => i + nx * (j + ny * k), sets = new Map<number, Set<number>>();
  for (const [l, list] of voxels) sets.set(l, new Set(list.map(([i, j, k]) => key3(i, j, k))));
  const centroid = (list: Array<[number, number, number]>) => { const c = [0, 0, 0]; for (const v of list) { c[0]! += v[0]; c[1]! += v[1]; c[2]! += v[2]; } return c.map((x) => x / list.length) as [number, number, number]; };
  const symmetries: Symmetry[] = [], labelsList = [...voxels.keys()].sort((a, b) => a - b).filter((l) => voxels.get(l)!.length >= T.minVoxels);
  for (let x = 0; x < labelsList.length; x++) for (let y = x + 1; y < labelsList.length; y++) {
    const la = labelsList[x]!, lb = labelsList[y]!, A = voxels.get(la)!, B = sets.get(lb)!, ca = centroid(A), cb = centroid(voxels.get(lb)!);
    if (Math.max(A.length, B.size) / Math.min(A.length, B.size) > 1.6) continue; // mirror images have similar volume
    let best: Symmetry | null = null;
    for (const [axis, ax] of [['x', 0], ['y', 1], ['z', 2]] as const) {
      const plane = (ca[ax]! + cb[ax]!) / 2; if (Math.abs(ca[ax]! - cb[ax]!) < 2) continue; // too close to reflect across
      let inter = 0; for (const [i, j, k] of A) { const p: [number, number, number] = [i, j, k]; p[ax] = Math.round(2 * plane - p[ax]); if (inside(p[0], p[1], p[2]) && B.has(key3(p[0], p[1], p[2]))) inter++; }
      const iou = inter / (A.length + B.size - inter); if (iou >= T.mirrorIoU && (!best || iou > best.iou)) best = { a: idOf(la), b: idOf(lb), axis, iou: +iou.toFixed(3) };
    }
    if (best && ids.has(best.a) && ids.has(best.b)) symmetries.push(best);
  }
  // parallel elongated parts: principal axis from the covariance of voxel centres
  const principal = (list: Array<[number, number, number]>) => {
    const c = centroid(list); let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
    for (const v of list) { const dx = v[0] - c[0], dy = v[1] - c[1], dz = v[2] - c[2]; xx += dx * dx; xy += dx * dy; xz += dx * dz; yy += dy * dy; yz += dy * dz; zz += dz * dz; }
    let v = new Vector3(1, 0.7, 0.3).normalize(); for (let it = 0; it < 30; it++) v = new Vector3(xx * v.x + xy * v.y + xz * v.z, xy * v.x + yy * v.y + yz * v.z, xz * v.x + yz * v.y + zz * v.z).normalize();
    const l1 = v.x * (xx * v.x + xy * v.y + xz * v.z) + v.y * (xy * v.x + yy * v.y + yz * v.z) + v.z * (xz * v.x + yz * v.y + zz * v.z);
    const trace = xx + yy + zz, l23 = Math.max(1e-9, (trace - l1) / 2);
    return { axis: v, elongation: Math.sqrt(Math.max(l1, 1e-9) / l23) };
  };
  const axes = new Map<number, { axis: Vector3; elongation: number }>(); for (const l of labelsList) axes.set(l, principal(voxels.get(l)!));
  const alignments: Alignment[] = [];
  for (let x = 0; x < labelsList.length; x++) for (let y = x + 1; y < labelsList.length; y++) {
    const A = axes.get(labelsList[x]!)!, B = axes.get(labelsList[y]!)!; if (A.elongation < T.minElongation || B.elongation < T.minElongation) continue;
    const angle = (Math.acos(Math.min(1, Math.abs(A.axis.dot(B.axis)))) * 180) / Math.PI;
    if (angle <= T.parallelDeg) alignments.push({ a: idOf(labelsList[x]!), b: idOf(labelsList[y]!), angleDeg: +angle.toFixed(1), elongationA: +A.elongation.toFixed(2), elongationB: +B.elongation.toFixed(2) });
  }
  // visibility / occlusion: a z-buffer of the whole solid per view, then the visible share of each part's exposed voxels
  const visibility: Visibility[] = model.parts.map((p) => ({ partId: p.id, perView: [], observedViews: 0, status: 'unobserved' as const }));
  const res = 128, half = model.frame.half, s = res / (2 * half), size = grid.size;
  for (const v of model.evidence.views) {
    const cam = model.evidence.camera, pj = viewProjector({ id: v.id, res, mask: new Uint8Array(res * res), azimuthDeg: v.azimuthDeg, elevationDeg: v.elevationDeg, azimuthSource: 'given', ...(cam ? { fovDeg: cam.fovDeg, principalShiftPx: cam.principalShiftPx * (res / model.evidence.res) } : {}) }, { centre: model.frame.centre, half });
    const d = orbitDirection(v.azimuthDeg, v.elevationDeg);
    const depth = new Float32Array(res * res).fill(-Infinity), proj = (i: number, j: number, k: number) => { const x = grid.min.x + (i + 0.5) * size - model.frame.centre.x, y = grid.min.y + (j + 0.5) * size - model.frame.centre.y, z = grid.min.z + (k + 0.5) * size - model.frame.centre.z; const uv = pj.project(x + model.frame.centre.x, y + model.frame.centre.y, z + model.frame.centre.z) ?? [-1e6, -1e6]; return { u: uv[0], w: uv[1], t: x * d.x + y * d.y + z * d.z }; };
    const r = Math.max(1, Math.ceil((size * s) / 2));
    for (const sv of surface) { const { u, w, t } = proj(sv.i, sv.j, sv.k); for (let yy = Math.max(0, Math.floor(w) - r); yy <= Math.min(res - 1, Math.floor(w) + r); yy++) for (let xx = Math.max(0, Math.floor(u) - r); xx <= Math.min(res - 1, Math.floor(u) + r); xx++) if (t > depth[yy * res + xx]!) depth[yy * res + xx] = t; }
    const seen = new Map<number, number>();
    for (const sv of surface) { const { u, w, t } = proj(sv.i, sv.j, sv.k), px = Math.floor(u), py = Math.floor(w); if (px < 0 || py < 0 || px >= res || py >= res) continue; if (t >= depth[py * res + px]! - 1.5 * size) seen.set(sv.label, (seen.get(sv.label) ?? 0) + 1); }
    for (const vis of visibility) { const l = Number(vis.partId.replace('part-', '')), total = surfaceCount.get(l) ?? 0; vis.perView.push({ viewId: v.id, visible: total ? +((seen.get(l) ?? 0) / total).toFixed(3) : 0 }); }
  }
  for (const vis of visibility) { vis.observedViews = vis.perView.filter((x) => x.visible >= T.minVisible).length; vis.status = vis.observedViews >= T.minViews ? 'observed' : vis.observedViews === 1 ? 'weakly_observed' : 'unobserved'; }
  return { contacts, symmetries, alignments, visibility };
}
