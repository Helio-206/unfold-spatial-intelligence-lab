import { describe, expect, it, vi } from 'vitest';
import { Mesh, PerspectiveCamera, Vector2, type Object3D } from 'three';
import { validateSpatialPlanV2, type SpatialPlanV2 } from '../src/universal-spatial/contracts-v2';
import { PlanSpaceLayer } from '../src/living/spatial-space/layer';
import { compileWithRouter } from '../src/universal-spatial/fidelity/router';

const T = (position: number[] = [0, 0, 0]) => ({ position, rotationRad: [0, 0, 0], scale: [1, 1, 1] });
const mat = { profile: 'organic', color: '#a04040', roughness: 0.6, metalness: 0, clearcoat: 0 };
const prov = { geometry: 'design_approximation', transform: 'design_approximation', material: 'design_approximation', evidence: 'test' };
const plan = (): SpatialPlanV2 => validateSpatialPlanV2({
  contract: 'unfold.spatial-plan.v2', source: { kind: 'image', sha256: 'd'.repeat(64) }, title: 'T', units: 'unitless', presentationProfile: 'organic', relations: [], constraints: [], unknowns: ['Physical scale is unknown.'],
  components: [
    { id: 'body', label: 'Body', parentId: null, transform: T([0, 1.5, 0]), provenance: prov, geometry: { type: 'shape', key: 'body-shape', operator: 'ellipsoid', parameters: { radii: [1.1, 1.5, 0.9], widthSegments: 24, heightSegments: 16 }, transform: T(), repeat: null, material: mat } },
    { id: 'duct', label: 'Duct', parentId: 'body', transform: T(), provenance: prov, geometry: { type: 'shape', key: 'duct-shape', operator: 'tube', parameters: { points: [[0, -0.5, 0], [0, 0.6, 0.3], [0.9, 1.2, 0.3]], radius: 0.12, tubularSegments: 24, radialSegments: 10 }, transform: T(), repeat: null, material: mat } },
  ],
});
const host = () => ({ changed: vi.fn(), redraw: vi.fn(), notify: vi.fn(), syncLost: vi.fn() });
const families = (root: Object3D) => { const out = new Set<string>(); root.traverse((o) => { if (o instanceof Mesh) out.add(String(o.userData.geometryFamily ?? 'procedural_v2')); }); return [...out]; };

describe('PlanSpaceLayer with the geometry router through its compile seam', () => {
  it('defaults to V2 when no seam is given (the release behaviour is unchanged)', () => {
    const layer = new PlanSpaceLayer(plan(), host()); expect(families(layer.root)).toEqual(['procedural_v2']); layer.dispose();
  });

  it('shows continuous surfaces, keeps selection and provenance, and rebuilds through the router after an edit and an undo', async () => {
    const compile = vi.fn((p: SpatialPlanV2) => compileWithRouter(p, { limits: { maxGridCells: 40 } })), layer = new PlanSpaceLayer(plan(), host(), compile);
    expect(families(layer.root)).toEqual(['continuous_surface']); expect(layer.has('body') && layer.has('duct')).toBe(true); expect(layer.box('duct')).not.toBeNull();
    layer.root.updateMatrixWorld(true); const camera = new PerspectiveCamera(30, 1, 0.1, 100); camera.position.set(0, 2, 8); camera.lookAt(0, 1.6, 0); camera.updateMatrixWorld(true);
    expect(layer.pick(new Vector2(0, 0), camera)).toMatch(/body|duct/);
    layer.highlight('body'); layer.proposeEdit('x+'); await layer.applyEdit();
    expect(compile.mock.calls.length).toBeGreaterThanOrEqual(2); expect(families(layer.root)).toEqual(['continuous_surface']);
    expect(layer.currentPlan.components.find((c) => c.id === 'body')!.provenance.transform).toBe('user_provided'); expect(layer.currentPlan.source.sha256).toBe('d'.repeat(64));
    expect(await layer.undo()).toBe(true); expect(layer.currentPlan.components.find((c) => c.id === 'body')!.provenance.transform).toBe('design_approximation');
    layer.dispose();
  });
});
