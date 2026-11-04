// Full execution cycle of the V3 geometry in a REAL browser with a REAL Web Worker (Chromium + SwiftShader, 1440x900).
//   node scripts/visual/fidelity-cycle.mjs --host http://127.0.0.1:5195 --out reports/fidelity-v3
// Every check is a pass/fail with the measured values next to it; the result is written to cycle-result.json.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const args = {}; for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const out = resolve(args.out ?? 'reports/fidelity-v3'); await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const result = { browser: 'Chromium (system) + SwiftShader', worker: 'real module Worker', checks: [], data: {} };
const check = (name, pass, value) => { result.checks.push({ name, pass: !!pass, value }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${value === undefined ? '' : JSON.stringify(value)}`); };

async function open(query) {
  const page = await context.newPage(); const errors = []; page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${args.host}/tests/harness/fidelity/index.html?${query}`, { waitUntil: 'networkidle' }); await page.evaluate(() => window.__fid.ready);
  page.errors = errors; return page;
}
const settle = (page, ms = 400) => page.evaluate((t) => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, t)))), ms);
const waitIdle = (page, timeout = 60_000) => page.waitForFunction(() => { const f = window.__fid; return f.report && f.report.pending.length === 0; }, null, { timeout, polling: 25 });
const families = (page) => page.evaluate(() => { const o = {}; window.__fid.layer.root.traverse((m) => { if (m.isMesh && m.userData.spatialEntityId) o[m.userData.spatialEntityId] = m.userData.geometryFamily ?? 'procedural_v2'; }); return o; });

