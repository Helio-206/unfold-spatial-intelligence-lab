import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import assert from 'node:assert/strict';

process.env.UNFOLD_API_TARGET = 'http://127.0.0.1:9';
const port = Number(process.env.UNFOLD_WORKSPACE_HISTORY_PORT ?? 5306);
const server = await createServer({ server: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'error' });
await server.listen();
const base = `http://127.0.0.1:${port}`;
try {
  for (const cache of [false, true]) {
    const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', ignoreDefaultArgs: cache ? ['--disable-back-forward-cache'] : [], args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', ...(cache ? ['--enable-features=BackForwardCache'] : [])] });
    try {
      const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
      const errors = []; page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript(() => { window.__shows = []; window.addEventListener('pageshow', (event) => window.__shows.push(event.persisted)); });
      await page.goto(`${base}/living?debug-living=1&agent=fixture&rm=0`);
      await page.waitForFunction(() => window.__foundry?.ready, null, { timeout: 120000 });
      await page.evaluate(() => {
        const ws = window.__workspace; ws.select('boom_cylinder'); ws.offerExperiment('boom_cylinder', null);
        ws.approveProposal(ws.getState().messages.at(-1).id);
        ws.renderNow(); window.__initialStats = ws.stats(); window.__listenerCount = ws.disposers.length;
        window.__originalCanvas = document.querySelector('.uw-stage canvas');
        window.addEventListener('pagehide', () => { window.__stateAtHide = ws.engineState(); });
      });
      for (let cycle = 1; cycle <= 2; cycle++) {
        await page.goto(`${base}/landing/`, { waitUntil: 'domcontentloaded' });
        await page.goBack({ waitUntil: 'commit' });
        await page.waitForFunction(() => window.__foundry?.ready, null, { timeout: 120000 });
        const result = await page.evaluate(() => { const ws = window.__workspace; ws.renderNow(); const stats = ws.stats(); return { persisted: window.__shows.at(-1), count: document.querySelectorAll('.uw-stage canvas').length,
          same: window.__originalCanvas === document.querySelector('.uw-stage canvas'), state: ws.engineState(), before: window.__stateAtHide,
          selection: ws.selection()?.id ?? null, lost: ws.foundry.renderer.getContext().isContextLost(), listenerCount: ws.disposers.length, originalListeners: window.__listenerCount,
          geometries: stats.geometries, textures: stats.textures, originalGeometries: window.__initialStats?.geometries, originalTextures: window.__initialStats?.textures }; });
        assert.equal(result.count, 1); assert.equal(result.lost, false);
        if (cache) {
          assert.equal(result.persisted, true); assert.equal(result.same, true); assert.equal(result.selection, 'boom_cylinder');
          assert.equal(result.state.playing, false); assert.equal(result.state.timeS, result.before.timeS);
          assert.equal(result.listenerCount, result.originalListeners); assert.equal(result.geometries, result.originalGeometries); assert.equal(result.textures, result.originalTextures);
        } else { assert.equal(result.persisted, false); assert.equal(result.state.timeS, 0); }
        assert.deepEqual(errors, []);
        console.log(`PASS history recovery cycle=${cycle} cache=${cache} persisted=${result.persisted}`);
      }
    } finally { await browser.close(); }
  }
} finally { await server.close(); }
