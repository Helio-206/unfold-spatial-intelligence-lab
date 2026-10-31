import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import WebSocket from 'ws';

const baseUrl = process.env.UNFOLD_E2E_URL ?? 'http://127.0.0.1:5193';
const debugUrl = process.env.UNFOLD_CDP_URL ?? 'http://127.0.0.1:9226';
const outputDir = resolve(process.env.UNFOLD_EVIDENCE_DIR ?? 'reports/phase-8f/evidence');
const scenePath = resolve('reports/phase-8d/evidence/plan-1d78e739dad5.spatial-scene.json');
await mkdir(outputDir, { recursive: true });
const seed = await readFile(scenePath, 'utf8');
const targetResponse = await fetch(`${debugUrl}/json/new?about:blank`, { method: 'PUT' });
assert.equal(targetResponse.status, 200, 'Chromium de teste via CDP não está disponível.');
const target = await targetResponse.json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolvePromise, reject) => { socket.once('open', resolvePromise); socket.once('error', reject); });
let nextId = 0;
const pending = new Map();
const errors = [];
const calls = [];
let selectedId;
socket.on('message', (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.method === 'Fetch.requestPaused') {
    const url = new URL(message.params.request.url);
    if (url.pathname === '/api/diagnostics') {
      const body = Buffer.from(JSON.stringify({ schema: 'unfold.backend_diagnostics.v1', contractVersion: 'unfold.backend.v1', buildId: '8f-offline-browser-mock', pipelineVersion: 'unfold.image_pipeline.ab.v2', responseSchemaVersion: 'technical_document.v1', recognitionSchemaVersion: 'technical_recognition.v2', startedAt: '2026-10-31T00:00:00.000Z', capabilities: { imageAnalysis: { available: true, apiKeyConfigured: true, responseContract: 'unfold.image_analysis.v1' }, contextualConversation: { available: true, apiKeyConfigured: true }, imageRegionVerification: { available: true, apiKeyConfigured: true } }, metaCallBudget: { limit: null, used: 0, remaining: null } })).toString('base64');
      void cdp('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body });
    } else if (url.pathname === '/api/spatial-agent') {
      const request = JSON.parse(message.params.request.postData);
      calls.push({ query: request.query, sceneRevisionId: request.scene?.revisionId ?? null, selectedId: request.scene?.selectedId ?? null, mode: request.mode });
      selectedId = request.scene?.selectedId ?? selectedId;
      let result;
      if (/desfaz|desfazer/i.test(request.query)) {
        result = { schema: 'spatial_agent_result.v1', kind: 'PROPOSE_ACTION', text: 'Vou desfazer a revisão imediatamente anterior.', basis: 'history', evidenceIds: selectedId ? [selectedId] : [], question: null, action: { kind: 'Undo', target: { reference: 'none', label: null, ordinal: null }, value: null, valueMode: null, unit: null, axis: null, opening: null } };
      } else if (/o que mudou|explica/i.test(request.query)) {
        result = { schema: 'spatial_agent_result.v1', kind: 'ANSWER', text: 'A revisão anterior aumentou a parede seleccionada em 0,50 m; a revisão actual preserva a operação e a proveniência geométrica.', basis: 'history', evidenceIds: selectedId ? [selectedId] : [], question: null, action: null };
      } else {
        result = { schema: 'spatial_agent_result.v1', kind: 'PROPOSE_ACTION', text: 'Proponho aumentar em 0,50 m a parede seleccionada.', basis: 'scene', evidenceIds: selectedId ? [selectedId] : [], question: null, action: { kind: 'Resize', target: { reference: 'selected', label: null, ordinal: null }, value: 0.5, valueMode: 'increase_by', unit: 'm', axis: null, opening: null } };
      }
      const body = Buffer.from(JSON.stringify({ result, sceneRevisionId: request.scene?.revisionId ?? null, meta: { model: 'muse-spark-1.3', requestId: `offline-cdp-${calls.length}` } })).toString('base64');
      void cdp('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body });
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
const wait = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const click = (selector) => evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('not found '+${JSON.stringify(selector)});el.click()})()`);
async function command(text) { await evaluate(`(()=>{const input=document.querySelector('#demo-question');input.value=${JSON.stringify(text)};input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#demo-submit').click()})()`); }
async function screenshot(name) {
  const shot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
  await writeFile(resolve(outputDir, name), Buffer.from(shot.data, 'base64'));
}

const result = { browser: 'Chromium headless via CDP', baseUrl, sourceScene: scenePath, sourceSceneClassification: '8D tracing; unreviewed geometry, offline E2E seed only', MetaCalls: 0, responseMode: 'browser-intercepted deterministic fixtures; not live Muse validation', calls, checks: [], screenshots: [], errors };
try {
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable'); await cdp('Fetch.enable', { patterns: [{ urlPattern: `${baseUrl}/api/*`, requestStage: 'Request' }] });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: `${baseUrl}/demo` });
  await waitFor(`document.querySelector('#demo-open-spatial')`);
  await evaluate(`localStorage.setItem('unfold-spatial-scene.v1',${JSON.stringify(seed)})`);
  await click('#demo-open-spatial'); await click('#demo-open-spatial');
  await waitFor(`document.querySelector('.spatial-lab') && document.querySelectorAll('#component-list [data-scene-node]').length===4`);
  const wallId = await evaluate(`document.querySelector('#component-list [data-scene-node]')?.dataset.sceneNode`);
  await click(`[data-scene-node="${wallId}"]`);
  const before = await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`);
  const sourceState = await evaluate(`document.querySelector('#source-state')?.textContent`);
  assert.match(sourceState, /sem documento-fonte/i, 'cena carregada sem documento deve ser identificada explicitamente');
  assert.equal(await evaluate(`document.querySelector('.demo-spatial-host')?.dataset.cameraView`), 'focus');
  await screenshot('01-spatial-agent-scene-selected.png'); result.screenshots.push('01-spatial-agent-scene-selected.png');
  await click('#iso-view'); await waitFor(`document.querySelector('.demo-spatial-host')?.dataset.cameraView==='isometric'`);
  await wait(800);
  await screenshot('05-camera-isometric.png'); result.screenshots.push('05-camera-isometric.png');
  await click('#top-view'); await waitFor(`document.querySelector('.demo-spatial-host')?.dataset.cameraView==='top'`);
  await wait(800);
  await screenshot('06-camera-top.png'); result.screenshots.push('06-camera-top.png');
  await click('#front-view'); await waitFor(`document.querySelector('.demo-spatial-host')?.dataset.cameraView==='front'`);
  await wait(800);
  await screenshot('07-camera-front.png'); result.screenshots.push('07-camera-front.png');
  await click('#iso-view'); await waitFor(`document.querySelector('.demo-spatial-host')?.dataset.cameraView==='isometric'`);
  result.cameraViews = ['focus', 'isometric', 'top', 'front'];
  result.sourceState = sourceState;
  await command('Aumenta esta parede em 50 centímetros.');
  await waitFor(`document.querySelector('#commit-preview')?.disabled===false`);
  const preview = await evaluate(`({state:document.querySelector('#demo-command-state').textContent,preview:document.querySelector('#preview-status').textContent,current:JSON.parse(localStorage.getItem('unfold-spatial-scene.v1')).scene.nodes.find(n=>n.id===${JSON.stringify(wallId)}).geometry.sizeM[0]})`);
  assert.equal(preview.current, before.scene.nodes.find((node) => node.id === wallId).geometry.sizeM[0], 'preview não pode persistir antes da confirmação');
  assert.match(preview.state, /AWAITING_CONFIRMATION/);
  result.preview = preview; result.checks.push('intenção estruturada mockada foi resolvida para a parede seleccionada; preview mantém Scene Graph canónico intacto');
  await screenshot('02-spatial-agent-preview-awaiting-confirmation.png'); result.screenshots.push('02-spatial-agent-preview-awaiting-confirmation.png');
  await click('#commit-preview'); await waitFor(`document.querySelector('#demo-command-state').textContent==='COMPLETE'`);
  const committed = await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`);
  const afterLength = committed.scene.nodes.find((node) => node.id === wallId).geometry.sizeM[0];
  assert.equal(afterLength, before.scene.nodes.find((node) => node.id === wallId).geometry.sizeM[0] + 0.5);
  assert.ok(committed.scene.revision.number > before.scene.revision.number);
  result.commit = { before: before.scene.nodes.find((node) => node.id === wallId).geometry.sizeM[0], after: afterLength, revisionBefore: before.scene.revision.number, revisionAfter: committed.scene.revision.number };
  result.checks.push('confirmação criou revisão real no spatial_scene.v1 e actualizou o modelo Three.js através do executor existente');
  await screenshot('03-spatial-agent-committed.png'); result.screenshots.push('03-spatial-agent-committed.png');
  await command('Desfaz a última alteração.');
  await waitFor(`document.querySelector('#demo-command-state').textContent==='COMPLETE'`);
  const undone = await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`);
  assert.equal(undone.scene.nodes.find((node) => node.id === wallId).geometry.sizeM[0], result.commit.before);
  result.checks.push('Undo interpretado pela fixture foi executado pelo mesmo executor transaccional');
  await screenshot('04-spatial-agent-undone.png'); result.screenshots.push('04-spatial-agent-undone.png');
  await command('O que mudou nesta estrutura?');
  await waitFor(`document.querySelectorAll('#demo-messages .demo-message-assistant').length>=3`);
  const answer = await evaluate(`document.querySelectorAll('#demo-messages .demo-message-assistant p')[2]?.textContent`);
  assert.match(answer, /0,50 m/);
  result.contextualAnswer = answer; result.checks.push('resposta contextual fixture não executou operação e aponta a alteração/histórico');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await click('#top-view'); await waitFor(`document.querySelector('.demo-spatial-host')?.dataset.cameraView==='top'`);
  await click('#front-view'); await waitFor(`document.querySelector('.demo-spatial-host')?.dataset.cameraView==='front'`);
  const mobileLayout = await evaluate(`({width:innerWidth,documentWidth:document.documentElement.scrollWidth,toolbarWidth:document.querySelector('.spatial-toolbar')?.getBoundingClientRect().width})`);
  assert.ok(mobileLayout.documentWidth <= mobileLayout.width, 'viewport móvel não deve introduzir overflow horizontal');
  result.mobileLayout = mobileLayout;
  await screenshot('08-mobile-camera-views.png'); result.screenshots.push('08-mobile-camera-views.png');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.sceneRevisionId && call.selectedId === wallId && call.mode === 'architecture'));
  assert.deepEqual(errors, [], 'sem excepções nem erros de consola');
} finally { socket.close(); }
result.mockCalls = calls.length;
await writeFile(resolve(outputDir, 'spatial-agent-e2e.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
