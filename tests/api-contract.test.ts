import { describe, expect, it, vi } from 'vitest';
import { BACKEND_CONTRACT_VERSION, BACKEND_DIAGNOSTICS_SCHEMA, BackendCompatibilityError, IMAGE_PIPELINE_VERSION, IMAGE_RESPONSE_CONTRACT, TECHNICAL_DOCUMENT_SCHEMA_VERSION, TECHNICAL_RECOGNITION_SCHEMA_VERSION, validateBackendDiagnostics, verifyBackendCompatibility } from '../src/api-contract';

const validDiagnostics = () => ({
  schema: BACKEND_DIAGNOSTICS_SCHEMA,
  contractVersion: BACKEND_CONTRACT_VERSION,
  buildId: 'fixture-build-123',
  pipelineVersion: IMAGE_PIPELINE_VERSION,
  responseSchemaVersion: TECHNICAL_DOCUMENT_SCHEMA_VERSION,
  recognitionSchemaVersion: TECHNICAL_RECOGNITION_SCHEMA_VERSION,
  startedAt: '2026-10-31T00:00:00.000Z',
  metaCallBudget: { limit: 2, used: 0, remaining: 2 },
  capabilities: {
    imageAnalysis: { available: true, apiKeyConfigured: true, responseContract: IMAGE_RESPONSE_CONTRACT },
    contextualConversation: { available: true, apiKeyConfigured: true },
    imageRegionVerification: { available: true, apiKeyConfigured: true },
  },
});

describe('backend diagnostics contract', () => {
  it('accepts the current pipeline and rejects stale or incomplete contracts', () => {
    expect(validateBackendDiagnostics(validDiagnostics()).buildId).toBe('fixture-build-123');
    expect(() => validateBackendDiagnostics({ ...validDiagnostics(), responseSchemaVersion: 'technical_document.legacy' })).toThrow(BackendCompatibilityError);
    expect(() => validateBackendDiagnostics({ ...validDiagnostics(), capabilities: { ...validDiagnostics().capabilities, imageAnalysis: { available: true, apiKeyConfigured: false, responseContract: IMAGE_RESPONSE_CONTRACT } } })).toThrow(BackendCompatibilityError);
  });

  it('performs a no-cache identity handshake and rejects old backends before a POST can follow', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ contract: 'unfold.phase4c' }), { status: 200 }));
    await expect(verifyBackendCompatibility(fetchMock)).rejects.toThrow('incompatível');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/diagnostics');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'GET', cache: 'no-store' });
  });
});
