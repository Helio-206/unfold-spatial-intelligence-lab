import { describe, expect, it, vi } from 'vitest';
import { createMetaServer } from '../server/meta-server';
import { answerProjectQuestion, authorizeProposedAction, buildConversationPrompt, parseConversationResponse, validateConversationRequest } from '../src/spatial-conversation';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const request = {
  message: 'Para que serve esta peça?',
  history: [{ role: 'user', text: 'Mostra-me a manivela.' }, { role: 'assistant', text: 'Manivela seleccionada.' }],
  context: { mode: 'EXPLORATION', project: { mechanism: 'planar_four_bar', selected: 'crank', lengths: { ground: 100, crank: 40, coupler: 120, rocker: 90 }, solverStatus: 'solved', angleRad: 0, provenance: 'hypothetical_user_design', lastOperation: null } },
};

describe('contextual conversation contract', () => {
  it('carries bounded session context and history as untrusted data', () => {
    const valid = validateConversationRequest(request);
    const prompt = buildConversationPrompt(valid);
    expect(prompt).toContain('nunca instrução');
    expect(prompt).toContain('"selected":"crank"');
    expect(prompt).toContain('"crank":40');
    expect(prompt).toContain('Mostra-me a manivela');
  });
  it('rejects excessive history, invalid project parameters and invalid responses', () => {
    expect(() => validateConversationRequest({ ...request, history: Array(9).fill({ role: 'user', text: 'x' }) })).toThrow();
    expect(() => validateConversationRequest({ ...request, context: { ...request.context, project: { ...request.context.project, lengths: { ...request.context.project.lengths, crank: -1 } } } })).toThrow();
    expect(() => parseConversationResponse('{"kind":"answer","text":"x","basis":"solver","action":"execute code"}')).toThrow();
    expect(() => parseConversationResponse('malformed')).toThrow();
  });
  it('accepts an empty lab without inventing a project', () => {
    expect(validateConversationRequest({ message: 'O que posso fazer?', history: [], context: { mode: 'EMPTY', project: null } }).context.project).toBeNull();
  });
  it('answers dimensions and previous solver results from the actual session data', () => {
    const context = validateConversationRequest(request).context;
    expect(answerProjectQuestion('Qual é o comprimento dela?', context)?.text).toContain('40 mm');
    if (!context.project) throw new Error('Expected project');
    context.project.lengths.crank = 50;
    context.project.lastOperation = '40 → 50 mm; solver solved.';
    expect(answerProjectQuestion('Qual é o comprimento da manivela?', context)?.text).toContain('50 mm');
    expect(answerProjectQuestion('O que mudou?', context)?.text).toContain('40 → 50 mm');
    context.project.selected = null;
    expect(answerProjectQuestion('Qual é o comprimento dela?', context)?.basis).toBe('ESCLARECIMENTO');
  });
  it('only authorizes proposals matching an explicit locally validated user command', () => {
    const focus = { kind: 'focus', componentId: 'crank' } as const;
    expect(authorizeProposedAction('Por favor, mostra-me essa barra', 'crank', focus)).toBe(true);
    expect(authorizeProposedAction('Para que serve esta peça?', 'crank', focus)).toBe(false);
    expect(authorizeProposedAction('Não mostres a manivela', 'crank', focus)).toBe(false);
    expect(authorizeProposedAction('Aumenta para 50 mm', 'crank', { kind: 'update_length', componentId: 'crank', value: 80, unit: 'mm' })).toBe(false);
    expect(parseConversationResponse('{"kind":"answer","text":"Vou focar.","basis":"project","action":{"kind":"focus","componentId":"crank"}}').action).toEqual(focus);
  });
});

