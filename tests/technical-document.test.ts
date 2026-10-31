import { describe, expect, it } from 'vitest';
import { answerTechnicalDocumentQuestion, DOMAIN_ADAPTER_REGISTRY, parseTechnicalDocumentText, technicalAdapters, TECHNICAL_DOCUMENT_JSON_SCHEMA, toMechanicalObservation, type TechnicalDocumentV1 } from '../src/technical-document';

const base: TechnicalDocumentV1 = {
  schema: 'technical_document.v1', provenance: { source: 'submitted_image', kind: 'model_extraction' }, analysisState: 'complete', documentType: 'planta residencial', primaryDomain: 'architecture', secondaryDomains: ['electrical_installation'],
  classification: { confidence: 0.92, evidence: 'nomes de divisões e símbolos eléctricos', rationale: 'Planta mista.' },
  summary: 'A imagem mostra uma planta residencial com anotação eléctrica.',
  elements: [
    { id: 'kitchen', kind: 'room', label: 'Cozinha', status: 'observed', evidence: 'texto “Cozinha” legível', confidence: 0.96, rawValue: '23.39 m²', value: 23.39, unit: 'm²' },
    { id: 'load', kind: 'load', label: 'Carga', status: 'inferred', evidence: 'símbolo parcialmente legível', confidence: 0.55, rawValue: '800 VA', value: 800, unit: 'VA' },
  ],
  relations: [{ id: 'rel-1', fromId: 'load', toId: 'kitchen', kind: 'other', status: 'unknown', evidence: 'a ligação não está desenhada com clareza', confidence: 0.2 }],
  observedText: ['Cozinha', '23.39 m²', '800 VA'], ambiguities: ['não é possível confirmar a que circuito pertence a carga'], missingInformation: ['escala calibrada'],
  capabilities: ['canExplain', 'canInspect', 'canEditSemanticData', 'canVisualize2D', 'canConstruct3D', 'canSimulate', 'canRunWhatIf'].map((id) => ({ id, state: id === 'canExplain' || id === 'canInspect' ? 'available' : 'blocked', reason: 'Limite de prova documental.', dependencies: [], missing: [], engine: null })) as TechnicalDocumentV1['capabilities'],
  questions: [{ id: 'kitchen-area', question: 'Qual é a área indicada da cozinha?', answer: '23.39 m² aparece junto ao rótulo Cozinha.', basis: 'observed', sourceIds: ['kitchen'] }],
};

