import { describe, expect, it } from 'vitest';
import { Box3, InstancedMesh, Mesh } from 'three';
import { evaluateSpatialConstraintsV2 } from '../src/universal-spatial/constraints-v2';
import { SPATIAL_PLAN_V2_CONTRACT, spatialPlanV1ToV2, validateSpatialPlanV2, type GeometryNodeV2, type MaterialV2, type SpatialPlanV2 } from '../src/universal-spatial/contracts-v2';
import { compileSpatialPlanV2, disposeCompiledSpatialPlan } from '../src/universal-spatial/geometry-compiler-v2';
import { validateSpatialPlan } from '../src/universal-spatial/contracts';

const source = { kind: 'text' as const, sha256: 'a'.repeat(64) };
const identity = { position: [0, 0, 0] as [number, number, number], rotationRad: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] };
const metal: MaterialV2 = { profile: 'industrial', color: '#49525d', roughness: 0.35, metalness: 0.5, clearcoat: 0.3 };
const component = (id: string, geometry: GeometryNodeV2, parentId: string | null = null) => ({ id, label: id, parentId, geometry, transform: structuredClone(identity), provenance: { geometry: 'design_approximation' as const, transform: 'design_approximation' as const, material: 'design_approximation' as const, evidence: 'Conceptual test geometry; no physical scale.' } });
const shape = (key: string, operator: Extract<GeometryNodeV2, { type: 'shape' }>['operator'], parameters: Record<string, unknown>, material = metal, repeat: Extract<GeometryNodeV2, { type: 'shape' }>['repeat'] = null): GeometryNodeV2 => ({ type: 'shape', key, operator, parameters, material, repeat, transform: structuredClone(identity) });
const basePlan = (): SpatialPlanV2 => validateSpatialPlanV2({
  contract: SPATIAL_PLAN_V2_CONTRACT, source, title: 'Radial assembly', units: 'unitless', presentationProfile: 'industrial',
  components: [
    component('hub', shape('hub-shell', 'cylinder', { radiusTop: 0.35, radiusBottom: 0.35, height: 0.2, radialSegments: 48 })),
    component('blade-set', shape('blade-shell', 'loft', { profile: [[0, -0.07], [1, -0.04], [1, 0.04], [0, 0.07]], sections: [[0, 1, 1], [0.9, 0.56, 0.66]], capEnds: [true, true] }, metal, { kind: 'radial', count: 6, axis: 'y', spacingOrRadius: 0.28 }), 'hub'),
  ],
  relations: [{ id: 'blade-attach', fromId: 'hub', toId: 'blade-set', kind: 'attached_to', origin: 'inferred', evidence: 'Radial subparts are declared as a pattern.' }],
  constraints: [{ id: 'blade-distribution', kind: 'distributed_around', componentIds: ['hub', 'blade-set'], axis: 'y', tolerance: 0.01 }], unknowns: ['No physical scale.'],
});

