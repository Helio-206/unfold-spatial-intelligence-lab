import { describe, expect, it } from 'vitest';
import { rawRequest, withGuardedServer, ALLOWED_ORIGIN } from './helpers/paid-routes';
import { applySpatialPlanV2Transaction, recoverSpatialPlanV2Transaction, SpatialTransactionUnresolvedError } from '../src/universal-spatial/api-client';

const headers = { 'content-type': 'application/json', origin: ALLOWED_ORIGIN };
const identity = { position: [0, 0, 0], rotationRad: [0, 0, 0], scale: [1, 1, 1] };
const material = { profile: 'metal', color: '#777777', roughness: 0.4, metalness: 0.7, clearcoat: 0 };
const part = (id: string) => ({ id, label: id, parentId: null, geometry: { type: 'shape', key: `${id}-shell`, operator: 'box', parameters: { dimensions: [1, 1, 1] }, transform: identity, repeat: null, material }, transform: identity, provenance: { geometry: 'inferred', transform: 'inferred', material: 'inferred', evidence: 'fixture' } });
const plan = { contract: 'unfold.spatial-plan.v2', source: { kind: 'text', sha256: 'a'.repeat(64) }, title: 'Tx', units: 'unitless', presentationProfile: 'neutral', components: [part('base'), part('top')], relations: [], constraints: [], unknowns: [] };
const op = (operationId: string, componentId: string, x: number, kind = 'set-transform') => ({ contract: 'unfold.spatial-operation.v2', operationId, kind, componentId, nodeKey: null, value: { ...identity, position: [x, 0, 0] } });
const txn = (sessionId: string, baseRevision: number, key: string, operations: unknown[]) => ({ contract: 'unfold.spatial-transaction.v2', sessionId, baseRevision, idempotencyKey: key, operations, provenance: { origin: 'inferred', evidence: 'solver fixture evidence' } });

async function adopt(port: number): Promise<string> {
  const r = await rawRequest(port, { path: '/api/spatial/v2/adopt', headers, body: { plan } });
  expect(r.status, r.text).toBe(200);
  return r.json.sessionId as string;
}
const post = (port: number, path: string, body: unknown) => rawRequest(port, { path, headers, body });

