import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMetaServer } from '../server/meta-server';
import { createPhase3DReferenceFixture } from '../src/phase3d-fixture';

const validJpegDataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAgAAAQABAAD//gAPTGF2YzYxLjMuMTAwAP/bAEMACAQEBAQEBQUFBQUFBgYGBgYGBgYGBgYGBgcHBwgICAcHBwYGBwcICAgICQkJCAgICAkJCgoKDAwLCw4ODhERFP/EAEsAAQEAAAAAAAAAAAAAAAAAAAAHAQEAAAAAAAAAAAAAAAAAAAAAEAEAAAAAAAAAAAAAAAAAAAAAEQEAAAAAAAAAAAAAAAAAAAAA/8AAEQgACAAIAwEiAAIRAAMRAP/aAAwDAQACEQMRAD8Av4AP/9k=';
function initializeTestBudget(path: string, limit: number): void { writeFileSync(path, JSON.stringify({ limit, used: 0 }) + '\n', { mode: 0o600, flag: 'wx' }); }

function technicalDocument(domain: string, label: string, rawValue: string | null = null, unit: string | null = null) {
  const kind = domain === 'mechanical' ? 'bar' : 'room_or_component';
  return {
    schema: 'technical_document.v1', documentType: 'planta técnica', primaryDomain: domain, secondaryDomains: [],
    classification: { confidence: 0.95, evidence: 'rótulos e símbolos visíveis', rationale: 'Interpretação do documento com evidência.' },
    summary: 'Documento técnico analisado sem reconstrução geométrica.',
    elements: [{ id: 'item-1', kind, label, status: 'observed', evidence: 'rótulo impresso na imagem', confidence: 0.9, rawValue, value: rawValue ? Number.parseFloat(rawValue) : null, unit }],
    relations: [], observedText: [], ambiguities: ['topologia não confirmável'], missingInformation: ['escala e ligações completas'],
    capabilities: ['canExplain', 'canInspect', 'canEditSemanticData', 'canVisualize2D', 'canConstruct3D', 'canSimulate', 'canRunWhatIf'].map((id) => ({ id, state: id === 'canExplain' || id === 'canInspect' ? 'available' : 'blocked', reason: 'Teste estrutural; visualização ou simulação exige mais dados.', dependencies: [], missing: [], engine: null })),
    questions: [{ id: 'q1', question: 'O que consegues identificar?', answer: 'O elemento indicado é visível na imagem.', basis: 'observed', sourceIds: ['item-1'] }],
  };
}

function recognition(domain: string) {
  return {
    schema: 'technical_recognition.v2', primaryDomain: domain, secondaryDomains: [],
    documentType: domain === 'architecture' ? 'planta residencial' : 'desenho mecânico',
    summary: 'Sinais visuais resumidos para orientar uma extracção especializada.',
    legibility: 'medium',
    route: domain === 'unknown' ? 'stop_unknown' : 'extract',
  };
}

function metaOutput(text: string, id: string) {
  return new Response(JSON.stringify({ id, status: 'completed', output_text: text, usage: { input_tokens: 12, output_tokens: 34, total_tokens: 46, output_tokens_details: { reasoning_tokens: 5 } } }), { status: 200, headers: { 'x-request-id': id } });
}