describe('technical_document.v1', () => {
  it('accepts mixed domains and preserves explicit raw units and evidence classes', () => {
    const parsed = parseTechnicalDocumentText(JSON.stringify(base));
    expect(parsed.secondaryDomains).toContain('electrical_installation');
    expect(parsed.elements.find((item) => item.id === 'load')?.rawValue).toBe('800 VA');
    expect(parsed.elements.find((item) => item.id === 'load')?.unit).toBe('VA');
    expect(answerTechnicalDocumentQuestion('Qual é a área indicada da cozinha?', parsed).answer).toContain('23.39 m²');
  });

  it('answers document questions with citations or explicit uncertainty instead of blanket BLOCKED', () => {
    const parsed = parseTechnicalDocumentText(JSON.stringify(base));
    expect(answerTechnicalDocumentQuestion('Explica-me a distribuição desta casa.', parsed).answer).toContain('Cozinha');
    expect(answerTechnicalDocumentQuestion('Qual é a cota superior esquerda?', parsed).answer).toContain('Não encontrei uma medida');
    const focused = answerTechnicalDocumentQuestion('Tens certeza dessa medida?', parsed, 'kitchen');
    expect(focused.answer).toContain('validação actual: unreviewed');
    expect(focused.sourceIds).toEqual(['kitchen']);

    const electrical = structuredClone(parsed);
    electrical.primaryDomain = 'electrical_installation';
    expect(answerTechnicalDocumentQuestion('O que significam os valores em VA?', electrical).answer).toContain('potência aparente');
    expect(answerTechnicalDocumentQuestion('Posso testar uma sobrecarga?', electrical).answer).toContain('Não é possível testar uma falha');

    const mechanical = structuredClone(parsed);
    mechanical.primaryDomain = 'mechanical';
    expect(answerTechnicalDocumentQuestion('Porque ainda não podes simular?', mechanical).answer).toContain('fotografia não confirma');
  });

  it('rejects model claims of human verification, invented relation targets and unbounded capability states', () => {
    const falselyVerified = structuredClone(base);
    falselyVerified.elements[0]!.status = 'verified' as never;
    expect(() => parseTechnicalDocumentText(JSON.stringify(falselyVerified))).toThrow('SCHEMA_INVALID');
    const invalidRelation = structuredClone(base);
    invalidRelation.relations[0]!.toId = 'not-present';
    expect(() => parseTechnicalDocumentText(JSON.stringify(invalidRelation))).toThrow('SCHEMA_INVALID');
    const modelInventedCapabilities = structuredClone(base);
    modelInventedCapabilities.capabilities = [];
    expect(parseTechnicalDocumentText(JSON.stringify(modelInventedCapabilities)).capabilities).toHaveLength(7);
  });

  it('distinguishes invalid JSON and keeps unknown domains explainable but not simulatable', () => {
    expect(() => parseTechnicalDocumentText('{"incomplete":')).toThrow('JSON_INVALID');
    const unknown = structuredClone(base);
    unknown.primaryDomain = 'unknown';
    unknown.secondaryDomains = [];
    unknown.classification.confidence = 0.4;
    const capacities = technicalAdapters('unknown', unknown);
    expect(parseTechnicalDocumentText(JSON.stringify(unknown)).analysisState).toBe('unknown');
    expect(capacities.find((item) => item.id === 'canExplain')?.state).toBe('partial');
    expect(capacities.find((item) => item.id === 'canSimulate')?.state).toBe('blocked');
  });

  it('registers adapters for every required domain without claiming unsupported engines', () => {
    expect(Object.keys(DOMAIN_ADAPTER_REGISTRY)).toHaveLength(10);
    expect(DOMAIN_ADAPTER_REGISTRY.mechanical.engine).toContain('kinematic_assembly.v1');
    expect(DOMAIN_ADAPTER_REGISTRY.civil_structural.engine).toBeNull();
    expect(TECHNICAL_DOCUMENT_JSON_SCHEMA.properties).not.toHaveProperty('capabilities');
  });

  it('rejects electrical unit coercion while preserving the printed quantity', () => {
    const electrical = structuredClone(base);
    electrical.primaryDomain = 'electrical_installation';
    electrical.secondaryDomains = [];
    electrical.elements[1]!.rawValue = '800 VA';
    electrical.elements[1]!.unit = 'W';
    expect(() => parseTechnicalDocumentText(JSON.stringify(electrical))).toThrow('unidade original incompatíveis');
  });

  it('preserves the mechanical observation adapter without promoting inference or enabling a solver', () => {
    const mechanical = structuredClone(base);
    mechanical.primaryDomain = 'mechanical';
    mechanical.secondaryDomains = [];
    mechanical.elements = [
      { ...mechanical.elements[0]!, id: 'bar-a', kind: 'bar', label: 'Barra A', status: 'observed' },
      { ...mechanical.elements[0]!, id: 'bar-b', kind: 'bar', label: 'Barra B', status: 'inferred' },
    ];
    mechanical.questions = [];
    mechanical.relations = [{ id: 'link', fromId: 'bar-a', toId: 'bar-b', kind: 'connected_to', status: 'observed', evidence: 'parafuso visível', confidence: 0.9 }];
    const normalized = parseTechnicalDocumentText(JSON.stringify(mechanical));
    const observation = toMechanicalObservation(normalized);
    expect(observation?.elements.map((item) => item.id)).toEqual(['bar-a']);
    expect(observation?.connections).toEqual([]);
    expect(normalized.capabilities.find((item) => item.id === 'canSimulate')?.state).toBe('blocked');
  });
});
