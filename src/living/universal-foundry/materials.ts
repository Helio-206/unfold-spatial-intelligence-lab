/**
 * Universal Foundry materials: semantic finishes with PBR parameters and SEEDED procedural maps (roughness, height -> bump and normal, albedo variation).
 * Extends src/living/visual-foundry/materials.ts, whose seeded micro-roughness fields (turned, brushed, cast, paint, rubber) are reused for the metals, rubber and
 * paint; the finishes that library never needed (wood, fabric, leather, ceramic, concrete, plastic, wall paint) are generated here. No canvas, no network, no
 * texture download: every map is built from a PRNG into a DataTexture, so Node tests and the browser produce the same bytes.
 * Maps are shared per finish (colour is a material parameter, not baked in), 128-256 px, so a scene with every finish costs a few MB.
 */
import { Color, DataTexture, DoubleSide, FrontSide, LinearFilter, LinearMipmapLinearFilter, MeshPhysicalMaterial, RepeatWrapping, RGBAFormat, SRGBColorSpace, UnsignedByteType, type Texture } from 'three';
import { finishPixels, rng, type Finish } from '../visual-foundry/materials';

export const MATERIAL_KINDS = ['paintedMetal', 'steelBrushed', 'steelMachined', 'chrome', 'glass', 'rubber', 'leather', 'plastic', 'plasticGloss', 'wood', 'fabric', 'ceramic', 'concrete', 'paintedWall', 'emissive', 'screen', 'trim'] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];
export type MaterialSpec = { kind: MaterialKind; /** sRGB hex; each kind has a sensible default */ color?: string; variant?: string };
export const mat = (kind: MaterialKind, color?: string, variant?: string): MaterialSpec => ({ kind, ...(color ? { color } : {}), ...(variant ? { variant } : {}) });

type Maps = { rough: DataTexture; bump?: DataTexture; normal?: DataTexture; variation?: DataTexture };
type Preset = { color: string; metalness: number; roughness: number; clearcoat?: number; clearcoatRoughness?: number; sheen?: number; sheenRoughness?: number; envMapIntensity?: number; transparent?: boolean; opacity?: number; ior?: number; emissive?: string; emissiveIntensity?: number; doubleSided?: boolean; bumpScale?: number; normalScale?: number; repeat?: [number, number]; variation?: number; description: string };

