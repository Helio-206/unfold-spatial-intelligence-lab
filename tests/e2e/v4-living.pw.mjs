// V4 visual validation in the REAL product workspace (/living): the same renderer, camera, lighting, framing, selection and inspector as the product.
// The plan endpoint is replaced by a local file (no Meta call); every variant is labelled with what it is.
//   npx vite --port 5301 &   UNFOLD_SPACE_URL=http://127.0.0.1:5301 node tests/e2e/v4-living.pw.mjs
// Variants per case, same viewport, same product camera:
//   ground-truth   the plan the synthetic evidence was rendered from                       [hand-authored]
//   input-v3       the degraded plan through the product geometry policy (V3 as shipped)    [synthetic degradation]
//   v4-fit6        the V4 placement proposal (6 silhouettes) through the same product path [inferred, basis recorded in provenance]
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';

const host = process.env.UNFOLD_SPACE_URL ?? 'http://127.0.0.1:5301', out = process.env.UNFOLD_V4_OUT ?? 'reports/fidelity-v4/living', plans = 'reports/fidelity-v4/plans';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const records = [];
for (const name of ['lungs-like', 'microscope-like']) for (const [variant, file] of [['ground-truth', 'ground-truth'], ['input-v3', 'degraded'], ['v4-fit6', 'v4-fit6']]) {
  const reply = JSON.parse(await readFile(`${plans}/${name}-${file}.json`, 'utf8')), page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [];
  page.on('response', (r) => { if (r.status() >= 400) console.log('  http', r.status(), r.url().replace(host, '')); }); page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/api/spatial/v2/plan', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply) }));
  await page.goto(`${host}/living?debug-living&rm=1`, { waitUntil: 'networkidle' }); await page.click('[data-space="open"]'); await page.fill('#sp-text', 'Validação local V4: plano servido de ficheiro, sem chamada à Meta.'); await page.click('[data-sp="submit"]');
  await page.waitForSelector('.sp-root[data-phase="review"]'); await page.click('[data-sp="keep-all"]'); await page.check('#sp-ack');
  const started = Date.now(); await page.click('[data-sp="build"]'); await page.waitForFunction(() => window.__workspace.spaceActive);
  await page.waitForFunction(() => !window.__space.layer.geometryReport?.pending.length, null, { timeout: 30000 }); await page.waitForTimeout(1500);
  const info = await page.evaluate(() => {
    const w = window.__workspace, l = window.__space.layer, cv = document.querySelector('canvas'), r = cv.getBoundingClientRect(), cam = w.foundry.camera, box = l.box();
    const corners = []; for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) { const v = { x, y, z }; const p = new (box.min.constructor)(v.x, v.y, v.z).project(cam); corners.push([(p.x + 1) / 2 * r.width, (1 - p.y) / 2 * r.height]); }
    const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]), plan = l.currentPlan;
    return { framing: { objectBoxPx: [Math.round(Math.min(...xs)), Math.round(Math.min(...ys)), Math.round(Math.max(...xs)), Math.round(Math.max(...ys))], canvasPx: [Math.round(r.width), Math.round(r.height)], widthFraction: +((Math.max(...xs) - Math.min(...xs)) / r.width).toFixed(2), heightFraction: +((Math.max(...ys) - Math.min(...ys)) / r.height).toFixed(2) },
      components: plan.components.length, transformProvenance: Object.fromEntries(plan.components.map((c) => [c.id, c.provenance.transform])), sourceSha: plan.source.sha256, report: l.geometryReport ? { totals: l.geometryReport.totals, used: [...new Set(l.geometryReport.decisions.map((d) => d.used))] } : null, stats: w.stats() };
  });
  await page.screenshot({ path: `${out}/${name}-${variant}.png` });
  // selection in the real workspace: click on the object, then read what the inspector shows
  const point = await page.evaluate(() => { const w = window.__workspace, l = window.__space.layer, r = document.querySelector('canvas').getBoundingClientRect(); for (let y = r.height * 0.2; y < r.height; y += 10) for (let x = r.width * 0.3; x < r.width * 0.8; x += 10) { const id = l.pick({ x: x / r.width * 2 - 1, y: 1 - y / r.height * 2 }, w.foundry.camera); if (id) return { id, x: r.left + x, y: r.top + y }; } return null; });
  assert.ok(point, `${name}/${variant}: nothing pickable`); await page.mouse.click(point.x, point.y); await page.waitForTimeout(500);
  const selected = await page.evaluate(() => window.__workspace.selectedSpaceId); assert.equal(selected, point.id);
  await page.screenshot({ path: `${out}/${name}-${variant}-selected.png` });
  assert.deepEqual(errors, []);
  records.push({ name, variant, origin: variant === 'ground-truth' ? 'hand-authored reproduction' : variant === 'input-v3' ? 'SYNTHETIC degradation of a hand-authored plan' : 'V4 placement fitted to 6 calibrated silhouettes of the hand-authored plan (synthetic evidence); not a Meta call', ...info, selectedAfterClick: selected, elapsedMs: Date.now() - started, errors });
  console.log(name, variant, JSON.stringify(info.framing), 'tri', info.report?.totals.triangles, 'selected', selected);
  await page.close();
}
await writeFile(`${out}/results.json`, JSON.stringify(records, null, 2)); await browser.close();
