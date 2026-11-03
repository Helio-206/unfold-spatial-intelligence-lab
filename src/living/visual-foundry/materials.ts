/**
 * Material library for industrial display geometry. Physically based (MeshPhysicalMaterial), with procedural
 * micro-roughness textures generated from a seeded PRNG into DataTextures, so the library builds identically in the
 * browser and in Node tests (no canvas, no network, no external assets).
 *
 * Realism comes from roughness response and reflections, not from raising reflectivity: each preset keeps a plausible
 * base colour (F0 for metals, albedo for dielectrics) and a roughness band measured by eye against studio references.
 *
 * Technique adapted from the Airsup machine-skill kit (MIT, © 2026 Air Supply Technologies Inc.): preset table with
 * per-finish roughness maps (turned, brushed, cast, smudge). See NOTICE.md.
 */
import {
  Color, DataTexture, DoubleSide, FrontSide, LinearFilter, LinearMipmapLinearFilter, MeshPhysicalMaterial, RepeatWrapping, RGBAFormat,
  SRGBColorSpace, UnsignedByteType, type Material, type Texture,
} from 'three';

export const FINISHES = ['paint', 'turned', 'brushed', 'cast', 'rubber'] as const;
export type Finish = (typeof FINISHES)[number];

export const MATERIAL_KEYS = [
  'paint', 'paintDark', 'castDark', 'machined', 'brushed', 'chrome', 'rubber', 'glass', 'trim', 'interior', 'steelTube', 'shoe',
] as const;
export type MaterialKey = (typeof MATERIAL_KEYS)[number];

/** Seeded PRNG (LCG). Same seed, same texture, byte for byte. */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

const SIZE = 256;

/** A greyscale micro-roughness field around 0.5 (128). The material's roughness multiplies the map's green channel. */
export function finishPixels(finish: Finish, size = SIZE): Uint8Array {
  const R = rng(FINISHES.indexOf(finish) * 7919 + 17);
  const field = new Float32Array(size * size).fill(0.5);
  const add = (x: number, y: number, v: number) => { const i = ((y % size + size) % size) * size + ((x % size + size) % size); field[i] = field[i]! + v; };
  if (finish === 'turned') {
    for (let y = 0; y < size; y++) { const v = (R() - 0.5) * 0.16 + Math.sin(y * 0.9) * 0.04; for (let x = 0; x < size; x++) add(x, y, v); }
  } else if (finish === 'brushed') {
    for (let i = 0; i < 2400; i++) { const x0 = Math.floor(R() * size), y = Math.floor(R() * size), len = 20 + Math.floor(R() * 160), v = (R() - 0.5) * 0.22; for (let k = 0; k < len; k++) add(x0 + k, y, v); }
  } else {
    // paint (orange peel, faint), cast (blotchy), rubber (fine grain): sums of soft blobs plus white noise
    const blobs = finish === 'cast' ? 320 : finish === 'paint' ? 140 : 40;
    const amp = finish === 'cast' ? 0.14 : finish === 'paint' ? 0.06 : 0.04;
    for (let b = 0; b < blobs; b++) {
      const cx = R() * size, cy = R() * size, r = (finish === 'paint' ? 8 : 5) + R() * (finish === 'cast' ? 34 : 22), v = (R() - 0.5) * 2 * amp;
      for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const d = Math.hypot(x - cx, y - cy) / r; if (d < 1) add(x, y, v * (1 - d * d));
      }
    }
    const grain = finish === 'rubber' ? 0.12 : finish === 'cast' ? 0.07 : 0.025;
    for (let i = 0; i < field.length; i++) field[i] = field[i]! + (R() - 0.5) * grain;
  }
  const out = new Uint8Array(size * size * 4);
  for (let i = 0; i < field.length; i++) { const v = Math.max(0, Math.min(255, Math.round(field[i]! * 255))); out.set([v, v, v, 255], i * 4); }
  return out;
}

function finishTexture(finish: Finish, repeat: [number, number]): DataTexture {
  const texture = new DataTexture(finishPixels(finish), SIZE, SIZE, RGBAFormat, UnsignedByteType);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter; texture.minFilter = LinearMipmapLinearFilter; texture.generateMipmaps = true;
  texture.repeat.set(repeat[0], repeat[1]);
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  texture.name = `finish:${finish}`;
  return texture;
}

/** Low-frequency albedo field in [1 - depth, 1]: large soft patches (metres apart), no noise, no streaks. */
export function variationPixels(depth: number, size = 128): Uint8Array {
  const R = rng(9173);
  const field = new Float32Array(size * size);
  for (let b = 0; b < 60; b++) {
    const cx = R() * size, cy = R() * size, r = 10 + R() * 36, v = R();
    for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      const d = Math.hypot(x - cx, y - cy) / r; if (d >= 1) continue;
      const i = ((y % size + size) % size) * size + ((x % size + size) % size); field[i] = field[i]! + v * (1 - d * d) * (1 - d * d);
    }
  }
  let max = 0; for (const f of field) max = Math.max(max, f);
  const out = new Uint8Array(size * size * 4);
  for (let i = 0; i < field.length; i++) { const v = Math.round((1 - depth * (field[i]! / (max || 1))) * 255); out.set([v, v, v, 255], i * 4); }
  return out;
}

/** sRGB hex (as written in design-system/tokens.css) to a linear Color. */
const srgb = (hex: string) => new Color().setStyle(hex, SRGBColorSpace);

