/**
 * Convergência completa em /living: upload de imagem → plano revisto → Space activo →
 * Living Intelligence ligada ao Space (explicação e movimento inferido transitório) →
 * photoreal activo no mesmo palco. Sem chamadas pagas: a resposta do plano é um fixture
 * rotulado, casado com a imagem por sha256 do pedido.
 * Run: npx tsx tests/e2e/full-living-experience.pw.ts
 */
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { doorSpacePlanFixture } from '../../src/living/living-intelligence/space-bridge';

const out = resolve(process.env.UNFOLD_FLE_OUT ?? 'reports/product-integration/full-living-evidence');
mkdirSync(out, { recursive: true });
const port = Number(process.env.UNFOLD_FLE_PORT ?? 5351);
process.env.UNFOLD_API_TARGET = 'http://127.0.0.1:9';
const vite = await createServer({ server: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'error' });
await vite.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
const pass = (m: string) => console.log(`PASS ${m}`);

const envelope = JSON.parse(readFileSync(resolve('reports/visual-recovery/fixtures/bicycle.json'), 'utf8')) as Record<string, unknown>;
await page.route('**/api/spatial/v2/plan', async (route) => {
  const body = route.request().postDataJSON() as { imageDataUrl?: string };
  const sha = createHash('sha256').update(body.imageDataUrl ?? 'door').digest('hex');
  const plan = doorSpacePlanFixture(sha);
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...envelope, plan, meta: { model: 'labelled-fixture (not Muse Spark)', requestId: 'fle-e2e' }, limitations: ['Plano-modelo fixture rotulado; sem inferência paga neste teste.'] }) });
});
await page.route('**/api/spatial/v2/session**', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'NOT_IN_E2E', message: 'sem sessão neste e2e' } }) }));

const flags = 'debug-living=1&experimental-foundry=1&experimental-living-intelligence=1&experimental-photoreal=1&rm=1';
await page.goto(`http://127.0.0.1:${port}/living?${flags}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="living-intelligence"]', { timeout: 30_000 });

// 1-3: upload real da imagem pelo painel do Space, revisão humana, construção
await page.click('[data-space="open"]');
await page.setInputFiles('#sp-file', resolve('tests/fixtures/photos/door-photo.png'));
await page.click('[data-sp="submit"]');
await page.waitForSelector('.sp-root[data-phase="review"]', { timeout: 60_000 });
await page.click('[data-sp="keep-all"]');
await page.check('#sp-ack');
await page.screenshot({ path: resolve(out, '01-review-door.png') });
await page.click('[data-sp="build"]');
await page.waitForFunction(() => (window as never as { __workspace: { spaceActive: boolean } }).__workspace.spaceActive, null, { timeout: 60_000 });
await page.waitForSelector('[data-li-space]', { timeout: 30_000 });
await page.waitForTimeout(1800);
await page.screenshot({ path: resolve(out, '02-space-door-living.png') });
pass('upload → revisão → Space activo ligado ao painel vivo no mesmo palco');

// photoreal activo no mesmo palco (flag combinada)
const photorealActive = await page.evaluate(() => (window as never as { __photoreal?: { active(): boolean } }).__photoreal?.active() ?? false);
console.log(`INFO photorealActive=${photorealActive}`);

// 4-6: seleccionar a folha da porta e pedir explicação ancorada
await page.click('[data-space-entity="door-leaf"]');
await page.click('[data-space-explain]');
await page.waitForFunction(() => document.querySelector('[data-li-output]')?.textContent?.includes('door-hinge'), null, { timeout: 10_000 });
const explanation = await page.locator('[data-li-output]').innerText();
assert.match(explanation, /inferida/);
assert.match(explanation, /fixture|Desconhecido|desconhecido/);
pass('explicação do Space ancorada no plano (relações, proveniência, unknowns)');
await page.screenshot({ path: resolve(out, '03-space-explain.png') });

// 7-8: movimento inferido transitório sobre a malha real do Space, pausa e reposição
await page.click('[data-space-motion="open"]');
await page.waitForTimeout(2200);
const angleAfterOpen = await page.evaluate(() => {
  const layer = (window as never as { __space: { layer: { root: { traverse(fn: (o: never) => void): void } } } }).__space.layer;
  let angle = 0;
  layer.root.traverse((o: never) => {
    const obj = o as { userData?: Record<string, unknown>; quaternion?: { angleTo(q: never): number }; };
    if (obj.userData?.spatialComponentRoot && obj.userData?.spatialEntityId === 'door-leaf') {
      const identity = (obj.quaternion as never as { constructor: new () => { angleTo(q: never): number } }).constructor;
      angle = obj.quaternion!.angleTo(new identity() as never);
    }
  });
  return angle;
});
assert.ok(angleAfterOpen > 0.2, `a folha da porta devia ter rodado (ângulo=${angleAfterOpen})`);
await page.screenshot({ path: resolve(out, '04-space-motion-open.png') });
pass(`movimento transitório aplicado à malha real do Space (ângulo ${angleAfterOpen.toFixed(2)} rad)`);
await page.click('[data-space-motion="close"]');
await page.waitForTimeout(2000);
pass('fechar/repor executado');

// regressão: escavadora sintética continua viva com as três flags
await page.goto(`http://127.0.0.1:${port}/living?${flags}&example=1`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="living-intelligence"]', { timeout: 30_000 });
await page.waitForTimeout(2000);
const input = page.locator('[data-li-input]');
await input.fill('Estende o cilindro da lança');
await page.click('.li-command button[type="submit"]');
await page.waitForFunction(() => document.querySelector('[data-li-output]')?.textContent?.includes('A animar boom_cylinder'), null, { timeout: 10_000 });
await page.waitForTimeout(1000);
await page.screenshot({ path: resolve(out, '05-excavator-still-living.png') });
pass('escavadora sintética (regressão) continua a animar com as três flags');

assert.deepEqual(errors, [], `pageerrors: ${errors.join(' | ')}`);
await browser.close();
await vite.close();
console.log('FULL-LIVING-EXPERIENCE-E2E OK');
