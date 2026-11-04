import { Matrix4, Quaternion, Vector3 } from 'three';
import type { SpatialPlanV2 } from '../contracts-v2';
import { readParts } from './engine';
import { closest, classifyRelations, sample, type RelationFinding } from './relations';
import { correctedLocal, correctedQuaternion, type HParam, type HPart } from './hierarchical-fit';
import type { Tri } from './silhouette';

/**
 * Which parts of a plan cannot be put right with transforms alone? Uses the plan ONLY (no evidence, no photograph): for every declared relation that the plan's own
 * geometry contradicts, it searches for the placement of one side (a uniform scale, a local rotation and a translation, inside stated limits, with its subtree following)
 * that closes the gap. If even the best allowed transform leaves the parts apart, the contradiction is not a placement problem: the shapes or sizes cannot meet, or a
 * connecting part is missing. That is reported as `not_closable_by_transform`. Nothing is applied: forcing a contradicted relation shut would only make the picture look
 * connected, which is exactly what this engine must not do.
 */
export type Reach = { scale: [number, number]; maxRotationRad: number; maxShiftFraction: number };
export const DEFAULT_REACH: Reach = { scale: [0.6, 1.7], maxRotationRad: 0.6, maxShiftFraction: 0.15 };
export type ContradictionDiagnosis = { relation: string; a: string; b: string; declaredKind: string | null; gapPctSpan: number; moves: string; bestGapPctSpan: number; verdict: 'closable_by_transform' | 'not_closable_by_transform'; breaksOtherRelations: boolean; hint: string };

const diag = (p: HPart) => { const lo = new Vector3(Infinity, Infinity, Infinity), hi = new Vector3(-Infinity, -Infinity, -Infinity); for (const t of p.tris) for (const q of t) { lo.min(q); hi.max(q); } return hi.sub(lo).length(); };

export function diagnoseContradictions(plan: SpatialPlanV2, reach: Reach = DEFAULT_REACH): { diagnoses: ContradictionDiagnosis[]; notCorrectableByTransforms: string[]; closable: string[] } | null {
  const read = readParts(plan); if (!read) return null; const { parts, span } = read, byId = new Map(parts.map((p) => [p.id, p]));
  const findings = classifyRelations(plan, parts.map((p) => ({ id: p.id, tris: p.tris })), { span }), supported = findings.filter((f) => f.enforced);
  const children = new Map<string, string[]>(parts.map((p) => [p.id, []])); for (const p of parts) if (p.parentId) children.get(p.parentId)!.push(p.id);
  const subtree = (id: string): string[] => [id, ...children.get(id)!.flatMap(subtree)];
  const diagnoses: ContradictionDiagnosis[] = [];
  for (const f of findings.filter((x) => x.status === 'declared_contradicted')) {
    // the side that moves: the one with the smaller body (its subtree follows); the other stays
    const smaller = diag(byId.get(f.a)!) <= diag(byId.get(f.b)!) ? f.a : f.b, other = smaller === f.a ? f.b : f.a, mover = subtree(smaller).includes(other) ? other : smaller, fixed = mover === f.a ? f.b : f.a, mp = byId.get(mover)!, group = subtree(mover), h = 0.02 * span; // a part cannot meet its own descendant by moving the whole subtree
    const fixedSample = sample(byId.get(fixed)!.tris, h, 500), c: HParam = { s: 1, d: new Vector3(), r: new Vector3() }, parentWorld = mp.parentId ? byId.get(mp.parentId)!.world : new Matrix4();
    const motion = (q: HParam) => parentWorld.clone().multiply(correctedLocal(mp, q)).multiply(mp.world.clone().invert());
    const moved = (q: HParam) => { const m = motion(q); return group.map((id) => ({ id, tris: byId.get(id)!.tris.map((t) => t.map((p) => p.clone().applyMatrix4(m)) as Tri) })); };
    const gapOf = (q: HParam) => { const m = motion(q); let best = Infinity; for (const id of group) { if (id !== mover && id !== f.a && id !== f.b) continue; const sm = sample(byId.get(id)!.tris.map((t) => t.map((p) => p.clone().applyMatrix4(m)) as Tri), h, 500); best = Math.min(best, closest(sm, fixedSample).gap); } return best; };
    let best = gapOf(c), step = 1;
    for (let sweep = 0; sweep < 6; sweep++, step *= 0.55) {
      for (const axis of ['s', 'rx', 'ry', 'rz', 'dx', 'dy', 'dz'] as const) for (const sign of [1, -1]) {
        const q: HParam = { s: c.s, d: c.d.clone(), r: c.r.clone() };
        if (axis === 's') q.s *= 1 + 0.2 * step * sign; else if (axis[0] === 'r') q.r[axis[1] as 'x' | 'y' | 'z'] += 0.15 * step * sign; else q.d[axis[1] as 'x' | 'y' | 'z'] += 0.05 * span * step * sign;
        if (q.s < reach.scale[0] || q.s > reach.scale[1] || q.r.length() > reach.maxRotationRad || q.d.length() > reach.maxShiftFraction * span) continue;
        const g = gapOf(q); if (g < best - 1e-9) { best = g; c.s = q.s; c.d.copy(q.d); c.r.copy(q.r); }
      }
    }
    const tol = Math.min(0.05 * span, 0.01 * span + 1.5 * Math.max(sample(mp.tris, h, 500).spacing, fixedSample.spacing)), closable = best <= tol;
    // does closing it break a joint that IS supported?
    const after = moved(c); const breaks = supported.some((s: RelationFinding) => { const involved = group.includes(s.a) !== group.includes(s.b); if (!involved) return false; const a = s.a, b = s.b, A = group.includes(a) ? after.find((x) => x.id === a)!.tris : byId.get(a)!.tris, B = group.includes(b) ? after.find((x) => x.id === b)!.tris : byId.get(b)!.tris; return closest(sample(A, h, 400), sample(B, h, 400)).gap > Math.min(0.05 * span, 0.01 * span + 0.03 * span); });
    void Quaternion; void correctedQuaternion;
    diagnoses.push({ relation: f.id, a: f.a, b: f.b, declaredKind: f.declaredKind, gapPctSpan: +(100 * f.gap / span).toFixed(2), moves: mover, bestGapPctSpan: +(100 * best / span).toFixed(2), verdict: closable && !breaks ? 'closable_by_transform' : 'not_closable_by_transform', breaksOtherRelations: breaks, hint: closable && !breaks ? `${mover} (with its subtree) can meet ${fixed} within the allowed scale, rotation and shift` : closable ? `${mover} can meet ${fixed} only by breaking a relation that is currently supported` : `even the best allowed placement of ${mover} leaves ${(100 * best / span).toFixed(1)} % of the span between it and ${fixed}: shape or size mismatch, or a connecting part is missing` });
  }
  const not = new Set<string>(), ok = new Set<string>(); for (const d of diagnoses) (d.verdict === 'not_closable_by_transform' ? not : ok).add(d.moves);
  return { diagnoses, notCorrectableByTransforms: [...not], closable: [...ok].filter((x) => !not.has(x)) };
}
