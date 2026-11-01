import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import WebSocket from 'ws';

const baseUrl = process.env.UNFOLD_E2E_URL ?? 'http://127.0.0.1:5191';
const imagePath = resolve(process.env.UNFOLD_PLAN_FIXTURE ?? 'reports/phase-8d/fixtures/amoureaux-house-plan.png');
const outputDir = resolve(process.env.UNFOLD_EVIDENCE_DIR ?? 'reports/phase-8d/evidence');
const cdpPort = Number(process.env.UNFOLD_CDP_PORT ?? 9225);
const expectedImageWidth = Number(process.env.UNFOLD_PLAN_WIDTH ?? 3700);
const expectedImageHeight = Number(process.env.UNFOLD_PLAN_HEIGHT ?? 2996);
await mkdir(outputDir, { recursive: true });
const created = await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: 'PUT' });
assert.equal(created.status, 200, 'Chromium headed com CDP não está disponível.');
const target = await created.json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
let id = 0;
const pending = new Map();
const errors = [];
const asset = { requests: 0, status: null };
const assetRequestIds = new Set();
socket.on('message', (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map((x) => x.value ?? x.description).join(' '));
  if (message.method === 'Network.requestWillBeSent' && new URL(message.params.request.url).pathname.endsWith('/assets/architectural_library.glb')) { asset.requests++; assetRequestIds.add(message.params.requestId); }
  if (message.method === 'Network.responseReceived' && assetRequestIds.has(message.params.requestId)) asset.status = message.params.response.status;
  if (message.id && pending.has(message.id)) { const waiter = pending.get(message.id); pending.delete(message.id); message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result); }
});
function cdp(method, params = {}) {
  const requestId = ++id;
  return new Promise((resolve, reject) => { pending.set(requestId, { resolve, reject }); socket.send(JSON.stringify({ id: requestId, method, params })); });
}
async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result?.value;
}
async function waitFor(expression, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) { if (await evaluate(expression)) return; await new Promise((resolve) => setTimeout(resolve, 100)); }
  throw new Error(`Timeout: ${expression}`);
}
async function click(selector) { await evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`); }
async function setValue(selector, value) { await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('missing '+${JSON.stringify(selector)});e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`); }
async function screenshot(file) {
  const shot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
  const data = Buffer.from(shot.data, 'base64'); await writeFile(resolve(outputDir, file), data); return data;
}
async function upload(selector, file) {
  const { root } = await cdp('DOM.getDocument', { depth: -1 });
  const { nodeId } = await cdp('DOM.querySelector', { nodeId: root.nodeId, selector });
  assert.ok(nodeId, `File input ${selector} não encontrado.`);
  await cdp('DOM.setFileInputFiles', { nodeId, files: [file] });
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new Event('change',{bubbles:true}))`);
}
async function positionOnImage(point) {
  return evaluate(`(()=>{const svg=document.querySelector('#plan-overlay'),r=svg.getBoundingClientRect(),v=svg.viewBox.baseVal;return {x:r.left+${point.x}*r.width/v.width,y:r.top+${point.y}*r.height/v.height}})()`);
}
async function imageClick(point) {
  const p = await positionOnImage(point);
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 });
}
async function trace(start, end) {
  const a = await positionOnImage(start); const b = await positionOnImage(end);
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x, y: b.y, button: 'left', buttons: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', buttons: 0, clickCount: 1 });
}

const result = { browser: 'Google Chrome headed, DevTools Protocol', baseUrl, source: imagePath, sourceSha256: createHash('sha256').update(await (await import('node:fs/promises')).readFile(imagePath)).digest('hex'), checks: [], screenshots: [], metrics: {}, metaRequests: 0, browserErrors: errors };
try {
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
  await cdp('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: outputDir });
  await cdp('Page.navigate', { url: `${baseUrl}/demo` });
  await waitFor(`document.querySelector('#demo-open-spatial')`);
  await evaluate(`localStorage.removeItem('unfold-spatial-scene.v1')`);
  await screenshot('01-demo-empty.png'); result.screenshots.push('01-demo-empty.png');
  await click('#demo-open-spatial'); await waitFor(`document.querySelector('.spatial-lab')`);
  result.checks.push('o editor abre dentro de /demo; a rota não muda');
  await upload('#plan-file', imagePath);
  await waitFor(`document.querySelector('#source-image').naturalWidth===${expectedImageWidth}`);
  assert.deepEqual(await evaluate(`(()=>{const i=document.querySelector('#source-image');return [i.naturalWidth,i.naturalHeight]})()`), [expectedImageWidth, expectedImageHeight]);
  await screenshot('02-second-plan-original.png'); result.screenshots.push('02-second-plan-original.png');

  // Coordinates follow the visible main footprint and the printed 50'-3 1/2" dimension.
  // They are explicit user tracing proposals, not an automated or verified reconstruction.
  const toPx = (x, y) => ({ x: x * 3700 / 3517, y: y * 2996 / 2848 });
  await click('#trace-mode');
  const corners = [[735, 696], [2781, 696], [2781, 1800], [735, 1800]].map(([x, y]) => toPx(x, y));
  for (let i = 0; i < corners.length; i++) await trace(corners[i], corners[(i + 1) % corners.length]);
  result.tracingDebug = await evaluate(`({count:document.querySelectorAll('#candidate-list [data-candidate]').length,selected:document.querySelectorAll('#candidate-list [data-candidate][aria-pressed="true"]').length,status:document.querySelector('#spatial-status').textContent,mode:document.querySelector('#trace-mode').getAttribute('aria-pressed'),viewBox:document.querySelector('#plan-overlay').getAttribute('viewBox')})`);
  assert.equal(await evaluate(`document.querySelectorAll('#candidate-list [data-candidate][aria-pressed="true"]').length`), 4);
  await screenshot('03-second-plan-tracing.png'); result.screenshots.push('03-second-plan-tracing.png');
  result.checks.push('quatro segmentos do perímetro principal traçados manualmente e selecionados; interiores/aberturas não são declarados completos');

  await click('#scale-mode');
  const anchors = [[735, 214], [2781, 214]].map(([x, y]) => toPx(x, y));
  await imageClick(anchors[0]); await imageClick(anchors[1]);
  await setValue('#scale-distance', '50.2916667');
  const unit = await cdp('DOM.getDocument', { depth: -1 });
  const { nodeId: unitNode } = await cdp('DOM.querySelector', { nodeId: unit.root.nodeId, selector: '#scale-unit' });
  await cdp('DOM.setAttributeValue', { nodeId: unitNode, name: 'value', value: 'ft' });
  await evaluate(`(()=>{const e=document.querySelector('#scale-unit');e.value='ft';e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await setValue('#wall-height', '2.72'); await setValue('#wall-thickness', '0.15');
  await setValue('#scale-evidence', 'Cota total impressa no desenho: 50\'-3 1/2\"; traçado manual parcial. Altura 2,72 m e espessura 0,15 m são hipóteses explícitas do teste.');
  await click('#build-scene');
  await waitFor(`document.querySelector('#scene-components')?.hidden===false && document.querySelectorAll('#component-list [data-scene-node]').length===4`);
  result.checks.push('quatro paredes paramétricas propostas em spatial_scene.v1 com escala derivada da cota impressa, mas não verificada');
  await screenshot('04-construction-start.png'); result.screenshots.push('04-construction-start.png');
  await new Promise((resolve) => setTimeout(resolve, 450)); await screenshot('05-construction-motion.png'); result.screenshots.push('05-construction-motion.png');
  await new Promise((resolve) => setTimeout(resolve, 900)); await screenshot('06-second-plan-model.png'); result.screenshots.push('06-second-plan-model.png');
  await new Promise((resolve) => setTimeout(resolve, 1300)); await screenshot('07-second-plan-model-settled.png'); result.screenshots.push('07-second-plan-model-settled.png');
  const frameTiming = await evaluate(`new Promise(resolve=>{const times=[];let last=performance.now();function frame(now){times.push(now-last);last=now;if(times.length===91){const sorted=[...times].sort((a,b)=>a-b);resolve({samples:times.length,meanMs:Number((times.reduce((a,b)=>a+b,0)/times.length).toFixed(2)),p50Ms:Number(sorted[Math.floor(sorted.length*.5)].toFixed(2)),p95Ms:Number(sorted[Math.floor(sorted.length*.95)].toFixed(2)),fps:Number((1000/(times.reduce((a,b)=>a+b,0)/times.length)).toFixed(1))})}else requestAnimationFrame(frame)}requestAnimationFrame(frame)})`);
  await click('#save-scene'); await waitFor(`localStorage.getItem('unfold-spatial-scene.v1')`);
  result.metrics = await evaluate(`(()=>{const t=JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'));const g=document.querySelector('#spatial-canvas canvas').getContext('webgl2')||document.querySelector('#spatial-canvas canvas').getContext('webgl');const ext=g?.getExtension('WEBGL_debug_renderer_info');return {revision:t?.scene?.revision?.number,nodes:t?.scene?.nodes?.length,nodeIds:t?.scene?.nodes?.map(n=>n.id),validation:t?.scene?.imageWorldMapping?.provenance?.validation,mapping:t?.scene?.imageWorldMapping?.pixelToWorldXZ,renderer:ext?g.getParameter(ext.UNMASKED_RENDERER_WEBGL):'masked',dpr:devicePixelRatio,viewport:[innerWidth,innerHeight],buildReadout:document.querySelector('#spatial-metrics')?.textContent}})()`);
  result.metrics.frameTiming = frameTiming;
  assert.equal(result.metrics.nodes, 4); assert.equal(result.metrics.validation, 'unreviewed');
  await click('#top-view'); await new Promise((resolve) => setTimeout(resolve, 800));
  await click('[data-view-mode="trace"]'); await screenshot('12-top-view-tracing.png'); result.screenshots.push('12-top-view-tracing.png');
  await click('[data-view-mode="compare"]'); await screenshot('13-top-view-overlay.png'); result.screenshots.push('13-top-view-overlay.png');
  result.checks.push('vista superior e sobreposição raster/3D usam o mapeamento affine guardado no spatial_scene.v1');

  const wallSelector = await evaluate(`document.querySelector('#component-list [data-scene-node]')?.dataset.sceneNode`);
  const wallSelectorLiteral = JSON.stringify(wallSelector);
  await click(`[data-scene-node="${wallSelector}"]`); await waitFor(`document.querySelector('#inspector')?.hidden===false`);
  await screenshot('08-selected-wall.png'); result.screenshots.push('08-selected-wall.png');
  const before = await evaluate(`(()=>{const t=JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'));return t.scene.nodes.find(n=>n.id===${wallSelectorLiteral})})()`);
  await setValue('#wall-length', String(before.geometry.sizeM[0] + 0.5));
  await click('#preview-wall'); await waitFor(`document.querySelector('#commit-preview').disabled===false`);
  await screenshot('09-wall-edit-preview.png'); result.screenshots.push('09-wall-edit-preview.png');
  await click('#commit-preview');
  let after = await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`);
  const edited = after.scene.nodes.find((n) => n.id === wallSelector);
  assert.ok(Math.abs(edited.geometry.sizeM[0] - before.geometry.sizeM[0] - 0.5) < 1e-9);
  result.checks.push('comprimento alterado por preview → commit e persistido no grafo canónico');
  await screenshot('10-wall-edited.png'); result.screenshots.push('10-wall-edited.png');
  await click('#compare-scene'); await waitFor(`document.querySelector('#spatial-status').textContent.includes('revisão anterior')`);
  await screenshot('18-before-after-revisions.png'); result.screenshots.push('18-before-after-revisions.png');
  await click('#compare-scene');
  await click('#undo-scene'); after = await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`);
  assert.equal(after.scene.nodes.find((n) => n.id === wallSelector).geometry.sizeM[0], before.geometry.sizeM[0]);
  await click('#redo-scene'); after = await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`);
  assert.ok(Math.abs(after.scene.nodes.find((n) => n.id === wallSelector).geometry.sizeM[0] - before.geometry.sizeM[0] - 0.5) < 1e-9);
  result.checks.push('Undo e Redo actualizam spatial_scene.v1; sem alteração directa apenas no mesh');
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', modifiers: 2 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', modifiers: 2 });
  after = await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`);
  assert.equal(after.scene.nodes.find((n) => n.id === wallSelector).geometry.sizeM[0], before.geometry.sizeM[0]);
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', modifiers: 10 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', modifiers: 10 });
  after = await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`);
  assert.ok(Math.abs(after.scene.nodes.find((n) => n.id === wallSelector).geometry.sizeM[0] - before.geometry.sizeM[0] - 0.5) < 1e-9);
  result.checks.push('atalhos Ctrl+Z / Ctrl+Shift+Z aplicam undo/redo também ao estado canónico');
  await click('#save-scene');
  await waitFor(`localStorage.getItem('unfold-spatial-scene.v1')`);
  await click('#exit-spatial-editor'); await waitFor(`!document.querySelector('.spatial-lab')`);
  await click('#demo-open-spatial'); await waitFor(`document.querySelector('.spatial-lab')`);
  assert.equal(await evaluate(`document.querySelector('#restore-scene').disabled`), false);
  await click('#restore-scene'); await waitFor(`document.querySelectorAll('#component-list [data-scene-node]').length===4`);
  const restored = await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`);
  assert.ok(Math.abs(restored.scene.nodes.find((n) => n.id === wallSelector).geometry.sizeM[0] - before.geometry.sizeM[0] - 0.5) < 1e-9);
  result.checks.push('saída/reentrada no editor e restauro revalidam a cena persistida');
  await screenshot('11-restored-scene.png'); result.screenshots.push('11-restored-scene.png');
  await evaluate(`document.querySelector('.module-palette').open=true`);
  for (const moduleId of ['wall_ext_3000','partition_int_3000','door_single_900','window_double_1200','connector_corner_90','connector_isolated_foot','mechanical_frame_1000']) {
    await evaluate(`(()=>{const e=document.querySelector('#module-choice');e.value=${JSON.stringify(moduleId)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await click('#add-module'); await waitFor(`document.querySelector('#commit-preview').disabled===false`);
    await click('#commit-preview'); await waitFor(`document.querySelectorAll('#component-list [data-scene-node]').length===5`);
    const visibleModule = await evaluate(`document.querySelector('#component-list').innerText.includes(${JSON.stringify(moduleId)})`);
    assert.equal(visibleModule, true, `módulo ${moduleId} precisa aparecer na cena`);
    await click('#undo-scene'); await waitFor(`document.querySelectorAll('#component-list [data-scene-node]').length===4`);
  }
  result.checks.push('os sete módulos Blender podem ser instanciados como referências GLB independentes e desfeitos; não são confundidos com geometria da planta');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  result.viewports = { desktop1920x1080: await evaluate(`({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,canvas:!!document.querySelector('#spatial-canvas canvas')})`) };
  await screenshot('15-desktop-1920x1080.png'); result.screenshots.push('15-desktop-1920x1080.png');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  result.viewports.desktop1280x720 = await evaluate(`({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,canvas:!!document.querySelector('#spatial-canvas canvas')})`);
  await screenshot('16-desktop-1280x720.png'); result.screenshots.push('16-desktop-1280x720.png');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  result.viewports.mobileEmulated = await evaluate(`({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,toolbarWidth:document.querySelector('.spatial-toolbar').clientWidth,toolbarScrollWidth:document.querySelector('.spatial-toolbar').scrollWidth,canvas:!!document.querySelector('#spatial-canvas canvas')})`);
  assert.equal(result.viewports.mobileEmulated.width, 390); assert.equal(result.viewports.mobileEmulated.scrollWidth, 390); assert.ok(result.viewports.mobileEmulated.toolbarScrollWidth <= result.viewports.mobileEmulated.toolbarWidth + 1);
  const mobileBefore = await screenshot('17-mobile-390x844.png'); result.screenshots.push('17-mobile-390x844.png');
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 345, y: 520, id: 1 }] });
  await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 322, y: 485, id: 1 }] });
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await new Promise((resolve) => setTimeout(resolve, 400));
  const mobileAfter = await screenshot('19-mobile-touch-orbit.png'); result.screenshots.push('19-mobile-touch-orbit.png');
  assert.notEqual(createHash('sha256').update(mobileBefore).digest('hex'), createHash('sha256').update(mobileAfter).digest('hex'), 'toque deve alterar a câmara ou a cena no viewport móvel emulado');
  result.checks.push('touch orbit em viewport móvel emulado altera a apresentação; não substitui validação em dispositivo físico');
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 1 });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await click('#exit-spatial-editor'); await waitFor(`!document.querySelector('.spatial-lab')`);
  await click('#demo-empty-example'); await waitFor(`document.querySelector('.demo-shell')?.dataset.demoPhase==='READY'`, 7000);
  const fourBar = await evaluate(`({canvas:!!document.querySelector('#demo-scene canvas'),empty:document.querySelector('#demo-empty-state')?.hidden,crank:document.querySelector('#demo-crank-length')?.textContent,status:document.querySelector('#demo-solver')?.textContent,provenance:document.querySelector('#demo-mode-provenance')?.textContent})`);
  assert.equal(fourBar.canvas, true); assert.equal(fourBar.empty, true); assert.match(fourBar.crank, /40 mm/); assert.match(fourBar.status, /SOLVED/);
  result.fourBarRegression = fourBar; result.checks.push('Four-Bar Lab continua acessível no /demo, com solver e proveniência hipotética');
  await screenshot('14-four-bar-regression.png'); result.screenshots.push('14-four-bar-regression.png');

  const assets = await evaluate(`performance.getEntriesByType('resource').filter(x=>new URL(x.name).pathname.endsWith('/assets/architectural_library.glb')).map(x=>({durationMs:x.duration,transferSize:x.transferSize,decodedBodySize:x.decodedBodySize}))`);
  result.blenderAsset = { requests: asset.requests, lastHttpStatus: asset.status, fileBytes: (await stat(resolve('public/assets/architectural_library.glb'))).size, timings: assets };
  assert.ok(asset.requests >= 1 && asset.status === 200 && result.blenderAsset.fileBytes > 0 && assets.some((entry) => entry.decodedBodySize > 0), 'GLB arquitectónico deve ter sido realmente pedido pelo browser');
  result.checks.push('o browser carregou o GLB Blender da biblioteca por HTTP 200; módulos são assets conceptuais independentes e não fazem parte do tracing por defeito');
  result.metaRequests = await evaluate(`performance.getEntriesByType('resource').filter(x=>new URL(x.name).pathname.startsWith('/api/')).length`);
  assert.equal(result.metaRequests, 0);
  assert.equal(errors.length, 0, errors.join('; '));
  await writeFile(resolve(outputDir, 'second-plan-e2e.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  result.failure = error instanceof Error ? error.stack : String(error);
  try { await screenshot('second-plan-failure.png'); } catch {}
  await writeFile(resolve(outputDir, 'second-plan-e2e.json'), JSON.stringify(result, null, 2));
  console.error(JSON.stringify(result, null, 2)); process.exitCode = 1;
} finally {
  socket.close(); await fetch(`http://127.0.0.1:${cdpPort}/json/close/${target.id}`).catch(() => undefined);
}
