// Phase C in the REAL product workspace (/living): the hierarchical structural engine runs INSIDE the page on the saved Meta plans (excavator, harp), and its result goes through
// the product's own review path. Category C+D mechanics: the evidence is rendered from the saved plan itself; the loaded plan is a seeded local perturbation of it (see
// scripts/benchmark/v4-hierarchical.ts). It proves the engine and the workspace cooperate on real hierarchies; it says nothing about fidelity to the original photograph.
//   npx vite --port 5301 &   node tests/e2e/v4-hierarchical-living.pw.mjs     (local-edit mode: no backend)
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';

const host = process.env.UNFOLD_SPACE_URL ?? 'http://127.0.0.1:5301', out = process.env.UNFOLD_V4_OUT ?? 'reports/fidelity-v4/living-hierarchical', dir = 'reports/fidelity-v4/hierarchical/plans';
await mkdir(out, { recursive: true });
const read = async (f) => JSON.parse(await readFile(`${dir}/${f}.json`, 'utf8'));
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const records = [];
const opsBetween = (from, to, tag) => to.plan.components.flatMap((c) => { const a = from.plan.components.find((x) => x.id === c.id); return JSON.stringify(a.transform) === JSON.stringify(c.transform) ? [] : [{ contract: 'unfold.spatial-operation.v2', operationId: `${tag}-${c.id}`.slice(0, 80), kind: 'set-transform', componentId: c.id, nodeKey: null, value: c.transform }]; });

async function open(reply) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = []; page.errors = errors;
  page.on('pageerror', (e) => errors.push(e.message)); page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/api/spatial/v2/adopt')) errors.push(`${r.status()} ${r.url()}`); }); page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route('**/api/spatial/v2/plan', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply) }));
  await page.goto(`${host}/living?debug-living&rm=1`, { waitUntil: 'networkidle' }); await page.click('[data-space="open"]'); await page.fill('#sp-text', 'Validação local V4: plano servido de ficheiro, sem chamada à Meta.'); await page.click('[data-sp="submit"]');
  await page.waitForSelector('.sp-root[data-phase="review"]'); await page.click('[data-sp="keep-all"]'); await page.check('#sp-ack'); await page.click('[data-sp="build"]'); await page.waitForFunction(() => window.__workspace.spaceActive);
  await page.waitForFunction(() => !window.__space.layer.geometryReport?.pending.length, null, { timeout: 40000 }); await page.waitForTimeout(1200); return page;
}
const snap = (page) => page.evaluate(() => { const l = window.__space.layer; return { plan: l.currentPlan, edits: l.editCount, pending: !!l.pendingEdit, selected: window.__workspace.selectedSpaceId, families: [...new Set(Object.values((l.geometryReport?.decisions ?? []).reduce((o, d) => ({ ...o, [d.componentId]: d.used }), {})))] }; });
const diff = (a, b, path = '') => (a && b && typeof a === 'object' && typeof b === 'object') ? Object.keys({ ...a, ...b }).flatMap((k) => diff(a[k], b[k], `${path}/${k}`)) : (JSON.stringify(a) === JSON.stringify(b) ? [] : [`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`]);
const waitIdle = (page, n) => page.waitForFunction((k) => window.__space.layer.editCount === k && !window.__space.layer.isBusy, n, { timeout: 20000 });

