// Browser proof for the V2 harness after the visual recovery (Chromium + SwiftShader). No paid call: the evaluator route is intercepted and counted.
//   npx tsx scripts/visual/write-fixtures.ts reports/visual-recovery/fixtures
//   npx vite --port 5192 &   UNFOLD_V2_E2E_URL=http://127.0.0.1:5192/universal-spatial-v2 node tests/e2e/universal-spatial-v2-visual.pw.mjs
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const url = process.env.UNFOLD_V2_E2E_URL ?? 'http://127.0.0.1:5192/universal-spatial-v2';
const out = resolve(process.env.UNFOLD_V2_EVIDENCE_DIR ?? 'reports/visual-recovery/e2e');
await mkdir(out, { recursive: true });
const engine = JSON.parse(await readFile(resolve('reports/visual-recovery/fixtures/jet-engine.json'), 'utf8'));
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const errors = []; page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message));
const settle = () => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 500)))));
const evaluations = []; const mockEvaluation = { contract: 'unfold.spatial-evaluation.v1', sessionId: '00000000-0000-4000-8000-000000000000', revision: 0, suggestionStatus: 'none', refinementBudget: { maximum: 1, used: 0 }, meta: { estimatedCostUsd: 0 }, evaluation: { contract: 'unfold.spatial-evaluation.v1', recognizabilityScore: 50, silhouetteScore: 50, spatialIntegrityScore: 50, confidence: 0.5, discrepancies: [], suggestedOperation: null, rationale: 'mock evaluator for the browser test' } };
await page.route('**/api/spatial/v2/evaluate', async (route) => { evaluations.push(JSON.parse(route.request().postData())); await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockEvaluation) }); });
const results = {};
try {
  await page.goto(url, { waitUntil: 'networkidle' }); await settle();
  await page.evaluate((payload) => window.unfoldLoadSpatialPlanV2(payload), engine); await settle();

  // 1. layout: the viewport is the stage, not a 150 px strip
  const boxes = await page.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); return { stage: r('.us-view'), canvas: r('#v2-canvas canvas') }; });
  assert.ok(boxes.canvas.height >= boxes.stage.height * 0.95, `canvas ${boxes.canvas.height}px inside a ${boxes.stage.height}px stage`);
  results.layout = { stageHeight: Math.round(boxes.stage.height), canvasHeight: Math.round(boxes.canvas.height) };

  // 2. framing and verified capture
  const verified = await page.evaluate(() => window.unfoldV2Debug.captureVerified());
  assert.equal(verified.verdict.ok, true, JSON.stringify(verified.verdict)); assert.ok(verified.analysis.extentFraction >= 0.85, `extent ${verified.analysis.extentFraction}`); assert.equal(verified.analysis.touchesEdge, false);
  results.framing = { extentFraction: +verified.analysis.extentFraction.toFixed(3), verdict: verified.verdict };
  await page.screenshot({ path: resolve(out, 'workspace-overview.png'), fullPage: true });

  // 3. selection, understanding and framing of one component
  const buttons = await page.locator('#v2-components button').count(); assert.ok(buttons >= 6);
  const wide = (await page.evaluate(() => window.unfoldV2Debug.stats())).cameraDistance;
  await page.locator('#v2-components button', { hasText: 'Fan blades' }).click(); await settle();
  assert.ok((await page.locator('#v2-detail').textContent()).includes('provenance'));
  await page.waitForFunction((d) => window.unfoldV2Debug.stats().cameraDistance < d * 0.8, wide, { timeout: 5000 });
  results.selection = { components: buttons, cameraDistanceBefore: +wide.toFixed(2), cameraDistanceAfter: +(await page.evaluate(() => window.unfoldV2Debug.stats())).cameraDistance.toFixed(2) };
  await page.screenshot({ path: resolve(out, 'selected-fan-blades.png') });

  // 4. modification: preview first, nothing changes until Apply; a human edit marks the value user_provided
  const before = await page.evaluate(() => JSON.parse(document.querySelector('#v2-detail').textContent).transform.scale);
  await page.locator('[data-edit="scale-up"]').click();
  assert.match(await page.locator('#v2-pending-text').textContent(), /scale/);
  assert.deepEqual(await page.evaluate(() => JSON.parse(document.querySelector('#v2-detail').textContent).transform.scale), before, 'preview must not change the plan');
  await page.locator('#v2-apply').click(); await settle();
  const after = await page.evaluate(() => JSON.parse(document.querySelector('#v2-detail').textContent));
  assert.ok(after.transform.scale[0] > before[0]); assert.equal(after.provenance.transform, 'user_provided');
  assert.equal(await page.locator('#v2-undo').isEnabled(), true);
  // a second edit now touches a confirmed value: refused without the authorisation tick
  await page.locator('[data-edit="x+"]').click(); await page.locator('#v2-apply').click();
  assert.match(await page.locator('#v2-status').textContent(), /authoris/i);
  await page.locator('#v2-auth').check(); await page.locator('#v2-apply').click(); await settle();
  assert.match(await page.locator('#v2-status').textContent(), /Applied/);
  await page.locator('#v2-undo').click(); await page.locator('#v2-undo').click(); await settle();
  assert.deepEqual(await page.evaluate(() => JSON.parse(document.querySelector('#v2-detail').textContent).transform.scale), before, 'undo restores the plan');
  results.modification = { previewDidNotChangePlan: true, provenanceAfterEdit: after.provenance.transform, authorisationRequiredForConfirmedValue: true, undo: true };

  // 5. assembly solver: a component moved away is found and re-attached through a typed operation
  const detached = structuredClone(engine); detached.plan.components.find((c) => c.id === 'pylon').transform.position = [0, 4.5, -0.14];
  await page.evaluate((payload) => window.unfoldLoadSpatialPlanV2(payload), detached); await settle();
  assert.match(await page.locator('#v2-assembly').textContent(), /pylon does not touch/);
  await page.locator('#v2-fix').click(); await settle();
  assert.match(await page.locator('#v2-status').textContent(), /closed 1 gap/);
  assert.doesNotMatch(await page.locator('#v2-assembly').textContent(), /does not touch/);
  results.solver = { found: 'pylon', corrected: true };

  // 6. paid-call guard: an empty/black capture never reaches the evaluator; a verified one does, with real pixels
  await page.evaluate((payload) => window.unfoldLoadSpatialPlanV2(payload), engine); await settle();
  await page.evaluate(() => window.unfoldV2Debug.setContentVisible(false)); await settle();
  await page.locator('#v2-evaluate').click(); await settle();
  assert.match(await page.locator('#v2-status').textContent(), /Capture rejected \(blank\)/); assert.equal(evaluations.length, 0, 'a blank capture must not be sent');
  await page.evaluate(() => window.unfoldV2Debug.setContentVisible(true)); await settle();
  // the realistic way to get an empty screen: construction reveal at step 0
  await page.locator('#v2-step').fill('0'); await settle();
  await page.locator('#v2-evaluate').click(); await settle();
  assert.match(await page.locator('#v2-status').textContent(), /Capture rejected \(blank\)/); assert.equal(evaluations.length, 0, 'an empty construction step must not be sent');
  await page.locator('#v2-step').fill(await page.locator('#v2-step').getAttribute('max')); await settle();
  await page.locator('#v2-evaluate').click(); await page.waitForFunction(() => document.querySelector('#v2-status').textContent.startsWith('Visual hypothesis'), null, { timeout: 15000 });
  assert.equal(evaluations.length, 1); assert.match(evaluations[0].imageDataUrl, /^data:image\/png;base64,/);
  const pixels = await page.evaluate(async (dataUrl) => { const img = new Image(); await new Promise((ok) => { img.onload = ok; img.src = dataUrl; }); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let sum = 0, sq = 0; const n = c.width * c.height; for (let i = 0; i < n; i++) { const l = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3; sum += l; sq += l * l; } const mean = sum / n; return { width: c.width, height: c.height, meanLuma: mean, stdLuma: Math.sqrt(sq / n - mean * mean) }; }, evaluations[0].imageDataUrl);
  assert.ok(pixels.meanLuma > 15 && pixels.stdLuma > 15, `evaluator image looks empty: ${JSON.stringify(pixels)}`);
  results.paidCallGuard = { blankRejectedBeforeSend: true, sentCaptures: evaluations.length, sentImage: { ...pixels, meanLuma: +pixels.meanLuma.toFixed(1), stdLuma: +pixels.stdLuma.toFixed(1) } };

  assert.deepEqual(errors, [], 'browser console must stay clean'); results.consoleErrors = errors;
  await writeFile(resolve(out, 'e2e-result.json'), `${JSON.stringify({ browser: 'Chromium + SwiftShader', viewport: '1440x1000', url, fixture: 'hand-authored jet-engine (not Meta output)', ...results }, null, 2)}\n`);
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
