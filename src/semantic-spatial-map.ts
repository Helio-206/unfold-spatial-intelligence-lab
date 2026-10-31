import type { TechnicalDocumentV1 } from './technical-document';
import type { PlanRegionCandidate } from './plan-reconstruction';
import type { SpatialSceneV1 } from './spatial-scene';

export const SEMANTIC_SPATIAL_MAP_SCHEMA = 'semantic_spatial_map.v1' as const;

export type SemanticLinkReviewState = 'proposed' | 'accepted' | 'rejected';
export type SemanticSpatialLink = {
  id: string;
  documentElementId: string;
  elementKind: string;
  elementLabel: string;
  elementStatus: TechnicalDocumentV1['elements'][number]['status'];
  regionId: string;
  wallCandidateIds: string[];
  sceneNodeIds: string[];
  evidence: string[];
  review: { state: SemanticLinkReviewState; actor: string | null; recordedAt: string | null; note: string | null };
};
export type SemanticSpatialMapV1 = {
  schema: typeof SEMANTIC_SPATIAL_MAP_SCHEMA;
  documentId: string;
  sourceImageSha256: string;
  documentPreserved: true;
  links: SemanticSpatialLink[];
};

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const SHA = /^[a-f0-9]{64}$/i;

function assertDocument(document: TechnicalDocumentV1): void {
  if (!document || document.schema !== 'technical_document.v1' || !Array.isArray(document.elements)) throw new Error('SEMANTIC_MAP_DOCUMENT_INVALID');
}

/** Create an empty, versioned map. The original document is referenced, never mutated or copied into geometry. */
export function createSemanticSpatialMap(document: TechnicalDocumentV1, documentId: string, sourceImageSha256: string): SemanticSpatialMapV1 {
  assertDocument(document);
  if (!ID.test(documentId) || !SHA.test(sourceImageSha256)) throw new Error('SEMANTIC_MAP_SOURCE_INVALID');
  if (document.primaryDomain !== 'architecture') throw new Error('SEMANTIC_MAP_DOMAIN_UNSUPPORTED');
  return { schema: SEMANTIC_SPATIAL_MAP_SCHEMA, documentId, sourceImageSha256, documentPreserved: true, links: [] };
}

function linkId(elementId: string, regionId: string): string {
  return `link-${elementId}-${regionId}`.replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 100);
}

/**
 * Propose (never apply) an association between a recognised division and a
 * candidate region. Names, areas and dimensions from the document are NOT
 * converted into walls or coordinates: the link only references the region's
 * existing boundary candidate ids.
 */
export function proposeSemanticLink(map: SemanticSpatialMapV1, document: TechnicalDocumentV1, region: PlanRegionCandidate, elementId: string): SemanticSpatialMapV1 {
  assertDocument(document);
  if (map.documentId && document && map.sourceImageSha256 && !SHA.test(map.sourceImageSha256)) throw new Error('SEMANTIC_MAP_SOURCE_INVALID');
  const element = document.elements.find((item) => item.id === elementId);
  if (!element) throw new Error('SEMANTIC_MAP_ELEMENT_NOT_FOUND');
  if (!/room|division|compartment|divis/i.test(element.kind)) throw new Error('SEMANTIC_MAP_ELEMENT_NOT_A_DIVISION');
  if (element.status === 'unknown') throw new Error('SEMANTIC_MAP_ELEMENT_UNCERTAIN');
  if (!region || !ID.test(region.id) || !Array.isArray(region.boundaryCandidateIds) || region.boundaryCandidateIds.length < 3) throw new Error('SEMANTIC_MAP_REGION_INVALID');
  if (region.eligibility !== 'construction_candidate') throw new Error('SEMANTIC_MAP_REGION_NOT_ELIGIBLE');
  if (map.links.some((link) => link.regionId === region.id && link.review.state !== 'rejected')) throw new Error('SEMANTIC_MAP_REGION_ALREADY_LINKED');
  if (map.links.some((link) => link.documentElementId === elementId && link.review.state !== 'rejected')) throw new Error('SEMANTIC_MAP_ELEMENT_ALREADY_LINKED');
  const link: SemanticSpatialLink = {
    id: linkId(elementId, region.id),
    documentElementId: element.id,
    elementKind: element.kind,
    elementLabel: element.label,
    elementStatus: element.status,
    regionId: region.id,
    wallCandidateIds: [...region.boundaryCandidateIds],
    sceneNodeIds: [],
    evidence: [element.evidence, ...region.evidence].filter(Boolean).slice(0, 6),
    review: { state: 'proposed', actor: null, recordedAt: null, note: null },
  };
  return { ...map, links: [...map.links, link] };
}

