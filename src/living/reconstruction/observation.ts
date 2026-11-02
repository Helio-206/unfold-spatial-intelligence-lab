import { sha256Hex } from '../../core/canonical';
import {
  EXCAVATOR_ENTITY_KINDS,
  RECONSTRUCTION_OBSERVATION_SCHEMA,
  type ExcavatorObservationDimension,
  type ExcavatorObservationEntity,
  type ExcavatorObservationRelation,
  type ExcavatorObservationV1,
  type ObservationHypothesis,
  type ObservationStatus,
  type ReconstructionRequest,
  type SourceEvidence,
  parseJsonObject,
  validateExcavatorObservation,
} from './contracts';

const MACHINE_PARTS = ['chassis', 'house', 'boom', 'stick', 'bucket', 'boom-cylinder', 'stick-cylinder', 'bucket-cylinder'] as const;
type MachinePart = typeof MACHINE_PARTS[number];

function slug(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

function evidence(id: string, kind: SourceEvidence['kind'], detail: string, locator?: string): SourceEvidence {
  return { id, kind, detail, ...(locator ? { locator } : {}) };
}

function entity(id: string, kind: ExcavatorObservationEntity['kind'], label: string, status: ObservationStatus, sourceEvidence: SourceEvidence, confidence: number): ExcavatorObservationEntity {
  return { id, kind, label, status, evidence: [sourceEvidence], features: [{ name: 'visibility', value: status === 'observed' ? 'visible' : null, status, evidence: [sourceEvidence] }], confidence };
}

function relation(id: string, relationName: ExcavatorObservationRelation['relation'], from: string, to: string, status: ObservationStatus, sourceEvidence: SourceEvidence, confidence: number): ExcavatorObservationRelation {
  return { id, relation: relationName, from, to, status, evidence: [sourceEvidence], confidence };
}

function unknownDimension(id: string, partId: string, label: string, sourceEvidence: SourceEvidence): ExcavatorObservationDimension {
  return { id, partId, label, value: null, unit: 'unknown', status: 'unknown', evidence: [sourceEvidence] };
}

function genericEntities(status: ObservationStatus, sourceEvidence: SourceEvidence, confidence: number): ExcavatorObservationEntity[] {
  return [
    entity('chassis', 'chassis', 'Chassis inferior', status, sourceEvidence, confidence),
    entity('house', 'house', 'Casa giratória', status, sourceEvidence, confidence),
    entity('boom', 'boom', 'Boom / lança', status, sourceEvidence, confidence),
    entity('stick', 'stick', 'Stick / braço', status, sourceEvidence, confidence),
    entity('bucket', 'bucket', 'Balde', status, sourceEvidence, confidence),
    entity('boom-cylinder', 'cylinder', 'Cilindro do boom', status, sourceEvidence, confidence),
    entity('stick-cylinder', 'cylinder', 'Cilindro do stick', status, sourceEvidence, confidence),
    entity('bucket-cylinder', 'cylinder', 'Cilindro do balde', status, sourceEvidence, confidence),
    entity('joint-swing', 'joint', 'Junta de rotação', status, sourceEvidence, confidence),
    entity('joint-boom', 'joint', 'Junta boom-chassis', status, sourceEvidence, confidence),
    entity('joint-stick', 'joint', 'Junta boom-stick', status, sourceEvidence, confidence),
    entity('joint-bucket', 'joint', 'Junta stick-balde', status, sourceEvidence, confidence),
    entity('track-left', 'track', 'Lagarta esquerda', status, sourceEvidence, confidence),
    entity('track-right', 'track', 'Lagarta direita', status, sourceEvidence, confidence),
  ];
}

function genericRelations(status: ObservationStatus, sourceEvidence: SourceEvidence, confidence: number): ExcavatorObservationRelation[] {
  return [
    relation('rel-house-chassis', 'mounted_on', 'house', 'chassis', status, sourceEvidence, confidence),
    relation('rel-boom-house', 'mounted_on', 'boom', 'house', status, sourceEvidence, confidence),
    relation('rel-stick-boom', 'pivot', 'stick', 'boom', status, sourceEvidence, confidence),
    relation('rel-bucket-stick', 'pivot', 'bucket', 'stick', status, sourceEvidence, confidence),
    relation('rel-boom-cylinder', 'actuated_by', 'boom', 'boom-cylinder', status, sourceEvidence, confidence),
    relation('rel-stick-cylinder', 'actuated_by', 'stick', 'stick-cylinder', status, sourceEvidence, confidence),
    relation('rel-bucket-cylinder', 'actuated_by', 'bucket', 'bucket-cylinder', status, sourceEvidence, confidence),
    relation('rel-joint-boom', 'connected', 'joint-boom', 'boom', status, sourceEvidence, confidence),
    relation('rel-joint-stick', 'connected', 'joint-stick', 'stick', status, sourceEvidence, confidence),
    relation('rel-joint-bucket', 'connected', 'joint-bucket', 'bucket', status, sourceEvidence, confidence),
  ];
}

function genericDimensions(sourceEvidence: SourceEvidence): ExcavatorObservationDimension[] {
  return [
    unknownDimension('dim-chassis-length', 'chassis', 'comprimento do chassis', sourceEvidence),
    unknownDimension('dim-chassis-width', 'chassis', 'largura do chassis', sourceEvidence),
    unknownDimension('dim-boom-length', 'boom', 'comprimento do boom', sourceEvidence),
    unknownDimension('dim-stick-length', 'stick', 'comprimento do stick', sourceEvidence),
    unknownDimension('dim-bucket-width', 'bucket', 'largura do balde', sourceEvidence),
    unknownDimension('dim-boom-cylinder-stroke', 'boom-cylinder', 'curso do cilindro do boom', sourceEvidence),
    unknownDimension('dim-stick-cylinder-stroke', 'stick-cylinder', 'curso do cilindro do stick', sourceEvidence),
    unknownDimension('dim-bucket-cylinder-stroke', 'bucket-cylinder', 'curso do cilindro do balde', sourceEvidence),
  ];
}

function parseNumber(value: string): number | null {
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function dimensionMatches(text: string, target: MachinePart): { label: string; value: number; unit: 'mm' | 'm' } | null {
  const token = target === 'boom-cylinder' ? '(?:cilindro\\s+do\\s+boom|boom\\s+cilindro)' : target === 'stick-cylinder' ? '(?:cilindro\\s+do\\s+stick|stick\\s+cilindro)' : target === 'bucket-cylinder' ? '(?:cilindro\\s+do\\s+balde|bucket\\s+cilindro)' : target === 'bucket' ? '(?:bucket|balde)' : target === 'chassis' ? '(?:chassis|base)' : target;
  const match = new RegExp(`${token}[^\\d]{0,40}(\\d+(?:[.,]\\d+)?)\\s*(mm|m)\\b`, 'i').exec(text);
  if (!match) return null;
  const value = parseNumber(match[1]!); if (value === null) return null;
  return { label: target === 'bucket' ? 'largura do balde' : `comprimento do ${target}`, value, unit: match[2]!.toLowerCase() as 'mm' | 'm' };
}

function requestFromText(text: string, sourceEvidence: SourceEvidence): ReconstructionRequest[] {
  const requests: ReconstructionRequest[] = [];
  const patterns: Array<{ operation: ReconstructionRequest['operation']; regex: RegExp }> = [
    { operation: 'increase_dimension', regex: /\b(?:aumenta|aumentar|increase|increase\s+the)\s+(?:o|a|the)?\s*(boom|stick|bucket|balde|lan[cç]a)/i },
    { operation: 'decrease_dimension', regex: /\b(?:reduz|reduzir|decrease|shorten)\s+(?:o|a|the)?\s*(boom|stick|bucket|balde|lan[cç]a)/i },
    { operation: 'replace_part', regex: /\b(?:troca|trocar|substitui|replace)\s+(?:o|a|the)?\s*(bucket|balde|boom|stick|lan[cç]a)/i },
  ];
  for (const [index, pattern] of patterns.entries()) {
    const match = pattern.regex.exec(text);
    if (match) requests.push({ id: `request-${index + 1}-${slug(match[1]!)}`, operation: pattern.operation, target: match[1]!, value: null, unit: 'unknown', text: match[0], evidence: [sourceEvidence] });
  }
  return requests;
}

export function parseExcavatorObservation(text: string): ExcavatorObservationV1 {
  return validateExcavatorObservation(parseJsonObject(text));
}

export function createOfflineImageObservation(sourceKind: 'image' | 'technical_drawing', sourceReference: string, sourceSha256: string): ExcavatorObservationV1 {
  const sourceEvidence = evidence('evidence-source', 'template', 'Fallback offline determinístico: a imagem foi recebida, mas não foi interpretada por um modelo. Nenhuma geometria é declarada observada.', sourceReference);
  const entities = genericEntities('hypothesis', sourceEvidence, 0.2);
  return validateExcavatorObservation({
    schema: RECONSTRUCTION_OBSERVATION_SCHEMA,
    source: { kind: sourceKind, reference: sourceReference, sha256: sourceSha256 },
    machineType: 'excavator', entities, relations: genericRelations('hypothesis', sourceEvidence, 0.2), dimensions: genericDimensions(sourceEvidence), requests: [],
    unknowns: ['A geometria visível não foi interpretada offline.', 'Dimensões, materiais, eixos e peças ocultas requerem imagem processada e revisão humana.', 'O fallback não prova que a máquina é uma escavadora real.'],
    hypotheses: [{ id: 'hypothesis-machine-type', statement: 'A fonte pode representar uma escavadora compatível com o template paramétrico.', evidence: [sourceEvidence], confidence: 0.2 }],
  });
}

export function createOfflineTextObservation(instruction: string, sourceReference = 'user-instruction'): ExcavatorObservationV1 {
  const sourceEvidence = evidence('evidence-instruction', 'user_instruction', 'Texto fornecido pelo utilizador; dimensões explícitas são propostas e continuam por confirmar.', sourceReference);
  const entities = genericEntities('hypothesis', sourceEvidence, 0.35);
  const dimensions = genericDimensions(sourceEvidence);
  for (const dimension of dimensions) {
    const target = dimension.partId as MachinePart;
    const parsed = dimensionMatches(instruction, target);
    if (parsed) { dimension.value = parsed.value; dimension.unit = parsed.unit; dimension.status = 'observed'; dimension.evidence = [sourceEvidence]; }
  }
  const requests = requestFromText(instruction, sourceEvidence);
  const hypotheses: ObservationHypothesis[] = [{ id: 'hypothesis-text-machine-type', statement: 'A instrução refere-se a uma escavadora e pede uma proposta editável, não uma alteração confirmada.', evidence: [sourceEvidence], confidence: 0.5 }];
  return validateExcavatorObservation({
    schema: RECONSTRUCTION_OBSERVATION_SCHEMA,
    source: { kind: 'text', reference: sourceReference, sha256: sha256Hex(instruction) }, machineType: 'excavator', entities, relations: genericRelations('hypothesis', sourceEvidence, 0.35), dimensions, requests, unknowns: ['A instrução não confirma a geometria completa nem a compatibilidade estrutural.', 'Cursos, diâmetros, massas e limites de junta permanecem desconhecidos.'], hypotheses,
  });
}

export function isSupportedEntityKind(value: string): value is ExcavatorObservationEntity['kind'] {
  return (EXCAVATOR_ENTITY_KINDS as readonly string[]).includes(value);
}
