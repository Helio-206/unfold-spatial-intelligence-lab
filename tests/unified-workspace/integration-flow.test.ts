import { describe, expect, it, vi } from 'vitest';
import { createMetaServer } from '../../server/meta-server';
import { initialReview, reduceReview, readiness } from '../../src/living/experience/review';
import { backendDecision, bridgeItems, createReconstructionClient, LiveReconstructionPort, localOnlyNotes, ReviewGateway, validateWithEngine } from '../../src/living/unified-workspace';
import { validateAssembly } from '../../src/living/contracts';
import { PNG_1X1, observation } from './helpers';

const ORIGIN = 'http://127.0.0.1:5173';
const input = { kind: 'drawing' as const, name: 'alcado.png', size: 100, mime: 'image/png', dataUrl: PNG_1X1 };

/** Real server, live mode, with a provider double that returns a fixed observation and counts calls. No paid call is possible. */
async function withLiveServer<T>(run: (ctx: { baseUrl: string; client: ReturnType<typeof createReconstructionClient>; provider: ReturnType<typeof vi.fn>; fetchSpy: ReturnType<typeof vi.fn> }) => Promise<T>): Promise<T> {
  const provider = vi.fn(async () => new Response(JSON.stringify({ id: 'req-live-1', status: 'completed', output_text: JSON.stringify(observation()), usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }), { status: 200, headers: { 'content-type': 'application/json' } }));
  const server = createMetaServer({ apiKey: 'fixture-key-not-real', fetchImpl: provider as unknown as typeof fetch });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('port');
  const fetchSpy = vi.fn((url: RequestInfo | URL, init?: RequestInit) => fetch(url, { ...init, headers: { ...(init?.headers as Record<string, string>), origin: ORIGIN } }));
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try { return await run({ baseUrl, client: createReconstructionClient({ baseUrl, fetchImpl: fetchSpy as unknown as typeof fetch }), provider, fetchSpy }); }
  finally { await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve())); }
}

describe('translation of the interface review into the backend contract', () => {
  it('maps confirmed -> confirm, rejected -> reject, corrected -> reject, pending -> undecided', () => {
    expect(backendDecision('confirmed')).toBe('confirm');
    expect(backendDecision('rejected')).toBe('reject');
    expect(backendDecision('corrected')).toBe('reject');
    expect(backendDecision('pending')).toBeUndefined();
  });

  it('splits the required items between entity cards and extras the cards do not cover', () => {
    const items = bridgeItems(observation());
    expect(items.filter((i) => i.source === 'ui_entity').every((i) => i.key.startsWith('entity:'))).toBe(true);
    expect(items.filter((i) => i.source === 'extra').every((i) => !i.key.startsWith('entity:'))).toBe(true);
    expect(items.length).toBeGreaterThan(0);
  });

  it('says which decisions the API cannot receive', () => {
    const obs = observation();
    obs.entities[0]!.status = 'observed'; // a source-read entity: the API has no decision for it
    let ui = initialReview(obs);
    ui = reduceReview(ui, { type: 'decide', id: obs.entities[0]!.id, decision: 'rejected' });
    ui = reduceReview(ui, { type: 'correct', id: obs.entities[1]!.id, correction: { kind: 'boom', label: 'Lança' } });
    const notes = localOnlyNotes(obs, ui);
    expect(notes.some((n) => n.includes(obs.entities[0]!.label) && /fica só neste ecrã/.test(n))).toBe(true);
    expect(notes.some((n) => n.includes(obs.entities[1]!.label) && /interpretação original foi rejeitada/.test(n))).toBe(true);
  });

  it('lists the relations and statements the entity cards do not show, so they can be decided explicitly', () => {
    const extras = bridgeItems(observation()).filter((i) => i.source === 'extra');
    expect(extras.some((i) => i.kind === 'relation')).toBe(true);
    expect(extras.some((i) => i.kind === 'hypothesis')).toBe(true);
  });
});

