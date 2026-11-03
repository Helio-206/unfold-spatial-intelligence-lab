import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';
import { createMetaServer, type ServerOptions } from '../../server/meta-server';
import { createPhase3DReferenceFixture } from '../../src/phase3d-fixture';
import { SPATIAL_AGENT_REQUEST_SCHEMA } from '../../src/spatial-agent';
import { createOfflineTextObservation } from '../../src/living/reconstruction/observation';

export const ALLOWED_ORIGIN = 'http://127.0.0.1:5173';
const validJpegDataUrl = 'data:image/jpeg;base64,/9j/4AA=';

export type PaidRouteCase = { body: unknown; upstreamText: string; prepare?: (port: number, headers: Record<string, string>) => Promise<Record<string, unknown>> };

const operation = JSON.stringify({ schema: 'kinematic_operation.v1', action: 'update_length', componentId: 'crank', newValue: 80, unit: 'mm' });

// Um caso válido por rota paga. Se aparecer uma rota nova em PAID_ROUTES sem entrada aqui,
// o teste de cobertura falha, por isso não dá para esquecer a guarda nem o teste.
export function paidRouteCases(): Record<string, PaidRouteCase> {
  const fixture = createPhase3DReferenceFixture();
  const v2Plan = { title: 'Fan', units: 'unitless', presentationProfile: 'industrial', components: [{ id: 'hub', label: 'Hub', parentId: null, geometry: { type: 'shape', key: 'hub-shell', operator: 'cylinder', parameters: { radiusTop: 0.4, radiusBottom: 0.4, height: 0.2, radialSegments: 16 }, transform: { position: [0, 0, 0], rotationRad: [0, 0, 0], scale: [1, 1, 1] }, repeat: null, material: { profile: 'metal', color: '#777777', roughness: 0.4, metalness: 0.7, clearcoat: 0 } }, transform: { position: [0, 0, 0], rotationRad: [0, 0, 0], scale: [1, 1, 1] }, provenance: { geometry: 'inferred', transform: 'inferred', material: 'inferred', evidence: 'Test fixture.' } }], relations: [], constraints: [], unknowns: [] };
  const v2PlanText = JSON.stringify(v2Plan);
  const seedSession = async (port: number, headers: Record<string, string>) => {
    const response = await rawRequest(port, { path: '/api/spatial/v2/plan', headers, body: { sourceKind: 'text', instruction: 'Build a small fan.' } });
    if (response.status !== 200 || typeof response.json?.sessionId !== 'string') throw new Error('Unable to seed V2 route test.');
    return { sessionId: response.json.sessionId, baseRevision: 0 };
  };
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p6sAAAAASUVORK5CYII=';
  return {
    '/api/meta/text': { body: { prompt: 'olá' }, upstreamText: 'ok' },
    '/api/meta/image': {
      body: { imageDataUrl: validJpegDataUrl },
      upstreamText: JSON.stringify({ schema: 'technical_recognition.v2', primaryDomain: 'unknown', secondaryDomains: [], documentType: 'desenho', summary: 'Sinais insuficientes.', legibility: 'low', route: 'stop_unknown' }),
    },
    '/api/meta/image/verify-region': {
      body: { cropImageDataUrl: validJpegDataUrl, targetId: 'dimension-1', targetLabel: 'Cota superior', question: 'Leia o valor literal.', region: { x: 0.2, y: 0.1, width: 0.15, height: 0.08 }, originalSize: { width: 1000, height: 800 } },
      upstreamText: JSON.stringify({ status: 'uncertain', reading: null, unit: null, visibleText: '9.?5 m', alternatives: ['9.85'], explanation: 'Um dígito ilegível.', regionReference: 'selected_crop' }),
    },
    '/api/kinematics/experiment': { body: { instruction: 'Aumenta a manivela.', graph: fixture.graph, assembly: fixture.assembly, mode: 'TEST_FIXTURE_ONLY' }, upstreamText: operation },
    '/api/experiments/preview': { body: { mechanismId: 'technical-four-bar-fixture', instruction: 'Aumenta a manivela.', mode: 'TEST_FIXTURE_ONLY' }, upstreamText: operation },
    '/api/conversation': {
      body: { message: 'Para que serve esta peça?', history: [], context: { mode: 'EMPTY', project: null } },
      upstreamText: JSON.stringify({ kind: 'answer', text: 'A manivela é a barra de entrada.', basis: 'general' }),
    },
    '/api/spatial-agent': {
      body: {
        schema: SPATIAL_AGENT_REQUEST_SCHEMA, query: 'Aumenta esta parede em 30 centímetros.', mode: 'architecture',
        capabilities: ['Select', 'Inspect', 'Focus', 'Move', 'Rotate', 'Resize', 'AddOpening', 'RemoveOpening', 'Undo', 'Redo', 'Save', 'Restore'],
        scene: { id: 'scene-a', revisionId: 'revision-2', revisionNumber: 2, selectedId: 'wall-a', components: [{ id: 'wall-a', label: 'Parede 1', kind: 'wall', dimensionsM: [4, 2.7, 0.15], verification: 'unreviewed' }], constraints: [] },
        document: { id: 'doc-a', domain: 'architecture', summary: 'Planta residencial.', elements: [], relations: [], uncertainties: [], missing: [] },
        history: [],
      },
      upstreamText: JSON.stringify({ schema: 'spatial_agent_result.v1', kind: 'PROPOSE_ACTION', text: 'Proponho aumentar a parede seleccionada em 30 cm.', basis: 'scene', evidenceIds: ['wall-a'], question: null, action: { kind: 'Resize', target: { reference: 'selected', label: null, ordinal: null }, value: 0.3, valueMode: 'increase_by', unit: 'm', axis: null, opening: null } }),
    },
    '/api/spatial/plan': {
      body: { sourceKind: 'text', instruction: 'Cria uma forma conceptual.' },
      upstreamText: JSON.stringify({ title: 'Concept', units: 'unitless', entities: [{ id: 'body', label: 'Body', parentId: null, geometry: { operator: 'box', parameters: [1, 1, 1] }, repeat: null, transform: { position: [0, 0, 0], rotationRad: [0, 0, 0], scale: [1, 1, 1] }, material: { color: '#888888', roughness: 0.5, metalness: 0 }, origin: 'design_approximation', evidence: 'Model generated primitive.' }], relations: [], unknowns: ['Scale unknown.'] }),
    },
    '/api/spatial/v2/plan': { body: { sourceKind: 'text', instruction: 'Build a small fan.' }, upstreamText: v2PlanText },
    '/api/spatial/v2/edit': { body: { sessionId: '', baseRevision: 0, instruction: 'Move hub.' }, upstreamText: JSON.stringify({ kind: 'set-transform', componentId: 'hub', nodeKey: null, value: JSON.stringify({ position: [0.1, 0, 0], rotationRad: [0, 0, 0], scale: [1, 1, 1] }) }), prepare: seedSession },
    '/api/spatial/v2/evaluate': { body: { sessionId: '', baseRevision: 0, imageDataUrl: png }, upstreamText: JSON.stringify({ recognizabilityScore: 70, silhouetteScore: 65, spatialIntegrityScore: 80, confidence: 0.6, discrepancies: [], suggestedOperation: null, rationale: 'A compact conceptual fan is visible.' }), prepare: seedSession },
    '/api/living/reconstruction': {
      body: { sourceKind: 'text', instruction: 'Escavadora', sourceReference: 'guard-fixture' },
      upstreamText: JSON.stringify(createOfflineTextObservation('Escavadora', 'guard-fixture')),
    },
  };
}

