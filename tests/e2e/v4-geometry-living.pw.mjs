// Phase D in the REAL product workspace (/living): two geometry corrections that translation and uniform scale cannot give.
//   1  ROTATION   the saved Meta excavator (C+D mechanics: synthetic local rotation errors on boom and bucket; evidence rendered from the saved plan itself)
//   2  PRIMITIVE  the Lantern plan with two primitives degraded by us, silhouettes of the independent CC0 mesh as evidence (A+D), replayed from stored evidence data
// Same page and camera for every column; the engine runs inside the page; proposals go through preview -> explicit confirmation -> apply -> undo.
//   npx vite --port 5301 &   node tests/e2e/v4-geometry-living.pw.mjs     (local-edit mode: no backend)
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';

const host = process.env.UNFOLD_SPACE_URL ?? 'http://127.0.0.1:5301', out = process.env.UNFOLD_V4_OUT ?? 'reports/fidelity-v4/living-geometry', dir = 'reports/fidelity-v4/geometry/plans';
await mkdir(out, { recursive: true });
const read = async (f) => JSON.parse(await readFile(`${dir}/${f}.json`, 'utf8'));
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const records = [];
async function open(reply) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = []; page.errors = errors;
  page.on('pageerror', (e) => errors.push(e.message)); page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/api/spatial/v2/adopt')) errors.push(`${r.status()} ${r.url()}`); }); page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route('**/api/spatial/v2/plan', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply) }));
  await page.goto(`${host}/living?debug-living&rm=1`, { waitUntil: 'networkidle' }); await page.click('[data-space="open"]'); await page.fill('#sp-text', 'Validação local V4: plano servido de ficheiro, sem chamada à Meta.'); await page.click('[data-sp="submit"]');
  await page.waitForSelector('.sp-root[data-phase="review"]'); await page.click('[data-sp="keep-all"]'); await page.check('#sp-ack'); await page.click('[data-sp="build"]'); await page.waitForFunction(() => window.__workspace.spaceActive);
  await page.waitForFunction(() => !window.__space.layer.geometryReport?.pending.length, null, { timeout: 40000 }); await page.waitForTimeout(1200);
  await page.evaluate(() => { const w = window.__workspace, h = w.director.homeView(); window.__home = { target: h.target.clone(), azimuth: h.azimuth, elevation: h.elevation, distance: h.distance }; }); return page;
}
const snap = (page) => page.evaluate(() => { const l = window.__space.layer; return { plan: l.currentPlan, edits: l.editCount, pending: !!l.pendingEdit, families: [...new Set((l.geometryReport?.decisions ?? []).map((d) => d.used))], tri: l.geometryReport?.totals.triangles ?? null }; });
const shoot = async (page, name) => { await page.evaluate(() => { const w = window.__workspace; w.clearSelection(); w.director.jumpTo(window.__home); }); await page.waitForTimeout(900); await page.screenshot({ path: `${out}/${name}.png` }); };
const diff = (a, b, path = '') => (a && b && typeof a === 'object' && typeof b === 'object') ? Object.keys({ ...a, ...b }).flatMap((k) => diff(a[k], b[k], `${path}/${k}`)) : (JSON.stringify(a) === JSON.stringify(b) ? [] : [`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`]);
const idle = async (page, n) => { try { await page.waitForFunction((k) => window.__space.layer.editCount === k && !window.__space.layer.isBusy && !window.__space.layer.geometryReport?.pending.length, n, { timeout: 40000 }); } catch (e) { console.log('idle timeout', n, JSON.stringify(await page.evaluate(() => { const l = window.__space.layer; return { edits: l.editCount, busy: l.isBusy, pending: l.geometryReport?.pending, pend: !!l.pendingEdit, text: document.querySelector('.sp-pending')?.innerText?.slice(0, 120) }; }))); throw e; } };
async function review(page, base, ops, label, evidence, name, tag) {
  await page.evaluate(([o, l, e]) => { window.__workspace.select(o[0].componentId); return window.__space.layer.proposeSolverEdit(o, l, e); }, [ops, label, evidence]); await page.waitForSelector('.sp-pending[data-source="solver"]');
  assert.equal(JSON.stringify((await snap(page)).plan), JSON.stringify(base.plan), 'the preview changed the plan');
  const pendingText = await page.locator('.sp-pending').innerText(); const st = () => page.evaluate(() => ({ pend: !!window.__space.layer.pendingEdit, sel: window.__workspace.selectedSpaceId, edits: window.__space.layer.editCount })); if (process.env.V4_DEBUG) console.log('before check', JSON.stringify(await st())); await page.check('[data-auth]'); if (process.env.V4_DEBUG) console.log('after check', JSON.stringify(await st())); await page.evaluate(() => { const l = window.__space.layer; window.__log = []; const h = l.host; const n = h.notify.bind(h); h.notify = (t) => { window.__log.push(t); n(t); }; }); await page.click('[data-apply]'); await page.waitForTimeout(300); if (process.env.V4_DEBUG) console.log('after click', JSON.stringify(await st()), JSON.stringify(await page.evaluate(() => window.__log))); await idle(page, base.edits + 1); await page.waitForTimeout(1200);
  const after = await snap(page); assert.deepEqual(after.plan.components.map((k) => k.id), base.plan.components.map((k) => k.id)); assert.deepEqual(after.plan.components.map((k) => k.parentId), base.plan.components.map((k) => k.parentId), 'hierarchy changed'); assert.equal(after.plan.source.sha256, base.plan.source.sha256);
  const changed = after.plan.components.filter((k) => JSON.stringify(k) !== JSON.stringify(base.plan.components.find((x) => x.id === k.id)));
  await shoot(page, `${name}-${tag}`);
  await page.evaluate(() => window.__workspace.select(window.__space.layer.currentPlan.components[0].id)); await page.waitForSelector('[data-undo]:not([disabled])'); await page.click('[data-undo]'); await idle(page, base.edits);
  assert.deepEqual(diff((await snap(page)).plan, base.plan).slice(0, 5), [], 'undo did not restore the plan exactly');
  return { pendingText: pendingText.replace(/\s+/g, ' ').slice(0, 220), changed: changed.map((k) => ({ id: k.id, transformProv: k.provenance.transform, geometryProv: k.provenance.geometry })), families: after.families, triangles: after.tri, undoExact: true };
}

