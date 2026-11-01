const META_BASE_URL = 'https://api.meta.ai/v1';
const META_MODEL = 'muse-spark-1.3';

export type MetaUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
};

export type MetaCallLog = {
  model: string;
  endpoint: string;
  requestId?: string;
  httpStatus: number;
  latencyMs: number;
  responseStatus?: string;
  incompleteReason?: string;
  maxOutputTokens?: number;
  usage?: MetaUsage;
  estimatedCostUsd?: number;
  upstreamEnvelope?: { fields: string[]; outputItemTypes: string[]; contentTypes: string[]; outputTextLength: number };
  status: 'success' | 'error';
};

export type MetaFailureKind = 'http_error' | 'network_error' | 'incomplete' | 'unexpected_envelope' | 'invalid_json' | 'empty_output' | 'model_error';

export function sanitizeMetaEvidenceExcerpt(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const safe = value.slice(0, 2_000)
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk|rk|api)[-_][A-Za-z0-9_-]{12,}\b/gi, '[REDACTED]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]');
  return safe;
}

export class MetaApiError extends Error {
  constructor(message: string, readonly log: MetaCallLog, readonly kind: MetaFailureKind, readonly upstreamExcerpt?: string) {
    super(message);
    this.name = 'MetaApiError';
  }
}

type ResponsesPayload = {
  id?: string;
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output_text?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens_details?: { reasoning_tokens?: number };
  };
  error?: { message?: string };
};

export const META_SPARK_STANDARD_RATES_USD_PER_MILLION = { input: 1.25, cachedInput: 0.15, output: 4.25 } as const;

export type MechanicalObservation = {
  elements: Array<{
    id: string;
    kind: 'bar' | 'joint' | 'fixed';
    label: string;
    observed: true;
    evidence: string;
    confidence: number;
  }>;
  connections: Array<{
    from: string;
    to: string;
    relation: string;
    observed: true;
    evidence: string;
  }>;
  dimensions: Array<{
    label: string;
    value: string;
    observed: true;
    evidence: string;
  }>;
  ambiguities: string[];
  missingInformation: string[];
};

export function validateMechanicalObservation(value: unknown): MechanicalObservation {
  if (!value || typeof value !== 'object') throw new Error('A resposta não é um objecto JSON.');
  const candidate = value as Partial<MechanicalObservation>;
  if (!Array.isArray(candidate.elements) || !Array.isArray(candidate.connections) || !Array.isArray(candidate.dimensions) || !Array.isArray(candidate.ambiguities) || !Array.isArray(candidate.missingInformation)) {
    throw new Error('JSON mecânico incompleto: campos obrigatórios ausentes.');
  }
  const elements = candidate.elements;
  const connections = candidate.connections;
  const dimensions = candidate.dimensions;
  for (const element of elements) {
    if (!element || typeof element !== 'object' || typeof element.id !== 'string' || !element.id || !['bar', 'joint', 'fixed'].includes(element.kind ?? '') || typeof element.label !== 'string' || !element.label || element.observed !== true || typeof element.evidence !== 'string' || !element.evidence || typeof element.confidence !== 'number' || !Number.isFinite(element.confidence) || element.confidence < 0 || element.confidence > 1) {
      throw new Error('Elemento mecânico inválido ou não marcado como observado.');
    }
  }
  const elementIds = new Set(elements.map((element) => element.id));
  for (const connection of connections) {
    if (!connection || typeof connection !== 'object' || typeof connection.from !== 'string' || typeof connection.to !== 'string' || !elementIds.has(connection.from) || !elementIds.has(connection.to) || typeof connection.relation !== 'string' || !connection.relation || connection.observed !== true || typeof connection.evidence !== 'string' || !connection.evidence) {
      throw new Error('Ligação mecânica inválida ou não marcada como observada.');
    }
  }
  for (const dimension of dimensions) {
    if (!dimension || typeof dimension !== 'object' || typeof dimension.label !== 'string' || !dimension.label || typeof dimension.value !== 'string' || !dimension.value || dimension.observed !== true || typeof dimension.evidence !== 'string' || !dimension.evidence) {
      throw new Error('Dimensão inválida ou não marcada como explicitamente observada.');
    }
  }
  if (!candidate.ambiguities.every((item) => typeof item === 'string') || !candidate.missingInformation.every((item) => typeof item === 'string')) throw new Error('Ambiguidades ou informação em falta inválidas.');
  if (elements.some((element) => elements.filter((item) => item.id === element.id).length > 1)) throw new Error('IDs de elementos duplicados.');
  return candidate as MechanicalObservation;
}

