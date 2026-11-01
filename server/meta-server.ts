import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import {
  executeKinematicOperation,
  buildKinematicOperationPrompt,
  parseKinematicOperation,
} from '../src/ai-kinematic-experiment';
import { adaptMechanicalGraph, type KinematicAssemblyV1 } from '../src/kinematic-assembly';
import { MetaApiError, requestMetaStructuredImage, requestMetaStructuredText, requestMetaText, sanitizeMetaEvidenceExcerpt, type MetaCallLog } from '../src/meta';
import type { MechanicalGraphV1 } from '../src/mechanical-graph';
import { technicalAdapters } from '../src/technical-document';
import { buildRegionVerificationPrompt, buildTechnicalRecognitionPrompt, MULTIMODAL_STAGE_CONFIG, parseRegionVerification, parseTechnicalRecognition, REGION_VERIFICATION_JSON_SCHEMA, TECHNICAL_RECOGNITION_JSON_SCHEMA } from '../src/technical-document-pipeline';
import { validateImageDataUrl, MAX_IMAGE_BYTES } from '../src/image-input';
import { extractTechnicalDocumentFromRecognition } from '../src/technical-extraction';
import { createExperimentPreview, type ExperimentPreview } from '../src/experiment-preview';
import { createPhase3DReferenceFixture } from '../src/phase3d-fixture';
import { authorizeProposedAction, buildConversationPrompt, CONVERSATION_JSON_SCHEMA, ConversationResponseError, parseConversationResponse, validateConversationRequest } from '../src/spatial-conversation';
import {
  DESIGN_SANDBOX_MODE,
  buildDesignSandboxPrompt,
  executeDesignSandboxOperation,
  validateDesignSandboxRequest,
} from '../src/design-sandbox';
import { BACKEND_CONTRACT_VERSION, BACKEND_DIAGNOSTICS_SCHEMA, IMAGE_PIPELINE_VERSION, IMAGE_RESPONSE_CONTRACT, TECHNICAL_DOCUMENT_SCHEMA_VERSION, TECHNICAL_RECOGNITION_SCHEMA_VERSION } from '../src/api-contract';
import { buildSpatialAgentPrompt, parseSpatialAgentResult, SPATIAL_AGENT_JSON_SCHEMA, validateSpatialAgentRequest } from '../src/spatial-agent';

const MAX_BODY_BYTES = 64 * 1024;
const MAX_IMAGE_BODY_BYTES = 14 * 1024 * 1024;
const MAX_PREVIEW_BODY_BYTES = 16 * 1024;
const MAX_SPATIAL_AGENT_BODY_BYTES = 48 * 1024;
const ALLOWED_ORIGINS = new Set(['http://127.0.0.1:5173', 'http://localhost:5173']);
// O proxy do Vite (changeOrigin: false) deixa passar o Host do browser, por isso o frontend
// chega aqui com 127.0.0.1:5173 e não com a porta do backend. Os dois valores são aceites.
const ALLOWED_ORIGIN_HOSTS = new Set([...ALLOWED_ORIGINS].map((origin) => new URL(origin).host));
export const BACKEND_CONTRACT = 'unfold.phase4c' as const;

// Única lista de rotas que gastam chamadas Meta. O despacho abaixo só encaminha caminhos que estão
// aqui, e tudo o que está aqui passa pela mesma guarda antes de qualquer outra coisa. Uma rota nova
// sem entrada nesta lista devolve 404; com entrada, herda a guarda.
export const PAID_ROUTES = [
  '/api/meta/text',
  '/api/meta/image',
  '/api/meta/image/verify-region',
  '/api/kinematics/experiment',
  '/api/experiments/preview',
  '/api/conversation',
  '/api/spatial-agent',
] as const;
const PAID_ROUTE_SET: ReadonlySet<string> = new Set(PAID_ROUTES);

type GuardRejection = { status: number; code: string; message: string; allow?: string };

export const LOCAL_TOKEN_HEADER = 'x-unfold-local-token';

// Ficheiros de estado do backend a sério (token, orçamento). Só o server/index.ts os usa por omissão;
// createMetaServer() não escreve aqui sozinho, para os testes não mexerem no estado de quem desenvolve.
export function defaultStateFile(name: string): string {
  return join(process.env.UNFOLD_STATE_DIR ?? join(homedir(), '.unfold'), name);
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function createLocalToken(file: string | undefined): string {
  const token = randomBytes(32).toString('hex');
  if (file) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    // Ficheiro novo com 0600 desde a criação e rename por cima, para nunca ficar legível por outros
    // nem herdar o modo de um ficheiro antigo.
    const temporaryFile = `${file}.${randomUUID()}.tmp`;
    writeFileSync(temporaryFile, `${token}\n`, { flag: 'wx', mode: 0o600 });
    renameSync(temporaryFile, file);
  }
  return token;
}

function removeLocalTokenFile(file: string, token: string): void {
  try {
    if (readFileSync(file, 'utf8').trim() === token) rmSync(file, { force: true });
  } catch { /* já não existe ou foi substituído por outro arranque */ }
}

