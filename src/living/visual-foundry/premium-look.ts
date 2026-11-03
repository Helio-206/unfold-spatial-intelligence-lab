/**
 * Premium look: a reusable, reversible material profile for the Visual Foundry machine, plus the studio specification (lights, environment panels, floor,
 * grade) that stages use to show it. It lives next to the Foundry so that the Cinema, the Living Workspace and future reconstructions apply the SAME
 * profile instead of re-deriving materials and lighting.
 *
 * What it does and does not do:
 *  - It never edits `materials.ts` or the Foundry's materials: `applyPremiumLook` assigns CLONES (one per Foundry material key, plus one per accent zone)
 *    to the meshes, shares the textures, and `revert()` puts the original material objects back and disposes only the clones. Applying twice replaces the
 *    previous application; nothing accumulates.
 *  - It touches materials only. Geometry, transforms, `userData.partId` / `displayOnly`, mesh names, canonical ids, picking and hose routing are untouched,
 *    and the clones keep `userData.materialKey`.
 *  - Accent zones (the UNFOLD fold orange, #FF5A1F) are drawn by a small shader patch from the mesh's own object-space position, so they need no extra
 *    geometry. They mark functional and structural details only: the handrail and cab frame, the counterweight stripe and the bucket linkage.
 *  - The palette is object colour, not UI colour. No brand, logo or text of any manufacturer is represented.
 */
import { Color, SRGBColorSpace, type Material, type Mesh, type MeshPhysicalMaterial, type Object3D, type Vector3Tuple } from 'three';
import type { MaterialKey } from './materials';

export const PREMIUM_LOOK_ID = 'unfold.premium-look' as const;
export const FOLD_ORANGE = '#FF5A1F'; // design-system/tokens.css --fold

type Params = {
  color: string; metalness?: number; roughness?: number; clearcoat?: number; clearcoatRoughness?: number; envMapIntensity?: number;
  opacity?: number; specularIntensity?: number; sheen?: number; sheenRoughness?: number; sheenColor?: string;
};

/** Deep industrial graphite as the dominant colour; steel, chrome, rubber and dark glass as supporting finishes. */
export const PREMIUM_PALETTE: Record<MaterialKey, Params> = {
  paint: { color: '#3A3E46', metalness: 0.18, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.07, envMapIntensity: 1.25 },
  paintDark: { color: '#2A2D33', metalness: 0.2, roughness: 0.4, clearcoat: 0.8, clearcoatRoughness: 0.12, envMapIntensity: 1.15 },
  castDark: { color: '#3E4044', metalness: 0.92, roughness: 0.48, envMapIntensity: 1.1 },
  shoe: { color: '#4A4C51', metalness: 0.85, roughness: 0.5, envMapIntensity: 1 },
  machined: { color: '#BCBFC4', metalness: 1, roughness: 0.2, envMapIntensity: 1.35 },
  brushed: { color: '#9A9DA3', metalness: 1, roughness: 0.3, envMapIntensity: 1.25 },
  steelTube: { color: '#8F9298', metalness: 1, roughness: 0.26, envMapIntensity: 1.3 },
  chrome: { color: '#F4F5F7', metalness: 1, roughness: 0.035, envMapIntensity: 1.6 },
  rubber: { color: '#0B0C0E', metalness: 0, roughness: 0.52, clearcoat: 0.18, clearcoatRoughness: 0.4, envMapIntensity: 1.1, specularIntensity: 0.9 },
  trim: { color: '#0C0D10', metalness: 0, roughness: 0.4, clearcoat: 0.2, clearcoatRoughness: 0.35, envMapIntensity: 1.1 },
  interior: { color: '#07080A', metalness: 0, roughness: 0.8 },
  glass: { color: '#10161C', metalness: 0, roughness: 0.02, clearcoat: 1, clearcoatRoughness: 0.01, envMapIntensity: 2.4, opacity: 0.62, specularIntensity: 1 },
};
const ACCENT: Params = { color: FOLD_ORANGE, metalness: 0.2, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.3 };

