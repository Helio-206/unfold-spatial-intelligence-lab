import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ALLOWED_ORIGIN, metaResponse, rawRequest, withGuardedServer } from './helpers/paid-routes';

const material = { profile: 'metal', color: '#777777', roughness: 0.4, metalness: 0.7, clearcoat: 0 };
const identity = { position: [0, 0, 0], rotationRad: [0, 0, 0], scale: [1, 1, 1] };
const plan = {
  title: 'Concept fan', units: 'unitless', presentationProfile: 'industrial', constraints: [], unknowns: ['Physical scale is unknown.'],
  components: [{ id: 'hub', label: 'Hub', parentId: null, transform: identity, geometry: { type: 'shape', key: 'hub-shell', operator: 'cylinder', parameters: { radiusTop: 0.4, radiusBottom: 0.4, height: 0.3, capped: true }, transform: identity, repeat: null, material },
    provenance: { geometry: 'inferred', transform: 'inferred', material: 'design_approximation', evidence: 'test' } }],
  relations: [],
};
const headers = { 'content-type': 'application/json', origin: ALLOWED_ORIGIN };

describe('spatial run evidence (raw Meta response kept server-side)', () => {
  it('stores nothing unless evidence is enabled', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'spatial-evidence-off-'));
    try {
      await withGuardedServer({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(metaResponse(JSON.stringify(plan))), upstreamEvidence: { enabled: false, directory } }, async (port) => {
        const created = await rawRequest(port, { path: '/api/spatial/v2/plan', headers, body: { sourceKind: 'text', instruction: 'A fan.' } });
        expect(created.status, created.text).toBe(200);
        expect(created.json.meta.rawResponseSha256).toMatch(/^[0-9a-f]{64}$/);
        expect(created.json.meta.rawResponseStored).toBe(false);
      });
      expect(readdirSync(directory)).toEqual([]);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('keeps the exact raw text, the normalised plan and no secret when enabled, with owner-only permissions', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'spatial-evidence-on-'));
    const rawText = JSON.stringify(plan);
    try {
      await withGuardedServer({ apiKey: 'sk-test-secret-value', fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(metaResponse(rawText)), upstreamEvidence: { enabled: true, directory } }, async (port) => {
        const created = await rawRequest(port, { path: '/api/spatial/v2/plan', headers, body: { sourceKind: 'text', instruction: 'A fan.' } });
        expect(created.status, created.text).toBe(200);
        expect(created.json.meta.rawResponseStored).toBe(true);
      });
      const files = readdirSync(directory).filter((name) => name.startsWith('spatial-run-'));
      expect(files).toHaveLength(1);
      const path = join(directory, files[0]!), text = readFileSync(path, 'utf8'), record = JSON.parse(text);
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(record.schema).toBe('unfold_spatial_run_evidence.v1');
      expect(record.rawResponseText).toBe(rawText);
      expect(record.normalizedPlan.contract).toBe('unfold.spatial-plan.v2');
      expect(record.source.kind).toBe('text');
      expect(text).not.toContain('sk-test-secret-value');
      expect(text.toLowerCase()).not.toContain('authorization');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});

describe('spatial run evidence for a failed upstream call', () => {
  it('records the failure class, usage and the incomplete reason, and tells the client why', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'spatial-evidence-fail-'));
    const incomplete = new Response(JSON.stringify({ id: 'resp-1', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output_text: '{"title":"cut off', usage: { input_tokens: 900, output_tokens: 6000, total_tokens: 6900 } }), { status: 200, headers: { 'x-request-id': 'req-incomplete' } });
    try {
      await withGuardedServer({ apiKey: 'sk-test-secret-value', fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(incomplete), upstreamEvidence: { enabled: true, directory } }, async (port) => {
        const failed = await rawRequest(port, { path: '/api/spatial/v2/plan', headers, body: { sourceKind: 'text', instruction: 'A very large cathedral.' } });
        expect(failed.status).toBe(502);
        expect(failed.json.error.code).toBe('SPATIAL_V2_META_INCOMPLETE');
        expect(failed.json.meta.incompleteReason).toBe('max_output_tokens');
      });
      const files = readdirSync(directory).filter((name) => name.startsWith('spatial-run-'));
      expect(files).toHaveLength(1);
      const text = readFileSync(join(directory, files[0]!), 'utf8'), record = JSON.parse(text);
      expect(record.outcome).toBe('failed');
      expect(record.code).toBe('SPATIAL_V2_META_INCOMPLETE');
      expect(record.meta.incompleteReason).toBe('max_output_tokens');
      expect(text).not.toContain('sk-test-secret-value');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});

describe('spatial plan output budget', () => {
  it('leaves room for the plan after the model has reasoned (a 6000-token cap truncated a real clock plan at 3652 reasoning tokens)', async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(metaResponse(JSON.stringify(plan)));
    await withGuardedServer({ fetchImpl: upstream }, async (port) => {
      const created = await rawRequest(port, { path: '/api/spatial/v2/plan', headers, body: { sourceKind: 'text', instruction: 'A grandfather clock.' } });
      expect(created.status, created.text).toBe(200);
    });
    const body = JSON.parse(String(upstream.mock.calls[0]![1]?.body));
    expect(body.max_output_tokens).toBeGreaterThanOrEqual(12_000);
    expect(body.reasoning.effort).toBe('low');
  });
});