export const PRESETS: Record<MaterialKind, Preset> = {
  paintedMetal: { color: '#C9CDD2', metalness: 0.15, roughness: 0.36, clearcoat: 0.75, clearcoatRoughness: 0.14, variation: 0.045, repeat: [3, 3], description: 'Painted sheet metal, clear-coated; panel-to-panel tone' },
  steelBrushed: { color: '#8E9196', metalness: 1, roughness: 0.34, repeat: [2, 6], description: 'Brushed steel (directional micro-roughness)' },
  steelMachined: { color: '#A9ABAE', metalness: 1, roughness: 0.26, repeat: [1, 12], description: 'Turned and machined steel (concentric micro-roughness)' },
  chrome: { color: '#D9DADC', metalness: 1, roughness: 0.05, envMapIntensity: 1.15, description: 'Polished chrome' },
  glass: { color: '#3A4A57', metalness: 0, roughness: 0.04, transparent: true, opacity: 0.34, ior: 1.52, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.3, doubleSided: true, description: 'Tinted glazing: reflective and see-through' },
  rubber: { color: '#121316', metalness: 0, roughness: 0.8, bumpScale: 0.15, repeat: [2, 8], description: 'Rubber, fine grain' },
  leather: { color: '#4A2E22', metalness: 0, roughness: 0.52, sheen: 0.4, sheenRoughness: 0.5, clearcoat: 0.15, clearcoatRoughness: 0.5, bumpScale: 0.6, normalScale: 0.8, repeat: [3, 3], variation: 0.08, description: 'Pebbled leather: pores, soft sheen' },
  plastic: { color: '#2A2D33', metalness: 0, roughness: 0.55, bumpScale: 0.12, repeat: [4, 4], description: 'Moulded plastic, matte fine grain' },
  plasticGloss: { color: '#E8E6E1', metalness: 0, roughness: 0.2, clearcoat: 0.6, clearcoatRoughness: 0.1, repeat: [2, 2], description: 'Glossy moulded plastic' },
  wood: { color: '#A87444', metalness: 0, roughness: 0.55, clearcoat: 0.25, clearcoatRoughness: 0.35, bumpScale: 0.5, normalScale: 0.7, repeat: [1, 1], variation: 0.2, description: 'Wood with grain, rings and pores' },
  fabric: { color: '#7C8794', metalness: 0, roughness: 0.92, sheen: 0.3, sheenRoughness: 0.55, bumpScale: 0.35, normalScale: 1, repeat: [3, 3], variation: 0.06, description: 'Woven fabric with sheen' },
  ceramic: { color: '#F1EFEA', metalness: 0, roughness: 0.16, clearcoat: 0.9, clearcoatRoughness: 0.06, bumpScale: 0.05, repeat: [2, 2], description: 'Glazed ceramic' },
  concrete: { color: '#9B9C98', metalness: 0, roughness: 0.9, bumpScale: 0.9, normalScale: 0.9, repeat: [2, 2], variation: 0.14, description: 'Concrete: blotches and pits' },
  paintedWall: { color: '#E6E1D6', metalness: 0, roughness: 0.82, bumpScale: 0.12, repeat: [3, 3], variation: 0.03, description: 'Matte wall paint, roller texture' },
  emissive: { color: '#FFF3D6', metalness: 0, roughness: 0.3, emissive: '#FFE7A8', emissiveIntensity: 1.1, description: 'Lamp / indicator lens' },
  screen: { color: '#06080C', metalness: 0, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.03, emissive: '#102338', emissiveIntensity: 0.55, envMapIntensity: 1.2, description: 'Display glass: dark, glossy, faint backlight' },
  trim: { color: '#101216', metalness: 0, roughness: 0.55, bumpScale: 0.12, repeat: [2, 2], description: 'Black trim, seals, grilles' },
};

const SIZE = 192;
const srgb = (hex: string) => new Color().setStyle(hex, SRGBColorSpace);
const wrap = (x: number, n: number) => ((x % n) + n) % n;
const grey = (field: Float32Array, size: number, scale = 255) => { const out = new Uint8Array(size * size * 4); for (let i = 0; i < field.length; i++) { const v = Math.max(0, Math.min(255, Math.round(field[i]! * scale))); out.set([v, v, v, 255], i * 4); } return out; };
/** Smooth value noise on a wrapping lattice, seeded. */
function valueNoise(size: number, cell: number, R: () => number): (x: number, y: number) => number {
  const n = Math.max(2, Math.ceil(size / cell)), lat = Float32Array.from({ length: n * n }, () => R());
  return (x, y) => { const fx = (x / size) * n, fy = (y / size) * n, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy, s = (t: number) => t * t * (3 - 2 * t), g = (a: number, b: number) => lat[wrap(b, n) * n + wrap(a, n)]!; const a = g(ix, iy) + (g(ix + 1, iy) - g(ix, iy)) * s(tx), b = g(ix, iy + 1) + (g(ix + 1, iy + 1) - g(ix, iy + 1)) * s(tx); return a + (b - a) * s(ty); };
}

