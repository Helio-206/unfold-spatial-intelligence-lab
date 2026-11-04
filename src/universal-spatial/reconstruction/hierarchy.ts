import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { SpatialPlanV2 } from '../contracts-v2';

/**
 * Hierarchy of a plan, read WITHOUT trusting it. A component's transform is LOCAL: it is expressed in its parent's frame (or the plan root's). The world
 * placement of a component is the product of the local matrices from the root down to it. Nothing here mixes the two: `local` is always what the plan
 * stores, `world` is always derived, and a correction is always written back as a local value.
 */
export type HierarchyIssueCode = 'DUPLICATE_ID' | 'SELF_PARENT' | 'MISSING_PARENT' | 'CYCLE' | 'RELATION_UNKNOWN_COMPONENT' | 'RELATION_SELF' | 'RELATION_CONTRADICTS_HIERARCHY' | 'RELATION_MUTUAL_CONTAINMENT' | 'CONSTRAINT_UNKNOWN_COMPONENT';
export type HierarchyIssue = { code: HierarchyIssueCode; ids: string[]; detail: string };
export type Frame = { id: string; parentId: string | null; depth: number; local: Matrix4; world: Matrix4; position: Vector3; rotation: Euler; scale: Vector3 };
export type HierarchyReport = { ok: boolean; issues: HierarchyIssue[]; /** parents before children; empty when the hierarchy is invalid */ order: string[]; frames: Map<string, Frame> };

export const localMatrix = (position: ArrayLike<number>, rotationRad: ArrayLike<number>, scale: ArrayLike<number>): Matrix4 =>
  new Matrix4().compose(new Vector3(position[0], position[1], position[2]), new Quaternion().setFromEuler(new Euler(rotationRad[0], rotationRad[1], rotationRad[2], 'XYZ')), new Vector3(scale[0], scale[1], scale[2]));

/** Structural validation. Reports every problem found; never throws, never repairs. */
export function validateHierarchy(plan: SpatialPlanV2): HierarchyReport {
  const issues: HierarchyIssue[] = [], byId = new Map<string, SpatialPlanV2['components'][number]>(), seen = new Set<string>();
  for (const c of plan.components) { if (seen.has(c.id)) issues.push({ code: 'DUPLICATE_ID', ids: [c.id], detail: `component id ${c.id} appears more than once` }); seen.add(c.id); byId.set(c.id, c); }
  for (const c of plan.components) {
    if (c.parentId === c.id) issues.push({ code: 'SELF_PARENT', ids: [c.id], detail: `${c.id} is its own parent` });
    else if (c.parentId !== null && !byId.has(c.parentId)) issues.push({ code: 'MISSING_PARENT', ids: [c.id, c.parentId], detail: `${c.id} names a parent (${c.parentId}) that does not exist` });
  }
  // cycles: follow parent links; a link that revisits a component of the same walk is a cycle
  const cyclic = new Set<string>();
  for (const c of plan.components) { const walk = new Set<string>(); let cursor: string | null = c.id; while (cursor && byId.has(cursor)) { if (walk.has(cursor)) { for (const id of walk) cyclic.add(id); issues.push({ code: 'CYCLE', ids: [...walk], detail: `parent links of ${[...walk].join(' -> ')} form a cycle` }); break; } walk.add(cursor); cursor = byId.get(cursor)!.parentId; } }
  const ancestors = (id: string) => { const out = new Set<string>(); let cursor = byId.get(id)?.parentId ?? null, guard = 0; while (cursor && guard++ < 1000) { out.add(cursor); cursor = byId.get(cursor)?.parentId ?? null; } return out; };
  const contains = new Set<string>();
  for (const r of plan.relations) {
    if (!byId.has(r.fromId) || !byId.has(r.toId)) { issues.push({ code: 'RELATION_UNKNOWN_COMPONENT', ids: [r.id, r.fromId, r.toId], detail: `relation ${r.id} names a component that does not exist` }); continue; }
    if (r.fromId === r.toId) { issues.push({ code: 'RELATION_SELF', ids: [r.id], detail: `relation ${r.id} relates ${r.fromId} to itself` }); continue; }
    if (r.kind === 'contains') { contains.add(`${r.fromId}>${r.toId}`); if (!cyclic.has(r.fromId) && ancestors(r.fromId).has(r.toId)) issues.push({ code: 'RELATION_CONTRADICTS_HIERARCHY', ids: [r.id, r.fromId, r.toId], detail: `relation ${r.id} says ${r.fromId} contains ${r.toId}, but ${r.toId} is an ancestor of ${r.fromId}` }); }
  }
  for (const key of contains) { const [a, b] = key.split('>') as [string, string]; if (a < b && contains.has(`${b}>${a}`)) issues.push({ code: 'RELATION_MUTUAL_CONTAINMENT', ids: [a, b], detail: `${a} contains ${b} and ${b} contains ${a}` }); }
  for (const c of plan.constraints) for (const id of c.componentIds) if (!byId.has(id)) issues.push({ code: 'CONSTRAINT_UNKNOWN_COMPONENT', ids: [c.id, id], detail: `constraint ${c.id} names a component that does not exist` });

  const structural = issues.some((i) => ['DUPLICATE_ID', 'SELF_PARENT', 'MISSING_PARENT', 'CYCLE'].includes(i.code));
  const frames = new Map<string, Frame>(), order: string[] = [];
  if (!structural) {
    const place = (id: string, depth: number): void => {
      const c = byId.get(id)!, local = localMatrix(c.transform.position, c.transform.rotationRad, c.transform.scale), parent = c.parentId ? frames.get(c.parentId)! : null;
      frames.set(id, { id, parentId: c.parentId, depth, local, world: parent ? parent.world.clone().multiply(local) : local.clone(), position: new Vector3(...c.transform.position), rotation: new Euler(...(c.transform.rotationRad as [number, number, number]), 'XYZ'), scale: new Vector3(...c.transform.scale) }); order.push(id);
    };
    const children = new Map<string | null, string[]>(); for (const c of plan.components) children.set(c.parentId, [...(children.get(c.parentId) ?? []), c.id]);
    const visit = (id: string, depth: number) => { place(id, depth); for (const child of children.get(id) ?? []) visit(child, depth + 1); };
    for (const id of children.get(null) ?? []) visit(id, 0);
  }
  return { ok: issues.length === 0, issues, order, frames };
}

export const maxDepth = (report: HierarchyReport): number => Math.max(0, ...[...report.frames.values()].map((f) => f.depth));
