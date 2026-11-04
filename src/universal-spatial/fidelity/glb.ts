import { Mesh, type Object3D, type Texture } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { RouterLimits } from './types';

/**
 * Bounded, fail-closed GLB intake. A GLB is data from outside (a provider, an upload, a library). It is checked BEFORE anything is decoded or allocated for
 * it: container and chunk lengths, JSON size, glTF version, extensions, embedded-only data, counts, accessor ranges, triangle totals and texture sizes read
 * from the image headers. Any failure returns a coded reason and nothing else; there is never a partial scene.
 */
export type GlbInfo = { downscaledTo: number | null; bytes: number; nodes: number; meshes: number; materials: number; textures: number; triangles: number; textureBytes: number; nodeNames: string[]; maxTextureSide: number };
export type GlbVerdict = { ok: true; info: GlbInfo } | { ok: false; code: GlbRefusal; detail: string };
export type GlbRefusal = 'TOO_LARGE' | 'NOT_GLB' | 'BAD_CONTAINER' | 'BAD_JSON' | 'BAD_VERSION' | 'EXTENSION_NOT_ALLOWED' | 'EXTERNAL_DATA' | 'TOO_MANY_NODES' | 'TOO_MANY_TRIANGLES' | 'BAD_ACCESSOR' | 'IMAGE_DIMENSIONS_UNKNOWN' | 'TEXTURE_TOO_LARGE' | 'TEXTURES_TOO_HEAVY';

export const ALLOWED_GLB_EXTENSIONS = new Set(['KHR_materials_emissive_strength', 'KHR_materials_ior', 'KHR_materials_specular', 'KHR_materials_clearcoat', 'KHR_materials_sheen', 'KHR_materials_transmission', 'KHR_materials_volume', 'KHR_materials_unlit', 'KHR_texture_transform', 'KHR_mesh_quantization', 'KHR_materials_iridescence', 'KHR_materials_anisotropy']);
const COMPONENT_BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }, TYPE_COUNT: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const refuse = (code: GlbRefusal, detail: string): GlbVerdict => ({ ok: false, code, detail });

function imageSide(bytes: Uint8Array): [number, number] | null {
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) { const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); return [v.getUint32(16), v.getUint32(20)]; }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2; const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    while (i + 9 < bytes.length) { if (bytes[i] !== 0xff) { i++; continue; } const marker = bytes[i + 1]!; if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return [v.getUint16(i + 7), v.getUint16(i + 5)]; i += 2 + v.getUint16(i + 2); }
  }
  return null;
}

/** Hard decode-safety cap: a texture larger than this is never decoded, even if it would be downscaled afterwards. */
const HARD_TEXTURE_SIDE = 4096;
export type GlbIntakeOptions = { /** textures are reduced to this side (never enlarged) before they reach the GPU; memory is then judged on the reduced size */ downscaleTo?: number };

