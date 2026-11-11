// Segmentation on REAL photographs with complex backgrounds (tests/fixtures/photos-real, polygons by ONE annotator): classical background-colour segmentation
// (what the product did) vs interactive segmentation with a rough box and simulated corrections. The reference is a single annotator's polygon, so the ceiling is
// ~0.93-0.96 (two passes of the same annotator agree at that level); the numbers are relative, not absolute accuracy.
//   npx tsx scripts/benchmark/segmentation-real-photos.ts [outFile]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import jpeg from 'jpeg-js';
import { polygonMask } from '../../src/living/universal-foundry/evidence';
import { segmentGeneric, segmentationCredibility } from '../../src/living/reality/intake';
import { segmentInteractive, type Point } from '../../src/living/reality/interactive-segmentation';

const only = process.env.SEG_CASES?.split(',') ?? null, BRUSH = Number(process.env.SEG_BRUSH ?? 8), LAMBDA = Number(process.env.SEG_LAMBDA ?? 30), KC = Number(process.env.SEG_K ?? 5);
const dir = resolve('tests/fixtures/photos-real'), ann = JSON.parse(readFileSync(resolve(dir, 'annotations.json'), 'utf8')) as { cases: Array<{ id: string; file: string; polygon: Array<[number, number]> }> };
const iou = (a: Uint8Array, b: Uint8Array) => { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { i += a[k]! & b[k]!; u += a[k]! | b[k]!; } return u ? i / u : 1; };
const round = (n: number) => +n.toFixed(3);
const rows: Array<Record<string, unknown>> = [];
for (const c of ann.cases) {
  if (only && !only.includes(c.id)) continue;
  const img = jpeg.decode(readFileSync(resolve(dir, c.file)), { useTArray: true, formatAsRGBA: true }), W = img.width, H = img.height, rgba = { width: W, height: H, data: img.data as unknown as Uint8ClampedArray };
  const truth = polygonMask(c.polygon, W, H);
  let x0 = W, y0 = H, x1 = 0, y1 = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (truth[y * W + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const pad = 0.06, box = { x0: Math.max(0, x0 - pad * W), y0: Math.max(0, y0 - pad * H), x1: Math.min(W, x1 + pad * W), y1: Math.min(H, y1 + pad * H) }; // a person's loose rectangle
  const auto = segmentGeneric(rgba), autoCred = segmentationCredibility(auto);
  const t0 = performance.now(), boxOnly = segmentInteractive(rgba, { box }, { smoothness: LAMBDA, components: KC }), msBox = performance.now() - t0;
  // simulated corrections: each round marks up to 12 wrongly-labelled pixels (at random-but-deterministic positions) with the right label, like a few brush strokes
  const fg: Point[] = [], bg: Point[] = []; let cur = boxOnly, rounds = 0; const hist = [iou(boxOnly.mask, truth)];
  for (; rounds < 3; rounds++) {
    const fn: number[] = [], fp: number[] = [];
    for (let k = 0; k < W * H; k++) { if (truth[k] && !cur.mask[k]) fn.push(k); else if (!truth[k] && cur.mask[k]) fp.push(k); }
    const pick = (a: number[], m: number) => { const out: number[] = []; if (!a.length) return out; const step = Math.max(1, Math.floor(a.length / m)); for (let i = Math.floor(step / 2); i < a.length && out.length < m; i += step) out.push(a[i]!); return out; };
    for (const k of pick(fn, 12)) fg.push([k % W, Math.floor(k / W)]); for (const k of pick(fp, 12)) bg.push([k % W, Math.floor(k / W)]);
    cur = segmentInteractive(rgba, { box, foreground: fg, background: bg, brushRadius: BRUSH }, { smoothness: LAMBDA, components: KC }); hist.push(iou(cur.mask, truth));
  }
  rows.push({ id: c.id, size: [W, H], classicalIoU: round(iou(auto.mask, truth)), classicalCredible: autoCred.reliable, boxOnlyIoU: round(hist[0]!), afterCorrections: hist.slice(1).map(round), strokesUsed: { fg: fg.length, bg: bg.length }, msBoxOnly: Math.round(msBox), iterations: boxOnly.iterations });
  console.log(c.id, JSON.stringify(rows.at(-1)));
}
const m = (k: string) => rows.reduce((s, r) => s + (r[k] as number), 0) / rows.length;
const summary = { cases: rows.length, classicalMean: round(m('classicalIoU')), boxOnlyMean: round(m('boxOnlyIoU')), afterThreeRoundsMean: round(rows.reduce((s, r) => s + (r.afterCorrections as number[]).at(-1)!, 0) / rows.length), classicalCredibleCount: rows.filter((r) => r.classicalCredible).length };
console.log(summary);
writeFileSync(resolve(process.argv[2] ?? 'reports/reality-engine/benchmark/segmentation-real-photos.json'), JSON.stringify({ note: 'REAL photographs, single-annotator polygons (not independent). Interactive = rough box + simulated corrections.', summary, rows }, null, 2) + '\n');