/** Height field in [0, 1] for a finish (what bump and normal are derived from, and what drives roughness). */
export function heightField(kind: MaterialKind, size = SIZE): Float32Array {
  const R = rng(MATERIAL_KINDS.indexOf(kind) * 104729 + 31), h = new Float32Array(size * size);
  const set = (f: (x: number, y: number) => number) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = Math.max(0, Math.min(1, f(x, y))); };
  if (kind === 'wood') {
    const warp = valueNoise(size, 40, R), pores = valueNoise(size, 3, R), rings = valueNoise(size, 90, R);
    set((x, y) => { const w = warp(x, y) * 14 + rings(x, y) * 30, grain = 0.5 + 0.5 * Math.sin((y + w) * 0.55) * 0.5 + 0.25 * Math.sin((y + w * 0.7) * 1.9), pore = pores(x * 4, y * 0.6) > 0.78 ? -0.18 : 0; return 0.5 + (grain - 0.5) * 0.5 + pore; });
  } else if (kind === 'fabric') {
    const noise = valueNoise(size, 2, R); set((x, y) => { const warpT = 0.5 + 0.5 * Math.sin(x * Math.PI / 2.4), weft = 0.5 + 0.5 * Math.sin(y * Math.PI / 2.4), over = ((Math.floor(x / 2.4) + Math.floor(y / 2.4)) & 1) === 0; return 0.35 + 0.4 * (over ? warpT : weft) + (noise(x, y) - 0.5) * 0.1; });
  } else if (kind === 'leather') {
    const pts = Array.from({ length: 420 }, () => [R() * size, R() * size] as const); // Worley cells = pebble grain
    set((x, y) => { let d1 = 1e9, d2 = 1e9; for (const [px, py] of pts) { const dx = Math.min(Math.abs(x - px), size - Math.abs(x - px)), dy = Math.min(Math.abs(y - py), size - Math.abs(y - py)), d = dx * dx + dy * dy; if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; } return 0.35 + Math.min(1, (Math.sqrt(d2) - Math.sqrt(d1)) / 3.2) * 0.55; });
  } else if (kind === 'concrete') {
    const low = valueNoise(size, 70, R), mid = valueNoise(size, 18, R), fine = valueNoise(size, 3, R); const pits = Array.from({ length: 90 }, () => [R() * size, R() * size, 1 + R() * 3] as const);
    set((x, y) => { let v = 0.45 + (low(x, y) - 0.5) * 0.4 + (mid(x, y) - 0.5) * 0.25 + (fine(x, y) - 0.5) * 0.2; for (const [px, py, r] of pits) { const d = Math.hypot(x - px, y - py); if (d < r) v -= 0.35 * (1 - d / r); } return v; });
  } else if (kind === 'ceramic' || kind === 'plasticGloss') { const n = valueNoise(size, 22, R); set((x, y) => 0.5 + (n(x, y) - 0.5) * 0.1); }
  else if (kind === 'paintedWall') { const n = valueNoise(size, 3, R), m = valueNoise(size, 30, R); set((x, y) => 0.5 + (n(x, y) - 0.5) * 0.22 + (m(x, y) - 0.5) * 0.1); }
  else if (kind === 'plastic' || kind === 'trim') { const n = valueNoise(size, 2, R); set((x, y) => 0.5 + (n(x, y) - 0.5) * 0.3); }
  else { // metals, rubber, painted metal reuse the existing seeded finish fields
    const finish: Finish = kind === 'steelBrushed' ? 'brushed' : kind === 'steelMachined' ? 'turned' : kind === 'rubber' ? 'rubber' : 'paint'; const px = finishPixels(finish, 256); for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = px[((y % 256) * 256 + (x % 256)) * 4]! / 255;
  }
  return h;
}

function normalFrom(height: Float32Array, size: number, strength: number): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const hx = height[y * size + wrap(x + 1, size)]! - height[y * size + wrap(x - 1, size)]!, hy = height[wrap(y + 1, size) * size + x]! - height[wrap(y - 1, size) * size + x]!, nx = -hx * strength, ny = -hy * strength, nz = 1, l = Math.hypot(nx, ny, nz);
    out.set([Math.round((nx / l * 0.5 + 0.5) * 255), Math.round((ny / l * 0.5 + 0.5) * 255), Math.round((nz / l * 0.5 + 0.5) * 255), 255], (y * size + x) * 4);
  }
  return out;
}
function variationFrom(kind: MaterialKind, depth: number, size = 128): Uint8Array {
  const R = rng(MATERIAL_KINDS.indexOf(kind) * 7919 + 9173), big = valueNoise(size, 48, R), mid = valueNoise(size, 14, R), out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { let t = big(x, y) * 0.7 + mid(x, y) * 0.3; if (kind === 'wood') t = 0.5 + 0.5 * Math.sin(y * 0.55 + big(x, y) * 9) * 0.6 + (mid(x, y) - 0.5) * 0.4; const v = Math.round((1 - depth * Math.max(0, Math.min(1, t))) * 255); out.set([v, v, v, 255], (y * size + x) * 4); }
  return out;
}
const texture = (data: Uint8Array, size: number, repeat: [number, number], name: string, srgbMap = false): DataTexture => { const t = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType); t.wrapS = t.wrapT = RepeatWrapping; t.magFilter = LinearFilter; t.minFilter = LinearMipmapLinearFilter; t.generateMipmaps = true; t.repeat.set(repeat[0], repeat[1]); t.anisotropy = 4; if (srgbMap) t.colorSpace = SRGBColorSpace; t.needsUpdate = true; t.name = name; return t; };

