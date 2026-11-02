import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { fixtureMultiRoom, fixtureProvisional, fixtureTwoRooms } from '../src/rendering/fixtures';
import { buildRemovalGhost, buildThreePlanGroup, type ArchitecturalAssets } from '../src/plan-three-adapter';
import { disposeOwnedGeometries } from '../src/rendering/lifecycle';
import { disposeMaterials, getMaterials } from '../src/rendering/materials';
import { FrameMonitor, readDeviceCaps, resolveProfile } from '../src/rendering/quality';

/** Counts `dispose` events per geometry so a missed or doubled release is visible. */
function track(root: THREE.Object3D): Map<THREE.BufferGeometry, number> {
  const counts = new Map<THREE.BufferGeometry, number>();
  root.traverse((o) => {
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (g && !counts.has(g)) { counts.set(g, 0); g.addEventListener('dispose', () => counts.set(g, counts.get(g)! + 1)); }
  });
  return counts;
}

describe('geometry lifecycle', () => {
  it('releases mesh AND outline-line geometries on every rebuild, exactly once', () => {
    const scene = fixtureProvisional();
    const root = new THREE.Group();
    let lineGeometries = 0;
    for (let i = 0; i < 12; i += 1) {
      const group = buildThreePlanGroup(scene, {}, { quality: i % 2 ? 'presentation' : 'technical' });
      root.add(group);
      const counts = track(root);
      group.traverse((o) => { if ((o as THREE.Line).isLine) lineGeometries += 1; });
      expect(disposeOwnedGeometries(root)).toBe(counts.size);
      for (const [, n] of counts) expect(n).toBe(1);
      expect(disposeOwnedGeometries(root)).toBe(0); // no double release
      root.clear();
    }
    expect(lineGeometries).toBeGreaterThan(0); // the scene really had outlines to leak
  });

  it('never releases geometry shared with the loaded GLB modules', () => {
    const doorTemplate = new THREE.Group(); const doorGeometry = new THREE.BoxGeometry(1, 2.2, 0.14); doorTemplate.add(new THREE.Mesh(doorGeometry, new THREE.MeshStandardMaterial({ name: 'door_oak' })));
    const windowTemplate = new THREE.Group(); const windowGeometry = new THREE.BoxGeometry(1.2, 1.2, 0.1); windowTemplate.add(new THREE.Mesh(windowGeometry, new THREE.MeshStandardMaterial({ name: 'window_glazing' })));
    const assets = { door_single_900: doorTemplate, window_double_1200: windowTemplate } as ArchitecturalAssets;
    let disposed = 0; doorGeometry.addEventListener('dispose', () => { disposed += 1; }); windowGeometry.addEventListener('dispose', () => { disposed += 1; });
    for (let i = 0; i < 5; i += 1) { const group = buildThreePlanGroup(fixtureTwoRooms(), assets, { quality: 'presentation' }); disposeOwnedGeometries(group); }
    expect(disposed).toBe(0);
    // the clones were re-materialled, the templates were not touched
    expect(((doorTemplate.children[0] as THREE.Mesh).material as THREE.Material).name).toBe('door_oak');
  });

  it('keeps the shared material library alive across rebuilds and profile switches, without growth', () => {
    disposeMaterials();
    const seen = new Set<THREE.Material>(); const textures = new Set<THREE.Texture>();
    const collect = () => { for (const q of ['technical', 'presentation'] as const) { const lib = getMaterials(q); Object.values(lib.m).forEach((m) => seen.add(m)); seen.add(lib.provisionalLine); lib.textures && Object.values(lib.textures).forEach((t) => textures.add(t)); } };
    collect(); const materials = seen.size, texCount = textures.size;
    for (let i = 0; i < 20; i += 1) { const g = buildThreePlanGroup(fixtureMultiRoom(), {}, { quality: i % 2 ? 'technical' : 'presentation' }); disposeOwnedGeometries(g); collect(); }
    expect(seen.size).toBe(materials); expect(textures.size).toBe(texCount);
    let freed = 0; for (const t of textures) t.addEventListener('dispose', () => { freed += 1; });
    disposeMaterials(); // final teardown
    expect(freed).toBe(texCount);
    expect(getMaterials('presentation').m.wallFace.normalMap).not.toBeNull(); // and it comes back fresh
  });

  it('removal-preview ghosts release their own geometry, lines and materials once, however often they are created and cancelled', () => {
    const scene = fixtureTwoRooms(); let materialDisposals = 0; let geometryDisposals = 0;
    for (let i = 0; i < 10; i += 1) {
      const ghost = buildRemovalGhost(scene, 'wall-edge-0-0-400-0', 0xff5a1f, {}, i % 2 ? 'presentation' : 'technical')!;
      ghost.group.traverse((o) => {
        const mesh = o as THREE.Mesh; if (mesh.geometry) mesh.geometry.addEventListener('dispose', () => { geometryDisposals += 1; });
        for (const m of Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []) m.addEventListener('dispose', () => { materialDisposals += 1; });
      });
      let owned = 0; ghost.group.traverse((o) => { if ((o as THREE.Mesh).geometry) owned += 1; });
      ghost.dispose(); ghost.dispose();
      expect(geometryDisposals).toBe(owned * (i + 1));
    }
    expect(materialDisposals).toBeGreaterThanOrEqual(10);
  });
});

