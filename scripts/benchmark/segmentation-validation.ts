// Independent segmentation validation. Reference = the renderer's exact alpha (never produced by any segmentation algorithm). Inputs = renders of the eight licensed
// assets composited over REAL photographs under three conditions:
//   fixed     one background for all views (turntable on a table)
//   varied    a different real photograph behind every view (hand-held walk-around: kills the static-background cue)
//   degraded  varied backgrounds + per-view exposure/contrast jitter, sensor noise and blur
// For each view the product's automatic selector decides; a view is counted as ACCEPTED-WRONG when the product keeps a mask whose IoU with the reference is < 0.8
// (the dangerous case: the interface would show a plausible but wrong contour). Reports mean IoU of accepted masks, accepted-wrong rate and refusal rate.
// Run: npx tsx scripts/benchmark/segmentation-validation.ts [--assets A,B]   (needs scripts/benchmark/models/u2netp.onnx for the network; otherwise runs without it and says so)
import jpeg from 'jpeg-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { autoOutlines } from '../../src/living/reality/auto-segmentation';
import type { SodRunner } from '../../src/living/reality/sod';
import type { IntakeImage } from '../../src/living/reality/intake';

const PORT = Number(process.env.SEGVAL_PORT ?? 5399), TURN = Array.from({ length: 8 }, (_, i) => i * 45), ELEV = 20, FILL = 0.55;
const BACKGROUNDS = ['car.jpg', 'chair.jpg', 'bus.jpg', 'excavator.jpg', 'porsche-911.jpg', 'skoda-kodiaq.jpg'];
const only = process.argv.includes('--assets') ? process.argv[process.argv.indexOf('--assets') + 1]!.split(',') : null;
const manifest = JSON.parse(readFileSync(resolve('reports/reality-engine/benchmark/manifest.json'), 'utf8')) as { assets: Array<{ id: string; split: string; category: string }> };
const iou = (a: Uint8Array, b: Uint8Array) => { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { i += a[k]! & b[k]!; u += a[k]! | b[k]!; } return u ? i / u : 0; };
let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296), gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());

const vite = await createServer({ server: { host: '127.0.0.1', port: PORT, strictPort: true, hmr: false, watch: null }, logLevel: 'error' }); await vite.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 500, height: 400 } });
await page.goto(`http://127.0.0.1:${PORT}/scripts/benchmark/reality-render.html`);
await page.waitForFunction(() => (window as never as { __renderReady?: boolean }).__renderReady === true, null, { timeout: 60_000 });
let sodRunner: SodRunner | null = null, sodNote = 'rede de saliência u2netp ACTIVA';
try {
  const sodPage = await browser.newPage(); await sodPage.goto(`http://127.0.0.1:${PORT}/scripts/benchmark/sod.html`); await sodPage.waitForFunction(() => (window as any).__sodReady, null, { timeout: 60000 });
  sodRunner = { available: async () => true, run: async (rgba) => {
    const { width: W, height: H } = rgba, enc = jpeg.encode({ data: Buffer.from(rgba.data.buffer, rgba.data.byteOffset, rgba.data.byteLength), width: W, height: H }, 92);
    const r = await sodPage.evaluate(([m, u]) => (window as any).__sod(m, u), ['u2netp', `data:image/jpeg;base64,${Buffer.from(enc.data).toString('base64')}`] as const), a = Buffer.from(r.alpha, 'base64'), soft = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const fx = ((x + 0.5) / W) * r.w - 0.5, fy = ((y + 0.5) / H) * r.h - 0.5, x0 = Math.max(0, Math.floor(fx)), y0 = Math.max(0, Math.floor(fy)), x1 = Math.min(r.w - 1, x0 + 1), y1 = Math.min(r.h - 1, y0 + 1), tx = Math.min(1, Math.max(0, fx - x0)), ty = Math.min(1, Math.max(0, fy - y0)); soft[y * W + x] = ((a[y0 * r.w + x0]! * (1 - tx) + a[y0 * r.w + x1]! * tx) * (1 - ty) + (a[y1 * r.w + x0]! * (1 - tx) + a[y1 * r.w + x1]! * tx) * ty) / 255; }
    return soft; } };
} catch (e) { sodNote = `SEM rede de saliência (${(e as Error).message.slice(0, 80)})`; }

