import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createMetaServer } from '../server/meta-server';
import { buildExcavatorAssembly, assemblyMetrics } from '../src/living/reconstruction/generator';
import { createOfflineImageObservation, createOfflineTextObservation, parseExcavatorObservation } from '../src/living/reconstruction/observation';
import { validateAssemblyProposal, type ExcavatorObservationV1 } from '../src/living/reconstruction/contracts';
import { adaptReviewedProposalToAssembly, forwardKinematicsAtReference, ReconstructionAdapterBlockedError, sourceEulerDegreesToCanonicalQuaternion, sourceVectorToCanonical } from '../src/living/reconstruction/adapter';
import { EXCAVATOR_ASSEMBLY_V1 } from '../src/living/contracts/fixtures/excavator.assembly.v1';
import { validateAssembly } from '../src/living/contracts/assembly.v1';
import { EXCAVATOR_TEMPLATE_LIBRARY } from '../src/living/reconstruction/library';

const ALLOWED_ORIGIN = 'http://127.0.0.1:5173';
const jpegA = 'data:image/jpeg;base64,/9j/4AA=';
function expectArrayClose(actual: readonly number[] | undefined, expected: readonly number[], precision = 8): void {
  expect(actual).toBeDefined();
  expected.forEach((value, index) => expect(actual?.[index]).toBeCloseTo(value, precision));
}

function quaternionMultiply(a: [number, number, number, number], b: [number, number, number, number]): [number, number, number, number] {
  return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
}

function canonicalReferenceProposal(proposal: ReturnType<typeof buildExcavatorAssembly>): ReturnType<typeof buildExcavatorAssembly> {
  const reference = JSON.parse(readFileSync(new URL('../src/living/contracts/fixtures/excavator.reference-pose.json', import.meta.url), 'utf8')) as { parts: Array<{ partId: string; translationM: [number, number, number]; rotation: [number, number, number, number] }> };
  const canonicalToProposal = new Map<string, string>([['chassis', 'part-chassis'], ['upper_body', 'part-house'], ['boom', 'part-boom'], ['stick', 'part-stick'], ['bucket', 'part-bucket'], ['boom_cyl_barrel', 'part-boom-cylinder-body'], ['boom_cyl_rod', 'part-boom-cylinder-rod'], ['stick_cyl_barrel', 'part-stick-cylinder-body'], ['stick_cyl_rod', 'part-stick-cylinder-rod'], ['bucket_cyl_barrel', 'part-bucket-cylinder-body'], ['bucket_cyl_rod', 'part-bucket-cylinder-rod']]);
  const frame: [number, number, number, number] = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];
  const frameInverse: [number, number, number, number] = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
  const toSourceEuler = (canonical: [number, number, number, number]): [number, number, number] => {
    const source = quaternionMultiply(quaternionMultiply(frameInverse, canonical), frame);
    const [x, y, z, w] = source;
    const pitch = Math.asin(Math.max(-1, Math.min(1, 2 * (w * y - z * x))));
    return [Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)) * 180 / Math.PI, pitch * 180 / Math.PI, Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)) * 180 / Math.PI];
  };
  const result = structuredClone(proposal);
  for (const pose of reference.parts) {
    const proposalId = canonicalToProposal.get(pose.partId);
    if (!proposalId) continue;
    const part = result.parts.find((candidate) => candidate.id === proposalId)!;
    part.transform = { translation: [pose.translationM[0], -pose.translationM[2], pose.translationM[1]], rotationEulerDeg: toSourceEuler(pose.rotation), scale: [1, 1, 1] };
  }
  return result;
}

async function withServer<T>(server: ReturnType<typeof createMetaServer>, callback: (port: number) => Promise<T>): Promise<T> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Porta de teste indisponível.');
  try { return await callback(address.port); }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