function readOutputText(payload: ResponsesPayload): string | undefined {
  if (typeof payload.output_text === 'string' && payload.output_text.length > 0) return payload.output_text;
  const text = payload.output?.flatMap((item) => item.content ?? []).map((item) => item.text).filter((value): value is string => Boolean(value)).join('\n');
  return text || undefined;
}

function describeUpstreamEnvelope(payload: unknown): MetaCallLog['upstreamEnvelope'] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { fields: [], outputItemTypes: [], contentTypes: [], outputTextLength: 0 };
  const candidate = payload as ResponsesPayload & Record<string, unknown>;
  const output = Array.isArray(candidate.output) ? candidate.output : [];
  const content = output.flatMap((item) => Array.isArray(item?.content) ? item.content : []);
  return {
    fields: Object.keys(candidate).filter((key) => /^[a-z][a-z0-9_]{0,50}$/i.test(key)).sort().slice(0, 40),
    outputItemTypes: [...new Set(output.map((item) => typeof item?.type === 'string' ? item.type.slice(0, 40) : 'unspecified'))].slice(0, 12),
    contentTypes: [...new Set(content.map((item) => typeof item?.type === 'string' ? item.type.slice(0, 40) : 'unspecified'))].slice(0, 12),
    outputTextLength: typeof candidate.output_text === 'string' ? Math.min(candidate.output_text.length, 100_000) : content.reduce((sum, item) => sum + (typeof item?.text === 'string' ? item.text.length : 0), 0),
  };
}

function readUsage(payload: ResponsesPayload): MetaUsage | undefined {
  if (!payload.usage) return undefined;
  return {
    inputTokens: payload.usage.input_tokens,
    outputTokens: payload.usage.output_tokens,
    totalTokens: payload.usage.total_tokens,
    cachedInputTokens: payload.usage.input_tokens_details?.cached_tokens,
    reasoningTokens: payload.usage.output_tokens_details?.reasoning_tokens,
  };
}

function estimateMetaCostUsd(usage: MetaUsage | undefined): number | undefined {
  if (!usage || usage.inputTokens === undefined || usage.outputTokens === undefined) return undefined;
  const cached = Math.min(usage.inputTokens, usage.cachedInputTokens ?? 0);
  const regularInput = usage.inputTokens - cached;
  const { input, cachedInput, output } = META_SPARK_STANDARD_RATES_USD_PER_MILLION;
  return Number(((regularInput * input + cached * cachedInput + usage.outputTokens * output) / 1_000_000).toFixed(8));
}

type MetaInput = string | Array<{ type: 'message'; role: 'user'; content: Array<{ type: 'input_text'; text: string } | { type: 'input_image'; image_url: string; detail?: 'low' | 'high' | 'auto' | 'original' }> }>;

async function requestMetaInput(input: MetaInput, apiKey: string | undefined, fetchImpl: typeof fetch = fetch, maxOutputTokens?: number, structuredOutput?: { name: string; schema: Record<string, unknown> }, callerSignal?: AbortSignal, reasoningEffort?: 'low' | 'medium' | 'high'): Promise<{ text: string; log: MetaCallLog }> {
  if (!apiKey) throw new Error('MODEL_API_KEY não está configurada; chamada Meta interrompida.');

  const endpoint = `${META_BASE_URL}/responses`;
  const started = performance.now();
  let response: Response;
  let payload: ResponsesPayload = {};
  let invalidJson = false;
  let rawEnvelope: unknown;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: META_MODEL, input, ...(maxOutputTokens ? { max_output_tokens: maxOutputTokens } : {}), ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}), ...(structuredOutput ? { text: { format: { type: 'json_schema', name: structuredOutput.name, schema: structuredOutput.schema, strict: true } } } : {}) }),
      signal: callerSignal ? AbortSignal.any([callerSignal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
    });
    const raw = await response.text();
    try { rawEnvelope = JSON.parse(raw); payload = rawEnvelope as ResponsesPayload; }
    catch { invalidJson = true; payload = {}; }
  } catch (error) {
    const log: MetaCallLog = { model: META_MODEL, endpoint, ...(maxOutputTokens ? { maxOutputTokens } : {}), httpStatus: 0, latencyMs: Math.round(performance.now() - started), status: 'error' };
    throw new MetaApiError(error instanceof Error ? error.message : 'Falha de rede ao contactar a Meta.', log, 'network_error');
  }

  const log: MetaCallLog = {
    model: META_MODEL,
    endpoint,
    requestId: response.headers.get('x-request-id') ?? payload.id,
    httpStatus: response.status,
    latencyMs: Math.round(performance.now() - started),
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
    responseStatus: payload.status,
    ...(payload.incomplete_details?.reason ? { incompleteReason: payload.incomplete_details.reason } : {}),
    usage: readUsage(payload),
    estimatedCostUsd: estimateMetaCostUsd(readUsage(payload)),
    upstreamEnvelope: describeUpstreamEnvelope(rawEnvelope),
    status: response.ok && payload.status === 'completed' && Boolean(readOutputText(payload)) ? 'success' : 'error',
  };
  const excerpt = sanitizeMetaEvidenceExcerpt(readOutputText(payload));
  if (!response.ok) throw new MetaApiError(`Meta respondeu HTTP ${response.status}.`, log, 'http_error', sanitizeMetaEvidenceExcerpt(payload.error?.message) ?? excerpt);
  if (invalidJson) throw new MetaApiError('A resposta da Meta não contém JSON válido.', { ...log, status: 'error' }, 'invalid_json');
  if (payload.status === 'incomplete') throw new MetaApiError(`Resposta incompleta${payload.incomplete_details?.reason ? ` (${payload.incomplete_details.reason})` : ''}.`, { ...log, status: 'error' }, 'incomplete', excerpt);
  if (payload.status === 'failed' || payload.status === 'error' || payload.error) throw new MetaApiError('O fornecedor devolveu um estado de erro sem resposta utilizável.', { ...log, status: 'error' }, 'model_error', excerpt);
  if (payload.status !== 'completed' || !rawEnvelope || typeof rawEnvelope !== 'object' || Array.isArray(rawEnvelope)) throw new MetaApiError(`Envelope Responses API inesperado (status=${String(payload.status ?? 'ausente')}).`, { ...log, status: 'error' }, 'unexpected_envelope', excerpt);
  const text = readOutputText(payload);
  if (!text) throw new MetaApiError('A resposta Meta não contém texto utilizável.', { ...log, status: 'error' }, 'empty_output');
  return { text, log };
}

