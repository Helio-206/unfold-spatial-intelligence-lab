import { describe, expect, it } from 'vitest';
import { assessTechnicalSemantics, buildDomainExtractionPrompt, buildRegionVerificationPrompt, buildTechnicalRecognitionPrompt, MULTIMODAL_STAGE_CONFIG, parseRegionVerification, parseTechnicalRecognition, TECHNICAL_RECOGNITION_JSON_SCHEMA } from '../src/technical-document-pipeline';
import { TECHNICAL_DOCUMENT_JSON_SCHEMA, type TechnicalDocumentV1 } from '../src/technical-document';

const documentFixture = (domain: TechnicalDocumentV1['primaryDomain'], elements: TechnicalDocumentV1['elements'] = [], relations: TechnicalDocumentV1['relations'] = []): TechnicalDocumentV1 => ({
  schema: 'technical_document.v1', provenance: { source: 'submitted_image', kind: 'model_extraction' }, analysisState: 'complete', documentType: 'fixture exclusivamente automatizada', primaryDomain: domain, secondaryDomains: [],
  classification: { confidence: 0.9, evidence: 'fixture test', rationale: 'fixture test' }, summary: 'fixture test', elements, relations, observedText: [], ambiguities: [], missingInformation: [], capabilities: [], questions: [],
});

describe('progressive multimodal reliability pipeline', () => {
  it('validates minimal recognition classification, description and deterministic routing', () => {
    const value = { schema: 'technical_recognition.v2', primaryDomain: 'architecture', secondaryDomains: [], documentType: 'planta', summary: 'Planta residencial com cotas.', legibility: 'medium', route: 'extract' };
    expect(parseTechnicalRecognition(JSON.stringify(value))).toMatchObject({ primaryDomain: 'architecture', documentType: 'planta' });
    expect(parseTechnicalRecognition(JSON.stringify({ ...value, primaryDomain: 'unknown', route: 'stop_unknown' })).route).toBe('stop_unknown');
    expect(() => parseTechnicalRecognition(JSON.stringify({ ...value, primaryDomain: 'unknown' }))).toThrow('SCHEMA_INVALID');
    expect(TECHNICAL_RECOGNITION_JSON_SCHEMA.required).toEqual(['schema', 'primaryDomain', 'secondaryDomains', 'documentType', 'summary', 'legibility', 'route']);
    expect(TECHNICAL_RECOGNITION_JSON_SCHEMA.properties).not.toHaveProperty('keySignals');
    expect(buildTechnicalRecognitionPrompt()).toContain('Não cries relações, coordenadas, bounding boxes');
    expect(buildTechnicalRecognitionPrompt()).toContain('isso pertence à fase B');
  });

  it('uses low effort for recognition and calibrated high effort for specialized extraction', () => {
    expect(MULTIMODAL_STAGE_CONFIG).toEqual({
      recognition: { maxOutputTokens: 2_048, reasoningEffort: 'low', schemaName: 'technical_recognition_v2' },
      extraction: { maxOutputTokens: 12_288, reasoningEffort: 'high', schemaName: 'technical_document_v1' },
      regionVerification: { maxOutputTokens: 2_048, reasoningEffort: 'high', schemaName: 'technical_region_verification_v1' },
    });
    expect(JSON.stringify(TECHNICAL_RECOGNITION_JSON_SCHEMA).length).toBeLessThan(JSON.stringify(TECHNICAL_DOCUMENT_JSON_SCHEMA).length);
  });

  it('flags contradictory architectural dimensions without rewriting their raw values', () => {
    const document = documentFixture('architecture', [
      { id: 'total', kind: 'dimension', label: 'largura total', status: 'observed', evidence: 'cota visível', confidence: 0.9, rawValue: '15.12 m', value: 15.12, unit: 'm' },
      { id: 'a', kind: 'dimension', label: 'largura parcial superior esquerda', status: 'observed', evidence: 'cota visível', confidence: 0.8, rawValue: '5.25 m', value: 5.25, unit: 'm' },
      { id: 'b', kind: 'dimension', label: 'largura parcial superior direita', status: 'observed', evidence: 'cota visível', confidence: 0.8, rawValue: '9.25 m', value: 9.25, unit: 'm' },
    ]);
    const assessment = assessTechnicalSemantics(document);
    expect(assessment.issues.map((issue) => issue.code)).toContain('INCONSISTENT_DIMENSION_SUM');
    expect(document.elements.find((item) => item.id === 'total')?.rawValue).toBe('15.12 m');
  });

  it('keeps VA distinct from W and does not infer electrical topology', () => {
    const document = documentFixture('electrical_installation', [{ id: 'load', kind: 'load', label: 'Carga', status: 'observed', evidence: 'símbolo próximo ao valor', confidence: 0.85, rawValue: '800 VA', value: 800, unit: 'VA' }]);
    const codes = assessTechnicalSemantics(document).issues.map((issue) => issue.code);
    expect(codes).toContain('APPARENT_POWER_NOT_ACTIVE_POWER');
    expect(codes).toContain('ELECTRICAL_TOPOLOGY_UNCONFIRMED');
    expect(codes).not.toContain('VOLTAGE_NOT_EXPLICIT');
  });

  it('keeps mechanical compatibility blocked when joints, ground, or dimensions are not observed', () => {
    const document = documentFixture('mechanical', [{ id: 'bar', kind: 'bar', label: 'barra', status: 'observed', evidence: 'contorno visível', confidence: 0.8, rawValue: null, value: null, unit: null }]);
    const codes = assessTechnicalSemantics(document).issues.map((issue) => issue.code);
    expect(codes).toContain('JOINT_TYPES_UNCONFIRMED');
    expect(codes).toContain('MECHANICAL_DIMENSIONS_MISSING');
    expect(codes).toContain('GROUND_NOT_CONFIRMED');
    const recognition = parseTechnicalRecognition(JSON.stringify({ schema: 'technical_recognition.v2', primaryDomain: 'mechanical', secondaryDomains: [], documentType: 'mecanismo', summary: 'Barras visíveis.', legibility: 'high', route: 'extract' }));
    const prompt = buildDomainExtractionPrompt(recognition);
    expect(prompt).toContain('Não assumir mecanismo planar');
    expect(prompt).toContain('Evita repetir o mesmo facto');
  });

  it('labels same-model regional reread as non-independent and never verified', () => {
    const prompt = buildRegionVerificationPrompt({ targetLabel: 'cota superior', question: 'qual o valor?', originalRegion: { x: 0.2, y: 0.1, width: 0.1, height: 0.1 }, originalSize: { width: 1000, height: 800 } });
    expect(prompt).toContain('não é confirmação independente');
    expect(prompt).not.toContain('9.25');
    expect(parseRegionVerification(JSON.stringify({ status: 'uncertain', reading: null, unit: null, visibleText: '9.?5', alternatives: ['9.85', '9.65'], explanation: 'Dígito ilegível.', regionReference: 'selected_crop' })).status).toBe('uncertain');
    expect(() => parseRegionVerification(JSON.stringify({ status: 'uncertain', reading: '9.25', unit: 'm', visibleText: '9.25 m', alternatives: [], explanation: 'ok', regionReference: 'selected_crop' }))).toThrow('REGION_SCHEMA_INVALID');
  });
});
