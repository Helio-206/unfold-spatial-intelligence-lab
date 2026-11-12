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
export type PartOptions = { /** split thin limbs (legs, handles, pins) off thick masses by morphological opening at the scale that separates the most limbs (default OFF: on the ground-truth benchmark it did not improve component recovery and over-split single-piece objects; see reports/reality-engine/INVESTIGATION.md) */ limbs?: boolean; /** a neck must be this fraction shallower than the smaller peak to keep two parts apart */ persistence?: number; minVoxels?: number; maxParts?: number };

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


/** Distance (voxel units, chamfer 3-4-5 / 3) from each voxel to the nearest voxel with `seed` = 1, over the whole grid. */
function distanceFrom(seed: Uint8Array, [nx, ny, nz]: [number, number, number]): Float32Array {
  const d = new Float32Array(seed.length), BIG = 1e9, id = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  for (let i = 0; i < seed.length; i++) d[i] = seed[i] ? 0 : BIG;
  const pass = (forward: boolean) => {
    const ks = forward ? [0, nz, 1] : [nz - 1, -1, -1], js = forward ? [0, ny, 1] : [ny - 1, -1, -1], is = forward ? [0, nx, 1] : [nx - 1, -1, -1];
    for (let k = ks[0]!; k !== ks[1]; k += ks[2]!) for (let j = js[0]!; j !== js[1]; j += js[2]!) for (let i = is[0]!; i !== is[1]; i += is[2]!) {
      const c = id(i, j, k); let best = d[c]!;
      for (const [dx, dy, dz, w] of NEIGH) { const fwd = dz < 0 || (dz === 0 && (dy < 0 || (dy === 0 && dx < 0))); if (forward !== fwd) continue; const a = i + dx, b = j + dy, e = k + dz; if (a < 0 || b < 0 || e < 0 || a >= nx || b >= ny || e >= nz) continue; const v = d[id(a, b, e)]! + w; if (v < best) best = v; }
      d[c] = best;
    }
  };
  pass(true); pass(false); for (let i = 0; i < d.length; i++) d[i] = d[i]! / 3; return d;
}

/**
 * Thin limbs on thick masses. The distance transform alone cannot separate a leg from a seat (a limb of constant thickness has no neck). Opening the solid
 * with a ball of radius r removes everything thinner than r; what is removed, split into connected pieces, are the limbs. The radius that separates the most
 * limbs wins. A limb must be elongated (so a rounded edge is not a limb) and substantial.
 */
function splitLimbs(occ: Uint8Array, labels: Uint16Array, dt: Float32Array, grid: Grid, minVoxels: number, maxParts: number): number {
  const [nx, ny, nz] = grid.cells, total = occ.length; let maxDt = 0; for (let i = 0; i < total; i++) if (occ[i] && dt[i]! > maxDt) maxDt = dt[i]!;
  if (maxDt < 3) return 0;
  let hullTotal = 0; for (let i = 0; i < total; i++) hullTotal += occ[i]!;
  const limbMin = Math.max(minVoxels, 60, Math.round(hullTotal * 0.005)), id = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  type Cand = { r: number; comps: number[][]; volume: number };
  let best: Cand | null = null;
  for (let r = 2; r <= Math.floor(maxDt * 0.6); r++) {
    const core = new Uint8Array(total); for (let i = 0; i < total; i++) core[i] = occ[i] && dt[i]! >= r ? 1 : 0;
    const reach = distanceFrom(core, grid.cells), seen = new Uint8Array(total), comps: number[][] = [];
    for (let i0 = 0; i0 < total; i0++) {
      if (!occ[i0] || seen[i0] || reach[i0]! <= r) continue; // inside the opening (within r of the core): not residue
      const comp: number[] = [], stack = [i0]; seen[i0] = 1;
      while (stack.length) { const v = stack.pop()!; comp.push(v); const x = v % nx, y = Math.floor(v / nx) % ny, z = Math.floor(v / (nx * ny)); for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) { const a = x + dx, b = y + dy, c = z + dz; if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue; const u = id(a, b, c); if (occ[u] && !seen[u] && reach[u]! > r) { seen[u] = 1; stack.push(u); } } }
      if (comp.length >= limbMin) comps.push(comp);
    }
    const limbs = comps.filter((comp) => {
      // elongation from the covariance of the voxel centres: sqrt(l1 / mean(l2, l3))
      let cx = 0, cy = 0, cz = 0; for (const v of comp) { cx += v % nx; cy += Math.floor(v / nx) % ny; cz += Math.floor(v / (nx * ny)); } cx /= comp.length; cy /= comp.length; cz /= comp.length;
      let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0; for (const v of comp) { const dx = (v % nx) - cx, dy = (Math.floor(v / nx) % ny) - cy, dz = Math.floor(v / (nx * ny)) - cz; xx += dx * dx; xy += dx * dy; xz += dx * dz; yy += dy * dy; yz += dy * dz; zz += dz * dz; }
      let a = [1, 0.7, 0.3]; const nrm = Math.hypot(...a); a = a.map((q) => q / nrm); for (let it = 0; it < 25; it++) { const n = [xx * a[0]! + xy * a[1]! + xz * a[2]!, xy * a[0]! + yy * a[1]! + yz * a[2]!, xz * a[0]! + yz * a[1]! + zz * a[2]!], m = Math.hypot(...n) || 1; a = n.map((q) => q / m); }
      const l1 = a[0]! * (xx * a[0]! + xy * a[1]! + xz * a[2]!) + a[1]! * (xy * a[0]! + yy * a[1]! + yz * a[2]!) + a[2]! * (xz * a[0]! + yz * a[1]! + zz * a[2]!), l23 = Math.max(1e-9, (xx + yy + zz - l1) / 2);
      return Math.sqrt(Math.max(l1, 1e-9) / l23) >= 2;
    });
    let volume = 0; for (const c of limbs) volume += c.length; let hullVol = 0; for (let i = 0; i < total; i++) hullVol += occ[i]!;
    if (limbs.length && volume <= 0.6 * hullVol && (!best || volume > best.volume * 1.02)) best = { r, comps: limbs, volume };
  }
  if (!best) return 0;
  let next = 0; for (let i = 0; i < total; i++) if (labels[i]! > next) next = labels[i]!;
  let added = 0; const used = new Set<number>(); for (let i = 0; i < total; i++) if (labels[i]) used.add(labels[i]!);
  for (const comp of best.comps) { if (used.size >= maxParts) break; next++; if (next > 65000) break; for (const v of comp) labels[v] = next; used.add(next); added++; }
  return added;
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
  if (options.limbs === true) splitLimbs(occ, labels, dt, grid, minVoxels, maxParts);
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