export async function requestMetaText(prompt: string, apiKey: string | undefined, fetchImpl: typeof fetch = fetch, maxOutputTokens?: number): Promise<{ text: string; log: MetaCallLog }> {
  if (!prompt.trim() || prompt.length > 4_000) throw new Error('Prompt inválido: use entre 1 e 4000 caracteres.');
  return requestMetaInput(prompt, apiKey, fetchImpl, maxOutputTokens);
}

export async function requestMetaImageText(imageDataUrl: string, prompt: string, apiKey: string | undefined, fetchImpl: typeof fetch = fetch): Promise<{ text: string; log: MetaCallLog }> {
  if (!imageDataUrl.startsWith('data:image/')) throw new Error('Imagem inválida: esperado data URL de imagem.');
  if (!prompt.trim() || prompt.length > 8_000) throw new Error('Prompt inválido: use entre 1 e 8000 caracteres.');
  return requestMetaInput([{ type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }, { type: 'input_image', image_url: imageDataUrl }] }], apiKey, fetchImpl);
}

export async function requestMetaStructuredImage(imageDataUrl: string, prompt: string, apiKey: string | undefined, schema: Record<string, unknown>, fetchImpl: typeof fetch = fetch, maxOutputTokens = 4_000, callerSignal?: AbortSignal, reasoningEffort: 'low' | 'medium' | 'high' = 'low', schemaName = 'technical_document_v1', imageDetail: 'low' | 'high' | 'auto' | 'original' = 'auto'): Promise<{ text: string; log: MetaCallLog }> {
  if (!imageDataUrl.startsWith('data:image/')) throw new Error('Imagem inválida: esperado data URL de imagem.');
  if (!prompt.trim() || prompt.length > 8_000) throw new Error('Prompt inválido: use entre 1 e 8000 caracteres.');
  return requestMetaInput([{ type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }, { type: 'input_image', image_url: imageDataUrl, detail: imageDetail }] }], apiKey, fetchImpl, maxOutputTokens, { name: schemaName, schema }, callerSignal, reasoningEffort);
}

export async function requestMetaStructuredText(prompt: string, apiKey: string | undefined, schema: Record<string, unknown>, fetchImpl: typeof fetch = fetch, maxOutputTokens = 500, reasoningEffort: 'low' | 'medium' | 'high' = 'low', schemaName = 'unfold_conversation_v1', callerSignal?: AbortSignal): Promise<{ text: string; log: MetaCallLog }> {
  if (!prompt.trim() || prompt.length > 24_000) throw new Error('Prompt inválido: use entre 1 e 24000 caracteres.');
  return requestMetaInput(prompt, apiKey, fetchImpl, maxOutputTokens, { name: schemaName, schema }, callerSignal, reasoningEffort);
}

export { META_BASE_URL, META_MODEL };
