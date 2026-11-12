import { Vector3 } from 'three';
import type { Grid } from './silhouette';
import { orbitDirection, signedDistance2D, type Frame, type SilhouetteView } from './multiview';

/**
 * Appearance-aware part evidence. Geometry alone (silhouettes) cannot tell a chair seat from its legs when the hull is one blob, but the photographs show
 * where the material changes. Each photograph's colour is lifted onto the voxels it actually sees (first occupied voxel along each pixel ray), a robust
 * per-voxel colour is kept (median of the views that see it), the visible surface is grown into colour-coherent regions (graph segmentation, chroma-weighted so
 * shading is not a boundary), and a geometric part is split along those regions only when they are large, clearly different and spatially coherent.
 * Output is a HYPOTHESIS about structure (labels), never a measurement of how the object is assembled; the caller keeps the evidence kind 'inferred'.
 */
export type ColourView = { view: SilhouetteView; colour: Uint8Array | null; colourRes: number };
export type SurfaceColour = { lab: Float32Array; has: Uint8Array; samples: Uint8Array };

const srgb = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const R = srgb(r), G = srgb(g), B = srgb(b), X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

/** Lifts the colour photographs onto the visible surface voxels of an occupancy grid (orthographic cameras, as the rest of the reconstruction). */
export function surfaceColours(views: readonly ColourView[], occ: Uint8Array, grid: Grid, frame: Frame, res: number, marginPx = 2.5): SurfaceColour {
  const [nx, ny, nz] = grid.cells, N = occ.length, half = frame.half, per = new Map<number, number[]>();
  const isSurface = (id: number) => { if (!occ[id]) return false; const i = id % nx, j = Math.floor(id / nx) % ny, k = Math.floor(id / (nx * ny)); for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) { const a = i + dx, b = j + dy, c = k + dz; if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz || !occ[a + nx * (b + ny * c)]) return true; } return false; };
  const surface: number[] = []; for (let id = 0; id < N; id++) if (isSurface(id)) surface.push(id);
  for (const cv of views) {
    if (!cv.colour) continue; const d = orbitDirection(cv.view.azimuthDeg, cv.view.elevationDeg), worldUp = Math.abs(d.y) > 0.98 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
    const right = new Vector3().crossVectors(worldUp, d).normalize(), up = new Vector3().crossVectors(d, right).normalize(), cr = cv.colourRes, sdf = signedDistance2D(cv.view.mask, res);
    // depth buffer at colour resolution: distance along the view direction of the first occupied voxel (camera side = +d)
    const depth = new Float32Array(cr * cr).fill(-Infinity);
    for (let cw = 0; cw < cr; cw++) for (let cu = 0; cu < cr; cu++) {
      const a = ((cu + 0.5) / cr) * 2 * half - half, b = ((cw + 0.5) / cr) * 2 * half - half, base = frame.centre.clone().addScaledVector(right, a).addScaledVector(up, b);
      for (let t = half * 1.8; t > -half * 1.8; t -= grid.size * 0.5) {
        const i = Math.floor((base.x + d.x * t - grid.min.x) / grid.size), j = Math.floor((base.y + d.y * t - grid.min.y) / grid.size), k = Math.floor((base.z + d.z * t - grid.min.z) / grid.size);
        if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) continue; if (occ[i + nx * (j + ny * k)]) { depth[cw * cr + cu] = t; break; }
      }
    }
    for (const id of surface) {
      const i = id % nx, j = Math.floor(id / nx) % ny, k = Math.floor(id / (nx * ny)), p = new Vector3(grid.min.x + (i + 0.5) * grid.size, grid.min.y + (j + 0.5) * grid.size, grid.min.z + (k + 0.5) * grid.size).sub(frame.centre);
      const a = p.dot(right), b = p.dot(up), t = p.dot(d), u = ((a + half) / (2 * half)) * cr, w = ((b + half) / (2 * half)) * cr, cu = Math.floor(u), cw = Math.floor(w);
      if (cu < 0 || cw < 0 || cu >= cr || cw >= cr) continue;
      // visible when no occupied voxel is in front of it: the buffer depth at its pixel (or a neighbour) is within about a voxel
      let near = Infinity; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = cu + dx, y = cw + dy; if (x < 0 || y < 0 || x >= cr || y >= cr) continue; const dd = depth[y * cr + x]!; if (dd > -Infinity) near = Math.min(near, Math.abs(dd - t)); }
      if (near > grid.size * 1.2) continue;
      const mu = Math.min(res - 1, Math.floor((cu / cr) * res)), mw = Math.min(res - 1, Math.floor((cw / cr) * res)); if (sdf[mw * res + mu]! > -marginPx) continue;
      const q = (cw * cr + cu) * 3, arr = per.get(id) ?? per.set(id, []).get(id)!; arr.push(cv.colour[q]!, cv.colour[q + 1]!, cv.colour[q + 2]!);
    }
  }
  const lab = new Float32Array(N * 3), has = new Uint8Array(N), samples = new Uint8Array(N);
  for (const [id, a] of per) {
    const n = a.length / 3, med = (c: number) => { const s: number[] = []; for (let i = 0; i < n; i++) s.push(a[i * 3 + c]!); s.sort((p, q) => p - q); return s[Math.floor(n / 2)]!; };
    const [L, A, B] = rgbToLab(med(0), med(1), med(2)); lab[id * 3] = L; lab[id * 3 + 1] = A; lab[id * 3 + 2] = B; has[id] = 1; samples[id] = Math.min(255, n);
  }
  return { lab, has, samples };
}

