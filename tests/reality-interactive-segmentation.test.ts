import { describe, it, expect } from 'vitest';
import { segmentInteractive } from '../src/living/reality/interactive-segmentation';

const W = 160, H = 120;
const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
/** An object (ellipse, two-tone) over a textured, gradient background that partly resembles it. */
function scene(seed = 1) {
  const r = rng(seed), data = new Uint8ClampedArray(W * H * 4), truth = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, inside = ((x - 80) / 42) ** 2 + ((y - 60) / 30) ** 2 < 1, n = (r() - 0.5) * 40;
    const bg = [90 + x * 0.6 + n, 120 + y * 0.5 + n, 100 + n + (x > 100 ? 40 : 0)], fg = x < 80 ? [200 + n, 70 + n, 60 + n] : [60 + n, 90 + n, 200 + n];
    const c = inside ? fg : bg; data[i] = c[0]!; data[i + 1] = c[1]!; data[i + 2] = c[2]!; data[i + 3] = 255; truth[y * W + x] = inside ? 1 : 0;
  }
  return { rgba: { width: W, height: H, data }, truth };
}
const iou = (a: Uint8Array, b: Uint8Array) => { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { i += a[k]! & b[k]!; u += a[k]! | b[k]!; } return u ? i / u : 1; };

describe('segmentação interactiva (GrabCut com corte mínimo)', () => {
  it('com uma caixa solta separa o objecto de um fundo texturado (IoU alto) e é determinística', () => {
    const { rgba, truth } = scene(), hint = { box: { x0: 30, y0: 18, x1: 130, y1: 102 } };
    const a = segmentInteractive(rgba, hint), b = segmentInteractive(rgba, hint);
    expect(iou(a.mask, truth)).toBeGreaterThan(0.85); expect(Buffer.from(a.mask).equals(Buffer.from(b.mask))).toBe(true);
    expect(a.iterations).toBeGreaterThan(0);
  });
  it('os traços são restrições duras: fundo marcado dentro do objecto fica fundo; objecto marcado fora da caixa fica objecto', () => {
    const { rgba } = scene(), hint = { box: { x0: 30, y0: 18, x1: 130, y1: 102 }, background: [[80, 60]] as Array<[number, number]>, foreground: [[10, 10]] as Array<[number, number]>, brushRadius: 4 };
    const r = segmentInteractive(rgba, hint);
    expect(r.mask[60 * W + 80]).toBe(0); expect(r.mask[10 * W + 10]).toBe(1);
  });
  it('correcções melhoram o resultado quando a caixa engloba um objecto parecido com o fundo', () => {
    const { rgba, truth } = scene(3), box = { x0: 5, y0: 5, x1: 155, y1: 115 }, first = segmentInteractive(rgba, { box }), fn: Array<[number, number]> = [], fp: Array<[number, number]> = [];
    for (let k = 0; k < W * H; k += 37) { const p: [number, number] = [k % W, Math.floor(k / W)]; if (truth[k] && !first.mask[k]) fn.push(p); else if (!truth[k] && first.mask[k]) fp.push(p); }
    const second = segmentInteractive(rgba, { box, foreground: fn, background: fp, brushRadius: 3 });
    expect(iou(second.mask, truth)).toBeGreaterThanOrEqual(iou(first.mask, truth) - 1e-9);
  });
  it('é limitada em tempo e memória: imagens grandes são processadas a ≤ 256 px e devolvidas à resolução original', () => {
    const big = { width: 640, height: 480, data: new Uint8ClampedArray(640 * 480 * 4) }; for (let i = 0; i < big.data.length; i += 4) { const x = (i / 4) % 640, y = Math.floor(i / 4 / 640), on = Math.hypot(x - 320, y - 240) < 120; big.data[i] = on ? 220 : 40; big.data[i + 1] = on ? 60 : 90; big.data[i + 2] = on ? 50 : 120; big.data[i + 3] = 255; }
    const t = performance.now(), r = segmentInteractive(big, { box: { x0: 150, y0: 80, x1: 490, y1: 400 } });
    expect(r.mask.length).toBe(640 * 480); expect(Math.max(r.workWidth, r.workHeight)).toBeLessThanOrEqual(256); expect(performance.now() - t).toBeLessThan(20_000);
    expect(r.mask[240 * 640 + 320]).toBe(1); expect(r.mask[10 * 640 + 10]).toBe(0);
  });
});
