import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { rawRequest, withGuardedServer, ALLOWED_ORIGIN } from './helpers/paid-routes';

const headers = { 'content-type': 'application/json', origin: ALLOWED_ORIGIN };
const identity = { position: [0, 0, 0], rotationRad: [0, 0, 0], scale: [1, 1, 1] };
const material = { profile: 'metal', color: '#777777', roughness: 0.4, metalness: 0.7, clearcoat: 0 };
const part = (id: string, x: number) => ({ id, label: id, parentId: null, geometry: { type: 'shape', key: `${id}-shell`, operator: 'box', parameters: { dimensions: [1, 1, 1] }, transform: identity, repeat: null, material }, transform: { ...identity, position: [x, 0, 0] }, provenance: { geometry: 'inferred', transform: 'inferred', material: 'inferred', evidence: 'fixture' } });
const plan = {
  contract: 'unfold.spatial-plan.v2', source: { kind: 'text', sha256: createHash('sha256').update('fonte durable', 'utf8').digest('hex') },
  title: 'Durable', units: 'unitless', presentationProfile: 'neutral',
  components: [part('base', 0), part('top', 0.9), part('side', 5)],
  relations: [
    { id: 'base-top', fromId: 'base', toId: 'top', kind: 'attached_to', origin: 'inferred', evidence: 'declared' },
    { id: 'base-side', fromId: 'base', toId: 'side', kind: 'attached_to', origin: 'inferred', evidence: 'declared' },
  ],
  constraints: [], unknowns: [],
};
const post = (port: number, path: string, body: unknown) => rawRequest(port, { path, headers, body });
const op = (operationId: string, componentId: string, x: number) => ({ contract: 'unfold.spatial-operation.v2', operationId, kind: 'set-transform', componentId, nodeKey: null, value: { ...identity, position: [x, 0, 0] } });
const txn = (sessionId: string, baseRevision: number, key: string, extra: object = {}) => ({ contract: 'unfold.spatial-transaction.v2', sessionId, baseRevision, idempotencyKey: key, operations: [op(`${key}-a`, 'base', 1)], provenance: { origin: 'inferred', evidence: 'solver fixture' }, ...extra });

async function fencedSession(port: number) {
  const created = await post(port, '/api/spatial/v2/reviews', { plan, planRevision: 0 });
  expect(created.status, created.text).toBe(200);
  const review = created.json.review;
  const decided = await post(port, '/api/spatial/v2/reviews/decide', { reviewId: review.reviewId, baseReviewRevision: 0, subjectId: 'rel-base-side', decision: 'confirm', reviewerName: 'Revisora Durable' });
  expect(decided.status, decided.text).toBe(200);
  const adopted = await post(port, '/api/spatial/v2/adopt', { plan, mutationPolicy: 'review_fenced', reviewId: review.reviewId });
  expect(adopted.status, adopted.text).toBe(200);
  return { review, sessionId: adopted.json.sessionId as string, adopted: adopted.json };
}

describe('session mutation policy (E1.3 milestone B)', () => {
  it('a review_fenced session rejects unfenced transactions and every legacy mutation route; legacy sessions are untouched', async () => {
    await withGuardedServer({}, async (port) => {
      const { review, sessionId, adopted } = await fencedSession(port);
      expect(adopted.mutationPolicy).toEqual({ mode: 'review_fenced', reviewId: review.reviewId });
      expect(adopted.sessionDurability).toBe('volatile'); // no store file in this server: declared, not implied
      const unfenced = await post(port, '/api/spatial/v2/transactions', txn(sessionId, 0, 'pol-key-01'));
      expect(unfenced.status).toBe(403); expect(unfenced.json.error.code).toBe('SPATIAL_REVIEW_POLICY_REQUIRES_FENCE');
      const legacyOp = await post(port, '/api/spatial/v2/operation', { sessionId, baseRevision: 0, operation: op('pol-op-1', 'base', 1) });
      expect(legacyOp.status).toBe(403); expect(legacyOp.json.error.code).toBe('SPATIAL_REVIEW_POLICY_REQUIRES_FENCE');
      const fence = { reviewId: review.reviewId, reviewRevision: 1, planFingerprint: review.planFingerprint, sourceSha256: plan.source.sha256 };
      const wrongReview = await post(port, '/api/spatial/v2/transactions', txn(sessionId, 0, 'pol-key-02', { reviewPrecondition: { ...fence, reviewId: 'other-review' } }));
      expect(wrongReview.status).toBe(409);
      const done = await post(port, '/api/spatial/v2/transactions', txn(sessionId, 0, 'pol-key-03', { reviewPrecondition: fence, approvalActor: 'Revisora Durable' }));
      expect(done.status, done.text).toBe(200);
      // Structured approval: separate from provenance, client-asserted, never authenticated.
      expect(done.json.approval).toMatchObject({ contract: 'unfold.spatial-approval.v1', reviewId: review.reviewId, reviewRevision: 1, commitRevision: 1, actor: { displayName: 'Revisora Durable', authenticated: false, attribution: 'client_asserted_unverified' } });
      expect(done.json.plan.components[0].provenance.transform).toBe('inferred');
      // Grouped undo remains possible in a fenced session (it reverses, it does not introduce a new reviewed mutation).
      const undone = await post(port, '/api/spatial/v2/undo', { sessionId, baseRevision: 1, idempotencyKey: 'pol-undo-01' });
      expect(undone.status).toBe(200);
      // Legacy session: everything behaves as before.
      const legacy = await post(port, '/api/spatial/v2/adopt', { plan });
      expect(legacy.json.mutationPolicy).toEqual({ mode: 'legacy' });
      const legacyTxn = await post(port, '/api/spatial/v2/transactions', txn(legacy.json.sessionId, 0, 'pol-key-04'));
      expect(legacyTxn.status).toBe(200);
      // Binding a fenced session to a foreign review is rejected at adoption.
      const badBind = await post(port, '/api/spatial/v2/adopt', { plan, mutationPolicy: 'review_fenced', reviewId: 'no-such-review' });
      expect(badBind.status).toBe(400); expect(badBind.json.error.code).toBe('SPATIAL_SESSION_POLICY_BINDING_INVALID');
    });
  });
});

