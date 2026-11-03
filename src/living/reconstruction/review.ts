import { forwardKinematicsAtReference, adaptReviewedProposalToAssembly, ReconstructionAdapterBlockedError } from './adapter';
import { buildExcavatorAssembly, type ReconstructionExecutionMode } from './generator';
import { validateExcavatorObservation, type ExcavatorObservationV1 } from './contracts';
import { EXCAVATOR_ASSEMBLY_V1 } from '../contracts/fixtures/excavator.assembly.v1';
import { validateAssembly, type Quat } from '../contracts/assembly.v1';

export type ReconstructionReview = {
  reviewerId: string;
  family: 'tracked_excavator';
  bucketConfirmed: true;
  decisions: Record<string, 'confirm' | 'reject'>;
  bucketWidthM: number;
  widthBasis: string;
};

const partIds: Record<string, string> = { chassis: 'part-chassis', upper_body: 'part-house', boom: 'part-boom', stick: 'part-stick', bucket: 'part-bucket', boom_cyl_barrel: 'part-boom-cylinder-body', boom_cyl_rod: 'part-boom-cylinder-rod', stick_cyl_barrel: 'part-stick-cylinder-body', stick_cyl_rod: 'part-stick-cylinder-rod', bucket_cyl_barrel: 'part-bucket-cylinder-body', bucket_cyl_rod: 'part-bucket-cylinder-rod' };
function multiply(a: Quat, b: Quat): Quat { return [a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]]; }
function sourceEuler(q: Quat): [number, number, number] {
  const h = Math.SQRT1_2;
  const [x,y,z,w] = multiply(multiply([h,0,0,h], q),[-h,0,0,h]);
  const k = 180 / Math.PI;
  return [Math.atan2(2*(w*x+y*z),1-2*(x*x+y*y))*k, Math.asin(Math.max(-1,Math.min(1,2*(w*y-z*x))))*k, Math.atan2(2*(w*z+x*y),1-2*(y*y+z*z))*k];
}