try {
  // ------------------------------------------------------------------------------------------------ 1 + 2: V2 immediately, Worker result later, nothing recreated
  {
    const page = await open('fixture=lungs-like&route=live'); await settle(page, 100);
    const first = await page.evaluate(() => window.__fid.firstFrame);
    check('1. V2 is what the very first frame shows (every component procedural_v2, V3 pending for all of them)', Object.values(first.families).every((f) => f === 'procedural_v2') && first.pending.length === Object.keys(first.families).length, first);
    await page.screenshot({ path: resolve(out, 'live-0-v2-immediate.png') });
    // state that must survive the arrival of the geometry
    const before = await page.evaluate(() => {
      const f = window.__fid, l = f.layer; f.ws.select('carina'); l.setExploded(true, true);
      const groups = {}; l.root.traverse((o) => { if (o.userData.spatialComponentRoot) groups[o.userData.spatialEntityId] = o; }); window.__groups = groups; window.__canvas = document.querySelector('canvas'); window.__planRef = l.currentPlan;
      return { planJson: JSON.stringify(l.currentPlan), selected: l.selectedId, exploded: l.isExploded, phase: l.presentation?.phase ?? null, positions: Object.fromEntries(Object.entries(groups).map(([k, g]) => [k, g.position.toArray()])), gpu: f.ws.stats(), jobsPosted: f.counters.messages, workers: f.counters.created };
    });
    const t0 = Date.now(); await waitIdle(page); const arrivalMs = Date.now() - t0; await settle(page, 600);
    const after = await page.evaluate(() => {
      const f = window.__fid, l = f.layer; let same = true; l.root.traverse((o) => { if (o.userData.spatialComponentRoot && window.__groups[o.userData.spatialEntityId] !== o) same = false; });
      return { planJson: JSON.stringify(l.currentPlan), planSameObject: l.currentPlan === window.__planRef, selected: l.selectedId, wsSelected: f.ws.selectedSpaceId, exploded: l.isExploded, phase: l.presentation?.phase ?? null, sameGroups: same, sameCanvas: document.querySelector('canvas') === window.__canvas,
        positions: Object.fromEntries(Object.entries(window.__groups).map(([k, g]) => [k, g.position.toArray()])), events: f.events, longTasks: f.longTasks, svc: f.service.stats(), counters: f.counters, report: { totals: f.report.totals, perFamily: f.report.perFamily, pending: f.report.pending, decisions: f.report.decisions.map((d) => ({ id: d.componentId, used: d.used, computed: d.computed, deviation: d.deviation ?? null, fallback: d.fallback })) }, gpu: f.ws.stats() };
    });
    const now = await families(page);
    check('2a. the result arrives from a real Worker and the components are updated', Object.values(now).some((f) => f === 'continuous_surface') && after.counters.created > 0 && after.counters.messages > 0, { arrivalMs, workers: after.counters.created, jobs: after.counters.messages, families: now });
    check('2b. the reviewed plan is untouched (same object, same JSON)', after.planSameObject && after.planJson === before.planJson);
    check('2c. no recreation: same component groups, same canvas/workspace', after.sameGroups && after.sameCanvas);
    check('2d. selection kept (layer and workspace)', after.selected === 'carina' && after.wsSelected === 'carina', { selected: after.selected, ws: after.wsSelected });
    check('2e. Cinema state kept: still exploded, same phase, same group offsets', after.exploded && after.phase === before.phase && JSON.stringify(after.positions) === JSON.stringify(before.positions), { phase: after.phase });
    check('2f. the swap itself is small on the main thread (each upgrade < 100 ms)', after.events.length > 0 && after.events.every((e) => e.ms < 100), after.events.map((e) => ({ ids: e.ids.length, ms: +e.ms.toFixed(1) })));
    result.data.cycle = { arrivalMs, longTasksMs: after.longTasks.map((n) => +n.toFixed(0)), gpuBefore: before.gpu, gpuAfter: after.gpu, service: after.svc, report: after.report };
    await page.evaluate(() => { window.__fid.layer.setExploded(false, true); window.__fid.ws.clearSelection(); }); await settle(page, 300);
    await page.screenshot({ path: resolve(out, 'live-1-v3-arrived.png') });

    // ------------------------------------------------------------------------------------------------ 3: edit and undo invalidate only what moved
    const kinds = await page.evaluate(async () => {
      const f = window.__fid, l = f.layer, wait = () => new Promise((r) => { const tick = () => (f.report.pending.length === 0 ? r(null) : setTimeout(tick, 20)); tick(); });
      const fp0 = f.fingerprint(l.root), m0 = f.counters.messages;
      f.ws.select('lung-left'); l.proposeEdit('x+'); await l.applyEdit(); const fpEdit = f.fingerprint(l.root), flashed = Object.entries(fpEdit).filter(([, v]) => v.family !== 'continuous_surface').map(([k]) => k);
      await wait(); const jobsAfterEdit = f.counters.messages - m0; const fp1 = f.fingerprint(l.root);
      const m1 = f.counters.messages; await l.undo(); const fpUndo = f.fingerprint(l.root), pendingAfterUndo = f.report.pending.length; await new Promise((r) => setTimeout(r, 300)); const jobsAfterUndo = f.counters.messages - m1;
      return { changedByEdit: Object.keys(fp1).filter((k) => fp1[k].hash !== fp0[k].hash), flashed, jobsAfterEdit, pendingAfterUndo, jobsAfterUndo, undoRestoresExactly: Object.keys(fp0).every((k) => fpUndo[k].hash === fp0[k].hash), components: Object.keys(fp0).length };
    });
    check('3a. an edit recomputes only the tasks whose key changed (not every component)', kinds.jobsAfterEdit < kinds.components, kinds);
    check('3b. undo recomputes nothing (cache) and restores the exact geometry', kinds.jobsAfterUndo === 0 && kinds.pendingAfterUndo === 0 && kinds.undoRestoresExactly, kinds);
    result.data.editUndo = kinds;

    // ------------------------------------------------------------------------------------------------ 4: out-of-date results never show
    const stale = await page.evaluate(async () => {
      const f = window.__fid, l = f.layer, wait = () => new Promise((r) => { const tick = () => (f.report.pending.length === 0 ? r(null) : setTimeout(tick, 20)); tick(); });
      f.ws.select('lung-right'); const tick = () => new Promise((r) => setTimeout(r, 5)); // operation ids carry a millisecond stamp
      for (const code of ['x+', 'x+', 'y+']) { l.proposeEdit(code); l.authorise(true); /* the first edit made the value user_provided: the next ones need the person's authorisation, as in the product */ await l.applyEdit(); await tick(); } // three versions of the plan in flight, no waiting between them
      await l.undo(); await tick(); l.proposeEdit('z+'); l.authorise(true); await l.applyEdit(); await wait(); await new Promise((r) => setTimeout(r, 400));
      const shown = f.fingerprint(l.root), fresh = f.syncFingerprint();
      return { shown, fresh, equal: Object.keys(fresh).every((k) => shown[k].hash === fresh[k].hash && shown[k].family === fresh[k].family), cancelled: f.service.stats().cancelled, completed: f.service.stats().completed, editCount: l.editCount };
    });
    check('4. after 5 quick plan versions (3 edits kept), what is drawn equals a fresh compile of the CURRENT plan, vertex for vertex', stale.equal && stale.editCount === 3, { editCount: stale.editCount, cancelled: stale.cancelled, completed: stale.completed });
    result.data.stale = { equal: stale.equal, cancelled: stale.cancelled, completed: stale.completed };

    // ------------------------------------------------------------------------------------------------ 6: Worker == inline
    const eq = await page.evaluate(() => { const f = window.__fid, shown = f.fingerprint(f.layer.root), sync = f.syncFingerprint(); const ids = Object.keys(sync).filter((k) => sync[k].family === 'continuous_surface'); return { compared: ids.length, identical: ids.filter((k) => shown[k]?.hash === sync[k].hash && shown[k].triangles === sync[k].triangles).length }; });
    check('6. the same task gives bit-identical vertices in the Worker and inline on the main thread', eq.compared > 0 && eq.compared === eq.identical, eq);
    result.data.workerInline = eq;
    check('no console errors in the cycle', page.errors.length === 0, page.errors.slice(0, 3));
    await page.close();
  }

  // ------------------------------------------------------------------------------------------------ 5a: timeout
  {
    const page = await open('fixture=microscope-like&route=live&timeout=1'); await waitIdle(page, 30_000); await settle(page, 300);
    const t = await page.evaluate(() => { const f = window.__fid, s = f.service.stats(); return { stats: s, fallbacks: [...new Set(f.report.decisions.filter((d) => d.fallback).map((d) => d.fallback.code))], used: [...new Set(f.report.decisions.map((d) => d.used))], counters: f.counters, selectable: f.ws.select('base') ?? true, selected: f.ws.selectedSpaceId }; });
    check('5a. a task over its time limit is killed, remembered as TIMEOUT, and the component stays on V2', t.stats.timeouts > 0 && t.fallbacks.includes('TIMEOUT') && t.used.join() === 'procedural_v2', t);
    check('5a. every worker started was terminated, the Space still works (selection)', t.counters.created === t.counters.terminated && t.selected === 'base', t.counters);
    await page.close();
  }

  // ------------------------------------------------------------------------------------------------ 5b: cancel, change of Space, dispose
  {
    const page = await open('fixture=lungs-like&route=live'); await settle(page, 50);
    const r = await page.evaluate(async () => {
      const f = window.__fid, gpu0 = f.ws.stats(), plan = JSON.parse(JSON.stringify(f.layer.currentPlan)), seen = [];
      // change of Space while jobs are still running, five times; each new Space drops the previous layer and its service
      for (let i = 0; i < 5; i++) {
        const old = f.layer, oldService = f.service, m = f.mount(plan, i % 2 ? 'v2' : 'live'); f.ws.showSpace(m.layer, { brandLabel: `switch ${i}` }); old.dispose(); oldService?.dispose(); seen.push(oldService ? oldService.stats() : null);
        await new Promise((res) => setTimeout(res, 60));
      }
      const lastEvents = f.events.length; await new Promise((res) => setTimeout(res, 800));
      const live = f.layer, svc = f.service; live.dispose(); svc?.dispose(); f.dropService(); const eventsAtDispose = f.events.length; await new Promise((res) => setTimeout(res, 800));
      return { counters: { ...f.counters }, disposedStats: seen.filter(Boolean).map((s) => ({ running: s.running, queued: s.queued, cacheEntries: s.cacheEntries })), lateEventsAfterDispose: f.events.length - eventsAtDispose, gpu0, gpu1: f.ws.stats(), lastEvents };
    });
    check('5b. after 5 Space changes with jobs running, every worker created was terminated', r.counters.created > 0 && r.counters.created === r.counters.terminated, r.counters);
    check('5b. a disposed service keeps nothing: no running, no queued, empty cache', r.disposedStats.every((s) => s.running === 0 && s.queued === 0 && s.cacheEntries === 0), r.disposedStats);
    check('5b. no result is written after dispose', r.lateEventsAfterDispose === 0, r.lateEventsAfterDispose);
    check('5b. GPU resources do not grow across Space changes (geometries/textures bounded by the one Space shown)', r.gpu1.geometries <= r.gpu0.geometries + 40 && r.gpu1.textures <= r.gpu0.textures + 40, { before: { g: r.gpu0.geometries, t: r.gpu0.textures }, after: { g: r.gpu1.geometries, t: r.gpu1.textures } });
    result.data.lifecycle = r;
    await page.close();
  }
  await writeFile(resolve(out, 'cycle-result.json'), `${JSON.stringify(result, null, 2)}\n`);
  const failed = result.checks.filter((c) => !c.pass); console.log(`\n${result.checks.length - failed.length}/${result.checks.length} checks passed`); process.exitCode = failed.length ? 1 : 0;
} finally { await browser.close(); }
