import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import WebSocket from 'ws';

const baseUrl = process.env.UNFOLD_E2E_URL ?? 'http://127.0.0.1:5191';
const imagePath = resolve(process.env.UNFOLD_PLAN_FIXTURE ?? 'reports/phase-10-teardown/fixtures/amoureaux-house-plan.png');
const outputDir = resolve(process.env.UNFOLD_EVIDENCE_DIR ?? 'reports/phase-10-teardown/evidence/case-b-detection');
const cdpPort = Number(process.env.UNFOLD_CDP_PORT ?? 9227);
await mkdir(outputDir, { recursive: true });
const image = await readFile(imagePath);
const created = await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: 'PUT' });
assert.equal(created.status, 200, 'Chromium com DevTools Protocol não está disponível.');
const target = await created.json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolveOpen, reject) => { socket.once('open', resolveOpen); socket.once('error', reject); });
let nextId = 0;
const pending = new Map();
const errors = [];
socket.on('message', (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map((item) => item.value ?? item.description).join(' '));
  if (message.id && pending.has(message.id)) {
    const waiter = pending.get(message.id); pending.delete(message.id);
    message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
  }
});
function cdp(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolveResult, reject) => { pending.set(id, { resolve: resolveResult, reject }); socket.send(JSON.stringify({ id, method, params })); });
}
async function evaluate(expression) {
  const response = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  return response.result?.value;
}
async function waitFor(expression, timeout = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Timeout aguardando ${expression}`);
}
async function upload(selector, file) {
  const { root } = await cdp('DOM.getDocument', { depth: -1 });
  const { nodeId } = await cdp('DOM.querySelector', { nodeId: root.nodeId, selector });
  assert.ok(nodeId, `Input ${selector} não encontrado.`);
  await cdp('DOM.setFileInputFiles', { nodeId, files: [file] });
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new Event('change',{bubbles:true}))`);
}
async function screenshot(file) {
  const shot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
  await writeFile(resolve(outputDir, file), Buffer.from(shot.data, 'base64'));
}

const result = {
  scenario: 'B · Amoureaux House HABS MO-1113 sheet 3/10',
  attribution: 'Library of Congress, Prints & Photographs Division, HABS MO-1113, sheet 3/10',
  source: imagePath,
  sourceSha256: createHash('sha256').update(image).digest('hex'),
  baseUrl,
  browser: 'Chromium DevTools Protocol',
  extraction: 'UNFOLD raster wall detector and planar candidate graph; no Meta calls',
  errors,
};

