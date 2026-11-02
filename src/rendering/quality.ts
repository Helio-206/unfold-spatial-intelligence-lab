/**
 * Visual quality profiles. Both profiles are projections of exactly the same scene data: they change materials,
 * detail and lighting, never positions, sizes or which nodes exist.
 *
 * technical    — clarity and speed. Flat neutral materials, component boundaries readable, no shadows, no textures.
 * presentation — PBR materials with procedural textures, soft shadows, environment reflections, frames and glass.
 */
export type VisualQuality = 'technical' | 'presentation';

export type QualityProfile = {
  quality: VisualQuality;
  /** procedural normal / roughness / colour maps */
  textures: boolean;
  /** shadow-casting key light and receiving surfaces */
  shadows: boolean;
  shadowMapSize: number;
  /** small environment map for glass and metal response (generated once, shared) */
  environment: boolean;
  environmentIntensity: number;
  /** filler blocks that close the outer notch of two walls meeting at a right angle (distinguishable, see architecture.ts) */
  cornerFillers: boolean;
  /** frames and glass built from existing door/window nodes when no module asset is supplied */
  openingDetail: boolean;
  /** dashed outline on geometry that is not human-confirmed */
  provisionalOutline: boolean;
  toneMapping: 'none' | 'aces';
  exposure: number;
  antialias: boolean;
  /** upper bound for the renderer pixel ratio */
  maxPixelRatio: number;
};

export const QUALITY_PROFILES: Record<VisualQuality, QualityProfile> = {
  technical: {
    quality: 'technical', textures: false, shadows: false, shadowMapSize: 1024, environment: false, environmentIntensity: 0,
    cornerFillers: false, openingDetail: true, provisionalOutline: true, toneMapping: 'none', exposure: 1, antialias: true, maxPixelRatio: 1.7,
  },
  presentation: {
    quality: 'presentation', textures: true, shadows: true, shadowMapSize: 2048, environment: true, environmentIntensity: 0.32,
    cornerFillers: true, openingDetail: true, provisionalOutline: true, toneMapping: 'aces', exposure: 0.92, antialias: true, maxPixelRatio: 2,
  },
};

export const profileFor = (quality: VisualQuality): QualityProfile => QUALITY_PROFILES[quality];

/**
 * Adaptive choice without touching the application: given recent frame times (ms) in the current mode, say which mode to use.
 * Presentation drops to technical when the 95th percentile is slower than `slowMs`; technical goes up again only with a lot of headroom,
 * so the choice does not flap.
 */
export function adaptQuality(current: VisualQuality, frameMs: readonly number[], options: { slowMs?: number; fastMs?: number; minSamples?: number } = {}): VisualQuality {
  const { slowMs = 24, fastMs = 9, minSamples = 30 } = options;
  if (frameMs.length < minSamples) return current;
  const sorted = [...frameMs].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
  if (current === 'presentation' && p95 > slowMs) return 'technical';
  if (current === 'technical' && p95 < fastMs) return 'presentation';
  return current;
}

/** What the device can do, read once from the WebGL context. */
export type DeviceCaps = { maxTextureSize: number; maxSamples: number; software: boolean; renderer: string };

export function readDeviceCaps(gl: WebGLRenderingContext | WebGL2RenderingContext): DeviceCaps {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  return {
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    maxSamples: 'MAX_SAMPLES' in gl ? ((gl as WebGL2RenderingContext).getParameter((gl as WebGL2RenderingContext).MAX_SAMPLES) as number) : 0,
    software: /swiftshader|llvmpipe|software|softpipe|basic render/i.test(renderer),
    renderer,
  };
}

/**
 * The profile as it should actually be applied on this device. Presentation keeps its look everywhere, but its costly parts follow the hardware:
 * a software or small-texture device gets a 1024 px shadow map and a pixel ratio of 1; a device with 8k+ textures and a ratio above 1.5 can
 * afford 4096 px shadows only if `allowHeavy` (never the default). `degrade` is the extra reduction chosen by the runtime monitor.
 */
export type Degrade = 0 | 1 | 2;
export function resolveProfile(quality: VisualQuality, caps?: DeviceCaps, degrade: Degrade = 0): QualityProfile {
  const base = { ...profileFor(quality) };
  if (quality === 'technical' || !caps) return base;
  if (caps.software || caps.maxTextureSize < 4096) { base.shadowMapSize = 1024; base.maxPixelRatio = 1; }
  else if (caps.maxTextureSize < 8192) base.shadowMapSize = Math.min(base.shadowMapSize, 2048);
  if (degrade >= 1) base.shadowMapSize = Math.max(512, base.shadowMapSize / 2);
  if (degrade >= 2) { base.shadows = false; base.maxPixelRatio = Math.min(base.maxPixelRatio, 1); }
  return base;
}

/**
 * Watches frame times WITHOUT a loop of its own: the viewer calls `sample(now)` from its existing render function. Only frames drawn back to back
 * (gap under `contiguousMs`, i.e. during a drag or an animation) count, so an idle viewer produces no samples. `check()` returns a degrade step
 * at most once per `cooldownMs`, and never a step that undoes an earlier one (no oscillation: quality only goes down on its own; the user
 * can pick Technical or switch the profile again to reset).
 */
export class FrameMonitor {
  private last = 0; private readonly times: number[] = []; private level: Degrade = 0; private lastChange = 0;
  constructor(private readonly options: { window?: number; slowMs?: number; contiguousMs?: number; cooldownMs?: number } = {}) {}
  sample(now: number): void {
    const { window = 90, contiguousMs = 80 } = this.options;
    const gap = now - this.last; this.last = now;
    if (gap <= 0 || gap > contiguousMs) return;
    this.times.push(gap); if (this.times.length > window) this.times.shift();
  }
  check(now: number): Degrade | null {
    const { window = 90, slowMs = 26, cooldownMs = 4000 } = this.options;
    if (this.times.length < window * 0.66 || now - this.lastChange < cooldownMs || this.level >= 2) return null;
    const sorted = [...this.times].sort((a, b) => a - b);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
    if (p95 <= slowMs) return null;
    this.level = (this.level + 1) as Degrade; this.lastChange = now; this.times.length = 0;
    return this.level;
  }
  reset(): void { this.level = 0; this.times.length = 0; this.lastChange = 0; }
  get degrade(): Degrade { return this.level; }
}
