// Product-path evaluation of the Reality Engine against independent 3D ground truth.
// Input = textured, lit PERSPECTIVE renders of licensed assets on a plain background (rendered in Chromium), segmented AUTOMATICALLY by the product's
// intake, poses ASSUMED (equal turntable steps, direction chosen by evidence, elevation declared), refined by the product's pose gate, reconstructed by the
// product's model. Reported against the 3D asset (Chamfer, translation-aligned), against held-out renders (silhouette IoU) and per category/split.
// These are renders, not photographs. Run: npx tsx scripts/benchmark/reality-product-eval.ts [outDir] [--assets A,B]
import { createHash } from 'node:crypto';
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
import { buildModel, partGeometry, viewsOf } from '../../src/living/reality/model';
import { assessReconstruction } from '../../src/living/reality/assessment';
import { planFromModel } from '../../src/living/reality/plan';
import { evidenceSha256 } from '../../src/living/reality/evidence';

const argOut = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'reports/reality-engine/benchmark/product-results';
const only = process.argv.includes('--assets') ? process.argv[process.argv.indexOf('--assets') + 1]!.split(',') : null;
mkdirSync(resolve(argOut), { recursive: true });
const manifest = JSON.parse(readFileSync(resolve('reports/reality-engine/benchmark/manifest.json'), 'utf8')) as { assets: Array<{ id: string; kind: string; category: string; split: string; sha256: string }> };
const FILL = 0.55, ELEV = 20, TURN = Array.from({ length: 8 }, (_, i) => i * 45), HELD = [22.5, 112.5, 202.5, 292.5];
const round = (n: number, d = 4) => +n.toFixed(d);
const iou = (a: Uint8Array, b: Uint8Array) => { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { i += a[k]! & b[k]!; u += a[k]! | b[k]!; } return u ? i / u : 1; };

const vite = await createServer({ server: { host: '127.0.0.1', port: 5398, strictPort: true }, logLevel: 'error' }); await vite.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 500, height: 400 } });
await page.goto('http://127.0.0.1:5398/scripts/benchmark/reality-render.html');
await page.waitForFunction(() => (window as never as { __renderReady?: boolean }).__renderReady === true, null, { timeout: 60_000 });
const renderRaw = async (id: string, az: number[]): Promise<IntakeImage[]> => {
  const r = await page.evaluate(([url, a, elev, fill]) => (window as never as { __renderRaw: (u: string, a: number[], o: object) => Promise<{ width: number; height: number; rgba: string[] }> }).__renderRaw(url as string, a as number[], { width: 480, height: 360, elevationDeg: elev as number, fill: fill as number }), [`/reports/reality-engine/benchmark/assets/${id}/${id}.glb`, az, ELEV, FILL] as const);
  return r.rgba.map((b64, i) => ({ name: `${id}-${az[i]}.png`, rgba: { width: r.width, height: r.height, data: new Uint8ClampedArray(Buffer.from(b64, 'base64')) } }));
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
  const photos = await renderRaw(asset.id, TURN), held = await renderRaw(asset.id, HELD);
  const t0 = performance.now(), intake = intakeOrbit(photos, { elevationDeg: ELEV });
  if (!intake.evidence) { row.status = 'refused'; row.refusals = intake.refusals.map((r) => `${r.code}${r.viewName ? ` (${r.viewName})` : ''}`); row.reliability = intake.views.map((v) => ({ name: v.name, reliable: v.reliable, reasons: v.reasons })); results.push(row); console.log(asset.id, 'REFUSED', row.refusals); continue; }
  const poses = refinePosesOf(intake.evidence), evidence = poses.applied ? poses.evidence : intake.evidence, model = buildModel(evidence), ms = performance.now() - t0;
  const sign = Math.sign(evidence.views[1]!.azimuthDeg / (TURN[1]! || 1)) || 1;
  // held-out renders segmented automatically and framed like the originals; the pose of a held-out render follows the reconstruction's own direction
  const heldIoU: number[] = [];
  for (let i = 0; i < held.length; i++) {
    const added = intakeAddView(evidence, held[i]!, { azimuthDeg: sign * HELD[i]!, elevationDeg: ELEV }); if (!added.evidence) continue;
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
  const sha = await evidenceSha256(evidence), assess = assessReconstruction(planFromModel(model, sha, asset.id), model, sha);
  Object.assign(row, {
    status: 'reconstructed', views: evidence.views.length, parts: model.parts.length, triangles: model.parts.reduce((n, p) => n + p.indices.length / 3, 0), degraded: model.degraded,
    directionSign: sign, posesRefined: poses.applied, assumptions: evidence.assumptions.length,
    hullOnlyChamferPct: round((hullChamfer.symmetric / objDiag) * 100, 3), chamferPctAligned: round((ch.symmetric / objDiag) * 100, 3), accuracyPct: round((ch.accuracy / objDiag) * 100, 3), completenessPct: round((ch.completeness / objDiag) * 100, 3), chamferPctUnaligned: round((unaligned.symmetric / objDiag) * 100, 3),
    heldOutIoUMean: heldIoU.length ? round(heldIoU.reduce((a, b) => a + b, 0) / heldIoU.length) : null, heldOutViews: heldIoU.length,
    observedFraction: round(model.observedFraction), looIoUMean: model.heldOutIoU ? round(model.heldOutIoU.reduce((a, b) => a + b.iou, 0) / model.heldOutIoU.length) : null,
    fidelityClass: assess.ledger.fidelity.class, computeMs: Math.round(ms),
  });
  results.push(row); console.log(asset.id, asset.split, JSON.stringify({ chamfer: row.chamferPctAligned, held: row.heldOutIoUMean, dir: sign, class: row.fidelityClass, refined: poses.applied }));
}
writeFileSync(resolve(argOut, 'product-results.json'), JSON.stringify({ generatedBy: 'scripts/benchmark/reality-product-eval.ts', note: 'Product path on perspective RENDERS of licensed 3D assets (automatic segmentation, assumed poses, elevation declared). Not photographs. Chamfer is % of the asset bounding-box diagonal with translation aligned (origin convention) and the known render scale.', fill: FILL, elevationDeg: ELEV, turntable: TURN, heldOutAzimuths: HELD, results }, null, 2) + '\n');
await browser.close(); await vite.close();
