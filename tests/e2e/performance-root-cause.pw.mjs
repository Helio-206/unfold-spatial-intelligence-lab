import { chromium } from 'playwright-core';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const base=process.env.UNFOLD_SPACE_URL ?? 'http://127.0.0.1:5195', out=process.env.UNFOLD_RCA_OUT ?? '/tmp/unfold-rca'; await mkdir(out,{recursive:true});
const reply=JSON.parse(await readFile('reports/universal-spatial-v2/evidence/blind-harp-plan.json','utf8'));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH ?? '/usr/bin/google-chrome',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const configs=[['A-v2',true,false,false,false],['B-v3',false,false,false,false],['C-generated-no-swap',false,true,false,false],['D-no-probes',false,false,false,true],['B-screenshots',false,false,true,false]];
for(const [name,v2,noSwap,shots,bare] of configs.filter(([name]) => !process.env.UNFOLD_RCA_MODES || process.env.UNFOLD_RCA_MODES.split(',').includes(name))){
 const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
 if(v2)await page.addInitScript(()=>{Object.defineProperty(window,'Worker',{value:undefined,configurable:true});});
 await page.route('**/api/spatial/v2/plan',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(reply)}));
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await page.goto(`${base}/living?debug-living&rm=1`,{waitUntil:'networkidle'});
 await page.evaluate(async ({noSwap,bare})=>{
   const {PlanSpaceLayer}=await import('/src/living/spatial-space/layer.ts');
   if(noSwap)PlanSpaceLayer.prototype.scheduleGeometryUpgrade=function(){};
   if(bare)return;
   const THREE=await import('/node_modules/.vite/deps/three.js');
   const p=window.__rca={phase:'setup',iteration:-1,events:[],longtasks:[]};
   try {new PerformanceObserver(list=>{for(const e of list.getEntries())p.longtasks.push({start:e.startTime,duration:e.duration});}).observe({type:'longtask',buffered:true});}catch{}
   const wrap=(obj,key,label,depth=false)=>{const original=obj[key];if(typeof original!=='function')return;let d=0;obj[key]=function(...args){if(depth&&d++){try{return original.apply(this,args)}finally{d--}}const t=performance.now(),phase=p.phase,iteration=p.iteration;try{return original.apply(this,args)}finally{p.events.push({label,phase,iteration,start:t,ms:performance.now()-t});if(depth)d--}}};
   wrap(PlanSpaceLayer.prototype,'build','build');wrap(PlanSpaceLayer.prototype,'release','release');wrap(PlanSpaceLayer.prototype,'upgradeGeometry','upgrade');
   wrap(THREE.Object3D.prototype,'updateMatrixWorld','sceneGraph',true);wrap(THREE.BufferGeometry.prototype,'dispose','geometryDispose');wrap(THREE.Material.prototype,'dispose','materialDispose');
   const ws=window.__workspace;wrap(ws,'renderInspector','inspector');wrap(ws.foundry,'renderNow','renderer');
 },{noSwap,bare});
 await page.click('[data-space="open"]');await page.fill('#sp-text','Plano guardado reproduzido localmente.');await page.click('[data-sp="submit"]');await page.waitForSelector('.sp-root[data-phase="review"]');await page.click('[data-sp="keep-all"]');await page.check('#sp-ack');
 const t0=Date.now();await page.evaluate(()=>{if(window.__rca)window.__rca.phase='construction'});await page.click('[data-sp="build"]');await page.waitForFunction(()=>window.__workspace.spaceActive && !window.__space.layer.isBusy);
 const waitReady=async()=>{if(v2)return;await page.waitForFunction(({noSwap})=>{const g=window.__space.geometry,s=g?.service?.stats();return noSwap ? !!s && s.running===0 && s.queued===0 && s.completed>0 : (window.__space.layer.geometryReport?.pending.length??0)===0;},{noSwap},{timeout:30000});};
 await waitReady();
 const initial=await page.evaluate(()=>{const l=window.__space.layer;return {report:structuredClone(l.geometryReport),camera:window.__workspace.foundry.camera.position.toArray(),plan:l.currentPlan.title}});
 if(!v2&&!noSwap)assert.ok(initial.report.decisions.some(d=>d.used==='continuous_surface'),'V3 swap must happen');
 if(noSwap)assert.ok(initial.report.decisions.every(d=>d.used==='procedural_v2')&&initial.report.pending.length>0,`generation must not swap: ${JSON.stringify(initial.report)}`);
 const prepared=await page.evaluate(({bare})=>{const w=window.__workspace,l=window.__space.layer;w.select('harp-neck');l.attachSync(null);if(!bare){let old=l.compile;l.compile=(...args)=>{let t=performance.now();try{return old(...args)}finally{window.__rca.events.push({label:'compile',phase:window.__rca.phase,iteration:window.__rca.iteration,start:t,ms:performance.now()-t})}}}return {selected:w.selectedSpaceId,component:l.selectedId};},{bare});assert.equal(prepared.selected,'harp-neck');
 const measurements=[];
 for(let i=-3;i<12;i++)for(const action of ['edit','undo']){
  const result=await page.evaluate(async({i,action})=>{const l=window.__space.layer,w=window.__workspace;if(window.__rca){window.__rca.phase=action;window.__rca.iteration=i}const start=performance.now();if(action==='edit'){l.proposeEdit('x+');l.authorise(true);await l.applyEdit();}else{if(!await l.undo())throw Error('undo failed')}const editEnd=performance.now();w.renderNow();return {start,opMs:editEnd-start,renderMs:performance.now()-editEnd,selected:w.selectedSpaceId,layerSelected:l.selectedId,version:l.explanationVersion};},{i,action});
  assert.equal(result.selected,'harp-neck');assert.equal(result.layerSelected,'harp-neck');
  if(shots){const t=Date.now();await page.screenshot({path:`${out}/${name}-${i}-${action}.png`});result.screenshotMs=Date.now()-t;}
  await waitReady();if(i>=0)measurements.push({iteration:i,action,...result});
 }
 const diagnostics=await page.evaluate(()=>window.__rca??null);const service=await page.evaluate(()=>window.__space.geometry?.service?.stats()??null);const final=await page.evaluate(()=>({director:window.__space.layer.presentation,report:structuredClone(window.__space.layer.geometryReport)}));
 await writeFile(`${out}/${name}.json`,JSON.stringify({name,initial,prepared,measurements,diagnostics,service,final,errors,constructionWallMs:Date.now()-t0},null,2));
 console.log(name,JSON.stringify({count:measurements.length,errors,service}));await page.close();
}
await browser.close();
