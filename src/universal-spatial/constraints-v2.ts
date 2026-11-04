import { Box3, Vector3, type Group, type Object3D } from 'three';
import type { ConstraintV2, GeometryNodeV2, SpatialPlanV2 } from './contracts-v2';

export type ConstraintResultV2 = { id: string; kind: ConstraintV2['kind']; status: 'satisfied' | 'violated'; measured: number; tolerance: number; method: 'world-transform' | 'axis-aligned-bounds'; limitation: string };
export type ConstraintReportV2 = { ready: boolean; results: ConstraintResultV2[]; violatedIds: string[] };

const AXES: Record<NonNullable<ConstraintV2['axis']>, Vector3> = {
  x: new Vector3(1, 0, 0), y: new Vector3(0, 1, 0), z: new Vector3(0, 0, 1),
};
const direction = (object: Object3D, axis: ConstraintV2['axis']) => {
  const q = object.getWorldQuaternion(object.quaternion.clone());
  return (axis ? AXES[axis] : AXES.y).clone().applyQuaternion(q).normalize();
};
const boxFor = (object: Object3D) => new Box3().setFromObject(object);
const centerFor = (box: Box3) => box.getCenter(new Vector3());
const boxGap = (a: Box3, b: Box3): number => {
  const dx = Math.max(a.min.x - b.max.x, b.min.x - a.max.x, 0);
  const dy = Math.max(a.min.y - b.max.y, b.min.y - a.max.y, 0);
  const dz = Math.max(a.min.z - b.max.z, b.min.z - a.max.z, 0);
  return Math.hypot(dx, dy, dz);
};
const axisOffset = (delta: Vector3, axis: Vector3) => delta.clone().addScaledVector(axis, -delta.dot(axis)).length();

function measure(constraint: ConstraintV2, objects: Object3D[], boxes: Box3[]): { value: number; method: ConstraintResultV2['method'] } {
  const [a, b] = objects;
  const [ba, bb, bc] = boxes;
  const ca = centerFor(ba!), cb = centerFor(bb!);
  const delta = cb.clone().sub(ca);
  const axis = direction(a!, constraint.axis);
  switch (constraint.kind) {
    case 'coaxial': {
      const directionA = direction(a!, constraint.axis), directionB = direction(b!, constraint.axis);
      const angle = Math.acos(Math.min(1, Math.max(-1, Math.abs(directionA.dot(directionB)))));
      const sizeA = ba!.getSize(new Vector3()).length(), sizeB = bb!.getSize(new Vector3()).length();
      return { value: Math.max(axisOffset(delta, axis), angle * Math.max(sizeA, sizeB)), method: 'world-transform' };
    }
    case 'parallel': return { value: Math.acos(Math.min(1, Math.abs(direction(a!, constraint.axis).dot(direction(b!, constraint.axis))))), method: 'world-transform' };
    case 'perpendicular': return { value: Math.asin(Math.min(1, Math.abs(direction(a!, constraint.axis).dot(direction(b!, constraint.axis))))), method: 'world-transform' };
    case 'aligned': return { value: axisOffset(delta, axis), method: 'world-transform' };
    case 'centered_on': return { value: delta.length(), method: 'axis-aligned-bounds' };
    case 'attached_at': return { value: boxGap(ba!, bb!), method: 'axis-aligned-bounds' };
    case 'symmetric': {
      const reflected = ca.clone(); reflected.setComponent(constraint.axis === 'x' ? 0 : constraint.axis === 'y' ? 1 : 2, -reflected.getComponent(constraint.axis === 'x' ? 0 : constraint.axis === 'y' ? 1 : 2));
      return { value: reflected.distanceTo(cb), method: 'axis-aligned-bounds' };
    }
    case 'maintains_clearance': return { value: boxGap(ba!, bb!), method: 'axis-aligned-bounds' };
    case 'distributed_around': {
      const hub = ca, points = boxes.slice(1).map(centerFor).map((point) => point.sub(hub));
      const u = axis.clone().cross(Math.abs(axis.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)).normalize();
      const v = axis.clone().cross(u).normalize();
      const angles = points.map((point) => Math.atan2(point.dot(v), point.dot(u))).map((angle) => angle < 0 ? angle + Math.PI * 2 : angle).sort((x, y) => x - y);
      const radii = points.map((point) => axisOffset(point, axis));
      const steps = angles.map((angle, index) => ((angles[(index + 1) % angles.length]! + (index === angles.length - 1 ? Math.PI * 2 : 0)) - angle));
      const targetStep = Math.PI * 2 / points.length;
      const radius = Math.max(...radii);
      return { value: Math.max(Math.max(...radii) - Math.min(...radii), ...steps.map((step) => Math.abs(step - targetStep) * radius)), method: 'axis-aligned-bounds' };
    }
    case 'connected_by_curve': return { value: Math.max(boxGap(ba!, bc!), boxGap(bb!, bc!)), method: 'axis-aligned-bounds' };
  }
}

