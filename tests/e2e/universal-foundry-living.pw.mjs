// The Universal Foundry in the REAL /living workspace (experimental flag), several unrelated categories, same page and camera for V3 (default) and Foundry.
// Plans are served from files through the plan endpoint (no Meta call). Flow per object: text/picture -> review -> build -> Foundry geometry -> select/isolate ->
// parameter change -> coherent regeneration -> save -> reopen.   npx vite --port 5301 &   node tests/e2e/universal-foundry-living.pw.mjs
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';

const host = process.env.UNFOLD_SPACE_URL ?? 'http://127.0.0.1:5301', out = process.env.UVF_OUT ?? 'reports/product-integration/uvf/living', dir = 'reports/product-integration/uvf/plans';
const cases = (process.env.UVF_CASES ?? 'hatchback,sofa,washer,pavilion,apple,wrench,monitor,miniExcavator').split(',');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const results = [];
async function open(name, flag) {
  const reply = JSON.parse(await readFile(`${dir}/${name}.json`, 'utf8')), page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = []; page.errors = errors;
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route('**/api/spatial/v2/plan', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply) }));
  await page.route('**/api/spatial/v2/adopt', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await page.goto(`${host}/living?debug-living&rm=1${flag ? '&experimental-foundry' : ''}`, { waitUntil: 'networkidle' });
  await page.click('[data-space="open"]'); await page.fill('#sp-text', 'Plano grosseiro servido de ficheiro (sem chamada à Meta).'); await page.click('[data-sp="submit"]');
  await page.waitForSelector('.sp-root[data-phase="review"]'); await page.click('[data-sp="keep-all"]'); await page.check('#sp-ack'); await page.click('[data-sp="build"]'); await page.waitForFunction(() => window.__workspace.spaceActive);
  const t0 = Date.now(); await page.waitForFunction(() => { const l = window.__space.layer; return l && !(l.geometryReport?.pending?.length); }, null, { timeout: 60000 }); const ms = Date.now() - t0; await page.waitForTimeout(1500);
  await page.evaluate(() => { const w = window.__workspace, h = w.director.homeView(); window.__home = { target: h.target.clone(), azimuth: h.azimuth, elevation: h.elevation, distance: h.distance }; });
  return { page, ms };
}
const shoot = async (page, name) => { await page.evaluate(() => { const w = window.__workspace; w.clearSelection(); w.director.jumpTo(window.__home); }); await page.waitForTimeout(900); await page.screenshot({ path: `${out}/${name}.png` }); };
const stats = (page) => page.evaluate(() => { const l = window.__space.layer, s = window.__workspace.stats?.(); const fam = {}; for (const d of l.geometryReport?.decisions ?? []) fam[d.used] = (fam[d.used] ?? 0) + 1; return { tri: l.stats.triangleCount, meshes: l.stats.meshCount, families: fam, gpu: s && { geometries: s.geometries, textures: s.textures, programs: s.programs }, ids: l.currentPlan.components.map((c) => c.id), plan: JSON.stringify(l.currentPlan) }; });
const recounted = (page) => page.evaluate(() => { let tri = 0, meshes = 0; window.__space.layer.root.traverse((o) => { if (o.isMesh) { meshes++; const g = o.geometry; tri += (g.index ? g.index.count : g.attributes.position.count) / 3; } }); return { tri: Math.round(tri), meshes }; });

for (const name of cases) {
  const row = { name };
  { const { page } = await open(name, false); row.v3 = await stats(page); row.v3.count = await recounted(page); await shoot(page, `${name}-1-v3-default`); assert.deepEqual(page.errors, []); await page.close(); }
  const { page, ms } = await open(name, true); row.buildToReadyMs = ms;
  const s = await stats(page), c = await recounted(page); row.foundry = { ...s, count: c, plan: undefined };
  assert.equal(s.plan, row.v3.plan, 'the Foundry must not change the plan'); assert.ok(s.families.universal_foundry > 0, 'no component was built by the Foundry'); assert.ok(c.tri > row.v3.count.tri, 'Foundry geometry should be richer than V3');
  await shoot(page, `${name}-2-foundry`);
  // selection / isolation / focus on the first component
  const id = s.ids[0]; await page.evaluate((i) => window.__workspace.select(i), id); await page.waitForTimeout(500); assert.equal(await page.evaluate(() => window.__workspace.selectedSpaceId), id);
  await page.evaluate((i) => window.__space.layer.isolate(i), id); await page.waitForTimeout(500); await page.screenshot({ path: `${out}/${name}-3-isolated.png` }); await page.evaluate(() => window.__space.layer.isolate(null));
  // parameter change from the panel: first numeric param moved to its max; geometry regenerates from the same plan
  const before = await recounted(page), changed = await page.evaluate(() => { const f = window.__foundry3d, spec = f.specs.find((p) => p.type === 'number' && p.max > p.default) ?? f.specs[0]; if (!spec) return null; const l = window.__space.layer; f.set(l.currentPlan, { [spec.key]: spec.type === 'number' ? spec.max : spec.type === 'choice' ? spec.options.find((o) => o !== spec.default) : !spec.default }); l.regenerate(); return spec.key; });
  if (changed) { await page.waitForFunction(() => !window.__space.layer.geometryReport?.pending?.length, null, { timeout: 60000 }); await page.waitForTimeout(1200); const after = await recounted(page); row.regeneration = { param: changed, before, after }; await shoot(page, `${name}-4-regenerated`); const s2 = await stats(page); assert.equal(s2.plan, row.v3.plan, 'regeneration changed the plan'); assert.deepEqual(s2.ids, s.ids); }
  row.panelVisible = await page.evaluate(() => { const el = document.querySelector('[data-foundry-panel]'); return !!el && el.style.display !== 'none' && el.textContent.length > 20; });
  // save and reopen: the same parameters come back
  await page.evaluate(() => localStorage.setItem('unfold.keep', '1')); await page.click('[data-extra="space-save"]'); await page.waitForTimeout(600);
  await page.click('[data-extra="space-library"]'); await page.waitForSelector('.sp-root[data-phase="library"]'); await page.click('[data-sp-open]'); await page.waitForFunction(() => window.__workspace.spaceActive); await page.waitForFunction(() => !window.__space.layer.geometryReport?.pending?.length, null, { timeout: 60000 }); await page.waitForTimeout(1200);
  const re = await recounted(page); row.reopened = { count: re, sameTriangles: !changed || Math.abs(re.tri - (row.regeneration?.after.tri ?? re.tri)) < 1 }; await shoot(page, `${name}-5-reopened`);
  assert.ok(row.reopened.sameTriangles, 'reopened Space lost its parameters');
  row.gpuAfter = (await stats(page)).gpu; row.errors = page.errors; assert.deepEqual(page.errors, []); await page.close(); results.push(row); console.log('ok', name, JSON.stringify({ v3: row.v3.count, foundry: c, ms }));
}
await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2)); await browser.close();
