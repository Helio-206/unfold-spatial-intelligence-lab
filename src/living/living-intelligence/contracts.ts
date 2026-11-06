/**
 * `unfold.living-scene.v1` — modelo vivo independente do renderer.
 * Constrói-se a partir de uma `unfold.assembly.v1` validada; nunca inventa estrutura.
 * Capacidade sem junta/actuador correspondente é `unavailable`, nunca presumida.
 */
import { validateAssembly, type Assembly, type PartRole } from '../contracts';
import type { Provenance } from '../../core';

export const LIVING_SCENE_SCHEMA = 'unfold.living-scene.v1' as const;
export type EvidenceLevel = 'kinematically_valid' | 'mechanically_plausible' | 'physically_validated';
export type CapabilityStatus = 'supported' | 'inferred' | 'unavailable';
export type ParameterStatus = 'known' | 'inferred' | 'unknown';

export type LivingParameter = { id: string; label: string; value: number | null; unit: string; status: ParameterStatus; provenance: Provenance | null };
export type MotionCapability = { jointId: string; kind: 'revolute' | 'prismatic' | 'fixed'; min: number | null; max: number | null; unit: 'rad' | 'm' | 'none'; status: CapabilityStatus };
export type LivingEntity = {
  id: string; label: string; role: PartRole | 'actuator' | 'joint';
  parentId: string | null; childIds: string[];
  jointId: string | null; actuatorId: string | null;
  capabilities: MotionCapability[];
  parameters: LivingParameter[];
  review: { origin: string; validation: string; reviewed: boolean };
  evidence: Provenance['evidence'];
};
export type LivingScene = {
  schema: typeof LIVING_SCENE_SCHEMA; version: 1;
  assemblyId: string; title: string; sourceRevision: string;
  entities: LivingEntity[];
  supported: string[]; inferred: string[]; unavailable: string[];
  evidenceLevel: EvidenceLevel;
};

const param = (id: string, label: string, q: { value: number; unit: string; provenance: Provenance } | null, inferred = false): LivingParameter =>
  q ? { id, label, value: q.value, unit: q.unit, status: inferred ? 'inferred' : 'known', provenance: q.provenance }
      : { id, label, value: null, unit: 'none', status: 'unknown', provenance: null };

