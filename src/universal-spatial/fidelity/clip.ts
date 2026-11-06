import type { Field } from './surface-nets';

/**
 * Sub-triangle clipping against a scalar field. The first version of the junction code kept or dropped WHOLE triangles by testing their centroid, which
 * leaves a rim made of teeth the size of one grid cell. Here every triangle that crosses the iso-line is split exactly on it (the crossing is refined along
 * the edge with a few bisection steps on the real field), so the rim follows the field's iso-line smoothly, to well below one cell.
 * Vertices created on an edge are shared by both triangles that use the edge, so the surface stays welded.
 */
export type MeshArrays = { positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint32Array };
export type ClipSpec = { f: Field; keep: 'le' | 'ge'; t: number };

export function clipMesh(input: MeshArrays, specs: ClipSpec[]): MeshArrays {
  let mesh = input;
  for (const spec of specs) mesh = clipOnce(mesh, spec);
  return mesh;
}

function clipOnce(mesh: MeshArrays, spec: ClipSpec): MeshArrays {
  const count = mesh.positions.length / 3, sign = spec.keep === 'le' ? 1 : -1;
  const value = new Float64Array(count); for (let i = 0; i < count; i++) value[i] = sign * (spec.f(mesh.positions[i * 3]!, mesh.positions[i * 3 + 1]!, mesh.positions[i * 3 + 2]!) - spec.t);
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [], remap = new Map<number, number>(), edgeVertex = new Map<string, number>();
  const take = (i: number) => { let m = remap.get(i); if (m === undefined) { m = positions.length / 3; remap.set(i, m); positions.push(mesh.positions[i * 3]!, mesh.positions[i * 3 + 1]!, mesh.positions[i * 3 + 2]!); normals.push(mesh.normals[i * 3]!, mesh.normals[i * 3 + 1]!, mesh.normals[i * 3 + 2]!); uvs.push(mesh.uvs[i * 2]!, mesh.uvs[i * 2 + 1]!); } return m; };
  // vertex on the edge between an inside vertex `a` and an outside vertex `b`, on the iso-line (bisection on the real field)
  const cross = (a: number, b: number) => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`, cached = edgeVertex.get(key); if (cached !== undefined) return cached;
    const ax = mesh.positions[a * 3]!, ay = mesh.positions[a * 3 + 1]!, az = mesh.positions[a * 3 + 2]!, bx = mesh.positions[b * 3]!, by = mesh.positions[b * 3 + 1]!, bz = mesh.positions[b * 3 + 2]!;
    let lo = 0, hi = 1, u = value[a]! / (value[a]! - value[b]!); // start from the linear estimate
    if (!(u > 0 && u < 1)) u = 0.5;
    for (let n = 0; n < 9; n++) { const s = sign * (spec.f(ax + (bx - ax) * u, ay + (by - ay) * u, az + (bz - az) * u) - spec.t); if (s <= 0) lo = u; else hi = u; u = (lo + hi) / 2; }
    const id = positions.length / 3; edgeVertex.set(key, id);
    positions.push(ax + (bx - ax) * u, ay + (by - ay) * u, az + (bz - az) * u);
    const nx = mesh.normals[a * 3]! + (mesh.normals[b * 3]! - mesh.normals[a * 3]!) * u, ny = mesh.normals[a * 3 + 1]! + (mesh.normals[b * 3 + 1]! - mesh.normals[a * 3 + 1]!) * u, nz = mesh.normals[a * 3 + 2]! + (mesh.normals[b * 3 + 2]! - mesh.normals[a * 3 + 2]!) * u, len = Math.hypot(nx, ny, nz) || 1;
    normals.push(nx / len, ny / len, nz / len);
    uvs.push(mesh.uvs[a * 2]! + (mesh.uvs[b * 2]! - mesh.uvs[a * 2]!) * u, mesh.uvs[a * 2 + 1]! + (mesh.uvs[b * 2 + 1]! - mesh.uvs[a * 2 + 1]!) * u);
    return id;
  };
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const v = [mesh.indices[t]!, mesh.indices[t + 1]!, mesh.indices[t + 2]!], inside = v.map((i) => value[i]! <= 0), n = inside.filter(Boolean).length;
    if (n === 3) indices.push(take(v[0]!), take(v[1]!), take(v[2]!));
    else if (n === 1) { const k = inside.indexOf(true), a = v[k]!, b = v[(k + 1) % 3]!, c = v[(k + 2) % 3]!; indices.push(take(a), cross(a, b), cross(a, c)); }
    else if (n === 2) { const k = inside.indexOf(false), o = v[k]!, a = v[(k + 1) % 3]!, b = v[(k + 2) % 3]!; const oa = cross(a, o), ob = cross(b, o); indices.push(take(a), take(b), ob, take(a), ob, oa); }
  }
  return { positions: Float32Array.from(positions), normals: Float32Array.from(normals), uvs: Float32Array.from(uvs), indices: Uint32Array.from(indices) };
}
