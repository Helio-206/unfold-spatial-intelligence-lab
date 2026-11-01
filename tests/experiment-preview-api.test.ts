import { describe, expect, it, vi } from 'vitest';
import { createMetaServer, type PreviewMechanismResolution, type ServerOptions } from '../server/meta-server';
import { createPhase3DReferenceFixture } from '../src/phase3d-fixture';
import { ALLOWED_ORIGIN } from './helpers/paid-routes';

const operationResponse = JSON.stringify({
  schema: 'kinematic_operation.v1',
  action: 'update_length',
  componentId: 'crank',
  newValue: 80,
  unit: 'mm',
});

async function withServer(fetchImpl: typeof fetch, callback: (port: number) => Promise<void>, options: ServerOptions = {}): Promise<void> {
  const server = createMetaServer({ apiKey: 'test-key-not-real', fetchImpl, ...options });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Porta de teste indisponível.');
  try {
    await callback(address.port);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

describe('POST /api/experiments/preview', () => {
  it('returns the interpreted operation, before/after states, differences and provenance', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      id: 'preview-request-id',
      status: 'completed',
      output_text: operationResponse,
      usage: { input_tokens: 237, output_tokens: 643, total_tokens: 880 },
    }), { status: 200, headers: { 'x-request-id': 'preview-request-id' } }));
    try {
      await withServer(fetchMock, async (port) => {
        const response = await fetch(`http://127.0.0.1:${port}/api/experiments/preview`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: ALLOWED_ORIGIN },
          body: JSON.stringify({ mechanismId: 'technical-four-bar-fixture', instruction: 'Aumenta a manivela de 40 para 80 milímetros.', mode: 'TEST_FIXTURE_ONLY' }),
        });
        const body = await response.json() as {
          status?: string;
          operation?: { componentId?: string; newValue?: number; unit?: string };
          componentsAffected?: string[];
          before?: { result?: { status?: string } };
          after?: { result?: { status?: string } };
          differences?: { lengthDeltaMm?: number; statusChanged?: boolean };
          reversible?: { originalPreserved?: boolean; reverseOperation?: { newValue?: number } };
          validity?: { after?: { state?: string } };
          provenance?: { originalParameters?: { provenance?: string }; requestedChange?: { confirmed?: boolean; source?: string } };
          meta?: { requestId?: string };
        };
        expect(response.status).toBe(200);
        expect(body.status).toBe('executed');
        expect(body.operation).toMatchObject({ componentId: 'crank', newValue: 80, unit: 'mm' });
        expect(body.componentsAffected).toEqual(['crank']);
        expect(body.before?.result?.status).toBe('solved');
        expect(body.after?.result?.status).toBe('impossible');
        expect(body.differences).toMatchObject({ lengthDeltaMm: 40, statusChanged: true });
        expect(body.reversible).toMatchObject({ originalPreserved: true, reverseOperation: { newValue: 40 } });
        expect(body.validity?.after?.state).toBe('impossible');
        expect(body.provenance).toMatchObject({ originalParameters: { provenance: 'test_fixture' }, requestedChange: { confirmed: false, source: 'natural_language_instruction' } });
        expect(body.meta?.requestId).toBe('preview-request-id');
      });
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it('rejects invalid requests before contacting Meta', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    await withServer(fetchMock, async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/experiments/preview`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ALLOWED_ORIGIN },
        body: JSON.stringify({ mechanismId: 'technical-four-bar-fixture' }),
      });
      expect(response.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it('keeps a blocked mechanism blocked before contacting Meta', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const resolver = (): PreviewMechanismResolution => ({ status: 'blocked', issues: [{ path: 'assembly', message: 'ground e comprimentos não confirmados.' }] });
    await withServer(fetchMock, async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/experiments/preview`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ALLOWED_ORIGIN },
        body: JSON.stringify({ mechanismId: 'paderborn', instruction: 'Aumenta a manivela.' }),
      });
      const body = await response.json() as { error?: { code?: string; issues?: unknown[] } };
      expect(response.status).toBe(422);
      expect(body.error?.code).toBe('MECHANISM_BLOCKED');
      expect(body.error?.issues).toHaveLength(1);
      expect(fetchMock).not.toHaveBeenCalled();
    }, { resolvePreviewMechanism: resolver });
  });

  it('rejects malformed Meta operations without running the solver', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ id: 'malformed-request-id', status: 'completed', output_text: '{"action":"delete_mechanism"}' }), { status: 200 }));
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    try {
      await withServer(fetchMock, async (port) => {
        const response = await fetch(`http://127.0.0.1:${port}/api/experiments/preview`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: ALLOWED_ORIGIN },
          body: JSON.stringify({ mechanismId: 'technical-four-bar-fixture', instruction: 'Aumenta a manivela.', mode: 'TEST_FIXTURE_ONLY' }),
        });
        const body = await response.json() as { error?: { code?: string }; meta?: { requestId?: string } };
        expect(response.status).toBe(422);
        expect(body.error?.code).toBe('MALFORMED_OPERATION');
        expect(body.meta?.requestId).toBe('malformed-request-id');
      });
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it('does not authorize the fixture outside explicit test mode', async () => {
    const fixture = createPhase3DReferenceFixture();
    expect(fixture.assembly.links.crank.length.provenance).toBe('test_fixture');
    const fetchMock = vi.fn<typeof fetch>();
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await withServer(fetchMock, async (port) => {
        const response = await fetch(`http://127.0.0.1:${port}/api/experiments/preview`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: ALLOWED_ORIGIN },
          body: JSON.stringify({ mechanismId: 'technical-four-bar-fixture', instruction: 'Aumenta a manivela.', mode: 'TEST_FIXTURE_ONLY' }),
        });
        expect(response.status).toBe(403);
        expect(fetchMock).not.toHaveBeenCalled();
      });
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });
});
