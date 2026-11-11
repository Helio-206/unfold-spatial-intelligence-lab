/**
 * Interactive foreground segmentation for photographs with complex backgrounds (GrabCut-style): a rough box, optional foreground/background strokes, colour models
 * for object and background (small Gaussian mixtures), and a minimum graph cut that balances colour evidence against edge-aware smoothness. Deterministic, bounded
 * (works at <= MAX_SIDE pixels), no model, no network. The person's strokes are hard constraints; everything else is an estimate and is reported as such.
 */
import type { RGBA } from '../universal-foundry/evidence';

export type Point = [number, number];
export type SegmentationHint = {
  /** rough box around the object, in pixels of the ORIGINAL image; absent = the whole picture minus a 3% margin */
  box?: { x0: number; y0: number; x1: number; y1: number };
  /** pixels the person marked as object / as background (original-image coordinates) */
  foreground?: readonly Point[];
  background?: readonly Point[];
  /** brush radius in original-image pixels for the marked points (a stroke is a trail of points) */
  brushRadius?: number;
};
export type InteractiveOptions = { maxSide?: number; iterations?: number; components?: number; smoothness?: number };
export type InteractiveResult = { mask: Uint8Array; width: number; height: number; foregroundRatio: number; iterations: number; changedLastIteration: number; workWidth: number; workHeight: number };

export const MAX_SIDE = 256;

type Model = { means: Float64Array; vars: Float64Array; weights: Float64Array; k: number };

function fit(colours: Float64Array, ids: number[], k: number): Model {
  // deterministic k-means: initial centres at evenly spaced quantiles of luminance
  const n = ids.length, kk = Math.max(1, Math.min(k, n));
  const lum = ids.map((i) => colours[i * 3]! * 0.3 + colours[i * 3 + 1]! * 0.59 + colours[i * 3 + 2]! * 0.11), order = ids.map((_, i) => i).sort((a, b) => lum[a]! - lum[b]! || a - b);
  const means = new Float64Array(kk * 3), assign = new Int32Array(n);
  for (let c = 0; c < kk; c++) { const id = ids[order[Math.min(n - 1, Math.floor(((c + 0.5) / kk) * n))]!]!; means.set([colours[id * 3]!, colours[id * 3 + 1]!, colours[id * 3 + 2]!], c * 3); }
  for (let it = 0; it < 6; it++) {
    const sum = new Float64Array(kk * 3), cnt = new Float64Array(kk);
    for (let j = 0; j < n; j++) {
      const id = ids[j]!; let best = 0, bd = Infinity;
      for (let c = 0; c < kk; c++) { const d = (colours[id * 3]! - means[c * 3]!) ** 2 + (colours[id * 3 + 1]! - means[c * 3 + 1]!) ** 2 + (colours[id * 3 + 2]! - means[c * 3 + 2]!) ** 2; if (d < bd) { bd = d; best = c; } }
      assign[j] = best; cnt[best]! += 1; sum[best * 3]! += colours[id * 3]!; sum[best * 3 + 1]! += colours[id * 3 + 1]!; sum[best * 3 + 2]! += colours[id * 3 + 2]!;
    }
    for (let c = 0; c < kk; c++) if (cnt[c]!) means.set([sum[c * 3]! / cnt[c]!, sum[c * 3 + 1]! / cnt[c]!, sum[c * 3 + 2]! / cnt[c]!], c * 3);
  }
  const vars = new Float64Array(kk * 3).fill(0), weights = new Float64Array(kk), cnt = new Float64Array(kk);
  for (let j = 0; j < n; j++) { const id = ids[j]!, c = assign[j]!; cnt[c]! += 1; for (let ch = 0; ch < 3; ch++) vars[c * 3 + ch]! += (colours[id * 3 + ch]! - means[c * 3 + ch]!) ** 2; }
  for (let c = 0; c < kk; c++) { weights[c] = Math.max(cnt[c]!, 0.5) / n; for (let ch = 0; ch < 3; ch++) vars[c * 3 + ch] = Math.max(25, vars[c * 3 + ch]! / Math.max(1, cnt[c]!)); }
  return { means, vars, weights, k: kk };
}
/** -log of the mixture density at colour `id` */
function cost(m: Model, colours: Float64Array, id: number): number {
  let p = 0;
  for (let c = 0; c < m.k; c++) {
    let e = 0, logdet = 0;
    for (let ch = 0; ch < 3; ch++) { e += (colours[id * 3 + ch]! - m.means[c * 3 + ch]!) ** 2 / m.vars[c * 3 + ch]!; logdet += Math.log(m.vars[c * 3 + ch]!); }
    p += m.weights[c]! * Math.exp(-0.5 * e - 0.5 * logdet);
  }
  return -Math.log(Math.max(p, 1e-300));
}

