import { describe, expect, it } from 'vitest';
import { applySpatialOperationV2, validateSpatialPlanV2, type SpatialOperationV2, type SpatialPlanV2 } from '../src/universal-spatial/contracts-v2';
import { rawRequest, withGuardedServer, ALLOWED_ORIGIN } from './helpers/paid-routes';

const I = { position: [0, 0, 0], rotationRad: [0, 0, 0], scale: [1, 1, 1] } as const, mat = { profile: 'metal', color: '#777777', roughness: 0.4, metalness: 0.7, clearcoat: 0 } as const;
const shape = (key: string, op: 'box' | 'cylinder' = 'box') => ({ type: 'shape', key, operator: op, parameters: op === 'box' ? { dimensions: [1, 1, 1] } : { radiusTop: 0.2, radiusBottom: 0.2, height: 1, radialSegments: 12 }, transform: I, repeat: null, material: mat }) as const;
const comp = (id: string, x: number, geometry: unknown, origin = 'inferred', parentId: string | null = null) => ({ id, label: id, parentId, geometry, transform: { ...I, position: [x, 0, 0] }, provenance: { geometry: origin, transform: origin, material: origin, evidence: 'fixture' } });
const group = (key: string, children: unknown[]) => ({ type: 'group', key, transform: I, repeat: null, children });
const base = (): SpatialPlanV2 => validateSpatialPlanV2({ contract: 'unfold.spatial-plan.v2', source: { kind: 'text', sha256: 'a'.repeat(64) }, title: 'S', units: 'unitless', presentationProfile: 'neutral',
  components: [comp('base', 0, shape('base-shell')), comp('arm', 1, shape('arm-shell'), 'user_provided'), comp('pin', 2, shape('pin-shell', 'cylinder'), 'observed'), comp('knob', 3, group('knob-grp', [shape('knob-a'), shape('knob-b')]), 'inferred', 'arm')],
  relations: [{ id: 'r1', fromId: 'arm', toId: 'base', kind: 'attached_to', origin: 'inferred', evidence: 'x' }, { id: 'r2', fromId: 'pin', toId: 'arm', kind: 'connected_to', origin: 'user_provided', evidence: 'y' }, { id: 'r3', fromId: 'pin', toId: 'base', kind: 'adjacent_to', origin: 'inferred', evidence: 'z' }],
  constraints: [{ id: 'c1', kind: 'coaxial', componentIds: ['arm', 'pin'], axis: 'y', tolerance: 0.01 }], unknowns: [] });
const op = (kind: SpatialOperationV2['kind'], componentId: string, value: unknown, id = `op-${kind}`): SpatialOperationV2 => ({ contract: 'unfold.spatial-operation.v2', operationId: id, kind, componentId, nodeKey: null, value });
const P = { origin: 'user_provided' as const, evidence: 'test' }, strip = (c: SpatialPlanV2['components'][number]) => JSON.stringify(c);

