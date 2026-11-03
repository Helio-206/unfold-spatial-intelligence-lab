import { sha256Hex } from '../../core/canonical';
import { requestMetaStructuredImage, requestMetaStructuredText, type MetaCallLog } from '../../meta';
import {
  OBSERVATION_JSON_SCHEMA,
  type ExcavatorObservationV1,
  type ReconstructionSourceKind,
  parseJsonObject,
  validateExcavatorObservation,
} from './contracts';
import { createOfflineImageObservation, createOfflineTextObservation, parseExcavatorObservation } from './observation';

export const RECONSTRUCTION_MUSE_SCHEMA_NAME = 'excavator_observation_v1';

export type ReconstructionMetaResult = {
  observation: ExcavatorObservationV1;
  meta: MetaCallLog;
  mode: 'live';
};

function promptFor(sourceKind: ReconstructionSourceKind, instruction?: string): string {
  const sourceInstruction = sourceKind === 'text'
    ? 'Interpreta a instrução textual como pedido de proposta. Dimensões escritas pelo utilizador são propostas de entrada, não valores mecanicamente verificados.'
    : 'Analisa apenas o que é visível na imagem ou desenho. Não declares como observado uma peça oculta, uma dimensão não escrita ou uma ligação que não tenha evidência.';
  return [
    'Produz somente JSON que satisfaça o schema excavator_observation_v1.',
    'O resultado é uma observação não confiável para uma proposta editável de escavadora.',
    sourceInstruction,
    'Usa IDs estáveis e curtos. Em entities e relations separa status observed, hypothesis e unknown.',
    'Sê conciso: inclui apenas elementos pertinentes e não repitas evidências ou listas extensas.',
    'Cada afirmação deve ter evidence. Usa unknowns para massa, material, eixos, cursos, diâmetros, partes ocultas e dimensões ausentes.',
    'Não produzas comandos, código, operações de solver ou instruções para alterar uma cena confirmada. Pedidos de alteração entram apenas em requests como dados para revisão.',
    instruction ? `Instrução do utilizador: ${instruction}` : '',
  ].filter(Boolean).join('\n');
}

function bindSource(observation: ExcavatorObservationV1, kind: ReconstructionSourceKind, reference: string, sha256: string): ExcavatorObservationV1 {
  return validateExcavatorObservation({ ...observation, source: { kind, reference, sha256 } });
}

export async function observeExcavatorImage(imageDataUrl: string, sourceKind: 'image' | 'technical_drawing', sourceReference: string, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<ReconstructionMetaResult> {
  const sourceSha256 = sha256Hex(imageDataUrl);
  const result = await requestMetaStructuredImage(imageDataUrl, promptFor(sourceKind), apiKey, OBSERVATION_JSON_SCHEMA as unknown as Record<string, unknown>, fetchImpl, 5_000, undefined, 'medium', RECONSTRUCTION_MUSE_SCHEMA_NAME, 'high');
  const observation = bindSource(parseExcavatorObservation(result.text), sourceKind, sourceReference, sourceSha256);
  return { observation, meta: result.log, mode: 'live' };
}

export async function observeExcavatorText(instruction: string, sourceReference: string, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<ReconstructionMetaResult> {
  const sourceSha256 = sha256Hex(instruction);
  const result = await requestMetaStructuredText(promptFor('text', instruction), apiKey, OBSERVATION_JSON_SCHEMA as unknown as Record<string, unknown>, fetchImpl, 8_000, 'low', RECONSTRUCTION_MUSE_SCHEMA_NAME);
  const parsed = validateExcavatorObservation(parseJsonObject(result.text));
  const observation = bindSource(parsed, 'text', sourceReference, sourceSha256);
  return { observation, meta: result.log, mode: 'live' };
}

export function offlineImageObservation(imageDataUrl: string, sourceKind: 'image' | 'technical_drawing', sourceReference: string): { observation: ExcavatorObservationV1; mode: 'offline'; meta: { model: 'offline-template'; status: 'mocked'; sourceSha256: string } } {
  const sourceSha256 = sha256Hex(imageDataUrl);
  return { observation: createOfflineImageObservation(sourceKind, sourceReference, sourceSha256), mode: 'offline', meta: { model: 'offline-template', status: 'mocked', sourceSha256 } };
}

export function offlineTextObservation(instruction: string, sourceReference: string): { observation: ExcavatorObservationV1; mode: 'offline'; meta: { model: 'offline-template'; status: 'mocked'; sourceSha256: string } } {
  const sourceSha256 = sha256Hex(instruction);
  return { observation: createOfflineTextObservation(instruction, sourceReference), mode: 'offline', meta: { model: 'offline-template', status: 'mocked', sourceSha256 } };
}
