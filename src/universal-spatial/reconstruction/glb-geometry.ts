import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Tri } from './silhouette';

/**
 * Geometry-only GLB reader for the ground-truth benchmark (Node and browser, no decoder, no textures, no DOM). It reads container, JSON, node tree and the
 * POSITION/indices accessors of triangle primitives and returns world-space triangles per node. It refuses what it does not understand (sparse accessors,
 * Draco/meshopt/quantisation, external buffers) instead of guessing. The product intake with all its limits remains `fidelity/glb.ts`.
 */
export type GlbPart = { name: string; path: string; tris: Tri[] };

const COMPONENT: Record<number, [number, (v: DataView, o: number) => number]> = {
  5120: [1, (v, o) => v.getInt8(o)], 5121: [1, (v, o) => v.getUint8(o)], 5122: [2, (v, o) => v.getInt16(o, true)], 5123: [2, (v, o) => v.getUint16(o, true)], 5125: [4, (v, o) => v.getUint32(o, true)], 5126: [4, (v, o) => v.getFloat32(o, true)],
};
const WIDTH: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

export function readGlbParts(bytes: Uint8Array): GlbPart[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) throw new Error('GLB_NOT_V2');
  let offset = 12, json: Record<string, any> | null = null, bin: Uint8Array | null = null;
  while (offset + 8 <= bytes.byteLength) {
    const length = view.getUint32(offset, true), type = view.getUint32(offset + 4, true), start = offset + 8;
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(bytes.subarray(start, start + length))); else if (type === 0x004e4942 && !bin) bin = bytes.subarray(start, start + length);
    offset = start + length;
  }
  if (!json || !bin) throw new Error('GLB_MISSING_CHUNK');
  const used = [...(json.extensionsUsed ?? [])].filter((e: string) => /draco|meshopt|quantization/i.test(e)); if (used.length) throw new Error(`GLB_UNSUPPORTED_EXTENSION ${used.join(',')}`);
  const accessor = (index: number): number[][] => {
    const a = json!.accessors[index]; if (a.sparse) throw new Error('GLB_SPARSE_ACCESSOR');
    const bv = json!.bufferViews[a.bufferView], [size, read] = COMPONENT[a.componentType]!, width = WIDTH[a.type]!, stride = bv.byteStride ?? size * width, base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const dv = new DataView(bin!.buffer, bin!.byteOffset, bin!.byteLength), out: number[][] = [];
    for (let i = 0; i < a.count; i++) { const row: number[] = []; for (let k = 0; k < width; k++) row.push(read(dv, base + i * stride + k * size)); out.push(row); }
    return out;
  };
  const local = (node: any) => node.matrix ? new Matrix4().fromArray(node.matrix) : new Matrix4().compose(new Vector3(...(node.translation ?? [0, 0, 0])), new Quaternion(...(node.rotation ?? [0, 0, 0, 1])), new Vector3(...(node.scale ?? [1, 1, 1])));
  const parts: GlbPart[] = [];
  const walk = (index: number, parent: Matrix4, path: string) => {
    const node = json!.nodes[index], world = parent.clone().multiply(local(node)), here = `${path}/${node.name ?? index}`;
    if (node.mesh !== undefined) {
      const tris: Tri[] = [];
      for (const prim of json!.meshes[node.mesh].primitives) {
        if ((prim.mode ?? 4) !== 4) continue;
        const pos = accessor(prim.attributes.POSITION).map((p) => new Vector3(p[0], p[1], p[2]).applyMatrix4(world)), idx = prim.indices !== undefined ? accessor(prim.indices).map((r) => r[0]!) : pos.map((_, i) => i);
        for (let i = 0; i + 2 < idx.length; i += 3) tris.push([pos[idx[i]!]!, pos[idx[i + 1]!]!, pos[idx[i + 2]!]!]);
      }
      if (tris.length) parts.push({ name: node.name ?? String(index), path: here, tris });
    }
    for (const child of node.children ?? []) walk(child, world, here);
  };
  const scene = json.scenes[json.scene ?? 0];
  for (const root of scene.nodes) walk(root, new Matrix4(), '');
  return parts;
}
