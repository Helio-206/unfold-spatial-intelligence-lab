import { Vector3 } from 'three';
import type { Grid } from './silhouette';
import { orbitDirection, type Frame, type SilhouetteView } from './multiview';

/**
 * Multi-view part understanding. A promptable segmenter proposes 2D part masks in every photograph (AI HYPOTHESES, not measurements); the geometry decides what
 * they mean in 3D. Each proposal is lifted onto the surface voxels that its pixels see (first occupied voxel along each pixel ray of that view). Two neighbouring
 * surface voxels belong to the same physical part when they keep being proposed together by the views that see both: affinity = weighted Jaccard of the sets of
 * proposals containing each voxel (whole-object proposals carry little weight). Superpoints are merged greedily by mean affinity along their shared boundary;
 * the interior takes the label of the nearest surface voxel. A part exists in the output only where several views agree; where they do not, nothing is invented.
 */
export type ProposalView = { view: SilhouetteView; res: number; /** proposal masks resampled into this view's window, res x res */ proposals: Uint8Array[] };
export type LiftOptions = {
  /** adjacent voxels with at least this affinity form one superpoint (default 0.8) */ seedAffinity?: number;
  /** superpoints merge while their mean boundary affinity is at least this (default 0.55) */ mergeAffinity?: number;
  /** a part must hold at least this share of the observed surface (default 0.03) */ minShare?: number;
  /** minimum views that must see both voxels for an affinity to count (default 2) */ minViews?: number;
};
export type LiftResult = { labels: Uint16Array; parts: number; observedSurface: number; hiddenSurface: number; note: string };

const FORWARD: Array<[number, number, number]> = []; for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dz > 0 || (dz === 0 && (dy > 0 || (dy === 0 && dx > 0)))) FORWARD.push([dx, dy, dz]);
const OFFS6: Array<[number, number, number]> = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

