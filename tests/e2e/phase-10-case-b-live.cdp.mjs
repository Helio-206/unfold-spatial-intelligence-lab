import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import WebSocket from 'ws';

const baseUrl = process.env.UNFOLD_E2E_URL ?? 'http://127.0.0.1:5191';
const imagePath = resolve(process.env.UNFOLD_PLAN_FIXTURE ?? 'reports/phase-10-teardown/fixtures/amoureaux-house-plan.png');
const outputDir = resolve(process.env.UNFOLD_EVIDENCE_DIR ?? 'reports/phase-10-teardown/evidence/case-b');
const cdpPort = Number(process.env.UNFOLD_CDP_PORT ?? 9227);
await mkdir(outputDir, { recursive: true });
const created = await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: 'PUT' });
assert.equal(created.status, 200, 'Chromium com DevTools Protocol é necessário.');
const target = await created.json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
let id = 0;
const pending = new Map();
const errors = [];
const api = [];
const requests = new Map();
socket.on('message', (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map((item) => item.value ?? item.description).join(' '));
  if (message.method === 'Network.requestWillBeSent' && new URL(message.params.request.url).pathname === '/api/meta/image') requests.set(message.params.requestId, 'pending');
  if (message.method === 'Network.responseReceived' && requests.has(message.params.requestId)) {
    const requestId = message.params.requestId;
    const entry = { requestId, path: '/api/meta/image', status: message.params.response.status };
    api.push(entry);
    void cdp('Network.getResponseBody', { requestId }).then((body) => { entry.body = body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body; }).catch(() => {});
  }
  if (message.id && pending.has(message.id)) { const waiter = pending.get(message.id); pending.delete(message.id); message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result); }
});
function cdp(method, params = {}) { const requestId = ++id; return new Promise((resolve, reject) => { pending.set(requestId, { resolve, reject }); socket.send(JSON.stringify({ id: requestId, method, params })); }); }
async function evaluate(expression) { const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result?.value; }
async function waitFor(expression, timeoutMs = 15000) { const start = Date.now(); while (Date.now() - start < timeoutMs) { if (await evaluate(expression)) return; await new Promise((resolve) => setTimeout(resolve, 100)); } throw new Error(`Timeout: ${expression}`); }
async function click(selector) { await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('missing '+${JSON.stringify(selector)});e.click()})()`); }
async function upload(selector, file) { const { root } = await cdp('DOM.getDocument', { depth: -1 }); const { nodeId } = await cdp('DOM.querySelector', { nodeId: root.nodeId, selector }); assert.ok(nodeId, `Input ${selector} em falta.`); await cdp('DOM.setFileInputFiles', { nodeId, files: [file] }); await evaluate(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new Event('change',{bubbles:true}))`); }
async function screenshot(file) { const result = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true }); const data = Buffer.from(result.data, 'base64'); await writeFile(resolve(outputDir, file), data); return file; }

const image = await readFile(imagePath);
const result = { scenario: 'B · Amoureaux House HABS MO-1113, sheet 3/10', attribution: 'Library of Congress, Prints & Photographs Division, HABS MO-1113, sheet 3/10', source: imagePath, sourceSha256: createHash('sha256').update(image).digest('hex'), baseUrl, browser: 'Chromium DevTools Protocol', providerCalls: [], screenshots: [], checks: [], errors };
try {
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: `${baseUrl}/demo` });
  await waitFor(`document.querySelector('#demo-image-input')`);
  await screenshot('01-demo-empty.png'); result.screenshots.push('01-demo-empty.png');
  await upload('#demo-image-input', imagePath);
  await waitFor(`document.querySelector('#demo-image-preview')?.naturalWidth > 0`);
  result.checks.push('upload raster pela interface do UNFOLD; imagem ligada à sessão e pré-visualizada');
  await screenshot('02-plan-uploaded.png'); result.screenshots.push('02-plan-uploaded.png');
  await click('#demo-image-confirm');
  await waitFor(`document.querySelector('#demo-image-insight')?.dataset.imageState === 'success'`, 120000);
  await waitFor(`document.querySelector('#demo-image-results')?.hidden === false`);
  result.analysis = await evaluate(`(()=>({status:document.querySelector('#demo-image-insight')?.dataset.imageState,summary:document.querySelector('#demo-image-result-summary')?.textContent,domain:document.querySelector('#demo-document-facts')?.innerText,uncertainty:document.querySelector('#demo-document-uncertainty')?.innerText,missing:document.querySelector('#demo-document-missing')?.innerText,buildButton:{exists:!!document.querySelector('#demo-build-spatial'),disabled:document.querySelector('#demo-build-spatial')?.disabled,hidden:document.querySelector('#demo-build-spatial')?.hidden}}))()`);
  result.providerCalls = api.map(({ path, status }) => ({ path, status }));
  assert.equal(result.analysis.status, 'success');
  assert.equal(result.providerCalls.length, 1, 'A rota de imagem deve fazer uma análise em dois estágios sem retry.');
  assert.equal(result.providerCalls[0].status, 200);
  result.checks.push('análise multimodal real concluída; saída documental renderizada e separada de geometria');
  await screenshot('03-meta-analysis.png'); result.screenshots.push('03-meta-analysis.png');
  const build = await evaluate(`(()=>{const b=document.querySelector('#demo-build-spatial');return !!b && !b.disabled && !b.hidden})()`);
  if (build) {
    await click('#demo-build-spatial');
    await waitFor(`document.querySelector('.spatial-lab')`, 20000);
    result.checks.push('documento arquitectónico aceite transferido para o editor canónico de tracing');
    await screenshot('04-spatial-editor-handoff.png'); result.screenshots.push('04-spatial-editor-handoff.png');
  }
  await waitFor(`document.querySelector('#demo-image-insight')?.dataset.imageState === 'success'`);
} catch (error) {
  result.failure = error instanceof Error ? error.stack ?? error.message : String(error);
  result.providerCalls = api.map(({ path, status }) => ({ path, status }));
  try { await screenshot('failure-state.png'); result.screenshots.push('failure-state.png'); } catch {}
} finally {
  await writeFile(resolve(outputDir, 'case-b-live-e2e.json'), JSON.stringify(result, null, 2));
  await cdp('Page.close').catch(() => {}); socket.close();
}
console.log(JSON.stringify(result, null, 2));
if (result.failure) process.exitCode = 1;