describe('device-aware quality', () => {
  it('software or small-texture devices get smaller shadows and a pixel ratio of 1; technical never changes', () => {
    const software = { maxTextureSize: 8192, maxSamples: 4, software: true, renderer: 'SwiftShader' };
    const gpu = { maxTextureSize: 16384, maxSamples: 8, software: false, renderer: 'Some GPU' };
    expect(resolveProfile('presentation', software).shadowMapSize).toBe(1024);
    expect(resolveProfile('presentation', software).maxPixelRatio).toBe(1);
    expect(resolveProfile('presentation', gpu).shadowMapSize).toBe(2048);
    expect(resolveProfile('presentation', gpu, 1).shadowMapSize).toBe(1024);
    expect(resolveProfile('presentation', gpu, 2).shadows).toBe(false);
    expect(resolveProfile('technical', software)).toEqual(resolveProfile('technical'));
  });
  it('reads software renderers from the debug string', () => {
    const gl = { getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 1 }), getParameter: (p: number) => (p === 1 ? 'ANGLE (Google, Vulkan, SwiftShader Device)' : 8192), MAX_TEXTURE_SIZE: 2 } as unknown as WebGLRenderingContext;
    expect(readDeviceCaps(gl).software).toBe(true);
  });
  it('the frame monitor ignores idle gaps, lowers cost only when frames are slow, once per cooldown, and never goes back up by itself', () => {
    const idle = new FrameMonitor({ window: 30 }); for (let i = 0; i < 100; i += 1) idle.sample(i * 1000); expect(idle.check(1e6)).toBeNull(); // 1 s gaps: nothing sampled
    const fast = new FrameMonitor({ window: 30 }); let t = 0; for (let i = 0; i < 60; i += 1) fast.sample((t += 16)); expect(fast.check(t)).toBeNull();
    const slow = new FrameMonitor({ window: 30, cooldownMs: 1000 }); t = 0; for (let i = 0; i < 40; i += 1) slow.sample((t += 60));
    expect(slow.check(t)).toBe(1); expect(slow.check(t + 10)).toBeNull(); // cooldown
    for (let i = 0; i < 40; i += 1) slow.sample((t += 60)); expect(slow.check(t + 2000)).toBe(2);
    for (let i = 0; i < 40; i += 1) slow.sample((t += 5)); expect(slow.check(t + 9000)).toBeNull(); expect(slow.degrade).toBe(2);
  });
});
