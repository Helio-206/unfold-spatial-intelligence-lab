import { describe, expect, it } from 'vitest';
import { traceWallCandidate } from '../src/plan-reconstruction';
import {
  associateGroundingsToCandidates,
  buildVisualGroundingPrompt,
  groundingBoxToPixels,
  parseVisualGroundingResponse,
  validateVisualGrounding,
  VISUAL_GROUNDING_RESPONSE_SCHEMA,
} from '../src/visual-grounding';

const source = { sha256: 'a'.repeat(64), width: 1200, height: 800, mimeType: 'image/jpeg', coordinateSystem: 'normalized_0_1000_top_left' as const };
const response = {
  schema: VISUAL_GROUNDING_RESPONSE_SCHEMA,
  summary: 'Planta residencial com paredes, vãos e divisões identificáveis visualmente; sem escala inferida.',
  elements: [
    { id: 'wall-top', label: 'Parede horizontal superior', componentClass: 'wall', point: { x: 500, y: 100 }, box: { x: 100, y: 90, width: 800, height: 20 }, evidence: 'Linha estrutural espessa no limite superior.', confidence: 0.84, ambiguities: ['Pode incluir cotas adjacentes.'] },
    { id: 'window-east', label: 'Janela provável', componentClass: 'window', point: { x: 900, y: 350 }, box: null, evidence: 'Abertura com linhas paralelas no limite direito.', confidence: 0.62, ambiguities: ['Não é possível confirmar que é uma janela.'] },
  ],
  relations: [{ id: 'rel-1', fromId: 'window-east', toId: 'wall-top', kind: 'near', evidence: 'Proximidade visual, não conectividade.', confidence: 0.43, ambiguities: ['A relação geométrica não está confirmada.'] }],
  limitations: ['Não foi inferida escala métrica.'],
};

describe('visual_grounding.v1', () => {
  it('preserves image identity, location, ambiguity and unreviewed provenance', () => {
    const grounding = parseVisualGroundingResponse(JSON.stringify(response), source, { documentId: 'doc-1', schema: 'technical_document.v1' });
    expect(grounding.sourceImage).toEqual(source);
    expect(grounding.provider).toBe('muse-spark-1.3');
    expect(grounding.elements[0]).toMatchObject({ id: 'wall-top', review: 'unreviewed', confidence: 0.84, point: { x: 500, y: 100 } });
    expect(grounding.elements[0]?.relationIds).toEqual(['rel-1']);
    expect(grounding.elements[1]?.relationIds).toEqual(['rel-1']);
    expect(validateVisualGrounding(grounding, { sha256: source.sha256, width: source.width, height: source.height })).toEqual(grounding);
  });

  it('rejects out-of-bounds coordinates, dangling relations, invalid source identity and hostile shape', () => {
    const outside = structuredClone(response); outside.elements[0]!.box!.width = 901;
    expect(() => parseVisualGroundingResponse(JSON.stringify(outside), source, null)).toThrow('VISUAL_GROUNDING_INVALID_ELEMENT');
    const dangling = structuredClone(response); dangling.relations[0]!.toId = 'missing';
    expect(() => parseVisualGroundingResponse(JSON.stringify(dangling), source, null)).toThrow('VISUAL_GROUNDING_INVALID_RELATION');
    const grounding = parseVisualGroundingResponse(JSON.stringify(response), source, null);
    expect(() => validateVisualGrounding(grounding, { sha256: 'b'.repeat(64), width: source.width, height: source.height })).toThrow('VISUAL_GROUNDING_SOURCE_MISMATCH');
    expect(() => parseVisualGroundingResponse('{bad', source, null)).toThrow('VISUAL_GROUNDING_INVALID_JSON');
  });

  it('maps normalized boxes using the exact source dimensions without asserting a CAD transform', () => {
    expect(groundingBoxToPixels({ x: 250, y: 125, width: 500, height: 250 }, { width: 1200, height: 800 })).toEqual({ x: 300, y: 100, width: 600, height: 200 });
  });

  it('proposes nearest local wall candidates with a distance and rejects non-wall association', () => {
    const grounding = parseVisualGroundingResponse(JSON.stringify(response), source, null);
    const lines = [traceWallCandidate('local-top', { x: 10, y: 85 }, { x: 1100, y: 85 }, 8), traceWallCandidate('local-bottom', { x: 0, y: 550 }, { x: 1000, y: 550 }, 8)];
    const associations = associateGroundingsToCandidates(grounding, lines);
    expect(associations[0]).toMatchObject({ elementId: 'wall-top', candidateId: 'local-top', status: 'proposed' });
    expect(associations[0]?.distancePx).toBeGreaterThan(0);
    expect(associations[1]).toMatchObject({ elementId: 'window-east', candidateId: null, status: 'unmatched' });
  });

  it('matches room grounding only to existing region polygons and marks close alternatives ambiguous', () => {
    const withRooms = structuredClone(response);
    withRooms.elements.push({ id: 'room-kitchen', label: 'Cozinha', componentClass: 'room', point: { x: 450, y: 300 }, box: { x: 300, y: 100, width: 300, height: 400 }, evidence: 'Área identificada como cozinha.', confidence: 0.9, ambiguities: [] });
    const grounding = parseVisualGroundingResponse(JSON.stringify(withRooms), source, null);
    const region = (id: string, vertices: Array<{ x: number; y: number }>) => ({ id, boundaryCandidateIds: ['a', 'b', 'c', 'd'], vertices, areaPx2: Math.abs(vertices.reduce((sum, p, index) => { const next = vertices[(index + 1) % vertices.length]!; return sum + p.x * next.y - next.x * p.y; }, 0)) / 2, validation: 'unreviewed' as const, eligibility: 'construction_candidate' as const, confidence: 0.9, evidence: ['closed local topology'] });
    const regions = [region('region-kitchen', [{ x: 350, y: 120 }, { x: 680, y: 120 }, { x: 680, y: 420 }, { x: 350, y: 420 }])];
    expect(associateGroundingsToCandidates(grounding, [], regions).find((item) => item.elementId === 'room-kitchen')).toMatchObject({ regionId: 'region-kitchen', status: 'proposed' });
    const alternatives = [...regions, region('region-near', [{ x: 365, y: 125 }, { x: 690, y: 125 }, { x: 690, y: 425 }, { x: 365, y: 425 }])];
    expect(associateGroundingsToCandidates(grounding, [], alternatives).find((item) => item.elementId === 'room-kitchen')?.status).toBe('ambiguous');
  });

  it('does not use the center or width of a large wall box to snap to a distant local segment', () => {
    const broad = structuredClone(response) as unknown as {
      elements: Array<Omit<(typeof response.elements)[number], 'point'> & { point: { x: number; y: number } | null }>;
    };
    broad.elements[0]!.point = null;
    broad.elements[0]!.box = { x: 100, y: 80, width: 800, height: 20 };
    const grounding = parseVisualGroundingResponse(JSON.stringify(broad), source, null);
    const far = traceWallCandidate('far-horizontal', { x: 120, y: 420 }, { x: 1080, y: 420 }, 8);
    expect(associateGroundingsToCandidates(grounding, [far])[0]).toMatchObject({ candidateId: null, status: 'unmatched' });
  });

  it('keeps the prompt explicitly bounded to visual grounding, not scale or CAD claims', () => {
    const prompt = buildVisualGroundingPrompt({ width: 1200, height: 800, documentSummary: 'residencial' });
    expect(prompt).toContain('NORMALIZADA 0..1000');
    expect(prompt).toContain('Não inventes escala');
    expect(prompt).toContain('1200x800');
  });
});
