import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import assert from 'node:assert/strict';

/**
 * Lifecycle of the one persistent workspace: GPU resources do not grow when the machine is replaced or cleared over and over,
 * and disposing in the middle of the machine's entry animation leaves nothing running.
 * Run: npx tsx tests/e2e/unified-lifecycle.pw.ts   (env: CHROME_PATH, UNFOLD_LIFECYCLE_PORT)
 */
process.env.UNFOLD_API_TARGET = 'http://127.0.0.1:9';
const port = Number(process.env.UNFOLD_LIFECYCLE_PORT ?? 5331);
const vite = await createServer({ server: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'error' });
await vite.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const errors: string[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/living?example=1&debug-living=1&rm=0&agent=fixture`);
  await page.waitForFunction(() => (window as any).__foundry?.ready, null, { timeout: 120000 });
  const mem = () => page.evaluate(() => { const i = (window as any).__workspace.foundry.renderer.info; return { geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length ?? 0, canvases: document.querySelectorAll('.uw-stage canvas').length }; });
  const replace = () => page.evaluate(() => { const ws = (window as any).__workspace; ws.replaceAssembly(ws.options.assembly, { reveal: false }); ws.renderNow(); });
  const clear = () => page.evaluate(() => { const ws = (window as any).__workspace; ws.clearMachine({}); ws.renderNow(); });
  await replace(); const shown = await mem();
  await clear(); const empty = await mem();
  for (let i = 0; i < 8; i++) {
    await replace(); assert.deepEqual(await mem(), shown, `cycle ${i + 1}: a shown machine uses the same GPU resources`);
    await clear(); assert.deepEqual(await mem(), empty, `cycle ${i + 1}: the empty stage uses the same GPU resources`);
  }
  console.log(`PASS 8 replace/clear cycles keep GPU resources constant (shown ${JSON.stringify(shown)}, empty ${JSON.stringify(empty)})`);
  const r = await page.evaluate(async () => { const ws = (window as any).__workspace; ws.replaceAssembly(ws.options.assembly, { reveal: true }); const running = ws.revealTween !== null; ws.dispose(); const stopped = ws.revealTween === null; await new Promise((res) => setTimeout(res, 1500)); return { running, stopped }; });
  assert.deepEqual(r, { running: true, stopped: true });
  console.log('PASS dispose during the entry animation stops it at once');

  // ---- webcam hand control: leaving a machine must end the capture, whatever the way out, even if the permission arrives late
  const cam = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  cam.on('pageerror', (e) => errors.push(e.message));
  await cam.route(/\/mediapipe\/|hand_landmarker\.task/, () => { /* never answered: the capture stays live while the model "loads" */ });
  await cam.addInitScript(() => {
    const md = navigator.mediaDevices; const original = md.getUserMedia.bind(md);
    (window as any).__streams = []; (window as any).__gate = null;
    md.getUserMedia = async (constraints) => { const gate = (window as any).__gate; if (gate) await gate; const stream = await original(constraints); (window as any).__streams.push(stream); return stream; };
  });
  await cam.goto(`http://127.0.0.1:${port}/living?example=1&debug-living=1&rm=1&agent=fixture`);
  await cam.waitForFunction(() => (window as any).__foundry?.ready, null, { timeout: 120000 });
  const camState = () => cam.evaluate(() => { const ws = (window as any).__workspace; const hand = ws.el.userHand as HTMLElement; return { tracker: ws.handTracker !== null, pressed: ws.el.toolHand.getAttribute('aria-pressed'), srcObject: (ws.el.video as HTMLVideoElement).srcObject !== null, tracks: (window as any).__streams.flatMap((st: MediaStream) => st.getTracks().map((t) => t.readyState)), cursorHidden: hand.hidden, cursorState: hand.dataset.state ?? null }; });
  const startHand = async () => { await cam.evaluate(() => { (window as any).__streams.length = 0; }); await cam.locator('[data-el="toolMore"]').click(); if ((await cam.locator('[data-el="toolHand"]').getAttribute('aria-pressed')) !== 'true') await cam.locator('[data-el="toolHand"]').click(); };
  const exits: Array<[string, 'clear' | 'empty' | 'other']> = [
    ['clearMachine', 'clear'],
    ['replaceAssembly to the empty stage', 'empty'],
    ['replaceAssembly to another machine', 'other'],
  ];
  for (const [name, way] of exits) {
    await cam.evaluate(() => { const ws = (window as any).__workspace; if (ws.isEmpty) ws.replaceAssembly(ws.options.assembly, { reveal: false }); });
    await startHand();
    await cam.waitForFunction(() => (window as any).__streams.length === 1 && (window as any).__workspace.el.video.srcObject, null, { timeout: 30000 });
    const live = await camState();
    assert.deepEqual([live.tracker, live.pressed, live.srcObject, live.tracks.every((t: string) => t === 'live') && live.tracks.length > 0], [true, 'true', true, true], `${name}: the capture is live before leaving`);
    await cam.evaluate(() => { const ws = (window as any).__workspace; const hand = ws.el.userHand as HTMLElement; hand.hidden = false; hand.dataset.state = 'active'; hand.style.left = '10px'; (window as any).__tracker = ws.handTracker; });
    await cam.evaluate((w) => { const ws = (window as any).__workspace; if (w === 'clear') ws.clearMachine({}); else if (w === 'empty') ws.replaceAssembly(ws.options.assembly, { empty: true }); else ws.replaceAssembly(ws.options.assembly, { reveal: false }); }, way);
    const after = await camState();
    assert.deepEqual({ tracker: after.tracker, pressed: after.pressed, srcObject: after.srcObject, cursorHidden: after.cursorHidden, cursorState: after.cursorState }, { tracker: false, pressed: 'false', srcObject: false, cursorHidden: true, cursorState: null }, `${name}: the tracker, the video and the hand state are released`);
    assert.ok(after.tracks.length > 0 && after.tracks.every((t: string) => t === 'ended'), `${name}: every capture track ended (${after.tracks})`);
    // a callback that arrives late must not bring the hand back
    await cam.evaluate(() => { const t = (window as any).__tracker; t.options.onLandmarks(Array.from({ length: 21 }, (_, i) => ({ x: 0.5 + i * 0.001, y: 0.5, z: 0 }))); });
    assert.equal((await camState()).cursorHidden, true, `${name}: a late landmark callback does nothing`);
    console.log(`PASS webcam released on: ${name}`);
  }

  // the permission is granted only after the person already left
  await cam.evaluate(() => { const ws = (window as any).__workspace; if (ws.isEmpty) ws.replaceAssembly(ws.options.assembly, { reveal: false }); (window as any).__streams.length = 0; (window as any).__gate = new Promise((res) => { (window as any).__grant = res; }); });
  await cam.locator('[data-el="toolMore"]').click(); if ((await cam.locator('[data-el="toolMore"]').getAttribute('aria-expanded')) !== 'true') await cam.locator('[data-el="toolMore"]').click();
  await cam.locator('[data-el="toolHand"]').click();
  assert.equal((await camState()).tracker, true, 'the request is pending');
  await cam.evaluate(() => (window as any).__workspace.clearMachine({}));
  await cam.evaluate(() => (window as any).__grant());
  await cam.waitForFunction(() => (window as any).__streams.length === 1, null, { timeout: 30000 });
  await cam.waitForFunction(() => (window as any).__streams[0].getTracks().every((t: MediaStreamTrack) => t.readyState === 'ended'), null, { timeout: 10000 });
  const late = await camState();
  assert.deepEqual({ tracker: late.tracker, srcObject: late.srcObject, pressed: late.pressed }, { tracker: false, srcObject: false, pressed: 'false' });
  console.log('PASS a permission granted after leaving ends the capture at once and attaches nothing');
  await cam.close();
  assert.deepEqual(errors, []);
} finally { await browser.close(); await vite.close(); }
