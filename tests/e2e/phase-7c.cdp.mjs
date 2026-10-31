import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const evidenceDir = process.env.UNFOLD_E2E_EVIDENCE_DIR ? path.resolve(process.env.UNFOLD_E2E_EVIDENCE_DIR) : path.join(projectDir, 'reports/phase-7c/evidence');
const resultsPath = process.env.UNFOLD_E2E_RESULTS_PATH ? path.resolve(process.env.UNFOLD_E2E_RESULTS_PATH) : path.join(projectDir, 'reports/phase-7c/e2e-results.json');
fs.mkdirSync(evidenceDir, { recursive: true });
const targets = await fetch('http://127.0.0.1:9222/json/list').then((response) => response.json());
const target = targets.find((item) => item.type === 'page' && item.url === 'http://127.0.0.1:5173/demo');
if (!target) throw new Error('A tab de demonstração não está aberta no Chromium E2E.');

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
let nextId = 0;
const pending = new Map();
const held = [];
const errors = [];
let nextResponse;
let pauseNext = false;
let interceptedImageRequests = 0;
socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data));
  if (message.id && pending.has(message.id)) {
    const task = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) task.reject(new Error(message.error.message)); else task.resolve(message.result);
    return;
  }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails?.text ?? 'JavaScript exception');
  if (message.method === 'Fetch.requestPaused') {
    const request = message.params;
    if (request.request.url.includes('/api/meta/image')) {
      interceptedImageRequests += 1;
      if (pauseNext) {
        held.push(request);
        void evaluate('window.__UNFOLD_PHASE7C_MOCK_PAUSED__=true');
      } else if (nextResponse) {
        const response = nextResponse;
        nextResponse = undefined;
        void fulfill(request.requestId, response.payload, response.status);
      } else void send('Fetch.failRequest', { requestId: request.requestId, errorReason: 'Aborted' });
    } else void send('Fetch.continueRequest', { requestId: request.requestId });
  }
});

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result?.value;
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(expression, label, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await wait(100);
  }
  throw new Error(`Timeout à espera de ${label}`);
}
async function click(selector) {
  const result = await evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element)throw new Error("missing ${selector}");element.click();return true})()`);
  if (!result) throw new Error(`Não foi possível clicar em ${selector}`);
}
async function screenshot(name) {
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(evidenceDir, name), Buffer.from(result.data, 'base64'));
}
async function fulfill(requestId, payload, status = 200) {
  await send('Fetch.fulfillRequest', {
    requestId,
    responseCode: status,
    responseHeaders: [{ name: 'content-type', value: 'application/json' }],
    body: Buffer.from(JSON.stringify(payload)).toString('base64'),
  });
}
async function submitFixture(fileName, payload, requestId, screenshotPrefix) {
  const selected = await evaluate(`(()=>{const input=document.querySelector("#demo-image-input");const bytes=Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/t7sAAAAASUVORK5CYII="),c=>c.charCodeAt(0));const file=new File([bytes],${JSON.stringify(fileName)},{type:"image/png"});const transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;input.dispatchEvent(new Event("change",{bubbles:true}));return document.querySelector("#demo-image-file-name").textContent})()`);
  if (selected !== fileName) throw new Error(`Ficheiro não seleccionado: ${fileName}`);
  await screenshot(`${screenshotPrefix}-input.png`);
  pauseNext = true;
  nextResponse = undefined;
  await click('#demo-image-confirm');
  await waitFor('document.querySelector("#demo-image-insight").dataset.imageState === "processing"', 'estado de análise');
  const started = Date.now();
  await waitFor('window.__UNFOLD_PHASE7C_MOCK_PAUSED__ === true', 'pedido capturado pelo mock');
  const request = held.shift();
  await screenshot(`${screenshotPrefix}-processing.png`);
  pauseNext = false;
  await fulfill(request.requestId, payload);
  await evaluate('window.__UNFOLD_PHASE7C_MOCK_PAUSED__=false');
  await waitFor('document.querySelector("#demo-image-insight").dataset.imageState === "success"', 'resultado validado');
  await screenshot(`${screenshotPrefix}-result.png`);
  await evaluate('window.__UNFOLD_PHASE7C_MOCK_PAUSED__=false');
  return Date.now() - started;
}

const checks = [];
function check(name, pass, detail = '') {
  checks.push({ name, pass: Boolean(pass), detail });
  if (!pass) throw new Error(`${name}: ${detail || 'falhou'}`);
}

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*://127.0.0.1:5173/api/meta/image*', requestStage: 'Request' }] });
await send('Page.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900 });
await send('Page.reload', { ignoreCache: true });
await waitFor('document.querySelector(".demo-shell") && window.__UNFOLD_DEMO_METRICS__', 'workspace inicial');
await waitFor('document.querySelector(".demo-shell").dataset.demoPhase === "EMPTY_LAB"', 'laboratório vazio inicial');
await screenshot('00-empty-lab-desktop.png');
check('arranque em EMPTY_LAB com uma única cena WebGL', await evaluate('document.querySelectorAll("canvas").length === 1'));

const capabilities = ['canExplain', 'canInspect', 'canEditSemanticData', 'canVisualize2D', 'canConstruct3D', 'canSimulate', 'canRunWhatIf'].map((id) => ({ id, state: id === 'canExplain' || id === 'canInspect' ? 'available' : 'blocked', reason: 'Geometria ou motor específico não validados.', dependencies: [], missing: [], engine: null }));
function makeDocument(primaryDomain, documentType, elements, questions, ambiguities, missingInformation, secondaryDomains = []) {
  return { schema: 'technical_document.v1', documentType, primaryDomain, secondaryDomains, classification: { confidence: 0.97, evidence: 'rótulos e símbolos visíveis', rationale: `Documento classificado como ${documentType}.` }, summary: `Leitura contextual de ${documentType}; não é uma reconstrução CAD.`, elements, relations: [], observedText: [], ambiguities, missingInformation, capabilities, questions };
}
const architectureDocument = makeDocument('architecture', 'planta arquitectónica residencial', [
  { id: 'kitchen', kind: 'room', label: 'Cozinha', status: 'observed', evidence: 'rótulo Cozinha impresso', confidence: 0.97, rawValue: '23.39 m²', value: 23.39, unit: 'm²' },
  { id: 'garage', kind: 'room', label: 'Garagem', status: 'observed', evidence: 'rótulo Garagem impresso', confidence: 0.91, rawValue: null, value: null, unit: null },
], [{ id: 'kitchen-area', question: 'Qual é a área da cozinha?', answer: '23.39 m² está explicitamente indicado.', basis: 'observed', sourceIds: ['kitchen'] }], ['escala global não confirmada'], ['coordenadas, alturas e espessuras para reconstrução']);
const architecturePayload = { image: { mimeType: 'image/png', byteLength: 68, maxBytes: 10000000 }, document: architectureDocument, observation: null, meta: { model: 'muse-spark-1.3', requestId: 'fixture-architecture' } };
await submitFixture('architecture-e2e.png', architecturePayload, 'fixture-architecture', '10-architecture-mock');
const architectureUI = await evaluate('({domain:document.querySelector("#demo-document-domain").textContent,facts:document.querySelector("#demo-document-facts").textContent,uncertainty:document.querySelector("#demo-document-uncertainty").textContent,missing:document.querySelector("#demo-document-missing").textContent,readiness:document.querySelector("#demo-image-readiness-status").textContent,overlays:document.querySelectorAll(".image-overlay,[data-bounding-box]").length})');
check('planta arquitectónica mostra evidência e não cria geometria espacial', architectureUI.domain.includes('arquitectónica') && architectureUI.facts.includes('23.39 m²') && !architectureUI.facts.includes('m²m²') && architectureUI.uncertainty.includes('escala') && architectureUI.missing.includes('coordenadas') && architectureUI.readiness === 'BLOCKED' && architectureUI.overlays === 0);
await evaluate('(()=>{const item=[...document.querySelectorAll("#demo-document-answers .demo-image-item")].find(node=>node.textContent.includes("área da cozinha"));if(!item)throw new Error("FAQ cozinha ausente");item.click();return true})()');
check('pergunta documental precomputada responde sem perder o contexto da imagem', (await evaluate('document.querySelector("#demo-messages").textContent')).includes('23.39 m²'));

const electricalDocument = makeDocument('electrical_installation', 'plano eléctrico', [
  { id: 'light-1', kind: 'lighting_point', label: 'ponto de luz', status: 'observed', evidence: 'símbolo circular visível', confidence: 0.9, rawValue: null, value: null, unit: null },
  { id: 'rating-va', kind: 'load_rating', label: 'potência aparente', status: 'observed', evidence: 'inscrição 100 VA', confidence: 0.9, rawValue: '100 VA', value: 100, unit: 'VA' },
  { id: 'rating-w', kind: 'load_rating', label: 'potência activa', status: 'observed', evidence: 'inscrição 2700 W', confidence: 0.9, rawValue: '2700 W', value: 2700, unit: 'W' },
], [{ id: 'explain', question: 'Explica-me este desenho.', answer: 'Plano eléctrico; a topologia não está demonstrada.', basis: 'interpretation', sourceIds: [] }, { id: 'fault', question: 'Consigo ligar este circuito e testar uma falha?', answer: 'Não com esta imagem; faltam ligações e parâmetros.', basis: 'missing', sourceIds: [] }], ['associação entre potência e símbolo não confirmada'], ['tensão nominal', 'topologia', 'protecções e cabos']);
const electricalPayload = { image: { mimeType: 'image/png', byteLength: 68, maxBytes: 10000000 }, document: electricalDocument, observation: null, meta: { model: 'muse-spark-1.3', requestId: 'fixture-electrical' } };
await submitFixture('electrical-e2e.png', electricalPayload, 'fixture-electrical', '20-electrical-mock');
const electricalUI = await evaluate('({domain:document.querySelector("#demo-document-domain").textContent,facts:document.querySelector("#demo-document-facts").textContent,missing:document.querySelector("#demo-document-missing").textContent,answers:document.querySelector("#demo-document-answers").textContent,readiness:document.querySelector("#demo-image-readiness-status").textContent,sandboxHidden:document.querySelector("#demo-electrical-sandbox").hidden})');
check('plano eléctrico mantém VA e W separados e bloqueia simulação extraída', electricalUI.domain.includes('eléctrico') && electricalUI.facts.includes('100 VA') && electricalUI.facts.includes('2700 W') && !electricalUI.facts.includes('VA VA') && !electricalUI.facts.includes('W W') && electricalUI.missing.includes('topologia') && electricalUI.answers.includes('Não com esta imagem') && electricalUI.readiness === 'BLOCKED' && !electricalUI.sandboxHidden);

await click('#demo-electrical-example');
let circuitText = await evaluate('document.querySelector("#demo-electrical-readout").textContent');
check('exemplo eléctrico identifica proveniência independente e corrente nominal', (await evaluate('document.querySelector("#demo-electrical-provenance").textContent')).includes('EXEMPLO INDEPENDENTE') && circuitText.includes('2.261 A'));
await evaluate('(()=>{for(const selector of ["#demo-image-insight","#demo-image-results"]){const element=document.querySelector(selector);element.scrollTop=element.scrollHeight}return true})()');
await screenshot('21-electrical-independent-sandbox.png');
await evaluate('(()=>{const input=document.querySelector("#demo-electrical-load-value");input.value="1380";input.dispatchEvent(new Event("input",{bubbles:true}));return true})()');
await click('#demo-electrical-update-load');
circuitText = await evaluate('document.querySelector("#demo-electrical-readout").textContent');
check('alteração da carga recalcula a corrente e declara sobrecarga sem simular disparo', circuitText.includes('6.261 A') && circuitText.includes('SOBRECARGA NOMINAL') && !circuitText.includes('disjuntor disparou'));
await screenshot('22-electrical-overload-sandbox.png');

await evaluate(`(()=>{const input=document.querySelector("#demo-image-input");const bytes=Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/t7sAAAAASUVORK5CYII="),c=>c.charCodeAt(0));const file=new File([bytes],"api-failure.png",{type:"image/png"});const transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;input.dispatchEvent(new Event("change",{bubbles:true}));return true})()`);
nextResponse = { status: 503, payload: { error: { code: 'META_IMAGE_REQUEST_FAILED', message: 'Falha simulada do serviço multimodal.' } } };
pauseNext = false;
await click('#demo-image-confirm');
await waitFor('document.querySelector("#demo-image-insight").dataset.imageState === "error"', 'erro de API simulado');
check('falha da API é apresentada sem destruir a cena', (await evaluate('document.querySelector("#demo-image-status").textContent')).includes('Falha simulada') && await evaluate('document.querySelectorAll("canvas").length === 1'));
nextResponse = undefined;

await evaluate(`(()=>{const input=document.querySelector("#demo-image-input");const bytes=Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/t7sAAAAASUVORK5CYII="),c=>c.charCodeAt(0));const file=new File([bytes],"cancelled.png",{type:"image/png"});const transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;input.dispatchEvent(new Event("change",{bubbles:true}));return true})()`);
pauseNext = true;
await click('#demo-image-confirm');
await waitFor('window.__UNFOLD_PHASE7C_MOCK_PAUSED__ === true', 'pedido multimodal pendente para cancelar');
const cancelledRequest = held.shift();
await click('#demo-image-cancel');
try { await send('Fetch.failRequest', { requestId: cancelledRequest.requestId, errorReason: 'Aborted' }); } catch { /* O fetch pode já ter sido abortado pelo utilizador. */ }
await evaluate('window.__UNFOLD_PHASE7C_MOCK_PAUSED__=false');
pauseNext = false;
check('cancelamento limpa o contexto fotográfico sem alterar o canvas', await evaluate('document.querySelector("#demo-image-insight").hidden && document.querySelectorAll("canvas").length === 1'));

const invalidResult = await evaluate(`(()=>{const input=document.querySelector("#demo-image-input");const file=new File([new Uint8Array([1,2,3])],"invalid.webp",{type:"image/webp"});const transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;input.dispatchEvent(new Event("change",{bubbles:true}));return document.querySelector("#demo-image-status").textContent})()`);
check('imagem inválida recusada antes de qualquer pedido', invalidResult.includes('JPEG ou PNG'));
const largeResult = await evaluate(`(()=>{const input=document.querySelector("#demo-image-input");const file=new File([new Uint8Array(10000001)],"too-large.png",{type:"image/png"});const transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;input.dispatchEvent(new Event("change",{bubbles:true}));return document.querySelector("#demo-image-status").textContent})()`);
check('imagem acima de 10 MB recusada localmente', largeResult.includes('10 MB'));

await send('Page.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true, screenWidth: 390, screenHeight: 844 });
await wait(300);
const mobile = await evaluate('({overflow:document.documentElement.scrollWidth>innerWidth,canvas:document.querySelectorAll("canvas").length,width:innerWidth})');
check('viewport mobile emulado sem overflow e com uma cena', !mobile.overflow && mobile.canvas === 1 && mobile.width === 390, JSON.stringify(mobile));
await screenshot('30-mobile-390x844.png');
await submitFixture('mobile-electrical.png', electricalPayload, 'fixture-electrical-mobile', '31-mobile-electrical');
const mobileResult = await evaluate('({overflow:document.documentElement.scrollWidth>innerWidth,panel:document.querySelector("#demo-image-insight").getBoundingClientRect().toJSON(),canvas:document.querySelectorAll("canvas").length})');
check('resultado fotográfico responsivo em viewport móvel emulado', !mobileResult.overflow && mobileResult.panel.width <= 390 && mobileResult.canvas === 1, JSON.stringify(mobileResult));
await click('#demo-image-cancel');
check('regresso ao laboratório sem webcam/microfone e sem perda da cena', await evaluate('document.querySelector("#demo-image-insight").hidden && document.querySelectorAll("canvas").length === 1'));
check('nenhuma excepção JavaScript', errors.length === 0, errors.join(' | '));
const summary = { environment: 'Chromium headless · screenshots/mock fixtures · no Meta calls', checks, interceptedImageRequests, realMetaCalls: 0, errors, completedAt: new Date().toISOString() };
fs.mkdirSync(path.dirname(resultsPath), { recursive: true });
fs.writeFileSync(resultsPath, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
await send('Fetch.disable');
socket.close();