/** Minimum s-t cut on a grid by Dinic's algorithm; returns true for pixels on the source (object) side. */
function minCut(w: number, h: number, sCap: Float64Array, tCap: Float64Array, nbrW: Float64Array /* right, down per pixel */): Uint8Array {
  const n = w * h, S = n, T = n + 1, N = n + 2, maxE = 2 * (2 * n + 2 * n);
  const head = new Int32Array(N).fill(-1), next = new Int32Array(maxE), to = new Int32Array(maxE), cap = new Float64Array(maxE); let ec = 0;
  const add = (u: number, v: number, c1: number, c2: number) => { to[ec] = v; cap[ec] = c1; next[ec] = head[u]!; head[u] = ec++; to[ec] = u; cap[ec] = c2; next[ec] = head[v]!; head[v] = ec++; };
  for (let p = 0; p < n; p++) {
    if (sCap[p]! > 0) add(S, p, sCap[p]!, 0); if (tCap[p]! > 0) add(p, T, tCap[p]!, 0);
    const x = p % w; if (x < w - 1 && nbrW[p * 2]! > 0) add(p, p + 1, nbrW[p * 2]!, nbrW[p * 2]!);
    if (p + w < n && nbrW[p * 2 + 1]! > 0) add(p, p + w, nbrW[p * 2 + 1]!, nbrW[p * 2 + 1]!);
  }
  const level = new Int32Array(N), cur = new Int32Array(N), queue = new Int32Array(N), stack = new Int32Array(N), via = new Int32Array(N);
  const bfs = (): boolean => {
    level.fill(-1); level[S] = 0; let qh = 0, qt = 0; queue[qt++] = S;
    while (qh < qt) { const u = queue[qh++]!; for (let e = head[u]!; e >= 0; e = next[e]!) if (cap[e]! > 1e-9 && level[to[e]!]! < 0) { level[to[e]!] = level[u]! + 1; queue[qt++] = to[e]!; } }
    return level[T]! >= 0;
  };
  while (bfs()) {
    for (let i = 0; i < N; i++) cur[i] = head[i]!;
    for (;;) { // iterative blocking-flow DFS
      let sp = 0; stack[0] = S; let pushed = 0;
      while (sp >= 0) {
        const u = stack[sp]!;
        if (u === T) {
          let f = Infinity; for (let i = 1; i <= sp; i++) f = Math.min(f, cap[via[stack[i]!]!]!);
          for (let i = 1; i <= sp; i++) { cap[via[stack[i]!]!]! -= f; cap[via[stack[i]!]! ^ 1]! += f; }
          pushed = f; break;
        }
        let advanced = false;
        for (; cur[u]! >= 0; cur[u] = next[cur[u]!]!) { const e = cur[u]!, v = to[e]!; if (cap[e]! > 1e-9 && level[v]! === level[u]! + 1) { via[v] = e; stack[++sp] = v; advanced = true; break; } }
        if (!advanced) { level[u] = -1; sp--; }
      }
      if (!pushed) break;
    }
  }
  const side = new Uint8Array(n); level.fill(-1); level[S] = 0; let qh = 0, qt = 0; queue[qt++] = S;
  while (qh < qt) { const u = queue[qh++]!; for (let e = head[u]!; e >= 0; e = next[e]!) if (cap[e]! > 1e-9 && level[to[e]!]! < 0) { level[to[e]!] = 1; queue[qt++] = to[e]!; } }
  for (let p = 0; p < n; p++) side[p] = level[p]! >= 0 ? 1 : 0;
  return side;
}

