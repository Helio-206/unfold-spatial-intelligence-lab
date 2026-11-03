import { connect } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PAID_ROUTES } from '../server/meta-server';
import { ALLOWED_ORIGIN, countingFetch, paidRouteCases, rawRequest, withGuardedServer } from './helpers/paid-routes';

const cases = paidRouteCases();
const routes = Object.keys(cases);
const previousNodeEnv = process.env.NODE_ENV;
beforeAll(() => { process.env.NODE_ENV = 'test'; });
afterAll(() => { if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv; });

const json = { 'content-type': 'application/json', origin: ALLOWED_ORIGIN };

describe('paid routes guard: single list', () => {
  it('has a test fixture for every paid route and for nothing else', () => {
    expect([...PAID_ROUTES].sort()).toEqual([...routes].sort());
  });
});

describe.each(routes)('paid route %s: method, content type and Host', (path) => {
  const { body, upstreamText } = cases[path]!;

  it.each(['GET', 'PUT', 'DELETE', 'PATCH'])('rejects %s with 405 and never reaches Meta', async (method) => {
    const upstream = countingFetch(upstreamText);
    await withGuardedServer({ fetchImpl: upstream }, async (port) => {
      const reply = await rawRequest(port, { path, method, headers: json, body: method === 'GET' ? undefined : body });
      expect(reply.status).toBe(405);
      expect(reply.headers.allow).toBe('POST');
      expect(upstream).toHaveBeenCalledTimes(0);
    });
  });

  it.each([
    ['text/plain', 'text/plain'],
    ['text/plain;charset=UTF-8', 'text/plain;charset=UTF-8'],
    ['application/x-www-form-urlencoded', 'application/x-www-form-urlencoded'],
    ['multipart/form-data', 'multipart/form-data; boundary=x'],
    ['application/jsonp (prefix only)', 'application/jsonp'],
    ['application/json-evil (prefix only)', 'application/json-evil'],
    ['no content type', ''],
  ])('rejects %s with 415 and never reaches Meta', async (_label, contentType) => {
    const upstream = countingFetch(upstreamText);
    await withGuardedServer({ fetchImpl: upstream }, async (port) => {
      const headers: Record<string, string> = { origin: ALLOWED_ORIGIN };
      if (contentType) headers['content-type'] = contentType;
      const reply = await rawRequest(port, { path, headers, body });
      expect(reply.status).toBe(415);
      expect(upstream).toHaveBeenCalledTimes(0);
    });
  });

  it.each([
    ['unrelated name', () => 'evil.example'],
    ['rebinding name with the right port', (port: number) => `evil.example:${port}`],
    ['allowed name as a prefix of another', (port: number) => `localhost.evil.example:${port}`],
    ['allowed name without port', () => '127.0.0.1'],
    ['allowed name, wrong port', () => '127.0.0.1:9'],
    ['other loopback form', (port: number) => `[::1]:${port}`],
  ])('rejects Host: %s with 421 and never reaches Meta', async (_label, host) => {
    const upstream = countingFetch(upstreamText);
    await withGuardedServer({ fetchImpl: upstream }, async (port) => {
      const reply = await rawRequest(port, { path, headers: { ...json, host: host(port) }, body });
      expect(reply.status).toBe(421);
      expect(upstream).toHaveBeenCalledTimes(0);
    });
  });

  it.each([
    ['127.0.0.1 with the backend port', (port: number) => `127.0.0.1:${port}`],
    ['localhost with the backend port', (port: number) => `localhost:${port}`],
    ['LOCALHOST is case-insensitive', (port: number) => `LOCALHOST:${port}`],
    ['127.0.0.1 with the Vite port (proxy keeps Host)', () => '127.0.0.1:5173'],
    ['localhost with the Vite port (proxy keeps Host)', () => 'localhost:5173'],
  ])('lets the normal request through: %s', async (_label, host) => {
    const upstream = countingFetch(upstreamText);
    await withGuardedServer({ fetchImpl: upstream }, async (port) => {
      const prepared = cases[path]!.prepare ? await cases[path]!.prepare!(port, json) : {};
      const reply = await rawRequest(port, { path, headers: { ...json, host: host(port) }, body: { ...(body as Record<string, unknown>), ...prepared } });
      expect(reply.status).toBe(200);
      expect(upstream.mock.calls.length).toBeGreaterThan(0);
    });
  });

  it('accepts application/json with parameters and any letter case', async () => {
    const upstream = countingFetch(upstreamText);
    await withGuardedServer({ fetchImpl: upstream }, async (port) => {
      const prepared = cases[path]!.prepare ? await cases[path]!.prepare!(port, json) : {};
      const reply = await rawRequest(port, { path, headers: { origin: ALLOWED_ORIGIN, 'content-type': 'Application/JSON; charset=utf-8' }, body: { ...(body as Record<string, unknown>), ...prepared } });
      expect(reply.status).toBe(200);
      expect(upstream.mock.calls.length).toBeGreaterThan(0);
    });
  });

  it('runs before the API key check, so a rejected request learns nothing about configuration', async () => {
    const upstream = countingFetch(upstreamText);
    await withGuardedServer({ apiKey: '', fetchImpl: upstream }, async (port) => {
      const reply = await rawRequest(port, { path, headers: { origin: ALLOWED_ORIGIN, 'content-type': 'text/plain' }, body });
      expect(reply.status).toBe(415);
      expect(upstream).toHaveBeenCalledTimes(0);
    });
  });
});

describe('degenerate Host headers', () => {
  // O cliente http do Node recusa enviar Host vazio, por isso vai por socket cru.
  const rawStatusLine = (port: number, path: string, hostLine: string, body: string) => new Promise<string>((resolve) => {
    const socket = connect(port, '127.0.0.1');
    socket.write(`POST ${path} HTTP/1.1\r\n${hostLine}Origin: ${ALLOWED_ORIGIN}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
    let received = '';
    socket.on('data', (chunk) => { received += chunk; });
    socket.on('close', () => resolve(received.split('\r\n')[0]!));
  });

  it.each(routes)('rejects an empty or missing Host on %s without reaching Meta', async (path) => {
    const upstream = countingFetch(cases[path]!.upstreamText);
    await withGuardedServer({ fetchImpl: upstream }, async (port) => {
      const body = JSON.stringify(cases[path]!.body);
      expect(await rawStatusLine(port, path, 'Host: \r\n', body)).toContain(' 421 ');
      expect(await rawStatusLine(port, path, '', body)).toContain(' 400 ');
      expect(upstream).toHaveBeenCalledTimes(0);
    });
  });
});

describe('routes outside the paid list', () => {
  it('keep answering 404 for unknown paths and leave health and diagnostics alone', async () => {
    const upstream = countingFetch();
    await withGuardedServer({ fetchImpl: upstream }, async (port) => {
      expect((await rawRequest(port, { path: '/api/unknown', method: 'POST', headers: json, body: {} })).status).toBe(404);
      expect((await rawRequest(port, { path: '/api/health', method: 'GET' })).status).toBe(200);
      expect((await rawRequest(port, { path: '/api/diagnostics', method: 'GET' })).status).toBe(200);
      expect(upstream).toHaveBeenCalledTimes(0);
    });
  });
});
