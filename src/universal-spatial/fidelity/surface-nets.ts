import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';

/**
 * Surface nets: a signed distance field sampled on a regular grid becomes one smooth, closed triangle surface (negative = inside).
 * One vertex per cell that the surface crosses (the mean of the edge crossings), quads across every sign-changing grid edge, normals from the field gradient,
 * box-projected UVs. No lookup tables, no dependency. Bounded: the caller chooses the grid and the result reports its size.
 */
export type Field = (x: number, y: number, z: number) => number;
export type SurfaceNetsOptions = {
  min: Vector3;
  /** cells per axis */
  cells: [number, number, number];
  size: number;
  field: Field;
  /** triangles whose centroid fails this test are dropped (used to keep only the part of a blended surface that belongs to one component) */
  keep?: (x: number, y: number, z: number) => boolean;
  /** hard stop: throws SPATIAL_FIDELITY_GRID_LIMIT when the surface would exceed this many triangles */
  maxTriangles?: number;
};

const CORNERS: Array<[number, number, number]> = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
const EDGES: Array<[number, number]> = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];

export function surfaceNets(options: SurfaceNetsOptions): BufferGeometry {
  const { min, cells, size, field } = options, [nx, ny, nz] = cells, sx = nx + 1, sy = ny + 1, sz = nz + 1;
  const values = new Float32Array(sx * sy * sz), at = (i: number, j: number, k: number) => i + sx * (j + sy * k);
  for (let k = 0; k < sz; k++) for (let j = 0; j < sy; j++) for (let i = 0; i < sx; i++) values[at(i, j, k)] = field(min.x + i * size, min.y + j * size, min.z + k * size);

  const cellVertex = new Int32Array(nx * ny * nz).fill(-1), cellAt = (i: number, j: number, k: number) => i + nx * (j + ny * k), positions: number[] = [];
  const corner = new Float32Array(8);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let mask = 0; for (let c = 0; c < 8; c++) { const [a, b, d] = CORNERS[c]!; corner[c] = values[at(i + a, j + b, k + d)]!; if (corner[c]! < 0) mask |= 1 << c; }
    if (mask === 0 || mask === 255) continue;
    let count = 0, vx = 0, vy = 0, vz = 0;
    for (const [e0, e1] of EDGES) {
      const v0 = corner[e0]!, v1 = corner[e1]!; if ((v0 < 0) === (v1 < 0)) continue;
      const t = v0 / (v0 - v1), p0 = CORNERS[e0]!, p1 = CORNERS[e1]!;
      vx += p0[0] + (p1[0] - p0[0]) * t; vy += p0[1] + (p1[1] - p0[1]) * t; vz += p0[2] + (p1[2] - p0[2]) * t; count++;
    }
    cellVertex[cellAt(i, j, k)] = positions.length / 3;
    positions.push(min.x + (i + vx / count) * size, min.y + (j + vy / count) * size, min.z + (k + vz / count) * size);
  }

  const indices: number[] = [], limit = options.maxTriangles ?? Infinity;
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) indices.push(a, c, b, a, d, c); else indices.push(a, b, c, a, c, d); if (indices.length / 3 > limit) throw new Error('SPATIAL_FIDELITY_GRID_LIMIT'); };
  for (let k = 0; k < sz; k++) for (let j = 0; j < sy; j++) for (let i = 0; i < sx; i++) {
    const v0 = values[at(i, j, k)]! < 0;
    if (i + 1 < sx && j >= 1 && k >= 1 && j < ny && k < nz && v0 !== (values[at(i + 1, j, k)]! < 0)) quad(cellVertex[cellAt(i, j - 1, k - 1)]!, cellVertex[cellAt(i, j, k - 1)]!, cellVertex[cellAt(i, j, k)]!, cellVertex[cellAt(i, j - 1, k)]!, v0);
    if (j + 1 < sy && i >= 1 && k >= 1 && i < nx && k < nz && v0 !== (values[at(i, j + 1, k)]! < 0)) quad(cellVertex[cellAt(i - 1, j, k - 1)]!, cellVertex[cellAt(i - 1, j, k)]!, cellVertex[cellAt(i, j, k)]!, cellVertex[cellAt(i, j, k - 1)]!, v0);
    if (k + 1 < sz && i >= 1 && j >= 1 && i < nx && j < ny && v0 !== (values[at(i, j, k + 1)]! < 0)) quad(cellVertex[cellAt(i - 1, j - 1, k)]!, cellVertex[cellAt(i, j - 1, k)]!, cellVertex[cellAt(i, j, k)]!, cellVertex[cellAt(i - 1, j, k)]!, v0);
  }

  // normals from the gradient; every triangle is then wound to face along it, so orientation never depends on the quad bookkeeping
  const h = size * 1.0, vertexCount = positions.length / 3, normals = new Float32Array(vertexCount * 3), grad = new Vector3();
  for (let v = 0; v < vertexCount; v++) {
    const x = positions[v * 3]!, y = positions[v * 3 + 1]!, z = positions[v * 3 + 2]!;
    grad.set(field(x + h, y, z) - field(x - h, y, z), field(x, y + h, z) - field(x, y - h, z), field(x, y, z + h) - field(x, y, z - h)).normalize();
    normals.set([grad.x, grad.y, grad.z], v * 3);
  }
  const kept: number[] = [], a = new Vector3(), b = new Vector3(), c = new Vector3(), e1 = new Vector3(), e2 = new Vector3(), n = new Vector3();
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t]!, i1 = indices[t + 1]!, i2 = indices[t + 2]!;
    a.fromArray(positions, i0 * 3); b.fromArray(positions, i1 * 3); c.fromArray(positions, i2 * 3);
    if (options.keep && !options.keep((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3)) continue;
    e1.subVectors(b, a); e2.subVectors(c, a); n.crossVectors(e1, e2);
    if (n.lengthSq() < 1e-30) continue;
    const ref = new Vector3().fromArray(normals, i0 * 3).add(new Vector3().fromArray(normals, i1 * 3)).add(new Vector3().fromArray(normals, i2 * 3));
    if (n.dot(ref) < 0) kept.push(i0, i2, i1); else kept.push(i0, i1, i2);
  }
  // drop vertices no kept triangle uses
  const remap = new Int32Array(vertexCount).fill(-1); let used = 0; for (const i of kept) if (remap[i] < 0) remap[i] = used++;
  const outPos = new Float32Array(used * 3), outNor = new Float32Array(used * 3), outUv = new Float32Array(used * 2);
  for (let v = 0; v < vertexCount; v++) {
    const m = remap[v]!; if (m < 0) continue;
    const x = positions[v * 3]!, y = positions[v * 3 + 1]!, z = positions[v * 3 + 2]!, nxv = normals[v * 3]!, nyv = normals[v * 3 + 1]!, nzv = normals[v * 3 + 2]!;
    outPos.set([x, y, z], m * 3); outNor.set([nxv, nyv, nzv], m * 3);
    const ax = Math.abs(nxv), ay = Math.abs(nyv), az = Math.abs(nzv); // box projection along the dominant normal axis
    outUv.set(ax >= ay && ax >= az ? [z, y] : ay >= az ? [x, z] : [x, y], m * 2);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(outPos, 3)); geometry.setAttribute('normal', new Float32BufferAttribute(outNor, 3)); geometry.setAttribute('uv', new Float32BufferAttribute(outUv, 2));
  geometry.setIndex(kept.map((i) => remap[i]!)); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}
