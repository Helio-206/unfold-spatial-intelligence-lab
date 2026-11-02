import { sha256Hex } from '../../core/canonical';
import type { Provenance as CanonicalProvenance } from '../../core/provenance';
import type { Assembly, Part as CanonicalPart, Joint as CanonicalJoint, Pose, Quantity, Vec3, Quat } from '../contracts/assembly.v1';
import { validateAssembly } from '../contracts/assembly.v1';
import type { AssemblyPart, AssemblyProposalV1, AssemblyJoint, AssemblyValueSource } from './contracts';
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

function relativePose(parent: SourcePose, child: SourcePose): Pose {
  const inverse = inversePose(parent);
  const rotation = qMultiply(inverse.rotation, child.rotation);
  const delta: Vec3 = [child.translation[0] - parent.translation[0], child.translation[1] - parent.translation[1], child.translation[2] - parent.translation[2]];
  const translation = qRotate(inverse.rotation, delta);
  const provenance = conversionProvenance();
  return { translationM: translation, rotation, provenance: { translationM: provenance, rotation: provenance } };
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

function proposalPartForCanonical(part: CanonicalPart, proposalParts: AssemblyPart[]): AssemblyPart | undefined {
  const candidates = proposalParts.filter((candidate) => {
    if (part.role === 'chassis') return candidate.role === 'chassis';
    if (part.role === 'upper_body') return candidate.role === 'house';
    if (part.role === 'boom' || part.role === 'stick' || part.role === 'bucket') return candidate.role === part.role;
    if (part.role === 'cylinder_barrel' || part.role === 'cylinder_rod') {
      const suffix = part.role === 'cylinder_barrel' ? '.body' : '.rod';
      return candidate.role === 'cylinder' && candidate.libraryKey.endsWith(suffix) && candidate.libraryKey.includes(part.id.split('_')[0] ?? '');
    }
    return false;
  });
  return candidates[0];
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
  if (reasons.length) throw new ReconstructionAdapterBlockedError(reasons);
  const seed = cloneAssembly(engineeringSeedInput as Assembly);
  const mapping = new Map<string, AssemblyPart>();
  for (const canonicalPart of seed.parts) {
    const proposalPart = proposalPartForCanonical(canonicalPart, proposal.parts);
    if (!proposalPart && canonicalPart.role !== 'link' && canonicalPart.role !== 'other') reasons.push(`parte obrigatória sem correspondência: ${canonicalPart.id}`);
    if (proposalPart) mapping.set(canonicalPart.id, proposalPart);
  }
  if (reasons.length) throw new ReconstructionAdapterBlockedError(reasons);

  const globalPoses = new Map<string, SourcePose>();
  for (const [canonicalId, proposalPart] of mapping) globalPoses.set(canonicalId, sourcePartPose(proposalPart));
  const sourceId = `reconstruction-${sha256Hex(proposal.source.reference).slice(0, 16)}`;
  seed.sources = [...seed.sources, { id: sourceId, kind: sourceKind(proposal.source.kind), title: `Proposta ${proposal.proposalId}`, sha256: undefined }];
  seed.id = `assembly-${proposal.proposalId}`;
  seed.title = `Escavadora — proposta ${proposal.proposalId}`;
  seed.provenance = conversionProvenance([sourceId]);

  const rootPose = globalPoses.get(seed.root.partId);
  if (!rootPose) throw new ReconstructionAdapterBlockedError([`pose raiz ausente: ${seed.root.partId}`]);
  seed.root.pose = { translationM: rootPose.translation, rotation: rootPose.rotation, provenance: { translationM: conversionProvenance(), rotation: conversionProvenance() } };
  seed.parts = seed.parts.map((part) => ({ ...part, provenance: adaptPartProvenance(part, mapping.get(part.id)) }));
  seed.joints = seed.joints.map((joint) => {
    const parent = globalPoses.get(joint.parentPartId);
    const child = globalPoses.get(joint.childPartId);
    const proposalJoint = proposalJointForCanonical(joint, proposal, mapping);
    if (!parent || !child || !proposalJoint) return joint;
    const adapted = relativePose(parent, child);
    const axis = sourceVectorToCanonical(proposalJoint.axis);
    const axisNorm = Math.hypot(...axis);
    return { ...joint, origin: adapted, axis: [axis[0] / axisNorm, axis[1] / axisNorm, axis[2] / axisNorm], provenance: conversionProvenance(proposalJoint.evidenceIds) };
  });
  seed.actuators = seed.actuators.map((actuator) => {
    const proposalPart = actuator.kind === 'hydraulic_cylinder' ? mapping.get(actuator.barrelPartId) : undefined;
    const proposalEvidence = proposalPart?.evidenceIds ?? [];
    return {
      ...actuator,
      provenance: conversionProvenance(proposalEvidence),
      ...(actuator.kind === 'hydraulic_cylinder' ? {
        stroke: { min: quantityWithProvenance(actuator.stroke.min, proposalEvidence), max: quantityWithProvenance(actuator.stroke.max, proposalEvidence) },
        referenceStroke: quantityWithProvenance(actuator.referenceStroke, proposalEvidence),
      } : {}),
    };
  });
  const result = validateAssembly(seed);
  if (!result.ok) throw new ReconstructionAdapterBlockedError(result.issues.map((issue) => `${issue.path}: ${issue.code}`));
  return seed;
}

export function adapterBlockReason(): string {
  return 'A reconstrução só pode entrar no contrato unfold.assembly.v1 com um seed de engenharia validado e revisão humana explícita; sem isso permanece unfold.assembly_proposal.v1.';
}

export type { AssemblyValueSource };
