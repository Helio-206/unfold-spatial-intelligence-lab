import { describe, expect, it, vi } from 'vitest';
import { createMetaServer } from '../server/meta-server';
import { buildExcavatorAssembly, assemblyMetrics } from '../src/living/reconstruction/generator';
import { createOfflineImageObservation, createOfflineTextObservation, parseExcavatorObservation } from '../src/living/reconstruction/observation';
import { validateAssemblyProposal } from '../src/living/reconstruction/contracts';

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
});

describe('living reconstruction API', () => {
  it('serves deterministic offline text and image proposals without an API key', async () => {
    const provider = vi.fn<typeof fetch>();
    const server = createMetaServer({ fetchImpl: provider, maxMetaCalls: 2 });
    await withServer(server, async (port) => {
      const textResponse = await fetch(`http://127.0.0.1:${port}/api/living/reconstruction`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ALLOWED_ORIGIN }, body: JSON.stringify({ mode: 'offline', sourceKind: 'text', instruction: 'Escavadora com boom de 4200 mm e troca o balde.', sourceReference: 'text-fixture' }) });
      const textBody = await textResponse.json() as { contract?: string; status?: string; assembly?: { schema?: string; modifications?: Array<{ review?: string }> }; meta?: { status?: string } };
      expect(textResponse.status).toBe(200);
      expect(textBody).toMatchObject({ contract: 'unfold.reconstruction.v1', status: 'review_required', assembly: { schema: 'unfold.assembly.v1' }, meta: { status: 'mocked' } });
      expect(textBody.assembly?.modifications?.[0]?.review).toBe('pending');

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
      const body = await response.json() as { meta?: { requestId?: string }; assembly?: { validation?: { status?: string } } };
      expect(body).toMatchObject({ meta: { requestId: 'reconstruction-live' }, assembly: { validation: { status: 'review_required' } } });
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
