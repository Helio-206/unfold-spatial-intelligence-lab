import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import WebSocket from 'ws';

const baseUrl = process.env.UNFOLD_E2E_URL ?? 'http://127.0.0.1:5194';
const debugUrl = process.env.UNFOLD_CDP_URL ?? 'http://127.0.0.1:9227';
const imagePath = resolve(process.env.UNFOLD_PLAN_IMAGE ?? 'reports/phase-7e4/evidence/architecture-source.png');
const outputDir = resolve(process.env.UNFOLD_EVIDENCE_DIR ?? 'reports/phase-10-stabilization/evidence/semantic-restore');
await mkdir(outputDir, { recursive: true });
const imageBytes = await readFile(imagePath);
const targetResponse = await fetch(`${debugUrl}/json/new?about:blank`, { method: 'PUT' });
assert.equal(targetResponse.status, 200, 'Chromium CDP indisponível.');
const target = await targetResponse.json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolvePromise, reject) => { socket.once('open', resolvePromise); socket.once('error', reject); });
let nextId = 0;
const pending = new Map();
const requests = [];
const errors = [];
socket.on('message', (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.method === 'Fetch.requestPaused') {
    requests.push(message.params.request.url);
    void cdp('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode: 503, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: Buffer.from('{"error":{"code":"E2E_OFFLINE"}}').toString('base64') });
  }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  if (message.id && pending.has(message.id)) {
    const waiter = pending.get(message.id); pending.delete(message.id);
    message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
  }
});
function cdp(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolvePromise, reject) => { pending.set(id, { resolve: resolvePromise, reject }); socket.send(JSON.stringify({ id, method, params })); });
}
async function evaluate(expression) {
  const response = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  return response.result?.value;
}
async function waitFor(expression) {
  const until = Date.now() + 15000;
  while (Date.now() < until) { if (await evaluate(expression)) return; await new Promise((done) => setTimeout(done, 100)); }
  throw new Error(`Timeout: ${expression}`);
}
async function screenshot(name) {
  const shot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
  await writeFile(resolve(outputDir, name), Buffer.from(shot.data, 'base64'));
}

const document = {
  schema: 'technical_document.v1', provenance: { source: 'submitted_image', kind: 'model_extraction' },
  analysisState: 'complete', documentType: 'Fixture E2E — planta', primaryDomain: 'architecture', secondaryDomains: [],
  classification: { confidence: 0.9, evidence: 'fixture E2E', rationale: 'Documento criado exclusivamente para teste offline.' },
  summary: 'Fixture E2E para testar restauração de associação semântica.',
  elements: [{ id: 'el-kitchen', kind: 'room', label: 'Cozinha fixture', status: 'observed', evidence: 'Fixture; não é resultado Meta.', confidence: 0.9, rawValue: null, value: null, unit: null }],
  relations: [], observedText: ['Cozinha fixture'], ambiguities: [], missingInformation: [],
  capabilities: ['canExplain', 'canInspect', 'canEditSemanticData', 'canVisualize2D', 'canConstruct3D', 'canSimulate', 'canRunWhatIf'].map((id) => ({ id, state: 'partial', reason: 'Fixture offline.', dependencies: [], missing: [], engine: null })),
  questions: [],
};
const imageBase64 = imageBytes.toString('base64');
const result = { browser: null, sourceSha256: createHash('sha256').update(imageBytes).digest('hex'), provider: 'offline test fixture', metaCalls: 0, requests, checks: [], errors };

