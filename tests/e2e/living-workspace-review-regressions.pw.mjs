import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import assert from 'node:assert/strict';

process.env.UNFOLD_API_TARGET = 'http://127.0.0.1:9';
const port = Number(process.env.UNFOLD_REVIEW_PORT ?? 5303);
const server = await createServer({ server: { port, host: '127.0.0.1', strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
const page = await context.newPage();
const failures = [];
const check = (name, f) => { try { f(); console.log(`PASS ${name}`); } catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.message}`); } };
try {
  await page.goto(`http://127.0.0.1:${port}/src/living/workspace-design/harness/index.html?agent=auto&rm=1`);
  await page.waitForFunction(() => window.__foundry?.ready, null, { timeout: 240000 });
  const inset = await page.evaluate(() => {
    const ws = window.__workspace;
    ws.el.expand.click();
    return { actual: ws.insets.bottom, expected: (ws.el.composer.offsetHeight || 64) + 32 + ws.el.conversation.offsetHeight + 8, height: ws.el.conversation.offsetHeight };
  });
  check('mobile conversation reserves visible panel height', () => { assert.ok(inset.height > 0); assert.equal(inset.actual, inset.expected); });
  const closed = await page.evaluate(() => {
    const ws = window.__workspace;
    ws.el.convClose.click();
    return { hidden: ws.el.conversation.hidden, actual: ws.insets.bottom, expected: (ws.el.composer.offsetHeight || 64) + 32 };
  });
  check('closing conversation restores the mobile safe area', () => { assert.equal(closed.hidden, true); assert.equal(closed.actual, closed.expected); });
  const explode = await page.evaluate(() => {
    const ws = window.__workspace;
    ws.el.toolExplode.click();
    const on = { exploded: ws.scene.exploded, notice: ws.getState().notices.some((n) => n.id === 'explode') };
    ws.el.toolExplode.click();
    const off = { exploded: ws.scene.exploded, notice: ws.getState().notices.some((n) => n.id === 'explode') };
    return { on, off };
  });
  check('reduced-motion exploded view has a truthful notice', () => assert.deepEqual(explode, { on: { exploded: true, notice: true }, off: { exploded: false, notice: false } }));
  if (failures.length) throw new Error(`Failed: ${failures.join(', ')}`);
} finally {
  await context.close(); await browser.close(); await server.close();
}