describe('structural operations in the Spatial Core', () => {
  it('add: the new component carries the operation\'s provenance (never "observed"); every other component is byte-identical', () => {
    const p = base(), next = applySpatialOperationV2(p, op('add-component', 'cap', comp('cap', 4, shape('cap-shell'), 'observed')), { origin: 'inferred', evidence: 'ia propôs' });
    expect(next.components.map((c) => c.id)).toEqual(['base', 'arm', 'pin', 'knob', 'cap']); expect(next.components[4]!.provenance).toMatchObject({ geometry: 'inferred', transform: 'inferred' });
    for (const c of p.components) expect(strip(next.components.find((x) => x.id === c.id)!)).toBe(strip(c));
    expect(() => applySpatialOperationV2(p, op('add-component', 'arm', comp('arm', 0, shape('z'))), P)).toThrow('SPATIAL_V2_STRUCTURE_ID_EXISTS'); expect(() => applySpatialOperationV2(p, op('add-component', 'cap', comp('cap', 0, shape('z'), 'inferred', 'nowhere')), P)).toThrow('SPATIAL_V2_STRUCTURE_PARENT_NOT_FOUND');
  });
  it('remove: relations and constraints that mention it go with it; children are reparented or removed as asked; the last component cannot be removed', () => {
    const p = base(), a = applySpatialOperationV2(p, op('remove-component', 'arm', { children: 'reparent' }), P);
    expect(a.components.map((c) => c.id)).toEqual(['base', 'pin', 'knob']); expect(a.components.find((c) => c.id === 'knob')!.parentId).toBeNull(); expect(a.relations.map((r) => r.id)).toEqual(['r3']); expect(a.constraints).toEqual([]);
    const b = applySpatialOperationV2(p, op('remove-component', 'arm', { children: 'remove' }), P); expect(b.components.map((c) => c.id)).toEqual(['base', 'pin']);
    expect(() => applySpatialOperationV2(p, op('remove-component', 'arm', {}), P)).toThrow('SPATIAL_V2_STRUCTURE_VALUE_INVALID');
    const one = validateSpatialPlanV2({ ...p, components: [p.components[0]!], relations: [], constraints: [] }); expect(() => applySpatialOperationV2(one, op('remove-component', 'base', { children: 'remove' }), P)).toThrow('SPATIAL_V2_STRUCTURE_LAST_COMPONENT');
  });
  it('merge: geometry of the sources joins the target at the right place, references move to the target, provenance is the WEAKEST of the members, unaffected components are untouched', () => {
    const p = base(), next = applySpatialOperationV2(p, op('merge-components', 'base', { sourceIds: ['arm', 'pin'] }), P), merged = next.components.find((c) => c.id === 'base')!;
    expect(next.components.map((c) => c.id)).toEqual(['base', 'knob']); expect(next.components.find((c) => c.id === 'knob')!.parentId).toBe('base');
    expect(merged.geometry.type).toBe('group'); const g = merged.geometry as { children: Array<{ type: string; transform: { position: number[] } }> }; expect(g.children).toHaveLength(3); expect(g.children[1]!.transform.position).toEqual([1, 0, 0]); expect(g.children[2]!.transform.position).toEqual([2, 0, 0]);
    expect(merged.provenance.geometry).toBe('inferred'); // base inferred, arm user_provided, pin observed -> inferred: merging never promotes
    expect(next.relations.map((r) => [r.fromId, r.toId])).toEqual([]); expect(next.constraints).toEqual([]); // every relation was internal to the merged set
    expect(strip(next.components.find((c) => c.id === 'knob')!)).toBe(strip({ ...p.components[3]!, parentId: 'base' }));
  });
  it('merge refuses what it cannot represent (a rotated part under non-uniform scale would shear)', () => {
    const p = base(), skew = validateSpatialPlanV2({ ...p, components: p.components.map((c) => (c.id === 'base' ? { ...c, transform: { ...c.transform, scale: [2, 1, 1] as [number, number, number] } } : c.id === 'arm' ? { ...c, transform: { ...c.transform, rotationRad: [0, 0, 0.7] as [number, number, number] } } : c)) });
    expect(() => applySpatialOperationV2(skew, op('merge-components', 'base', { sourceIds: ['arm'] }), P)).toThrow('SPATIAL_V2_MERGE_TRANSFORM_NOT_REPRESENTABLE');
  });
  it('split: a group\'s direct children become a new component with the same pose; both halves keep ids and a relation records the common origin; a shape cannot be split', () => {
    const p = base(), next = applySpatialOperationV2(p, op('split-component', 'knob', { newId: 'knob-two', label: 'Botão B', childKeys: ['knob-b'] }), P);
    expect(next.components.map((c) => c.id)).toEqual(['base', 'arm', 'pin', 'knob', 'knob-two']); expect(next.components[4]!.transform).toEqual(p.components[3]!.transform); expect(next.relations.at(-1)).toMatchObject({ fromId: 'knob-two', toId: 'knob', kind: 'attached_to' });
    expect(() => applySpatialOperationV2(p, op('split-component', 'base', { newId: 'x', label: 'x', childKeys: ['a'] }), P)).toThrow('SPATIAL_V2_SPLIT_REQUIRES_GROUP'); expect(() => applySpatialOperationV2(p, op('split-component', 'knob', { newId: 'x', label: 'x', childKeys: ['knob-a', 'knob-b'] }), P)).toThrow('SPATIAL_V2_SPLIT_CHILDREN_INVALID');
  });
});

describe('structural operations through the real server transaction (revisions, idempotency, grouped undo)', () => {
  const headers = { 'content-type': 'application/json', origin: ALLOWED_ORIGIN }, post = (port: number, path: string, body: unknown) => rawRequest(port, { path, headers, body });
  it('a merge + split transaction commits as one revision and ONE undo restores the exact previous plan', async () => {
    await withGuardedServer({}, async (port) => {
      const plan = base(), adopted = await post(port, '/api/spatial/v2/adopt', { plan }); expect(adopted.status, adopted.text).toBe(200); const sessionId = adopted.json.sessionId as string;
      const done = await post(port, '/api/spatial/v2/transactions', { contract: 'unfold.spatial-transaction.v2', sessionId, baseRevision: 0, idempotencyKey: 'struct-key-0001', operations: [op('split-component', 'knob', { newId: 'knob-two', label: 'Botão B', childKeys: ['knob-b'] }, 'tx-split'), op('merge-components', 'base', { sourceIds: ['pin'] }, 'tx-merge')], provenance: { origin: 'user_provided', evidence: 'pessoa autorizou' } });
      expect(done.status, done.text).toBe(200); expect(done.json.plan.components.map((c: { id: string }) => c.id)).toEqual(['base', 'arm', 'knob', 'knob-two']);
      const undone = await post(port, '/api/spatial/v2/undo', { sessionId, baseRevision: 1, idempotencyKey: 'undo-struct-0001' }); expect(undone.status, undone.text).toBe(200); expect(undone.json.plan).toEqual(plan);
    });
  });
});
