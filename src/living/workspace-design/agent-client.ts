/**
 * The workspace's only door to the intelligence: the existing `/api/spatial-agent` route and its
 * `spatial_agent_request.v1` / `spatial_agent_result.v1` contracts (src/spatial-agent.ts). Mechanical mode, so the
 * assistant may only propose Select, Inspect or Focus. Every result passes the same parser and authorisation checks
 * the product uses, including fixture results.
 *
 * When the live model is unavailable (no backend, no MODEL_API_KEY), the client answers from a deterministic fixture
 * and labels the reply as such. Contract violations from a live model are reported as errors, never replaced by a fixture.
 */
import { parseSpatialAgentResult, SPATIAL_AGENT_REQUEST_SCHEMA, type SpatialAgentRequestV1, type SpatialAgentResultV1 } from '../../spatial-agent';
import type { ComponentRegistry } from '../visual-foundry/component-registry';
import { fixtureAgentResult } from './fixture-agent';

export const AGENT_CAPABILITIES: SpatialAgentRequestV1['capabilities'] = ['Select', 'Inspect', 'Focus'];
export type HistoryItem = { role: 'user' | 'assistant'; text: string };

export function buildAgentRequest(query: string, registry: ComponentRegistry, selectedId: string | null, history: HistoryItem[]): SpatialAgentRequestV1 {
  const components = registry.all().filter((c) => c.kind !== 'joint').slice(0, 40).map((c) => ({
    id: c.id, label: c.label.slice(0, 120), kind: c.role, dimensionsM: null, verification: `${c.origin}/${c.validation}`.slice(0, 40),
  }));
  return {
    schema: SPATIAL_AGENT_REQUEST_SCHEMA, query: query.slice(0, 500), mode: 'mechanical', capabilities: [...AGENT_CAPABILITIES],
    scene: {
      id: registry.assemblyId, revisionId: `${registry.assemblyId}.fixture-r1`, revisionNumber: 1,
      selectedId: selectedId && components.some((c) => c.id === selectedId) ? selectedId : null, components,
      constraints: ['Montagem sintética (fixture): nada aqui é dado de fabricante.', 'O motor de engenharia não está ligado: o assistente não calcula movimento.'],
    },
    document: null,
    history: history.slice(-6).map((h) => ({ role: h.role, text: h.text.slice(0, 300) })),
  };
}

export type AgentOutcome =
  | { status: 'ok'; source: 'live'; result: SpatialAgentResultV1; meta: { model: string | null; requestId: string | null } }
  | { status: 'ok'; source: 'fixture'; result: SpatialAgentResultV1; reason: string }
  | { status: 'error'; code: string; message: string };

const FALLBACK_CODES = new Set(['MODEL_API_KEY_MISSING', 'NOT_FOUND', 'BACKEND_UNREACHABLE', 'FIXTURE_MODE']);

export type AgentClientOptions = {
  fetchImpl?: typeof fetch;
  /** 'auto' tries the live route and falls back to the fixture when it is unavailable; 'fixture' never calls the network. */
  mode?: 'auto' | 'fixture';
  endpoint?: string;
  timeoutMs?: number;
};

export async function askAgent(request: SpatialAgentRequestV1, options: AgentClientOptions = {}, signal?: AbortSignal): Promise<AgentOutcome> {
  const mode = options.mode ?? 'auto';
  const fixture = (reason: string): AgentOutcome => {
    try { return { status: 'ok', source: 'fixture', result: parseSpatialAgentResult(JSON.stringify(fixtureAgentResult(request)), request), reason }; }
    catch (error) { return { status: 'error', code: error instanceof Error ? error.message : 'FIXTURE_INVALID', message: 'O fixture produziu um resultado fora do contrato.' }; }
  };
  if (mode === 'fixture') return fixture('FIXTURE_MODE');
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), options.timeoutMs ?? 30_000);
  const onAbort = () => abort.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  let response: Response;
  try {
    response = await fetchImpl(options.endpoint ?? '/api/spatial-agent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request), signal: abort.signal });
  } catch (error) {
    clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
    if (signal?.aborted) return { status: 'error', code: 'ABORTED', message: 'Pedido cancelado.' };
    void error;
    return fixture('BACKEND_UNREACHABLE');
  }
  clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = payload && typeof payload === 'object' && 'error' in payload && typeof (payload.error as { code?: unknown })?.code === 'string' ? (payload.error as { code: string }).code : null;
    if (code && FALLBACK_CODES.has(code)) return fixture(code);
    if (!code && [404, 500, 502, 503, 504].includes(response.status)) return fixture('BACKEND_UNREACHABLE');
    return { status: 'error', code: code ?? `HTTP_${response.status}`, message: `O assistente não respondeu (${code ?? response.status}).` };
  }
  if (!payload || typeof payload !== 'object' || !('result' in payload)) return { status: 'error', code: 'SPATIAL_AGENT_INVALID_ENVELOPE', message: 'Resposta do assistente sem resultado.' };
  try {
    const result = parseSpatialAgentResult(JSON.stringify((payload as { result: unknown }).result), request);
    const meta = (payload as { meta?: { model?: unknown; requestId?: unknown } }).meta;
    return { status: 'ok', source: 'live', result, meta: { model: typeof meta?.model === 'string' ? meta.model : null, requestId: typeof meta?.requestId === 'string' ? meta.requestId : null } };
  } catch (error) {
    return { status: 'error', code: error instanceof Error ? error.message : 'SPATIAL_AGENT_INVALID_RESULT', message: 'A resposta do assistente não passou a validação; nada foi executado.' };
  }
}
