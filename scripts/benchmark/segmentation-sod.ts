// Automatic segmentation with salient-object networks vs the classical method, on (A) the 8 real photographs (single-annotator polygons) and (B) renders of the
// 14 licensed assets composited over those real photographs (exact alpha as reference). No person in the loop.
//   npx tsx scripts/benchmark/segmentation-sod.ts [models=u2netp,silueta,isnet-general-use,u2net]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import jpeg from 'jpeg-js';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { polygonMask } from '../../src/living/universal-foundry/evidence';
import { segmentGeneric } from '../../src/living/reality/intake';
import { segmentInteractive } from '../../src/living/reality/interactive-segmentation';

const SEED_HI = Number(process.env.SEED_HI ?? 0.9), SEED_LO = Number(process.env.SEED_LO ?? 0.1);
const models = (process.argv[2] ?? 'u2netp,silueta,isnet-general-use,u2net').split(',');
const dir = resolve('tests/fixtures/photos-real'), ann = JSON.parse(readFileSync(resolve(dir, 'annotations.json'), 'utf8')) as { cases: Array<{ id: string; file: string; polygon: Array<[number, number]> }> };
const manifest = JSON.parse(readFileSync(resolve('reports/reality-engine/benchmark/manifest.json'), 'utf8')) as { assets: Array<{ id: string; split: string }> };
const iou = (a: Uint8Array, b: Uint8Array) => { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { i += a[k]! & b[k]!; u += a[k]! | b[k]!; } return u ? i / u : 1; };
const vite = await createServer({ server: { host: '127.0.0.1', port: Number(process.env.SOD_PORT ?? 5395), strictPort: true }, logLevel: 'error' }); await vite.listen();
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const sod = await browser.newPage(); await sod.goto(`http://127.0.0.1:${process.env.SOD_PORT ?? 5395}/scripts/benchmark/sod.html`); await sod.waitForFunction(() => (window as any).__sodReady, null, { timeout: 60000 });
const maker = await browser.newPage(); await maker.goto(`http://127.0.0.1:${process.env.SOD_PORT ?? 5395}/scripts/benchmark/reality-render.html`); await maker.waitForFunction(() => (window as any).__renderReady, null, { timeout: 60000 });
const run = async (model: string, rgba: { width: number; height: number; data: Uint8ClampedArray }, W: number, H: number) => {
  const enc = jpeg.encode({ data: Buffer.from(rgba.data.buffer, rgba.data.byteOffset, rgba.data.byteLength), width: W, height: H }, 92);
  const r = await sod.evaluate(([m, u]) => (window as any).__sod(m, u), [model, `data:image/jpeg;base64,${Buffer.from(enc.data).toString('base64')}`] as const);
  const a = Buffer.from(r.alpha, 'base64'), mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { // bilinear upsample of the soft map, threshold 0.5
    const fx = ((x + 0.5) / W) * r.w - 0.5, fy = ((y + 0.5) / H) * r.h - 0.5, x0 = Math.max(0, Math.floor(fx)), y0 = Math.max(0, Math.floor(fy)), x1 = Math.min(r.w - 1, x0 + 1), y1 = Math.min(r.h - 1, y0 + 1), tx = Math.min(1, Math.max(0, fx - x0)), ty = Math.min(1, Math.max(0, fy - y0));
    const v = (a[y0 * r.w + x0]! * (1 - tx) + a[y0 * r.w + x1]! * tx) * (1 - ty) + (a[y1 * r.w + x0]! * (1 - tx) + a[y1 * r.w + x1]! * tx) * ty; mask[y * W + x] = v >= 127.5 ? 1 : 0; }
  // graph-cut refinement seeded by the network: confident object / confident background fixed, the uncertain band decided by colour models and image edges
  const soft = new Float32Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const fx = ((x + 0.5) / W) * r.w - 0.5, fy = ((y + 0.5) / H) * r.h - 0.5, x0 = Math.max(0, Math.floor(fx)), y0 = Math.max(0, Math.floor(fy)), x1 = Math.min(r.w - 1, x0 + 1), y1 = Math.min(r.h - 1, y0 + 1), tx = Math.min(1, Math.max(0, fx - x0)), ty = Math.min(1, Math.max(0, fy - y0)); soft[y * W + x] = ((a[y0 * r.w + x0]! * (1 - tx) + a[y0 * r.w + x1]! * tx) * (1 - ty) + (a[y1 * r.w + x0]! * (1 - tx) + a[y1 * r.w + x1]! * tx) * ty) / 255; }
  let bx0 = W, by0 = H, bx1 = 0, by1 = 0, cnt = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) { cnt++; bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
  let refined = mask; if (cnt > W * H * 0.003) { const seeds = new Uint8Array(W * H); for (let k = 0; k < W * H; k++) seeds[k] = soft[k]! > SEED_HI ? 1 : soft[k]! < SEED_LO ? 2 : 0; const pad = 0.06; refined = segmentInteractive({ width: W, height: H, data: rgba.data }, { box: { x0: Math.max(0, bx0 - pad * W), y0: Math.max(0, by0 - pad * H), x1: Math.min(W, bx1 + pad * W), y1: Math.min(H, by1 + pad * H) }, seeds }).mask; }
  return { mask, refined, ms: r.ms as number };
};
const results: Record<string, unknown> = {};
// (A) real photographs
const real: Array<Record<string, unknown>> = [];
for (const c of ann.cases) {
  const img = jpeg.decode(readFileSync(resolve(dir, c.file)), { useTArray: true, formatAsRGBA: true }), W = img.width, H = img.height, rgba = { width: W, height: H, data: img.data as unknown as Uint8ClampedArray }, truth = polygonMask(c.polygon, W, H);
  const row: Record<string, unknown> = { id: c.id, classical: +iou(segmentGeneric(rgba).mask, truth).toFixed(3) };
  for (const m of models) { const r = await run(m, rgba, W, H); row[m] = +iou(r.mask, truth).toFixed(3); row[`${m}+graphcut`] = +iou(r.refined, truth).toFixed(3); row[`${m}Ms`] = Math.round(r.ms); }
  real.push(row); console.log(JSON.stringify(row));
}
results.realPhotographs = real;
// (B) renders over real backgrounds
const BG = ['car.jpg', 'chair.jpg', 'bus.jpg', 'excavator.jpg', 'porsche-911.jpg', 'skoda-kodiaq.jpg'], comp: Array<Record<string, unknown>> = [];
for (const [ai, a] of manifest.assets.entries()) {
  const r = await maker.evaluate(([url]) => (window as any).__renderRaw(url, [0, 90, 180, 270], { width: 480, height: 360, elevationDeg: 20, fill: 0.55, background: 'transparent' }), [`/reports/reality-engine/benchmark/assets/${a.id}/${a.id}.glb`] as const) as { width: number; height: number; rgba: string[] };
  const bg = jpeg.decode(readFileSync(resolve(dir, BG[ai % BG.length]!)), { useTArray: true, formatAsRGBA: true }), W = r.width, H = r.height, s = Math.max(W / bg.width, H / bg.height), ox = (bg.width * s - W) / 2, oy = (bg.height * s - H) / 2;
  const per: Record<string, number[]> = { classical: [] }; for (const m of models) { per[m] = []; per[`${m}+graphcut`] = []; }
  for (const b64 of r.rgba) {
    const src = new Uint8ClampedArray(Buffer.from(b64, 'base64')), out = new Uint8ClampedArray(W * H * 4), truth = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4, al = src[o + 3]! / 255, bi = (Math.min(bg.height - 1, Math.floor((y + oy) / s)) * bg.width + Math.min(bg.width - 1, Math.floor((x + ox) / s))) * 4; for (let c = 0; c < 3; c++) out[o + c] = src[o + c]! * al + bg.data[bi + c]! * (1 - al); out[o + 3] = 255; truth[y * W + x] = al > 0.5 ? 1 : 0; }
    const rgba = { width: W, height: H, data: out }; per.classical!.push(iou(segmentGeneric(rgba).mask, truth));
    for (const m of models) { const rr = await run(m, rgba, W, H); per[m]!.push(iou(rr.mask, truth)); per[`${m}+graphcut`]!.push(iou(rr.refined, truth)); }
  }
  const row: Record<string, unknown> = { id: a.id, split: a.split, background: BG[ai % BG.length] }; for (const k of Object.keys(per)) row[k] = +(per[k]!.reduce((x, y) => x + y, 0) / per[k]!.length).toFixed(3);
  comp.push(row); console.log(JSON.stringify(row));
}
results.composites = comp;
const mean = (rows: Array<Record<string, unknown>>, k: string) => +(rows.reduce((s, r) => s + (r[k] as number), 0) / rows.length).toFixed(3);
const summary: Record<string, unknown> = {}; for (const k of ['classical', ...models, ...models.map((m) => `${m}+graphcut`)]) summary[k] = { realPhotos: mean(real, k), composites: mean(comp, k), compositesDev: mean(comp.filter((r) => r.split === 'development'), k), compositesAcc: mean(comp.filter((r) => r.split === 'acceptance'), k) };
console.log(summary);
writeFileSync(resolve(process.env.SOD_OUT ?? 'reports/reality-engine/benchmark/segmentation-sod.json'), JSON.stringify({ note: 'AUTOMATIC segmentation: classical colour vs salient-object networks (rembg release weights, Apache-2.0). Real photos: single-annotator polygons. Composites: renders over real photographs, exact alpha.', models, summary, ...results }, null, 2) + '\n');
await browser.close(); await vite.close();