export function liftProposals(occ: Uint8Array, grid: Grid, frame: Frame, input: readonly ProposalView[], options: LiftOptions = {}): LiftResult {
  const [nx, ny, nz] = grid.cells, N = occ.length, half = frame.half, seedAff = options.seedAffinity ?? 0.8, mergeAff = options.mergeAffinity ?? 0.55, minShare = options.minShare ?? 0.03, minViews = options.minViews ?? 2;
  const empty = (note: string): LiftResult => ({ labels: new Uint16Array(N), parts: 0, observedSurface: 0, hiddenSurface: 0, note });
  const isSurface = (id: number) => { if (!occ[id]) return false; const i = id % nx, j = Math.floor(id / nx) % ny, k = Math.floor(id / (nx * ny)); for (const [dx, dy, dz] of OFFS6) { const a = i + dx, b = j + dy, c = k + dz; if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz || !occ[a + nx * (b + ny * c)]) return true; } return false; };
  const surf: number[] = []; const sIdx = new Int32Array(N).fill(-1); for (let id = 0; id < N; id++) if (isSurface(id)) { sIdx[id] = surf.length; surf.push(id); }
  if (!surf.length || !input.length) return empty('no surface or no views');
  // flatten the proposals; weight = (1 - area/objectArea)^2 so the whole-object proposal contributes almost nothing
  type Prop = { view: number; w: number }; const props: Prop[] = []; const propOf: Array<number[]> = input.map(() => []);
  input.forEach((pv, vi) => { let obj = 0; for (const v of pv.view.mask) obj += v; pv.proposals.forEach((m) => { let a = 0; for (const v of m) a += v; const share = obj ? a / obj : 1, w = Math.max(0, 1 - share) ** 2; propOf[vi]!.push(props.length); props.push({ view: vi, w }); }); });
  const K = props.length; if (!K) return empty('no proposals');
  // per voxel: bitset of proposals containing it in the views that see it, and bitset of views that see it
  const words = Math.ceil(K / 32), mem = new Uint32Array(surf.length * words), seen = new Uint32Array(surf.length); // views <= 32
  if (input.length > 32) return empty('too many views for the lifting (max 32)');
  input.forEach((pv, vi) => {
    const d = orbitDirection(pv.view.azimuthDeg, pv.view.elevationDeg), worldUp = Math.abs(d.y) > 0.98 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
    const right = new Vector3().crossVectors(worldUp, d).normalize(), up = new Vector3().crossVectors(d, right).normalize(), res = pv.res;
    // per pixel the voxel hit; per voxel the hit-pixel counts per proposal, accepted when at least half of the voxel's hit pixels are inside the proposal
    const hits = new Map<number, { n: number; inside: number[] }>();
    for (let Y = 0; Y < res; Y++) for (let X = 0; X < res; X++) {
      if (!pv.view.mask[Y * res + X]) continue;
      const a = ((X + 0.5) / res) * 2 * half - half, b = ((Y + 0.5) / res) * 2 * half - half, base = frame.centre.clone().addScaledVector(right, a).addScaledVector(up, b);
      for (let t = half * 1.8; t > -half * 1.8; t -= grid.size * 0.5) {
        const i = Math.floor((base.x + d.x * t - grid.min.x) / grid.size), j = Math.floor((base.y + d.y * t - grid.min.y) / grid.size), k = Math.floor((base.z + d.z * t - grid.min.z) / grid.size);
        if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) continue; const id = i + nx * (j + ny * k);
        if (occ[id]) { const s = sIdx[id]!; if (s >= 0) { let h = hits.get(s); if (!h) hits.set(s, (h = { n: 0, inside: new Array(propOf[vi]!.length).fill(0) })); h.n++; propOf[vi]!.forEach((_p, q) => { if (pv.proposals[q]![Y * res + X]) h!.inside[q]!++; }); } break; }
      }
    }
    for (const [s, h] of hits) { if (h.n < 2) continue; seen[s]! |= 1 << vi; propOf[vi]!.forEach((p, q) => { if (h.inside[q]! >= 0.5 * h.n) mem[s * words + (p >> 5)]! |= 1 << (p & 31); }); }
  });
  const popcount = (x: number) => { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; };
  const viewsOfProp = Int32Array.from(props.map((p) => p.view));
  // affinity of adjacent surface voxels, only over the views that see both
  const affinity = (s1: number, s2: number): number | null => {
    const both = seen[s1]! & seen[s2]!; if (popcount(both) < minViews) return null;
    let inter = 0, uni = 0;
    for (let w = 0; w < words; w++) { let a = mem[s1 * words + w]!, b = mem[s2 * words + w]!; const x = a | b; if (!x) continue; for (let bit = 0; bit < 32; bit++) { if (!((x >>> bit) & 1)) continue; const p = w * 32 + bit; if (!((both >>> viewsOfProp[p]!) & 1)) continue; const wgt = props[p]!.w; uni += wgt; if (((a >>> bit) & 1) && ((b >>> bit) & 1)) inter += wgt; } }
    return uni > 1e-9 ? inter / uni : null;
  };
  const edges: Array<{ a: number; b: number; aff: number }> = []; let observed = 0; for (let s = 0; s < surf.length; s++) if (seen[s]) observed++;
  for (let s = 0; s < surf.length; s++) { const id = surf[s]!, i = id % nx, j = Math.floor(id / nx) % ny, k = Math.floor(id / (nx * ny)); if (!seen[s]) continue; for (const [dx, dy, dz] of FORWARD) { const a = i + dx, b = j + dy, c = k + dz; if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue; const u = sIdx[a + nx * (b + ny * c)]!; if (u < 0 || !seen[u]) continue; const aff = affinity(s, u); if (aff !== null) edges.push({ a: s, b: u, aff }); } }
  if (observed < 40 || !edges.length) return empty('too little observed surface');
  // superpoints, then greedy merging by mean boundary affinity
  const parent = Int32Array.from({ length: surf.length }, (_, i) => i); const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]!]!; x = parent[x]!; } return x; };
  for (const e of edges) if (e.aff >= seedAff) { const ra = find(e.a), rb = find(e.b); if (ra !== rb) parent[rb] = ra; }
  const size = new Map<number, number>(); for (let s = 0; s < surf.length; s++) if (seen[s]) { const r = find(s); size.set(r, (size.get(r) ?? 0) + 1); }
  const bound = new Map<string, { sum: number; n: number }>(); const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const rebuild = () => { bound.clear(); for (const e of edges) { const ra = find(e.a), rb = find(e.b); if (ra === rb) continue; const k = key(ra, rb), v = bound.get(k) ?? { sum: 0, n: 0 }; v.sum += e.aff; v.n++; bound.set(k, v); } };
  rebuild();
  const minVox = Math.max(8, Math.round(minShare * observed));
  for (let guard = 0; guard < 4000; guard++) {
    let best: { k: string; m: number } | null = null;
    for (const [k, v] of bound) { const [ra, rb] = k.split('|').map(Number) as [number, number], small = Math.min(size.get(ra) ?? 0, size.get(rb) ?? 0), m = v.sum / v.n + (small < minVox ? 0.5 : 0); if (v.n >= 2 && m >= mergeAff && (!best || m > best.m)) best = { k, m }; }
    if (!best) break;
    const [ra, rb] = best.k.split('|').map(Number) as [number, number]; parent[rb] = ra; size.set(ra, (size.get(ra) ?? 0) + (size.get(rb) ?? 0)); size.delete(rb); rebuild();
  }
  // parts below the minimum size are dissolved into the neighbour with the best affinity (or dropped if isolated)
  const label = new Uint16Array(N); const roots = [...size.entries()].filter(([, n]) => n >= minVox).sort((a, b) => b[1] - a[1]).map(([r]) => r); const idOf = new Map<number, number>(); roots.forEach((r, i) => idOf.set(r, i + 1));
  for (let s = 0; s < surf.length; s++) if (seen[s]) { const l = idOf.get(find(s)); if (l) label[surf[s]!] = l; }
  // dissolved voxels take the label of the most affine labelled neighbour
  for (let pass = 0; pass < 6; pass++) for (const e of edges.sort((a, b) => b.aff - a.aff)) { const la = label[surf[e.a]!]!, lb = label[surf[e.b]!]!; if (la && !lb) label[surf[e.b]!] = la; else if (lb && !la) label[surf[e.a]!] = lb; }
  // interior and unseen surface: nearest labelled voxel (BFS through the solid)
  const frontier: number[] = []; for (let id = 0; id < N; id++) if (label[id]) frontier.push(id);
  for (let head = 0; head < frontier.length; head++) { const v = frontier[head]!, i = v % nx, j = Math.floor(v / nx) % ny, k = Math.floor(v / (nx * ny)); for (const [dx, dy, dz] of OFFS6) { const a = i + dx, b = j + dy, c = k + dz; if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue; const u = a + nx * (b + ny * c); if (occ[u] && !label[u]) { label[u] = label[v]!; frontier.push(u); } } }
  return { labels: label, parts: roots.length, observedSurface: observed, hiddenSurface: surf.length - observed, note: `${roots.length} part(s) from ${K} proposals in ${input.length} views` };
}
