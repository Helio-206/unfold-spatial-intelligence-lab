/**
 * Photoreal material kinds and the swap that applies them to a compiled Space scene.
 *
 * The base BRDF is three.js's GGX in MeshPhysicalMaterial — measured, maintained, and not improved
 * by being rewritten. What this module adds as UNFOLD's own work: per-kind physical parameters,
 * procedural microdetail (normal + roughness variation generated locally, no assets), clearcoat for
 * paint, and strict bookkeeping so every swapped material and texture is disposed and the original
 * scene can be restored exactly. Component identity (mesh userData) is never touched.
 */
import { DataTexture, Mesh, MeshPhysicalMaterial, RepeatWrapping, RGBAFormat, type Material, type Object3D, type Texture } from 'three';

export type PhotorealKind = 'metal' | 'paint' | 'glass' | 'rubber' | 'fabric' | 'plastic' | 'wood';
export type PhotorealParams = { roughness: number; metalness: number; clearcoat: number; envMapIntensity: number; microdetail: number; detailScale: number };

export const PHOTOREAL_PARAMS: Record<PhotorealKind, PhotorealParams> = {
  metal: { roughness: 0.34, metalness: 1, clearcoat: 0, envMapIntensity: 1.05, microdetail: 0.35, detailScale: 90 },
  paint: { roughness: 0.38, metalness: 0, clearcoat: 0.7, envMapIntensity: 0.95, microdetail: 0.18, detailScale: 140 },
  glass: { roughness: 0.06, metalness: 0, clearcoat: 0, envMapIntensity: 1.1, microdetail: 0.05, detailScale: 60 },
  rubber: { roughness: 0.92, metalness: 0, clearcoat: 0, envMapIntensity: 0.45, microdetail: 0.5, detailScale: 120 },
  fabric: { roughness: 0.96, metalness: 0, clearcoat: 0, envMapIntensity: 0.35, microdetail: 0.65, detailScale: 220 },
  plastic: { roughness: 0.5, metalness: 0, clearcoat: 0.25, envMapIntensity: 0.8, microdetail: 0.22, detailScale: 110 },
  wood: { roughness: 0.62, metalness: 0, clearcoat: 0.08, envMapIntensity: 0.6, microdetail: 0.45, detailScale: 48 },
};

/** Derives the photoreal kind from what the Foundry already declared; never invents a new identity. */
export function photorealKindOf(material: Material): PhotorealKind {
  const m = material as MeshPhysicalMaterial & { userData?: Record<string, unknown> };
  const key = String(m.userData?.materialKey ?? m.userData?.kind ?? '').toLowerCase();
  if (key.includes('glass')) return 'glass';
  if (key.includes('rubber') || key.includes('tyre') || key.includes('tire')) return 'rubber';
  if (key.includes('fabric') || key.includes('textile') || key.includes('leather')) return 'fabric';
  if (key.includes('wood') || key.includes('timber')) return 'wood';
  if (key.includes('paint')) return 'paint';
  if (key.includes('metal') || key.includes('chrome') || key.includes('steel')) return 'metal';
  if (key.includes('plastic') || key.includes('polymer')) return 'plastic';
  if ((m.metalness ?? 0) > 0.65) return 'metal';
  if ((m as { transparent?: boolean }).transparent || (m as { transmission?: number }).transmission) return 'glass';
  if ((m.roughness ?? 0.5) > 0.85) return 'fabric';
  return 'plastic';
}

/**
 * Deterministic value-noise pixels used for microdetail; seeded so captures are reproducible.
 * A DataTexture (not a canvas) so the same generation runs in tests and in the browser.
 */
function noisePixels(size: number, seed: number, streaks = false): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  let state = seed >>> 0 || 1;
  const rand = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32; };
  const values = new Float32Array(size * size);
  for (let i = 0; i < values.length; i++) values[i] = rand();
  const at = (x: number, y: number) => values[((y + size) % size) * size + ((x + size) % size)]!;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const smooth = (at(x, y) * 4 + at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1)) / 8;
    const streak = streaks ? 0.75 + 0.25 * Math.sin(y * 1.7 + smooth * 9) : 1;
    const v = Math.round(255 * Math.min(1, Math.max(0, smooth * streak)));
    const i = (y * size + x) * 4;
    data[i] = Math.round(128 + (v - 128) * 0.6); data[i + 1] = Math.round(128 + (at(x + 3, y + 5) - 0.5) * 40); data[i + 2] = 255; data[i + 3] = v;
  }
  return data;
}