describe('phase 3D backend route', () => {
  it('exposes the phase4c health contract without checking MODEL_API_KEY', async () => {
    const server = createMetaServer({ apiKey: undefined });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Porta de teste indisponível.');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ status: 'ok', contract: 'unfold.phase4c' });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('exposes explicit diagnostics without leaking the key and reports the bounded call budget', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'unfold-budget-diagnostics-'));
    const budgetFile = join(directory, 'budget.json'); initializeTestBudget(budgetFile, 2);
    const server = createMetaServer({ apiKey: 'fixture-secret-must-not-appear', maxMetaCalls: 2, metaCallBudgetFile: budgetFile });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Porta de teste indisponível.');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/diagnostics`);
      const text = await response.text();
      expect(response.status).toBe(200);
      expect(text).not.toContain('fixture-secret');
      expect(JSON.parse(text)).toMatchObject({ contractVersion: 'unfold.backend.v1', pipelineVersion: 'unfold.image_pipeline.ab.v2', recognitionSchemaVersion: 'technical_recognition.v2', metaCallBudget: { limit: 2, used: 0, remaining: 2 }, capabilities: { imageAnalysis: { apiKeyConfigured: true, responseContract: 'unfold.image_analysis.v1' } } });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects a hard call limit without a durable shared budget file', () => {
    expect(() => createMetaServer({ apiKey: 'fixture-only', maxMetaCalls: 1 })).toThrow('UNFOLD_ACCEPTANCE_BUDGET_FILE');
  });

  it('fails closed instead of treating a missing configured ledger as a fresh budget', () => {
    const directory = mkdtempSync(join(tmpdir(), 'unfold-budget-missing-'));
    try { expect(() => createMetaServer({ apiKey: 'fixture-only', maxMetaCalls: 1, metaCallBudgetFile: join(directory, 'deleted-ledger.json') })).toThrow('META_CALL_BUDGET_FILE_MISSING'); }
    finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('fails fast with an actionable error for a stale truncated budget lock', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'unfold-budget-corrupt-lock-'));
    const budgetFile = join(directory, 'budget.json');
    initializeTestBudget(budgetFile, 1);
    writeFileSync(`${budgetFile}.lock`, '');
    const old = new Date(Date.now() - 5000);
    utimesSync(`${budgetFile}.lock`, old, old);
    const server = createMetaServer({ apiKey: 'fixture-only', fetchImpl: vi.fn<typeof fetch>(), maxMetaCalls: 1, metaCallBudgetFile: budgetFile });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Porta de teste indisponível.');
    try {
      const before = Date.now();
      const response = await fetch(`http://127.0.0.1:${address.port}/api/meta/text`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'test' }) });
      expect(response.status).toBe(503);
      expect(Date.now() - before).toBeLessThan(1500);
      expect((await response.json()).error.code).toBe('META_BUDGET_LOCK_CORRUPT');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('recovers a stale budget-lock reclaimer left by a dead process', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'unfold-budget-stale-reclaimer-'));
    const budgetFile = join(directory, 'budget.json');
    initializeTestBudget(budgetFile, 1);
    const lockPath = `${budgetFile}.lock`;
    const reclaimPath = `${lockPath}.reclaim`;
    const oldIso = new Date(Date.now() - 5_000).toISOString();
    const old = new Date(Date.now() - 5_000);
    writeFileSync(lockPath, JSON.stringify({ pid: 2_147_483_647, createdAt: oldIso }));
    utimesSync(lockPath, old, old);
    mkdirSync(reclaimPath);
    writeFileSync(`${reclaimPath}/owner.json`, JSON.stringify({ pid: 2_147_483_646, createdAt: oldIso }));
    utimesSync(reclaimPath, old, old);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(metaOutput('ok', 'after-stale-reclaimer'));
    const server = createMetaServer({ apiKey: 'fixture-only', fetchImpl: fetchMock, maxMetaCalls: 1, metaCallBudgetFile: budgetFile });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Porta de teste indisponível.');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/meta/text`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'test' }) });
      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(JSON.parse(readFileSync(budgetFile, 'utf8'))).toMatchObject({ limit: 1, used: 1 });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps the acceptance call budget across a backend restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'unfold-budget-'));
    const budgetFile = join(directory, 'budget.json');
    initializeTestBudget(budgetFile, 1);
    const serverFor = (fetchImpl: typeof fetch) => createMetaServer({ apiKey: 'fixture-only', fetchImpl, maxMetaCalls: 1, metaCallBudgetFile: budgetFile });
    const send = (port: number) => fetch(`http://127.0.0.1:${port}/api/meta/text`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'test' }) });
    const start = async (server: ReturnType<typeof createMetaServer>) => {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Porta de teste indisponível.');
      return address.port;
    };
    const stop = (server: ReturnType<typeof createMetaServer>) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    const successfulProvider = vi.fn<typeof fetch>().mockResolvedValue(metaOutput('ok', 'first-budget-call'));
    const firstServer = serverFor(successfulProvider);
    try {
      const firstPort = await start(firstServer);
      expect((await send(firstPort)).status).toBe(200);
      await stop(firstServer);

      const providerMustNotRun = vi.fn<typeof fetch>();
      const restartedServer = serverFor(providerMustNotRun);
      const restartedPort = await start(restartedServer);
      try {
        const response = await send(restartedPort);
        expect(response.status).toBe(429);
        expect((await response.json()).error.code).toBe('META_CALL_BUDGET_EXHAUSTED');
        expect(providerMustNotRun).not.toHaveBeenCalled();
      } finally { await stop(restartedServer); }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('enforces one shared file-backed Meta call slot across concurrently active server instances', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'unfold-budget-concurrent-'));
    const budgetFile = join(directory, 'budget.json');
    initializeTestBudget(budgetFile, 1);
    const provider = vi.fn<typeof fetch>().mockResolvedValue(metaOutput('ok', 'shared-budget-call'));
    const servers = [0, 1].map(() => createMetaServer({ apiKey: 'fixture-only', fetchImpl: provider, maxMetaCalls: 1, metaCallBudgetFile: budgetFile }));
    const ports: number[] = [];
    try {
      for (const server of servers) {
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Porta de teste indisponível.');
        ports.push(address.port);
      }
      const responses = await Promise.all(ports.map((port) => fetch(`http://127.0.0.1:${port}/api/meta/text`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'test' }) })));
      expect(responses.map((response) => response.status).sort()).toEqual([200, 429]);
      expect(provider).toHaveBeenCalledOnce();
      expect(JSON.parse(readFileSync(budgetFile, 'utf8'))).toMatchObject({ limit: 1, used: 1 });
    } finally {
      await Promise.all(servers.map((server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))));
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps stale-lock recovery and the hard budget serialized across OS processes', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'unfold-budget-processes-'));
    const budgetFile = join(directory, 'budget.json');
    initializeTestBudget(budgetFile, 1);
    const lockPath = budgetFile + '.lock';
    const old = new Date(Date.now() - 5000).toISOString();
    writeFileSync(lockPath, JSON.stringify({ pid: 2147483647, createdAt: old }));
    const stale = new Date(Date.now() - 5000);
    utimesSync(lockPath, stale, stale);
    const workerFile = fileURLToPath(new URL('./meta-budget-worker.mjs', import.meta.url));
    const workers: ChildProcess[] = [];
    const ready = (worker: ChildProcess) => new Promise<number>((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Worker readiness timeout: ' + output)), 10_000);
      worker.stdout!.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        const line = output.split('\n')[0];
        if (!line) return;
        clearTimeout(timer);
        try { resolve(JSON.parse(line).port as number); } catch (error) { reject(error); }
      });
      worker.once('error', reject);
      worker.once('exit', (code) => reject(new Error('Worker exited before readiness (' + code + ').')));
    });
    try {
      const ports = await Promise.all([0, 1].map(async () => {
        const worker = spawn(process.execPath, ['--import', 'tsx', workerFile], { env: { ...process.env, UNFOLD_TEST_BUDGET_FILE: budgetFile }, stdio: ['ignore', 'pipe', 'pipe'] });
        workers.push(worker);
        return ready(worker);
      }));
      const results = await Promise.all(ports.map(async (port) => {
        const response = await fetch('http://127.0.0.1:' + port + '/api/meta/text', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'test' }) });
        return response.status;
      }));
      expect(results.sort()).toEqual([200, 429]);
      expect(JSON.parse(readFileSync(budgetFile, 'utf8'))).toMatchObject({ limit: 1, used: 1 });
    } finally {
      for (const worker of workers) worker.kill('SIGTERM');
      await Promise.all(workers.map((worker) => new Promise<void>((resolve) => worker.once('exit', () => resolve()))));
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('calls the injected Meta transport and returns the validated experiment result', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    const fixture = createPhase3DReferenceFixture();
    const server = createMetaServer({
      apiKey: 'test-key-not-real',
      fetchImpl: async () => new Response(JSON.stringify({
        id: 'fixture-request-id',
        status: 'completed',
        output_text: '{"schema":"kinematic_operation.v1","action":"update_length","componentId":"crank","newValue":80,"unit":"mm"}',
        usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
      }), { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'fixture-request-id' } }),
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Porta de teste indisponível.');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/kinematics/experiment`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instruction: 'Aumenta a manivela.', graph: fixture.graph, assembly: fixture.assembly, mode: 'TEST_FIXTURE_ONLY' }),
      });
      const body = await response.json() as { status?: string; operation?: { newValue?: number }; meta?: { requestId?: string } };
      expect(response.status).toBe(200);
      expect(body.status).toBe('executed');
      expect(body.operation?.newValue).toBe(80);
      expect(body.meta?.requestId).toBe('fixture-request-id');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it('rejects the test fixture outside explicit test mode', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const fixture = createPhase3DReferenceFixture();
    const server = createMetaServer({ apiKey: 'test-key-not-real', fetchImpl: async () => { throw new Error('Meta must not be called.'); } });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Porta de teste indisponível.');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/kinematics/experiment`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instruction: 'Aumenta a manivela.', graph: fixture.graph, assembly: fixture.assembly, mode: 'TEST_FIXTURE_ONLY' }),
      });
      expect(response.status).toBe(403);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });
});

