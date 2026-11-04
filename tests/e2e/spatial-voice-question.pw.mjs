import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const requests = []; let release;
await page.route('**/api/spatial/question', async route => {
  const q = route.request().postDataJSON(); requests.push(q);
  if (q.question === 'Resposta atrasada') await new Promise(resolve => { release = resolve; });
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ contract: 'unfold.spatial-answer.v1', selectedId: q.selectedId, revision: q.revision, source: 'meta', answer: q.question === 'Para que serve?' ? 'A ocular permite observar a imagem ampliada.' : q.question === 'Resposta atrasada' ? 'RESPOSTA ANTIGA' : 'A objectiva forma a imagem; a ocular permite observá-la.', limitations: 'Resposta simulada para teste.' }) }).catch(() => {});
});
await page.goto(`${process.env.UNFOLD_TEST_HOST ?? 'http://127.0.0.1:5195'}/tests/harness/fidelity/index.html?fixture=microscope-like&route=v2`); await page.evaluate(() => window.__fid.ready); await page.evaluate(() => window.__fid.ws.select('eyepiece'));
async function ask(question) { await page.locator('[data-spatial-question]').fill(question); await page.locator('[data-act=ask-spatial]').click(); }
await ask('Para que serve?'); await page.getByTestId('spatial-transcript').waitFor(); assert.match(await page.getByTestId('spatial-transcript').innerText(), /ocular/);
await page.locator('[data-spatial-question]').fill('Qual é a diferença para a objectiva?'); await page.locator('[data-act=ask-spatial]').focus(); await page.keyboard.press('Enter'); await page.waitForFunction(() => document.querySelector('[data-testid=spatial-transcript]')?.textContent?.includes('objectiva forma')); assert.equal(requests[1].selectedId, 'eyepiece'); assert.equal(requests[1].history.length, 1);
await ask('Resposta atrasada'); await page.waitForFunction(() => document.querySelector('[data-act=ask-spatial]')?.disabled); while (!release) await new Promise(r => setTimeout(r, 10)); await page.evaluate(() => window.__fid.ws.select('base')); release(); await page.waitForTimeout(100); assert.equal(await page.getByTestId('spatial-transcript').count(), 0); assert.equal(await page.evaluate(() => window.__fid.ws.selectedSpaceId), 'base');
console.log('mock Meta: follow-up context and stale selection passed'); await browser.close();
