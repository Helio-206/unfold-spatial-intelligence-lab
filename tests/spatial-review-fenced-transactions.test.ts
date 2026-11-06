import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { rawRequest, withGuardedServer, ALLOWED_ORIGIN } from './helpers/paid-routes';
import { applySpatialPlanV2Transaction } from '../src/universal-spatial/api-client';

const headers = { 'content-type': 'application/json', origin: ALLOWED_ORIGIN };
const identity = { position: [0, 0, 0], rotationRad: [0, 0, 0], scale: [1, 1, 1] };
const material = { profile: 'metal', color: '#777777', roughness: 0.4, metalness: 0.7, clearcoat: 0 };
const part = (id: string, x: number) => ({ id, label: id, parentId: null, geometry: { type: 'shape', key: `${id}-shell`, operator: 'box', parameters: { dimensions: [1, 1, 1] }, transform: identity, repeat: null, material }, transform: { ...identity, position: [x, 0, 0] }, provenance: { geometry: 'inferred', transform: 'inferred', material: 'inferred', evidence: 'fixture' } });
const plan = {
  contract: 'unfold.spatial-plan.v2', source: { kind: 'text', sha256: createHash('sha256').update('fonte fenced', 'utf8').digest('hex') },
  title: 'Fenced', units: 'unitless', presentationProfile: 'neutral',
  components: [part('base', 0), part('top', 0.9), part('side', 5)],
  relations: [
    { id: 'base-top', fromId: 'base', toId: 'top', kind: 'attached_to', origin: 'inferred', evidence: 'declared' },
    { id: 'base-side', fromId: 'base', toId: 'side', kind: 'attached_to', origin: 'inferred', evidence: 'declared' },
  ],
  constraints: [], unknowns: [],
};
const post = (port: number, path: string, body: unknown) => rawRequest(port, { path, headers, body });
const op = (operationId: string, componentId: string, x: number) => ({ contract: 'unfold.spatial-operation.v2', operationId, kind: 'set-transform', componentId, nodeKey: null, value: { ...identity, position: [x, 0, 0] } });

async function setup(port: number) {
  const adopted = await post(port, '/api/spatial/v2/adopt', { plan });
  expect(adopted.status, adopted.text).toBe(200);
  const created = await post(port, '/api/spatial/v2/reviews', { plan, planRevision: 0 });
  expect(created.status, created.text).toBe(200);
  return { sessionId: adopted.json.sessionId as string, review: created.json.review, gate: created.json.gate };
}
const decide = (port: number, reviewId: string, rev: number, subjectId: string, decision: string) =>
  post(port, '/api/spatial/v2/reviews/decide', { reviewId, baseReviewRevision: rev, subjectId, decision, reviewerName: 'Revisora Fenced' });
const fencedTxn = (sessionId: string, key: string, precondition: object) => ({
  contract: 'unfold.spatial-transaction.v2', sessionId, baseRevision: 0, idempotencyKey: key,
  operations: [op(`${key}-a`, 'base', 1), op(`${key}-b`, 'top', 2)],
  provenance: { origin: 'inferred', evidence: 'Solver evidence: fitted placement (inferred).' },
  reviewPrecondition: precondition,
});

