import { validateMechanicalObservation, type MechanicalObservation } from './meta';
import { parseTechnicalDocumentText, type TechnicalDocumentV1 } from './technical-document';
import { parseTechnicalRecognition, type SemanticAssessment, type TechnicalRecognitionV1, type RegionVerification } from './technical-document-pipeline';
import { IMAGE_RESPONSE_CONTRACT, verifyBackendCompatibility } from './api-contract';

export const IMAGE_DEMO_MAX_BYTES = 10_000_000;
export const IMAGE_DEMO_MIME_TYPES = ['image/jpeg', 'image/png'] as const;
export type ImageDemoMime = typeof IMAGE_DEMO_MIME_TYPES[number];

export function getPastedImageFile(clipboardData: DataTransfer | null): File | undefined {
  if (!clipboardData) return undefined;
  for (const item of Array.from(clipboardData.items)) {
    if (item.kind !== 'file' || !IMAGE_DEMO_MIME_TYPES.includes(item.type as ImageDemoMime)) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  return undefined;
}

export function handlePastedImage(event: Pick<ClipboardEvent, 'clipboardData' | 'preventDefault'>, onImage: (file: File) => void): boolean {
  const file = getPastedImageFile(event.clipboardData);
  if (!file) return false;
  event.preventDefault();
  onImage(file);
  return true;
}

export type ImageAnalysisResult = {
  contract: typeof IMAGE_RESPONSE_CONTRACT;
  fileName: string;
  previewDataUrl: string;
  image: { mimeType: ImageDemoMime; byteLength: number; maxBytes: number };
  document: TechnicalDocumentV1;
  observation: MechanicalObservation | null;
  recognition?: TechnicalRecognitionV1;
  assessment?: SemanticAssessment;
  extraction?: { status: 'complete' | 'incomplete' | 'error' | 'not_run'; errorCode?: string; reason?: string };
  meta?: { model?: string; requestId?: string; httpStatus?: number; latencyMs?: number; estimatedCostUsd?: number; stages?: Array<{ stage?: string; requestId?: string; httpStatus?: number; latencyMs?: number; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number; reasoningTokens?: number; cachedInputTokens?: number }; estimatedCostUsd?: number }>; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number; reasoningTokens?: number; cachedInputTokens?: number } };
};

export type ImageRegionRequest = {
  cropDataUrl: string;
  targetId: string;
  targetLabel: string;
  question: string;
  region: { x: number; y: number; width: number; height: number };
  originalSize: { width: number; height: number };
};

export type ImageRegionResult = { targetId: string; region: ImageRegionRequest['region']; originalSize: ImageRegionRequest['originalSize']; verification: RegionVerification; limitation: string; meta?: ImageAnalysisResult['meta'] };

export type ImageSimulationReadiness = {
  status: 'blocked' | 'ready';
  missing: string[];
};

function hasJpegSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function hasPngSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && Array.from(bytes.subarray(0, 8)).join(',') === '137,80,78,71,13,10,26,10';
}

export function validateImageDemoFile(file: File): ImageDemoMime {
  if (!IMAGE_DEMO_MIME_TYPES.includes(file.type as ImageDemoMime)) throw new Error('Formato inválido. Seleccione um JPEG ou PNG.');
  if (file.size === 0) throw new Error('A imagem está vazia.');
  if (file.size > IMAGE_DEMO_MAX_BYTES) throw new Error('A imagem excede o limite de processamento de 10 MB.');
  return file.type as ImageDemoMime;
}

async function fileToDataUrl(file: File, signal: AbortSignal): Promise<string> {
  validateImageDemoFile(file);
  if (signal.aborted) throw new DOMException('Operação cancelada.', 'AbortError');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (signal.aborted) throw new DOMException('Operação cancelada.', 'AbortError');
  const validSignature = file.type === 'image/jpeg' ? hasJpegSignature(bytes) : hasPngSignature(bytes);
  if (!validSignature) throw new Error('A assinatura binária da imagem não corresponde ao MIME declarado.');
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  return `data:${file.type};base64,${btoa(binary)}`;
}

