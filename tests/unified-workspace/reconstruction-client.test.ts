import { describe, expect, it, vi } from 'vitest';
import { createReconstructionClient, inputProblems, requiredReviewItems, type ReviewSubmission } from '../../src/living/unified-workspace';
import { PNG_1X1, SESSION_ID, completeDraft, json, observation, proposalBody, reviewedBody } from './helpers';

const submission = (): ReviewSubmission => { const o = observation(); const d = completeDraft(o); return { reviewerId: 'rev-1', family: 'tracked_excavator', bucketConfirmed: true, decisions: Object.fromEntries(requiredReviewItems(o).map((i) => [i.key, 'reject' as const])), bucketWidthM: d.bucketWidthM!, widthBasis: 'valor' }; };
const clientWith = (fn: (...args: Parameters<typeof fetch>) => Promise<Response>, extra = {}) => { const spy = vi.fn(fn); return { spy, client: createReconstructionClient({ fetchImpl: spy as unknown as typeof fetch, ...extra }) }; };

describe('input validation (no request leaves the page)', () => {
  it.each([
    [{ sourceKind: 'image', imageDataUrl: 'data:image/gif;base64,AAAA' }, /JPEG ou PNG/],
    [{ sourceKind: 'image', imageDataUrl: 'não-é-url' }, /JPEG ou PNG/],
    [{ sourceKind: 'text', instruction: '   ' }, /instrução/],
    [{ sourceKind: 'text', instruction: 'x'.repeat(8001) }, /instrução/],
    [{ sourceKind: 'text', instruction: 'ok', sourceReference: 'r'.repeat(201) }, /sourceReference/],
    [{ sourceKind: 'text', instruction: 'ok', mode: 'maybe' }, /mode/],
  ] as const)('refuses %j', async (request, pattern) => {
    const { client, spy } = clientWith(async () => json(200, {}));
    const outcome = await client.propose(request as never);
    expect(outcome).toMatchObject({ ok: false, failure: { kind: 'invalid_input' } });
    if (!outcome.ok && outcome.failure.kind === 'invalid_input') expect(outcome.failure.reasons.join()).toMatch(pattern);
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses a PNG whose header declares more than 16 million pixels or a side above 10000', () => {
    const png = (w: number, h: number) => { const b = Uint8Array.from(atob(PNG_1X1.split(',')[1]!), (c) => c.charCodeAt(0)); const v = new DataView(b.buffer); v.setUint32(16, w); v.setUint32(20, h); let s = ''; b.forEach((x) => { s += String.fromCharCode(x); }); return `data:image/png;base64,${btoa(s)}`; };
    expect(inputProblems({ sourceKind: 'image', imageDataUrl: png(5000, 4000) }).join()).toMatch(/limites/);
    expect(inputProblems({ sourceKind: 'image', imageDataUrl: png(10001, 10) }).join()).toMatch(/limites/);
    expect(inputProblems({ sourceKind: 'image', imageDataUrl: png(4000, 4000) })).toEqual([]);
    expect(inputProblems({ sourceKind: 'image', imageDataUrl: PNG_1X1 })).toEqual([]);
  });
});