function checkPaidRoute(request: IncomingMessage, localToken: Buffer): GuardRejection | undefined {
  if (request.method !== 'POST') return { status: 405, code: 'METHOD_NOT_ALLOWED', message: 'Esta rota só aceita POST.', allow: 'POST' };
  const mediaType = (request.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
  if (mediaType !== 'application/json') return { status: 415, code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Content-Type tem de ser application/json.' };
  const host = (request.headers.host ?? '').toLowerCase();
  const localPort = request.socket.localPort;
  if (!ALLOWED_ORIGIN_HOSTS.has(host) && host !== `127.0.0.1:${localPort}` && host !== `localhost:${localPort}`) {
    return { status: 421, code: 'INVALID_HOST', message: 'Host não permitido.' };
  }
  // Com Origin, tem de ser uma das permitidas (um browser não consegue ler o token, por isso um
  // Origin estranho nunca é salvo por um token). Sem Origin, só entra quem tiver o token.
  const origin = request.headers.origin;
  if (origin !== undefined) {
    if (!ALLOWED_ORIGINS.has(origin)) return { status: 403, code: 'INVALID_ORIGIN', message: 'Origem não permitida.' };
    return undefined;
  }
  const presented = request.headers[LOCAL_TOKEN_HEADER];
  if (typeof presented !== 'string' || !timingSafeEqual(digest(presented), localToken)) {
    return { status: 403, code: 'LOCAL_TOKEN_REQUIRED', message: 'Pedido sem Origin permitida nem token local válido.' };
  }
  return undefined;
}

export type PreviewMechanismResolution =
  | { status: 'ready'; graph: MechanicalGraphV1; assembly: KinematicAssemblyV1; fixtureOnly: boolean; limitations: string[] }
  | { status: 'blocked'; issues: Array<{ path: string; message: string }> };

export type ServerOptions = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  resolvePreviewMechanism?: (mechanismId: string) => PreviewMechanismResolution;
  maxMetaCalls?: number;
  metaCallBudgetFile?: string;
  // Onde gravar o token para clientes sem Origin (scripts locais). Sem isto o token existe só em
  // memória e ninguém o consegue usar, ou seja, só entram pedidos de browser com Origin permitida.
  localTokenFile?: string;
  upstreamEvidence?: { enabled: boolean; directory: string; maxFiles?: number };
};

class MetaCallBudgetExceeded extends Error {
  constructor() { super('O limite de chamadas Meta desta execução foi atingido.'); }
}

function readCallLimit(option: number | undefined): number | undefined {
  const raw = option === undefined ? process.env.UNFOLD_ACCEPTANCE_MAX_META_CALLS : String(option);
  if (raw === undefined || raw === '') return undefined;
  const limit = Number(raw);
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('UNFOLD_ACCEPTANCE_MAX_META_CALLS deve ser um inteiro não negativo.');
  return limit;
}

function createSourceBuildId(): string {
  const serverPath = fileURLToPath(import.meta.url);
  const sourceDirectory = resolve(dirname(serverPath), '../src');
  const hashedSources = [
    serverPath,
    resolve(sourceDirectory, 'api-contract.ts'),
    resolve(sourceDirectory, 'meta.ts'),
    resolve(sourceDirectory, 'technical-document.ts'),
    resolve(sourceDirectory, 'technical-document-pipeline.ts'),
    resolve(sourceDirectory, 'technical-extraction.ts'),
    resolve(sourceDirectory, 'spatial-agent.ts'),
  ].map((path) => readFileSync(path));
  return `src-${createHash('sha256').update(hashedSources.join('')).digest('hex').slice(0, 12)}`;
}

function defaultPreviewMechanismResolver(mechanismId: string): PreviewMechanismResolution {
  if (mechanismId !== 'technical-four-bar-fixture') {
    return { status: 'blocked', issues: [{ path: 'mechanismId', message: `A montagem ${mechanismId} não está disponível como assembly verificada.` }] };
  }
  const fixture = createPhase3DReferenceFixture();
  return {
    status: 'ready',
    graph: fixture.graph,
    assembly: fixture.assembly,
    fixtureOnly: true,
    limitations: ['TEST_FIXTURE_ONLY; valores documentais de referência, sem validação física ou revisão humana real.'],
  };
}

function writeJson(response: ServerResponse, status: number, body: unknown, origin?: string): void {
  if (origin && ALLOWED_ORIGINS.has(origin)) response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Vary', 'Origin');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.writeHead(status);
  response.end(JSON.stringify(body));
}

function readBody(request: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error(`Payload excede o limite de ${Math.round(maxBytes / 1024 / 1024)} MiB.`));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function hasFixtureProvenance(assembly: KinematicAssemblyV1): boolean {
  const parameters = [
    assembly.ground.nodeId,
    assembly.ground.fixed,
    ...Object.values(assembly.links).flatMap((link) => [link.nodeId, link.length]),
    ...Object.values(assembly.joints).flatMap((joint) => [joint.nodeId, joint.type]),
    assembly.parameters.lengthUnit,
    assembly.parameters.inputAngleRad,
    assembly.parameters.branch,
  ];
  return parameters.some((parameter) => parameter.provenance === 'test_fixture');
}

function evidenceOptions(options: ServerOptions): ServerOptions['upstreamEvidence'] {
  if (options.upstreamEvidence) return options.upstreamEvidence;
  if (process.env.UNFOLD_UPSTREAM_EVIDENCE !== '1') return undefined;
  const directory = process.env.UNFOLD_UPSTREAM_EVIDENCE_DIR;
  if (!directory) throw new Error('UNFOLD_UPSTREAM_EVIDENCE_DIR é obrigatório quando a evidência upstream está activa.');
  return { enabled: true, directory, maxFiles: 100 };
}

function persistUpstreamEvidence(config: ServerOptions['upstreamEvidence'], record: Record<string, unknown>): void {
  if (!config?.enabled) return;
  const maxFiles = config.maxFiles ?? 100;
  if (!Number.isSafeInteger(maxFiles) || maxFiles < 1 || maxFiles > 1000) throw new Error('Limite de ficheiros de evidência inválido.');
  mkdirSync(config.directory, { recursive: true, mode: 0o700 });
  const existing = readdirSync(config.directory).filter((name) => /^conversation-upstream-[a-f0-9-]+\.json$/.test(name));
  if (existing.length >= maxFiles) {
    console.warn(JSON.stringify({ event: 'conversation.evidence.skipped', reason: 'EVIDENCE_RETENTION_LIMIT' }));
    return;
  }
  const serialized = JSON.stringify({ schema: 'unfold_upstream_evidence.v1', recordedAt: new Date().toISOString(), ...record });
  if (Buffer.byteLength(serialized, 'utf8') > 6_144) throw new Error('Evidência upstream excede o limite de tamanho.');
  const path = resolve(config.directory, `conversation-upstream-${randomUUID()}.json`);
  writeFileSync(path, `${serialized}\n`, { flag: 'wx', mode: 0o600 });
}

function conversationErrorCode(error: unknown): { code: string; category: string; status: number } {
  if (error instanceof ConversationResponseError) return { code: error.category === 'parsing' ? 'MODEL_RESPONSE_PARSE_ERROR' : 'MODEL_RESPONSE_SCHEMA_ERROR', category: error.category, status: 502 };
  if (error instanceof MetaApiError) {
    if (error.kind === 'network_error') return { code: 'META_TRANSPORT_ERROR', category: 'transport', status: 502 };
    if (error.kind === 'invalid_json') return { code: 'META_ENVELOPE_PARSE_ERROR', category: 'parsing', status: 502 };
    if (error.kind === 'incomplete') return { code: 'META_RESPONSE_INCOMPLETE', category: 'model', status: 502 };
    if (error.kind === 'model_error') return { code: 'META_MODEL_ERROR', category: 'model', status: 502 };
    if (error.kind === 'http_error') return { code: 'META_UPSTREAM_HTTP_ERROR', category: 'transport', status: 502 };
    return { code: 'META_RESPONSE_ENVELOPE_ERROR', category: 'parsing', status: 502 };
  }
  return { code: 'CONVERSATION_INTERNAL_ERROR', category: 'internal', status: 502 };
}

export function createMetaServer(options: ServerOptions = {}): Server {
  const upstreamEvidence = evidenceOptions(options);
  const localTokenFile = options.localTokenFile ?? process.env.UNFOLD_LOCAL_TOKEN_FILE;
  const localToken = createLocalToken(localTokenFile);
  const localTokenDigest = digest(localToken);
  const apiKey = options.apiKey ?? process.env.MODEL_API_KEY;
  const metaCallLimit = readCallLimit(options.maxMetaCalls);
  const metaCallBudgetFile = options.metaCallBudgetFile ?? process.env.UNFOLD_ACCEPTANCE_BUDGET_FILE;
  const savedBudget = metaCallBudgetFile ? (() => {
    try {
      const saved = JSON.parse(readFileSync(metaCallBudgetFile, 'utf8')) as { limit?: unknown; used?: unknown };
      if (saved.limit !== (metaCallLimit ?? null) || !Number.isSafeInteger(saved.used) || Number(saved.used) < 0) throw new Error('O ficheiro de orçamento não corresponde ao limite activo.');
      return Number(saved.used);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return 0;
      throw error;
    }
  })() : 0;
  let metaCallsUsed = savedBudget;
  const startedAt = new Date().toISOString();
  const buildId = process.env.UNFOLD_BUILD_ID ?? createSourceBuildId();
  const reserveMetaCall = () => {
    if (metaCallLimit !== undefined && metaCallsUsed >= metaCallLimit) throw new MetaCallBudgetExceeded();
    const nextCount = metaCallsUsed + 1;
    if (metaCallBudgetFile) {
      mkdirSync(dirname(metaCallBudgetFile), { recursive: true });
      const temporaryFile = `${metaCallBudgetFile}.${process.pid}.tmp`;
      writeFileSync(temporaryFile, JSON.stringify({ limit: metaCallLimit ?? null, used: nextCount }) + '\n', { mode: 0o600 });
      renameSync(temporaryFile, metaCallBudgetFile);
    }
    metaCallsUsed = nextCount;
  };
  const diagnostics = () => ({
    schema: BACKEND_DIAGNOSTICS_SCHEMA,
    contractVersion: BACKEND_CONTRACT_VERSION,
    buildId,
    pipelineVersion: IMAGE_PIPELINE_VERSION,
    responseSchemaVersion: TECHNICAL_DOCUMENT_SCHEMA_VERSION,
    recognitionSchemaVersion: TECHNICAL_RECOGNITION_SCHEMA_VERSION,
    startedAt,
    capabilities: {
      imageAnalysis: { available: true, apiKeyConfigured: Boolean(apiKey), responseContract: IMAGE_RESPONSE_CONTRACT },
      contextualConversation: { available: true, apiKeyConfigured: Boolean(apiKey) },
      spatialAgent: { available: true, apiKeyConfigured: Boolean(apiKey), contract: 'spatial_agent_result.v1', maxOutputTokens: 1_600, reasoningEffort: 'medium' },
      imageRegionVerification: { available: true, apiKeyConfigured: Boolean(apiKey) },
    },
    metaCallBudget: { limit: metaCallLimit ?? null, used: metaCallsUsed, remaining: metaCallLimit === undefined ? null : Math.max(0, metaCallLimit - metaCallsUsed) },
  });
  const conversationRequests = new Map<string, number[]>();
  const imageRequests = new Map<string, number[]>();
  const server = createServer(async (request, response) => {
    const origin = typeof request.headers.origin === 'string' ? request.headers.origin : undefined;
    if (request.method === 'OPTIONS') {
      if (origin && ALLOWED_ORIGINS.has(origin)) response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method === 'GET' && request.url === '/api/health') {
      writeJson(response, 200, { status: 'ok', service: 'unfold-backend', contract: BACKEND_CONTRACT }, origin);
      return;
    }
    if (request.method === 'GET' && request.url === '/api/diagnostics') {
      writeJson(response, 200, diagnostics(), origin);
      return;
    }
    if (!PAID_ROUTE_SET.has(request.url ?? '')) {
      writeJson(response, 404, { error: { code: 'NOT_FOUND', message: 'Rota não encontrada.' } }, origin);
      return;
    }
    const rejection = checkPaidRoute(request, localTokenDigest);
    if (rejection) {
      console.info(JSON.stringify({ event: 'paid_route.rejected', route: request.url, status: rejection.status, code: rejection.code }));
      if (rejection.allow) response.setHeader('Allow', rejection.allow);
      writeJson(response, rejection.status, { error: { code: rejection.code, message: rejection.message } }, origin);
      return;
    }
    if (!apiKey) {
      console.info(JSON.stringify({ event: 'meta.text.blocked', reason: 'MODEL_API_KEY_MISSING' }));
      writeJson(response, 503, { error: { code: 'MODEL_API_KEY_MISSING', message: 'Configure MODEL_API_KEY no processo do backend.' } }, origin);
      return;
    }

    if (request.url === '/api/conversation' || request.url === '/api/spatial-agent') {
      const now = Date.now();
      const peer = request.socket.remoteAddress ?? 'unknown';
      for (const [key, timestamps] of conversationRequests) if (!timestamps.some((time) => now - time < 60_000)) conversationRequests.delete(key);
      const recent = (conversationRequests.get(peer) ?? []).filter((time) => now - time < 60_000);
      if (recent.length >= 20 || conversationRequests.size >= 1000 && !conversationRequests.has(peer)) {
        writeJson(response, 429, { error: { code: 'RATE_LIMITED', message: 'Limite de conversa atingido. Tente novamente dentro de um minuto.' } }, origin);
        return;
      }
      conversationRequests.set(peer, [...recent, now]);
    }

    const started = performance.now();
    try {
      const body = JSON.parse(await readBody(request,
        request.url?.startsWith('/api/meta/image')
          ? MAX_IMAGE_BODY_BYTES
          : request.url === '/api/experiments/preview' || request.url === '/api/conversation'
            ? MAX_PREVIEW_BODY_BYTES
            : request.url === '/api/spatial-agent'
              ? MAX_SPATIAL_AGENT_BODY_BYTES
            : MAX_BODY_BYTES,
      )) as { prompt?: unknown };
      if (request.url === '/api/spatial-agent') {
        let agentRequest;
        let prompt: string;
        try {
          agentRequest = validateSpatialAgentRequest(body);
          prompt = buildSpatialAgentPrompt(agentRequest);
        } catch {
          writeJson(response, 400, { error: { code: 'INVALID_SPATIAL_AGENT_REQUEST', message: 'Pedido ou contexto espacial inválido.' } }, origin);
          return;
        }
        const abort = new AbortController();
        request.once('aborted', () => abort.abort());
        request.socket.once('close', () => abort.abort());
        response.once('close', () => { if (!response.writableEnded) abort.abort(); });
        let result: Awaited<ReturnType<typeof requestMetaStructuredText>> | undefined;
        try {
          reserveMetaCall();
          result = await requestMetaStructuredText(prompt, apiKey, SPATIAL_AGENT_JSON_SCHEMA as unknown as Record<string, unknown>, options.fetchImpl, 1_600, 'medium', 'spatial_agent_result_v1', abort.signal);
          if (abort.signal.aborted) return;
          const parsed = parseSpatialAgentResult(result.text, agentRequest);
          console.info(JSON.stringify({ event: 'spatial_agent.completed', httpStatus: result.log.httpStatus, latencyMs: result.log.latencyMs, requestId: result.log.requestId, usage: result.log.usage, estimatedCostUsd: result.log.estimatedCostUsd, kind: parsed.kind, mode: agentRequest.mode }));
          writeJson(response, 200, { result: parsed, sceneRevisionId: agentRequest.scene?.revisionId ?? null, meta: result.log }, origin);
        } catch (error) {
          if (abort.signal.aborted) return;
          const failure = error instanceof Error && error.message.startsWith('SPATIAL_AGENT_')
            ? {
              code: error.message,
              category: error.message.includes('INCOMPLETE') ? 'model'
                : error.message.includes('INVALID_JSON') ? 'parsing'
                  : error.message.includes('INVALID') || error.message.includes('NOT_ALLOWED') || error.message.includes('NOT_AUTHORIZED') ? 'schema'
                    : 'internal',
              status: 502,
            }
            : conversationErrorCode(error);
          const metaLog = error instanceof MetaApiError ? error.log : undefined;
          const code = error instanceof MetaApiError
            ? error.kind === 'incomplete' ? 'SPATIAL_AGENT_INCOMPLETE' : error.kind === 'network_error' ? 'SPATIAL_AGENT_TRANSPORT_ERROR' : error.kind === 'http_error' ? 'SPATIAL_AGENT_UPSTREAM_HTTP_ERROR' : error.kind === 'model_error' ? 'SPATIAL_AGENT_MODEL_ERROR' : 'SPATIAL_AGENT_UPSTREAM_INVALID'
            : error instanceof Error && error.message.startsWith('SPATIAL_AGENT_') ? error.message
              : 'SPATIAL_AGENT_INTERNAL_ERROR';
          console.info(JSON.stringify({ event: 'spatial_agent.failed', code, category: failure.category, httpStatus: metaLog?.httpStatus ?? 502, latencyMs: metaLog?.latencyMs ?? Math.round(performance.now() - started), requestId: metaLog?.requestId, usage: metaLog?.usage }));
          writeJson(response, metaLog?.httpStatus === 429 ? 429 : 502, { error: { code, category: failure.category, message: 'A interpretação espacial não passou na validação. A cena não foi alterada.' }, meta: metaLog }, origin);
        }
        return;
      }
      if (request.url === '/api/conversation') {
        let prompt: string;
        let conversationRequest;
        try { conversationRequest = validateConversationRequest(body); prompt = buildConversationPrompt(conversationRequest); }
        catch { writeJson(response, 400, { error: { code: 'INVALID_CONVERSATION', message: 'Pedido ou contexto de conversa inválido.' } }, origin); return; }
        reserveMetaCall();
        let result: Awaited<ReturnType<typeof requestMetaStructuredText>> | undefined;
        try {
          result = await requestMetaStructuredText(prompt, apiKey, CONVERSATION_JSON_SCHEMA as unknown as Record<string, unknown>, options.fetchImpl, 500);
          const parsed = parseConversationResponse(result.text);
          const selected = conversationRequest.context.project?.selected ?? undefined;
          const actionAuthorized = !parsed.action || authorizeProposedAction(conversationRequest.message, selected, parsed.action);
          writeJson(response, 200, { response: actionAuthorized ? parsed : { ...parsed, action: undefined }, actionValidation: parsed.action ? { status: actionAuthorized ? 'authorized' : 'rejected', reason: actionAuthorized ? null : 'A proposta não corresponde a uma instrução explícita validada.' } : null, meta: result.log }, origin);
          return;
        } catch (error) {
          const failure = conversationErrorCode(error);
          const metaLog = error instanceof MetaApiError ? error.log : result?.log;
          const excerpt = error instanceof MetaApiError ? error.upstreamExcerpt : error instanceof ConversationResponseError && result ? sanitizeMetaEvidenceExcerpt(result.text) : undefined;
          persistUpstreamEvidence(upstreamEvidence, { route: '/api/conversation', category: failure.category, code: failure.code, meta: metaLog, ...(excerpt ? { sanitizedOutputExcerpt: excerpt } : {}) });
          console.info(JSON.stringify({ event: 'conversation.failed', code: failure.code, category: failure.category, httpStatus: metaLog?.httpStatus ?? 502, latencyMs: metaLog?.latencyMs ?? Math.round(performance.now() - started), requestId: metaLog?.requestId, usage: metaLog?.usage }));
          writeJson(response, failure.status, { error: { code: failure.code, category: failure.category, message: 'A resposta contextual não passou a validação. Nenhum comando foi aplicado.' }, meta: metaLog }, origin);
          return;
        }
      }
      if (request.url === '/api/meta/image/verify-region') {
        const candidate = body as Record<string, unknown>;
        const region = candidate.region as Record<string, unknown> | undefined;
        const originalSize = candidate.originalSize as Record<string, unknown> | undefined;
        const targetId = candidate.targetId;
        const targetLabel = candidate.targetLabel;
        const question = candidate.question;
        const numbers = region && ['x', 'y', 'width', 'height'].every((key) => typeof region[key] === 'number' && Number.isFinite(region[key]));
        const dimensions = originalSize && ['width', 'height'].every((key) => Number.isInteger(originalSize[key]) && Number(originalSize[key]) >= 1 && Number(originalSize[key]) <= 20_000);
        const x = numbers ? Number(region!.x) : -1;
        const y = numbers ? Number(region!.y) : -1;
        const width = numbers ? Number(region!.width) : 0;
        const height = numbers ? Number(region!.height) : 0;
        if (!numbers || !dimensions || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1 || typeof targetId !== 'string' || !targetId.trim() || targetId.length > 100 || typeof targetLabel !== 'string' || !targetLabel.trim() || targetLabel.length > 160 || typeof question !== 'string' || !question.trim() || question.length > 240) {
          writeJson(response, 400, { error: { code: 'INVALID_REGION_VERIFICATION', message: 'Alvo, pergunta, dimensão da imagem ou região normalizada inválida.' } }, origin);
          return;
        }
        let crop;
        try { crop = validateImageDataUrl(candidate.cropImageDataUrl); }
        catch (error) { writeJson(response, 400, { error: { code: 'INVALID_IMAGE', message: error instanceof Error ? error.message : 'Recorte inválido.' } }, origin); return; }
        const now = Date.now();
        const peer = request.socket.remoteAddress ?? 'unknown';
        for (const [key, timestamps] of imageRequests) if (!timestamps.some((time) => now - time < 60_000)) imageRequests.delete(key);
        const recent = (imageRequests.get(peer) ?? []).filter((time) => now - time < 60_000);
        if (recent.length >= 4 || imageRequests.size >= 1000 && !imageRequests.has(peer)) {
          writeJson(response, 429, { error: { code: 'IMAGE_RATE_LIMITED', message: 'Limite de análises de imagem atingido. Aguarde antes de verificar outra região.' } }, origin);
          return;
        }
        imageRequests.set(peer, [...recent, now]);
        const abort = new AbortController();
        request.once('aborted', () => abort.abort());
        request.socket.once('close', () => abort.abort());
        response.once('close', () => { if (!response.writableEnded) abort.abort(); });
        const requestData = { targetLabel, question, originalRegion: { x, y, width, height }, originalSize: { width: Number(originalSize!.width), height: Number(originalSize!.height) } };
        try {
          reserveMetaCall();
          const result = await requestMetaStructuredImage(crop.dataUrl, buildRegionVerificationPrompt(requestData), apiKey, REGION_VERIFICATION_JSON_SCHEMA as unknown as Record<string, unknown>, options.fetchImpl, MULTIMODAL_STAGE_CONFIG.regionVerification.maxOutputTokens, abort.signal, MULTIMODAL_STAGE_CONFIG.regionVerification.reasoningEffort, MULTIMODAL_STAGE_CONFIG.regionVerification.schemaName);
          const verification = parseRegionVerification(result.text);
          console.info(JSON.stringify({ event: 'meta.image.verify_region', status: 'success', httpStatus: result.log.httpStatus, latencyMs: result.log.latencyMs, usage: result.log.usage, estimatedCostUsd: result.log.estimatedCostUsd, requestId: result.log.requestId }));
          writeJson(response, 200, { targetId, region: requestData.originalRegion, originalSize: requestData.originalSize, verification, limitation: 'Releitura do mesmo modelo; não é verificação independente nem confirmação humana.', meta: result.log }, origin);
        } catch (error) {
          if (abort.signal.aborted) return;
          const log = error && typeof error === 'object' && 'log' in error ? (error.log as MetaCallLog) : undefined;
          const status = log?.httpStatus && log.httpStatus >= 400 && log.httpStatus < 600 ? log.httpStatus : 502;
          console.info(JSON.stringify({ event: 'meta.image.verify_region', status: 'error', httpStatus: log?.httpStatus ?? status, latencyMs: log?.latencyMs ?? Math.round(performance.now() - started), usage: log?.usage, estimatedCostUsd: log?.estimatedCostUsd, requestId: log?.requestId }));
          const outputBudgetExhausted = error instanceof MetaApiError && error.kind === 'incomplete' && log?.incompleteReason === 'max_output_tokens';
          const code = outputBudgetExhausted ? 'OUTPUT_BUDGET_EXHAUSTED' : error instanceof MetaApiError && error.kind === 'incomplete' ? 'RESPONSE_INCOMPLETE' : log?.httpStatus === 0 ? 'TRANSPORT_ERROR' : 'REGION_VERIFICATION_FAILED';
          const message = outputBudgetExhausted ? `Orçamento de tokens esgotado na fase regional; limite ${log?.maxOutputTokens ?? 'desconhecido'}, raciocínio ${log?.usage?.reasoningTokens ?? 'indisponível'}, saída ${log?.usage?.outputTokens ?? 'indisponível'}. Nenhuma releitura foi aceite.` : error instanceof Error ? error.message : 'A releitura da região falhou.';
          writeJson(response, status, { error: { code, message }, failedStage: 'regionVerification', meta: log }, origin);
        }
        return;
      }
      if (request.url === '/api/meta/image') {
        let image;
        try {
          image = validateImageDataUrl((body as { imageDataUrl?: unknown }).imageDataUrl);
        } catch (error) {
          writeJson(response, 400, { contract: IMAGE_RESPONSE_CONTRACT, error: { code: 'INVALID_IMAGE', message: error instanceof Error ? error.message : 'Imagem inválida.' } }, origin);
          return;
        }
        const now = Date.now();
        const peer = request.socket.remoteAddress ?? 'unknown';
        for (const [key, timestamps] of imageRequests) if (!timestamps.some((time) => now - time < 60_000)) imageRequests.delete(key);
        const recent = (imageRequests.get(peer) ?? []).filter((time) => now - time < 60_000);
        if (recent.length >= 4 || imageRequests.size >= 1000 && !imageRequests.has(peer)) {
          writeJson(response, 429, { contract: IMAGE_RESPONSE_CONTRACT, error: { code: 'IMAGE_RATE_LIMITED', message: 'Limite de análise de imagens atingido. Aguarde antes de enviar outra imagem.' } }, origin);
          return;
        }
        imageRequests.set(peer, [...recent, now]);
        const analysisAbort = new AbortController();
        request.once('aborted', () => analysisAbort.abort());
        request.socket.once('close', () => analysisAbort.abort());
        response.once('close', () => { if (!response.writableEnded) analysisAbort.abort(); });
        const stageLogs: Array<{ stage: 'recognition' | 'extraction'; log: MetaCallLog }> = [];
        let failedStage: 'recognition' | 'extraction' = 'recognition';
        let recognition: ReturnType<typeof parseTechnicalRecognition> | undefined;
        const aggregateMeta = (documentStatus: string, additional?: MetaCallLog) => {
          const logs = [...stageLogs.map((item) => item.log), ...(additional ? [additional] : [])];
          const sum = (key: 'inputTokens' | 'outputTokens' | 'totalTokens' | 'cachedInputTokens' | 'reasoningTokens') => {
            const values = logs.map((log) => log.usage?.[key]).filter((value): value is number => typeof value === 'number');
            return values.length ? values.reduce((total, value) => total + value, 0) : undefined;
          };
          return { model: 'muse-spark-1.3', status: documentStatus, requestId: logs.at(-1)?.requestId, responseStatus: logs.at(-1)?.responseStatus, incompleteReason: logs.at(-1)?.incompleteReason, stages: logs.map((log, index) => ({ stage: stageLogs[index]?.stage ?? failedStage, ...log })), latencyMs: logs.reduce((total, log) => total + log.latencyMs, 0), usage: { inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'), totalTokens: sum('totalTokens'), cachedInputTokens: sum('cachedInputTokens'), reasoningTokens: sum('reasoningTokens') }, estimatedCostUsd: logs.reduce((total, log) => total + (log.estimatedCostUsd ?? 0), 0), callBudget: { limit: metaCallLimit ?? null, used: metaCallsUsed, remaining: metaCallLimit === undefined ? null : Math.max(0, metaCallLimit - metaCallsUsed) } };
        };
        const emptyDocument = (primaryDomain: import('../src/technical-document').TechnicalDomain, documentType: string, summary: string, classification: { confidence: number; evidence: string; rationale: string }, ambiguities: string[]) => {
          const base = { schema: 'technical_document.v1' as const, provenance: { source: 'submitted_image' as const, kind: 'model_extraction' as const }, analysisState: 'partial' as const, documentType, primaryDomain, secondaryDomains: [] as import('../src/technical-document').TechnicalDomain[], classification, summary, elements: [], relations: [], observedText: [], ambiguities, missingInformation: ['A extracção especializada não foi concluída; não assumir elementos nem valores.'], capabilities: [] as ReturnType<typeof technicalAdapters>, questions: [] };
          base.capabilities = technicalAdapters(primaryDomain, base as never);
          return base;
        };
        try {
          reserveMetaCall();
          const stageA = await requestMetaStructuredImage(image.dataUrl, buildTechnicalRecognitionPrompt(), apiKey, TECHNICAL_RECOGNITION_JSON_SCHEMA as unknown as Record<string, unknown>, options.fetchImpl, MULTIMODAL_STAGE_CONFIG.recognition.maxOutputTokens, analysisAbort.signal, MULTIMODAL_STAGE_CONFIG.recognition.reasoningEffort, MULTIMODAL_STAGE_CONFIG.recognition.schemaName);
          stageLogs.push({ stage: 'recognition', log: stageA.log });
          recognition = parseTechnicalRecognition(stageA.text);
          if (recognition.route === 'stop_unknown') {
            const document = emptyDocument('unknown', recognition.documentType, recognition.summary, { confidence: 0.4, evidence: recognition.summary, rationale: 'Reconhecimento de domínio insuficiente; extracção especializada omitida.' }, []);
            const assessment = { status: 'review_required', issues: [{ code: 'DOMAIN_UNKNOWN', severity: 'warning', elementIds: [], message: 'O domínio não foi identificado; não foi executada extracção especializada.', disposition: 'review_required' }] };
            writeJson(response, 200, { contract: IMAGE_RESPONSE_CONTRACT, status: 'PARTIAL', image: { mimeType: image.mimeType, byteLength: image.byteLength, maxBytes: MAX_IMAGE_BYTES }, recognition, document, assessment, observation: null, extraction: { status: 'not_run', reason: 'unknown_domain' }, meta: aggregateMeta('partial') }, origin);
            return;
          }
          failedStage = 'extraction';
          reserveMetaCall();
          const extracted = await extractTechnicalDocumentFromRecognition(image.dataUrl, recognition, (imageDataUrl, prompt, schema, config, signal) => requestMetaStructuredImage(imageDataUrl, prompt, apiKey, schema, options.fetchImpl, config.maxOutputTokens, signal, config.reasoningEffort, config.schemaName), analysisAbort.signal);
          stageLogs.push({ stage: 'extraction', log: extracted.log });
          const { document, assessment, observation } = extracted;
          const pipelineStatus = document.analysisState === 'complete' && assessment.status === 'consistent' ? 'PASS' : 'PARTIAL';
          console.info(JSON.stringify({ event: 'meta.image', status: pipelineStatus.toLowerCase(), stages: stageLogs.map((item) => ({ stage: item.stage, httpStatus: item.log.httpStatus, latencyMs: item.log.latencyMs, usage: item.log.usage, estimatedCostUsd: item.log.estimatedCostUsd, requestId: item.log.requestId })) }));
          writeJson(response, 200, { contract: IMAGE_RESPONSE_CONTRACT, status: pipelineStatus, image: { mimeType: image.mimeType, byteLength: image.byteLength, maxBytes: MAX_IMAGE_BYTES }, recognition, document, assessment, observation, extraction: { status: 'complete' }, meta: aggregateMeta(pipelineStatus.toLowerCase()) }, origin);
          return;
        } catch (error) {
          if (analysisAbort.signal.aborted) return;
          const failedLog = error && typeof error === 'object' && 'log' in error ? (error.log as MetaCallLog) : undefined;
          const incomplete = error instanceof MetaApiError && error.kind === 'incomplete';
          const outputBudgetExhausted = incomplete && failedLog?.incompleteReason === 'max_output_tokens';
          const upstreamStatus = failedLog?.httpStatus && failedLog.httpStatus >= 400 && failedLog.httpStatus < 600 ? failedLog.httpStatus : undefined;
          const code = error instanceof MetaCallBudgetExceeded ? 'META_CALL_BUDGET_EXHAUSTED' : outputBudgetExhausted ? 'OUTPUT_BUDGET_EXHAUSTED' : incomplete ? 'RESPONSE_INCOMPLETE' : error instanceof MetaApiError && error.kind === 'invalid_json' ? 'UPSTREAM_INVALID_JSON' : error instanceof MetaApiError && error.kind === 'unexpected_envelope' ? 'UPSTREAM_ENVELOPE_UNEXPECTED' : error instanceof MetaApiError && error.kind === 'empty_output' ? 'UPSTREAM_EMPTY_OUTPUT' : failedLog?.httpStatus === 0 ? 'TRANSPORT_ERROR' : error instanceof MetaApiError && error.kind === 'http_error' ? 'META_HTTP_ERROR' : error instanceof Error && error.message.startsWith('RECOGNITION') ? 'SCHEMA_INVALID' : error instanceof Error && error.message.startsWith('SCHEMA_INVALID:') ? 'SCHEMA_INVALID' : 'META_IMAGE_REQUEST_FAILED';
          const message = outputBudgetExhausted ? `Orçamento de tokens esgotado na fase ${failedStage}; limite ${failedLog?.maxOutputTokens ?? 'desconhecido'}, raciocínio ${failedLog?.usage?.reasoningTokens ?? 'indisponível'}, saída ${failedLog?.usage?.outputTokens ?? 'indisponível'}. Nenhum documento foi aceite.` : error instanceof Error ? error.message : 'Falha no pipeline multimodal.';
          const meta = aggregateMeta('error', failedLog);
          console.info(JSON.stringify({ event: 'meta.image', status: 'error', failedStage, errorCode: code, meta }));
          if (incomplete) {
            const status = upstreamStatus ?? 502;
            writeJson(response, status, { contract: IMAGE_RESPONSE_CONTRACT, error: { code, message }, failedStage, completedStages: stageLogs.map((item) => item.stage), meta }, origin);
            return;
          }
          if (recognition && failedStage === 'extraction') {
            const document = emptyDocument(recognition.primaryDomain, recognition.documentType, recognition.summary, { confidence: 0.5, evidence: recognition.summary, rationale: 'Apenas a fase de reconhecimento terminou; a extracção especializada falhou.' }, []);
            const assessment = { status: 'review_required', issues: [{ code: 'EXTRACTION_FAILED', severity: 'warning', elementIds: [], message: `Fase B não concluída (${code}); não há elementos técnicos extraídos. ${message}`, disposition: 'review_required' }] };
            writeJson(response, 200, { contract: IMAGE_RESPONSE_CONTRACT, status: 'PARTIAL', image: { mimeType: image.mimeType, byteLength: image.byteLength, maxBytes: MAX_IMAGE_BYTES }, recognition, document, assessment, observation: null, extraction: { status: 'error', errorCode: code }, meta }, origin);
            return;
          }
          const status = upstreamStatus ?? 502;
          writeJson(response, status, { contract: IMAGE_RESPONSE_CONTRACT, error: { code, message: message.replace(/^(?:JSON_INVALID|SCHEMA_INVALID):\s*/, '') }, failedStage, completedStages: stageLogs.map((item) => item.stage), meta }, origin);
          return;
        }
      }
      if (request.url === '/api/kinematics/experiment') {
        const experimentBody = body as unknown as {
          instruction?: unknown;
          graph?: unknown;
          assembly?: unknown;
          mode?: unknown;
        };
        if (typeof experimentBody.instruction !== 'string' || !experimentBody.instruction.trim() || !experimentBody.graph || !experimentBody.assembly) {
          writeJson(response, 400, { error: { code: 'INVALID_EXPERIMENT', message: 'instruction, graph e assembly são obrigatórios.' } }, origin);
          return;
        }
        const graph = experimentBody.graph as MechanicalGraphV1;
        const assembly = experimentBody.assembly as KinematicAssemblyV1;
        const adaptation = adaptMechanicalGraph(graph, assembly);
        if (adaptation.status === 'blocked') {
          writeJson(response, 422, { error: { code: 'ASSEMBLY_BLOCKED', message: 'A montagem não pode ser enviada ao solver.', missing: adaptation.missing, issues: adaptation.issues } }, origin);
          return;
        }
        const fixture = hasFixtureProvenance(assembly);
        if (fixture && (experimentBody.mode !== 'TEST_FIXTURE_ONLY' || process.env.NODE_ENV !== 'test')) {
          writeJson(response, 403, { error: { code: 'TEST_FIXTURE_REQUIRES_TEST_ENV', message: 'TEST_FIXTURE_ONLY só pode ser usado com mode explícito em NODE_ENV=test.' } }, origin);
          return;
        }
        const prompt = buildKinematicOperationPrompt(experimentBody.instruction, assembly);
        reserveMetaCall();
        const result = await requestMetaText(prompt, apiKey, options.fetchImpl);
        const parsed = parseKinematicOperation(result.text);
        if (parsed.status === 'blocked') {
          writeJson(response, 422, { error: { code: 'MALFORMED_OPERATION', message: 'A resposta Meta não passou o contrato declarativo.', issues: parsed.issues }, meta: result.log });
          return;
        }
        const executed = executeKinematicOperation(graph, assembly, parsed.operation);
        if (executed.status === 'blocked') {
          writeJson(response, 422, { error: { code: 'OPERATION_BLOCKED', message: 'A operação não foi autorizada ou executada.', issues: executed.issues }, meta: result.log });
          return;
        }
        console.info(JSON.stringify({ event: 'kinematics.experiment', status: 'success', httpStatus: result.log.httpStatus, latencyMs: result.log.latencyMs, usage: result.log.usage, requestId: result.log.requestId }));
        writeJson(response, 200, { ...executed, meta: result.log });
        return;
      }
      if (request.url === '/api/experiments/preview') {
        const previewBody = body as unknown as { mechanismId?: unknown; instruction?: unknown; mode?: unknown; design?: unknown };
        if (previewBody.mode === DESIGN_SANDBOX_MODE) {
          const sandboxValidation = validateDesignSandboxRequest(previewBody);
          if (sandboxValidation.status === 'invalid') {
            writeJson(response, 400, { error: { code: 'INVALID_DESIGN_SANDBOX', message: 'O desenho sandbox não passou a validação.', issues: sandboxValidation.issues } }, origin);
            return;
          }
          const prompt = buildDesignSandboxPrompt(sandboxValidation.model);
          reserveMetaCall();
          const result = await requestMetaText(prompt, apiKey, options.fetchImpl);
          const parsed = parseKinematicOperation(result.text);
          if (parsed.status === 'blocked') {
            writeJson(response, 422, { error: { code: 'MALFORMED_OPERATION', message: 'A resposta Meta não passou o contrato declarativo.', issues: parsed.issues }, meta: result.log }, origin);
            return;
          }
          const executed = executeDesignSandboxOperation(sandboxValidation.model, parsed.operation);
          if (executed.status === 'blocked') {
            writeJson(response, 422, { error: { code: 'OPERATION_BLOCKED', message: 'A operação não foi autorizada ou executada.', issues: executed.issues }, meta: result.log }, origin);
            return;
          }
          console.info(JSON.stringify({ event: 'experiments.preview', mode: DESIGN_SANDBOX_MODE, status: 'success', httpStatus: result.log.httpStatus, latencyMs: result.log.latencyMs, usage: result.log.usage, requestId: result.log.requestId }));
          writeJson(response, 200, { ...executed, meta: result.log }, origin);
          return;
        }
        if (typeof previewBody.mechanismId !== 'string' || !previewBody.mechanismId.trim() || previewBody.mechanismId.length > 128 || typeof previewBody.instruction !== 'string' || !previewBody.instruction.trim() || previewBody.instruction.length > 1_000) {
          writeJson(response, 400, { error: { code: 'INVALID_EXPERIMENT_PREVIEW', message: 'mechanismId e instruction são obrigatórios e têm limites de tamanho.' } }, origin);
          return;
        }
        const resolver = options.resolvePreviewMechanism ?? defaultPreviewMechanismResolver;
        const resolved = resolver(previewBody.mechanismId);
        if (resolved.status === 'blocked') {
          writeJson(response, 422, { error: { code: 'MECHANISM_BLOCKED', message: 'A montagem identificada está bloqueada.', issues: resolved.issues } }, origin);
          return;
        }
        if (resolved.fixtureOnly && (previewBody.mode !== 'TEST_FIXTURE_ONLY' || process.env.NODE_ENV !== 'test')) {
          writeJson(response, 403, { error: { code: 'TEST_FIXTURE_REQUIRES_TEST_ENV', message: 'Fixtures requerem mode=TEST_FIXTURE_ONLY e NODE_ENV=test.' } }, origin);
          return;
        }
        const adaptation = adaptMechanicalGraph(resolved.graph, resolved.assembly);
        if (adaptation.status === 'blocked') {
          writeJson(response, 422, { error: { code: 'ASSEMBLY_BLOCKED', message: 'A montagem identificada não passou a validação mecânica.', missing: adaptation.missing, issues: adaptation.issues } }, origin);
          return;
        }
        const prompt = buildKinematicOperationPrompt(previewBody.instruction, resolved.assembly);
        reserveMetaCall();
        const result = await requestMetaText(prompt, apiKey, options.fetchImpl);
        const parsed = parseKinematicOperation(result.text);
        if (parsed.status === 'blocked') {
          writeJson(response, 422, { error: { code: 'MALFORMED_OPERATION', message: 'A resposta Meta não passou o contrato declarativo.', issues: parsed.issues }, meta: result.log }, origin);
          return;
        }
        const executed = executeKinematicOperation(resolved.graph, resolved.assembly, parsed.operation);
        if (executed.status === 'blocked') {
          writeJson(response, 422, { error: { code: 'OPERATION_BLOCKED', message: 'A operação não foi autorizada ou executada.', issues: executed.issues }, meta: result.log }, origin);
          return;
        }
        const preview: ExperimentPreview = createExperimentPreview(previewBody.mechanismId, previewBody.instruction, executed);
        console.info(JSON.stringify({ event: 'experiments.preview', status: 'success', httpStatus: result.log.httpStatus, latencyMs: result.log.latencyMs, usage: result.log.usage, requestId: result.log.requestId }));
        writeJson(response, 200, { ...preview, limitations: resolved.limitations, meta: result.log }, origin);
        return;
      }
      if (typeof body.prompt !== 'string') {
        writeJson(response, 400, { error: { code: 'INVALID_PROMPT', message: 'O campo prompt é obrigatório.' } }, origin);
        return;
      }
      reserveMetaCall();
      const result = await requestMetaText(body.prompt, apiKey, options.fetchImpl);
      console.info(JSON.stringify({ event: 'meta.text', status: result.log.status, httpStatus: result.log.httpStatus, latencyMs: result.log.latencyMs, usage: result.log.usage, requestId: result.log.requestId }));
      writeJson(response, 200, { text: result.text, meta: result.log }, origin);
    } catch (error) {
      if (error instanceof MetaCallBudgetExceeded) {
        writeJson(response, 429, { error: { code: 'META_CALL_BUDGET_EXHAUSTED', message: error.message }, metaCallBudget: diagnostics().metaCallBudget }, origin);
        return;
      }
      const log = error && typeof error === 'object' && 'log' in error ? (error.log as { httpStatus?: number; latencyMs?: number; requestId?: string; usage?: unknown }) : undefined;
      console.info(JSON.stringify({ event: 'meta.text', status: 'error', httpStatus: log?.httpStatus ?? 500, latencyMs: log?.latencyMs ?? Math.round(performance.now() - started), usage: log?.usage, requestId: log?.requestId }));
      const status = log?.httpStatus && log.httpStatus >= 400 && log.httpStatus < 600 ? log.httpStatus : 502;
      writeJson(response, status, { error: { code: 'META_REQUEST_FAILED', message: error instanceof Error ? error.message : 'Falha na chamada Meta.' }, meta: log }, origin);
    }
  });
  if (localTokenFile) server.once('close', () => removeLocalTokenFile(localTokenFile, localToken));
  return server;
}
