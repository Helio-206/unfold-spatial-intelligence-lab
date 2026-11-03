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
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
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
  assert.deepEqual(errors, []);
} finally { await browser.close(); await vite.close(); }
