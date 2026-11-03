import { describe, expect, it, vi } from 'vitest';
import { createMetaServer } from '../../server/meta-server';
import { adoptReviewed, createReconstructionClient, ReconstructionSession, requiredReviewItems, type SessionState } from '../../src/living/unified-workspace';
import { PNG_1X1 } from './helpers';

const ORIGIN = 'http://127.0.0.1:5173';

/** Runs the real server handler (offline mode, no key). The provider fetch must never be called: no paid call in tests. */
async function withRealServer<T>(run: (ctx: { baseUrl: string; provider: ReturnType<typeof vi.fn> }) => Promise<T>): Promise<T> {
  const provider = vi.fn(async () => { throw new Error('provider must not be called in contract tests'); });
  const server = createMetaServer({ fetchImpl: provider as unknown as typeof fetch, maxMetaCalls: 0 });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('port');
  try { return await run({ baseUrl: `http://127.0.0.1:${address.port}`, provider }); }
  finally { await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve())); }
}
const browserLikeFetch: typeof fetch = (url, init) => fetch(url, { ...init, headers: { ...(init?.headers as Record<string, string>), origin: ORIGIN } });
const clientFor = (baseUrl: string, fetchImpl: typeof fetch = browserLikeFetch) => createReconstructionClient({ baseUrl, fetchImpl });

describe('client against the real POST /api/living/reconstruction handler', () => {
  it('propose -> review -> adopt: width 1.10 m -> 1.40 m, every confirmation from the draft, nothing authorised to move', async () => {
    await withRealServer(async ({ baseUrl, provider }) => {
      const session = new ReconstructionSession({ client: clientFor(baseUrl) });
      await session.propose({ sourceKind: 'image', imageDataUrl: PNG_1X1, mode: 'offline', sourceReference: 'contract-test' });
      const proposed = session.state; if (proposed.phase !== 'awaiting_review') throw new Error(JSON.stringify(proposed));
      expect(proposed.proposal.mode).toBe('offline');
      expect(proposed.proposal.engineering.status).toBe('blocked');
      session.edit({ reviewerId: 'contract-reviewer', familyConfirmed: true, bucketConfirmed: true, bucketWidthM: 1.4, widthBasis: 'valor fictício do teste de contrato' });
      for (const item of requiredReviewItems(proposed.proposal.observation)) session.decide(item.key, 'reject');
      expect((session.state as Extract<SessionState, { phase: 'awaiting_review' }>).blockers).toEqual([]);
      await session.submit();
      const done = session.state; if (done.phase !== 'reviewed') throw new Error(JSON.stringify(done));
      expect(done.result.geometry).toEqual({ bucketWidthBeforeM: 1.1, bucketWidthAfterM: 1.4 });
      expect(done.result.provenance).toMatchObject({ observation: { source: 'offline_fixture', statuses: 'fixture_generated' }, review: { humanParticipation: 'unverified' }, remainingGeometry: { source: 'synthetic_fixture' } });
      expect(done.result.originalObservation).toEqual(proposed.proposal.observation);
      const adopted = adoptReviewed(done);
      if (!adopted.ok) throw new Error(adopted.reasons.join());
      expect(adopted.candidate.motionAuthorized).toBe(false);
      expect(provider).not.toHaveBeenCalled();
    });
  });

  it('a missing width is blocked by the server (422) when the client-side check is bypassed', async () => {
    await withRealServer(async ({ baseUrl }) => {
      const client = clientFor(baseUrl);
      const proposed = await client.propose({ sourceKind: 'text', instruction: 'Escavadora de rastos com caçamba', mode: 'offline' });
      if (!proposed.ok) throw new Error(JSON.stringify(proposed.failure));
      const decisions = Object.fromEntries(requiredReviewItems(proposed.value.observation).map((i) => [i.key, 'reject' as const]));
      const outcome = await client.submitReview(proposed.value.sessionId, { reviewerId: 'r', family: 'tracked_excavator', bucketConfirmed: true, decisions, bucketWidthM: Number.NaN, widthBasis: 'x' });
      expect(outcome).toMatchObject({ ok: false, failure: { kind: 'blocked' } });
      if (!outcome.ok && outcome.failure.kind === 'blocked') expect(outcome.failure.reasons.join()).toMatch(/largura/);
    });
  });

  it('an unknown session id is reported as expired', async () => {
    await withRealServer(async ({ baseUrl }) => {
      const outcome = await clientFor(baseUrl).submitReview('00000000-0000-4000-8000-000000000000', { reviewerId: 'r', family: 'tracked_excavator', bucketConfirmed: true, decisions: {}, bucketWidthM: 1.2, widthBasis: 'x' });
      expect(outcome).toMatchObject({ ok: false, failure: { kind: 'session_expired' } });
    });
  });

  it('a request with a foreign Origin is rejected by the guard and reported as guard_rejected', async () => {
    await withRealServer(async ({ baseUrl }) => {
      const foreign: typeof fetch = (url, init) => fetch(url, { ...init, headers: { ...(init?.headers as Record<string, string>), origin: 'http://evil.example' } });
      expect(await clientFor(baseUrl, foreign).propose({ sourceKind: 'text', instruction: 'x', mode: 'offline' })).toMatchObject({ ok: false, failure: { kind: 'guard_rejected', status: 403 } });
    });
  });

  it('without Origin and without a token the server refuses; with the local token configured it is accepted', async () => {
    await withRealServer(async ({ baseUrl }) => {
      expect(await clientFor(baseUrl, fetch).propose({ sourceKind: 'text', instruction: 'x', mode: 'offline' })).toMatchObject({ ok: false, failure: { kind: 'guard_rejected', code: 'LOCAL_TOKEN_REQUIRED' } });
    });
  });

  it('the server rate limit surfaces as rate_limited', async () => {
    await withRealServer(async ({ baseUrl }) => {
      const client = clientFor(baseUrl);
      let last: Awaited<ReturnType<typeof client.propose>> | undefined;
      for (let i = 0; i < 11; i++) last = await client.propose({ sourceKind: 'text', instruction: `escavadora ${i}`, mode: 'offline' });
      expect(last).toMatchObject({ ok: false, failure: { kind: 'rate_limited' } });
    });
  });
});
