import { existsSync, statSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { defaultStateFile } from '../server/meta-server';
import { ALLOWED_ORIGIN, countingFetch, paidRouteCases, rawRequest, TOKEN_HEADER, withGuardedServer, withTokenServer } from './helpers/paid-routes';

const cases = paidRouteCases();
const routes = Object.keys(cases);
const previousNodeEnv = process.env.NODE_ENV;
beforeAll(() => { process.env.NODE_ENV = 'test'; });
afterAll(() => { if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv; });
afterEach(() => vi.restoreAllMocks());

const jsonOnly = { 'content-type': 'application/json' };

describe.each(routes)('paid route %s: Origin and local token', (path) => {
  const { body, upstreamText } = cases[path]!;

  it.each([
    ['another site', 'https://untrusted.example'],
    ['literal null (sandboxed iframe, file://)', 'null'],
    ['allowed host, other port', 'http://127.0.0.1:5174'],
    ['allowed origin as a prefix of another', 'http://localhost:5173.evil.example'],
    ['https variant of an allowed origin', 'https://127.0.0.1:5173'],
  ])('rejects a browser request from %s with 403, even with a valid token', async (_label, origin) => {
    const upstream = countingFetch(upstreamText);
    await withTokenServer({ fetchImpl: upstream }, async (port, token) => {
      const plain = await rawRequest(port, { path, headers: { ...jsonOnly, origin }, body });
      expect(plain.status).toBe(403);
      expect(plain.json.error.code).toBe('INVALID_ORIGIN');
      const withToken = await rawRequest(port, { path, headers: { ...jsonOnly, origin, [TOKEN_HEADER]: token }, body });
      expect(withToken.status).toBe(403);
      expect(upstream).toHaveBeenCalledTimes(0);
    });
  });

  it('rejects a cross-site text/plain form post (the original attack) before Meta', async () => {
    const upstream = countingFetch(upstreamText);
    await withTokenServer({ fetchImpl: upstream }, async (port) => {
      const reply = await rawRequest(port, { path, headers: { 'content-type': 'text/plain', origin: 'https://untrusted.example' }, body: JSON.stringify(body) });
      expect([403, 415]).toContain(reply.status);
      expect(upstream).toHaveBeenCalledTimes(0);
    });
  });

  it.each([
    ['no Origin and no token', () => ({}) as Record<string, string>],
    ['no Origin and an empty token', () => ({ [TOKEN_HEADER]: '' })],
    ['no Origin and a wrong token', () => ({ [TOKEN_HEADER]: 'f'.repeat(64) })],
    ['no Origin and a token that is only a prefix of the real one', (token: string) => ({ [TOKEN_HEADER]: token.slice(0, 32) })],
    ['no Origin and the real token with extra characters', (token: string) => ({ [TOKEN_HEADER]: `${token}0` })],
    ['an empty Origin and no token', () => ({ origin: '' })],
  ])('rejects %s with 403 and never reaches Meta', async (_label, extra) => {
    const upstream = countingFetch(upstreamText);
    await withTokenServer({ fetchImpl: upstream }, async (port, token) => {
      const reply = await rawRequest(port, { path, headers: { ...jsonOnly, ...extra(token) }, body });
      expect(reply.status).toBe(403);
      expect(upstream).toHaveBeenCalledTimes(0);
    });
  });

  it('rejects a token from a previous start of the backend', async () => {
    const upstream = countingFetch(upstreamText);
    let oldToken = '';
    await withTokenServer({ fetchImpl: upstream }, async (_port, token) => { oldToken = token; });
    await withTokenServer({ fetchImpl: upstream }, async (port, token) => {
      expect(token).not.toBe(oldToken);
      const reply = await rawRequest(port, { path, headers: { ...jsonOnly, [TOKEN_HEADER]: oldToken }, body });
      expect(reply.status).toBe(403);
      expect(upstream).toHaveBeenCalledTimes(0);
    });
  });

  it('rejects a server that has no token file: nobody can know its token', async () => {
    const upstream = countingFetch(upstreamText);
    await withGuardedServer({ fetchImpl: upstream }, async (port) => {
      const reply = await rawRequest(port, { path, headers: { ...jsonOnly, [TOKEN_HEADER]: 'a'.repeat(64) }, body });
      expect(reply.status).toBe(403);
      expect(upstream).toHaveBeenCalledTimes(0);
    });
  });

  it('lets an allowed browser Origin through without a token', async () => {
    const upstream = countingFetch(upstreamText);
    await withTokenServer({ fetchImpl: upstream }, async (port) => {
      const reply = await rawRequest(port, { path, headers: { ...jsonOnly, origin: ALLOWED_ORIGIN }, body });
      expect(reply.status).toBe(200);
      expect(upstream.mock.calls.length).toBeGreaterThan(0);
    });
  });

  it('lets a local script through with the token and no Origin', async () => {
    const upstream = countingFetch(upstreamText);
    await withTokenServer({ fetchImpl: upstream }, async (port, token) => {
      const reply = await rawRequest(port, { path, headers: { ...jsonOnly, [TOKEN_HEADER]: token }, body });
      expect(reply.status).toBe(200);
      expect(upstream.mock.calls.length).toBeGreaterThan(0);
    });
  });
});

describe('local token file', () => {
  it('is written with mode 0600, holds a long random value and is regenerated on every start', async () => {
    const seen: string[] = [];
    for (let run = 0; run < 2; run += 1) {
      await withTokenServer({ fetchImpl: countingFetch() }, async (_port, token, file) => {
        expect(statSync(file).mode & 0o777).toBe(0o600);
        expect(token).toMatch(/^[a-f0-9]{64}$/);
        seen.push(token);
      });
    }
    expect(new Set(seen).size).toBe(2);
  });

  it('is replaced with mode 0600 even when an old file with looser permissions exists', async () => {
    const { chmodSync, mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const directory = mkdtempSync(join(tmpdir(), 'unfold-token-old-'));
    const file = join(directory, 'local-token');
    writeFileSync(file, 'stale\n');
    chmodSync(file, 0o644);
    try {
      await withGuardedServer({ fetchImpl: countingFetch(), localTokenFile: file }, async () => {
        expect(statSync(file).mode & 0o777).toBe(0o600);
      });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('is removed when the server closes', async () => {
    let file = '';
    await withTokenServer({ fetchImpl: countingFetch() }, async (_port, _token, tokenFile) => { file = tokenFile; expect(existsSync(file)).toBe(true); });
    expect(existsSync(file)).toBe(false);
  });

  it('never shows up in logs or in any response, accepted or rejected', async () => {
    const logged: string[] = [];
    for (const method of ['info', 'log', 'warn', 'error'] as const) vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { logged.push(args.map(String).join(' ')); });
    const upstream = countingFetch('ok');
    await withTokenServer({ fetchImpl: upstream }, async (port, token) => {
      const replies = [
        await rawRequest(port, { path: '/api/meta/text', headers: { ...jsonOnly, [TOKEN_HEADER]: token }, body: { prompt: 'x' } }),
        await rawRequest(port, { path: '/api/meta/text', headers: { ...jsonOnly, [TOKEN_HEADER]: `${token}x` }, body: { prompt: 'x' } }),
        await rawRequest(port, { path: '/api/meta/text', headers: { ...jsonOnly, origin: 'https://untrusted.example', [TOKEN_HEADER]: token }, body: { prompt: 'x' } }),
        await rawRequest(port, { path: '/api/meta/text', method: 'GET', headers: { [TOKEN_HEADER]: token } }),
        await rawRequest(port, { path: '/api/meta/text', headers: { 'content-type': 'text/plain', [TOKEN_HEADER]: token }, body: '{}' }),
        await rawRequest(port, { path: '/api/diagnostics', method: 'GET', headers: { [TOKEN_HEADER]: token } }),
      ];
      for (const reply of replies) {
        expect(reply.text).not.toContain(token);
        expect(JSON.stringify(reply.headers)).not.toContain(token);
      }
      expect(logged.length).toBeGreaterThan(0);
      expect(logged.join('\n')).not.toContain(token);
      expect(upstream).toHaveBeenCalledTimes(1);
    });
  });
});

describe('default state files (used by server/index.ts, never by the tests)', () => {
  it('live under ~/.unfold unless UNFOLD_STATE_DIR says otherwise', () => {
    const previous = process.env.UNFOLD_STATE_DIR;
    try {
      delete process.env.UNFOLD_STATE_DIR;
      expect(defaultStateFile('local-token')).toBe(join(homedir(), '.unfold', 'local-token'));
      process.env.UNFOLD_STATE_DIR = '/var/lib/unfold-test';
      expect(defaultStateFile('local-token')).toBe('/var/lib/unfold-test/local-token');
    } finally {
      if (previous === undefined) delete process.env.UNFOLD_STATE_DIR; else process.env.UNFOLD_STATE_DIR = previous;
    }
  });
});
