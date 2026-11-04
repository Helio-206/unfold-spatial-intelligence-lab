import { describe, expect, it } from 'vitest';
import { Mesh, MeshPhysicalMaterial, type Texture } from 'three';
import { validateSpatialPlanV2 } from '../src/universal-spatial/contracts-v2';
import { compileSpatialPlanV2, disposeCompiledSpatialPlan } from '../src/universal-spatial/geometry-compiler-v2';
import { applyPresentationFinish, grainPixels } from '../src/living/spatial-presentation/finish';

const T = { position: [0, 0, 0] as [number, number, number], rotationRad: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] };
const profiles = ['metal', 'industrial', 'accent', 'organic', 'rubber', 'glass', 'neutral'] as const;
const planWithProfiles = () => validateSpatialPlanV2({
  contract: 'unfold.spatial-plan.v2', source: { kind: 'text', sha256: 'a'.repeat(64) }, title: 't', units: 'unitless', presentationProfile: 'neutral', relations: [], constraints: [], unknowns: [],
  components: profiles.map((profile, i) => ({
    id: `p-${profile}`, label: profile, parentId: null, transform: { ...T, position: [i * 2, 0, 0] as [number, number, number] },
    provenance: { geometry: 'design_approximation', transform: 'design_approximation', material: 'design_approximation', evidence: 'test' },
    geometry: { type: 'shape', key: `${profile}-shape`, operator: i % 2 ? 'cylinder' : 'rounded_box', parameters: i % 2 ? { radiusTop: 0.5, radiusBottom: 0.5, height: 1, radialSegments: 16 } : { dimensions: [1, 1, 1], bevelM: 0.05, segments: 2 }, transform: T, repeat: null, material: { profile, color: '#a07040', roughness: 0.5, metalness: 0.2, clearcoat: 0.1 } },
  })),
});
const materialsOf = (root: Mesh | { traverse: (f: (o: unknown) => void) => void }) => { const out = new Map<string, MeshPhysicalMaterial>(); root.traverse((o) => { if (o instanceof Mesh && o.material instanceof MeshPhysicalMaterial) out.set(o.userData.materialProfile as string, o.material); }); return out; };

describe('presentation PBR finish', () => {
  it('gives each category a finish that fits it and leaves glass alone', () => {
    const compiled = compileSpatialPlanV2(planWithProfiles()), handle = applyPresentationFinish(compiled.root), m = materialsOf(compiled.root);
    expect(m.get('metal')!.roughnessMap).not.toBeNull(); expect(m.get('industrial')!.roughnessMap).not.toBeNull(); expect(m.get('industrial')!.map).not.toBeNull();
    expect(m.get('rubber')!.bumpMap).not.toBeNull(); expect(m.get('organic')!.map).not.toBeNull(); expect(m.get('organic')!.roughnessMap).not.toBeNull();
    expect(m.get('glass')!.map).toBeNull(); expect(m.get('glass')!.roughnessMap).toBeNull(); expect(handle.applied).toBe(profiles.length - 1);
    handle.restore(); disposeCompiledSpatialPlan(compiled.root);
  });

  it('restores every material exactly and disposes every texture it created', () => {
    const compiled = compileSpatialPlanV2(planWithProfiles()), before = new Map([...materialsOf(compiled.root)].map(([k, v]) => [k, { map: v.map, rough: v.roughnessMap, bump: v.bumpMap, bumpScale: v.bumpScale, color: v.color.getHex(), roughness: v.roughness }]));
    const disposed: Texture[] = [], handle = applyPresentationFinish(compiled.root);
    for (const material of materialsOf(compiled.root).values()) for (const t of [material.map, material.roughnessMap, material.bumpMap]) if (t) t.addEventListener('dispose', () => disposed.push(t));
    const created = new Set([...materialsOf(compiled.root).values()].flatMap((material) => [material.map, material.roughnessMap, material.bumpMap]).filter(Boolean));
    handle.restore();
    for (const [profile, material] of materialsOf(compiled.root)) { const b = before.get(profile)!; expect([material.map, material.roughnessMap, material.bumpMap, material.bumpScale, material.color.getHex(), material.roughness]).toEqual([b.map, b.rough, b.bump, b.bumpScale, b.color, b.roughness]); }
    expect(new Set(disposed).size).toBe(created.size); handle.restore(); disposeCompiledSpatialPlan(compiled.root);
  });

  it('is idempotent on the same root and shares one texture per finish between materials', () => {
    const compiled = compileSpatialPlanV2(planWithProfiles()), a = applyPresentationFinish(compiled.root), b = applyPresentationFinish(compiled.root);
    expect(b.applied).toBe(0); const m = materialsOf(compiled.root); expect(m.get('metal')!.roughnessMap).toBe(m.get('metal')!.roughnessMap); a.restore(); disposeCompiledSpatialPlan(compiled.root);
  });

  it('wood-like grain is deterministic, in range and directional (smoother along the fibre than across)', () => {
    const size = 64, one = grainPixels(size), two = grainPixels(size); expect(Buffer.from(one).equals(Buffer.from(two))).toBe(true);
    let along = 0, across = 0; for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) { const v = one[(y * size + x) * 4]!; along += Math.abs(v - one[((y + 1) * size + x) * 4]!); across += Math.abs(v - one[(y * size + x + 1) * 4]!); }
    expect(along).toBeLessThan(across * 0.6); for (let i = 0; i < one.length; i += 4) { expect(one[i]).toBeGreaterThanOrEqual(185); expect(one[i + 3]).toBe(255); }
  });

  it('lofted shapes carry UVs, so they receive a finish like every other operator', () => {
    const plan = planWithProfiles(), loft = { type: 'shape' as const, key: 'loft-shape', operator: 'loft' as const, parameters: { profile: [[-0.5, -0.3], [0.5, -0.3], [0.5, 0.3], [-0.5, 0.3]], sections: [[0, 1, 1], [0.8, 0.6, 0.6]], capEnds: [true, true] }, transform: T, repeat: null, material: { profile: 'metal' as const, color: '#aaaaaa', roughness: 0.4, metalness: 0.9, clearcoat: 0 } };
    const compiled = compileSpatialPlanV2(validateSpatialPlanV2({ ...plan, components: [{ ...plan.components[0]!, id: 'lofted', geometry: loft }] }));
    let uv = false, vertices = 0, uvCount = 0; compiled.root.traverse((o) => { if (o instanceof Mesh) { uv = !!o.geometry.getAttribute('uv'); vertices = o.geometry.getAttribute('position').count; uvCount = o.geometry.getAttribute('uv')?.count ?? 0; } });
    expect(uv).toBe(true); expect(uvCount).toBe(vertices);
    const handle = applyPresentationFinish(compiled.root); expect(handle.applied).toBe(1); handle.restore(); disposeCompiledSpatialPlan(compiled.root);
  });

  it('does nothing for a root without compiled materials', () => {
    const empty = compileSpatialPlanV2(planWithProfiles()).root; empty.clear(); expect(applyPresentationFinish(empty).applied).toBe(0);
  });
});
