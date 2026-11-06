import { Vector3 } from 'three';
import { attachResidual, placePoint, type AttachConstraint, type ConstraintSet, type PartGeometry, type Placed } from './constraints';
import { maskIoU, rasterise, type Tri, type View } from './silhouette';

/**
 * Structural fit: placement of the plan's components from calibrated silhouettes, under assembly constraints.
 *
 * The constraints are satisfied BY CONSTRUCTION, not by a penalty that a strong silhouette term can overpower: the attach graph is turned into a spanning
 * forest; each root part is free (scale + translation); every other part is free only in its scale, and its translation is whatever keeps its joint on the
 * joint of its parent. Edges that close a cycle cannot be satisfied by construction; they are penalised and reported. Parts with no constraint are free.
 * Nothing is added or removed; shapes and hierarchy are untouched; the result is one scale and one translation per part (a typed set-transform each).
 * The score is the mean silhouette IoU over the fit views: judge the result on views that were NOT given here.
 */
export type StructuralFitOptions = { sweeps?: number; cyclePenalty?: number; span: number; /** parts thinner than this many pixels in the fit views are not judgeable by silhouettes: they keep their scale (default 2.5) */ minPixels?: number };
export type StructuralFitResult = {
  placements: Map<string, Placed>; iouBefore: number; iouAfter: number; evaluations: number;
  frozen: string[]; roots: string[]; free: string[]; tree: Array<{ child: string; parent: string; via: string }>; cycleEdges: string[];
  residuals: Array<{ constraint: string; before: number; after: number }>;
};

export const placeTris = (tris: Tri[], origin: Vector3, p: Placed): Tri[] => tris.map((t) => t.map((q) => placePoint(q, origin, p)) as Tri);
const diag = (p: PartGeometry) => { const lo = new Vector3(Infinity, Infinity, Infinity), hi = new Vector3(-Infinity, -Infinity, -Infinity); for (const t of p.tris) for (const q of t) { lo.min(q); hi.max(q); } return hi.sub(lo).length(); };

export type Forest = { roots: string[]; free: string[]; tree: Array<{ child: string; parent: string; via: string }>; cycle: AttachConstraint[]; parentOf: Map<string, { child: string; parent: string; via: string }>; childrenOf: Map<string, string[]> };
/** Spanning forest of the attach graph (largest part first, so the biggest body anchors its neighbours). Singletons are `free`. */
export function forestOf(parts: PartGeometry[], constraints: ConstraintSet): Forest {
  const adj = new Map<string, Array<{ other: string; c: AttachConstraint }>>(parts.map((p) => [p.id, []]));
  for (const c of constraints.attach) { adj.get(c.a)?.push({ other: c.b, c }); adj.get(c.b)?.push({ other: c.a, c }); }
  const order = [...parts].sort((x, y) => diag(y) - diag(x)).map((p) => p.id), seen = new Set<string>(), roots: string[] = [], free: string[] = [], tree: Forest['tree'] = [], treeEdges = new Set<string>();
  for (const id of order) {
    if (seen.has(id)) continue; seen.add(id); const queue = [id]; let size = 0;
    while (queue.length) { const cur = queue.shift()!; size++; for (const { other, c } of adj.get(cur)!) if (!seen.has(other)) { seen.add(other); tree.push({ child: other, parent: cur, via: c.id }); treeEdges.add(c.id); queue.push(other); } }
    (size === 1 ? free : roots).push(id);
  }
  const childrenOf = new Map<string, string[]>(); for (const t of tree) childrenOf.set(t.parent, [...(childrenOf.get(t.parent) ?? []), t.child]);
  return { roots, free, tree, cycle: constraints.attach.filter((c) => !treeEdges.has(c.id)), parentOf: new Map(tree.map((t) => [t.child, t])), childrenOf };
}
export type Params = Map<string, { s: number; d: Vector3 }>;
/** Placements implied by the free parameters: roots and free parts use (s, d); every other part uses s only and its joint stays on its parent's joint. */
export function derivePlacements(parts: PartGeometry[], constraints: ConstraintSet, forest: Forest, params: Params, into: Map<string, Placed> = new Map(), only?: string): Map<string, Placed> {
  const byId = new Map(parts.map((p) => [p.id, p])), edge = new Map(constraints.attach.map((c) => [c.id, c]));
  const settle = (id: string) => {
    const q = params.get(id)!, link = forest.parentOf.get(id);
    if (!link) into.set(id, { s: q.s, d: q.d.clone() });
    else { const c = edge.get(link.via)!, part = byId.get(id)!, mParent = placePoint(c.anchor, byId.get(link.parent)!.origin, into.get(link.parent)!); into.set(id, { s: q.s, d: mParent.sub(part.origin).addScaledVector(c.anchor.clone().sub(part.origin), -q.s) }); }
    for (const child of forest.childrenOf.get(id) ?? []) settle(child);
  };
  if (only) settle(only); else for (const id of [...forest.roots, ...forest.free]) settle(id);
  return into;
}

