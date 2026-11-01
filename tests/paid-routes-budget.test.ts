import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MAX_CONCURRENT_META_CALLS, DEFAULT_MAX_META_CALLS, createMetaServer } from '../server/meta-server';
import { ALLOWED_ORIGIN, countingFetch, metaResponse, paidRouteCases, rawRequest, withGuardedServer } from './helpers/paid-routes';

const cases = paidRouteCases();
const routes = Object.keys(cases);
const headers = { 'content-type': 'application/json', origin: ALLOWED_ORIGIN };
const envKeys = ['UNFOLD_ACCEPTANCE_MAX_META_CALLS', 'UNFOLD_ACCEPTANCE_BUDGET_FILE', 'UNFOLD_MAX_CONCURRENT_META_CALLS', 'NODE_ENV'] as const;
const savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
beforeAll(() => { process.env.NODE_ENV = 'test'; });
beforeEach(() => { for (const key of envKeys) if (key !== 'NODE_ENV') delete process.env[key]; });
afterEach(() => vi.restoreAllMocks());
afterAll(() => { for (const key of envKeys) { if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key]; } });

const budget = async (port: number) => (await rawRequest(port, { path: '/api/diagnostics', method: 'GET' })).json.metaCallBudget as { limit: number | null; used: number; remaining: number | null };

// Fetch que fica preso até soltarmos, para ter pedidos genuinamente em simultâneo.
function gatedFetch(text: string) {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => { open = resolve; });
  const upstream = vi.fn<typeof fetch>().mockImplementation(async () => { await gate; return metaResponse(text); });
  return { upstream, open };
}
const until = async (condition: () => boolean) => { for (let attempt = 0; attempt < 200 && !condition(); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5)); expect(condition()).toBe(true); };

describe.each(routes)('paid route %s: call budget', (path) => {
  const { body, upstreamText } = cases[path]!;

  it('answers 429 META_CALL_BUDGET_EXHAUSTED when the budget is spent, without reaching Meta', async () => {
    const upstream = countingFetch(upstreamText);
    await withGuardedServer({ fetchImpl: upstream, maxMetaCalls: 0 }, async (port) => {
      const reply = await rawRequest(port, { path, headers, body });
      expect(reply.status).toBe(429);
      expect(reply.json.error.code).toBe('META_CALL_BUDGET_EXHAUSTED');
      expect(upstream).toHaveBeenCalledTimes(0);
    });
  });

  it('spends from one budget shared with every other paid route', async () => {
    const upstream = countingFetch(upstreamText);
    await withGuardedServer({ fetchImpl: upstream, maxMetaCalls: 1 }, async (port) => {
      expect((await rawRequest(port, { path, headers, body })).status).toBe(200);
      const other = routes.find((route) => route !== path)!;
      const reply = await rawRequest(port, { path: other, headers, body: cases[other]!.body });
      expect(reply.status).toBe(429);
      expect(reply.json.error.code).toBe('META_CALL_BUDGET_EXHAUSTED');
      expect(upstream).toHaveBeenCalledTimes(1);
    });
  });
});

describe('budget defaults', () => {
  it('is finite when nothing is configured, and stops at exactly that many Meta calls', async () => {
    const upstream = countingFetch('ok');
    await withGuardedServer({ fetchImpl: upstream }, async (port) => {
      expect(await budget(port)).toEqual({ limit: DEFAULT_MAX_META_CALLS, used: 0, remaining: DEFAULT_MAX_META_CALLS });
      for (let call = 0; call < DEFAULT_MAX_META_CALLS; call += 1) {
        expect((await rawRequest(port, { path: '/api/meta/text', headers, body: { prompt: 'x' } })).status).toBe(200);
      }
      const reply = await rawRequest(port, { path: '/api/meta/text', headers, body: { prompt: 'x' } });
      expect(reply.status).toBe(429);
      expect(upstream).toHaveBeenCalledTimes(DEFAULT_MAX_META_CALLS);
      expect(await budget(port)).toMatchObject({ used: DEFAULT_MAX_META_CALLS, remaining: 0 });
    });
  });

  it('still honours an explicit limit from the environment or from the option', async () => {
    process.env.UNFOLD_ACCEPTANCE_MAX_META_CALLS = '3';
    await withGuardedServer({ fetchImpl: countingFetch() }, async (port) => { expect((await budget(port)).limit).toBe(3); });
    await withGuardedServer({ fetchImpl: countingFetch(), maxMetaCalls: 5 }, async (port) => { expect((await budget(port)).limit).toBe(5); });
  });

  it('keeps rejecting a malformed limit instead of falling back to the default', () => {
    process.env.UNFOLD_ACCEPTANCE_MAX_META_CALLS = 'many';
    expect(() => createMetaServer({ apiKey: 'x' })).toThrow(/UNFOLD_ACCEPTANCE_MAX_META_CALLS/);
  });

  it('is persisted to the budget file with the default limit and survives a restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'unfold-budget-default-'));
    const file = join(directory, 'budget.json');
    try {
      await withGuardedServer({ fetchImpl: countingFetch(), metaCallBudgetFile: file }, async (port) => {
        await rawRequest(port, { path: '/api/meta/text', headers, body: { prompt: 'x' } });
        await rawRequest(port, { path: '/api/meta/text', headers, body: { prompt: 'x' } });
      });
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ limit: DEFAULT_MAX_META_CALLS, used: 2 });
      await withGuardedServer({ fetchImpl: countingFetch(), metaCallBudgetFile: file }, async (port) => {
        expect(await budget(port)).toMatchObject({ limit: DEFAULT_MAX_META_CALLS, used: 2, remaining: DEFAULT_MAX_META_CALLS - 2 });
      });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});