export function segmentInteractive(rgba: RGBA, hint: SegmentationHint = {}, options: InteractiveOptions = {}): InteractiveResult {
  const { width: W, height: H, data } = rgba, maxSide = options.maxSide ?? MAX_SIDE, scale = Math.min(1, maxSide / Math.max(W, H));
  const w = Math.max(1, Math.round(W * scale)), h = Math.max(1, Math.round(H * scale)), n = w * h;
  // box-average downscale (deterministic)
  const colours = new Float64Array(n * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.floor((x / w) * W), x1 = Math.max(x0 + 1, Math.floor(((x + 1) / w) * W)), y0 = Math.floor((y / h) * H), y1 = Math.max(y0 + 1, Math.floor(((y + 1) / h) * H)); let r = 0, g = 0, b = 0, c = 0;
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const i = (yy * W + xx) * 4; r += data[i]!; g += data[i + 1]!; b += data[i + 2]!; c++; }
    colours.set([r / c, g / c, b / c], (y * w + x) * 3);
  }
  // 0 = sure background, 1 = sure object, 2 = probably object, 3 = probably background
  const state = new Uint8Array(n).fill(0), box = hint.box ?? { x0: W * 0.03, y0: H * 0.03, x1: W * 0.97, y1: H * 0.97 };
  const bx0 = Math.floor(box.x0 * scale), by0 = Math.floor(box.y0 * scale), bx1 = Math.ceil(box.x1 * scale), by1 = Math.ceil(box.y1 * scale);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x >= bx0 && x < bx1 && y >= by0 && y < by1) state[y * w + x] = 2;
  const rad = Math.max(1, Math.round((hint.brushRadius ?? 0) * scale));
  const stamp = (pts: readonly Point[] | undefined, value: 0 | 1) => { for (const [px, py] of pts ?? []) { const cx = Math.round(px * scale), cy = Math.round(py * scale); for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) { if (dx * dx + dy * dy > rad * rad) continue; const x = cx + dx, y = cy + dy; if (x >= 0 && y >= 0 && x < w && y < h) state[y * w + x] = value; } } };
  stamp(hint.background, 0); stamp(hint.foreground, 1);
  // smoothness weights: edge-aware Potts
  let beta = 0, pairs = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = y * w + x; if (x < w - 1) { beta += (colours[p * 3]! - colours[(p + 1) * 3]!) ** 2 + (colours[p * 3 + 1]! - colours[(p + 1) * 3 + 1]!) ** 2 + (colours[p * 3 + 2]! - colours[(p + 1) * 3 + 2]!) ** 2; pairs++; } if (y < h - 1) { beta += (colours[p * 3]! - colours[(p + w) * 3]!) ** 2 + (colours[p * 3 + 1]! - colours[(p + w) * 3 + 1]!) ** 2 + (colours[p * 3 + 2]! - colours[(p + w) * 3 + 2]!) ** 2; pairs++; } }
  beta = 1 / (2 * Math.max(1e-6, beta / Math.max(1, pairs))); const lambda = options.smoothness ?? 60, nbr = new Float64Array(n * 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = y * w + x; if (x < w - 1) nbr[p * 2] = lambda * Math.exp(-beta * ((colours[p * 3]! - colours[(p + 1) * 3]!) ** 2 + (colours[p * 3 + 1]! - colours[(p + 1) * 3 + 1]!) ** 2 + (colours[p * 3 + 2]! - colours[(p + 1) * 3 + 2]!) ** 2)); if (y < h - 1) nbr[p * 2 + 1] = lambda * Math.exp(-beta * ((colours[p * 3]! - colours[(p + w) * 3]!) ** 2 + (colours[p * 3 + 1]! - colours[(p + w) * 3 + 1]!) ** 2 + (colours[p * 3 + 2]! - colours[(p + w) * 3 + 2]!) ** 2)); }
  const K = options.components ?? 8, iterations = options.iterations ?? 5, HARD = 1e9;
  let label = new Uint8Array(n); for (let i = 0; i < n; i++) label[i] = state[i] === 1 || state[i] === 2 ? 1 : 0;
  let changed = 0, done = 0;
  for (let it = 0; it < iterations; it++) {
    const fgIds: number[] = [], bgIds: number[] = []; for (let i = 0; i < n; i++) (label[i] ? fgIds : bgIds).push(i);
    if (!fgIds.length || !bgIds.length) break;
    const fg = fit(colours, fgIds, K), bg = fit(colours, bgIds, K), sCap = new Float64Array(n), tCap = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      if (state[i] === 1) { sCap[i] = HARD; continue; } if (state[i] === 0) { tCap[i] = HARD; continue; }
      // object = source side. A pixel left on the sink side (background) cuts S->p and pays its BACKGROUND cost; one on the source side cuts p->T and pays its OBJECT cost.
      sCap[i] = cost(bg, colours, i); tCap[i] = cost(fg, colours, i);
    }
    const side = minCut(w, h, sCap, tCap, nbr);
    changed = 0; for (let i = 0; i < n; i++) { const v = side[i]! ? 1 : 0; if (v !== label[i]) changed++; label[i] = v; } done = it + 1;
    if (changed === 0) break;
  }
  // upscale (nearest)
  const mask = new Uint8Array(W * H); let count = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = label[Math.min(h - 1, Math.floor((y / H) * h)) * w + Math.min(w - 1, Math.floor((x / W) * w))]!; mask[y * W + x] = v; count += v; }
  return { mask, width: W, height: H, foregroundRatio: count / (W * H), iterations: done, changedLastIteration: changed, workWidth: w, workHeight: h };
}
