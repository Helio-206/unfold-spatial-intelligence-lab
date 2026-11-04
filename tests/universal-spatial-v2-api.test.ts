import { describe, expect, it, vi } from 'vitest';
import { rawRequest, withGuardedServer, ALLOWED_ORIGIN, metaResponse } from './helpers/paid-routes';
import { buildSpatialEvaluationV2Prompt, parseSpatialEvaluationV2 } from '../src/universal-spatial/evaluation-v2';
import { validateSpatialPlanV2 } from '../src/universal-spatial/contracts-v2';

const identity = { position: [0, 0, 0], rotationRad: [0, 0, 0], scale: [1, 1, 1] };
const material = { profile: 'metal', color: '#777777', roughness: 0.4, metalness: 0.7, clearcoat: 0 };
const plan = { title: 'Concept fan', units: 'unitless', presentationProfile: 'industrial', components: [{ id: 'hub', label: 'Hub', parentId: null, geometry: { type: 'shape', key: 'hub-shell', operator: 'cylinder', parameters: { radiusTop: 0.4, radiusBottom: 0.4, height: 0.2, radialSegments: 16 }, transform: identity, repeat: null, material }, transform: identity, provenance: { geometry: 'inferred', transform: 'inferred', material: 'inferred', evidence: 'Conceptual plan from text.' } }], relations: [], constraints: [], unknowns: ['Physical scale is unknown.'] };
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p6sAAAAASUVORK5CYII=';
const headers = { 'content-type': 'application/json', origin: ALLOWED_ORIGIN };

