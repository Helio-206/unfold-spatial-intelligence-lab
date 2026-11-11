// Static-background (turntable) automatic segmentation on renders composited over REAL photographs (exact alpha reference), vs the classical method.
//   npx tsx scripts/benchmark/segmentation-static.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import jpeg from 'jpeg-js';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { segmentGeneric, segmentationCredibility } from '../../src/living/reality/intake';
import { segmentStaticBackground } from '../../src/living/reality/static-background';

const manifest = JSON.parse(readFileSync(resolve('reports/reality-engine/benchmark/manifest.json'), 'utf8')) as { assets: Array<{ id: string; split: string }> };
const iou = (a: Uint8Array, b: Uint8Array) => { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { i += a[k]! & b[k]!; u += a[k]! | b[k]!; } return u ? i / u : 1; };
const vite = await createServer({ server: { host: '127.0.0.1', port: 5394, strictPort: true }, logLevel: 'error' }); await vite.listen();
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const maker = await browser.newPage(); await maker.goto('http://127.0.0.1:5394/scripts/benchmark/reality-render.html'); await maker.waitForFunction(() => (window as any).__renderReady, null, { timeout: 60000 });
const BG = ['car.jpg', 'chair.jpg', 'bus.jpg', 'excavator.jpg', 'porsche-911.jpg', 'skoda-kodiaq.jpg'], rows: Array<Record<string, unknown>> = [];
for (const [ai, a] of manifest.assets.entries()) {
  const r = await maker.evaluate(([url]) => (window as any).__renderRaw(url, [0, 45, 90, 135, 180, 225, 270, 315], { width: 480, height: 360, elevationDeg: 20, fill: 0.55, background: 'transparent' }), [`/reports/reality-engine/benchmark/assets/${a.id}/${a.id}.glb`] as const) as { width: number; height: number; rgba: string[] };
  const bg = jpeg.decode(readFileSync(resolve('tests/fixtures/photos-real', BG[ai % BG.length]!)), { useTArray: true, formatAsRGBA: true }), W = r.width, H = r.height, s = Math.max(W / bg.width, H / bg.height), ox = (bg.width * s - W) / 2, oy = (bg.height * s - H) / 2;
  const frames: Array<{ width: number; height: number; data: Uint8ClampedArray }> = [], truths: Uint8Array[] = [];
  for (const b64 of r.rgba) { const src = new Uint8ClampedArray(Buffer.from(b64, 'base64')), out = new Uint8ClampedArray(W * H * 4), truth = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4, al = src[o + 3]! / 255, bi = (Math.min(bg.height - 1, Math.floor((y + oy) / s)) * bg.width + Math.min(bg.width - 1, Math.floor((x + ox) / s))) * 4; for (let c = 0; c < 3; c++) out[o + c] = src[o + c]! * al + bg.data[bi + c]! * (1 - al); out[o + 3] = 255; truth[y * W + x] = al > 0.5 ? 1 : 0; } frames.push({ width: W, height: H, data: out }); truths.push(truth); }
  const t0 = performance.now(), st = segmentStaticBackground(frames), ms = performance.now() - t0;
  const cls = frames.map((f, i) => iou(segmentGeneric(f).mask, truths[i]!)), clsOk = frames.filter((f) => segmentationCredibility(segmentGeneric(f)).reliable).length;
  const stat = st.applicable ? st.masks.map((m, i) => iou(m, truths[i]!)) : [];
  rows.push({ id: a.id, split: a.split, background: BG[ai % BG.length], classicalIoU: +(cls.reduce((x, y) => x + y, 0) / cls.length).toFixed(3), classicalCredible: clsOk, staticApplicable: st.applicable, staticShare: +st.staticShare.toFixed(2), staticIoU: stat.length ? +(stat.reduce((x, y) => x + y, 0) / stat.length).toFixed(3) : null, staticMinIoU: stat.length ? +Math.min(...stat).toFixed(3) : null, ms: Math.round(ms) }); console.log(JSON.stringify(rows.at(-1)));
}
const m = (k: string, sp?: string) => { const x = rows.filter((r) => (!sp || r.split === sp) && r[k] !== null); return +(x.reduce((s, r) => s + (r[k] as number), 0) / x.length).toFixed(3); };
const summary = { classical: m('classicalIoU'), static: m('staticIoU'), staticDev: m('staticIoU', 'development'), staticAcc: m('staticIoU', 'acceptance') }; console.log(summary);
writeFileSync(resolve('reports/reality-engine/benchmark/segmentation-static.json'), JSON.stringify({ note: 'Turntable renders (fixed camera) over REAL photograph backgrounds; exact alpha reference; automatic, no person.', summary, rows }, null, 2) + '\n');
await browser.close(); await vite.close();
