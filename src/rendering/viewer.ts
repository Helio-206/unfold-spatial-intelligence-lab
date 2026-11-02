import * as THREE from 'three';
import { FrameMonitor, readDeviceCaps, resolveProfile, type FrameInfo, type DeviceCaps, type Degrade, type QualityProfile, type VisualQuality } from './quality';
import { configureRenderer, createStage, disposeEnvironment, type StageHandle } from './stage';
import { disposeMaterials } from './materials';

/**
 * Everything a viewer needs to run the two visual profiles, in one place: renderer settings, the lights of the active profile, the model fitting of
 * the shadows, the device-aware shadow size, and the runtime monitor that lowers presentation cost when frames are slow. The editor owns one of these.
 *
 * Switching profiles replaces the stage (the previous one is disposed first, so lights and environment pointers never pile up) and leaves the scene's
 * data, the camera and the selection alone: the caller only has to rebuild the group with `controller.quality`.
 */
export type RenderingController = {
  readonly quality: VisualQuality;
  readonly caps: DeviceCaps;
  readonly profile: QualityProfile;
  readonly degrade: Degrade;
  /** returns false when the profile was already active */
  setQuality(quality: VisualQuality): boolean;
  fit(bounds: THREE.Box3): void;
  /** call from the render function; returns the new degrade step when the monitor decides to lower the cost */
  sampleFrame(now: number, info?: FrameInfo): Degrade | null;
  /**
   * Presentation only: true on every other frame while the monitor still has work to do. On those frames the caller must call `syncGpu()` right after
   * rendering and pass the elapsed time to `sampleFrame`, because a CPU timer around `render()` does not see GPU time (the call returns when the
   * commands are queued). Technical never probes, and probing stops once the lowest step is reached.
   */
  wantsProbe(): boolean;
  /** waits for the GPU to finish what was just drawn (a 1x1 read); the cost is only paid on probe frames */
  syncGpu(): void;
  /** costs currently in the monitor's window, for diagnostics */
  samples(): readonly number[];
  dispose(): void;
};

export function createRenderingController(scene: THREE.Scene, renderer: THREE.WebGLRenderer, initial: VisualQuality = 'technical'): RenderingController {
  const caps = readDeviceCaps(renderer.getContext());
  const monitor = new FrameMonitor({ window: 45 }); // probes come every other frame: 30 samples are about 60 frames
  let probeTurn = false; const probePixel = new Uint8Array(4);
  let quality = initial; let degrade: Degrade = 0; let stage: StageHandle | undefined; let bounds: THREE.Box3 | undefined; let disposed = false;

  const apply = () => {
    stage?.dispose();
    configureRenderer(renderer, quality, caps, degrade);
    stage = createStage(scene, quality, renderer, caps);
    stage.degrade(degrade);
    if (bounds) stage.fit(bounds);
  };
  apply();

  return {
    get quality() { return quality; }, caps, get profile() { return resolveProfile(quality, caps, degrade); }, get degrade() { return degrade; },
    setQuality(next) {
      if (next === quality || disposed) return false;
      quality = next; degrade = 0; monitor.reset(); apply(); return true;
    },
    fit(box) { bounds = box.clone(); stage?.fit(bounds); },
    samples() { return monitor.samples; },
    wantsProbe() { if (quality !== 'presentation' || disposed || degrade >= 2) return false; probeTurn = !probeTurn; return probeTurn; },
    syncGpu() { const gl = renderer.getContext(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, probePixel); },
    sampleFrame(now, info) {
      if (quality !== 'presentation' || disposed) return null;
      monitor.sample(now, info);
      const step = monitor.check(now);
      if (step) { degrade = step; stage?.degrade(step); configureRenderer(renderer, quality, caps, degrade); }
      return step;
    },
    dispose() {
      if (disposed) return; disposed = true;
      stage?.dispose(); stage = undefined;
      disposeEnvironment(renderer);
      disposeMaterials(); // shared libraries are released once, at final teardown
    },
  };
}
