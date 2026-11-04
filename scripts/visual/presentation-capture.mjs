// Evidence for the Presentation Director, captured in the REAL SpatialWorkspace (Chromium + SwiftShader, 1440x900).
//   mine  = a dev server of this branch        (tests/harness/presentation/index.html: workspace + PlanSpaceLayer + Director)
//   pr25  = a dev server of the PR #25 commit  (tests/harness/presentation/legacy.html: the same workspace, no Director)
// Inputs are plan fixtures; none of them is Meta output (see their `meta.model`).
//   node scripts/visual/presentation-capture.mjs --mine http://127.0.0.1:5193 --pr25 http://127.0.0.1:5194 --out reports/presentation-director
import { mkdir, writeFile, rename, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const args = {}; for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const mine = args.mine, pr25 = args.pr25, out = resolve(args.out ?? 'reports/presentation-director');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const results = { browser: 'Chromium (system) + SwiftShader', viewport: '1440x900', objects: {} };
const newPage = async (context) => { const page = await context.newPage(); const errors = []; page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message)); page.errors = errors; return page; };
const settle = (page, ms = 700) => page.evaluate((t) => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, t)))), ms);
const shot = async (page, name) => { await settle(page); await page.screenshot({ path: resolve(out, `${name}.png`) }); return `${name}.png`; };
const state = (page) => page.evaluate(() => window.__present.director.state);

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

  // --- Foundry premium reference: the excavator in the same workspace, untouched code path ---
  { const page = await newPage(context); await page.goto(`${pr25}/tests/harness/presentation/legacy.html`, { waitUntil: 'networkidle' }); await settle(page, 1800); results.foundryExcavator = await shot(page, 'foundry-excavator'); results.foundryErrors = page.errors; await page.close(); }

  for (const fixture of ['clock-like', 'bicycle', 'jet-engine']) {
    const entry = { fixture }; results.objects[fixture] = entry;
    // --- PR #25: the same workspace and the same plan, its own timed reveal, no Director ---
    { const page = await newPage(context); await page.goto(`${pr25}/tests/harness/presentation/legacy.html?fixture=${fixture}`, { waitUntil: 'networkidle' }); await page.evaluate(() => window.__present.ready); await settle(page, 1800); entry.pr25 = await shot(page, `pr25-${fixture}`); entry.pr25Errors = page.errors; await page.close(); }

    // --- new: cinematic entrance, captured at chosen build steps, then every other mode ---
    const page = await newPage(context);
    await page.goto(`${mine}/tests/harness/presentation/index.html?fixture=${fixture}`, { waitUntil: 'networkidle' }); await page.evaluate(() => window.__present.ready); await settle(page, 600);
    const gpuBefore = await page.evaluate(() => { const s = window.__present.ws.stats(); return { geometries: s.geometries, textures: s.textures, programs: s.programs }; });
    entry.sequence = await page.evaluate(() => window.__present.director.sequence.map((s) => ({ order: s.order, id: s.componentId, reason: s.reason })));
    entry.pointsOfInterest = await page.evaluate(() => window.__present.director.pointsOfInterest.map((p) => ({ id: p.id, kind: p.kind, label: p.label, why: p.why })));
    await page.evaluate(() => window.__present.director.playEntrance());
    const total = entry.sequence.length, wanted = [...new Set([1, Math.ceil(total / 3), Math.ceil((2 * total) / 3), total])]; entry.filmstrip = [];
    for (const n of wanted) { await page.waitForFunction((k) => window.__present.director.state.shown >= k || window.__present.director.state.phase !== 'entering', n, { timeout: 60_000 }); entry.filmstrip.push(await shot(page, `new-${fixture}-entrance-${String(n).padStart(2, '0')}`)); }
    await page.waitForFunction(() => window.__present.director.state.phase === 'exploring', null, { timeout: 60_000 }); entry.final = await shot(page, `new-${fixture}-final`);
    entry.cues = await page.evaluate(() => window.__present.cues.map((c) => ({ id: c.id, kind: c.kind, durationMs: c.durationMs, reason: c.reason })));

    // exploded view: reversible, announced as a visualisation
    await page.evaluate(() => window.__present.director.setExploded(1)); await page.waitForFunction(() => window.__present.director.state.exploded === 1 && !window.__present.director.update(0), null, { timeout: 30_000 });
    entry.exploded = await shot(page, `new-${fixture}-exploded`); entry.explodedState = await state(page);
    await page.evaluate(() => window.__present.director.setExploded(0)); await page.waitForFunction(() => window.__present.director.state.exploded === 0, null, { timeout: 30_000 });
    entry.afterExplodeNotice = (await state(page)).notice;

    // focus on a component (dims the rest, workspace selection untouched)
    const focusId = entry.sequence[Math.min(2, total - 1)].id;
    await page.evaluate((id) => window.__present.director.focus(id), focusId); await page.waitForFunction((id) => window.__present.director.state.focusId === id && !window.__present.director.update(0), focusId, { timeout: 30_000 }); entry.focus = await shot(page, `new-${fixture}-focus`); await page.evaluate(() => window.__present.director.focus(null)); await settle(page, 500);

    // point-of-interest tour
    await page.evaluate(() => window.__present.director.startTour()); await page.waitForFunction(() => window.__present.director.state.poiIndex === 0); await page.evaluate(() => window.__present.director.nextPoi()); await page.evaluate(() => window.__present.director.nextPoi());
    entry.tour = await shot(page, `new-${fixture}-tour`); entry.tourState = await state(page); await page.evaluate(() => window.__present.director.stopTour());

    // editing: the director steps aside; the plan is read-only for it
    await page.evaluate(() => window.__present.director.enterEditing()); entry.editingPhase = (await state(page)).phase; await page.evaluate(() => window.__present.director.resumeExploring());

    // teardown: no GPU object left behind by the Director
    await page.evaluate(() => window.__present.director.dispose()); await settle(page, 400);
    const gpuAfter = await page.evaluate(() => { const s = window.__present.ws.stats(); return { geometries: s.geometries, textures: s.textures, programs: s.programs }; });
    entry.gpu = { before: gpuBefore, afterDispose: gpuAfter, note: 'textures/geometries counted by the Foundry renderer; programs may grow (cached shader variants), they are not leaks' }; entry.errors = page.errors; await page.close();
    // reduced motion: the whole sequence in one step
    { const p = await newPage(context); await p.goto(`${mine}/tests/harness/presentation/index.html?fixture=${fixture}&rm=1`, { waitUntil: 'networkidle' }); await p.evaluate(() => window.__present.ready); entry.reducedMotion = await p.evaluate(async () => { const h = window.__present.director.playEntrance(); const r = await h.done; return { result: r, phase: window.__present.director.state.phase, cueDurations: window.__present.cues.map((c) => c.durationMs) }; }); await p.close(); }
  }

  // --- regression: the Foundry excavator, same workspace, on this branch vs the PR #25 commit ---
  { const page = await newPage(context); await page.goto(`${mine}/tests/harness/presentation/legacy.html`, { waitUntil: 'networkidle' }); await settle(page, 1800); await page.screenshot({ path: resolve(out, 'foundry-excavator-this-branch.png') }); await page.close(); }
  { const { readFile } = await import('node:fs/promises'); const { createHash } = await import('node:crypto'); const a = await readFile(resolve(out, 'foundry-excavator.png')), b = await readFile(resolve(out, 'foundry-excavator-this-branch.png')); results.excavatorRegression = { pr25Sha256: createHash('sha256').update(a).digest('hex'), thisBranchSha256: createHash('sha256').update(b).digest('hex'), identicalBytes: a.equals(b) }; }

  // --- phone-sized viewport: portrait framing, entrance, exploded view ---
  { const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); const page = await newPage(phone);
    await page.goto(`${mine}/tests/harness/presentation/index.html?fixture=clock-like`, { waitUntil: 'networkidle' }); await page.evaluate(() => window.__present.ready); await settle(page, 600);
    await page.evaluate(() => window.__present.director.playEntrance()); await page.waitForFunction(() => window.__present.director.state.phase === 'exploring', null, { timeout: 90_000 }); results.mobile = { final: await shot(page, 'mobile-clock-final') };
    await page.evaluate(() => window.__present.director.setExploded(1)); await page.waitForFunction(() => window.__present.director.state.exploded === 1 && !window.__present.director.update(0), null, { timeout: 60_000 }); results.mobile.exploded = await shot(page, 'mobile-clock-exploded'); results.mobile.errors = page.errors; await phone.close(); }

  // --- CPU cost of the Director per frame (idle, and while it animates), measured in the browser ---
  { const page = await newPage(context); await page.goto(`${mine}/tests/harness/presentation/index.html?fixture=clock-like`, { waitUntil: 'networkidle' }); await page.evaluate(() => window.__present.ready); await settle(page, 600);
    results.updateCost = await page.evaluate(() => { const d = window.__present.director, time = (n, f) => { const t = performance.now(); for (let i = 0; i < n; i++) f(); return (performance.now() - t) / n; };
      const idle = time(2000, () => d.update(0)); d.playEntrance(); let steps = 0; const t = performance.now(); while (d.state.phase === 'entering' && steps < 2000) { d.update(16); steps++; } const animating = (performance.now() - t) / Math.max(1, steps);
      return { idleMsPerCall: +idle.toFixed(4), entranceMsPerFrame: +animating.toFixed(4), entranceSimulatedFrames: steps, components: d.sequence.length }; }); await page.close(); }
  await writeFile(resolve(out, 'capture-result.json'), `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify({ objects: Object.fromEntries(Object.entries(results.objects).map(([k, v]) => [k, { steps: v.sequence.length, pois: v.pointsOfInterest.length, cues: v.cues.map((c) => c.kind), gpu: v.gpu, errors: v.errors, reduced: v.reducedMotion }])) }, null, 1));
} finally { await browser.close(); }
