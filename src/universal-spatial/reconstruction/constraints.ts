import { Vector3 } from 'three';
import type { SpatialPlanV2 } from '../contracts-v2';
import type { Tri } from './silhouette';

/**
 * Structural assembly constraints for the V4 Structural Reconstruction stage.
 *
 * A constraint is only ever created from something the plan or its own geometry supports, and says which:
 *  - `declared`: the plan states it (relation attached_to / connected_to, constraint aligned / coaxial) AND the geometry as given does not contradict it
 *    (the parts already touch within tolerance). A declared relation the geometry does not support is NOT enforced and is reported in `notes`.
 *  - `detected`: two parts of the plan as given touch or overlap. It is a hypothesis ("these were meant to be joined"), proposed for review with its gap.
 * Parts that do not touch in the plan as given are never joined: a gap is a defect for a person or the assembly solver, not something to hide.
 * Everything is expressed through quantities a typed operation can carry later: a uniform scale about the component origin plus a translation.
 */
export type PartGeometry = { id: string; origin: Vector3; tris: Tri[] };
export type Source = 'declared' | 'detected';
export type AttachConstraint = { kind: 'attach'; id: string; a: string; b: string; /** joint position in the plan as given, world frame */ anchor: Vector3; source: Source; gap: number; evidence: string };
export type AlignConstraint = { kind: 'aligned'; id: string; a: string; b: string; axis: 'x' | 'y' | 'z'; offset: number; source: 'declared'; evidence: string };
export type Limits = { scale: [number, number]; maxShift: number };
export type ConstraintSet = { attach: AttachConstraint[]; align: AlignConstraint[]; limits: Map<string, Limits>; notes: string[] };
export type Placed = { s: number; d: Vector3 };

export const placePoint = (p: Vector3, origin: Vector3, placed: Placed): Vector3 => origin.clone().addScaledVector(p.clone().sub(origin), placed.s).add(placed.d);

type Sampled = { id: string; points: Vector3[]; spacing: number };
/** Points on the surface: vertices, edge midpoints and centroids, plus a regular subdivision of triangles longer than `h` so large flat faces are not represented by their corners only. */
function sample(part: PartGeometry, h: number, max = 2400): Sampled {
  const all: Vector3[] = []; let area = 0;
  for (const [a, b, c] of part.tris) {
    const longest = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)), n = Math.min(12, Math.max(1, Math.ceil(longest / h)));
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) { const u = i / n, v = j / n; all.push(a.clone().multiplyScalar(1 - u - v).addScaledVector(b, u).addScaledVector(c, v)); }
    area += new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).length() / 2;
  }
  const step = Math.max(1, Math.ceil(all.length / max)), points = all.filter((_, i) => i % step === 0);
  return { id: part.id, points, spacing: Math.sqrt(area / Math.max(1, points.length)) };
}
function closest(a: Sampled, b: Sampled): { gap: number; anchor: Vector3 } {
  let best = Infinity, pa = a.points[0]!, pb = b.points[0]!;
  for (const p of a.points) for (const q of b.points) { const d = p.distanceToSquared(q); if (d < best) { best = d; pa = p; pb = q; } }
  return { gap: Math.sqrt(best), anchor: pa.clone().add(pb).multiplyScalar(0.5) };
}

export type DetectOptions = { span: number; /** extra tolerance as a fraction of the span */ tolerance?: number };
/** Contacts present in the plan as given. The tolerance never exceeds 4 % of the span, so distant parts are never joined. */
export function detectContacts(parts: PartGeometry[], options: DetectOptions): AttachConstraint[] {
  const h = 0.02 * options.span, sampled = parts.map((p) => sample(p, h)), out: AttachConstraint[] = [];
  for (let i = 0; i < sampled.length; i++) for (let j = i + 1; j < sampled.length; j++) {
    const { gap, anchor } = closest(sampled[i]!, sampled[j]!), tol = Math.min(0.04 * options.span, (options.tolerance ?? 0.01) * options.span + Math.max(sampled[i]!.spacing, sampled[j]!.spacing));
    if (gap <= tol) out.push({ kind: 'attach', id: `contact-${sampled[i]!.id}-${sampled[j]!.id}`.slice(0, 48), a: sampled[i]!.id, b: sampled[j]!.id, anchor, source: 'detected', gap, evidence: `Parts touch or overlap in the plan as given (surface gap ${(gap / options.span * 100).toFixed(2)} % of the span).` });
  }
  return out;
}

