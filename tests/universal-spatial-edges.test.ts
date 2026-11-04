import { describe, expect, it } from 'vitest';
import { Box3, Mesh, Vector3 } from 'three';
import { validateSpatialPlanV2 } from '../src/universal-spatial/contracts-v2';
import { compileSpatialPlanV2, disposeCompiledSpatialPlan } from '../src/universal-spatial/geometry-compiler-v2';

const T = { position: [0, 0, 0] as [number, number, number], rotationRad: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] };
const plan = (dimensions: [number, number, number]) => validateSpatialPlanV2({
  contract: 'unfold.spatial-plan.v2', source: { kind: 'text', sha256: 'a'.repeat(64) }, title: 't', units: 'unitless', presentationProfile: 'neutral', relations: [], constraints: [], unknowns: [],
  components: [{ id: 'b', label: 'B', parentId: null, transform: T, provenance: { geometry: 'design_approximation', transform: 'design_approximation', material: 'design_approximation', evidence: 't' },
    geometry: { type: 'shape', key: 'b-shape', operator: 'box', parameters: { dimensions }, transform: T, repeat: null, material: { profile: 'neutral', color: '#999999', roughness: 0.5, metalness: 0, clearcoat: 0 } } }],
});

describe('box edge softening (presentation detail in the compiler)', () => {
  it('keeps the declared outer dimensions exactly, whatever the scale', () => {
    for (const dims of [[4, 1, 4], [0.02, 0.01, 0.03], [900, 20, 500]] as Array<[number, number, number]>) {
      const compiled = compileSpatialPlanV2(plan(dims)); compiled.root.updateMatrixWorld(true);
      const size = new Box3().setFromObject(compiled.root).getSize(new Vector3()); dims.forEach((d, i) => expect(size.getComponent(i)).toBeCloseTo(d, 5)); disposeCompiledSpatialPlan(compiled.root);
    }
  });

  it('rounds the edges proportionally to the thinnest side and says so on the mesh', () => {
    const compiled = compileSpatialPlanV2(plan([4, 1, 4])); let radius = 0, mesh: Mesh | null = null; compiled.root.traverse((o) => { if (o instanceof Mesh) { mesh = o; radius = o.userData.spatialEdgeSoftening as number; } });
    expect(radius).toBeCloseTo(0.07, 6); expect(mesh!.geometry.getAttribute('normal')).toBeDefined(); expect(mesh!.geometry.getAttribute('uv')).toBeDefined();
    // no corner of the box is a sharp vertex any more: no vertex sits at the exact corner of the bounding box
    const position = mesh!.geometry.getAttribute('position'); let atCorner = 0; for (let i = 0; i < position.count; i++) if (Math.abs(Math.abs(position.getX(i)) - 2) < 1e-6 && Math.abs(Math.abs(position.getY(i)) - 0.5) < 1e-6 && Math.abs(Math.abs(position.getZ(i)) - 2) < 1e-6) atCorner++;
    expect(atCorner).toBe(0); disposeCompiledSpatialPlan(compiled.root);
  });

  it('stays inside the triangle budget the contract estimates', () => {
    const p = plan([1, 1, 1]), compiled = compileSpatialPlanV2(p); expect(compiled.stats.triangleCount).toBeLessThanOrEqual(400_000); disposeCompiledSpatialPlan(compiled.root);
  });
});