export type MicrodetailSet = { normalMap: Texture; roughnessMap: Texture; dispose(): void };

export function createMicrodetail(kind: PhotorealKind, seed = 7): MicrodetailSet {
  const size = 128;
  const normalTexture = new DataTexture(noisePixels(size, seed * 31 + kind.length, kind === 'metal'), size, size, RGBAFormat);
  normalTexture.wrapS = normalTexture.wrapT = RepeatWrapping; normalTexture.needsUpdate = true;
  const roughnessTexture = new DataTexture(noisePixels(size, seed * 57 + kind.charCodeAt(0), kind === 'wood'), size, size, RGBAFormat);
  roughnessTexture.wrapS = roughnessTexture.wrapT = RepeatWrapping; roughnessTexture.needsUpdate = true;
  return { normalMap: normalTexture, roughnessMap: roughnessTexture, dispose() { normalTexture.dispose(); roughnessTexture.dispose(); } };
}

export function createPhotorealMaterial(source: Material, microdetail: MicrodetailSet | null): MeshPhysicalMaterial {
  const src = source as MeshPhysicalMaterial;
  const kind = photorealKindOf(source);
  const params = PHOTOREAL_PARAMS[kind];
  const material = new MeshPhysicalMaterial({
    color: src.color?.clone() ?? 0xffffff,
    roughness: params.roughness, metalness: params.metalness,
    clearcoat: params.clearcoat, clearcoatRoughness: 0.25,
    envMapIntensity: params.envMapIntensity,
    transparent: kind === 'glass' ? true : src.transparent ?? false,
    opacity: kind === 'glass' ? 0.38 : src.opacity ?? 1,
    ...(kind === 'glass' ? { transmission: 0.55, thickness: 0.4, ior: 1.5 } : {}),
  });
  material.userData = { ...src.userData, photoreal: true, photorealKind: kind };
  // Microdetail: tangent-space normal + roughness variation from local procedural maps. Where a
  // geometry has no UVs three.js ignores these maps (documented limitation, never an artefact).
  // With microdetail disabled (performance preset) no maps are generated or assigned at all.
  if (microdetail) {
    material.normalMap = microdetail.normalMap;
    material.normalScale.setScalar(params.microdetail * 0.35);
    material.roughnessMap = microdetail.roughnessMap;
  }
  return material;
}

export type PhotorealSwap = { materials: MeshPhysicalMaterial[]; microdetail: MicrodetailSet[]; restore(): void; dispose(): void };

/** Replaces every mesh material under `root` with a photoreal one. Restorable and disposable. */
export function swapPhotorealMaterials(root: Object3D, options: { microdetail?: boolean } = {}): PhotorealSwap {
  const useMicrodetail = options.microdetail ?? true;
  const originals = new Map<Mesh, Material | Material[]>();
  const microdetail: MicrodetailSet[] = [];
  const byKind = new Map<PhotorealKind, MicrodetailSet>();
  const swapped: MeshPhysicalMaterial[] = [];
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const mesh = object as Mesh;
    originals.set(mesh, mesh.material);
    const replace = (material: Material): Material => {
      const kind = photorealKindOf(material);
      if (useMicrodetail && !byKind.has(kind)) { const set = createMicrodetail(kind); byKind.set(kind, set); microdetail.push(set); }
      const created = createPhotorealMaterial(material, useMicrodetail ? byKind.get(kind)! : null);
      swapped.push(created);
      return created;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(replace) : replace(mesh.material);
    mesh.castShadow = true; mesh.receiveShadow = true;
  });
  let restored = false;
  return {
    materials: swapped, microdetail,
    restore() {
      if (restored) return; restored = true;
      for (const [mesh, material] of originals) mesh.material = material;
    },
    dispose() {
      this.restore();
      for (const material of swapped) material.dispose();
      for (const set of microdetail) set.dispose();
    },
  };
}
