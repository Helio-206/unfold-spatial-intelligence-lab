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
    selectedCandidateCount:document.querySelectorAll('#candidate-list [data-candidate][aria-pressed="true"]').length,
    proposedRegions:[...document.querySelectorAll('#region-list [data-region]')].map((item)=>({id:item.dataset.region,label:item.textContent.trim(),vertices:document.querySelector('#plan-overlay polygon[data-region="'+item.dataset.region+'"]')?.getAttribute('points')??null})),
    lowQualityFaceCount:Number((document.querySelector('#contour-summary')?.textContent.match(/(\\d+) face/)??[])[1]??0),
    contourSummary:document.querySelector('#contour-summary')?.textContent,
    openingCandidates:[...document.querySelectorAll('#opening-candidate-list [data-opening-candidate]')].map((item)=>({id:item.dataset.openingCandidate,label:item.textContent.trim()})),
    openingCandidateCount:document.querySelectorAll('#opening-candidate-list [data-opening-candidate]').length,
    viewport:[innerWidth,innerHeight],dpr:devicePixelRatio
  }))()`);
  await screenshot('02-detected-regions.png');
  assert.equal(result.candidates.proposedRegions.length, 3, 'A detecção deve ser medida; nenhum resultado é aceite automaticamente neste teste.');
  result.status = 'PASS_CANDIDATES_ONLY';
  result.note = 'Regiões automáticas são candidatas geométricas não revistas; não foram construídas nem associadas a nomes Meta.';
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