describe('budget file with another limit', () => {
  it('refuses to start and says which file to delete', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'unfold-budget-mismatch-'));
    const file = join(directory, 'budget.json');
    try {
      await withGuardedServer({ fetchImpl: countingFetch(), metaCallBudgetFile: file, maxMetaCalls: 7 }, async (port) => {
        await rawRequest(port, { path: '/api/meta/text', headers, body: { prompt: 'x' } });
      });
      expect(() => createMetaServer({ apiKey: 'x', metaCallBudgetFile: file, maxMetaCalls: 8 })).toThrow(new RegExp(`${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*Apague-o`));
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});

describe.each(routes)('paid route %s: concurrent Meta calls', (path) => {
  const { body, upstreamText } = cases[path]!;

  it('lets the default number through at once and refuses the next one with 429, without reaching Meta or spending budget', async () => {
    expect(DEFAULT_MAX_CONCURRENT_META_CALLS).toBe(2);
    const { upstream, open } = gatedFetch(upstreamText);
    await withGuardedServer({ fetchImpl: upstream }, async (port) => {
      const inFlight = [rawRequest(port, { path, headers, body }), rawRequest(port, { path, headers, body })];
      await until(() => upstream.mock.calls.length === 2);
      const refused = await rawRequest(port, { path, headers, body });
      expect(refused.status).toBe(429);
      expect(refused.json.error.code).toBe('META_CONCURRENCY_LIMIT');
      expect(upstream).toHaveBeenCalledTimes(2);
      expect((await budget(port)).used).toBe(2);
      open();
      expect((await Promise.all(inFlight)).map((reply) => reply.status)).toEqual([200, 200]);
      expect((await rawRequest(port, { path, headers, body })).status).toBe(200);
      expect((await budget(port)).used).toBe(3);
    });
  });
});

describe('concurrency limit details', () => {
  const text = cases['/api/meta/text']!;

  it('counts slots across routes, not per route', async () => {
    const { upstream, open } = gatedFetch('ok');
    await withGuardedServer({ fetchImpl: upstream, maxConcurrentMetaCalls: 1 }, async (port) => {
      const first = rawRequest(port, { path: '/api/meta/text', headers, body: text.body });
      await until(() => upstream.mock.calls.length === 1);
      const refused = await rawRequest(port, { path: '/api/conversation', headers, body: cases['/api/conversation']!.body });
      expect(refused.status).toBe(429);
      expect(refused.json.error.code).toBe('META_CONCURRENCY_LIMIT');
      expect(upstream).toHaveBeenCalledTimes(1);
      open();
      expect((await first).status).toBe(200);
    });
  });

  it('is configurable by option and by environment, and rejects nonsense', async () => {
    process.env.UNFOLD_MAX_CONCURRENT_META_CALLS = '1';
    const { upstream, open } = gatedFetch('ok');
    await withGuardedServer({ fetchImpl: upstream }, async (port) => {
      const first = rawRequest(port, { path: '/api/meta/text', headers, body: text.body });
      await until(() => upstream.mock.calls.length === 1);
      expect((await rawRequest(port, { path: '/api/meta/text', headers, body: text.body })).status).toBe(429);
      open();
      await first;
    });
    delete process.env.UNFOLD_MAX_CONCURRENT_META_CALLS;
    for (const bad of ['0', '-1', '1.5', 'two', '']) {
      if (bad === '') continue; // vazio = não configurado
      process.env.UNFOLD_MAX_CONCURRENT_META_CALLS = bad;
      expect(() => createMetaServer({ apiKey: 'x' })).toThrow(/UNFOLD_MAX_CONCURRENT_META_CALLS/);
    }
    delete process.env.UNFOLD_MAX_CONCURRENT_META_CALLS;
    expect(() => createMetaServer({ apiKey: 'x', maxConcurrentMetaCalls: 0 })).toThrow(/UNFOLD_MAX_CONCURRENT_META_CALLS/);
  });

  it('holds one slot per request even when the image pipeline makes two Meta calls', async () => {
    const recognitionCall = JSON.stringify({ schema: 'technical_recognition.v2', primaryDomain: 'mechanical', secondaryDomains: [], documentType: 'desenho mecânico', summary: 'Sinais.', legibility: 'medium', route: 'extract' });
    const upstream = vi.fn<typeof fetch>().mockImplementation(async () => metaResponse(recognitionCall));
    await withGuardedServer({ fetchImpl: upstream, maxConcurrentMetaCalls: 1 }, async (port) => {
      const reply = await rawRequest(port, { path: '/api/meta/image', headers, body: cases['/api/meta/image']!.body });
      expect(reply.status).not.toBe(429);
      expect(upstream.mock.calls.length).toBe(2);
      expect((await budget(port)).used).toBe(2);
    });
  });

  it('frees the slot when Meta fails', async () => {
    const upstream = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('offline')).mockImplementation(async () => metaResponse('ok'));
    await withGuardedServer({ fetchImpl: upstream, maxConcurrentMetaCalls: 1 }, async (port) => {
      expect((await rawRequest(port, { path: '/api/meta/text', headers, body: text.body })).status).toBe(502);
      expect((await rawRequest(port, { path: '/api/meta/text', headers, body: text.body })).status).toBe(200);
    });
  });

  it('does not take a slot for requests that fail validation before any Meta call', async () => {
    const upstream = countingFetch();
    await withGuardedServer({ fetchImpl: upstream, maxConcurrentMetaCalls: 1 }, async (port) => {
      for (let attempt = 0; attempt < 3; attempt += 1) expect((await rawRequest(port, { path: '/api/meta/text', headers, body: { nope: true } })).status).toBe(400);
      expect((await rawRequest(port, { path: '/api/meta/text', headers, body: text.body })).status).toBe(200);
      expect((await budget(port)).used).toBe(1);
    });
  });
});
