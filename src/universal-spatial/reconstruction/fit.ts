import { Vector3 } from 'three';
import { maskIoU, rasterise, type Tri, type View } from './silhouette';

/**
 * Structural Reconstruction, first engine: fit the PLACEMENT of the plan's own components to calibrated silhouettes (analysis by synthesis).
 * Each component keeps its identity, shape and hierarchy; only a uniform scale `s` about its own origin and a translation `d` are estimated, so the result
 * is exactly representable as one `set-transform` per component. Nothing is invented: no part is added, no primitive changed.
 *
 * The score is the mean silhouette IoU over the views handed in. Judging the result on those same views is circular: callers MUST keep other views aside.
 * Only components with no parent are fitted by `fitPlacement` (their world and parent frames coincide); the rest are reported untouched.
 */
export type FitInput = { id: string; origin: Vector3; tris: Tri[] };
export type Placement = { s: number; d: Vector3 };
export type FitOptions = { sweeps?: number; scaleRange?: [number, number]; maxShift: number; fixed?: ReadonlySet<string> };
export type FitResult = { placements: Map<string, Placement>; iouBefore: number; iouAfter: number; evaluations: number };

export const place = (tris: Tri[], origin: Vector3, p: Placement): Tri[] => tris.map((t) => t.map((q) => origin.clone().addScaledVector(q.clone().sub(origin), p.s).add(p.d)) as Tri);

export function fitPlacement(parts: FitInput[], views: View[], targets: Uint8Array[], options: FitOptions): FitResult {
  const placements = new Map(parts.map((c) => [c.id, { s: 1, d: new Vector3() }])), range = options.scaleRange ?? [0.5, 2], res = views[0]!.res;
  // one mask per part and view; the union is rebuilt from them, so changing one part re-rasterises only that part
  const cache = new Map<string, Uint8Array[]>(), draw = (c: FitInput) => views.map((v) => rasterise(place(c.tris, c.origin, placements.get(c.id)!), v));
  for (const c of parts) cache.set(c.id, draw(c));
  let evaluations = 0;
  const score = () => { evaluations++; let sum = 0; for (let v = 0; v < views.length; v++) { const u = new Uint8Array(res * res); for (const masks of cache.values()) { const m = masks[v]!; for (let k = 0; k < u.length; k++) u[k]! |= m[k]!; } sum += maskIoU(u, targets[v]!); } return sum / views.length; };
  const before = score(); let best = before;
  const sweeps = options.sweeps ?? 4, shiftStep = options.maxShift / 6;
  for (let sweep = 0; sweep < sweeps; sweep++) {
    const f = 1 / (sweep + 1);
    for (const c of parts) {
      if (options.fixed?.has(c.id)) continue;
      const q = placements.get(c.id)!;
      const tries: Array<(step: number) => void> = [(t) => { q.s *= 1 + t * 0.5; }, (t) => { q.d.x += t; }, (t) => { q.d.y += t; }, (t) => { q.d.z += t; }];
      for (let a = 0; a < tries.length; a++) for (const sign of [1, -1]) {
        const step = (a === 0 ? 0.2 : shiftStep) * f * sign, saved = { s: q.s, d: q.d.clone() }, savedMasks = cache.get(c.id)!;
        tries[a]!(step);
        if (q.s < range[0] || q.s > range[1] || q.d.length() > options.maxShift) { q.s = saved.s; q.d.copy(saved.d); continue; }
        cache.set(c.id, draw(c)); const s = score();
        if (s > best + 1e-5) best = s; else { q.s = saved.s; q.d.copy(saved.d); cache.set(c.id, savedMasks); }
      }
    }
  }
  return { placements, iouBefore: before, iouAfter: best, evaluations };
}
