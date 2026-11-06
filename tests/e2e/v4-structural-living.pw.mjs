// V4 structural proposals in the REAL product workspace (/living), same page and camera for every column, through the real UI path:
//   input plan (product V3 policy)  ->  solver proposal PREVIEW (inspector)  ->  person authorises + applies  ->  screenshot  ->  UNDO (button)  ->  next proposal
// No Meta call: the plan endpoint serves a local file. Cases: category A/D (CC0 Lantern and AntiqueCamera, hand-built plans, fitted to silhouettes of the CC0 mesh)
// and category D/D (lungs, microscope: synthetic mis-proportioned-but-connected input).
//   npx vite --port 5301 &  node server (UNFOLD_LOCAL_ORIGINS=http://127.0.0.1:5301) &  node tests/e2e/v4-structural-living.pw.mjs
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';

const host = process.env.UNFOLD_SPACE_URL ?? 'http://127.0.0.1:5301', out = process.env.UNFOLD_V4_OUT ?? 'reports/fidelity-v4/living-structural', dir = 'reports/fidelity-v4/benchmark/plans';
await mkdir(out, { recursive: true });
const CASES = [
  { name: 'Lantern', category: 'A (CC0 mesh as evidence) + D (hand-built plan)', input: 'Lantern-input', structural: 'Lantern-structural', sil: 'Lantern-silhouetteOnly' },
  { name: 'AntiqueCamera', category: 'A (CC0 mesh as evidence) + D (hand-built plan)', input: 'AntiqueCamera-input', structural: 'AntiqueCamera-structural', sil: 'AntiqueCamera-silhouetteOnly' },
  { name: 'lungs-like', category: 'D/D (synthetic input, hand-authored ground truth)', input: 'lungs-like-consistent-input', structural: 'lungs-like-consistent-structural', sil: 'lungs-like-consistent-silhouetteOnly', truth: 'lungs-like-ground-truth' },
  { name: 'microscope-like', category: 'D/D (synthetic input, hand-authored ground truth)', input: 'microscope-like-consistent-input', structural: 'microscope-like-consistent-structural', sil: 'microscope-like-consistent-silhouetteOnly', truth: 'microscope-like-ground-truth' },
];
const read = async (f) => JSON.parse(await readFile(`${dir}/${f}.json`, 'utf8'));
const opsBetween = (from, to, label) => to.plan.components.flatMap((c) => { const a = from.plan.components.find((x) => x.id === c.id); return JSON.stringify(a.transform) === JSON.stringify(c.transform) ? [] : [{ contract: 'unfold.spatial-operation.v2', operationId: `v4-${label}-${c.id}`.slice(0, 80), kind: 'set-transform', componentId: c.id, nodeKey: null, value: c.transform }]; });

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const records = [], LOCAL = process.env.UNFOLD_V4_SYNC !== '1'; // LOCAL: no backend, the layer edits locally (the backend limits spatial requests to 20 per minute); UNFOLD_V4_SYNC=1 runs against the real session backend
async function open(reply) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = []; page.errors = errors;
  page.on('pageerror', (e) => errors.push(e.message)); page.on('response', (r) => { if (r.status() >= 400 && !(LOCAL && r.url().includes('/api/spatial/v2/adopt'))) errors.push(`${r.status()} ${r.url()}`); }); page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route('**/api/spatial/v2/plan', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply) }));
  await page.goto(`${host}/living?debug-living&rm=1`, { waitUntil: 'networkidle' }); await page.click('[data-space="open"]'); await page.fill('#sp-text', 'Validação local V4: plano servido de ficheiro, sem chamada à Meta.'); await page.click('[data-sp="submit"]');
  await page.waitForSelector('.sp-root[data-phase="review"]'); await page.click('[data-sp="keep-all"]'); await page.check('#sp-ack'); await page.click('[data-sp="build"]'); await page.waitForFunction(() => window.__workspace.spaceActive);
  await page.waitForFunction(() => !window.__space.layer.geometryReport?.pending.length, null, { timeout: 30000 }); await page.waitForTimeout(1200); return page;
}
const snapshot = (page) => page.evaluate(() => { const l = window.__space.layer, w = window.__workspace; return { plan: l.currentPlan, selected: w.selectedSpaceId, edits: l.editCount, canUndo: l.canUndo, tri: l.geometryReport?.totals.triangles ?? null, stats: { geometries: w.stats().geometries, lastFrameMs: w.stats().lastFrameMs } }; });

