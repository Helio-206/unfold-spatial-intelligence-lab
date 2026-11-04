// Same-input capture for the V2 harness. Loads a saved plan reply, renders it, screenshots the canvas and measures how much of it the object fills.
// The object mask is a pixel diff against a reference frame of the same viewport without the object (hidden through the debug hook when the
// harness has one, otherwise the empty harness before the plan was loaded), so it works for flat and for graded backgrounds alike.
//
//   node scripts/visual/capture.mjs --url http://127.0.0.1:5191/universal-spatial-v2 --plan <reply.json> --out <dir> --label before-harp [--shot hero]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
for (const key of ['url', 'plan', 'out', 'label']) if (!args[key]) { console.error(`missing --${key}`); process.exit(2); }
const out = resolve(args.out); await mkdir(out, { recursive: true });
const reply = JSON.parse(await readFile(resolve(args.plan), 'utf8'));
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const errors = []; page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message));
const settle = () => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 500)))));
const shotOf = async () => (await page.locator('#v2-canvas').screenshot()).toString('base64');
const result = { label: args.label, plan: args.plan, viewport: '1440x1000', shot: args.shot ?? null };
try {
  await page.goto(args.url, { waitUntil: 'networkidle' }); await settle();
  let reference = await shotOf();
  await page.evaluate((payload) => window.unfoldLoadSpatialPlanV2(payload), reply); await settle();
  if (args.shot) { await page.evaluate((id) => window.unfoldV2Debug.setShot(id), args.shot); await settle(); }
  const hasHook = await page.evaluate(() => Boolean(window.unfoldV2Debug?.setContentVisible));
  const presented = await shotOf(); let full = presented;
  if (hasHook) {
    // Shadow-free pair for the mask (a floor shadow is not the object); the saved PNG stays the presented frame with its shadows.
    await page.evaluate(() => window.unfoldV2Debug.setShadows(false)); await settle(); full = await shotOf();
    await page.evaluate(() => window.unfoldV2Debug.setContentVisible(false)); await settle(); reference = await shotOf();
    await page.evaluate(() => { window.unfoldV2Debug.setContentVisible(true); window.unfoldV2Debug.setShadows(true); }); await settle();
    result.appCapture = await page.evaluate(() => window.unfoldV2Debug.captureVerified());
  }
  await writeFile(resolve(out, `${args.label}.png`), Buffer.from(presented, 'base64'));
  const stats = await page.evaluate(async ({ a, b }) => {
    const load = (b64) => new Promise((ok) => { const img = new Image(); img.onload = () => ok(img); img.src = `data:image/png;base64,${b64}`; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const draw = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; };
    const da = draw(ia), db = draw(ib); const w = ia.width, h = ia.height; let n = 0, minX = w, minY = h, maxX = -1, maxY = -1, lum = 0;
    for (let i = 0; i < w * h; i++) {
      const d = Math.abs(da[i * 4] - db[i * 4]) + Math.abs(da[i * 4 + 1] - db[i * 4 + 1]) + Math.abs(da[i * 4 + 2] - db[i * 4 + 2]);
      if (d > 30) { n++; const x = i % w, y = (i - x) / w; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; lum += (da[i * 4] + da[i * 4 + 1] + da[i * 4 + 2]) / 3; }
    }
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    return { canvas: [w, h], objectPixelFraction: +(n / (w * h)).toFixed(4), bboxFraction: n ? +((bw * bh) / (w * h)).toFixed(4) : 0, bbox: n ? [minX, minY, maxX, maxY] : null, meanObjectLuma: n ? +(lum / n).toFixed(1) : 0, touchesEdge: n ? (minX <= 1 || minY <= 1 || maxX >= w - 2 || maxY >= h - 2) : false };
  }, { a: full, b: reference });
  // Comparable across versions: the stage (`.us-view`) is the same 1010x680 box in both, whatever the canvas inside it measured.
  const stageBox = await page.locator('.us-view').boundingBox();
  const objectHeightPx = stats.bbox ? stats.bbox[3] - stats.bbox[1] + 1 : 0, objectWidthPx = stats.bbox ? stats.bbox[2] - stats.bbox[0] + 1 : 0;
  result.stage = { width: Math.round(stageBox.width), height: Math.round(stageBox.height), objectHeightPx, objectWidthPx, objectHeightOfStage: +(objectHeightPx / stageBox.height).toFixed(3), objectBoxAreaOfStage: +((objectHeightPx * objectWidthPx) / (stageBox.width * stageBox.height)).toFixed(4) };
  Object.assign(result, stats, { consoleErrors: errors, compiler: await page.evaluate(() => window.unfoldSpatialStatsV2 ?? null) });
  await writeFile(resolve(out, `${args.label}.json`), `${JSON.stringify(result, null, 2)}\n`); console.log(JSON.stringify(result));
} finally { await browser.close(); }