describe('durable spatial sessions (E1.3 milestone E)', () => {
  it('a committed fenced transaction, its idempotency, grouped undo and the policy survive a server restart; corruption is quarantined', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'unfold-sessions-'));
    const sessionFile = join(directory, 'sessions.json'), reviewFile = join(directory, 'reviews.json');
    const options = { sessionStoreFile: sessionFile, reviewStoreFile: reviewFile };
    try {
      let sessionId = '', review: { reviewId: string; planFingerprint: string } = { reviewId: '', planFingerprint: '' };
      await withGuardedServer(options, async (port) => {
        const setup = await fencedSession(port);
        sessionId = setup.sessionId; review = setup.review;
        const durable = await post(port, '/api/spatial/v2/adopt', { plan });
        expect(durable.json.sessionDurability).toBe('file');
        const fence = { reviewId: review.reviewId, reviewRevision: 1, planFingerprint: review.planFingerprint, sourceSha256: plan.source.sha256 };
        const done = await post(port, '/api/spatial/v2/transactions', txn(sessionId, 0, 'dur-key-01', { reviewPrecondition: fence, approvalActor: 'Revisora Durable' }));
        expect(done.status, done.text).toBe(200); expect(done.json.revision).toBe(1);
      });
      expect(existsSync(sessionFile)).toBe(true);
      await withGuardedServer(options, async (port) => {
        // Same idempotency key after restart: replay, no reapply.
        const fence = { reviewId: review.reviewId, reviewRevision: 1, planFingerprint: review.planFingerprint, sourceSha256: plan.source.sha256 };
        const replay = await post(port, '/api/spatial/v2/transactions', txn(sessionId, 0, 'dur-key-01', { reviewPrecondition: fence, approvalActor: 'Revisora Durable' }));
        expect(replay.status, replay.text).toBe(200); expect(replay.json).toMatchObject({ revision: 1, replayed: true });
        expect(replay.json.approval).toMatchObject({ commitRevision: 1 });
        // Policy survived: unfenced still rejected.
        expect((await post(port, '/api/spatial/v2/transactions', txn(sessionId, 1, 'dur-key-02'))).status).toBe(403);
        // Grouped undo still works from the persisted history.
        const undone = await post(port, '/api/spatial/v2/undo', { sessionId, baseRevision: 1, idempotencyKey: 'dur-undo-01' });
        expect(undone.status, undone.text).toBe(200); expect(undone.json.revision).toBe(2);
        expect(undone.json.plan.components[0].transform.position).toEqual([0, 0, 0]);
      });
      // Corrupted state: quarantined, server healthy, no fabricated session.
      writeFileSync(sessionFile, '{broken', 'utf8');
      await withGuardedServer(options, async (port) => {
        const gone = await post(port, '/api/spatial/v2/transactions', txn(sessionId, 2, 'dur-key-03'));
        expect(gone.status).toBe(404);
        expect(readdirSync(directory).some((name) => name.includes('corrupt'))).toBe(true);
      });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('expired persisted sessions are not resurrected', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'unfold-sessions-'));
    const sessionFile = join(directory, 'sessions.json');
    try {
      writeFileSync(sessionFile, JSON.stringify({ contract: 'unfold.spatial-sessions.v2', sessions: [{ id: 'expired-1', plan, revision: 3, history: [], expires: Date.now() - 1000, instruction: 'x', sourceKind: 'text', refinementsUsed: 0, maxRefinements: 1, policy: { mode: 'legacy' }, transactions: [], undoReceipts: [] }] }), 'utf8');
      await withGuardedServer({ sessionStoreFile: sessionFile }, async (port) => {
        const reply = await post(port, '/api/spatial/v2/transactions', txn('expired-1', 3, 'exp-key-01'));
        expect(reply.status).toBe(404);
      });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