// ------------------------------------------------------------------------------------------------ 1 rotation (excavator)
{
  const saved = await read('excavator-rot-input'), page = await open(saved), base = await snap(page), row = { name: 'excavator-rotation', category: 'C+D mechanics (saved Meta plan as geometry basis, synthetic local rotation errors on boom and bucket; no ground truth for the original photograph)' };
  await shoot(page, 'excavator-1-v3-original-input'); const truthPlan = JSON.parse(await readFile('reports/universal-spatial-v2/evidence/live-image-plan.json', 'utf8')).plan;
  const engine = (rotation) => page.evaluate(async ({ truthPlan, rotation }) => {
    const [{ reconstructStructure }, { renderedEvidence }] = await Promise.all([import('/src/universal-spatial/reconstruction/engine.ts'), import('/src/universal-spatial/reconstruction/evidence.ts')]);
    const layer = window.__space.layer, before = JSON.stringify(layer.currentPlan), o = reconstructStructure(layer.currentPlan, renderedEvidence(truthPlan, 6, 128), { allowContradicted: true, rotation });
    return { status: o.status, refusals: o.refusals, ops: o.proposal?.operations ?? [], evidence: o.proposal?.evidence ?? null, fitIou: o.proposal ? [o.proposal.fitIouBefore, o.proposal.fitIouAfter] : null, checks: o.checks, unexplained: { candidates: o.unexplained?.candidates.length ?? null }, unresolved: o.unresolved, planUnchanged: JSON.stringify(layer.currentPlan) === before, pending: !!layer.pendingEdit };
  }, { truthPlan, rotation });
  const noRot = await engine(false), withRot = await engine(true); assert.ok(noRot.planUnchanged && withRot.planUnchanged && !withRot.pending, 'the engine changed or previewed the Space by itself'); assert.equal(withRot.status, 'proposal');
  row.engine = { translationScaleOnly: { status: noRot.status, fitIou: noRot.fitIou, ops: noRot.ops.length }, withRotation: { status: withRot.status, fitIou: withRot.fitIou, ops: withRot.ops.length, checks: withRot.checks, rotatedParts: withRot.ops.filter((o) => JSON.stringify(o.value.rotationRad) !== JSON.stringify(base.plan.components.find((k) => k.id === o.componentId).transform.rotationRad)).map((o) => o.componentId), unexplainedCandidates: withRot.unexplained.candidates, unresolved: withRot.unresolved } };
  assert.ok(row.engine.withRotation.rotatedParts.length > 0);
  row.translationScaleOnly = await review(page, base, noRot.ops, 'Ajuste estrutural (translação e escala)', noRot.evidence, 'excavator', '2-v4-translation-scale-only');
  row.withRotation = await review(page, base, withRot.ops, 'Ajuste estrutural com rotação local', withRot.evidence, 'excavator', '3-v4-with-rotation');
  assert.deepEqual(page.errors, []); await page.close(); records.push(row); console.log('excavator ok', JSON.stringify(row.engine.withRotation).slice(0, 200));
}

// ------------------------------------------------------------------------------------------------ 2 primitive alternatives (Lantern, CC0 evidence)
{
  const input = await read('Lantern-shape-input'), page = await open(input), base = await snap(page), row = { name: 'lantern-primitives', category: 'A (independent CC0 mesh as evidence, replayed from stored silhouettes) + D (hand-built plan, two primitives degraded by us)' };
  await shoot(page, 'lantern-1-v3-original-input');
  const found = await page.evaluate(async () => {
    const [{ proposeShapeAlternatives }, { evidenceFromJSON }] = await Promise.all([import('/src/universal-spatial/reconstruction/shapes.ts'), import('/src/universal-spatial/reconstruction/evidence.ts')]);
    const json = await (await fetch('/reports/fidelity-v4/geometry/evidence/Lantern-6views.json')).json(), layer = window.__space.layer, before = JSON.stringify(layer.currentPlan), f = proposeShapeAlternatives(layer.currentPlan, evidenceFromJSON(json));
    return { table: f.map((x) => ({ id: x.componentId, current: x.current, proposed: x.proposal ? `${x.proposal.to}${x.proposal.axis ?? ''}` : null, reason: x.reason })), ops: f.filter((x) => x.proposal).map((x) => x.proposal.operation), evidence: f.filter((x) => x.proposal).map((x) => x.proposal.evidence).join(' ').slice(0, 480), unchanged: JSON.stringify(layer.currentPlan) === before, pending: !!layer.pendingEdit };
  });
  assert.ok(found.unchanged && !found.pending && found.ops.length > 0); row.table = found.table;
  row.geometryProposal = await review(page, base, found.ops, 'Primitivas alternativas', found.evidence, 'lantern', '2-v4-primitives');
  assert.ok(row.geometryProposal.changed.every((c) => c.geometryProv === 'inferred'), 'geometry provenance not recorded');
  assert.deepEqual(page.errors, []); await page.close(); records.push(row); console.log('lantern ok', JSON.stringify(found.table.filter((x) => x.proposed)));
}
await writeFile(`${out}/results.json`, JSON.stringify(records, null, 2)); await browser.close();
