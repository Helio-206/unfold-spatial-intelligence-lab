import { Box3, Vector3, type Object3D } from 'three';
import type { SpatialPlanV2 } from '../../universal-spatial/contracts-v2';
import { collectWorldPoints } from '../../universal-spatial/framing';
import type { PointOfInterest, SequenceStep } from './types';

/**
 * What the presentation may say about an object, derived only from the reviewed plan and the compiled geometry: hierarchy (`parentId`), declared
 * relations, bounding-box contact, size and repetition. Nothing here knows what the object is, and nothing infers joints, kinematics or physics.
 * The order it produces is a presentation order, not an assembly procedure.
 */
export type ComponentMeasure = { id: string; centre: Vector3; box: Box3; volume: number; extent: number; level: number; childCount: number; repeated: number };
export type Measures = Map<string, ComponentMeasure> & { span?: number; centre?: Vector3 };

const TOUCH = 0.004;

/** World-space measure of each component's OWN geometry (children components are measured separately). */
export function measureComponents(plan: SpatialPlanV2, root: Object3D): Measures {
  root.updateMatrixWorld(true);
  const groups = new Map<string, Object3D>(); root.traverse((object) => { if (object.userData.spatialComponentRoot) groups.set(object.userData.spatialEntityId as string, object); });
  const level = (id: string): number => { const c = plan.components.find((item) => item.id === id); return c?.parentId ? 1 + level(c.parentId) : 0; };
  const repeats = (node: SpatialPlanV2['components'][number]['geometry']): number => (node.repeat ? node.repeat.count : 1) * (node.type === 'group' ? Math.max(1, ...node.children.map(repeats)) : 1);
  const out: Measures = new Map(); const whole = new Box3();
  for (const component of plan.components) {
    const group = groups.get(component.id); if (!group) continue;
    const points = collectWorldPoints(group, 800, (object) => Boolean(object.userData.spatialComponentRoot));
    if (!points.length) continue;
    const box = new Box3().setFromPoints(points), size = box.getSize(new Vector3()); whole.union(box);
    out.set(component.id, { id: component.id, centre: box.getCenter(new Vector3()), box, volume: Math.max(size.x * size.y * size.z, 1e-18), extent: Math.max(size.x, size.y, size.z), level: level(component.id), childCount: plan.components.filter((c) => c.parentId === component.id).length, repeated: repeats(component.geometry) });
  }
  const size = whole.getSize(new Vector3()); out.span = Math.max(size.x, size.y, size.z, 1e-12); out.centre = whole.getCenter(new Vector3());
  return out;
}

const gapBetween = (a: Box3, b: Box3): number => {
  const dx = Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x), dy = Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y), dz = Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z);
  return Math.hypot(dx, dy, dz);
};
const spanOf = (m: Measures) => m.span ?? 1;

export function assemblySequence(plan: SpatialPlanV2, m: Measures): SequenceStep[] {
  const span = spanOf(m), tol = span * TOUCH, label = (id: string) => plan.components.find((c) => c.id === id)?.label ?? id;
  const placed: string[] = [], steps: SequenceStep[] = [], remaining = plan.components.map((c) => c.id).filter((id) => m.has(id));
  const push = (id: string, reason: string) => { placed.push(id); remaining.splice(remaining.indexOf(id), 1); steps.push({ componentId: id, label: label(id), order: steps.length, reason }); };
  const roots = remaining.filter((id) => !plan.components.find((c) => c.id === id)!.parentId);
  const firstPool = roots.length ? roots : remaining;
  if (firstPool.length) {
    const start = [...firstPool].sort((a, b) => Math.round(m.get(a)!.box.min.y / (span * 0.02)) - Math.round(m.get(b)!.box.min.y / (span * 0.02)) || m.get(b)!.volume - m.get(a)!.volume || a.localeCompare(b))[0]!;
    push(start, 'Grounded start: the lowest of the top-level parts, the largest when level.');
  }
  while (remaining.length) {
    const candidates = remaining.filter((id) => { const parent = plan.components.find((c) => c.id === id)!.parentId; return !parent || placed.includes(parent) || !m.has(parent); });
    const pool = candidates.length ? candidates : remaining;
    const scored = pool.map((id) => {
      const mine = m.get(id)!; let nearest = Infinity, nearestId = placed[0]!;
      for (const other of placed) { const gap = gapBetween(mine.box, m.get(other)!.box); if (gap < nearest) { nearest = gap; nearestId = other; } }
      const parent = plan.components.find((c) => c.id === id)!.parentId;
      return { id, touching: nearest <= tol, nearest, nearestId, parent, volume: mine.volume };
    }).sort((a, b) => Number(!a.touching) - Number(!b.touching) || a.nearest - b.nearest || b.volume - a.volume || a.id.localeCompare(b.id));
    const pick = scored[0]!;
    push(pick.id, pick.parent && placed.includes(pick.parent) && pick.touching ? `Child of ${label(pick.parent)}, built where it touches it.` : pick.touching ? `Touches ${label(pick.nearestId)}, which is already in place.` : `Nearest remaining part to what is built (${label(pick.nearestId)}).`);
  }
  for (const c of plan.components) if (!m.has(c.id)) steps.push({ componentId: c.id, label: c.label, order: steps.length, reason: 'No measurable geometry; shown last.' });
  return steps;
}

