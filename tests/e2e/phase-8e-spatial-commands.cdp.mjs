import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import WebSocket from 'ws';

const baseUrl = process.env.UNFOLD_E2E_URL ?? 'http://127.0.0.1:5192';
const outputDir = resolve('reports/phase-8e/evidence');
const scenePath = resolve('reports/phase-8d/evidence/plan-1d78e739dad5.spatial-scene.json');
const acceptedRecordPath = resolve('reports/phase-7e4/live/step-1-architecture-B-resume.json');
const acceptedImagePath = resolve('reports/phase-7e4/evidence/architecture-source.png');
const electricalRecordPath = resolve('reports/phase-7f/live/electrical-analysis-response.json');
const electricalImagePath = resolve('reports/phase-7f/evidence/electrical-source.png');
await mkdir(outputDir, { recursive: true });
const seed = await readFile(scenePath, 'utf8');
const targetResponse = await fetch('http://127.0.0.1:9225/json/new?about:blank', { method: 'PUT' });
assert.equal(targetResponse.status, 200, 'Chromium headed com CDP não está disponível.');
const target = await targetResponse.json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolvePromise, reject) => { socket.once('open', resolvePromise); socket.once('error', reject); });
let nextId = 0;
const pending = new Map();
const errors = [];
let metaRequests = 0;
let savedElectricalReplayRequests = 0;
let diagnosticContractReplayRequests = 0;
const electricalRecord = JSON.parse(await readFile(electricalRecordPath, 'utf8'));
socket.on('message', (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.method === 'Network.requestWillBeSent' && /(^|\.)api\.meta\.ai$/i.test(new URL(message.params.request.url).hostname)) metaRequests += 1;
  if (message.method === 'Fetch.requestPaused') {
    const pathname = new URL(message.params.request.url).pathname;
    if (pathname === '/api/meta/image') {
      savedElectricalReplayRequests += 1;
      const body = Buffer.from(JSON.stringify(electricalRecord.response)).toString('base64');
      void cdp('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json; charset=utf-8' }], body });
    } else if (pathname === '/api/diagnostics') {
      diagnosticContractReplayRequests += 1;
      const body = Buffer.from(JSON.stringify({ schema: 'unfold.backend_diagnostics.v1', contractVersion: 'unfold.backend.v1', buildId: '8e-offline-recorded-response-replay', pipelineVersion: 'unfold.image_pipeline.ab.v2', responseSchemaVersion: 'technical_document.v1', recognitionSchemaVersion: 'technical_recognition.v2', startedAt: '2026-10-31T00:00:00.000Z', capabilities: { imageAnalysis: { available: true, apiKeyConfigured: true, responseContract: 'unfold.image_analysis.v1' }, contextualConversation: { available: true, apiKeyConfigured: true }, imageRegionVerification: { available: true, apiKeyConfigured: true } }, metaCallBudget: { limit: null, used: 0, remaining: null } })).toString('base64');
      void cdp('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json; charset=utf-8' }], body });
    }
  }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(' '));
  if (message.id && pending.has(message.id)) {
    const waiter = pending.get(message.id); pending.delete(message.id);
    message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
  }
});
function cdp(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolvePromise, reject) => { pending.set(id, { resolve: resolvePromise, reject }); socket.send(JSON.stringify({ id, method, params })); });
}
async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result?.value;
}
async function waitFor(expression, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) { if (await evaluate(expression)) return; await new Promise((resolvePromise) => setTimeout(resolvePromise, 100)); }
  throw new Error(`Timeout: ${expression}`);
}
const click = (selector) => evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('not found '+${JSON.stringify(selector)});el.click()})()`);
async function command(text) {
  await evaluate(`(()=>{const input=document.querySelector('#demo-question');input.value=${JSON.stringify(text)};input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#demo-submit').click()})()`);
}
async function screenshot(name) {
  const shot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
  await writeFile(resolve(outputDir, name), Buffer.from(shot.data, 'base64'));
}

const result = { browser: 'Google Chrome headed via DevTools Protocol', baseUrl, sourceScene: scenePath, sourceSceneClassification: 'preserved PHASE 8D manual-tracing evidence; geometry remains unreviewed', metaCalls: 0, checks: [], screenshots: [], errors };
try {
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: `${baseUrl}/demo` });
  await waitFor(`document.querySelector('#demo-open-spatial')`);
  await evaluate(`localStorage.setItem('unfold-spatial-scene.v1',${JSON.stringify(seed)})`);
  await click('#demo-open-spatial');
  await click('#demo-open-spatial');
  await waitFor(`document.querySelector('.spatial-lab') && document.querySelectorAll('#component-list [data-scene-node]').length===4`);
  const mode = await evaluate(`({url:location.pathname,bar:!document.querySelector('#demo-question').disabled,canvas:[...document.querySelectorAll('canvas')].map(c=>{const gl=c.getContext('webgl2')??c.getContext('webgl');const ext=gl?.getExtension('WEBGL_debug_renderer_info');return {lost:gl?.isContextLost()??true,owner:c.closest('#demo-scene')?'four-bar':'architecture',renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'masked'}})})`);
  assert.equal(mode.url, '/demo'); assert.equal(mode.bar, true); assert.equal(await evaluate(`document.querySelectorAll('.spatial-lab').length`), 1, 'clique concorrente não pode montar um segundo editor');
  assert.equal(mode.canvas.filter((canvas) => !canvas.lost).length, 1, 'deve existir apenas um contexto WebGL não perdido durante o editor');
  result.runtimeArchitecture = mode; result.checks.push('editor integrado em /demo; command bar activa; renderer mecânico suspenso e apenas um contexto WebGL utilizável');
  result.metrics = { headedFramePacing: await evaluate(`new Promise(resolve=>{const samples=[];let last=performance.now();function frame(now){samples.push(now-last);last=now;if(samples.length===121){const s=[...samples].sort((a,b)=>a-b);resolve({samples:samples.length,meanMs:Number((samples.reduce((a,b)=>a+b,0)/samples.length).toFixed(2)),p50Ms:Number(s[60].toFixed(2)),p95Ms:Number(s[114].toFixed(2)),approxFps:Number((1000/(samples.reduce((a,b)=>a+b,0)/samples.length)).toFixed(1))})}else requestAnimationFrame(frame)}requestAnimationFrame(frame)})`), classification: 'headed browser rAF pacing, not Three.js render FPS; measured with normal UI activity' };
  await screenshot('01-architecture-editor-command-bar.png'); result.screenshots.push('01-architecture-editor-command-bar.png');

  const wallId = await evaluate(`document.querySelector('#component-list [data-scene-node]')?.dataset.sceneNode`);
  await click(`[data-scene-node="${wallId}"]`);
  const before = await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`);
  await command('Aumenta esta parede para cinco metros');
  await waitFor(`document.querySelector('#commit-preview')?.disabled===false`);
  const preview = await evaluate(`({length:JSON.parse(localStorage.getItem('unfold-spatial-scene.v1')).scene.nodes.find(n=>n.id===${JSON.stringify(wallId)}).geometry.sizeM[0],state:document.querySelector('#demo-command-state').textContent,preview:document.querySelector('#preview-status').textContent})`);
  assert.equal(preview.length, before.scene.nodes.find((node) => node.id === wallId).geometry.sizeM[0], 'preview não pode alterar persistência canónica');
  assert.match(preview.state, /AWAITING_CONFIRMATION/);
  result.preview = preview; result.checks.push('comando contextual criou preview com alvo seleccionado e sem mutar a revisão persistida');
  await screenshot('02-command-preview-awaiting-confirmation.png'); result.screenshots.push('02-command-preview-awaiting-confirmation.png');
  await click('#commit-preview');
  await waitFor(`document.querySelector('#demo-command-state').textContent==='COMPLETE'`);
  let current = await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`);
  assert.equal(current.scene.nodes.find((node) => node.id === wallId).geometry.sizeM[0], 5);
  result.checks.push('confirmação executou transacção e actualizou spatial_scene.v1 e geometria Three.js');

  await command('adiciona uma porta largura 90 cm altura 2 m offset 1 m peitoril 0 m');
  await waitFor(`document.querySelector('#commit-preview')?.disabled===false`);
  await click('#commit-preview'); await waitFor(`document.querySelector('#demo-command-state').textContent==='COMPLETE'`);
  current = await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`);
  const opening = current.scene.nodes.find((node) => node.component?.kind === 'door');
  assert.ok(opening); assert.deepEqual(opening.component.dependsOn, [wallId]);
  const initialOpeningPosition = opening.transform.translationM;
  await command('Aumenta esta parede para 5.5 m'); await waitFor(`document.querySelector('#commit-preview')?.disabled===false`);
  await click('#commit-preview'); await waitFor(`document.querySelector('#demo-command-state').textContent==='COMPLETE'`);
  current = await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`);
  const attached = current.scene.nodes.find((node) => node.id === opening.id);
  assert.notDeepEqual(attached.transform.translationM, initialOpeningPosition);
  result.checks.push('abertura criada via command, ligada à parede e recalculada após edição dimensional');
  await screenshot('03-wall-and-dependent-door-edited.png'); result.screenshots.push('03-wall-and-dependent-door-edited.png');

  const doorPositionAt55 = attached.transform.translationM;
  await command('Desfaz'); await waitFor(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1')).scene.nodes.find(n=>n.id===${JSON.stringify(wallId)}).geometry.sizeM[0]===5`);
  const doorPositionAt5 = await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1')).scene.nodes.find(n=>n.id===${JSON.stringify(opening.id)}).transform.translationM`);
  assert.notDeepEqual(doorPositionAt5, doorPositionAt55, 'Undo deve restaurar também a dependência geométrica');
  await command('Refaz'); await waitFor(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1')).scene.nodes.find(n=>n.id===${JSON.stringify(wallId)}).geometry.sizeM[0]===5.5`);
  assert.deepEqual(await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1')).scene.nodes.find(n=>n.id===${JSON.stringify(opening.id)}).transform.translationM`), doorPositionAt55, 'Redo deve reaplicar a posição dependente');
  await command('Guarda esta versão');
  result.checks.push('Undo/Redo restauram parede e porta dependente; Save grava a revisão canónica');

  await click('#exit-spatial-editor'); await waitFor(`!document.querySelector('.spatial-lab')`);
  await click('#demo-open-spatial'); await waitFor(`document.querySelector('.spatial-lab') && document.querySelectorAll('#component-list [data-scene-node]').length===5`);
  const restoredScene = await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`);
  assert.equal(restoredScene.scene.nodes.find((node) => node.id === wallId).geometry.sizeM[0], 5.5);
  assert.ok(restoredScene.scene.nodes.some((node) => node.id === opening.id && node.component?.dependsOn.includes(wallId)));
  result.checks.push('saída e reentrada restauram a revisão persistida com abertura e dependência validadas');
  await screenshot('05-restored-wall-and-dependent-door.png'); result.screenshots.push('05-restored-wall-and-dependent-door.png');
  await click(`[data-scene-node="${wallId}"]`);
  const beforeAmbiguous = await evaluate(`localStorage.getItem('unfold-spatial-scene.v1')`);
  await command('Move esta parede para a direita');
  await waitFor(`document.querySelector('#demo-command-state').textContent==='CLARIFICATION'`);
  assert.equal(await evaluate(`localStorage.getItem('unfold-spatial-scene.v1')`), beforeAmbiguous);
  result.checks.push('comando direccional ambíguo solicita esclarecimento sem mutar a cena');
  await screenshot('04-ambiguous-command-clarification.png'); result.screenshots.push('04-ambiguous-command-clarification.png');

  const canvasStates = await evaluate(`({canvases:[...document.querySelectorAll('canvas')].map(c=>({lost:c.getContext('webgl2')?.isContextLost()??c.getContext('webgl')?.isContextLost()??true,owner:c.closest('#demo-scene')?'four-bar':'architecture'})),selected:document.querySelector('#node-label')?.textContent,revision:JSON.parse(localStorage.getItem('unfold-spatial-scene.v1')).scene.revision.number})`);
  result.runtimeWhileEditing = canvasStates;
  await click('#exit-spatial-editor'); await waitFor(`!document.querySelector('.spatial-lab')`);
  await waitFor(`(()=>{const c=document.querySelector('#demo-scene canvas')?.getContext('webgl2')??document.querySelector('#demo-scene canvas')?.getContext('webgl');return !!c&&!c.isContextLost()})()`);
  const restored = await evaluate(`({canvas:[...document.querySelectorAll('canvas')].map(c=>({lost:c.getContext('webgl2')?.isContextLost()??c.getContext('webgl')?.isContextLost()??true,owner:c.closest('#demo-scene')?'four-bar':'architecture'})),bar:!document.querySelector('#demo-question').disabled})`);
  assert.equal(restored.canvas.filter((canvas) => !canvas.lost).length, 1);
  result.runtimeAfterExit = restored; result.checks.push('ao sair, o renderer Four-Bar recupera; o renderer arquitectónico é libertado, sem perda do Scene Graph persistido');
  await screenshot('06-four-bar-runtime-restored.png'); result.screenshots.push('06-four-bar-runtime-restored.png');
  await click('#demo-empty-example'); await waitFor(`document.querySelector('#demo-solver')?.textContent.includes('SOLVED')`, 7000);
  await waitFor(`window.__UNFOLD_DEMO_METRICS__?.().asset==='READY'`, 12000);
  result.checks.push('regressão Four-Bar resolvida no runtime recuperado; classificação permanece hipotética');
  result.fourBarMetrics = await evaluate(`window.__UNFOLD_DEMO_METRICS__?.()`);

  const acceptedRecord = JSON.parse(await readFile(acceptedRecordPath, 'utf8'));
  const acceptedDocument = acceptedRecord.document;
  const documentHash = createHash('sha256').update(JSON.stringify(acceptedDocument)).digest('hex');
  const imageBase64 = (await readFile(acceptedImagePath)).toString('base64');
  await evaluate(`new Promise((resolve,reject)=>{const req=indexedDB.open('unfold-spatial-source.v1',1);req.onupgradeneeded=()=>req.result.createObjectStore('pending');req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result;const tx=db.transaction('pending','readwrite');tx.objectStore('pending').put({blob:new Blob([Uint8Array.from(atob(${JSON.stringify(imageBase64)}),c=>c.charCodeAt(0))],{type:'image/png'}),name:'architecture-source.png',mimeType:'image/png',technicalDocumentRef:{documentId:'doc-${documentHash.slice(0,20)}',sha256:'${documentHash}'},technicalDocument:${JSON.stringify(acceptedDocument)}},'last-image');tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>reject(tx.error)}})`);
  await cdp('Page.navigate', { url: `${baseUrl}/demo?source=accepted-document` });
  await waitFor(`document.querySelector('#demo-open-spatial')`);
  await click('#demo-open-spatial');
  await waitFor(`document.querySelector('.spatial-lab') && document.querySelector('#accepted-document-context')?.hidden===false`);
  const handoff = await evaluate(`({context:document.querySelector('#accepted-document-context').textContent,sourceWidth:document.querySelector('#source-image').naturalWidth,componentCount:document.querySelectorAll('#component-list [data-scene-node]').length,sceneEmpty:document.querySelector('#scene-components').hidden})`);
  assert.ok(handoff.sourceWidth > 0); assert.equal(handoff.componentCount, 0); assert.equal(handoff.sceneEmpty, true);
  assert.match(handoff.context, /Nenhuma sala, área, parede ou abertura foi convertida automaticamente/);
  assert.match(handoff.context, /escala calibrada/);
  result.acceptedDocumentHandoff = handoff;
  result.checks.push('documento técnico real da PHASE 7E.4 associado à imagem original; handoff pede tracing/escala e não cria geometria');
  await screenshot('07-accepted-document-handoff-awaiting-tracing.png'); result.screenshots.push('07-accepted-document-handoff-awaiting-tracing.png');
  await click('#exit-spatial-editor'); await waitFor(`!document.querySelector('.spatial-lab')`);

  await cdp('Page.navigate', { url: `${baseUrl}/demo` });
  await waitFor(`document.querySelector('#demo-image-input')`);
  await cdp('Fetch.enable', { patterns: [{ urlPattern: '*://127.0.0.1:5192/api/meta/image*', requestStage: 'Request' }, { urlPattern: '*://127.0.0.1:5192/api/diagnostics*', requestStage: 'Request' }] });
  const electricalImage = await cdp('DOM.getDocument', { depth: -1 });
  const electricalInput = await cdp('DOM.querySelector', { nodeId: electricalImage.root.nodeId, selector: '#demo-image-input' });
  await cdp('DOM.setFileInputFiles', { nodeId: electricalInput.nodeId, files: [electricalImagePath] });
  await evaluate(`document.querySelector('#demo-image-input').dispatchEvent(new Event('change',{bubbles:true}))`);
  await waitFor(`document.querySelector('#demo-image-confirm')?.hidden===false`);
  await click('#demo-image-confirm');
  await waitFor(`document.querySelector('#demo-image-insight')?.dataset.imageState==='success'`);
  const electricalUi = await evaluate(`({domain:document.querySelector('#demo-document-domain').textContent,readiness:document.querySelector('#demo-image-readiness-status').textContent,sandboxHidden:document.querySelector('#demo-electrical-sandbox').hidden,facts:document.querySelector('#demo-document-facts').textContent,missing:document.querySelector('#demo-image-readiness-missing').textContent})`);
  assert.match(electricalUi.domain.toLowerCase(), /el[eé]tric/); assert.equal(electricalUi.sandboxHidden, false); assert.equal(electricalUi.readiness, 'BLOCKED');
  result.electricalRecordedRealResponseReplay = { phase: electricalRecord.phase, sourceImageSha256: electricalRecord.sourceImage.sha256, priorHttpStatus: electricalRecord.httpStatus, replayedRequests: savedElectricalReplayRequests, diagnosticsContractFixtureRequests: diagnosticContractReplayRequests, ui: electricalUi, liveCalls: 0 };
  result.checks.push('análise eléctrica real preservada foi reproduzida offline; documento consultável, sandbox hipotético visível e simulação documental permanece bloqueada');
  await screenshot('08-electrical-recorded-analysis-offline-replay.png'); result.screenshots.push('08-electrical-recorded-analysis-offline-replay.png');

  const contextualQuestion = electricalRecord.response.document.questions?.[0]?.question ?? 'Que cargas estão identificadas no documento?';
  await command(contextualQuestion);
  await waitFor(`document.querySelectorAll('#demo-messages .demo-message-assistant').length>0`);
  const contextual = await evaluate(`document.querySelector('#demo-messages .demo-message-assistant p')?.textContent`);
  assert.ok(contextual && contextual.length > 10);
  result.electricalRecordedContextualReplay = { question: contextualQuestion, answer: contextual, classification: 'local document-grounded response; saved historical extraction; no Muse Spark call' };
  await screenshot('09-electrical-contextual-answer-offline.png'); result.screenshots.push('09-electrical-contextual-answer-offline.png');

  await click('#demo-electrical-example');
  await waitFor(`document.querySelector('#demo-electrical-result')?.hidden===false`);
  const electricalSandbox = await evaluate(`({provenance:document.querySelector('#demo-electrical-provenance').textContent,readout:document.querySelector('#demo-electrical-readout').textContent})`);
  assert.match(electricalSandbox.provenance, /EXEMPLO INDEPENDENTE/);
  result.electricalSandbox = electricalSandbox;
  result.checks.push('Electrical Sandbox independente continua executável e rotulado como exemplo não derivado do documento');
  await screenshot('10-electrical-independent-sandbox.png'); result.screenshots.push('10-electrical-independent-sandbox.png');
  await cdp('Fetch.disable');
  assert.deepEqual(errors, [], 'sem erros de consola/excepções no browser');
} finally {
  socket.close();
}
result.metaCalls = metaRequests;
assert.equal(result.metaCalls, 0, 'esta fase não pode efectuar chamadas Meta');
result.savedElectricalReplayRequests = savedElectricalReplayRequests;
await writeFile(resolve(outputDir, 'spatial-commands-e2e.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