export type UniversalMaterials = { get(spec: MaterialSpec): MeshPhysicalMaterial; materials(): MeshPhysicalMaterial[]; textures(): Texture[]; describe(kind: MaterialKind): string; dispose(): void };

/**
 * `textures:false` (modo geometria-apenas, usado pelo fitting): materiais sem mapas procedurais.
 * A geometria não depende de texturas; gerá-las a cada avaliação custava ~60% do tempo.
 */
export function createUniversalMaterials(options: { textures?: boolean } = {}): UniversalMaterials {
  const withTextures = options.textures !== false;
  const cache = new Map<string, MeshPhysicalMaterial>(), maps = new Map<MaterialKind, Maps>(), all: Texture[] = [];
  const mapsFor = (kind: MaterialKind): Maps => {
    let m = maps.get(kind); if (m) return m;
    if (!withTextures) { m = {} as Maps; maps.set(kind, m); return m; } const p = PRESETS[kind], rep = p.repeat ?? [2, 2], h = heightField(kind);
    const rough = texture(grey(h, SIZE), SIZE, rep, `rough:${kind}`); m = { rough }; all.push(rough);
    if (p.bumpScale) { m.bump = rough; }
    if (p.normalScale) { const n = texture(normalFrom(h, SIZE, 3), SIZE, rep, `normal:${kind}`); m.normal = n; all.push(n); }
    if (p.variation) { const v = texture(variationFrom(kind, p.variation), 128, [0.5, 0.5], `variation:${kind}`, true); m.variation = v; all.push(v); }
    maps.set(kind, m); return m;
  };
  return {
    get(spec) {
      const key = `${spec.kind}:${spec.color ?? ''}:${spec.variant ?? ''}`, hit = cache.get(key); if (hit) return hit;
      const p = PRESETS[spec.kind], t = mapsFor(spec.kind), color = srgb(spec.color ?? p.color);
      const m = new MeshPhysicalMaterial({ color, metalness: p.metalness, roughness: p.roughness, clearcoat: p.clearcoat ?? 0, clearcoatRoughness: p.clearcoatRoughness ?? 0, sheen: p.sheen ?? 0, sheenRoughness: p.sheenRoughness ?? 0.5, sheenColor: color.clone().lerp(new Color(1, 1, 1), 0.4), envMapIntensity: p.envMapIntensity ?? 1, transparent: p.transparent ?? false, opacity: p.opacity ?? 1, ior: p.ior ?? 1.5, side: p.doubleSided ? DoubleSide : FrontSide });
      if (p.emissive) { m.emissive = srgb(p.emissive); m.emissiveIntensity = p.emissiveIntensity ?? 1; }
      if (p.transparent) m.depthWrite = false;
      if (spec.kind !== 'glass' && spec.kind !== 'chrome' && spec.kind !== 'emissive' && spec.kind !== 'screen') { m.roughnessMap = t.rough; if (t.bump) { m.bumpMap = t.bump; m.bumpScale = p.bumpScale ?? 0.2; } if (t.normal) { m.normalMap = t.normal; m.normalScale.set(p.normalScale ?? 1, p.normalScale ?? 1); } if (t.variation) m.map = t.variation; }
      m.name = `ufoundry:${spec.kind}`; m.userData.materialKind = spec.kind; m.userData.universalFoundry = true; cache.set(key, m); return m;
    },
    materials: () => [...cache.values()], textures: () => [...all], describe: (k) => PRESETS[k].description,
    dispose() { for (const m of cache.values()) m.dispose(); for (const t of all) t.dispose(); cache.clear(); maps.clear(); all.length = 0; },
  };
}
