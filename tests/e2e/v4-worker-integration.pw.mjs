import { chromium } from 'playwright-core';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const host = process.env.UNFOLD_SPACE_URL ?? 'http://127.0.0.1:5301', out = process.env.UNFOLD_V4_OUT ?? '/tmp/unfold-v4-worker'; await mkdir(out, { recursive: true });
const cases = [
  ['excavator', 'hierarchical/plans/excavator-input', 'hierarchical/plans/excavator-saved', 'saved Meta plan with synthetic perturbation; rendered evidence from saved plan, not photograph'],
  ['harp', 'hierarchical/plans/harp-input', 'hierarchical/plans/harp-saved', 'saved Meta plan with synthetic perturbation; rendered evidence from saved plan, not photograph'],
  ['lungs', 'plans/lungs-like-degraded', 'plans/lungs-like-ground-truth', 'hand-authored plan with synthetic degradation and rendered evidence'],
  ['microscope', 'plans/microscope-like-degraded', 'plans/microscope-like-ground-truth', 'hand-authored plan with synthetic degradation and rendered evidence'],
];
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const records = [];
try {
 for (const [name,inputPath,truthPath,origin] of cases.filter(([name]) => !process.env.UNFOLD_V4_CASES || process.env.UNFOLD_V4_CASES.split(',').includes(name))) {
  const input=JSON.parse(await readFile(`reports/fidelity-v4/${inputPath}.json`,'utf8')), truth=JSON.parse(await readFile(`reports/fidelity-v4/${truthPath}.json`,'utf8'));
  const page=await browser.newPage({viewport:{width:1440,height:900}}), errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/spatial/v2/plan',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(input)}));
  await page.route('**/api/spatial/v2/adopt',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({contract:'unfold.spatial-v2-review.v1',sessionId:'fixture',revision:0,plan:input.plan,review:{status:'adopted'}})}));
  await page.goto(`${host}/living?debug-living&experimental-v4&rm=1`,{waitUntil:'networkidle'}); await page.click('[data-space="open"]'); await page.fill('#sp-text','Experiência local com evidência sintética.'); await page.click('[data-sp="submit"]'); await page.waitForSelector('.sp-root[data-phase="review"]'); await page.click('[data-sp="keep-all"]'); await page.check('#sp-ack'); await page.click('[data-sp="build"]');
  await page.waitForFunction(()=>window.__workspace.spaceActive && !window.__space.layer.isBusy && (window.__space.layer.geometryReport?.pending.length??0)===0,null,{timeout:40000});
  const result=await page.evaluate(async truthPlan=>{
    const [{renderedEvidence,evidenceToJSON}]=await Promise.all([import('/src/universal-spatial/reconstruction/evidence.ts')]);
    const layer=window.__space.layer; layer.attachSync(null); const before=JSON.stringify(layer.currentPlan);
    const evidence=evidenceToJSON(renderedEvidence(truthPlan,6,64),'synthetic rendered evidence; not a photo');
    let ticks=0; const timer=setInterval(()=>ticks++,50);
    try {
      let outcome=await window.__v4.run({sourceSha256:layer.currentPlan.source.sha256,evidence});
      const initial={status:outcome.status,refusals:outcome.refusals,hypotheses:outcome.hypotheses.map(h=>h.id)};
      // E1: no caller-supplied confirmation flags exist. Without a persistent review record the solver must not promote hypotheses, so a refusal here is correct product behaviour.
       const simulatedConfirmation=false;
      return {initial,status:outcome.status,refusals:outcome.refusals,proposal:!!outcome.proposal,unchanged:before===JSON.stringify(layer.currentPlan),ticks,before,simulatedConfirmation};
    }
    finally {clearInterval(timer)}
  }, truth.plan);
  assert.equal(result.unchanged,true); let applied=false, undone=false;
  if(result.proposal){assert.equal(await page.evaluate(()=>window.__v4.preview()),true); await page.waitForSelector('.sp-pending[data-source="solver"]'); await page.check('[data-auth]'); await page.click('[data-apply]'); await page.waitForFunction(()=>window.__space.layer.editCount===1 && !window.__space.layer.isBusy,null,{timeout:20000}); applied=true; await page.evaluate(()=>window.__space.layer.undo()); undone=await page.evaluate(before=>JSON.stringify(window.__space.layer.currentPlan)===before,result.before); assert.equal(undone,true);}
  if(name==='excavator') {
    const stale = await page.evaluate(async truthPlan => {
      const {renderedEvidence,evidenceToJSON}=await import('/src/universal-spatial/reconstruction/evidence.ts');
      const l=window.__space.layer,w=window.__workspace, evidence=evidenceToJSON(renderedEvidence(truthPlan,6,64),'synthetic fixture');
      const pending=window.__v4.run({sourceSha256:l.currentPlan.source.sha256,evidence}).then(()=> 'accepted', e=>e.message);
      w.select(l.currentPlan.components[0].id); l.proposeEdit('x+'); l.authorise(true); await l.applyEdit();
      const status=await pending; await l.undo(); return status;
    }, truth.plan);
    assert.equal(stale,'V4_STALE'); result.stale=stale;
  }
  if(name==='microscope') {
    const shapes=await page.evaluate(async truthPlan => {
      const {renderedEvidence,evidenceToJSON}=await import('/src/universal-spatial/reconstruction/evidence.ts');
      const l=window.__space.layer, before=JSON.stringify(l.currentPlan), evidence=evidenceToJSON(renderedEvidence(truthPlan,6,64),'synthetic fixture');
      const findings=await window.__v4.runShapes({sourceSha256:l.currentPlan.source.sha256,evidence});
      return {count:findings.length,proposals:findings.filter(f=>f.proposal).length,unchanged:before===JSON.stringify(l.currentPlan)};
    },truth.plan);
    assert.equal(shapes.unchanged,true); result.shapes=shapes;
  }
  await page.screenshot({path:`${out}/${name}.png`}); assert.deepEqual(errors,[]); delete result.before; records.push({name,origin,...result,applied,undone,errors}); await page.close(); console.log(name,JSON.stringify(records.at(-1)));
 }
 await writeFile(`${out}/results.json`,JSON.stringify(records,null,2));
} finally {await browser.close()}