/** A zone of one Foundry mesh (named `<partId>:<materialKey>`) that takes the accent colour. Boxes are in the mesh's own object space (the part frame, metres). */
export type AccentZone = { mesh: string; id: string; description: string; box?: { min: Vector3Tuple; max: Vector3Tuple }; whole?: true };
export const ACCENT_ZONES: readonly AccentZone[] = [
  { mesh: 'upper_body:paintDark', id: 'handrail-and-cab-frame', description: 'Handrail, cab pillars and frame: everything dark above the deck (deck top is y = 0.12).', box: { min: [-3, 0.25, -3], max: [3, 3, 3] } },
  { mesh: 'upper_body:paint', id: 'counterweight-stripe', description: 'Horizontal stripe across the rear of the counterweight.', box: { min: [-3, 0.27, -3], max: [-1.43, 0.35, 3] } },
  { mesh: 'bucket_link:paint', id: 'bucket-link', description: 'Bucket linkage (functional).', whole: true },
  { mesh: 'idler_link:paint', id: 'idler-link', description: 'Idler link (functional).', whole: true },
];

/** Studio specification, plain data so that any stage (Cinema, Workspace) can build the same set without copying numbers. */
export const PREMIUM_STUDIO = {
  /** emissive panels baked into the environment map; `absorber` panels are black and stand in front of a panel, giving structured, architectural reflections */
  environment: [
    { id: 'key', kind: 'panel', size: [10, 5], position: [-8, 9, 8], color: '#fff3e4', radiance: 12 },
    { id: 'strip-left', kind: 'panel', size: [1.2, 10], position: [-13, 4.5, -1], color: '#ffffff', radiance: 16 },
    { id: 'strip-right', kind: 'panel', size: [1.2, 10], position: [13, 4.5, 3], color: '#f0f2f5', radiance: 11 },
    { id: 'rim-back', kind: 'panel', size: [1.1, 9], position: [9, 5, -12], color: '#d3e0f5', radiance: 12 },
    { id: 'rim-back-left', kind: 'panel', size: [1.1, 9], position: [-9, 5, -12], color: '#d6e4ff', radiance: 9 },
    { id: 'top', kind: 'panel', size: [13, 8], position: [0, 13, 0], color: '#ffffff', radiance: 5 },
    { id: 'wall-glow', kind: 'panel', size: [34, 9], position: [0, 4.6, -17], color: '#bfc3c9', radiance: 0.8 },
    { id: 'pillar-1', kind: 'absorber', size: [1.6, 11], position: [-6, 5, -16.5], color: '#000000', radiance: 0 },
    { id: 'pillar-2', kind: 'absorber', size: [1.6, 11], position: [5, 5, -16.5], color: '#000000', radiance: 0 },
    { id: 'pillar-3', kind: 'absorber', size: [1.6, 11], position: [14, 5, -16.5], color: '#000000', radiance: 0 },
    { id: 'front-soft', kind: 'panel', size: [16, 6], position: [8, 3.5, 15], color: '#f4f2ee', radiance: 3.2 },
    { id: 'bounce', kind: 'panel', size: [14, 1.6], position: [0, 0.6, 12], color: '#ffd9b0', radiance: 1.4 },
  ],
  lights: {
    key: { color: '#fff1e0', intensity: 5.2, direction: [-0.5, 0.85, 0.55] },
    rim: { color: '#eaf0ff', intensity: 3.4, direction: [0.55, 0.55, -0.8] },
    kick: { color: '#c9d6f2', intensity: 0.6, direction: [-0.75, 0.5, -0.55] },
    fill: { sky: '#aab6c8', ground: '#1b1814', intensity: 0.32 },
    floorPool: { color: '#ffe9d2', intensity: 420, angle: 0.5, penumbra: 1, height: 15 },
  },
  floor: { color: '#0C0E11', roughness: 0.5, metalness: 0.03, mirrorOpacity: 0.86 },
  backdrop: { horizon: '#2B3139', zenith: '#10141A' },
  grade: { contrast: 1.12, vignette: 0.44, grain: 0.01, bloomStrength: 0.16, bloomThreshold: 1.25, exposure: 1.1 },
  environmentIntensity: 1.1,
} as const;

export type PremiumLookHandle = {
  readonly id: typeof PREMIUM_LOOK_ID;
  /** clones created by this application (materials), for counts and tests */
  readonly materials: readonly MeshPhysicalMaterial[];
  readonly accentZones: readonly string[];
  readonly active: boolean;
  /** puts the original materials back and disposes the clones; idempotent */
  revert(): void;
};

