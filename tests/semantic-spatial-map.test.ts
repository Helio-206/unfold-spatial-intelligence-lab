import { describe, expect, it } from 'vitest';
import type { TechnicalDocumentV1 } from '../src/technical-document';
import type { PlanRegionCandidate } from '../src/plan-reconstruction';
import {
  acceptSemanticLink, answerGroundedQuery, createSemanticSpatialMap, describeSemanticProposal,
  proposeSemanticLink, rejectSemanticLink, selectWellDefinedRegionIds, validateSemanticSpatialMap,
  deserializeSemanticWorkspace, restoreSemanticSpatialMap, serializeSemanticWorkspace,
  semanticWorkspaceStorageKey,
} from '../src/semantic-spatial-map';

const SHA = 'a'.repeat(64);
const source = { documentId: 'doc-0123456789abcdef0123', imageSha256: SHA };
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
function accept(map: ReturnType<typeof createSemanticSpatialMap>, document: TechnicalDocumentV1, id: string, actor: string, region?: PlanRegionCandidate) {
  const regionId = map.links.find((link) => link.id === id)?.regionId;
  if (!regionId && !region) throw new Error('Missing test region');
  return acceptSemanticLink(map, id, actor, { document, currentRegion: region ?? makeRegion(regionId!), source });
}

