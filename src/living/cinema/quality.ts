import type { DeviceCaps } from "../../rendering/quality";

/**
 * Cinema quality tiers. `studio` is the Golden Frame look (AO, bloom, 2048 px soft shadows, mirrored floor, contact shadow, DPR up to 2).
 * `balanced` keeps the look at a lower price; `light` keeps lighting and reflections but drops every extra pass.
 * The tier is picked from the device, never silently raised: the runtime only steps DOWN (`degrade`) when frames are slow, and says so.
 */
export type CinemaTier = 'studio' | 'balanced' | 'light';
export type CinemaSettings = {
  tier: CinemaTier;
  maxPixelRatio: number;
  msaa: number;
  ao: boolean; bloom: boolean; grade: boolean;
  shadows: boolean; shadowMapSize: number; softShadowRadius: number;
  mirror: boolean; contact: boolean; contactResolution: number;
  environmentIntensity: number;
  exposure: number;
};

export const CINEMA_TIERS: Record<CinemaTier, CinemaSettings> = {
  studio: { tier: 'studio', maxPixelRatio: 2, msaa: 4, ao: true, bloom: true, grade: true, shadows: true, shadowMapSize: 2048, softShadowRadius: 5, mirror: true, contact: true, contactResolution: 512, environmentIntensity: 1, exposure: 1.15 },
  balanced: { tier: 'balanced', maxPixelRatio: 1.5, msaa: 4, ao: false, bloom: true, grade: true, shadows: true, shadowMapSize: 1024, softShadowRadius: 4, mirror: true, contact: true, contactResolution: 256, environmentIntensity: 1, exposure: 1.15 },
  light: { tier: 'light', maxPixelRatio: 1, msaa: 0, ao: false, bloom: false, grade: false, shadows: false, shadowMapSize: 512, softShadowRadius: 2, mirror: false, contact: true, contactResolution: 256, environmentIntensity: 1, exposure: 1 },
};

/** Device-aware default. Software rasterisers and small-texture devices start at `light`; nobody is moved up automatically. */
export function pickTier(caps: Pick<DeviceCaps, 'software' | 'maxTextureSize'>, requested?: CinemaTier | null): CinemaTier {
  if (requested && requested in CINEMA_TIERS) return requested;
  if (caps.software || caps.maxTextureSize < 4096) return 'light';
  if (caps.maxTextureSize < 8192) return 'balanced';
  return 'studio';
}

/** One step down from the current settings, or null at the floor. Order: ambient occlusion, then bloom + smaller shadows + DPR 1, then no shadows and no mirror. */
export function stepDown(settings: CinemaSettings, level: 0 | 1 | 2): CinemaSettings {
  const next = { ...settings };
  if (level >= 1) next.ao = false;
  if (level >= 2) { next.bloom = false; next.shadowMapSize = Math.min(next.shadowMapSize, 1024); next.maxPixelRatio = 1; next.msaa = Math.min(next.msaa, 2); }
  return next;
}
