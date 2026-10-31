import { createHash } from 'node:crypto';
import { closeSync, existsSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requestMetaStructuredImage } from '../src/meta';
import { readImageFileAsDataUrl } from '../src/image-input';
import { IMAGE_PIPELINE_VERSION, TECHNICAL_RECOGNITION_SCHEMA_VERSION } from '../src/api-contract';
import { MULTIMODAL_STAGE_CONFIG, parseTechnicalRecognition, buildTechnicalRecognitionPrompt, TECHNICAL_RECOGNITION_JSON_SCHEMA } from '../src/technical-document-pipeline';

type GlobalCallLedger = {
  schema: 'unfold.global_meta_call_ledger.v1';
  authorization: { maximumCalls: 6; previouslyConsumed: 5; phaseAllowance: 1 };
  history: Array<{ phase: string; realCalls: number; requestId?: string; source: string }>;
  phase: { name: '7E.3'; authorizedCalls: 1; usedCalls: 0 | 1 };
  limit: 6;
  used: 5 | 6;
  remaining: 0 | 1;
  status: 'READY_FOR_SINGLE_CALL' | 'CALL_RESERVED' | 'CALL_COMPLETED' | 'CALL_FAILED';
  reservation?: { reservedAt: string };
  lastCall?: { requestId?: string; httpStatus?: number; responseStatus?: string; completedAt: string };
};

function writeLedgerAtomically(path: string, ledger: GlobalCallLedger): void {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporaryPath, path);
}

function withLedgerLock<T>(path: string, action: (ledger: GlobalCallLedger) => { ledger: GlobalCallLedger; result: T }): T {
  const lockPath = `${path}.lock`;
  let lockDescriptor: number;
  try { lockDescriptor = openSync(lockPath, 'wx', 0o600); }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') throw new Error('PHASE7E3_LEDGER_LOCKED');
    throw error;
  }
  try {
    const ledger = JSON.parse(readFileSync(path, 'utf8')) as GlobalCallLedger;
    const outcome = action(ledger);
    writeLedgerAtomically(path, outcome.ledger);
    return outcome.result;
  } finally {
    closeSync(lockDescriptor);
    unlinkSync(lockPath);
  }
}

export function reserveAuthorizedCall(path: string, now = new Date().toISOString()): GlobalCallLedger {
  return withLedgerLock(path, (ledger) => {
    const validHistoryTotal = ledger.history.reduce((sum, entry) => sum + entry.realCalls, 0);
    if (ledger.schema !== 'unfold.global_meta_call_ledger.v1' || ledger.authorization.maximumCalls !== 6 || ledger.authorization.previouslyConsumed !== 5 || ledger.authorization.phaseAllowance !== 1 || validHistoryTotal !== 5 || ledger.phase.name !== '7E.3' || ledger.phase.authorizedCalls !== 1 || ledger.phase.usedCalls !== 0 || ledger.limit !== 6 || ledger.used !== 5 || ledger.remaining !== 1 || ledger.status !== 'READY_FOR_SINGLE_CALL') throw new Error('PHASE7E3_BUDGET_NOT_AVAILABLE');
    const reserved: GlobalCallLedger = { ...ledger, phase: { ...ledger.phase, usedCalls: 1 }, used: 6, remaining: 0, status: 'CALL_RESERVED', reservation: { reservedAt: now } };
    return { ledger: reserved, result: reserved };
  });
}

export function finishAuthorizedCall(path: string, result: { requestId?: string; httpStatus?: number; responseStatus?: string; completedAt?: string; success: boolean }): void {
  withLedgerLock(path, (ledger) => {
    if (ledger.schema !== 'unfold.global_meta_call_ledger.v1' || ledger.phase.usedCalls !== 1 || ledger.used !== 6 || ledger.remaining !== 0 || ledger.status !== 'CALL_RESERVED') throw new Error('PHASE7E3_RESERVATION_STATE_INVALID');
    const finished: GlobalCallLedger = {
      ...ledger,
      status: result.success ? 'CALL_COMPLETED' : 'CALL_FAILED',
      lastCall: { requestId: result.requestId, httpStatus: result.httpStatus, responseStatus: result.responseStatus, completedAt: result.completedAt ?? new Date().toISOString() },
    };
    return { ledger: finished, result: undefined };
  });
}

