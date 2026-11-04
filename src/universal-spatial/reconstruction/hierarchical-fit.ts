import { Euler, Matrix3, Matrix4, Quaternion, Vector3 } from 'three';
import { maskIoU, rasterise, type Tri, type View } from './silhouette';
import type { RelationFinding } from './relations';

/**
 * Silhouette fit of the placement of a HIERARCHICAL plan.
 *
 * Each part has a local correction in its own parent's frame: a uniform scale `s` (multiplying its local scale) and a translation `d` (added to its local
 * position). World placement is recomputed down the tree, so a change to a part moves and scales its whole subtree exactly as the plan itself would, and the
 * correction of a parent is never re-applied to its children (no duplicated transform). Nothing is read from a world position as if it were local.
 *
 * Enforced joints between a part and its PARENT are kept exactly by construction: the translation is derived from the scale so the joint stays where it is.
 * Other enforced joints are penalised and checked afterwards. Parts without usable silhouette evidence (too thin, or never visible on their own) are frozen and
 * reported as unresolved; they still follow their parent.
 */
export type HPart = { id: string; parentId: string | null; position: Vector3; rotation: Euler; scale: Vector3; local: Matrix4; world: Matrix4; tris: Tri[]; pivot: Vector3 };
/** `r` is a small rotation vector (axis * angle, radians) applied in the PARENT's frame about the part's own origin, on top of its local rotation. */
export type HParam = { s: number; d: Vector3; r: Vector3 };
export type HOptions = { /** rotation corrections: bound in radians; `false` = translation and scale only (Phase C behaviour) */ rotation?: { maxRad: number } | false; span: number; sweeps?: number; scaleRange?: [number, number]; maxShift: number; cyclePenalty?: number; minPixels?: number; minExclusivePixels?: number; maxEvaluations?: number; maxMs?: number; now?: () => number };
export type Unresolved = { id: string; reason: 'too_thin_for_silhouette' | 'never_visible_alone' };
export type HResult = {
  params: Map<string, HParam>; /** world matrix of each part after the fit */ worlds: Map<string, Matrix4>; local: Map<string, { position: Vector3; scale: Vector3; rotationRad: Vector3 }>;
  iouBefore: number; iouAfter: number; evaluations: number; ms: number; aborted: 'evaluations' | 'time' | null; unresolved: Unresolved[];
  residuals: Array<{ id: string; before: number; after: number; viaHierarchy: boolean }>; changed: string[];
};

const EPS = 1e-6;
/** Local matrix with the correction applied: position + d, scale * s, rotation untouched. */
export const correctedQuaternion = (p: HPart, c: HParam): Quaternion => { const q = new Quaternion().setFromEuler(p.rotation), angle = c.r.length(); return angle < 1e-12 ? q : new Quaternion().setFromAxisAngle(c.r.clone().divideScalar(angle), angle).multiply(q); };
export const correctedLocal = (p: HPart, c: HParam): Matrix4 => new Matrix4().compose(p.position.clone().add(c.d), correctedQuaternion(p, c), p.scale.clone().multiplyScalar(c.s));
/** Translation that keeps the point `anchorWorld` (a joint with the parent) where it is when the part is scaled by `s`. Derived in the part's own local frame. */
export function pinnedTranslation(p: HPart, anchorWorld: Vector3, s: number): Vector3 {
  const lc = anchorWorld.clone().applyMatrix4(p.world.clone().invert()), linear = new Matrix3().setFromMatrix4(p.local);
  return lc.applyMatrix3(linear).multiplyScalar(1 - s);
}

