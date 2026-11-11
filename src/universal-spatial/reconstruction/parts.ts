import { Vector3 } from 'three';
import type { Grid } from './silhouette';

/**
 * Part segmentation of a reconstructed solid. Persistence-based watershed on the distance transform: thick masses are basins; two basins stay separate
 * when the neck between them is deep relative to the smaller basin, otherwise they merge. Purely geometric (nothing is named), deterministic, bounded.
 * Parts are HYPOTHESES about structure: the evidence is silhouettes, which say nothing about how the object is assembled. They get stable ids ordered
 * by position, and a person can rename, merge or reject them in review.
 */
export type Part = { id: string; label: number; voxels: number; centroid: Vector3; min: Vector3; max: Vector3; peakDistance: number };
export type PartsResult = { labels: Uint16Array; parts: Part[]; adjacency: Array<[string, string]>; /** voxels of isolated specks below minVoxels, removed (reported, never hidden) */ discardedVoxels: number };
export type PartOptions = { /** a neck must be this fraction shallower than the smaller peak to keep two parts apart */ persistence?: number; minVoxels?: number; maxParts?: number };

const NEIGH: Array<[number, number, number, number]> = []; // dx, dy, dz, chamfer weight (3-4-5)
for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const n = Math.abs(dx) + Math.abs(dy) + Math.abs(dz); if (n) NEIGH.push([dx, dy, dz, n === 1 ? 3 : n === 2 ? 4 : 5]); }

function distanceTransform(occ: Uint8Array, [nx, ny, nz]: [number, number, number]): Float32Array {
  const d = new Float32Array(occ.length), BIG = 1e9, id = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  for (let i = 0; i < occ.length; i++) d[i] = occ[i] ? BIG : 0;
  const pass = (forward: boolean) => {
    const ks = forward ? [0, nz, 1] : [nz - 1, -1, -1], js = forward ? [0, ny, 1] : [ny - 1, -1, -1], is = forward ? [0, nx, 1] : [nx - 1, -1, -1];
    for (let k = ks[0]!; k !== ks[1]; k += ks[2]!) for (let j = js[0]!; j !== js[1]; j += js[2]!) for (let i = is[0]!; i !== is[1]; i += is[2]!) {
      const c = id(i, j, k); if (!occ[c]) continue;
      let best = d[c]!;
      for (const [dx, dy, dz, w] of NEIGH) {
        const forwardNeighbour = dz < 0 || (dz === 0 && (dy < 0 || (dy === 0 && dx < 0)));
        if (forward !== forwardNeighbour) continue;
        const a = i + dx, b = j + dy, e = k + dz;
        const v = a < 0 || b < 0 || e < 0 || a >= nx || b >= ny || e >= nz ? w : d[id(a, b, e)]! + w; // outside the grid counts as background
        if (v < best) best = v;
      }
      d[c] = best;
    }
  };
  pass(true); pass(false);
  for (let i = 0; i < d.length; i++) d[i] = d[i]! / 3;
  return d;
}

