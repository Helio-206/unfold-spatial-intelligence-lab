import { Matrix4, Vector3 } from 'three';
import { applySpatialOperationV2, isValidShapeParametersV2, type GeometryNodeV2, type MaterialV2, type SpatialOperationV2, type SpatialPlanV2 } from '../contracts-v2';

export type Vec3 = [number, number, number];
export type BeamSection = { z: number; width: number; height: number };
export type Joint = { id: string; a: string; b: string; anchorA: Vec3; anchorB: Vec3 };
export type BodyFrame = { id: string; parentId: string | null; position: Vec3; rotationRad: Vec3 };
const identity = () => ({ position: [0, 0, 0] as Vec3, rotationRad: [0, 0, 0] as Vec3, scale: [1, 1, 1] as Vec3 });
const idPattern = /^[a-z][a-z0-9-]{0,47}$/;
const finite = (n: number) => Number.isFinite(n) && Math.abs(n) <= 1000;
const vec = (v: Vec3) => Array.isArray(v) && v.length === 3 && v.every(finite);
const shape = (key: string, operator: 'loft' | 'extrude', parameters: Record<string, unknown>, material: MaterialV2): GeometryNodeV2 => {
  if (!idPattern.test(key) || !isValidShapeParametersV2(operator, parameters)) throw new Error('INVALID_GEOMETRY');
  return { type: 'shape', key, operator, parameters, transform: identity(), repeat: null, material: { ...material } };
};

/** A straight beam along local Z; each section gives its complete rectangular cross-section. */
export function taperedBeam(key: string, sections: BeamSection[], material: MaterialV2): GeometryNodeV2 {
  if (!Array.isArray(sections) || sections.length < 2 || sections.length > 32 || sections.some((s, i) => !finite(s.z) || !finite(s.width) || !finite(s.height) || s.width <= 0 || s.height <= 0 || (i > 0 && s.z <= sections[i - 1]!.z))) throw new Error('INVALID_SECTIONS');
  return shape(key, 'loft', { profile: [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]], sections: sections.map(s => [s.z, s.width, s.height]), capEnds: [true, true] }, material);
}

/** Open trough from an extruded concave profile. Ends are open, not an enclosed bucket. */
export function troughShell(key: string, width: number, height: number, depth: number, thickness: number, material: MaterialV2): GeometryNodeV2 {
  if (![width, height, depth, thickness].every(n => finite(n) && n > 0) || thickness * 2 >= width || thickness >= height) throw new Error('INVALID_SHELL');
  const w = width / 2, t = thickness;
  return shape(key, 'extrude', { profile: [[-w, 0], [w, 0], [w, height], [w - t, height], [w - t, t], [-w + t, t], [-w + t, height], [-w, height]], depth, bevelM: 0, curveSegments: 1 }, material);
}

/** Measures supplied anchors in rigid parent-relative frames. Does not move, fit, or invent joints. */
export function measureJointClosure(bodies: BodyFrame[], joints: Joint[]): Array<{ id: string; residual: number }> {
  if (bodies.length > 64 || joints.length > 128) throw new Error('ASSEMBLY_BUDGET');
  const byId = new Map<string, BodyFrame>();
  for (const b of bodies) {
    if (!idPattern.test(b.id) || byId.has(b.id) || !vec(b.position) || !vec(b.rotationRad)) throw new Error('INVALID_BODY');
    byId.set(b.id, b);
  }
  const cache = new Map<string, Matrix4>(), visiting = new Set<string>();
  const world = (id: string): Matrix4 => {
    const cached = cache.get(id); if (cached) return cached;
    const b = byId.get(id); if (!b || visiting.has(id)) throw new Error('INVALID_HIERARCHY');
    visiting.add(id);
    const e = new Matrix4().makeRotationFromEuler(new (EulerClass)(...b.rotationRad));
    e.setPosition(...b.position);
    const out = b.parentId === null ? e : world(b.parentId).clone().multiply(e);
    visiting.delete(id); cache.set(id, out); return out;
  };
  for (const b of bodies) world(b.id);
  const ids = new Set<string>();
  return joints.map(j => {
    if (!idPattern.test(j.id) || ids.has(j.id) || j.a === j.b || !vec(j.anchorA) || !vec(j.anchorB)) throw new Error('INVALID_JOINT');
    ids.add(j.id);
    const a = new Vector3(...j.anchorA).applyMatrix4(world(j.a));
    const b = new Vector3(...j.anchorB).applyMatrix4(world(j.b));
    return { id: j.id, residual: a.distanceTo(b) };
  });
}
import { Euler as EulerClass } from 'three';

/** Validate a candidate against the full plan without mutating it or granting approval. */
export function proposeGeometry(plan: SpatialPlanV2, componentId: string, geometry: GeometryNodeV2, evidence: string): { operation: SpatialOperationV2; provenance: { origin: 'inferred'; evidence: string } } {
  const component = plan.components.find(c => c.id === componentId);
  if (!component || geometry.key !== component.geometry.key || !evidence.trim() || evidence.length > 500) throw new Error('INVALID_PROPOSAL');
  const operation: SpatialOperationV2 = { contract: 'unfold.spatial-operation.v2', operationId: `parametric-${componentId}`, kind: 'set-geometry', componentId, nodeKey: geometry.key, value: geometry };
  const provenance = { origin: 'inferred' as const, evidence };
  applySpatialOperationV2(plan, operation, provenance);
  return { operation, provenance };
}
