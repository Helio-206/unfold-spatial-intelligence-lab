/**
 * Compõe lado-a-lado: fotografia de entrada | vista 3D ajustada, para as duas fotografias reais.
 * Run (depois de real-photo-fitting.pw.ts): npx tsx tests/e2e/gen-side-by-side.pw.ts
 */
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const out = resolve('reports/product-integration/real-photo-evidence');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 560 } });
const img = (p: string) => `data:image/${p.endsWith('.jpg') ? 'jpeg' : 'png'};base64,${readFileSync(p).toString('base64')}`;
await page.setContent(`<body style="margin:0;background:#111;color:#eee;font-family:system-ui">
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:8px">
    <figure><img style="width:100%" src="${img(resolve('tests/fixtures/photos-real/car.jpg'))}"><figcaption>INPUT car.jpg — fotografia de câmara (CC0, Wikimedia Commons)</figcaption></figure>
    <figure><img style="width:100%" src="${img(resolve(out, 'car-03-fitted-3d-clean.png'))}"><figcaption>FITTED 3D — hatchback fixture + fitting por silhueta (cabinHeight 0.52)</figcaption></figure>
    <figure><img style="width:100%" src="${img(resolve('tests/fixtures/photos-real/bus.jpg'))}"><figcaption>INPUT bus.jpg — fotografia de câmara (CC BY-SA 4.0, Wikimedia Commons)</figcaption></figure>
    <figure><img style="width:100%" src="${img(resolve(out, 'bus-03-fitted-3d-clean.png'))}"><figcaption>FITTED 3D — template SUV fixture + fitting por silhueta (cabinHeight 0.52)</figcaption></figure>
  </div></body>`);
await page.waitForTimeout(800);
await page.screenshot({ path: resolve(out, 'side-by-side.png'), fullPage: true });
await browser.close();
console.log('SIDE-BY-SIDE OK');