describe('live path: port -> review gateway -> adoption -> engine (real server handler, provider double)', () => {
  it('runs end to end with one provider call, and the review never reaches the provider', async () => {
    await withLiveServer(async ({ client, provider, fetchSpy }) => {
      const port = new LiveReconstructionPort({ client });
      const outcome = await port.submit(input, new AbortController().signal);
      if (outcome.kind !== 'observation') throw new Error(JSON.stringify(outcome));
      expect(outcome.provenance).toMatchObject({ mode: 'live', requestId: 'req-live-1' });
      expect(outcome.sessionId).toBeTruthy();
      expect(provider).toHaveBeenCalledTimes(1);

      // the person works in the interface's own review
      let ui = initialReview(outcome.observation);
      for (const item of ui.items) if (item.status === 'hypothesis') ui = reduceReview(ui, { type: 'decide', id: item.id, decision: 'confirmed' });
      expect(readiness(ui).status === 'ready_for_engine' || readiness(ui).status === 'insufficient').toBe(true);

      const gateway = new ReviewGateway(port.session);
      gateway.syncFromUi(ui);
      // nothing else is decided for them
      expect(gateway.blockers().join()).toMatch(/identificação do revisor|confirmação humana|sem decisão|origem humana/);
      const calls = fetchSpy.mock.calls.length;
      expect((await gateway.submit()).kind).toBe('blocked');
      expect(fetchSpy.mock.calls.length).toBe(calls); // an incomplete review is refused locally

      for (const extra of gateway.extras()) gateway.decideExtra(extra.key, 'reject');
      gateway.setHuman({ reviewerId: 'revisor-teste', familyConfirmed: true, bucketConfirmed: true, bucketWidthM: 1.4, widthBasis: 'valor fictício do teste' });
      expect(gateway.blockers()).toEqual([]);

      const result = await gateway.submit();
      if (result.kind !== 'ready') throw new Error(JSON.stringify(result));
      expect(result.candidate.motionAuthorized).toBe(false);
      expect(result.candidate.bucketWidthM).toEqual({ before: 1.1, after: 1.4 });
      expect(result.engine).toMatchObject({ status: 'valid' });
      if (result.engine.status === 'valid') expect(result.engine.solverId).toMatch(/@/);
      expect(provider).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps the person\'s decisions when they go back to the review, and an edit needs a reopen first', async () => {
    await withLiveServer(async ({ client }) => {
      const port = new LiveReconstructionPort({ client });
      const outcome = await port.submit(input, new AbortController().signal);
      if (outcome.kind !== 'observation') throw new Error(outcome.kind);
      let ui = initialReview(outcome.observation);
      for (const item of ui.items) ui = reduceReview(ui, { type: 'decide', id: item.id, decision: 'confirmed' });
      const gateway = new ReviewGateway(port.session);
      gateway.syncFromUi(ui);
      for (const extra of gateway.extras()) gateway.decideExtra(extra.key, 'reject');
      gateway.setHuman({ reviewerId: 'r', familyConfirmed: true, bucketConfirmed: true, bucketWidthM: 1.2, widthBasis: 'x' });
      expect(gateway.blockers()).toEqual([]);
      expect((await gateway.submit()).kind).toBe('ready');
      gateway.setHuman({ bucketWidthM: 9 });
      expect(gateway.human().bucketWidthM).toBe(1.2); // reviewed: edits are ignored until reopened
      gateway.reopen();
      expect(gateway.human()).toMatchObject({ reviewerId: 'r', bucketWidthM: 1.2, familyConfirmed: true, bucketConfirmed: true });
      expect(gateway.extras().every((e) => e.decision === 'reject')).toBe(true);
      gateway.setHuman({ bucketWidthM: 1.5 });
      const again = await gateway.submit();
      if (again.kind !== 'ready') throw new Error(again.kind);
      expect(again.candidate.bucketWidthM.after).toBe(1.5);
    });
  });
});

describe('after the engine refuses an assembly, the person can fix the review and send it again', () => {
  it('edits take effect and the next submit goes to the server again', async () => {
    await withLiveServer(async ({ baseUrl, fetchSpy }) => {
      // the first review answer is altered into an assembly that is structurally valid but that the engine cannot pose
      let tamper = true;
      const tampering = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const response = await (fetchSpy as unknown as typeof fetch)(url, init);
        if (!tamper || !String(init?.body).includes('"action":"review"')) return response;
        tamper = false;
        const body = await response.json();
        for (const a of body.assembly.actuators) if (a.kind === 'hydraulic_cylinder') a.stroke.max.value = 0.0001;
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      });
      const port = new LiveReconstructionPort({ client: createReconstructionClient({ baseUrl, fetchImpl: tampering as unknown as typeof fetch }) });
      const outcome = await port.submit(input, new AbortController().signal);
      if (outcome.kind !== 'observation') throw new Error(outcome.kind);
      let ui = initialReview(outcome.observation);
      for (const item of ui.items) ui = reduceReview(ui, { type: 'decide', id: item.id, decision: 'confirmed' });
      const gateway = new ReviewGateway(port.session);
      gateway.syncFromUi(ui);
      for (const extra of gateway.extras()) gateway.decideExtra(extra.key, 'reject');
      gateway.setHuman({ reviewerId: 'r', familyConfirmed: true, bucketConfirmed: true, bucketWidthM: 1.2, widthBasis: 'x' });
      expect((await gateway.submit()).kind).toBe('engine_blocked');
      gateway.setHuman({ bucketWidthM: 1.6 });
      expect(gateway.human().bucketWidthM).toBe(1.6); // not silently ignored
      const again = await gateway.submit();
      if (again.kind !== 'ready') throw new Error(JSON.stringify(again));
      expect(again.candidate.bucketWidthM.after).toBe(1.6);
      expect(tampering.mock.calls.filter((c) => String(c[1]?.body).includes('"action":"review"'))).toHaveLength(2);
    });
  });
});

describe('gate 2 is the engine, not the contract', () => {
  it('blocks an assembly the engine cannot pose, with a reason, even though it is structurally valid', async () => {
    await withLiveServer(async ({ client }) => {
      const port = new LiveReconstructionPort({ client });
      const outcome = await port.submit(input, new AbortController().signal);
      if (outcome.kind !== 'observation') throw new Error(outcome.kind);
      const gateway = new ReviewGateway(port.session);
      const ui = initialReview(outcome.observation);
      gateway.syncFromUi(ui);
      for (const item of bridgeItems(outcome.observation)) if (item.source === 'ui_entity') gateway.decideExtra(item.key, 'reject');
      for (const extra of gateway.extras()) gateway.decideExtra(extra.key, 'reject');
      gateway.setHuman({ reviewerId: 'r', familyConfirmed: true, bucketConfirmed: true, bucketWidthM: 1.4, widthBasis: 'x' });
      const result = await gateway.submit();
      if (result.kind !== 'ready') throw new Error(JSON.stringify(result));
      const broken = structuredClone(result.candidate.assembly);
      for (const actuator of broken.actuators) if (actuator.kind === 'hydraulic_cylinder') actuator.stroke.max.value = 0.0001; // the reference pose no longer fits the stroke
      expect(validateAssembly(broken).ok).toBe(true); // structurally this is still a valid assembly document
      expect(validateWithEngine(result.candidate.assembly).status).toBe('valid');
      const gate = validateWithEngine(broken);
      expect(gate.status).toBe('blocked');
      if (gate.status === 'blocked') expect(gate.reasons.join()).toMatch(/STROKE_OUT_OF_RANGE/);
    });
  });
});
