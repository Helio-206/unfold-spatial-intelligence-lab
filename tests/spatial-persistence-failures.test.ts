import { describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { rawRequest, withGuardedServer, ALLOWED_ORIGIN, countingFetch } from './helpers/paid-routes';

const headers = { 'content-type': 'application/json', origin: ALLOWED_ORIGIN };
const identity = { position: [0, 0, 0], rotationRad: [0, 0, 0], scale: [1, 1, 1] };
const material = { profile: 'metal', color: '#777777', roughness: 0.4, metalness: 0.7, clearcoat: 0 };
const part = (id: string, x: number) => ({ id, label: id, parentId: null, geometry: { type: 'shape', key: `${id}-shell`, operator: 'box', parameters: { dimensions: [1, 1, 1] }, transform: identity, repeat: null, material }, transform: { ...identity, position: [x, 0, 0] }, provenance: { geometry: 'inferred', transform: 'inferred', material: 'inferred', evidence: 'fixture' } });
const plan = {
  contract: 'unfold.spatial-plan.v2', source: { kind: 'text', sha256: createHash('sha256').update('fonte persist', 'utf8').digest('hex') },
  title: 'Persist', units: 'unitless', presentationProfile: 'neutral',
  components: [part('base', 0), part('top', 1)], relations: [], constraints: [], unknowns: [],
};
const post = (port: number, path: string, body: unknown) => rawRequest(port, { path, headers, body });
const op = (operationId: string, componentId: string, x: number) => ({ contract: 'unfold.spatial-operation.v2', operationId, kind: 'set-transform', componentId, nodeKey: null, value: { ...identity, position: [x, 0, 0] } });
const txn = (sessionId: string, baseRevision: number, key: string, extra: object = {}) => ({ contract: 'unfold.spatial-transaction.v2', sessionId, baseRevision, idempotencyKey: key, operations: [op(`${key}-a`, 'base', 1)], provenance: { origin: 'inferred', evidence: 'solver fixture' }, ...extra });

describe('persistence failures are never acknowledged as success (E1.4 finding 1)', () => {
  it('disk failure during transaction, undo, legacy operation and session creation rolls back exactly; restart confirms it', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'unfold-persist-fail-'));
    const options = { sessionStoreFile: join(directory, 'sessions.json') };
    const lock = () => chmodSync(directory, 0o555);
    const unlock = () => chmodSync(directory, 0o755);
    try {
      let sessionId = '';
      await withGuardedServer(options, async (port) => {
        // Session creation with the disk locked: no session may be acknowledged.
        lock();
        const failedCreate = await post(port, '/api/spatial/v2/adopt', { plan });
        expect(failedCreate.status, failedCreate.text).toBe(500);
        expect(failedCreate.json.error.code).toBe('SPATIAL_SESSION_PERSISTENCE_FAILED');
        unlock();
        const adopted = await post(port, '/api/spatial/v2/adopt', { plan });
        expect(adopted.status, adopted.text).toBe(200);
        sessionId = adopted.json.sessionId;

        // Transaction with the disk locked: 500, and the base revision is untouched afterwards.
        lock();
        const failedTxn = await post(port, '/api/spatial/v2/transactions', txn(sessionId, 0, 'pf-txn-1'));
        expect(failedTxn.status, failedTxn.text).toBe(500);
        expect(failedTxn.json.error.code).toBe('SPATIAL_SESSION_PERSISTENCE_FAILED');
        unlock();
        const done = await post(port, '/api/spatial/v2/transactions', txn(sessionId, 0, 'pf-txn-1'));
        expect(done.status, done.text).toBe(200); expect(done.json).toMatchObject({ revision: 1, replayed: false });

        // Legacy operation with the disk locked: 500, no phantom revision.
        lock();
        const failedOp = await post(port, '/api/spatial/v2/operation', { sessionId, baseRevision: 1, operation: op('pf-op-1', 'base', 5) });
        expect(failedOp.status, failedOp.text).toBe(500);
        unlock();
        const appliedOp = await post(port, '/api/spatial/v2/operation', { sessionId, baseRevision: 1, operation: op('pf-op-1', 'base', 5) });
        expect(appliedOp.status, appliedOp.text).toBe(200); expect(appliedOp.json.revision).toBe(2);

        // Undo with the disk locked: 500, history intact afterwards.
        lock();
        const failedUndo = await post(port, '/api/spatial/v2/undo', { sessionId, baseRevision: 2, idempotencyKey: 'pf-undo-1' });
        expect(failedUndo.status, failedUndo.text).toBe(500);
        unlock();
        const undone = await post(port, '/api/spatial/v2/undo', { sessionId, baseRevision: 2, idempotencyKey: 'pf-undo-1' });
        expect(undone.status, undone.text).toBe(200); expect(undone.json.revision).toBe(3);
      });
      // Restart: only the acknowledged state exists (revision 3 after the undo); nothing phantom.
      await withGuardedServer(options, async (port) => {
        const status = await post(port, '/api/spatial/v2/transactions/status', { sessionId, idempotencyKey: 'pf-txn-1' });
        expect(status.status).toBe(200); expect(status.json.revision).toBe(1);
        const next = await post(port, '/api/spatial/v2/transactions', txn(sessionId, 3, 'pf-txn-2'));
        expect(next.status, next.text).toBe(200); expect(next.json.revision).toBe(4);
      });
    } finally { try { chmodSync(directory, 0o755); } catch { /* cleanup */ } rmSync(directory, { recursive: true, force: true }); }
  });

  it('idempotency fingerprint covers approval metadata: same key, different actor is a conflict, original receipt immutable (finding 4)', async () => {
    await withGuardedServer({}, async (port) => {
      const created = await post(port, '/api/spatial/v2/reviews', { plan: { ...plan, relations: [{ id: 'base-top', fromId: 'base', toId: 'top', kind: 'attached_to', origin: 'inferred', evidence: 'x' }] }, planRevision: 0 });
      expect(created.status, created.text).toBe(200);
      const review = created.json.review;
      const adopted = await post(port, '/api/spatial/v2/adopt', { plan });
      const sessionId = adopted.json.sessionId;
      const fence = { reviewId: review.reviewId, reviewRevision: 0, planFingerprint: review.planFingerprint, sourceSha256: plan.source.sha256 };
      const body = { ...txn(sessionId, 0, 'idem-actor-1', { reviewPrecondition: fence, approvalActor: 'Revisora Um' }) };
      const first = await post(port, '/api/spatial/v2/transactions', body);
      expect(first.status, first.text).toBe(200);
      expect(first.json.approval.actor.displayName).toBe('Revisora Um');
      const conflict = await post(port, '/api/spatial/v2/transactions', { ...body, approvalActor: 'Revisora Dois' });
      expect(conflict.status).toBe(409); expect(conflict.json.error.code).toBe('SPATIAL_V2_IDEMPOTENCY_KEY_CONFLICT');
      const replay = await post(port, '/api/spatial/v2/transactions', body);
      expect(replay.status).toBe(200); expect(replay.json.approval.actor.displayName).toBe('Revisora Um'); // original receipt unchanged
    });
  });

  it('a persisted session with a corrupted plan or receipt is quarantined, never half-loaded (test 14)', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'unfold-persist-corrupt-'));
    const sessionFile = join(directory, 'sessions.json');
    try {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(sessionFile, JSON.stringify({ contract: 'unfold.spatial-sessions.v2', sessions: [{ id: 'bad-1', plan: { title: 'not a plan' }, revision: 0, history: [], expires: Date.now() + 60_000, instruction: 'x', sourceKind: 'text', refinementsUsed: 0, maxRefinements: 1, policy: { mode: 'legacy' }, transactions: [['k', { fingerprint: 'zz', status: 200, body: {} }]], undoReceipts: [] }] }), 'utf8');
      await withGuardedServer({ sessionStoreFile: sessionFile }, async (port) => {
        const reply = await post(port, '/api/spatial/v2/transactions', txn('bad-1', 0, 'bad-key-1'));
        expect(reply.status).toBe(404); // quarantined as a whole, nothing fabricated
        const adopted = await post(port, '/api/spatial/v2/adopt', { plan });
        expect(adopted.status).toBe(200); // server healthy
      });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('disk failure during plan-created sessions is not acknowledged either', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'unfold-persist-plan-'));
    try {
      chmodSync(directory, 0o555);
      await withGuardedServer({ sessionStoreFile: join(directory, 'sessions.json'), fetchImpl: countingFetch() }, async (port) => {
        const created = await post(port, '/api/spatial/v2/plan', { sourceKind: 'text', instruction: 'Build a small fan.' });
        expect(created.status, created.text).toBe(500);
        expect(created.json.error.code).toBe('SPATIAL_SESSION_PERSISTENCE_FAILED');
      });
    } finally { try { chmodSync(directory, 0o755); } catch { /* cleanup */ } rmSync(directory, { recursive: true, force: true }); }
  });
});
