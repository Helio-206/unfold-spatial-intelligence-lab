// Photoreal comparison harness: identical geometry, identical flow, renderer flag off vs on.
// Spawns its own backend + Vite. Only the paid plan route is simulated; adopt/edits use the real server.
// Run: node tests/e2e/photoreal-living.pw.mjs
import { spawn } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const backendPort = 8901, webPort = 5304;
const out = process.env.UNFOLD_PHOTOREAL_OUT ?? `/tmp/unfold-photoreal-${process.pid}`; await mkdir(out, { recursive: true });
const children = [];
const start = (command, args, env, name) => { const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }); child.stderr.on('data', (d) => process.stderr.write(`[${name}] ${d}`)); children.push(child); return child; };
const waitFor = async (url, timeoutMs = 30_000) => { const deadline = Date.now() + timeoutMs; for (;;) { try { const r = await fetch(url); if (r.ok) return; } catch { /* up yet */ } if (Date.now() > deadline) throw new Error(`timeout waiting for ${url}`); await new Promise((r) => setTimeout(r, 250)); } };

let browser;
const statsOf = async (page, buffer) => page.evaluate(async (dataUrl) => {
  const img = new Image(); img.src = dataUrl; await img.decode();
  const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 100;
  const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, 160, 100);
  const data = ctx.getImageData(0, 0, 160, 100).data;
  let mean = 0, sat = 0, n = 0;
  for (let i = 0; i < data.length; i += 16) { const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255; mean += (r + g + b) / 3; sat += Math.max(r, g, b) - Math.min(r, g, b); n++; }
  let variance = 0; const m = mean / n;
  for (let i = 0; i < data.length; i += 16) { const v = (data[i] + data[i + 1] + data[i + 2]) / (3 * 255); variance += (v - m) ** 2; }
  return { mean: Number(m.toFixed(4)), std: Number(Math.sqrt(variance / n).toFixed(4)), saturation: Number((sat / n).toFixed(4)) };
}, `data:image/png;base64,${buffer.toString('base64')}`);

