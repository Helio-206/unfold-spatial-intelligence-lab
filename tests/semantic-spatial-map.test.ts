import { describe, expect, it } from 'vitest';
import type { TechnicalDocumentV1 } from '../src/technical-document';
import type { PlanRegionCandidate } from '../src/plan-reconstruction';
import {
  acceptSemanticLink, answerGroundedQuery, createSemanticSpatialMap, describeSemanticProposal,
  proposeSemanticLink, rejectSemanticLink, selectWellDefinedRegionIds, validateSemanticSpatialMap,
} from '../src/semantic-spatial-map';

const SHA = 'a'.repeat(64);
export function makeDocument(): TechnicalDocumentV1 {
  return {
    schema: 'technical_document.v1',
    provenance: { source: 'submitted_image', kind: 'model_extraction' },
    analysisState: 'complete', documentType: 'Planta de habitação', primaryDomain: 'architecture', secondaryDomains: [],
    classification: { confidence: 0.9, evidence: 'planta', rationale: 'teste' },
    summary: 'Planta com cozinha.',
    elements: [
      { id: 'el-kitchen', kind: 'room', label: 'Cozinha', status: 'observed', evidence: 'rótulo visível', confidence: 0.9, rawValue: null, value: null, unit: null },
      { id: 'el-wall', kind: 'wall', label: 'Parede norte', status: 'observed', evidence: 'linha', confidence: 0.8, rawValue: null, value: null, unit: null },
    ],
    relations: [], observedText: ['Cozinha'], ambiguities: [], missingInformation: [],
    capabilities: [], questions: [],
  } as TechnicalDocumentV1;
}
export function makeRegion(id = 'region-1', confidence = 0.85): PlanRegionCandidate {
  return {
    id, boundaryCandidateIds: ['top', 'right', 'bottom', 'left'],
    vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }],
    areaPx2: 8000, validation: 'unreviewed', eligibility: 'construction_candidate', confidence,
    evidence: ['contorno fechado'], topologyMethod: 'closed_segment_graph',
  };
}

describe('semantic_spatial_map.v1', () => {
  it('proposes without applying, then accepts only with a human actor', () => {
    const document = makeDocument();
    const map = createSemanticSpatialMap(document, 'doc-0123456789abcdef0123', SHA);
    const proposed = proposeSemanticLink(map, document, makeRegion(), 'el-kitchen');
    expect(proposed.links[0]?.review.state).toBe('proposed');
    expect(proposed.links[0]?.sceneNodeIds).toEqual([]);
    expect(describeSemanticProposal(proposed, proposed.links[0]!.id)).toContain('não aplicada');
    expect(describeSemanticProposal(proposed, proposed.links[0]!.id)).toContain('Nenhum nome, área ou cota foi convertido');
    expect(() => acceptSemanticLink(proposed, proposed.links[0]!.id, ' ')).toThrow('ACTOR');
    const accepted = acceptSemanticLink(proposed, proposed.links[0]!.id, 'tester');
    expect(accepted.links[0]?.review.state).toBe('accepted');
    expect(validateSemanticSpatialMap(accepted, document)).toEqual(accepted);
    // original document preserved
    expect(document.elements[0]?.label).toBe('Cozinha');
  });

  it('rejects non-divisions, duplicate regions and low-quality regions', () => {
    const document = makeDocument();
    const map = createSemanticSpatialMap(document, 'doc-0123456789abcdef0123', SHA);
    expect(() => proposeSemanticLink(map, document, makeRegion(), 'el-wall')).toThrow('NOT_A_DIVISION');
    expect(() => proposeSemanticLink(map, document, { ...makeRegion(), eligibility: 'low_quality_candidate' }, 'el-kitchen')).toThrow('NOT_ELIGIBLE');
    const proposed = proposeSemanticLink(map, document, makeRegion(), 'el-kitchen');
    expect(() => proposeSemanticLink(proposed, document, makeRegion(), 'el-kitchen')).toThrow('ALREADY_LINKED');
    const rejected = rejectSemanticLink(proposed, proposed.links[0]!.id, 'tester', 'região errada');
    expect(rejected.links[0]?.review.state).toBe('rejected');
  });

  it('pre-selects only well-defined regions for review', () => {
    expect(selectWellDefinedRegionIds([makeRegion('region-1', 0.9), makeRegion('region-2', 0.4), { ...makeRegion('region-3', 0.95), eligibility: 'low_quality_candidate' }])).toEqual(['region-1']);
  });

  it('answers grounded questions without fabricating missing context', () => {
    const empty = answerGroundedQuery('O que identificaste neste projecto?', { document: null, map: null, scene: null, selectedId: null, undoDepth: 0 });
    expect(empty?.kind).toBe('CLARIFICATION');
    const missing = answerGroundedQuery('Mostra-me a cozinha.', { document: makeDocument(), map: null, scene: null, selectedId: null, undoDepth: 0 });
    expect(missing?.kind).toBe('CLARIFICATION');
    const noWall = answerGroundedQuery('Qual é a dimensão desta parede?', { document: null, map: null, scene: null, selectedId: null, undoDepth: 0 });
    expect(noWall?.kind).toBe('CLARIFICATION');
    expect(answerGroundedQuery('Aumenta esta parede em 50 centímetros.', { document: null, map: null, scene: null, selectedId: null, undoDepth: 0 })).toBeNull();
  });
});