export function buildLivingScene(assembly: Assembly, sourceRevision = 'assembly-v1'): LivingScene {
  const v = validateAssembly(assembly);
  if (!v.ok) throw new Error(`LIVING_SCENE_INVALID_ASSEMBLY: ${v.issues[0]?.path} ${v.issues[0]?.code}`);
  const entities: LivingEntity[] = [];
  const parentOf = new Map(assembly.joints.map(j => [j.childPartId, j.parentPartId]));
  const jointOfChild = new Map(assembly.joints.map(j => [j.childPartId, j]));
  const childrenOf = new Map<string, string[]>();
  for (const j of assembly.joints) childrenOf.set(j.parentPartId, [...(childrenOf.get(j.parentPartId) ?? []), j.childPartId]);

  for (const part of assembly.parts) {
    const joint = jointOfChild.get(part.id) ?? null;
    const caps: MotionCapability[] = joint ? [{
      jointId: joint.id, kind: joint.type,
      min: joint.limits?.min.value ?? null, max: joint.limits?.max.value ?? null,
      unit: joint.type === 'prismatic' ? 'm' : joint.type === 'revolute' ? 'rad' : 'none',
      status: joint.type === 'fixed' ? 'unavailable' : 'supported',
    }] : [];
    entities.push({
      id: part.id, label: part.label, role: part.role,
      parentId: parentOf.get(part.id) ?? null, childIds: childrenOf.get(part.id) ?? [],
      jointId: joint?.id ?? null,
      actuatorId: assembly.actuators.find(a => a.kind === 'hydraulic_cylinder' && (a.barrelPartId === part.id || a.rodPartId === part.id))?.id
        ?? assembly.actuators.find(a => a.kind === 'rotary_drive' && a.jointId === joint?.id)?.id ?? null,
      capabilities: caps,
      parameters: [param(`${part.id}.mass`, 'Massa', part.massKg)],
      review: { origin: part.provenance.origin, validation: part.provenance.validation, reviewed: part.provenance.validation === 'verified' || part.provenance.validation === 'corrected' },
      evidence: part.provenance.evidence ?? [],
    });
  }
  for (const a of assembly.actuators) {
    const params: LivingParameter[] = a.kind === 'hydraulic_cylinder' ? [
      param(`${a.id}.strokeMin`, 'Curso mínimo', a.stroke.min), param(`${a.id}.strokeMax`, 'Curso máximo', a.stroke.max),
      param(`${a.id}.bore`, 'Diâmetro do êmbolo', a.hydraulics.boreDiameter), param(`${a.id}.rod`, 'Diâmetro da haste', a.hydraulics.rodDiameter),
      param(`${a.id}.pressure`, 'Pressão de alimentação', a.hydraulics.supplyPressure),
    ] : [param(`${a.id}.maxRate`, 'Velocidade máxima', a.maxRate)];
    entities.push({
      id: a.id, label: a.label, role: 'actuator', parentId: null, childIds: [],
      jointId: a.kind === 'hydraulic_cylinder' ? a.drives.jointId : a.jointId, actuatorId: a.id,
      capabilities: [{ jointId: a.kind === 'hydraulic_cylinder' ? a.slideJointId : a.jointId, kind: a.kind === 'hydraulic_cylinder' ? 'prismatic' : 'revolute', min: a.kind === 'hydraulic_cylinder' ? a.stroke.min.value : null, max: a.kind === 'hydraulic_cylinder' ? a.stroke.max.value : null, unit: a.kind === 'hydraulic_cylinder' ? 'm' : 'rad', status: 'supported' }],
      parameters: params,
      review: { origin: a.provenance.origin, validation: a.provenance.validation, reviewed: a.provenance.validation === 'verified' || a.provenance.validation === 'corrected' },
      evidence: a.provenance.evidence ?? [],
    });
  }
  const supported: string[] = [], inferred: string[] = [], unavailable: string[] = [];
  for (const e of entities) {
    if (!e.capabilities.length) unavailable.push(`${e.id}:motion-not-declared`);
    for (const c of e.capabilities) (c.status === 'supported' ? supported : c.status === 'inferred' ? inferred : unavailable).push(`${e.id}:${c.jointId}`);
  }
  if (!assembly.actuators.length) unavailable.push('actuation:none-declared');
  return { schema: LIVING_SCENE_SCHEMA, version: 1, assemblyId: assembly.id, title: assembly.title, sourceRevision, entities, supported, inferred, unavailable, evidenceLevel: 'kinematically_valid' };
}

export const entityById = (scene: LivingScene, id: string | null | undefined): LivingEntity | null =>
  id ? scene.entities.find(e => e.id === id) ?? null : null;

/** Entidades ligadas: pai, filhos, junta e actuador que acciona a junta desta entidade. */
export function relatedEntities(scene: LivingScene, assembly: Assembly, id: string): LivingEntity[] {
  const e = entityById(scene, id); if (!e) return [];
  const ids = new Set<string>([e.parentId, ...e.childIds].filter(Boolean) as string[]);
  const joint = assembly.joints.find(j => j.id === e.jointId);
  if (joint) { ids.add(joint.parentPartId); ids.add(joint.childPartId); }
  for (const a of assembly.actuators) {
    const drives = a.kind === 'hydraulic_cylinder' ? a.drives.jointId : a.jointId;
    if (drives === e.jointId || a.id === e.actuatorId) { ids.add(a.id); if (a.kind === 'hydraulic_cylinder') { ids.add(a.barrelPartId); ids.add(a.rodPartId); } }
  }
  return [...ids].map(x => entityById(scene, x)).filter((x): x is LivingEntity => !!x && x.id !== id);
}
