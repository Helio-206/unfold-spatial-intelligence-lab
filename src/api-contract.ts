export const BACKEND_DIAGNOSTICS_SCHEMA = 'unfold.backend_diagnostics.v1' as const;
export const BACKEND_CONTRACT_VERSION = 'unfold.backend.v1' as const;
export const IMAGE_PIPELINE_VERSION = 'unfold.image_pipeline.ab.v2' as const;
export const IMAGE_RESPONSE_CONTRACT = 'unfold.image_analysis.v1' as const;
export const TECHNICAL_DOCUMENT_SCHEMA_VERSION = 'technical_document.v1' as const;
export const TECHNICAL_RECOGNITION_SCHEMA_VERSION = 'technical_recognition.v2' as const;

export type BackendDiagnosticsV1 = {
  schema: typeof BACKEND_DIAGNOSTICS_SCHEMA;
  contractVersion: typeof BACKEND_CONTRACT_VERSION;
  buildId: string;
  pipelineVersion: typeof IMAGE_PIPELINE_VERSION;
  responseSchemaVersion: typeof TECHNICAL_DOCUMENT_SCHEMA_VERSION;
  recognitionSchemaVersion: typeof TECHNICAL_RECOGNITION_SCHEMA_VERSION;
  startedAt: string;
  capabilities: {
    imageAnalysis: { available: true; apiKeyConfigured: boolean; responseContract: typeof IMAGE_RESPONSE_CONTRACT };
    contextualConversation: { available: true; apiKeyConfigured: boolean };
    imageRegionVerification: { available: true; apiKeyConfigured: boolean };
  };
  metaCallBudget: { limit: number | null; used: number; remaining: number | null };
};

export class BackendCompatibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackendCompatibilityError';
  }
}

export function validateBackendDiagnostics(value: unknown): BackendDiagnosticsV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BackendCompatibilityError('O backend não forneceu diagnóstico de versão válido. Análise real bloqueada.');
  const candidate = value as Partial<BackendDiagnosticsV1>;
  const capabilities = candidate.capabilities;
  const expectedVersions = candidate.schema === BACKEND_DIAGNOSTICS_SCHEMA
    && candidate.contractVersion === BACKEND_CONTRACT_VERSION
    && candidate.pipelineVersion === IMAGE_PIPELINE_VERSION
    && candidate.responseSchemaVersion === TECHNICAL_DOCUMENT_SCHEMA_VERSION
    && candidate.recognitionSchemaVersion === TECHNICAL_RECOGNITION_SCHEMA_VERSION;
  const timestampValid = typeof candidate.startedAt === 'string' && Number.isFinite(Date.parse(candidate.startedAt));
  const budget = candidate.metaCallBudget;
  const budgetValid = budget && Number.isSafeInteger(budget.used) && budget.used >= 0
    && (budget.limit === null || Number.isSafeInteger(budget.limit) && budget.limit >= 0)
    && (budget.remaining === null || Number.isSafeInteger(budget.remaining) && budget.remaining >= 0)
    && (budget.limit === null ? budget.remaining === null : budget.remaining === Math.max(0, budget.limit - budget.used));
  if (!expectedVersions || typeof candidate.buildId !== 'string' || !candidate.buildId || !timestampValid
    || !budgetValid
    || !capabilities || capabilities.imageAnalysis?.available !== true
    || capabilities.imageAnalysis.responseContract !== IMAGE_RESPONSE_CONTRACT
    || capabilities.imageAnalysis.apiKeyConfigured !== true
    || capabilities.contextualConversation?.available !== true || capabilities.contextualConversation.apiKeyConfigured !== true
    || capabilities.imageRegionVerification?.available !== true || capabilities.imageRegionVerification.apiKeyConfigured !== true) {
    throw new BackendCompatibilityError('Backend incompatível ou sem configuração completa para o pipeline multimodal actual. Análise Meta bloqueada.');
  }
  return candidate as BackendDiagnosticsV1;
}

export async function verifyBackendCompatibility(fetchImpl: typeof fetch = fetch): Promise<BackendDiagnosticsV1> {
  let response: Response;
  try { response = await fetchImpl('/api/diagnostics', { method: 'GET', cache: 'no-store' }); }
  catch { throw new BackendCompatibilityError('Não foi possível confirmar a identidade do backend. Análise Meta bloqueada.'); }
  if (!response.ok) throw new BackendCompatibilityError(`O backend não suporta diagnóstico de contrato (HTTP ${response.status}). Análise Meta bloqueada.`);
  let payload: unknown;
  try { payload = await response.json(); }
  catch { throw new BackendCompatibilityError('O diagnóstico do backend não contém JSON válido. Análise Meta bloqueada.'); }
  return validateBackendDiagnostics(payload);
}
