import { describe, expect, it, vi } from 'vitest';
import { createReconstructionClient, ReconstructionSession, requiredReviewItems, SESSION_TTL_MS, type SessionState } from '../../src/living/unified-workspace';
import { PNG_1X1, SESSION_ID, json, observation, proposalBody, reviewedBody } from './helpers';

const REQUEST = { sourceKind: 'image', imageDataUrl: PNG_1X1, mode: 'offline' } as const;

/** fetch double whose responses the test releases explicitly; it honours abort like the real one. */
function controlled() {
  const calls: Array<{ body: any; resolve: (r: Response) => void }> = [];
  const fetchImpl = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    init!.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    calls.push({ body: JSON.parse(init!.body as string), resolve });
  }));
  return { calls, fetchImpl, client: createReconstructionClient({ fetchImpl: fetchImpl as unknown as typeof fetch }) };
}
const answerWith = (fn: (body: any) => Response) => { const fetchImpl = vi.fn(async (_u: unknown, init?: RequestInit) => fn(JSON.parse(init!.body as string))); return { fetchImpl, client: createReconstructionClient({ fetchImpl: fetchImpl as unknown as typeof fetch }) }; };
const fillDraft = (session: ReconstructionSession, obs = observation()) => {
  session.edit({ reviewerId: 'rev-1', familyConfirmed: true, bucketConfirmed: true, bucketWidthM: 1.4, widthBasis: 'valor do utilizador' });
  for (const item of requiredReviewItems(obs)) session.decide(item.key, 'reject');
};
const phase = (s: ReconstructionSession) => s.state.phase;

