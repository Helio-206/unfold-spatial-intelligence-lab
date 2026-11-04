import { describe, expect, it } from 'vitest';
import { applySpatialOperation, validateSpatialPlan, type SpatialPlan } from '../src/universal-spatial/contracts';
import { disposeSpatialPlan, spatialPlanToThree } from '../src/universal-spatial/three-adapter';
import { createSpatialPlan, SpatialApiError } from '../src/universal-spatial/api-client';

const source = { kind: 'text' as const, sha256: 'a'.repeat(64) };
const entity = (id: string, parentId: string | null, count = 1) => ({ id, label: id, parentId, geometry: { operator: 'box' as const, parameters: [0.2, 0.1, 0.03] }, repeat: count > 1 ? { kind: 'radial' as const, count, axis: 'y' as const, spacingOrRadius: 0.4 } : null, transform: { position: [0, 0, 0] as [number, number, number], rotationRad: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] }, material: { color: '#8899aa', roughness: 0.6, metalness: 0.1 }, origin: 'design_approximation' as const, evidence: 'Proporção conceptual para teste.' });
const plan = (count = 6): SpatialPlan => validateSpatialPlan({ contract: 'unfold.spatial-plan.v1', source, title: 'Fan assembly', units: 'unitless', entities: [entity('hub', null), entity('blade', 'hub', count)], relations: [{ id: 'blade-attached', fromId: 'hub', toId: 'blade', kind: 'attached_to', origin: 'design_approximation', evidence: 'Composition in the plan.' }], unknowns: ['No physical scale.'] });

describe('unfold.spatial-plan.v1', () => {
  it('validates a hierarchical plan and creates real repeated Three.js meshes', () => {
    const sixBlades = spatialPlanToThree(plan(6));
    const eightBlades = spatialPlanToThree(plan(8));
    const meshCount = (root: typeof sixBlades) => { let count = 0; root.traverse((item) => { if ('isMesh' in item && item.isMesh) count += 1; }); return count; };
    expect(meshCount(sixBlades)).toBe(7);
    expect(meshCount(eightBlades)).toBe(9);
    expect(eightBlades.getObjectByName('blade')?.children).toHaveLength(8);
    disposeSpatialPlan(sixBlades); disposeSpatialPlan(eightBlades);
  });

  it('rejects non-finite parameters, missing parents, cycles, invalid repeats and unknown fields', () => {
    const current = plan();
    expect(() => validateSpatialPlan({ ...current, entities: current.entities.map((item) => item.id === 'blade' ? { ...item, geometry: { ...item.geometry, parameters: [Number.NaN, 1, 1] } } : item) })).toThrow('PLAN_INVALID_ENTITY');
    expect(() => validateSpatialPlan({ ...current, entities: current.entities.map((item) => item.id === 'blade' ? { ...item, parentId: 'missing' } : item) })).toThrow('PLAN_INVALID_PARENT');
    expect(() => validateSpatialPlan({ ...current, entities: current.entities.map((item) => ({ ...item, parentId: item.id === 'hub' ? 'blade' : 'hub' })) })).toThrow('PLAN_PARENT_CYCLE');
    expect(() => validateSpatialPlan({ ...current, entities: current.entities.map((item) => item.id === 'blade' ? { ...item, repeat: { kind: 'radial', count: 1000, axis: 'y', spacingOrRadius: 1 } } : item) })).toThrow('PLAN_INVALID_ENTITY');
    expect(() => validateSpatialPlan({ ...current, arbitraryCode: 'console.log(1)' })).toThrow('PLAN_INVALID_FIELDS');
  });

  it('enforces hierarchy depth and aggregate rendered-mesh budgets', () => {
    const chain = Array.from({ length: 18 }, (_, i) => entity(`part-${i}`, i === 0 ? null : `part-${i - 1}`));
    expect(() => validateSpatialPlan({ contract: 'unfold.spatial-plan.v1', source, title: 'Too deep', units: 'unitless', entities: chain, relations: [], unknowns: [] })).toThrow('PLAN_HIERARCHY_TOO_DEEP');
    const repeated = Array.from({ length: 16 }, (_, i) => entity(`repeat-${i}`, null, 64));
    expect(() => validateSpatialPlan({ contract: 'unfold.spatial-plan.v1', source, title: 'Too many meshes', units: 'unitless', entities: repeated, relations: [], unknowns: [] })).toThrow('PLAN_MESH_BUDGET_EXCEEDED');
  });

  it('applies a localized edit with stable IDs and explicit user provenance, then blocks unknown operations', () => {
    const before = plan();
    const after = applySpatialOperation(before, { contract: 'unfold.spatial-operation.v1', operationId: 'eight-blades', kind: 'set-repeat', entityId: 'blade', value: { kind: 'radial', count: 8, axis: 'y', spacingOrRadius: 0.4 } });
    expect(after.entities.map((item) => item.id)).toEqual(before.entities.map((item) => item.id));
    expect(after.entities[1]).toMatchObject({ origin: 'user_provided', repeat: { count: 8 } });
    const proposed = applySpatialOperation(before, { contract: 'unfold.spatial-operation.v1', operationId: 'model-eight', kind: 'set-repeat', entityId: 'blade', value: { kind: 'radial', count: 8, axis: 'y', spacingOrRadius: 0.4 } }, { origin: 'inferred', evidence: 'Muse Spark operation proposal; not human-confirmed.' });
    expect(proposed.entities[1]).toMatchObject({ origin: 'inferred', evidence: 'Muse Spark operation proposal; not human-confirmed.' });
    expect(() => applySpatialOperation(before, { contract: 'unfold.spatial-operation.v1', operationId: 'bad', kind: 'execute-code' as never, entityId: 'blade', value: 'x' })).toThrow('OPERATION_KIND_NOT_ALLOWED');
  });

  it('exposes a browser-safe client that validates replies and preserves structured API errors', async () => {
    const valid = plan();
    const client = createSpatialPlan({ sourceKind: 'text', instruction: 'A tower' }, async (_input, init) => {
      expect(init?.method).toBe('POST');
      return new Response(JSON.stringify({ contract: 'unfold.spatial-plan.v1', sessionId: 'session', revision: 0, plan: valid, sceneSummary: { entityCount: 2, operators: ['box'], provenanceCounts: { design_approximation: 2 } }, constructionEvents: [], meta: {}, limitations: [] }), { status: 200 });
    });
    await expect(client).resolves.toMatchObject({ sessionId: 'session', plan: { contract: 'unfold.spatial-plan.v1' } });
    await expect(createSpatialPlan({ sourceKind: 'text', instruction: 'A tower' }, async () => new Response(JSON.stringify({ error: { code: 'SPATIAL_PLAN_INVALID', message: 'Invalid plan.' } }), { status: 502 }))).rejects.toMatchObject<Partial<SpatialApiError>>({ status: 502, code: 'SPATIAL_PLAN_INVALID' });
  });
});
