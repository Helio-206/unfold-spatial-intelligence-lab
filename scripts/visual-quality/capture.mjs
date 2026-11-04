// Independent capture runner. No generator or paid network is invoked by default.
import { chromium } from 'playwright-core';
import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {analyzeBounds} from './metrics.mjs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const host=process.env.UNFOLD_SPACE_URL ?? 'http://127.0.0.1:5195';
const out=process.env.UNFOLD_VISUAL_OUT ?? 'reports/product-integration/visual-quality/captures';
const fixture=process.env.UNFOLD_VISUAL_PLAN ?? 'reports/universal-spatial-v2/evidence/live-image-plan.json';
const adapter=process.env.UNFOLD_VISUAL_ADAPTER ? await import(pathToFileURL(resolve(process.env.UNFOLD_VISUAL_ADAPTER)).href) : null;
if(adapter && (typeof adapter.providerName!=='string' || typeof adapter.setup!=='function' || typeof adapter.afterBuild!=='function')) throw Error('Adapter must export providerName, setup and afterBuild');
const reply=JSON.parse(await readFile(fixture,'utf8')); const reference=process.env.UNFOLD_VISUAL_REFERENCE;
if(reference){const hash=createHash('sha256').update(await readFile(reference)).digest('hex');if(reply.plan.source.sha256!==hash)throw Error('REFERENCE_PLAN_HASH_MISMATCH: do not associate an unrelated photograph with this plan');}
await mkdir(out,{recursive:true});if(reference)await copyFile(reference,`${out}/source-image`);
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH ?? '/usr/bin/google-chrome',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1}); const errors=[];
page.on('pageerror',e=>errors.push(e.message)); page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
// Force the existing product's supported WORKER_UNAVAILABLE fallback, not a mock renderer.
if(!adapter) await page.addInitScript(()=>{Object.defineProperty(window,'Worker',{value:undefined,configurable:true});});
if(adapter) await adapter.setup({page,fixture,reply});
await page.route('**/*',route=>{const u=new URL(route.request().url());return u.origin===new URL(host).origin ? route.continue() : route.abort('blockedbyclient');});
await page.route('**/api/**',route=>{const url=new URL(route.request().url()); if(url.pathname==='/api/spatial/v2/plan') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(reply)}); if(url.pathname==='/api/spatial/v2/adopt') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({contract:'unfold.spatial-v2-review.v1',sessionId:'fixture',revision:0,plan:reply.plan,review:{status:'adopted'}})}); return route.fulfill({status:503,contentType:'application/json',body:'{"error":"offline capture: API disabled"}'});});
try {
 await page.goto(`${host}/living?debug-living&rm=1`,{waitUntil:'networkidle'}); await page.click('[data-space="open"]'); if(reference){await page.locator('#sp-file').setInputFiles(reference);await page.waitForFunction(()=>!document.querySelector('[data-sp=submit]')?.disabled);}else await page.fill('#sp-text','Reprodução local de um plano previamente guardado.'); await page.click('[data-sp="submit"]'); await page.waitForSelector('.sp-root[data-phase="review"]'); await page.click('[data-sp="keep-all"]'); await page.check('#sp-ack');
 const started=Date.now(); await page.click('[data-sp="build"]'); await page.waitForFunction(()=>window.__workspace.spaceActive && !window.__space.layer.isBusy,null,{timeout:30000}); if(adapter) await adapter.afterBuild({page,fixture,reply}); const loadingMs=Date.now()-started;
 const diagnostics=await page.evaluate(async()=>{
   const THREE=await import('/node_modules/three/build/three.module.js'); const w=window.__workspace, layer=window.__space.layer; const root=layer.root;root.updateMatrixWorld(true);
   const bounds=new THREE.Box3().setFromObject(root), center=bounds.getCenter(new THREE.Vector3()), size=bounds.getSize(new THREE.Vector3());
   const meshes=[];let triangles=0,degenerate=0,invalidNormals=0, texturedMaterials=0;const materials=new Set();
   root.traverse(o=>{if(!o.isMesh)return;const g=o.geometry,p=g.getAttribute('position'),n=g.getAttribute('normal'),ix=g.index,count=ix?ix.count:p?.count??0,instances=o.isInstancedMesh?o.count:1;triangles+=count/3*instances;
    for(let i=0;i+2<count;i+=3){const ids=[0,1,2].map(j=>ix?ix.getX(i+j):i+j);const vs=ids.map(k=>new THREE.Vector3().fromBufferAttribute(p,k));if(vs.some(v=>![v.x,v.y,v.z].every(Number.isFinite))||new THREE.Vector3().subVectors(vs[1],vs[0]).cross(new THREE.Vector3().subVectors(vs[2],vs[0])).lengthSq()<1e-20)degenerate+=instances;}
    if(n)for(let i=0;i<n.count;i++){const a=[n.getX(i),n.getY(i),n.getZ(i)];if(!a.every(Number.isFinite)||Math.hypot(...a)<1e-6)invalidNormals++;}
    for(const m of Array.isArray(o.material)?o.material:[o.material])if(m&&!materials.has(m)){materials.add(m);if(m.map)texturedMaterials++;}
    const box=new THREE.Box3().setFromObject(o);meshes.push({id:o.userData.spatialEntityId??null,instances,minimum:box.min.toArray(),maximum:box.max.toArray()}); });
   const renderer=w.foundry.renderer;return {bounds:{min:bounds.min.toArray(),max:bounds.max.toArray(),center:center.toArray(),size:size.toArray()},meshes,triangles,degenerate,invalidNormals,materialCount:materials.size,texturedMaterials,geometryReport:structuredClone(layer.geometryReport),renderer:w.foundry.rendererInfo,resources:{...renderer.info.memory,programs:renderer.info.programs?.length??null},jsHeap:performance.memory?{used:performance.memory.usedJSHeapSize,total:performance.memory.totalJSHeapSize}:null};
 });
 diagnostics.boundsDiagnostics=analyzeBounds(diagnostics.meshes,diagnostics.bounds);
 if(!adapter) assert.ok(diagnostics.geometryReport.decisions.every(d=>d.used==='procedural_v2'));
 const camera=process.env.UNFOLD_VISUAL_CAMERA ? JSON.parse(await readFile(process.env.UNFOLD_VISUAL_CAMERA,'utf8')) : {center:diagnostics.bounds.center,size:diagnostics.bounds.size};
 if(!Array.isArray(camera.center)||!Array.isArray(camera.size)||camera.center.length!==3||camera.size.length!==3||![...camera.center,...camera.size].every(Number.isFinite)||Math.max(...camera.size)<=0)throw Error('INVALID_CAMERA');
 await writeFile(`${out}/camera.json`,JSON.stringify(camera,null,2)+'\n');
 for(const [name,dir] of Object.entries({front:[0,0,1],side:[1,0,0],threeQuarter:[1,.35,1]})){
  await page.evaluate(({dir,b})=>{const w=window.__workspace,c=w.foundry.camera,t=w.director.controls.target;t.set(...b.center);const distance=Math.max(...b.size)*2.9;c.position.set(t.x+dir[0]*distance,t.y+dir[1]*distance,t.z+dir[2]*distance);c.lookAt(t);c.updateProjectionMatrix();w.foundry.requestRender()}, {dir,b:camera});await page.waitForTimeout(500);await page.locator('canvas.uw-canvas').screenshot({path:`${out}/${name}.png`});
 }
 const point=await page.evaluate(()=>{const w=window.__workspace,l=window.__space.layer,r=document.querySelector('canvas.uw-canvas').getBoundingClientRect(); for(let y=10;y<r.height;y+=8)for(let x=10;x<r.width;x+=8){const id=l.pick({x:x/r.width*2-1,y:1-y/r.height*2},w.foundry.camera);if(id)return{id,x:r.left+x,y:r.top+y}}return null});assert.ok(point,'no selectable geometry');await page.mouse.click(point.x,point.y);assert.equal(await page.evaluate(()=>window.__workspace.selectedSpaceId),point.id);await page.screenshot({path:`${out}/selection.png`});await page.evaluate(()=>{const w=window.__workspace,c=w.foundry.camera,t=w.director.controls.target;c.position.lerp(t,.35);c.lookAt(t);w.foundry.requestRender()});await page.waitForTimeout(300);await page.locator('canvas.uw-canvas').screenshot({path:`${out}/closeup.png`});await page.locator('[data-act="isolate"]').last().click();await page.screenshot({path:`${out}/isolation.png`});
 const lifecycle=await page.evaluate(async()=>{const f=window.__space,before=JSON.stringify(f.layer.currentPlan);const saved=await f.save(),id=f.savedId;if(!saved||!id)return{saved:false};const opened=await f.openRecord(id);return{saved,opened,samePlan:JSON.stringify(f.layer.currentPlan)===before}});assert.deepEqual(lifecycle,{saved:true,opened:true,samePlan:true});await page.screenshot({path:`${out}/reopened.png`});
 const result={contract:'unfold.visual-quality.capture.v1',fixture,source:reference?'source hash matches the replayed plan; plan origin must be independently checked':'saved Meta plan replayed locally; no photo correspondence asserted',provider:adapter?.providerName ?? 'SpatialPlanV2 fallback (Worker unavailable)',loadingMs,point,lifecycle,diagnostics,camera,reference:reference?{path:'source-image',sha256:reply.plan.source.sha256}:null,errors,captures:{front:'front.png',side:'side.png',threeQuarter:'threeQuarter.png',selection:'selection.png',closeup:'closeup.png',isolation:'isolation.png',reopened:'reopened.png'},review:null};await writeFile(`${out}/result.json`,JSON.stringify(result,null,2)+'\n'); console.log(JSON.stringify({loadingMs,point,lifecycle,renderer:diagnostics.renderer,triangles:diagnostics.triangles,errors})); if(errors.length)process.exitCode=1;
} finally {await page.close();await browser.close();}
