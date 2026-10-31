import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const reportDir = path.join(root, 'reports/phase-7e5/evidence');
const sourcePath = path.join(root, 'reports/phase-7e4/evidence/architecture-source.png');
const extractionPath = path.join(root, 'reports/phase-7e4/live/step-1-architecture-B-resume.json');
const recognitionPath = path.join(root, 'reports/phase-7e3/live-recognition.json');
const extraction = JSON.parse(await readFile(extractionPath, 'utf8'));
const recognition = JSON.parse(await readFile(recognitionPath, 'utf8'));
const source = await readFile(sourcePath);
const liveRegion = process.env.UNFOLD_PHASE7E5_LIVE_REGION === '1';
const liveUpperDimension = process.env.UNFOLD_PHASE7E5_LIVE_UPPER_DIMENSION === '1';
const screenshotDir = process.env.UNFOLD_PHASE7E5_EVIDENCE_DIR
  ? path.resolve(root, process.env.UNFOLD_PHASE7E5_EVIDENCE_DIR)
  : path.join(reportDir, liveUpperDimension ? 'upper-dimension-session' : '');
const liveResultPath = path.join(root, `reports/phase-7e5/live/${liveUpperDimension ? 'upper-right-dimension' : 'office-area'}-region-C-response.json`);
const profileDir = await mkdtemp(path.join(os.tmpdir(), 'unfold-phase-7e5-chrome-'));
await mkdir(reportDir, { recursive: true });

const chrome = spawn(process.env.CHROME_BIN ?? '/usr/bin/google-chrome', [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
  '--remote-debugging-port=0', `--user-data-dir=${profileDir}`, '--window-size=1440,1000',
  'http://127.0.0.1:5173/demo',
], { stdio: 'ignore' });
let socket;
let sessionId;
let nextId = 0;
const pending = new Map();
const pausedRequests = [];
const failures = [];
const liveResponses = [];
let imageCalls = 0;
let regionCalls = 0;
let analysisBody;
let regionBody;
let loadEvents = 0;

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function waitUntil(check, label, timeout = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await check()) return;
    if (chrome.exitCode !== null) throw new Error(`Chromium terminou inesperadamente (${chrome.exitCode}).`);
    await wait(100);
  }
  throw new Error(`Timeout: ${label}`);
}