for (const c of CASES) {
  const input = await read(c.input), structural = await read(c.structural), sil = await read(c.sil), page = await open(input), row = { name: c.name, category: c.category, columns: {} };
  const base = await snapshot(page);
  // one camera for every column of the row: the home view the product computed for the INPUT plan, restored after clearing the selection (a selection retargets the camera and tints the part)
  await page.evaluate(() => { const w = window.__workspace, h = w.director.homeView(); window.__home = { target: h.target.clone(), azimuth: h.azimuth, elevation: h.elevation, distance: h.distance }; });
  const shoot = async (file) => { await page.evaluate(() => { const w = window.__workspace; w.clearSelection(); w.director.jumpTo(window.__home); w.renderNow?.(); }); await page.waitForTimeout(900); await page.screenshot({ path: `${out}/${file}.png` }); };
  await shoot(`${c.name}-1-input-v3`);
  // ---- coverage recovered from the removed Engine Lab e2e tests, now on the real workspace (non-public test harness)
  const cov = await page.evaluate(async () => {
    const w = window.__workspace, l = window.__space.layer; w.clearSelection(); w.director.jumpTo(window.__home); await new Promise((r) => setTimeout(r, 700));
    const frame = w.captureSpaceFrame(), box = frame?.analysis.bbox;
    l.root.visible = false; await new Promise((r) => setTimeout(r, 300)); const blank = w.captureSpaceFrame(); l.root.visible = true;
    return { verdictOk: frame?.verdict.ok, problems: frame?.verdict.problems, bbox: box, size: frame ? [frame.analysis.width, frame.analysis.height] : null, bboxFraction: frame?.analysis.bboxFraction, blankRejected: blank ? blank.verdict.ok === false : null, blankProblems: blank?.verdict.problems };
  });
  assert.equal(cov.verdictOk, true, `${c.name}: the product frame was not verified (${JSON.stringify(cov.problems)})`); assert.ok(cov.bbox[0] > 0 && cov.bbox[1] > 0 && cov.bbox[2] < cov.size[0] && cov.bbox[3] < cov.size[1], 'object touches the frame edge'); assert.equal(cov.blankRejected, true, 'a blank capture was accepted');
  row.coverage = cov; // preview-does-not-change-plan, authorisation of confirmed values, undo and gap closing are covered in tests/spatial-space-layer.test.ts and below
  await page.evaluate(() => { window.__space.layer.cancelPending(); window.__workspace.clearSelection(); window.__workspace.director.jumpTo(window.__home); });
 const first = structural.plan.components.find((k) => JSON.stringify(input.plan.components.find((x) => x.id === k.id).transform) !== JSON.stringify(k.transform))?.id;
  assert.ok(first, `${c.name}: the proposal changes nothing`);
  for (const [label, reply, shot] of [['structural', structural, '2-v4-structural'], ['silhouette-only', sil, '3-silhouette-only-contrast']]) {
    const ops = opsBetween(input, reply, label.slice(0, 6)); assert.ok(ops.length > 0);
    await page.evaluate((id) => window.__workspace.select(id), ops[0].componentId);
    const ok = await page.evaluate(([o, l, e]) => window.__space.layer.proposeSolverEdit(o, l, e), [ops, `Ajuste ${label}`, `V4 ${label}: placement fitted to 6 calibrated silhouettes (${c.category}). Basis: inferred.`]); assert.ok(ok, 'proposal refused');
    await page.waitForSelector('.sp-pending[data-source="solver"]'); const previewPlanSame = await page.evaluate((p) => JSON.stringify(window.__space.layer.currentPlan) === p, JSON.stringify(base.plan)); assert.ok(previewPlanSame, 'the preview changed the plan');
    await page.screenshot({ path: `${out}/${c.name}-${shot}-preview.png` });
    await page.check('[data-auth]'); await page.click('[data-apply]'); await page.waitForFunction((n) => window.__space.layer.editCount === n && !window.__space.layer.isBusy, base.edits + 1, { timeout: 15000 });
    await page.waitForFunction(() => !window.__space.layer.geometryReport?.pending.length, null, { timeout: 30000 }); await page.waitForTimeout(1500);
    const after = await snapshot(page); await shoot(`${c.name}-${shot}`);
    const changed = after.plan.components.filter((k) => JSON.stringify(k.transform) !== JSON.stringify(input.plan.components.find((x) => x.id === k.id).transform));
    assert.deepEqual(after.plan.components.map((k) => k.id), base.plan.components.map((k) => k.id), 'ids changed'); assert.equal(after.plan.source.sha256, base.plan.source.sha256, 'source hash changed');
    assert.ok(changed.every((k) => k.provenance.transform === 'inferred' && /placement fitted|Resultado de optimização/.test(k.provenance.evidence)), 'provenance not recorded');
    assert.ok(after.selected, 'selection lost'); await page.evaluate((id) => window.__workspace.select(id), after.selected);
    // undo through the real button: back to the input plan, exactly
    await page.evaluate(() => window.__workspace.select(window.__space.layer.currentPlan.components[0].id)); await page.waitForSelector('[data-undo]:not([disabled])'); await page.click('[data-undo]'); await page.waitForFunction((n) => window.__space.layer.editCount === n && !window.__space.layer.isBusy, base.edits, { timeout: 15000 });
    const undone = await snapshot(page); const diff = (a, b, path = '') => (a && b && typeof a === 'object' && typeof b === 'object') ? Object.keys({ ...a, ...b }).flatMap((k) => diff(a[k], b[k], `${path}/${k}`)) : (JSON.stringify(a) === JSON.stringify(b) ? [] : [`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`]);
    const d = diff(undone.plan, base.plan); assert.deepEqual(d.slice(0, 6), [], 'undo did not restore the plan');
    await page.waitForFunction(() => !window.__space.layer.geometryReport?.pending.length, null, { timeout: 30000 });
    row.columns[label] = { operations: ops.length, componentsChanged: changed.length, provenanceAfter: [...new Set(changed.map((k) => k.provenance.transform))], evidenceSample: changed[0].provenance.evidence.slice(0, 200), selectableAfter: after.selected, undoRestoredExactly: true, triangles: after.tri, lastFrameMs: after.stats.lastFrameMs };
    console.log(c.name, label, JSON.stringify(row.columns[label]).slice(0, 220));
  }
  assert.deepEqual(page.errors, []); await page.close();
  if (c.truth) { const g = await open(await read(c.truth)); await g.screenshot({ path: `${out}/${c.name}-4-ground-truth-own-framing.png` }); await g.close(); }
  records.push(row);
}
await writeFile(`${out}/results.json`, JSON.stringify(records, null, 2)); await browser.close();