try {
  start('./node_modules/.bin/tsx', ['server/index.ts'], { UNFOLD_BACKEND_PORT: String(backendPort), UNFOLD_LOCAL_TOKEN_FILE: `${out}/local-token`, UNFOLD_ACCEPTANCE_BUDGET_FILE: `${out}/budget.json`, UNFOLD_REVIEW_STORE_FILE: `${out}/reviews.json`, UNFOLD_SESSION_STORE_FILE: `${out}/sessions.json`, UNFOLD_LOCAL_ORIGINS: `http://127.0.0.1:${webPort}`, MODEL_API_KEY: '' }, 'backend');
  start('./node_modules/.bin/vite', ['--host', '127.0.0.1', '--port', String(webPort)], { UNFOLD_API_TARGET: `http://127.0.0.1:${backendPort}` }, 'vite');
  await waitFor(`http://127.0.0.1:${backendPort}/api/health`);
  await waitFor(`http://127.0.0.1:${webPort}/living`);
  const { createHash } = await import('node:crypto');
  const input = JSON.parse(await readFile('reports/fidelity-v4/hierarchical/plans/excavator-input.json', 'utf8'));
  input.plan.source = { kind: 'text', sha256: createHash('sha256').update('Experiência local photoreal com servidor real.', 'utf8').digest('hex') };
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

  const build = async (photoreal) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/api/spatial/v2/plan', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(input) }));
    await page.goto(`http://127.0.0.1:${webPort}/living?debug-living&experimental-v4&experimental-foundry${photoreal ? '&experimental-photoreal' : ''}&rm=1`, { waitUntil: 'networkidle' });
    await page.click('[data-space="open"]'); await page.fill('#sp-text', 'Experiência local photoreal com servidor real.'); await page.click('[data-sp="submit"]');
    await page.waitForSelector('.sp-root[data-phase="review"]'); await page.click('[data-sp="keep-all"]'); await page.check('#sp-ack'); await page.click('[data-sp="build"]');
    await page.waitForFunction(() => window.__space.session && window.__space.layer && !window.__space.layer.isBusy, null, { timeout: 40_000 });
    await page.waitForFunction(() => (window.__space.layer.geometryReport?.perFamily?.universal_foundry?.components ?? 0) > 0, null, { timeout: 40_000 });
    if (photoreal) await page.waitForFunction(() => window.__photoreal?.active(), null, { timeout: 20_000 });
    // Identical comparison setup on both sides: drain geometry upgrades, settle the presentation,
    // then frame and render in the same call.
    await page.evaluate(() => { const layer = window.__space.layer; for (let i = 0; i < 60; i++) layer.upgradeGeometry(60_000); layer.settle(); });
    await page.waitForFunction(() => window.__space.layer.geometryReport?.pending?.length === 0, null, { timeout: 40_000 });
    await page.evaluate(() => { window.__workspace.frameAll(); window.__workspace.renderNow(); });
    await page.waitForTimeout(600);
    return { page, errors };
  };

  const before = await build(false);
  const beforeShot = await before.page.screenshot({ path: `${out}/before-stock.png` });
  const beforeStats = await statsOf(before.page, beforeShot);
  assert.deepEqual(before.errors, []);
  await before.page.close();

  const after = await build(true);
  const stageStats = await after.page.evaluate(() => window.__photoreal.stage()?.stats());
  assert.ok(stageStats, 'photoreal stage applied');
  const afterShot = await after.page.screenshot({ path: `${out}/after-photoreal.png` });
  const afterStats = await statsOf(after.page, afterShot);
  assert.notDeepEqual(afterStats, beforeStats, 'the photoreal path must visibly change the render');

  // Interactions survive: selection, an authorised local edit through the real session, undo.
  const interaction = await after.page.evaluate(async () => {
    const flow = window.__space, layer = flow.layer, workspace = window.__workspace;
    const id = layer.currentPlan.components[0].id;
    workspace.select(id);
    const beforePlan = JSON.stringify(layer.currentPlan);
    layer.highlight(id); layer.proposeEdit('x+'); await layer.applyEdit();
    const moved = JSON.stringify(layer.currentPlan) !== beforePlan;
    const undone = await layer.undo();
    return { selected: workspace.selectedSpaceId ?? id, moved, undone, restored: JSON.stringify(layer.currentPlan) === beforePlan, revision: flow.session.revision };
  });
  assert.equal(interaction.moved, true);
  assert.equal(interaction.undone, true);
  assert.equal(interaction.restored, true);

  // Neutral material spheres with the module's own BRDF (reference material, same stage).
  await after.page.evaluate(async () => {
    const { SphereGeometry, Mesh, Group } = await import('/node_modules/three/build/three.module.js').catch(() => import('three'));
    const { createReferenceMaterial } = await import('/src/living/photoreal/reference-material.ts');
    const stage = window.__workspace.photorealStage();
    const lights = [{ direction: [-0.5, 0.8, 0.6], color: '#fff1de', intensity: 3 }, { direction: [0.7, 0.3, -0.6], color: '#d6e4ff', intensity: 1.2 }];
    const group = new Group(); group.name = 'photoreal-reference-spheres';
    const kinds = [{ albedo: '#c8c9cc', metallic: 1, roughness: 0.25 }, { albedo: '#8a2f23', metallic: 0, roughness: 0.45 }, { albedo: '#d8d8d8', metallic: 0, roughness: 0.9 }];
    kinds.forEach((kind, i) => { const sphere = new Mesh(new SphereGeometry(0.55, 48, 32), createReferenceMaterial({ ...kind, lights })); sphere.position.set((i - 1) * 1.4, 0, 6); group.add(sphere); });
    stage.scene.add(group);
    window.__workspace.renderNow();
  });
  await after.page.waitForTimeout(400);
  await after.page.screenshot({ path: `${out}/material-spheres.png` });
  assert.deepEqual(after.errors, []);
  process.stdout.write(`${JSON.stringify({ case: 'photoreal-living', softwareRendering: true, beforeStats, afterStats, stageStats, interaction, errors: after.errors }, null, 2)}\n`);
  await after.page.close();
} finally {
  await browser?.close().catch(() => {});
  for (const child of children) child.kill('SIGTERM');
}
