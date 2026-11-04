import { describe, expect, it } from 'vitest';
import { countingFetch, rawRequest, withGuardedServer, ALLOWED_ORIGIN } from './helpers/paid-routes';

const metaPlan = JSON.stringify({ title: 'Fan', units: 'unitless', entities: [{ id: 'blade', label: 'Blade', parentId: null, geometry: { operator: 'box', parameters: [0.8, 0.1, 0.04] }, repeat: { kind: 'radial', count: 6, axis: 'y', spacingOrRadius: 0.5 }, transform: { position: [0, 0, 0], rotationRad: [0, 0, 0], scale: [1, 1, 1] }, material: { color: '#778899', roughness: 0.5, metalness: 0.1 }, origin: 'design_approximation', evidence: 'Six blades requested.' }], relations: [], unknowns: ['No physical scale supplied.'] });
const headers = { origin: ALLOWED_ORIGIN, 'content-type': 'application/json' };

describe('universal spatial API sessions', () => {
  it('creates a source-hashed plan, applies a local operation, labels caller identity unverified, rejects stale revisions, and undoes', async () => {
    await withGuardedServer({ fetchImpl: countingFetch(metaPlan) }, async (port) => {
      const created = await rawRequest(port, { path: '/api/spatial/plan', headers, body: { sourceKind: 'text', instruction: 'Create a six blade fan.' } });
      expect(created.status).toBe(200);
      expect(created.json.plan.source).toMatchObject({ kind: 'text', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
      const sessionId = created.json.sessionId as string;
      const operation = { contract: 'unfold.spatial-operation.v1', operationId: 'set-eight', kind: 'set-repeat', entityId: 'blade', value: { kind: 'radial', count: 8, axis: 'y', spacingOrRadius: 0.5 } };
      const applied = await rawRequest(port, { path: '/api/spatial/operation', headers, body: { sessionId, baseRevision: 0, operation } });
      expect(applied.status).toBe(200);
      expect(applied.json.plan.entities[0].repeat.count).toBe(8);
      expect(applied.json.review).toMatchObject({ actorEvidence: 'client_asserted_unverified', authenticatedReviewer: false });
      const stale = await rawRequest(port, { path: '/api/spatial/operation', headers, body: { sessionId, baseRevision: 0, operation } });
      expect(stale.status).toBe(409);
      expect(stale.json.error.code).toBe('SPATIAL_REVISION_CONFLICT');
      const undone = await rawRequest(port, { path: '/api/spatial/undo', headers, body: { sessionId, baseRevision: 1 } });
      expect(undone.status).toBe(200);
      expect(undone.json.plan.entities[0].repeat.count).toBe(6);
      expect(undone.json.revision).toBe(2);
    });
  });

  it('rejects edits without a valid session and never fabricates a reviewer identity', async () => {
    await withGuardedServer({ apiKey: '', fetchImpl: countingFetch(metaPlan) }, async (port) => {
      const reply = await rawRequest(port, { path: '/api/spatial/operation', headers, body: { sessionId: 'missing', baseRevision: 0, operation: {} } });
      expect(reply.status).toBe(404);
      expect(reply.json.error.code).toBe('SPATIAL_SESSION_NOT_FOUND');
    });
  });

  it('rate-limits spatial plan requests before Meta and rejects untrusted origins on local mutation routes', async () => {
    const upstream = countingFetch(metaPlan);
    await withGuardedServer({ fetchImpl: upstream }, async (port) => {
      for (let i = 0; i < 20; i++) {
        const reply = await rawRequest(port, { path: '/api/spatial/plan', headers, body: { sourceKind: 'invalid' } });
        expect(reply.status).toBe(400);
      }
      const limited = await rawRequest(port, { path: '/api/spatial/plan', headers, body: { sourceKind: 'invalid' } });
      expect(limited.status).toBe(429);
      expect(limited.json.error.code).toBe('RATE_LIMITED');
      const rejectedOrigin = await rawRequest(port, { path: '/api/spatial/operation', headers: { origin: 'http://outside.example', 'content-type': 'application/json' }, body: { sessionId: 'missing', baseRevision: 0, operation: {} } });
      expect(rejectedOrigin.status).toBe(403);
      expect(upstream).toHaveBeenCalledTimes(0);
    });
  });
});