describe('review-fenced atomic transactions (E1.2, real HTTP)', () => {
  it('commits only against the exact reviewed state, keeps inferred provenance, and undoes as one group', async () => {
    await withGuardedServer({}, async (port) => {
      const { sessionId, review } = await setup(port);
      // The contradicted relation blocks the gate until a person decides; confirm it (revision 1).
      const decided = await decide(port, review.reviewId, 0, 'rel-base-side', 'confirm');
      expect(decided.status, decided.text).toBe(200);
      const precondition = { reviewId: review.reviewId, reviewRevision: 1, planFingerprint: review.planFingerprint, sourceSha256: plan.source.sha256 };
      const done = await post(port, '/api/spatial/v2/transactions', fencedTxn(sessionId, 'fenced-key-01', precondition));
      expect(done.status, done.text).toBe(200);
      expect(done.json).toMatchObject({ revision: 1, reviewPrecondition: precondition });
      // Authorisation is recorded separately; the geometry stays inferred, never promoted.
      expect(done.json.plan.components[0].provenance.transform).toBe('inferred');
      const undone = await post(port, '/api/spatial/v2/undo', { sessionId, baseRevision: 1, idempotencyKey: 'fenced-undo-01' });
      expect(undone.status).toBe(200); expect(undone.json.revision).toBe(2);
      expect(undone.json.plan.components[0].transform.position).toEqual([0, 0, 0]);
    });
  });

  it('rejects a stale review precondition before any mutation, and an idempotent replay stays valid after the review moves on', async () => {
    await withGuardedServer({}, async (port) => {
      const { sessionId, review } = await setup(port);
      await decide(port, review.reviewId, 0, 'rel-base-side', 'confirm');
      const stale = { reviewId: review.reviewId, reviewRevision: 0, planFingerprint: review.planFingerprint, sourceSha256: plan.source.sha256 };
      const rejected = await post(port, '/api/spatial/v2/transactions', fencedTxn(sessionId, 'fenced-key-02', stale));
      expect(rejected.status).toBe(409); expect(rejected.json.error.code).toBe('SPATIAL_REVIEW_PRECONDITION_STALE');
      // Nothing mutated: a valid transaction at the same base revision still commits.
      const current = { ...stale, reviewRevision: 1 };
      const body = fencedTxn(sessionId, 'fenced-key-03', current);
      const done = await post(port, '/api/spatial/v2/transactions', body);
      expect(done.status, done.text).toBe(200); expect(done.json.revision).toBe(1);
      // A new decision makes the precondition stale for new work, but the replay must not re-mutate.
      await decide(port, review.reviewId, 1, 'rel-base-top', 'defer');
      const replay = await post(port, '/api/spatial/v2/transactions', body);
      expect(replay.status).toBe(200); expect(replay.json).toMatchObject({ revision: 1, replayed: true });
      const fresh = await post(port, '/api/spatial/v2/transactions', { ...fencedTxn(sessionId, 'fenced-key-04', current), baseRevision: 1 });
      expect(fresh.status).toBe(409); expect(fresh.json.error.code).toBe('SPATIAL_REVIEW_PRECONDITION_STALE');
    });
  });

  it('rejects foreign reviews and client-supplied fingerprint mismatches; plain E0 transactions remain compatible', async () => {
    await withGuardedServer({}, async (port) => {
      const { sessionId, review } = await setup(port);
      await decide(port, review.reviewId, 0, 'rel-base-side', 'confirm');
      const otherPlan = { ...plan, components: plan.components.map((c, i) => (i === 2 ? { ...c, transform: { ...c.transform, position: [9, 0, 0] } } : c)) };
      const other = await post(port, '/api/spatial/v2/reviews', { plan: otherPlan, planRevision: 0 });
      const foreign = { reviewId: other.json.review.reviewId, reviewRevision: 0, planFingerprint: review.planFingerprint, sourceSha256: plan.source.sha256 };
      const foreignReply = await post(port, '/api/spatial/v2/transactions', fencedTxn(sessionId, 'fenced-key-05', foreign));
      expect(foreignReply.status).toBe(409); expect(foreignReply.json.error.code).toBe('SPATIAL_REVIEW_PRECONDITION_STALE');
      const bogus = { reviewId: review.reviewId, reviewRevision: 1, planFingerprint: 'a'.repeat(64), sourceSha256: plan.source.sha256 };
      const bogusReply = await post(port, '/api/spatial/v2/transactions', fencedTxn(sessionId, 'fenced-key-06', bogus));
      expect(bogusReply.status).toBe(409);
      const missing = { reviewId: 'no-such-review', reviewRevision: 0, planFingerprint: review.planFingerprint, sourceSha256: plan.source.sha256 };
      expect((await post(port, '/api/spatial/v2/transactions', fencedTxn(sessionId, 'fenced-key-07', missing))).status).toBe(409);
      // E0 compatibility: no review precondition at all still commits.
      const plain = { contract: 'unfold.spatial-transaction.v2', sessionId, baseRevision: 0, idempotencyKey: 'fenced-key-08', operations: [op('plain-1', 'base', 3)], provenance: { origin: 'user_provided', evidence: 'person edit' } };
      const plainReply = await post(port, '/api/spatial/v2/transactions', plain);
      expect(plainReply.status, plainReply.text).toBe(200); expect(plainReply.json.revision).toBe(1);
    });
  });

  it('a rejected relation cannot be re-fenced at the pre-rejection revision without a new decision', async () => {
    await withGuardedServer({}, async (port) => {
      const { sessionId, review } = await setup(port);
      await decide(port, review.reviewId, 0, 'rel-base-side', 'confirm');
      await decide(port, review.reviewId, 1, 'rel-base-top', 'reject'); // revision 2: rejection recorded
      const oldPrecondition = { reviewId: review.reviewId, reviewRevision: 1, planFingerprint: review.planFingerprint, sourceSha256: plan.source.sha256 };
      const reply = await post(port, '/api/spatial/v2/transactions', fencedTxn(sessionId, 'fenced-key-09', oldPrecondition));
      expect(reply.status).toBe(409); expect(reply.json.error.code).toBe('SPATIAL_REVIEW_PRECONDITION_STALE');
    });
  });

  it('client recovers a fenced commit after a lost response, with the same idempotency key', async () => {
    await withGuardedServer({}, async (port) => {
      const { sessionId, review } = await setup(port);
      await decide(port, review.reviewId, 0, 'rel-base-side', 'confirm');
      const base = `http://127.0.0.1:${port}`;
      let dropped = false;
      const fetchImpl: typeof fetch = async (input, init) => {
        const response = await fetch(`${base}${String(input)}`, { ...init, headers: { ...(init?.headers as Record<string, string>), origin: ALLOWED_ORIGIN } });
        if (String(input).endsWith('/transactions') && !dropped) { dropped = true; await response.text(); throw new TypeError('response lost'); }
        return response;
      };
      const receipt = await applySpatialPlanV2Transaction({
        sessionId, baseRevision: 0, idempotencyKey: 'fenced-key-10',
        operations: [op('flost-1', 'base', 7) as never],
        provenance: { origin: 'inferred', evidence: 'Solver evidence.' },
        reviewPrecondition: { reviewId: review.reviewId, reviewRevision: 1, planFingerprint: review.planFingerprint, sourceSha256: plan.source.sha256 },
      }, fetchImpl);
      expect(receipt).toMatchObject({ revision: 1, replayed: true });
      expect(receipt.plan.components[0].provenance.transform).toBe('inferred');
    });
  });
});
