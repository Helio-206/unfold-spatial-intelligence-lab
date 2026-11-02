import { DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RGBAFormat, RepeatWrapping, SRGBColorSpace, UnsignedByteType } from 'three';

/**
 * Textures generated in code from a fixed seed, so they are original work (no third-party image is bundled), deterministic and tiny
 * (256 x 256, 256 KiB each before mipmaps). They are used only by the presentation profile.
 */

const SIZE = 256;

/** mulberry32: small deterministic PRNG */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Tileable value noise on a SIZE x SIZE grid, `cells` lattice cells across, summed over octaves. Returns values 0..1. */
function noise(seed: number, cells: number, octaves = 3): Float32Array {
  const out = new Float32Array(SIZE * SIZE);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o += 1) {
    const n = cells * 2 ** o; const rand = rng(seed + o * 101);
    const lattice = new Float32Array(n * n).map(() => rand());
    const at = (x: number, y: number) => lattice[((y % n) + n) % n * n + ((x % n) + n) % n]!;
    for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
      const fx = (x / SIZE) * n, fy = (y / SIZE) * n; const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0; const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const v = (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
      out[y * SIZE + x]! += v * amp;
    }
    total += amp; amp *= 0.5;
  }
  for (let i = 0; i < out.length; i += 1) out[i]! /= total;
  return out;
}

function make(data: Uint8Array, colorSpace: typeof SRGBColorSpace | typeof NoColorSpace): DataTexture {
  const texture = new DataTexture(data, SIZE, SIZE, RGBAFormat, UnsignedByteType);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter; texture.minFilter = LinearMipmapLinearFilter; texture.generateMipmaps = true;
  texture.colorSpace = colorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** Height field -> tangent-space normal map. `strength` scales the slope. */
function normalFrom(height: Float32Array, strength: number): DataTexture {
  const data = new Uint8Array(SIZE * SIZE * 4);
  const h = (x: number, y: number) => height[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)]!;
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
    const dx = (h(x + 1, y) - h(x - 1, y)) * strength, dy = (h(x, y + 1) - h(x, y - 1)) * strength;
    const len = Math.hypot(dx, dy, 1); const i = (y * SIZE + x) * 4;
    data[i] = Math.round((-dx / len * 0.5 + 0.5) * 255); data[i + 1] = Math.round((-dy / len * 0.5 + 0.5) * 255); data[i + 2] = Math.round((1 / len * 0.5 + 0.5) * 255); data[i + 3] = 255;
  }
  return make(data, NoColorSpace);
}

function grayscale(values: Float32Array, lo: number, hi: number): DataTexture {
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let i = 0; i < values.length; i += 1) { const v = Math.round((lo + (hi - lo) * values[i]!) * 255); data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v; data[i * 4 + 3] = 255; }
  return make(data, NoColorSpace);
}

export type ProceduralTextures = {
  plasterNormal: DataTexture; plasterRoughness: DataTexture;
  concreteNormal: DataTexture; concreteRoughness: DataTexture;
  timberColor: DataTexture; timberNormal: DataTexture; timberRoughness: DataTexture;
  hatch: DataTexture;
};

export function createProceduralTextures(): ProceduralTextures {
  const plaster = noise(11, 24, 3);
  const concrete = noise(23, 12, 4);
  // timber: 8 boards across; each board has its own tone and a grain that runs along the board
  const boards = 8; const grainA = noise(37, 4, 2); const rand = rng(41); const tone = Array.from({ length: boards }, () => 0.82 + rand() * 0.28);
  const timberHeight = new Float32Array(SIZE * SIZE); const timberRgb = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
    const b = Math.floor((x / SIZE) * boards); const bx = (x / SIZE) * boards - b;
    const groove = bx < 0.03 || bx > 0.97 ? 0.35 : 1;
    const grain = 0.5 + 0.5 * Math.sin((y / SIZE) * Math.PI * 2 * 3 + grainA[y * SIZE + x]! * 9 + b);
    timberHeight[y * SIZE + x] = groove * (0.85 + 0.15 * grain);
    const t = tone[b]! * (0.9 + 0.1 * grain) * (groove < 1 ? 0.7 : 1); const i = (y * SIZE + x) * 4;
    timberRgb[i] = Math.min(255, Math.round(176 * t)); timberRgb[i + 1] = Math.min(255, Math.round(132 * t)); timberRgb[i + 2] = Math.min(255, Math.round(88 * t)); timberRgb[i + 3] = 255;
  }
  return {
    plasterNormal: normalFrom(plaster, 1.1), plasterRoughness: grayscale(plaster, 0.82, 0.98),
    concreteNormal: normalFrom(concrete, 2.2), concreteRoughness: grayscale(concrete, 0.7, 0.95),
    timberColor: make(timberRgb, SRGBColorSpace), timberNormal: normalFrom(timberHeight, 2.4), timberRoughness: grayscale(grainA, 0.45, 0.7),
    hatch: createHatchTexture(),
  };
}

/** Provisional hatch: diagonal lines, 3 px every 32. Small enough that the technical profile uses it too, for ambiguous geometry only. */
export function createHatchTexture(): DataTexture {
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
    const on = ((x + y) % 32) < 3; const v = on ? 150 : 255; const i = (y * SIZE + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
  }
  return make(data, SRGBColorSpace);
}