const srgb = (hex: string) => new Color().setStyle(hex, SRGBColorSpace);
const isPhysical = (m: Material): m is MeshPhysicalMaterial => (m as MeshPhysicalMaterial).isMeshPhysicalMaterial === true;
const applied = new WeakMap<Object3D, PremiumLookHandle>();

function configure(m: MeshPhysicalMaterial, p: Params): void {
  m.color.copy(srgb(p.color)); if (p.metalness !== undefined) m.metalness = p.metalness; if (p.roughness !== undefined) m.roughness = p.roughness;
  m.clearcoat = p.clearcoat ?? 0; m.clearcoatRoughness = p.clearcoatRoughness ?? 0; if (p.envMapIntensity !== undefined) m.envMapIntensity = p.envMapIntensity;
  if (p.specularIntensity !== undefined) m.specularIntensity = p.specularIntensity;
  if (p.opacity !== undefined) { m.opacity = p.opacity; m.transparent = p.opacity < 1; if (m.transparent) m.depthWrite = false; }
  m.needsUpdate = true;
}

/** Patches a cloned material so that the zone (or the whole mesh) is drawn in the accent colour, from the mesh's own object-space position. */
function accentShader(m: MeshPhysicalMaterial, zone: AccentZone): void {
  const accent = srgb(FOLD_ORANGE);
  const min = zone.box?.min ?? [-1e4, -1e4, -1e4]; const max = zone.box?.max ?? [1e4, 1e4, 1e4];
  m.userData.accentZone = zone.id;
  m.customProgramCacheKey = () => `premium-accent:${zone.id}`;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.accentColor = { value: accent }; shader.uniforms.accentMin = { value: min }; shader.uniforms.accentMax = { value: max };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vAccentPos;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvAccentPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vAccentPos; uniform vec3 accentColor; uniform vec3 accentMin; uniform vec3 accentMax;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n{ vec3 a = step(accentMin, vAccentPos) * step(vAccentPos, accentMax); diffuseColor.rgb = mix(diffuseColor.rgb, accentColor, a.x * a.y * a.z); }');
  };
}

/**
 * Applies the premium look to every Foundry mesh under `root`. Returns a handle; `handle.revert()` restores the original materials exactly. Calling it again
 * on the same root first reverts the previous application.
 */
export function applyPremiumLook(root: Object3D): PremiumLookHandle {
  applied.get(root)?.revert();
  const originals = new Map<Mesh, Material | Material[]>(); const clones = new Map<string, MeshPhysicalMaterial>(); const all: MeshPhysicalMaterial[] = []; const zones: string[] = [];
  const clone = (key: string, source: MeshPhysicalMaterial, params: Params, zone?: AccentZone) => {
    let m = clones.get(key);
    if (!m) { m = source.clone() as MeshPhysicalMaterial; configure(m, params); m.userData = { ...source.userData, premiumLook: PREMIUM_LOOK_ID }; m.name = `${source.name}+premium${zone ? `:${zone.id}` : ''}`; if (zone) accentShader(m, zone); clones.set(key, m); all.push(m); }
    return m;
  };
  root.traverse((o) => {
    const mesh = o as Mesh; if (!mesh.isMesh || Array.isArray(mesh.material) || !isPhysical(mesh.material)) return;
    const key = mesh.material.userData.materialKey as MaterialKey | undefined; if (!key || !(key in PREMIUM_PALETTE)) return; // not a Foundry material: left alone
    originals.set(mesh, mesh.material);
    const zone = ACCENT_ZONES.find((z) => z.mesh === mesh.name);
    if (zone) { mesh.material = clone(`${key}|${zone.id}`, mesh.material, { ...PREMIUM_PALETTE[key], ...(zone.whole ? ACCENT : { color: PREMIUM_PALETTE[key].color }) }, zone); zones.push(zone.id); }
    else mesh.material = clone(key, mesh.material, PREMIUM_PALETTE[key]);
  });
  let active = true;
  const handle: PremiumLookHandle = {
    id: PREMIUM_LOOK_ID, materials: all, accentZones: zones,
    get active() { return active; },
    revert() { if (!active) return; active = false; for (const [mesh, material] of originals) mesh.material = material; for (const m of all) m.dispose(); originals.clear(); clones.clear(); if (applied.get(root) === handle) applied.delete(root); },
  };
  applied.set(root, handle);
  return handle;
}

export const premiumLookOf = (root: Object3D): PremiumLookHandle | undefined => applied.get(root);