/** Human-readable preview of a proposal. Must be shown before acceptance. */
export function describeSemanticProposal(map: SemanticSpatialMapV1, linkIdValue: string): string {
  const link = map.links.find((item) => item.id === linkIdValue);
  if (!link) throw new Error('SEMANTIC_MAP_LINK_NOT_FOUND');
  return `Proposta (não aplicada): associar a divisão reconhecida “${link.elementLabel}” (${link.documentElementId}, ${link.elementStatus}) à região candidata ${link.regionId}, delimitada por ${link.wallCandidateIds.length} segmentos (${link.wallCandidateIds.join(', ')}). Nenhum nome, área ou cota foi convertido em geometria. Aceitar apenas regista a associação; a cena continua a exigir escala, confirmação de limites, altura e espessura.`;
}

function reviewLink(map: SemanticSpatialMapV1, linkIdValue: string, state: 'accepted' | 'rejected', actor: string, note?: string): SemanticSpatialMapV1 {
  if (!actor?.trim()) throw new Error('SEMANTIC_MAP_REVIEW_ACTOR_REQUIRED');
  const link = map.links.find((item) => item.id === linkIdValue);
  if (!link) throw new Error('SEMANTIC_MAP_LINK_NOT_FOUND');
  if (link.review.state !== 'proposed') throw new Error('SEMANTIC_MAP_LINK_NOT_PROPOSED');
  return { ...map, links: map.links.map((item) => item.id === linkIdValue ? { ...item, review: { state, actor: actor.trim(), recordedAt: new Date().toISOString(), note: note?.trim() || null } } : item) };
}
export function acceptSemanticLink(map: SemanticSpatialMapV1, linkIdValue: string, actor: string, note?: string): SemanticSpatialMapV1 {
  return reviewLink(map, linkIdValue, 'accepted', actor, note);
}
export function rejectSemanticLink(map: SemanticSpatialMapV1, linkIdValue: string, actor: string, note?: string): SemanticSpatialMapV1 {
  return reviewLink(map, linkIdValue, 'rejected', actor, note);
}

/** Fill sceneNodeIds for accepted links from a built scene. Room node id equals the region id; walls are matched by source candidate provenance. */
export function resolveSemanticSceneLinks(map: SemanticSpatialMapV1, scene: SpatialSceneV1): SemanticSpatialMapV1 {
  const wallIdsByCandidate = new Map<string, string[]>();
  for (const node of scene.nodes) {
    if (node.component?.kind !== 'wall') continue;
    const ids = new Set<string>();
    const single = node.component.properties.sourceCandidate?.value;
    if (typeof single === 'string') ids.add(single);
    const many = node.component.properties.sourceCandidateIds?.value;
    if (typeof many === 'string') { try { (JSON.parse(many) as string[]).forEach((id) => ids.add(id)); } catch { /* provenance malformed: ignore */ } }
    ids.forEach((id) => wallIdsByCandidate.set(id, [...(wallIdsByCandidate.get(id) ?? []), node.id]));
  }
  return {
    ...map,
    links: map.links.map((link) => {
      if (link.review.state !== 'accepted') return link;
      const room = scene.nodes.find((node) => node.id === link.regionId && node.component?.kind === 'room');
      const walls = [...new Set(link.wallCandidateIds.flatMap((id) => wallIdsByCandidate.get(id) ?? []))];
      return { ...link, sceneNodeIds: [...(room ? [room.id] : []), ...walls] };
    }),
  };
}

export function validateSemanticSpatialMap(value: unknown, document?: TechnicalDocumentV1): SemanticSpatialMapV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('SEMANTIC_MAP_INVALID');
  const map = value as SemanticSpatialMapV1;
  if (map.schema !== SEMANTIC_SPATIAL_MAP_SCHEMA || !ID.test(String(map.documentId)) || !SHA.test(String(map.sourceImageSha256)) || map.documentPreserved !== true || !Array.isArray(map.links)) throw new Error('SEMANTIC_MAP_INVALID');
  const elementIds = document ? new Set(document.elements.map((item) => item.id)) : null;
  const seen = new Set<string>();
  for (const link of map.links) {
    if (!ID.test(String(link.id)) || seen.has(link.id) || !ID.test(String(link.documentElementId)) || !ID.test(String(link.regionId)) || !Array.isArray(link.wallCandidateIds) || link.wallCandidateIds.length < 3 || !Array.isArray(link.sceneNodeIds) || !['proposed', 'accepted', 'rejected'].includes(link.review?.state)) throw new Error('SEMANTIC_MAP_LINK_INVALID');
    if (elementIds && !elementIds.has(link.documentElementId)) throw new Error('SEMANTIC_MAP_ELEMENT_NOT_FOUND');
    if (link.review.state !== 'proposed' && (!link.review.actor || !link.review.recordedAt)) throw new Error('SEMANTIC_MAP_REVIEW_INCOMPLETE');
    seen.add(link.id);
  }
  return structuredClone(map);
}

/** Region ids whose contours are well defined enough to pre-select for human review. Construction still requires explicit build confirmation. */
export function selectWellDefinedRegionIds(regions: PlanRegionCandidate[], minimumConfidence = 0.7): string[] {
  return regions.filter((region) => region.eligibility === 'construction_candidate' && region.confidence >= minimumConfidence && region.boundaryCandidateIds.length >= 3).map((region) => region.id);
}

