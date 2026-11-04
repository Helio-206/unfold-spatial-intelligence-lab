import { Vector3 } from 'three';
import type { SpatialPlanV2 } from '../contracts-v2';
import type { Tri } from './silhouette';

/**
 * What a relation between two parts IS, before any solver uses it. A geometric contact is not a relation:
 *
 *  - `declared_supported`   the plan declares it (attached_to / connected_to) and the geometry as given agrees (the parts touch within tolerance). Enforced.
 *  - `declared_contradicted` the plan declares it and the geometry disagrees (a gap). NEVER enforced and never repaired here: it is a defect for a person or the assembly solver.
 *  - `detected_hypothesis`  the parts touch but nothing says they should be joined. A hypothesis for review. NOT enforced by default.
 *  - `human_confirmed`      a person confirmed it (the plan marks the relation `user_provided`, or the review confirmed the hypothesis id) and the geometry agrees. Enforced.
 *
 * Nothing is promoted automatically: a hypothesis becomes `human_confirmed` only through `confirmed`, which comes from a person.
 */
export type RelationStatus = 'declared_supported' | 'declared_contradicted' | 'detected_hypothesis' | 'human_confirmed';
export type RelationFinding = { id: string; a: string; b: string; status: RelationStatus; enforced: boolean; gap: number; anchor: Vector3; evidence: string; declaredKind: string | null; origin: string | null };
export type PartTris = { id: string; tris: Tri[] };

export type Sampled = { points: Vector3[]; spacing: number };
export function sample(tris: Tri[], h: number, max: number): Sampled {
  const all: Vector3[] = []; let area = 0;
  for (const [a, b, c] of tris) {
    const longest = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)), n = Math.min(10, Math.max(1, Math.ceil(longest / h)));
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) { const u = i / n, v = j / n; all.push(a.clone().multiplyScalar(1 - u - v).addScaledVector(b, u).addScaledVector(c, v)); }
    area += new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).length() / 2;
  }
  const step = Math.max(1, Math.ceil(all.length / max)), points = all.filter((_, i) => i % step === 0);
  return { points, spacing: Math.sqrt(area / Math.max(1, points.length)) };
}
export const closest = (a: Sampled, b: Sampled) => { let best = Infinity, pa = a.points[0]!, pb = b.points[0]!; for (const p of a.points) for (const q of b.points) { const d = p.distanceToSquared(q); if (d < best) { best = d; pa = p; pb = q; } } return { gap: Math.sqrt(best), anchor: pa.clone().add(pb).multiplyScalar(0.5) }; };

export type ClassifyOptions = { span: number; /** hypothesis ids a person confirmed in review */ confirmed?: ReadonlySet<string>; maxSamples?: number };

/** All pairs whose parts touch, plus every declared attach relation, each with its status. Pure: reads the plan and world-space triangles. */
export function classifyRelations(plan: SpatialPlanV2, parts: PartTris[], options: ClassifyOptions): RelationFinding[] {
  const h = 0.015 * options.span, max = options.maxSamples ?? 2000, sampled = new Map(parts.map((p) => [p.id, sample(p.tris, h, max)])), ids = parts.map((p) => p.id), out: RelationFinding[] = [];
  const tol = (a: string, b: string) => Math.min(0.05 * options.span, 0.01 * options.span + 1.5 * Math.max(sampled.get(a)!.spacing, sampled.get(b)!.spacing)), key = (a: string, b: string) => [a, b].sort().join('|');
  const declared = new Map<string, SpatialPlanV2['relations'][number]>();
  for (const r of plan.relations) if ((r.kind === 'attached_to' || r.kind === 'connected_to') && sampled.has(r.fromId) && sampled.has(r.toId) && r.fromId !== r.toId) declared.set(key(r.fromId, r.toId), r);
  const done = new Set<string>();
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = ids[i]!, b = ids[j]!, k = key(a, b), rel = declared.get(k), { gap, anchor } = closest(sampled.get(a)!, sampled.get(b)!), touching = gap <= tol(a, b);
    if (!rel && !touching) continue; done.add(k);
    const pct = `${(100 * gap / options.span).toFixed(2)} % of the span`;
    if (rel) {
      if (!touching) { out.push({ id: `rel-${rel.id}`.slice(0, 48), a, b, status: 'declared_contradicted', enforced: false, gap, anchor, evidence: `The plan declares ${rel.kind} (${rel.fromId} -> ${rel.toId}) but the parts are ${pct} apart. Not enforced, not repaired.`, declaredKind: rel.kind, origin: rel.origin }); continue; }
      const human = rel.origin === 'user_provided' || (options.confirmed?.has(`rel-${rel.id}`.slice(0, 48)) ?? false);
      out.push({ id: `rel-${rel.id}`.slice(0, 48), a, b, status: human ? 'human_confirmed' : 'declared_supported', enforced: true, gap, anchor, evidence: human ? `Confirmed by a person (relation origin ${rel.origin}) and supported by the geometry (gap ${pct}).` : `Declared by the plan (${rel.kind}, origin ${rel.origin}) and supported by the geometry as given (gap ${pct}).`, declaredKind: rel.kind, origin: rel.origin });
    } else {
      const id = `hyp-${a}-${b}`.slice(0, 48), human = options.confirmed?.has(id) ?? false;
      out.push({ id, a, b, status: human ? 'human_confirmed' : 'detected_hypothesis', enforced: human, gap, anchor, evidence: human ? `Hypothesis confirmed by a person in review (parts touch, gap ${pct}).` : `The parts touch or overlap (gap ${pct}) but nothing in the plan says they are joined. A hypothesis for review; not enforced.`, declaredKind: null, origin: null });
    }
  }
  return out;
}

export const enforced = (findings: RelationFinding[]) => findings.filter((f) => f.enforced);
export const summary = (findings: RelationFinding[]) => ({ declared_supported: findings.filter((f) => f.status === 'declared_supported').length, declared_contradicted: findings.filter((f) => f.status === 'declared_contradicted').length, detected_hypothesis: findings.filter((f) => f.status === 'detected_hypothesis').length, human_confirmed: findings.filter((f) => f.status === 'human_confirmed').length });