export function segmentParts(occ: Uint8Array, grid: Grid, options: PartOptions = {}): PartsResult {
  const persistence = options.persistence ?? 0.4, minVoxels = options.minVoxels ?? 30, maxParts = options.maxParts ?? 12;
  const [nx, ny, nz] = grid.cells, total = occ.length;
  const empty: PartsResult = { labels: new Uint16Array(total), parts: [], adjacency: [], discardedVoxels: 0 };
  let occupied = 0; for (let i = 0; i < total; i++) if (occ[i]) occupied++;
  if (!occupied) return empty;
  const dt = distanceTransform(occ, grid.cells);
  // union-find over basins; process voxels from the highest distance down
  const order: number[] = []; for (let i = 0; i < total; i++) if (occ[i]) order.push(i);
  order.sort((a, b) => dt[b]! - dt[a]! || a - b);
  const parent = new Int32Array(total).fill(-1), peak = new Float32Array(total);
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]!]!; x = parent[x]!; } return x; };
  for (const v of order) {
    const i = v % nx, j = Math.floor(v / nx) % ny, k = Math.floor(v / (nx * ny));
    parent[v] = v; peak[v] = dt[v]!;
    for (const [dx, dy, dz] of NEIGH) {
      const a = i + dx, b = j + dy, e = k + dz; if (a < 0 || b < 0 || e < 0 || a >= nx || b >= ny || e >= nz) continue;
      const u = a + nx * (b + ny * e); if (parent[u]! < 0) continue;
      const ru = find(u), rv = find(v); if (ru === rv) continue;
      const small = Math.min(peak[ru]!, peak[rv]!), big = Math.max(peak[ru]!, peak[rv]!), saddle = dt[v]!;
      // merge when the neck is shallow relative to the smaller basin (or the basin is tiny); the higher peak survives
      if (small - saddle < persistence * small || small < 1.5) { const keep = peak[ru]! >= peak[rv]! ? ru : rv, drop = keep === ru ? rv : ru; parent[drop] = keep; peak[keep] = big; }
    }
  }
  const rootLabel = new Map<number, number>(); const labels = new Uint16Array(total);
  const roots: number[] = []; for (const v of order) { const r = find(v); if (!rootLabel.has(r)) { rootLabel.set(r, roots.length + 1); roots.push(r); } labels[v] = rootLabel.get(r)!; }
  type Acc = { n: number; sx: number; sy: number; sz: number; min: Vector3; max: Vector3; peak: number };
  const collect = (): Map<number, Acc> => {
    const acc = new Map<number, Acc>();
    for (const v of order) {
      const l = labels[v]!; if (!l) continue; const i = v % nx, j = Math.floor(v / nx) % ny, k = Math.floor(v / (nx * ny));
      const x = grid.min.x + (i + 0.5) * grid.size, y = grid.min.y + (j + 0.5) * grid.size, z = grid.min.z + (k + 0.5) * grid.size;
      let a = acc.get(l); if (!a) { a = { n: 0, sx: 0, sy: 0, sz: 0, min: new Vector3(Infinity, Infinity, Infinity), max: new Vector3(-Infinity, -Infinity, -Infinity), peak: 0 }; acc.set(l, a); }
      a.n++; a.sx += x; a.sy += y; a.sz += z; a.min.min(new Vector3(x, y, z)); a.max.max(new Vector3(x, y, z)); a.peak = Math.max(a.peak, dt[v]!);
    }
    return acc;
  };
  // merge undersized / excess parts into the neighbour sharing the largest contact
  const contact = (): Map<string, number> => {
    const m = new Map<string, number>();
    for (const v of order) {
      const i = v % nx, j = Math.floor(v / nx) % ny, k = Math.floor(v / (nx * ny)), l = labels[v]!;
      for (const [dx, dy, dz, w] of NEIGH) { if (w !== 3) continue; const a = i + dx, b = j + dy, e = k + dz; if (a < 0 || b < 0 || e < 0 || a >= nx || b >= ny || e >= nz) continue; const o = labels[a + nx * (b + ny * e)]!; if (o && o !== l) { const key = l < o ? `${l}|${o}` : `${o}|${l}`; m.set(key, (m.get(key) ?? 0) + 1); } }
    }
    return m;
  };
  let discarded = 0;
  for (let guard = 0; guard < 64; guard++) {
    const acc = collect(); if (acc.size <= 1) break;
    const sorted = [...acc.entries()].sort((a, b) => a[1].n - b[1].n), [smallLabel, small] = sorted[0]!;
    if (small.n >= minVoxels && acc.size <= maxParts) break;
    const contacts = contact(); let target = -1, best = -1;
    for (const [key, c] of contacts) { const [p, q] = key.split('|').map(Number) as [number, number]; if (p === smallLabel || q === smallLabel) { if (c > best) { best = c; target = p === smallLabel ? q : p; } } }
    if (target < 0) {
      if (small.n >= minVoxels) break; // isolated but substantial: a real separate part
      for (let i = 0; i < total; i++) if (labels[i] === smallLabel) { labels[i] = 0; discarded++; } // floating speck from inconsistent views
      continue;
    }
    for (let i = 0; i < total; i++) if (labels[i] === smallLabel) labels[i] = target;
  }
  // stable ids ordered by position (x, then y, then z)
  const acc = collect(), ordered = [...acc.entries()].map(([l, a]) => ({ l, a, c: new Vector3(a.sx / a.n, a.sy / a.n, a.sz / a.n) }))
    .sort((p, q) => p.c.x - q.c.x || p.c.y - q.c.y || p.c.z - q.c.z || p.l - q.l);
  const remap = new Map<number, number>(ordered.map((o, idx) => [o.l, idx + 1]));
  for (let i = 0; i < total; i++) if (labels[i]) labels[i] = remap.get(labels[i]!)!;
  const parts: Part[] = ordered.map((o, idx) => ({ id: `part-${idx + 1}`, label: idx + 1, voxels: o.a.n, centroid: o.c, min: o.a.min.clone().subScalar(grid.size / 2), max: o.a.max.clone().addScalar(grid.size / 2), peakDistance: o.a.peak * grid.size }));
  const adjacency: Array<[string, string]> = [];
  for (const key of [...contact().keys()].map((k) => k.split('|').map(Number) as [number, number]).map(([p, q]) => [remap.get(p)!, remap.get(q)!].sort((a, b) => a - b) as [number, number]).sort((a, b) => a[0] - b[0] || a[1] - b[1])) adjacency.push([`part-${key[0]}`, `part-${key[1]}`]);
  void ny; void nz;
  return { discardedVoxels: discarded, labels, parts, adjacency: adjacency.filter((p, i, arr) => i === 0 || p[0] !== arr[i - 1]![0] || p[1] !== arr[i - 1]![1]) };
}