export function validateGlb(input: Uint8Array, limits: Pick<RouterLimits, 'maxAssetBytes' | 'maxTextureSide' | 'maxTextureBytes' | 'maxAssetTriangles' | 'maxAssetNodes'>, intake: GlbIntakeOptions = {}): GlbVerdict {
  if (input.byteLength > limits.maxAssetBytes) return refuse('TOO_LARGE', `${input.byteLength} bytes`);
  if (input.byteLength < 20) return refuse('NOT_GLB', 'shorter than a GLB header');
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) return refuse('NOT_GLB', 'magic is not glTF');
  if (view.getUint32(4, true) !== 2) return refuse('BAD_VERSION', 'GLB container version is not 2');
  if (view.getUint32(8, true) !== input.byteLength) return refuse('BAD_CONTAINER', 'declared length differs from the file');
  let offset = 12, json: Uint8Array | null = null, bin: Uint8Array | null = null, chunks = 0;
  while (offset + 8 <= input.byteLength) {
    const length = view.getUint32(offset, true), type = view.getUint32(offset + 4, true), start = offset + 8;
    if (++chunks > 4 || start + length > input.byteLength || length % 4 !== 0) return refuse('BAD_CONTAINER', 'chunk out of range');
    if (type === 0x4e4f534a && !json) json = input.subarray(start, start + length); else if (type === 0x004e4942 && !bin) bin = input.subarray(start, start + length);
    offset = start + length;
  }
  if (!json || json.byteLength > 8 * 1024 * 1024) return refuse('BAD_CONTAINER', 'missing or oversized JSON chunk');
  let gltf: Record<string, any>; try { gltf = JSON.parse(new TextDecoder().decode(json)); } catch { return refuse('BAD_JSON', 'JSON chunk does not parse'); }
  if (!gltf || typeof gltf !== 'object' || gltf.asset?.version !== '2.0') return refuse('BAD_VERSION', 'asset.version is not 2.0');
  for (const list of [gltf.extensionsUsed, gltf.extensionsRequired]) for (const ext of Array.isArray(list) ? list : []) if (!ALLOWED_GLB_EXTENSIONS.has(String(ext))) return refuse('EXTENSION_NOT_ALLOWED', String(ext));
  for (const buffer of gltf.buffers ?? []) if (buffer.uri !== undefined) return refuse('EXTERNAL_DATA', 'buffer with a uri');
  const nodes = gltf.nodes ?? [], meshes = gltf.meshes ?? [], accessors = gltf.accessors ?? [], views = gltf.bufferViews ?? [];
  if (nodes.length > limits.maxAssetNodes) return refuse('TOO_MANY_NODES', `${nodes.length} nodes`);
  const binLength = bin?.byteLength ?? 0;
  for (const bv of views) if (!Number.isInteger(bv.byteOffset ?? 0) || !Number.isInteger(bv.byteLength) || (bv.byteOffset ?? 0) < 0 || bv.byteLength < 0 || (bv.byteOffset ?? 0) + bv.byteLength > binLength) return refuse('BAD_ACCESSOR', 'bufferView outside the binary chunk');
  for (const a of accessors) {
    const size = (COMPONENT_BYTES[a.componentType] ?? 0) * (TYPE_COUNT[a.type] ?? 0), bv = views[a.bufferView];
    if (!size || !Number.isInteger(a.count) || a.count < 0) return refuse('BAD_ACCESSOR', 'accessor type or count');
    if (a.bufferView !== undefined && (!bv || (a.byteOffset ?? 0) + (bv.byteStride && a.count > 0 ? bv.byteStride * (a.count - 1) + size : size * a.count) > bv.byteLength)) return refuse('BAD_ACCESSOR', 'accessor outside its bufferView');
  }
  let triangles = 0;
  for (const mesh of meshes) for (const p of mesh.primitives ?? []) { const mode = p.mode ?? 4; if (mode !== 4) continue; const count = p.indices !== undefined ? accessors[p.indices]?.count : accessors[p.attributes?.POSITION]?.count; if (!Number.isInteger(count)) return refuse('BAD_ACCESSOR', 'primitive without a usable accessor'); triangles += count / 3; }
  const instanced = nodes.filter((n: any) => n.mesh !== undefined).length; void instanced;
  if (triangles > limits.maxAssetTriangles) return refuse('TOO_MANY_TRIANGLES', `${Math.round(triangles)} triangles`);
  let textureBytes = 0, maxSide = 0;
  for (const image of gltf.images ?? []) {
    let data: Uint8Array | null = null;
    if (image.uri !== undefined) return refuse('EXTERNAL_DATA', 'image with a uri'); // embedded bufferView images only
    if (image.bufferView !== undefined && bin) { const bv = views[image.bufferView]; if (bv) data = bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength); }
    const side = data && imageSide(data); if (!side) return refuse('IMAGE_DIMENSIONS_UNKNOWN', 'only PNG and JPEG with readable headers are accepted');
    const cap = intake.downscaleTo ? HARD_TEXTURE_SIDE : limits.maxTextureSide;
    if (side[0] > cap || side[1] > cap) return refuse('TEXTURE_TOO_LARGE', `${side[0]}x${side[1]}`);
    const scale = intake.downscaleTo ? Math.min(1, intake.downscaleTo / Math.max(side[0], side[1])) : 1, w = Math.max(1, Math.round(side[0] * scale)), h = Math.max(1, Math.round(side[1] * scale));
    maxSide = Math.max(maxSide, w, h); textureBytes += Math.round(w * h * 4 * (4 / 3));
  }
  if (textureBytes > limits.maxTextureBytes) return refuse('TEXTURES_TOO_HEAVY', `${textureBytes} bytes decoded`);
  return { ok: true, info: { downscaledTo: intake.downscaleTo ?? null, bytes: input.byteLength, nodes: nodes.length, meshes: meshes.length, materials: (gltf.materials ?? []).length, textures: (gltf.images ?? []).length, triangles: Math.round(triangles), textureBytes, nodeNames: nodes.map((n: any) => String(n.name ?? '')), maxTextureSide: maxSide } };
}