describe('living image-to-assembly contracts', () => {
  it('keeps observed, hypothesis and unknown values separate', () => {
    const observation = createOfflineTextObservation('Escavadora com boom de 4,2 m e balde de 1.1 m. Aumenta o boom.', 'fixture-text');
    expect(observation.source.kind).toBe('text');
    expect(observation.dimensions.find((dimension) => dimension.partId === 'boom')).toMatchObject({ value: 4.2, unit: 'm', status: 'observed' });
    expect(observation.dimensions.find((dimension) => dimension.partId === 'bucket')).toMatchObject({ value: 1.1, unit: 'm', status: 'observed' });
    expect(observation.requests).toEqual([expect.objectContaining({ operation: 'increase_dimension', target: 'boom' })]);
    expect(observation.unknowns.length).toBeGreaterThan(0);
    const assembly = buildExcavatorAssembly(observation);
    expect(validateAssemblyProposal(assembly)).toEqual(assembly);
    expect(assembly.validation.status).toBe('review_required');
    expect(assembly.parts.find((part) => part.id === 'part-boom')?.dimensions.length).toMatchObject({ value: 4.2, unit: 'm', source: 'observed' });
    expect(assembly.parts.find((part) => part.id === 'part-stick')?.geometrySource).toBe('hypothesis');
    expect(assembly.parts.some((part) => part.geometrySource === 'template' || part.geometrySource === 'mixed')).toBe(true);
    expect(assembly.modifications[0]).toMatchObject({ targetPartId: 'part-boom', review: 'pending' });
  });

  it('matches text dimensions by part and semantic dimension, preserving omitted values', () => {
    const both = createOfflineTextObservation('Escavadora com chassis de 3.2 m de comprimento e 2.4 m de largura.');
    expect(both.dimensions.find((dimension) => dimension.id === 'dim-chassis-length')).toMatchObject({ value: 3.2, unit: 'm', status: 'observed' });
    expect(both.dimensions.find((dimension) => dimension.id === 'dim-chassis-width')).toMatchObject({ value: 2.4, unit: 'm', status: 'observed' });
    const lengthOnly = createOfflineTextObservation('Escavadora com chassis de 3200 mm de comprimento.');
    expect(lengthOnly.dimensions.find((dimension) => dimension.id === 'dim-chassis-length')).toMatchObject({ value: 3200, unit: 'mm', status: 'observed' });
    expect(lengthOnly.dimensions.find((dimension) => dimension.id === 'dim-chassis-width')).toMatchObject({ value: null, unit: 'unknown', status: 'unknown' });
  });

  it('generates reviewable assemblies for two distinct image sources without treating the raster as verified geometry', () => {
    const first = buildExcavatorAssembly(createOfflineImageObservation('image', 'excavator-photo-a', 'a'.repeat(64)));
    const second = buildExcavatorAssembly(createOfflineImageObservation('technical_drawing', 'excavator-drawing-b', 'b'.repeat(64)));
    expect(first.proposalId).not.toBe(second.proposalId);
    expect(first.source.kind).toBe('image');
    expect(second.source.kind).toBe('technical_drawing');
    expect(first.parts.every((part) => part.review === 'pending')).toBe(true);
    expect(first.parts.find((part) => part.id === 'part-boom')?.geometrySource).toBe('hypothesis');
    expect(first.joints.every((joint) => joint.axis.some((component) => component !== 0))).toBe(true);
    expect(assemblyMetrics(first)).toMatchObject({ schemaValid: true, partRecognition: 0, jointConnectivity: 0 });
  });

  it('isolates mutable template transforms across proposals and canonical adaptation', () => {
    const templateBoom = EXCAVATOR_TEMPLATE_LIBRARY.find((template) => template.libraryKey === 'excavator.boom.single')!;
    const pristineTransform = structuredClone(templateBoom.transform);
    const proposalA = buildExcavatorAssembly(createOfflineImageObservation('image', 'transform-isolation-a', '8'.repeat(64)));
    const proposalB = buildExcavatorAssembly(createOfflineImageObservation('technical_drawing', 'transform-isolation-b', '9'.repeat(64)));
    const boomA = proposalA.parts.find((part) => part.id === 'part-boom')!;
    const boomB = proposalB.parts.find((part) => part.id === 'part-boom')!;

    expect(boomA.transform).not.toBe(boomB.transform);
    expect(boomA.transform).not.toBe(templateBoom.transform);
    expect(boomB.transform).not.toBe(templateBoom.transform);
    expect(boomA.transform.translation).not.toBe(boomB.transform.translation);
    expect(boomA.transform.rotationEulerDeg).not.toBe(boomB.transform.rotationEulerDeg);
    expect(boomA.transform.scale).not.toBe(boomB.transform.scale);

    boomA.transform.translation[0] += 0.25;
    boomA.transform.rotationEulerDeg[2] += 1;
    boomA.transform.scale[0] += 0.1;

    expect(boomB.transform).toEqual(pristineTransform);
    expect(templateBoom.transform).toEqual(pristineTransform);
    const proposalC = buildExcavatorAssembly(createOfflineImageObservation('image', 'transform-isolation-c', 'a'.repeat(64)));
    expect(proposalC.parts.find((part) => part.id === 'part-boom')?.transform).toEqual(pristineTransform);
    expect(validateAssemblyProposal(proposalA)).toEqual(proposalA);
    expect(validateAssemblyProposal(proposalB)).toEqual(proposalB);
    expect(validateAssemblyProposal(proposalC)).toEqual(proposalC);

    const adapted = adaptReviewedProposalToAssembly(canonicalReferenceProposal(proposalC), EXCAVATOR_ASSEMBLY_V1, { reviewerId: 'transform-isolation-reviewer', authorizationId: 'transform-isolation-001' });
    expect(validateAssembly(adapted)).toEqual({ ok: true, issues: [] });
    const expectedBoom = sourceVectorToCanonical(canonicalReferenceProposal(proposalC).parts.find((part) => part.id === 'part-boom')!.transform.translation);
    expectArrayClose(forwardKinematicsAtReference(adapted).get('boom')?.translationM, expectedBoom, 9);
  });

  it('rejects malformed model output and invalid topology before assembly generation', () => {
    expect(() => parseExcavatorObservation(JSON.stringify({ schema: 'unfold.excavator_observation.v1', source: { kind: 'image', reference: 'x' }, machineType: 'excavator', entities: [{ id: 'boom', kind: 'boom', label: 'boom', status: 'observed', evidence: [], features: [], confidence: 1 }], relations: [], dimensions: [], requests: [], unknowns: [], hypotheses: [] }))).toThrow(/RECONSTRUCTION_SCHEMA_INVALID/);
    const assembly = buildExcavatorAssembly(createOfflineImageObservation('image', 'x', 'c'.repeat(64)));
    const cyclic = structuredClone(assembly);
    cyclic.parts[0]!.parentId = cyclic.parts[1]!.id;
    cyclic.parts[1]!.parentId = cyclic.parts[0]!.id;
    expect(() => validateAssemblyProposal(cyclic)).toThrow(/ciclo|raiz/);
  });

  it('resolves arbitrary model entity IDs and matches dimensions semantically', () => {
    const observation = createOfflineImageObservation('image', 'arbitrary-ids', 'd'.repeat(64)) as ExcavatorObservationV1;
    observation.entities = observation.entities.map((entity) => ({ ...entity, id: `${entity.id}-1`, label: entity.label }));
    observation.dimensions = [
      { id: 'width', partId: 'bucket-1', label: 'largura do balde', value: 1.2, unit: 'm', status: 'observed', evidence: observation.entities[4]!.evidence },
      { id: 'depth', partId: 'bucket-1', label: 'profundidade do balde', value: 0.8, unit: 'unknown', status: 'observed', evidence: observation.entities[4]!.evidence },
    ];
    const proposal = buildExcavatorAssembly(observation, { mode: 'live' });
    expect(proposal.parts.find((part) => part.id === 'part-bucket')?.dimensions.width).toMatchObject({ value: 1.2, unit: 'm', source: 'observed' });
    expect(proposal.parts.find((part) => part.id === 'part-bucket')?.dimensions.depth).toMatchObject({ value: 0.8, unit: 'unknown', source: 'observed' });
    expect(proposal.parts.find((part) => part.id === 'part-bucket')?.dimensions.depth?.unit).not.toBe('deg');
    expect(proposal.parts.find((part) => part.id === 'part-bucket')?.provenance.inference?.provider).toBe('meta');
  });

  it('keeps offline hypotheses synthetic and never attributes them to Muse', () => {
    const proposal = buildExcavatorAssembly(createOfflineImageObservation('image', 'offline-provenance', 'e'.repeat(64)));
    expect(proposal.parts.every((part) => part.provenance.inference === undefined)).toBe(true);
    expect(proposal.parts.every((part) => part.provenance.actor?.id !== 'muse-spark-1.3')).toBe(true);
    expect(proposal.parts.some((part) => part.provenance.origin === 'synthetic')).toBe(true);
  });

  it('converts source frame and units explicitly', () => {
    expect(sourceVectorToCanonical([1, 2, 3])).toEqual([1, 3, -2]);
    expect(sourceEulerDegreesToCanonicalQuaternion([0, 0, 0])).toEqual([0, 0, 0, 1]);
  });

  it('adapts a reviewed proposal to the engineering fixture and validates the actual canonical output', () => {
    const proposal = canonicalReferenceProposal(buildExcavatorAssembly(createOfflineImageObservation('image', 'engineering-fixture', 'f'.repeat(64))));
    const adapted = adaptReviewedProposalToAssembly(proposal, EXCAVATOR_ASSEMBLY_V1, { reviewerId: 'fixture-reviewer', authorizationId: 'fixture-review-001' });
    expect(validateAssembly(adapted)).toEqual({ ok: true, issues: [] });
    expect(adapted.schema).toBe('unfold.assembly.v1');
    expect(adapted.units).toEqual({ length: 'm', angle: 'rad', time: 's' });
    expect(adapted.root.pose.rotation).toHaveLength(4);
    expect(adapted.provenance.validation).toBe('unreviewed');
    expect(adapted.provenance.origin).toBe('derived');
  });

  it('removes reference motion from Joint.origin and recovers the proposed pose by FK', () => {
    const proposal = canonicalReferenceProposal(buildExcavatorAssembly(createOfflineImageObservation('image', 'fk-proposal', '2'.repeat(64))));
    const adapted = adaptReviewedProposalToAssembly(proposal, EXCAVATOR_ASSEMBLY_V1, { reviewerId: 'fk-reviewer', authorizationId: 'fk-001' });
    const fk = forwardKinematicsAtReference(adapted);
    const expected = new Map([
      ['chassis', { translationM: sourceVectorToCanonical(proposal.parts.find((part) => part.id === 'part-chassis')!.transform.translation), rotation: sourceEulerDegreesToCanonicalQuaternion(proposal.parts.find((part) => part.id === 'part-chassis')!.transform.rotationEulerDeg) }],
      ['upper_body', { translationM: sourceVectorToCanonical(proposal.parts.find((part) => part.id === 'part-house')!.transform.translation), rotation: sourceEulerDegreesToCanonicalQuaternion(proposal.parts.find((part) => part.id === 'part-house')!.transform.rotationEulerDeg) }],
      ['boom', { translationM: sourceVectorToCanonical(proposal.parts.find((part) => part.id === 'part-boom')!.transform.translation), rotation: sourceEulerDegreesToCanonicalQuaternion(proposal.parts.find((part) => part.id === 'part-boom')!.transform.rotationEulerDeg) }],
      ['stick', { translationM: sourceVectorToCanonical(proposal.parts.find((part) => part.id === 'part-stick')!.transform.translation), rotation: sourceEulerDegreesToCanonicalQuaternion(proposal.parts.find((part) => part.id === 'part-stick')!.transform.rotationEulerDeg) }],
      ['bucket', { translationM: sourceVectorToCanonical(proposal.parts.find((part) => part.id === 'part-bucket')!.transform.translation), rotation: sourceEulerDegreesToCanonicalQuaternion(proposal.parts.find((part) => part.id === 'part-bucket')!.transform.rotationEulerDeg) }],
      ['boom_cyl_barrel', { translationM: sourceVectorToCanonical(proposal.parts.find((part) => part.id === 'part-boom-cylinder-body')!.transform.translation), rotation: sourceEulerDegreesToCanonicalQuaternion(proposal.parts.find((part) => part.id === 'part-boom-cylinder-body')!.transform.rotationEulerDeg) }],
      ['boom_cyl_rod', { translationM: sourceVectorToCanonical(proposal.parts.find((part) => part.id === 'part-boom-cylinder-rod')!.transform.translation), rotation: sourceEulerDegreesToCanonicalQuaternion(proposal.parts.find((part) => part.id === 'part-boom-cylinder-rod')!.transform.rotationEulerDeg) }],
      ['stick_cyl_barrel', { translationM: sourceVectorToCanonical(proposal.parts.find((part) => part.id === 'part-stick-cylinder-body')!.transform.translation), rotation: sourceEulerDegreesToCanonicalQuaternion(proposal.parts.find((part) => part.id === 'part-stick-cylinder-body')!.transform.rotationEulerDeg) }],
      ['stick_cyl_rod', { translationM: sourceVectorToCanonical(proposal.parts.find((part) => part.id === 'part-stick-cylinder-rod')!.transform.translation), rotation: sourceEulerDegreesToCanonicalQuaternion(proposal.parts.find((part) => part.id === 'part-stick-cylinder-rod')!.transform.rotationEulerDeg) }],
      ['bucket_cyl_barrel', { translationM: sourceVectorToCanonical(proposal.parts.find((part) => part.id === 'part-bucket-cylinder-body')!.transform.translation), rotation: sourceEulerDegreesToCanonicalQuaternion(proposal.parts.find((part) => part.id === 'part-bucket-cylinder-body')!.transform.rotationEulerDeg) }],
      ['bucket_cyl_rod', { translationM: sourceVectorToCanonical(proposal.parts.find((part) => part.id === 'part-bucket-cylinder-rod')!.transform.translation), rotation: sourceEulerDegreesToCanonicalQuaternion(proposal.parts.find((part) => part.id === 'part-bucket-cylinder-rod')!.transform.rotationEulerDeg) }],
    ]);
    for (const [partId, pose] of expected) {
      expectArrayClose(fk.get(partId)?.translationM, pose.translationM, 9);
      expectArrayClose(fk.get(partId)?.rotation, pose.rotation, 9);
    }

    const reference = JSON.parse(readFileSync(new URL('../src/living/contracts/fixtures/excavator.reference-pose.json', import.meta.url), 'utf8')) as { parts: Array<{ partId: string; translationM: [number, number, number]; rotation: [number, number, number, number] }> };
    const fixtureUpper = reference.parts.find((part) => part.partId === 'upper_body')!;
    const fixtureProposal = structuredClone(proposal);
    fixtureProposal.parts.find((part) => part.id === 'part-house')!.transform = { translation: [0, 0, fixtureUpper.translationM[1]], rotationEulerDeg: [0, 0, 0], scale: [1, 1, 1] };
    const fixtureAdapted = adaptReviewedProposalToAssembly(fixtureProposal, EXCAVATOR_ASSEMBLY_V1, { reviewerId: 'fk-reviewer', authorizationId: 'fk-fixture-001' });
    const fixtureFk = forwardKinematicsAtReference(fixtureAdapted).get('upper_body')!;
    expectArrayClose(fixtureFk.translationM, fixtureUpper.translationM, 9);
  });

  it('fails closed when an approved boom length cannot preserve loop closure', () => {
    const proposal = canonicalReferenceProposal(buildExcavatorAssembly(createOfflineImageObservation('image', 'boom-7m', '3'.repeat(64))));
    const boom = proposal.parts.find((part) => part.id === 'part-boom')!;
    boom.dimensions.length = { value: 7, unit: 'm', source: 'observed', evidenceIds: ['boom-7m-evidence'], requiredForVerification: true };
    expect(() => adaptReviewedProposalToAssembly(proposal, EXCAVATOR_ASSEMBLY_V1, { reviewerId: 'dimension-reviewer', authorizationId: 'dimension-001' })).toThrow(/constraint .*inconsistente/);
  });

  it('applies approved cylinder stroke to actuator limits and rod geometry', () => {
    const proposal = canonicalReferenceProposal(buildExcavatorAssembly(createOfflineImageObservation('image', 'boom-stroke', '4'.repeat(64))));
    const cylinder = proposal.parts.find((part) => part.id === 'part-boom-cylinder-body')!;
    cylinder.dimensions.stroke = { value: 1, unit: 'm', source: 'observed', evidenceIds: ['boom-stroke-evidence'], requiredForVerification: true };
    const adapted = adaptReviewedProposalToAssembly(proposal, EXCAVATOR_ASSEMBLY_V1, { reviewerId: 'stroke-reviewer', authorizationId: 'stroke-001' });
    const actuator = adapted.actuators.find((candidate) => candidate.id === 'boom_cylinder')!;
    expect(actuator.kind).toBe('hydraulic_cylinder');
    if (actuator.kind === 'hydraulic_cylinder') expect(actuator.stroke.max.value).toBe(1);
    expect(adapted.joints.find((joint) => joint.id === 'boom_cyl_slide')!.limits!.max.value).toBe(1);
    const rodShape = adapted.parts.find((part) => part.id === 'boom_cyl_rod')!.shapes[0]!;
    if (rodShape.kind === 'cylinder') expect(rodShape.halfLengthM).toBeCloseTo(0.7515 / 0.76, 9);
    expect(validateAssembly(adapted)).toEqual({ ok: true, issues: [] });
  });

  it('consumes rod-side cylinder stroke observations and rejects conflicts', () => {
    const rodOnly = canonicalReferenceProposal(buildExcavatorAssembly(createOfflineImageObservation('image', 'rod-stroke', '7'.repeat(64))));
    rodOnly.parts.find((part) => part.id === 'part-boom-cylinder-rod')!.dimensions.stroke = { value: 1, unit: 'm', source: 'observed', evidenceIds: ['rod-stroke-evidence'], requiredForVerification: true };
    const adapted = adaptReviewedProposalToAssembly(rodOnly, EXCAVATOR_ASSEMBLY_V1, { reviewerId: 'stroke-reviewer', authorizationId: 'stroke-rod-001' });
    const actuator = adapted.actuators.find((candidate) => candidate.id === 'boom_cylinder')!;
    if (actuator.kind === 'hydraulic_cylinder') expect(actuator.stroke.max.value).toBe(1);

    const conflicting = structuredClone(rodOnly);
    conflicting.parts.find((part) => part.id === 'part-boom-cylinder-body')!.dimensions.stroke = { value: 0.9, unit: 'm', source: 'observed', evidenceIds: ['barrel-stroke-evidence'], requiredForVerification: true };
    expect(() => adaptReviewedProposalToAssembly(conflicting, EXCAVATOR_ASSEMBLY_V1, { reviewerId: 'stroke-reviewer', authorizationId: 'stroke-rod-002' })).toThrow(/cursos observados conflitantes/);
  });

  it('applies an actuator-only observed stroke with unit normalization and coherent provenance', () => {
    const proposal = canonicalReferenceProposal(buildExcavatorAssembly(createOfflineImageObservation('image', 'actuator-stroke', 'b'.repeat(64))));
    const proposalActuator = proposal.actuators.find((actuator) => actuator.id === 'actuator-boom')!;
    proposalActuator.stroke = { value: 1000, unit: 'mm', source: 'observed', evidenceIds: ['actuator-stroke-evidence'], requiredForVerification: true };
    const adapted = adaptReviewedProposalToAssembly(proposal, EXCAVATOR_ASSEMBLY_V1, { reviewerId: 'stroke-reviewer', authorizationId: 'stroke-actuator-001' });
    const actuator = adapted.actuators.find((candidate) => candidate.id === 'boom_cylinder')!;
    if (actuator.kind !== 'hydraulic_cylinder') throw new Error('Expected hydraulic cylinder.');
    expect(actuator.stroke.max.value).toBe(1);
    expect(actuator.stroke.max.provenance.evidence).toEqual([{ sourceId: 'actuator-stroke-evidence' }]);
    expect(actuator.provenance.evidence).toEqual([{ sourceId: 'actuator-stroke-evidence' }]);
    expect(adapted.joints.find((joint) => joint.id === 'boom_cyl_slide')!.limits!.max.value).toBe(1);
    const rodShape = adapted.parts.find((part) => part.id === 'boom_cyl_rod')!.shapes[0]!;
    if (rodShape.kind === 'cylinder') expect(rodShape.halfLengthM).toBeCloseTo(0.7515 / 0.76, 9);
    expect(validateAssembly(adapted)).toEqual({ ok: true, issues: [] });
  });

  it('accepts matching actuator, barrel and rod strokes and combines their evidence', () => {
    const proposal = canonicalReferenceProposal(buildExcavatorAssembly(createOfflineImageObservation('image', 'matching-strokes', 'c'.repeat(64))));
    proposal.actuators.find((actuator) => actuator.id === 'actuator-boom')!.stroke = { value: 1000, unit: 'mm', source: 'observed', evidenceIds: ['actuator-evidence'], requiredForVerification: true };
    proposal.parts.find((part) => part.id === 'part-boom-cylinder-body')!.dimensions.stroke = { value: 1, unit: 'm', source: 'observed', evidenceIds: ['barrel-evidence'], requiredForVerification: true };
    proposal.parts.find((part) => part.id === 'part-boom-cylinder-rod')!.dimensions.stroke = { value: 1000, unit: 'mm', source: 'observed', evidenceIds: ['rod-evidence'], requiredForVerification: true };
    const adapted = adaptReviewedProposalToAssembly(proposal, EXCAVATOR_ASSEMBLY_V1, { reviewerId: 'stroke-reviewer', authorizationId: 'stroke-matching-001' });
    const actuator = adapted.actuators.find((candidate) => candidate.id === 'boom_cylinder')!;
    if (actuator.kind !== 'hydraulic_cylinder') throw new Error('Expected hydraulic cylinder.');
    expect(actuator.stroke.max.value).toBe(1);
    expect(actuator.provenance.evidence?.map((evidence) => evidence.sourceId)).toEqual(['actuator-evidence', 'barrel-evidence', 'rod-evidence']);
  });

  it('rejects conflicting or unsupported observed stroke measurements', () => {
    const conflicting = canonicalReferenceProposal(buildExcavatorAssembly(createOfflineImageObservation('image', 'conflicting-actuator-stroke', 'd'.repeat(64))));
    conflicting.actuators.find((actuator) => actuator.id === 'actuator-boom')!.stroke = { value: 0.9, unit: 'm', source: 'observed', evidenceIds: ['actuator-evidence'], requiredForVerification: true };
    conflicting.parts.find((part) => part.id === 'part-boom-cylinder-body')!.dimensions.stroke = { value: 1, unit: 'm', source: 'observed', evidenceIds: ['barrel-evidence'], requiredForVerification: true };
    expect(() => adaptReviewedProposalToAssembly(conflicting, EXCAVATOR_ASSEMBLY_V1, { reviewerId: 'stroke-reviewer', authorizationId: 'stroke-conflict-001' })).toThrow(/cursos observados conflitantes/);

    const unsupported = canonicalReferenceProposal(buildExcavatorAssembly(createOfflineImageObservation('image', 'unsupported-actuator-stroke', 'e'.repeat(64))));
    unsupported.actuators.find((actuator) => actuator.id === 'actuator-boom')!.stroke = { value: 1, unit: 'unknown', source: 'observed', evidenceIds: ['unknown-unit-evidence'], requiredForVerification: true };
    expect(() => adaptReviewedProposalToAssembly(unsupported, EXCAVATOR_ASSEMBLY_V1, { reviewerId: 'stroke-reviewer', authorizationId: 'stroke-unit-001' })).toThrow(/unidade de engenharia suportada/);
  });

  it('blocks an explicitly rejected required part', () => {
    const proposal = canonicalReferenceProposal(buildExcavatorAssembly(createOfflineImageObservation('image', 'rejected-part', 'f'.repeat(64))));
    proposal.parts.find((part) => part.id === 'part-bucket')!.review = 'rejected';
    expect(() => adaptReviewedProposalToAssembly(proposal, EXCAVATOR_ASSEMBLY_V1, { reviewerId: 'reviewer', authorizationId: 'reject-part-001' })).toThrow(/parte rejeitada: part-bucket/);
  });

  it('blocks an explicitly rejected required joint', () => {
    const proposal = canonicalReferenceProposal(buildExcavatorAssembly(createOfflineImageObservation('image', 'rejected-joint', '0'.repeat(64))));
    proposal.joints.find((joint) => joint.id === 'joint-bucket')!.review = 'rejected';
    expect(() => adaptReviewedProposalToAssembly(proposal, EXCAVATOR_ASSEMBLY_V1, { reviewerId: 'reviewer', authorizationId: 'reject-joint-001' })).toThrow(/junta rejeitada: joint-bucket/);
  });

  it('blocks an explicitly rejected required actuator', () => {
    const proposal = canonicalReferenceProposal(buildExcavatorAssembly(createOfflineImageObservation('image', 'rejected-actuator', '1'.repeat(64))));
    proposal.actuators.find((actuator) => actuator.id === 'actuator-boom')!.review = 'rejected';
    expect(() => adaptReviewedProposalToAssembly(proposal, EXCAVATOR_ASSEMBLY_V1, { reviewerId: 'reviewer', authorizationId: 'reject-actuator-001' })).toThrow(/actuador rejeitado: actuator-boom/);
  });

  it('fails closed for reviewed proposal fields that have no canonical conversion', () => {
    const scaled = canonicalReferenceProposal(buildExcavatorAssembly(createOfflineImageObservation('image', 'unsupported-scale', '2'.repeat(64))));
    scaled.parts.find((part) => part.id === 'part-boom')!.transform.scale = [2, 1, 1];
    expect(() => adaptReviewedProposalToAssembly(scaled, EXCAVATOR_ASSEMBLY_V1, { reviewerId: 'reviewer', authorizationId: 'unsupported-scale-001' })).toThrow(/escala não suportada/);

    const anchored = canonicalReferenceProposal(buildExcavatorAssembly(createOfflineImageObservation('image', 'unsupported-anchor', '3'.repeat(64))));
    anchored.joints.find((joint) => joint.id === 'joint-boom')!.anchor = [0.1, 0, 0];
    expect(() => adaptReviewedProposalToAssembly(anchored, EXCAVATOR_ASSEMBLY_V1, { reviewerId: 'reviewer', authorizationId: 'unsupported-anchor-001' })).toThrow(/anchor não suportado/);

    const modified = canonicalReferenceProposal(buildExcavatorAssembly(createOfflineTextObservation('Aumenta o boom.', 'verified-modification')));
    modified.modifications[0]!.review = 'verified';
    expect(() => adaptReviewedProposalToAssembly(modified, EXCAVATOR_ASSEMBLY_V1, { reviewerId: 'reviewer', authorizationId: 'verified-modification-001' })).toThrow(/modificação verificada sem adaptação/);
  });

  it('fails closed for missing or inconsistent required actuator and joint mappings', () => {
    const missingActuator = canonicalReferenceProposal(buildExcavatorAssembly(createOfflineImageObservation('image', 'missing-actuator', '4'.repeat(64))));
    missingActuator.actuators = missingActuator.actuators.filter((actuator) => actuator.id !== 'actuator-boom');
    expect(() => adaptReviewedProposalToAssembly(missingActuator, EXCAVATOR_ASSEMBLY_V1, { reviewerId: 'reviewer', authorizationId: 'missing-actuator-001' })).toThrow(/actuador canónico sem correspondência: boom_cylinder/);

    const wrongJointType = canonicalReferenceProposal(buildExcavatorAssembly(createOfflineImageObservation('image', 'wrong-joint-type', '5'.repeat(64))));
    wrongJointType.joints.find((joint) => joint.id === 'joint-boom')!.type = 'fixed';
    expect(() => adaptReviewedProposalToAssembly(wrongJointType, EXCAVATOR_ASSEMBLY_V1, { reviewerId: 'reviewer', authorizationId: 'wrong-joint-type-001' })).toThrow(/tipo de junta incompatível/);
  });

  it('fails closed for unconsumed observed geometry and inconsistent proposal topology', () => {
    const unmappedDimension = canonicalReferenceProposal(buildExcavatorAssembly(createOfflineImageObservation('image', 'unmapped-track-dimension', '6'.repeat(64))));
    unmappedDimension.parts.find((part) => part.id === 'part-track-left')!.dimensions.length = { value: 4, unit: 'm', source: 'observed', evidenceIds: ['track-length-evidence'], requiredForVerification: true };
    expect(() => adaptReviewedProposalToAssembly(unmappedDimension, EXCAVATOR_ASSEMBLY_V1, { reviewerId: 'reviewer', authorizationId: 'unmapped-dimension-001' })).toThrow(/dimensão observada em parte sem correspondência canónica/);

    const wrongHierarchy = canonicalReferenceProposal(buildExcavatorAssembly(createOfflineImageObservation('image', 'wrong-hierarchy', '7'.repeat(64))));
    wrongHierarchy.parts.find((part) => part.id === 'part-boom')!.parentId = 'part-chassis';
    expect(() => adaptReviewedProposalToAssembly(wrongHierarchy, EXCAVATOR_ASSEMBLY_V1, { reviewerId: 'reviewer', authorizationId: 'wrong-hierarchy-001' })).toThrow(/hierarquia de parte incompatível/);

    const wrongActuatorJoints = canonicalReferenceProposal(buildExcavatorAssembly(createOfflineImageObservation('image', 'wrong-actuator-joints', '8'.repeat(64))));
    wrongActuatorJoints.actuators.find((actuator) => actuator.id === 'actuator-boom')!.jointIds = ['joint-stick', 'joint-boom-cylinder-slide'];
    expect(() => adaptReviewedProposalToAssembly(wrongActuatorJoints, EXCAVATOR_ASSEMBLY_V1, { reviewerId: 'reviewer', authorizationId: 'wrong-actuator-joints-001' })).toThrow(/juntas de actuador incompatíveis/);
  });

  it('blocks an approved dimension when no coherent canonical mapping exists', () => {
    const proposal = buildExcavatorAssembly(createOfflineImageObservation('image', 'bucket-width', '5'.repeat(64)));
    const bucket = proposal.parts.find((part) => part.id === 'part-bucket')!;
    bucket.dimensions.width = { value: 1.2, unit: 'm', source: 'observed', evidenceIds: ['bucket-width-evidence'], requiredForVerification: true };
    expect(() => adaptReviewedProposalToAssembly(proposal, EXCAVATOR_ASSEMBLY_V1, { reviewerId: 'dimension-reviewer', authorizationId: 'dimension-002' })).toThrow(/sem adaptação geométrica suportada/);
  });

  it('fails closed when engineering information or explicit review is missing', () => {
    const proposal = buildExcavatorAssembly(createOfflineImageObservation('image', 'blocked-adapter', '1'.repeat(64)));
    expect(() => adaptReviewedProposalToAssembly(proposal, EXCAVATOR_ASSEMBLY_V1, { reviewerId: '', authorizationId: '' })).toThrow(ReconstructionAdapterBlockedError);
    const incomplete = structuredClone(EXCAVATOR_ASSEMBLY_V1);
    incomplete.parts = incomplete.parts.filter((part) => part.id !== 'boom');
    expect(() => adaptReviewedProposalToAssembly(proposal, incomplete, { reviewerId: 'reviewer', authorizationId: 'auth-1' })).toThrow(/engineeringSeed inválido|parte obrigatória/);
  });
});

