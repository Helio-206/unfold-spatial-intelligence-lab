import type { MetaCallLog } from './meta';
import {
  assessTechnicalSemantics,
  buildDomainExtractionPrompt,
  MULTIMODAL_STAGE_CONFIG,
  type TechnicalRecognitionV1,
} from './technical-document-pipeline';
import {
  parseTechnicalDocumentText,
  TECHNICAL_DOCUMENT_JSON_SCHEMA,
  technicalAdapters,
  toMechanicalObservation,
  type TechnicalDocumentV1,
} from './technical-document';

export type TechnicalExtractionRequest = (
  imageDataUrl: string,
  prompt: string,
  schema: Record<string, unknown>,
  options: { maxOutputTokens: number; reasoningEffort: 'low' | 'medium' | 'high'; schemaName: string },
  signal?: AbortSignal,
) => Promise<{ text: string; log: MetaCallLog }>;

export class TechnicalExtractionValidationError extends Error {
  constructor(message: string, readonly log: MetaCallLog, readonly rawOutputText: string) {
    super(message);
    this.name = 'TechnicalExtractionValidationError';
  }
}

/** Runs only stage B from a previously validated stage-A recognition. */
export async function extractTechnicalDocumentFromRecognition(
  imageDataUrl: string,
  recognition: TechnicalRecognitionV1,
  request: TechnicalExtractionRequest,
  signal?: AbortSignal,
  config: { maxOutputTokens: number; reasoningEffort: 'low' | 'medium' | 'high'; schemaName: string } = MULTIMODAL_STAGE_CONFIG.extraction,
) {
  if (!imageDataUrl.startsWith('data:image/')) throw new Error('EXTRACTION_IMAGE_INVALID');
  if (recognition.route !== 'extract' || recognition.primaryDomain === 'unknown') throw new Error('EXTRACTION_RECOGNITION_NOT_ROUTABLE');

  const stage = await request(
    imageDataUrl,
    buildDomainExtractionPrompt(recognition),
    TECHNICAL_DOCUMENT_JSON_SCHEMA as unknown as Record<string, unknown>,
    config,
    signal,
  );
  let document: TechnicalDocumentV1;
  try { document = parseTechnicalDocumentText(stage.text); }
  catch (error) { throw new TechnicalExtractionValidationError(error instanceof Error ? error.message : 'SCHEMA_INVALID', stage.log, stage.text); }
  const assessment = assessTechnicalSemantics(document);
  if (document.primaryDomain !== recognition.primaryDomain && !recognition.secondaryDomains.includes(document.primaryDomain)) {
    assessment.issues.push({ code: 'DOMAIN_STAGE_MISMATCH', severity: 'warning', elementIds: [], message: `Fase A classificou ${recognition.primaryDomain}, mas a extracção classificou ${document.primaryDomain}. Confirmar o domínio antes de usar a interpretação.`, disposition: 'review_required' });
  }
  if (assessment.issues.length) document.analysisState = 'partial';
  document.capabilities = technicalAdapters(document.primaryDomain, document);
  return { document, assessment, observation: toMechanicalObservation(document), rawOutputText: stage.text, log: stage.log };
}