describe('propose', () => {
  it('posts the request as JSON to the reconstruction route, with no token by default', async () => {
    const { client, spy } = clientWith(async () => json(200, proposalBody()));
    const outcome = await client.propose({ sourceKind: 'image', imageDataUrl: PNG_1X1, mode: 'offline', sourceReference: 'foto-1' });
    expect(outcome.ok).toBe(true);
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe('/api/living/reconstruction');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['x-unfold-local-token']).toBeUndefined();
    expect(JSON.parse(init!.body as string)).toMatchObject({ mode: 'offline', sourceKind: 'image', sourceReference: 'foto-1' });
  });

  it('sends the local token only when explicitly configured (non-browser callers)', async () => {
    const { client, spy } = clientWith(async () => json(200, proposalBody()), { localToken: 'tok' });
    await client.propose({ sourceKind: 'text', instruction: 'escavadora' });
    expect((spy.mock.calls[0]![1]?.headers as Record<string, string>)['x-unfold-local-token']).toBe('tok');
  });

  it('returns the observation untouched and marks engineering as blocked', async () => {
    const body = proposalBody();
    const { client } = clientWith(async () => json(200, body));
    const outcome = await client.propose({ sourceKind: 'text', instruction: 'escavadora' });
    if (!outcome.ok) throw new Error(JSON.stringify(outcome.failure));
    expect(outcome.value.observation).toEqual(body.observation);
    expect(outcome.value.engineering.status).toBe('blocked');
    expect(outcome.value.sessionId).toBe(SESSION_ID);
  });

  it.each([
    [400, { error: { code: 'INVALID_RECONSTRUCTION_REFERENCE', message: 'sourceReference inválido.' } }, 'invalid_input'],
    [403, { error: { code: 'INVALID_ORIGIN', message: 'x' } }, 'guard_rejected'],
    [421, { error: { code: 'INVALID_HOST', message: 'x' } }, 'guard_rejected'],
    [429, { error: { code: 'RECONSTRUCTION_RATE_LIMITED', message: 'x' } }, 'rate_limited'],
    [429, { error: { code: 'META_CALL_BUDGET_EXHAUSTED', message: 'x' } }, 'budget_exhausted'],
    [503, { error: { code: 'RECONSTRUCTION_SESSION_CAPACITY', message: 'x' } }, 'capacity'],
    [502, { error: { code: 'RECONSTRUCTION_META_FAILED', message: 'x' } }, 'upstream'],
    [500, null, 'upstream'],
  ])('maps HTTP %i to %s', async (status, body, kind) => {
    const { client } = clientWith(async () => json(status as number, body));
    expect(await client.propose({ sourceKind: 'text', instruction: 'escavadora' })).toMatchObject({ ok: false, failure: { kind } });
  });

  it('reports a network failure and a timeout without throwing', async () => {
    const down = clientWith(async () => { throw new TypeError('fetch failed'); });
    expect(await down.client.propose({ sourceKind: 'text', instruction: 'x' })).toMatchObject({ ok: false, failure: { kind: 'network', message: 'fetch failed' } });
    const slow = clientWith((_u, init) => new Promise((_r, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))), { timeoutMs: 10 });
    expect(await slow.client.propose({ sourceKind: 'text', instruction: 'x' })).toMatchObject({ ok: false, failure: { kind: 'network', message: 'tempo esgotado' } });
  });

  it('reports an abort requested by the caller as aborted', async () => {
    const { client } = clientWith((_u, init) => new Promise((_r, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
    const controller = new AbortController();
    const pending = client.propose({ sourceKind: 'text', instruction: 'x' }, controller.signal);
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, failure: { kind: 'aborted' } });
  });

  it.each([
    ['wrong contract', (b: any) => { b.contract = 'other'; }],
    ['missing session id', (b: any) => { delete b.sessionId; }],
    ['engineering not blocked', (b: any) => { b.engineering.status = 'ready'; }],
    ['invalid observation', (b: any) => { b.observation.schema = 'x'; }],
    ['invalid proposal', (b: any) => { b.assemblyProposal.parts = 'x'; }],
    ['unknown status', (b: any) => { b.status = 'approved'; }],
  ])('discards a response with %s', async (_name, mutate) => {
    const body: any = structuredClone(proposalBody()); mutate(body);
    const { client } = clientWith(async () => json(200, body));
    expect(await client.propose({ sourceKind: 'text', instruction: 'x' })).toMatchObject({ ok: false, failure: { kind: 'bad_response' } });
  });
});

describe('submitReview', () => {
  it('posts action review with the session id and returns a contract-valid assembly', async () => {
    const { client, spy } = clientWith(async () => json(200, reviewedBody()));
    const outcome = await client.submitReview(SESSION_ID, submission());
    if (!outcome.ok) throw new Error(JSON.stringify(outcome.failure));
    expect(JSON.parse(spy.mock.calls[0]![1]!.body as string)).toMatchObject({ action: 'review', sessionId: SESSION_ID, review: { family: 'tracked_excavator' } });
    expect(outcome.value.geometry).toEqual({ bucketWidthBeforeM: 1.1, bucketWidthAfterM: 1.4 });
    expect(outcome.value.provenance.review).toEqual({ source: 'client_submitted', reviewerIdentity: 'unverified', humanParticipation: 'unverified' });
  });

  it('maps 422 to blocked with the reasons, and 404 to an expired session', async () => {
    const blocked = clientWith(async () => json(422, { contract: 'unfold.reconstruction.review.v1', sessionId: SESSION_ID, status: 'blocked', reasons: ['largura da caçamba deve estar entre 0,1 e 10 m'] }));
    expect(await blocked.client.submitReview(SESSION_ID, submission())).toEqual({ ok: false, failure: { kind: 'blocked', reasons: ['largura da caçamba deve estar entre 0,1 e 10 m'] } });
    const gone = clientWith(async () => json(404, { error: { code: 'RECONSTRUCTION_SESSION_NOT_FOUND', message: 'x' } }));
    expect(await gone.client.submitReview(SESSION_ID, submission())).toMatchObject({ ok: false, failure: { kind: 'session_expired' } });
  });

  it.each([
    ['another session', (b: any) => { b.sessionId = 'other'; }],
    ['not contract_valid', (b: any) => { b.status = 'approved'; }],
    ['verified reviewer identity', (b: any) => { b.provenance.review.reviewerIdentity = 'verified'; }],
    ['verified human participation', (b: any) => { b.provenance.review.humanParticipation = 'verified'; }],
    ['measured width', (b: any) => { b.provenance.bucketWidth.measurement = 'verified'; }],
    ['photographic geometry', (b: any) => { b.provenance.remainingGeometry.source = 'photograph'; }],
    ['invalid assembly', (b: any) => { b.assembly.parts = []; }],
    ['invalid mode', (b: any) => { b.mode = 'x'; }],
  ])('discards a review response claiming %s', async (_name, mutate) => {
    const body: any = structuredClone(reviewedBody()); mutate(body);
    const { client } = clientWith(async () => json(200, body));
    expect(await client.submitReview(SESSION_ID, submission())).toMatchObject({ ok: false, failure: { kind: 'bad_response' } });
  });
});