describe('living reconstruction API', () => {
  it('serves deterministic offline text and image proposals without an API key', async () => {
    const provider = vi.fn<typeof fetch>();
    const server = createMetaServer({ fetchImpl: provider, maxMetaCalls: 2 });
    await withServer(server, async (port) => {
      const textResponse = await fetch(`http://127.0.0.1:${port}/api/living/reconstruction`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ALLOWED_ORIGIN }, body: JSON.stringify({ mode: 'offline', sourceKind: 'text', instruction: 'Escavadora com boom de 4200 mm e troca o balde.', sourceReference: 'text-fixture' }) });
      const textBody = await textResponse.json() as { contract?: string; status?: string; assemblyProposal?: { schema?: string; modifications?: Array<{ review?: string }> }; engineering?: { status?: string }; meta?: { status?: string } };
      expect(textResponse.status).toBe(200);
      expect(textBody).toMatchObject({ contract: 'unfold.reconstruction.v1', status: 'review_required', assemblyProposal: { schema: 'unfold.assembly_proposal.v1' }, engineering: { status: 'blocked' }, meta: { status: 'mocked' } });
      expect(textBody.assemblyProposal?.modifications?.[0]?.review).toBe('pending');

      const imageResponse = await fetch(`http://127.0.0.1:${port}/api/living/reconstruction`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ALLOWED_ORIGIN }, body: JSON.stringify({ mode: 'offline', sourceKind: 'technical_drawing', imageDataUrl: jpegA, sourceReference: 'drawing-fixture' }) });
      expect(imageResponse.status).toBe(200);
      const imageBody = await imageResponse.json() as { observation?: { source?: { kind?: string } } };
      expect(imageBody.observation?.source?.kind).toBe('technical_drawing');
      expect(provider).not.toHaveBeenCalled();
    });
  });

  it('uses the strict Muse schema for live text and rejects invalid upstream JSON', async () => {
    const observation = createOfflineTextObservation('Escavadora com boom de 4 m', 'live-fixture');
    const provider = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ id: 'reconstruction-live', status: 'completed', output_text: JSON.stringify(observation), usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } }), { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'reconstruction-live' } }));
    const server = createMetaServer({ apiKey: 'fixture-key-not-real', fetchImpl: provider });
    await withServer(server, async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/living/reconstruction`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ALLOWED_ORIGIN }, body: JSON.stringify({ sourceKind: 'text', instruction: 'Escavadora com boom de 4 m', sourceReference: 'live-fixture' }) });
      expect(response.status).toBe(200);
      const body = await response.json() as { meta?: { requestId?: string }; assemblyProposal?: { validation?: { status?: string } } };
      expect(body).toMatchObject({ meta: { requestId: 'reconstruction-live' }, assemblyProposal: { validation: { status: 'review_required' } } });
      const request = provider.mock.calls[0]?.[1];
      const requestBody = JSON.parse(String(request?.body)) as { model?: string; text?: { format?: { name?: string; strict?: boolean } } };
      expect(requestBody).toMatchObject({ model: 'muse-spark-1.3', text: { format: { name: 'excavator_observation_v1', strict: true } } });

      const imageResponse = await fetch(`http://127.0.0.1:${port}/api/living/reconstruction`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ALLOWED_ORIGIN }, body: JSON.stringify({ sourceKind: 'image', imageDataUrl: jpegA, sourceReference: 'live-image-fixture' }) });
      expect(imageResponse.status).toBe(200);
      const imageRequest = provider.mock.calls[1]?.[1];
      const imageRequestBody = JSON.parse(String(imageRequest?.body)) as { input?: Array<{ content?: Array<{ type?: string }> }> };
      expect(imageRequestBody.input?.[0]?.content?.some((item) => item.type === 'input_image')).toBe(true);
    });

    const invalidProvider = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ id: 'reconstruction-invalid', status: 'completed', output_text: '{"schema":"wrong"}' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const invalidServer = createMetaServer({ apiKey: 'fixture-key-not-real', fetchImpl: invalidProvider });
    await withServer(invalidServer, async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/living/reconstruction`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ALLOWED_ORIGIN }, body: JSON.stringify({ sourceKind: 'text', instruction: 'Escavadora', sourceReference: 'invalid-fixture' }) });
      expect(response.status).toBe(502);
      const body = await response.json() as { error?: { code?: string } };
      expect(body.error?.code).toBe('RECONSTRUCTION_SCHEMA_INVALID');
    });
  });

  it('rejects malformed image input before any provider call', async () => {
    const provider = vi.fn<typeof fetch>();
    const server = createMetaServer({ apiKey: 'fixture-key-not-real', fetchImpl: provider });
    await withServer(server, async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/living/reconstruction`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ALLOWED_ORIGIN }, body: JSON.stringify({ mode: 'offline', sourceKind: 'image', imageDataUrl: 'data:image/png;base64,not-an-image', sourceReference: 'bad-image' }) });
      expect(response.status).toBe(400);
      const body = await response.json() as { error?: { code?: string } };
      expect(body.error?.code).toBe('INVALID_RECONSTRUCTION_IMAGE');
      expect(provider).not.toHaveBeenCalled();
    });
  });

  it('does not silently downgrade a live request when credentials are absent', async () => {
    const provider = vi.fn<typeof fetch>();
    const server = createMetaServer({ fetchImpl: provider });
    await withServer(server, async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/living/reconstruction`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ALLOWED_ORIGIN }, body: JSON.stringify({ sourceKind: 'text', instruction: 'Escavadora', sourceReference: 'live-without-key' }) });
      expect(response.status).toBe(503);
      const body = await response.json() as { error?: { code?: string } };
      expect(body.error?.code).toBe('MODEL_API_KEY_MISSING');
      expect(provider).not.toHaveBeenCalled();
    });
  });
});