describe('semantic_spatial_map.v1', () => {
  it('proposes without applying, then accepts only with a human actor', () => {
    const document = makeDocument();
    const map = createSemanticSpatialMap(document, 'doc-0123456789abcdef0123', SHA);
    const proposed = proposeSemanticLink(map, document, makeRegion(), 'el-kitchen', source);
    expect(proposed.links[0]?.review.state).toBe('proposed');
    expect(proposed.links[0]?.sceneNodeIds).toEqual([]);
    expect(describeSemanticProposal(proposed, proposed.links[0]!.id)).toContain('não aplicada');
    expect(describeSemanticProposal(proposed, proposed.links[0]!.id)).toContain('Nenhum nome, área ou cota foi convertido');
    expect(() => accept(proposed, document, proposed.links[0]!.id, ' ')).toThrow('ACTOR');
    const accepted = accept(proposed, document, proposed.links[0]!.id, 'tester');
    expect(accepted.links[0]?.review.state).toBe('accepted');
    expect(validateSemanticSpatialMap(accepted, document)).toEqual(accepted);
    // original document preserved
    expect(document.elements[0]?.label).toBe('Cozinha');
  });

  it('rejects non-divisions, duplicate regions and low-quality regions', () => {
    const document = makeDocument();
    const map = createSemanticSpatialMap(document, 'doc-0123456789abcdef0123', SHA);
    expect(() => proposeSemanticLink(map, document, makeRegion(), 'el-wall', source)).toThrow('NOT_A_DIVISION');
    expect(() => proposeSemanticLink(map, document, { ...makeRegion(), eligibility: 'low_quality_candidate' }, 'el-kitchen', source)).toThrow('NOT_ELIGIBLE');
    const proposed = proposeSemanticLink(map, document, makeRegion(), 'el-kitchen', source);
    expect(() => proposeSemanticLink(proposed, document, makeRegion(), 'el-kitchen', source)).toThrow('ALREADY_LINKED');
    const rejected = rejectSemanticLink(proposed, proposed.links[0]!.id, 'tester', 'região errada');
    expect(rejected.links[0]?.review.state).toBe('rejected');
  });

  it('prevents cross-document/image associations and gives a rejected retry a fresh stable ID', () => {
    const document = makeDocument();
    const map = createSemanticSpatialMap(document, 'doc-0123456789abcdef0123', SHA);
    expect(() => proposeSemanticLink(map, document, makeRegion(), 'el-kitchen', { documentId: 'doc-ffffffffffffffffffff', imageSha256: SHA })).toThrow('SOURCE_MISMATCH');
    expect(() => proposeSemanticLink(map, document, makeRegion(), 'el-kitchen', { documentId: map.documentId, imageSha256: 'c'.repeat(64) })).toThrow('SOURCE_MISMATCH');
    const first = proposeSemanticLink(map, document, makeRegion(), 'el-kitchen', source);
    const rejected = rejectSemanticLink(first, first.links[0]!.id, 'unidentified-local-user');
    const retried = proposeSemanticLink(rejected, document, makeRegion(), 'el-kitchen', source);
    expect(retried.links[0]!.review.state).toBe('rejected');
    expect(retried.links[1]!.review.state).toBe('proposed');
    expect(retried.links[1]!.id).not.toBe(retried.links[0]!.id);
    expect(validateSemanticSpatialMap(retried, document)).toEqual(retried);
  });

  it('round-trips semantic workspace only for the bound document and original image', () => {
    const document = makeDocument();
    const map = createSemanticSpatialMap(document, 'doc-0123456789abcdef0123', SHA);
    const serialized = serializeSemanticWorkspace({ schema: 'semantic_spatial_workspace.v1', documentId: map.documentId, sourceImageSha256: SHA, document, map });
    const expected = { documentId: map.documentId, imageSha256: SHA, document };
    expect(deserializeSemanticWorkspace(serialized, expected)).toMatchObject({ documentId: map.documentId, sourceImageSha256: SHA });
    expect(() => deserializeSemanticWorkspace(serialized, { ...expected, imageSha256: 'c'.repeat(64) })).toThrow('SOURCE_MISMATCH');
    expect(() => deserializeSemanticWorkspace(serialized, { ...expected, documentId: 'doc-ffffffffffffffffffff' })).toThrow('SOURCE_MISMATCH');
    const substituted = makeDocument(); substituted.elements[0]!.label = 'Documento substituído';
    expect(() => deserializeSemanticWorkspace(serialized, { ...expected, document: substituted })).toThrow('DOCUMENT_MISMATCH');
    const malformed = makeDocument(); (malformed as unknown as { elements: unknown[] }).elements = [null];
    expect(() => deserializeSemanticWorkspace(JSON.stringify({ schema: 'semantic_spatial_workspace.v1', documentId: map.documentId, sourceImageSha256: SHA, document: malformed, map }), { ...expected, document: makeDocument() })).toThrow('DOCUMENT_INVALID');
    expect(() => validateSemanticSpatialMap({ ...map, links: [{ ...proposeSemanticLink(map, document, makeRegion(), 'el-kitchen', source).links[0], sceneNodeIds: ['missing', 'missing'] }] }, document)).toThrow('LINK_INVALID');
    expect(() => deserializeSemanticWorkspace(JSON.stringify({ schema: 'semantic_spatial_workspace.v1', documentId: map.documentId, sourceImageSha256: null }), expected)).toThrow('SOURCE_MISMATCH');
    expect(() => validateSemanticSpatialMap({ ...map, links: [{ ...proposeSemanticLink(map, document, makeRegion(), 'el-kitchen', source).links[0], elementLabel: 'Outra divisão' }] }, document)).toThrow('SNAPSHOT_MISMATCH');
  });

  it('keeps document workspaces isolated so loading a source without a document cannot erase another source', () => {
    const first = semanticWorkspaceStorageKey(source.documentId, SHA);
    const second = semanticWorkspaceStorageKey('doc-ffffffffffffffffffff', 'b'.repeat(64));
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const document = makeDocument();
    const map = createSemanticSpatialMap(document, source.documentId, SHA);
    const serialized = serializeSemanticWorkspace({ schema: 'semantic_spatial_workspace.v1', documentId: source.documentId, sourceImageSha256: SHA, document, map });
    storage.setItem(first, serialized);
    expect(storage.getItem(second)).toBeNull();
    expect(storage.getItem(first)).toBe(serialized);
    expect(deserializeSemanticWorkspace(storage.getItem(first)!, { documentId: source.documentId, imageSha256: SHA, document }).map).toEqual(map);
  });

  it('restores accepted semantic links on source handoff after reload and discards a different source', () => {
    const document = makeDocument();
    const map = createSemanticSpatialMap(document, source.documentId, SHA);
    const proposed = proposeSemanticLink(map, document, makeRegion(), 'el-kitchen', source);
    const accepted = accept(proposed, document, proposed.links[0]!.id, 'test-user');
    const serialized = serializeSemanticWorkspace({ schema: 'semantic_spatial_workspace.v1', documentId: source.documentId, sourceImageSha256: SHA, document, map: accepted });
    const expected = { documentId: source.documentId, imageSha256: SHA, document };

    const restored = restoreSemanticSpatialMap(serialized, expected);
    expect(restored.state).toBe('restored');
    expect(restored.map.links[0]).toMatchObject({ review: { state: 'accepted', actor: 'test-user' }, regionId: 'region-1' });

    const otherImage = restoreSemanticSpatialMap(serialized, { ...expected, imageSha256: 'c'.repeat(64) });
    expect(otherImage.state).toBe('discarded');
    expect(otherImage.reason).toBe('SEMANTIC_WORKSPACE_SOURCE_MISMATCH');
    expect(otherImage.map).toMatchObject({ documentId: source.documentId, sourceImageSha256: 'c'.repeat(64), links: [] });
  });

  it('refuses acceptance when the vector region changed after the proposal', () => {
    const document = makeDocument();
    const map = createSemanticSpatialMap(document, source.documentId, SHA);
    const region = makeRegion();
    const proposed = proposeSemanticLink(map, document, region, 'el-kitchen', source);
    const changed = { ...region, vertices: region.vertices.map((point, index) => index === 1 ? { ...point, x: point.x + 0.25 } : point) };
    expect(() => accept(proposed, document, proposed.links[0]!.id, 'tester', changed)).toThrow('SEMANTIC_MAP_REGION_STALE');
    expect(proposed.links[0]!.review.state).toBe('proposed');
  });

  it('loads legacy proposals but requires fresh geometry before accepting them', () => {
    const document = makeDocument();
    const map = createSemanticSpatialMap(document, source.documentId, SHA);
    const proposal = proposeSemanticLink(map, document, makeRegion(), 'el-kitchen', source);
    const legacy = structuredClone(proposal);
    delete legacy.links[0]!.regionSnapshot;
    expect(validateSemanticSpatialMap(legacy, document)).toEqual(legacy);
    expect(() => acceptSemanticLink(legacy, legacy.links[0]!.id, 'tester', { document, currentRegion: makeRegion(), source })).toThrow('SEMANTIC_MAP_REGION_SNAPSHOT_MISSING');
  });

  it('pre-selects only well-defined regions for review', () => {
    expect(selectWellDefinedRegionIds([makeRegion('region-1', 0.9), makeRegion('region-2', 0.4), { ...makeRegion('region-3', 0.95), eligibility: 'low_quality_candidate' }])).toEqual(['region-1']);
  });

  it('answers grounded questions without fabricating missing context', () => {
    const empty = answerGroundedQuery('O que identificaste neste projecto?', { document: null, map: null, scene: null, selectedId: null, undoDepth: 0, redoDepth: 0 });
    expect(empty?.kind).toBe('CLARIFICATION');
    const missing = answerGroundedQuery('Mostra-me a cozinha.', { document: makeDocument(), map: null, scene: null, selectedId: null, undoDepth: 0, redoDepth: 0 });
    expect(missing?.kind).toBe('CLARIFICATION');
    const noWall = answerGroundedQuery('Qual é a dimensão desta parede?', { document: null, map: null, scene: null, selectedId: null, undoDepth: 0, redoDepth: 0 });
    expect(noWall?.kind).toBe('CLARIFICATION');
    expect(answerGroundedQuery('Aumenta esta parede em 50 centímetros.', { document: null, map: null, scene: null, selectedId: null, undoDepth: 0, redoDepth: 0 })).toBeNull();
  });

  it('reports the undone operation even when older undo history also remains', () => {
    const scene = { id: 'scene-test', nodes: [], revision: { number: 10, id: 'scene-test:r10', createdBy: 'user' } } as never;
    const answer = answerGroundedQuery('O que mudou nesta estrutura?', { document: null, map: null, scene, selectedId: null, undoDepth: 4, redoDepth: 1 });
    expect(answer?.kind).toBe('ANSWER');
    if (answer?.kind !== 'ANSWER') return;
    expect(answer.text).toContain('A última alteração foi desfeita');
    expect(answer.text).toContain('1 revisão disponível para refazer');
    expect(answer.text).toContain('4 revisões anteriores disponíveis para desfazer');
  });
});
