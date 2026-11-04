import { describe, expect, it } from 'vitest';
import { parseSpatialAnswer, validateSpatialQuestion } from '../src/living/spatial-voice/question';

const request = { question: 'Para que serve?', selectedId: 'eye', revision: 'eye:1', title: 'Microscope', components: [{ id: 'eye', label: 'Eyepiece' }], relations: [], unknowns: [], history: [] };
describe('universal spatial question contract', () => {
  it('accepts bounded context and rejects unknown selections and fields', () => {
    expect(validateSpatialQuestion(request)).toEqual(request);
    expect(() => validateSpatialQuestion({ ...request, selectedId: 'other' })).toThrow('INVALID_SPATIAL_QUESTION');
    expect(() => validateSpatialQuestion({ ...request, operation: 'execute' })).toThrow('INVALID_SPATIAL_QUESTION');
    expect(() => validateSpatialQuestion({ ...request, question: 'x'.repeat(501) })).toThrow('INVALID_SPATIAL_QUESTION');
  });
  it('requires a bounded answer and limitations', () => {
    expect(parseSpatialAnswer('{"answer":"Explicação","limitations":"Não verificado"}')).toEqual({ answer: 'Explicação', limitations: 'Não verificado' });
    expect(() => parseSpatialAnswer('{"answer":"Explicação","limitations":""}')).toThrow('INVALID_SPATIAL_ANSWER');
    expect(() => parseSpatialAnswer('{"answer":"Explicação","limitations":"X","operation":"edit"}')).toThrow('INVALID_SPATIAL_ANSWER');
  });
});
