// The product's AUTOMATIC outline policy (autoOutlines: static background + salient network + graph cut + classical, consensus selection) on turntable renders over REAL
// photographs. Reports per-view IoU against the exact alpha, the share of views for which a credible outline was found (the rest go to the editor), and which method won.
//   npx tsx scripts/benchmark/segmentation-fusion.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import jpeg from 'jpeg-js';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { autoOutlines } from '../../src/living/reality/auto-segmentation';
import type { SodRunner } from '../../src/living/reality/sod';

const PORT = Number(process.env.FUSION_PORT ?? 5392), manifest = JSON.parse(readFileSync(resolve('reports/reality-engine/benchmark/manifest.json'), 'utf8')) as { assets: Array<{ id: string; split: string }> };
const iou = (a: Uint8Array, b: Uint8Array) => { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { i += a[k]! & b[k]!; u += a[k]! | b[k]!; } return u ? i / u : 0; };
const vite = await createServer({ server: { host: '127.0.0.1', port: PORT, strictPort: true }, logLevel: 'error' }); await vite.listen();
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const sodPage = await browser.newPage(); await sodPage.goto(`http://127.0.0.1:${PORT}/scripts/benchmark/sod.html`); await sodPage.waitForFunction(() => (window as any).__sodReady, null, { timeout: 60000 });
const maker = await browser.newPage(); await maker.goto(`http://127.0.0.1:${PORT}/scripts/benchmark/reality-render.html`); await maker.waitForFunction(() => (window as any).__renderReady, null, { timeout: 60000 });
const sod: SodRunner = { available: async () => true, run: async (rgba) => {
  const { width: W, height: H } = rgba, enc = jpeg.encode({ data: Buffer.from(rgba.data.buffer, rgba.data.byteOffset, rgba.data.byteLength), width: W, height: H }, 92);
  const r = await sodPage.evaluate(([m, u]) => (window as any).__sod(m, u), ['u2netp', `data:image/jpeg;base64,${Buffer.from(enc.data).toString('base64')}`] as const), a = Buffer.from(r.alpha, 'base64'), soft = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const fx = ((x + 0.5) / W) * r.w - 0.5, fy = ((y + 0.5) / H) * r.h - 0.5, x0 = Math.max(0, Math.floor(fx)), y0 = Math.max(0, Math.floor(fy)), x1 = Math.min(r.w - 1, x0 + 1), y1 = Math.min(r.h - 1, y0 + 1), tx = Math.min(1, Math.max(0, fx - x0)), ty = Math.min(1, Math.max(0, fy - y0)); soft[y * W + x] = ((a[y0 * r.w + x0]! * (1 - tx) + a[y0 * r.w + x1]! * tx) * (1 - ty) + (a[y1 * r.w + x0]! * (1 - tx) + a[y1 * r.w + x1]! * tx) * ty) / 255; }
  return soft; } };
const BG = ['car.jpg', 'chair.jpg', 'bus.jpg', 'excavator.jpg', 'porsche-911.jpg', 'skoda-kodiaq.jpg'], rows: Array<Record<string, unknown>> = [];
for (const [ai, a] of manifest.assets.entries()) {
  const r = await maker.evaluate(([url]) => (window as any).__renderRaw(url, [0, 45, 90, 135, 180, 225, 270, 315], { width: 480, height: 360, elevationDeg: 20, fill: 0.55, background: 'transparent' }), [`/reports/reality-engine/benchmark/assets/${a.id}/${a.id}.glb`] as const) as { width: number; height: number; rgba: string[] };
  const bg = jpeg.decode(readFileSync(resolve('tests/fixtures/photos-real', BG[ai % BG.length]!)), { useTArray: true, formatAsRGBA: true }), W = r.width, H = r.height, s = Math.max(W / bg.width, H / bg.height), ox = (bg.width * s - W) / 2, oy = (bg.height * s - H) / 2;
  const frames: Array<{ width: number; height: number; data: Uint8ClampedArray }> = [], truths: Uint8Array[] = [];
  for (const b64 of r.rgba) { const src = new Uint8ClampedArray(Buffer.from(b64, 'base64')), out = new Uint8ClampedArray(W * H * 4), truth = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4, al = src[o + 3]! / 255, bi = (Math.min(bg.height - 1, Math.floor((y + oy) / s)) * bg.width + Math.min(bg.width - 1, Math.floor((x + ox) / s))) * 4; for (let c = 0; c < 3; c++) out[o + c] = src[o + c]! * al + bg.data[bi + c]! * (1 - al); out[o + 3] = 255; truth[y * W + x] = al > 0.5 ? 1 : 0; } frames.push({ width: W, height: H, data: out }); truths.push(truth); }
  const t0 = performance.now(), outs = await autoOutlines(frames, { sod }), ms = performance.now() - t0;
  const credible = outs.filter((o) => o.credible), ious = outs.map((o, i) => (o.mask ? iou(o.mask, truths[i]!) : null)), methods: Record<string, number> = {}; for (const o of outs) if (o.method) methods[o.method] = (methods[o.method] ?? 0) + 1;
  const okIous = ious.filter((v): v is number => v !== null);
  rows.push({ id: a.id, split: a.split, background: BG[ai % BG.length], credibleViews: credible.length, of: outs.length, meanIoUCredible: okIous.length ? +(okIous.reduce((x, y) => x + y, 0) / okIous.length).toFixed(3) : null, wrongButCredible: ious.filter((v) => v !== null && v < 0.5).length, methods, ms: Math.round(ms) }); console.log(JSON.stringify(rows.at(-1)));
}
const tot = rows.reduce((s, r) => s + (r.credibleViews as number), 0), all = rows.reduce((s, r) => s + (r.of as number), 0), wrong = rows.reduce((s, r) => s + (r.wrongButCredible as number), 0);
const mean = (sp: string) => { const x = rows.filter((r) => r.split === sp && r.meanIoUCredible !== null); return +(x.reduce((s, r) => s + (r.meanIoUCredible as number), 0) / x.length).toFixed(3); };
const summary = { credibleViews: tot, views: all, credibleShare: +(tot / all).toFixed(3), wrongButCredibleViews: wrong, meanIoUDev: mean('development'), meanIoUAcc: mean('acceptance') }; console.log(summary);
writeFileSync(resolve('reports/reality-engine/benchmark/segmentation-fusion.json'), JSON.stringify({ note: 'Product automatic outline policy on turntable renders over REAL photograph backgrounds; exact alpha reference; no person.', summary, rows }, null, 2) + '\n');
await browser.close(); await vite.close();
