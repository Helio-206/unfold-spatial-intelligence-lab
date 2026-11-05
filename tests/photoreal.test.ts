import { describe, expect, it, vi } from 'vitest';
import { Group, Mesh, BoxGeometry, MeshStandardMaterial } from 'three';
import { cookTorrance, dielectricF0, effectiveRoughness, fresnelSchlick, ggxDistribution, smithJoint, PHOTOREAL_BRDF_GLSL } from '../src/living/photoreal/brdf';
import { PHOTOREAL_PARAMS, photorealKindOf, swapPhotorealMaterials } from '../src/living/photoreal/materials';
import { PHOTOREAL_PRESETS, selectPhotorealPreset } from '../src/living/photoreal/presets';
import { PhotorealGeometry } from '../src/living/photoreal/look';
import { compileFoundry } from '../src/living/universal-foundry/foundry';
import * as plans from '../src/living/universal-foundry/fixtures/plans';

describe('photoreal BRDF mathematics', () => {
  it('GGX peaks at the half-vector normal and falls with roughness', () => {
    expect(ggxDistribution(1, 0.2)).toBeGreaterThan(ggxDistribution(1, 0.8));
    expect(ggxDistribution(0.2, 0.4)).toBeLessThan(ggxDistribution(1, 0.4));
    expect(Number.isFinite(ggxDistribution(1, 0))).toBe(true); // zero roughness is clamped, never NaN
    expect(effectiveRoughness(0)).toBeGreaterThan(0);
    expect(effectiveRoughness(Number.NaN)).toBe(1);
  });
  it('Smith joint term is bounded and finite at grazing', () => {
    for (const angle of [0.999, 0.5, 0.05, 0.001]) {
      const g = smithJoint(angle, angle, 0.4);
      expect(Number.isFinite(g)).toBe(true); expect(g).toBeGreaterThan(0); expect(g).toBeLessThanOrEqual(1.0001);
    }
  });
  it('Fresnel is F0 head-on and 1 at grazing; dielectrics start at 0.04', () => {
    expect(fresnelSchlick(1, 0.04)).toBeCloseTo(0.04);
    expect(fresnelSchlick(0, 0.04)).toBeCloseTo(1);
    expect(dielectricF0(1.5)).toBeCloseTo(0.04);
  });
  it('a white furnace test keeps a non-metal from returning more than it receives (single-bounce bound)', () => {
    // Integrate qualitatively: sample the hemisphere at one roughness and require the directional
    // albedo of a white dielectric to stay at or below 1 (no energy creation in this model).
    let total = 0, weight = 0;
    for (let i = 0; i < 40; i++) for (let j = 0; j < 40; j++) {
      const polar = (i + 0.5) / 40 * Math.PI / 2, azimuth = (j + 0.5) / 40 * Math.PI * 2;
      const light: [number, number, number] = [Math.sin(polar) * Math.cos(azimuth), Math.cos(polar), Math.sin(polar) * Math.sin(azimuth)];
      const out = cookTorrance({ normal: [0, 1, 0], view: [0, 1, 0], light, albedo: [1, 1, 1], metallic: 0, roughness: 0.5 });
      const nDotL = light[1];
      total += out[0] * nDotL * Math.sin(polar); weight += Math.sin(polar);
      expect(out.every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
    }
    expect(total / weight * Math.PI / 2).toBeLessThanOrEqual(1.05);
  });
  it('metals tint the specular with the base colour and kill the diffuse', () => {
    const metal = cookTorrance({ normal: [0, 1, 0], view: [0, 1, 0], light: [0, 1, 0], albedo: [0.8, 0.2, 0.1], metallic: 1, roughness: 0.3 });
    expect(metal[0]).toBeGreaterThan(metal[1]!);
    const back = cookTorrance({ normal: [0, 1, 0], view: [0, 1, 0], light: [0, -1, 0], albedo: [1, 1, 1], metallic: 0, roughness: 0.5 });
    expect(back).toEqual([0, 0, 0]);
    expect(PHOTOREAL_BRDF_GLSL).toContain('unfoldCookTorrance');
  });
});

describe('photoreal materials and swap lifecycle', () => {
  it('classifies kinds from Foundry declarations before heuristics', () => {
    const glass = new MeshStandardMaterial(); glass.userData = { materialKey: 'glass' };
    expect(photorealKindOf(glass)).toBe('glass');
    const chrome = new MeshStandardMaterial({ metalness: 0.95, roughness: 0.3 });
    expect(photorealKindOf(chrome)).toBe('metal');
    expect(PHOTOREAL_PARAMS.glass.roughness).toBeLessThan(PHOTOREAL_PARAMS.rubber.roughness);
  });
  it('swap replaces materials, preserves identity, restores and disposes exactly', () => {
    const root = new Group();
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ color: '#aa3333', metalness: 0.9, roughness: 0.4 }));
    mesh.userData.spatialEntityId = 'part-1';
    root.add(mesh);
    const original = mesh.material;
    const swap = swapPhotorealMaterials(root);
    expect(mesh.material).not.toBe(original);
    expect((mesh.material as MeshStandardMaterial).userData.photoreal).toBe(true);
    expect(mesh.userData.spatialEntityId).toBe('part-1');
    const disposeSpy = vi.spyOn(swap.materials[0]!, 'dispose');
    swap.restore();
    expect(mesh.material).toBe(original);
    swap.dispose();
    expect(disposeSpy).toHaveBeenCalled();
  });
  it('presets fall back safely: no WebGL2 -> null, software rendering -> performance', () => {
    expect(selectPhotorealPreset('cinematic', { webgl2: false, maxTextures: 16, softwareRendering: false, rendererInfo: 'x' })).toBeNull();
    expect(selectPhotorealPreset('cinematic', { webgl2: true, maxTextures: 16, softwareRendering: true, rendererInfo: 'SwiftShader' })?.name).toBe('performance');
    expect(selectPhotorealPreset('balanced', { webgl2: true, maxTextures: 16, softwareRendering: false, rendererInfo: 'GPU' })).toBe(PHOTOREAL_PRESETS.balanced);
  });
  it('the geometry wrapper swaps on every compile and the plan is never written', () => {
    const plan = plans.sedan();
    const before = JSON.stringify(plan);
    const inner = { compile: (p: typeof plan) => compileFoundry(p), attach: () => {}, report: () => null, dispose: () => {} };
    const geometry = new PhotorealGeometry(inner as never);
    const compiled = geometry.compile(plan);
    let photorealCount = 0;
    compiled.root.traverse((o) => { if (o instanceof Mesh && (o.material as MeshStandardMaterial).userData?.photoreal) photorealCount++; });
    expect(photorealCount).toBeGreaterThan(0);
    expect(JSON.stringify(plan)).toBe(before);
    geometry.dispose();
  });
});