export function pointsOfInterest(plan: SpatialPlanV2, m: Measures, steps: readonly SequenceStep[], max: number): PointOfInterest[] {
  const span = spanOf(m), tol = span * TOUCH, order = new Map(steps.map((s) => [s.componentId, s.order]));
  const label = (id: string) => plan.components.find((c) => c.id === id)?.label ?? id;
  const whole = new Box3(); for (const item of m.values()) whole.union(item.box);
  const out: PointOfInterest[] = [];
  if (!whole.isEmpty()) { const centre = whole.getCenter(new Vector3()); out.push({ id: 'poi:overview', kind: 'overview', label: plan.title, why: 'The whole assembly.', componentIds: [], centre: centre.toArray() as [number, number, number], radius: whole.getSize(new Vector3()).length() / 2 }); }
  const totalVolume = [...m.values()].reduce((sum, item) => sum + item.volume, 0) || 1, maxVolume = Math.max(...[...m.values()].map((item) => item.volume), 1e-18);
  const comps = [...m.values()].map((item) => ({ item, score: item.volume / maxVolume + 0.4 * item.childCount + (item.repeated > 1 ? 0.25 : 0) })).sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id));
  const jointBudget = max >= 6 ? 2 : 0, componentBudget = Math.max(0, max - 1 - jointBudget);
  const picked = comps.slice(0, componentBudget).map(({ item }) => {
    const why = item.childCount >= 2 ? `Carries ${item.childCount} other parts.` : item.repeated > 1 ? `A group repeated ${item.repeated} times.` : item.volume / totalVolume > 0.2 ? `A large part (${Math.round((100 * item.volume) / totalVolume)}% of the assembly's bounding volume).` : 'One of the larger separate parts.';
    return { order: order.get(item.id) ?? 0, poi: { id: `poi:${item.id}`, kind: 'component' as const, label: label(item.id), why, componentIds: [item.id], centre: item.centre.toArray() as [number, number, number], radius: Math.max(item.box.getSize(new Vector3()).length() / 2, span * 0.02) } };
  });
  const pairs = new Map<string, [string, string]>();
  for (const r of plan.relations) pairs.set([r.fromId, r.toId].sort().join('|'), [r.fromId, r.toId]);
  for (const c of plan.components) if (c.parentId) pairs.set([c.id, c.parentId].sort().join('|'), [c.id, c.parentId]);
  const joints = [...pairs.values()].filter(([a, b]) => m.has(a) && m.has(b) && gapBetween(m.get(a)!.box, m.get(b)!.box) <= tol)
    .map(([a, b]) => ({ a, b, size: Math.min(m.get(a)!.volume, m.get(b)!.volume) })).sort((x, y) => y.size - x.size || (x.a + x.b).localeCompare(y.a + y.b)).slice(0, jointBudget || (max > 1 ? Math.max(0, max - 1 - picked.length) : 0));
  const jointPois = joints.map(({ a, b }) => {
    const A = m.get(a)!.box, B = m.get(b)!.box, overlap = A.clone().intersect(B);
    const centre = (overlap.isEmpty() ? A.clone().union(B) : overlap).getCenter(new Vector3()), small = Math.min(m.get(a)!.extent, m.get(b)!.extent);
    return { order: Math.max(order.get(a) ?? 0, order.get(b) ?? 0) + 0.5, poi: { id: `poi:${a}+${b}`, kind: 'joint' as const, label: `${label(a)} / ${label(b)}`, why: 'Where two related parts meet (their bounding boxes touch).', componentIds: [a, b], centre: centre.toArray() as [number, number, number], radius: Math.max(small * 0.6, span * 0.03) } };
  });
  return [...out, ...[...picked, ...jointPois].sort((x, y) => x.order - y.order).map((entry) => entry.poi)].slice(0, Math.max(1, max));
}

/** World-space offset of each component RELATIVE to its parent's own displacement (nested groups compose them), for an exploded view at `amount` 0..1. */
export function explodeOffsets(plan: SpatialPlanV2, m: Measures, amount: number, spread = 0.45): Map<string, Vector3> {
  const span = spanOf(m), out = new Map<string, Vector3>(); const k = Math.max(0, Math.min(1, amount)) * spread * span;
  const rootIds = plan.components.filter((c) => !c.parentId && m.has(c.id)).map((c) => c.id);
  const anchorId = rootIds.length ? [...rootIds].sort((a, b) => m.get(a)!.box.min.y - m.get(b)!.box.min.y || m.get(b)!.volume - m.get(a)!.volume)[0]! : null;
  const fallbackDir = (id: string) => { let h = 2166136261; for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); const a = ((h >>> 0) % 360) * (Math.PI / 180); return new Vector3(Math.cos(a), 0.6, Math.sin(a)).normalize(); };
  for (const c of plan.components) {
    const mine = m.get(c.id); if (!mine) { out.set(c.id, new Vector3()); continue; }
    const origin = c.parentId && m.get(c.parentId) ? m.get(c.parentId)!.centre : anchorId && anchorId !== c.id ? m.get(anchorId)!.centre : null;
    if (!origin) { out.set(c.id, new Vector3()); continue; }
    const delta = mine.centre.clone().sub(origin), distance = delta.length();
    const dir = distance > span * 1e-6 ? delta.divideScalar(distance) : fallbackDir(c.id);
    out.set(c.id, dir.multiplyScalar(k * (0.25 + 0.75 * Math.min(1, distance / (0.5 * span)))));
  }
  return out;
}