/**
 * A correction a PERSON made to the automatic part structure. Parts are named by a world-space seed point INSIDE them, not by label number, so an edit keeps its
 * meaning when the grid or the evidence changes. Applied on top of the automatic segmentation, in order, deterministically; the automatic result is never overwritten
 * (remove the edit and the automatic structure is back). An edit that cannot be applied (seed in empty space, a side too small) is reported, never guessed.
 */
export type PartEdit =
  | { kind: 'merge'; seeds: [[number, number, number], [number, number, number]] }
  | { kind: 'split'; seed: [number, number, number]; axis: 'x' | 'y' | 'z'; at: number }
  | { kind: 'rename'; seed: [number, number, number]; name: string };
export type PartEditReport = { index: number; kind: PartEdit['kind']; applied: boolean; reason?: string };
export type EditedParts = PartsResult & { names: Map<string, string>; reports: PartEditReport[] };

export function applyPartEdits(base: PartsResult, occ: Uint8Array, grid: Grid, edits: readonly PartEdit[], minVoxels = 12): EditedParts {
  const [nx, ny, nz] = grid.cells, labels = Uint16Array.from(base.labels), reports: PartEditReport[] = [], renames: Array<{ seed: [number, number, number]; name: string }> = [];
  const at = (p: readonly number[]): number => { // label of the voxel holding p, or of the nearest labelled voxel within 2 voxels
    const i = Math.floor((p[0]! - grid.min.x) / grid.size), j = Math.floor((p[1]! - grid.min.y) / grid.size), k = Math.floor((p[2]! - grid.min.z) / grid.size);
    for (let r = 0; r <= 2; r++) for (let dk = -r; dk <= r; dk++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { if (Math.max(Math.abs(di), Math.abs(dj), Math.abs(dk)) !== r) continue; const a = i + di, b = j + dj, c = k + dk; if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue; const l = labels[a + nx * (b + ny * c)]!; if (l) return l; }
    return 0;
  };
  let next = 0; for (const l of labels) if (l > next) next = l; next++;
  edits.forEach((e, index) => {
    const rep = (applied: boolean, reason?: string) => reports.push({ index, kind: e.kind, applied, ...(reason ? { reason } : {}) });
    if (e.kind === 'merge') { const a = at(e.seeds[0]), b = at(e.seeds[1]); if (!a || !b) return rep(false, 'um dos pontos não está dentro de nenhuma parte'); if (a === b) return rep(false, 'os dois pontos estão na mesma parte'); for (let i = 0; i < labels.length; i++) if (labels[i] === b) labels[i] = a; return rep(true); }
    if (e.kind === 'rename') { if (!at(e.seed)) return rep(false, 'o ponto não está dentro de nenhuma parte'); renames.push({ seed: e.seed, name: e.name }); return rep(true); }
    const l = at(e.seed); if (!l) return rep(false, 'o ponto não está dentro de nenhuma parte');
    const ax = e.axis === 'x' ? 0 : e.axis === 'y' ? 1 : 2; let lo = 0, hi = 0; const hiIdx: number[] = [];
    for (let id = 0; id < labels.length; id++) { if (labels[id] !== l) continue; const i = id % nx, j = Math.floor(id / nx) % ny, k = Math.floor(id / (nx * ny)), c = ax === 0 ? grid.min.x + (i + 0.5) * grid.size : ax === 1 ? grid.min.y + (j + 0.5) * grid.size : grid.min.z + (k + 0.5) * grid.size; if (c < e.at) lo++; else { hi++; hiIdx.push(id); } }
    if (lo < minVoxels || hi < minVoxels) return rep(false, `o plano deixaria um lado com menos de ${minVoxels} voxels (${lo}/${hi})`);
    for (const id of hiIdx) labels[id] = next; next++; rep(true);
  });
  void ny; void nz;
  // stable ids by position again (same rule as the automatic segmentation), voxel statistics recomputed
  const acc = new Map<number, { n: number; sx: number; sy: number; sz: number; min: Vector3; max: Vector3 }>();
  for (let id = 0; id < labels.length; id++) { const l = labels[id]!; if (!l || !occ[id]) continue; const i = id % nx, j = Math.floor(id / nx) % ny, k = Math.floor(id / (nx * ny)), x = grid.min.x + (i + 0.5) * grid.size, y = grid.min.y + (j + 0.5) * grid.size, z = grid.min.z + (k + 0.5) * grid.size;
    let a = acc.get(l); if (!a) { a = { n: 0, sx: 0, sy: 0, sz: 0, min: new Vector3(Infinity, Infinity, Infinity), max: new Vector3(-Infinity, -Infinity, -Infinity) }; acc.set(l, a); } a.n++; a.sx += x; a.sy += y; a.sz += z; a.min.min(new Vector3(x, y, z)); a.max.max(new Vector3(x, y, z)); }
  const ordered = [...acc.entries()].map(([l, a]) => ({ l, a, c: new Vector3(a.sx / a.n, a.sy / a.n, a.sz / a.n) })).sort((p, q) => p.c.x - q.c.x || p.c.y - q.c.y || p.c.z - q.c.z || p.l - q.l), remap = new Map<number, number>(ordered.map((o, idx) => [o.l, idx + 1]));
  for (let id = 0; id < labels.length; id++) if (labels[id]) labels[id] = remap.get(labels[id]!) ?? 0;
  const parts: Part[] = ordered.map((o, idx) => ({ id: `part-${idx + 1}`, label: idx + 1, voxels: o.a.n, centroid: o.c, min: o.a.min.clone().subScalar(grid.size / 2), max: o.a.max.clone().addScalar(grid.size / 2), peakDistance: 0 }));
  const adj = new Set<string>(); for (let id = 0; id < labels.length; id++) { const l = labels[id]!; if (!l) continue; const i = id % nx, j = Math.floor(id / nx) % ny, k = Math.floor(id / (nx * ny)); for (const [dx, dy, dz] of [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as const) { const a = i + dx, b = j + dy, c = k + dz; if (a >= nx || b >= ny || c >= nz) continue; const o = labels[a + nx * (b + ny * c)]!; if (o && o !== l) adj.add(l < o ? `${l}|${o}` : `${o}|${l}`); } }
  const adjacency = [...adj].map((q) => q.split('|').map(Number) as [number, number]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([a, b]) => [`part-${a}`, `part-${b}`] as [string, string]);
  const names = new Map<string, string>(); for (const r of renames) { const l = (() => { const i = Math.floor((r.seed[0] - grid.min.x) / grid.size), j = Math.floor((r.seed[1] - grid.min.y) / grid.size), k = Math.floor((r.seed[2] - grid.min.z) / grid.size); for (let d = 0; d <= 2; d++) for (let dk = -d; dk <= d; dk++) for (let dj = -d; dj <= d; dj++) for (let di = -d; di <= d; di++) { if (Math.max(Math.abs(di), Math.abs(dj), Math.abs(dk)) !== d) continue; const a = i + di, b = j + dj, c = k + dk; if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue; const v = labels[a + nx * (b + ny * c)]!; if (v) return v; } return 0; })(); if (l) names.set(`part-${l}`, r.name); }
  return { labels, parts, adjacency, discardedVoxels: base.discardedVoxels, names, reports };
}
