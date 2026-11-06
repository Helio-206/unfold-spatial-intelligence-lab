import { Box3, Matrix4, Vector3 } from 'three';
import type { GeometryNodeV2, MaterialV2 } from '../contracts-v2';
import { clipMesh, type ClipSpec, type MeshArrays } from './clip';
import { implicitShapesOf, smoothMin, unionFieldCulled, type ImplicitShape } from './sdf';
import { surfaceNets, type Field } from './surface-nets';

/**
 * One continuous-surface computation as PURE DATA IN, PURE DATA OUT: no meshes, no materials, no closures cross the boundary. That is what lets the same
 * function run in a Web Worker (structured-clone in, transferable buffers out), inline (tests, fallback), and be cached by a content key.
 *
 * Rules that keep the silhouette of the plan:
 *  - a fillet is blended only between parts that already touch or overlap (gap <= blend radius). A gap is a defect of the plan, for the assembly solver and a
 *    person to decide: the router does not hide it by growing material across it;
 *  - the blend radius is 0.8 of the thinnest feature of the pair, so smoothing can add at most 20% of that feature (smooth-min deficit = k/4);
 *  - a junction is drawn by one side only (the thinner part flares into the thicker one);
 *  - the skirt is cut on the iso-line of the partner (sub-triangle clipping), not by dropping whole triangles.
 * Sizes are LOCAL (this part and its partners), so a key does not change when something far away in the scene moves.
 */
export const JOB_VERSION = 4; // 4: normals sampled one cell wide (no pearl-string highlights along under-resolved edges)
export type JobNeighbour = { id: string; geometry: GeometryNodeV2; /** neighbour space -> this component's space, column-major */ toLocal: number[] };
export type ContinuousJob = { entityId: string; key: string; geometry: GeometryNodeV2; neighbours: JobNeighbour[]; maxTriangles: number; maxGridCells: number };
export type JobGroup = { material: MaterialV2; keys: string[]; positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint32Array; blend: number };
export type Deviation = {
  /** largest |distance to the part's own shape| of a vertex far from every partner: how far the surface strays from the plan's silhouette (0 = exact) */
  freeMax: number;
  /** same, for vertices inside a blend zone (bounded by k/4 plus one cell) */
  blendMax: number;
  cell: number;
};
export type JobResult =
  | { ok: true; groups: JobGroup[]; triangles: number; bytes: number; cells: number; blendRadius: number; blendedWith: string[]; deviation: Deviation; ms: number }
  | { ok: false; code: string };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const signature = (m: MaterialV2) => `${m.profile}|${m.color}|${m.roughness}|${m.metalness}|${m.clearcoat}`;
const boxGap = (a: Box3, b: Box3) => Math.hypot(Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x), Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y), Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z));
const boxOf = (shapes: ImplicitShape[]) => { const b = new Box3(); for (const s of shapes) b.union(s.box); return b; };
const minFeature = (shapes: ImplicitShape[]) => Math.min(...shapes.map((s) => s.featureRadius));

