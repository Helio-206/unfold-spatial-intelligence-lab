// Reproduces, on the PR #23 harness, what the paid evaluator was sent: canvas.toDataURL() called the way the old "Evaluate" handler did (outside the
// render task, WebGL context without preserveDrawingBuffer). Reports the luminance of that image next to a screenshot of the same canvas.
//   node scripts/visual/black-capture-proof.mjs --url http://127.0.0.1:5191/universal-spatial-v2 --plan <reply.json> --out <file.json>
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const args = {}; for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const reply = JSON.parse(await readFile(resolve(args.plan), 'utf8'));
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
try {
  await page.goto(args.url, { waitUntil: 'networkidle' });
  await page.evaluate((payload) => window.unfoldLoadSpatialPlanV2(payload), reply);
  await page.evaluate(() => new Promise((done) => setTimeout(done, 1000)));
  const luma = (dataUrl) => page.evaluate(async (url) => { const img = new Image(); await new Promise((ok) => { img.onload = ok; img.src = url; }); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let sum = 0, max = 0; const n = c.width * c.height; for (let i = 0; i < n; i++) { const l = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3; sum += l; if (l > max) max = l; } return { width: img.width, height: img.height, meanLuma: +(sum / n).toFixed(2), maxLuma: +max.toFixed(1) }; }, dataUrl);
  const oldHandlerImage = await page.evaluate(() => document.querySelector('#v2-canvas canvas').toDataURL('image/png'));
  const screenshot = `data:image/png;base64,${(await page.locator('#v2-canvas canvas').screenshot()).toString('base64')}`;
  const result = { url: args.url, plan: args.plan, toDataURLAsTheOldHandlerDidIt: await luma(oldHandlerImage), screenshotOfTheSameCanvas: await luma(screenshot) };
  if (args.out) await writeFile(resolve(args.out), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
