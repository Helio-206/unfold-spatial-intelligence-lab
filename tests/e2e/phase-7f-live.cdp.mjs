import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const reportRoot = path.join(root, 'reports/phase-7f');
const evidenceDir = path.join(reportRoot, 'evidence/live');
const liveDir = path.join(reportRoot, 'live');
const sourcePath = path.join(reportRoot, 'evidence/electrical-source.png');
const source = await readFile(sourcePath);
const sourceSha256 = createHash('sha256').update(source).digest('hex');
const profileDir = await mkdtemp(path.join(os.tmpdir(), 'unfold-phase-7f-live-chrome-'));
await mkdir(evidenceDir, { recursive: true }); await mkdir(liveDir, { recursive: true });

const chrome = spawn(process.env.CHROME_BIN ?? '/usr/bin/google-chrome', [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
  '--remote-debugging-port=0', `--user-data-dir=${profileDir}`, '--window-size=1440,1000',
  'http://127.0.0.1:5173/demo',
], { stdio: 'ignore' });
let socket; let sessionId; let nextId = 0;
const pending = new Map(); const apiResponses = []; const failures = [];
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function waitUntil(check, label, timeoutMs = 90000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) return;
    if (chrome.exitCode !== null) throw new Error(`Chromium exited ${chrome.exitCode}`);
    await sleep(100);
  }
  throw new Error(`Timeout waiting for ${label}`);
}
try {
  let debugPort;
  await waitUntil(async () => { try { debugPort = Number((await readFile(path.join(profileDir, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); return Number.isInteger(debugPort) && debugPort > 0; } catch { return false; } }, 'CDP startup', 15000);
  const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then((r) => r.json());
  socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) { const task = pending.get(message.id); pending.delete(message.id); if (message.error) task.reject(new Error(message.error.message)); else task.resolve(message.result); return; }
    if (message.method === 'Network.responseReceived' && message.params.response.url.includes('/api/')) apiResponses.push({ requestId: message.params.requestId, url: message.params.response.url, status: message.params.response.status });
    if (message.method === 'Runtime.exceptionThrown') failures.push(message.params.exceptionDetails?.text ?? 'browser exception');
  });
  const rootSend = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const targets = await rootSend('Target.getTargets');
  const page = targets.targetInfos.find((item) => item.type === 'page' && item.url.includes('/demo'));
  assert.ok(page, 'the existing local /demo route is open in isolated Chrome');
  sessionId = (await rootSend('Target.attachToTarget', { targetId: page.targetId, flatten: true })).sessionId;
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params, sessionId })); });
  const evaluate = async (expression) => { const out = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description ?? out.exceptionDetails.text); return out.result?.value; };
  const screenshot = async (name) => { const out = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(path.join(evidenceDir, name), Buffer.from(out.data, 'base64')); };
  const responseBody = async (entry) => { const out = await send('Network.getResponseBody', { requestId: entry.requestId }); return JSON.parse(out.base64Encoded ? Buffer.from(out.body, 'base64').toString('utf8') : out.body); };

  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await evaluate('document.fonts.ready');
  await waitUntil(() => evaluate('!!document.querySelector("#demo-image-input")'), 'image input ready');
  const documentRoot = await send('DOM.getDocument');
  const input = await send('DOM.querySelector', { nodeId: documentRoot.root.nodeId, selector: '#demo-image-input' });
  assert.ok(input.nodeId);
  await send('DOM.setFileInputFiles', { files: [sourcePath], nodeId: input.nodeId });
  await evaluate('document.querySelector("#demo-image-input").dispatchEvent(new Event("change",{bubbles:true}))');
  await waitUntil(() => evaluate('document.querySelector("#demo-image-confirm")?.hidden === false'), 'electrical image preview');
  await screenshot('01-electrical-upload-confirm.png');
  const priorApiResponses = apiResponses.length;
  await evaluate('document.querySelector("#demo-image-confirm").click()');
  await waitUntil(() => evaluate('document.querySelector("#demo-image-results")?.hidden === false || document.querySelector(".demo-shell")?.dataset.imageState === "error"'), 'real A/B analysis result');
  const imageResponseEntry = apiResponses.slice(priorApiResponses).find((item) => item.url.includes('/api/meta/image'));
  assert.ok(imageResponseEntry, 'browser sent image analysis request through backend');
  const analysis = await responseBody(imageResponseEntry);
  await writeFile(path.join(liveDir, 'electrical-analysis-response.json'), `${JSON.stringify({ evidenceType: 'real_backend_response_no_image_payload', phase: '7F', sourceImage: { file: 'reports/phase-7f/evidence/electrical-source.png', sha256: sourceSha256, mimeType: 'image/png', byteLength: source.length }, httpStatus: imageResponseEntry.status, response: analysis }, null, 2)}\n`);
  await screenshot('02-electrical-analysis-real.png');
  const analysisStatus = {
    httpStatus: imageResponseEntry.status,
    apiStatus: analysis.status,
    recognitionDomain: analysis.recognition?.primaryDomain,
    extractionStatus: analysis.extraction?.status,
    schema: analysis.document?.schema,
    documentDomain: analysis.document?.primaryDomain,
    analysisState: analysis.document?.analysisState,
    elements: analysis.document?.elements?.length ?? 0,
    relations: analysis.document?.relations?.length ?? 0,
    stages: analysis.meta?.stages?.map((stage) => ({ stage: stage.stage, requestId: stage.requestId, httpStatus: stage.httpStatus, latencyMs: stage.latencyMs, usage: stage.usage, estimatedCostUsd: stage.estimatedCostUsd })),
  };
  const usableDocument = analysisStatus.httpStatus === 200 && analysisStatus.extractionStatus === 'complete' && analysisStatus.schema === 'technical_document.v1' && analysisStatus.documentDomain === 'electrical_installation' && analysisStatus.elements > 0;
  if (!usableDocument) {
    console.log(JSON.stringify({ status: 'STOP_AFTER_A_B_NOT_USABLE', sourceSha256, analysisStatus, apiResponseCount: apiResponses.length, browserFailures: failures }));
    process.exitCode = 2;
  } else {
    const question = 'Que conclusão contextual consegues justificar sobre as marcações eléctricas que aparecem nesta folha, e que associação entre marcações e componentes continuaria a ser especulativa?';
    const beforeConversation = apiResponses.length;
    await evaluate(`(()=>{const q=document.querySelector('#demo-question');q.value=${JSON.stringify(question)};q.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#demo-submit').click()})()`);
    await waitUntil(() => Promise.resolve(apiResponses.slice(beforeConversation).some((item) => item.url.includes('/api/conversation'))), 'one real contextual conversation request', 45000);
    const conversationEntry = apiResponses.slice(beforeConversation).find((item) => item.url.includes('/api/conversation'));
    assert.equal(conversationEntry?.status, 200);
    const conversation = await responseBody(conversationEntry);
    await waitUntil(() => evaluate('document.querySelector("#demo-messages").textContent.includes("UNFOLD")'), 'contextual response rendered');
    await writeFile(path.join(liveDir, 'electrical-contextual-response.json'), `${JSON.stringify({ evidenceType: 'real_provider_response', question, httpStatus: conversationEntry.status, response: conversation.response, meta: conversation.meta, groundingContext: { domain: analysis.document.primaryDomain, summary: analysis.document.summary, factCount: analysis.document.elements.length, missingInformation: analysis.document.missingInformation, ambiguities: analysis.document.ambiguities } }, null, 2)}\n`);
    await screenshot('03-electrical-contextual-answer.png');

    const sandbox = await evaluate('(()=>{const p=document.querySelector("#demo-electrical-sandbox");return {exists:!!p,hidden:p?.hidden,text:p?.textContent.slice(0,300)}})()');
    assert.ok(sandbox.exists, 'existing electrical sandbox is present');
    await evaluate('(()=>{const f=document.querySelector("#demo-electrical-form");for(const [n,v] of Object.entries({voltageV:"230",currentLimitA:"5",lightingVA:"100",outletVA:"600"}))f.elements.namedItem(n).value=v;f.elements.namedItem("confirmedTopology").checked=true;f.requestSubmit()})()');
    await waitUntil(() => evaluate('document.querySelector("#demo-electrical-result")?.hidden === false'), 'user-configured electrical sandbox result');
    const nominal = await evaluate('document.querySelector("#demo-electrical-readout").textContent');
    const provenance = await evaluate('document.querySelector("#demo-electrical-provenance").textContent');
    assert.ok(provenance.includes('user_configured') || provenance.toLowerCase().includes('hipot'));
    await screenshot('04-electrical-sandbox-nominal.png');
    await evaluate('document.querySelector("#demo-electrical-load-value").value="1500";document.querySelector("#demo-electrical-update-load").click()');
    const overload = await evaluate('document.querySelector("#demo-electrical-readout").textContent');
    assert.notEqual(overload, nominal, 'deterministic result changes after changing the explicit hypothetical load');
    assert.ok(/sobrecarga|acima|overload/i.test(overload), `expected configured nominal overload; got ${overload}`);
    await screenshot('05-electrical-sandbox-overload-hypothetical.png');

    assert.deepEqual(failures, []);
    console.log(JSON.stringify({ status: 'LIVE_ELECTRICAL_FLOW_COMPLETE', browser: 'Google Chrome headless isolated profile', viewport: '1440x1000', providerCalls: 3, sourceSha256, analysisStatus, contextual: { httpStatus: conversationEntry.status, requestId: conversation.meta?.requestId, response: conversation.response }, sandbox: { provenance, initial: nominal, afterIncrease: overload, evidenceStatus: 'user_configured hypothetical independent circuit' }, screenshots: ['01-electrical-upload-confirm.png','02-electrical-analysis-real.png','03-electrical-contextual-answer.png','04-electrical-sandbox-nominal.png','05-electrical-sandbox-overload-hypothetical.png'] }));
  }
} finally {
  try { socket?.close(); } catch {}
  chrome.kill('SIGTERM');
}