type Preset = {
  color: Color; metalness: number; roughness: number; finish: Finish | null; repeat?: [number, number];
  clearcoat?: number; clearcoatRoughness?: number; envMapIntensity?: number; transparent?: boolean; opacity?: number;
  ior?: number; specularIntensity?: number; doubleSided?: boolean; description: string;
  /** Depth of a low-frequency albedo variation (0 = none). Restrained: panel-to-panel tone, not dirt. */
  variation?: number;
};

/**
 * Paint colours come from the UNFOLD palette: the body is Paper (#F3F0E8 surface, slightly lowered so it keeps detail
 * under the key light), the dark paint is Void raised (#171A1F). They are object colours, not UI colours.
 */
export const PRESETS: Record<MaterialKey, Preset> = {
  paint: { color: srgb('#DAD5CA'), metalness: 0, roughness: 0.4, variation: 0.05, finish: 'paint', repeat: [3, 3], clearcoat: 0.7, clearcoatRoughness: 0.16, description: 'Painted industrial steel, Paper body paint, clear-coated.' },
  paintDark: { color: srgb('#4B4F57'), metalness: 0, roughness: 0.38, variation: 0.06, finish: 'paint', repeat: [3, 3], clearcoat: 0.5, clearcoatRoughness: 0.22, description: 'Painted steel, Void graphite.' },
  castDark: { color: srgb('#6E7075'), metalness: 0.82, roughness: 0.46, variation: 0.1, finish: 'cast', repeat: [2, 2], description: 'Dark cast steel: sprockets, idlers, rollers, counterweight underside.' },
  shoe: { color: srgb('#64666B'), metalness: 0.8, roughness: 0.44, variation: 0.12, finish: 'cast', repeat: [1, 1], description: 'Forged track shoes, worn but restrained.' },
  machined: { color: srgb('#A9ABAE'), metalness: 1, roughness: 0.26, finish: 'turned', repeat: [1, 12], description: 'Machined steel faces: pins, bosses, bushings.' },
  brushed: { color: srgb('#8E9196'), metalness: 1, roughness: 0.34, finish: 'brushed', repeat: [2, 6], description: 'Brushed steel: keeper plates, clamps, fittings.' },
  steelTube: { color: srgb('#7F8287'), metalness: 1, roughness: 0.3, finish: 'brushed', repeat: [1, 8], description: 'Drawn steel hydraulic tubing.' },
  chrome: { color: srgb('#D9DADC'), metalness: 1, roughness: 0.06, finish: null, envMapIntensity: 1.15, description: 'Polished hard-chromed piston rods.' },
  rubber: { color: srgb('#0F1012'), metalness: 0, roughness: 0.78, finish: 'rubber', repeat: [2, 8], description: 'Hydraulic hose rubber and seals.' },
  trim: { color: srgb('#111317'), metalness: 0, roughness: 0.55, finish: 'rubber', repeat: [2, 2], description: 'Black trim, window seals, grilles.' },
  interior: { color: srgb('#0B0D10'), metalness: 0, roughness: 0.85, finish: null, description: 'Cab interior (dark, seen through the glazing).' },
  glass: { color: srgb('#3A4048'), metalness: 0, roughness: 0.04, finish: null, transparent: true, opacity: 0.32, ior: 1.52, specularIntensity: 1, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.3, doubleSided: true, description: 'Tinted safety glazing: reflective, see-through, no transmission pass.' },
};

export type MaterialLibrary = {
  get(key: MaterialKey): MeshPhysicalMaterial;
  /** Every material and texture created, for counts and disposal. */
  materials(): MeshPhysicalMaterial[];
  textures(): Texture[];
  dispose(): void;
};

export function createMaterialLibrary(): MaterialLibrary {
  const cache = new Map<MaterialKey, MeshPhysicalMaterial>();
  const textures: Texture[] = [];
  const build = (key: MaterialKey) => {
    const p = PRESETS[key];
    const m = new MeshPhysicalMaterial({
      color: p.color.clone(), metalness: p.metalness, roughness: p.roughness, clearcoat: p.clearcoat ?? 0, clearcoatRoughness: p.clearcoatRoughness ?? 0,
      envMapIntensity: p.envMapIntensity ?? 1, transparent: p.transparent ?? false, opacity: p.opacity ?? 1, ior: p.ior ?? 1.5,
      specularIntensity: p.specularIntensity ?? 1, side: p.doubleSided ? DoubleSide : FrontSide,
    });
    if (p.transparent) m.depthWrite = false;
    if (p.variation) {
      const v = new DataTexture(variationPixels(p.variation), 128, 128, RGBAFormat, UnsignedByteType);
      v.wrapS = v.wrapT = RepeatWrapping; v.magFilter = LinearFilter; v.minFilter = LinearMipmapLinearFilter; v.generateMipmaps = true;
      v.repeat.set(0.35, 0.35); v.needsUpdate = true; v.name = `variation:${key}`;
      textures.push(v); m.map = v; // multiplies the base colour: ±5–12 % tone between panels
    }
    if (p.finish) {
      const t = finishTexture(p.finish, p.repeat ?? [2, 2]); textures.push(t);
      m.roughnessMap = t;
      if (p.finish === 'cast' || p.finish === 'rubber') { m.bumpMap = t; m.bumpScale = p.finish === 'cast' ? 0.35 : 0.15; }
    }
    m.name = `foundry:${key}`;
    m.userData.materialKey = key;
    return m;
  };
  return {
    get(key) { let m = cache.get(key); if (!m) { m = build(key); cache.set(key, m); } return m; },
    materials: () => [...cache.values()],
    textures: () => [...textures],
    dispose() { for (const m of cache.values()) m.dispose(); for (const t of textures) t.dispose(); cache.clear(); textures.length = 0; },
  };
}

export const isFoundryMaterial = (m: Material) => typeof m.userData.materialKey === 'string';
