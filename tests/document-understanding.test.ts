import { describe, expect, it } from 'vitest';
import { answerDocumentQuestion, createDocumentCorrection, DOCUMENT_QUESTIONS, documentFacts, parseDocumentAnalysisText, type DocumentAnalysis } from '../src/document-understanding';

const evidence = <T>(value: T, status: 'observed' | 'inferred' | 'ambiguous' = 'observed', text = 'visual evidence') => ({ value, status, evidence: text, confidence: 0.96 });
const roomQuestions = DOCUMENT_QUESTIONS.architectural_floorplan.map((item) => ({ ...item, answer: item.id === 'kitchen_area' ? '23.39 m² está indicado no rótulo da cozinha.' : `Resposta baseada na planta: ${item.question}`, basis: 'observed' as const, sourceIds: item.id === 'kitchen_area' ? ['room-kitchen'] : [] }));
const electricalQuestions = DOCUMENT_QUESTIONS.electrical_installation_plan.map((item) => ({ ...item, answer: `Explicação contextual: ${item.question}`, basis: item.id === 'fault_test' ? 'missing' as const : 'interpretation' as const, sourceIds: item.id === 'va' ? ['rating-va'] : [] }));

const architecture: DocumentAnalysis = {
  domain: 'architectural_floorplan',
  classification: { confidence: 0.98, evidence: 'nomes de divisões, paredes e cotas', rationale: 'Planta residencial com divisões e cotas visíveis.' },
  extraction: { domain: 'architectural_floorplan', data: {
    rooms: [
      { id: 'room-kitchen', name: evidence('Cozinha'), area: { ...evidence({ value: 23.39, unit: 'm²' }), value: { value: 23.39, unit: 'm²' } } },
      { id: 'room-garage', name: evidence('Garagem') },
    ],
    dimensions: [{ id: 'dimension-total', label: evidence('Comprimento total'), value: evidence(15.12), unit: evidence('m') }],
    elements: [{ id: 'wall-1', kind: 'wall', label: evidence('parede exterior') }],
    relations: [{ fromId: 'room-kitchen', toId: 'room-garage', relation: evidence('relação espacial não confirmada', 'ambiguous') }],
    ambiguities: ['Escala global não confirmada.'], missingInformation: ['coordenadas métricas calibradas'],
  } },
  answers: roomQuestions,
};

const electrical: DocumentAnalysis = {
  domain: 'electrical_installation_plan',
  classification: { confidence: 0.95, evidence: 'símbolos eléctricos e valores VA/W', rationale: 'Plano de instalação eléctrica com anotações de potência.' },
  extraction: { domain: 'electrical_installation_plan', data: {
    symbols: [{ id: 'light-1', kind: 'lighting_point', label: evidence('símbolo de iluminação', 'ambiguous') }],
    ratings: [
      { id: 'rating-va', targetId: null, quantity: 'apparent_power', value: evidence(100), unit: 'VA' },
      { id: 'rating-w', targetId: null, quantity: 'active_power', value: evidence(2700), unit: 'W' },
    ],
    circuits: [], connections: [], ambiguities: ['Topologia de ligação não confirmável.'], missingInformation: ['tensão nominal da fonte'],
  } },
  answers: electricalQuestions,
};

describe('domain-aware document analysis', () => {
  it('validates architectural rooms, areas, dimensions, evidence and contextual answers', () => {
    expect(parseDocumentAnalysisText(JSON.stringify(architecture))).toEqual(architecture);
    expect(documentFacts(architecture).facts).toContain('Cozinha: 23.39 m² [observed; visual evidence]');
    expect(answerDocumentQuestion('Qual é a área da cozinha?', architecture)?.answer).toContain('23.39 m²');
  });

  it('validates electrical quantities without conflating VA, W or V', () => {
    expect(parseDocumentAnalysisText(JSON.stringify(electrical)).extraction.domain).toBe('electrical_installation_plan');
    const invalid = structuredClone(electrical);
    const data = invalid.extraction.data as typeof electrical.extraction.data & { ratings: Array<{ unit: string }> };
    data.ratings[0]!.unit = 'W';
    expect(() => parseDocumentAnalysisText(JSON.stringify(invalid))).toThrow('extraídos');
  });

  it('rejects invalid relation references and missing required questions', () => {
    const invalidReference = structuredClone(architecture);
    if (invalidReference.extraction.domain === 'architectural_floorplan') invalidReference.extraction.data.relations[0]!.toId = 'not-an-id';
    expect(() => parseDocumentAnalysisText(JSON.stringify(invalidReference))).toThrow('extraídos');
    const invalidAnswers = structuredClone(electrical);
    invalidAnswers.answers.pop();
    expect(() => parseDocumentAnalysisText(JSON.stringify(invalidAnswers))).toThrow('contextuais obrigatórias');
  });

  it('downgrades an underconfident category to unknown instead of guessing', () => {
    const uncertain = structuredClone(architecture);
    uncertain.classification.confidence = 0.42;
    const parsed = parseDocumentAnalysisText(JSON.stringify(uncertain));
    expect(parsed.domain).toBe('unknown');
    expect(parsed.extraction.domain).toBe('unknown');
    expect((parsed.extraction.data as { missingInformation: string[] }).missingInformation).toContain('esclarecer o tipo de documento');
  });

  it('extracts one schema-validated JSON object from a prose or markdown wrapper', () => {
    const json = JSON.stringify(architecture);
    expect(parseDocumentAnalysisText('```json\n' + json + '\n```').domain).toBe('architectural_floorplan');
    expect(parseDocumentAnalysisText(`Resultado:\n${json}\nFim.`).domain).toBe('architectural_floorplan');
  });

  it('records only explicit user corrections with separate provenance', () => {
    expect(createDocumentCorrection({ field: 'value', targetId: 'rating-va', value: '120', unit: 'VA', now: new Date('2026-10-30T10:00:00Z') })).toEqual({ field: 'value', targetId: 'rating-va', value: '120', unit: 'VA', confirmed: true, author: 'user', provenance: 'explicit_user_correction', createdAt: '2026-10-30T10:00:00.000Z' });
    expect(() => createDocumentCorrection({ field: 'unit', value: '  ' })).toThrow();
  });
});
