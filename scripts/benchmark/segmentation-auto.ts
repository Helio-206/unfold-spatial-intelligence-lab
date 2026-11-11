// AUTOMATIC segmentation (no person in the loop) on the 8 real photographs: classical colour, DeepLab v3 alone, DeepLab seeding the graph-cut. Reference: single-annotator polygons.
//   npx tsx scripts/benchmark/segmentation-auto.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import jpeg from 'jpeg-js';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { polygonMask } from '../../src/living/universal-foundry/evidence';
import { segmentGeneric } from '../../src/living/reality/intake';
import { segmentInteractive } from '../../src/living/reality/interactive-segmentation';

const dir = resolve('tests/fixtures/photos-real'), ann = JSON.parse(readFileSync(resolve(dir, 'annotations.json'), 'utf8')) as { cases: Array<{ id: string; file: string; polygon: Array<[number, number]> }> };
const iou = (a: Uint8Array, b: Uint8Array) => { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { i += a[k]! & b[k]!; u += a[k]! | b[k]!; } return u ? i / u : 1; };
const vite = await createServer({ server: { host: '127.0.0.1', port: 5396, strictPort: true }, logLevel: 'error' }); await vite.listen();
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--ignore-gpu-blocklist'] });
const page = await browser.newPage(); await page.goto('http://127.0.0.1:5396/scripts/benchmark/deeplab.html'); await page.waitForFunction(() => (window as any).__deeplabReady, null, { timeout: 60000 });
const rows: Array<Record<string, unknown>> = [];
for (const c of ann.cases) {
  const buf = readFileSync(resolve(dir, c.file)), img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true }), W = img.width, H = img.height, rgba = { width: W, height: H, data: img.data as unknown as Uint8ClampedArray };
  const truth = polygonMask(c.polygon, W, H), t0 = performance.now();
  let labels: Uint8Array | null = null, lw = 0, lh = 0;
  try { const r = await page.evaluate((u) => (window as any).__deeplab(u), `data:image/jpeg;base64,${buf.toString('base64')}`); labels = Uint8Array.from(Buffer.from(r.labels, 'base64')); lw = r.w; lh = r.h; } catch (e) { console.log('deeplab failed', String(e).slice(0, 120)); }
  const classical = segmentGeneric(rgba).mask; let dl = new Uint8Array(W * H), classes: Record<number, number> = {};
  if (labels) { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const l = labels[Math.min(lh - 1, Math.floor((y / H) * lh)) * lw + Math.min(lw - 1, Math.floor((x / W) * lw))]!; if (l) { dl[y * W + x] = 1; classes[l] = (classes[l] ?? 0) + 1; } } }
  // keep the dominant foreground class (the object the model is most sure of)
  const dom = Number(Object.entries(classes).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0); if (labels) { dl = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (labels[Math.min(lh - 1, Math.floor((y / H) * lh)) * lw + Math.min(lw - 1, Math.floor((x / W) * lw))] === dom) dl[y * W + x] = 1; }
  // DeepLab-seeded graph cut: its mask's bounding box is the box; its eroded interior is object, its far exterior is background
  let x0 = W, y0 = H, x1 = 0, y1 = 0, n = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (dl[y * W + x]) { n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  let seeded = dl; if (n > W * H * 0.01) { const pad = 0.04; const fg: Array<[number, number]> = [], bg: Array<[number, number]> = []; for (let y = 0; y < H; y += 6) for (let x = 0; x < W; x += 6) { const inside = dl[y * W + x]!; let core = inside; if (inside) for (const [dx, dy] of [[12, 0], [-12, 0], [0, 12], [0, -12]] as const) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H || !dl[yy * W + xx]) core = 0; } if (core) fg.push([x, y]); else if (!inside && (x < x0 - 0.1 * W || x > x1 + 0.1 * W || y < y0 - 0.1 * H || y > y1 + 0.1 * H)) bg.push([x, y]); }
    seeded = segmentInteractive(rgba, { box: { x0: Math.max(0, x0 - pad * W), y0: Math.max(0, y0 - pad * H), x1: Math.min(W, x1 + pad * W), y1: Math.min(H, y1 + pad * H) }, foreground: fg, background: bg, brushRadius: 6 }).mask; }
  rows.push({ id: c.id, classical: +iou(classical, truth).toFixed(3), deeplab: labels ? +iou(dl, truth).toFixed(3) : null, deeplabClass: dom, deeplabSeededGraphCut: +iou(seeded, truth).toFixed(3), ms: Math.round(performance.now() - t0) }); console.log(JSON.stringify(rows.at(-1)));
}
const m = (k: string) => +(rows.reduce((s, r) => s + (r[k] as number), 0) / rows.length).toFixed(3);
console.log({ classical: m('classical'), deeplab: m('deeplab'), seeded: m('deeplabSeededGraphCut') });
writeFileSync(resolve('reports/reality-engine/benchmark/segmentation-auto-real-photos.json'), JSON.stringify({ note: 'Automatic segmentation (no person) on 8 real vehicle photographs; single-annotator polygons; DeepLab v3 (Pascal VOC) via MediaPipe.', rows }, null, 2) + '\n');
await browser.close(); await vite.close();
