import { sha256Hex } from '../../core/canonical';
import type { Provenance as CanonicalProvenance } from '../../core/provenance';
import type { Assembly, Part as CanonicalPart, Joint as CanonicalJoint, Pose, Quantity, Vec3, Quat } from '../contracts/assembly.v1';
import { validateAssembly } from '../contracts/assembly.v1';
import type { AssemblyDimension, AssemblyPart, AssemblyProposalV1, AssemblyJoint, AssemblyValueSource } from './contracts';
import { validateAssemblyProposal } from './contracts';
import { RECONSTRUCTION_SOURCE_FRAME } from './library';

export type ProposalReviewAuthorization = {
  reviewerId: string;
  authorizationId: string;
  reviewedAt?: string;
};

export class ReconstructionAdapterBlockedError extends Error {
  readonly code = 'RECONSTRUCTION_ADAPTER_BLOCKED';
  constructor(readonly reasons: string[]) {
    super(`A proposta não pode entrar no contrato de engenharia: ${reasons.join('; ')}`);
    this.name = 'ReconstructionAdapterBlockedError';
  }
}

type SourcePose = { translation: Vec3; rotation: Quat };

/**
 * A proposta stores template poses in +X forward, +Y operator-left, +Z up.
 * The engineering contract is +X forward, +Y up, +Z operator-right. This
 * basis change is explicit and is applied to translations, axes and rotations.
 */
export const RECONSTRUCTION_FRAME_CONVERSION = {
  source: RECONSTRUCTION_SOURCE_FRAME,
  target: 'engineering.canonical.x-forward-y-up-z-right',
  units: { sourceLength: 'm', sourceAngle: 'deg', targetLength: 'm', targetAngle: 'rad' },
} as const;

const HALF_SQRT = Math.SQRT1_2;
const FRAME_ROTATION: Quat = [-HALF_SQRT, 0, 0, HALF_SQRT]; // source -> canonical: rotation -90° around X.