try {
  let debugPort;
  await waitUntil(async () => {
    try {
      const portFile = await readFile(path.join(profileDir, 'DevToolsActivePort'), 'utf8');
      debugPort = Number(portFile.split('\n')[0]);
      return Number.isInteger(debugPort) && debugPort > 0;
    } catch { return false; }
  }, 'Chromium remote debugging');
  const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then((response) => response.json());
  socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) {
      const task = pending.get(message.id); pending.delete(message.id);
      if (message.error) task.reject(new Error(message.error.message)); else task.resolve(message.result);
      return;
    }
    if (message.method === 'Page.loadEventFired') loadEvents += 1;
    if (message.method === 'Fetch.requestPaused') void handlePaused(message.params);
    if (message.method === 'Network.responseReceived' && message.params.response.url.includes('/api/meta/image/verify-region')) liveResponses.push({ requestId: message.params.requestId, status: message.params.response.status });
    if (message.method === 'Runtime.exceptionThrown') failures.push(message.params.exceptionDetails?.text ?? 'Browser JavaScript exception');
  });
  const rootSend = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const targets = await rootSend('Target.getTargets');
  const targetInfo = targets.targetInfos.find((item) => item.type === 'page' && item.url.includes('/demo'));
  assert.ok(targetInfo, 'deve abrir apenas a rota local /demo');
  sessionId = (await rootSend('Target.attachToTarget', { targetId: targetInfo.targetId, flatten: true })).sessionId;
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result?.value;
  };
  const fulfill = (requestId, payload) => send('Fetch.fulfillRequest', {
    requestId, responseCode: 200,
    responseHeaders: [{ name: 'Content-Type', value: 'application/json; charset=utf-8' }],
    body: Buffer.from(JSON.stringify(payload)).toString('base64'),
  });
  async function handlePaused(params) {
    pausedRequests.push(params.request.url);
    try {
      if (params.request.url.includes('/api/diagnostics')) {
        await fulfill(params.requestId, {
          schema: 'unfold.backend_diagnostics.v1', contractVersion: 'unfold.backend.v1', buildId: 'phase-7e5-offline-e2e',
          pipelineVersion: 'unfold.image_pipeline.ab.v2', responseSchemaVersion: 'technical_document.v1', recognitionSchemaVersion: 'technical_recognition.v2', startedAt: new Date().toISOString(),
          capabilities: { imageAnalysis: { available: true, apiKeyConfigured: true, responseContract: 'unfold.image_analysis.v1' }, contextualConversation: { available: true, apiKeyConfigured: true }, imageRegionVerification: { available: true, apiKeyConfigured: true } },
          metaCallBudget: { limit: 0, used: 0, remaining: 0 },
        });
      } else if (params.request.url.includes('/api/meta/image/verify-region')) {
        regionCalls += 1;
        regionBody = JSON.parse(params.request.postData ?? '{}');
        if (liveRegion || (liveUpperDimension && regionBody.targetId === 'upper_right_dimension')) await send('Fetch.continueRequest', { requestId: params.requestId });
        else await fulfill(params.requestId, {
          targetId: regionBody.targetId, region: regionBody.region, originalSize: regionBody.originalSize,
          verification: { status: 'uncertain', reading: null, unit: null, visibleText: '10.?6 m²', alternatives: ['10,06 m²', '10,66 m²'], explanation: 'Fixture offline para testar a apresentação de uma releitura ambígua.', regionReference: 'selected_crop' },
          limitation: 'Fixture offline; não é validação Meta nem confirmação humana.',
        });
      } else if (params.request.url.includes('/api/meta/image')) {
        imageCalls += 1;
        analysisBody = JSON.parse(params.request.postData ?? '{}');
        await fulfill(params.requestId, {
          contract: 'unfold.image_analysis.v1', status: 'PARTIAL', image: { mimeType: 'image/png', byteLength: source.length, maxBytes: 10_000_000 },
          recognition: recognition.recognition, document: extraction.document, assessment: extraction.assessment, observation: extraction.observation,
          extraction: { status: 'complete' }, meta: { model: 'muse-spark-1.3', requestId: extraction.response.requestId, stages: [{ stage: 'recognition', requestId: recognition.response.requestId }, { stage: 'extraction', requestId: extraction.response.requestId }], usage: extraction.response.usage },
        });
      } else {
        await send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'BlockedByClient' });
        failures.push(`endpoint não esperado interceptado: ${params.request.url}`);
      }
    } catch (error) {
      failures.push(`Fetch fixture: ${error instanceof Error ? error.message : String(error)}`);
      try { await send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'Failed' }); } catch { /* request já retomado */ }
    }
  }

  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Page.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 1000 });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*://127.0.0.1:5173/api/*', requestStage: 'Request' }] });
  await waitUntil(() => evaluate('!!document.querySelector("#demo-image-input")'), 'frontend carregado');

  async function uploadAndAnalyze() {
    const documentRoot = await send('DOM.getDocument');
    const node = await send('DOM.querySelector', { nodeId: documentRoot.root.nodeId, selector: '#demo-image-input' });
    assert.ok(node.nodeId, 'input de imagem presente');
    await send('DOM.setFileInputFiles', { files: [sourcePath], nodeId: node.nodeId });
    await evaluate('document.querySelector("#demo-image-input").dispatchEvent(new Event("change",{bubbles:true}))');
    await waitUntil(() => evaluate('document.querySelector("#demo-image-confirm")?.hidden === false'), 'preview do ficheiro original');
    await evaluate('document.querySelector("#demo-image-confirm").click()');
    await waitUntil(() => evaluate('document.querySelector("#demo-image-results")?.hidden === false || document.querySelector(".demo-shell")?.dataset.imageState === "error"'), 'resultado ou erro documental recebido');
    const state = await evaluate('({imageState:document.querySelector(".demo-shell")?.dataset.imageState,status:document.querySelector("#demo-image-status")?.textContent,command:document.querySelector("#demo-command-message")?.textContent,confirmationHidden:document.querySelector("#demo-image-confirm")?.hidden})');
    assert.equal(await evaluate('document.querySelector("#demo-image-results")?.hidden === false'), true, JSON.stringify({ state, imageCalls, analysisBodyPresent: Boolean(analysisBody), failures }));
  }
  async function screenshot(name) {
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await mkdir(screenshotDir, { recursive: true });
    await writeFile(path.join(screenshotDir, name), Buffer.from(shot.data, 'base64'));
  }

  await uploadAndAnalyze();
  assert.equal(imageCalls, 1);
  assert.equal(analysisBody.imageDataUrl.startsWith('data:image/png;base64,'), true);
  assert.equal(await evaluate('document.querySelector("#demo-document-facts").textContent.includes("10.66 m2")'), true);
  await evaluate('document.querySelector("#demo-document-facts [data-review-id=\\"e_escritorio\\"]").click()');
  assert.equal((await evaluate('document.querySelector("#demo-value-review-status").textContent')).includes('NÃO VERIFICADA'), true);
  await evaluate('(()=>{const r=document.querySelector("#demo-image-results"),t=document.querySelector("#demo-value-review");r.scrollTop+=t.getBoundingClientRect().top-r.getBoundingClientRect().top-(r.clientHeight-t.clientHeight)/2})()');
  await wait(200);
  await screenshot('01-analysis-office-unreviewed.png');

  await evaluate('document.querySelector("#demo-image-verify-region").click()');
  const bounds = await evaluate('(()=>{const r=document.querySelector("#demo-image-preview").getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height}})()');
  const start = { x: Math.round(bounds.left + bounds.width * (liveRegion ? 0.66 : 0.70)), y: Math.round(bounds.top + bounds.height * 0.62) };
  const end = { x: Math.round(bounds.left + bounds.width * (liveRegion ? 0.77 : 0.81)), y: Math.round(bounds.top + bounds.height * 0.70) };
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: end.x, y: end.y, button: 'left', buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: end.x, y: end.y, button: 'left', buttons: 0, clickCount: 1 });
  await waitUntil(() => evaluate('document.querySelector("#demo-image-region-result")?.textContent.includes("RELEITURA DO MESMO MODELO")'), 'resultado de região no browser');
  assert.equal(regionCalls, 1);
  assert.equal(Object.hasOwn(regionBody, 'candidateValue'), false);
  let liveResponse;
  if (liveRegion) {
    await waitUntil(() => liveResponses.length === 1, 'resposta HTTP da verificação regional');
    assert.equal(liveResponses[0].status, 200, 'verificação regional real deve terminar em HTTP 200');
    const responseBody = await send('Network.getResponseBody', { requestId: liveResponses[0].requestId });
    const responseText = responseBody.base64Encoded ? Buffer.from(responseBody.body, 'base64').toString('utf8') : responseBody.body;
    liveResponse = JSON.parse(responseText);
    assert.equal(liveResponse.targetId, regionBody.targetId);
    assert.deepEqual(liveResponse.region, regionBody.region);
    assert.ok(liveResponse.meta?.requestId);
    await mkdir(path.dirname(liveResultPath), { recursive: true });
    await writeFile(liveResultPath, `${JSON.stringify({ evidenceType: 'real_provider_call', phase: '7E.5', operation: 'office-area-region-C', sourceImage: { file: 'reports/phase-7e4/evidence/architecture-source.png', sha256: createHash('sha256').update(source).digest('hex'), width: 650, height: 446 }, selectedRegion: regionBody.region, cropSha256: createHash('sha256').update(Buffer.from(regionBody.cropImageDataUrl.split(',')[1], 'base64')).digest('hex'), request: { targetId: regionBody.targetId, targetLabel: regionBody.targetLabel, question: regionBody.question, candidateValueSent: false }, httpStatus: liveResponses[0].status, result: liveResponse }, null, 2)}\n`);
  }
  assert.equal(await evaluate('document.querySelector("#demo-image-region-zoom").hidden'), false);
  await waitUntil(() => evaluate('(()=>{const i=document.querySelector("#demo-image-region-zoom");return i.complete&&i.naturalWidth>0&&i.getBoundingClientRect().width>i.naturalWidth})()'), 'ampliação fiel do recorte original');
  if (liveUpperDimension) {
    const upperResult = await evaluate(`(async()=>{
      const image=document.querySelector('#demo-image-preview');
      const region={x:0.57,y:0.025,width:0.15,height:0.08};
      const x=Math.floor(region.x*image.naturalWidth),y=Math.floor(region.y*image.naturalHeight);
      const width=Math.ceil(region.width*image.naturalWidth),height=Math.ceil(region.height*image.naturalHeight);
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
      const context=canvas.getContext('2d');context.drawImage(image,x,y,width,height,0,0,width,height);
      const cropDataUrl=canvas.toDataURL('image/png');
      const bytes=Uint8Array.from(atob(cropDataUrl.split(',')[1]),c=>c.charCodeAt(0));
      const digest=await crypto.subtle.digest('SHA-256',bytes);
      const cropSha256=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
      const response=await fetch('/api/meta/image/verify-region',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({cropImageDataUrl:cropDataUrl,targetId:'upper_right_dimension',targetLabel:'Cota superior direita',question:'Qual é exactamente a transcrição impressa nesta região? Indique unidade apenas se visível.',region,originalSize:{width:image.naturalWidth,height:image.naturalHeight}})});
      return {httpStatus:response.status,cropSha256,region,result:await response.json()};
    })()`);
    assert.equal(upperResult.httpStatus, 200, 'segunda região deve ser aceite pelo backend');
    assert.equal(upperResult.result.targetId, 'upper_right_dimension');
    assert.deepEqual(upperResult.result.region, upperResult.region);
    assert.ok(upperResult.result.meta?.requestId);
    await mkdir(path.dirname(liveResultPath), { recursive: true });
    await writeFile(liveResultPath, `${JSON.stringify({ evidenceType: 'real_provider_call', phase: '7E.5', operation: 'upper-right-dimension-region-C', sourceImage: { file: 'reports/phase-7e4/evidence/architecture-source.png', sha256: createHash('sha256').update(source).digest('hex'), width: 650, height: 446 }, selectedRegion: upperResult.region, cropSha256: upperResult.cropSha256, request: { targetId: 'upper_right_dimension', targetLabel: 'Cota superior direita', question: 'Qual é exactamente a transcrição impressa nesta região? Indique unidade apenas se visível.', candidateValueSent: false }, httpStatus: upperResult.httpStatus, result: upperResult.result }, null, 2)}\n`);
    liveResponses.push({ status: upperResult.httpStatus, requestId: upperResult.result.meta.requestId, metaStatus: upperResult.result.meta.responseStatus, latencyMs: upperResult.result.meta.latencyMs, usage: upperResult.result.meta.usage, outputBudget: upperResult.result.meta.maxOutputTokens, verificationStatus: upperResult.result.verification.status, reading: upperResult.result.verification.reading, upper: true });
  }
  await evaluate('(()=>{const r=document.querySelector("#demo-image-results"),t=document.querySelector("#demo-image-region-result");r.scrollTop+=t.getBoundingClientRect().top-r.getBoundingClientRect().top-(r.clientHeight-t.clientHeight)/2})()');
  await wait(200);
  await screenshot('02-office-region-reread-ambiguous.png');

  await evaluate('document.querySelector("#demo-value-corrected").value="10,06 m²";document.querySelector("#demo-value-unit").value="m²";document.querySelector("#demo-value-correct-button").click()');
  assert.equal((await evaluate('document.querySelector("#demo-value-review-status").textContent')).includes('Correcção: 10,06 m²'), true);
  assert.equal(await evaluate('document.querySelector("#demo-document-facts").textContent.includes("10.66 m2")'), true, 'o texto extraído mantém a leitura original');
  const stored = await evaluate('(()=>{const key=Object.keys(localStorage).find(k=>k.startsWith("unfold:technical-value-review:"));return key?JSON.parse(localStorage.getItem(key)):null})()');
  assert.equal(stored.entries.e_escritorio.status, 'corrected');
  assert.equal(stored.entries.e_escritorio.original.rawValue, '10.66 m2');
  assert.equal(stored.entries.e_escritorio.current.rawValue, '10,06 m²');
  assert.equal(stored.history.at(-1).actor, 'user');
  await evaluate('(()=>{const r=document.querySelector("#demo-image-results"),t=document.querySelector("#demo-value-review");r.scrollTop+=t.getBoundingClientRect().top-r.getBoundingClientRect().top-(r.clientHeight-t.clientHeight)/2})()');
  await wait(200);
  await screenshot('03-office-human-correction.png');

  const previousLoads = loadEvents;
  await send('Page.reload', { ignoreCache: true });
  await waitUntil(async () => loadEvents > previousLoads, 'evento de carregamento após refresh');
  await waitUntil(() => evaluate('!!document.querySelector("#demo-image-input")'), 'reload completo');
  await uploadAndAnalyze();
  await evaluate('document.querySelector("#demo-document-facts [data-review-id=\\"e_escritorio\\"]").click()');
  assert.equal((await evaluate('document.querySelector("#demo-value-review-status").textContent')).includes('Correcção: 10,06 m²'), true, 'revisão persiste para o hash do mesmo documento');
  const uiMetrics = await evaluate('(()=>{const r=document.querySelector("#demo-image-results"),t=document.querySelector("#demo-value-review");return {resultsScrollTop:r.scrollTop,resultsScrollHeight:r.scrollHeight,resultsClientHeight:r.clientHeight,reviewHidden:t.hidden,reviewRect:t.getBoundingClientRect().toJSON(),resultsRect:r.getBoundingClientRect().toJSON()}})()');
  assert.deepEqual(failures, []);

  console.log(JSON.stringify({
    status: liveUpperDimension ? 'LIVE_UPPER_DIMENSION_RECORDED' : liveRegion ? 'LIVE_OFFICE_REGION_RECORDED' : 'PASS_OFFLINE_E2E', browser: 'Google Chrome headless isolated profile', viewport: '1440x1000',
    imageSource: 'reports/phase-7e4/evidence/architecture-source.png', providerOutputSource: 'reports/phase-7e4/live/step-1-architecture-B-resume.json',
    providerCalls: liveRegion || liveUpperDimension ? 1 : 0, interceptedCalls: { historicalAnalysisFixture: imageCalls, regionalVerificationFixture: liveRegion ? 0 : liveUpperDimension ? Math.max(0, regionCalls - 1) : regionCalls },
    liveResponse: liveRegion ? { status: liveResponses[0]?.status, requestId: liveResponse?.meta?.requestId, metaStatus: liveResponse?.meta?.responseStatus, latencyMs: liveResponse?.meta?.latencyMs, usage: liveResponse?.meta?.usage, outputBudget: liveResponse?.meta?.maxOutputTokens, verificationStatus: liveResponse?.verification?.status, reading: liveResponse?.verification?.reading } : liveUpperDimension ? { status: liveResponses.at(-1)?.status, requestId: liveResponses.at(-1)?.requestId, metaStatus: liveResponses.at(-1)?.metaStatus, latencyMs: liveResponses.at(-1)?.latencyMs, usage: liveResponses.at(-1)?.usage, outputBudget: liveResponses.at(-1)?.outputBudget, verificationStatus: liveResponses.at(-1)?.verificationStatus, reading: liveResponses.at(-1)?.reading } : undefined,
    uiMetrics,
    assertions: ['real source image selected', '10.66 m2 rendered unreviewed', 'manual bounded crop selected', 'same-model ambiguity rendered', 'candidate value absent from request', 'crop zoom shown', 'human correction records old/new/hash/author', 'raw extraction preserved', 'review restored after refresh'],
    screenshots: ['01-analysis-office-unreviewed.png', '02-office-region-reread-ambiguous.png', '03-office-human-correction.png'],
    otherApiRequestsBlocked: pausedRequests.filter((url) => url.includes('/api/')).filter((url) => !/diagnostics|meta\/image/.test(url)),
  }));
} finally {
  try { socket?.close(); } catch { /* already closed */ }
  chrome.kill('SIGTERM');
}
