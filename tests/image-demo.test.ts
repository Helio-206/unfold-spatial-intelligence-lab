import { describe, expect, it, vi } from 'vitest';
import { assessImageSimulationReadiness, handlePastedImage, getPastedImageFile, requestImageAnalysis, validateImageDemoFile, IMAGE_DEMO_MAX_BYTES } from '../src/image-demo';
import { BACKEND_CONTRACT_VERSION, BACKEND_DIAGNOSTICS_SCHEMA, IMAGE_PIPELINE_VERSION, IMAGE_RESPONSE_CONTRACT, TECHNICAL_DOCUMENT_SCHEMA_VERSION, TECHNICAL_RECOGNITION_SCHEMA_VERSION } from '../src/api-contract';

function backendDiagnostics(): Response {
  return new Response(JSON.stringify({
    schema: BACKEND_DIAGNOSTICS_SCHEMA, contractVersion: BACKEND_CONTRACT_VERSION, buildId: 'fixture-build',
    pipelineVersion: IMAGE_PIPELINE_VERSION, responseSchemaVersion: TECHNICAL_DOCUMENT_SCHEMA_VERSION,
    recognitionSchemaVersion: TECHNICAL_RECOGNITION_SCHEMA_VERSION, startedAt: new Date().toISOString(),
    metaCallBudget: { limit: 2, used: 0, remaining: 2 },
    capabilities: {
      imageAnalysis: { available: true, apiKeyConfigured: true, responseContract: IMAGE_RESPONSE_CONTRACT },
      contextualConversation: { available: true, apiKeyConfigured: true },
      imageRegionVerification: { available: true, apiKeyConfigured: true },
    },
  }), { status: 200 });
}

describe('demo image insight', () => {
  it('extracts a pasted JPEG or PNG file and ignores other clipboard content', () => {
    const png = new File([new Uint8Array([1])], 'clipboard.png', { type: 'image/png' });
    const webp = new File([new Uint8Array([1])], 'clipboard.webp', { type: 'image/webp' });
    const clipboardData = (files: File[]): DataTransfer => ({
      items: files.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file })),
    } as unknown as DataTransfer);

    expect(getPastedImageFile(clipboardData([webp, png]))).toBe(png);
    expect(getPastedImageFile(clipboardData([webp]))).toBeUndefined();
    expect(getPastedImageFile(null)).toBeUndefined();
  });

  it('consumes only supported image pastes and routes them to the existing selection flow', () => {
    const png = new File([new Uint8Array([1])], 'clipboard.png', { type: 'image/png' });
    const clipboardData = { items: [{ kind: 'file', type: png.type, getAsFile: () => png }] } as unknown as DataTransfer;
    const preventDefault = vi.fn();
    const onImage = vi.fn();
    const event = { clipboardData, preventDefault };

    expect(handlePastedImage(event, onImage)).toBe(true);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onImage).toHaveBeenCalledWith(png);

    const textOnly = { clipboardData: { items: [] } as unknown as DataTransfer, preventDefault: vi.fn() };
    expect(handlePastedImage(textOnly, onImage)).toBe(false);
    expect(textOnly.preventDefault).not.toHaveBeenCalled();
  });

  it('accepts only bounded JPEG and PNG files before upload', () => {
    expect(validateImageDemoFile(new File([new Uint8Array([0xff, 0xd8, 0xff])], 'mechanism.jpg', { type: 'image/jpeg' }))).toBe('image/jpeg');
    expect(() => validateImageDemoFile(new File([new Uint8Array([1])], 'mechanism.webp', { type: 'image/webp' }))).toThrow('JPEG ou PNG');
    expect(() => validateImageDemoFile(new File([new Uint8Array(IMAGE_DEMO_MAX_BYTES + 1)], 'large.jpg', { type: 'image/jpeg' }))).toThrow('10 MB');
  });

  it('validates the structured response again on the client and keeps failures controlled', async () => {
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'mechanism.jpg', { type: 'image/jpeg' });
    const malformed = vi.fn<typeof fetch>().mockResolvedValueOnce(backendDiagnostics()).mockResolvedValueOnce(new Response(JSON.stringify({ contract: IMAGE_RESPONSE_CONTRACT, observation: {} }), { status: 200 }));
    await expect(requestImageAnalysis(file, new AbortController().signal, malformed)).rejects.toThrow('documento técnico completo');
    const upstreamFailure = vi.fn<typeof fetch>().mockResolvedValueOnce(backendDiagnostics()).mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'upstream unavailable' } }), { status: 503 }));
    await expect(requestImageAnalysis(file, new AbortController().signal, upstreamFailure)).rejects.toThrow('upstream unavailable');
  });

  it('rejects malformed recognition metadata rather than trusting optional stage fields', async () => {
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'plan.jpg', { type: 'image/jpeg' });
    const document = { schema: 'technical_document.v1', provenance: { source: 'submitted_image', kind: 'model_extraction' }, analysisState: 'partial', documentType: 'planta', primaryDomain: 'architecture', secondaryDomains: [], classification: { confidence: 0.8, evidence: 'rótulos', rationale: 'planta' }, summary: 'planta', elements: [], relations: [], observedText: [], ambiguities: [], missingInformation: [], capabilities: [], questions: [] };
    const response = vi.fn<typeof fetch>().mockResolvedValueOnce(backendDiagnostics()).mockResolvedValueOnce(new Response(JSON.stringify({ contract: IMAGE_RESPONSE_CONTRACT, image: { mimeType: 'image/jpeg', byteLength: 3, maxBytes: 100 }, document, observation: null, recognition: { schema: 'technical_recognition.v2', primaryDomain: 'made-up', secondaryDomains: [], documentType: 'x', summary: 'x', route: 'extract' } }), { status: 200 }));
    await expect(requestImageAnalysis(file, new AbortController().signal, response)).rejects.toThrow('Reconhecimento multimodal inválido');
  });

  it('does not accept a document after an output-budget failure', async () => {
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'plan.jpg', { type: 'image/jpeg' });
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(backendDiagnostics())
      .mockResolvedValueOnce(new Response(JSON.stringify({ contract: IMAGE_RESPONSE_CONTRACT, error: { code: 'OUTPUT_BUDGET_EXHAUSTED', message: 'Orçamento esgotado na fase recognition.' }, failedStage: 'recognition' }), { status: 502 }));
    await expect(requestImageAnalysis(file, new AbortController().signal, fetchMock)).rejects.toThrow('Orçamento esgotado na fase recognition');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps an image interpretation blocked for deterministic simulation until reviewed', () => {
    const readiness = assessImageSimulationReadiness({
      elements: [{ id: 'bar-1', kind: 'bar', label: 'barra', observed: true, evidence: 'visível', confidence: 0.9 }],
      connections: [],
      dimensions: [],
      ambiguities: ['eixo não confirmável'],
      missingInformation: ['escala ausente'],
    });
    expect(readiness.status).toBe('blocked');
    expect(readiness.missing).toEqual(expect.arrayContaining(['escala ausente', 'ligações entre componentes', 'revisão humana independente e confirmação da topologia']));
  });
});
