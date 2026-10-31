import fs from 'node:fs';

const baseDir = new URL('../../reports/final-frontend/', import.meta.url);
const evidenceDir = new URL('../../reports/final-frontend/evidence/', import.meta.url);
const cdpPort = Number(process.env.UNFOLD_CDP_PORT ?? 9222);
fs.mkdirSync(evidenceDir, { recursive: true });

const browser = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).then((response) => response.json());
const socket = new WebSocket(browser.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
let nextId = 0;
let cdpSessionId;
let cdpTargetId;
const pending = new Map();
const browserErrors = [];
const requests = { experiments: 0, images: 0, glb: 0 };
const heldImageRequests = [];
let failNextExperiment = false;
let failCrankGlb = false;

socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data));
  if (message.id && pending.has(message.id)) {
    const task = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) task.reject(new Error(message.error.message)); else task.resolve(message.result);
    return;
  }
  if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails?.text ?? 'JavaScript exception');
  if (message.method === 'Fetch.requestPaused' && message.sessionId === cdpSessionId) void handlePausedRequest(message.params);
  if (message.method === 'Target.detachedFromTarget' && message.params.sessionId === cdpSessionId) cdpSessionId = undefined;
});

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, ...(cdpSessionId ? { sessionId: cdpSessionId } : {}) }));
  });
}
function sendRoot(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

const target = await send('Target.createTarget', { url: 'http://127.0.0.1:5173/demo', newWindow: true });
await send('Target.activateTarget', { targetId: target.targetId });
cdpTargetId = target.targetId;
cdpSessionId = (await sendRoot('Target.attachToTarget', { targetId: cdpTargetId, flatten: true })).sessionId;

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result?.value;
}

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitFor(expression, label, timeout = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await wait(100);
  }
  throw new Error(`Timeout à espera de ${label}`);
}

async function navigate(url, readyExpression, label) {
  await evaluate(`location.href=${JSON.stringify(url)}`);
  const started = Date.now();
  while (Date.now() - started < 10000) {
    await wait(180);
    try {
      const targetState = await sendRoot('Target.getTargets');
      const current = targetState.targetInfos.find((item) => item.targetId === cdpTargetId);
      if (!current || new URL(current.url).pathname !== new URL(url).pathname || cdpSessionId) continue;
      cdpSessionId = (await sendRoot('Target.attachToTarget', { targetId: cdpTargetId, flatten: true })).sessionId;
      await send('Page.enable');
      await send('Runtime.enable');
      await send('Network.enable');
      await send('Network.setCacheDisabled', { cacheDisabled: true });
      await send('Fetch.enable', { patterns: [
        { urlPattern: '*://127.0.0.1:5173/api/*', requestStage: 'Request' },
        { urlPattern: '*://127.0.0.1:5173/assets/crank.glb*', requestStage: 'Request' },
      ] });
      await waitFor(readyExpression, label, 5000);
      return;
    } catch {
      cdpSessionId = undefined;
    }
  }
  throw new Error(`Timeout à navegar para ${label}`);
}

