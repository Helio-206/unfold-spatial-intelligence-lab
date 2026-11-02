import { describe, expect, it, vi } from 'vitest';
import { createMetaServer } from '../server/meta-server';
import { buildExcavatorAssembly, assemblyMetrics } from '../src/living/reconstruction/generator';
import { createOfflineImageObservation, createOfflineTextObservation, parseExcavatorObservation } from '../src/living/reconstruction/observation';
import { validateAssemblyProposal, type ExcavatorObservationV1 } from '../src/living/reconstruction/contracts';
import { adaptReviewedProposalToAssembly, ReconstructionAdapterBlockedError, sourceEulerDegreesToCanonicalQuaternion, sourceVectorToCanonical } from '../src/living/reconstruction/adapter';
import { EXCAVATOR_ASSEMBLY_V1 } from '../src/living/contracts/fixtures/excavator.assembly.v1';
import { validateAssembly } from '../src/living/contracts/assembly.v1';

const ALLOWED_ORIGIN = 'http://127.0.0.1:5173';
const jpegA = 'data:image/jpeg;base64,/9j/4AA=';

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
    const proposal = buildExcavatorAssembly(createOfflineImageObservation('image', 'engineering-fixture', 'f'.repeat(64)));
    const adapted = adaptReviewedProposalToAssembly(proposal, EXCAVATOR_ASSEMBLY_V1, { reviewerId: 'fixture-reviewer', authorizationId: 'fixture-review-001' });
    expect(validateAssembly(adapted)).toEqual({ ok: true, issues: [] });
    expect(adapted.schema).toBe('unfold.assembly.v1');
    expect(adapted.units).toEqual({ length: 'm', angle: 'rad', time: 's' });
    expect(adapted.root.pose.rotation).toHaveLength(4);
    expect(adapted.provenance.validation).toBe('unreviewed');
    expect(adapted.provenance.origin).toBe('derived');
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