export type GroundedContext = {
  document: TechnicalDocumentV1 | null;
  map: SemanticSpatialMapV1 | null;
  scene: SpatialSceneV1 | null;
  selectedId: string | null;
  undoDepth: number;
};
export type GroundedAnswer =
  | { kind: 'ANSWER'; text: string; evidenceIds: string[] }
  | { kind: 'FOCUS'; nodeId: string; text: string; evidenceIds: string[] }
  | { kind: 'CLARIFICATION'; text: string; evidenceIds: string[] };

const norm = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * Deterministic grounded answers for the mandatory contextual cases.
 * Returns null for anything else (e.g. mutations), which must go through the
 * existing agent + deterministic executor with preview/confirmation.
 * Never fabricates: missing context yields an explicit CLARIFICATION.
 */
export function answerGroundedQuery(query: string, context: GroundedContext): GroundedAnswer | null {
  const q = norm(query);
  if (/o que identificaste|que identificaste|identificaste neste|neste projecto|neste projeto/.test(q)) {
    if (!context.document && !context.scene) return { kind: 'CLARIFICATION', text: 'Ainda não existe documento aceite nem cena construída nesta sessão. Não vou inventar uma identificação.', evidenceIds: [] };
    const parts: string[] = [];
    const evidenceIds: string[] = [];
    if (context.document) {
      const observed = context.document.elements.filter((item) => item.status === 'observed');
      parts.push(`Documento (${context.document.primaryDomain}): ${observed.length} elementos observados${observed.length ? `: ${observed.map((item) => item.label).join(', ')}` : ''}.`);
      evidenceIds.push(...observed.map((item) => item.id));
    }
    const accepted = context.map?.links.filter((link) => link.review.state === 'accepted') ?? [];
    if (accepted.length) parts.push(`Associações semânticas aceites: ${accepted.map((link) => `${link.elementLabel} → ${link.regionId}`).join('; ')}.`);
    if (context.scene) parts.push(`Cena actual: ${context.scene.nodes.length} componentes (revisão ${context.scene.revision.number}).`);
    return { kind: 'ANSWER', text: parts.join(' '), evidenceIds };
  }
  const show = q.match(/mostra(?:-me)?\s+(?:a|o|as|os)?\s*(.+)/);
  if (show) {
    const wanted = show[1]!.replace(/[?.!]+$/, '').trim();
    const link = context.map?.links.find((item) => item.review.state === 'accepted' && norm(item.elementLabel).includes(wanted));
    const nodeId = link?.sceneNodeIds[0] ?? context.scene?.nodes.find((node) => norm(node.label).includes(wanted))?.id;
    if (!context.scene || !nodeId) return { kind: 'CLARIFICATION', text: `Não encontrei “${show[1]!.trim()}” associado a uma região/cena aceite. Associe e aceite primeiro a divisão, ou seleccione o componente.`, evidenceIds: link ? [link.documentElementId] : [] };
    return { kind: 'FOCUS', nodeId, text: `A mostrar ${link?.elementLabel ?? wanted} (${nodeId}).`, evidenceIds: link ? [link.documentElementId] : [nodeId] };
  }
  if (/qual e a dimensao desta parede|dimensao desta parede|comprimento desta parede/.test(q)) {
    const node = context.scene?.nodes.find((item) => item.id === context.selectedId);
    if (!node) return { kind: 'CLARIFICATION', text: 'Nenhuma parede está seleccionada. Seleccione uma parede para eu indicar a dimensão registada na cena.', evidenceIds: [] };
    if (node.geometry?.kind !== 'box') return { kind: 'CLARIFICATION', text: `“${node.label}” não é uma parede paramétrica com comprimento registado.`, evidenceIds: [node.id] };
    return { kind: 'ANSWER', text: `${node.label}: comprimento ${node.geometry.sizeM[0].toFixed(2)} m (altura ${node.geometry.sizeM[1].toFixed(2)} m, espessura ${node.geometry.sizeM[2].toFixed(2)} m). Proveniência: ${node.geometry.provenance.validation}; não é certificação estrutural.`, evidenceIds: [node.id] };
  }
  if (/o que mudou|que mudou/.test(q)) {
    if (!context.scene) return { kind: 'CLARIFICATION', text: 'Ainda não existe cena nesta sessão, pelo que não há alterações para descrever.', evidenceIds: [] };
    return { kind: 'ANSWER', text: `Revisão actual ${context.scene.revision.number} (${context.scene.revision.id}, criada por ${context.scene.revision.createdBy}). ${context.undoDepth ? `Existem ${context.undoDepth} revisão(ões) anteriores disponíveis para desfazer.` : 'Não existe revisão anterior registada.'}`, evidenceIds: [context.scene.revision.id] };
  }
  return null;
}