/** `rim: 'discard'` is the pre-clipping behaviour (whole triangles dropped at the skirt edge). It exists ONLY as a measurement baseline for the artefact metrics; the router never uses it. */
export type JobOptions = { rim?: 'clip' | 'discard' };
export function runContinuousJob(job: ContinuousJob, clock: () => number = () => performance.now(), options: JobOptions = {}): JobResult {
  const t0 = clock(), own = implicitShapesOf(job.geometry);
  if ('code' in own) return { ok: false, code: own.code };
  if (!own.length) return { ok: false, code: 'NO_SHAPES' };
  const partners = job.neighbours.map((n) => ({ id: n.id, matrix: new Matrix4().fromArray(n.toLocal), shapes: implicitShapesOf(n.geometry) })).filter((n): n is { id: string; matrix: Matrix4; shapes: ImplicitShape[] } => !('code' in n.shapes) && n.shapes.length > 0);
  const byMaterial = new Map<string, ImplicitShape[]>(); for (const s of own) byMaterial.set(signature(s.material), [...(byMaterial.get(signature(s.material)) ?? []), s]);

  const groups: JobGroup[] = [], blendedWith = new Set<string>(); let triangles = 0, bytes = 0, cells = 0, blendRadius = 0, freeMax = 0, blendMax = 0, lastCell = 0;
  for (const shapes of byMaterial.values()) {
    const box = boxOf(shapes), feature = minFeature(shapes), kInternal = clamp(0.5 * feature, 0, Infinity), ownField = unionFieldCulled(shapes, kInternal);
    // partners that flare INTO this part's neighbours: only a thinner part draws the fillet (ties: the later id), and only if the two already touch
    const active = partners.map((n) => {
      const pf = minFeature(n.shapes), thinner = feature < pf * 0.999 || (Math.abs(feature - pf) <= pf * 0.001 && job.entityId < n.id), k = 0.8 * Math.min(feature, pf);
      const nb = new Box3(); for (const s of n.shapes) nb.union(s.box.clone().applyMatrix4(n.matrix));
      return { n, thinner, k, gap: boxGap(box, nb) };
    }).filter((p) => p.thinner && p.gap <= p.k);
    const k = active.length ? Math.max(...active.map((p) => p.k)) : 0;
    const partnerFields: Field[] = active.map(({ n }) => { const e = n.matrix.clone().invert().elements, f = unionFieldCulled(n.shapes, 0), s = Math.min(new Vector3().setFromMatrixColumn(n.matrix, 0).length(), new Vector3().setFromMatrixColumn(n.matrix, 1).length(), new Vector3().setFromMatrixColumn(n.matrix, 2).length()); return (x: number, y: number, z: number) => f(e[0]! * x + e[4]! * y + e[8]! * z + e[12]!, e[1]! * x + e[5]! * y + e[9]! * z + e[13]!, e[2]! * x + e[6]! * y + e[10]! * z + e[14]!) * s; });
    const field: Field = partnerFields.length ? (x, y, z) => { let d = ownField(x, y, z); for (let i = 0; i < partnerFields.length; i++) d = smoothMin(d, partnerFields[i]!(x, y, z), active[i]!.k); return d; } : ownField;

    const pad = k * 1.5, size3 = box.getSize(new Vector3()).addScalar(2 * pad), extent = Math.max(size3.x, size3.y, size3.z);
    let cell = Math.min(extent / 56, feature / 1.2); cell = Math.max(cell, extent / job.maxGridCells); lastCell = cell;
    if (feature < 0.75 * cell) return { ok: false, code: 'FEATURE_BELOW_RESOLUTION' };
    const min = box.min.clone().subScalar(pad + cell), dims = [0, 1, 2].map((a) => Math.max(2, Math.ceil((size3.getComponent(a) + 2 * cell) / cell))) as [number, number, number];
    if (dims[0] * dims[1] * dims[2] > 1_400_000) return { ok: false, code: 'GRID_TOO_LARGE' };
    let geometry;
    try { geometry = surfaceNets({ min, cells: dims, size: cell, field, maxTriangles: Math.floor(job.maxTriangles / 4), ...(options.rim === 'discard' && partnerFields.length ? { keep: (x: number, y: number, z: number) => ownField(x, y, z) <= k * 0.6 + cell && partnerFields.every((pf) => pf(x, y, z) >= -cell * 0.2) } : {}) }); }
    catch (error) { return { ok: false, code: error instanceof Error && error.message.startsWith('SPATIAL_FIDELITY') ? error.message.replace('SPATIAL_FIDELITY_', '') : 'SURFACE_FAILED' }; }
    let mesh: MeshArrays = { positions: geometry.getAttribute('position').array as Float32Array, normals: geometry.getAttribute('normal').array as Float32Array, uvs: geometry.getAttribute('uv').array as Float32Array, indices: Uint32Array.from((geometry.index?.array ?? []) as ArrayLike<number>) };
    geometry.dispose();
    if (partnerFields.length && options.rim !== 'discard') {
      const specs: ClipSpec[] = [{ f: ownField, keep: 'le', t: 0.6 * k }, ...partnerFields.map((f): ClipSpec => ({ f, keep: 'ge', t: -cell * 0.05 }))];
      mesh = clipMesh(mesh, specs);
    }
    if (!mesh.indices.length) return { ok: false, code: 'EMPTY_SURFACE' };

    // silhouette audit: how far does the surface stray from the plan's own shape?
    const step = Math.max(1, Math.floor(mesh.positions.length / 3 / 2000));
    for (let v = 0; v < mesh.positions.length / 3; v += step) {
      const x = mesh.positions[v * 3]!, y = mesh.positions[v * 3 + 1]!, z = mesh.positions[v * 3 + 2]!, d = Math.abs(ownField(x, y, z));
      if (partnerFields.some((pf, i) => pf(x, y, z) < active[i]!.k)) blendMax = Math.max(blendMax, d); else freeMax = Math.max(freeMax, d);
    }
    blendRadius = Math.max(blendRadius, k); for (const p of active) blendedWith.add(p.n.id);
    groups.push({ material: shapes[0]!.material, keys: shapes.map((s) => s.key), ...mesh, blend: k });
    triangles += mesh.indices.length / 3; bytes += mesh.positions.byteLength + mesh.normals.byteLength + mesh.uvs.byteLength + mesh.indices.byteLength; cells += dims[0] * dims[1] * dims[2];
  }
  return { ok: true, groups, triangles, bytes, cells, blendRadius, blendedWith: [...blendedWith], deviation: { freeMax, blendMax, cell: lastCell }, ms: clock() - t0 };
}

/** Stable content key: same geometry, same partners in the same relative placement, same limits, same version, same key. */
export function jobKey(job: Omit<ContinuousJob, 'key'>): string {
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  const text = JSON.stringify([JOB_VERSION, job.geometry, job.neighbours.map((n) => [n.id, n.geometry, n.toLocal.map(round)]), job.maxTriangles, job.maxGridCells]);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57; for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909); h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${job.entityId}:${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}:${text.length}`;
}
