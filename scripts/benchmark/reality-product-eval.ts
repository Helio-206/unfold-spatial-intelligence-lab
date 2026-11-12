// Product-path evaluation of the Reality Engine against independent 3D ground truth.
// Input = textured, lit PERSPECTIVE renders of licensed assets on a plain background (rendered in Chromium), segmented AUTOMATICALLY by the product's
// intake, poses ASSUMED (equal turntable steps, direction chosen by evidence, elevation declared), refined by the product's pose gate, reconstructed by the
// product's model. Reported against the 3D asset (Chamfer, translation-aligned), against held-out renders (silhouette IoU) and per category/split.
// These are renders, not photographs. Run: npx tsx scripts/benchmark/reality-product-eval.ts [outDir] [--assets A,B]
import { createHash } from 'node:crypto';
import jpeg from 'jpeg-js';
import { segmentInteractive, type Point } from '../../src/living/reality/interactive-segmentation';
import { segmentGeneric, segmentationCredibility } from '../../src/living/reality/intake';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { Box3, Vector3 } from 'three';
import { readGlbParts } from '../../src/universal-spatial/reconstruction/glb-geometry';
import { hullField, hullSilhouette, reconstructHull } from '../../src/universal-spatial/reconstruction/multiview';
import { chamfer, geometryPoints, samplePoints } from '../../src/universal-spatial/reconstruction/multiview-metrics';
import type { Tri } from '../../src/universal-spatial/reconstruction/silhouette';
import { extractEvidence } from '../../src/living/universal-foundry/evidence';
import { refinePosesOf } from '../../src/living/reality/compute';
import { decodeMask } from '../../src/living/reality/evidence';
import { intakeAddView, intakeOrbit, type IntakeImage } from '../../src/living/reality/intake';
import { autoOutlines } from '../../src/living/reality/auto-segmentation';
import type { SodRunner } from '../../src/living/reality/sod';
import { photometricError } from '../../src/living/reality/photometric';
import { buildModel, partGeometry, viewsOf } from '../../src/living/reality/model';
import { assessReconstruction } from '../../src/living/reality/assessment';
import { planFromModel } from '../../src/living/reality/plan';
import { evidenceSha256 } from '../../src/living/reality/evidence';

const AUTO = process.env.AUTO === '1', REAL_BG = process.env.BG === 'real', BACKGROUNDS = ['car.jpg', 'chair.jpg', 'bus.jpg', 'excavator.jpg', 'porsche-911.jpg', 'skoda-kodiaq.jpg'];
const argOut = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : AUTO ? 'reports/reality-engine/benchmark/product-results-realbg-auto' : REAL_BG ? 'reports/reality-engine/benchmark/product-results-realbg' : 'reports/reality-engine/benchmark/product-results';
const only = process.argv.includes('--assets') ? process.argv[process.argv.indexOf('--assets') + 1]!.split(',') : null;
mkdirSync(resolve(argOut), { recursive: true });
const manifest = JSON.parse(readFileSync(resolve('reports/reality-engine/benchmark/manifest.json'), 'utf8')) as { assets: Array<{ id: string; kind: string; category: string; split: string; sha256: string }> };
const FILL = 0.55, ELEV = 20, TURN = Array.from({ length: 8 }, (_, i) => i * 45), HELD = [22.5, 112.5, 202.5, 292.5];
const round = (n: number, d = 4) => +n.toFixed(d);
const iou = (a: Uint8Array, b: Uint8Array) => { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { i += a[k]! & b[k]!; u += a[k]! | b[k]!; } return u ? i / u : 1; };

const vite = await createServer({ server: { host: '127.0.0.1', port: 5398, strictPort: true, hmr: false, watch: null }, logLevel: 'error' }); await vite.listen(); // no HMR/watch: a file written during a long run (or a git operation) used to reload the render page mid-evaluation ("Execution context was destroyed")
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 500, height: 400 } });
await page.goto('http://127.0.0.1:5398/scripts/benchmark/reality-render.html');
await page.waitForFunction(() => (window as never as { __renderReady?: boolean }).__renderReady === true, null, { timeout: 60_000 });
const sodPage = AUTO ? await browser.newPage() : null;
if (sodPage) { await sodPage.goto('http://127.0.0.1:5398/scripts/benchmark/sod.html'); await sodPage.waitForFunction(() => (window as any).__sodReady, null, { timeout: 60000 }); }
const sodRunner: SodRunner = { available: async () => true, run: async (rgba) => {
  const { width: W, height: H } = rgba, enc = jpeg.encode({ data: Buffer.from(rgba.data.buffer, rgba.data.byteOffset, rgba.data.byteLength), width: W, height: H }, 92);
  const r = await sodPage!.evaluate(([m, u]) => (window as any).__sod(m, u), ['u2netp', `data:image/jpeg;base64,${Buffer.from(enc.data).toString('base64')}`] as const), a = Buffer.from(r.alpha, 'base64'), soft = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const fx = ((x + 0.5) / W) * r.w - 0.5, fy = ((y + 0.5) / H) * r.h - 0.5, x0 = Math.max(0, Math.floor(fx)), y0 = Math.max(0, Math.floor(fy)), x1 = Math.min(r.w - 1, x0 + 1), y1 = Math.min(r.h - 1, y0 + 1), tx = Math.min(1, Math.max(0, fx - x0)), ty = Math.min(1, Math.max(0, fy - y0)); soft[y * W + x] = ((a[y0 * r.w + x0]! * (1 - tx) + a[y0 * r.w + x1]! * tx) * (1 - ty) + (a[y1 * r.w + x0]! * (1 - tx) + a[y1 * r.w + x1]! * tx) * ty) / 255; }
  return soft; } };
