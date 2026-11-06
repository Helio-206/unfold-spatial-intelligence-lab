import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const requests = []; let release;
await page.addInitScript(() => {
  window.__voiceEvents = [];
  Object.defineProperty(window, 'speechSynthesis', { value: { getVoices: () => [], speak: u => window.__voiceEvents.push(['speak', u.text]), cancel: () => window.__voiceEvents.push(['cancel']), pause() {}, resume() {}, addEventListener() {}, removeEventListener() {} } });
  window.SpeechRecognition = class { start() { window.__voiceEvents.push(['mic-start']); this.onstart?.(); } abort() { window.__voiceEvents.push(['mic-abort']); } };
  const nativeFetch = window.fetch; window.fetch = (url, options) => { if (String(url).includes('/api/spatial/question')) options.signal.addEventListener('abort', () => window.__voiceEvents.push(['request-abort']), { once: true }); return nativeFetch(url, options); };
});
await page.route('**/api/spatial/question', async route => {
  const q = route.request().postDataJSON(); requests.push(q);
  if (q.question.startsWith('Resposta atrasada')) await new Promise(resolve => { release = resolve; });
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ contract: 'unfold.spatial-answer.v1', selectedId: q.selectedId, revision: q.revision, source: 'meta', answer: q.question === 'Para que serve?' ? 'A ocular permite observar a imagem ampliada.' : q.question.startsWith('Resposta atrasada') ? 'RESPOSTA ANTIGA' : 'A objectiva forma a imagem; a ocular permite observá-la.', limitations: 'Resposta simulada para teste.' }) }).catch(() => {});
});
await page.goto(`${process.env.UNFOLD_TEST_HOST ?? 'http://127.0.0.1:5195'}/tests/harness/fidelity/index.html?fixture=microscope-like&route=v2`); await page.evaluate(() => window.__fid.ready); const point = await page.evaluate(() => { const f=window.__fid, r=document.querySelector('canvas').getBoundingClientRect(); for(let y=8;y<r.height;y+=8) for(let x=8;x<r.width;x+=8) if(f.layer.pick({x:x/r.width*2-1,y:1-y/r.height*2},f.ws.foundry.camera)==='eyepiece') return {x:r.left+x,y:r.top+y}; return null; }); assert.ok(point); await page.mouse.click(point.x,point.y); assert.equal(await page.evaluate(()=>window.__fid.ws.selectedSpaceId),'eyepiece');
async function ask(question) { await page.locator('[data-spatial-question]').fill(question); await page.locator('[data-act=ask-spatial]').click(); }
await ask('Para que serve?'); await page.getByTestId('spatial-transcript').waitFor(); assert.match(await page.getByTestId('spatial-transcript').innerText(), /ocular/);
await page.locator('[data-spatial-question]').fill('Qual é a diferença para a objectiva?'); await page.locator('[data-act=ask-spatial]').focus(); await page.keyboard.press('Enter'); await page.waitForFunction(() => document.querySelector('[data-testid=spatial-transcript]')?.textContent?.includes('objectiva forma')); assert.equal(requests[1].selectedId, 'eyepiece'); assert.equal(requests[1].history.length, 1); assert.ok(Array.isArray(requests[1].relations)); assert.ok(requests[1].unknowns.some(u => /unknown|not modelled/i.test(u)));
await page.locator('[data-act=speech-play]').click(); assert.ok((await page.evaluate(()=>window.__voiceEvents)).some(e=>e[0]==='speak' && e[1].includes('objectiva'))); await page.locator('[data-el=mic]').click(); const voiceEvents=await page.evaluate(()=>window.__voiceEvents); const spoken=voiceEvents.findLastIndex(e=>e[0]==='speak'); const mic=voiceEvents.findIndex(e=>e[0]==='mic-start'); assert.ok(spoken >= 0 && voiceEvents.slice(spoken + 1, mic).some(e=>e[0]==='cancel'));
await ask('Resposta atrasada'); await page.waitForFunction(() => document.querySelector('[data-act=ask-spatial]')?.disabled); while (!release) await new Promise(r => setTimeout(r, 10)); await page.evaluate(() => window.__fid.ws.select('base')); release(); await page.waitForTimeout(100); assert.equal(await page.getByTestId('spatial-transcript').count(), 0); assert.equal(await page.evaluate(() => window.__fid.ws.selectedSpaceId), 'base');
assert.ok((await page.evaluate(()=>window.__voiceEvents)).some(e=>e[0]==='request-abort'));
for (const kind of ['revision','space']) {
  if (kind === 'revision') await page.evaluate(async()=>{ const l=window.__fid.layer; l.proposeEdit('x+'); l.authorise(true); await l.applyEdit(); });
  release = null; const prior = (await page.evaluate(()=>window.__voiceEvents.filter(e=>e[0]==='request-abort').length));
  await ask('Resposta atrasada '+kind); while (!release) await new Promise(r=>setTimeout(r,10));
  if (kind === 'revision') await page.evaluate(async()=>{ await window.__fid.layer.undo(); });
  else await page.evaluate(()=>{ const f=window.__fid; const next=f.mount(structuredClone(f.layer.currentPlan),'v2'); f.ws.showSpace(next.layer); });
  await page.waitForFunction(count=>window.__voiceEvents.filter(e=>e[0]==='request-abort').length > count, prior); release(); await page.waitForTimeout(100); assert.equal(await page.getByTestId('spatial-transcript').count(),0);
}
await page.evaluate(()=>window.__fid.ws.dispose()); const events=await page.evaluate(()=>window.__voiceEvents); assert.equal(events.at(-1)[0], 'cancel');
console.log('mock Meta: pointer, follow-up, speech, microphone, abort on selection/Space/revision and dispose passed'); await browser.close();