export type AppearanceOptions = {
  /** smoothing passes of the surface colour over adjacent observed voxels (suppresses texture and noise) */ smooth?: number;
  /** each side of a split must be this spatially coherent: largest connected piece / cluster size */ coherence?: number;
  /** graph-segmentation scale (Lab units); larger = fewer, bigger regions */ scale?: number;
  /** chroma-weighted distance: lightness weight (shading is not material) */ lightnessWeight?: number;
  /** a region must hold at least this share of its geometric part's observed surface */ minShare?: number;
  /** two regions are different materials when their mean colour differs by at least this (Lab) */ minContrast?: number;
  maxParts?: number;
};
export type AppearanceResult = { labels: Uint16Array; regions: number; splitParts: number; note: string };

const FORWARD: Array<[number, number, number]> = []; for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dz > 0 || (dz === 0 && (dy > 0 || (dy === 0 && dx > 0)))) FORWARD.push([dx, dy, dz]);
const OFFS6: Array<[number, number, number]> = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const ALL26 = [...FORWARD, ...FORWARD.map(([a, b, c]) => [-a, -b, -c] as [number, number, number])];

/**
 * Splits geometric parts by recursive 2-means on the (smoothed, chroma-weighted) surface colour. A split is accepted only when both sides are large, their mean
 * colours differ clearly, and each side is spatially coherent on the surface (texture and noise interleave; materials form patches). The interior is then
 * assigned to the nearest labelled surface voxel inside the same original part.
 */
