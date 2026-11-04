import { describe, expect, it } from 'vitest';
import { Mesh, MeshPhysicalMaterial } from 'three';
import type { MaterialV2 } from '../src/universal-spatial/contracts-v2';
import { materialValues } from '../src/universal-spatial/materials-v2';
import { compileSpatialPlanV2 } from '../src/universal-spatial/geometry-compiler-v2';

const spec = (profile: MaterialV2['profile'], extra: Partial<MaterialV2> = {}): MaterialV2 => ({ profile, color: '#808080', roughness: 0.5, metalness: 0.5, clearcoat: 0, ...extra });

describe('material profiles', () => {
  it('bare metal is mirror-like and conductive, painted industrial is coated and not a mirror', () => {
    const metal = materialValues(spec('metal', { metalness: 0.2, roughness: 0.9 })), painted = materialValues(spec('industrial', { metalness: 0.95 }));
    expect(metal.metalness).toBeGreaterThanOrEqual(0.85); expect(metal.roughness).toBeLessThanOrEqual(0.45);
    expect(painted.metalness).toBeLessThanOrEqual(0.6); expect(painted.clearcoat).toBeGreaterThanOrEqual(0.25);
  });

  it('rubber and organic are matte and non-metallic, organic gets a soft sheen', () => {
    const rubber = materialValues(spec('rubber', { metalness: 1, roughness: 0.1, clearcoat: 1 })), organic = materialValues(spec('organic', { metalness: 1, roughness: 0.1 }));
    expect(rubber.roughness).toBeGreaterThanOrEqual(0.75); expect(rubber.metalness).toBe(0); expect(rubber.clearcoat).toBe(0);
    expect(organic.metalness).toBeLessThanOrEqual(0.05); expect(organic.roughness).toBeGreaterThanOrEqual(0.55); expect(organic.sheen).toBeGreaterThan(0);
  });

  it('glass is smooth, coated, translucent and does not write depth', () => {
    const glass = materialValues(spec('glass', { roughness: 0.9, metalness: 1 }));
    expect(glass.roughness).toBeLessThanOrEqual(0.1); expect(glass.metalness).toBe(0); expect(glass.opacity).toBeLessThan(0.6); expect(glass.transparent).toBe(true); expect(glass.depthWrite).toBe(false);
  });

  it('accent is glossy paint and neutral never turns into a mirror', () => {
    expect(materialValues(spec('accent')).clearcoat).toBeGreaterThanOrEqual(0.5);
    const neutral = materialValues(spec('neutral', { metalness: 1, roughness: 0 }));
    expect(neutral.metalness).toBeLessThanOrEqual(0.3); expect(neutral.roughness).toBeGreaterThanOrEqual(0.25);
  });

  it('keeps every value inside the physical 0..1 range for any contract-valid input', () => {
    for (const profile of ['neutral', 'industrial', 'organic', 'glass', 'rubber', 'metal', 'accent'] as const) for (const value of [0, 0.5, 1]) {
      const v = materialValues(spec(profile, { roughness: value, metalness: value, clearcoat: value }));
      for (const n of [v.roughness, v.metalness, v.clearcoat, v.opacity, v.sheen]) { expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThanOrEqual(1); }
    }
  });

  it('is what the compiler actually applies', () => {
    const plan = { contract: 'unfold.spatial-plan.v2', source: { kind: 'text', sha256: 'a'.repeat(64) }, title: 't', units: 'unitless', presentationProfile: 'neutral', relations: [], constraints: [], unknowns: [],
      components: [{ id: 'part', label: 'Part', parentId: null, transform: { position: [0, 0, 0], rotationRad: [0, 0, 0], scale: [1, 1, 1] }, provenance: { geometry: 'inferred', transform: 'inferred', material: 'inferred', evidence: 'x' },
        geometry: { type: 'shape', key: 'part-shape', operator: 'box', parameters: { dimensions: [1, 1, 1] }, transform: { position: [0, 0, 0], rotationRad: [0, 0, 0], scale: [1, 1, 1] }, repeat: null, material: spec('rubber', { metalness: 1, roughness: 0.1 }) } }] };
    const compiled = compileSpatialPlanV2(plan);
    let found: MeshPhysicalMaterial | undefined; compiled.root.traverse((o) => { if (o instanceof Mesh && o.material instanceof MeshPhysicalMaterial) found = o.material; });
    expect(found!.metalness).toBe(0); expect(found!.roughness).toBeGreaterThanOrEqual(0.75);
  });
});