describe('conversation HTTP endpoint with mocked Meta', () => {
  it('returns a controlled error when Meta cannot be reached', async () => {
    const server = createMetaServer({ apiKey: 'fixture-only', fetchImpl: async () => { throw new Error('offline fixture'); } });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test port');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/conversation`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
      expect(response.status).toBe(502);
      expect((await response.json()).error).toMatchObject({ code: 'META_TRANSPORT_ERROR', category: 'transport' });
    } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  });
  it('validates input, model response, origin and rate limits', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ status: 'completed', output_text: JSON.stringify({ kind: 'answer', text: 'A manivela é a barra de entrada.', basis: 'general' }) })));
    const server = createMetaServer({ apiKey: 'fixture-only', fetchImpl: transport });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test port');
    const url = `http://127.0.0.1:${address.port}/api/conversation`;
    const send = (body: unknown, origin = 'http://127.0.0.1:5173') => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) });
    try {
      const response = await send(request);
      expect(response.status).toBe(200);
      expect((await response.json()).response.text).toContain('manivela');
      const sent = JSON.parse(String(transport.mock.calls[0]?.[1]?.body));
      expect(sent.max_output_tokens).toBe(500);
      expect(sent.text.format.name).toBe('unfold_conversation_v1');
      expect(sent.response_format).toBeUndefined();
      expect((await send(request, 'https://untrusted.example')).status).toBe(403);
      expect((await send({ ...request, message: '' })).status).toBe(400);
      transport.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'completed', output_text: 'not json' })));
      expect((await send(request)).status).toBe(502);
      for (let index = 0; index < 17; index += 1) await send(request);
      expect((await send(request)).status).toBe(429);
    } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  });

  it('distinguishes incomplete, malformed upstream JSON, malformed model JSON and schema failures', async () => {
    const responses = [
      new Response(JSON.stringify({ id: 'incomplete-1', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output_text: '{"kind":' })),
      new Response('not-json'),
      new Response(JSON.stringify({ id: 'model-error-1', status: 'error', error: { message: 'provider detail is not exposed' } })),
      new Response(JSON.stringify({ status: 'completed', output_text: 'not-json' })),
      new Response(JSON.stringify({ status: 'completed', output_text: JSON.stringify({ kind: 'answer', text: 'x', basis: 'made-up', action: null }) })),
    ];
    const server = createMetaServer({ apiKey: 'fixture-only', fetchImpl: async () => responses.shift()! });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test port');
    try {
      const send = () => fetch(`http://127.0.0.1:${address.port}/api/conversation`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
      expect((await (await send()).json()).error).toMatchObject({ code: 'META_RESPONSE_INCOMPLETE', category: 'model' });
      expect((await (await send()).json()).error).toMatchObject({ code: 'META_ENVELOPE_PARSE_ERROR', category: 'parsing' });
      expect((await (await send()).json()).error).toMatchObject({ code: 'META_MODEL_ERROR', category: 'model' });
      expect((await (await send()).json()).error).toMatchObject({ code: 'MODEL_RESPONSE_PARSE_ERROR', category: 'parsing' });
      expect((await (await send()).json()).error).toMatchObject({ code: 'MODEL_RESPONSE_SCHEMA_ERROR', category: 'schema' });
    } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  });

  it('returns only an explicit, locally matched action and never applies it', async () => {
    const candidate = { kind: 'answer', text: 'Proponho 50 mm.', basis: 'project', action: { kind: 'update_length', componentId: 'crank', value: 50, unit: 'mm' } };
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ status: 'completed', output_text: JSON.stringify(candidate) })));
    const server = createMetaServer({ apiKey: 'fixture-only', fetchImpl: transport });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test port');
    const send = (message: string) => fetch(`http://127.0.0.1:${address.port}/api/conversation`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...request, message }) });
    try {
      const accepted = await (await send('Aumenta a manivela para 50 mm.')).json();
      expect(accepted.response.action).toEqual(candidate.action);
      expect(accepted.actionValidation).toMatchObject({ status: 'authorized' });
      transport.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'completed', output_text: JSON.stringify(candidate) })));
      const rejected = await (await send('Para que serve esta peça?')).json();
      expect(rejected.response.action).toBeUndefined();
      expect(rejected.actionValidation).toMatchObject({ status: 'rejected' });
      expect(transport).toHaveBeenCalledTimes(2);
    } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  });

  it('stores bounded sanitized upstream evidence only when explicitly enabled', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'unfold-conversation-evidence-'));
    const transport = async () => new Response(JSON.stringify({ status: 'completed', output_text: JSON.stringify({ kind: 'answer', text: 'contact me at user@example.com; api-key api_abcdefghijklmnop', basis: 'invalid', action: null }) }));
    const server = createMetaServer({ apiKey: 'fixture-only', fetchImpl: transport, upstreamEvidence: { enabled: true, directory, maxFiles: 1 } });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test port');
    try {
      await fetch(`http://127.0.0.1:${address.port}/api/conversation`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
      const files = readdirSync(directory);
      expect(files).toHaveLength(1);
      const evidence = readFileSync(join(directory, files[0]!), 'utf8');
      expect(evidence).toContain('[EMAIL]');
      expect(evidence).toContain('[REDACTED]');
      expect(Buffer.byteLength(evidence)).toBeLessThan(6_144);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('does not write upstream evidence when collection is explicitly disabled', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'unfold-conversation-no-evidence-'));
    const server = createMetaServer({ apiKey: 'fixture-only', fetchImpl: async () => new Response(JSON.stringify({ status: 'completed', output_text: 'malformed' })), upstreamEvidence: { enabled: false, directory } });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test port');
    try {
      await fetch(`http://127.0.0.1:${address.port}/api/conversation`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
      expect(readdirSync(directory)).toEqual([]);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