describe('reconstruction session', () => {
  it('goes idle -> proposing -> awaiting_review, with every human confirmation still missing', async () => {
    const { client } = answerWith(() => json(200, proposalBody()));
    const session = new ReconstructionSession({ client });
    const seen: string[] = []; session.subscribe((s) => seen.push(s.phase));
    await session.propose(REQUEST);
    expect(seen).toEqual(['proposing', 'awaiting_review']);
    const s = session.state as Extract<SessionState, { phase: 'awaiting_review' }>;
    expect(s.draft.bucketConfirmed).toBe(false); expect(s.draft.familyConfirmed).toBe(false); expect(s.draft.reviewerId).toBe('');
    expect(s.blockers.length).toBeGreaterThan(3);
  });

  it('refuses to submit an incomplete draft without calling the server', async () => {
    const { client, fetchImpl } = answerWith(() => json(200, proposalBody()));
    const session = new ReconstructionSession({ client });
    await session.propose(REQUEST);
    await session.submit();
    expect(phase(session)).toBe('review_blocked');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('runs the full flow and ends reviewed with unverified provenance', async () => {
    const { client } = answerWith((body) => body.action === 'review' ? json(200, reviewedBody()) : json(200, proposalBody()));
    const session = new ReconstructionSession({ client });
    await session.propose(REQUEST); fillDraft(session);
    expect((session.state as any).blockers).toEqual([]);
    await session.submit();
    const s = session.state; if (s.phase !== 'reviewed') throw new Error(s.phase);
    expect(s.result.provenance.review.humanParticipation).toBe('unverified');
    expect(s.result.geometry.bucketWidthAfterM).toBe(1.4);
  });

  it('keeps the draft after a server 422 so the person can fix it and resubmit', async () => {
    let first = true;
    const { client } = answerWith((body) => body.action !== 'review' ? json(200, proposalBody()) : first ? ((first = false), json(422, { contract: 'unfold.reconstruction.review.v1', sessionId: SESSION_ID, status: 'blocked', reasons: ['família não confirmada'] })) : json(200, reviewedBody()));
    const session = new ReconstructionSession({ client });
    await session.propose(REQUEST); fillDraft(session);
    await session.submit();
    const blocked = session.state; if (blocked.phase !== 'review_blocked') throw new Error(blocked.phase);
    expect(blocked.reasons).toEqual(['família não confirmada']); expect(blocked.draft.bucketWidthM).toBe(1.4);
    await session.submit();
    expect(phase(session)).toBe('reviewed');
  });

  it('turns a 404 on review into expired', async () => {
    const { client } = answerWith((body) => body.action === 'review' ? json(404, { error: { code: 'RECONSTRUCTION_SESSION_NOT_FOUND', message: 'x' } }) : json(200, proposalBody()));
    const session = new ReconstructionSession({ client });
    await session.propose(REQUEST); fillDraft(session); await session.submit();
    expect(phase(session)).toBe('expired');
  });

  it('expires locally after 30 minutes and then refuses edits and submits', async () => {
    let clock = 1_000;
    const { client, fetchImpl } = answerWith(() => json(200, proposalBody()));
    const session = new ReconstructionSession({ client, now: () => clock });
    await session.propose(REQUEST); fillDraft(session);
    clock += SESSION_TTL_MS - 1; expect(phase(session)).toBe('awaiting_review');
    clock += 1; expect(phase(session)).toBe('expired');
    session.edit({ reviewerId: 'x' }); await session.submit();
    expect(phase(session)).toBe('expired'); expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('shows a blocked proposal with its reasons and offers no review', async () => {
    const body: any = proposalBody(); body.status = 'blocked'; body.assemblyProposal.validation = { ...body.assemblyProposal.validation, status: 'blocked', issues: ['evidência insuficiente'] };
    const { client } = answerWith(() => json(200, body));
    const session = new ReconstructionSession({ client });
    await session.propose(REQUEST);
    expect(session.state).toMatchObject({ phase: 'proposal_blocked', reasons: ['evidência insuficiente'] });
    session.edit({ reviewerId: 'x' }); await session.submit();
    expect(phase(session)).toBe('proposal_blocked');
  });

  it('reports a failed proposal and allows another attempt', async () => {
    let n = 0;
    const { client } = answerWith(() => n++ === 0 ? json(429, { error: { code: 'RECONSTRUCTION_RATE_LIMITED', message: 'x' } }) : json(200, proposalBody()));
    const session = new ReconstructionSession({ client });
    await session.propose(REQUEST);
    expect(session.state).toMatchObject({ phase: 'proposal_failed', failure: { kind: 'rate_limited' } });
    await session.propose(REQUEST);
    expect(phase(session)).toBe('awaiting_review');
  });

  it('ignores the late answer of a superseded proposal', async () => {
    const { client, calls } = controlled();
    const session = new ReconstructionSession({ client });
    const first = session.propose(REQUEST);
    const second = session.propose(REQUEST);
    calls[1]!.resolve(json(200, proposalBody(observation(), 'session-B')));
    await second; await first;
    expect((session.state as any).proposal.sessionId).toBe('session-B');
    calls[0]!.resolve(json(200, proposalBody(observation(), 'session-A')));
    await Promise.resolve();
    expect((session.state as any).proposal.sessionId).toBe('session-B');
  });

  it('ignores a second submit while one is in flight, and sends exactly one review', async () => {
    const { client, calls } = controlled();
    const session = new ReconstructionSession({ client });
    const proposing = session.propose(REQUEST); calls[0]!.resolve(json(200, proposalBody())); await proposing;
    fillDraft(session);
    const a = session.submit(); const b = session.submit();
    expect(calls.filter((c) => c.body.action === 'review')).toHaveLength(1);
    expect(phase(session)).toBe('reviewing');
    calls[1]!.resolve(json(200, reviewedBody())); await a; await b;
    expect(phase(session)).toBe('reviewed');
  });

  it('cancel aborts the review in flight, discards its answer and returns to the editable draft', async () => {
    const { client, calls } = controlled();
    const session = new ReconstructionSession({ client });
    const proposing = session.propose(REQUEST); calls[0]!.resolve(json(200, proposalBody())); await proposing;
    fillDraft(session);
    const pending = session.submit(); session.cancel(); await pending;
    expect(phase(session)).toBe('awaiting_review');
    expect((session.state as any).draft.bucketWidthM).toBe(1.4);
    calls[1]!.resolve(json(200, reviewedBody())); await Promise.resolve();
    expect(phase(session)).toBe('awaiting_review');
  });

  it('cancel during the first proposal returns to idle; reset and dispose stop everything', async () => {
    const { client, calls } = controlled();
    const session = new ReconstructionSession({ client });
    const pending = session.propose(REQUEST); session.cancel(); await pending;
    expect(phase(session)).toBe('idle');
    calls[0]!.resolve(json(200, proposalBody())); await Promise.resolve();
    expect(phase(session)).toBe('idle');
    const listener = vi.fn(); session.subscribe(listener);
    session.dispose(); await session.propose(REQUEST); session.reset();
    expect(listener).not.toHaveBeenCalled();
  });
});