describe('universal spatial V2 HTTP pipeline', () => {
  it('keeps the visual-evaluation image prompt within Meta image-call limits for full plans', () => {
    const validPlan = validateSpatialPlanV2({ ...plan, contract: 'unfold.spatial-plan.v2', source: { kind: 'text', sha256: 'a'.repeat(64) } });
    const expandedPlan = { ...validPlan, components: Array.from({ length: 20 }, (_, index) => ({ ...validPlan.components[0]!, id: `component-${index}`, label: `Component ${index}` })) };
    expect(buildSpatialEvaluationV2Prompt('A'.repeat(10_000), expandedPlan).length).toBeLessThan(8_000);
  });

  it('creates a bounded live-plan-shaped session, applies typed edits, detects stale revisions, and undoes', async () => {
    const upstream = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const name = request.text?.format?.name;
      const output = name === 'unfold_spatial_plan_v2' ? { ...plan, constraints: [{ id: 'bad-alignment', kind: 'aligned', componentIds: ['hub', 'hub'], axis: null, tolerance: 0.1 }] } : { kind: 'set-transform', componentId: 'hub', nodeKey: null, value: JSON.stringify({ position: [0.25, 0, 0], rotationRad: [0, 0, 0], scale: [1, 1, 1] }) };
      return metaResponse(JSON.stringify(output));
    });
    await withGuardedServer({ fetchImpl: upstream }, async (port) => {
      const created = await rawRequest(port, { path: '/api/spatial/v2/plan', headers, body: { sourceKind: 'text', instruction: 'Create a small fan.' } });
      expect(created.status, created.text).toBe(200);
      expect(created.json.plan.contract).toBe('unfold.spatial-plan.v2');
      expect(created.json.plan.source.kind).toBe('text');
      expect(created.json.sceneSummary.operators).toContain('cylinder');
      expect(created.json.plan.unknowns).toContain('Physical scale is unknown.');
      expect(created.json.plan.constraints).toEqual([]);
      expect(created.json.plan.unknowns).toContain('Invalid Meta constraint proposals were omitted; no unvalidated constraints were applied.');
      const sessionId = created.json.sessionId;
      const operation = { contract: 'unfold.spatial-operation.v2', operationId: 'move-hub-1', kind: 'set-transform', componentId: 'hub', nodeKey: null, value: { ...identity, position: [0.25, 0, 0] } };
      const edited = await rawRequest(port, { path: '/api/spatial/v2/operation', headers, body: { sessionId, baseRevision: 0, operation } });
      expect(edited.status).toBe(200);
      expect(edited.json.revision).toBe(1);
      expect(edited.json.plan.components[0].transform.position).toEqual([0.25, 0, 0]);
      expect(edited.json.review.authenticatedReviewer).toBe(false);
      expect(edited.json.plan.components[0].provenance.transform).toBe('user_provided');
      const stale = await rawRequest(port, { path: '/api/spatial/v2/undo', headers, body: { sessionId, baseRevision: 0 } });
      expect(stale.status).toBe(409);
      const undone = await rawRequest(port, { path: '/api/spatial/v2/undo', headers, body: { sessionId, baseRevision: 1 } });
      expect(undone.status).toBe(200);
      expect(undone.json.revision).toBe(2);
      expect(undone.json.plan.components[0].transform.position).toEqual([0, 0, 0]);
      expect(upstream).toHaveBeenCalledTimes(1);
    });
  });

  it('repairs invalid shape parameters field by field instead of swapping in a generic shape, with one mocked Meta call', async () => {
    const broken = { ...plan, components: [{ ...plan.components[0]!, geometry: { ...plan.components[0]!.geometry, parameters: { radius: 0.4, height: 6, capped: true } } }] };
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(metaResponse(JSON.stringify(broken)));
    await withGuardedServer({ fetchImpl: upstream }, async (port) => {
      const created = await rawRequest(port, { path: '/api/spatial/v2/plan', headers, body: { sourceKind: 'text', instruction: 'Create a tall thin post.' } });
      expect(created.status, created.text).toBe(200);
      const component = created.json.plan.components[0];
      expect(component.geometry.parameters).toMatchObject({ radiusTop: 0.4, radiusBottom: 0.4, height: 6 });
      expect(component.provenance.geometry).toBe('design_approximation');
      expect(component.provenance.evidence).toMatch(/Parameter repair/);
      expect(created.json.plan.unknowns.join(' ')).toMatch(/hub-shell/);
      expect(upstream).toHaveBeenCalledTimes(1);
    });
  });

  it('reads the abbreviated transform keys t/r/s a real model used, instead of stacking every part at the origin', async () => {
    const abbreviated = { ...plan, components: [{ ...plan.components[0]!, transform: JSON.stringify({ t: [0, 3.1, 0], r: [0, 0, 0], s: [1, 1, 1] }), geometry: { ...plan.components[0]!.geometry, transform: JSON.stringify({ t: [0.5, 0, 0], r: [0, 0, 0], s: [1, 1, 1] }) } }] };
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(metaResponse(JSON.stringify(abbreviated)));
    await withGuardedServer({ fetchImpl: upstream }, async (port) => {
      const created = await rawRequest(port, { path: '/api/spatial/v2/plan', headers, body: { sourceKind: 'text', instruction: 'Create a small fan.' } });
      expect(created.status, created.text).toBe(200);
      expect(created.json.plan.components[0].transform.position).toEqual([0, 3.1, 0]);
      expect(created.json.plan.components[0].geometry.transform.position).toEqual([0.5, 0, 0]);
      expect(created.json.plan.unknowns.join(' ')).not.toMatch(/identity transform defaulted position/);
    });
  });

  it('rejects oversized or malformed image inputs before Meta and rejects incomplete request objects', async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(metaResponse(JSON.stringify(plan)));
    await withGuardedServer({ fetchImpl: upstream }, async (port) => {
      const missing = await rawRequest(port, { path: '/api/spatial/v2/plan', headers, body: { sourceKind: 'text', instruction: 'x', injected: true } });
      expect(missing.status).toBe(400);
      const invalid = await rawRequest(port, { path: '/api/spatial/v2/plan', headers, body: { sourceKind: 'image', imageDataUrl: 'data:image/png;base64,AA==' } });
      expect(invalid.status).toBe(400);
      expect(upstream).not.toHaveBeenCalled();
      const unscaled = await rawRequest(port, { path: '/api/spatial/v2/plan', headers, body: { sourceKind: 'image', imageDataUrl: png } });
      expect(unscaled.status).toBe(200);
      expect(unscaled.json.plan.units).toBe('unitless');
      expect(unscaled.json.plan.unknowns).toContain('Physical dimensions and absolute scale are unknown because no known reference was supplied.');
    });
  });

  it('returns a fallible visual-evaluation hypothesis without applying an operation', async () => {
    const upstream = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const name = request.text?.format?.name;
      return metaResponse(JSON.stringify(name === 'unfold_spatial_plan_v2' ? plan : { recognizabilityScore: 60, silhouetteScore: 55, spatialIntegrityScore: 70, confidence: 0.5, discrepancies: [{ componentId: '', kind: 'silhouette', severity: 'medium', observation: 'The plan is visually sparse.' }], suggestedOperation: 'null', rationale: 'A bounded conceptual scene is visible, but its silhouette is incomplete.' }));
    });
    await withGuardedServer({ fetchImpl: upstream }, async (port) => {
      const created = await rawRequest(port, { path: '/api/spatial/v2/plan', headers, body: { sourceKind: 'text', instruction: 'Create a conceptual fan.' } });
      const evaluated = await rawRequest(port, { path: '/api/spatial/v2/evaluate', headers, body: { sessionId: created.json.sessionId, baseRevision: 0, imageDataUrl: png } });
      expect(evaluated.status).toBe(200);
      expect(evaluated.json.evaluation.contract).toBe('unfold.spatial-evaluation.v1');
      expect(parseSpatialEvaluationV2(evaluated.json.evaluation, created.json.plan).contract).toBe('unfold.spatial-evaluation.v1');
      expect(evaluated.json.evaluation.discrepancies[0].componentId).toBeNull();
      expect(evaluated.json.suggestionStatus).toBe('none');
      expect(evaluated.json.revision).toBe(0);
      expect(upstream).toHaveBeenCalledTimes(2);
    });
  });
});
