import { Color, DoubleSide, LineDashedMaterial, Material, MeshStandardMaterial, RepeatWrapping, type Texture } from 'three';
import { createHatchTexture, createProceduralTextures, type ProceduralTextures } from './procedural-textures';
import { profileFor, type VisualQuality } from './quality';

/**
 * Small shared material library. One instance per quality profile, created lazily and reused by every scene build:
 * rebuilding a scene (selection, preview, reconstruction) never creates new materials or textures. The viewer's
 * disposal code frees geometries only, so materials live here and are released explicitly with disposeMaterials().
 */
export type MaterialKey =
  | 'wallFace' | 'wallCap' | 'wallFaceAmbiguous' | 'wallCapAmbiguous'
  | 'floor' | 'timber' | 'metal' | 'glass' | 'concrete' | 'neutral';

export type MaterialLibrary = {
  quality: VisualQuality;
  m: Record<MaterialKey, MeshStandardMaterial>;
  /** dashed outline drawn on geometry that is not human-confirmed (same colour for every level: provisional is not an alarm) */
  provisionalLine: LineDashedMaterial;
  /** materials used by the GLB modules, mapped by their Blender material name so modules respond to light like the rest */
  byGltfName: Record<string, Material>;
  textures: ProceduralTextures | null;
};

const libraries = new Map<VisualQuality, MaterialLibrary>();
let sharedTextures: ProceduralTextures | null = null;
let sharedHatch: Texture | null = null;

function standard(name: string, color: number, roughness: number, metalness = 0): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: new Color(color), roughness, metalness });
  material.name = name;
  return material;
}

function repeated(texture: Texture, x: number, y: number): Texture { texture.repeat.set(x, y); texture.wrapS = texture.wrapT = RepeatWrapping; return texture; }

function build(quality: VisualQuality): MaterialLibrary {
  const profile = profileFor(quality);
  const textures = profile.textures ? (sharedTextures ??= createProceduralTextures()) : null;
  const technical = !profile.textures;

  const wallFace = standard('wall-face', technical ? 0xd2cec3 : 0xdad6cc, technical ? 0.95 : 0.9);
  const wallCap = standard('wall-cap', technical ? 0xa9a59b : 0xb7b3a8, technical ? 0.95 : 0.85);
  const floor = standard('floor', technical ? 0xbab5a9 : 0xffffff, technical ? 0.95 : 0.6);
  const timber = standard('timber', technical ? 0x7d6246 : 0xffffff, technical ? 0.8 : 0.55);
  const metal = standard('metal', technical ? 0x353a40 : 0x1d2227, technical ? 0.6 : 0.34, technical ? 0.2 : 0.75);
  const glass = standard('glass', technical ? 0x8fb2bf : 0xb4ccd6, technical ? 0.5 : 0.06, 0);
  glass.transparent = true; glass.opacity = technical ? 0.38 : 0.26; glass.depthWrite = false; glass.side = DoubleSide;
  const concrete = standard('concrete', technical ? 0x9a9a95 : 0xa4a49f, technical ? 0.95 : 0.85);
  const neutral = standard('neutral', 0x8a8f88, 0.8);
  // floors sit exactly where the canonical data puts them; polygonOffset keeps them from fighting with the ground and the reference plane
  floor.polygonOffset = true; floor.polygonOffsetFactor = -1; floor.polygonOffsetUnits = -1;

  const wallFaceAmbiguous = wallFace.clone(); wallFaceAmbiguous.name = 'wall-face-ambiguous';
  const wallCapAmbiguous = wallCap.clone(); wallCapAmbiguous.name = 'wall-cap-ambiguous';

  if (textures) {
    wallFace.normalMap = repeated(textures.plasterNormal, 0.5, 0.5); wallFace.roughnessMap = textures.plasterRoughness; wallFace.normalScale.set(0.35, 0.35);
    wallCap.normalMap = repeated(textures.concreteNormal, 1, 1); wallCap.roughnessMap = textures.concreteRoughness; wallCap.normalScale.set(0.5, 0.5);
    concrete.normalMap = textures.concreteNormal; concrete.roughnessMap = textures.concreteRoughness;
    floor.map = repeated(textures.timberColor, 0.5, 0.5); floor.normalMap = textures.timberNormal; floor.roughnessMap = textures.timberRoughness; floor.normalScale.set(0.6, 0.6);
    timber.map = textures.timberColor; timber.normalMap = textures.timberNormal; timber.roughnessMap = textures.timberRoughness;
    // ambiguous geometry: the same surface with a diagonal hatch, so it reads as "unresolved" without changing hue
    wallFaceAmbiguous.normalMap = wallFace.normalMap; wallFaceAmbiguous.roughnessMap = wallFace.roughnessMap; wallFaceAmbiguous.map = repeated(textures.hatch, 1.2, 1.2);
    wallCapAmbiguous.normalMap = wallCap.normalMap; wallCapAmbiguous.roughnessMap = wallCap.roughnessMap; wallCapAmbiguous.map = textures.hatch;
  } else {
    // technical: still no PBR maps, but ambiguous geometry gets the same hatch so it stays visibly unresolved
    sharedHatch ??= createHatchTexture();
    wallFaceAmbiguous.map = repeated(sharedHatch, 1.2, 1.2); wallCapAmbiguous.map = sharedHatch;
  }

  const provisionalLine = new LineDashedMaterial({ color: 0x4a5057, dashSize: 0.12, gapSize: 0.09, transparent: true, opacity: 0.75 });
  provisionalLine.name = 'provisional-outline';

  const m = { wallFace, wallCap, wallFaceAmbiguous, wallCapAmbiguous, floor, timber, metal, glass, concrete, neutral };
  const byGltfName: Record<string, Material> = {
    wall_plaster_warm: wallFace, wall_concrete: concrete, door_oak: timber, window_powder_coat: metal, window_glazing: glass, connector_stainless: metal, connector_isolator: neutral,
  };
  return { quality, m, provisionalLine, byGltfName, textures };
}

export function getMaterials(quality: VisualQuality): MaterialLibrary {
  let library = libraries.get(quality);
  if (!library) { library = build(quality); libraries.set(quality, library); }
  return library;
}

/** Releases every shared material and texture. Safe to call at any time; the next getMaterials() builds fresh ones. */
export function disposeMaterials(): void {
  for (const library of libraries.values()) {
    for (const material of Object.values(library.m)) material.dispose();
    library.provisionalLine.dispose();
  }
  libraries.clear();
  if (sharedTextures) { for (const texture of Object.values(sharedTextures)) texture.dispose(); sharedTextures = null; }
  if (sharedHatch) { sharedHatch.dispose(); sharedHatch = null; }
}
