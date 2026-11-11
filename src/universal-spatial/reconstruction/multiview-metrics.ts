import { BufferGeometry, Vector3 } from 'three';
import type { Tri } from './silhouette';

/** Deterministic PRNG (mulberry32) so metrics are reproducible. */
const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/** Area-weighted surface samples of a triangle soup. */
export function samplePoints(tris: readonly Tri[], count: number, seed = 1): Vector3[] {
  const r = rng(seed), cum = new Float64Array(tris.length); let total = 0;
  tris.forEach((t, i) => { total += new Vector3().crossVectors(t[1].clone().sub(t[0]), t[2].clone().sub(t[0])).length() / 2; cum[i] = total; });
  const out: Vector3[] = [];
  if (!(total > 0)) return out;
  for (let n = 0; n < count; n++) {
    const target = r() * total; let lo = 0, hi = tris.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m]! < target) lo = m + 1; else hi = m; }
    const t = tris[lo]!, a = Math.sqrt(r()), b = r();
    out.push(t[0].clone().multiplyScalar(1 - a).addScaledVector(t[1], a * (1 - b)).addScaledVector(t[2], a * b));
  }
  return out;
}
export function geometryPoints(g: BufferGeometry, count: number, seed = 1): Vector3[] {
  const p = g.getAttribute('position'); if (!p) return [];
  const idx = g.index, at = (i: number) => new Vector3(p.getX(i), p.getY(i), p.getZ(i)), tris: Tri[] = [], n = idx ? idx.count : p.count;
  for (let i = 0; i + 2 < n; i += 3) tris.push(idx ? [at(idx.getX(i)), at(idx.getX(i + 1)), at(idx.getX(i + 2))] : [at(i), at(i + 1), at(i + 2)]);
  return samplePoints(tris, count, seed);
}

/** Nearest-neighbour distances from `from` to `to` through a uniform hash grid. */
export function nearestDistances(from: readonly Vector3[], to: readonly Vector3[]): Float64Array {
  const out = new Float64Array(from.length).fill(Infinity); if (!to.length) return out;
  const box = { min: new Vector3(Infinity, Infinity, Infinity), max: new Vector3(-Infinity, -Infinity, -Infinity) };
  for (const p of to) { box.min.min(p); box.max.max(p); }
  const span = box.max.clone().sub(box.min), cell = Math.max(1e-9, Math.cbrt((span.x * span.y * span.z) / Math.max(1, to.length)) * 2 || Math.max(span.x, span.y, span.z) / 8 || 1e-3);
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`, map = new Map<string, Vector3[]>();
  for (const p of to) { const k = key(Math.floor((p.x - box.min.x) / cell), Math.floor((p.y - box.min.y) / cell), Math.floor((p.z - box.min.z) / cell)); (map.get(k) ?? map.set(k, []).get(k)!).push(p); }
  const diag = span.length();
  for (let i = 0; i < from.length; i++) {
    const p = from[i]!, cx = Math.floor((p.x - box.min.x) / cell), cy = Math.floor((p.y - box.min.y) / cell), cz = Math.floor((p.z - box.min.z) / cell);
    let best = Infinity;
    for (let ring = 0; ring < 64; ring++) {
      for (let x = cx - ring; x <= cx + ring; x++) for (let y = cy - ring; y <= cy + ring; y++) for (let z = cz - ring; z <= cz + ring; z++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy), Math.abs(z - cz)) !== ring) continue;
        const bucket = map.get(key(x, y, z)); if (bucket) for (const q of bucket) best = Math.min(best, p.distanceTo(q));
      }
      if (best <= ring * cell) break; // nada mais próximo pode estar num anel exterior
      if (ring * cell > diag * 2 + 1) break;
    }
    out[i] = best;
  }
  return out;
}

export type ChamferResult = { /** mean distance prediction -> truth (accuracy) */ accuracy: number; /** mean distance truth -> prediction (completeness) */ completeness: number; symmetric: number; p95Accuracy: number };
/** Chamfer distance in the units of the points. `predicted` and `truth` are surface samples. */
export function chamfer(predicted: readonly Vector3[], truth: readonly Vector3[]): ChamferResult {
  const a = nearestDistances(predicted, truth), c = nearestDistances(truth, predicted);
  const mean = (x: Float64Array) => { let s = 0; for (const v of x) s += v; return x.length ? s / x.length : Infinity; };
  const sorted = Float64Array.from(a).sort();
  return { accuracy: mean(a), completeness: mean(c), symmetric: (mean(a) + mean(c)) / 2, p95Accuracy: sorted.length ? sorted[Math.floor(sorted.length * 0.95)]! : Infinity };
}
