import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MetaApiError, requestMetaStructuredImage, requestMetaStructuredText, type MetaCallLog } from '../src/meta';
import { readImageFileAsDataUrl } from '../src/image-input';
import { buildTechnicalRecognitionPrompt, MULTIMODAL_STAGE_CONFIG, parseTechnicalRecognition, TECHNICAL_RECOGNITION_JSON_SCHEMA } from '../src/technical-document-pipeline';
import { extractTechnicalDocumentFromRecognition, TechnicalExtractionValidationError } from '../src/technical-extraction';
import { buildConversationPrompt, CONVERSATION_JSON_SCHEMA, parseConversationResponse, validateConversationRequest } from '../src/spatial-conversation';
import type { TechnicalDocumentV1 } from '../src/technical-document';

type Ledger = {
  schema: 'unfold.phase_7e4_call_ledger.v1';
  phase: '7E.4';
  previousGlobalLedger: 'reports/phase-7e3/call-ledger.json';
  previousGlobalCalls: 6;
  additionalAuthorization: { maximumCalls: 6; explicitUserAuthorization: true; authorizedAt: string; statement: string };
  usedCalls: number;
  remainingCalls: number;
  status: 'AUTHORIZED' | 'CALL_RESERVED' | 'CALL_COMPLETED' | 'CALL_FAILED' | 'STOPPED_CRITICAL_FAILURE';
  retryPolicy: 'none';
  concurrency: 'serial_only';
  stopOnCriticalFailure: true;
  historyPreserved: true;
  callHistory: Array<{ index: number; name: string; state: 'reserved' | 'completed' | 'failed'; reservedAt: string; completedAt?: string; requestId?: string; httpStatus?: number; responseStatus?: string; latencyMs?: number; usage?: MetaCallLog['usage']; estimatedCostUsd?: number; errorCode?: string }>;
};

const root = process.cwd();
const liveDirectory = resolve(root, 'reports/phase-7e4/live');
const ledgerPath = resolve(root, 'reports/phase-7e4/call-ledger.json');
const globalLedgerPath = resolve(root, 'reports/phase-7e3/call-ledger.json');
const imagePaths = {
  architecture: '/tmp/codex-clipboard-c3cb2657-3e2d-4e21-b4a3-0e0c292dfe03.png',
  electrical: '/tmp/codex-clipboard-44cb8f57-d072-4062-b7f4-51fb49a1c927.png',
  mechanical: resolve(root, 'input/mechanism-paderborn.jpg'),
};
const recognitionConfig = MULTIMODAL_STAGE_CONFIG.recognition;
const extractionConfig = { maxOutputTokens: 12_288, reasoningEffort: 'high' as const, schemaName: 'technical_document_v1' };
const contextConfig = { maxOutputTokens: 8_192, reasoningEffort: 'high' as const, schemaName: 'unfold_conversation_v1' };
const steps = [
  { name: 'architecture-B-resume', kind: 'B', image: imagePaths.architecture, domain: 'architecture' },
  { name: 'electrical-A', kind: 'A', image: imagePaths.electrical, domain: 'electrical_installation' },
  { name: 'electrical-B', kind: 'B', image: imagePaths.electrical, domain: 'electrical_installation' },
  { name: 'paderborn-A', kind: 'A', image: imagePaths.mechanical, domain: 'mechanical' },
  { name: 'paderborn-B', kind: 'B', image: imagePaths.mechanical, domain: 'mechanical' },
  { name: 'contextual-question', kind: 'Q', image: null, domain: null },
] as const;