/** Declared relations/constraints of the plan, kept only where the geometry as given supports them. */
export function declaredConstraints(plan: SpatialPlanV2, parts: PartGeometry[], options: DetectOptions): Pick<ConstraintSet, 'attach' | 'align' | 'notes'> {
  const byId = new Map(parts.map((p) => [p.id, p])), detected = new Map(detectContacts(parts, { ...options, tolerance: (options.tolerance ?? 0.01) * 2 }).map((c) => [[c.a, c.b].sort().join('|'), c])), attach: AttachConstraint[] = [], align: AlignConstraint[] = [], notes: string[] = [];
  for (const r of plan.relations) {
    if (r.kind !== 'attached_to' && r.kind !== 'connected_to') continue;
    if (!byId.has(r.fromId) || !byId.has(r.toId)) { notes.push(`Relation ${r.id}: a component is not part of this fit (has a parent or is missing); not enforced.`); continue; }
    const hit = detected.get([r.fromId, r.toId].sort().join('|'));
    if (!hit) notes.push(`Relation ${r.id} (${r.kind} ${r.fromId} -> ${r.toId}) is declared but the parts do not touch in the plan as given; NOT enforced and NOT created. Needs the assembly solver or a person.`);
    else attach.push({ ...hit, id: `rel-${r.id}`.slice(0, 48), source: 'declared', evidence: `Declared by the plan (${r.kind}, origin ${r.origin}) and supported by the geometry as given.` });
  }
  for (const c of plan.constraints) {
    if (c.kind !== 'aligned' && c.kind !== 'coaxial') continue;
    const [a, b] = c.componentIds; if (!a || !b || !byId.has(a) || !byId.has(b)) continue;
    const axis = (c.axis ?? 'y') as 'x' | 'y' | 'z', pa = byId.get(a)!, pb = byId.get(b)!, centre = (p: PartGeometry) => { const v = new Vector3(); let n = 0; for (const t of p.tris) for (const q of t) { v.add(q); n++; } return v.divideScalar(Math.max(1, n)); };
    align.push({ kind: 'aligned', id: `align-${c.id}`.slice(0, 48), a, b, axis, offset: centre(pa).getComponent('xyz'.indexOf(axis)) - centre(pb).getComponent('xyz'.indexOf(axis)), source: 'declared', evidence: `Declared by the plan (${c.kind} on ${axis}); the offset in the plan as given is preserved.` });
  }
  return { attach, align, notes };
}

export function buildConstraints(plan: SpatialPlanV2, parts: PartGeometry[], span: number, options: { useDeclared?: boolean; useDetected?: boolean; scale?: [number, number]; maxShiftFraction?: number } = {}): ConstraintSet {
  const declared = declaredConstraints(plan, parts, { span }), attach = [...(options.useDeclared === false ? [] : declared.attach)], notes = [...declared.notes];
  if (options.useDetected !== false) for (const c of detectContacts(parts, { span })) if (!attach.some((x) => [x.a, x.b].sort().join() === [c.a, c.b].sort().join())) attach.push(c);
  const limits = new Map(parts.map((p) => [p.id, { scale: options.scale ?? [0.6, 1.7], maxShift: (options.maxShiftFraction ?? 0.3) * span } as Limits]));
  return { attach, align: declared.align, limits, notes };
}

/** Current residual of one attach constraint: distance between where its two parts put the joint, as a fraction of the span. */
export function attachResidual(c: AttachConstraint, parts: Map<string, PartGeometry>, placements: Map<string, Placed>, span: number): number {
  const a = parts.get(c.a)!, b = parts.get(c.b)!, pa = placements.get(c.a) ?? { s: 1, d: new Vector3() }, pb = placements.get(c.b) ?? { s: 1, d: new Vector3() };
  return placePoint(c.anchor, a.origin, pa).distanceTo(placePoint(c.anchor, b.origin, pb)) / span;
}

/** Surface gap between two placed parts (independent of the joint bookkeeping): what a person sees as "detached". */
export function placedGap(a: PartGeometry, b: PartGeometry, pa: Placed, pb: Placed): number {
  const move = (p: PartGeometry, pl: Placed): PartGeometry => ({ ...p, tris: p.tris.map((t) => t.map((q) => placePoint(q, p.origin, pl)) as Tri) });
  const h = 0.02 * Math.max(...[a, b].flatMap((p) => p.tris.flatMap((t) => t.map((q) => q.length()))), 1); return closest(sample(move(a, pa), h), sample(move(b, pb), h)).gap;
}