function qMultiply(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function qConjugate(q: Quat): Quat { return [-q[0], -q[1], -q[2], q[3]]; }

function qNormalize(q: Quat): Quat {
  const norm = Math.hypot(...q);
  if (!Number.isFinite(norm) || norm < 1e-12) throw new ReconstructionAdapterBlockedError(['rotação inválida: quaternião sem norma finita']);
  return [q[0] / norm, q[1] / norm, q[2] / norm, q[3] / norm];
}

function qRotate(q: Quat, vector: Vec3): Vec3 {
  const rotated = qMultiply(qMultiply(q, [vector[0], vector[1], vector[2], 0]), qConjugate(q));
  return [rotated[0], rotated[1], rotated[2]];
}

export function sourceVectorToCanonical(vector: Vec3): Vec3 { return [vector[0], vector[2], -vector[1]]; }

export function sourceEulerDegreesToCanonicalQuaternion(rotationEulerDeg: Vec3): Quat {
  const [x, y, z] = rotationEulerDeg.map((value) => value * Math.PI / 180) as Vec3;
  const qx: Quat = [Math.sin(x / 2), 0, 0, Math.cos(x / 2)];
  const qy: Quat = [0, Math.sin(y / 2), 0, Math.cos(y / 2)];
  const qz: Quat = [0, 0, Math.sin(z / 2), Math.cos(z / 2)];
  const sourceRotation = qMultiply(qMultiply(qz, qy), qx);
  const canonical = qMultiply(qMultiply(FRAME_ROTATION, sourceRotation), qConjugate(FRAME_ROTATION));
  const norm = Math.hypot(...canonical);
  return [canonical[0] / norm, canonical[1] / norm, canonical[2] / norm, canonical[3] / norm];
}

function sourcePartPose(part: AssemblyPart): SourcePose {
  return { translation: sourceVectorToCanonical(part.transform.translation), rotation: sourceEulerDegreesToCanonicalQuaternion(part.transform.rotationEulerDeg) };
}

function inversePose(pose: SourcePose): SourcePose {
  const rotation = qConjugate(pose.rotation);
  const translation = qRotate(rotation, [-pose.translation[0], -pose.translation[1], -pose.translation[2]]);
  return { translation, rotation };
}

function composePose(parent: SourcePose, child: SourcePose): SourcePose {
  return {
    translation: [
      parent.translation[0] + qRotate(parent.rotation, child.translation)[0],
      parent.translation[1] + qRotate(parent.rotation, child.translation)[1],
      parent.translation[2] + qRotate(parent.rotation, child.translation)[2],
    ],
    rotation: qNormalize(qMultiply(parent.rotation, child.rotation)),
  };
}

function motionPose(joint: CanonicalJoint, value: number): SourcePose {
  const axis = joint.axis;
  if (joint.type === 'revolute') {
    const half = value / 2;
    return { translation: [0, 0, 0], rotation: qNormalize([axis[0] * Math.sin(half), axis[1] * Math.sin(half), axis[2] * Math.sin(half), Math.cos(half)]) };
  }
  if (joint.type === 'prismatic') return { translation: [axis[0] * value, axis[1] * value, axis[2] * value], rotation: [0, 0, 0, 1] };
  return { translation: [0, 0, 0], rotation: [0, 0, 0, 1] };
}

function relativePose(parent: SourcePose, child: SourcePose): Pose {
  const inverse = inversePose(parent);
  const rotation = qMultiply(inverse.rotation, child.rotation);
  const delta: Vec3 = [child.translation[0] - parent.translation[0], child.translation[1] - parent.translation[1], child.translation[2] - parent.translation[2]];
  const translation = qRotate(inverse.rotation, delta);
  const provenance = conversionProvenance();
  return { translationM: translation, rotation, provenance: { translationM: provenance, rotation: provenance } };
}

function poseWithoutReferenceMotion(relativeAtReference: Pose, joint: CanonicalJoint): Pose {
  if (joint.type === 'fixed' || joint.referenceValue === null) return relativeAtReference;
  const inverseMotion = inversePose(motionPose(joint, joint.referenceValue.value));
  const origin = composePose({ translation: relativeAtReference.translationM, rotation: relativeAtReference.rotation }, inverseMotion);
  return {
    translationM: origin.translation,
    rotation: origin.rotation,
    provenance: relativeAtReference.provenance,
  };
}

export type ForwardKinematicsPose = { translationM: Vec3; rotation: Quat };

/** Resolve the canonical tree at each joint's declared referenceValue. */
export function forwardKinematicsAtReference(assembly: Assembly): Map<string, ForwardKinematicsPose> {
  const poses = new Map<string, ForwardKinematicsPose>([[assembly.root.partId, { translationM: assembly.root.pose.translationM, rotation: assembly.root.pose.rotation }]]);
  const pending = [...assembly.joints];
  while (pending.length) {
    const index = pending.findIndex((joint) => poses.has(joint.parentPartId));
    if (index < 0) throw new Error('ASSEMBLY_FK_UNRESOLVED_TREE');
    const [joint] = pending.splice(index, 1);
    const parentValue = poses.get(joint.parentPartId)!;
    const parent: SourcePose = { translation: parentValue.translationM, rotation: parentValue.rotation };
    const origin: SourcePose = { translation: joint.origin.translationM, rotation: joint.origin.rotation };
    const value = joint.referenceValue?.value ?? 0;
    const child = composePose(composePose(parent, origin), motionPose(joint, value));
    poses.set(joint.childPartId, { translationM: child.translation, rotation: child.rotation });
  }
  return poses;
}

function conversionProvenance(evidence: string[] = []): CanonicalProvenance {
  return {
    origin: 'derived',
    validation: 'unreviewed',
    recordedAt: new Date().toISOString(),
    actor: { kind: 'system', id: 'living-reconstruction-adapter' },
    ...(evidence.length ? { evidence: evidence.map((sourceId) => ({ sourceId })) } : {}),
  };
}

function sourceKind(kind: AssemblyProposalV1['source']['kind']): 'drawing' | 'user_input' | 'other' {
  return kind === 'technical_drawing' ? 'drawing' : kind === 'text' ? 'user_input' : 'other';
}

function proposalPartsForCanonical(part: CanonicalPart, proposalParts: AssemblyPart[]): AssemblyPart[] {
  return proposalParts.filter((candidate) => {
    if (part.role === 'chassis') return candidate.role === 'chassis';
    if (part.role === 'upper_body') return candidate.role === 'house';
    if (part.role === 'boom' || part.role === 'stick' || part.role === 'bucket') return candidate.role === part.role;
    if (part.role === 'cylinder_barrel' || part.role === 'cylinder_rod') {
      const suffix = part.role === 'cylinder_barrel' ? '.body' : '.rod';
      return candidate.role === 'cylinder' && candidate.libraryKey.endsWith(suffix) && candidate.libraryKey.includes(part.id.split('_')[0] ?? '');
    }
    return false;
  });
}

function proposalJointForCanonical(joint: CanonicalJoint, proposal: AssemblyProposalV1, mapping: Map<string, AssemblyPart>): AssemblyJoint | undefined {
  const parent = mapping.get(joint.parentPartId);
  const child = mapping.get(joint.childPartId);
  if (!parent || !child) return undefined;
  return proposal.joints.find((candidate) => candidate.parentPartId === parent.id && candidate.childPartId === child.id);
}

function quantityWithProvenance(quantity: Quantity, evidence: string[]): Quantity {
  return { ...quantity, provenance: conversionProvenance(evidence) };
}

function adaptPartProvenance(part: CanonicalPart, proposalPart: AssemblyPart | undefined): CanonicalPart['provenance'] {
  if (!proposalPart) return part.provenance;
  return conversionProvenance(proposalPart.evidenceIds);
}

function cloneAssembly(value: Assembly): Assembly { return structuredClone(value); }

type ApprovedDimension = { value: number; evidenceIds: string[] };

function observedDimension(dimension: AssemblyDimension | undefined, label: string, reasons: string[]): ApprovedDimension | undefined {
  if (!dimension || dimension.source !== 'observed') return undefined;
  if (dimension.value === null || !Number.isFinite(dimension.value) || dimension.value <= 0) {
    reasons.push(`dimensão observada inválida: ${label}`);
    return undefined;
  }
  if (dimension.unit !== 'm' && dimension.unit !== 'mm') {
    reasons.push(`dimensão observada sem unidade de engenharia suportada: ${label} (${dimension.unit})`);
    return undefined;
  }
  return { value: dimension.unit === 'mm' ? dimension.value / 1000 : dimension.value, evidenceIds: dimension.evidenceIds };
}

function approvedDimension(part: AssemblyPart | undefined, name: string, reasons: string[]): ApprovedDimension | undefined {
  return observedDimension(part?.dimensions[name], `${part?.id ?? 'parte'}.${name}`, reasons);
}

function reconcileObservedDimensions(dimensions: Array<{ label: string; value: ApprovedDimension | undefined }>, actuatorId: string, reasons: string[]): ApprovedDimension | undefined {
  const observed = dimensions.filter((entry): entry is { label: string; value: ApprovedDimension } => entry.value !== undefined);
  if (!observed.length) return undefined;
  const reference = observed[0]!.value.value;
  if (observed.some((entry) => Math.abs(entry.value.value - reference) > 1e-9)) {
    reasons.push(`cursos observados conflitantes para ${actuatorId}: ${observed.map((entry) => entry.label).join(', ')}`);
    return undefined;
  }
  return { value: reference, evidenceIds: [...new Set(observed.flatMap((entry) => entry.value.evidenceIds))] };
}

function scaleLocalPartX(part: CanonicalPart, ratio: number, evidenceIds: string[]): CanonicalPart {
  const provenance = conversionProvenance(evidenceIds);
  return {
    ...part,
    points: part.points.map((point) => ({ ...point, positionM: [point.positionM[0] * ratio, point.positionM[1], point.positionM[2]] as Vec3, provenance })),
    shapes: part.shapes.map((shape) => {
      const translationM: Vec3 = [shape.pose.translationM[0] * ratio, shape.pose.translationM[1], shape.pose.translationM[2]];
      const pose = { ...shape.pose, translationM, provenance: { translationM: provenance, rotation: shape.pose.provenance.rotation } };
      return shape.kind === 'box'
        ? { ...shape, halfExtentsM: [shape.halfExtentsM[0] * ratio, shape.halfExtentsM[1], shape.halfExtentsM[2]] as Vec3, pose, provenance }
        : { ...shape, pose, provenance };
    }),
    provenance,
  };
}

function scaleChildJointOrigins(joint: CanonicalJoint, scaledParentId: string, ratio: number, evidenceIds: string[]): CanonicalJoint {
  if (joint.parentPartId !== scaledParentId) return joint;
  const provenance = conversionProvenance(evidenceIds);
  return { ...joint, origin: { ...joint.origin, translationM: [joint.origin.translationM[0] * ratio, joint.origin.translationM[1], joint.origin.translationM[2]] as Vec3, provenance: { translationM: provenance, rotation: joint.origin.provenance.rotation } }, provenance };
}

function applyCylinderStroke(assembly: Assembly, actuator: Extract<Assembly['actuators'][number], { kind: 'hydraulic_cylinder' }>, approved: ApprovedDimension, reasons: string[]): void {
  if (approved.value <= actuator.stroke.min.value) {
    reasons.push(`curso observado inválido para ${actuator.id}: tem de ser maior que o mínimo`);
    return;
  }
  if (actuator.referenceStroke.value > approved.value) {
    reasons.push(`curso observado inferior ao curso de referência de ${actuator.id}`);
    return;
  }
  const slide = assembly.joints.find((joint) => joint.id === actuator.slideJointId);
  if (!slide || slide.type !== 'prismatic' || !slide.limits) {
    reasons.push(`curso de ${actuator.id} sem junta prismática/limites canónicos`);
    return;
  }
  const previousMax = actuator.stroke.max.value;
  if (!(previousMax > 0)) {
    reasons.push(`curso de seed inválido para ${actuator.id}`);
    return;
  }
  const ratio = approved.value / previousMax;
  const provenance = conversionProvenance(approved.evidenceIds);
  actuator.stroke = { ...actuator.stroke, max: { value: approved.value, unit: 'm', provenance } };
  actuator.provenance = provenance;
  slide.limits = { ...slide.limits, max: { value: approved.value, unit: 'm', provenance } };
  slide.provenance = provenance;
  const rod = assembly.parts.find((part) => part.id === actuator.rodPartId);
  if (!rod) {
    reasons.push(`haste de ${actuator.id} ausente no seed`);
    return;
  }
  const scaledRod = {
    ...rod,
    shapes: rod.shapes.map((shape) => shape.kind === 'cylinder'
      ? { ...shape, halfLengthM: shape.halfLengthM * ratio, pose: { ...shape.pose, translationM: [shape.pose.translationM[0] * ratio, shape.pose.translationM[1], shape.pose.translationM[2]] as Vec3, provenance: { translationM: provenance, rotation: shape.pose.provenance.rotation } }, provenance }
      : shape),
    provenance,
  };
  const index = assembly.parts.findIndex((part) => part.id === rod.id);
  assembly.parts[index] = scaledRod;
  for (const constraint of assembly.constraints) {
    if (constraint.a.partId === actuator.rodPartId || constraint.b.partId === actuator.rodPartId) constraint.provenance = provenance;
  }
}

function validateMappedConstraintClosure(assembly: Assembly, mappedPartIds: ReadonlySet<string>, toleranceM = 1e-6): string[] {
  const fk = forwardKinematicsAtReference(assembly);
  const pointWorld = (partId: string, pointId: string): Vec3 | null => {
    const pose = fk.get(partId);
    const part = assembly.parts.find((candidate) => candidate.id === partId);
    const point = part?.points.find((candidate) => candidate.id === pointId);
    if (!pose || !point) return null;
    const rotated = qRotate(pose.rotation, point.positionM);
    return [pose.translationM[0] + rotated[0], pose.translationM[1] + rotated[1], pose.translationM[2] + rotated[2]];
  };
  const reasons: string[] = [];
  for (const constraint of assembly.constraints) {
    if (!mappedPartIds.has(constraint.a.partId) || !mappedPartIds.has(constraint.b.partId)) continue;
    const a = pointWorld(constraint.a.partId, constraint.a.pointId);
    const b = pointWorld(constraint.b.partId, constraint.b.pointId);
    if (!a || !b) {
      reasons.push(`constraint ${constraint.id} referencia ponto ausente`);
      continue;
    }
    const distance = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    if (distance > toleranceM) reasons.push(`constraint ${constraint.id} inconsistente na configuração de referência (${distance.toFixed(6)} m)`);
  }
  return reasons;
}

/**
 * Converts an explicitly reviewed reconstruction proposal using an engineering
 * assembly seed. The seed supplies mandatory shapes, points, limits and loop
 * constraints; missing engineering data is rejected instead of invented.
 */
export function adaptReviewedProposalToAssembly(proposalInput: AssemblyProposalV1, engineeringSeedInput: unknown, review: ProposalReviewAuthorization): Assembly {
  const proposal = validateAssemblyProposal(proposalInput);
  const seedValidation = validateAssembly(engineeringSeedInput);
  const reasons: string[] = [];
  if (!seedValidation.ok) reasons.push(`engineeringSeed inválido (${seedValidation.issues.map((issue) => issue.code).join(', ')})`);
  if (!review || !review.reviewerId.trim() || !review.authorizationId.trim()) reasons.push('revisão humana e authorizationId são obrigatórios');
  if (proposal.validation.status === 'blocked') reasons.push('a proposta está bloqueada');
  if (proposal.modifications.some((modification) => modification.review === 'pending')) reasons.push('há modificações pendentes');
  for (const modification of proposal.modifications) if (modification.review === 'verified') reasons.push(`modificação verificada sem adaptação suportada: ${modification.id}`);
  for (const part of proposal.parts) {
    if (part.review === 'rejected') reasons.push(`parte rejeitada: ${part.id}`);
    if (part.transform.scale.some((value) => Math.abs(value - 1) > 1e-12)) reasons.push(`escala não suportada na conversão canónica: ${part.id}`);
  }
  for (const joint of proposal.joints) {
    if (joint.review === 'rejected') reasons.push(`junta rejeitada: ${joint.id}`);
    if (joint.anchor.some((value) => Math.abs(value) > 1e-12)) reasons.push(`anchor não suportado na conversão canónica: ${joint.id}`);
  }
  for (const actuator of proposal.actuators) if (actuator.review === 'rejected') reasons.push(`actuador rejeitado: ${actuator.id}`);
  if (reasons.length) throw new ReconstructionAdapterBlockedError(reasons);
  const seed = cloneAssembly(engineeringSeedInput as Assembly);
  const mapping = new Map<string, AssemblyPart>();
  const consumedProposalPartIds = new Set<string>();
  for (const canonicalPart of seed.parts) {
    const candidates = proposalPartsForCanonical(canonicalPart, proposal.parts);
    if (candidates.length > 1) reasons.push(`parte canónica com correspondência ambígua: ${canonicalPart.id}`);
    const proposalPart = candidates.length === 1 ? candidates[0] : undefined;
    if (!proposalPart && canonicalPart.role !== 'link' && canonicalPart.role !== 'other') reasons.push(`parte obrigatória sem correspondência: ${canonicalPart.id}`);
    if (proposalPart) {
      mapping.set(canonicalPart.id, proposalPart);
      consumedProposalPartIds.add(proposalPart.id);
    }
  }
  for (const proposalPart of proposal.parts) {
    if (consumedProposalPartIds.has(proposalPart.id)) continue;
    if (proposalPart.review === 'verified') reasons.push(`parte verificada sem correspondência canónica: ${proposalPart.id}`);
    for (const [name, dimension] of Object.entries(proposalPart.dimensions)) {
      if (dimension.source === 'observed') reasons.push(`dimensão observada em parte sem correspondência canónica: ${proposalPart.id}.${name}`);
    }
    if (proposalPart.role !== 'track') reasons.push(`parte proposta sem correspondência canónica: ${proposalPart.id}`);
  }
  if (reasons.length) throw new ReconstructionAdapterBlockedError(reasons);

  const canonicalByProposalPartId = new Map([...mapping].map(([canonicalId, proposalPart]) => [proposalPart.id, canonicalId]));
  for (const [canonicalId, proposalPart] of mapping) {
    const incomingJoint = seed.joints.find((joint) => joint.childPartId === canonicalId);
    const expectedParentId = incomingJoint?.parentPartId ?? null;
    const actualParentId = proposalPart.parentId === null ? null : canonicalByProposalPartId.get(proposalPart.parentId);
    if (actualParentId !== expectedParentId) reasons.push(`hierarquia de parte incompatível: ${proposalPart.id}`);
  }

  const proposalJointMapping = new Map<string, CanonicalJoint>();
  for (const proposalJoint of proposal.joints) {
    const canonicalParent = canonicalByProposalPartId.get(proposalJoint.parentPartId);
    const canonicalChild = canonicalByProposalPartId.get(proposalJoint.childPartId);
    const canonicalJoint = canonicalParent && canonicalChild
      ? seed.joints.find((joint) => joint.parentPartId === canonicalParent && joint.childPartId === canonicalChild)
      : undefined;
    if (!canonicalJoint) reasons.push(`junta sem correspondência canónica: ${proposalJoint.id}`);
    else {
      proposalJointMapping.set(proposalJoint.id, canonicalJoint);
      if (canonicalJoint.type !== proposalJoint.type) reasons.push(`tipo de junta incompatível: ${proposalJoint.id} (${proposalJoint.type} != ${canonicalJoint.type})`);
    }
  }

  const proposalActuatorMapping = new Map<string, AssemblyProposalV1['actuators'][number]>();
  const consumedProposalActuatorIds = new Set<string>();
  for (const canonicalActuator of seed.actuators) {
    if (canonicalActuator.kind !== 'hydraulic_cylinder') continue;
    const proposalBarrel = mapping.get(canonicalActuator.barrelPartId);
    const proposalRod = mapping.get(canonicalActuator.rodPartId);
    const candidates = proposal.actuators.filter((actuator) => actuator.bodyPartId === proposalBarrel?.id && actuator.rodPartId === proposalRod?.id);
    if (candidates.length !== 1) {
      reasons.push(candidates.length === 0 ? `actuador canónico sem correspondência: ${canonicalActuator.id}` : `actuador canónico com correspondência ambígua: ${canonicalActuator.id}`);
      continue;
    }
    const candidate = candidates[0]!;
    if (candidate.kind !== 'hydraulic_cylinder') reasons.push(`tipo de actuador incompatível: ${candidate.id}`);
    const mappedJointIds = candidate.jointIds.map((jointId) => proposalJointMapping.get(jointId)?.id);
    const expectedJointIds = [canonicalActuator.drives.jointId, canonicalActuator.slideJointId];
    if (mappedJointIds.some((jointId) => jointId === undefined) || mappedJointIds.length !== expectedJointIds.length || expectedJointIds.some((jointId) => !mappedJointIds.includes(jointId))) {
      reasons.push(`juntas de actuador incompatíveis: ${candidate.id}`);
    }
    proposalActuatorMapping.set(canonicalActuator.id, candidate);
    consumedProposalActuatorIds.add(candidate.id);
  }
  for (const proposalActuator of proposal.actuators) if (!consumedProposalActuatorIds.has(proposalActuator.id)) reasons.push(`actuador sem correspondência canónica: ${proposalActuator.id}`);
  if (reasons.length) throw new ReconstructionAdapterBlockedError(reasons);

  const globalPoses = new Map<string, SourcePose>();
  for (const [canonicalId, proposalPart] of mapping) globalPoses.set(canonicalId, sourcePartPose(proposalPart));
  const dimensionActions = new Map<string, { name: 'length' | 'stroke'; dimension: ApprovedDimension }>();
  for (const canonicalPart of seed.parts) {
    const proposalPart = mapping.get(canonicalPart.id);
    if (!proposalPart) continue;
    for (const [name, value] of Object.entries(proposalPart.dimensions)) {
      if (value.source !== 'observed') continue;
      const supported = (canonicalPart.role === 'boom' || canonicalPart.role === 'stick') && name === 'length'
        || (canonicalPart.role === 'cylinder_barrel' || canonicalPart.role === 'cylinder_rod') && name === 'stroke';
      if (!supported) {
        reasons.push(`dimensão observada sem adaptação geométrica suportada: ${proposalPart.id}.${name}`);
        continue;
      }
      const approved = approvedDimension(proposalPart, name, reasons);
      if (approved) dimensionActions.set(canonicalPart.id, { name: name as 'length' | 'stroke', dimension: approved });
    }
  }
  if (reasons.length) throw new ReconstructionAdapterBlockedError(reasons);
  const lengthRatios = new Map<string, number>();
  const sourceId = `reconstruction-${sha256Hex(proposal.source.reference).slice(0, 16)}`;
  seed.sources = [...seed.sources, { id: sourceId, kind: sourceKind(proposal.source.kind), title: `Proposta ${proposal.proposalId}`, sha256: undefined }];
  seed.id = `assembly-${proposal.proposalId}`;
  seed.title = `Escavadora — proposta ${proposal.proposalId}`;
  seed.provenance = conversionProvenance([sourceId]);

  const rootPose = globalPoses.get(seed.root.partId);
  if (!rootPose) throw new ReconstructionAdapterBlockedError([`pose raiz ausente: ${seed.root.partId}`]);
  seed.root.pose = { translationM: rootPose.translation, rotation: rootPose.rotation, provenance: { translationM: conversionProvenance(), rotation: conversionProvenance() } };
  seed.parts = seed.parts.map((part) => {
    const adapted = { ...part, provenance: adaptPartProvenance(part, mapping.get(part.id)) };
    const action = dimensionActions.get(part.id);
    if (!action || action.name !== 'length') return adapted;
    const shape = adapted.shapes.find((candidate) => candidate.kind === 'box');
    if (!shape || shape.kind !== 'box' || shape.halfExtentsM[0] <= 0) {
      reasons.push(`geometria longitudinal não suportada para ${part.id}`);
      return adapted;
    }
    const ratio = action.dimension.value / (shape.halfExtentsM[0] * 2);
    lengthRatios.set(part.id, ratio);
    return scaleLocalPartX(adapted, ratio, action.dimension.evidenceIds);
  });
  if (reasons.length) throw new ReconstructionAdapterBlockedError(reasons);
  seed.joints = seed.joints.map((joint) => {
    const parent = globalPoses.get(joint.parentPartId);
    const child = globalPoses.get(joint.childPartId);
    const proposalJoint = proposalJointForCanonical(joint, proposal, mapping);
    if (!parent || !child) return joint;
    if (joint.type !== 'fixed' && joint.referenceValue === null) {
      reasons.push(`junta ${joint.id} não tem referenceValue para reconciliar a pose proposta`);
      return joint;
    }
    const adapted = relativePose(parent, child);
    const axis = proposalJoint ? sourceVectorToCanonical(proposalJoint.axis) : joint.axis;
    const axisNorm = Math.hypot(...axis);
    if (!(axisNorm > 0)) {
      reasons.push(`eixo inválido na junta ${proposalJoint?.id ?? joint.id}`);
      return joint;
    }
    const normalizedAxis: Vec3 = [axis[0] / axisNorm, axis[1] / axisNorm, axis[2] / axisNorm];
    const canonicalJoint = { ...joint, axis: normalizedAxis };
    const evidenceIds = proposalJoint?.evidenceIds ?? [...(mapping.get(joint.parentPartId)?.evidenceIds ?? []), ...(mapping.get(joint.childPartId)?.evidenceIds ?? [])];
    return { ...canonicalJoint, origin: poseWithoutReferenceMotion(adapted, canonicalJoint), provenance: conversionProvenance(evidenceIds) };
  });
  for (const [partId, action] of dimensionActions) {
    if (action.name !== 'length') continue;
    const ratio = lengthRatios.get(partId) ?? 1;
    seed.joints = seed.joints.map((joint) => scaleChildJointOrigins(joint, partId, ratio, action.dimension.evidenceIds));
    const provenance = conversionProvenance(action.dimension.evidenceIds);
    for (const constraint of seed.constraints) {
      if (constraint.a.partId === partId || constraint.b.partId === partId) constraint.provenance = provenance;
    }
  }
  const actuatorStrokeActions = new Map<string, ApprovedDimension>();
  for (const actuator of seed.actuators) {
    if (actuator.kind !== 'hydraulic_cylinder') continue;
    const proposalActuator = proposalActuatorMapping.get(actuator.id);
    const actuatorStroke = observedDimension(proposalActuator?.stroke, `${proposalActuator?.id ?? actuator.id}.stroke`, reasons);
    const barrel = dimensionActions.get(actuator.barrelPartId)?.dimension;
    const rod = dimensionActions.get(actuator.rodPartId)?.dimension;
    const chosen = reconcileObservedDimensions([
      { label: proposalActuator?.id ?? actuator.id, value: actuatorStroke },
      { label: mapping.get(actuator.barrelPartId)?.id ?? actuator.barrelPartId, value: barrel },
      { label: mapping.get(actuator.rodPartId)?.id ?? actuator.rodPartId, value: rod },
    ], actuator.id, reasons);
    if (chosen) actuatorStrokeActions.set(actuator.id, chosen);
  }
  if (reasons.length) throw new ReconstructionAdapterBlockedError(reasons);
  seed.actuators = seed.actuators.map((actuator) => {
    const proposalPart = actuator.kind === 'hydraulic_cylinder' ? mapping.get(actuator.barrelPartId) : undefined;
    const proposalActuator = actuator.kind === 'hydraulic_cylinder' ? proposalActuatorMapping.get(actuator.id) : undefined;
    const proposalEvidence = [...new Set([...(proposalActuator?.evidenceIds ?? []), ...(proposalPart?.evidenceIds ?? [])])];
    return {
      ...actuator,
      provenance: conversionProvenance(proposalEvidence),
      ...(actuator.kind === 'hydraulic_cylinder' ? {
        stroke: { min: quantityWithProvenance(actuator.stroke.min, proposalEvidence), max: quantityWithProvenance(actuator.stroke.max, proposalEvidence) },
        referenceStroke: quantityWithProvenance(actuator.referenceStroke, proposalEvidence),
      } : {}),
    };
  });
  for (const actuator of seed.actuators) {
    if (actuator.kind !== 'hydraulic_cylinder') continue;
    const stroke = actuatorStrokeActions.get(actuator.id);
    if (stroke) applyCylinderStroke(seed, actuator, stroke, reasons);
  }
  reasons.push(...validateMappedConstraintClosure(seed, new Set(seed.parts.map((part) => part.id))));
  if (reasons.length) throw new ReconstructionAdapterBlockedError(reasons);
  const result = validateAssembly(seed);
  if (!result.ok) throw new ReconstructionAdapterBlockedError(result.issues.map((issue) => `${issue.path}: ${issue.code}`));
  return seed;
}

export function adapterBlockReason(): string {
  return 'A reconstrução só pode entrar no contrato unfold.assembly.v1 com um seed de engenharia validado e revisão humana explícita; sem isso permanece unfold.assembly_proposal.v1.';
}

export type { AssemblyValueSource };