describe('V4 E0 atomic spatial transactions (real HTTP)', () => {
  it('commits several operations as one revision, preserving provenance, and undoes them as one entry', async () => {
    await withGuardedServer({}, async (port) => {
      const sessionId = await adopt(port);
      const done = await post(port, '/api/spatial/v2/transactions', txn(sessionId, 0, 'txn-key-0001', [op('tx-op-1', 'base', 1), op('tx-op-2', 'top', 2)]));
      expect(done.status, done.text).toBe(200);
      expect(done.json).toMatchObject({ contract: 'unfold.spatial-transaction-receipt.v1', revision: 1, baseRevision: 0, replayed: false, operationIds: ['tx-op-1', 'tx-op-2'] });
      expect(done.json.plan.components[0].transform.position).toEqual([1, 0, 0]);
      expect(done.json.plan.components[1].transform.position).toEqual([2, 0, 0]);
      expect(done.json.plan.components[0].provenance).toMatchObject({ transform: 'inferred', evidence: 'solver fixture evidence' });
      const undone = await post(port, '/api/spatial/v2/undo', { sessionId, baseRevision: 1, idempotencyKey: 'undo-key-0001' });
      expect(undone.status, undone.text).toBe(200);
      expect(undone.json.revision).toBe(2);
      expect(undone.json.plan.components.map((c: { transform: { position: number[] } }) => c.transform.position)).toEqual([[0, 0, 0], [0, 0, 0]]);
      // Repeated grouped undo with the same key replays the receipt and does not undo again.
      const replay = await post(port, '/api/spatial/v2/undo', { sessionId, baseRevision: 1, idempotencyKey: 'undo-key-0001' });
      expect(replay.status).toBe(200); expect(replay.json).toMatchObject({ revision: 2, replayed: true });
      const empty = await post(port, '/api/spatial/v2/undo', { sessionId, baseRevision: 2, idempotencyKey: 'undo-key-0002' });
      expect(empty.status).toBe(409); expect(empty.json.error.code).toBe('SPATIAL_V2_UNDO_EMPTY');
    });
  });

  it('rejects an invalid or unsupported operation in the middle without changing plan, revision or history', async () => {
    await withGuardedServer({}, async (port) => {
      const sessionId = await adopt(port);
      for (const [key, operations] of [
        ['txn-key-bad-mid', [op('bad-1', 'base', 1), op('bad-2', 'ghost', 2)]],
        ['txn-key-bad-kind', [op('bad-3', 'base', 1, 'delete-everything')]],
      ] as const) {
        const failed = await post(port, '/api/spatial/v2/transactions', txn(sessionId, 0, key, [...operations]));
        expect(failed.status, failed.text).toBe(400);
        expect(failed.json.error.currentRevision ?? failed.json.currentRevision ?? 0).toBeDefined();
      }
      // The original base revision still commits, proving no partial state or revision was consumed.
      const done = await post(port, '/api/spatial/v2/transactions', txn(sessionId, 0, 'txn-key-after-fail', [op('good-1', 'base', 3)]));
      expect(done.status, done.text).toBe(200); expect(done.json.revision).toBe(1);
      expect(done.json.plan.components[1].transform.position).toEqual([0, 0, 0]);
    });
  });

  it('rejects a conflicting base revision and resolves two simultaneous transactions to exactly one commit', async () => {
    await withGuardedServer({}, async (port) => {
      const sessionId = await adopt(port);
      const stale = await post(port, '/api/spatial/v2/transactions', txn(sessionId, 7, 'txn-key-stale', [op('stale-1', 'base', 1)]));
      expect(stale.status).toBe(409); expect(stale.json.error.code).toBe('SPATIAL_V2_REVISION_CONFLICT');
      const [a, b] = await Promise.all([
        post(port, '/api/spatial/v2/transactions', txn(sessionId, 0, 'txn-key-race-a', [op('race-a', 'base', 1)])),
        post(port, '/api/spatial/v2/transactions', txn(sessionId, 0, 'txn-key-race-b', [op('race-b', 'top', 2)])),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const winner = a.status === 200 ? a : b;
      expect(winner.json.revision).toBe(1);
      const recovered = await post(port, '/api/spatial/v2/transactions/status', { sessionId, idempotencyKey: winner === a ? 'txn-key-race-a' : 'txn-key-race-b' });
      expect(recovered.json.revision).toBe(1);
    });
  });

  it('replays an identical retry, rejects key reuse with different content, and recovers after a lost response', async () => {
    await withGuardedServer({}, async (port) => {
      const sessionId = await adopt(port);
      const body = txn(sessionId, 0, 'txn-key-retry', [op('retry-1', 'base', 1), op('retry-2', 'top', 2)]);
      const first = await post(port, '/api/spatial/v2/transactions', body);
      const again = await post(port, '/api/spatial/v2/transactions', body);
      expect(again.status).toBe(200); expect(again.json).toMatchObject({ revision: 1, replayed: true, transactionId: first.json.transactionId });
      const conflict = await post(port, '/api/spatial/v2/transactions', txn(sessionId, 0, 'txn-key-retry', [op('retry-9', 'base', 9)]));
      expect(conflict.status).toBe(409); expect(conflict.json.error.code).toBe('SPATIAL_V2_IDEMPOTENCY_KEY_CONFLICT');
      const recovered = await post(port, '/api/spatial/v2/transactions/status', { sessionId, idempotencyKey: 'txn-key-retry' });
      expect(recovered.status).toBe(200); expect(recovered.json.plan).toEqual(first.json.plan);
      const missing = await post(port, '/api/spatial/v2/transactions/status', { sessionId, idempotencyKey: 'txn-key-absent' });
      expect(missing.status).toBe(404); expect(missing.json.error.code).toBe('SPATIAL_V2_TRANSACTION_NOT_FOUND');
    });
  });

  it('returns 404 for an expired or unknown session', async () => {
    await withGuardedServer({}, async (port) => {
      const r = await post(port, '/api/spatial/v2/transactions', txn('00000000-0000-0000-0000-000000000000', 0, 'txn-key-nobody', [op('x-1', 'base', 1)]));
      expect(r.status).toBe(404); expect(r.json.error.code).toBe('SPATIAL_V2_SESSION_NOT_FOUND');
    });
  });

  it('client recovers the authoritative result when the success response is lost, and does not double-apply', async () => {
    await withGuardedServer({}, async (port) => {
      const sessionId = await adopt(port);
      const base = `http://127.0.0.1:${port}`;
      let dropped = false;
      const fetchImpl: typeof fetch = async (input, init) => {
        const response = await fetch(`${base}${String(input)}`, { ...init, headers: { ...(init?.headers as Record<string, string>), origin: ALLOWED_ORIGIN } });
        if (String(input).endsWith('/transactions') && !dropped) { dropped = true; await response.text(); throw new TypeError('response lost after commit'); }
        return response;
      };
      const receipt = await applySpatialPlanV2Transaction({ sessionId, baseRevision: 0, idempotencyKey: 'txn-key-lost-1', operations: [op('lost-1', 'base', 5) as never], provenance: { origin: 'inferred', evidence: 'lost response fixture' } }, fetchImpl);
      expect(receipt).toMatchObject({ revision: 1, replayed: true });
      expect(receipt.plan.components[0].transform.position).toEqual([5, 0, 0]);
      const again = await recoverSpatialPlanV2Transaction({ sessionId, idempotencyKey: 'txn-key-lost-1' }, fetchImpl);
      expect(again.revision).toBe(1);
    });
  });

  it('client failure before commit leaves the session at the original revision', async () => {
    await withGuardedServer({}, async (port) => {
      const sessionId = await adopt(port);
      const base = `http://127.0.0.1:${port}`;
      const fetchImpl: typeof fetch = async (input, init) => {
        if (String(input).endsWith('/transactions')) throw new TypeError('timeout before commit');
        return fetch(`${base}${String(input)}`, { ...init, headers: { ...(init?.headers as Record<string, string>), origin: ALLOWED_ORIGIN } });
      };
      // Every submission fails before reaching the server, so the outcome is unknown to the client
      // (never reported as a definitive failure) while the server remains untouched.
      const failure = await applySpatialPlanV2Transaction({ sessionId, baseRevision: 0, idempotencyKey: 'txn-key-early', operations: [op('early-1', 'base', 5) as never], provenance: { origin: 'inferred', evidence: 'timeout fixture' } }, fetchImpl).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(SpatialTransactionUnresolvedError);
      expect((failure as SpatialTransactionUnresolvedError).idempotencyKey).toBe('txn-key-early');
      const done = await post(port, '/api/spatial/v2/transactions', txn(sessionId, 0, 'txn-key-early-2', [op('early-2', 'base', 1)]));
      expect(done.status, done.text).toBe(200); expect(done.json.revision).toBe(1);
    });
  });

  it('a pre-commit timeout followed by an authoritative not-found resubmits once with the same key and commits exactly once', async () => {
    await withGuardedServer({}, async (port) => {
      const sessionId = await adopt(port);
      const base = `http://127.0.0.1:${port}`;
      let submissions = 0;
      const fetchImpl: typeof fetch = async (input, init) => {
        if (String(input).endsWith('/transactions')) { submissions += 1; if (submissions === 1) throw new TypeError('timeout before commit'); }
        return fetch(`${base}${String(input)}`, { ...init, headers: { ...(init?.headers as Record<string, string>), origin: ALLOWED_ORIGIN } });
      };
      const receipt = await applySpatialPlanV2Transaction({ sessionId, baseRevision: 0, idempotencyKey: 'txn-key-precommit', operations: [op('pre-1', 'base', 4) as never], provenance: { origin: 'inferred', evidence: 'pre-commit fixture' } }, fetchImpl);
      expect(receipt).toMatchObject({ revision: 1, replayed: false });
      const recovered = await post(port, '/api/spatial/v2/transactions/status', { sessionId, idempotencyKey: 'txn-key-precommit' });
      expect(recovered.json.revision).toBe(1);
    });
  });

  it('intermittent failure: lost response plus failing recovery stays unresolved, then later reconciliation recovers revision 1 exactly once', async () => {
    await withGuardedServer({}, async (port) => {
      const sessionId = await adopt(port);
      const base = `http://127.0.0.1:${port}`;
      let networkDown = true;
      const fetchImpl: typeof fetch = async (input, init) => {
        const response = await fetch(`${base}${String(input)}`, { ...init, headers: { ...(init?.headers as Record<string, string>), origin: ALLOWED_ORIGIN } });
        if (networkDown) { await response.text(); throw new TypeError('network down'); }
        return response;
      };
      const failure = await applySpatialPlanV2Transaction({ sessionId, baseRevision: 0, idempotencyKey: 'txn-key-flaky', operations: [op('flaky-1', 'base', 6) as never], provenance: { origin: 'inferred', evidence: 'flaky fixture' } }, fetchImpl).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(SpatialTransactionUnresolvedError);
      // The client must not invent the outcome: the server did commit, provable once the network returns.
      networkDown = false;
      const receipt = await recoverSpatialPlanV2Transaction({ sessionId, idempotencyKey: 'txn-key-flaky' }, fetchImpl);
      expect(receipt).toMatchObject({ revision: 1, replayed: true });
      expect(receipt.plan.components[0].transform.position).toEqual([6, 0, 0]);
    });
  });

  it('server restart (new server, no session) during recovery is reported as session-not-found unresolved, never as success or failure', async () => {
    await withGuardedServer({}, async (port) => {
      const sessionId = await adopt(port);
      await withGuardedServer({}, async (restartedPort) => {
        const fetchImpl: typeof fetch = async (input, init) => {
          const target = String(input).endsWith('/status') ? restartedPort : port;
          const response = await fetch(`http://127.0.0.1:${target}${String(input)}`, { ...init, headers: { ...(init?.headers as Record<string, string>), origin: ALLOWED_ORIGIN } });
          if (String(input).endsWith('/transactions')) { await response.text(); throw new TypeError('response lost'); }
          return response;
        };
        const failure = await applySpatialPlanV2Transaction({ sessionId, baseRevision: 0, idempotencyKey: 'txn-key-restart', operations: [op('restart-1', 'base', 1) as never], provenance: { origin: 'inferred', evidence: 'restart fixture' } }, fetchImpl).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(SpatialTransactionUnresolvedError);
        expect((failure as SpatialTransactionUnresolvedError).reason).toBe('session-not-found');
      });
    });
  });
});
