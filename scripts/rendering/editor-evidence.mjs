// Evidence from the REAL editor (Chrome + SwiftShader, no GPU): same scenes and cameras on `main` ("before") and on this branch ("after").
//   node scripts/rendering/editor-evidence.mjs <label: before|after> <baseUrl> <outDir> <seedsDir> [plan.png]
// "after" also records the lifecycle/benchmark/export/consistency numbers through the ?debug-rendering hook.
// Scenes: two-rooms, multi-room, provisional = SYNTHETIC fixtures (src/rendering/fixtures.ts) restored from localStorage;
//         real-sample-1 = the real plan (.local-fixtures/sample-1.png, if present), run through the editor's own detect/calibrate/build.
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [label, BASE, OUTARG, SEEDS, PLAN] = process.argv.slice(2);
const OUT = resolve(OUTARG); const RAW = join(OUT, 'raw'); const EXPORTS = join(OUT, 'exports');
mkdirSync(RAW, { recursive: true }); mkdirSync(EXPORTS, { recursive: true });
const after = label === 'after';
const debug = after ? '?debug-rendering' : '';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const evidence = { label, base: BASE, at: new Date().toISOString(), renderer: null, scenes: {} };
const HIDE = '.spatial-toolbar,.view-controls,.spatial-status,.spatial-metrics,.demo-command,.demo-command-feedback,.demo-quick-actions,.demo-tools,.demo-conversation,#export-card,#export-menu,.removal-card{visibility:hidden!important}';
const wait = (page, ms) => page.waitForTimeout(ms);
const R = (page, fn, arg) => page.evaluate(`(${fn})(window.__unfoldRendering, ${JSON.stringify(arg ?? null)})`);
const domClick = (page, sel) => page.$eval(sel, (e) => e.click());

