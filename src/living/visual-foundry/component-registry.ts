/**
 * Canonical component registry: the only names the workspace and the Digital Hand may target.
 *
 * Built from `unfold.assembly.v1`: every part, every actuator (mapped to the parts it is made of) and every revolute
 * joint (a pin). Display meshes carry `userData.partId`; anything without a canonical part id (hoses, studio) is
 * display-only and never resolves to a component. Verification comes from the assembly provenance and is never upgraded.
 */
import type { Assembly, PartRole } from '../contracts';
import type { EvidenceRef, Origin, Validation } from '../../core';

export type ComponentKind = 'part' | 'actuator' | 'joint';
/** An anchor is a point in a canonical part frame; a component's anchor is the mean of its anchors in world space. */
export type Anchor = { partId: string; localM: [number, number, number] };

export type CanonicalComponent = {
  id: string;
  kind: ComponentKind;
  label: string;
  role: PartRole | 'hydraulic_cylinder' | 'rotary_drive' | 'pin';
  /** Canonical parts whose meshes represent this component (highlight, occlusion, isolation). */
  partIds: string[];
  anchors: Anchor[];
  origin: Origin;
  validation: Validation;
  evidence: EvidenceRef[];
};

export type ComponentRegistry = {
  assemblyId: string;
  all(): CanonicalComponent[];
  get(id: string): CanonicalComponent | undefined;
  /** The narrowest component that owns a part: the actuator for a barrel or rod, else the part itself. */
  ownerOfPart(partId: string): CanonicalComponent | undefined;
  /** Case/diacritics-insensitive exact label match (unique matches only). */
  byLabel(label: string): CanonicalComponent[];
};

export const normalizeLabel = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt').trim();

export function buildComponentRegistry(assembly: Assembly): ComponentRegistry {
  const list: CanonicalComponent[] = [];
  const centre = (partId: string): [number, number, number] => {
    const part = assembly.parts.find((p) => p.id === partId)!;
    const shape = part.shapes.find((s) => s.purpose !== 'visual') ?? part.shapes[0];
    return shape ? [...shape.pose.translationM] as [number, number, number] : [0, 0, 0];
  };
  for (const part of assembly.parts) {
    list.push({ id: part.id, kind: 'part', label: part.label, role: part.role, partIds: [part.id], anchors: [{ partId: part.id, localM: centre(part.id) }],
      origin: part.provenance.origin, validation: part.provenance.validation, evidence: part.provenance.evidence ?? [] });
  }
  for (const actuator of assembly.actuators) {
    if (actuator.kind === 'hydraulic_cylinder') {
      // anchor: midway between the base pin (barrel origin) and the rod pin (rod origin), through the motion
      list.push({ id: actuator.id, kind: 'actuator', label: actuator.label, role: 'hydraulic_cylinder', partIds: [actuator.barrelPartId, actuator.rodPartId],
        anchors: [{ partId: actuator.barrelPartId, localM: [0, 0, 0] }, { partId: actuator.rodPartId, localM: [0, 0, 0] }],
        origin: actuator.provenance.origin, validation: actuator.provenance.validation, evidence: actuator.provenance.evidence ?? [] });
    } else {
      const joint = assembly.joints.find((j) => j.id === actuator.jointId)!;
      list.push({ id: actuator.id, kind: 'actuator', label: actuator.label, role: 'rotary_drive', partIds: [joint.childPartId],
        anchors: [{ partId: joint.parentPartId, localM: [...joint.origin.translationM] as [number, number, number] }],
        origin: actuator.provenance.origin, validation: actuator.provenance.validation, evidence: actuator.provenance.evidence ?? [] });
    }
  }
  for (const joint of assembly.joints) {
    if (joint.type !== 'revolute') continue;
    list.push({ id: joint.id, kind: 'joint', label: `Articulação ${joint.id}`, role: 'pin', partIds: [joint.parentPartId, joint.childPartId],
      anchors: [{ partId: joint.parentPartId, localM: [...joint.origin.translationM] as [number, number, number] }],
      origin: joint.provenance.origin, validation: joint.provenance.validation, evidence: joint.provenance.evidence ?? [] });
  }
  const byId = new Map(list.map((c) => [c.id, c]));
  if (byId.size !== list.length) throw new Error('FOUNDRY_DUPLICATE_COMPONENT_ID');
  const ownerOfPart = new Map<string, CanonicalComponent>();
  for (const c of list) if (c.kind === 'part') ownerOfPart.set(c.id, c);
  for (const c of list) if (c.kind === 'actuator' && c.role === 'hydraulic_cylinder') for (const p of c.partIds) ownerOfPart.set(p, c);
  return {
    assemblyId: assembly.id,
    all: () => [...list],
    get: (id) => byId.get(id),
    ownerOfPart: (partId) => ownerOfPart.get(partId),
    byLabel: (label) => { const n = normalizeLabel(label); return list.filter((c) => normalizeLabel(c.label) === n); },
  };
}
