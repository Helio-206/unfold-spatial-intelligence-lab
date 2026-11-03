import type { MaterialV2 } from './contracts-v2';

/**
 * Physical values for a V2 material profile. The model proposes a profile, a colour and three numbers; the profile decides what those numbers may be,
 * so a "rubber" that came back metalness 1 is still rubber and a "metal" that came back rough is still a metal.
 *
 * - metal      bare metal: conductive, polished enough to show the studio's soft boxes
 * - industrial painted or coated hardware: some metal underneath, a clear coat on top, never a mirror
 * - accent     glossy paint (signal colours)
 * - organic    wood, fabric, leather, plant: matte, non-metallic, with a soft sheen at grazing angles
 * - rubber     matte, no clear coat
 * - glass      smooth, coated, translucent, does not write depth so what is behind stays visible
 * - neutral    plastic-like default; never a mirror, never chalk
 * Presentation values only: the plan keeps the model's numbers; this is how they are shown.
 */
export type MaterialValues = { metalness: number; roughness: number; clearcoat: number; sheen: number; opacity: number; transparent: boolean; depthWrite: boolean; ior: number };
const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

export function materialValues(spec: MaterialV2): MaterialValues {
  const base: MaterialValues = { metalness: 0, roughness: 0.5, clearcoat: 0, sheen: 0, opacity: 1, transparent: false, depthWrite: true, ior: 1.46 };
  switch (spec.profile) {
    case 'metal': return { ...base, metalness: clamp(Math.max(spec.metalness, 0.88), 0, 1), roughness: clamp(spec.roughness, 0.18, 0.42), clearcoat: clamp(spec.clearcoat, 0, 0.3) };
    case 'industrial': return { ...base, metalness: clamp(spec.metalness, 0.1, 0.55), roughness: clamp(spec.roughness, 0.3, 0.6), clearcoat: clamp(Math.max(spec.clearcoat, 0.35), 0, 1) };
    case 'accent': return { ...base, metalness: clamp(spec.metalness, 0, 0.2), roughness: clamp(spec.roughness, 0.25, 0.45), clearcoat: clamp(Math.max(spec.clearcoat, 0.6), 0, 1) };
    case 'organic': return { ...base, metalness: 0, roughness: clamp(Math.max(spec.roughness, 0.58), 0, 0.92), clearcoat: clamp(spec.clearcoat, 0, 0.15), sheen: 0.35 };
    case 'rubber': return { ...base, metalness: 0, roughness: clamp(Math.max(spec.roughness, 0.78), 0, 1), clearcoat: 0 };
    case 'glass': return { ...base, metalness: 0, roughness: clamp(spec.roughness, 0.02, 0.08), clearcoat: 1, opacity: 0.35, transparent: true, depthWrite: false, ior: 1.5 };
    case 'neutral': return { ...base, metalness: clamp(spec.metalness, 0, 0.3), roughness: clamp(spec.roughness, 0.25, 0.9), clearcoat: clamp(spec.clearcoat, 0, 0.3) };
  }
}
