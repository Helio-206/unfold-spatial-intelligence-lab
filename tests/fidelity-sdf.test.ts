import { describe, expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import { validateSpatialPlanV2 } from '../src/universal-spatial/contracts-v2';
import { compileSpatialPlanV2, disposeCompiledSpatialPlan } from '../src/universal-spatial/geometry-compiler-v2';
import { collectWorldPoints } from '../src/universal-spatial/framing';
import { implicitShapesOf, unionField, smoothMin } from '../src/universal-spatial/fidelity/sdf';
import { surfaceNets } from '../src/universal-spatial/fidelity/surface-nets';

type V3 = [number, number, number];
const material = { profile: 'neutral' as const, color: '#999999', roughness: 0.5, metalness: 0, clearcoat: 0 };
const geometryFor = (operator: string, parameters: object, transform: { position: V3; rotationRad: V3; scale: V3 }, repeat: object | null = null) => ({ type: 'shape' as const, key: 'k', operator, parameters, transform, repeat, material });
const planOf = (geometry: object) => validateSpatialPlanV2({ contract: 'unfold.spatial-plan.v2', source: { kind: 'text', sha256: 'a'.repeat(64) }, title: 't', units: 'unitless', presentationProfile: 'neutral', relations: [], constraints: [], unknowns: [], components: [{ id: 'c', label: 'c', parentId: null, geometry, transform: { position: [0, 0, 0], rotationRad: [0, 0, 0], scale: [1, 1, 1] }, provenance: { geometry: 'design_approximation', transform: 'design_approximation', material: 'design_approximation', evidence: 't' } }] });
const rot = { position: [0.3, -0.2, 0.5] as V3, rotationRad: [0.4, 0.7, -0.3] as V3, scale: [1, 1, 1] as V3 };

const CASES: Array<[string, object, object | null]> = [
  ['box', { dimensions: [2, 1, 1.5] }, null], ['rounded_box', { dimensions: [2, 1, 1.5], bevelM: 0.2, segments: 3 }, null], ['sphere', { radius: 0.8, widthSegments: 24, heightSegments: 16 }, null],
  ['ellipsoid', { radii: [1.2, 0.6, 0.9], widthSegments: 24, heightSegments: 16 }, null], ['cylinder', { radiusTop: 0.5, radiusBottom: 0.7, height: 1.8, radialSegments: 32 }, null],
  ['cone', { radius: 0.8, height: 1.6, radialSegments: 32 }, null], ['torus', { majorRadius: 1, tubeRadius: 0.25, radialSegments: 16, tubularSegments: 48 }, null],
  ['tube', { points: [[0, 0, 0], [1, 0.5, 0], [1.5, 1.5, 0.5]], radius: 0.15, tubularSegments: 24, radialSegments: 10 }, null],
  ['cylinder', { radiusTop: 0.15, radiusBottom: 0.15, height: 1, radialSegments: 16 }, { kind: 'radial', count: 5, axis: 'y', spacingOrRadius: 1.2 }],
  ['box', { dimensions: [0.4, 0.4, 0.4] }, { kind: 'linear', count: 4, axis: 'x', spacingOrRadius: 0.9 }],
];

describe('distance fields describe the same shapes as the V2 compiler', () => {
  it.each(CASES.map((c, i) => [i, c[0]] as const))('case %i: %s (rotated, translated) matches the V2 bounds within one cell', (index) => {
    const [operator, parameters, repeat] = CASES[index]!, geometry = geometryFor(operator, parameters, rot, repeat), plan = planOf(geometry);
    const compiled = compileSpatialPlanV2(plan); compiled.root.updateMatrixWorld(true); const v2 = new Box3().setFromPoints(collectWorldPoints(compiled.root, 200_000)); disposeCompiledSpatialPlan(compiled.root); // real vertices: Box3.setFromObject would give the rotated bounding box, which is larger than a rotated sphere
    const shapes = implicitShapesOf(geometry as never); expect(Array.isArray(shapes)).toBe(true);
    const field = unionField((shapes as Exclude<typeof shapes, { code: string }>).map((s) => s.field), 0), box = new Box3(); for (const s of shapes as Array<{ box: Box3 }>) box.union(s.box);
    const size = box.getSize(new Vector3()), cell = Math.max(size.x, size.y, size.z) / 48, min = box.min.clone().subScalar(2 * cell);
    const mesh = surfaceNets({ min, cells: [0, 1, 2].map((a) => Math.ceil(size.getComponent(a) / cell) + 4) as V3, size: cell, field }); mesh.computeBoundingBox();
    const got = mesh.boundingBox!, tol = cell * 1.6;
    for (const axis of ['x', 'y', 'z'] as const) { expect(Math.abs(got.min[axis] - v2.min[axis]), `${operator} min ${axis}`).toBeLessThan(tol); expect(Math.abs(got.max[axis] - v2.max[axis]), `${operator} max ${axis}`).toBeLessThan(tol); }
  });

  it('refuses operators that have no distance field, with a code', () => {
    const r = implicitShapesOf(geometryFor('revolve', { profile: [[0.3, 0], [0.3, 1]], segments: 16 }, rot) as never); expect(r).toMatchObject({ code: 'OPERATOR_NOT_IMPLICIT' });
  });

  it('smooth minimum equals min away from the crossing, never exceeds it, and fillets inside the band', () => {
    expect(smoothMin(3, 1, 0.5)).toBe(1); expect(smoothMin(1, 1, 0.5)).toBeLessThan(1); expect(smoothMin(1, 1, 0.5)).toBeCloseTo(1 - 0.5 / 4, 9); expect(smoothMin(2, 5, 0)).toBe(2);
    for (const [a, b] of [[0, 0.1], [0.3, 0.2], [-1, 0.05]] as const) expect(smoothMin(a, b, 0.4)).toBeLessThanOrEqual(Math.min(a, b));
  });
});