export function metaResponse(text: string): Response {
  return new Response(JSON.stringify({ id: 'guard-test', status: 'completed', output_text: text, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }), { status: 200, headers: { 'x-request-id': 'guard-test' } });
}

// fetch simulado que só conta: é ele que prova que um pedido rejeitado nunca chegou à Meta.
export function countingFetch(text = 'ok') {
  return vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
    try {
      const request = JSON.parse(String(init?.body));
      if (request.text?.format?.name === 'unfold_spatial_plan_v2') {
        const material = { profile: 'metal', color: '#777777', roughness: 0.4, metalness: 0.7, clearcoat: 0 };
        const identity = { position: [0, 0, 0], rotationRad: [0, 0, 0], scale: [1, 1, 1] };
        return metaResponse(JSON.stringify({ title: 'Fan', units: 'unitless', presentationProfile: 'industrial', components: [{ id: 'hub', label: 'Hub', parentId: null, geometry: { type: 'shape', key: 'hub-shell', operator: 'cylinder', parameters: { radiusTop: 0.4, radiusBottom: 0.4, height: 0.2, radialSegments: 16 }, transform: identity, repeat: null, material }, transform: identity, provenance: { geometry: 'inferred', transform: 'inferred', material: 'inferred', evidence: 'Test fixture.' } }], relations: [], constraints: [], unknowns: [] }));
      }
    } catch { /* The tested endpoint owns malformed upstream responses. */ }
    return metaResponse(text);
  });
}

export type Reply = { status: number; headers: IncomingHttpHeaders; text: string; json: any };

// node:http em vez de fetch para poder controlar Host e Content-Type à vontade.
export function rawRequest(port: number, options: { path: string; method?: string; headers?: Record<string, string>; body?: unknown }): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const payload = options.body === undefined ? undefined : typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    const request = httpRequest({ host: '127.0.0.1', port, path: options.path, method: options.method ?? 'POST', headers: { ...(payload === undefined ? {} : { 'content-length': String(Buffer.byteLength(payload)) }), ...options.headers } }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json: unknown;
        try { json = JSON.parse(text); } catch { json = undefined; }
        resolve({ status: response.statusCode ?? 0, headers: response.headers, text, json });
      });
    });
    request.on('error', reject);
    if (payload !== undefined) request.write(payload);
    request.end();
  });
}

export async function withGuardedServer(options: ServerOptions, run: (port: number) => Promise<void>): Promise<void> {
  const server = createMetaServer({ apiKey: 'fixture-key-never-real', ...options });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Porta de teste indisponível.');
  try { await run(address.port); }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

export const TOKEN_HEADER = 'x-unfold-local-token';

// Servidor com ficheiro de token num directório temporário; entrega o token lido do ficheiro,
// tal como um script local o leria.
export async function withTokenServer(options: ServerOptions, run: (port: number, token: string, tokenFile: string) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'unfold-token-'));
  const localTokenFile = join(directory, 'local-token');
  try {
    await withGuardedServer({ ...options, localTokenFile }, (port) => run(port, readFileSync(localTokenFile, 'utf8').trim(), localTokenFile));
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