const renderRaw = async (id: string, az: number[]): Promise<IntakeImage[]> => {
  const r = await page.evaluate(([url, a, elev, fill]) => (window as never as { __renderRaw: (u: string, a: number[], o: object) => Promise<{ width: number; height: number; rgba: string[] }> }).__renderRaw(url as string, a as number[], { width: 480, height: 360, elevationDeg: elev as number, fill: fill as number, background: 'transparent' }), [`/reports/reality-engine/benchmark/assets/${id}/${id}.glb`, az, ELEV, FILL] as const);
  return r.rgba.map((b64, i) => ({ name: `${id}-${az[i]}`, rgba: { width: r.width, height: r.height, data: new Uint8ClampedArray(Buffer.from(b64, 'base64')) } }));
};
const bgCache = new Map<string, ReturnType<typeof jpeg.decode>>();
const bgOf = (f: string) => { if (!bgCache.has(f)) bgCache.set(f, jpeg.decode(readFileSync(resolve('tests/fixtures/photos-real', f)), { useTArray: true, formatAsRGBA: true })); return bgCache.get(f)!; };
const composite = (im: IntakeImage, bgFile: string, flip: boolean): Uint8ClampedArray => {
  const bg = bgOf(bgFile), { width: W, height: H } = im.rgba, out = new Uint8ClampedArray(W * H * 4), s = Math.max(W / bg.width, H / bg.height), ox = (bg.width * s - W) / 2, oy = (bg.height * s - H) / 2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const xx = flip ? W - 1 - x : x, sx = Math.min(bg.width - 1, Math.floor((xx + ox) / s)), sy = Math.min(bg.height - 1, Math.floor((y + oy) / s)), bi = (sy * bg.width + sx) * 4, o = (y * W + x) * 4, a = im.rgba.data[o + 3]! / 255;
    for (let c = 0; c < 3; c++) out[o + c] = im.rgba.data[o + c]! * a + bg.data[bi + c]! * (1 - a); out[o + 3] = 255;
  }
  return out;
};
const degrade = (d: Uint8ClampedArray, W: number, H: number) => {
  const gain = 0.65 + rnd() * 0.7, bias = (rnd() - 0.5) * 50, sigma = 4 + rnd() * 8, out = new Uint8ClampedArray(d.length);
  for (let k = 0; k < W * H; k++) for (let c = 0; c < 3; c++) out[k * 4 + c] = (d[k * 4 + c]! - 128) * gain + 128 + bias + gauss() * sigma; 
  for (let k = 0; k < W * H; k++) out[k * 4 + 3] = 255;
  if (rnd() < 0.5) { const t = out.slice(); for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) for (let c = 0; c < 3; c++) { let s = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += t[((y + dy) * W + x + dx) * 4 + c]!; out[(y * W + x) * 4 + c] = s / 9; } }
  return out;
};

type Row = { asset: string; split: string; condition: string; views: number; accepted: number; refused: number; acceptedWrong: number; meanIoUAccepted: number | null; meanIoUAll: number; methods: Record<string, number> };
const rows: Row[] = [];
for (const asset of manifest.assets) {
  if (only && !only.includes(asset.id)) continue;
  const raw = await renderRaw(asset.id, TURN), truths = raw.map((im) => { const m = new Uint8Array(im.rgba.width * im.rgba.height); for (let k = 0; k < m.length; k++) m[k] = im.rgba.data[k * 4 + 3]! > 127 ? 1 : 0; return m; });
  const ai = manifest.assets.findIndex((a) => a.id === asset.id);
  for (const condition of ['fixed', 'varied', 'degraded'] as const) {
    const imgs = raw.map((im, i) => {
      const bgFile = condition === 'fixed' ? BACKGROUNDS[ai % BACKGROUNDS.length]! : BACKGROUNDS[(ai + i) % BACKGROUNDS.length]!, { width: W, height: H } = im.rgba;
      let data = composite(im, bgFile, condition !== 'fixed' && i % 2 === 1); if (condition === 'degraded') data = degrade(data, W, H);
      return { width: W, height: H, data };
    });
    // flipping the background of the object's alpha is not applied: the object stays; only the background changes.
    const outs = await autoOutlines(imgs, { sod: sodRunner });
    const ious = outs.map((o, i) => (o.mask ? iou(o.mask, truths[i]!) : 0)), acc = outs.map((o) => !!o.mask), methods: Record<string, number> = {};
    outs.forEach((o) => { if (o.method) methods[o.method] = (methods[o.method] ?? 0) + 1; });
    const accIoU = ious.filter((_, i) => acc[i]);
    const row: Row = { asset: asset.id, split: asset.split, condition, views: outs.length, accepted: accIoU.length, refused: outs.length - accIoU.length, acceptedWrong: ious.filter((v, i) => acc[i] && v < 0.8).length, meanIoUAccepted: accIoU.length ? +(accIoU.reduce((a, b) => a + b, 0) / accIoU.length).toFixed(4) : null, meanIoUAll: +(ious.reduce((a, b) => a + b, 0) / ious.length).toFixed(4), methods };
    rows.push(row); console.log(asset.id, asset.split, condition, JSON.stringify({ acc: row.accepted, wrong: row.acceptedWrong, iouAcc: row.meanIoUAccepted, methods }));
  }
}
const summary = Object.fromEntries(['fixed', 'varied', 'degraded'].map((c) => { const r = rows.filter((x) => x.condition === c), v = r.reduce((n, x) => n + x.views, 0), a = r.reduce((n, x) => n + x.accepted, 0), w = r.reduce((n, x) => n + x.acceptedWrong, 0); return [c, { views: v, accepted: a, refused: v - a, acceptedWrong: w, acceptedWrongRate: +(w / Math.max(1, a)).toFixed(3), meanIoUAccepted: +(r.reduce((s, x) => s + (x.meanIoUAccepted ?? 0) * x.accepted, 0) / Math.max(1, a)).toFixed(4), meanIoUAll: +(r.reduce((s, x) => s + x.meanIoUAll * x.views, 0) / Math.max(1, v)).toFixed(4) }]; }));
mkdirSync(resolve('reports/reality-engine/benchmark'), { recursive: true });
writeFileSync(resolve('reports/reality-engine/benchmark/segmentation-validation.json'), JSON.stringify({ generatedBy: 'scripts/benchmark/segmentation-validation.ts', sod: sodNote, reference: 'renderer exact alpha (independent of every segmentation algorithm)', acceptedWrongDefinition: 'accepted mask with IoU < 0.8', summary, rows }, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 1)); await browser.close(); await vite.close();