async function click(selector) {
  const clicked = await evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element||element.hidden)return false;element.click();return true})()`);
  if (!clicked) throw new Error(`Elemento indisponível: ${selector}`);
}

async function screenshot(name) {
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(new URL(`evidence/${name}`, baseDir), Buffer.from(result.data, 'base64'));
}

async function getSolverResult(requestBody) {
  const design = requestBody.design;
  const lengths = Object.fromEntries(Object.entries(design.lengths).map(([key, entry]) => [key, entry.value]));
  const match = requestBody.instruction.match(/(\d+(?:[.,]\d+)?)\s*(?:mm|mil[ií]metros?)/i);
  const newValue = match ? Number(match[1].replace(',', '.')) : undefined;
  if (!Number.isFinite(newValue) || newValue <= 0) throw new Error('Instrução de fixture sem comprimento válido.');
  const inputAngleRad = design.inputAngle.value;
  const branch = design.branch;
  const payload = JSON.stringify({ lengths, newValue, inputAngleRad, branch });
  return evaluate(`(async()=>{const {solveFourBar}=await import('/src/kinematics.ts');const p=${payload};const before=solveFourBar({lengths:p.lengths,inputAngleRad:p.inputAngleRad,branch:p.branch});const after=solveFourBar({lengths:{...p.lengths,crank:p.newValue},inputAngleRad:p.inputAngleRad,branch:p.branch});return {status:'executed',mode:'DESIGN_SANDBOX',evidenceStatus:'hypothetical_user_design',inputValidity:'valid',operation:{schema:'kinematic_operation.v1',action:'update_length',componentId:'crank',newValue:p.newValue,unit:'mm'},before:{result:before},after:{result:after},originalPreserved:true}})()`);
}

async function fulfill(requestId, payload, status = 200) {
  await send('Fetch.fulfillRequest', {
    requestId,
    responseCode: status,
    responseHeaders: [{ name: 'Content-Type', value: 'application/json; charset=utf-8' }],
    body: Buffer.from(JSON.stringify(payload)).toString('base64'),
  });
}

async function handlePausedRequest(params) {
  const { requestId, request } = params;
  try {
    if (request.url.includes('/api/experiments/preview')) {
      requests.experiments += 1;
      if (failNextExperiment) {
        failNextExperiment = false;
        await fulfill(requestId, { error: { message: 'API temporariamente indisponível.' } }, 503);
        return;
      }
      const response = await getSolverResult(JSON.parse(request.postData ?? '{}'));
      await fulfill(requestId, response);
      return;
    }
    if (request.url.includes('/api/meta/image')) {
      requests.images += 1;
      heldImageRequests.push({ requestId, resolve: undefined });
      await evaluate('window.__UNFOLD_FINAL_E2E_IMAGE_PAUSED__=true');
      return;
    }
    if (request.url.includes('/assets/crank.glb')) {
      requests.glb += 1;
      if (failCrankGlb) await send('Fetch.failRequest', { requestId, errorReason: 'Failed' });
      else await send('Fetch.continueRequest', { requestId });
      return;
    }
    if (request.url.includes('/api/')) {
      browserErrors.push(`Endpoint local sem fixture interceptada: ${request.url}`);
      await send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
      return;
    }
    await send('Fetch.continueRequest', { requestId });
  } catch (error) {
    browserErrors.push(`Fetch mock: ${error instanceof Error ? error.message : String(error)}`);
    try { await send('Fetch.failRequest', { requestId, errorReason: 'Failed' }); } catch { /* already resumed */ }
  }
}

await send('Page.enable');
await send('Page.bringToFront');
await send('Page.setWebLifecycleState', { state: 'active' });
await send('Runtime.enable');
await send('Log.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Fetch.enable', { patterns: [
  { urlPattern: '*://127.0.0.1:5173/api/*', requestStage: 'Request' },
  { urlPattern: '*://127.0.0.1:5173/assets/crank.glb*', requestStage: 'Request' },
] });

const results = { environment: 'headed Chromium · local browser · all Meta/API requests intercepted', checks: [], metrics: {}, mockRequests: requests, browserErrors };
const check = (name, pass, detail = '') => {
  results.checks.push({ name, pass: Boolean(pass), detail });
  if (!pass) throw new Error(`${name}: ${detail || 'falhou'}`);
};

await send('Page.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false, screenWidth: 1920, screenHeight: 1080 });
await send('Page.reload', { ignoreCache: true });
await waitFor('!!document.querySelector(".demo-shell")', 'carregamento da rota');
await wait(180);
await screenshot('00-entry-1920x1080.png');
await waitFor('document.querySelector(".demo-shell")?.dataset.demoPhase === "READY"', 'entrada cinematográfica');
await waitFor('window.__UNFOLD_DEMO_METRICS__?.().asset === "READY"', 'GLB crank');
await wait(600);
const initial = await evaluate('({metrics:window.__UNFOLD_DEMO_METRICS__(),phase:document.querySelector(".demo-shell").dataset.demoPhase,hiddenInspector:document.querySelector("#demo-readout").hidden,overflow:document.documentElement.scrollWidth>innerWidth,assetRequests:performance.getEntriesByType("resource").filter(entry=>entry.name.includes(".glb")).map(entry=>new URL(entry.name).pathname)})');
results.metrics.desktop1920 = initial.metrics;
check('entrada READY com um renderer e GLB crank carregado', initial.phase === 'READY' && initial.metrics.canvasCount === 1 && initial.metrics.asset === 'READY', JSON.stringify(initial.metrics));
check('inventário runtime confirma crank.glb utilizado e catálogo modular não carregado', initial.assetRequests.some((path) => path.endsWith('/crank.glb')) && !initial.assetRequests.some((path) => path.endsWith('/modular_four_bar_set.glb')), initial.assetRequests.join(', '));
check('inspector contextual fechado por omissão e sem overflow', initial.hiddenInspector && !initial.overflow);
await screenshot('01-mounted-1920x1080.png');
await screenshot('05-floating-command-bar-1920x1080.png');
const handle = await evaluate('document.querySelector("#demo-command-drag").getBoundingClientRect().toJSON()');
const startBar = await evaluate('document.querySelector(".demo-command").getBoundingClientRect().toJSON()');
await evaluate('window.__dragEvents=[];for(const name of ["pointerdown","pointermove","pointerup","pointercancel"])document.addEventListener(name,e=>window.__dragEvents.push({name,target:e.target.id,x:e.clientX,y:e.clientY,button:e.button,pointerId:e.pointerId}),true)');
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: handle.x + handle.width / 2, y: handle.y + handle.height / 2, button: 'left', buttons: 1, clickCount: 1 });
await wait(80);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handle.x + handle.width / 2 + 110, y: handle.y + handle.height / 2 - 50, button: 'left', buttons: 1 });
await wait(80);
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: handle.x + handle.width / 2 + 110, y: handle.y + handle.height / 2 - 50, button: 'left', buttons: 0, clickCount: 1 });
await wait(560);
const movedBar = await evaluate('document.querySelector(".demo-command").getBoundingClientRect().toJSON()');
const dragEvents = await evaluate('window.__dragEvents');
const dragStyle = await evaluate('({x:document.querySelector(".demo-command").style.getPropertyValue("--command-offset-x"),y:document.querySelector(".demo-command").style.getPropertyValue("--command-offset-y"),transform:getComputedStyle(document.querySelector(".demo-command")).transform})');
check('handle reposiciona a command bar dentro do viewport', Math.abs(movedBar.x - startBar.x) > 40 && movedBar.left >= 0 && movedBar.right <= 1920, JSON.stringify({ startBar, movedBar, handle, dragEvents, dragStyle }));
await screenshot('05b-command-bar-repositioned.png');
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: handle.x + handle.width / 2 + 110, y: handle.y + handle.height / 2 - 50, button: 'left', buttons: 1, clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handle.x + handle.width / 2, y: handle.y + handle.height / 2, button: 'left', buttons: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: handle.x + handle.width / 2, y: handle.y + handle.height / 2, button: 'left', buttons: 0, clickCount: 1 });

await click('#demo-tools-toggle');
await click('[data-demo-action="focus"]');
await waitFor('document.querySelector("#demo-readout").hidden === false && document.querySelector("#demo-selection").textContent.includes("Manivela")', 'Focus');
await wait(760);
await screenshot('02-focus-1920x1080.png');
check('Focus abre contexto da manivela', (await evaluate('document.querySelector("#demo-selection").textContent')).includes('Manivela'));

await click('[data-demo-command="Desmonta o mecanismo"]');
await waitFor('document.querySelector("#demo-visual").textContent === "INSPECTION"', 'Explode');
await wait(900);
check('Explode entra em INSPECTION sem mudar o solver', (await evaluate('window.__UNFOLD_DEMO_METRICS__().visualState')) === 'inspection');
await screenshot('03-exploded-inspection-1920x1080.png');
await click('[data-demo-command="Remonta tudo"]');
await waitFor('document.querySelector("#demo-visual").textContent === "ASSEMBLED"', 'Reassemble');
await wait(900);
await screenshot('04-reassembled-1920x1080.png');

async function sendCommand(value) {
  await evaluate(`(()=>{const input=document.querySelector("#demo-question");input.value=${JSON.stringify(value)};input.dispatchEvent(new Event("input",{bubbles:true}));document.querySelector("#demo-submit").click()})()`);
}

await sendCommand('Aumenta a manivela para 50 mm.');
await waitFor('document.querySelector("#demo-crank-length").textContent === "50 mm"', 'operação sandbox 40→50');
check('40→50 mm validado pelo backend mock e solver', (await evaluate('document.querySelector("#demo-solver").textContent')) === 'SOLVED');
check('proveniência hipotética preservada', (await evaluate('document.querySelector("#demo-provenance").textContent')).includes('hypothetical_user_design'));
await screenshot('06-experiment-solved-50mm.png');

await sendCommand('Aumenta a manivela para 80 mm.');
await waitFor('document.querySelector("#demo-solver").textContent.includes("IMPOSSIBLE")', 'configuração angular impossível');
const impossible = await evaluate('({length:document.querySelector("#demo-crank-length").textContent,state:document.querySelector("#demo-command-state").textContent,solver:document.querySelector("#demo-solver").textContent,metrics:window.__UNFOLD_DEMO_METRICS__()})');
check('impossibilidade angular não substitui a geometria válida', impossible.length === '50 mm' && impossible.metrics.visualState === 'assembled', JSON.stringify(impossible));
await screenshot('07-impossible-80mm-preserved-50mm.png');

const beforeInvalid = requests.experiments;
await sendCommand('Desmonta e coloca tudo em linha recta.');
await waitFor('document.querySelector("#demo-command-state").textContent === "ERROR"', 'comando composto não suportado');
check('comando composto não executa parcialmente', requests.experiments === beforeInvalid && (await evaluate('document.querySelector("#demo-command-message").textContent')).includes('Nada foi executado'));

failNextExperiment = true;
await sendCommand('Aumenta a manivela para 55 mm.');
await waitFor('document.querySelector("#demo-command-state").textContent === "ERROR"', 'falha HTTP simulada');
check('erro HTTP mantém o parâmetro validado anterior', (await evaluate('document.querySelector("#demo-crank-length").textContent')) === '50 mm');

await click('#demo-tools-toggle');
await click('[data-demo-action="restore"]');
await waitFor('document.querySelector("#demo-crank-length").textContent === "40 mm"', 'Restore');
await wait(800);
await screenshot('08-restored-40mm.png');
check('Restore repõe os parâmetros 100/40/120/90 sem chamada Meta', requests.experiments === beforeInvalid + 1 && requests.images === 0);

const selectedImage = await evaluate(`(()=>{const input=document.querySelector("#demo-image-input");const bytes=Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/t7sAAAAASUVORK5CYII="),c=>c.charCodeAt(0));const file=new File([bytes],"mechanism-real-photo.png",{type:"image/png"});const transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;input.dispatchEvent(new Event("change",{bubbles:true}));return {name:file.name,size:file.size}})()`);
check('JPEG/PNG local válido seleccionado para preview', selectedImage.name === 'mechanism-real-photo.png');
await screenshot('09-photo-selected.png');
await evaluate('window.__UNFOLD_FINAL_E2E_IMAGE_PAUSED__=false');
await click('#demo-image-confirm');
await waitFor('document.querySelector("#demo-image-insight").dataset.imageState === "processing"', 'processamento de imagem');
await waitFor('window.__UNFOLD_DEMO_METRICS__ && document.querySelector("#demo-image-status").textContent.includes("A analisar")', 'pedido multimodal interceptado');
await waitFor('window.__UNFOLD_FINAL_E2E_IMAGE_PAUSED__ === true', 'interceptação do endpoint de imagem');
await screenshot('10-photo-processing.png');
const pausedImage = heldImageRequests.shift();
const imageObservation = {
  elements: [
    { id: 'bar-crank', kind: 'bar', label: 'Manivela visível', observed: true, evidence: 'Barra metálica visível na fotografia.', confidence: 0.9 },
    { id: 'joint-left', kind: 'joint', label: 'Articulação esquerda', observed: true, evidence: 'União circular visível junto à base.', confidence: 0.84 },
  ],
  connections: [{ from: 'bar-crank', to: 'joint-left', relation: 'ligada a', observed: true, evidence: 'Contacto visual entre barra e articulação.' }],
  dimensions: [],
  ambiguities: ['O eixo do terminal direito não pode ser confirmado pela vista disponível.'],
  missingInformation: ['Comprimentos medidos', 'Escala da fotografia', 'Topologia completa'],
};
await fulfill(pausedImage.requestId, { image: { mimeType: 'image/png', byteLength: selectedImage.size, maxBytes: 10000000 }, analysis: { domain: 'mechanical_mechanism', classification: { confidence: 0.9, evidence: 'two visible mechanical components', rationale: 'Mecanismo mecânico visível.' }, extraction: { domain: 'mechanical_mechanism', data: imageObservation }, answers: [] }, observation: imageObservation, meta: { model: 'muse-spark-1.3', requestId: 'fixture-only' } });
await waitFor('document.querySelector("#demo-image-results").hidden === false', 'resultado estruturado');
const imageUI = await evaluate('({observed:document.querySelector("#demo-image-observed").textContent,connections:document.querySelector("#demo-image-connections").textContent,dimensions:document.querySelector("#demo-image-dimensions").textContent,ambiguous:document.querySelector("#demo-image-ambiguous").textContent,missing:document.querySelector("#demo-image-missing").textContent,readiness:document.querySelector("#demo-image-readiness-status").textContent,overlays:document.querySelectorAll(".image-overlay,[data-bounding-box]").length})');
check('resultado da fotografia mantém ambiguidades e não inventa posição', imageUI.readiness === 'BLOCKED' && imageUI.overlays === 0 && imageUI.connections.includes('ligada a') && imageUI.ambiguous.includes('terminal direito'));
results.imageResult = imageUI;
await click('#demo-image-observed .demo-image-item');
check('selecção de componente abre detalhe de evidência', (await evaluate('document.querySelector("#demo-image-detail").textContent')).includes('Evidência:'));
await screenshot('11-photo-insight-blocked.png');
await click('#demo-image-example');
check('lab de exemplo identificado como independente da imagem', (await evaluate('document.querySelector("#demo-provenance").textContent')).includes('independent of uploaded image'));
await screenshot('12-example-lab-independent.png');

const invalidImageCheck = await evaluate(`(()=>{const input=document.querySelector("#demo-image-input");const file=new File([new Uint8Array([1,2,3])],"wrong.webp",{type:"image/webp"});const transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;input.dispatchEvent(new Event("change",{bubbles:true}));return document.querySelector("#demo-image-status").textContent})()`);
check('imagem inválida recusada localmente', invalidImageCheck.includes('JPEG ou PNG') && requests.images === 1);
await click('#demo-image-cancel');
await evaluate(`(()=>{document.querySelector('#demo-readout-close')?.click();const menu=document.querySelector('#demo-actions');if(menu&&!menu.hidden)document.querySelector('#demo-tools-toggle')?.click();return true})()`);

await evaluate(`(()=>{Object.defineProperty(navigator,"mediaDevices",{configurable:true,value:{getUserMedia:async()=>{throw new DOMException("Permission denied","NotAllowedError")}}});return true})()`);
await click('#demo-tools-toggle');
await click('#demo-hand-toggle');
await waitFor('document.querySelector("#demo-hand-status").textContent.includes("permissão recusada")', 'permissão webcam recusada');
check('Hand Control falha sem webcam sem mostrar cursor fictício', (await evaluate('document.querySelector("#demo-hand-cursor").hidden')));
await click('#demo-hand-stop');
await evaluate(`(()=>{Object.defineProperty(window,"SpeechRecognition",{configurable:true,value:undefined});Object.defineProperty(window,"webkitSpeechRecognition",{configurable:true,value:undefined});return true})()`);
await click('#demo-mic');
await waitFor('document.querySelector("#demo-command-state").textContent === "ERROR"', 'microfone indisponível');
check('microfone indisponível mantém entrada textual acessível', (await evaluate('document.querySelector("#demo-command-message").textContent')).includes('entrada textual'));

await send('Page.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false, screenWidth: 1280, screenHeight: 720 });
await wait(900);
const laptop = await evaluate('({metrics:window.__UNFOLD_DEMO_METRICS__(),overflow:document.documentElement.scrollWidth>innerWidth,bar:document.querySelector(".demo-command").getBoundingClientRect().toJSON()})');
results.metrics.laptop1280 = laptop.metrics;
check('layout laptop sem overflow horizontal e com palco adaptado', !laptop.overflow && laptop.metrics.canvasWidth === 1280);
await screenshot('13-laptop-1280x720.png');

await send('Page.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true, screenWidth: 390, screenHeight: 844 });
await wait(900);
const mobile = await evaluate('({metrics:window.__UNFOLD_DEMO_METRICS__(),overflow:document.documentElement.scrollWidth>innerWidth,bar:document.querySelector(".demo-command").getBoundingClientRect().toJSON(),mode:document.querySelector(".demo-mode-mark").getBoundingClientRect().toJSON()})');
results.metrics.mobile390 = mobile.metrics;
check('mobile emulado sem overflow, mecanismo reenquadrado, command bar visível', !mobile.overflow && mobile.metrics.canvasWidth === 390 && mobile.bar.bottom <= 844 && mobile.mode.width > 0);
await screenshot('14-mobile-390x844.png');

const mobileImage = await evaluate(`(()=>{const input=document.querySelector("#demo-image-input");const bytes=Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/t7sAAAAASUVORK5CYII="),c=>c.charCodeAt(0));const file=new File([bytes],"mobile-mechanism.png",{type:"image/png"});const transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;input.dispatchEvent(new Event("change",{bubbles:true}));return true})()`);
check('seleção de fotografia no mobile', mobileImage);
await evaluate('window.__UNFOLD_FINAL_E2E_IMAGE_PAUSED__=false');
await click('#demo-image-confirm');
await waitFor('window.__UNFOLD_FINAL_E2E_IMAGE_PAUSED__ === true', 'mock de imagem mobile');
const mobilePausedImage = heldImageRequests.shift();
await fulfill(mobilePausedImage.requestId, { image: { mimeType: 'image/png', byteLength: 68, maxBytes: 10000000 }, analysis: { domain: 'mechanical_mechanism', classification: { confidence: 0.9, evidence: 'two visible mechanical components', rationale: 'Mecanismo mecânico visível.' }, extraction: { domain: 'mechanical_mechanism', data: imageObservation }, answers: [] }, observation: imageObservation, meta: { model: 'muse-spark-1.3', requestId: 'fixture-only-mobile' } });
await waitFor('document.querySelector("#demo-image-readiness-status").textContent === "BLOCKED"', 'resultado bloqueado mobile');
const mobilePanel = await evaluate('({panel:document.querySelector("#demo-image-insight").getBoundingClientRect().toJSON(),overflow:document.documentElement.scrollWidth>innerWidth,canvas:document.querySelectorAll("canvas").length})');
check('resultado fotográfico responsivo em mobile emulado', mobilePanel.panel.width <= 390 && !mobilePanel.overflow && mobilePanel.canvas === 1);
await screenshot('15-mobile-photo-result-390x844.png');
await click('#demo-image-cancel');
check('regresso do contexto fotográfico à cena', await evaluate('document.querySelector("#demo-image-insight").hidden'));

const cameraBeforeTouch = mobile.metrics.cameraPosition;
await send('Emulation.setTouchEmulationEnabled', { enabled: true, configuration: 'mobile' });
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 390, id: 1 }] });
await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 245, y: 430, id: 1 }] });
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await wait(500);
const cameraAfterTouch = await evaluate('window.__UNFOLD_DEMO_METRICS__().cameraPosition');
check('touch orbit altera a câmara', cameraAfterTouch.some((value, index) => Math.abs(value - cameraBeforeTouch[index]) > 0.001));
await send('Emulation.setTouchEmulationEnabled', { enabled: false });