for (const name of ['excavator', 'harp']) {
  const saved = await read(`${name}-saved`), input = await read(`${name}-input`), nonhier = await read(`${name}-v4-nonhierarchical`), page = await open(input), row = { name, category: 'C+D mechanics on a saved Meta plan (no ground truth for the original photograph)', steps: {} };
  const base = await snap(page);
  await page.evaluate(() => { const w = window.__workspace, h = w.director.homeView(); window.__home = { target: h.target.clone(), azimuth: h.azimuth, elevation: h.elevation, distance: h.distance }; });
  const shoot = async (file) => { await page.evaluate(() => { const w = window.__workspace; w.clearSelection(); w.director.jumpTo(window.__home); }); await page.waitForTimeout(900); await page.screenshot({ path: `${out}/${name}-${file}.png` }); };
  await shoot('1-v3-original-input');

  // ---- the engine runs in the page: by default it must REFUSE (declared relations contradict the geometry) and must not touch the Space
  const run = (override) => page.evaluate(async ({ savedPlan, override }) => {
    const [{ reconstructStructure }, { renderedEvidence }] = await Promise.all([import('/src/universal-spatial/reconstruction/engine.ts'), import('/src/universal-spatial/reconstruction/evidence.ts')]);
    const evidence = renderedEvidence(savedPlan, 6, 128);
    const layer = window.__space.layer, before = JSON.stringify(layer.currentPlan), t0 = performance.now(), outcome = reconstructStructure(layer.currentPlan, evidence, override ? { allowContradicted: true } : {}), ms = performance.now() - t0;
    const slim = { status: outcome.status, refusals: outcome.refusals, relationSummary: outcome.relationSummary, unresolved: outcome.unresolved, checks: outcome.checks, metrics: outcome.metrics, ms: Math.round(ms), operations: outcome.proposal?.operations ?? [], evidence: outcome.proposal?.evidence ?? null, changed: outcome.proposal?.changed ?? [], fitIou: outcome.proposal ? [outcome.proposal.fitIouBefore, outcome.proposal.fitIouAfter] : null, heldOut: outcome.proposal?.heldOut ?? null };
    return { ...slim, planUnchanged: JSON.stringify(layer.currentPlan) === before, pendingAfter: !!layer.pendingEdit, editsAfter: layer.editCount };
  }, { savedPlan: saved.plan, override });
  const refused = await run(false); assert.equal(refused.status, 'refused'); assert.equal(refused.refusals[0].code, 'CONTRADICTORY_RELATIONS'); assert.ok(refused.planUnchanged && !refused.pendingAfter && refused.editsAfter === 0, 'a refusal changed the Space');
  row.steps.defaultRefusal = { refusals: refused.refusals, relations: refused.relationSummary, planUnchanged: refused.planUnchanged, ms: refused.ms };
  const result = await run(true); assert.equal(result.status, 'proposal', JSON.stringify(result.refusals)); assert.ok(result.planUnchanged && !result.pendingAfter, 'the engine mutated or previewed by itself');
  row.steps.engineWithHumanOverride = { changed: result.changed, fitIou: result.fitIou, leftOutViews: result.heldOut, checks: result.checks, unresolved: result.unresolved, ms: result.ms, operations: result.operations.length };

  // ---- preview (no mutation) -> cancel -> preview again -> unconfirmed apply does nothing -> confirmed apply -> inspect -> selection -> exploded -> undo
  const propose = (ops) => page.evaluate(([o, e]) => { window.__workspace.select(o[0].componentId); return window.__space.layer.proposeSolverEdit(o, 'Ajuste estrutural hierárquico', e); }, [ops, result.evidence]);
  assert.ok(await propose(result.operations)); await page.waitForSelector('.sp-pending[data-source="solver"]'); assert.equal(JSON.stringify((await snap(page)).plan), JSON.stringify(base.plan), 'the preview changed the plan');
  await page.screenshot({ path: `${out}/${name}-preview-pending.png` });
  await page.click('[data-cancel]'); const cancelled = await snap(page); assert.equal(cancelled.pending, false); assert.equal(JSON.stringify(cancelled.plan), JSON.stringify(base.plan), 'cancel changed the plan'); row.steps.cancel = { pendingAfter: cancelled.pending, planUnchanged: true };
  assert.ok(await propose(result.operations)); await page.waitForSelector('.sp-pending[data-source="solver"]');
  await page.click('[data-apply]'); await page.waitForTimeout(500); const noAuth = await snap(page); assert.equal(noAuth.edits, 0, 'applied without explicit confirmation'); assert.equal(JSON.stringify(noAuth.plan), JSON.stringify(base.plan)); assert.ok(noAuth.pending);
  await page.check('[data-auth]'); await page.click('[data-apply]'); await waitIdle(page, 1); await page.waitForFunction(() => !window.__space.layer.geometryReport?.pending.length, null, { timeout: 40000 }); await page.waitForTimeout(1200);
  const after = await snap(page), changed = after.plan.components.filter((k) => JSON.stringify(k.transform) !== JSON.stringify(base.plan.components.find((x) => x.id === k.id).transform));
  assert.deepEqual(after.plan.components.map((k) => k.id), base.plan.components.map((k) => k.id)); assert.deepEqual(after.plan.components.map((k) => k.parentId), base.plan.components.map((k) => k.parentId), 'hierarchy changed'); assert.equal(after.plan.source.sha256, base.plan.source.sha256);
  assert.ok(changed.length > 0 && changed.every((k) => k.provenance.transform === 'inferred' && /Hierarchical structural solver/.test(k.provenance.evidence)), 'provenance not recorded');
  assert.ok(after.plan.components.filter((k) => !changed.includes(k)).every((k) => k.provenance.transform === base.plan.components.find((x) => x.id === k.id).provenance.transform), 'an untouched component changed provenance');
  row.steps.confirmedApply = { componentsChanged: changed.length, of: after.plan.components.length, provenance: [...new Set(changed.map((k) => k.provenance.transform))], families: after.families, geometryReport: await page.evaluate(() => window.__space.layer.geometryReport?.totals ?? null) };
  await shoot('3-v4-hierarchical');
  // 3D selection on the result: click a visible part, the workspace and the layer agree and the inspector shows the provenance
  const point = await page.evaluate(() => { const w = window.__workspace, l = window.__space.layer, r = document.querySelector('canvas').getBoundingClientRect(); for (let y = r.height * 0.15; y < r.height; y += 9) for (let x = r.width * 0.3; x < r.width * 0.66; x += 9) { const id = l.pick({ x: x / r.width * 2 - 1, y: 1 - y / r.height * 2 }, w.foundry.camera); if (id && document.elementFromPoint(r.left + x, r.top + y) === document.querySelector('canvas')) return { id, x: r.left + x, y: r.top + y }; } return null; });
  assert.ok(point); await page.mouse.click(point.x, point.y); await page.waitForTimeout(500); assert.equal(await page.evaluate(() => window.__workspace.selectedSpaceId), point.id); const chips = await page.locator('.uw-chips').first().innerText(); assert.match(chips, /posição/);
  row.steps.selection = { picked: point.id, inspectorChips: chips.replace(/\s+/g, ' ').slice(0, 160) };
  // exploded view keeps ids, hierarchy and plan, and restores
  const ex = await page.evaluate(async () => { const l = window.__space.layer, p = JSON.stringify(l.currentPlan); l.setExploded(true, true); await new Promise((r) => setTimeout(r, 400)); const on = l.isExploded; const same = JSON.stringify(l.currentPlan) === p; l.setExploded(false, true); await new Promise((r) => setTimeout(r, 300)); return { on, planSame: same, off: !l.isExploded }; });
  assert.ok(ex.on && ex.planSame && ex.off); row.steps.exploded = ex;
  await page.evaluate(() => window.__workspace.select(window.__space.layer.currentPlan.components[0].id)); await page.waitForSelector('[data-undo]:not([disabled])'); await page.click('[data-undo]'); await waitIdle(page, 0);
  const undone = await snap(page); const d = diff(undone.plan, base.plan); assert.deepEqual(d.slice(0, 5), [], 'undo did not restore the plan exactly'); row.steps.undo = { restoredExactly: true };

  // ---- Phase B (non-hierarchical) result on the same page, same camera, for the comparison column; then restore
  const nops = opsBetween(input, nonhier, 'v4b'); assert.ok(await propose(nops)); await page.check('[data-auth]'); await page.click('[data-apply]'); await waitIdle(page, 1); await page.waitForFunction(() => !window.__space.layer.geometryReport?.pending.length, null, { timeout: 40000 }); await page.waitForTimeout(1200);
  await shoot('2-v4-non-hierarchical'); await page.evaluate(() => window.__workspace.select(window.__space.layer.currentPlan.components[0].id)); await page.waitForSelector('[data-undo]:not([disabled])'); await page.click('[data-undo]'); await waitIdle(page, 0);
  assert.deepEqual(diff((await snap(page)).plan, base.plan).slice(0, 5), []); row.steps.nonHierarchicalComparison = { operations: nops.length, undoExact: true };

  // ---- dispose with a proposal pending: nothing is left behind, nothing throws
  assert.ok(await propose(result.operations)); const disposed = await page.evaluate(async () => { const l = window.__space.layer; l.dispose(); await new Promise((r) => setTimeout(r, 300)); return { offered: l.proposeSolverEdit([], 'x', 'y'), pending: !!l.pendingEdit, upgraded: l.upgradeGeometry() }; });
  assert.equal(disposed.pending, false); assert.deepEqual(disposed.upgraded, []); row.steps.dispose = disposed;
  assert.deepEqual(page.errors, []); await page.close(); records.push(row); console.log(name, 'ok', JSON.stringify(row.steps.engineWithHumanOverride).slice(0, 200));
}
await writeFile(`${out}/results.json`, JSON.stringify(records, null, 2)); await browser.close();