async function runLiveRecognition(): Promise<void> {
  if (!process.argv.includes('--execute-one-authorized-call')) throw new Error('Use --execute-one-authorized-call to consume the single authorized request.');
  const apiKey = process.env.MODEL_API_KEY;
  if (!apiKey) throw new Error('MODEL_API_KEY não está configurada; chamada interrompida antes da reserva.');

  const projectRoot = process.cwd();
  const imagePath = '/tmp/codex-clipboard-c3cb2657-3e2d-4e21-b4a3-0e0c292dfe03.png';
  const ledgerPath = resolve(projectRoot, 'reports/phase-7e3/call-ledger.json');
  const evidencePath = resolve(projectRoot, 'reports/phase-7e3/live-recognition.json');
  if (!existsSync(ledgerPath)) throw new Error('Global call ledger is missing.');
  const image = readImageFileAsDataUrl(imagePath);
  const imageBytes = Buffer.from(image.dataUrl.split(',')[1]!, 'base64');
  const imageSha256 = createHash('sha256').update(imageBytes).digest('hex');

  const diagnosticsResponse = await fetch('http://127.0.0.1:8787/api/diagnostics');
  const diagnostics = await diagnosticsResponse.json() as { contractVersion?: string; pipelineVersion?: string; recognitionSchemaVersion?: string; buildId?: string; capabilities?: { imageAnalysis?: { apiKeyConfigured?: boolean } }; metaCallBudget?: { limit?: number | null; used?: number; remaining?: number | null } };
  if (!diagnosticsResponse.ok || diagnostics.contractVersion !== 'unfold.backend.v1' || diagnostics.pipelineVersion !== IMAGE_PIPELINE_VERSION || diagnostics.recognitionSchemaVersion !== TECHNICAL_RECOGNITION_SCHEMA_VERSION || !diagnostics.buildId || diagnostics.capabilities?.imageAnalysis?.apiKeyConfigured !== true || diagnostics.metaCallBudget?.remaining !== 0) throw new Error('LIVE_BACKEND_PREFLIGHT_FAILED');

  reserveAuthorizedCall(ledgerPath);
  const startedAt = new Date().toISOString();
  let result: Awaited<ReturnType<typeof requestMetaStructuredImage>> | undefined;
  let validated: ReturnType<typeof parseTechnicalRecognition> | undefined;
  let validationError: string | undefined;
  try {
    result = await requestMetaStructuredImage(
      image.dataUrl,
      buildTechnicalRecognitionPrompt(),
      apiKey,
      TECHNICAL_RECOGNITION_JSON_SCHEMA as unknown as Record<string, unknown>,
      fetch,
      MULTIMODAL_STAGE_CONFIG.recognition.maxOutputTokens,
      undefined,
      MULTIMODAL_STAGE_CONFIG.recognition.reasoningEffort,
      MULTIMODAL_STAGE_CONFIG.recognition.schemaName,
    );
    try { validated = parseTechnicalRecognition(result.text); }
    catch (error) { validationError = error instanceof Error ? error.message : 'SCHEMA_VALIDATION_FAILED'; }
    const semanticallyAligned = validated?.primaryDomain === 'architecture' && validated.route === 'extract' && /planta|residencial/i.test(`${validated.documentType} ${validated.summary}`);
    const completedAt = new Date().toISOString();
    const usage = result.log.usage;
    const evidence = {
      evidenceType: 'real_provider_call_stage_a',
      phase: '7E.3',
      image: { fileName: 'codex-clipboard-c3cb2657-3e2d-4e21-b4a3-0e0c292dfe03.png', sha256: imageSha256, mimeType: image.mimeType, byteLength: image.byteLength },
      build: { id: diagnostics.buildId, pipelineVersion: diagnostics.pipelineVersion, recognitionSchemaVersion: diagnostics.recognitionSchemaVersion },
      request: { model: result.log.model, endpoint: result.log.endpoint, schemaName: MULTIMODAL_STAGE_CONFIG.recognition.schemaName, reasoningEffort: MULTIMODAL_STAGE_CONFIG.recognition.reasoningEffort, maxOutputTokens: MULTIMODAL_STAGE_CONFIG.recognition.maxOutputTokens, stagesRequested: ['recognition'], retries: 0 },
      response: { requestId: result.log.requestId, httpStatus: result.log.httpStatus, responseStatus: result.log.responseStatus, incompleteReason: result.log.incompleteReason, latencyMs: result.log.latencyMs, usage: { inputTokens: usage?.inputTokens, reasoningTokens: usage?.reasoningTokens, outputTokens: usage?.outputTokens, visibleOutputTokens: usage?.outputTokens === undefined ? undefined : Math.max(0, usage.outputTokens - (usage.reasoningTokens ?? 0)), totalTokens: usage?.totalTokens, cachedInputTokens: usage?.cachedInputTokens }, estimatedCostUsd: result.log.estimatedCostUsd },
      validation: { jsonParsed: true, schemaValid: validated !== undefined, error: validationError ?? null, semanticGate: semanticallyAligned ? 'architecture_route_extract_residential_plan' : 'review_required' },
      recognition: validated ?? null,
      rawOutputText: result.text,
      stagesAfterRecognition: { extractionB: 'not_run', contextualMeta: 'not_run', regionalVerificationC: 'not_run' },
      startedAt,
      completedAt,
    };
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
    finishAuthorizedCall(ledgerPath, { requestId: result.log.requestId, httpStatus: result.log.httpStatus, responseStatus: result.log.responseStatus, completedAt, success: validated !== undefined });
    console.log(JSON.stringify({ evidencePath, requestId: result.log.requestId, httpStatus: result.log.httpStatus, responseStatus: result.log.responseStatus, schemaValid: validated !== undefined, semanticGate: evidence.validation.semanticGate, tokens: evidence.response.usage, latencyMs: result.log.latencyMs }));
    if (!validated) process.exitCode = 1;
  } catch (error) {
    const apiError = error && typeof error === 'object' && 'log' in error ? (error as { log: { model?: string; endpoint?: string; requestId?: string; httpStatus?: number; responseStatus?: string; incompleteReason?: string; latencyMs?: number; maxOutputTokens?: number; usage?: unknown; estimatedCostUsd?: number } }).log : undefined;
    const completedAt = new Date().toISOString();
    const evidence = {
      evidenceType: 'real_provider_call_stage_a', phase: '7E.3',
      image: { fileName: 'codex-clipboard-c3cb2657-3e2d-4e21-b4a3-0e0c292dfe03.png', sha256: imageSha256, mimeType: image.mimeType, byteLength: image.byteLength },
      build: { id: diagnostics.buildId, pipelineVersion: diagnostics.pipelineVersion, recognitionSchemaVersion: diagnostics.recognitionSchemaVersion },
      request: { model: apiError?.model ?? 'muse-spark-1.3', endpoint: apiError?.endpoint ?? 'https://api.meta.ai/v1/responses', schemaName: MULTIMODAL_STAGE_CONFIG.recognition.schemaName, reasoningEffort: MULTIMODAL_STAGE_CONFIG.recognition.reasoningEffort, maxOutputTokens: MULTIMODAL_STAGE_CONFIG.recognition.maxOutputTokens, stagesRequested: ['recognition'], retries: 0 },
      response: { requestId: apiError?.requestId, httpStatus: apiError?.httpStatus, responseStatus: apiError?.responseStatus, incompleteReason: apiError?.incompleteReason, latencyMs: apiError?.latencyMs, usage: apiError?.usage, estimatedCostUsd: apiError?.estimatedCostUsd },
      validation: { jsonParsed: false, schemaValid: false, error: error instanceof Error ? error.message : 'LIVE_RECOGNITION_FAILED', semanticGate: 'not_assessed' },
      recognition: validated ?? null,
      rawOutputText: result?.text ?? null,
      stagesAfterRecognition: { extractionB: 'not_run', contextualMeta: 'not_run', regionalVerificationC: 'not_run' },
      startedAt,
      completedAt,
    };
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
    finishAuthorizedCall(ledgerPath, { requestId: apiError?.requestId, httpStatus: apiError?.httpStatus, responseStatus: apiError?.responseStatus, completedAt, success: false });
    console.error(JSON.stringify({ evidencePath, error: evidence.validation.error, requestId: apiError?.requestId, httpStatus: apiError?.httpStatus, responseStatus: apiError?.responseStatus }));
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  runLiveRecognition().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Phase 7E.3 preflight failed.');
    process.exitCode = 1;
  });
}