try {
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: `${baseUrl}/spatial-editor` });
  await waitFor(`document.querySelector('#plan-file')`);
  await evaluate(`localStorage.removeItem('unfold-spatial-scene.v1');location.reload()`);
  await waitFor(`document.querySelector('#plan-file')`);
  await upload('#plan-file', imagePath);
  await waitFor(`document.querySelector('#source-image')?.naturalWidth===3700`);
  await screenshot('01-uploaded-source.png');
  await evaluate(`document.querySelector('#detect-lines').click()`);
  await waitFor(`document.querySelectorAll('#candidate-list [data-candidate]').length>0`);
  await waitFor(`document.querySelector('#region-list')?.children.length>0`);
  await evaluate(`document.querySelector('[data-view-mode="trace"]').click()`);
  result.candidates = await evaluate(`(()=>({
    candidateCount:document.querySelectorAll('#candidate-list [data-candidate]').length,
    rawCandidateCount:document.querySelectorAll('#plan-overlay [data-raw-id]').length,
    selectedCandidateCount:document.querySelectorAll('#candidate-list [data-candidate][aria-pressed="true"]').length,
    proposedRegions:[...document.querySelectorAll('#region-list [data-region]')].map((item)=>({id:item.dataset.region,label:item.textContent.trim(),vertices:document.querySelector('#plan-overlay polygon[data-region="'+item.dataset.region+'"]')?.getAttribute('points')??null})),
    lowQualityFaceCount:Number((document.querySelector('#contour-summary')?.textContent.match(/(\\d+) face/)??[])[1]??0),
    contourSummary:document.querySelector('#contour-summary')?.textContent,
    openingCandidates:[...document.querySelectorAll('#opening-candidate-list [data-opening-candidate]')].map((item)=>({id:item.dataset.openingCandidate,label:item.textContent.trim()})),
    openingCandidateCount:document.querySelectorAll('#opening-candidate-list [data-opening-candidate]').length,
    viewport:[innerWidth,innerHeight],dpr:devicePixelRatio
  }))()`);
  await screenshot('02-detected-regions.png');
  await evaluate(`document.querySelector('#evidence-expand').click()`);
  await new Promise((resolveWait) => setTimeout(resolveWait, 400));
  await screenshot('03-expanded-evidence-debugger.png');
  result.faceDiagnostics = await evaluate(`(()=>({
    rejectedFaces:[...document.querySelectorAll('#region-list [data-region-diagnostic]')].map((item)=>({id:item.dataset.regionDiagnostic,reason:item.textContent.trim()})),
    rejectedOverlayCount:document.querySelectorAll('#plan-overlay polygon[fill="#c74f46"]').length,
    intersectionCount:document.querySelectorAll('#plan-overlay [data-intersection]').length,
    openingReasonCount:[...document.querySelectorAll('#plan-overlay [data-opening-candidate] title')].filter((item)=>item.textContent.trim().length>0).length,
    expanded:document.querySelector('#evidence-expand')?.getAttribute('aria-expanded'),
    sourcePanelWidth:document.querySelector('#source-panel').getBoundingClientRect().width
  }))()`);
  assert.ok(result.faceDiagnostics.rejectedFaces.length > 0, 'Faces rejeitadas precisam de uma razão individual visível.');
  assert.ok(result.faceDiagnostics.rejectedFaces.every((item) => item.reason.length > 0), 'Cada face rejeitada precisa de uma razão.');
  assert.equal(result.faceDiagnostics.expanded, 'true');
  assert.ok(result.faceDiagnostics.sourcePanelWidth > 700, 'O modo debugger deve ampliar a planta para inspecção visual.');
  await evaluate(`(()=>{for(const [selector,value] of [['#crop-x','600'],['#crop-y','600'],['#crop-width','2900'],['#crop-height','2100'],['#deskew-angle','0.5']]){const input=document.querySelector(selector);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));}document.querySelector('#apply-preprocessing').click()})()`);
  await waitFor(`document.querySelector('#preprocess-summary')?.textContent.includes('Cópia de análise')`);
  await evaluate(`document.querySelector('#detect-lines').click()`);
  await waitFor(`document.querySelectorAll('#candidate-list [data-candidate]').length>0`);
  result.preprocessing = await evaluate(`(()=>({summary:document.querySelector('#preprocess-summary').textContent,candidateCount:document.querySelectorAll('#candidate-list [data-candidate]').length,sourceWidth:document.querySelector('#source-image').naturalWidth,sourceHeight:document.querySelector('#source-image').naturalHeight,coordinateBounds:[...document.querySelectorAll('#plan-overlay line[data-id]')].every(line=>[line.x1.baseVal.value,line.y1.baseVal.value,line.x2.baseVal.value,line.y2.baseVal.value].every(v=>v>=0))}))()`);
  await screenshot('04-preprocessed-evidence-overlay.png');
  assert.ok(result.preprocessing.candidateCount > 0, 'Pré-processamento mantém candidatos detectáveis.');
  assert.equal(result.preprocessing.sourceWidth, 3700, 'Original continua em resolução de origem.');
  assert.equal(result.preprocessing.sourceHeight, 2996, 'Original continua em resolução de origem.');
  assert.equal(result.preprocessing.coordinateBounds, true, 'Coordenadas derivadas foram convertidas para o raster original.');
  await evaluate(`(()=>{
    const svg=document.querySelector('#plan-overlay');
    const setPair=(x0,y0,x1,y1)=>{document.querySelector('#scale-mode').click();const rect=svg.getBoundingClientRect();const point=(x,y)=>({bubbles:true,pointerId:1,clientX:rect.left+x*rect.width/3700,clientY:rect.top+y*rect.height/2996});svg.dispatchEvent(new PointerEvent('pointerdown',point(x0,y0)));svg.dispatchEvent(new PointerEvent('pointerdown',point(x1,y1)));};
    setPair(100,120,200,120);document.querySelector('#scale-distance').value='10';document.querySelector('#scale-evidence').value='browser E2E synthetic calibration sample 1';document.querySelector('#add-calibration').click();
    setPair(250,120,350,120);document.querySelector('#scale-distance').value='10.5';document.querySelector('#scale-evidence').value='browser E2E synthetic calibration sample 2';document.querySelector('#add-calibration').click();
  })()`);
  result.calibration = await evaluate(`document.querySelector('#calibration-list').textContent.trim()`);
  assert.match(result.calibration, /bloqueada: medidas incompatíveis/);
  assert.equal(result.candidates.selectedCandidateCount, 0, 'Segmentos e regiões automáticos não podem entrar pré-seleccionados na cena.');
  assert.ok(result.candidates.rawCandidateCount >= result.candidates.candidateCount, 'O overlay precisa expor segmentos raster antes da fusão e segmentos finais.');
  assert.equal(result.candidates.proposedRegions.length, 4, 'As quatro regiões rectangulares suportadas devem permanecer propostas, sem aceitação automática.');
  result.status = 'PASS_CANDIDATES_ONLY';
  result.note = 'Regiões automáticas permanecem não seleccionadas; o debugger mostra razões por face. O teste também comprova recorte/deskew reversível e bloqueio de cotas inconsistentes. Não houve commit geométrico.';
  assert.equal(errors.length, 0, errors.join('; '));
} catch (error) {
  result.status = 'FAIL';
  result.failure = error instanceof Error ? error.stack : String(error);
  try { await screenshot('failure.png'); } catch {}
  process.exitCode = 1;
} finally {
  result.errors = errors;
  await writeFile(resolve(outputDir, 'case-b-detection.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  socket.close();
  await fetch(`http://127.0.0.1:${cdpPort}/json/close/${target.id}`).catch(() => undefined);
}
