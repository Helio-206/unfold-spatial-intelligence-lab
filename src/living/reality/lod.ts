import type { PartMesh } from './model';

/**
 * Levels of detail for a reconstructed shell, by vertex clustering. The error of every level is KNOWN, not assumed: each original vertex moves at most to the
 * mean of the vertices of its cell, so the displacement is bounded by the cell diagonal and the measured maximum is recorded. Nothing is invented (no new
 * vertices, colours are cluster means, `observed` stays true only where some member was seen), winding is kept so normals stay outward, and level 0 is the
 * untouched shell.
 */
export type LodLevel = { level: number; cell: number; triangles: number; vertices: number; maxDisplacement: number; meanDisplacement: number; mesh: Pick<PartMesh, 'positions' | 'normals' | 'indices' | 'colours' | 'observed'> };
type Src = Pick<PartMesh, 'positions' | 'normals' | 'indices' | 'colours' | 'observed'>;

export function decimateByClustering(src: Src, cell: number): LodLevel | null {
  const n = src.positions.length / 3; if (!(cell > 0) || n < 12) return null;
  const key = new Map<string, number>(), ids = new Int32Array(n);
  const sum = { p: [] as number[], nrm: [] as number[], c: [] as number[], count: [] as number[], seen: [] as number[] };
  for (let i = 0; i < n; i++) {
    const k = `${Math.floor(src.positions[i * 3]! / cell)},${Math.floor(src.positions[i * 3 + 1]! / cell)},${Math.floor(src.positions[i * 3 + 2]! / cell)}`; let id = key.get(k);
    if (id === undefined) { id = key.size; key.set(k, id); sum.p.push(0, 0, 0); sum.nrm.push(0, 0, 0); sum.c.push(0, 0, 0); sum.count.push(0); sum.seen.push(0); }
    ids[i] = id; sum.count[id]!++; sum.seen[id] = Math.max(sum.seen[id]!, src.observed[i]!);
    for (let a = 0; a < 3; a++) { sum.p[id * 3 + a]! += src.positions[i * 3 + a]!; sum.nrm[id * 3 + a]! += src.normals[i * 3 + a]!; sum.c[id * 3 + a]! += src.colours[i * 3 + a]!; }
  }
  const m = key.size, positions = new Float32Array(m * 3), normals = new Float32Array(m * 3), colours = new Float32Array(m * 3), observed = new Uint8Array(m);
  for (let id = 0; id < m; id++) {
    const c = sum.count[id]!; let nx = sum.nrm[id * 3]!, ny = sum.nrm[id * 3 + 1]!, nz = sum.nrm[id * 3 + 2]!; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (let a = 0; a < 3; a++) { positions[id * 3 + a] = sum.p[id * 3 + a]! / c; colours[id * 3 + a] = sum.c[id * 3 + a]! / c; } normals[id * 3] = nx; normals[id * 3 + 1] = ny; normals[id * 3 + 2] = nz; observed[id] = sum.seen[id]!;
  }
  const tri: number[] = []; for (let t = 0; t < src.indices.length; t += 3) { const a = ids[src.indices[t]!]!, b = ids[src.indices[t + 1]!]!, c = ids[src.indices[t + 2]!]!; if (a !== b && b !== c && a !== c) tri.push(a, b, c); }
  if (!tri.length) return null;
  let maxD = 0, sumD = 0; for (let i = 0; i < n; i++) { const id = ids[i]!, d = Math.hypot(src.positions[i * 3]! - positions[id * 3]!, src.positions[i * 3 + 1]! - positions[id * 3 + 1]!, src.positions[i * 3 + 2]! - positions[id * 3 + 2]!); if (d > maxD) maxD = d; sumD += d; }
  return { level: 0, cell, triangles: tri.length / 3, vertices: m, maxDisplacement: maxD, meanDisplacement: sumD / n, mesh: { positions, normals, colours, observed, indices: Uint32Array.from(tri) } };
}

/** Levels for a part: 0 = the shell itself, then clustering at 2x and 4x the typical edge length, each kept only if it removes a meaningful share of triangles. */
export function buildLods(part: Src, options: { minTriangles?: number } = {}): LodLevel[] {
  const tris = part.indices.length / 3, base: LodLevel = { level: 0, cell: 0, triangles: tris, vertices: part.positions.length / 3, maxDisplacement: 0, meanDisplacement: 0, mesh: part };
  if (tris < (options.minTriangles ?? 4000)) return [base];
  let edge = 0, count = 0; for (let t = 0; t < part.indices.length && count < 3000; t += 3, count++) { const a = part.indices[t]! * 3, b = part.indices[t + 1]! * 3; edge += Math.hypot(part.positions[a]! - part.positions[b]!, part.positions[a + 1]! - part.positions[b + 1]!, part.positions[a + 2]! - part.positions[b + 2]!); }
  edge /= Math.max(1, count); const levels = [base];
  for (const f of [2, 4]) { const l = decimateByClustering(part, edge * f); if (l && l.triangles <= levels.at(-1)!.triangles * 0.65) levels.push({ ...l, level: levels.length }); }
  return levels;
}
