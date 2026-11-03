import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import assert from 'node:assert/strict';

// Digital Hand regressions while the Engineering Engine moves the machine (PR #15, section 5A).
process.env.UNFOLD_API_TARGET = 'http://127.0.0.1:9';
const port = Number(process.env.UNFOLD_WORKSPACE_HAND_PORT ?? 5307);
const server = await createServer({ server: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/living?example=1&debug-living=1&agent=fixture&rm=0`);
  await page.waitForFunction(() => window.__foundry?.ready, null, { timeout: 120000 });

  // Start a real engine move on the boom cylinder, then hold it mid-motion so every reading is deterministic.
  const started = await page.evaluate(async () => {
    const ws = window.__workspace;
    ws.select('boom_cylinder');
    const input = ws.el.inspector.querySelector('[data-el="engineTarget"]');
    input.value = '0.65'; ws.previewEngineMove(); ws.approveEngineMove();
    ws.pauseEngine(); ws.engineering.seek(ws.engineState().durationS * 0.4); ws.showEngineFrame(); ws.renderNow();
    return { time: ws.engineState().timeS, hand: ws.handView()?.targetId ?? null, pose: ws.poseSource };
  });
  assert.ok(started.time > 0 && started.hand === 'boom_cylinder' && started.pose === 'engine', JSON.stringify(started));
  console.log('PASS hand tracks a valid moving component');

  // The hand reads current transforms: moving the engine time moves the projected target.
  const tracked = await page.evaluate(() => {
    const ws = window.__workspace, a = ws.handView(); ws.engineering.seek(ws.engineState().durationS); ws.showEngineFrame(); ws.renderNow(); const b = ws.handView();
    return { dx: Math.hypot(a.x - b.x, a.y - b.y), target: b.targetId };
  });
  assert.ok(tracked.dx > 0.01 && tracked.target === 'boom_cylinder', JSON.stringify(tracked));
  console.log('PASS hand position follows the current pose');

  // Frame without a pose / blocked: no stale location, no pointing, no camera move; recovery restores tracking.
  const noPose = await page.evaluate(() => {
    const ws = window.__workspace, real = ws.engineering.frame.bind(ws.engineering), base = real();
    const make = (extra) => () => ({ ...base, ...extra });
    const out = {};
    ws.engineering.frame = make({ parts: [], status: 'blocked', blocked: { code: 'TARGET_BLOCKED', message: 'bloqueado' } });
    ws.showEngineFrame(); ws.renderNow();
    const cam = ws.foundry.camera.position.toArray();
    out.visible = ws.model.root.visible; out.hand = ws.handView()?.state ?? null; out.x = ws.handView()?.x ?? null;
    out.pointing = ws.pointAt('boom_cylinder', 'point', 'assistant'); out.cameraSame = JSON.stringify(cam) === JSON.stringify(ws.foundry.camera.position.toArray());
    ws.engineering.frame = real; ws.engineering.reset(); ws.showEngineFrame(); ws.select('boom_cylinder'); ws.renderNow();
    out.recovered = ws.handView()?.targetId ?? null; out.visibleAgain = ws.model.root.visible;
    return out;
  });
  assert.deepEqual(noPose, { visible: false, hand: 'hidden', x: null, pointing: { resolved: false, cameraMoved: false }, cameraSame: true, recovered: 'boom_cylinder', visibleAgain: true });
  console.log('PASS blocked frame (no pose) hides the hand and recovery restores it');

  // Target change in the middle of an experiment: the hand follows the new selection; the engine session is untouched.
  const retarget = await page.evaluate(() => {
    const ws = window.__workspace; ws.resetPose(); ws.select('boom_cylinder');
    const input = ws.el.inspector.querySelector('[data-el="engineTarget"]'); input.value = '0.65'; ws.previewEngineMove(); ws.approveEngineMove(); ws.pauseEngine();
    ws.engineering.seek(ws.engineState().durationS * 0.5); ws.showEngineFrame();
    const time = ws.engineState().timeS; ws.select('stick_cylinder'); ws.renderNow();
    return { time, after: ws.engineState().timeS, target: ws.handView()?.targetId ?? null, proposal: ws.engineProposal };
  });
  assert.equal(retarget.after, retarget.time); assert.equal(retarget.target, 'stick_cylinder'); assert.equal(retarget.proposal, null);
  console.log('PASS changing target mid-experiment keeps the session and retargets the hand');

  // Isolation and hiding: the hand stays on a visible, current mesh and releases when the target is hidden.
  const isolation = await page.evaluate(() => {
    const ws = window.__workspace; ws.select('stick_cylinder'); ws.scene.isolate(ws.registry.get('stick_cylinder')); ws.renderNow();
    const isolated = ws.handView()?.targetId ?? null;
    ws.scene.isolate(ws.registry.get('boom_cylinder')); ws.renderNow(); const other = ws.handView();
    ws.scene.isolate(null); ws.renderNow();
    return { isolated, otherTarget: other?.targetId ?? null, otherState: other?.state ?? null, restored: ws.handView()?.targetId ?? null };
  });
  assert.equal(isolation.isolated, 'stick_cylinder'); assert.ok(isolation.otherTarget === null || isolation.otherTarget === 'stick_cylinder', 'isolation never retargets the hand to another component'); assert.equal(isolation.restored, 'stick_cylinder');
  console.log('PASS isolation never retargets the hand and unisolating restores tracking');

  // Manual camera movement during playback: motion keeps running and the hand is re-projected, not frozen.
  const camera = await page.evaluate(async () => {
    const ws = window.__workspace; ws.resetPose(); ws.select('boom_cylinder');
    const input = ws.el.inspector.querySelector('[data-el="engineTarget"]'); input.value = '0.65'; ws.previewEngineMove(); ws.approveEngineMove();
    const t0 = ws.engineState().timeS; ws.renderNow(); const a = ws.handView();
    const cam = ws.foundry.camera; cam.position.x += 0.6; cam.lookAt(0, 0.8, 0); cam.updateMatrixWorld(true); ws.renderNow(); const b = ws.handView();
    window.__t0 = t0;
    return { moved: Math.hypot(a.x - b.x, a.y - b.y) };
  });
  await page.waitForFunction(() => window.__workspace.engineState().timeS > window.__t0, null, { timeout: 60000 });
  Object.assign(camera, await page.evaluate(() => { const ws = window.__workspace, s = ws.engineState(); ws.renderNow(); return { advanced: true, target: ws.handView()?.targetId ?? null, playing: s.playing || s.timeS >= s.durationS }; }));
  assert.ok(camera.moved > 0.005 && camera.advanced && camera.target === 'boom_cylinder' && camera.playing, JSON.stringify(camera));
  console.log('PASS manual camera movement during playback re-projects the hand');

  // Lifecycle: disposing during playback leaves no frame loop, no further engine activity and no console errors.
  const disposed = await page.evaluate(async () => {
    const ws = window.__workspace; ws.resetPose(); ws.select('boom_cylinder');
    const input = ws.el.inspector.querySelector('[data-el="engineTarget"]'); input.value = '0.65'; ws.previewEngineMove(); ws.approveEngineMove();
    const playingBefore = ws.engineState().playing;
    let raf = 0; const orig = window.requestAnimationFrame; window.requestAnimationFrame = (cb) => { raf += 1; return orig(cb); };
    ws.dispose(); ws.dispose();
    const rafAfterDispose = raf; await new Promise((r) => setTimeout(r, 500)); window.requestAnimationFrame = orig;
    let closed = false; try { ws.engineFrame(); } catch (e) { closed = /ENGINE_SESSION_CLOSED/.test(String(e.message)); }
    return { playingBefore, engineRaf: ws.engineRaf, closed, rafAfterDispose, rafLater: raf };
  });
  assert.equal(disposed.playingBefore, true); assert.equal(disposed.engineRaf, 0); assert.equal(disposed.closed, true);
  console.log('PASS dispose during playback stops the engine loop and closes the session');

  assert.deepEqual(errors, []);
} finally { await browser.close(); await server.close(); }