export function fitStructured(parts: PartGeometry[], constraints: ConstraintSet, views: View[], targets: Uint8Array[], options: StructuralFitOptions): StructuralFitResult {
  const byId = new Map(parts.map((p) => [p.id, p])), res = views[0]!.res, span = options.span, lambda = options.cyclePenalty ?? 60;
  const forest = forestOf(parts, constraints), { roots, free, tree, cycle, childrenOf } = forest;
  const params: Params = new Map(parts.map((p) => [p.id, { s: 1, d: new Vector3() }])), placements = new Map<string, Placed>(parts.map((p) => [p.id, { s: 1, d: new Vector3() }]));
  const settle = (id: string) => { derivePlacements(parts, constraints, forest, params, placements, id); };
  const subtree = (id: string): string[] => [id, ...(childrenOf.get(id) ?? []).flatMap(subtree)];
  const cache = new Map<string, Uint8Array[]>(), draw = (id: string) => views.map((v) => rasterise(placeTris(byId.get(id)!.tris, byId.get(id)!.origin, placements.get(id)!), v));
  const penalty = () => { let s = 0; for (const c of cycle) { const r = attachResidual(c, byId, placements, span); s += r * r; } return lambda * s; };
  // a part thinner than a couple of pixels in every fit view has no usable silhouette: moving it would fit noise, so it keeps its own scale (and follows its parent)
  const pixel = (2 * views[0]!.half) / res, thin = (p: PartGeometry) => { const lo = new Vector3(Infinity, Infinity, Infinity), hi = new Vector3(-Infinity, -Infinity, -Infinity); for (const t of p.tris) for (const q of t) { lo.min(q); hi.max(q); } const e = hi.sub(lo).toArray().sort((x, y) => x - y); return e[1]! < (options.minPixels ?? 2.5) * pixel; };
  const frozen = new Set(parts.filter(thin).map((p) => p.id));
  let evaluations = 0;
  const score = () => { evaluations++; let sum = 0; for (let v = 0; v < views.length; v++) { const u = new Uint8Array(res * res); for (const masks of cache.values()) { const m = masks[v]!; for (let k = 0; k < u.length; k++) u[k]! |= m[k]!; } sum += maskIoU(u, targets[v]!); } return sum / views.length - penalty(); };
  for (const id of [...roots, ...free]) settle(id); for (const p of parts) cache.set(p.id, draw(p.id));
  const iouOf = () => { let sum = 0; for (let v = 0; v < views.length; v++) { const u = new Uint8Array(res * res); for (const masks of cache.values()) { const m = masks[v]!; for (let k = 0; k < u.length; k++) u[k]! |= m[k]!; } sum += maskIoU(u, targets[v]!); } return sum / views.length; };
  const iouBefore = iouOf(), residualsBefore = constraints.attach.map((c) => attachResidual(c, byId, placements, span)); let best = score();
  const refresh = (id: string) => { for (const sid of subtree(id)) cache.set(sid, draw(sid)); };
  const free_ = new Set([...roots, ...free]);
  for (let sweep = 0; sweep < (options.sweeps ?? 4); sweep++) {
    const f = 1 / (sweep + 1);
    for (const part of parts) {
      if (frozen.has(part.id)) continue;
      const id = part.id, q = params.get(id)!, lim = constraints.limits.get(id)!, canShift = free_.has(id);
      const moves: Array<(t: number) => void> = [(t) => { q.s *= 1 + 0.25 * t; }]; if (canShift) for (const axis of ['x', 'y', 'z'] as const) moves.push((t) => { q.d[axis] += t * 0.05 * span; });
      for (const move of moves) for (const sign of [1, -1]) {
        const saved = { s: q.s, d: q.d.clone() }, savedMasks = subtree(id).map((sid) => [sid, cache.get(sid)!] as const);
        move(sign * f);
        if (q.s < lim.scale[0] || q.s > lim.scale[1] || q.d.length() > lim.maxShift) { q.s = saved.s; q.d.copy(saved.d); continue; }
        settle(id); refresh(id); const s = score();
        if (s > best + 1e-5) best = s; else { q.s = saved.s; q.d.copy(saved.d); settle(id); for (const [sid, masks] of savedMasks) cache.set(sid, masks); }
      }
    }
  }
  return { placements, iouBefore, iouAfter: iouOf(), evaluations, frozen: [...frozen], roots, free, tree, cycleEdges: cycle.map((c) => c.id), residuals: constraints.attach.map((c, i) => ({ constraint: c.id, before: residualsBefore[i]!, after: attachResidual(c, byId, placements, span) })) };
}
