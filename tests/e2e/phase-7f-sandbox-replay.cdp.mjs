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
const actualAnalysis = saved.response;
const sourcePath = path.join(reportRoot, 'evidence/electrical-source.png');
const profileDir = await mkdtemp(path.join(os.tmpdir(), 'unfold-7f-sandbox-chrome-'));
const chrome = spawn(process.env.CHROME_BIN ?? '/usr/bin/google-chrome', ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profileDir}`, '--window-size=1440,1000', 'http://127.0.0.1:5173/demo'], { stdio: 'ignore' });
const pending = new Map(); let socket; let sessionId; let nextId = 0;
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function waitUntil(check, label, timeoutMs = 90000) { const start = Date.now(); while (Date.now() - start < timeoutMs) { if (await check()) return; if (chrome.exitCode !== null) throw new Error(`Chromium exited ${chrome.exitCode}`); await sleep(100); } throw new Error(`Timeout waiting for ${label}`); }
try {
  await mkdir(evidenceDir, { recursive: true });
  await waitUntil(async () => { try { return Number((await readFile(path.join(profileDir, 'DevToolsActivePort'), 'utf8')).split('\n')[0]) > 0; } catch { return false; } }, 'CDP startup', 15000);
  const port = Number((await readFile(path.join(profileDir, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
  const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json());
  socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) { const task = pending.get(message.id); pending.delete(message.id); if (message.error) task.reject(new Error(message.error.message)); else task.resolve(message.result); return; }
    if (message.sessionId === sessionId && message.method === 'Fetch.requestPaused' && message.params.request.url.includes('/api/meta/image')) {
      const body = Buffer.from(JSON.stringify(actualAnalysis)).toString('base64');
      void send('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json; charset=utf-8' }], body });
    }
  });
  const rootSend = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const targets = await rootSend('Target.getTargets'); const target = targets.targetInfos.find((item) => item.type === 'page' && item.url.includes('/demo')); assert.ok(target);
  sessionId = (await rootSend('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
  function send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params, sessionId })); }); }
  async function evaluate(expression) { const out = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description ?? out.exceptionDetails.text); return out.result?.value; }
  async function screenshot(name) { const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(path.join(evidenceDir, name), Buffer.from(result.data, 'base64')); }
  await send('Page.enable'); await send('Runtime.enable'); await send('Fetch.enable', { patterns: [{ urlPattern: '*://127.0.0.1:5173/api/meta/image*', requestStage: 'Request' }] });
  await waitUntil(() => evaluate('!!document.querySelector("#demo-image-input")'), 'demo ready');
  const documentRoot = await send('DOM.getDocument'); const input = await send('DOM.querySelector', { nodeId: documentRoot.root.nodeId, selector: '#demo-image-input' });
  await send('DOM.setFileInputFiles', { files: [sourcePath], nodeId: input.nodeId });
  await evaluate('document.querySelector("#demo-image-input").dispatchEvent(new Event("change",{bubbles:true}))');
  await waitUntil(() => evaluate('document.querySelector("#demo-image-confirm")?.hidden === false'), 'image preview');
  await evaluate('document.querySelector("#demo-image-confirm").click()');
  await waitUntil(() => evaluate('document.querySelector("#demo-image-insight")?.dataset.imageState === "success"'), 'saved live A/B document rendered');
  const independence = await evaluate('document.querySelector("#demo-electrical-sandbox > p")?.textContent');
  assert.ok(independence?.includes('modelo independente'));
  await evaluate('(()=>{const f=document.querySelector("#demo-electrical-form");for(const [n,v] of Object.entries({voltageV:"230",currentLimitA:"5",lightingVA:"100",outletVA:"600"}))f.elements.namedItem(n).value=v;f.elements.namedItem("confirmedTopology").checked=true;f.requestSubmit()})()');
  await waitUntil(() => evaluate('document.querySelector("#demo-electrical-result")?.hidden === false'), 'hypothetical calculation');
  const nominal = await evaluate('document.querySelector("#demo-electrical-readout").textContent');
  const provenance = await evaluate('document.querySelector("#demo-electrical-provenance").textContent');
  assert.ok(provenance.includes('NÃO É ENSAIO FÍSICO'));
  assert.match(nominal, /3\.043 A/);
  await evaluate('document.querySelector("#demo-electrical-result").scrollIntoView({block:"center",behavior:"instant"})');
  await screenshot('04-electrical-sandbox-nominal.png');
  await evaluate('document.querySelector("#demo-electrical-load-value").value="1500";document.querySelector("#demo-electrical-update-load").click()');
  const increased = await evaluate('document.querySelector("#demo-electrical-readout").textContent');
  assert.match(increased, /6\.957 A/);
  assert.match(increased, /SOBRECARGA NOMINAL/);
  assert.match(increased, /não representa disparo/i);
  assert.match(increased, /não prevê actuação de disjuntor/i);
  await screenshot('05-electrical-sandbox-overload-hypothetical.png');
  console.log(JSON.stringify({ status: 'PASS_OFFLINE_SANDBOX_REPLAY', replayedDocument: 'saved real A/B response; no image call', independence, provenance, nominal, increased, providerCalls: 0 }));
} finally { try { socket?.close(); } catch {} chrome.kill('SIGTERM'); }
