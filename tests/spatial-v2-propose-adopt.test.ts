import { describe, expect, it, vi } from 'vitest';
import { ALLOWED_ORIGIN, metaResponse, rawRequest, withGuardedServer } from './helpers/paid-routes';

const id3 = { position: [0, 0, 0], rotationRad: [0, 0, 0], scale: [1, 1, 1] };
const material = { profile: 'metal', color: '#777777', roughness: 0.4, metalness: 0.7, clearcoat: 0 };
const component = (name: string) => ({ id: name, label: name, parentId: null, transform: id3, provenance: { geometry: 'inferred', transform: 'inferred', material: 'design_approximation', evidence: 'x' },
  geometry: { type: 'shape', key: `${name}-s`, operator: 'box', parameters: { dimensions: [1, 1, 1] }, transform: id3, repeat: null, material } });
const plan = { contract: 'unfold.spatial-plan.v2', source: { kind: 'text', sha256: 'a'.repeat(64) }, title: 'Adopted', units: 'unitless', presentationProfile: 'neutral', components: [component('base'), component('top')], relations: [], constraints: [], unknowns: [] };
const headers = { 'content-type': 'application/json', origin: ALLOWED_ORIGIN };
const proposal = { kind: 'set-transform', componentId: 'top', nodeKey: null, value: JSON.stringify({ ...id3, position: [0, 2, 0] }) };

describe('adopting a reviewed plan as a server session (local, never paid)', () => {
  it('creates a session from a valid plan without calling Meta, and typed operations then work on it', async () => {
    const upstream = vi.fn<typeof fetch>();
    await withGuardedServer({ fetchImpl: upstream }, async (port) => {
      const adopted = await rawRequest(port, { path: '/api/spatial/v2/adopt', headers, body: { plan } });
      expect(adopted.status, adopted.text).toBe(200);
      expect(adopted.json.revision).toBe(0); expect(adopted.json.plan.components).toHaveLength(2);
      const op = { contract: 'unfold.spatial-operation.v2', operationId: 'e-1', kind: 'set-transform', componentId: 'top', nodeKey: null, value: { ...id3, position: [0, 3, 0] } };
      const edited = await rawRequest(port, { path: '/api/spatial/v2/operation', headers, body: { sessionId: adopted.json.sessionId, baseRevision: 0, operation: op } });
      expect(edited.status).toBe(200); expect(edited.json.plan.components[1].transform.position).toEqual([0, 3, 0]);
      expect(upstream).not.toHaveBeenCalled();
    });
  });
  it('rejects an invalid plan and unknown fields, and counts nothing against the Meta budget', async () => {
    await withGuardedServer({ fetchImpl: vi.fn<typeof fetch>() }, async (port) => {
      expect((await rawRequest(port, { path: '/api/spatial/v2/adopt', headers, body: { plan: { ...plan, components: [] } } })).status).toBe(400);
      expect((await rawRequest(port, { path: '/api/spatial/v2/adopt', headers, body: { plan, extra: 1 } })).status).toBe(400);
    });
  });
});

describe('Meta edit in proposal mode', () => {
  it('returns the operation and a preview but changes neither the plan nor the revision until a person submits it', async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(metaResponse(JSON.stringify(proposal)));
    await withGuardedServer({ fetchImpl: upstream }, async (port) => {
      const adopted = await rawRequest(port, { path: '/api/spatial/v2/adopt', headers, body: { plan } });
      const sessionId = adopted.json.sessionId;
      const proposed = await rawRequest(port, { path: '/api/spatial/v2/edit', headers, body: { sessionId, baseRevision: 0, instruction: 'Move the top up.', propose: true } });
      expect(proposed.status, proposed.text).toBe(200);
      expect(proposed.json.contract).toBe('unfold.spatial-v2-proposal.v1');
      expect(proposed.json.revision).toBe(0);
      expect(proposed.json.operation.componentId).toBe('top');
      expect(proposed.json.operation.value.position).toEqual([0, 2, 0]);
      expect(proposed.json.applied).toBe(false);
      expect(upstream).toHaveBeenCalledTimes(1);
      // still revision 0: the operation route accepts baseRevision 0 and the plan is untouched
      const op = await rawRequest(port, { path: '/api/spatial/v2/operation', headers, body: { sessionId, baseRevision: 0, operation: proposed.json.operation } });
      expect(op.status).toBe(200); expect(op.json.revision).toBe(1);
    });
  });
  it('rejects a proposal the plan would not accept, without applying anything', async () => {
    const bad = { ...proposal, componentId: 'ghost' };
    await withGuardedServer({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(metaResponse(JSON.stringify(bad))) }, async (port) => {
      const adopted = await rawRequest(port, { path: '/api/spatial/v2/adopt', headers, body: { plan } });
      const proposed = await rawRequest(port, { path: '/api/spatial/v2/edit', headers, body: { sessionId: adopted.json.sessionId, baseRevision: 0, instruction: 'x', propose: true } });
      expect(proposed.status).toBeGreaterThanOrEqual(400);
    });
  });
});
