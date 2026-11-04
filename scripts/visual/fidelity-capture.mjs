// Fidelity V3 evidence in the real SpatialWorkspace (Chromium + SwiftShader, 1440x900). One variable between captures: the geometry route.
//   node scripts/visual/fidelity-capture.mjs --host http://127.0.0.1:5195 --glb <AntiqueCamera.glb> --out reports/fidelity-v3
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const args = {}; for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const out = resolve(args.out ?? 'reports/fidelity-v3'); await mkdir(out, { recursive: true });
const glb = args.glb ? await readFile(resolve(args.glb)) : null;
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const settle = (page, ms = 900) => page.evaluate((t) => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, t)))), ms);
const results = { browser: 'Chromium (system) + SwiftShader', viewport: '1440x900', cases: {} };

async function run(label, query) {
  const page = await context.newPage(); const errors = []; page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message));
  if (glb) await page.route('**/__assets/AntiqueCamera.glb', (route) => route.fulfill({ status: 200, contentType: 'model/gltf-binary', body: glb }));
  await page.goto(`${args.host}/tests/harness/fidelity/index.html?${query}`, { waitUntil: 'networkidle' }); await page.evaluate(() => window.__fid.ready); await settle(page, 1800);
  const info = await page.evaluate(() => {
    const f = window.__fid, s = f.ws.stats(), plan = f.layer.currentPlan, ids = new Set(), families = {};
    f.layer.root.traverse((o) => { if (o.isMesh && o.userData.spatialEntityId) { ids.add(o.userData.spatialEntityId); const k = o.userData.geometryFamily ?? 'procedural_v2'; families[k] = (families[k] ?? 0) + 1; } });
    return { metrics: f.metrics, gpu: { geometries: s.geometries, textures: s.textures, programs: s.programs }, components: plan.components.length, selectableComponents: [...ids].filter((id) => plan.components.some((c) => c.id === id)).length, meshesByFamily: families, assetNote: f.assetNote,
      decisions: f.report ? f.report.decisions.map((d) => ({ id: d.componentId, used: d.used, reason: d.reason, fallback: d.fallback, representation: d.representation, planGeometryOrigin: d.planGeometryOrigin, triangles: d.triangles })) : null,
      report: f.report ? { planSource: f.report.planSource, totals: f.report.totals, perFamily: f.report.perFamily, fallbacks: f.report.fallbacks, proposalsNotApproved: f.report.proposalsNotApproved } : null };
  });
  await page.screenshot({ path: resolve(out, `${label}.png`) }); results.cases[label] = { ...info, consoleErrors: errors }; await page.close();
}

try {
  for (const fixture of ['lungs-like', 'microscope-like']) for (const route of ['v2', 'router']) await run(`${fixture}-${route}`, `fixture=${fixture}&route=${route}`);
  if (glb) { await run('camera-asset-offered-not-approved', 'fixture=camera-standin&route=router&asset=camera'); await run('camera-asset-approved', 'fixture=camera-standin&route=router&asset=camera&approve=1'); await run('camera-standin-v2', 'fixture=camera-standin&route=v2'); }
  await writeFile(resolve(out, 'capture-result.json'), `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify(Object.fromEntries(Object.entries(results.cases).map(([k, v]) => [k, { tri: v.metrics.triangles, ms: v.metrics.buildMs, meshes: v.metrics.meshes, bytes: v.metrics.geometryBytes, gpu: v.gpu, selectable: `${v.selectableComponents}/${v.components}`, errors: v.consoleErrors.length, families: v.meshesByFamily }])), null, 1));
} finally { await browser.close(); }