async function newPage() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage(); page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errors.push(m.text()); });
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: 'null' }));
  return page;
}
async function openSeed(name) {
  const page = await newPage();
  await page.goto(`${BASE}/demo${debug}`); await page.waitForSelector('#demo-open-spatial');
  await page.evaluate((s) => localStorage.setItem('unfold-spatial-scene.v1', s), readFileSync(join(SEEDS, `${name}.json`), 'utf8'));
  await page.click('#demo-open-spatial'); await page.waitForSelector('#component-list [data-scene-node]', { state: 'attached', timeout: 30000 });
  if (after) await page.waitForFunction(() => window.__unfoldRendering);
  await wait(page, 1500); return page;
}
async function openRealPlan() {
  const page = await newPage();
  await page.goto(`${BASE}/spatial-editor${debug}`, { waitUntil: 'networkidle' }); await wait(page, 1200);
  await page.setInputFiles('#plan-file', PLAN);
  await page.waitForFunction(() => !document.querySelector('#plan-workflow').hidden && document.querySelector('#source-image').naturalWidth);
  await page.click('#detect-lines');
  await page.waitForFunction(() => document.querySelectorAll('#candidate-list [data-candidate]').length > 0);
  await page.evaluate(() => document.querySelectorAll('details.workflow-section').forEach((d) => (d.open = true)));
  await page.click('#scale-mode'); await page.locator('#plan-overlay').scrollIntoViewIfNeeded();
  const box = await page.locator('#plan-overlay').boundingBox();
  const size = await page.evaluate(() => ({ w: document.querySelector('#source-image').naturalWidth, h: document.querySelector('#source-image').naturalHeight }));
  const at = (x, y) => ({ x: box.x + (x / size.w) * box.width, y: box.y + (y / size.h) * box.height });
  for (const p of [at(250.67, 50), at(721, 50)]) await page.mouse.click(p.x, p.y);
  const set = (sel, v) => page.evaluate(([s, val]) => { const e = document.querySelector(s); e.value = val; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, [sel, v]);
  await set('#scale-distance', '6.0'); await set('#wall-height', '2.7'); await set('#wall-thickness', '0.15');
  await set('#scale-evidence', 'Largura do Balcony = 6,0 m, introduzida por uma pessoa nesta medição (não está impressa na planta).');
  const n = await page.evaluate(() => document.querySelectorAll('#region-list [data-region]').length);
  for (let i = 0; i < n; i += 1) { await page.evaluate((k) => document.querySelectorAll('#region-list [data-region]')[k]?.click(), i); await wait(page, 60); }
  await page.click('#build-scene');
  await page.waitForFunction(() => document.querySelector('#app').dataset.state === 'ready', null, { timeout: 30000 });
  if (after) await page.waitForFunction(() => window.__unfoldRendering);
  await wait(page, 12000); // the editor's build-in animation staggers every wall; capture only after it ends
  return page;
}
async function setQuality(page, quality) {
  if (!after) return null;
  const ms = await page.evaluate((q) => { const t = performance.now(); document.querySelector(`#quality-${q}`).click(); return performance.now() - t; }, quality);
  await wait(page, 900); return ms;
}
const shot = async (page, file) => { await page.screenshot({ path: file, clip: { x: 384, y: 100, width: 1040, height: 788 } }); };

async function views(page, scene, kind) {
  const list = [['iso', async () => { await domClick(page, '#iso-view'); await wait(page, 1600); }], ['top', async () => { await domClick(page, '#top-view'); await wait(page, 1600); }]];
  if (after) {
    const b = await R(page, (r) => r.bounds());
    const cx = (b.min[0] + b.max[0]) / 2; const cz = (b.min[2] + b.max[2]) / 2;
    const go = async (position, target) => { await R(page, (r, a) => r.view(a.position, a.target), { position, target }); await wait(page, 700); };
    list.push(['interior', () => go([b.min[0] + 1.3, 1.6, cz], [b.min[0] + 6, 1.2, cz])]);
    list.push(['material-detail', () => go([b.min[0] - 2.4, 1.9, b.min[2] - 2.4], [b.min[0], 1.2, b.min[2]])]);
    if (kind === 'fixture') for (const [id, name] of [['door-1', 'door-detail'], ['win-1', 'window-detail']]) {
      list.push([name, async () => {
        const n = await R(page, (r, i) => r.nodePosition(i), id); if (!n) return;
        const axis = n.size[0] < n.size[2] ? 0 : 2; const position = [...n.center]; position[axis] += 2.6; position[1] = n.center[1] + 0.3;
        await go(position, n.center);
      }]);
    }
  }
  for (const [name, run] of list) {
    await run();
    for (const quality of after ? ['technical', 'presentation'] : ['before']) {
      if (after) await setQuality(page, quality);
      const hide = await page.addStyleTag({ content: HIDE });
      await shot(page, join(RAW, `${label}__${quality}__${scene}__${name}.png`));
      await hide.evaluate((e) => e.remove());
    }
    if (after) await setQuality(page, 'technical');
  }
}

try {
  const scenes = [['two-rooms', 'fixture'], ['multi-room', 'fixture'], ['provisional', 'fixture']];
  for (const [scene, kind] of process.env.ONLY === 'real' ? [] : scenes) {
    const page = await openSeed(scene);
    await views(page, scene, kind);
    evidence.scenes[scene] = { kind: 'synthetic fixture', errors: page.errors };
    if (after && scene === 'multi-room') await measure(page, scene);
    if (after && scene === 'multi-room') await exports(page);
    await page.context().close();
  }
  if (PLAN && existsSync(PLAN)) {
    const page = await openRealPlan();
    await views(page, 'real-sample-1', 'real');
    evidence.scenes['real-sample-1'] = { kind: 'real plan through the editor pipeline', errors: page.errors };
    if (after) await measure(page, 'real-sample-1');
    await page.context().close();
  }
} finally {
  evidence.renderer = after ? 'see exports' : null;
  writeFileSync(join(OUT, `evidence-${label}.json`), JSON.stringify(evidence, null, 2));
  await browser.close();
}

async function measure(page, scene) {
  const out = { rebuild: {}, bench: {}, profile: {}, geometriesAfterCycles: [] };
  await domClick(page, '#iso-view'); await wait(page, 1600);
  for (const quality of ['technical', 'presentation']) {
    out.rebuild[quality] = [];
    for (let i = 0; i < 5; i += 1) { await setQuality(page, quality === 'technical' ? 'presentation' : 'technical'); out.rebuild[quality].push(await setQuality(page, quality)); }
    out.profile[quality] = await R(page, (r) => r.profile());
    out.bench[quality] = await R(page, (r) => r.benchmark(60));
  }
  for (let i = 0; i < 20; i += 1) { await setQuality(page, 'presentation'); await setQuality(page, 'technical'); if (i % 5 === 4) out.geometriesAfterCycles.push(await R(page, (r) => r.benchmark(1))); }
  evidence.scenes[scene] = { ...(evidence.scenes[scene] ?? {}), measure: out };
  if (scene === 'multi-room') {
    out.consistency = {};
    for (const quality of ['technical', 'presentation']) {
      await setQuality(page, quality);
      out.consistency[quality] = {
        tiles: await R(page, (r) => r.compare('tiles', 1920, 1080, 512, 4096)),
        editorVsExport: await R(page, (r) => r.compare('editor', 0, 0, 0, 1024)),
      };
    }
    await setQuality(page, 'technical');
  }
}
async function exports(page) {
  evidence.exports = [];
  await domClick(page, '#iso-view'); await wait(page, 1600); await setQuality(page, 'presentation');
  for (const key of ['1920x1080', '2560x1440', '3840x2160']) {
    await page.evaluate(() => { window.__unfoldLastExport = undefined; });
    await page.click('#export-image');
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 240000 }), page.click(`[data-export="${key}"]`)]);
    const file = join(EXPORTS, download.suggestedFilename()); await download.saveAs(file);
    await page.waitForFunction(() => window.__unfoldLastExport, null, { timeout: 60000 });
    const last = await page.evaluate(() => window.__unfoldLastExport); const png = readFileSync(file);
    evidence.exports.push({ requested: key, file: download.suggestedFilename(), png: { width: png.readUInt32BE(16), height: png.readUInt32BE(20), bytes: png.length }, report: last.report });
    await page.click('#export-close').catch(() => {});
  }
  await setQuality(page, 'technical');
}
