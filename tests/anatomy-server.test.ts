import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createMetaServer } from '../server/meta-server';
import { ANATOMY_OBSERVATION_SCHEMA, validateBoundAnatomyObservation } from '../src/anatomy/contracts';

function tinyPng() {
  const bytes = Buffer.alloc(24); Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(bytes); bytes.writeUInt32BE(13, 8); bytes.write('IHDR', 12); bytes.writeUInt32BE(64, 16); bytes.writeUInt32BE(64, 20);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}
const evidence = [{ id: 'label-ra', kind: 'label_text', detail: 'Printed label: right atrium.', locator: 'left label' }];
const result = { schema: ANATOMY_OBSERVATION_SCHEMA, subjectDisposition: 'heart_illustration', subjectEvidence: evidence, structures: [{ id: 'right-atrium', label: 'Right atrium', status: 'observed', confidence: 0.9, evidence }], relations: [], hypotheses: [], uncertainties: ['No physical scale.'] };
const servers: Array<ReturnType<typeof createMetaServer>> = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))); });

describe('anatomy live observation endpoint', () => {
  it('sends the image to strict Meta schema and returns source-bound anatomy provenance', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: 'completed', output_text: JSON.stringify(result), usage: { input_tokens: 120, output_tokens: 65, total_tokens: 185 } }), { status: 200, headers: { 'x-request-id': 'meta-anatomy-test' } }));
    const server = createMetaServer({ apiKey: 'test-key', fetchImpl }); servers.push(server); await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test port');
    const imageDataUrl = tinyPng(); const imageBytes = Buffer.from(imageDataUrl.slice(imageDataUrl.indexOf(',') + 1), 'base64');
    const response = await fetch(`http://127.0.0.1:${address.port}/api/anatomy/observe`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:5173' }, body: JSON.stringify({ imageDataUrl, sourceReference: 'test-illustration' }) });
    const body = await response.json() as { contract?: string; status?: string; observation?: { schema: string; observationId: string; source: { sha256: string; reference: string }; subjectDisposition: string; subjectEvidence: unknown[]; structures: unknown[]; relations: unknown[]; hypotheses: unknown[]; uncertainties: string[]; dimensions: unknown[] }; meta?: { requestId?: string } };
    const wire = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as { text: { format: { strict: boolean; name: string; schema: object } }; input: Array<{ content: Array<{ image_url?: string }> }> };
    expect(response.status).toBe(200); expect(body).toMatchObject({ contract: ANATOMY_OBSERVATION_SCHEMA, status: 'review_required', meta: { requestId: 'meta-anatomy-test' } });
    expect(body.observation?.source.sha256).toBe(createHash('sha256').update(imageBytes).digest('hex')); expect(body.observation?.dimensions).toEqual([]);
    expect(validateBoundAnatomyObservation(body.observation).observationId).toBe(body.observation?.observationId);
    expect(wire.text.format).toMatchObject({ strict: true, name: 'anatomy_observation_v1' }); expect(wire.input[0]?.content.some((part) => part.image_url === imageDataUrl)).toBe(true);
  });

  it('blocks invalid image dimensions before contacting Meta', async () => {
    const fetchImpl = vi.fn<typeof fetch>(); const server = createMetaServer({ apiKey: 'test-key', fetchImpl }); servers.push(server); await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test port');
    const invalid = tinyPng().replace(/$/, ''); const bytes = Buffer.from(invalid.slice(invalid.indexOf(',') + 1), 'base64'); bytes.writeUInt32BE(5000, 16);
    const response = await fetch(`http://127.0.0.1:${address.port}/api/anatomy/observe`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:5173' }, body: JSON.stringify({ imageDataUrl: `data:image/png;base64,${bytes.toString('base64')}`, sourceReference: 'bad-dimensions' }) });
    expect(response.status).toBe(400); expect(fetchImpl).not.toHaveBeenCalled();
  });
});
