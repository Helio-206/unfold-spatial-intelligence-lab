import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const reportRoot = path.join(root, 'reports/phase-7f');
const liveDir = path.join(reportRoot, 'live');
const evidenceDir = path.join(reportRoot, 'evidence/live');
const saved = JSON.parse(await readFile(path.join(liveDir, 'electrical-analysis-response.json'), 'utf8'));
const electricalDocumentResponse = saved.response;
assert.equal(electricalDocumentResponse.document?.schema, 'technical_document.v1');
assert.equal(electricalDocumentResponse.document?.primaryDomain, 'electrical_installation');
assert.equal(electricalDocumentResponse.extraction?.status, 'complete');
const sourcePath = path.join(reportRoot, 'evidence/electrical-source.png');
const profileDir = await mkdtemp(path.join(os.tmpdir(), 'unfold-7f-context-chrome-'));
const chrome = spawn(process.env.CHROME_BIN ?? '/usr/bin/google-chrome', [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--remote-debugging-port=0',
  `--user-data-dir=${profileDir}`, '--window-size=1440,1000', 'http://127.0.0.1:5173/demo',
], { stdio: 'ignore' });
const apiEvents = [];
const pending = new Map();
let socket;
let nextId = 0;
let pageSession;
let pausedImageRequest;
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function waitUntil(check, label, timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    if (chrome.exitCode !== null) throw new Error(`Chromium exited ${chrome.exitCode}`);
    await sleep(100);
  }
  throw new Error(`Timeout waiting for ${label}`);
}
try {
  await mkdir(liveDir, { recursive: true });
  await mkdir(evidenceDir, { recursive: true });
  await waitUntil(async () => { try { return Number((await readFile(path.join(profileDir, 'DevToolsActivePort'), 'utf8')).split('\n')[0]) > 0; } catch { return false; } }, 'CDP startup', 15000);
  const port = Number((await readFile(path.join(profileDir, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
  const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json());
  socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) {
      const task = pending.get(message.id); pending.delete(message.id);
      if (message.error) task.reject(new Error(message.error.message)); else task.resolve(message.result);
      return;
    }
    if (message.sessionId !== pageSession) return;
    if (message.method === 'Network.responseReceived' && message.params.response.url.includes('/api/')) apiEvents.push({ requestId: message.params.requestId, url: message.params.response.url, status: message.params.response.status });
    if (message.method === 'Fetch.requestPaused' && message.params.request.url.includes('/api/meta/image')) {
      pausedImageRequest = message.params.requestId;
      const body = Buffer.from(JSON.stringify(electricalDocumentResponse)).toString('base64');
      void send('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json; charset=utf-8' }, { name: 'cache-control', value: 'no-store' }], body });
    }
  });
  const rootSend = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const pageTargets = await rootSend('Target.getTargets');
  const target = pageTargets.targetInfos.find((item) => item.type === 'page' && item.url.includes('/demo'));
  assert.ok(target, 'isolated Chromium opened the existing /demo route');
  pageSession = (await rootSend('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
  function send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params, sessionId: pageSession })); }); }
  async function evaluate(expression) { const out = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description ?? out.exceptionDetails.text); return out.result?.value; }
  async function screenshot(name) { const out = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(path.join(evidenceDir, name), Buffer.from(out.data, 'base64')); }
  async function body(event) { const out = await send('Network.getResponseBody', { requestId: event.requestId }); return JSON.parse(out.base64Encoded ? Buffer.from(out.body, 'base64').toString() : out.body); }

  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*://127.0.0.1:5173/api/meta/image*', requestStage: 'Request' }] });
  await waitUntil(() => evaluate('!!document.querySelector("#demo-image-input")'), 'demo ready');
  const documentRoot = await send('DOM.getDocument');
  const input = await send('DOM.querySelector', { nodeId: documentRoot.root.nodeId, selector: '#demo-image-input' });
  await send('DOM.setFileInputFiles', { files: [sourcePath], nodeId: input.nodeId });
  await evaluate('document.querySelector("#demo-image-input").dispatchEvent(new Event("change",{bubbles:true}))');
  await waitUntil(() => evaluate('document.querySelector("#demo-image-confirm")?.hidden === false'), 'image preview');
  await evaluate('document.querySelector("#demo-image-confirm").click()');
  await waitUntil(() => evaluate('document.querySelector("#demo-image-insight")?.dataset.imageState === "success"'), 'actual saved analysis rendered in app');
  await waitUntil(() => Boolean(pausedImageRequest), 'image response replay intercepted');
  await screenshot('02-electrical-analysis-real.png');

  const question = 'Analisa este documento tecnicamente.';
  const messageCount = await evaluate('document.querySelectorAll("#demo-messages > *").length');
  await evaluate(`(()=>{const q=document.querySelector('#demo-question');q.value=${JSON.stringify(question)};q.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#demo-submit').click()})()`);
  await waitUntil(() => apiEvents.some((event) => event.url.includes('/api/conversation')), 'contextual conversation request', 45000);
  const conversationEvent = apiEvents.find((event) => event.url.includes('/api/conversation'));
  const conversation = await body(conversationEvent);
  await waitUntil(() => evaluate(`document.querySelectorAll('#demo-messages > *').length >= ${messageCount + 2}`), 'contextual answer displayed');
  const renderedMessages = await evaluate('Array.from(document.querySelectorAll("#demo-messages > *")).slice(-2).map(n=>n.textContent)');
  assert.equal(conversationEvent.status, 429, 'exhausted persistent budget blocks the browser replay without another provider call');
  await writeFile(path.join(liveDir, 'electrical-contextual-budget-guard.json'), `${JSON.stringify({ evidenceType: 'backend_budget_guard_no_provider_call', imageStage: 'exact saved real A/B response replayed into app', question, httpStatus: conversationEvent.status, response: conversation, renderedMessages, providerCallsFromThisReplay: 0 }, null, 2)}\n`);
  await screenshot('03-electrical-contextual-answer.png');

  const sandbox = await evaluate('(()=>{const p=document.querySelector("#demo-electrical-sandbox");return {exists:!!p,hidden:p?.hidden}})()');
  assert.ok(sandbox.exists, 'electrical sandbox is shown after the actual electrical analysis');
  await evaluate('(()=>{const f=document.querySelector("#demo-electrical-form");for(const [n,v] of Object.entries({voltageV:"230",currentLimitA:"5",lightingVA:"100",outletVA:"600"}))f.elements.namedItem(n).value=v;f.elements.namedItem("confirmedTopology").checked=true;f.requestSubmit()})()');
  await waitUntil(() => evaluate('document.querySelector("#demo-electrical-result")?.hidden === false'), 'hypothetical sandbox result');
  const nominal = await evaluate('document.querySelector("#demo-electrical-readout").textContent');
  const provenance = await evaluate('document.querySelector("#demo-electrical-provenance").textContent');
  assert.ok(provenance.includes('user_configured') || provenance.toLowerCase().includes('hipot'));
  await screenshot('04-electrical-sandbox-nominal.png');
  await evaluate('document.querySelector("#demo-electrical-load-value").value="1500";document.querySelector("#demo-electrical-update-load").click()');
  const overload = await evaluate('document.querySelector("#demo-electrical-readout").textContent');
  assert.notEqual(overload, nominal);
  assert.ok(/sobrecarga|acima|overload/i.test(overload), `expected configured nominal overload; got ${overload}`);
  await screenshot('05-electrical-sandbox-overload-hypothetical.png');
  assert.equal(JSON.parse(await readFile(path.join(reportRoot, 'runtime-call-budget.json'), 'utf8')).used, 3, 'only third and final authorized call used');
  console.log(JSON.stringify({ status: 'LIVE_ANALYSIS_AND_SANDBOX_WITH_CONTEXTUAL_CALL_FAILED', imageStage: 'replayed exact real A/B result; no provider call', conversation: { httpStatus: conversationEvent.status, error: conversation }, renderedMessages, sandbox: { provenance, nominal, overload }, finalBudget: { limit: 3, used: 3, remaining: 0 } }));
} finally {
  try { socket?.close(); } catch {}
  chrome.kill('SIGTERM');
}
