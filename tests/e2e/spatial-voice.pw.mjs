import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch({headless:true, executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/google-chrome',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
await mkdir('reports/spatial-voice/evidence',{recursive:true});
for (const [fixture,id,viewport] of [['microscope-like','eyepiece',{width:1440,height:900}],['lungs-like','trachea',{width:390,height:844}]]) {
 const page=await browser.newPage({viewport}); const errors=[]; page.on('pageerror',e=>errors.push(e.message)); page.on('console',m=>{if(m.type()==='error') errors.push(m.text())});
 await page.addInitScript(()=>{window.__tts=[]; Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[],speak:u=>window.__tts.push(['speak',u.text]),cancel:()=>window.__tts.push(['cancel']),pause:()=>window.__tts.push(['pause']),resume:()=>window.__tts.push(['resume']),addEventListener(){},removeEventListener(){}}});});
 await page.goto(`${process.env.UNFOLD_TEST_HOST ?? 'http://127.0.0.1:5195'}/tests/harness/fidelity/index.html?fixture=${fixture}&route=v2`); await page.evaluate(()=>window.__fid.ready);
 const point = await page.evaluate(target => { const f = window.__fid, canvas = document.querySelector('canvas'), r = canvas.getBoundingClientRect(); for (let y=8; y<r.height; y+=8) for (let x=8; x<r.width; x+=8) { const ndc={x:x/r.width*2-1,y:1-y/r.height*2}; if (f.layer.pick(ndc, f.ws.foundry.camera)===target) return {x:r.left+x,y:r.top+y}; } return null; }, id);
 assert.ok(point, `No pickable screen point for ${id}`); await page.mouse.click(point.x, point.y); assert.equal(await page.evaluate(() => window.__fid.ws.selectedSpaceId), id);
 await page.locator('[data-act=explain-space]').click(); await page.locator('[data-testid=spatial-transcript]').waitFor(); const transcript=await page.locator('[data-testid=spatial-transcript]').innerText();
 await page.screenshot({path:resolve(`reports/spatial-voice/evidence/${fixture}.png`)});
 await page.locator('[data-act=speech-play]').click(); await page.locator('[data-act=speech-pause]').click(); await page.locator('[data-act=speech-resume]').click(); await page.locator('[data-act=speech-stop]').click();
 await page.locator('[data-act=speech-play]').click(); await page.evaluate(()=>window.__fid.ws.select(window.__fid.layer.currentPlan.components.find(c => c.id !== window.__fid.ws.selectedSpaceId).id));
 const output=await page.evaluate(()=>({tts:window.__tts,selection:window.__fid.ws.selectedSpaceId,transcript:!!document.querySelector('[data-testid=spatial-transcript]')}));
 await page.locator('[data-act=explain-space]').click(); await page.locator('[data-testid=spatial-transcript]').waitFor(); await page.locator('[data-act=speech-play]').click();
 await page.evaluate(async()=>{const l=window.__fid.layer; l.proposeEdit('x+'); l.authorise(true); await l.applyEdit();});
 assert.equal(await page.locator('[data-testid=spatial-transcript]').count(),0);
 await page.locator('[data-act=explain-space]').click(); await page.locator('[data-testid=spatial-transcript]').waitFor();
 await page.evaluate(async()=>{await window.__fid.layer.undo()}); assert.equal(await page.locator('[data-testid=spatial-transcript]').count(),0);
 assert.match(transcript, fixture === 'lungs-like' ? /traqueia conduz o ar/ : /ocular é a parte/); assert.equal(output.transcript, false); assert.deepEqual(output.tts.filter(x=>['speak','pause','resume'].includes(x[0])).map(x=>x[0]), ['speak','pause','resume','speak']); assert.equal(output.tts.at(-1)[0], 'cancel'); assert.deepEqual(errors, []); console.log(JSON.stringify({fixture,viewport,selection:output.selection,checks:'passed',errors})); await page.close();
}
{
 const page = await browser.newPage();
 await page.addInitScript(() => { Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true }); delete window.SpeechSynthesisUtterance; });
 await page.goto(`${process.env.UNFOLD_TEST_HOST ?? 'http://127.0.0.1:5195'}/tests/harness/fidelity/index.html?fixture=microscope-like&route=v2`); await page.evaluate(() => window.__fid.ready);
 await page.evaluate(() => window.__fid.ws.select('eyepiece')); await page.locator('[data-act=explain-space]').click();
 await page.locator('[data-testid=spatial-transcript]').waitFor(); assert.match(await page.locator('.uw-spatial-voice').innerText(), /Síntese indisponível/); assert.equal(await page.locator('[data-act=speech-play]').count(), 0); await page.close();
 console.log('unsupported speech: passed');
}
await browser.close();
