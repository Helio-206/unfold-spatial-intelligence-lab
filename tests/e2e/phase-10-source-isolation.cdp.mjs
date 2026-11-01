import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import WebSocket from 'ws';

const sourceA = process.env.UNFOLD_PLAN_A;
const sourceB = process.env.UNFOLD_PLAN_B;
if (!sourceA || !sourceB) throw new Error('Set UNFOLD_PLAN_A and UNFOLD_PLAN_B to the two real raster files.');
const base = process.env.UNFOLD_E2E_URL ?? 'http://127.0.0.1:5194';
const debug = process.env.UNFOLD_CDP_URL ?? 'http://127.0.0.1:9227';
const output = resolve(process.env.UNFOLD_EVIDENCE_ROOT ?? 'reports/phase-10-stabilization/evidence/source-isolation');
await mkdir(output, { recursive: true });
const target = await (await fetch(`${debug}/json/new?about:blank`, { method: 'PUT' })).json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((done, reject) => { socket.once('open', done); socket.once('error', reject); });
let sequence = 0;
const pending = new Map();
const errors = [];
const apiRequests = [];
socket.on('message', (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  if (message.method === 'Fetch.requestPaused') {
    apiRequests.push(message.params.request.url);
    void cdp('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode: 503, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: Buffer.from('{"error":{"code":"MODEL_API_KEY_MISSING"}}').toString('base64') });
  }
  if (message.id && pending.has(message.id)) {
    const wait = pending.get(message.id); pending.delete(message.id);
    message.error ? wait.reject(new Error(message.error.message)) : wait.resolve(message.result);
  }
});
function cdp(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolveResult, reject) => { pending.set(id, { resolve: resolveResult, reject }); socket.send(JSON.stringify({ id, method, params })); });
}
async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result?.value;
}
async function waitFor(expression, timeout = 25_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await evaluate(expression)) return; await new Promise((done) => setTimeout(done, 100)); }
  throw new Error(`Timeout: ${expression}`);
}
async function click(selector) { await evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element)throw Error('Missing '+${JSON.stringify(selector)});element.click()})()`); }
async function set(selector, value) { await evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});element.value=${JSON.stringify(String(value))};element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}))})()`); }
async function upload(file) {
  const { root } = await cdp('DOM.getDocument', { depth: -1 });
  const { nodeId } = await cdp('DOM.querySelector', { nodeId: root.nodeId, selector: '#plan-file' });
  await cdp('DOM.setFileInputFiles', { nodeId, files: [file] });
  await evaluate(`document.querySelector('#plan-file').dispatchEvent(new Event('change',{bubbles:true}))`);
}
async function point(x, y) {
  const position = await evaluate(`(()=>{const svg=document.querySelector('#plan-overlay'),rect=svg.getBoundingClientRect(),view=svg.viewBox.baseVal;return {x:rect.left+${x}*rect.width/view.width,y:rect.top+${y}*rect.height/view.height}})()`);
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: position.x, y: position.y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: position.x, y: position.y, button: 'left', buttons: 0, clickCount: 1 });
}
async function screenshot(name) { const shot = await cdp('Page.captureScreenshot', { format: 'png', fromSurface: true }); await writeFile(resolve(output, name), Buffer.from(shot.data, 'base64')); }
const result = { sourceA: { path: sourceA, sha256: createHash('sha256').update(await readFile(sourceA)).digest('hex') }, sourceB: { path: sourceB, sha256: createHash('sha256').update(await readFile(sourceB)).digest('hex') }, metaCalls: 0, assertions: [], apiRequests, errors };
try {
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('DOM.enable');
  const browser = await cdp('Browser.getVersion');
  assert.doesNotMatch(browser.userAgent, /Headless/i, 'requires headed browser');
  result.browser = { product: browser.product, userAgent: browser.userAgent };
  await cdp('Fetch.enable', { patterns: [{ urlPattern: `${base}/api/*`, requestStage: 'Request' }] });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: `${base}/demo?spatial-test=1` });
  await waitFor(`document.readyState==='complete' && document.querySelector('#demo-open-spatial')`);
  await evaluate(`localStorage.removeItem('unfold-spatial-scene.v1')`);
  await click('#demo-open-spatial'); await waitFor(`document.querySelector('.spatial-lab')`);
  await upload(sourceA); await waitFor(`document.querySelector('#source-image').naturalWidth>0`);
  await click('#detect-lines'); await waitFor(`document.querySelector('#spatial-status').textContent.includes('segmentos axiais candidatos')`);
  const firstCandidate = await evaluate(`document.querySelector('#candidate-list [data-candidate]')?.dataset.candidate`);
  assert.ok(firstCandidate, 'first real plan must produce at least one candidate for this isolation test');
  result.recycledCandidateId = firstCandidate;
  await click(`#candidate-list [data-candidate="${firstCandidate}"]`);
  await click('#scale-mode'); await point(20, 20); await point(120, 20);
  await set('#scale-distance', '10'); await set('#scale-unit', 'm'); await set('#wall-height', '2.7'); await set('#wall-thickness', '0.15'); await set('#scale-evidence', 'Explicit test calibration; not a verified measurement.');
  await click('#build-scene');
  await waitFor(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1')||'null')?.scene?.nodes?.some(node=>node.component?.properties?.sourceCandidate?.value===${JSON.stringify(firstCandidate)})`);
  const before = await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`);
  result.beforeRevision = before.scene.revision.id;
  result.beforeWallIds = before.scene.nodes.filter((node) => node.component?.kind === 'wall').map((node) => node.id);
  assert.ok(result.beforeWallIds.includes(`wall-${firstCandidate}`));
  await upload(sourceB); await waitFor(`document.querySelector('#source-image').naturalWidth>1000`);
  await click('#detect-lines'); await waitFor(`document.querySelector('#spatial-status').textContent.includes('segmentos axiais candidatos')`);
  const recycled = await evaluate(`document.querySelector('#candidate-list [data-candidate="${firstCandidate}"]')`);
  assert.ok(recycled, `second real plan must emit the same deterministic ID ${firstCandidate}`);
  await evaluate(`document.querySelector('#plan-overlay [data-id="${firstCandidate}"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
  assert.equal(await evaluate(`document.querySelectorAll('#component-list .is-selected').length`), 0, 'new raster candidate must not select a component from the previous scene');
  assert.match(await evaluate(`document.querySelector('#source-state').textContent`), /não corresponde à cena preservada/);
  result.assertions.push('candidate ID recycling across two real images does not cross-link or select the prior scene');
  await screenshot('source-mismatch-isolated.png');
  const oldWall = result.beforeWallIds[0];
  await click(`[data-scene-node="${oldWall}"]`);
  await set('#demo-question', 'Aumenta esta parede em 50 centímetros.'); await click('#demo-submit');
  await waitFor(`document.querySelector('#demo-command-state').textContent==='CLARIFICATION'`);
  assert.match(await evaluate(`document.querySelector('#demo-command-message').textContent`), /pertence a outra imagem\/documento/);
  assert.deepEqual((await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`)).scene.revision, before.scene.revision, 'stale-scene command must not mutate or persist');
  assert.equal(apiRequests.length, 0, 'stale-source gate must run before any API request');
  result.assertions.push('spatial command is blocked before network, preview, mutation, or persistence');
  await click('#preview-wall');
  assert.equal(await evaluate(`document.querySelector('#commit-preview').disabled`), true, 'direct inspector edit must not produce a preview');
  assert.match(await evaluate(`document.querySelector('#spatial-status').textContent`), /pertence a outra imagem\/documento/);
  assert.deepEqual((await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`)).scene.revision, before.scene.revision);
  result.assertions.push('direct inspector edit is blocked and previous canonical revision remains unchanged');
  assert.deepEqual(errors, [], 'no uncaught browser exceptions');
  result.passed = true;
  await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  result.passed = false; result.failure = error instanceof Error ? error.message : String(error);
  await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2));
  throw error;
} finally { socket.close(); }