const renderRaw = async (id: string, az: number[], transparent = false): Promise<IntakeImage[]> => {
  const r = await page.evaluate(([url, a, elev, fill, transp]) => (window as never as { __renderRaw: (u: string, a: number[], o: object) => Promise<{ width: number; height: number; rgba: string[] }> }).__renderRaw(url as string, a as number[], { width: 480, height: 360, elevationDeg: elev as number, fill: fill as number, ...(transp ? { background: 'transparent' } : {}) }), [`/reports/reality-engine/benchmark/assets/${id}/${id}.glb`, az, ELEV, FILL, transparent] as const);
  return r.rgba.map((b64, i) => ({ name: `${id}-${az[i]}.png`, rgba: { width: r.width, height: r.height, data: new Uint8ClampedArray(Buffer.from(b64, 'base64')) } }));
};

const gtMaskOf = (im: IntakeImage) => { const m = new Uint8Array(im.rgba.width * im.rgba.height); for (let k = 0; k < m.length; k++) m[k] = im.rgba.data[k * 4 + 3]! > 127 ? 1 : 0; return m; };
const composite = (im: IntakeImage, bgFile: string): IntakeImage => {
  const bg = jpeg.decode(readFileSync(resolve('tests/fixtures/photos-real', bgFile)), { useTArray: true, formatAsRGBA: true }), { width: W, height: H } = im.rgba, out = new Uint8ClampedArray(W * H * 4);
  const s = Math.max(W / bg.width, H / bg.height), ox = (bg.width * s - W) / 2, oy = (bg.height * s - H) / 2; // cover-fit, centre crop
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = Math.min(bg.width - 1, Math.floor((x + ox) / s)), sy = Math.min(bg.height - 1, Math.floor((y + oy) / s)), bi = (sy * bg.width + sx) * 4, o = (y * W + x) * 4, a = im.rgba.data[o + 3]! / 255;
    for (let c = 0; c < 3; c++) out[o + c] = im.rgba.data[o + c]! * a + bg.data[bi + c]! * (1 - a); out[o + 3] = 255;
  }
  return { name: im.name, rgba: { width: W, height: H, data: out } };
};
/** What a person would do: a rough box, then up to 3 rounds of a dozen brush marks on the worst errors. The reference is the render's own exact alpha. */
const assistedMask = (im: IntakeImage, truth: Uint8Array) => {
  const { width: W, height: H } = im.rgba; let x0 = W, y0 = H, x1 = 0, y1 = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (truth[y * W + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const box = { x0: Math.max(0, x0 - 0.06 * W), y0: Math.max(0, y0 - 0.06 * H), x1: Math.min(W, x1 + 0.06 * W), y1: Math.min(H, y1 + 0.06 * H) }, brushRadius = Math.max(3, Math.round(0.0146 * Math.max(W, H)));
  const fg: Point[] = [], bg: Point[] = []; let cur = segmentInteractive(im.rgba, { box, brushRadius }); const hist = [iou(cur.mask, truth)];
  for (let r = 0; r < 3; r++) {
    const fn: number[] = [], fp: number[] = []; for (let k = 0; k < W * H; k++) { if (truth[k] && !cur.mask[k]) fn.push(k); else if (!truth[k] && cur.mask[k]) fp.push(k); }
    const pick = (a: number[], m: number) => { const o: number[] = []; if (!a.length) return o; const st = Math.max(1, Math.floor(a.length / m)); for (let i = Math.floor(st / 2); i < a.length && o.length < m; i += st) o.push(a[i]!); return o; };
    for (const k of pick(fn, 12)) fg.push([k % W, Math.floor(k / W)]); for (const k of pick(fp, 12)) bg.push([k % W, Math.floor(k / W)]);
    cur = segmentInteractive(im.rgba, { box, foreground: fg, background: bg, brushRadius }); hist.push(iou(cur.mask, truth));
  }
  return { mask: cur.mask, iou: hist.at(-1)!, boxOnlyIoU: hist[0]! };
};

const results: Array<Record<string, unknown>> = [];
for (const asset of manifest.assets) {
  if (only && !only.includes(asset.id)) continue;
  const bytes = readFileSync(resolve('reports/reality-engine/benchmark/assets', asset.id, `${asset.id}.glb`));
  if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error(`SHA_MISMATCH ${asset.id}`);
  const tris: Tri[] = readGlbParts(new Uint8Array(bytes)).flatMap((p) => p.tris);
  const box = new Box3(); for (const t of tris) for (const p of t) box.expandByPoint(p);
  const c = box.getCenter(new Vector3()), height = box.getSize(new Vector3()).y, diag = box.getSize(new Vector3()).length();
  const gt = tris.map((t) => t.map((p) => p.clone().sub(c).multiplyScalar(FILL / height)) as Tri); // recon units: 1 = one image height; the object is FILL of it
  const row: Record<string, unknown> = { id: asset.id, kind: asset.kind, category: asset.category, split: asset.split };
  let photos: IntakeImage[], held: IntakeImage[];
  if (REAL_BG) {
    const bgFile = BACKGROUNDS[manifest.assets.indexOf(asset) % BACKGROUNDS.length]!, rawP = await renderRaw(asset.id, TURN, true), rawH = await renderRaw(asset.id, HELD, true);
    const comp = rawP.map((im) => composite(im, bgFile)), truths = rawP.map(gtMaskOf);
    const autoOk = comp.filter((im) => segmentationCredibility(segmentGeneric(im.rgba)).reliable).length;
    if (AUTO) {
      // automatic-first policy: the product's strategies decide; views with no credible outline go to the person (simulated with the oracle brush protocol and counted as manual)
      const outs = await autoOutlines(comp.map((c) => c.rgba), { sod: sodRunner }), manual = new Set<number>(), masks: Uint8Array[] = [], ious: number[] = [];
      for (let i = 0; i < comp.length; i++) { if (outs[i]!.mask) { masks.push(outs[i]!.mask!); ious.push(iou(outs[i]!.mask!, truths[i]!)); } else { manual.add(i); const m = assistedMask(comp[i]!, truths[i]!); masks.push(m.mask); ious.push(m.iou); } }
      photos = comp.map((im, i) => ({ ...im, mask: masks[i]!, maskSource: manual.has(i) ? 'confirmed' as const : 'automatic' as const }));
      row.background = bgFile; row.autoViews = comp.length - manual.size; row.manualViews = manual.size; row.autoWrongViews = outs.reduce((n, o, i) => n + (o.mask && iou(o.mask, truths[i]!) < 0.5 ? 1 : 0), 0); row.segmentationIoUMean = round(ious.reduce((a, b) => a + b, 0) / ious.length);
      held = rawH.map((im) => ({ ...composite(im, bgFile), mask: gtMaskOf(im) }));
    } else {
    const assisted = comp.map((im, i) => assistedMask(im, truths[i]!));
    photos = comp.map((im, i) => ({ ...im, mask: assisted[i]!.mask }));
    held = rawH.map((im) => ({ ...composite(im, bgFile), mask: gtMaskOf(im) })); // held-out references use the exact alpha
    row.background = bgFile; row.autoCredibleViews = autoOk; row.segmentationBoxOnlyIoU = round(assisted.reduce((a, b) => a + b.boxOnlyIoU, 0) / assisted.length); row.segmentationAssistedIoU = round(assisted.reduce((a, b) => a + b.iou, 0) / assisted.length);
    }
  } else { photos = await renderRaw(asset.id, TURN); held = await renderRaw(asset.id, HELD); }
  const t0 = performance.now(), intake = intakeOrbit(photos, { elevationDeg: ELEV });
  if (!intake.evidence) { row.status = 'refused'; row.refusals = intake.refusals.map((r) => `${r.code}${r.viewName ? ` (${r.viewName})` : ''}`); row.reliability = intake.views.map((v) => ({ name: v.name, reliable: v.reliable, reasons: v.reasons })); results.push(row); console.log(asset.id, 'REFUSED', row.refusals); continue; }
  const poses = refinePosesOf(intake.evidence), evidence = poses.applied ? poses.evidence : intake.evidence, model = buildModel(evidence), ms = performance.now() - t0;
  const sign = Math.sign(evidence.views[1]!.azimuthDeg / (TURN[1]! || 1)) || 1;
  // held-out renders segmented automatically and framed like the originals; the pose of a held-out render follows the reconstruction's own direction
  const heldIoU: number[] = [], heldViews: import('../../src/living/reality/evidence').StoredView[] = [];
  for (let i = 0; i < held.length; i++) {
    const added = intakeAddView(evidence, held[i]!, { azimuthDeg: sign * HELD[i]!, elevationDeg: ELEV }); if (!added.evidence) continue;
    heldViews.push(added.evidence.views.at(-1)!);
    const view = viewsOf(added.evidence).at(-1)!; heldIoU.push(iou(view.mask, hullSilhouette(model.solid.grid, model.solid.occupancy, view, model.frame)));
  }
  // Shells also carry interface faces between parts, INSIDE the solid, which no scanned surface has: accuracy (prediction -> truth) is measured on the OUTER
  // surface only (points on the hull's own surface); completeness (truth -> prediction) may use every shell point. Translation alignment uses all points.
  const exactField = hullField(viewsOf(evidence), model.frame);
  const pts = model.parts.flatMap((p) => geometryPoints(partGeometry(p), 2500, 3).map((q) => q.add(new Vector3(...p.origin))));
  const cen = (a: Vector3[]) => a.reduce((s, v) => s.add(v), new Vector3()).multiplyScalar(1 / a.length);
  // Translation alignment (origin convention only, no rotation, no scale) from the solid's own outer surface, so interface faces cannot bias it
  const hullOnly = geometryPoints(reconstructHull(viewsOf(evidence), { frame: model.frame, cells: evidence.cells }).geometry, 4000, 3);
  const gtPts = samplePoints(gt, 5000, 2), shift = cen(gtPts).sub(cen(hullOnly)), objDiag = diag * FILL / height;
  const aligned = pts.map((q) => q.clone().add(shift)), outer = pts.filter((q) => Math.abs(exactField(q.x, q.y, q.z)) < 1.5).map((q) => q.clone().add(shift));
  const accuracy = chamfer(outer, gtPts).accuracy, completeness = chamfer(aligned, gtPts).completeness, ch = { accuracy, completeness, symmetric: (accuracy + completeness) / 2 };
  const unaligned = chamfer(pts, gtPts), hullChamfer = chamfer(hullOnly.map((q) => q.clone().add(shift)), gtPts);
  const modelRobust = buildModel(evidence, { colour: 'robust-median' }), meanOf = (m: typeof model) => { const e = heldViews.map((v) => photometricError(m, v, evidence)).filter((x) => Number.isFinite(x.meanAbsError)); return e.length ? round(e.reduce((a, b) => a + b.meanAbsError, 0) / e.length, 2) : null; };
  const photometric = { weightedMean: meanOf(model), robustMedian: meanOf(modelRobust) };
  const sha = await evidenceSha256(evidence), assess = assessReconstruction(planFromModel(model, sha, asset.id), model, sha);
  Object.assign(row, {
    status: 'reconstructed', views: evidence.views.length, parts: model.parts.length, triangles: model.parts.reduce((n, p) => n + p.indices.length / 3, 0), degraded: model.degraded,
    directionSign: sign, posesRefined: poses.applied, assumptions: evidence.assumptions.length,
    hullOnlyChamferPct: round((hullChamfer.symmetric / objDiag) * 100, 3), chamferPctAligned: round((ch.symmetric / objDiag) * 100, 3), accuracyPct: round((ch.accuracy / objDiag) * 100, 3), completenessPct: round((ch.completeness / objDiag) * 100, 3), chamferPctUnaligned: round((unaligned.symmetric / objDiag) * 100, 3),
    heldOutIoUMean: heldIoU.length ? round(heldIoU.reduce((a, b) => a + b, 0) / heldIoU.length) : null, heldOutViews: heldIoU.length,
    observedFraction: round(model.observedFraction), looIoUMean: model.heldOutIoU ? round(model.heldOutIoU.reduce((a, b) => a + b.iou, 0) / model.heldOutIoU.length) : null,
    photometricMeanAbsError: photometric, fidelityClass: assess.ledger.fidelity.class, computeMs: Math.round(ms),
  });
  results.push(row); console.log(asset.id, asset.split, JSON.stringify({ chamfer: row.chamferPctAligned, held: row.heldOutIoUMean, dir: sign, class: row.fidelityClass, refined: poses.applied }));
}
writeFileSync(resolve(argOut, 'product-results.json'), JSON.stringify({ generatedBy: 'scripts/benchmark/reality-product-eval.ts', note: 'Product path on perspective RENDERS of licensed 3D assets (automatic segmentation, assumed poses, elevation declared). Not photographs. Chamfer is % of the asset bounding-box diagonal with translation aligned (origin convention) and the known render scale.', fill: FILL, elevationDeg: ELEV, turntable: TURN, heldOutAzimuths: HELD, results }, null, 2) + '\n');
await browser.close(); await vite.close();
