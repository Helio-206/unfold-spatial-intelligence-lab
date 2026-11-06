/**
 * The photoreal look: a geometry-seam wrapper plus a stage rig.
 *
 * `PhotorealGeometry` wraps the Foundry geometry provider: every compile (initial build, visual
 * regeneration, authorised plan mutation, undo) has its materials swapped for photoreal ones, so the
 * visual representation always follows the authoritative plan the layer holds. Swapping materials
 * never writes the plan, a revision, a review or a receipt.
 *
 * `applyPhotorealStage` installs the studio environment (procedural PMREM, no downloads), a
 * key/fill/rim rig with soft shadows and a ground contact shadow on the workspace stage, and sets a
 * single exposure. Tone mapping and colour space stay owned by the workspace's existing composer
 * (OutputPass): this module never adds a second tone map or gamma conversion. Everything is
 * restorable (`revert`) and disposable.
 */
import { DirectionalLight, Group, Mesh, PlaneGeometry, Scene, ShadowMaterial, WebGLRenderer } from 'three';
import { createStudioEnvironment, type StudioEnvironment } from '../cinema/studio-environment';
import type { GeometrySeam } from '../spatial-space/flow';
import { swapPhotorealMaterials, type PhotorealSwap } from './materials';
import { detectCapabilities, selectPhotorealPreset, type PhotorealPreset, type PhotorealPresetName } from './presets';

export const PHOTOREAL_PANELS = [
  { id: 'key', size: [10, 6] as const, position: [-9, 10, 9] as const, color: '#fff1de', radiance: 9 },
  { id: 'fill', size: [9, 6] as const, position: [11, 5, 8] as const, color: '#e8efff', radiance: 3 },
  { id: 'rim', size: [1.4, 9] as const, position: [7, 6, -12] as const, color: '#d6e4ff', radiance: 16 },
  { id: 'top', size: [12, 8] as const, position: [0, 14, 0] as const, color: '#ffffff', radiance: 5 },
  { id: 'bounce', size: [14, 1.6] as const, position: [0, 0.6, 12] as const, color: '#ffd9b0', radiance: 1.4 },
] as const;

export class PhotorealGeometry {
  private swap: PhotorealSwap | null = null;
  /** When false, compiles pass through with the original materials (unsupported capabilities). */
  enabled = true;
  constructor(private readonly inner: GeometrySeam, private readonly options: { microdetail?: boolean } = {}) {}
  compile = (plan: Parameters<GeometrySeam['compile']>[0]): ReturnType<GeometrySeam['compile']> => {
    this.swap?.dispose(); this.swap = null;
    const compiled = this.inner.compile(plan);
    if (this.enabled) this.swap = swapPhotorealMaterials(compiled.root, { microdetail: this.options.microdetail ?? true });
    return compiled;
  };
  /** Disabling after materials were swapped restores the originals immediately. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled && this.swap) { this.swap.restore(); }
  }
  attach(onReady: () => void): void { this.inner.attach(onReady); }
  report(): unknown { return this.inner.report(); }
  dispose(): void { this.swap?.dispose(); this.swap = null; this.inner.dispose(); }
}

export type PhotorealStage = { preset: PhotorealPreset; revert(): void; dispose(): void; stats(): { lights: number; shadowMapSize: number; softwareRendering: boolean } };

export function applyPhotorealStage(renderer: WebGLRenderer, scene: Scene, requested: PhotorealPresetName = 'balanced', hooks: { createEnvironment?: (renderer: WebGLRenderer) => StudioEnvironment } = {}): PhotorealStage | null {
  const caps = detectCapabilities(renderer);
  const preset = selectPhotorealPreset(requested, caps);
  if (!preset) return null; // no safe path: the stock renderer stays exactly as it was
  const previous = { environment: scene.environment, environmentIntensity: scene.environmentIntensity, exposure: renderer.toneMappingExposure };
  const studio: StudioEnvironment = hooks.createEnvironment ? hooks.createEnvironment(renderer) : createStudioEnvironment(renderer, [...PHOTOREAL_PANELS]);
  scene.environment = studio.texture;
  scene.environmentIntensity = preset.envMapIntensityScale;
  renderer.toneMappingExposure = preset.exposure;

  const rig = new Group(); rig.name = 'photoreal-studio-rig';
  const key = new DirectionalLight(0xfff1de, 2.6);
  key.position.set(-6, 9, 6); key.castShadow = true;
  key.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
  key.shadow.camera.left = key.shadow.camera.bottom = -7; key.shadow.camera.right = key.shadow.camera.top = 7;
  key.shadow.camera.far = 40; key.shadow.bias = -0.0004; key.shadow.radius = 4;
  const fill = new DirectionalLight(0xe8efff, 0.7); fill.position.set(8, 4, 7);
  const rim = new DirectionalLight(0xd6e4ff, 1.5); rim.position.set(5, 6, -9);
  rig.add(key, fill, rim);
  let ground: Mesh | null = null;
  if (preset.contactShadow) {
    ground = new Mesh(new PlaneGeometry(60, 60), new ShadowMaterial({ opacity: 0.32 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -1.55; ground.receiveShadow = true; ground.name = 'photoreal-contact-shadow';
    rig.add(ground);
  }
  scene.add(rig);
  // Restoring the stage and releasing the procedural environment are separate one-shot
  // duties: revert() restores, dispose() restores (if needed) AND releases. A single shared
  // guard made revert()->dispose() skip the studio dispose, leaking its texture for the
  // life of the page.
  let stageRestored = false;
  let studioDisposed = false;
  const restoreStage = () => {
    if (stageRestored) return; stageRestored = true;
    scene.environment = previous.environment; scene.environmentIntensity = previous.environmentIntensity; renderer.toneMappingExposure = previous.exposure;
    scene.remove(rig); key.shadow.map?.dispose(); (ground?.material as ShadowMaterial | undefined)?.dispose(); ground?.geometry.dispose();
  };
  const disposeStudio = () => { if (studioDisposed) return; studioDisposed = true; studio.dispose(); };
  return {
    preset,
    revert() { restoreStage(); },
    dispose() { restoreStage(); disposeStudio(); },
    stats: () => ({ lights: 3, shadowMapSize: preset.shadowMapSize, softwareRendering: caps.softwareRendering }),
  };
}