export function fitHierarchical(parts: HPart[], enforcedFindings: RelationFinding[], views: View[], targets: Uint8Array[], options: HOptions): HResult {
  const now = options.now ?? (() => performance.now()), t0 = now(), byId = new Map(parts.map((p) => [p.id, p])), res = views[0]!.res, span = options.span, lambda = options.cyclePenalty ?? 60;
  // ---- dependency graph: a part's world placement depends on its hierarchical parent and, if it is pinned, on the part it follows
  const deps = new Map<string, string[]>(parts.map((p) => [p.id, p.parentId ? [p.parentId] : []])), dependents = new Map<string, string[]>(parts.map((p) => [p.id, []]));
  for (const p of parts) if (p.parentId) dependents.get(p.parentId)!.push(p.id);
  const dependsOn = (x: string, y: string, seen = new Set<string>()): boolean => { if (x === y) return true; if (seen.has(x)) return false; seen.add(x); return deps.get(x)!.some((d) => dependsOn(d, y, seen)); };
  // ---- pins: a part follows ONE leader at an enforced joint, so the joint is kept exactly by construction. Breadth-first from the largest part, so the biggest body leads.
  const diag = (p: HPart) => { const lo = new Vector3(Infinity, Infinity, Infinity), hi = new Vector3(-Infinity, -Infinity, -Infinity); for (const t of p.tris) for (const q of t) { lo.min(q); hi.max(q); } return hi.sub(lo).length(); };
  const adj = new Map<string, Array<{ other: string; f: RelationFinding }>>(parts.map((p) => [p.id, []])); for (const f of enforcedFindings) { adj.get(f.a)?.push({ other: f.b, f }); adj.get(f.b)?.push({ other: f.a, f }); }
  const pins = new Map<string, { leader: string; anchor: Vector3 }>(), usedEdges = new Set<string>(), seen = new Set<string>();
  for (const start of [...parts].sort((x, y) => diag(y) - diag(x)).map((p) => p.id)) {
    if (seen.has(start)) continue; seen.add(start); const queue = [start];
    while (queue.length) { const cur = queue.shift()!; for (const { other, f } of adj.get(cur)!) { if (seen.has(other)) continue; seen.add(other); queue.push(other); if (dependsOn(cur, other)) { /* `cur` is built on `other` (an ancestor): `other` cannot follow it, so `cur` follows `other` if it is free to */ if (!pins.has(cur)) { pins.set(cur, { leader: other, anchor: f.anchor }); usedEdges.add(f.id); deps.get(cur)!.push(other); dependents.get(other)!.push(cur); } continue; } pins.set(other, { leader: cur, anchor: f.anchor }); usedEdges.add(f.id); deps.get(other)!.push(cur); dependents.get(cur)!.push(other); } }
  }
  const others = enforcedFindings.filter((f) => !usedEdges.has(f.id));
  const order: string[] = [], mark = new Set<string>(); const visit = (id: string) => { if (mark.has(id)) return; mark.add(id); for (const d of deps.get(id)!) visit(d); order.push(id); }; for (const p of parts) visit(p.id);
  const downstream = (id: string): string[] => { const out = new Set<string>([id]); const walk = (x: string) => { for (const d of dependents.get(x)!) if (!out.has(d)) { out.add(d); walk(d); } }; walk(id); return order.filter((x) => out.has(x)); };
  const params = new Map<string, HParam>(parts.map((p) => [p.id, { s: 1, d: new Vector3(), r: new Vector3() }])), worlds = new Map<string, Matrix4>(), locals = new Map<string, Matrix4>();
  const moveOf = (id: string) => worlds.get(id)!.clone().multiply(byId.get(id)!.world.clone().invert());
  const settleOne = (id: string) => {
    const p = byId.get(id)!, c = params.get(id)!, pin = pins.get(id), parentWorld = p.parentId ? worlds.get(p.parentId)! : new Matrix4();
    if (pin) { // translation that puts this part's joint exactly where its leader's joint now is
      const target = pin.anchor.clone().applyMatrix4(moveOf(pin.leader)), lc = pin.anchor.clone().applyMatrix4(p.world.clone().invert()), linear = new Matrix3().setFromMatrix4(new Matrix4().compose(new Vector3(), correctedQuaternion(p, c), p.scale.clone().multiplyScalar(c.s)));
      const rs = lc.clone().applyMatrix3(linear); c.d.copy(target.applyMatrix4(parentWorld.clone().invert()).sub(p.position).sub(rs));
    }
    const L = correctedLocal(p, c); locals.set(id, L); worlds.set(id, parentWorld.clone().multiply(L));
  };
  for (const id of order) settleOne(id);
  const settle = (id: string) => { for (const x of downstream(id)) settleOne(x); };
  const subtree = (id: string): string[] => downstream(id);
  const pinned = new Set(pins.keys());
  const move = moveOf;
  const draw = (id: string) => { const m = move(id), tris = byId.get(id)!.tris.map((t) => t.map((q) => q.clone().applyMatrix4(m)) as Tri); return views.map((v) => rasterise(tris, v)); };
  const cache = new Map<string, Uint8Array[]>(); for (const p of parts) cache.set(p.id, draw(p.id));
  const union = (v: number, skip?: string) => { const u = new Uint8Array(res * res); for (const [id, masks] of cache) { if (id === skip) continue; const m = masks[v]!; for (let k = 0; k < u.length; k++) u[k]! |= m[k]!; } return u; };
  const iouOf = () => { let s = 0; for (let v = 0; v < views.length; v++) s += maskIoU(union(v), targets[v]!); return s / views.length; };
  const residual = (f: RelationFinding) => f.anchor.clone().applyMatrix4(move(f.a)).distanceTo(f.anchor.clone().applyMatrix4(move(f.b))) / span;
  const penalty = () => { let s = 0; for (const f of others) { const r = residual(f); s += r * r; } return lambda * s; };

  // ---- which parts have silhouette evidence of their own
  const pixel = (2 * views[0]!.half) / res, unresolved: Unresolved[] = [], frozen = new Set<string>();
  for (const p of parts) {
    const lo = new Vector3(Infinity, Infinity, Infinity), hi = new Vector3(-Infinity, -Infinity, -Infinity); for (const t of p.tris) for (const q of t) { lo.min(q); hi.max(q); }
    const e = hi.sub(lo).toArray().sort((x, y) => x - y);
    if (e[1]! < (options.minPixels ?? 2.5) * pixel) { frozen.add(p.id); unresolved.push({ id: p.id, reason: 'too_thin_for_silhouette' }); continue; }
    let exclusive = 0; for (let v = 0; v < views.length; v++) { const own = cache.get(p.id)![v]!, rest = union(v, p.id); for (let k = 0; k < own.length; k++) exclusive += own[k]! & ~rest[k]! & 1; }
    if (exclusive < (options.minExclusivePixels ?? 12)) { frozen.add(p.id); unresolved.push({ id: p.id, reason: 'never_visible_alone' }); }
  }
  const residualsBefore = enforcedFindings.map(residual); let evaluations = 0, aborted: HResult['aborted'] = null;
  const score = () => { evaluations++; return iouOf() - penalty(); };
  const iouBefore = iouOf(); let best = score();
  const range = options.scaleRange ?? [0.6, 1.7], over = () => (options.maxEvaluations !== undefined && evaluations >= options.maxEvaluations ? 'evaluations' : options.maxMs !== undefined && now() - t0 > options.maxMs ? 'time' : null);
  // ---- coarse rotation probes: a rotation error is not found by small steps from a wrong angle (the score is flat or misleading near it), so try a spread of angles per axis first
  const rotationOn = options.rotation !== false, maxRad0 = options.rotation === false ? 0 : options.rotation?.maxRad ?? 0.6;
  // deepest parts first: a rotation of a parent rotates its whole subtree, so a wrong angle in a child must be tried on the child before a parent is allowed to absorb it
  const depthOf = (p: HPart): number => { let d = 0, cur = p.parentId; while (cur) { d++; cur = byId.get(cur)!.parentId; } return d; }, deepFirst = [...parts].sort((x, y) => depthOf(y) - depthOf(x));
  if (rotationOn && maxRad0 > 0) probe: for (const p of deepFirst) {
    if (frozen.has(p.id)) continue; const id = p.id, c = params.get(id)!;
    for (const axis of ['z', 'x', 'y'] as const) {
      let bestVal = c.r[axis], bestScore = best; const start = c.r[axis];
      for (let k = -5; k <= 5; k++) {
        const val = (k / 5) * maxRad0; if (Math.abs(val - start) < 1e-9) continue; if ((aborted = (options.maxEvaluations !== undefined && evaluations >= options.maxEvaluations ? 'evaluations' : options.maxMs !== undefined && now() - t0 > options.maxMs ? 'time' : null))) break probe;
        c.r[axis] = val; if (c.r.length() > maxRad0 + 1e-9) continue; settle(id); const shift = byId.get(id)!.pivot.clone().applyMatrix4(move(id)).distanceTo(byId.get(id)!.pivot); if (shift > options.maxShift) continue;
        for (const sid of subtree(id)) cache.set(sid, draw(sid)); const sc = score(); if (sc > bestScore + 0.003) { bestScore = sc; bestVal = val; }
      }
      c.r[axis] = bestVal; settle(id); for (const sid of subtree(id)) cache.set(sid, draw(sid)); best = Math.max(best, bestScore);
    }
  }
  outer: for (let sweep = 0; sweep < (options.sweeps ?? 4); sweep++) {
    const f = 1 / (sweep + 1);
    for (const p of deepFirst) {
      if (frozen.has(p.id)) continue; const id = p.id, c = params.get(id)!, isPinned = pinned.has(id);
      const maxRad = options.rotation === false ? 0 : options.rotation?.maxRad ?? 0.6, moves: Array<(t: number) => void> = [(t) => { c.s *= 1 + 0.25 * t; }]; if (maxRad > 0) for (const axis of ['x', 'y', 'z'] as const) moves.push((t) => { c.r[axis] += t * 0.1; }); if (!isPinned) for (const axis of ['x', 'y', 'z'] as const) moves.push((t) => { c.d[axis] += t * 0.05 * span / Math.max(1e-9, Math.cbrt(Math.abs(p.world.determinant()) / Math.max(EPS, Math.abs(p.local.determinant())))) });
      for (const m of moves) for (const sign of [1, -1]) {
        if ((aborted = over())) break outer;
        const saved = { s: c.s, d: c.d.clone(), r: c.r.clone() }, savedMasks = subtree(id).map((sid) => [sid, cache.get(sid)!] as const);
        m(sign * f); const bad = c.s < range[0] || c.s > range[1] || c.r.length() > maxRad + 1e-9;
        if (bad) { c.s = saved.s; c.d.copy(saved.d); c.r.copy(saved.r); continue; }
        settle(id); const shift = byId.get(id)!.pivot.clone().applyMatrix4(move(id)).distanceTo(byId.get(id)!.pivot);
        if (shift > options.maxShift) { c.s = saved.s; c.d.copy(saved.d); c.r.copy(saved.r); settle(id); continue; }
        for (const sid of subtree(id)) cache.set(sid, draw(sid)); const s = score();
        if (s > best + 1e-5) best = s; else { c.s = saved.s; c.d.copy(saved.d); c.r.copy(saved.r); settle(id); for (const [sid, masks] of savedMasks) cache.set(sid, masks); }
      }
    }
  }
  const local = new Map(parts.map((p) => { const c = params.get(p.id)!; const e = new Euler().setFromQuaternion(correctedQuaternion(p, c), 'XYZ'); return [p.id, { position: p.position.clone().add(c.d), scale: p.scale.clone().multiplyScalar(c.s), rotationRad: new Vector3(e.x, e.y, e.z) }] as const; }));
  const changed = parts.filter((p) => { const c = params.get(p.id)!; return Math.abs(c.s - 1) > 1e-4 || c.d.length() > 1e-4 * span || c.r.length() > 1e-4; }).map((p) => p.id);
  return { params, worlds, local, iouBefore, iouAfter: iouOf(), evaluations, ms: now() - t0, aborted, unresolved, residuals: enforcedFindings.map((f, i) => ({ id: f.id, before: residualsBefore[i]!, after: residual(f), viaHierarchy: usedEdges.has(f.id) })), changed };
}
