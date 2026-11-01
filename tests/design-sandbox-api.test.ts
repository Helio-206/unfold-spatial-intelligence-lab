import { describe, expect, it, vi } from 'vitest';
import { createMetaServer } from '../server/meta-server';
import { ALLOWED_ORIGIN } from './helpers/paid-routes';

const operationResponse = JSON.stringify({
  schema: 'kinematic_operation.v1',
  action: 'update_length',
  componentId: 'crank',
  newValue: 80,
  unit: 'mm',
});

function sandboxBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mode: 'DESIGN_SANDBOX',
    mechanismId: 'user-design-001',
    instruction: 'Aumenta a manivela para 80 mm.',
    design: {
      lengths: {
        ground: { value: 100, unit: 'mm' },
        crank: { value: 40, unit: 'mm' },
        coupler: { value: 120, unit: 'mm' },
        rocker: { value: 90, unit: 'mm' },
      },
      fixedBar: 'ground',
      topology: {
        joints: [
          { id: 'j1', type: 'revolute', connects: ['ground', 'crank'] },
          { id: 'j2', type: 'revolute', connects: ['crank', 'coupler'] },
          { id: 'j3', type: 'revolute', connects: ['coupler', 'rocker'] },
          { id: 'j4', type: 'revolute', connects: ['rocker', 'ground'] },
        ],
      },
      inputAngle: { value: 0, unit: 'rad' },
      branch: 'plus',
    },
    ...overrides,
  };
}

async function withServer(fetchImpl: typeof fetch, callback: (port: number) => Promise<void>): Promise<void> {
  const server = createMetaServer({ apiKey: 'test-key-not-real', fetchImpl });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Porta de teste indisponível.');
  try {
    await callback(address.port);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

describe('DESIGN_SANDBOX HTTP', () => {
  it('executa fora de NODE_ENV=test e mantém a classificação hipotética', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      id: 'sandbox-request-id',
      status: 'completed',
      output_text: operationResponse,
      usage: { input_tokens: 140, output_tokens: 100, total_tokens: 240 },
    }), { status: 200, headers: { 'x-request-id': 'sandbox-request-id' } }));
    try {
      await withServer(fetchMock, async (port) => {
        const response = await fetch(`http://127.0.0.1:${port}/api/experiments/preview`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: ALLOWED_ORIGIN },
          body: JSON.stringify(sandboxBody({ review: { status: 'verified' } })),
        });
        const body = await response.json() as {
          status?: string;
          mode?: string;
          classification?: string;
          evidenceStatus?: string;
          inputValidity?: string;
          solverStatus?: { before?: string; after?: string };
          provenance?: { originalParameters?: { crank?: { source?: string; physicallyVerified?: boolean } }; requestedChange?: { confirmed?: boolean } };
          review?: unknown;
          meta?: { requestId?: string };
        };
        expect(response.status).toBe(200);
        expect(body).toMatchObject({
          status: 'executed',
          mode: 'DESIGN_SANDBOX',
          classification: 'mathematical_simulation_hypothetical_project',
          evidenceStatus: 'hypothetical_user_design',
          inputValidity: 'valid',
          solverStatus: { before: 'solved', after: 'impossible' },
          provenance: { originalParameters: { crank: { source: 'user_provided', physicallyVerified: false } }, requestedChange: { confirmed: false } },
          meta: { requestId: 'sandbox-request-id' },
        });
        expect(body.review).toBeUndefined();
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it('rejeita sandbox inválido sem chamar a Meta', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    await withServer(fetchMock, async (port) => {
      const body = sandboxBody({ design: { fixedBar: 'crank' } });
      const response = await fetch(`http://127.0.0.1:${port}/api/experiments/preview`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ALLOWED_ORIGIN },
        body: JSON.stringify(body),
      });
      const result = await response.json() as { error?: { code?: string; issues?: unknown[] } };
      expect(response.status).toBe(400);
      expect(result.error?.code).toBe('INVALID_DESIGN_SANDBOX');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it('não aceita resposta Meta malformada no sandbox', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      id: 'sandbox-malformed-id',
      status: 'completed',
      output_text: '{"action":"delete_mechanism"}',
    }), { status: 200 }));
    await withServer(fetchMock, async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/experiments/preview`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ALLOWED_ORIGIN },
        body: JSON.stringify(sandboxBody()),
      });
      const body = await response.json() as { error?: { code?: string }; meta?: { requestId?: string } };
      expect(response.status).toBe(422);
      expect(body.error?.code).toBe('MALFORMED_OPERATION');
      expect(body.meta?.requestId).toBe('sandbox-malformed-id');
    });
  });
});
