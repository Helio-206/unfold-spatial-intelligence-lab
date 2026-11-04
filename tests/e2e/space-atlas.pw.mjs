// Anatomy as a provider of Space: the educational heart atlas on the same /living stage. No Meta call.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const base = process.env.UNFOLD_SPACE_URL ?? 'http://127.0.0.1:5191';
const out = resolve(process.env.UNFOLD_SPACE_OUT ?? 'reports/space-integration/runs/atlas');
const viewport = { width: Number(process.env.UNFOLD_SPACE_W ?? 1440), height: Number(process.env.UNFOLD_SPACE_H ?? 900) };
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
const errors = [], apiCalls = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
page.on('request', (r) => { if (r.url().includes('/api/')) apiCalls.push(`${r.method()} ${new URL(r.url()).pathname}`); });
const shot = async (name) => { await page.waitForTimeout(600); await page.screenshot({ path: resolve(out, `${name}.png`) }); return `${name}.png`; };
const steps = {};
try {
  await page.goto(`${base}/living?debug-living&rm=1`, { waitUntil: 'networkidle' });
  const gpuBefore = await page.evaluate(() => { const s = window.__workspace.stats(); return { geometries: s.geometries, textures: s.textures }; });
  await page.click('[data-space="open"]'); await page.waitForSelector('[data-sp="atlas"]');
  steps.intake = await shot('01-intake-with-atlas');
  await page.click('[data-sp="atlas"]');
  await page.waitForFunction(() => window.__workspace.spaceActive && window.__space.atlas, null, { timeout: 60000 });
  await page.waitForTimeout(800);
  steps.atlas = await shot('02-atlas');
  const text = await page.evaluate(() => document.body.innerText);
  assert.match(text, /Atlas educativo de referência/); assert.match(text, /não é clínico/);
  // selection by real pointer picks
  const box = await page.locator('[data-el="stage"]').boundingBox(); const picked = new Set();
  for (let gy = 0; gy < 9 && picked.size < 3; gy++) for (let gx = 0; gx < 13 && picked.size < 3; gx++) {
    await page.mouse.click(box.x + box.width * (0.25 + gx * 0.04), box.y + box.height * (0.2 + gy * 0.07));
    const id = await page.evaluate(() => window.__workspace.selectedSpaceId); if (id) picked.add(id);
  }
  assert.ok(picked.size >= 2, `structures must be selectable by pointer, got ${picked.size}`);
  steps.selected = await shot('03-selected');
  assert.match(await page.locator('[data-el="inspector"]').innerText(), /atlas educativo/);
  await page.click('[data-el="toolIsolate"]'); await page.waitForTimeout(500); steps.isolated = await shot('04-isolated'); await page.click('[data-el="toolIsolate"]');
  await page.click('[data-el="toolExplode"]'); await page.waitForFunction(() => !window.__space.atlas.animating, null, { timeout: 60000 });
  assert.equal(await page.evaluate(() => window.__space.atlas.isExploded), true);
  const spread = await page.evaluate(() => { const b = window.__space.atlas.box(); return b.getSize(b.max.clone()).length(); });
  assert.ok(spread > 9.5, `the exploded view really spreads the structures (${spread.toFixed(2)})`);
  assert.match(await page.evaluate(() => document.body.innerText), /Vista explodida/);
  steps.exploded = await shot('05-exploded');
  await page.click('[data-el="toolExplode"]'); await page.waitForFunction(() => !window.__space.atlas.animating, null, { timeout: 60000 });
  // no editing affordance on a reference model
  assert.equal(await page.locator('[data-edit]').count(), 0);
  // leave: back to the lab, resources freed
  await page.click('[data-extra="space-exit"]'); await page.waitForSelector('[data-space="open"]');
  assert.equal(await page.evaluate(() => window.__workspace.spaceActive), false);
  const gpuAfter = await page.evaluate(() => { window.__workspace.renderNow(); const s = window.__workspace.stats(); return { geometries: s.geometries, textures: s.textures }; });
  assert.ok(gpuAfter.geometries <= gpuBefore.geometries + 2 && gpuAfter.textures <= gpuBefore.textures + 2, JSON.stringify({ gpuBefore, gpuAfter }));
  steps.back = await shot('06-back');
  assert.deepEqual(apiCalls.filter((c) => c.includes('/api/spatial') || c.includes('/api/anatomy')), [], 'the atlas makes no model call');
  assert.deepEqual(errors, [], 'console must stay clean');
  await writeFile(resolve(out, 'e2e-result.json'), `${JSON.stringify({ viewport, picked: [...picked], gpu: { before: gpuBefore, after: gpuAfter }, apiCalls, consoleErrors: errors, screenshots: steps, at: new Date().toISOString() }, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, picked: [...picked] }));
} catch (error) { await shot('zz-failure').catch(() => {}); console.error(error); console.error('console errors:', errors); process.exitCode = 1; }
finally { await browser.close(); }