export function reviewReconstruction(observationInput: unknown, mode: ReconstructionExecutionMode, reviewInput: unknown, authorizationId: string) {
  const observation: ExcavatorObservationV1 = validateExcavatorObservation(observationInput);
  const review = reviewInput as ReconstructionReview;
  const reasons: string[] = [];
  if (!review || typeof review !== 'object') throw new ReconstructionAdapterBlockedError(['revisão humana obrigatória']);
  if (typeof review.reviewerId !== 'string' || !review.reviewerId.trim() || review.reviewerId.length > 100) reasons.push('identificação do revisor obrigatória');
  if (review.bucketConfirmed !== true) reasons.push('a presença de uma caçamba requer confirmação humana');
  if (review.family !== 'tracked_excavator') reasons.push('família de escavadora de rastos requer confirmação humana');
  if (typeof review.widthBasis !== 'string' || !review.widthBasis.trim() || review.widthBasis.length > 500) reasons.push('origem humana da largura obrigatória');
  if (typeof review.bucketWidthM !== 'number' || !Number.isFinite(review.bucketWidthM) || review.bucketWidthM < 0.1 || review.bucketWidthM > 10) reasons.push('largura da caçamba deve estar entre 0,1 e 10 m');
  const decisions = review.decisions;
  if (!decisions || typeof decisions !== 'object' || Array.isArray(decisions)) reasons.push('decisões sobre hipóteses obrigatórias');
  else {
    const items = [ ...observation.hypotheses.map(h => `hypothesis:${h.id}`), ...observation.entities.filter(e => e.status === 'hypothesis').map(e => `entity:${e.id}`), ...observation.relations.filter(r => r.status === 'hypothesis').map(r => `relation:${r.id}`), ...observation.requests.map(r => `request:${r.id}`) ];
    for (const id of items) if (decisions[id] !== 'confirm' && decisions[id] !== 'reject') reasons.push(`item sem decisão: ${id}`);
    for (const request of observation.requests) if (decisions[`request:${request.id}`] === 'confirm') reasons.push(`pedido confirmado sem adaptação suportada: ${request.id}`);
  }
  const descriptions = observation.entities.flatMap(e => [e.label, ...e.features.map(f => f.value ?? '')]).join(' ').toLowerCase();
  if (/\b(wheel(?:ed|s)?|rodas|pneus)\b/.test(descriptions)) reasons.push('possível máquina de rodas incompatível com a família suportada');
  if (observation.machineType !== 'excavator') reasons.push('tipo de máquina não confirmado como escavadora');
  if (reasons.length) throw new ReconstructionAdapterBlockedError(reasons);
  const reviewedObservation = structuredClone(observation);
  for (const entity of reviewedObservation.entities) if (entity.status === 'hypothesis' && decisions[`entity:${entity.id}`] === 'reject') entity.status = 'unknown';
  for (const relation of reviewedObservation.relations) if (relation.status === 'hypothesis' && decisions[`relation:${relation.id}`] === 'reject') relation.status = 'unknown';
  const proposal = buildExcavatorAssembly(reviewedObservation, { mode });
  // Model dimensions and requests never become engineering inputs by themselves.
  for (const part of proposal.parts) {
    for (const dimension of Object.values(part.dimensions)) if (dimension.source === 'observed') dimension.source = 'hypothesis';
    part.geometrySource = 'template';
    part.provenance = { origin: 'synthetic', validation: 'unreviewed', recordedAt: new Date().toISOString(), actor: { kind: 'system', id: 'excavator-reference-template' }, evidence: [{ sourceId: 'src-excavator-fixture' }] };
  }
  for (const actuator of proposal.actuators) if (actuator.stroke.source === 'observed') actuator.stroke.source = 'hypothesis';
  for (const modification of proposal.modifications) modification.review = 'rejected';
  const referencePoses = forwardKinematicsAtReference(EXCAVATOR_ASSEMBLY_V1);
  for (const [canonicalId, proposalId] of Object.entries(partIds)) {
    const pose = referencePoses.get(canonicalId); const part = proposal.parts.find(p => p.id === proposalId);
    if (!pose || !part) throw new ReconstructionAdapterBlockedError([`pose de referência ausente: ${canonicalId}`]);
    part.transform = { translation: [pose.translationM[0], -pose.translationM[2], pose.translationM[1]], rotationEulerDeg: sourceEuler(pose.rotation), scale: [1,1,1] };
  }
  const assembly = adaptReviewedProposalToAssembly(proposal, EXCAVATOR_ASSEMBLY_V1, { reviewerId: review.reviewerId, authorizationId });
  const bucket = assembly.parts.find(p => p.role === 'bucket');
  const box = bucket?.shapes.find(s => s.kind === 'box');
  if (!box || box.kind !== 'box') throw new ReconstructionAdapterBlockedError(['geometria da caçamba não suportada']);
  const beforeM = box.halfExtentsM[2] * 2;
  box.halfExtentsM[2] = review.bucketWidthM / 2;
  box.provenance = { origin: 'human_entered', validation: 'unreviewed', recordedAt: new Date().toISOString(), actor: { kind: 'human', id: review.reviewerId }, evidence: [{ sourceId: authorizationId, excerpt: review.widthBasis }] };
  const validation = validateAssembly(assembly);
  if (!validation.ok) throw new ReconstructionAdapterBlockedError(validation.issues.map(i => `${i.path}: ${i.code}`));
  return { proposal, assembly, review, validation: 'contract_valid' as const, geometry: { bucketWidthBeforeM: beforeM, bucketWidthAfterM: review.bucketWidthM }, limitations: ['A largura é um valor fornecido pelo utilizador, não uma medição física certificada.', 'A restante geometria usa uma referência sintética; não representa dimensões recuperadas da fotografia.', 'Validação do contrato não é cálculo de engenharia nem autorização de movimento.'] };
}