describe('unfold.spatial-plan.v2 contract and geometry compiler', () => {
  it('compiles a nested, profiled, radial assembly into selectable Three.js geometry with instancing', () => {
    const plan = basePlan();
    const { root, stats } = compileSpatialPlanV2(plan);
    const instance = root.getObjectByName('blade-shell');
    expect(instance).toBeInstanceOf(InstancedMesh);
    expect((instance as InstancedMesh).count).toBe(6);
    expect(instance?.userData.spatialEntityId).toBe('blade-set');
    expect(stats).toMatchObject({ componentCount: 2, meshCount: 2 });
    expect(stats.triangleCount).toBeGreaterThan(100);
    expect(evaluateSpatialConstraintsV2(plan, root)).toMatchObject({ ready: true, violatedIds: [] });
    disposeCompiledSpatialPlan(root);
  });

  it('compiles all validated operators and checks finite vertices, bounds, normals, and resource release', () => {
    const operators: GeometryNodeV2[] = [
      shape('box', 'box', { dimensions: [1, 0.5, 0.4] }),
      shape('rounded', 'rounded_box', { dimensions: [0.7, 0.5, 0.4], bevelM: 0.04, segments: 3 }),
      shape('sphere', 'sphere', { radius: 0.25, widthSegments: 24, heightSegments: 16 }),
      shape('ellipsoid', 'ellipsoid', { radii: [0.2, 0.4, 0.3], widthSegments: 24, heightSegments: 16 }),
      shape('cylinder', 'cylinder', { radiusTop: 0.2, radiusBottom: 0.3, height: 0.7, radialSegments: 32 }),
      shape('cone', 'cone', { radius: 0.3, height: 0.6, radialSegments: 32 }),
      shape('torus', 'torus', { majorRadius: 0.35, tubeRadius: 0.08, radialSegments: 16, tubularSegments: 48 }),
      shape('extrude', 'extrude', { profile: [[0, 0], [0.8, 0], [0.6, 0.4], [0, 0.3]], depth: 0.12, bevelM: 0.01, curveSegments: 8 }),
      shape('tube', 'tube', { points: [[0, 0, 0], [0.3, 0.4, 0.2], [0.7, 0.2, 0.5]], radius: 0.025, tubularSegments: 32, radialSegments: 10 }),
      shape('revolve', 'revolve', { profile: [[0.08, -0.4], [0.25, -0.3], [0.3, 0.3], [0.2, 0.4]], segments: 48 }),
      shape('loft', 'loft', { profile: [[-0.4, -0.3], [0.4, -0.3], [0.3, 0.3], [-0.3, 0.3]], sections: [[-0.4, 1, 1], [0.4, 0.6, 0.8]], capEnds: [true, true] }),
    ];
    const plan = validateSpatialPlanV2({ source, title: 'Operator coverage', units: 'unitless', presentationProfile: 'neutral', components: operators.map((geometry) => component(`part-${geometry.key}`, geometry)), relations: [], constraints: [], unknowns: [] });
    const { root, stats } = compileSpatialPlanV2(plan);
    let meshCount = 0;
    root.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      meshCount++;
      const position = object.geometry.getAttribute('position');
      expect([...position.array]).toEqual(expect.arrayContaining([expect.any(Number)]));
      expect([...position.array].every(Number.isFinite)).toBe(true);
      const box = new Box3().setFromObject(object);
      expect([...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite)).toBe(true);
      expect(object.geometry.getAttribute('normal')).toBeDefined();
      object.geometry.addEventListener('dispose', () => { object.userData.geometryDisposed = true; });
    });
    expect(meshCount).toBe(operators.length);
    expect(stats.geometryBytes).toBeGreaterThan(0);
    disposeCompiledSpatialPlan(root);
    root.traverse((object) => { if (object instanceof Mesh) expect(object.userData.geometryDisposed).toBe(true); });
  });

  it('rejects unsafe fields, self-intersecting profiles, excessive geometry and inconsistent constraint cardinality', () => {
    const plan = basePlan();
    expect(() => validateSpatialPlanV2({ ...plan, executable: 'throw new Error()' })).toThrow('SPATIAL_V2_PLAN_INVALID_FIELDS');
    expect(() => validateSpatialPlanV2({ ...plan, components: plan.components.map((part) => part.id === 'blade-set' ? { ...part, geometry: shape('bad-profile', 'extrude', { profile: [[0, 0], [1, 1], [0, 1], [1, 0]], depth: 0.2, bevelM: 0, curveSegments: 4 }) } : part) })).toThrow('SPATIAL_V2_PARAMETERS_INVALID');
    expect(() => validateSpatialPlanV2({ ...plan, constraints: [{ id: 'bad-distribution', kind: 'distributed_around', componentIds: ['hub'], axis: 'y', tolerance: 0.01 }] })).toThrow('SPATIAL_V2_CONSTRAINT_SHAPE_INVALID');
    const manyShapes = Array.from({ length: 64 }, (_, i) => shape(`shape-${i}`, 'sphere', { radius: 0.1, widthSegments: 128, heightSegments: 64 }));
    const huge = component('huge', { type: 'group', key: 'many', transform: structuredClone(identity), repeat: null, children: manyShapes });
    expect(() => validateSpatialPlanV2({ ...plan, components: [huge] })).toThrow('SPATIAL_V2_TRIANGLE_BUDGET_EXCEEDED');
  });

  it('keeps radial pattern failures visible instead of presenting a ready assembly', () => {
    const plan = basePlan();
    const components = plan.components.map((part) => {
      if (part.id !== 'blade-set' || part.geometry.type !== 'shape') return part;
      return { ...part, geometry: { ...part.geometry, repeat: { kind: 'radial' as const, count: 6, axis: 'x' as const, spacingOrRadius: 0.28 } } };
    });
    const invalidAxis = validateSpatialPlanV2({ ...plan, components });
    const { root } = compileSpatialPlanV2(invalidAxis);
    expect(evaluateSpatialConstraintsV2(invalidAxis, root)).toMatchObject({ ready: false, violatedIds: ['blade-distribution'] });
    disposeCompiledSpatialPlan(root);
  });

  it('adapts V1 plans without changing the V1 validator or losing source and entity IDs', () => {
    const v1 = validateSpatialPlan({ title: 'Legacy fan', units: 'unitless', entities: [{ id: 'hub', label: 'Hub', parentId: null, geometry: { operator: 'cylinder', parameters: [0.2, 0.1] }, repeat: null, transform: identity, material: { color: '#667788', roughness: 0.5, metalness: 0.1 }, origin: 'design_approximation', evidence: 'V1 source.' }], relations: [], unknowns: [] }, source);
    const v2 = spatialPlanV1ToV2(v1);
    expect(v2).toMatchObject({ contract: SPATIAL_PLAN_V2_CONTRACT, source, components: [{ id: 'hub', provenance: { evidence: 'V1 source.' } }] });
    const compiled = compileSpatialPlanV2(v2);
    expect(compiled.root.userData.contract).toBe(SPATIAL_PLAN_V2_CONTRACT);
    disposeCompiledSpatialPlan(compiled.root);
  });
});
