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

it('passes labelled relations and unknowns to the model as data and requests distinction from general knowledge', async () => {
  const { ALLOWED_ORIGIN, metaResponse, rawRequest, withGuardedServer } = await import('./helpers/paid-routes');
  const { vi } = await import('vitest');
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(metaResponse(JSON.stringify({ answer: 'Informação geral.', limitations: 'Geometria desconhecida.' })));
  const context = { ...request, components: [...request.components, { id: 'lens', label: 'Objective' }], relations: [{ fromId: 'eye', toId: 'lens', kind: 'aligned_with', origin: 'inferred' }], unknowns: ['Dimensões desconhecidas'] };
  await withGuardedServer({ fetchImpl }, async port => {
    const reply = await rawRequest(port, { path: '/api/spatial/question', headers: { origin: ALLOWED_ORIGIN, 'content-type': 'application/json' }, body: context });
    expect(reply.status).toBe(200);
    const requestBody = JSON.stringify(JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body)));
    expect(requestBody).toContain('conhecimento geral');
    expect(requestBody).toContain('aligned_with');
    expect(requestBody).toContain('inferred');
    expect(requestBody).toContain('Dimensões desconhecidas');
    expect(reply.json.source).toBe('meta');
  });
});
