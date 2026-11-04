import { describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { rawRequest, withGuardedServer, ALLOWED_ORIGIN } from './helpers/paid-routes';

const headers = { 'content-type': 'application/json', origin: ALLOWED_ORIGIN };
const identity = { position: [0, 0, 0], rotationRad: [0, 0, 0], scale: [1, 1, 1] };
const material = { profile: 'metal', color: '#777777', roughness: 0.4, metalness: 0.7, clearcoat: 0 };
const part = (id: string, x: number) => ({ id, label: id, parentId: null, geometry: { type: 'shape', key: `${id}-shell`, operator: 'box', parameters: { dimensions: [1, 1, 1] }, transform: identity, repeat: null, material }, transform: { ...identity, position: [x, 0, 0] }, provenance: { geometry: 'inferred', transform: 'inferred', material: 'inferred', evidence: 'fixture' } });
const plan = {
  contract: 'unfold.spatial-plan.v2', source: { kind: 'text', sha256: createHash('sha256').update('fonte transition', 'utf8').digest('hex') },
  title: 'Transition', units: 'unitless', presentationProfile: 'neutral',
  components: [part('base', 0), part('top', 0.9), part('side', 5)],
  relations: [
    { id: 'base-top', fromId: 'base', toId: 'top', kind: 'attached_to', origin: 'inferred', evidence: 'declared' },
    { id: 'base-side', fromId: 'base', toId: 'side', kind: 'attached_to', origin: 'inferred', evidence: 'declared' },
  ],
  constraints: [], unknowns: [],
};
const post = (port: number, path: string, body: unknown) => rawRequest(port, { path, headers, body });
const op = (operationId: string, componentId: string, x: number) => ({ contract: 'unfold.spatial-operation.v2', operationId, kind: 'set-transform', componentId, nodeKey: null, value: { ...identity, position: [x, 0, 0] } });
const txn = (sessionId: string, baseRevision: number, key: string, fence: object) => ({ contract: 'unfold.spatial-transaction.v2', sessionId, baseRevision, idempotencyKey: key, operations: [op(`${key}-a`, 'base', baseRevision + 1), op(`${key}-b`, 'top', baseRevision + 2)], provenance: { origin: 'inferred', evidence: 'solver fixture' }, reviewPrecondition: fence, approvalActor: 'Revisora Transition' });
const fenceOf = (review: { reviewId: string; reviewRevision: number; planFingerprint: string }) => ({ reviewId: review.reviewId, reviewRevision: review.reviewRevision, planFingerprint: review.planFingerprint, sourceSha256: plan.source.sha256 });
const transition = (port: number, sessionId: string, baseRevision: number, reviewId: string) => post(port, '/api/spatial/v2/sessions/review-binding', { sessionId, baseRevision, reviewId });

async function reviewFor(port: number, currentPlan: unknown, planRevision: number) {
  const created = await post(port, '/api/spatial/v2/reviews', { plan: currentPlan, planRevision });
  expect(created.status, created.text).toBe(200);
  const review = created.json.review;
  const decided = await post(port, '/api/spatial/v2/reviews/decide', { reviewId: review.reviewId, baseReviewRevision: 0, subjectId: 'rel-base-side', decision: 'confirm', reviewerName: 'Revisora Transition' });
  expect(decided.status, decided.text).toBe(200);
  return decided.json.review;
}

describe('review binding transition for fenced sessions (E1.4 patch)', () => {
  it('review A -> commit -> changed plan -> review B -> second valid commit, with undo and restart intact', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'unfold-binding-'));
    const options = { sessionStoreFile: join(directory, 'sessions.json'), reviewStoreFile: join(directory, 'reviews.json') };
    try {
      let sessionId = '', reviewB: { reviewId: string; reviewRevision: number; planFingerprint: string } = { reviewId: '', reviewRevision: 0, planFingerprint: '' };
      await withGuardedServer(options, async (port) => {
        const adopted = await post(port, '/api/spatial/v2/adopt', { plan });
        sessionId = adopted.json.sessionId;
        const reviewA = await reviewFor(port, plan, 0);
        const bound = await transition(port, sessionId, 0, reviewA.reviewId);
        expect(bound.status, bound.text).toBe(200);
        expect(bound.json).toMatchObject({ revision: 0, mutationPolicy: { mode: 'review_fenced', reviewId: reviewA.reviewId } });
        const first = await post(port, '/api/spatial/v2/transactions', txn(sessionId, 0, 'bind-txn-01', fenceOf(reviewA)));
        expect(first.status, first.text).toBe(200); expect(first.json.revision).toBe(1);

        // The plan changed: review A no longer binds. Review B is created for the exact new plan.
        reviewB = await reviewFor(port, first.json.plan, 1);
        // Without a transition, the legitimate fence B is rejected by the stale session binding.
        const rejected = await post(port, '/api/spatial/v2/transactions', txn(sessionId, 1, 'bind-txn-02', fenceOf(reviewB)));
        expect(rejected.status).toBe(409);

        const moved = await transition(port, sessionId, 1, reviewB.reviewId);
        expect(moved.status, moved.text).toBe(200);
        expect(moved.json).toMatchObject({ revision: 1, mutationPolicy: { mode: 'review_fenced', reviewId: reviewB.reviewId } }); // revision and history preserved

        const second = await post(port, '/api/spatial/v2/transactions', txn(sessionId, 1, 'bind-txn-03', fenceOf(reviewB)));
        expect(second.status, second.text).toBe(200); expect(second.json.revision).toBe(2);
        // Both undo steps still work, in order.
        expect((await post(port, '/api/spatial/v2/undo', { sessionId, baseRevision: 2, idempotencyKey: 'bind-undo-01' })).json.revision).toBe(3);
        const back = await post(port, '/api/spatial/v2/undo', { sessionId, baseRevision: 3, idempotencyKey: 'bind-undo-02' });
        expect(back.status).toBe(200);
        expect(back.json.plan.components[0].transform.position).toEqual([0, 0, 0]);
        // Review A's history is untouched.
        const a = await post(port, '/api/spatial/v2/reviews/get', { reviewId: reviewA.reviewId });
        expect(a.json.review.decisions).toHaveLength(1);
      });
      // Restart: the binding to review B and the session revision survive.
      await withGuardedServer(options, async (port) => {
        const unfenced = await post(port, '/api/spatial/v2/transactions', { contract: 'unfold.spatial-transaction.v2', sessionId, baseRevision: 4, idempotencyKey: 'bind-txn-04', operations: [op('bind-x', 'base', 9)], provenance: { origin: 'inferred', evidence: 'probe' } });
        expect(unfenced.status).toBe(403);
        const bound = await post(port, '/api/spatial/v2/transactions/status', { sessionId, idempotencyKey: 'bind-txn-03' });
        expect(bound.status).toBe(200); expect(bound.json.revision).toBe(2); // durable receipt
      });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('rejects stale revisions and incompatible reviews, preserves revision/history on a legacy transition, and rolls back on persistence failure', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'unfold-binding-fail-'));
    const options = { sessionStoreFile: join(directory, 'sessions.json'), reviewStoreFile: join(directory, 'reviews.json') };
    try {
      await withGuardedServer(options, async (port) => {
        const adopted = await post(port, '/api/spatial/v2/adopt', { plan });
        const sessionId = adopted.json.sessionId;
        // A legacy mutation first: transition must preserve revision 1 and its undo history.
        const legacy = await post(port, '/api/spatial/v2/transactions', { contract: 'unfold.spatial-transaction.v2', sessionId, baseRevision: 0, idempotencyKey: 'bind-legacy-1', operations: [op('bind-l1', 'base', 1)], provenance: { origin: 'user_provided', evidence: 'person' } });
        expect(legacy.status).toBe(200);
        const review = await reviewFor(port, legacy.json.plan, 1);
        const stale = await transition(port, sessionId, 0, review.reviewId);
        expect(stale.status).toBe(409); expect(stale.json.error.code).toBe('SPATIAL_V2_REVISION_CONFLICT');
        const foreign = await reviewFor(port, plan, 0); // bound to the pre-legacy plan, not the current one
        const incompatible = await transition(port, sessionId, 1, foreign.reviewId);
        expect(incompatible.status).toBe(409); expect(incompatible.json.error.code).toBe('SPATIAL_SESSION_POLICY_BINDING_INVALID');
        // Persistence failure: transition rolls back, session stays legacy at revision 1.
        chmodSync(directory, 0o555);
        const failed = await transition(port, sessionId, 1, review.reviewId);
        expect(failed.status, failed.text).toBe(500); expect(failed.json.error.code).toBe('SPATIAL_SESSION_PERSISTENCE_FAILED');
        chmodSync(directory, 0o755);
        const moved = await transition(port, sessionId, 1, review.reviewId);
        expect(moved.status, moved.text).toBe(200); expect(moved.json.revision).toBe(1);
        // History preserved: the pre-transition legacy edit can still be undone.
        const undone = await post(port, '/api/spatial/v2/undo', { sessionId, baseRevision: 1, idempotencyKey: 'bind-undo-09' });
        expect(undone.status, undone.text).toBe(200);
        expect(undone.json.plan.components[0].transform.position).toEqual([0, 0, 0]);
      });
    } finally { try { chmodSync(directory, 0o755); } catch { /* cleanup */ } rmSync(directory, { recursive: true, force: true }); }
  });
});
