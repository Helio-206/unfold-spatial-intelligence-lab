// V4 E0 browser integration against the REAL local backend:
//   browser -> Vite -> /api proxy -> createMetaServer (server/index.ts, no Meta key needed for local routes)
// Only the paid plan-generation route is simulated; adopt, the atomic transaction, revision checks
// and grouped undo all go through the real HTTP server. No mocked transaction endpoint.
// Run: node tests/e2e/v4-e0-atomic-browser.pw.mjs   (spawns and stops its own backend + Vite)
import { spawn } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const backendPort = 8899, webPort = 5302;
const out = process.env.UNFOLD_V4_E0_OUT ?? '/tmp/unfold-v4-e0-browser'; await mkdir(out, { recursive: true });
const children = [];
const start = (command, args, env, name) => {
  const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => process.stdout.write(`[${name}] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[${name}] ${d}`));
  children.push(child); return child;
};
const waitFor = async (url, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) { try { const r = await fetch(url); if (r.ok) return; } catch { /* not up yet */ } if (Date.now() > deadline) throw new Error(`timeout waiting for ${url}`); await new Promise((r) => setTimeout(r, 250)); }
};

let browser;
try {
  start('./node_modules/.bin/tsx', ['server/index.ts'], { UNFOLD_BACKEND_PORT: String(backendPort), UNFOLD_LOCAL_TOKEN_FILE: `${out}/local-token`, UNFOLD_ACCEPTANCE_BUDGET_FILE: `${out}/budget.json`, UNFOLD_LOCAL_ORIGINS: `http://127.0.0.1:${webPort}`, MODEL_API_KEY: '' }, 'backend');
  start('./node_modules/.bin/vite', ['--host', '127.0.0.1', '--port', String(webPort)], { UNFOLD_API_TARGET: `http://127.0.0.1:${backendPort}` }, 'vite');
  await waitFor(`http://127.0.0.1:${backendPort}/api/health`);
  await waitFor(`http://127.0.0.1:${webPort}/living`);

  const input = JSON.parse(await readFile('reports/fidelity-v4/hierarchical/plans/excavator-input.json', 'utf8'));
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  // Meta inference simulated ONLY at the paid plan route; everything below is the real server.
  await page.route('**/api/spatial/v2/plan', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(input) }));
  await page.goto(`http://127.0.0.1:${webPort}/living?debug-living&experimental-v4&rm=1`, { waitUntil: 'networkidle' });
  await page.click('[data-space="open"]'); await page.fill('#sp-text', 'Experiência local E0 com servidor real.'); await page.click('[data-sp="submit"]');
  await page.waitForSelector('.sp-root[data-phase="review"]'); await page.click('[data-sp="keep-all"]'); await page.check('#sp-ack'); await page.click('[data-sp="build"]');
  // The reviewed plan is adopted into a real server session (no adopt mock in this run).
  await page.waitForFunction(() => window.__space.session && window.__space.layer && !window.__space.layer.isBusy, null, { timeout: 40_000 });

  const result = await page.evaluate(async () => {
    const flow = window.__space, layer = flow.layer;
    const before = JSON.stringify(layer.currentPlan);
    const [a, b] = layer.currentPlan.components;
    const move = (component, dx) => ({ contract: 'unfold.spatial-operation.v2', operationId: `e2e-${component.id}`.slice(0, 80), kind: 'set-transform', componentId: component.id, nodeKey: null, value: { ...component.transform, position: [component.transform.position[0] + dx, component.transform.position[1], component.transform.position[2]] } });
    // Synchronised multi-operation transaction through the layer's real sync.
    if (!layer.proposeSolverEdit([move(a, 0.25), move(b, -0.25)], 'E2E atómico', 'browser E2E against the real local server')) return { ok: false, stage: 'propose' };
    layer.authorise(true); await layer.applyEdit();
    const afterApply = { revision: flow.session.revision, editCount: layer.editCount, positions: layer.currentPlan.components.slice(0, 2).map((c) => c.transform.position[0]), unresolved: layer.transactionUnresolved };
    // Authoritative check straight against the server: baseRevision 0 is now stale, currentRevision must be 1.
    const stale = await fetch('/api/spatial/v2/transactions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contract: 'unfold.spatial-transaction.v2', sessionId: flow.session.id, baseRevision: 0, idempotencyKey: 'e2e-stale-check-1', operations: [move(a, 1)], provenance: { origin: 'inferred', evidence: 'stale check' } }) }).then(async (r) => ({ status: r.status, body: await r.json() }));
    // Grouped undo: one server undo for the whole transaction.
    const undone = await layer.undo();
    const staleAfterUndo = await fetch('/api/spatial/v2/transactions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contract: 'unfold.spatial-transaction.v2', sessionId: flow.session.id, baseRevision: 1, idempotencyKey: 'e2e-stale-check-2', operations: [move(a, 1)], provenance: { origin: 'inferred', evidence: 'stale check' } }) }).then(async (r) => ({ status: r.status, body: await r.json() }));
    return { ok: true, before, afterApply, stale, undone, staleAfterUndo, afterUndoRevision: flow.session.revision, restored: JSON.stringify(layer.currentPlan) === before, editCountAfterUndo: layer.editCount };
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.afterApply.revision, 1, 'one revision for the whole transaction');
  assert.equal(result.afterApply.editCount, 1, 'one history entry for the group');
  assert.equal(result.afterApply.unresolved, false);
  assert.notDeepEqual(result.afterApply.positions, JSON.parse(result.before).components.slice(0, 2).map((c) => c.transform.position[0]));
  assert.equal(result.stale.status, 409); assert.equal(result.stale.body.error.currentRevision, 1, 'server authoritative revision after commit');
  assert.equal(result.undone, true, 'grouped undo through the real server');
  assert.equal(result.afterUndoRevision, 2, 'grouped undo advances revision once');
  assert.equal(result.restored, true, 'grouped undo restores the exact pre-transaction plan');
  assert.equal(result.staleAfterUndo.status, 409); assert.equal(result.staleAfterUndo.body.error.currentRevision, 2);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: `${out}/after-grouped-undo.png` });
  process.stdout.write(`${JSON.stringify({ case: 'v4-e0-atomic-browser', afterApply: result.afterApply, afterUndoRevision: result.afterUndoRevision, restored: result.restored, errors }, null, 2)}\n`);
} finally {
  await browser?.close().catch(() => {});
  for (const child of children) child.kill('SIGTERM');
}