function atomicJson(path: string, value: unknown): void {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

function withLedgerLock<T>(action: (ledger: Ledger) => { ledger: Ledger; result: T }): T {
  const lockPath = `${ledgerPath}.lock`;
  let descriptor: number;
  try { descriptor = openSync(lockPath, 'wx', 0o600); }
  catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') throw new Error('PHASE7E4_LEDGER_LOCKED'); throw error; }
  try {
    const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8')) as Ledger;
    const outcome = action(ledger);
    atomicJson(ledgerPath, outcome.ledger);
    return outcome.result;
  } finally { closeSync(descriptor); unlinkSync(lockPath); }
}

function verifyGlobalHistory(): void {
  const previous = JSON.parse(readFileSync(globalLedgerPath, 'utf8')) as { limit?: number; used?: number; remaining?: number; status?: string };
  if (previous.limit !== 6 || previous.used !== 6 || previous.remaining !== 0 || previous.status !== 'CALL_COMPLETED') throw new Error('PHASE7E3_LEDGER_CHANGED_OR_INVALID');
}

function reserve(index: number): void {
  verifyGlobalHistory();
  withLedgerLock((ledger) => {
    if (ledger.schema !== 'unfold.phase_7e4_call_ledger.v1' || !ledger.additionalAuthorization.explicitUserAuthorization || ledger.additionalAuthorization.maximumCalls !== 6 || ledger.usedCalls !== index - 1 || ledger.remainingCalls !== 6 - (index - 1) || ledger.status === 'STOPPED_CRITICAL_FAILURE' || ledger.callHistory.some((call) => call.state === 'reserved')) throw new Error('PHASE7E4_BUDGET_OR_SEQUENCE_INVALID');
    const prior = ledger.callHistory.at(-1);
    if (index === 1 ? prior !== undefined : prior?.state !== 'completed') throw new Error('PHASE7E4_PREVIOUS_CALL_NOT_COMPLETED');
    const reservation = { index, name: steps[index - 1]!.name, state: 'reserved' as const, reservedAt: new Date().toISOString() };
    const next = { ...ledger, usedCalls: index, remainingCalls: 6 - index, status: 'CALL_RESERVED' as const, callHistory: [...ledger.callHistory, reservation] };
    return { ledger: next, result: undefined };
  });
}

function finish(index: number, log: MetaCallLog | undefined, errorCode?: string): void {
  withLedgerLock((ledger) => {
    const current = ledger.callHistory[index - 1];
    if (!current || current.state !== 'reserved' || ledger.usedCalls !== index) throw new Error('PHASE7E4_RESERVATION_STATE_INVALID');
    const failed = Boolean(errorCode) || log?.status !== 'success';
    const callHistory = ledger.callHistory.map((item) => item.index === index ? {
      ...item,
      state: failed ? 'failed' as const : 'completed' as const,
      completedAt: new Date().toISOString(),
      ...(log ? { requestId: log.requestId, httpStatus: log.httpStatus, responseStatus: log.responseStatus, latencyMs: log.latencyMs, usage: log.usage, estimatedCostUsd: log.estimatedCostUsd } : {}),
      ...(errorCode ? { errorCode } : {}),
    } : item);
    const status = failed ? 'STOPPED_CRITICAL_FAILURE' as const : 'CALL_COMPLETED' as const;
    return { ledger: { ...ledger, callHistory, status }, result: undefined };
  });
}

function evidencePath(index: number, name: string): string { return resolve(liveDirectory, `step-${index}-${name}.json`); }
function loadJson<T>(path: string): T { return JSON.parse(readFileSync(path, 'utf8')) as T; }
function imageEvidence(path: string) {
  const input = readImageFileAsDataUrl(path);
  const bytes = Buffer.from(input.dataUrl.slice(input.dataUrl.indexOf(',') + 1), 'base64');
  return { ...input, sha256: createHash('sha256').update(bytes).digest('hex'), fileName: path.split('/').at(-1) };
}
function requestCall(index: number): { name: string; status: string; requestId?: string; outputFile: string } {
  const call = loadJson<{ requestId?: string; validation?: { status?: string } }>(evidencePath(index, steps[index - 1]!.name));
  if (call.validation?.status !== 'valid') throw new Error('PHASE7E4_PREVIOUS_STAGE_NOT_VALID');
  return { name: steps[index - 1]!.name, status: call.validation.status, requestId: call.requestId, outputFile: evidencePath(index, steps[index - 1]!.name) };
}

async function executeStep(index: number): Promise<void> {
  if (!Number.isInteger(index) || index < 1 || index > 6) throw new Error('Use --step 1..6; one call per invocation.');
  if (!process.argv.includes('--execute')) throw new Error('Missing --execute; no request sent.');
  const apiKey = process.env.MODEL_API_KEY;
  if (!apiKey) throw new Error('MODEL_API_KEY não configurada; nenhuma chamada foi reservada.');
  verifyGlobalHistory();
  const ledger = loadJson<Ledger>(ledgerPath);
  if (!ledger.additionalAuthorization.explicitUserAuthorization || ledger.status === 'STOPPED_CRITICAL_FAILURE') throw new Error('PHASE7E4_NOT_AUTHORIZED_OR_STOPPED');
  if (ledger.usedCalls !== index - 1) throw new Error('PHASE7E4_CALLS_MUST_RUN_IN_SEQUENCE');
  if (index === 3 && !requestCall(2).status || index === 5 && !requestCall(4).status || index === 6 && !requestCall(5).status) throw new Error('PHASE7E4_STAGE_DEPENDENCY_NOT_VALID');
  if (index === 2 && !requestCall(1).status) throw new Error('PHASE7E4_ARCHITECTURE_STAGE_NOT_VALID');
  if (index === 4 && !requestCall(3).status) throw new Error('PHASE7E4_ELECTRICAL_STAGE_NOT_VALID');

  const step = steps[index - 1]!;
  mkdirSync(liveDirectory, { recursive: true });
  const startedAt = new Date().toISOString();
  const sourceFingerprint = createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex');
  let log: MetaCallLog | undefined;
  let rawOutputText: string | undefined;
  let result: Record<string, unknown> = {};
  let validation: { status: 'valid' | 'invalid'; errors: string[] } = { status: 'invalid', errors: [] };
  let image: ReturnType<typeof imageEvidence> | undefined;
  let recognition: ReturnType<typeof parseTechnicalRecognition> | undefined;
  let document: TechnicalDocumentV1 | undefined;

  if (step.image) image = imageEvidence(step.image);
  if (index === 1) {
    const previous = loadJson<{ evidenceType: string; image: { sha256: string; fileName: string }; rawOutputText: string; recognition: unknown; response: { requestId: string; httpStatus: number; responseStatus: string } }>(resolve(root, 'reports/phase-7e3/live-recognition.json'));
    if (previous.evidenceType !== 'real_provider_call_stage_a' || previous.response.httpStatus !== 200 || previous.response.responseStatus !== 'completed' || image?.sha256 !== previous.image.sha256 || image?.fileName !== previous.image.fileName) throw new Error('PHASE7E4_STAGE_A_IMAGE_BINDING_INVALID');
    recognition = parseTechnicalRecognition(previous.rawOutputText);
    if (JSON.stringify(recognition) !== JSON.stringify(previous.recognition)) throw new Error('PHASE7E4_STAGE_A_PROVENANCE_INVALID');
  } else if (index === 3) {
    const prior = loadJson<{ recognition: ReturnType<typeof parseTechnicalRecognition> }>(evidencePath(2, steps[1].name));
    recognition = prior.recognition;
  } else if (index === 5) {
    const prior = loadJson<{ recognition: ReturnType<typeof parseTechnicalRecognition> }>(evidencePath(4, steps[3].name));
    recognition = prior.recognition;
  }

  reserve(index);
  const outputFile = evidencePath(index, step.name);
  try {
    if (step.kind === 'A') {
      const response = await requestMetaStructuredImage(image!.dataUrl, buildTechnicalRecognitionPrompt(), apiKey, TECHNICAL_RECOGNITION_JSON_SCHEMA as unknown as Record<string, unknown>, fetch, recognitionConfig.maxOutputTokens, undefined, recognitionConfig.reasoningEffort, recognitionConfig.schemaName, 'high');
      log = response.log;
      rawOutputText = response.text;
      recognition = parseTechnicalRecognition(response.text);
      const semanticOk = recognition.primaryDomain === step.domain && recognition.route === 'extract';
      validation = semanticOk ? { status: 'valid', errors: [] } : { status: 'invalid', errors: [`A recognition esperava ${step.domain}, recebeu ${recognition.primaryDomain}/${recognition.route}.`] };
      result = { recognition };
    } else if (step.kind === 'B') {
      if (!recognition) throw new Error('PHASE7E4_RECOGNITION_MISSING');
      const response = await extractTechnicalDocumentFromRecognition(image!.dataUrl, recognition, (dataUrl, prompt, schema, config, signal) => requestMetaStructuredImage(dataUrl, prompt, apiKey, schema, fetch, config.maxOutputTokens, signal, config.reasoningEffort, config.schemaName, 'high'), undefined, extractionConfig);
      log = response.log;
      rawOutputText = response.rawOutputText;
      const extractedDocument = response.document;
      document = extractedDocument;
      const semanticOk = extractedDocument.primaryDomain === step.domain;
      validation = semanticOk ? { status: 'valid', errors: [] } : { status: 'invalid', errors: [`A extracção B divergiu do domínio esperado ${step.domain}: ${extractedDocument.primaryDomain}.`] };
      result = { document: extractedDocument, assessment: response.assessment, observation: response.observation };
    } else {
      const accepted = loadJson<{ document: TechnicalDocumentV1 }>(evidencePath(5, steps[4].name));
      const contextDocument = accepted.document;
      document = contextDocument;
      const facts = contextDocument.elements.slice(0, 20).map((item) => `${item.id}: ${item.label}; estado=${item.status}; valor=${item.rawValue ?? 'não indicado'}; evidência=${item.evidence}`);
      const context = validateConversationRequest({
        message: 'Com base no documento acabado de analisar, indica uma medida ou elemento específico que ficou incerto, cita o seu ID se existir e explica que evidência da imagem sustenta essa incerteza. Distingue observação de interpretação; se o documento aceite não contiver essa informação, declara-o sem completar por suposição.',
        history: [],
        context: { mode: 'EMPTY', project: null, document: { domain: contextDocument.primaryDomain, summary: contextDocument.summary, facts, missing: contextDocument.missingInformation.slice(0, 20), uncertainty: contextDocument.ambiguities.slice(0, 20), corrections: [] } },
      });
      const response = await requestMetaStructuredText(buildConversationPrompt(context), apiKey, CONVERSATION_JSON_SCHEMA as unknown as Record<string, unknown>, fetch, contextConfig.maxOutputTokens, contextConfig.reasoningEffort, contextConfig.schemaName);
      log = response.log;
      rawOutputText = response.text;
      const contextualResponse = parseConversationResponse(response.text);
      const evidenceWasIncluded = contextualResponse.kind === 'answer' && contextualResponse.basis !== 'unknown' && document.elements.some((item) => contextualResponse.text.includes(item.id) || contextualResponse.text.includes(item.label));
      validation = evidenceWasIncluded ? { status: 'valid', errors: [] } : { status: 'invalid', errors: ['Resposta contextual sem referência textual identificável aos factos do documento.'] };
      result = { contextualResponse, sourceDocumentDomain: contextDocument.primaryDomain, sourceDocumentSummary: contextDocument.summary };
    }
    const completedAt = new Date().toISOString();
    const evidence = {
      evidenceType: 'real_provider_call', phase: '7E.4', index, stage: step.kind, name: step.name,
      image: image ? { fileName: image.fileName, sha256: image.sha256, mimeType: image.mimeType, byteLength: image.byteLength } : undefined,
      priorRecognition: index === 1 ? { phase: '7E.3', requestId: '6a09cfd4-140a-46b3-b964-1a52db4b5dba', reused: true } : undefined,
      build: { runnerSha256: sourceFingerprint },
      request: { model: 'muse-spark-1.3', endpoint: 'https://api.meta.ai/v1/responses', reasoningEffort: step.kind === 'A' ? 'low' : 'high', maxOutputTokens: step.kind === 'A' ? 2_048 : step.kind === 'B' ? 12_288 : 8_192, schemaName: step.kind === 'A' ? 'technical_recognition_v2' : step.kind === 'B' ? 'technical_document_v1' : 'unfold_conversation_v1', imageDetail: image ? 'high' : undefined, retries: 0 },
      response: { requestId: log?.requestId, httpStatus: log?.httpStatus, responseStatus: log?.responseStatus, incompleteReason: log?.incompleteReason, latencyMs: log?.latencyMs, maxOutputTokens: log?.maxOutputTokens, usage: log?.usage, estimatedCostUsd: log?.estimatedCostUsd },
      validation, ...result, rawOutputText, startedAt, completedAt,
    };
    atomicJson(outputFile, evidence);
    const criticalError = validation.status !== 'valid' ? 'SEMANTIC_OR_SCHEMA_GATE_FAILED' : undefined;
    finish(index, log, criticalError);
    console.log(JSON.stringify({ outputFile, index, name: step.name, validation, requestId: log?.requestId, httpStatus: log?.httpStatus, responseStatus: log?.responseStatus, latencyMs: log?.latencyMs, usage: log?.usage, estimatedCostUsd: log?.estimatedCostUsd }));
    if (criticalError) process.exitCode = 1;
  } catch (error) {
    const apiError = error instanceof MetaApiError ? error : undefined;
    const validationError = error instanceof TechnicalExtractionValidationError ? error : undefined;
    const failedLog = apiError?.log ?? validationError?.log;
    const failedRaw = validationError?.rawOutputText ?? rawOutputText ?? null;
    const code = apiError?.kind ?? (error instanceof Error ? error.message : 'LIVE_STEP_FAILED');
    atomicJson(outputFile, { evidenceType: 'real_provider_call', phase: '7E.4', index, stage: step.kind, name: step.name, image: image ? { fileName: image.fileName, sha256: image.sha256, mimeType: image.mimeType, byteLength: image.byteLength } : undefined, request: { model: 'muse-spark-1.3', reasoningEffort: step.kind === 'A' ? 'low' : 'high', maxOutputTokens: step.kind === 'A' ? 2_048 : step.kind === 'B' ? 12_288 : 8_192, retries: 0 }, response: failedLog ?? null, validation: { status: 'invalid', errors: [code] }, rawOutputText: failedRaw, startedAt, completedAt: new Date().toISOString() });
    finish(index, failedLog, code);
    console.error(JSON.stringify({ outputFile, index, errorCode: code, requestId: failedLog?.requestId, httpStatus: failedLog?.httpStatus, responseStatus: failedLog?.responseStatus, usage: failedLog?.usage }));
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const stepIndex = process.argv.indexOf('--step');
  const step = stepIndex < 0 ? Number.NaN : Number(process.argv[stepIndex + 1]);
  executeStep(step).catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Phase 7E.4 preflight failed.'); process.exitCode = 1; });
}
