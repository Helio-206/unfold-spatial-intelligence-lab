import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import WebSocket from 'ws';

const baseUrl = process.env.UNFOLD_E2E_URL ?? 'http://127.0.0.1:5190';
const imagePath = resolve('reports/phase-7e4/evidence/architecture-source.png');
const outputDir = resolve('reports/phase-8c/evidence');
await mkdir(outputDir, { recursive: true });
const created = await fetch('http://127.0.0.1:9225/json/new?about:blank', { method: 'PUT' });
assert.equal(created.status, 200, 'Chromium remote debugging is unavailable.');
const target = await created.json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
let nextId = 0;
const pending = new Map();
const consoleErrors = [];
const apiRequests = [];
const glbNetwork = { requests: 0, status: undefined, mimeType: undefined, encodedBytes: undefined };
const glbRequestIds = new Set();
socket.on('message', (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(message.params.exceptionDetails.text);
  if (message.method === 'Network.requestWillBeSent' && new URL(message.params.request.url).pathname.startsWith('/api/')) apiRequests.push(message.params.request.url);
  if (message.method === 'Network.requestWillBeSent' && new URL(message.params.request.url).pathname.endsWith('/assets/architectural_library.glb')) { glbNetwork.requests += 1; glbRequestIds.add(message.params.requestId); }
  if (message.method === 'Network.responseReceived' && glbRequestIds.has(message.params.requestId)) { glbNetwork.status = message.params.response.status; glbNetwork.mimeType = message.params.response.mimeType; }
  if (message.method === 'Network.loadingFinished' && glbRequestIds.has(message.params.requestId)) glbNetwork.encodedBytes = message.params.encodedDataLength;
  if (message.id && pending.has(message.id)) { const { resolve, reject } = pending.get(message.id); pending.delete(message.id); message.error ? reject(new Error(message.error.message)) : resolve(message.result); }
});
function cdp(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
}
async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result?.value;
}
async function waitFor(expression, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await evaluate(expression)) return; await new Promise((resolve) => setTimeout(resolve, 100)); }
  throw new Error(`Timeout waiting for ${expression}`);
}
async function click(selector) { await evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`); }
async function setValue(selector, value) { await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`); }
async function screenshot(name) {
  const result = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
  const bytes = Buffer.from(result.data, 'base64');
  await writeFile(resolve(outputDir, name), bytes);
  return bytes;
}
async function upload(selector, filePath) {
  const { root } = await cdp('DOM.getDocument', { depth: -1 });
  const { nodeId } = await cdp('DOM.querySelector', { nodeId: root.nodeId, selector });
  assert.ok(nodeId, `File input ${selector} not found`);
  await cdp('DOM.setFileInputFiles', { nodeId, files: [filePath] });
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new Event('change',{bubbles:true}))`);
}
async function mouseAt(svgPoint, type) {
  const box = await evaluate(`(()=>{const r=document.querySelector('#plan-overlay').getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height,iw:Number(document.querySelector('#plan-overlay').viewBox.baseVal.width),ih:Number(document.querySelector('#plan-overlay').viewBox.baseVal.height)}})()`);
  const x = box.x + svgPoint.x * box.w / box.iw;
  const y = box.y + svgPoint.y * box.h / box.ih;
  await cdp('Input.dispatchMouseEvent', { type: type === 'down' ? 'mousePressed' : 'mouseReleased', x, y, button: 'left', buttons: type === 'down' ? 1 : 0, clickCount: 1 });
}
async function trace(start, end) {
  await mouseAt(start, 'down');
  const box = await evaluate(`(()=>{const r=document.querySelector('#plan-overlay').getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height,iw:Number(document.querySelector('#plan-overlay').viewBox.baseVal.width),ih:Number(document.querySelector('#plan-overlay').viewBox.baseVal.height)}})()`);
  const x = box.x + end.x * box.w / box.iw; const y = box.y + end.y * box.h / box.ih;
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}

const failures = [];
const evidence = { browser: 'Google Chrome headless via DevTools Protocol', baseUrl, imagePath, apiCallsObserved: 0, checks: [], screenshots: [], timingsMs: {}, renderer: {}, exceptions: consoleErrors };
try {
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
  await cdp('Page.navigate', { url: `${baseUrl}/spatial-editor` });
  await waitFor(`document.querySelector('.spatial-lab')?.dataset.state==='empty'`);
  evidence.checks.push('empty scene first; no geometry fabricated');
  evidence.renderer = await evaluate(`(()=>{const c=document.querySelector('#spatial-canvas canvas');const gl=c?.getContext('webgl2')||c?.getContext('webgl');let renderer='unavailable';try{renderer=gl?.getExtension('WEBGL_debug_renderer_info')?gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL):'masked'}catch{}return {dpr:devicePixelRatio,renderer,viewport:[innerWidth,innerHeight]}})()`);
  await upload('#plan-file', imagePath);
  await waitFor(`document.querySelector('#plan-workflow')?.hidden===false && !!document.querySelector('#source-image').naturalWidth`);
  assert.deepEqual(await evaluate(`(()=>{const i=document.querySelector('#source-image');return [i.naturalWidth,i.naturalHeight]})()`), [650, 446]);
  await screenshot('01-original-plan.png'); evidence.screenshots.push('01-original-plan.png');
  await click('#detect-lines'); await waitFor(`document.querySelectorAll('#candidate-list [data-candidate]').length>0`);
  evidence.checks.push(`raster detector suggested ${await evaluate(`document.querySelectorAll('#candidate-list [data-candidate]').length`)} candidates; manual choices remain explicit`);
  await screenshot('02-detection-candidates.png'); evidence.screenshots.push('02-detection-candidates.png');

  await click('#scale-mode');
  await mouseAt({ x: 149, y: 19 }, 'down'); await mouseAt({ x: 149, y: 19 }, 'up');
  await mouseAt({ x: 547, y: 19 }, 'down'); await mouseAt({ x: 547, y: 19 }, 'up');
  await setValue('#scale-distance', '15.12');
  await setValue('#wall-height', '2.7'); await setValue('#wall-thickness', '0.15');
  await setValue('#scale-evidence', 'Cota superior total legível no raster original: 15.12 m; altura e espessura são hipóteses explícitas do teste.');
  await click('#trace-mode');
  const traces = [
    [{ x: 150, y: 53 }, { x: 546, y: 53 }], [{ x: 546, y: 53 }, { x: 546, y: 331 }],
    [{ x: 546, y: 331 }, { x: 430, y: 331 }], [{ x: 430, y: 331 }, { x: 290, y: 331 }],
    [{ x: 290, y: 331 }, { x: 290, y: 82 }], [{ x: 290, y: 82 }, { x: 150, y: 82 }],
    [{ x: 150, y: 82 }, { x: 150, y: 254 }], [{ x: 150, y: 254 }, { x: 290, y: 254 }],
  ];
  for (const [a, b] of traces) await trace(a, b);
  assert.equal(await evaluate(`document.querySelectorAll('#candidate-list [data-candidate][aria-pressed="true"]').length`), 8);
  await screenshot('03-manual-tracing.png'); evidence.screenshots.push('03-manual-tracing.png');
  const buildStart = Date.now(); await click('#build-scene');
  await waitFor(`document.querySelector('#scene-components')?.hidden===false && document.querySelectorAll('#component-list [data-scene-node]').length===8`);
  evidence.timingsMs.sceneBuildWallClock = Date.now() - buildStart;
  await click('#save-scene');
  let snapshot = await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`);
  assert.equal(snapshot.scene.schema, 'spatial_scene.v1');
  assert.equal(snapshot.scene.imageWorldMapping.provenance.validation, 'unreviewed');
  assert.equal(snapshot.scene.nodes.length, 8);
  assert.equal(snapshot.scene.sourceDocuments.length, 0, 'manual upload has no accepted technical-document reference');
  assert.equal(new Set(snapshot.scene.nodes.map((node) => node.id)).size, 8);
  evidence.geometry = { imageSha256: snapshot.scene.imageWorldMapping.sourceImageSha256, imageSizePx: snapshot.scene.imageWorldMapping.imageSizePx, scaleAnchorPx: 398, printedDimensionM: 15.12, derivedPxPerM: 398 / 15.12, scaleValidation: snapshot.scene.imageWorldMapping.provenance.validation, wallIds: snapshot.scene.nodes.map((node) => node.id), wallHeightsM: [...new Set(snapshot.scene.nodes.map((node) => node.geometry.sizeM[1]))], wallThicknessesM: [...new Set(snapshot.scene.nodes.map((node) => node.geometry.sizeM[2]))] };
  evidence.checks.push('8 manually traced wall proposals converted to spatial_scene.v1 with unique IDs; scale unreviewed; heights/thickness explicitly hypothetical');
  await new Promise((resolve) => setTimeout(resolve, 1200));
  evidence.timingsMs.sceneBuildReported = await evaluate(`document.querySelector('#spatial-metrics').textContent`);
  await screenshot('04-built-scene.png'); evidence.screenshots.push('04-built-scene.png');

  const longest = [...snapshot.scene.nodes].sort((a,b)=>b.geometry.sizeM[0]-a.geometry.sizeM[0])[0];
  await click(`[data-scene-node="${longest.id}"]`);
  await waitFor(`document.querySelector('#inspector').hidden===false`);
  await screenshot('05-selected-wall.png'); evidence.screenshots.push('05-selected-wall.png');
  const initialWall = snapshot.scene.nodes.find((node) => node.id === longest.id);
  const oldLength = initialWall.geometry.sizeM[0];
  await setValue('#opening-offset', '0.2'); await setValue('#opening-width', '0.8'); await setValue('#opening-height', '2.0'); await setValue('#opening-sill', '0');
  await click('#add-opening'); await waitFor(`document.querySelector('#commit-preview').disabled===false`); await click('#commit-preview');
  await waitFor(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1')).scene.nodes.some(n=>n.id.startsWith('opening-'))`);
  snapshot = await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`);
  const opening = snapshot.scene.nodes.find((node) => node.component?.kind === 'door'); assert.ok(opening);
  const beforePosition = [...opening.transform.translationM];
  await click(`[data-scene-node="${longest.id}"]`);
  await setValue('#wall-length', String(oldLength + 1)); await setValue('#wall-height-edit', '2.8'); await setValue('#wall-thickness-edit', '0.18');
  await setValue('#wall-x', String(initialWall.transform.translationM[0] + 0.1));
  await setValue('#wall-z', String(initialWall.transform.translationM[2] - 0.1));
  await click('#preview-wall'); await waitFor(`document.querySelector('#commit-preview').disabled===false`);
  await screenshot('06-edit-preview.png'); evidence.screenshots.push('06-edit-preview.png');
  await click('#commit-preview');
  snapshot = await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`);
  const changedWall = snapshot.scene.nodes.find((node) => node.id === longest.id);
  const changedOpening = snapshot.scene.nodes.find((node) => node.id === opening.id);
  assert.equal(changedWall.geometry.sizeM[0], oldLength + 1);
  assert.equal(changedWall.geometry.sizeM[1], 2.8); assert.equal(changedWall.geometry.sizeM[2], 0.18);
  assert.notDeepEqual(changedOpening.transform.translationM, beforePosition);
  const currentLength = changedWall.geometry.sizeM[0];
  evidence.geometry.edit = { wallId: longest.id, lengthBeforeM: oldLength, lengthAfterM: currentLength, heightAfterM: changedWall.geometry.sizeM[1], thicknessAfterM: changedWall.geometry.sizeM[2], positionAfterM: changedWall.transform.translationM, dependentOpeningId: opening.id, openingPositionBeforeM: beforePosition, openingPositionAfterM: changedOpening.transform.translationM };
  evidence.checks.push('wall length/position/height/thickness committed; dependent door position recalculated from wall geometry');
  await screenshot('07-edited-scene.png'); evidence.screenshots.push('07-edited-scene.png');
  await click(`[data-scene-node="${opening.id}"]`); await click('#remove-opening');
  await waitFor(`document.querySelector('#commit-preview').disabled===false`); await click('#commit-preview');
  snapshot = await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`);
  assert.equal(snapshot.scene.nodes.some((node) => node.id === opening.id), false);
  await click('#undo-scene'); snapshot = await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`);
  assert.equal(snapshot.scene.nodes.some((node) => node.id === opening.id), true);
  await click('#redo-scene'); snapshot = await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`);
  assert.equal(snapshot.scene.nodes.some((node) => node.id === opening.id), false);
  await click('#undo-scene');
  evidence.checks.push('opening removal is committed and reversible through Undo/Redo');
  await click('#undo-scene');
  snapshot = await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`);
  assert.equal(snapshot.scene.nodes.find((node) => node.id === longest.id).geometry.sizeM[0], oldLength);
  await click('#redo-scene');
  snapshot = await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`);
  assert.equal(snapshot.scene.nodes.find((node) => node.id === longest.id).geometry.sizeM[0], currentLength);
  evidence.checks.push('Undo restores prior wall revision; Redo restores edited revision');
  await click('#save-scene'); await waitFor(`localStorage.getItem('unfold-spatial-scene.v1')!==null`);
  const saved = await evaluate(`localStorage.getItem('unfold-spatial-scene.v1')`);
  const storedTransaction = JSON.parse(saved);
  const priorScene = storedTransaction.undoStack.at(-1);
  assert.ok(priorScene, 'saved transaction must retain an earlier scene revision');
  const earlierRevision = JSON.stringify({ scene: priorScene, undoStack: storedTransaction.undoStack.slice(0, -1), redoStack: [] });
  await evaluate(`localStorage.setItem('unfold-spatial-scene.v1',${JSON.stringify(earlierRevision)})`);
  await click('#restore-scene');
  await waitFor(`document.querySelectorAll('#component-list [data-scene-node]').length>0`);
  assert.equal(await evaluate(`document.querySelectorAll('#component-list [data-scene-node]').length`), 9);
  const restored = await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`);
  assert.equal(restored.scene.nodes.find((node) => node.id === longest.id).geometry.sizeM[0], oldLength);
  evidence.checks.push('saved scene transaction restored an earlier valid revision through the spatial_scene.v1 validator; restoration is explicit, not automatic on reload');
  await screenshot('08-restored-scene.png'); evidence.screenshots.push('08-restored-scene.png');

  for (const assetId of ['wall_ext_3000','partition_int_3000','door_single_900','window_double_1200','connector_corner_90','connector_isolated_foot','mechanical_frame_1000']) {
    await evaluate(`(()=>{const e=document.querySelector('#module-choice');e.value=${JSON.stringify(assetId)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await click('#add-module'); await waitFor(`document.querySelector('#commit-preview').disabled===false`);
    await click('#commit-preview');
    const hasAsset = await evaluate(`(()=>{const t=JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'));return t.scene.nodes.some(n=>n.geometry?.kind==='mesh_reference'&&n.geometry.assetId===${JSON.stringify(assetId)})})()`);
    assert.equal(hasAsset, true, `GLB module ${assetId} must be represented by a committed mesh reference`);
    await click('#undo-scene');
  }
  evidence.checks.push('all seven named Blender library modules can be added as mesh_reference nodes and undone');
  glbNetwork.performance = await evaluate(`(()=>{const e=performance.getEntriesByType('resource').filter(x=>new URL(x.name).pathname.endsWith('/assets/architectural_library.glb')).at(-1);return e?{durationMs:e.duration,transferSize:e.transferSize,decodedBodySize:e.decodedBodySize}:null})()`);
  assert.ok(glbNetwork.performance?.decodedBodySize > 0, 'browser performance timing must report decoded GLB size');

  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await waitFor(`innerWidth===390`);
  const mobile = await evaluate(`({width:innerWidth,height:innerHeight,bodyWidth:document.documentElement.scrollWidth,toolbarWidth:document.querySelector('.spatial-toolbar').clientWidth,toolbarScrollWidth:document.querySelector('.spatial-toolbar').scrollWidth,canvas:!!document.querySelector('#spatial-canvas canvas')})`);
  assert.equal(mobile.bodyWidth, 390); assert.ok(mobile.toolbarScrollWidth <= mobile.toolbarWidth + 1, 'mobile toolbar must not require horizontal scrolling');
  evidence.mobile = mobile;
  const touchBefore = await screenshot('09-mobile-viewport.png'); evidence.screenshots.push('09-mobile-viewport.png');
  const touchCanvas = await evaluate(`(()=>{const r=document.querySelector('#spatial-canvas canvas').getBoundingClientRect();return {x:r.left+Math.min(300,r.width*.7),y:r.top+r.height*.55}})()`);
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchCanvas.x, y: touchCanvas.y, id: 1 }] });
  await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchCanvas.x + 34, y: touchCanvas.y + 22, id: 1 }] });
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await new Promise((resolve) => setTimeout(resolve, 500));
  const touchAfter = await screenshot('09-mobile-touch-orbit.png'); evidence.screenshots.push('09-mobile-touch-orbit.png');
  assert.notEqual(createHash('sha256').update(touchBefore).digest('hex'), createHash('sha256').update(touchAfter).digest('hex'), 'touch orbit should change the rendered camera view');
  evidence.checks.push('mobile viewport emulation: toolbar fits; single-touch drag changed rendered camera view. Physical-device behavior remains unverified.');

  await cdp('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 1 });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: `${baseUrl}/demo` });
  await waitFor(`document.querySelector('#demo-scene canvas')`);
  await click('#demo-empty-example'); await waitFor(`document.querySelector('#demo-empty-state')?.hidden===true`);
  await waitFor(`document.querySelector('.demo-shell')?.dataset.demoPhase==='READY'`, 5000);
  const fourbar = await evaluate(`({canvas:!!document.querySelector('#demo-scene canvas'),empty:document.querySelector('#demo-empty-state')?.hidden,crank:document.querySelector('#demo-crank-length')?.textContent,status:document.querySelector('#demo-solver')?.textContent,provenance:document.querySelector('#demo-mode-provenance')?.textContent})`);
  assert.equal(fourbar.canvas, true); assert.equal(fourbar.empty, true); assert.match(fourbar.crank, /40 mm/); assert.match(fourbar.status, /SOLVED/);
  await screenshot('10-fourbar-workspace-regression.png'); evidence.screenshots.push('10-fourbar-workspace-regression.png');
  evidence.checks.push('Four-Bar Lab loads through its existing example route with solver controls and hypothetical provenance; no Meta/API calls issued by this E2E');
  evidence.demo = fourbar;
  evidence.glb = glbNetwork;
  assert.equal(glbNetwork.requests, 1); assert.equal(glbNetwork.status, 200); assert.ok((glbNetwork.encodedBytes ?? 0) > 0);
  evidence.checks.push('browser fetched the Blender GLB over HTTP 200; GLB meshes are instantiated by the adapter tests and scene palette');
  evidence.apiCallsObserved = apiRequests.length;
  assert.equal(apiRequests.length, 0, `unexpected API requests: ${apiRequests.join(', ')}`);
  assert.equal(consoleErrors.length, 0, `browser exceptions: ${consoleErrors.join('; ')}`);
  evidence.checks.push('no uncaught browser exceptions');
  await writeFile(resolve(outputDir, 'e2e-results.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  failures.push(error instanceof Error ? error.stack : String(error));
  evidence.failures = failures;
  try { await screenshot('e2e-failure.png'); } catch {}
  await writeFile(resolve(outputDir, 'e2e-results.json'), JSON.stringify(evidence, null, 2));
  console.error(JSON.stringify(evidence, null, 2));
  process.exitCode = 1;
} finally {
  socket.close();
  await fetch(`http://127.0.0.1:9225/json/close/${target.id}`).catch(() => undefined);
}
