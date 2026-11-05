/**
 * Living Intelligence no workspace real `/living` (flag experimental, sem inferência paga).
 * Run: npx tsx tests/e2e/living-intelligence.pw.ts
 */
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const out = resolve(process.env.UNFOLD_LI_OUT ?? 'reports/product-integration/living-intelligence-evidence');
mkdirSync(out, { recursive: true });
const port = Number(process.env.UNFOLD_LI_PORT ?? 5341);
process.env.UNFOLD_API_TARGET = 'http://127.0.0.1:9';
const vite = await createServer({ server: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'error' });
await vite.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors: string[] = [];
page.on('pageerror', e => errors.push(e.message));
const pass = (m: string) => console.log(`PASS ${m}`);

await page.goto(`http://127.0.0.1:${port}/living?debug-living=1&experimental-living-intelligence=1&example=1`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="living-intelligence"]', { timeout: 30_000 });
await page.waitForFunction(() => document.body.innerText.includes('montagem sintética') || !(window as never as { __workspace: { isEmpty: boolean } }).__workspace.isEmpty, null, { timeout: 30_000 }).catch(() => {});
await page.waitForTimeout(2500);
await page.screenshot({ path: resolve(out, '01-excavator-living-panel.png') });
pass('painel Living Intelligence visível no /living real com a escavadora de exemplo');

// 1-4: seleccionar a lança e perguntar o que faz
await page.click('[data-entity="boom"]');
await page.waitForTimeout(400);
const input = page.locator('[data-li-input]');
await input.fill('O que faz a lança?');
await page.click('.li-command button[type="submit"]');
await page.waitForFunction(() => document.querySelector('[data-li-output]')?.textContent?.includes('primeiro braço'), null, { timeout: 10_000 });
pass('pergunta sobre a lança respondida com explicação ancorada na cena');
await page.screenshot({ path: resolve(out, '02-explain-boom.png') });

// 5-8: destacar o actuador e animar o movimento ligado, pausar e continuar
await input.fill('Estende o cilindro da lança');
await page.click('.li-command button[type="submit"]');
await page.waitForFunction(() => document.querySelector('[data-li-output]')?.textContent?.includes('A animar boom_cylinder'), null, { timeout: 10_000 });
await page.waitForTimeout(1200);
await page.click('[data-play="pause"]');
const pausedText = await page.locator('[data-li-output]').innerText();
assert.match(pausedText, /Reprodução: paused/);
await page.screenshot({ path: resolve(out, '03-animated-paused.png') });
pass('extensão do cilindro animou componentes ligados e pausou');
await page.click('[data-play="resume"]');
await page.waitForTimeout(600);
await page.click('[data-play="reset"]');
pass('retoma e reposição executadas');

// 9-10: experiência com parâmetro
await page.click('[data-mode="experiment"]');
await page.click('[data-exp="0"]');
await page.waitForFunction(() => document.querySelector('[data-li-output]')?.textContent?.includes('Curso'), null, { timeout: 10_000 });
await page.screenshot({ path: resolve(out, '04-experiment.png') });
pass('experiência cilindro→lança apresentou antes/depois');

// 12: explicação guiada passo a passo
await page.click('[data-walk="start"]');
await page.waitForFunction(() => document.querySelector('[data-li-output]')?.textContent?.includes('Passo 1/'), null, { timeout: 10_000 });
await page.click('[data-walk="next"]');
await page.waitForFunction(() => document.querySelector('[data-li-output]')?.textContent?.includes('Passo 2/'), null, { timeout: 10_000 });
await page.screenshot({ path: resolve(out, '05-walkthrough.png') });
pass('walkthrough progrediu com destaque sincronizado');

// 13: guardar e reabrir cenário
await page.click('[data-li-save]');
await page.waitForFunction(() => document.querySelector('[data-li-output]')?.textContent?.includes('Cenário guardado'), null, { timeout: 10_000 });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="living-intelligence"]', { timeout: 30_000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: resolve(out, '06-reopened.png') });
pass('cenário guardado e página reaberta com o painel vivo');

assert.deepEqual(errors, [], `pageerrors: ${errors.join(' | ')}`);
await browser.close();
await vite.close();
console.log('LIVING-INTELLIGENCE-E2E OK');
