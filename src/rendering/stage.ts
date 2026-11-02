import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { getMaterials } from './materials';
import { resolveProfile, type DeviceCaps, type Degrade, type QualityProfile, type VisualQuality } from './quality';

/**
 * Renderer settings and lighting for each quality profile. Nothing here touches the scene's data: it configures a WebGLRenderer
 * and adds lights (and, for presentation, a small shared environment) to a THREE.Scene.
 */

/** Colour management, tone mapping, exposure, shadow filtering, pixel ratio and texture anisotropy for a profile. Idempotent. */
export function configureRenderer(renderer: THREE.WebGLRenderer, quality: VisualQuality, caps?: DeviceCaps, degrade: Degrade = 0): QualityProfile {
  const profile = resolveProfile(quality, caps, degrade);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = profile.toneMapping === 'aces' ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
  renderer.toneMappingExposure = profile.exposure;
  renderer.shadowMap.enabled = profile.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, profile.maxPixelRatio));
  // sharp, stable textures at grazing angles and different zoom levels (shared textures: set once per renderer limit)
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const textures = getMaterials(quality).textures;
  if (textures) for (const texture of Object.values(textures)) texture.anisotropy = anisotropy;
  return profile;
}

export type StageHandle = { group: THREE.Group; fit(bounds: THREE.Box3): void; /** shrink shadow cost: 1 = half-size map, 2 = no shadows */ degrade(level: Degrade): void; dispose(): void };

/** The lighting the viewer uses today. Technical keeps it so the technical profile changes geometry and materials only. */
export function editorRig(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'stage-editor-rig';
  group.add(new THREE.AmbientLight(0xc9c7bb, 1.25));
  const key = new THREE.DirectionalLight(0xffead0, 3.2); key.position.set(-5, 9, 6); group.add(key);
  const fill = new THREE.DirectionalLight(0xa5b09a, 1.05); fill.position.set(7, 4, -7); group.add(fill);
  return group;
}

const environments = new WeakMap<THREE.WebGLRenderer, THREE.Texture>();
export function environmentFor(renderer: THREE.WebGLRenderer): THREE.Texture {
  let texture = environments.get(renderer);
  if (!texture) {
    const generator = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    texture = generator.fromScene(room, 0.04).texture;
    room.dispose(); generator.dispose();
    environments.set(renderer, texture);
  }
  return texture;
}

/**
 * Lights for a profile. `renderer` is only needed for the presentation environment map (generated once per renderer, 256 px cube).
 * Call `fit(bounds)` after the model is built so the shadow frustum hugs it.
 */
export function createStage(scene: THREE.Scene, quality: VisualQuality, renderer?: THREE.WebGLRenderer, caps?: DeviceCaps): StageHandle {
  const profile = resolveProfile(quality, caps);
  if (quality === 'technical') {
    const group = editorRig(); scene.add(group);
    return { group, fit: () => undefined, degrade: () => undefined, dispose: () => { scene.remove(group); group.traverse((o) => (o as THREE.Light).dispose?.()); } };
  }
  const group = new THREE.Group(); group.name = 'stage-presentation';
  group.add(new THREE.HemisphereLight(0xdfe7ef, 0x8b857a, 0.7));
  const key = new THREE.DirectionalLight(0xfff1de, 2.3); key.name = 'stage-key';
  key.castShadow = profile.shadows;
  key.shadow.mapSize.set(profile.shadowMapSize, profile.shadowMapSize);
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 3;
  group.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xc9d6e6, 0.7); fill.position.set(8, 5, -8); group.add(fill);
  scene.add(group);
  let previousEnvironment: THREE.Texture | null = null; let previousIntensity = 1; let usesEnvironment = false;
  if (profile.environment && renderer) { previousEnvironment = scene.environment; scene.environment = environmentFor(renderer); previousIntensity = scene.environmentIntensity; scene.environmentIntensity = profile.environmentIntensity; usesEnvironment = true; }
  let disposed = false;
  return {
    group,
    fit(bounds) {
      if (bounds.isEmpty()) return;
      const centre = bounds.getCenter(new THREE.Vector3()); const radius = bounds.getBoundingSphere(new THREE.Sphere()).radius;
      key.target.position.copy(centre); key.position.copy(centre).add(new THREE.Vector3(-0.55, 0.85, 0.45).normalize().multiplyScalar(radius * 3));
      const c = key.shadow.camera; c.left = -radius * 1.15; c.right = radius * 1.15; c.top = radius * 1.15; c.bottom = -radius * 1.15; c.near = radius * 0.5; c.far = radius * 6.5;
      c.updateProjectionMatrix(); key.target.updateMatrixWorld(); key.shadow.needsUpdate = true;
    },
    degrade(level) {
      const next = resolveProfile('presentation', caps, level);
      if (key.shadow.mapSize.x !== next.shadowMapSize) { key.shadow.mapSize.set(next.shadowMapSize, next.shadowMapSize); key.shadow.map?.dispose(); key.shadow.map = null; }
      key.castShadow = next.shadows; // the renderer-wide shadow flag is left alone: toggling it would recompile every material
    },
    dispose() {
      if (disposed) return; disposed = true;
      scene.remove(group); key.shadow.map?.dispose(); key.shadow.map = null; group.traverse((o) => (o as THREE.Light).dispose?.());
      // the environment map is cached per renderer and released with it (disposeEnvironment); the scene stops pointing at it now
      if (usesEnvironment) { scene.environment = previousEnvironment; scene.environmentIntensity = previousIntensity; }
    },
  };
}

/** Release the cached environment map of a renderer that is being thrown away. */
export function disposeEnvironment(renderer: THREE.WebGLRenderer): void { environments.get(renderer)?.dispose(); environments.delete(renderer); }