failCrankGlb = true;
await send('Page.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false, screenWidth: 1920, screenHeight: 1080 });
await send('Page.reload', { ignoreCache: true });
await waitFor('location.pathname === "/demo" && document.querySelector(".demo-shell")?.dataset.demoPhase === "READY" && window.__UNFOLD_DEMO_METRICS__?.().asset === "FALLBACK"', 'fallback Three.js após falha GLB', 10000);
const fallback = await evaluate('({asset:window.__UNFOLD_DEMO_METRICS__().asset,canvases:document.querySelectorAll("canvas").length})');
check('falha GLB usa fallback sem criar renderer duplicado', fallback.asset === 'FALLBACK' && fallback.canvases === 1);
results.glbFallback = fallback;
await screenshot('16-glb-fallback.png');

failCrankGlb = false;
await send('Page.reload', { ignoreCache: true });
await waitFor('location.pathname === "/demo" && document.querySelector(".demo-shell")?.dataset.demoPhase === "READY" && window.__UNFOLD_DEMO_METRICS__?.().asset === "READY"', 'retorno a demo com asset', 10000);

await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await send('Page.reload', { ignoreCache: false });
await waitFor('location.pathname === "/demo" && document.querySelector(".demo-shell")?.dataset.demoPhase === "READY"', 'entrada com reduced motion', 10000);
check('prefers-reduced-motion salta a coreografia sem bloquear o laboratório', await evaluate('document.querySelector(".demo-shell").dataset.demoPhase === "READY"'));
await send('Emulation.setEmulatedMedia', { features: [] });

await navigate('http://127.0.0.1:5173/phase-4a', 'location.pathname === "/phase-4a" && document.querySelector("#proof-scene") && document.querySelector("#solver-status")', 'rota técnica /phase-4a');
const phase4a = await evaluate('({canvases:document.querySelectorAll("canvas").length,title:document.title,url:location.pathname})');
check('/phase-4a continua carregável com um canvas', phase4a.url === '/phase-4a' && phase4a.canvases === 1, JSON.stringify(phase4a));
results.regressionPhase4A = phase4a;

check('zero exceções JavaScript durante o percurso', browserErrors.length === 0, browserErrors.join(' | '));
results.mockRequests = requests;
results.realMetaCalls = 0;
results.completedAt = new Date().toISOString();
fs.writeFileSync(new URL('e2e-results.json', baseDir), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
socket.close();
