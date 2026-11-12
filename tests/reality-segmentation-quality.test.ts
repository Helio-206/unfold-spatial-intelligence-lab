import { describe, it, expect } from 'vitest';
import { autoOutlines, selectOutline } from '../src/living/reality/auto-segmentation';

/**
 * Segmentation QUALITY, not interface presence: synthetic scenes with an exact reference mask, textured/cluttered backgrounds, exposure jitter and noise.
 * The reference is generated alongside the picture and never seen by the segmenter. Thresholds come from measured behaviour (see the numbers logged by each test);
 * they are floors for regressions, not claims about real photographs (those are validated in reports/reality-engine/benchmark/segmentation-*.json).
 */
const W = 160, H = 120;
const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const iou = (a: Uint8Array, b: Uint8Array) => { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { i += a[k]! & b[k]!; u += a[k]! | b[k]!; } return u ? i / u : 0; };

function background(seed: number): Uint8ClampedArray {
  const r = rng(seed), d = new Uint8ClampedArray(W * H * 4), base = [60 + r() * 140, 60 + r() * 140, 60 + r() * 140];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4, g = (x / W) * 40 + Math.sin(y / 9 + seed) * 18; for (let c = 0; c < 3; c++) d[o + c] = base[c]! + g + (r() - 0.5) * 14; d[o + 3] = 255; }
  for (let k = 0; k < 14; k++) { const x0 = Math.floor(r() * W), y0 = Math.floor(r() * H), w = 8 + Math.floor(r() * 30), h = 8 + Math.floor(r() * 24), col = [r() * 255, r() * 255, r() * 255]; for (let y = y0; y < Math.min(H, y0 + h); y++) for (let x = x0; x < Math.min(W, x0 + w); x++) { const o = (y * W + x) * 4; for (let c = 0; c < 3; c++) d[o + c] = col[c]!; } }
  return d;
}
/** a two-tone object (body + cap) that turns: its apparent width changes with the angle */
function scene(bg: Uint8ClampedArray, angle: number, seed: number, jitter: boolean): { rgba: { width: number; height: number; data: Uint8ClampedArray }; truth: Uint8Array } {
  const r = rng(seed), data = Uint8ClampedArray.from(bg), truth = new Uint8Array(W * H), cx = W / 2, cy = H / 2, rx = 22 + 14 * Math.abs(Math.cos(angle)), ry = 38;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const e = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2, cap = y < cy - ry * 0.55 && ((x - cx) / (rx * 0.7)) ** 2 + ((y - (cy - ry * 0.75)) / (ry * 0.35)) ** 2 < 1;
    if (e < 1 || cap) { const o = (y * W + x) * 4; truth[y * W + x] = 1; const stripe = Math.sin((x - cx) / 4 + angle * 3) > 0.4; const col = cap ? [220, 40, 40] : stripe ? [30, 90, 200] : [240, 210, 40]; for (let c = 0; c < 3; c++) data[o + c] = col[c]! + (r() - 0.5) * 10; }
  }
  if (jitter) { const gain = 0.7 + r() * 0.6, bias = (r() - 0.5) * 40; for (let k = 0; k < W * H; k++) for (let c = 0; c < 3; c++) data[k * 4 + c] = (data[k * 4 + c]! - 128) * gain + 128 + bias + (r() - 0.5) * 16; }
  return { rgba: { width: W, height: H, data }, truth };
}
const turn = (varied: boolean, jitter: boolean, seed: number) => { const fixed = background(seed); return Array.from({ length: 8 }, (_, i) => scene(varied ? background(seed * 31 + i * 7 + 1) : fixed, (i / 8) * Math.PI * 2, seed + i, jitter)); };

describe('automatic outlines: measured quality against an exact reference', () => {
  it('fixed camera, cluttered fixed background: the static-background outline is chosen and is accurate on every view', async () => {
    const views = turn(false, false, 5), out = await autoOutlines(views.map((v) => v.rgba)), ious = out.map((o, i) => (o.mask ? iou(o.mask, views[i]!.truth) : 0));
    const mean = ious.reduce((a, b) => a + b, 0) / ious.length;
    expect(out.every((o) => o.method === 'static-background')).toBe(true);
    expect(mean).toBeGreaterThan(0.9); expect(Math.min(...ious)).toBeGreaterThan(0.65); // the narrowest views are the weak ones: pixels the object covers in most frames have no clean background sample
  });
  it('fixed camera with exposure drift and sensor noise: still accurate (static threshold follows the noise level)', async () => {
    const views = turn(false, true, 9), out = await autoOutlines(views.map((v) => v.rgba)), ious = out.map((o, i) => (o.mask ? iou(o.mask, views[i]!.truth) : 0));
    expect(ious.reduce((a, b) => a + b, 0) / ious.length).toBeGreaterThan(0.75);
  });
  it('moving background (hand-held): the static cue is NOT used, and a wrong accepted outline is never labelled static-background', async () => {
    const views = turn(true, false, 13), out = await autoOutlines(views.map((v) => v.rgba));
    expect(out.some((o) => o.method === 'static-background')).toBe(false);
    // whatever is accepted must not be claimed as physically grounded; the wrong ones are exactly why the intake labels non-static outlines "confirm visually"
    for (const o of out) if (o.mask) expect(['classical-colour', 'salient-network', 'salient-network+graphcut']).toContain(o.method);
  });
  it('selection prefers the physical cue only when it is credible: a fragmented static mask falls back to the others', () => {
    const good = new Uint8Array(W * H), noise = new Uint8Array(W * H); for (let y = 30; y < 90; y++) for (let x = 60; x < 100; x++) good[y * W + x] = 1; for (let k = 0; k < noise.length; k += 7) noise[k] = 1;
    const sel = selectOutline([{ method: 'static-background', mask: noise }, { method: 'classical-colour', mask: good }], W, H);
    expect(sel.method).toBe('classical-colour');
    expect(selectOutline([{ method: 'static-background', mask: good }, { method: 'classical-colour', mask: good }], W, H).method).toBe('static-background');
  });
});
