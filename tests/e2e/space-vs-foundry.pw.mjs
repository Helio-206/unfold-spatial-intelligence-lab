// Visual comparison on the SAME stage and viewport: the premium Foundry excavator (the existing example) against a Space built from a plan.
//   UNFOLD_SPACE_REPLAY=<stored raw-run file>  replays a real run's normalised plan locally (no Meta call); without it a labelled fixture is used.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const base = process.env.UNFOLD_SPACE_URL ?? 'http://127.0.0.1:5191';
const out = resolve(process.env.UNFOLD_SPACE_OUT ?? 'reports/space-integration/runs/foundry-comparison');
const viewport = { width: 1440, height: 900 };
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
const errors = []; page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message));
let fixture = JSON.parse(await readFile(resolve('reports/visual-recovery/fixtures/bicycle.json'), 'utf8'));
if (process.env.UNFOLD_SPACE_REPLAY) { const stored = JSON.parse(await readFile(resolve(process.env.UNFOLD_SPACE_REPLAY), 'utf8')); fixture = { ...fixture, plan: stored.normalizedPlan, meta: { model: 'replay-of-stored-run', requestId: stored.requestId, estimatedCostUsd: 0 } }; }
await page.route('**/api/spatial/v2/plan', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) }));
try {
  // the existing premium excavator (labelled example)
  await page.goto(`${base}/living?debug-living&rm=1&example=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__foundry?.ready === true && !window.__workspace.isEmpty, null, { timeout: 60000 }); await page.waitForTimeout(2500);
  await page.keyboard.press('f'); await page.waitForTimeout(700);
  await page.screenshot({ path: resolve(out, 'foundry-excavator.png') });
  const excavator = await page.evaluate(() => window.__workspace.stats());
  // a Space on the same stage
  await page.goto(`${base}/living?debug-living&rm=1`, { waitUntil: 'networkidle' });
  await page.click('[data-space="open"]'); await page.fill('#sp-text', 'A space built from a reviewed plan.'); await page.click('[data-sp="submit"]');
  await page.waitForSelector('.sp-root[data-phase="review"]', { timeout: 120000 }); await page.click('[data-sp="keep-all"]'); await page.check('#sp-ack'); await page.click('[data-sp="build"]');
  await page.waitForFunction(() => window.__workspace.spaceActive && window.__space.layer?.presentation?.phase !== 'entering', null, { timeout: 120000 }); await page.waitForTimeout(1500);
  await page.keyboard.press('f'); await page.waitForTimeout(700);
  await page.screenshot({ path: resolve(out, 'space.png') });
  const space = await page.evaluate(() => ({ ...window.__workspace.stats(), stats: window.__space.layer.stats }));
  // side by side
  const [a, b] = await Promise.all(['foundry-excavator.png', 'space.png'].map(async (f) => `data:image/png;base64,${(await readFile(resolve(out, f))).toString('base64')}`));
  await page.setViewportSize({ width: 1440, height: 450 });
  await page.setContent(`<body style="margin:0;background:#0b0c0e;display:grid;grid-template-columns:1fr 1fr;height:450px"><figure style="margin:0;position:relative"><img src="${a}" style="width:100%;height:100%;object-fit:cover"><figcaption style="position:absolute;left:12px;top:8px;color:#fff;font:12px monospace">Foundry · excavadora premium (exemplo sintético)</figcaption></figure><figure style="margin:0;position:relative"><img src="${b}" style="width:100%;height:100%;object-fit:cover"><figcaption style="position:absolute;left:12px;top:8px;color:#fff;font:12px monospace">Space · plano da IA revisto</figcaption></figure></body>`);
  await page.waitForTimeout(500); await page.screenshot({ path: resolve(out, 'comparison.png') });
  await writeFile(resolve(out, 'stats.json'), `${JSON.stringify({ viewport, excavator, space, replay: process.env.UNFOLD_SPACE_REPLAY ? 'stored real run' : 'labelled fixture', consoleErrors: errors }, null, 2)}\n`);
  console.log(JSON.stringify({ ok: errors.length === 0, errors }));
} finally { await browser.close(); }
