import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const evidenceRoot = resolve(process.env.UNFOLD_EVIDENCE_ROOT ?? 'reports/phase-10-stabilization/evidence/grounding-integration');
const sourceRun = JSON.parse(await readFile('reports/phase-10-stabilization/evidence/user-plan/result.json', 'utf8'));
const plan = resolve(process.env.UNFOLD_PLAN_IMAGE ?? sourceRun.image);
const bytes = await readFile(plan);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const groundingEvidence = JSON.parse(await readFile('reports/phase-10-stabilization/evidence/meta-grounding-live-02.json', 'utf8')).body.grounding;
const baseUrl = process.env.UNFOLD_E2E_URL ?? 'http://127.0.0.1:5194';
const cdpUrl = process.env.UNFOLD_CDP_URL ?? 'http://127.0.0.1:9227';
assert.equal(sha256, sourceRun.sha256, 'original plan SHA differs from preserved detection evidence');
assert.equal(groundingEvidence.sourceImage.sha256, sha256, 'preserved Muse grounding is not bound to this source image');
await mkdir(evidenceRoot, { recursive: true });

const target = await (await fetch(`${cdpUrl}/json/new?about:blank`, { method: 'PUT' })).json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((done, reject) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', reject, { once: true }); });
let sequence = 0;
const pending = new Map();
const networkRequests = [];
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.method === 'Network.requestWillBeSent') networkRequests.push(message.params.request.url);
  if (!message.id || !pending.has(message.id)) return;
  const waiter = pending.get(message.id); pending.delete(message.id);
  message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
});
const call = (method, params = {}) => new Promise((resolveCall, reject) => {
  const id = ++sequence; pending.set(id, { resolve: resolveCall, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.result?.description ?? result.exceptionDetails.text);
  return result.result?.value;
};
const waitFor = async (expression, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await evaluate(expression)) return; }
    catch (error) { if (!(error instanceof Error) || !/Inspected target navigated|Execution context was destroyed|Cannot find context/.test(error.message)) throw error; }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`Timeout: ${expression}`);
};
const screenshot = async (name) => {
  const shot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await writeFile(resolve(evidenceRoot, name), Buffer.from(shot.data, 'base64'));
};
const click = (selector) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('missing '+${JSON.stringify(selector)});e.click()})()`);

try {
  await call('Page.enable'); await call('Runtime.enable'); await call('DOM.enable'); await call('Network.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: `${baseUrl}/demo?grounding-e2e=stored-real-response&spatial-test=1` });
  await waitFor('document.querySelector("#demo-open-spatial")');
  await evaluate(`localStorage.removeItem('unfold-spatial-scene.v1');localStorage.setItem(${JSON.stringify(`unfold-visual-grounding.v1.${sha256}`)},${JSON.stringify(JSON.stringify(groundingEvidence))});document.querySelector('#demo-open-spatial').click()`);
  await waitFor('document.querySelector("#plan-file")');
  const documentRoot = await call('DOM.getDocument', { depth: -1 });
  const input = await call('DOM.querySelector', { nodeId: documentRoot.root.nodeId, selector: '#plan-file' });
  await call('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [plan] });
  await evaluate(`document.querySelector('#plan-file').dispatchEvent(new Event('change',{bubbles:true}))`);
  await waitFor('document.querySelector("#source-image")?.naturalWidth===1280');
  await screenshot('01-source-with-preserved-muse-grounding.png');
  await click('#detect-lines');
  await waitFor('document.querySelectorAll("#candidate-list [data-candidate]").length===46');
  const initial = await evaluate(`({segments:document.querySelectorAll('#candidate-list [data-candidate]').length, regions:document.querySelectorAll('#region-list [data-region]').length, exactCycles:(document.querySelector('#contour-summary')?.textContent.match(/(\\d+) ciclo\\(s\\) fechados exactos/)||[])[1], labels:[...document.querySelectorAll('#grounding-elements [data-grounding-row]')].length, associations:[...document.querySelectorAll('#grounding-elements [data-grounding-row]')].map(row=>({id:row.dataset.groundingRow,text:row.innerText}))})`);
  assert.equal(initial.segments, 46);
  assert.ok(initial.regions >= 1);
  await screenshot('02-grounding-to-geometric-candidates.png');

  const kitchen = await evaluate(`(()=>{const row=document.querySelector('[data-grounding-row="R_COZINHA"]');return row?.innerText??null})()`);
  assert.ok(kitchen?.includes('room-390-20-565-200') || kitchen?.includes('Sem região'), 'expected a deterministic room association or explicit no-match');
  await click('[data-grounding-id="R_COZINHA"][data-grounding-review="accepted"]');
  const manualReviewVisible = await evaluate(`Boolean(document.querySelector('[data-grounding-association-manual="R_COZINHA"]'))`);
  if (manualReviewVisible) {
    await click('[data-grounding-association-manual="R_COZINHA"]');
  } else {
    const autoReviewVisible = await evaluate(`Boolean(document.querySelector('[data-grounding-association="R_COZINHA"][data-association-review="accepted"]'))`);
    assert.ok(autoReviewVisible, 'grounded room did not expose a review action');
    await click('[data-grounding-association="R_COZINHA"][data-association-review="accepted"]');
  }
  const reviewed = await evaluate(`document.querySelector('[data-grounding-row="R_COZINHA"]')?.innerText??''`);
  assert.match(reviewed, /confirmad[ao] pelo utilizador|revista manualmente/);
  await screenshot('03-human-reviewed-grounding-link.png');

  const regionId = await evaluate(`document.querySelector('[data-grounding-row="R_COZINHA"] [data-grounding-region]')?.dataset.groundingRegion`);
  assert.ok(regionId, 'a reviewable region candidate must be present');
  await click('#clear-selection');
  await click(`#region-list [data-region="${regionId}"]`);
  await evaluate(`(()=>{const set=(s,v)=>{const e=document.querySelector(s);e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))};set('#scale-distance','5');set('#wall-height','2.7');set('#wall-thickness','0.15');set('#scale-evidence','E2E: escala hipotética de teste, não lida nem confirmada na planta.')})()`);
  await click('#scale-mode');
  const dispatchPlanPointer = async (point) => {
    const coordinates = await evaluate(`(()=>{const svg=document.querySelector('#plan-overlay'),r=svg.getBoundingClientRect(),v=svg.viewBox.baseVal;return {x:r.left+${point[0]}*r.width/v.width,y:r.top+${point[1]}*r.height/v.height}})()`);
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: coordinates.x, y: coordinates.y, button: 'left', buttons: 1, clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: coordinates.x, y: coordinates.y, button: 'left', buttons: 0, clickCount: 1 });
  };
  await dispatchPlanPointer([220, 20]); await dispatchPlanPointer([320, 20]);
  await waitFor('document.querySelector("#spatial-status").textContent.includes("Introduza a cota")');
  await click('#build-scene');
  await waitFor('document.querySelector("#spatial-status").textContent.includes("Cena proposta")');
  await waitFor('document.querySelector("#spatial-status").textContent.includes("Cena construída a partir")', 10_000);
  const sceneCheck = await evaluate(`(()=>{const rows=[...document.querySelectorAll('#component-list [data-scene-node]')];const room=document.querySelector('[data-scene-node="'+${JSON.stringify(regionId)}+'"]');const inspect=window.__unfoldSpatialInspect;return {rooms:rows.map(e=>e.innerText),roomLabel:room?.innerText??null,revision:document.querySelector('#spatial-status')?.textContent,canvas:document.querySelector('#spatial-canvas')?.querySelectorAll('canvas').length??0,roomMesh:inspect?.(${JSON.stringify(regionId)})??null,wallMesh:rows.find(e=>e.dataset.sceneNode?.startsWith('wall-'))?inspect?.(rows.find(e=>e.dataset.sceneNode?.startsWith('wall-')).dataset.sceneNode):null}})()`);
  assert.ok(sceneCheck.roomLabel?.includes('Cozinha'), 'confirmed grounded label not attached to the scene node');
  assert.ok(sceneCheck.canvas > 0, 'Three.js scene was not mounted');
  assert.ok(sceneCheck.roomMesh?.meshes.length > 0, 'grounded room has no renderable Three.js mesh');
  assert.ok(sceneCheck.wallMesh?.meshes.length > 0, 'room boundary wall has no renderable Three.js mesh');
  await screenshot('04-scene-graph-and-threejs-from-grounded-region.png');
  const storedScene = await evaluate(`localStorage.getItem('unfold-spatial-scene.v1')`);
  assert.ok(storedScene && storedScene.includes('visual-kitchen') === false, 'unexpected hardcoded source id');
  assert.ok(storedScene && storedScene.includes('R_COZINHA'), 'scene serialization lost the Muse grounding identity');
  const forbidden = networkRequests.filter((url) => /\/api\/(?:meta|spatial-agent)/.test(url));
  assert.deepEqual(forbidden, [], 'E2E must not issue any Meta or spatial-agent request');
  const persistedBeforeRestore = await evaluate(`localStorage.getItem('unfold-spatial-scene.v1')`);
  assert.ok(persistedBeforeRestore?.includes('R_COZINHA'), 'scene graph was not persisted before restore');
  await click('#restore-scene');
  await waitFor('document.querySelector("#spatial-status").textContent.includes("Cena restaurada")', 10_000);
  await waitFor(`document.querySelector('#component-list')?.innerText.includes('Cozinha')`, 20_000);
  const restored = await evaluate(`(()=>{const row=[...document.querySelectorAll('#component-list [data-scene-node]')].find(e=>e.innerText.includes('Cozinha'));return {roomLabel:row?.innerText??null,revision:document.querySelector('#spatial-status')?.textContent,canvas:document.querySelector('#spatial-canvas')?.querySelectorAll('canvas').length??0,mesh:row&&window.__unfoldSpatialInspect?window.__unfoldSpatialInspect(row.dataset.sceneNode):null}})()`);
  assert.ok(restored.roomLabel?.includes('Cozinha'), 'persisted grounded label was lost after reload');
  assert.ok(restored.mesh?.meshes.length > 0, 'restored scene no longer has renderable Three.js geometry');
  await click('#fit-scene');
  await evaluate('new Promise(resolve=>setTimeout(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)),900))');
  await screenshot('05-restored-grounded-scene.png');
  const finalForbidden = networkRequests.filter((url) => /\/api\/(?:meta|spatial-agent)/.test(url));
  assert.deepEqual(finalForbidden, [], 'E2E must not issue any Meta or spatial-agent request');
  await writeFile(resolve(evidenceRoot, 'result.json'), JSON.stringify({ test: 'phase-10 saved real Muse grounding; no live request', sourceImage: { sha256, path: plan, width: 1280, height: 720 }, initial, kitchenAssociationReview: reviewed, sceneCheck, restored, metaRequests: finalForbidden, calibration: 'test-only explicit hypothetical scale; not measured from source' }, null, 2));
} finally {
  socket.close();
}
