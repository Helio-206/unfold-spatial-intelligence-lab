import { validateAssembly } from '../contracts';
import { validateAssemblyProposal, validateExcavatorObservation } from '../reconstruction/contracts';
import { dimensionsFromHeader } from '../../plan-image';
import {
  RECONSTRUCTION_CONTRACT, RECONSTRUCTION_ENDPOINT, REVIEW_CONTRACT,
  type Outcome, type ProposeRequest, type ReconstructionFailure, type ReconstructionProposal, type ReviewedReconstruction, type ReviewSubmission,
} from './types';

export const MAX_IMAGE_BYTES = 10_000_000;
export const MAX_IMAGE_SIDE_PX = 10_000;
export const MAX_IMAGE_PIXELS = 16_000_000;
export const MAX_INSTRUCTION_CHARS = 8_000;
export const MAX_REFERENCE_CHARS = 200;

export type ReconstructionClientOptions = {
  fetchImpl?: typeof fetch;
  /** Base URL; empty for same-origin (the Vite proxy). A browser sends `Origin`, which is what the server's guard accepts. */
  baseUrl?: string;
  /** Only for non-browser callers (tests, scripts) that send no `Origin`. The browser frontend must never hold this token. */
  localToken?: string;
  timeoutMs?: number;
};

const fail = (failure: ReconstructionFailure): { ok: false; failure: ReconstructionFailure } => ({ ok: false, failure });
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Same limits as the server, applied before any bytes leave the page. The server remains the authority. */
export function inputProblems(request: ProposeRequest): string[] {
  const problems: string[] = [];
  if (request.sourceReference !== undefined && (!request.sourceReference.trim() || request.sourceReference.length > MAX_REFERENCE_CHARS)) problems.push('sourceReference inválido');
  if (request.mode !== undefined && request.mode !== 'live' && request.mode !== 'offline') problems.push('mode deve ser live ou offline');
  if (request.sourceKind === 'text') {
    if (!request.instruction.trim() || request.instruction.length > MAX_INSTRUCTION_CHARS) problems.push('instrução vazia ou superior a 8000 caracteres');
    return problems;
  }
  const match = /^data:(image\/jpeg|image\/png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(request.imageDataUrl);
  if (!match) { problems.push('imagem: esperado data URL JPEG ou PNG em base64'); return problems; }
  if (request.imageDataUrl.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 128) { problems.push('imagem excede o limite de 10 MB'); return problems; }
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(match[2]!), (c) => c.charCodeAt(0)); } catch { problems.push('imagem: base64 inválido'); return problems; }
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) { problems.push('imagem vazia ou superior ao limite de 10 MB'); return problems; }
  const { width, height } = dimensionsFromHeader(bytes, match[1]!);
  if (!width || !height) problems.push('imagem sem dimensões legíveis no cabeçalho');
  else if (width > MAX_IMAGE_SIDE_PX || height > MAX_IMAGE_SIDE_PX || width * height > MAX_IMAGE_PIXELS) problems.push('dimensões da imagem excedem os limites');
  return problems;
}

function failureFromStatus(status: number, body: unknown): ReconstructionFailure {
  const error = isObject(body) && isObject(body.error) ? body.error : {};
  const code = typeof error.code === 'string' ? error.code : 'UNKNOWN';
  if (status === 422 && isObject(body) && body.status === 'blocked' && Array.isArray(body.reasons)) return { kind: 'blocked', reasons: body.reasons.filter((r): r is string => typeof r === 'string') };
  if (status === 404 && code === 'RECONSTRUCTION_SESSION_NOT_FOUND') return { kind: 'session_expired' };
  if (status === 429) return code === 'RECONSTRUCTION_RATE_LIMITED' ? { kind: 'rate_limited' } : code === 'META_CALL_BUDGET_EXHAUSTED' ? { kind: 'budget_exhausted' } : { kind: 'rate_limited' };
  if (status === 503 && code === 'RECONSTRUCTION_SESSION_CAPACITY') return { kind: 'capacity' };
  if (status === 400) return { kind: 'invalid_input', reasons: [typeof error.message === 'string' ? error.message : code] };
  if (status === 403 || status === 421 || status === 405 || status === 415) return { kind: 'guard_rejected', status, code };
  return { kind: 'upstream', status, code };
}

export function createReconstructionClient(options: ReconstructionClientOptions = {}) {
  const url = `${options.baseUrl ?? ''}${RECONSTRUCTION_ENDPOINT}`;

  async function post(payload: unknown, signal?: AbortSignal): Promise<{ ok: true; body: unknown } | { ok: false; failure: ReconstructionFailure }> {
    const impl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), options.timeoutMs ?? 60_000);
    const onAbort = () => abort.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (options.localToken) headers['x-unfold-local-token'] = options.localToken;
      const response = await impl(url, { method: 'POST', headers, body: JSON.stringify(payload), signal: abort.signal });
      let body: unknown = null;
      try { body = await response.json(); } catch { body = null; }
      if (!response.ok) return { ok: false, failure: failureFromStatus(response.status, body) };
      return { ok: true, body };
    } catch (error) {
      if (signal?.aborted) return { ok: false, failure: { kind: 'aborted' } };
      if (abort.signal.aborted) return { ok: false, failure: { kind: 'network', message: 'tempo esgotado' } };
      return { ok: false, failure: { kind: 'network', message: error instanceof Error ? error.message : 'pedido falhou' } };
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
  }

  return {
    /** First call: an observation and a proposal to review. Never an engineering result. */
    async propose(request: ProposeRequest, signal?: AbortSignal): Promise<Outcome<ReconstructionProposal>> {
      const problems = inputProblems(request);
      if (problems.length) return fail({ kind: 'invalid_input', reasons: problems });
      const sent = await post(request, signal);
      if (!sent.ok) return sent;
      return parseProposal(sent.body);
    },

    /** Second call. The server cannot authenticate the reviewer or the measurement; both stay `unverified` in the result. */
    async submitReview(sessionId: string, review: ReviewSubmission, signal?: AbortSignal): Promise<Outcome<ReviewedReconstruction>> {
      const sent = await post({ action: 'review', sessionId, review }, signal);
      if (!sent.ok) return sent;
      return parseReviewed(sent.body, sessionId);
    },
  };
}