try {
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Fetch.enable', { patterns: [{ urlPattern: `${baseUrl}/api/*`, requestStage: 'Request' }] });
  const browser = await cdp('Browser.getVersion');
  assert.doesNotMatch(browser.userAgent, /Headless/i);
  result.browser = browser.product;
  await cdp('Page.navigate', { url: `${baseUrl}/demo` });
  await waitFor("document.querySelector('#app') && document.querySelector('#app').children.length>0");
  const seeded = await evaluate(`(async()=>{
    const doc=${JSON.stringify(document)};
    const raw=Uint8Array.from(atob(${JSON.stringify(imageBase64)}),c=>c.charCodeAt(0));
    const file=new File([raw],'architecture-source.png',{type:'image/png'});
    const imageDigest=new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()));
    const imageSha=[...imageDigest].map(x=>x.toString(16).padStart(2,'0')).join('');
    const docDigest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(doc))));
    const docSha=[...docDigest].map(x=>x.toString(16).padStart(2,'0')).join('');
    const ref={documentId:'doc-'+docSha.slice(0,20),sha256:docSha};
    const source=await import('/src/spatial-source-store.ts');
    await source.saveSpatialSourceImage(file,ref,doc);
    const semantic=await import('/src/semantic-spatial-map.ts');
    let map=semantic.createSemanticSpatialMap(doc,ref.documentId,imageSha);
    const region={id:'region-e2e-restore',boundaryCandidateIds:['a','b','c','d'],vertices:[{x:0,y:0},{x:100,y:0},{x:100,y:80},{x:0,y:80}],areaPx2:8000,validation:'unreviewed',eligibility:'construction_candidate',confidence:0.85,evidence:['fixture closed contour'],topologyMethod:'closed_segment_graph'};
    map=semantic.proposeSemanticLink(map,doc,region,'el-kitchen',{documentId:ref.documentId,imageSha256:imageSha});
    const workspace=semantic.serializeSemanticWorkspace({schema:'semantic_spatial_workspace.v1',documentId:ref.documentId,sourceImageSha256:imageSha,document:doc,map});
    const workspaceKey=semantic.semanticWorkspaceStorageKey(ref.documentId,imageSha);
    localStorage.setItem(workspaceKey,workspace);
    return {imageSha,documentId:ref.documentId,map,workspaceKey};
  })()`);
  result.checks.push('IndexedDB e workspace local preparados com a mesma origem/hash, via fixture explícita');
  await cdp('Page.navigate', { url: `${baseUrl}/spatial-editor?source=accepted-document` });
  await waitFor("document.querySelector('#semantic-link-list')?.textContent.includes('proposed')");
  const restoredUi = await evaluate(`(()=>{const w=JSON.parse(localStorage.getItem(${JSON.stringify(seeded.workspaceKey)}));return {list:document.querySelector('#semantic-link-list').textContent,acceptDisabled:document.querySelector('#semantic-accept').disabled,rejectDisabled:document.querySelector('#semantic-reject').disabled,stored:w.map.links[0].review.state}})()`);
  assert.equal(restoredUi.stored, 'proposed');
  assert.equal(restoredUi.acceptDisabled, false, 'proposal must be actionable after source restore');
  assert.equal(restoredUi.rejectDisabled, false);
  result.restored = restoredUi;
  result.checks.push('reload/handoff manteve proposta legada do mesmo documento+imagem para revisão explícita');
  await screenshot('semantic-proposal-restored.png');
  await evaluate("document.querySelector('#semantic-accept').click()");
  await waitFor(`document.querySelector('#spatial-status').textContent.startsWith('Associação não confirmada:')`);
  const reviewAfterStaleAccept = await evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(seeded.workspaceKey)})).map.links[0].review`);
  assert.equal(reviewAfterStaleAccept.state, 'proposed', 'stale fixture geometry must not become an accepted semantic fact');
  assert.match(await evaluate(`document.querySelector('#spatial-status').textContent`), /Região candidata já não existe/);
  result.staleAcceptance = { state: reviewAfterStaleAccept.state, status: await evaluate(`document.querySelector('#spatial-status').textContent`) };
  result.checks.push('snapshot de região que não existe na vectorização restaurada é recusado; a proposta continua proposed');
  await screenshot('semantic-proposal-stale-rejected.png');
  assert.deepEqual(errors, []);
  assert.ok(requests.every((url) => new URL(url).pathname === '/api/diagnostics'), 'unexpected application API call in this offline test');
  result.status = 'passed';
  await writeFile(resolve(outputDir, 'result.json'), JSON.stringify(result, null, 2));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  result.status = 'failed'; result.error = error instanceof Error ? error.message : String(error);
  await writeFile(resolve(outputDir, 'result.json'), JSON.stringify(result, null, 2));
  throw error;
} finally { socket.close(); }
