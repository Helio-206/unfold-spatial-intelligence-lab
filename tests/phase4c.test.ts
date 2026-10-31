import { describe, expect, it } from 'vitest';
import { createPhase4CMockServer } from '../server/phase4c-mock';
import { createPhase4AExperimentRequest } from '../src/phase4a-experiment';
import { PHASE4A_LENGTHS } from '../src/phase4a-kinematics';

async function withMock(callback: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = createPhase4CMockServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Porta de teste indisponível.');
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function post(baseUrl: string, lengths: typeof PHASE4A_LENGTHS, instruction: string): Promise<{ response: Response; body: any }> {
  const response = await fetch(`${baseUrl}/api/experiments/preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(createPhase4AExperimentRequest(instruction, lengths, 0, 'plus')),
  });
  return { response, body: await response.json() };
}

describe('PHASE 4C isolated browser backend contract', () => {
  it('exposes a phase4c health contract without requiring Meta credentials', async () => {
    await withMock(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/health`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ status: 'ok', contract: 'unfold.phase4c' });
    });
  });

  it('simulates 40 to 50 and returns a solved accepted state', async () => {
    await withMock(async (baseUrl) => {
      const { response, body } = await post(baseUrl, PHASE4A_LENGTHS, 'Aumenta a manivela para 50 mm.');
      expect(response.status).toBe(200);
      expect(body.operation).toMatchObject({ componentId: 'crank', newValue: 50, unit: 'mm' });
      expect(body.before.result.lengths.crank).toBe(40);
      expect(body.after.result.lengths.crank).toBe(50);
      expect(body.after.result.status).toBe('solved');
      expect(body.after.result.coordinates).toBeDefined();
      expect(body.meta.requestId).toMatch(/^phase4c-mock-/);
    });
  });

  it('simulates 50 to 80 using the current request, returning angular impossibility without coordinates', async () => {
    await withMock(async (baseUrl) => {
      const current = { ...PHASE4A_LENGTHS, crank: 50 };
      const { response, body } = await post(baseUrl, current, 'Aumenta a manivela para 80 mm.');
      expect(response.status).toBe(200);
      expect(body.before.result.lengths.crank).toBe(50);
      expect(body.after.result.lengths.crank).toBe(80);
      expect(body.after.result.status).toBe('impossible');
      expect(body.after.result.coordinates).toBeUndefined();
      expect(body.solverStatus.scope).toBe('requested_input_angle_configuration');
    });
  });

  it('does not fabricate an operation for an invalid instruction', async () => {
    await withMock(async (baseUrl) => {
      const { response, body } = await post(baseUrl, PHASE4A_LENGTHS, 'Explica a montagem sem alterar parâmetros.');
      expect(response.status).toBe(422);
      expect(body.error.code).toBe('MALFORMED_OPERATION');
    });
  });

  it('keeps the endpoint contract independent of a previous mechanism state', async () => {
    await withMock(async (baseUrl) => {
      const first = await post(baseUrl, PHASE4A_LENGTHS, 'Aumenta a manivela para 50 mm.');
      expect(first.body.before.result.lengths.crank).toBe(40);
      const second = await post(baseUrl, { ...PHASE4A_LENGTHS, crank: 50 }, 'Aumenta a manivela para 80 mm.');
      expect(second.body.before.result.lengths.crank).toBe(50);
      expect(second.body.after.result.lengths.crank).toBe(80);
    });
  });
});