/**
 * Verifies constraints against the compiled scene. Contact and distribution use component AABBs,
 * so the result is a geometric screen, not a collision/engineering proof.
 */
export function evaluateSpatialConstraintsV2(plan: SpatialPlanV2, root: Group): ConstraintReportV2 {
  root.updateMatrixWorld(true);
  const entities = new Map<string, Object3D>();
  root.traverse((object) => { const id = object.userData.spatialEntityId; if (object.userData.spatialComponentRoot === true && typeof id === 'string') entities.set(id, object); });
  const results = plan.constraints.map((constraint): ConstraintResultV2 => {
    const objects = constraint.componentIds.map((id) => entities.get(id));
    if (objects.some((object) => !object)) return { id: constraint.id, kind: constraint.kind, status: 'violated', measured: Infinity, tolerance: constraint.tolerance, method: 'axis-aligned-bounds', limitation: 'Referenced component was not compiled.' };
    const resolved = objects as Object3D[];
    if (constraint.kind === 'distributed_around') {
      const center = resolved[0]!.getWorldPosition(new Vector3()), pattern = findRadialPattern(plan.components.find((part) => part.id === constraint.componentIds[1])!.geometry);
      const partOrigin = resolved[1]!.getWorldPosition(new Vector3()), offset = partOrigin.sub(center);
      const axisVector = direction(resolved[0]!, constraint.axis);
      const axisOffsetM = axisOffset(offset, axisVector), sameAxis = pattern?.axis === constraint.axis;
      const measured = Math.max(axisOffsetM, pattern ? 1 / pattern.count : Infinity);
      const satisfied = Boolean(pattern && sameAxis && pattern.count >= 3 && axisOffsetM <= constraint.tolerance);
      return { id: constraint.id, kind: constraint.kind, status: satisfied ? 'satisfied' : 'violated', measured: satisfied ? axisOffsetM : measured, tolerance: constraint.tolerance, method: 'world-transform', limitation: 'Verifies the compiler-generated radial pattern metadata and component origin; does not inspect part-to-part contact.' };
    }
    const boxes = resolved.map(boxFor);
    const result = measure(constraint, resolved, boxes);
    const within = constraint.kind === 'maintains_clearance' ? result.value >= constraint.tolerance : result.value <= constraint.tolerance;
    return { id: constraint.id, kind: constraint.kind, status: within ? 'satisfied' : 'violated', measured: result.value, tolerance: constraint.tolerance, method: result.method, limitation: result.method === 'axis-aligned-bounds' ? 'AABB approximation; does not prove contact of actual surfaces or physical validity.' : 'Transform relation only; does not prove mechanical validity.' };
  });
  const violatedIds = results.filter((result) => result.status === 'violated').map((result) => result.id);
  return { ready: violatedIds.length === 0, results, violatedIds };
}

function findRadialPattern(node: GeometryNodeV2): { axis: string; count: number } | null {
  if (node.repeat?.kind === 'radial') return { axis: node.repeat.axis, count: node.repeat.count };
  if (node.type === 'group') for (const child of node.children) { const result = findRadialPattern(child); if (result) return result; }
  return null;
}
