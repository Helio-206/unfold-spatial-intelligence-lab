// Drives the real editor (/spatial-editor) on a local fixture: detect, look at what it says without a scale,
// calibrate with ONE reference measure typed by a person, build, and read back what the scene says about the scale.
// usage: node scripts/benchmark/run-ui-scale.mjs <image> <out.json> <x0> <x1> <y> <metres>
import fs from 'node:fs';
import { createServer } from 'vite';
import { launchSystemChromium } from './browser.mjs';

const [, , imagePath, outPath, x0, x1, y, metres] = process.argv;
const server = await createServer({ server: { port: 5190, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await launchSystemChromium({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const out = { requests: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('request', (r) => { if (!r.url().startsWith('http://127.0.0.1:5190')) out.requests.push(r.url()); });
  page.on('pageerror', (e) => (out.pageErrors ??= []).push(e.message));
  await page.goto('http://127.0.0.1:5190/spatial-editor', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.setInputFiles('#plan-file', imagePath);
  await page.waitForFunction(() => !document.querySelector('#plan-workflow').hidden && document.querySelector('#source-image').naturalWidth);
  const t0 = Date.now();
  await page.click('#detect-lines');
  await page.waitForFunction(() => document.querySelectorAll('#candidate-list [data-candidate]').length > 0);
  out.detectClickToListMs = Date.now() - t0;
  const text = (sel) => page.evaluate((s) => document.querySelector(s)?.textContent ?? null, sel);
  out.before = { contourSummary: await text('#contour-summary'), sourceState: await text('#source-state'), planMeta: await text('#plan-meta'),
    regionRows: await page.evaluate(() => [...document.querySelectorAll('#region-list [data-region]')].map((e) => e.textContent)) };
  // calibration: two clicks on the SVG overlay at image coordinates (the editor snaps to nearby lines)
  await page.evaluate(() => document.querySelectorAll('details.workflow-section').forEach((d) => (d.open = true)));
  await page.click('#scale-mode');
  await page.locator('#plan-overlay').scrollIntoViewIfNeeded();
  const box = await page.locator('#plan-overlay').boundingBox();
  const size = await page.evaluate(() => ({ w: document.querySelector('#source-image').naturalWidth, h: document.querySelector('#source-image').naturalHeight }));
  const at = (x, yy) => ({ x: box.x + (x / size.w) * box.width, y: box.y + (yy / size.h) * box.height });
  for (const p of [at(Number(x0), Number(y)), at(Number(x1), Number(y))]) await page.mouse.click(p.x, p.y);
  out.statusAfterAnchors = await text('#spatial-status');
  const set = (sel, v) => page.evaluate(([s, val]) => { const e = document.querySelector(s); e.value = val; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, [sel, v]);
  await set('#scale-distance', metres); await set('#wall-height', '2.7'); await set('#wall-thickness', '0.15');
  await set('#scale-evidence', `Largura do Balcony = ${metres} m, introduzida por uma pessoa neste teste (não está impressa na planta).`);
  // the accepted candidates: only the eligible regions are selected (as a person would after reviewing them)
  const nRegions = await page.evaluate(() => document.querySelectorAll('#region-list [data-region]').length);
  for (let i = 0; i < nRegions; i += 1) { await page.evaluate((k) => document.querySelectorAll('#region-list [data-region]')[k]?.click(), i); await page.waitForTimeout(60); }
  out.buildButton = await text('#build-scene');
  const b0 = Date.now();
  await page.click('#build-scene');
  await page.waitForFunction(() => document.querySelector('#app').dataset.state === 'ready', null, { timeout: 30000 });
  out.buildMs = Date.now() - b0;
  await page.click('#save-scene');
  const scene = await page.evaluate(() => JSON.parse(localStorage.getItem('unfold-spatial-scene.v1')));
  const s = scene.scene ?? scene;
  out.after = { contourSummary: await text('#contour-summary'), sourceState: await text('#source-state'), status: await text('#spatial-status'),
    imageWorldMapping: s.imageWorldMapping ? { scale: s.imageWorldMapping.pixelToWorldXZ, provenance: s.imageWorldMapping.provenance } : null,
    rooms: s.nodes.filter((n) => n.component?.kind === 'room').map((n) => ({ id: n.id, label: n.label, properties: Object.fromEntries(Object.entries(n.component.properties).filter(([k]) => /area|scale|unit/i.test(k)).map(([k, v]) => [k, { value: v.value, unit: v.unit, provenance: { source: v.provenance.source, validation: v.provenance.validation, actor: v.provenance.actor, evidence: v.provenance.evidence } }])), geometryProvenance: n.geometry?.provenance && { source: n.geometry.provenance.source, validation: n.geometry.provenance.validation } })) };
  fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ before: out.before.contourSummary, after: out.after.contourSummary, rooms: out.after.rooms.length, externalRequests: out.requests.length, buildMs: out.buildMs }));
} finally { await browser.close(); await server.close(); }
