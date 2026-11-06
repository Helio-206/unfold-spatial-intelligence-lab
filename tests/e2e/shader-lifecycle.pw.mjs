import { chromium } from 'playwright-core';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const base = process.env.UNFOLD_SPACE_URL ?? 'http://127.0.0.1:5195';
const out = process.env.UNFOLD_RCA_OUT ?? '/tmp/unfold-shader-lifecycle';
await mkdir(out, { recursive: true });
const reply = JSON.parse(await readFile('reports/universal-spatial-v2/evidence/blind-harp-plan.json', 'utf8'));
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
try {
  await page.route('**/api/spatial/v2/plan', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply) }));
  await page.goto(`${base}/living?debug-living&rm=1`, { waitUntil: 'networkidle' });
  await page.click('[data-space="open"]'); await page.fill('#sp-text', 'Plano guardado reproduzido localmente.'); await page.click('[data-sp="submit"]');
  await page.waitForSelector('.sp-root[data-phase="review"]'); await page.click('[data-sp="keep-all"]'); await page.check('#sp-ack'); await page.click('[data-sp="build"]');
  await page.waitForFunction(() => window.__workspace.spaceActive && !window.__space.layer.isBusy && (window.__space.layer.geometryReport?.pending.length ?? 0) === 0, null, { timeout: 30000 });
  const records = [];
  const snapshot = () => { const s = window.__workspace.stats(); return { geometries: s.geometries, textures: s.textures, programs: s.programs, heapBytes: performance.memory?.usedJSHeapSize ?? null }; };
  await page.evaluate(() => { window.__testPlan = structuredClone(window.__space.layer.currentPlan); window.__space.dropScene(); window.__workspace.renderNow(); });
  const baseline = await page.evaluate(snapshot);
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => window.__space.show(window.__testPlan, false));
    await page.waitForFunction(() => window.__workspace.spaceActive && !window.__space.layer.isBusy && (window.__space.layer.geometryReport?.pending.length ?? 0) === 0, null, { timeout: 30000 });
    const active = await page.evaluate(async () => {
      const w = window.__workspace, l = window.__space.layer; w.select('harp-neck'); l.attachSync(null);
      l.proposeEdit('x+'); l.authorise(true); await l.applyEdit(); w.renderNow();
      if (!await l.undo()) throw new Error('undo failed'); w.renderNow();
      const s = w.stats();
      return { geometries: s.geometries, textures: s.textures, programs: s.programs, heapBytes: performance.memory?.usedJSHeapSize ?? null, selected: w.selectedSpaceId, layerSelected: l.selectedId, geometryBytes: l.stats.geometryBytes };
    });
    assert.equal(active.selected, 'harp-neck'); assert.equal(active.layerSelected, 'harp-neck');
    await page.evaluate(() => { window.__space.dropScene(); window.__workspace.renderNow(); });
    const closed = await page.evaluate(snapshot); records.push({ i, active, closed });
    assert.ok(closed.geometries <= baseline.geometries + 2 && closed.textures <= baseline.textures + 2, `resources after close: ${JSON.stringify({ baseline, closed })}`);
  }
  assert.deepEqual(errors, []);
  await writeFile(`${out}/lifecycle.json`, JSON.stringify({ baseline, records, errors }, null, 2));
  console.log(JSON.stringify({ baseline, records, errors }));
} finally { await page.close(); await browser.close(); }