export type ReconstructionClient = ReturnType<typeof createReconstructionClient>;

export function parseProposal(body: unknown): Outcome<ReconstructionProposal> {
  const issues: string[] = [];
  if (!isObject(body) || body.contract !== RECONSTRUCTION_CONTRACT) return fail({ kind: 'bad_response', issues: ['contrato inesperado'] });
  if (typeof body.sessionId !== 'string' || !body.sessionId) issues.push('sessionId em falta');
  if (body.mode !== 'live' && body.mode !== 'offline') issues.push('mode inválido');
  if (body.status !== 'review_required' && body.status !== 'blocked') issues.push('status inválido');
  // The adapter is never reached from a proposal: the server reports engineering as blocked, and so do we.
  if (!isObject(body.engineering) || body.engineering.status !== 'blocked') issues.push('engineering deve estar bloqueado numa proposta');
  let observation, assemblyProposal;
  try { observation = validateExcavatorObservation(body.observation); } catch (e) { issues.push(`observação: ${e instanceof Error ? e.message : 'inválida'}`); }
  try { assemblyProposal = validateAssemblyProposal(body.assemblyProposal); } catch (e) { issues.push(`proposta: ${e instanceof Error ? e.message : 'inválida'}`); }
  if (issues.length || !observation || !assemblyProposal) return fail({ kind: 'bad_response', issues });
  const engineering = body.engineering as { reason?: unknown };
  return { ok: true, value: {
    contract: RECONSTRUCTION_CONTRACT, sessionId: body.sessionId as string, mode: body.mode as 'live' | 'offline', status: body.status as 'review_required' | 'blocked',
    observation, assemblyProposal, engineering: { status: 'blocked', reason: typeof engineering.reason === 'string' ? engineering.reason : '' },
    limitations: Array.isArray(body.limitations) ? body.limitations.filter((l): l is string => typeof l === 'string') : [],
    meta: { model: isObject(body.meta) && typeof body.meta.model === 'string' ? body.meta.model : null, requestId: isObject(body.meta) && typeof body.meta.requestId === 'string' ? body.meta.requestId : null },
  } };
}

export function parseReviewed(body: unknown, expectedSessionId: string): Outcome<ReviewedReconstruction> {
  if (!isObject(body) || body.contract !== REVIEW_CONTRACT) return fail({ kind: 'bad_response', issues: ['contrato inesperado'] });
  const issues: string[] = [];
  if (body.status !== 'contract_valid' || body.validation !== 'contract_valid') issues.push('estado diferente de contract_valid');
  if (body.sessionId !== expectedSessionId) issues.push('sessionId não corresponde à sessão pedida');
  if (body.mode !== 'live' && body.mode !== 'offline') issues.push('mode inválido');
  const provenance = body.provenance;
  if (!isObject(provenance) || !isObject(provenance.review) || provenance.review.reviewerIdentity !== 'unverified' || provenance.review.humanParticipation !== 'unverified'
    || !isObject(provenance.bucketWidth) || provenance.bucketWidth.measurement !== 'unverified' || !isObject(provenance.remainingGeometry) || provenance.remainingGeometry.source !== 'synthetic_fixture') issues.push('proveniência ausente ou a afirmar mais do que o contrato permite');
  const geometry = body.geometry;
  if (!isObject(geometry) || typeof geometry.bucketWidthBeforeM !== 'number' || typeof geometry.bucketWidthAfterM !== 'number') issues.push('geometry inválida');
  const assemblyCheck = validateAssembly(body.assembly);
  if (!assemblyCheck.ok) issues.push(...assemblyCheck.issues.slice(0, 5).map((i) => `assembly ${i.path}: ${i.code}`));
  let originalObservation, proposal;
  try { originalObservation = validateExcavatorObservation(body.originalObservation); } catch (e) { issues.push(`observação original: ${e instanceof Error ? e.message : 'inválida'}`); }
  try { proposal = validateAssemblyProposal(body.proposal); } catch (e) { issues.push(`proposta: ${e instanceof Error ? e.message : 'inválida'}`); }
  if (issues.length || !originalObservation || !proposal) return fail({ kind: 'bad_response', issues });
  return { ok: true, value: {
    contract: REVIEW_CONTRACT, sessionId: expectedSessionId, mode: body.mode as 'live' | 'offline', status: 'contract_valid', originalObservation, review: body.review as ReviewedReconstruction['review'],
    provenance: provenance as ReviewedReconstruction['provenance'], assembly: body.assembly as ReviewedReconstruction['assembly'], proposal, validation: 'contract_valid',
    geometry: geometry as ReviewedReconstruction['geometry'], limitations: Array.isArray(body.limitations) ? body.limitations.filter((l): l is string => typeof l === 'string') : [],
  } };
}
