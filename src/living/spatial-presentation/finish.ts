import { DataTexture, LinearFilter, LinearMipmapLinearFilter, Mesh, MeshPhysicalMaterial, RepeatWrapping, RGBAFormat, SRGBColorSpace, UnsignedByteType, type Object3D, type Texture } from 'three';
import { finishTexture, rng, variationPixels, type Finish } from '../visual-foundry/materials';

/**
 * PBR finish by declared material profile, for ANY compiled V2 plan. It reuses the Foundry's procedural micro-surface generators (seeded, no canvas,
 * no image, no network): brushed, paint, rubber. The Foundry has no organic finish, so `grainPixels` adds one in the same style (a directional fibre field).
 * Presentation only: every property it sets is saved first and `restore()` puts it back exactly and disposes the textures it created.
 * It says nothing about the real material: it is how a declared profile is shown.
 */
type Recipe = { rough?: [Finish, [number, number]]; variation?: number; bump?: number; grain?: boolean };
const RECIPES: Partial<Record<string, Recipe>> = {
  metal: { rough: ['brushed', [2, 6]] },
  industrial: { rough: ['paint', [3, 3]], variation: 0.05 },
  accent: { rough: ['paint', [3, 3]], variation: 0.04 },
  neutral: { rough: ['paint', [3, 3]] },
  rubber: { rough: ['rubber', [2, 8]], bump: 0.15 },
  organic: { grain: true, bump: 0.1 },
};
const MARK = 'presentationFinish';

/** Fibre field as an albedo multiplier in [~165, 255] (so it darkens, never brightens): smooth along v, varying across u, slightly wavy. Deterministic. */
export function grainPixels(size = 128, seed = 4417): Uint8Array {
  const R = rng(seed), stripes = new Float32Array(size);
  for (let x = 0; x < size; x++) stripes[x] = R();
  const smooth = new Float32Array(size);
  for (let x = 0; x < size; x++) smooth[x] = (stripes[(x + size - 1) % size]! * 0.25 + stripes[x]! * 0.5 + stripes[(x + 1) % size]! * 0.25);
  const lines = new Float32Array(size); for (let x = 0; x < size; x++) lines[x] = R() > 0.9 ? 0.5 + R() * 0.5 : 0;
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const wave = Math.round(3 * Math.sin(y * 0.09 + x * 0.05)), sx = (((x + wave) % size) + size) % size;
    const v = Math.min(1, smooth[sx]! * 0.7 + lines[sx]! * 0.5 + (R() - 0.5) * 0.04), px = Math.round(255 - 90 * v);
    out.set([px, px, px, 255], (y * size + x) * 4);
  }
  return out;
}

export type FinishHandle = { /** number of materials changed */ readonly applied: number; restore(): void };

export function applyPresentationFinish(root: Object3D): FinishHandle {
  const textures = new Map<string, Texture>(), saved: Array<{ material: MeshPhysicalMaterial; map: Texture | null; roughnessMap: Texture | null; bumpMap: Texture | null; bumpScale: number }> = [];
  const get = (key: string, make: () => Texture) => { let t = textures.get(key); if (!t) { t = make(); textures.set(key, t); } return t; };
  const variationMap = (depth: number) => get(`variation:${depth}`, () => { const t = new DataTexture(variationPixels(depth), 128, 128, RGBAFormat, UnsignedByteType); t.wrapS = t.wrapT = RepeatWrapping; t.magFilter = LinearFilter; t.minFilter = LinearMipmapLinearFilter; t.generateMipmaps = true; t.repeat.set(0.35, 0.35); t.colorSpace = SRGBColorSpace; t.needsUpdate = true; t.name = `presentation:variation:${depth}`; return t; });
  const grainMap = () => get('grain', () => { const t = new DataTexture(grainPixels(), 128, 128, RGBAFormat, UnsignedByteType); t.wrapS = t.wrapT = RepeatWrapping; t.magFilter = LinearFilter; t.minFilter = LinearMipmapLinearFilter; t.generateMipmaps = true; t.repeat.set(2, 1); t.colorSpace = SRGBColorSpace; t.anisotropy = 4; t.needsUpdate = true; t.name = 'presentation:grain'; return t; });
  const done = new Set<MeshPhysicalMaterial>();
  root.traverse((object) => {
    if (!(object instanceof Mesh) || !(object.material instanceof MeshPhysicalMaterial)) return;
    const material = object.material, recipe = RECIPES[String(material.userData.materialProfile ?? object.userData.materialProfile)];
    if (!recipe || done.has(material) || material.userData[MARK] || !object.geometry.getAttribute('uv')) return;
    done.add(material); saved.push({ material, map: material.map, roughnessMap: material.roughnessMap, bumpMap: material.bumpMap, bumpScale: material.bumpScale });
    if (recipe.grain) { const grain = grainMap(); material.map = grain; material.roughnessMap = grain; material.bumpMap = grain; }
    if (recipe.rough) { const [finish, repeat] = recipe.rough, texture = get(`finish:${finish}:${repeat.join('x')}`, () => finishTexture(finish, repeat)); material.roughnessMap = texture; if (recipe.bump) material.bumpMap = texture; }
    if (recipe.variation) material.map = variationMap(recipe.variation);
    if (recipe.bump) material.bumpScale = recipe.bump;
    material.userData[MARK] = true; material.needsUpdate = true;
  });
  let restored = false;
  return {
    applied: saved.length,
    restore() {
      if (restored) return; restored = true;
      for (const s of saved) { s.material.map = s.map; s.material.roughnessMap = s.roughnessMap; s.material.bumpMap = s.bumpMap; s.material.bumpScale = s.bumpScale; delete s.material.userData[MARK]; s.material.needsUpdate = true; }
      for (const t of textures.values()) t.dispose();
      textures.clear();
    },
  };
}
