// New Space in the main /living workspace: New Space → text/image → Muse Spark → human review → 3D → select/camera/edit/undo.
//   UNFOLD_SPACE_MODE=mock  (default) answers the plan route with a labelled fixture: no Meta call.
//   UNFOLD_SPACE_MODE=live  calls the real backend (needs MODEL_API_KEY in the backend process; one paid call per run).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const mode = process.env.UNFOLD_SPACE_MODE ?? 'mock';
const base = process.env.UNFOLD_SPACE_URL ?? 'http://127.0.0.1:5191';
const out = resolve(process.env.UNFOLD_SPACE_OUT ?? `reports/space-integration/runs/${mode === 'live' ? 'real-meta' : 'mock-fixture'}`);
const rawDir = resolve(process.env.UNFOLD_SPACE_RAW ?? 'reports/space-integration/raw');
const prompt = process.env.UNFOLD_SPACE_PROMPT ?? 'Um relógio de pêndulo de pé: caixa alta de madeira, mostrador redondo com ponteiros, pêndulo com disco de latão e pés.';
const imagePath = process.env.UNFOLD_SPACE_IMAGE;
const viewport = { width: Number(process.env.UNFOLD_SPACE_W ?? 1440), height: Number(process.env.UNFOLD_SPACE_H ?? 900) };
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const videoDir = process.env.UNFOLD_SPACE_VIDEO ? resolve(process.env.UNFOLD_SPACE_VIDEO) : null;
const context = await browser.newContext({ viewport, deviceScaleFactor: 1, ...(videoDir ? { recordVideo: { dir: videoDir, size: { width: Math.min(viewport.width, 1280), height: Math.round(Math.min(viewport.width, 1280) * viewport.height / viewport.width) } } } : {}) });
const page = await context.newPage();
const errors = [], calls = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
let planRequest = null;
page.on('request', (r) => { if (r.url().includes('/api/')) calls.push(`${r.method()} ${new URL(r.url()).pathname}`); if (r.url().endsWith('/api/spatial/v2/plan')) { try { const b = JSON.parse(r.postData() ?? '{}'); planRequest = { sourceKind: b.sourceKind, hasInstruction: typeof b.instruction === 'string', imageMime: typeof b.imageDataUrl === 'string' ? b.imageDataUrl.slice(5, b.imageDataUrl.indexOf(';')) : null, maxRefinements: b.maxRefinements }; } catch { planRequest = { unreadable: true }; } } });
let planReply = null;
page.on('response', async (r) => { if (r.url().endsWith('/api/spatial/v2/plan') && r.ok()) { try { planReply = await r.json(); } catch { /* body consumed by route.fulfill in mock */ } } });
if (mode === 'mock') {
  // UNFOLD_SPACE_REPLAY=<stored raw-run file> replays a real run's normalised plan locally (no Meta call); otherwise a labelled fixture is used
  let fixture = JSON.parse(await readFile(resolve('reports/visual-recovery/fixtures/bicycle.json'), 'utf8'));
  if (process.env.UNFOLD_SPACE_REPLAY) {
    const stored = JSON.parse(await readFile(resolve(process.env.UNFOLD_SPACE_REPLAY), 'utf8'));
    fixture = { ...fixture, plan: stored.normalizedPlan, sceneSummary: { ...fixture.sceneSummary }, meta: { model: 'replay-of-stored-run', requestId: stored.requestId, latencyMs: stored.latencyMs, estimatedCostUsd: 0 } };
  }
  await page.route('**/api/spatial/v2/plan', async (route) => { await new Promise((r) => setTimeout(r, 1800)); await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...fixture, meta: { ...fixture.meta, rawResponseStored: false, rawResponseSha256: null } }) }); });
}
const extras = mode === 'mock' || process.env.UNFOLD_SPACE_LIVE_EXTRAS === '1';
if (mode === 'mock') {
  // paid routes only; adopt, operation and undo are local and go to the real backend
  await page.route('**/api/spatial/v2/edit', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    const target = await page.evaluate(() => window.__space.layer.currentPlan.components.at(-1).id);
    const position = await page.evaluate((id) => window.__space.layer.currentPlan.components.find((c) => c.id === id).transform.position, target);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ contract: 'unfold.spatial-v2-proposal.v1', sessionId: body.sessionId, revision: body.baseRevision, applied: false, operation: { contract: 'unfold.spatial-operation.v2', operationId: 'meta-mock-1', kind: 'set-transform', componentId: target, nodeKey: null, value: { position: [position[0], position[1] + 0.6, position[2]], rotationRad: [0, 0, 0], scale: [1, 1, 1] } }, meta: { estimatedCostUsd: 0 } }) });
  });
  await page.route('**/api/spatial/v2/evaluate', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ contract: 'unfold.spatial-evaluation.v1', sessionId: body.sessionId, revision: body.baseRevision, evaluation: { contract: 'unfold.spatial-evaluation.v1', recognizabilityScore: 70, silhouetteScore: 65, spatialIntegrityScore: 72, confidence: 0.6, discrepancies: [{ componentId: null, kind: 'other', severity: 'low', observation: 'Mock evaluation.' }], suggestedOperation: null, rationale: 'mock' }, suggestionStatus: 'none', refinementBudget: { maximum: 1, used: 0 }, constraintReport: {}, meta: { estimatedCostUsd: 0 }, limitations: [] }) });
  });
}
const shot = async (name, opts = {}) => { await page.waitForTimeout(500); await page.screenshot({ path: resolve(out, `${name}.png`), ...opts }); return `${name}.png`; };
const steps = {};
// on a real model answer, content quality is something to RECORD, not to assert away: the run must finish and report what it saw
const softFailures = [];
const quality = (condition, message) => { if (condition) return; if (mode === 'live' || process.env.UNFOLD_SPACE_REPLAY) softFailures.push(message); else assert.fail(message); };
const openEdit = () => page.evaluate(() => document.querySelector('.sp-edit')?.setAttribute('open', ''));
try {
  await page.goto(`${base}/living?debug-living&rm=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-space="open"]');
  // Test-only profiling: RAF cadence and renderer main-thread call time are separate samples.
  await page.evaluate(() => {
    const w = window.__workspace, renderer = w.foundry;
    const profile = window.__temporal = { phase: 'setup', samples: [], raf: [], requests: [], lastRaf: null };
    const render = renderer.renderNow.bind(renderer), request = renderer.requestRender.bind(renderer);
    renderer.renderNow = () => { const phase = profile.phase, t = performance.now(); try { return render(); } finally { profile.samples.push({ phase, ms: performance.now() - t }); } };
    renderer.requestRender = () => { if (profile.phase === 'idle') profile.requests.push({ at: performance.now(), stack: new Error().stack }); return request(); };
    const tick = (t) => { if (profile.lastRaf !== null && profile.phase !== 'setup') profile.raf.push({ phase: profile.phase, ms: t - profile.lastRaf }); profile.lastRaf = t; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  steps.entry = await shot('01-entry');
  const gpuBefore = await page.evaluate(() => { const st = window.__workspace.stats(); return { geometries: st.geometries, textures: st.textures, programs: st.programs }; });

  await page.click('[data-space="open"]');
  await page.waitForSelector('.sp-root[data-phase="intake"]');
  steps.newSpace = await shot('02-new-space');

  if (imagePath) await page.setInputFiles('#sp-file', imagePath);
  else await page.fill('#sp-text', prompt);
  await page.waitForSelector('[data-sp="submit"]:not([disabled])');
  const started = Date.now();
  await page.click('[data-sp="submit"]');
  await page.waitForSelector('.sp-root[data-phase="waiting"]');
  steps.waiting = await shot('03-waiting');
  await page.waitForSelector('.sp-root[data-phase="review"], .sp-root[data-phase="failed"]', { timeout: Number(process.env.UNFOLD_SPACE_TIMEOUT ?? 180_000) });
  const phase = await page.getAttribute('.sp-root', 'data-phase');
  if (phase === 'failed') {
    steps.failed = await shot('04-failed');
    const failure = await page.evaluate(() => window.__space.failure);
    await writeFile(resolve(out, 'blocked.json'), `${JSON.stringify({ mode, prompt, failure, calls, at: new Date().toISOString() }, null, 2)}\n`);
    console.log(JSON.stringify({ blocked: failure }));
    process.exitCode = 2; throw new Error('BLOCKED');
  }
  const latencyMs = Date.now() - started;
  if (imagePath) assert.equal(planRequest?.sourceKind, 'image', 'a photograph is sent as an image request');
  else assert.equal(planRequest?.sourceKind, 'text');
  steps.review = await shot('04-review');
  const reviewState = await page.evaluate(() => ({ components: window.__space.reply.plan.components.length, title: window.__space.reply.plan.title }));
  // the build button must stay disabled until every component is decided and the plan is acknowledged
  assert.equal(await page.isDisabled('[data-sp="build"]'), true, 'build must be blocked before review');
  await page.click('[data-sp="keep-all"]');
  assert.equal(await page.isDisabled('[data-sp="build"]'), true, 'build must be blocked until acknowledged');
  // a rejected component leaves the built scene (the last one in the list, whatever it is)
  // the rejection path is exercised on the labelled fixture only; a real or replayed model plan is built whole, so what is on screen is what the model proposed
  const rejectId = mode === 'mock' && !process.env.UNFOLD_SPACE_REPLAY ? await page.evaluate(() => window.__space.reply.plan.components.at(-1).id) : null;
  if (rejectId) await page.click(`[data-sp-decide="reject"][data-id="${rejectId}"]`);
  await page.check('#sp-ack');
  assert.equal(await page.isDisabled('[data-sp="build"]'), false);
  steps.reviewed = await shot('05-reviewed');
  await page.evaluate(() => { window.__temporal.phase = 'construction'; });
  await page.click('[data-sp="build"]');
  await page.waitForFunction(() => window.__workspace.spaceActive);
  await page.evaluate(() => { window.__temporal.phase = 'arrival'; });
  await page.waitForTimeout(800);
  steps.built = await shot('06-built');
  const builtIds = await page.evaluate(() => window.__space.layer.currentPlan.components.map((c) => c.id));
  if (rejectId) assert.ok(!builtIds.includes(rejectId), 'a rejected component is not built'); else assert.equal(builtIds.length, reviewState.components, 'every proposed component is built');
  assert.ok(builtIds.length >= 1);

  // coverage of the frame by the object: same view with and without the layer, chrome hidden (focus mode)
  await page.keyboard.press('f'); await page.waitForTimeout(400);
  const coverage = await page.evaluate(async () => {
    const w = window.__workspace, layer = window.__space.layer;
    const grab = async () => { w.renderNow(); await new Promise((r) => setTimeout(r, 50)); w.renderNow(); return w.root.querySelector('canvas').toDataURL('image/png'); };
    const read = async (url) => { const img = new Image(); img.src = url; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
    const canvas = w.root.querySelector('canvas');
    // preserveDrawingBuffer is off: read in the same task as the render
    const frame = () => { w.renderNow(); return canvas.toDataURL('image/png'); };
    layer.root.visible = false; const empty = frame(); layer.root.visible = true; const full = frame();
    const a = await read(empty), b = await read(full); let diff = 0, lumaMax = 0, lumaSum = 0; const n = b.length / 4;
    for (let i = 0; i < b.length; i += 4) { const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); if (d > 24) diff++; const l = 0.2126 * b[i] + 0.7152 * b[i + 1] + 0.0722 * b[i + 2]; lumaSum += l; lumaMax = Math.max(lumaMax, l); }
    return { width: canvas.width, height: canvas.height, objectFraction: diff / n, meanLuma: lumaSum / n, maxLuma: lumaMax };
  });
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  quality(coverage.maxLuma > 40 && coverage.objectFraction > 0.04, `the object must be visible in the frame: ${JSON.stringify(coverage)}`);

  // camera: orbit with the mouse, then the tool that resets the view
  const before = await page.evaluate(() => window.__workspace.cameraState().position);
  const box = await page.locator('[data-el="stage"]').boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.8); await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.74, { steps: 12 }); await page.mouse.up();
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => window.__workspace.cameraState().position);
  assert.notDeepEqual(after.map((v) => +v.toFixed(2)), before.map((v) => +v.toFixed(2)), 'orbit must move the camera');
  steps.orbited = await shot('07-orbited');
  await page.keyboard.press('r'); await page.waitForTimeout(1200);

  // selection by real pointer picks
  const picked = new Map();
  for (let gy = 0; gy < 9 && picked.size < 4; gy++) for (let gx = 0; gx < 13 && picked.size < 4; gx++) {
    await page.mouse.click(box.x + box.width * (0.22 + gx * 0.05), box.y + box.height * (0.18 + gy * 0.075));
    const id = await page.evaluate(() => window.__workspace.selectedSpaceId);
    if (id && !picked.has(id)) { picked.set(id, [gx, gy]); if (picked.size === 1) { await page.waitForTimeout(300); steps.selected = await shot('08-selected'); } }
  }
  quality(picked.size >= 2, `at least two distinct components must be selectable by pointer, got ${picked.size}`);
  if (picked.size < 1) for (const id of (await page.evaluate(() => window.__space.layer.currentPlan.components.map((c) => c.id))).slice(0, 1)) { await page.evaluate((i) => window.__workspace.select(i), id); picked.set(id, [0, 0]); }

  // edit: preview → apply (+X), then undo
  const id = [...picked.keys()][0];
  await page.evaluate((i) => window.__workspace.select(i), id);
  assert.equal(await page.evaluate(() => window.__workspace.selectedSpaceId), id);
  const posBefore = await page.evaluate((i) => window.__space.layer.currentPlan.components.find((c) => c.id === i).transform.position, id);
  await openEdit(); await page.click('[data-edit="x+"]');
  await page.waitForSelector('[data-apply]');
  steps.preview = await shot('09-edit-preview');
  const needsAuth = await page.locator('[data-auth]').count();
  if (needsAuth) await page.check('[data-auth]');
  await page.evaluate(() => { window.__temporal.phase = 'edit'; });
  await page.click('[data-apply]');
  await page.waitForTimeout(400);
  const edited = await page.evaluate((i) => { const c = window.__space.layer.currentPlan.components.find((x) => x.id === i); return { position: c.transform.position, origin: c.provenance.transform }; }, id);
  assert.notDeepEqual(edited.position, posBefore, 'apply must move the component');
  assert.equal(edited.origin, 'user_provided');
  steps.edited = await shot('10-edited');
  assert.equal(await page.evaluate(() => window.__workspace.selectedSpaceId), id, 'selection survives an edit');
  await page.evaluate(() => { window.__temporal.phase = 'undo'; });
  await page.click('[data-undo]');
  await page.waitForTimeout(400);
  const restored = await page.evaluate((i) => window.__space.layer.currentPlan.components.find((c) => c.id === i).transform.position, id);
  assert.deepEqual(restored, posBefore, 'undo restores the position');
  // colour edit goes through the same preview
  await page.evaluate(() => { const i = document.querySelector('[data-edit-colour]'); i.value = '#2d6cdf'; i.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForSelector('[data-apply]'); if (await page.locator('[data-auth]').count()) await page.check('[data-auth]'); await page.click('[data-apply]'); await page.waitForTimeout(300);
  steps.recoloured = await shot('11-recoloured');
  await page.click('[data-undo]'); await page.waitForTimeout(300);
  // isolate + frame tools
  await page.click('[data-el="toolIsolate"]'); await page.waitForTimeout(500); steps.isolated = await shot('12-isolated');
  await page.click('[data-el="toolIsolate"]'); await page.click('[data-el="toolFrame"]'); await page.waitForTimeout(1200); steps.framed = await shot('13-framed');
  // the renderer idles: with nothing moving, no frames are drawn
  await page.waitForFunction(() => window.__space.layer.presentation?.phase !== 'entering' && (window.__space.layer.geometryReport?.pending.length ?? 0) === 0, null, { timeout: 120000 });
  // OrbitControls damping can still request frames after the fixed animation delay.
  // Require a quiet window before measuring; a persistent loop still times out.
  await page.waitForFunction(() => {
    const now = performance.now(), frames = window.__workspace.stats().frames;
    const state = window.__idleProbe ?? (window.__idleProbe = { frames, since: now });
    if (frames !== state.frames) { state.frames = frames; state.since = now; }
    return now - state.since >= 1000;
  }, null, { timeout: 30000, polling: 100 });
  await page.evaluate(() => { window.__temporal.phase = 'idle'; });
  const idleFrames = await page.evaluate(async () => { const a = window.__workspace.stats().frames; await new Promise((r) => setTimeout(r, 2000)); return window.__workspace.stats().frames - a; });
  const temporal = await page.evaluate(() => window.__temporal);
  await writeFile(resolve(out, 'temporal.json'), JSON.stringify({ ...temporal, idleFrames }, null, 2));
  assert.ok(idleFrames <= 2, `an idle Space must not keep rendering (${idleFrames} frames in 2 s)`);
  // evidence
  await page.click('[data-el="toolMore"]'); await page.click('[data-el="toolEvidence"]'); await page.waitForTimeout(300); steps.evidence = await shot('14-evidence');
  await page.click('[data-el="toolEvidence"]');
  // exploded view: generic, display only, restores exactly
  const planBefore = await page.evaluate(() => JSON.stringify(window.__space.layer.currentPlan));
  await page.click('[data-el="toolExplode"]'); await page.waitForTimeout(1000);
  assert.equal(await page.evaluate(() => window.__space.layer.isExploded), true);
  steps.exploded = await shot('13b-exploded');
  assert.equal(await page.evaluate(() => JSON.stringify(window.__space.layer.currentPlan)), planBefore, 'exploding never changes the plan');
  await page.click('[data-el="toolExplode"]'); await page.waitForTimeout(1000);
  assert.equal(await page.evaluate(() => window.__space.layer.isExploded), false);
  // the server session mirrors the Space (edits, undo) so the paid proposals can rely on it
  assert.ok(await page.evaluate(() => !!window.__space.session), 'a server session exists for the Space on stage');
  const revisionBefore = await page.evaluate(() => window.__space.session.revision);
  assert.ok(revisionBefore >= 2, 'edit + undo + colour edit + undo were mirrored to the server');
  // Meta edit in proposal mode: previewed, blocked without authorisation, applied after it, undone
  if (extras) {
    const metaBefore = await page.evaluate(() => JSON.stringify(window.__space.layer.currentPlan));
    await page.fill('[data-el="input"]', 'Raise the last part a little.'); await page.keyboard.press('Enter');
    await page.waitForSelector('.sp-pending[data-source="meta"]', { timeout: 120000 });
    assert.equal(await page.evaluate(() => JSON.stringify(window.__space.layer.currentPlan)), metaBefore, 'a proposal changes nothing');
    steps.proposal = await shot('13c-meta-proposal');
    await page.click('[data-apply]'); await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => JSON.stringify(window.__space.layer.currentPlan)), metaBefore, 'applying without authorisation is refused');
    await page.check('[data-auth]'); await page.click('[data-apply]'); await page.waitForTimeout(600);
    assert.notEqual(await page.evaluate(() => JSON.stringify(window.__space.layer.currentPlan)), metaBefore, 'authorised proposal is applied');
    await page.click('[data-undo]'); await page.waitForTimeout(600);
    assert.equal(await page.evaluate(() => JSON.stringify(window.__space.layer.currentPlan)), metaBefore);
    // verified capture + visual evaluation (hypothesis only)
    await page.click('[data-extra="space-eval"]');
    await page.waitForFunction(() => /Hipótese visual|Captura rejeitada|Avaliação indisponível/.test(document.body.innerText), null, { timeout: 120000 });
    const verdictText = await page.evaluate(() => document.body.innerText.match(/Hipótese visual[^\n]*|Captura rejeitada[^\n]*|Avaliação indisponível[^\n]*/)?.[0]);
    if (!/Hipótese visual/.test(verdictText)) console.error('capture analysis', JSON.stringify(await page.evaluate(() => { const c = window.__workspace.captureSpaceFrame(); return c && { analysis: c.analysis, verdict: c.verdict, dataUrl: c.dataUrl }; }).then(async (r) => { if (r?.dataUrl) await writeFile(resolve(out, 'zz-capture.png'), Buffer.from(r.dataUrl.split(',')[1], 'base64')); delete r.dataUrl; return r; })));
    assert.match(verdictText, /Hipótese visual/, verdictText);
    steps.evaluated = await shot('13d-visual-evaluation');
    await page.evaluate(() => window.__space.layer.cancelPending());
  }
  // save → leave guard → My Spaces → reopen → delete
  await page.evaluate(() => localStorage.clear());
  await page.click('[data-extra="space-save"]'); await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => window.__space.dirty), false, 'saved Space is not dirty');
  const savedPlan = await page.evaluate(() => JSON.stringify(window.__space.layer.currentPlan));
  await page.evaluate((i) => window.__workspace.select(i), id);
  await openEdit(); await page.click('[data-edit="y+"]'); await page.check('[data-auth]').catch(() => {}); await page.click('[data-apply]'); await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => window.__space.dirty), true, 'an edit after saving makes it dirty');
  await page.click('[data-extra="space-exit"]'); await page.waitForSelector('.sp-root[data-phase="leaving"]');
  steps.leaving = await shot('13e-leave-guard');
  await page.click('[data-sp="stay"]'); await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__workspace.spaceActive), true, 'staying keeps the Space on stage');
  await page.click('[data-extra="space-save"]'); await page.waitForTimeout(500);
  await page.click('[data-extra="space-library"]'); await page.waitForSelector('.sp-root[data-phase="library"]');
  assert.equal(await page.evaluate(() => window.__workspace.spaceActive), false, 'the library frees the Space on stage');
  assert.equal(await page.locator('[data-sp-open]').count(), 1);
  steps.library = await shot('13f-my-spaces');
  await page.click('[data-sp-open]'); await page.waitForFunction(() => window.__workspace.spaceActive); await page.waitForTimeout(1200);
  const reopened = await page.evaluate(() => JSON.stringify(window.__space.layer.currentPlan));
  assert.notEqual(reopened, savedPlan, 'the later save replaced the first one'); assert.equal(await page.evaluate(() => window.__space.dirty), false);
  steps.reopened = await shot('13g-reopened');
  assert.ok(await page.evaluate(() => !!window.__space.session), 'a reopened Space gets a fresh server session');
  await page.click('[data-extra="space-library"]'); await page.waitForSelector('.sp-root[data-phase="library"]');
  await page.click('[data-sp-ask-delete]'); await page.click('[data-sp-delete]'); await page.waitForTimeout(400);
  assert.equal(await page.locator('[data-sp-open]').count(), 0, 'deleted');
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('unfold.space.v1:')).length), 0);
  await page.click('[data-sp="new"]'); await page.waitForSelector('.sp-root[data-phase="intake"]');
  // back on stage for the rest of the run is not needed: leave through the lab entry
  await page.click('[data-sp="exit"]'); await page.waitForSelector('[data-space="open"]');
  await page.waitForSelector('[data-space="open"]');
  steps.back = await shot('15-back-to-entry');
  const gpuAfter = await page.evaluate(() => { window.__workspace.renderNow(); const st = window.__workspace.stats(); return { geometries: st.geometries, textures: st.textures, programs: st.programs }; });
  assert.ok(gpuAfter.geometries <= gpuBefore.geometries + 2 && gpuAfter.textures <= gpuBefore.textures + 2, `leaving the space must free its GPU resources: ${JSON.stringify({ gpuBefore, gpuAfter })}`);

  assert.deepEqual(errors, [], 'browser console must stay clean');
  const plan = planReply?.plan ?? null;
  const record = {
    mode, url: `${base}/living`, viewport, browser: 'Chromium (system) + SwiftShader', at: new Date().toISOString(),
    input: imagePath ? { kind: 'image', path: imagePath } : { kind: 'text', prompt, promptSha256: createHash('sha256').update(prompt).digest('hex') },
    latencyMsToReview: latencyMs, review: { ...reviewState, rejected: rejectId, built: builtIds },
    meta: planReply ? { model: planReply.meta?.model, requestId: planReply.meta?.requestId, latencyMs: planReply.meta?.latencyMs, estimatedCostUsd: planReply.meta?.estimatedCostUsd, rawResponseSha256: planReply.meta?.rawResponseSha256, rawResponseStored: planReply.meta?.rawResponseStored } : null,
    normalizedPlan: plan ? { title: plan.title, units: plan.units, components: plan.components.map((c) => ({ id: c.id, label: c.label, parentId: c.parentId, origin: c.provenance.geometry })), unknowns: plan.unknowns, sceneSummary: planReply.sceneSummary } : null,
    coverage, distinctSelectable: [...picked.keys()], edit: { componentId: id, from: posBefore, to: edited.position, originAfter: edited.origin, undone: true },
    gpu: { before: gpuBefore, afterLeaving: gpuAfter }, qualityChecksFailed: softFailures, humanRecognition: null, apiCalls: calls, planRequest, consoleErrors: errors, screenshots: steps,
  };
  // the raw response is kept server-side only (owner-only file, git-ignored); only its hash is carried here, and it must match the file
  if (mode === 'live' && record.meta?.rawResponseStored) {
    const files = (await readdir(rawDir)).filter((f) => f.startsWith('spatial-run-'));
    const matches = [];
    for (const f of files) { const j = JSON.parse(await readFile(resolve(rawDir, f), 'utf8')); if (j.rawResponseSha256 === record.meta.rawResponseSha256) matches.push({ file: f, shaOfStoredText: createHash('sha256').update(j.rawResponseText, 'utf8').digest('hex'), bytes: j.rawResponseText.length }); }
    assert.equal(matches.length, 1, 'exactly one stored raw response matches the hash');
    assert.equal(matches[0].shaOfStoredText, record.meta.rawResponseSha256);
    record.rawResponse = { ...matches[0], location: 'reports/space-integration/raw/ (git-ignored, mode 0600)' };
  }
  await writeFile(resolve(out, 'e2e-result.json'), `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, mode, components: reviewState.components, coverage, selectable: picked.size, meta: record.meta }, null, 2));
} catch (error) {
  if (error.message !== 'BLOCKED') { await shot('zz-failure').catch(() => {}); console.error(error); console.error('console errors:', errors); process.exitCode = 1; }
} finally { await context.close(); await browser.close(); }
