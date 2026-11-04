// Detail crops (2x device scale) of the same region on each route, so surface artefacts are judged at pixel level, not on the favourable overview.
//   node scripts/visual/fidelity-zoom.mjs --host http://127.0.0.1:5195 --fixture lungs-like --clip 560,300,300,260 --out reports/fidelity-v3
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const args = {}; for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const [x, y, width, height] = args.clip.split(',').map(Number), out = resolve(args.out ?? 'reports/fidelity-v3'); await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
for (const route of ['v2', 'live', 'live&rim=discard']) {
  const page = await context.newPage(); await page.goto(`${args.host}/tests/harness/fidelity/index.html?fixture=${args.fixture}&route=${route}`, { waitUntil: 'networkidle' }); await page.evaluate(() => window.__fid.ready);
  if (route.startsWith('live')) await page.waitForFunction(() => window.__fid.report && window.__fid.report.pending.length === 0, null, { timeout: 60_000, polling: 25 });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 1800)))));
  await page.screenshot({ path: resolve(out, `zoom-${args.fixture}-${route.replace('live&rim=discard', 'v3-earlier-rim').replace('live', 'v3')}.png`), clip: { x, y, width, height } }); await page.close();
}
await browser.close(); console.log('zoom crops written');
