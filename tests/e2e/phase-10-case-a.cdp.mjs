import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import WebSocket from 'ws';

const baseUrl = process.env.UNFOLD_E2E_URL ?? 'http://127.0.0.1:5191';
const fixture = resolve(process.env.UNFOLD_PLAN_FIXTURE ?? 'reports/phase-10-teardown/fixtures/case-a-floor-plan.png');
const outputDir = resolve(process.env.UNFOLD_EVIDENCE_DIR ?? 'reports/phase-10-teardown/evidence/case-a');
const cdpPort = Number(process.env.UNFOLD_CDP_PORT ?? 9227);
await mkdir(outputDir, { recursive: true });
const created = await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: 'PUT' });
assert.equal(created.status, 200, 'Chrome headed with CDP is required.');
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
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map((x) => x.value ?? x.description).join(' '));
  if (message.method === 'Network.requestWillBeSent' && new URL(message.params.request.url).pathname.startsWith('/api/')) requests.set(message.params.requestId, new URL(message.params.request.url).pathname);
  if (message.method === 'Network.responseReceived' && requests.has(message.params.requestId)) api.push({ requestId: message.params.requestId, path: requests.get(message.params.requestId), status: message.params.response.status });
  if (message.id && pending.has(message.id)) { const waiter = pending.get(message.id); pending.delete(message.id); message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result); }
});
function cdp(method, params = {}) { const requestId = ++id; return new Promise((resolve, reject) => { pending.set(requestId, { resolve, reject }); socket.send(JSON.stringify({ id: requestId, method, params })); }); }
async function evaluate(expression) { const out = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description ?? out.exceptionDetails.text); return out.result?.value; }
async function waitFor(expression, timeout = 15000) { const start = Date.now(); while (Date.now() - start < timeout) { if (await evaluate(expression)) return; await new Promise((r) => setTimeout(r, 100)); } throw new Error(`Timeout waiting for ${expression}`); }
async function click(selector) { await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('missing '+${JSON.stringify(selector)});e.click()})()`); }
async function setValue(selector, value) { await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('missing '+${JSON.stringify(selector)});e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`); }
async function screenshot(name) { const shot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true }); const data = Buffer.from(shot.data, 'base64'); await writeFile(resolve(outputDir, name), data); return data; }
async function upload(selector, file) { const { root } = await cdp('DOM.getDocument', { depth: -1 }); const { nodeId } = await cdp('DOM.querySelector', { nodeId: root.nodeId, selector }); assert.ok(nodeId, `Missing file input ${selector}`); await cdp('DOM.setFileInputFiles', { nodeId, files: [file] }); await evaluate(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new Event('change',{bubbles:true}))`); }
async function pointOnOverlay(p) { return evaluate(`(()=>{const s=document.querySelector('#plan-overlay'),r=s.getBoundingClientRect(),v=s.viewBox.baseVal;return {x:r.left+${p.x}*r.width/v.width,y:r.top+${p.y}*r.height/v.height}})()`); }
async function mouse(type, p, buttons) { const q = await pointOnOverlay(p); await cdp('Input.dispatchMouseEvent', { type, x: q.x, y: q.y, button: 'left', buttons, clickCount: 1 }); }
async function trace(a,b) { await mouse('mousePressed',a,1); await mouse('mouseMoved',b,1); await mouse('mouseReleased',b,0); }
async function imageClick(p) { const q = await pointOnOverlay(p); await cdp('Input.dispatchMouseEvent',{type:'mousePressed',x:q.x,y:q.y,button:'left',buttons:1,clickCount:1}); await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x:q.x,y:q.y,button:'left',buttons:0,clickCount:1}); }

const result = { scenario: 'A · generated floor plan with independent dimensions', browser: 'Google Chrome headed, DevTools Protocol', baseUrl, source: fixture, sourceSha256: createHash('sha256').update(await readFile(fixture)).digest('hex'), api, screenshots: [], checks: [], errors };
try {
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: `${baseUrl}/demo` });
  await waitFor(`document.querySelector('#demo-open-spatial')`);
  await evaluate(`localStorage.removeItem('unfold-spatial-scene.v1')`);
  await click('#demo-open-spatial'); await waitFor(`document.querySelector('.spatial-lab')`);
  await upload('#plan-file', fixture); await waitFor(`document.querySelector('#source-image').naturalWidth===1200`);
  result.screenshots.push('01-original.png'); await screenshot('01-original.png');
  await click('[data-view-mode="trace"]'); await click('#trace-mode');
  const segs = [
    [[100,100],[700,100]], [[700,100],[1100,100]], [[1100,100],[1100,600]],
    [[1100,600],[700,600]], [[700,600],[100,600]], [[100,600],[100,100]], [[700,100],[700,600]],
  ];
  for (const [a,b] of segs) await trace({x:a[0],y:a[1]},{x:b[0],y:b[1]});
  await new Promise((resolve) => setTimeout(resolve, 500));
  result.traceDebug = await evaluate(`({candidateCount:document.querySelectorAll('#candidate-list [data-candidate]').length,selectedCount:document.querySelectorAll('#candidate-list [data-candidate][aria-pressed="true"]').length,status:document.querySelector('#spatial-status')?.textContent,traceMode:document.querySelector('#trace-mode')?.getAttribute('aria-pressed'),viewBox:document.querySelector('#plan-overlay')?.getAttribute('viewBox')})`);
  assert.equal(result.traceDebug.candidateCount, 7, `Expected 7 unique wall candidates, got ${JSON.stringify(result.traceDebug)}`);
  const regionCount = await evaluate(`document.querySelectorAll('#region-list [data-region]').length`);
  result.tracing = await evaluate(`({candidateCount:document.querySelectorAll('#candidate-list [data-candidate]').length,regionCount:document.querySelectorAll('#region-list [data-region]').length,regions:Array.from(document.querySelectorAll('#region-list [data-region]')).map(e=>({id:e.dataset.region,text:e.innerText})),viewBox:document.querySelector('#plan-overlay').getAttribute('viewBox')})`);
  result.screenshots.push('02-manual-trace-and-regions.png'); await screenshot('02-manual-trace-and-regions.png');
  const reconstructionRegions = result.tracing.regions.filter((region) => region.id.startsWith('room-'));
  assert.equal(reconstructionRegions.length, 2, 'The independent fixture should produce exactly two orthogonal room supports; duplicate half-edge faces remain excluded.');
  for (const region of reconstructionRegions) await click(`#region-list [data-region="${region.id}"]`);
  await click('#scale-mode'); await imageClick({x:100,y:680}); await imageClick({x:1100,y:680});
  await setValue('#scale-distance','10'); await evaluate(`(()=>{const e=document.querySelector('#scale-unit');e.value='m';e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await setValue('#wall-height','2.7'); await setValue('#wall-thickness','0.12'); await setValue('#scale-evidence','Cota fixture conhecida: 10,00 m em 1000 px. Ground truth independente no ficheiro case-a-ground-truth.json.');
  await click('#build-scene'); await waitFor(`document.querySelector('#scene-components')?.hidden===false`);
  await waitFor(`document.querySelectorAll('#component-list [data-scene-node]').length===9`);
  let saved = await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`);
  assert.equal(saved.scene.schema,'spatial_scene.v1');
  const rooms = saved.scene.nodes.filter((node) => node.component?.kind === 'room');
  assert.equal(rooms.length,2);
  const measure = rooms.map((room) => { const xs=room.geometry.verticesM.map(p=>p[0]),zs=room.geometry.verticesM.map(p=>p[2]);return {id:room.id,width:Math.max(...xs)-Math.min(...xs),depth:Math.max(...zs)-Math.min(...zs),areaM2:room.component.properties.area?.value}; });
  result.geometry = { schema:saved.scene.schema, roomCount:rooms.length, wallCount:saved.scene.nodes.filter(n=>n.component?.kind==='wall').length, measurements:measure, mapping:saved.scene.imageWorldMapping, dimensionsPass:measure.every((m,i)=>Math.abs(m.width-[6,4][i])/[6,4][i]<=0.01&&Math.abs(m.depth-5)/5<=0.01), topologyPass:saved.scene.relations.filter(r=>r.kind==='bounded_by').length===8 };
  assert.equal(result.geometry.dimensionsPass,true); assert.equal(result.geometry.topologyPass,true);
  result.checks.push('trace manual produce 2 regiões, 7 paredes únicas e dimensões/áreas dentro de 1%');
  result.screenshots.push('03-case-a-scene.png'); await screenshot('03-case-a-scene.png');
  const internal = saved.scene.nodes.find((n) => n.component?.kind==='wall'&&n.geometry.kind==='box'&&Math.abs(n.transform.translationM[0]-7)<0.01);
  assert.ok(internal,'Shared wall must be selectable by stable node ID.');
  await click(`[data-scene-node="${internal.id}"]`); await waitFor(`document.querySelector('#inspector')?.hidden===false`);
  result.inspection = await evaluate(`({id:document.querySelector('#component-list [aria-pressed=true]')?.dataset.sceneNode,label:document.querySelector('#node-label').textContent,meta:document.querySelector('#node-meta').textContent,provenance:document.querySelector('#node-provenance').textContent})`);
  saved = await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`);
  const canonicalBeforeInspection = JSON.stringify(saved.scene);
  await click('#isolate-selected'); await waitFor(`document.querySelector('#isolate-selected').getAttribute('aria-pressed')==='true'`); result.screenshots.push('04-isolated-component.png'); await screenshot('04-isolated-component.png');
  assert.equal(await evaluate(`JSON.stringify(JSON.parse(localStorage.getItem('unfold-spatial-scene.v1')).scene)`),canonicalBeforeInspection);
  await click('#isolate-selected'); await click('#toggle-cutaway'); await waitFor(`document.querySelector('#toggle-cutaway').getAttribute('aria-pressed')==='true'`); result.screenshots.push('05-cutaway.png'); await screenshot('05-cutaway.png');
  assert.equal(await evaluate(`JSON.stringify(JSON.parse(localStorage.getItem('unfold-spatial-scene.v1')).scene)`),canonicalBeforeInspection);
  await click('#toggle-cutaway');
  result.checks.push('componente identificado; isolamento e clipping temporários não alteraram a Scene Graph');
  // One explicitly authorized real Muse Spark proposal; the browser's own command handler performs preview and explicit commit.
  await setValue('#demo-question','Remove esta parede interna e amplia a Sala A.'); await click('#demo-submit');
  await waitFor(`document.querySelector('#commit-preview')?.disabled===false`,30000);
  const proposalStatus = await evaluate(`document.querySelector('#spatial-status').textContent`);
  assert.match(proposalStatus,/conceptual|conceptual|desconhecidas|estrutural/i);
  result.screenshots.push('06-remove-wall-preview.png'); await screenshot('06-remove-wall-preview.png');
  await click('#commit-preview'); await waitFor(`document.querySelector('#commit-preview')?.disabled===true`);
  const beforeUndo = await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`);
  assert.equal(beforeUndo.scene.nodes.filter(n=>n.component?.kind==='room').length,1);
  assert.equal(beforeUndo.scene.nodes.filter(n=>n.component?.kind==='wall').length,6);
  assert.equal(beforeUndo.scene.revision.number,saved.scene.revision.number+1);
  result.transformation = { status:'committed', revision:beforeUndo.scene.revision.number, rooms:beforeUndo.scene.nodes.filter(n=>n.component?.kind==='room').length, walls:beforeUndo.scene.nodes.filter(n=>n.component?.kind==='wall').length, structuralImplication:beforeUndo.scene.nodes.find(n=>n.component?.kind==='room')?.component?.properties?.structuralImplication?.value };
  result.screenshots.push('07-remove-wall-committed.png'); await screenshot('07-remove-wall-committed.png');
  await click('#undo-scene'); await waitFor(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1')).scene.revision.number===${beforeUndo.scene.revision.number+1}`);
  const undone = await evaluate(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1'))`);
  assert.deepEqual(undone.scene.nodes,saved.scene.nodes);
  await click('#redo-scene'); await waitFor(`JSON.parse(localStorage.getItem('unfold-spatial-scene.v1')).scene.nodes.filter(n=>n.component?.kind==='room').length===1`);
  result.checks.push('proposta Muse Spark → preview → commit transacional → undo/redo no grafo canónico');
  result.screenshots.push('08-before-after.png'); await screenshot('08-before-after.png');
  result.api = api;
  assert.equal(api.filter((x)=>x.path==='/api/spatial-agent'&&x.status===200).length,1,'Exactly one real spatial-agent HTTP response expected.');
  assert.equal(errors.length,0,errors.join('; '));
  const renderer = await evaluate(`(()=>{const gl=document.querySelector('#spatial-canvas canvas').getContext('webgl2')||document.querySelector('#spatial-canvas canvas').getContext('webgl');const ext=gl?.getExtension('WEBGL_debug_renderer_info');return {renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'masked',vendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):'masked',viewport:[innerWidth,innerHeight],dpr:devicePixelRatio}})()`);
  result.renderer = renderer;
  result.frameTiming = await evaluate(`new Promise(resolve=>{const a=[];let last=performance.now();function f(now){a.push(now-last);last=now;if(a.length===91){a.sort((x,y)=>x-y);resolve({samples:a.length,p50Ms:a[45],p95Ms:a[86],meanMs:a.reduce((x,y)=>x+y,0)/a.length})}else requestAnimationFrame(f)}requestAnimationFrame(f)})`);
  result.performanceVerdict = /swiftshader/i.test(renderer.renderer) ? 'software-rendering-only' : 'reported-renderer-needs-hardware-classification';
  await writeFile(resolve(outputDir,'case-a-e2e.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
} catch (error) {
  result.failure = error instanceof Error ? error.stack : String(error);
  try { await screenshot('failure.png'); } catch {}
  await writeFile(resolve(outputDir,'case-a-e2e.json'),JSON.stringify(result,null,2)); console.error(JSON.stringify(result,null,2)); process.exitCode=1;
} finally { socket.close(); await fetch(`http://127.0.0.1:${cdpPort}/json/close/${target.id}`).catch(()=>undefined); }