describe('image understanding backend route', () => {
  async function withServer(fetchImpl: typeof fetch, callback: (port: number) => Promise<void>, options: { maxMetaCalls?: number } = {}): Promise<void> {
    const budgetDirectory = options.maxMetaCalls === undefined ? undefined : mkdtempSync(join(tmpdir(), 'unfold-budget-stage-'));
    const budgetFile = budgetDirectory ? join(budgetDirectory, 'budget-' + randomUUID() + '.json') : undefined;
    if (budgetFile && options.maxMetaCalls !== undefined) initializeTestBudget(budgetFile, options.maxMetaCalls);
    const server = createMetaServer({ apiKey: 'test-key-not-real', fetchImpl, ...options, ...(budgetFile ? { metaCallBudgetFile: budgetFile } : {}) });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Porta de teste indisponível.');
    try {
      await callback(address.port);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      if (budgetDirectory) rmSync(budgetDirectory, { recursive: true, force: true });
    }
  }

  it.each(['/api/meta/text', '/api/meta/image', '/api/meta/image/verify-region', '/api/meta/grounding', '/api/kinematics/experiment', '/api/experiments/preview', '/api/conversation', '/api/spatial-agent'])('rejects disallowed origins on every billable API route (%s)', async (path) => {
    const fetchMock = vi.fn<typeof fetch>();
    await withServer(fetchMock, async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: 'POST',
        headers: { origin: 'https://attacker.invalid', 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'not sent upstream' }),
      });
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe('INVALID_ORIGIN');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it('rejects non-JSON requests to billable routes before reading the body', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    await withServer(fetchMock, async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/meta/text`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'prompt' });
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe('INVALID_ORIGIN');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it('uses the exact source bytes and structured Responses output for visual grounding', async () => {
    const output = { schema: 'visual_grounding_response.v1', summary: 'Planta residencial com limites visíveis.', elements: [], relations: [], limitations: ['Sem escala.'] };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(metaOutput(JSON.stringify(output), 'visual-grounding-request-id'));
    const bytes = Buffer.from(validJpegDataUrl.split(',')[1]!, 'base64');
    const source = { sha256: createHash('sha256').update(bytes).digest('hex'), width: 8, height: 8, mimeType: 'image/jpeg' };
    await withServer(fetchMock, async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/meta/grounding`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ imageDataUrl: validJpegDataUrl, image: source, document: null }) });
      expect(response.status).toBe(200);
      const body = await response.json() as { grounding?: { schema?: string; sourceImage?: { sha256?: string }; provider?: string; elements?: unknown[] }; meta?: { requestId?: string } };
      expect(body.grounding).toMatchObject({ schema: 'visual_grounding.v1', provider: 'muse-spark-1.3', sourceImage: { sha256: source.sha256, width: 8, height: 8, coordinateSystem: 'normalized_0_1000_top_left' }, elements: [] });
      expect(body.meta?.requestId).toBe('visual-grounding-request-id');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
      expect(payload).toMatchObject({ model: 'muse-spark-1.3', reasoning: { effort: 'low' }, max_output_tokens: 8_192, text: { format: { type: 'json_schema', name: 'visual_grounding_response_v1', strict: true } } });
      expect(payload.input[0].content[1]).toMatchObject({ type: 'input_image', image_url: validJpegDataUrl, detail: 'high' });
    });
  });

  it('rejects visual grounding when hash or declared dimensions do not match the uploaded bytes, without a Meta call', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const bytes = Buffer.from(validJpegDataUrl.split(',')[1]!, 'base64');
    const source = { sha256: createHash('sha256').update(bytes).digest('hex'), width: 9, height: 8, mimeType: 'image/jpeg' };
    await withServer(fetchMock, async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/meta/grounding`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ imageDataUrl: validJpegDataUrl, image: source, document: null }) });
      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe('GROUNDING_IMAGE_IDENTITY_MISMATCH');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it('applies one per-peer rate limit across billable model routes', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => metaOutput('ok', randomUUID()));
    await withServer(fetchMock, async (port) => {
      const request = (path: string) => fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'test' }) });
      for (let index = 0; index < 20; index += 1) expect((await request('/api/meta/text')).status).toBe(200);
      const limited = await request('/api/meta/text');
      expect(limited.status).toBe(429);
      expect((await limited.json()).error.code).toBe('RATE_LIMITED');
      expect(fetchMock).toHaveBeenCalledTimes(20);
    });
  });

  it('validates the image, calls the multimodal client and returns structured JSON', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(metaOutput(JSON.stringify(recognition('mechanical')), 'recognition-request-id'))
      .mockResolvedValueOnce(metaOutput(JSON.stringify(technicalDocument('mechanical', 'visible bar')), 'image-request-id'));
    await withServer(fetchMock, async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/meta/image`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ imageDataUrl: validJpegDataUrl }),
      });
      const body = await response.json() as { contract?: string; status?: string; document?: { primaryDomain?: string; capabilities?: unknown[] }; observation?: { elements?: unknown[] }; meta?: { requestId?: string; stages?: unknown[] } };
      expect(response.status).toBe(200);
      expect(body.status).toBe('PARTIAL');
      expect(body.contract).toBe('unfold.image_analysis.v1');
      expect(body.document?.primaryDomain).toBe('mechanical');
      expect(body.document?.capabilities).toHaveLength(7);
      expect(body.observation?.elements).toHaveLength(1);
      expect(body.meta?.requestId).toBe('image-request-id');
      expect(body.meta?.stages).toHaveLength(2);
      expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain('input_image');
      expect(String(fetchMock.mock.calls[0]?.[1]?.body)).not.toContain('MODEL_API_KEY');
    });
  });

  it('blocks stage B at the hard budget boundary after exactly one provider call', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(metaOutput(JSON.stringify(recognition('architecture')), 'budget-recognition'));
    await withServer(fetchMock, async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/meta/image`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ imageDataUrl: validJpegDataUrl }) });
      const body = await response.json() as { status?: string; extraction?: { status?: string; errorCode?: string }; meta?: { callBudget?: { used?: number; remaining?: number } } };
      expect(response.status).toBe(200);
      expect(body.status).toBe('PARTIAL');
      expect(body.extraction).toMatchObject({ status: 'error', errorCode: 'META_CALL_BUDGET_EXHAUSTED' });
      expect(body.meta?.callBudget).toMatchObject({ used: 1, remaining: 0 });
      expect(fetchMock).toHaveBeenCalledOnce();
    }, { maxMetaCalls: 1 });
  });

  it.each([
    ['legacy analysis envelope', new Response(JSON.stringify({ status: 'completed', analysis: { domain: 'architecture' }, output_text: '{"domain":"architecture"}' }), { status: 200 }), 'SCHEMA_INVALID'],
    ['unexpected Responses envelope', new Response(JSON.stringify({ analysis: { domain: 'architecture' } }), { status: 200 }), 'UPSTREAM_ENVELOPE_UNEXPECTED'],
    ['invalid upstream JSON', new Response('not-json', { status: 200 }), 'UPSTREAM_INVALID_JSON'],
  ])('rejects %s through the HTTP route without treating it as a current result', async (_label, result, expectedCode) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(result as Response);
    await withServer(fetchMock, async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/meta/image`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ imageDataUrl: validJpegDataUrl }) });
      const body = await response.json() as { error?: { code?: string }; meta?: { upstreamEnvelope?: { fields?: string[] } } };
      expect(response.status).toBe(502);
      expect(body.error?.code).toBe(expectedCode);
      expect(JSON.stringify(body)).not.toContain('architecture');
      expect(fetchMock).toHaveBeenCalledOnce();
    });
  });

  it('classifies an architectural document and returns the domain-specific structured contract', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(metaOutput(JSON.stringify(recognition('architecture')), 'recognition-document-id'))
      .mockResolvedValueOnce(metaOutput(JSON.stringify(technicalDocument('architecture', 'Cozinha', '23.39', 'm²')), 'document-request-id'));
    await withServer(fetchMock, async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/meta/image`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ imageDataUrl: validJpegDataUrl }) });
      const body = await response.json() as { document?: { primaryDomain?: string; elements?: unknown[]; questions?: unknown[] }; observation?: unknown };
      expect(response.status).toBe(200);
      expect(body.document?.primaryDomain).toBe('architecture');
      expect(body.document?.elements).toHaveLength(1);
      expect(body.document?.questions).toHaveLength(1);
      expect(body.observation).toBeNull();
      const recognitionRequest = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
      const extractionRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
      expect(JSON.stringify(recognitionRequest.text.format)).toContain('technical_recognition_v2');
      expect(JSON.stringify(extractionRequest.input)).toContain('architecture');
      expect(JSON.stringify(extractionRequest.text.format)).toContain('technical_document_v1');
      expect(recognitionRequest.response_format).toBeUndefined();
    });
  });

  it('accepts an electrical document through the complete A/B HTTP pipeline without changing units', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(metaOutput(JSON.stringify(recognition('electrical_installation')), 'electrical-recognition-id'))
      .mockResolvedValueOnce(metaOutput(JSON.stringify(technicalDocument('electrical_installation', 'Carga identificada', '100 VA', 'VA')), 'electrical-extraction-id'));
    await withServer(fetchMock, async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/meta/image`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ imageDataUrl: validJpegDataUrl }) });
      const body = await response.json() as { contract?: string; document?: { primaryDomain?: string; elements?: Array<{ rawValue?: string; unit?: string }> } };
      expect(response.status).toBe(200);
      expect(body.contract).toBe('unfold.image_analysis.v1');
      expect(body.document?.primaryDomain).toBe('electrical_installation');
      expect(body.document?.elements?.[0]).toMatchObject({ rawValue: '100 VA', unit: 'VA' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  it('classifies network failure at the actual image HTTP boundary without retrying', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error('fixture network outage'));
    await withServer(fetchMock, async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/meta/image`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ imageDataUrl: validJpegDataUrl }) });
      const body = await response.json() as { contract?: string; error?: { code?: string }; meta?: { latencyMs?: number } };
      expect(response.status).toBe(502);
      expect(body.contract).toBe('unfold.image_analysis.v1');
      expect(body.error?.code).toBe('TRANSPORT_ERROR');
      expect(body.meta?.latencyMs).toEqual(expect.any(Number));
      expect(fetchMock).toHaveBeenCalledOnce();
    });
  });

  it('rejects an invalid image before calling Meta', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    await withServer(fetchMock, async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/meta/image`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ imageDataUrl: 'data:image/jpeg;base64,ZmFrZQ==' }),
      });
      expect(response.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it('returns a controlled error for malformed Meta JSON', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(metaOutput('{"elements":[]}', 'bad-response-id'));
    await withServer(fetchMock, async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/meta/image`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ imageDataUrl: validJpegDataUrl }),
      });
      const body = await response.json() as { error?: { code?: string }; meta?: { requestId?: string } };
      expect(response.status).toBe(502);
      expect(body.error?.code).toBe('SCHEMA_INVALID');
      expect(body.meta?.requestId).toBe('bad-response-id');
    });
  });

  it('distinguishes an incomplete HTTP 200 response from invalid JSON and schema errors', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ id: 'incomplete-id', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [], usage: { input_tokens: 517, output_tokens: 700, total_tokens: 1_217, output_tokens_details: { reasoning_tokens: 668 } } }), { status: 200 }));
    await withServer(fetchMock, async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/meta/image`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ imageDataUrl: validJpegDataUrl }) });
      const body = await response.json() as { error?: { code?: string; message?: string }; meta?: { requestId?: string; stages?: Array<{ incompleteReason?: string; maxOutputTokens?: number; usage?: { reasoningTokens?: number; outputTokens?: number } }> }; failedStage?: string; document?: unknown };
      expect(response.status).toBe(502);
      expect(body.error?.code).toBe('OUTPUT_BUDGET_EXHAUSTED');
      expect(body.meta?.requestId).toBe('incomplete-id');
      expect(body.meta?.stages?.[0]?.incompleteReason).toBe('max_output_tokens');
      expect(body.meta?.stages?.[0]?.maxOutputTokens).toBe(2_048);
      expect(body.failedStage).toBe('recognition');
      expect(body.document).toBeUndefined();
      expect(body.error?.message).toContain('raciocínio');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
      expect(requestBody).toMatchObject({ model: 'muse-spark-1.3', max_output_tokens: 2_048, reasoning: { effort: 'low' }, text: { format: { type: 'json_schema', name: 'technical_recognition_v2', strict: true } } });
      expect(requestBody.text.format.schema.required).toEqual(['schema', 'primaryDomain', 'secondaryDomains', 'documentType', 'summary', 'legibility', 'route']);
    });
  });

  it('rejects an incomplete Stage B response without accepting a document or issuing retries', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(metaOutput(JSON.stringify(recognition('architecture')), 'recognition-ok'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'extraction-incomplete', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] }), { status: 200 }));
    await withServer(fetchMock, async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/meta/image`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ imageDataUrl: validJpegDataUrl }) });
      const body = await response.json() as { status?: string; document?: unknown; extraction?: { status?: string }; error?: { code?: string }; failedStage?: string; meta?: { stages?: Array<{ stage?: string; incompleteReason?: string; maxOutputTokens?: number }> } };
      expect(response.status).toBe(502);
      expect(body.status).toBeUndefined();
      expect(body.document).toBeUndefined();
      expect(body.error?.code).toBe('OUTPUT_BUDGET_EXHAUSTED');
      expect(body.failedStage).toBe('extraction');
      expect(body.meta?.stages?.map((stage) => stage.stage)).toEqual(['recognition', 'extraction']);
      expect(body.meta?.stages?.[1]?.incompleteReason).toBe('max_output_tokens');
      expect(body.meta?.stages?.[1]?.maxOutputTokens).toBe(12_288);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const extractionRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
      expect(extractionRequest).toMatchObject({ max_output_tokens: 12_288, reasoning: { effort: 'high' }, text: { format: { name: 'technical_document_v1', strict: true } } });
    });
  });

  it('keeps regional verification separate and explicitly non-independent', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(metaOutput(JSON.stringify({ status: 'uncertain', reading: null, unit: null, visibleText: '9.?5 m', alternatives: ['9.85', '9.65'], explanation: 'Um dígito permanece ilegível.', regionReference: 'selected_crop' }), 'region-request-id'));
    await withServer(fetchMock, async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/meta/image/verify-region`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cropImageDataUrl: validJpegDataUrl, targetId: 'dimension-1', targetLabel: 'Cota superior', candidateValue: '9.25 m', question: 'Leia o valor literal.', region: { x: 0.2, y: 0.1, width: 0.15, height: 0.08 }, originalSize: { width: 1000, height: 800 } }) });
      const body = await response.json() as { verification?: { status?: string; reading?: string | null }; limitation?: string; targetId?: string };
      expect(response.status).toBe(200);
      expect(body.targetId).toBe('dimension-1');
      expect(body.verification).toMatchObject({ status: 'uncertain', reading: null });
      expect(body.limitation).toContain('não é verificação independente');
      const upstream = String(fetchMock.mock.calls[0]?.[1]?.body);
      expect(upstream).not.toContain('MODEL_API_KEY');
      expect(upstream).not.toContain('9.25 m');
      expect(JSON.parse(upstream)).toMatchObject({ max_output_tokens: 2_048, reasoning: { effort: 'high' } });
    });
  });

  it('reports an incomplete regional check as budget exhaustion with no accepted reading', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ id: 'region-incomplete-id', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [], usage: { input_tokens: 20, output_tokens: 400, total_tokens: 420, output_tokens_details: { reasoning_tokens: 360 } } }), { status: 200 }));
    await withServer(fetchMock, async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/meta/image/verify-region`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cropImageDataUrl: validJpegDataUrl, targetId: 'dimension-1', targetLabel: 'Cota superior', candidateValue: '9.85 m', question: 'Leia o valor literal.', region: { x: 0.2, y: 0.1, width: 0.15, height: 0.08 }, originalSize: { width: 1000, height: 800 } }) });
      const body = await response.json() as { error?: { code?: string; message?: string }; failedStage?: string; verification?: unknown; meta?: { maxOutputTokens?: number; usage?: { reasoningTokens?: number; outputTokens?: number } } };
      expect(response.status).toBe(502);
      expect(body.error?.code).toBe('OUTPUT_BUDGET_EXHAUSTED');
      expect(body.failedStage).toBe('regionVerification');
      expect(body.verification).toBeUndefined();
      expect(body.meta).toMatchObject({ maxOutputTokens: 2_048, usage: { reasoningTokens: 360, outputTokens: 400 } });
      expect(body.error?.message).toContain('Nenhuma releitura foi aceite');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it('returns a useful partial result for low-confidence or unknown domain instead of a blanket block', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(metaOutput(JSON.stringify(recognition('unknown')), 'unknown-domain-id'));
    await withServer(fetchMock, async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/meta/image`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ imageDataUrl: validJpegDataUrl }) });
      const body = await response.json() as { status?: string; document?: { capabilities?: Array<{ id: string; state: string }> } };
      expect(response.status).toBe(200);
      expect(body.status).toBe('PARTIAL');
      expect(body.document?.capabilities?.find((item) => item.id === 'canExplain')?.state).toBe('partial');
      expect(body.document?.capabilities?.find((item) => item.id === 'canSimulate')?.state).toBe('blocked');
    });
  });

  it('propagates client cancellation to the upstream image request', async () => {
    let upstreamSignal: AbortSignal | undefined;
    const fetchMock = vi.fn<typeof fetch>((_input, init) => new Promise((_resolve, reject) => {
      upstreamSignal = init?.signal as AbortSignal;
      upstreamSignal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    await withServer(fetchMock, async (port) => {
      const controller = new AbortController();
      const pending = fetch(`http://127.0.0.1:${port}/api/meta/image`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ imageDataUrl: validJpegDataUrl }), signal: controller.signal }).catch(() => undefined);
      for (let index = 0; index < 50 && !upstreamSignal; index += 1) await new Promise((resolve) => setTimeout(resolve, 10));
      expect(upstreamSignal).toBeDefined();
      controller.abort();
      await pending;
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(upstreamSignal?.aborted).toBe(true);
    });
  });

  it('limits image analysis calls per peer without logging or forwarding an extra request', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      const requestBody = JSON.parse(String(init?.body));
      return requestBody.text.format.name === 'technical_recognition_v2'
        ? metaOutput(JSON.stringify(recognition('architecture')), `recognition-${fetchMock.mock.calls.length}`)
        : metaOutput(JSON.stringify(technicalDocument('architecture', 'Cozinha')), `extraction-${fetchMock.mock.calls.length}`);
    });
    await withServer(fetchMock, async (port) => {
      const send = () => fetch(`http://127.0.0.1:${port}/api/meta/image`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ imageDataUrl: validJpegDataUrl }) });
      const responses = [];
      for (let index = 0; index < 5; index += 1) responses.push(await send());
      expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 429]);
      expect(fetchMock).toHaveBeenCalledTimes(8);
    });
  });

  it('propagates an upstream API failure without exposing payload image or echoed credentials', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'rate limited Bearer fixture-upstream-secret-123456' } }), { status: 429, headers: { 'x-request-id': 'rate-limit-id' } }));
    await withServer(fetchMock, async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/meta/image`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ imageDataUrl: validJpegDataUrl }),
      });
      const body = await response.json() as { error?: { code?: string }; meta?: { requestId?: string } };
      expect(response.status).toBe(429);
      expect(body.error?.code).toBe('META_HTTP_ERROR');
      expect(body.meta?.requestId).toBe('rate-limit-id');
      expect(JSON.stringify(body)).not.toContain(validJpegDataUrl);
      expect(JSON.stringify(body)).not.toContain('fixture-upstream-secret');
    });
  });
});