export function splitByAppearance(labels: Uint16Array | ArrayLike<number>, occ: Uint8Array, grid: Grid, sc: SurfaceColour, options: AppearanceOptions = {}): AppearanceResult {
  const [nx, ny, nz] = grid.cells, N = occ.length, wL = options.lightnessWeight ?? 0.25, minShare = options.minShare ?? 0.12, minContrast = options.minContrast ?? 22, maxParts = options.maxParts ?? 16, passes = options.smooth ?? 2, coherence = options.coherence ?? 0.85;
  const out = new Uint16Array(N); for (let i = 0; i < N; i++) out[i] = (labels[i] as number) ?? 0;
  const surf: number[] = []; for (let i = 0; i < N; i++) if (sc.has[i]) surf.push(i);
  if (surf.length < 40) return { labels: out, regions: 0, splitParts: 0, note: 'too little observed surface' };
  const idxOf = new Int32Array(N).fill(-1); surf.forEach((v, k) => (idxOf[v] = k));
  const nbr = (v: number): number[] => { const i = v % nx, j = Math.floor(v / nx) % ny, k = Math.floor(v / (nx * ny)), r: number[] = []; for (const [dx, dy, dz] of ALL26) { const a = i + dx, b = j + dy, c = k + dz; if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue; const u = a + nx * (b + ny * c); if (idxOf[u]! >= 0 && out[u] === out[v]) r.push(u); } return r; };
  const adj = new Map<number, number[]>(); for (const v of surf) adj.set(v, nbr(v));
  // smooth colour within the same geometric part
  let lab = Float32Array.from(sc.lab);
  for (let p = 0; p < passes; p++) { const next = Float32Array.from(lab); for (const v of surf) { const ns = adj.get(v)!; if (!ns.length) continue; for (let c = 0; c < 3; c++) { let sum = lab[v * 3 + c]!; for (const u of ns) sum += lab[u * 3 + c]!; next[v * 3 + c] = sum / (ns.length + 1); } } lab = next; }
  const d = (u: number, c: Float32Array | number[]) => Math.hypot(Math.sqrt(wL) * (lab[u * 3]! - c[0]!), lab[u * 3 + 1]! - c[1]!, lab[u * 3 + 2]! - c[2]!);
  const connectedShare = (members: number[]): number => { const set = new Set(members), seen = new Set<number>(); let largest = 0; for (const s0 of members) { if (seen.has(s0)) continue; let c = 0; const st = [s0]; seen.add(s0); while (st.length) { const v = st.pop()!; c++; for (const u of adj.get(v)!) if (set.has(u) && !seen.has(u)) { seen.add(u); st.push(u); } } largest = Math.max(largest, c); } return members.length ? largest / members.length : 0; };
  const bisect = (members: number[]): [number[], number[]] | null => {
    // 2-means seeded with the two most distant colours among a sample
    let a = members[0]!, b = members[0]!, far = -1; for (const v of members) { const dv = d(v, [lab[a * 3]!, lab[a * 3 + 1]!, lab[a * 3 + 2]!]); if (dv > far) { far = dv; b = v; } } far = -1; for (const v of members) { const dv = d(v, [lab[b * 3]!, lab[b * 3 + 1]!, lab[b * 3 + 2]!]); if (dv > far) { far = dv; a = v; } }
    let ca = [lab[a * 3]!, lab[a * 3 + 1]!, lab[a * 3 + 2]!], cb = [lab[b * 3]!, lab[b * 3 + 1]!, lab[b * 3 + 2]!], A: number[] = [], B: number[] = [];
    for (let it = 0; it < 12; it++) { A = []; B = []; for (const v of members) (d(v, ca) <= d(v, cb) ? A : B).push(v); if (!A.length || !B.length) return null; const m = (g: number[]) => [0, 1, 2].map((c) => g.reduce((s, v) => s + lab[v * 3 + c]!, 0) / g.length); ca = m(A); cb = m(B); }
    const contrast = Math.hypot(Math.sqrt(wL) * (ca[0]! - cb[0]!), ca[1]! - cb[1]!, ca[2]! - cb[2]!);
    return contrast >= minContrast && connectedShare(A) >= coherence && connectedShare(B) >= coherence ? [A, B] : null;
  };
  const byPart = new Map<number, number[]>(); for (const v of surf) { const p = out[v]!; if (p) (byPart.get(p) ?? byPart.set(p, []).get(p)!).push(v); }
  let next = 0; for (let i = 0; i < N; i++) if (out[i]! > next) next = out[i]!;
  const newLabelOf = new Map<number, number>(); let split = 0, groups = 0;
  for (const members of byPart.values()) {
    let clusters: number[][] = [members]; const done: number[][] = [];
    while (clusters.length && done.length + clusters.length < maxParts) { const c = clusters.pop()!; if (c.length < Math.max(30, minShare * members.length * 2)) { done.push(c); continue; } const sp = bisect(c); if (!sp || sp[0].length < minShare * members.length || sp[1].length < minShare * members.length) { done.push(c); continue; } clusters.push(sp[0], sp[1]); }
    done.push(...clusters); groups += done.length; if (done.length < 2) continue;
    split++; done.sort((p, q) => q.length - p.length).slice(1).forEach((g) => { next++; for (const v of g) newLabelOf.set(v, next); });
  }
  if (!newLabelOf.size) return { labels: out, regions: groups, splitParts: 0, note: 'no part showed large, clearly different, spatially coherent colour regions' };
  const splitParents = new Set<number>(); for (const v of newLabelOf.keys()) splitParents.add(out[v]!);
  const result = out.slice(), frontier: number[] = [], orig = out.slice(), claimed = new Uint8Array(N); let head = 0;
  for (const v of surf) if (splitParents.has(orig[v]!)) { if (newLabelOf.has(v)) result[v] = newLabelOf.get(v)!; claimed[v] = 1; frontier.push(v); }
  while (head < frontier.length) { const v = frontier[head++]!, i = v % nx, j = Math.floor(v / nx) % ny, k = Math.floor(v / (nx * ny)); for (const [dx, dy, dz] of OFFS6) { const a = i + dx, b = j + dy, c = k + dz; if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue; const u = a + nx * (b + ny * c); if (!occ[u] || claimed[u] || orig[u] !== orig[v]) continue; claimed[u] = 1; result[u] = result[v]!; frontier.push(u); } }
  return { labels: result, regions: groups, splitParts: split, note: `${split} geometric part(s) split along colour regions` };
}