/** Validates, then decodes with Three's loader and re-checks the decoded scene. Never returns a partial scene. */
export async function loadValidatedGlb(bytes: Uint8Array, limits: Parameters<typeof validateGlb>[1], intake: GlbIntakeOptions = {}): Promise<{ scene: Object3D; info: GlbInfo } | { refused: GlbRefusal; detail: string }> {
  const verdict = validateGlb(bytes, limits, intake); if (!verdict.ok) return { refused: verdict.code, detail: verdict.detail };
  try {
    const copy = bytes.slice().buffer, gltf = await new GLTFLoader().parseAsync(copy, '');
    let triangles = 0; gltf.scene.traverse((o) => { if (o instanceof Mesh) { const g = o.geometry; triangles += (g.index ? g.index.count : g.getAttribute('position').count) / 3; } });
    if (triangles > limits.maxAssetTriangles) return { refused: 'TOO_MANY_TRIANGLES', detail: `${Math.round(triangles)} after decoding` };
    const doomed: Object3D[] = []; gltf.scene.traverse((o) => { if ((o as { isCamera?: boolean }).isCamera || (o as { isLight?: boolean }).isLight) doomed.push(o); }); for (const o of doomed) o.parent?.remove(o);
    if (intake.downscaleTo) downscaleTextures(gltf.scene, intake.downscaleTo);
    return { scene: gltf.scene, info: verdict.info };
  } catch (error) { return { refused: 'BAD_CONTAINER', detail: error instanceof Error ? error.message.slice(0, 160) : 'decode failed' }; }
}

/** Browser only (needs a canvas): replaces every larger texture image by a reduced copy and releases the original bitmap. Never enlarges. */
export function downscaleTextures(scene: Object3D, side: number): number {
  if (typeof document === 'undefined') return 0;
  const seen = new Set<Texture>(); let changed = 0;
  scene.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    for (const material of Array.isArray(o.material) ? o.material : [o.material]) for (const value of Object.values(material)) {
      const t = value as Texture; if (!t || !t.isTexture || seen.has(t)) continue; seen.add(t);
      const image = t.image as { width?: number; height?: number; close?: () => void } | undefined; if (!image?.width || !image.height || Math.max(image.width, image.height) <= side) continue;
      const k = side / Math.max(image.width, image.height), canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.width * k)); canvas.height = Math.max(1, Math.round(image.height * k));
      const ctx = canvas.getContext('2d'); if (!ctx) continue; ctx.drawImage(image as CanvasImageSource, 0, 0, canvas.width, canvas.height); image.close?.(); t.image = canvas; t.needsUpdate = true; changed++;
    }
  });
  return changed;
}
