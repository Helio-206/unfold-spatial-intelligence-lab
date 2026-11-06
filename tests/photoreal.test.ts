import { describe, expect, it, vi } from 'vitest';
import { Group, Mesh, BoxGeometry, MeshStandardMaterial, Scene } from 'three';
import { cookTorrance, dielectricF0, effectiveRoughness, fresnelSchlick, ggxDistribution, smithJoint, PHOTOREAL_BRDF_GLSL } from '../src/living/photoreal/brdf';
import { PHOTOREAL_PARAMS, photorealKindOf, swapPhotorealMaterials } from '../src/living/photoreal/materials';
import { PHOTOREAL_PRESETS, selectPhotorealPreset } from '../src/living/photoreal/presets';
import { PhotorealGeometry, applyPhotorealStage } from '../src/living/photoreal/look';
import { Texture } from 'three';
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

describe('photoreal stage cleanup and capability fallback', () => {
  class FakeGL2 {}
  const fakeRenderer = () => {
    const gl = Object.create(FakeGL2.prototype) as Record<string, unknown>;
    gl.MAX_TEXTURE_IMAGE_UNITS = 0x84e2;
    gl.getExtension = () => null;
    gl.getParameter = (p: unknown) => (p === 0x84e2 ? 16 : 'FakeGPU');
    return { getContext: () => gl, toneMappingExposure: 1.25 } as never;
  };
  it('dispose restores environment, exposure and rig exactly once, across repeated open/close cycles', () => {
    vi.stubGlobal('WebGL2RenderingContext', FakeGL2);
    try {
      for (let cycle = 0; cycle < 3; cycle++) {
        const scene = new Scene();
        const previousEnv = new Texture();
        scene.environment = previousEnv; scene.environmentIntensity = 0.7;
        const renderer = fakeRenderer();
        const studioDispose = vi.fn();
        const stage = applyPhotorealStage(renderer, scene, 'balanced', { createEnvironment: () => ({ texture: new Texture(), panels: [], dispose: studioDispose }) });
        expect(stage).not.toBeNull();
        expect(scene.environment).not.toBe(previousEnv);
        expect(scene.children.some((c) => c.name === 'photoreal-studio-rig')).toBe(true);
        stage!.dispose();
        expect(scene.environment).toBe(previousEnv); // restored, not leaked
        expect(scene.environmentIntensity).toBe(0.7);
        expect((renderer as { toneMappingExposure: number }).toneMappingExposure).toBe(1.25);
        expect(scene.children.some((c) => c.name === 'photoreal-studio-rig')).toBe(false);
        expect(studioDispose).toHaveBeenCalledTimes(1);
        stage!.dispose(); stage!.revert(); // idempotent: nothing happens twice
        expect(studioDispose).toHaveBeenCalledTimes(1);
        expect(scene.environment).toBe(previousEnv);
      }
    } finally { vi.unstubAllGlobals(); }
  });
  it('revert() before dispose() still disposes the procedural environment exactly once', () => {
    vi.stubGlobal('WebGL2RenderingContext', FakeGL2);
    try {
      const scene = new Scene();
      const previousEnv = new Texture();
      scene.environment = previousEnv; scene.environmentIntensity = 0.7;
      const renderer = fakeRenderer();
      const studioDispose = vi.fn();
      const stage = applyPhotorealStage(renderer, scene, 'balanced', { createEnvironment: () => ({ texture: new Texture(), panels: [], dispose: studioDispose }) });
      expect(stage).not.toBeNull();
      stage!.revert(); // undress first: stage restored, but the studio texture is still owned by this stage
      expect(scene.environment).toBe(previousEnv);
      expect(scene.children.some((c) => c.name === 'photoreal-studio-rig')).toBe(false);
      stage!.dispose(); // must release the procedural environment even though revert already ran
      expect(studioDispose).toHaveBeenCalledTimes(1);
      stage!.dispose(); stage!.revert();
      expect(studioDispose).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });
  it('unsupported capabilities return null and touch nothing', () => {
    const scene = new Scene();
    const renderer = { getContext: () => ({ getExtension: () => null, getParameter: () => 0 }), toneMappingExposure: 1 } as never;
    expect(applyPhotorealStage(renderer, scene, 'balanced')).toBeNull();
    expect(scene.children).toHaveLength(0);
    expect(scene.environment).toBeNull();
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
  it('microdetail:false generates and assigns no procedural maps (performance preset)', () => {
    const root = new Group();
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ color: '#888888', metalness: 0.8, roughness: 0.4 }));
    root.add(mesh);
    const swap = swapPhotorealMaterials(root, { microdetail: false });
    const material = mesh.material as MeshStandardMaterial;
    expect(material.userData.photoreal).toBe(true);
    expect(material.normalMap).toBeNull();
    expect(material.roughnessMap).toBeNull();
    expect(swap.microdetail).toHaveLength(0);
    swap.dispose();
    const withDetail = swapPhotorealMaterials(root, { microdetail: true });
    expect((mesh.material as MeshStandardMaterial).normalMap).not.toBeNull();
    expect(withDetail.microdetail.length).toBeGreaterThan(0);
    withDetail.dispose();
  });
  it('a disabled geometry wrapper preserves the original materials exactly, including after a swap', () => {
    const plan = plans.sedan(), before = JSON.stringify(plan);
    const inner = { compile: (p: typeof plan) => compileFoundry(p), attach: () => {}, report: () => null, dispose: () => {} };
    const geometry = new PhotorealGeometry(inner as never);
    geometry.setEnabled(false);
    const compiled = geometry.compile(plan);
    let photorealCount = 0;
    compiled.root.traverse((o) => { if (o instanceof Mesh && (o.material as MeshStandardMaterial).userData?.photoreal) photorealCount++; });
    expect(photorealCount).toBe(0);
    geometry.setEnabled(true);
    const second = geometry.compile(plan);
    let swapped = 0; const originals = new Map<Mesh, unknown>();
    second.root.traverse((o) => { if (o instanceof Mesh && (o.material as MeshStandardMaterial).userData?.photoreal) swapped++; });
    expect(swapped).toBeGreaterThan(0);
    geometry.setEnabled(false); // restores the currently swapped materials immediately
    second.root.traverse((o) => { if (o instanceof Mesh) originals.set(o as Mesh, (o as Mesh).material); });
    second.root.traverse((o) => { if (o instanceof Mesh) expect((o.material as MeshStandardMaterial).userData?.photoreal).toBeUndefined(); });
    expect(JSON.stringify(plan)).toBe(before);
    geometry.dispose();
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
