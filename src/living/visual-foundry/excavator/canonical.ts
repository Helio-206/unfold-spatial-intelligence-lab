/**
 * Read-only accessors over the canonical assembly. The display geometry is placed from these numbers (pins, joint
 * origins, cylinder lengths), never from its own copy of them, so the high-fidelity meshes stay attached to the
 * canonical engineering geometry when the fixture changes.
 */
import type { Assembly, CylinderShape, HydraulicCylinder, Joint, Part } from '../../contracts';

export type CanonicalView = {
  assembly: Assembly;
  part(id: string): Part;
  joint(id: string): Joint;
  /** Joint origin (pin) in the parent part frame, XY plane. */
  pin(jointId: string): [number, number];
  point(partId: string, pointId: string): [number, number];
  cylinder(actuatorId: string): { closedLengthM: number; barrelLengthM: number; barrelRadiusM: number; rodLengthM: number; rodRadiusM: number; strokeMaxM: number; referenceStrokeM: number; actuator: HydraulicCylinder };
};

export function canonicalView(assembly: Assembly): CanonicalView {
  const parts = new Map(assembly.parts.map((p) => [p.id, p]));
  const joints = new Map(assembly.joints.map((j) => [j.id, j]));
  const need = <T>(map: Map<string, T>, id: string, kind: string): T => { const v = map.get(id); if (!v) throw new Error(`FOUNDRY_CANONICAL_MISSING_${kind}:${id}`); return v; };
  return {
    assembly,
    part: (id) => need(parts, id, 'PART'),
    joint: (id) => need(joints, id, 'JOINT'),
    pin(jointId) { const t = need(joints, jointId, 'JOINT').origin.translationM; return [t[0], t[1]]; },
    point(partId, pointId) {
      const p = need(parts, partId, 'PART').points.find((x) => x.id === pointId);
      if (!p) throw new Error(`FOUNDRY_CANONICAL_MISSING_POINT:${partId}.${pointId}`);
      return [p.positionM[0], p.positionM[1]];
    },
    cylinder(actuatorId) {
      const a = assembly.actuators.find((x) => x.id === actuatorId);
      if (!a || a.kind !== 'hydraulic_cylinder') throw new Error(`FOUNDRY_CANONICAL_MISSING_CYLINDER:${actuatorId}`);
      const barrel = need(parts, a.barrelPartId, 'PART').shapes.find((s): s is CylinderShape => s.kind === 'cylinder');
      const rod = need(parts, a.rodPartId, 'PART').shapes.find((s): s is CylinderShape => s.kind === 'cylinder');
      if (!barrel || !rod) throw new Error(`FOUNDRY_CANONICAL_MISSING_CYLINDER_SHAPE:${actuatorId}`);
      return {
        closedLengthM: need(joints, a.slideJointId, 'JOINT').origin.translationM[0],
        barrelLengthM: barrel.halfLengthM * 2, barrelRadiusM: barrel.radiusM, rodLengthM: rod.halfLengthM * 2, rodRadiusM: rod.radiusM,
        strokeMaxM: a.stroke.max.value, referenceStrokeM: a.referenceStroke.value, actuator: a,
      };
    },
  };
}
