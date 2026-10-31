import type { TechnicalDocumentV1 } from './technical-document';

export type SpatialPreparationV1 = {
  schema: 'spatial_preparation.v1';
  state: 'ready_for_tracing' | 'blocked';
  documentId: string;
  sourceImageSha256: string;
  domain: TechnicalDocumentV1['primaryDomain'];
  observedElementIds: string[];
  candidateGeometry: [];
  missing: string[];
  explanation: string;
};

/** Documents may inform tracing, but semantic labels/areas never become coordinates or walls. */
export function prepareSpatialHandoff(document: TechnicalDocumentV1, documentId: string, sourceImageSha256: string): SpatialPreparationV1 {
  if (!/^doc-[a-f0-9]{20}$/.test(documentId) || !/^[a-f0-9]{64}$/i.test(sourceImageSha256)) throw new Error('SPATIAL_HANDOFF_SOURCE_INVALID');
  const architectural = document.primaryDomain === 'architecture';
  return {
    schema: 'spatial_preparation.v1',
    state: architectural ? 'ready_for_tracing' : 'blocked',
    documentId,
    sourceImageSha256,
    domain: document.primaryDomain,
    observedElementIds: document.elements.filter((element) => element.status === 'observed').map((element) => element.id),
    candidateGeometry: [],
    missing: architectural ? ['segmentos de parede traçados e confirmados', 'escala calibrada a partir de cota explícita', 'altura e espessura de modelação fornecidas', 'revisão humana da correspondência imagem/cena'] : ['documento de arquitectura com geometria espacial compatível'],
    explanation: architectural
      ? 'O documento aceite fornece contexto e elementos observados, mas não contém coordenadas espaciais confirmadas. Nenhuma sala, área, parede ou abertura foi convertida automaticamente em geometria.'
      : 'O documento aceite não é uma planta arquitectónica para reconstrução. Não será criada geometria 3D a partir de símbolos ou relações sem um motor de domínio validado.',
  };
}
