import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const host=process.env.UNFOLD_SPACE_URL ?? 'http://127.0.0.1:5195'; const out=process.env.UNFOLD_PRODUCT_OUT ?? '/tmp/unfold-product-geometry'; await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH ?? '/usr/bin/google-chrome',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const records=[];
for (const [name,file] of [['harp','blind-harp-plan'],['excavator','live-image-plan']]) {
 const reply=JSON.parse(await readFile(`reports/universal-spatial-v2/evidence/${file}.json`,'utf8')); const page=await browser.newPage({viewport:{width:1440,height:900}}); await page.addInitScript(()=>{window.__spoken=[]; Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[],speak:u=>window.__spoken.push(u.text),cancel(){},pause(){},resume(){},addEventListener(){},removeEventListener(){}}});}); const errors=[]; page.on('pageerror',e=>errors.push(e.message)); page.on('console',m=>{if(m.type()==='error') errors.push(m.text())});
 await page.route('**/api/spatial/question',route=>{const q=route.request().postDataJSON(); return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({contract:'unfold.spatial-answer.v1',selectedId:q.selectedId,revision:q.revision,source:'meta',answer:'Resposta contextual simulada para o componente seleccionado.',limitations:'Resposta de teste, não é resultado Meta live.'})});});
 await page.route('**/api/spatial/v2/plan',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(reply)}));
 await page.goto(`${host}/living?debug-living&rm=1`,{waitUntil:'networkidle'}); await page.click('[data-space="open"]'); await page.fill('#sp-text','Construir objecto conceptual para esta avaliação local.'); await page.click('[data-sp="submit"]'); await page.waitForSelector('.sp-root[data-phase="review"]'); await page.click('[data-sp="keep-all"]'); await page.check('#sp-ack');
 const started=Date.now(); await page.click('[data-sp="build"]'); await page.waitForFunction(()=>window.__workspace.spaceActive);
 const first=await page.evaluate(()=>({report:structuredClone(window.__space.layer.geometryReport),selection:window.__workspace.selectedSpaceId}));
 assert.ok(first.report); assert.ok(first.report.decisions.every(d=>d.used==='procedural_v2'));
 await page.waitForFunction(()=>!window.__space.layer.geometryReport?.pending.length,null,{timeout:30000}); const elapsed=Date.now()-started;
 const result=await page.evaluate(()=>({report:structuredClone(window.__space.layer.geometryReport),stats:window.__workspace.stats(),plan:window.__space.layer.currentPlan.title})); await page.screenshot({path:`${out}/${name}.png`});
 const point=await page.evaluate(()=>{const w=window.__workspace,l=window.__space.layer,r=document.querySelector('canvas').getBoundingClientRect(); for(let y=16;y<r.height;y+=12) for(let x=16;x<r.width;x+=12){const id=l.pick({x:x/r.width*2-1,y:1-y/r.height*2},w.foundry.camera);if(id)return {id,x:r.left+x,y:r.top+y};}return null;}); assert.ok(point); await page.mouse.click(point.x,point.y); assert.equal(await page.evaluate(()=>window.__workspace.selectedSpaceId),point.id);
 await page.locator('[data-spatial-question]').fill('Para que serve?'); await page.locator('[data-act=ask-spatial]').click(); await page.getByTestId('spatial-transcript').waitFor(); await page.locator('[data-act=speech-play]').click(); assert.match((await page.evaluate(()=>window.__spoken)).at(-1),/Resposta contextual simulada/);
 assert.deepEqual(errors,[]); records.push({name,origin:'saved Meta plan, old repair; locally replayed',first: first.report.decisions.map(d=>({id:d.componentId,used:d.used,pending:d.pending??false})),elapsedMs:elapsed,lastFrameMs:result.stats.lastFrameMs,totals:result.report.totals,decisions:result.report.decisions.map(d=>({id:d.componentId,used:d.used,reason:d.reason,fallback:d.fallback})),errors});
 await page.close();
}
await writeFile(`${out}/results.json`,JSON.stringify(records,null,2)); console.log(JSON.stringify(records)); await browser.close();
