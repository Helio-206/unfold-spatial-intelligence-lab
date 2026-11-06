// Screenshots of the Universal Foundry reference host. node scripts/visual/foundry-shot.mjs --host http://127.0.0.1:5197 --out reports/product-integration/uvf --cases sedan:v2,sedan:foundry
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
const args = {}; for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const out = resolve(args.out ?? 'reports/product-integration/uvf'); await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: Number(args.w ?? 1200), height: Number(args.h ?? 760) }, deviceScaleFactor: 1 });
const results = {};
try {
  for (const spec of (args.cases ?? 'sedan:foundry').split(',')) {
    const [plan, route, extra = ''] = spec.split(':'), page = await context.newPage(), errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${args.host}/tests/harness/foundry/index.html?plan=${plan}&route=${route}${extra ? `&${extra.replaceAll('+', '&')}` : ''}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => window.__uvf.ready); await page.evaluate(() => new Promise((d) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(d, 1500)))));
    const label = `${plan}-${route}${extra ? `-${extra.replace(/[^a-z0-9.]+/gi, '_')}` : ''}`;
    await page.screenshot({ path: resolve(out, `${label}.png`) });
    results[label] = { metrics: await page.evaluate(() => window.__uvf.metrics), errors }; await page.close();
  }
  await writeFile(resolve(out, 'shots.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify(results, null, 1));
} finally { await browser.close(); }
