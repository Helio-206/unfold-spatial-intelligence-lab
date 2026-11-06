import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

process.env.UNFOLD_API_TARGET = 'http://127.0.0.1:9';
const vite = await createServer({ server: { host: '127.0.0.1', port: 5377, strictPort: true }, logLevel: 'error' });
await vite.listen();
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5377/living?debug-living=1', { waitUntil: 'domcontentloaded' });
const cases: Array<[string, string]> = [
  ['car', 'car.jpg'], ['bus', 'bus.jpg'], ['porsche-911', 'porsche-911.jpg'],
  ['skoda-kodiaq', 'skoda-kodiaq.jpg'], ['accept-mini', 'accept-mini.jpg'], ['accept-pickup', 'accept-pickup.jpg'],
];
const results: Record<string, unknown> = {};
for (const [id, file] of cases) {
  const dataUrl = `data:image/jpeg;base64,${readFileSync(resolve('tests/fixtures/photos-real', file)).toString('base64')}`;
  const r = await page.evaluate(async (url) => {
    // @ts-ignore — módulos servidos pelo Vite dentro da página
    const seg = await import('/src/living/universal-foundry/mediapipe-segmentation.ts');
    // @ts-ignore — idem
    const lm2 = await import('/src/living/universal-foundry/landmarks.ts');
    const ev = await seg.mediapipeVehicleEvidence(url);
    if (!ev) return { error: 'mediapipe-null' };
    const landmarks = lm2.detectWheelLandmarks(ev, ev.rgba);
    const camera = lm2.estimateCamera(ev, landmarks);
    return {
      azimuthDeg: +camera.azimuthDeg.toFixed(1), uncertaintyDeg: +camera.uncertaintyDeg.toFixed(1),
      kind: camera.kind, ambiguous: camera.ambiguous, method: camera.method,
      wheels: landmarks.wheels.map((w: { centreXFraction: number; radiusFractionOfBboxHeight: number; partial: boolean }) => ({ x: +w.centreXFraction.toFixed(3), r: +w.radiusFractionOfBboxHeight.toFixed(3), partial: w.partial })),
      regions: landmarks.wheelRegions ?? null, missing: landmarks.missing,
      foregroundRatio: +ev.foregroundRatio.toFixed(3),
    };
  }, dataUrl);
  results[id] = r;
  process.stdout.write(`${id} ${JSON.stringify(r)}\n`);
}
mkdirSync(resolve('reports/product-integration/real-photo-evidence'), { recursive: true });
writeFileSync(resolve('reports/product-integration/real-photo-evidence/camera-azimuth.json'), JSON.stringify(results, null, 2));
await browser.close();
await vite.close();
process.stdout.write('CAMERA-AZIMUTH OK\n');
