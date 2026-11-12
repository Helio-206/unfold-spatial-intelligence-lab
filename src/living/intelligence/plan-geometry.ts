import { Box3, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { GeometryNodeV2, GeometryTransformV2, SpatialPlanV2 } from '../../universal-spatial/contracts-v2';
import type { PartBox } from './collision';
import type { Vec3 } from './mechanism';

/**
 * Coordinates and rough extents of a plan's components, computed from the plan itself (no rendering): the box each component occupies at rest, and the shape clues the
 * functional heuristics read (cylindrical/radial parts and their axes). Extents are the operators' parameters, an approximation for shapes without simple bounds (loft),
 * which are reported as `unbounded` rather than guessed.
 */
export type ShapeClue = { operator: string; axis: Vec3 | null; radius: number | null; world: Matrix4 };
export type ComponentGeometry = { id: string; box: PartBox | null; clues: ShapeClue[]; radialRepeat: { axis: Vec3; count: number } | null; unbounded: boolean };
const matrixOf = (t: GeometryTransformV2) => new Matrix4().compose(new Vector3(...t.position), new Quaternion().setFromEuler(new Euler(...t.rotationRad, 'XYZ')), new Vector3(...t.scale));
const AX = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] } as const;

function localExtent(node: Extract<GeometryNodeV2, { type: 'shape' }>): { half: Vec3; axis: Vec3 | null; radius: number | null } | null {
  const p = node.parameters as Record<string, unknown>, n = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d), pts = (v: unknown) => (Array.isArray(v) ? (v as number[][]).filter((a) => Array.isArray(a)) : []);
  switch (node.operator) {
    case 'box': case 'rounded_box': { const d = (p.dimensions as number[]) ?? [1, 1, 1]; return { half: [d[0]! / 2, d[1]! / 2, d[2]! / 2], axis: null, radius: null }; }
    case 'sphere': return { half: [n(p.radius), n(p.radius), n(p.radius)], axis: null, radius: n(p.radius) };
    case 'ellipsoid': { const r = (p.radii as number[]) ?? [1, 1, 1]; return { half: [r[0]!, r[1]!, r[2]!], axis: null, radius: null }; }
    case 'cylinder': { const r = Math.max(n(p.radiusTop), n(p.radiusBottom)), h = n(p.height); return { half: [r, h / 2, r], axis: [0, 1, 0], radius: r }; }
    case 'cone': { const r = n(p.radius), h = n(p.height); return { half: [r, h / 2, r], axis: [0, 1, 0], radius: r }; }
    case 'torus': { const R = n(p.majorRadius), r = n(p.tubeRadius); return { half: [R + r, R + r, r], axis: [0, 0, 1], radius: R + r }; }
    case 'revolve': { const q = pts(p.profile); if (!q.length) return null; const R = Math.max(...q.map((a) => Math.abs(a[0]!))), y0 = Math.min(...q.map((a) => a[1]!)), y1 = Math.max(...q.map((a) => a[1]!)); return { half: [R, (y1 - y0) / 2, R], axis: [0, 1, 0], radius: R }; }
    case 'extrude': { const q = pts(p.profile), d = n(p.depth); if (!q.length) return null; return { half: [Math.max(...q.map((a) => Math.abs(a[0]!))), Math.max(...q.map((a) => Math.abs(a[1]!))), d / 2], axis: null, radius: null }; }
    case 'tube': { const q = pts(p.points), r = n(p.radius); if (!q.length) return null; return { half: [Math.max(...q.map((a) => Math.abs(a[0]!))) + r, Math.max(...q.map((a) => Math.abs(a[1]!))) + r, Math.max(...q.map((a) => Math.abs(a[2] ?? 0))) + r], axis: null, radius: r }; }
    default: return null; // loft and anything without simple bounds
  }
}
export function componentGeometry(plan: SpatialPlanV2, id: string): ComponentGeometry | null {
  const c = plan.components.find((x) => x.id === id); if (!c) return null;
  // a component nested under a parent is positioned relative to it: compose up the chain
  let world = matrixOf(c.transform); for (let p = c.parentId, guard = 0; p && guard < 16; guard++) { const pc = plan.components.find((x) => x.id === p); if (!pc) break; world = matrixOf(pc.transform).multiply(world); p = pc.parentId; }
  const box = new Box3(), clues: ShapeClue[] = []; let unbounded = false, radial: ComponentGeometry['radialRepeat'] = null;
  const walk = (node: GeometryNodeV2, m: Matrix4, repeatAxis: Vec3 | null) => {
    const here = m.clone().multiply(matrixOf(node.transform)); let rep = repeatAxis; if (node.repeat?.kind === 'radial') { rep = [...AX[node.repeat.axis]] as Vec3; radial = { axis: rep, count: node.repeat.count }; }
    if (node.type === 'group') { node.children.forEach((ch) => walk(ch, here, rep)); return; }
    const e = localExtent(node); if (!e) { unbounded = true; return; }
    const R = Math.max(...e.half) * (node.repeat?.kind === 'radial' ? 1 : 0), spread = node.repeat ? (node.repeat.kind === 'radial' ? node.repeat.spacingOrRadius : node.repeat.spacingOrRadius * (node.repeat.count - 1)) : 0;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) { const v = new Vector3(sx * (e.half[0] + (node.repeat ? spread + R : 0)), sy * (e.half[1] + (node.repeat ? spread + R : 0)), sz * (e.half[2] + (node.repeat ? spread + R : 0))).applyMatrix4(here); box.expandByPoint(v); }
    const axis = e.axis ? new Vector3(...e.axis).transformDirection(here) : null; clues.push({ operator: node.operator, axis: axis ? [axis.x, axis.y, axis.z] : null, radius: e.radius, world: here });
  };
  walk(c.geometry, world, null);
  if (box.isEmpty()) return { id, box: null, clues, radialRepeat: radial, unbounded: true };
  const ctr = box.getCenter(new Vector3()), size = box.getSize(new Vector3());
  return { id, box: { part: id, center: [ctr.x, ctr.y, ctr.z], half: [size.x / 2, size.y / 2, size.z / 2] }, clues, radialRepeat: radial, unbounded };
}
export const allGeometry = (plan: SpatialPlanV2): ComponentGeometry[] => plan.components.map((c) => componentGeometry(plan, c.id)!).filter(Boolean);
