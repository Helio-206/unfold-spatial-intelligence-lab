import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import assert from 'node:assert/strict';

const port = Number(process.env.UNFOLD_CINEMA_HISTORY_PORT ?? 5302);
process.env.UNFOLD_API_TARGET = 'http://127.0.0.1:9';
const server = await createServer({ server: { port, host: '127.0.0.1', strictPort: true }, logLevel: 'error' });
await server.listen();
const bfcacheEnabled = process.env.UNFOLD_CINEMA_BFCACHE !== '0';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', ignoreDefaultArgs: bfcacheEnabled ? ['--disable-back-forward-cache'] : [], args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', ...(bfcacheEnabled ? ['--enable-features=BackForwardCache'] : [])] });
const context = await browser.newContext({ viewport: { width: 800, height: 500 } });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('Page.enable');
const notRestored = [];
cdp.on('Page.backForwardCacheNotUsed', (event) => notRestored.push(event.notRestoredExplanations));
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.addInitScript(() => {
  window.__historyShows = [];
  window.addEventListener('pageshow', (event) => window.__historyShows.push(event.persisted));
});
const cinema = `http://127.0.0.1:${port}/cinema?debug-cinema&tier=light`;
const ready = () => page.waitForFunction(() => window.__unfoldCinema?.ready, null, { timeout: 90000 });
const inspect = () => page.evaluate(() => {
  const debug = window.__unfoldCinema;
  debug.renderNow();
  return { canvasCount: document.querySelectorAll('#cinema-stage canvas').length, connected: debug.canvas().isConnected,
    contextLost: debug.runtime.renderer.getContext().isContextLost(), calls: debug.stats().calls, shot: debug.runtime.shot,
    tier: debug.stats().tier, pose: debug.pose(), presenting: document.querySelector('#cinema-root').classList.contains('is-presenting'),
    resources: (({ geometries, textures, programs, lights }) => ({ geometries, textures, programs, lights }))(debug.stats()),
    sameCanvas: window.__initialCinemaCanvas === debug.canvas(),
    persisted: window.__historyShows.at(-1), notRestoredReasons: performance.getEntriesByType('navigation')[0]?.notRestoredReasons ?? null };
});
try {
  await page.goto(cinema); await ready();
  await page.evaluate(async () => { const d = window.__unfoldCinema; window.__initialCinemaCanvas = d.canvas(); d.seekShot('profile', 1); await d.playTransportFrames('basic', false); d.seekPose(1); document.querySelector('#cinema-hide').click(); });
  const before = await inspect();
  assert.equal(before.canvasCount, 1); assert.equal(before.contextLost, false); assert.ok(before.calls > 0);
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => document.querySelector('.cinema-logo').click());
    await page.waitForURL(`http://127.0.0.1:${port}/`);
    await page.goBack({ waitUntil: 'commit' }); await ready();
    const restored = await inspect();
    assert.equal(restored.canvasCount, 1); assert.equal(restored.connected, true); assert.equal(restored.contextLost, false); assert.ok(restored.calls > 0);
    if (restored.persisted) {
      assert.equal(restored.shot, before.shot); assert.equal(restored.tier, before.tier);
      assert.equal(restored.pose.timeS, before.pose.timeS); assert.equal(restored.pose.playing, false); assert.equal(restored.presenting, before.presenting);
      assert.equal(restored.sameCanvas, true); assert.deepEqual(restored.resources, before.resources);
    }
    if (!bfcacheEnabled) assert.equal(restored.persisted, false);
    await page.evaluate(() => { document.querySelector('#cinema-root').classList.remove('is-presenting', 'is-idle'); document.querySelector('[data-shot="bucket"]').click(); });
    assert.equal(await page.getAttribute('[data-shot="bucket"]', 'aria-pressed'), 'true');
    console.log(`PASS real history cycle ${i + 1}; bfcache=${restored.persisted}; reasons=${JSON.stringify(restored.notRestoredReasons ?? notRestored.at(-1) ?? null)}`);
    await page.evaluate(() => { const d = window.__unfoldCinema; d.seekShot('profile', 1); if (!document.querySelector('#cinema-root').classList.contains('is-presenting')) document.querySelector('#cinema-hide').click(); });
  }
  const synthetic = await page.evaluate(() => {
    const before = window.__unfoldCinema.canvas();
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    const d = window.__unfoldCinema;
    d.renderNow();
    return { same: d.canvas() === before, connected: d.canvas().isConnected, count: document.querySelectorAll('#cinema-stage canvas').length, lost: d.runtime.renderer.getContext().isContextLost() };
  });
  assert.deepEqual(synthetic, { same: true, connected: true, count: 1, lost: false });
  const playback = await page.evaluate(async () => {
    const d = window.__unfoldCinema;
    await d.playTransportFrames('basic', false); d.seekPose(0.5); d.runtime.playPose(true, false);
    const before = d.pose();
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    await new Promise((resolve) => setTimeout(resolve, 750));
    const suspended = d.pose();
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    const resumed = d.pose();
    d.runtime.playPose(false);
    return { before, suspended, resumed, canvasCount: document.querySelectorAll('#cinema-stage canvas').length };
  });
  assert.equal(playback.before.playing, true); assert.equal(playback.suspended.timeS, playback.before.timeS);
  assert.equal(playback.resumed.timeS, playback.before.timeS); assert.equal(playback.resumed.playing, true); assert.equal(playback.canvasCount, 1);
  assert.deepEqual(errors, []);
  console.log('PASS persisted lifecycle retains one functioning canvas and freezes the playback clock');
} finally {
  await context.close(); await browser.close(); await server.close();
}