export async function requestImageAnalysis(file: File, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<ImageAnalysisResult> {
  const previewDataUrl = await fileToDataUrl(file, signal);
  await verifyBackendCompatibility(fetchImpl);
  if (signal.aborted) throw new DOMException('Operação cancelada.', 'AbortError');
  const response = await fetchImpl('/api/meta/image', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ imageDataUrl: previewDataUrl }),
    signal,
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('O backend devolveu uma resposta inválida.');
  }
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'error' in payload && payload.error && typeof payload.error === 'object' && 'message' in payload.error && typeof payload.error.message === 'string'
      ? payload.error.message
      : `A análise falhou com HTTP ${response.status}.`;
    throw new Error(message);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('O backend não devolveu um objecto de resposta válido.');
  const candidate = payload as { contract?: unknown; document?: unknown; observation?: unknown; image?: { mimeType?: unknown; byteLength?: unknown; maxBytes?: unknown }; recognition?: unknown; assessment?: unknown; extraction?: ImageAnalysisResult['extraction']; meta?: ImageAnalysisResult['meta'] };
  if (candidate.contract !== IMAGE_RESPONSE_CONTRACT) throw new Error('Contrato de resposta de imagem incompatível; o backend pode estar desactualizado. Nenhum resultado foi aceite.');
  if (!('document' in candidate) || !candidate.image) throw new Error('O backend não devolveu um documento técnico completo.');
  let document: TechnicalDocumentV1;
  try { document = parseTechnicalDocumentText(JSON.stringify(candidate.document)); }
  catch (error) { throw new Error(error instanceof Error ? error.message : 'Documento técnico inválido.'); }
  const observation = candidate.observation === null || candidate.observation === undefined ? null : validateMechanicalObservation(candidate.observation);
  if (document.primaryDomain === 'mechanical' && observation === null && candidate.extraction?.status !== 'incomplete' && candidate.extraction?.status !== 'error' || document.primaryDomain !== 'mechanical' && observation !== null) throw new Error('O Mechanical Observation não corresponde ao domínio documental.');
  if (!IMAGE_DEMO_MIME_TYPES.includes(candidate.image.mimeType as ImageDemoMime) || typeof candidate.image.byteLength !== 'number' || typeof candidate.image.maxBytes !== 'number') throw new Error('Metadados da imagem inválidos.');
  const recognition = candidate.recognition === undefined ? undefined : validateRecognition(candidate.recognition);
  const assessment = candidate.assessment === undefined ? undefined : validateAssessment(candidate.assessment);
  return {
    fileName: file.name,
    contract: IMAGE_RESPONSE_CONTRACT,
    previewDataUrl,
    image: { mimeType: candidate.image.mimeType as ImageDemoMime, byteLength: candidate.image.byteLength, maxBytes: candidate.image.maxBytes },
    document,
    observation,
    ...(recognition ? { recognition } : {}),
    ...(assessment ? { assessment } : {}),
    ...(candidate.extraction ? { extraction: candidate.extraction } : {}),
    meta: candidate.meta,
  };
}

function validateRecognition(value: unknown): TechnicalRecognitionV1 {
  try { return parseTechnicalRecognition(JSON.stringify(value)); }
  catch { throw new Error('Reconhecimento multimodal inválido.'); }
}

function validateAssessment(value: unknown): SemanticAssessment {
  if (!value || typeof value !== 'object' || !('status' in value) || !['consistent', 'review_required', 'rejected'].includes(String(value.status)) || !('issues' in value) || !Array.isArray(value.issues) || value.issues.length > 50 || !value.issues.every((issue) => issue && typeof issue === 'object' && 'code' in issue && typeof issue.code === 'string' && issue.code.length <= 80 && 'severity' in issue && ['warning', 'error'].includes(String(issue.severity)) && 'message' in issue && typeof issue.message === 'string' && issue.message.length <= 500 && 'elementIds' in issue && Array.isArray(issue.elementIds) && issue.elementIds.length <= 40 && issue.elementIds.every((id: unknown) => typeof id === 'string' && id.length <= 100) && 'disposition' in issue && ['review_required', 'rejected'].includes(String(issue.disposition)))) throw new Error('Avaliação semântica inválida.');
  return value as SemanticAssessment;
}

