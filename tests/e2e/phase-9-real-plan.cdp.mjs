import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import WebSocket from 'ws';

// Manual tracing proposals for two existing real drawings, not detector output or verified ground truth.
const which = process.env.UNFOLD_PLAN_CASE ?? 'A';
const directEditor = process.env.UNFOLD_DIRECT_EDITOR === '1';
const plans = {
  A: { file: 'reports/phase-7e4/evidence/architecture-source.png', width: 650, segments: [
    [[289,52],[544,52]], [[544,52],[544,330]], [[544,330],[289,330]], [[289,330],[289,52]],
    [[149,82],[289,82]], [[149,82],[149,255]],
    [[385,184],[430,184]], [[385,184],[385,255]], [[430,184],[430,269]],
    [[385,255],[407,255]], [[407,255],[407,330]], [[407,269],[544,269]], [[289,255],[349,255]],
  ], anchors: [[149,20],[548,20]], distance: '15.12', unit: 'm' },
  B: { file: 'reports/phase-8d/fixtures/amoureaux-house-plan.png', width: 3700, segments: [
    [[773,732],[2926,732]], [[2926,732],[2926,1894]], [[2926,1894],[773,1894]], [[773,1894],[773,732]],
  ], anchors: [[773,225],[2926,225]], distance: '50.2916667', unit: 'ft' },
};
const plan = plans[which]; if (!plan) throw new Error('Unsupported plan case');
const base = process.env.UNFOLD_E2E_URL ?? 'http://127.0.0.1:5194';
const debug = process.env.UNFOLD_CDP_URL ?? 'http://127.0.0.1:9227';
const output = resolve(process.env.UNFOLD_EVIDENCE_ROOT ?? 'reports/phase-9-drawing-to-world/evidence', which);
await mkdir(output, { recursive: true });
const image = resolve(process.env.UNFOLD_PLAN_IMAGE ?? plan.file);
const target = await (await fetch(`${debug}/json/new?about:blank`, { method: 'PUT' })).json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((done, reject) => { socket.once('open', done); socket.once('error', reject); });
let counter = 0; const pending = new Map(); const errors = []; const requests = [];
socket.on('message', (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  if (message.method === 'Fetch.requestPaused') {
    requests.push(message.params.request.url);
    void cdp('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode: 503, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: Buffer.from('{"error":{"code":"MODEL_API_KEY_MISSING"}}').toString('base64') });
  }
  if (message.id && pending.has(message.id)) { const wait = pending.get(message.id); pending.delete(message.id); message.error ? wait.reject(new Error(message.error.message)) : wait.resolve(message.result); }
});
function cdp(method, params = {}) { const id = ++counter; return new Promise((done, reject) => { pending.set(id, { resolve: done, reject }); socket.send(JSON.stringify({ id, method, params })); }); }
async function evaluate(expression) { const value = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description ?? value.exceptionDetails.text); return value.result?.value; }
async function waitFor(expression) {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    try { if (await evaluate(expression)) return; }
    catch (error) {
      // A full reload can invalidate the execution context between polling
      // iterations. Keep the same target and retry until its new document is ready.
      if (!(error instanceof Error) || !/Inspected target navigated or closed|Execution context was destroyed|Cannot find context with specified id/.test(error.message)) throw error;
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`Timeout: ${expression}`);
}
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const click = (selector) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing selector');e.click()})()`);
const set = (selector, value) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
async function screenshot(name) { const shot = await cdp('Page.captureScreenshot', { format: 'png', fromSurface: true }); await writeFile(resolve(output, name), Buffer.from(shot.data, 'base64')); }
async function upload() { const { root } = await cdp('DOM.getDocument', { depth: -1 }); const { nodeId } = await cdp('DOM.querySelector', { nodeId: root.nodeId, selector: '#plan-file' }); await cdp('DOM.setFileInputFiles', { nodeId, files: [image] }); await evaluate(`document.querySelector('#plan-file').dispatchEvent(new Event('change',{bubbles:true}))`); }
async function pointer(point, release = true) { const p = await evaluate(`(()=>{const s=document.querySelector('#plan-overlay'),r=s.getBoundingClientRect(),v=s.viewBox.baseVal;return {x:r.left+${point[0]}*r.width/v.width,y:r.top+${point[1]}*r.height/v.height}})()`); await cdp('Input.dispatchMouseEvent', { type: release ? 'mouseReleased' : 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: release ? 0 : 1, clickCount: 1 }); }
async function trace(a,b) { await pointer(a,false); await pointer(b,true); }
const result = { case: which, image, sha256: createHash('sha256').update(await readFile(image)).digest('hex'), method: 'manual tracing proposals; dimensions and geometry unreviewed', metaCalls: 0, checks: [], requests, errors };
try {
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('DOM.enable');
  const browserInfo = await cdp('Browser.getVersion');
  assert.doesNotMatch(browserInfo.userAgent, /Headless/i, 'E2E evidence requires a headed browser');
  result.browser = { product: browserInfo.product, userAgent: browserInfo.userAgent };
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{window.__phase9RenderTimes=[];for(const C of [window.WebGLRenderingContext,window.WebGL2RenderingContext]){if(!C||!Object.hasOwn(C.prototype,'clear'))continue;const original=C.prototype.clear;C.prototype.clear=function(...args){if(this.canvas?.parentElement?.id==='spatial-canvas')window.__phase9RenderTimes.push(performance.now());return original.apply(this,args)}}})()` });
  await cdp('Fetch.enable', { patterns: [{ urlPattern: `${base}/api/*`, requestStage: 'Request' }] });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: `${base}${directEditor ? '/spatial-editor' : '/demo'}?spatial-test=1` });
  await waitFor(directEditor ? `document.querySelector('.spatial-lab')` : `document.querySelector('#demo-open-spatial')`);
  await evaluate(`(()=>{for(const key of Object.keys(localStorage))if(key==='unfold-spatial-scene.v1'||key==='unfold-semantic-workspace.v1'||key.startsWith('unfold-semantic-workspace.v1:')||key.startsWith('unfold-semantic-workspace.quarantine.'))localStorage.removeItem(key);return new Promise((resolve)=>{const req=indexedDB.deleteDatabase('unfold-spatial-source.v1');req.onsuccess=req.onerror=req.onblocked=()=>resolve()})})()`);
  await cdp('Page.reload');
  await waitFor(directEditor ? `document.querySelector('.spatial-lab')` : `document.querySelector('#demo-open-spatial')`);
  await wait(250);
  if (!directEditor) { await click('#demo-open-spatial'); await waitFor(`document.querySelector('.spatial-lab')`); }
  await cdp('Emulation.setDeviceMetricsOverride', { width: 709, height: 900, deviceScaleFactor: 1, mobile: false });
  await wait(100);
  result.tabletEmptyLayout = await evaluate(`(()=>{const box=(s)=>{const r=document.querySelector(s).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};const panel=box('#source-panel'),empty=box('#stage-empty'),toolbar=document.querySelector('.spatial-toolbar');return {width:innerWidth,documentWidth:document.documentElement.scrollWidth,panel,empty,emptyVisible:!document.querySelector('#stage-empty').hidden,importVisible:!!document.querySelector('#empty-import')&&getComputedStyle(document.querySelector('#empty-import')).display!=='none',sourceHidden:getComputedStyle(document.querySelector('#source-panel')).display==='none',toolbarHidden:getComputedStyle(toolbar).display==='none'}})()`);
  assert.ok(result.tabletEmptyLayout.documentWidth <= result.tabletEmptyLayout.width, 'tablet empty editor must not create horizontal page overflow');
  assert.equal(result.tabletEmptyLayout.emptyVisible, true, 'the empty state must remain visible until a scene is created');
  assert.equal(result.tabletEmptyLayout.sourceHidden, true, 'empty state must not show a duplicate source panel');
  assert.equal(result.tabletEmptyLayout.importVisible, true, 'empty state must present one clear import action');
  assert.equal(result.tabletEmptyLayout.toolbarHidden, true, 'scene-editing tools must stay hidden until a scene exists');
  await screenshot('00-empty-tablet.png');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await upload(); await waitFor(`document.querySelector('#source-image').naturalWidth===${plan.width}`);
  assert.equal(await evaluate(`document.querySelector('.spatial-lab').dataset.state`), 'source', 'loading a raster must leave the empty state and activate the source workflow');
  assert.equal(await evaluate(`document.querySelector('#plan-workflow').hidden`), false, 'the original and tracing controls must be visible after upload');
  assert.notEqual(await evaluate(`getComputedStyle(document.querySelector('#source-panel')).display`), 'none', 'the source panel must be visible after upload');
  assert.notEqual(await evaluate(`getComputedStyle(document.querySelector('#stage-empty')).display`), 'block', 'the empty-state card must not cover the loaded drawing');
  result.checks.push('upload actualiza o estado para source e revela workflow raster antes do tracing');
  await screenshot('01-original.png');
  await click('#detect-lines'); await waitFor(`document.querySelector('#spatial-status').textContent.includes('segmentos axiais candidatos')`);
  await click('[data-view-mode="trace"]');
  result.detectedCandidates = await evaluate(`document.querySelectorAll('#candidate-list [data-candidate]').length`);
  result.detectedClosedRegions = await evaluate(`document.querySelectorAll('#region-list [data-region]').length`);
  result.detectedRegionGeometry = await evaluate(`[...document.querySelectorAll('#plan-overlay polygon[data-region]')].map((element)=>({id:element.dataset.region,points:element.getAttribute('points')}))`);
  result.ambiguousOpeningCandidates = await evaluate(`document.querySelectorAll('#opening-candidate-list [data-opening-candidate]').length`);
  result.detectedCandidateIds = await evaluate(`[...document.querySelectorAll('#candidate-list [data-candidate]')].map((e)=>e.dataset.candidate)`);
  result.detectedCandidateGeometry = await evaluate(`[...document.querySelectorAll('#plan-overlay line[data-id]')].map((e)=>({id:e.dataset.id,start:[Number(e.getAttribute('x1')),Number(e.getAttribute('y1'))],end:[Number(e.getAttribute('x2')),Number(e.getAttribute('y2'))],strokeWidth:Number(e.getAttribute('stroke-width')),thicknessPx:Number(e.dataset.thickness),confidence:Number(e.dataset.confidence)}))`);
  result.vectorModelStatus = await evaluate(`document.querySelector('#contour-summary').textContent`);
  await screenshot('02-candidates.png');
  if (result.detectedCandidates > 0) {
    await click('#candidate-list [data-candidate]');
    const splitDisabled = await evaluate(`document.querySelector('#split-segment')?.disabled ?? true`);
    if (!splitDisabled) {
      await click('#split-segment');
      await waitFor(`document.querySelectorAll('#candidate-list [data-candidate]').length>${result.detectedCandidates}`);
      assert.equal(await evaluate(`document.querySelectorAll('#candidate-list [aria-pressed="true"]').length`), 2);
      await click('#join-segments');
      await waitFor(`document.querySelectorAll('#candidate-list [data-candidate]').length===${result.detectedCandidates}`);
      result.checks.push('segmento candidato dividido e unido novamente pelo editor vectorial, sem construir geometria');
    } else result.checks.push('divisão vectorial não aplicável ao primeiro candidato seleccionado; mantido sem mutação');
  }
  await upload(); await waitFor(`document.querySelectorAll('#candidate-list [data-candidate]').length===0`);
  await click('[data-view-mode="trace"]'); await click('#trace-mode');
  for (const [a,b] of plan.segments) await trace(a,b);
  await click('#trace-mode');
  assert.equal(await evaluate(`document.querySelectorAll('#candidate-list [aria-pressed="true"]').length`), plan.segments.length);
  result.manualTracingClosedRegions = await evaluate(`document.querySelectorAll('#region-list [data-region]').length`);
  if (result.manualTracingClosedRegions > 0) {
    await evaluate(`document.querySelector('#plan-overlay [data-region]')?.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:1,clientY:1}))`);
    assert.match(await evaluate(`document.querySelector('#spatial-status').textContent`), /seleccionada para revisão/);
    result.regionBoundarySelectionCount = await evaluate(`document.querySelectorAll('#candidate-list [aria-pressed="true"]').length`);
    const ids = await evaluate(`[...document.querySelectorAll('#candidate-list [data-candidate]')].map((item)=>item.dataset.candidate)`);
    for (const id of ids) {
      const isSelected = await evaluate(`(()=>{const item=[...document.querySelectorAll('#candidate-list [data-candidate]')].find((candidate)=>candidate.dataset.candidate===${JSON.stringify(id)});return item?.getAttribute('aria-pressed')==='true'})()`);
      if (!isSelected) await click(`#candidate-list [data-candidate="${id}"]`);
    }
    assert.equal(await evaluate(`document.querySelectorAll('#candidate-list [aria-pressed="true"]').length`), plan.segments.length);
  }
  await screenshot('03-manual-tracing.png'); await click('#scale-mode'); await pointer(plan.anchors[0],false); await pointer(plan.anchors[0]); await pointer(plan.anchors[1],false); await pointer(plan.anchors[1]);
  await set('#scale-distance', plan.distance); await set('#scale-unit', plan.unit); await set('#wall-height','2.72'); await set('#wall-thickness','0.15');
  await set('#scale-evidence', 'Cota impressa, âncoras manuais aproximadas; altura e espessura hipotéticas. Nenhuma medida é certificada.');
  await click('#build-scene'); await waitFor(`document.querySelectorAll('#component-list [data-scene-node]').length>=${plan.segments.length}`);
  await screenshot('04-build-start.png'); await wait(700); await screenshot('05-build-motion.png'); await wait(6500); await screenshot('06-built.png');
  let saved = await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`);
  assert.equal(saved.scene.nodes.filter((node) => node.component?.kind === 'wall').length, plan.segments.length); assert.equal(saved.scene.imageWorldMapping.provenance.validation, 'unreviewed');
  const firstWall = saved.scene.nodes.find((node) => node.component?.kind === 'wall');
  const firstRenderedWall = await evaluate(`window.__unfoldSpatialInspect?.(${JSON.stringify(firstWall.id)}) ?? null`);
  assert.ok(firstRenderedWall, 'built wall must be represented by an active Three.js object');
  assert.ok(Math.abs(Math.max(firstRenderedWall.size[0], firstRenderedWall.size[2]) - firstWall.geometry.sizeM[0]) < 0.03, 'rendered wall bounds must agree with the parametric Scene Graph');
  result.firstRenderedWall = firstRenderedWall;
  result.wallCount = saved.scene.nodes.filter((node) => node.component?.kind === 'wall').length;
  result.roomCount = saved.scene.nodes.filter((node) => node.component?.kind === 'room').length;
  const roomNode = saved.scene.nodes.find((node) => node.component?.kind === 'room');
  result.renderedRoom = roomNode ? await evaluate(`window.__unfoldSpatialInspect?.(${JSON.stringify(roomNode.id)}) ?? null`) : null;
  if (roomNode) assert.ok(result.renderedRoom?.meshes.some((mesh) => mesh.material === '0xb9b09f'), 'a proposed room polygon must produce a separately classified suggested floor surface');
  result.mapping = saved.scene.imageWorldMapping;
  if (which === 'A' && !directEditor) {
    async function add(wallId, kind, offset, width, height, sill) {
      const beforeCount = await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1')).scene.nodes.filter(n=>n.component?.kind===${JSON.stringify(kind)}).length`);
      await click(`[data-scene-node="${wallId}"]`);
      await set('#opening-kind',kind); await set('#opening-offset',offset); await set('#opening-width',width); await set('#opening-height',height); await set('#opening-sill',sill);
      await click('#add-opening'); await waitFor(`!document.querySelector('#commit-preview').disabled`); await click('#commit-preview');
      await waitFor(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1')).scene.nodes.filter(n=>n.component?.kind===${JSON.stringify(kind)}).length===${beforeCount + 1}`);
    }
    const openingWalls = await evaluate(`(()=>JSON.parse(localStorage.getItem('unfold-spatial-scene.v1')).scene.nodes.filter(n=>n.component?.kind==='wall').map(n=>({id:n.id,length:n.geometry?.sizeM?.[0]})))()`);
    const windowWall = openingWalls.find((wall) => wall.length >= 3.29);
    const doorWall = openingWalls.find((wall) => wall.id !== windowWall?.id && wall.length >= 2.6);
    assert.ok(windowWall && doorWall, 'the traced scene must include walls long enough for the explicit test openings');
    await add(windowWall.id, 'window', 1.29, 2.0, 1.2, 0.9);
    await add(doorWall.id, 'door', 1.8, 0.8, 2.05, 0);
    saved = await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`);
    const door = saved.scene.nodes.find((node) => node.component?.kind === 'door');
    assert.ok(door); assert.equal(saved.scene.nodes.filter((node) => node.component?.kind === 'window').length, 1);
    await click(`[data-scene-node="${door.id}"]`); await set('#edit-opening-width','0.9'); await click('#preview-opening'); await waitFor(`!document.querySelector('#commit-preview').disabled`);
    assert.equal((await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`)).scene.nodes.find((n) => n.id === door.id).geometry.sizeM[0], 0.8);
    await click('#commit-preview');
    await waitFor(`document.querySelector('#commit-preview').disabled && JSON.parse(localStorage.getItem('unfold-spatial-scene.v1')).scene.nodes.find((node)=>node.id===${JSON.stringify(door.id)}).geometry.sizeM[0]===0.9`);
    saved = await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`);
    const committedDoor = saved.scene.nodes.find((n) => n.id === door.id);
    assert.ok(Math.abs(committedDoor.geometry.sizeM[0] - 0.9) < 1e-9, `opening commit did not persist the preview: ${JSON.stringify({ expected: 0.9, actual: committedDoor.geometry.sizeM[0], status: await evaluate(`document.querySelector('#spatial-status').textContent`), preview: await evaluate(`document.querySelector('#preview-status').textContent`), enabled: await evaluate(`document.querySelector('#commit-preview').disabled`) })}`);
    await click('#undo-scene'); await waitFor(`document.querySelector('#spatial-status').textContent.startsWith('Desfeito · revisão')`);
    assert.ok(Math.abs((await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`)).scene.nodes.find((n) => n.id === door.id).geometry.sizeM[0] - 0.8) < 1e-9);
    await click('#redo-scene'); await waitFor(`document.querySelector('#spatial-status').textContent.startsWith('Refeito · revisão')`);
    const redoneDoorWidth = (await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`)).scene.nodes.find((n) => n.id === door.id).geometry.sizeM[0];
    assert.ok(Math.abs(redoneDoorWidth - 0.9) < 1e-9, `opening redo did not restore committed geometry: ${JSON.stringify({ expected: 0.9, actual: redoneDoorWidth, status: await evaluate(`document.querySelector('#spatial-status').textContent`) })}`);
    result.checks.push('porta e janela adicionadas por parâmetros hipotéticos explícitos; largura da porta alterada com preview, commit, undo e redo');
    const beforeCommand = await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`);
    const wall = beforeCommand.scene.nodes[0];
    const windowNode = beforeCommand.scene.nodes.find((node) => node.component?.kind === 'window');
    await click(`[data-scene-node="${wall.id}"]`);
    assert.equal(await evaluate(`document.querySelector('#plan-overlay [data-id="${wall.component.properties.sourceCandidate.value}"]')?.getAttribute('stroke')`), '#fff1ca');
    await set('#demo-question', 'Aumenta esta parede em 50 centímetros.'); await click('#demo-submit');
    await waitFor(`document.querySelector('#demo-command-state').textContent==='AWAITING_CONFIRMATION' && !document.querySelector('#commit-preview').disabled`);
    assert.equal((await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`)).scene.nodes[0].geometry.sizeM[0], wall.geometry.sizeM[0]);
    assert.match(await evaluate(`document.querySelector('#demo-messages').textContent`), /parser local determinístico/);
    await screenshot('10-local-command-preview.png'); await click('#commit-preview');
    const afterCommand = await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`);
    assert.ok(Math.abs(afterCommand.scene.nodes[0].geometry.sizeM[0] - wall.geometry.sizeM[0] - 0.5) < 1e-8);
    assert.equal(afterCommand.scene.nodes.find((node) => node.id === windowNode.id).component.properties.offset.value, windowNode.component.properties.offset.value);
    await click('#compare-scene');
    await waitFor(`document.querySelector('#compare-scene').getAttribute('aria-pressed')==='true'`);
    assert.match(await evaluate(`document.querySelector('#spatial-status').textContent`), /revisão anterior/);
    await screenshot('12-before-after.png');
    await click('#compare-scene');
    await waitFor(`document.querySelector('#compare-scene').getAttribute('aria-pressed')==='false'`);
    result.checks.push('comando local relativo de 50 cm identificou o provider, criou preview e aplicou uma transacção mantendo o offset da janela');
    result.checks.push('comparação alterna para a revisão anterior real sem substituir a revisão canónica mais recente');
    await click('#clear-focus');
    const beforeClarification = await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`);
    await set('#demo-question', 'Aumenta esta parede em 50 centímetros.'); await click('#demo-submit');
    await waitFor(`document.querySelector('#demo-command-state').textContent==='CLARIFICATION'`);
    assert.deepEqual((await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`)).scene.nodes.map((node) => node.geometry?.sizeM), beforeClarification.scene.nodes.map((node) => node.geometry?.sizeM), 'an ambiguity must preserve the canonical scene');
    await set('#demo-question', 'Parede 1'); await click('#demo-submit');
    await waitFor(`document.querySelector('#demo-command-state').textContent==='AWAITING_CONFIRMATION' && !document.querySelector('#commit-preview').disabled`);
    assert.deepEqual((await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`)).scene.nodes.map((node) => node.geometry?.sizeM), beforeClarification.scene.nodes.map((node) => node.geometry?.sizeM), 'clarification continuation must still be preview-only');
    await click('#commit-preview');
    const resumedCommand = await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`);
    assert.ok(Math.abs(resumedCommand.scene.nodes[0].geometry.sizeM[0] - beforeClarification.scene.nodes[0].geometry.sizeM[0] - 0.5) < 1e-8);
    await click('#undo-scene');
    await waitFor(`document.querySelector('#spatial-status').textContent.startsWith('Desfeito · revisão')`);
    assert.ok(Math.abs((await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`)).scene.nodes[0].geometry.sizeM[0] - beforeClarification.scene.nodes[0].geometry.sizeM[0]) < 1e-8);
    result.checks.push('pedido sem alvo pediu esclarecimento; “Parede 1” retomou a intenção vinculada à mesma revisão, criou apenas preview e permitiu commit/undo sem /api/conversation');
  }
  await click('#top-view'); await wait(900); await click('[data-view-mode="compare"]'); await screenshot('07-top-overlay.png');
  await click('[data-view-mode="model"]'); await evaluate('window.__phase9RenderTimes=[]'); await click('#iso-view'); await wait(900); await screenshot('08-isometric.png');
  result.metrics = await evaluate(`(()=>{const canvas=document.querySelector('#spatial-canvas canvas');const gl=canvas.getContext('webgl2')||canvas.getContext('webgl');const ext=gl?.getExtension('WEBGL_debug_renderer_info');const canvases=[...document.querySelectorAll('canvas')].map(c=>{const context=c.getContext('webgl2')||c.getContext('webgl');return {parent:c.parentElement?.id||'',contextLost:context?.isContextLost()??null}});return {readout:document.querySelector('#spatial-metrics')?.textContent,renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'masked',dpr:devicePixelRatio,canvases}})()`);
  assert.match(result.metrics.renderer, /AMD|Radeon|NVIDIA|Intel/i, 'headed E2E should expose a hardware renderer, not only SwiftShader');
  result.metrics.renderTimesMs = await evaluate('window.__phase9RenderTimes');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await click('#source-toggle'); await click('#clear-focus'); await click('#iso-view');
  const firstComponent = await evaluate(`document.querySelector('#component-list [data-scene-node]')?.dataset.sceneNode`);
  if (firstComponent) await click(`#component-list [data-scene-node="${firstComponent}"]`);
  await wait(800); await screenshot('11-mobile.png');
  result.mobile = await evaluate(`(()=>{const rect=(s)=>{const r=document.querySelector(s).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};const conversation=document.querySelector('#demo-conversation');const header=document.querySelector('.demo-conversation-header');const toolbar=document.querySelector('.spatial-toolbar');const source=document.querySelector('#source-panel');const inspector=document.querySelector('.inspector');return {width:innerWidth,documentWidth:document.documentElement.scrollWidth,conversation:{...rect('#demo-conversation'),visible:!conversation.hidden,headerClientWidth:header.clientWidth,headerScrollWidth:header.scrollWidth},command:rect('.demo-command'),toolbar:{...rect('.spatial-toolbar'),scrollWidth:toolbar.scrollWidth,clientWidth:toolbar.clientWidth},source:{...rect('#source-panel'),visible:getComputedStyle(source).opacity!=='0'},inspector:{...rect('.inspector'),visible:!inspector.hidden}}})()`);
  assert.ok(result.mobile.documentWidth <= result.mobile.width);
  if (result.mobile.conversation.visible) {
    assert.ok(result.mobile.conversation.height <= 181, 'mobile conversation must stay compact and scroll internally');
    assert.ok(result.mobile.conversation.headerScrollWidth <= result.mobile.conversation.headerClientWidth + 1, 'mobile conversation controls must not wrap or overflow');
  }
  assert.ok(result.mobile.toolbar.width <= result.mobile.width && result.mobile.toolbar.left >= 0, 'mobile scene toolbar must remain inside the viewport');
  assert.ok(!result.mobile.source.visible || !result.mobile.inspector.visible || result.mobile.source.right <= 0, 'mobile source and inspector must not occupy the same screen area');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  const beforeRebuild = await evaluate(`localStorage.getItem('unfold-spatial-scene.v1')`);
  await evaluate(`window.confirm=()=>false`); await click('#build-scene');
  assert.equal(await evaluate(`localStorage.getItem('unfold-spatial-scene.v1')`), beforeRebuild, 'declining destructive rebuild must preserve the canonical scene');
  result.checks.push('reconstrução repetida foi recusada sem perder a cena editada ou o histórico');
  await click('#save-scene');
  if (directEditor) { await cdp('Page.navigate', { url: `${base}/spatial-editor` }); await waitFor(`document.querySelector('.spatial-lab')`); }
  else {
    await click('#exit-spatial-editor'); await waitFor(`!document.querySelector('.spatial-lab')`);
    await click('#demo-open-spatial'); await waitFor(`document.querySelector('.spatial-lab')`);
    await cdp('Page.reload'); await waitFor(`document.readyState==='complete' && document.querySelector('.spatial-lab')`);
    await waitFor(`!!document.querySelector('#source-image') && document.querySelector('#source-image').naturalWidth===${plan.width}`);
    assert.equal(await evaluate(`document.querySelector('#plan-meta').textContent.includes('original preservado localmente')`), true, 'full refresh must restore the source raster bound to the scene hash');
    result.checks.push('refresh completo recupera a imagem original persistida e associa-a ao hash da cena');
  }
  await click('#restore-scene');
  await waitFor(`document.querySelectorAll('#component-list [data-scene-node]').length>=${plan.segments.length}`);
  assert.equal(await evaluate(`localStorage.getItem('unfold-spatial-scene.v1')`), beforeRebuild, 'restore must preserve the complete persisted transaction, not merely node count');
  await screenshot('09-restored.png');
  result.checks.push(directEditor ? 'cena spatial_scene.v1 guardada e restaurada na rota de compatibilidade do editor' : 'cena spatial_scene.v1 guardada e restaurada dentro de /demo');
  const restoredScene = await evaluate(`localStorage.getItem('unfold-spatial-scene.v1')`);
  await writeFile(resolve(output, 'restored.spatial-scene.json'), restoredScene);
  assert.deepEqual(requests.map((url) => new URL(url).pathname), which === 'A' && !directEditor ? ['/api/spatial-agent', '/api/spatial-agent'] : [], 'only explicit offline-fallback spatial-agent requests may occur; follow-up clarifications must not escape to /api/conversation');
  assert.deepEqual(errors, []); await writeFile(resolve(output, 'result.json'), JSON.stringify(result,null,2)); console.log(JSON.stringify(result,null,2));
} finally { socket.close(); await fetch(`${debug}/json/close/${target.id}`).catch(() => undefined); }
