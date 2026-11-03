import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import assert from 'node:assert/strict';

const port = Number(process.env.UNFOLD_SELECTION_PORT ?? 5301);
process.env.UNFOLD_API_TARGET = 'http://127.0.0.1:9';
const server = await createServer({ server: { port, host: '127.0.0.1', strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 800, height: 500 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
let release;
let arrived;
const received = new Promise((resolve) => { arrived = resolve; });
let mode = 'selected';
await page.route('**/api/**', async (route) => {
  const request = route.request().postDataJSON();
  if (mode === 'selected') { arrived(request); await new Promise((resolve) => { release = resolve; }); }
  const selected = mode === 'selected';
  const kind = selected ? 'Focus' : mode === 'inspect' ? 'Inspect' : 'Select';
  const target = selected ? { reference: 'selected', label: null, ordinal: null } : { reference: 'label', label: 'Caçamba', ordinal: null };
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { schema: 'spatial_agent_result.v1', kind: 'PROPOSE_ACTION', text: 'Componente indicado.', basis: 'scene', evidenceIds: [selected ? 'boom_cylinder' : 'bucket'], question: null, action: { kind, target, value: null, valueMode: null, unit: null, axis: null, opening: null } }, meta: { model: 'mock' } }) });
});
try {
  await page.goto(`http://127.0.0.1:${port}/src/living/workspace-design/harness/index.html?agent=auto&rm=0`);
  await page.waitForFunction(() => window.__foundry?.ready, null, { timeout: 240000 });
  await page.evaluate(() => { window.__workspace.select('boom_cylinder'); window.__selectionRequest = window.__workspace.ask('Foca esta peça.'); });
  const request = await received;
  assert.equal(request.scene.selectedId, 'boom_cylinder');
  await page.evaluate(() => window.__workspace.select('bucket'));
  release();
  const result = await page.evaluate(async () => { const g = await window.__selectionRequest; return { id: g.primary?.id, blocked: g.blocked }; });
  assert.deepEqual(result, { id: 'boom_cylinder', blocked: null });
  console.log('PASS selected target uses request snapshot');

  for (const act of ['select', 'inspect']) {
    mode = act;
    const state = await page.evaluate(async (kind) => {
      const ws = window.__workspace;
      ws.clearSelection(); ws.select('boom_cylinder'); ws.toggleIsolate();
      const before = ws.scene.isolatedId;
      const g = await ws.ask(kind === 'inspect' ? 'Inspeciona a caçamba.' : 'Seleciona a caçamba.');
      ws.renderNow();
      const meshes = (id) => { const out = []; ws.model.parts.get(id).traverse((o) => { if (o.isMesh && !o.userData.highlightOverlay) out.push(o); }); return out; };
      const bucket = meshes('bucket'); const cylinder = meshes('boom_cyl_barrel');
      const result = { before, after: ws.scene.isolatedId, selected: ws.selection()?.id, hand: ws.handView()?.targetId, act: g.act, blocked: g.blocked,
        bucketSolid: bucket.length > 0 && bucket.every((mesh) => mesh.material !== ws.scene.ghost),
        cylinderGhosted: cylinder.length > 0 && cylinder.every((mesh) => mesh.material === ws.scene.ghost),
        inspectorOpen: ws.inspectorOpen, inspectorMatches: kind !== 'inspect' || document.querySelector('.uw-inspector').textContent.includes(ws.selection().label) };
      ws.toggleIsolate(); result.restored = ws.scene.isolatedId;
      ws.select('boom_cylinder'); result.returned = ws.selection()?.id;
      return result;
    }, act);
    assert.deepEqual(state, { before: 'boom_cylinder', after: 'bucket', selected: 'bucket', hand: 'bucket', act, blocked: null, bucketSolid: true, cylinderGhosted: true, inspectorOpen: act === 'inspect', inspectorMatches: true, restored: null, returned: 'boom_cylinder' });
    console.log(`PASS isolate cylinder -> ${act} bucket -> restore -> cylinder`);
  }
  const tracking = await page.evaluate(async () => {
    const ws = window.__workspace;
    const pending = [];
    let stops = 0;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: () => new Promise((resolve) => pending.push(resolve)) });
    const first = ws.toggleHandTracking();
    await ws.toggleHandTracking();
    pending.shift()({ getTracks: () => [{ stop: () => { stops++; } }] });
    await first;
    const afterDisable = { stops, current: ws.handTracker, source: ws.el.video.srcObject };
    const second = ws.toggleHandTracking();
    ws.dispose();
    pending.shift()({ getTracks: () => [{ stop: () => { stops++; } }] });
    await second;
    return { afterDisable, stops, source: ws.el.video.srcObject, disposed: ws.disposed };
  });
  assert.deepEqual(tracking, { afterDisable: { stops: 1, current: null, source: null }, stops: 2, source: null, disposed: true });
  console.log('PASS delayed webcam acquisition after disable and disposal');
  assert.deepEqual(errors, []);
} finally {
  await context.close();
  await browser.close();
  await server.close();
}
