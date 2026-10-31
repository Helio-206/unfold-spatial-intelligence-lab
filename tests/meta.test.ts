import { describe, expect, it, vi } from 'vitest';
import { requestMetaImageText, requestMetaStructuredImage, requestMetaStructuredText, requestMetaText, validateMechanicalObservation } from '../src/meta';

describe('Meta text client', () => {
  it('stops before fetch when the server key is missing', async () => {
    const fetchMock = vi.fn();
    await expect(requestMetaText('hello', undefined, fetchMock)).rejects.toThrow('MODEL_API_KEY');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends text only and returns a sanitized call log', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ id: 'resp_test', status: 'completed', output: [{ content: [{ type: 'output_text', text: 'UNFOLD_META_PROBE_OK' }] }], usage: { input_tokens: 4, output_tokens: 1, total_tokens: 5 } }), { status: 200, headers: { 'x-request-id': 'req_test' } }));
    const result = await requestMetaText('hello', 'server-only-test-key', fetchMock);
    expect(result.text).toBe('UNFOLD_META_PROBE_OK');
    expect(result.log).toMatchObject({ model: 'muse-spark-1.3', httpStatus: 200, status: 'success', requestId: 'req_test', usage: { totalTokens: 5 } });
    const request = fetchMock.mock.calls[0]?.[1];
    expect(request?.headers).toMatchObject({ Authorization: 'Bearer server-only-test-key' });
    expect(String(request?.body)).toContain('"model":"muse-spark-1.3"');
    expect(String(request?.body)).toContain('"input":"hello"');
    expect(String(request?.body)).not.toContain('input_image');
  });

  it('sends one image as multimodal input without changing the text contract', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: 'completed', output: [{ content: [{ text: '{"elements":[],"connections":[],"dimensions":[],"ambiguities":[],"missingInformation":[]}' }] }], usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 } }), { status: 200 }));
    const result = await requestMetaImageText('data:image/jpeg;base64,ZmFrZQ==', 'Return JSON.', 'server-only-test-key', fetchMock);
    expect(validateMechanicalObservation(JSON.parse(result.text))).toMatchObject({ elements: [], connections: [], dimensions: [] });
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain('input_image');
  });

  it('uses Responses API text.format strict JSON Schema and does not send response_format', async () => {
    const schema = { type: 'object', properties: { result: { type: 'string' } }, required: ['result'], additionalProperties: false };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: 'completed', output_text: '{"result":"ok"}', usage: { input_tokens: 100, output_tokens: 40, total_tokens: 140, input_tokens_details: { cached_tokens: 20 }, output_tokens_details: { reasoning_tokens: 15 } } }), { status: 200 }));
    const result = await requestMetaStructuredImage('data:image/jpeg;base64,ZmFrZQ==', 'Extract.', 'server-only-test-key', schema, fetchMock);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.text.format).toEqual({ type: 'json_schema', name: 'technical_document_v1', schema, strict: true });
    expect(body.response_format).toBeUndefined();
    expect(body.reasoning).toEqual({ effort: 'low' });
    expect(result.log.usage).toMatchObject({ inputTokens: 100, outputTokens: 40, cachedInputTokens: 20, reasoningTokens: 15 });
    expect(result.log.estimatedCostUsd).toBe(0.000273);
  });

  it('supports the authorized high-effort budgets and high-fidelity image detail in the actual Responses payload', async () => {
    const schema = { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: 'completed', output_text: '{"answer":"ok"}', usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } }), { status: 200 }));
    await requestMetaStructuredImage('data:image/png;base64,aGVsbG8=', 'Extract.', 'server-only-test-key', schema, fetchMock, 12_288, undefined, 'high', 'technical_document_v1', 'high');
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({ model: 'muse-spark-1.3', max_output_tokens: 12_288, reasoning: { effort: 'high' }, text: { format: { type: 'json_schema', name: 'technical_document_v1', strict: true } } });
    expect(body.input[0].content[1]).toEqual({ type: 'input_image', image_url: 'data:image/png;base64,aGVsbG8=', detail: 'high' });

    fetchMock.mockClear();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: 'completed', output_text: '{"answer":"ok"}' }), { status: 200 }));
    await requestMetaStructuredText('Question.', 'server-only-test-key', schema, fetchMock, 8_192, 'high');
    const textBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(textBody).toMatchObject({ max_output_tokens: 8_192, reasoning: { effort: 'high' }, text: { format: { name: 'unfold_conversation_v1', strict: true } } });
  });

  it('reports incomplete model responses distinctly', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ id: 'resp-incomplete', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [], usage: { input_tokens: 517, output_tokens: 700, total_tokens: 1_217, output_tokens_details: { reasoning_tokens: 668 } } }), { status: 200 }));
    try {
      await requestMetaStructuredImage('data:image/jpeg;base64,ZmFrZQ==', 'Extract.', 'server-only-test-key', {}, fetchMock, 700, undefined, 'low', 'recognition_test');
      throw new Error('Expected incomplete response');
    } catch (error) {
      expect(error).toMatchObject({ kind: 'incomplete', log: { incompleteReason: 'max_output_tokens', maxOutputTokens: 700, usage: { outputTokens: 700, reasoningTokens: 668 } } });
    }
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request).toMatchObject({ max_output_tokens: 700, reasoning: { effort: 'low' }, text: { format: { type: 'json_schema', name: 'recognition_test', strict: true } } });
  });

  it('propagates caller cancellation to the upstream request', async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    const fetchMock = vi.fn<typeof fetch>((_input, init) => new Promise((_resolve, reject) => {
      requestSignal = init?.signal as AbortSignal;
      requestSignal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    const pending = requestMetaStructuredImage('data:image/jpeg;base64,ZmFrZQ==', 'Extract.', 'server-only-test-key', {}, fetchMock, 100, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(requestSignal?.aborted).toBe(true);
  });

  it('rejects inferred mechanical fields that are not marked observed', () => {
    expect(() => validateMechanicalObservation({ elements: [{ id: 'bar-1', kind: 'bar', label: 'bar', observed: false, evidence: 'guess', confidence: 'low' }], connections: [], dimensions: [], ambiguities: [], missingInformation: [] })).toThrow('observado');
  });

  it('accepts numeric confidence returned by the multimodal response', () => {
    const result = validateMechanicalObservation({ elements: [{ id: 'bar-1', kind: 'bar', label: 'bar', observed: true, evidence: 'visible', confidence: 0.9 }], connections: [], dimensions: [], ambiguities: [], missingInformation: [] });
    expect(result.elements[0]?.confidence).toBe(0.9);
  });
});
