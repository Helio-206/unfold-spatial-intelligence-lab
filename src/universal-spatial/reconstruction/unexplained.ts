import { Vector3 } from 'three';
import type { Tri, View } from './silhouette';
import { rasterise } from './silhouette';

/**
 * Regions of the evidence that the plan does not explain, and where a MISSING component may be.
 *
 * A pixel is unexplained when the source silhouette has it and the drawing of the plan does not. Connected unexplained pixels form blobs per view. A blob seen from
 * several independent views whose rays meet in one place in space is a candidate for a missing part: the engine reports where, roughly how big, which existing parts are
 * nearest and how many views support it. It NEVER adds a component, never connects it to anything and never says what it is: a candidate is a prompt for Spatial
 * Understanding or a person. Views are orthographic (their rays are parallel lines); perspective photographs would need their intrinsics.
 */
export type Blob = { view: number; areaPx: number; areaPct: number; centroid: [number, number]; bbox: [number, number, number, number] };
export type MissingCandidate = { centre: Vector3; radius: number; supportViews: number[]; meanAreaPct: number; nearestParts: Array<{ id: string; distance: number }>; confidence: 'low' | 'medium'; note: string };
export type UnexplainedReport = { perView: Array<{ view: number; uncoveredPct: number; excessPct: number; blobs: Blob[] }>; candidates: MissingCandidate[] };
export type UnexplainedOptions = { minBlobPct?: number; minViews?: number; minAngleDeg?: number };

const pixelRay = (view: View, x: number, y: number) => { const s = view.res / (2 * view.half), dr = (x + 0.5) / s - view.half, du = (y + 0.5) / s - view.half; return { point: view.centre.clone().addScaledVector(view.right, dr).addScaledVector(view.up, du), dir: view.direction }; };
const lineDistance = (p1: Vector3, d1: Vector3, p2: Vector3, d2: Vector3) => { // closest points of two lines
  const n = new Vector3().crossVectors(d1, d2), nn = n.lengthSq(); if (nn < 1e-9) return null;
  const w = p2.clone().sub(p1), t1 = new Vector3().crossVectors(w, d2).dot(n) / nn, t2 = new Vector3().crossVectors(w, d1).dot(n) / nn, a = p1.clone().addScaledVector(d1, t1), b = p2.clone().addScaledVector(d2, t2);
  return { gap: a.distanceTo(b), mid: a.clone().add(b).multiplyScalar(0.5) };
};
const distanceToLine = (p: Vector3, a: Vector3, d: Vector3) => p.clone().sub(a).cross(d).length();

export function blobsOf(target: Uint8Array, drawn: Uint8Array, res: number, view: number, minPct: number): { blobs: Blob[]; uncoveredPct: number; excessPct: number } {
  const miss = new Uint8Array(target.length); let area = 0, uncovered = 0, excess = 0;
  for (let k = 0; k < target.length; k++) { area += target[k]!; if (target[k] && !drawn[k]) { miss[k] = 1; uncovered++; } else if (!target[k] && drawn[k]) excess++; }
  const blobs: Blob[] = [];
  for (let k = 0; k < miss.length; k++) {
    if (!miss[k]) continue; const stack = [k]; miss[k] = 0; let size = 0, sx = 0, sy = 0, x0 = res, y0 = res, x1 = 0, y1 = 0;
    while (stack.length) { const c = stack.pop()!, x = c % res, y = (c - x) / res; size++; sx += x; sy += y; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= res || ny >= res) continue; const n = ny * res + nx; if (miss[n]) { miss[n] = 0; stack.push(n); } } }
    if (100 * size / Math.max(1, area) >= minPct) blobs.push({ view, areaPx: size, areaPct: 100 * size / Math.max(1, area), centroid: [sx / size, sy / size], bbox: [x0, y0, x1, y1] });
  }
  return { blobs, uncoveredPct: 100 * uncovered / Math.max(1, area), excessPct: 100 * excess / Math.max(1, area) };
}

export function findUnexplained(views: Array<{ view: View; mask: Uint8Array }>, placedParts: Array<{ id: string; tris: Tri[] }>, options: UnexplainedOptions = {}): UnexplainedReport {
  const res = views[0]!.view.res, minPct = options.minBlobPct ?? 0.8, minViews = options.minViews ?? 3, cosMax = Math.cos(((options.minAngleDeg ?? 20) * Math.PI) / 180);
  const all = placedParts.flatMap((p) => p.tris), perView = views.map((v, i) => ({ view: i, ...blobsOf(v.mask, rasterise(all, v.view), res, i, minPct) }));
  const half = views[0]!.view.half, pixel = (2 * half) / res, tol = Math.max(3 * pixel, 0.02 * half * 2);
  // candidate points: pairs of blobs from different views whose rays (nearly) meet and are not parallel
  const points: Vector3[] = [];
  for (let i = 0; i < perView.length; i++) for (let j = i + 1; j < perView.length; j++) {
    if (Math.abs(views[i]!.view.direction.dot(views[j]!.view.direction)) > cosMax) continue;
    for (const a of perView[i]!.blobs) for (const b of perView[j]!.blobs) { const ra = pixelRay(views[i]!.view, a.centroid[0], a.centroid[1]), rb = pixelRay(views[j]!.view, b.centroid[0], b.centroid[1]), l = lineDistance(ra.point, ra.dir, rb.point, rb.dir); if (l && l.gap <= tol) points.push(l.mid); }
  }
  // cluster the meeting points, then count how many independent views have a blob whose ray passes through the cluster
  const clusters: Vector3[] = []; for (const p of points) { const c = clusters.find((q) => q.distanceTo(p) < 4 * tol); if (c) c.lerp(p, 0.5); else clusters.push(p.clone()); }
  const candidates: MissingCandidate[] = [];
  for (const c of clusters) {
    const support = new Map<number, Blob>(); for (const v of perView) for (const b of v.blobs) { const r = pixelRay(views[v.view]!.view, b.centroid[0], b.centroid[1]); if (distanceToLine(c, r.point, r.dir) <= 2 * tol && (!support.has(v.view) || b.areaPx > support.get(v.view)!.areaPx)) support.set(v.view, b); }
    if (support.size < minViews) continue;
    const bs = [...support.values()], meanPct = bs.reduce((s, b) => s + b.areaPct, 0) / bs.length, radius = bs.map((b) => Math.sqrt(b.areaPx / Math.PI) * pixel).sort((x, y) => x - y)[Math.floor(bs.length / 2)]!;
    const near = placedParts.map((p) => { let d = Infinity; for (const t of p.tris) for (const q of t) d = Math.min(d, q.distanceTo(c)); return { id: p.id, distance: d }; }).sort((x, y) => x.distance - y.distance).slice(0, 3);
    candidates.push({ centre: c, radius, supportViews: [...support.keys()], meanAreaPct: meanPct, nearestParts: near, confidence: support.size >= 4 && meanPct >= 1.5 ? 'medium' : 'low', note: 'Candidate only: something the evidence shows and the plan does not draw, around this place. Not added, not connected, not identified.' });
  }
  candidates.sort((a, b) => b.supportViews.length * b.meanAreaPct - a.supportViews.length * a.meanAreaPct);
  return { perView: perView.map(({ view, uncoveredPct, excessPct, blobs }) => ({ view, uncoveredPct, excessPct, blobs })), candidates };
}
