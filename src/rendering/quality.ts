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