export async function requestImageRegionVerification(request: ImageRegionRequest, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<ImageRegionResult> {
  if (!/^data:image\/(?:jpeg|png);base64,/.test(request.cropDataUrl) || request.cropDataUrl.length > 14_000_000) throw new Error('O recorte não é uma imagem JPEG/PNG válida ou excede o limite.');
  if (!request.targetId.trim() || request.targetId.length > 100 || !request.targetLabel.trim() || request.targetLabel.length > 160 || !request.question.trim() || request.question.length > 240) throw new Error('Alvo ou pergunta de verificação inválidos.');
  const { x, y, width, height } = request.region;
  if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1 || !Number.isInteger(request.originalSize.width) || !Number.isInteger(request.originalSize.height) || request.originalSize.width < 1 || request.originalSize.height < 1) throw new Error('Região de origem inválida.');
  await verifyBackendCompatibility(fetchImpl);
  if (signal.aborted) throw new DOMException('Operação cancelada.', 'AbortError');
  const response = await fetchImpl('/api/meta/image/verify-region', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cropImageDataUrl: request.cropDataUrl, targetId: request.targetId, targetLabel: request.targetLabel, question: request.question, region: request.region, originalSize: request.originalSize }), signal,
  });
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'error' in payload && payload.error && typeof payload.error === 'object' && 'message' in payload.error && typeof payload.error.message === 'string' ? payload.error.message : `A releitura falhou com HTTP ${response.status}.`;
    throw new Error(message);
  }
  if (!payload || typeof payload !== 'object' || !('targetId' in payload) || payload.targetId !== request.targetId || !('verification' in payload) || !('region' in payload) || !payload.region || typeof payload.region !== 'object' || !('originalSize' in payload) || !payload.originalSize || typeof payload.originalSize !== 'object' || !('limitation' in payload) || typeof payload.limitation !== 'string') throw new Error('A resposta de verificação localizada não corresponde ao contrato.');
  const responseRegion = payload.region as ImageRegionRequest['region'];
  const responseSize = payload.originalSize as ImageRegionRequest['originalSize'];
  if (['x', 'y', 'width', 'height'].some((key) => responseRegion[key as keyof ImageRegionRequest['region']] !== request.region[key as keyof ImageRegionRequest['region']]) || responseSize.width !== request.originalSize.width || responseSize.height !== request.originalSize.height) throw new Error('A região devolvida não corresponde à selecção sobre a imagem original.');
  const verification = payload.verification;
  if (!verification || typeof verification !== 'object' || !('status' in verification) || !['readable', 'uncertain', 'not_visible'].includes(String(verification.status)) || !('reading' in verification) || !(verification.reading === null || typeof verification.reading === 'string') || !('unit' in verification) || !(verification.unit === null || typeof verification.unit === 'string') || !('visibleText' in verification) || !(verification.visibleText === null || typeof verification.visibleText === 'string') || !('alternatives' in verification) || !Array.isArray(verification.alternatives) || !verification.alternatives.every((item) => typeof item === 'string' && item.length <= 80) || !('regionReference' in verification) || verification.regionReference !== 'selected_crop' || !('explanation' in verification) || typeof verification.explanation !== 'string') throw new Error('A resposta de verificação localizada é inválida.');
  return payload as unknown as ImageRegionResult;
}

export function assessImageSimulationReadiness(observation: MechanicalObservation): ImageSimulationReadiness {
  const missing = [...observation.missingInformation];
  if (!observation.elements.some((element) => element.kind === 'fixed')) missing.push('barra fixa/ground observável');
  if (observation.connections.length === 0) missing.push('ligações entre componentes');
  if (observation.dimensions.length === 0) missing.push('comprimentos explicitamente medidos');
  missing.push('revisão humana independente e confirmação da topologia');
  return { status: 'blocked', missing: [...new Set(missing)] };
}

export function assessTechnicalDocumentSimulation(document: TechnicalDocumentV1): ImageSimulationReadiness {
  const capability = document.capabilities.find((item) => item.id === 'canSimulate');
  return { status: capability?.state === 'available' ? 'ready' : 'blocked', missing: capability?.missing.length ? [...capability.missing] : ['motor de simulação específico validado'] };
}
