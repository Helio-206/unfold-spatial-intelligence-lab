import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import assert from 'node:assert/strict';

// Review regressions for PR #15: stale approval cards and the timeline thumb.
process.env.UNFOLD_API_TARGET = 'http://127.0.0.1:9';
const port = Number(process.env.UNFOLD_WORKSPACE_REVIEW_PORT ?? 5308);
const server = await createServer({ server: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const errors = [];
const open = async (rm) => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/living?debug-living=1&agent=fixture&rm=${rm}`);
  await page.waitForFunction(() => window.__foundry?.ready, null, { timeout: 120000 });
  return page;
};
const proposals = (page) => page.evaluate(() => window.__workspace.getState().messages.filter((m) => m.proposal?.kind === 'engine_move').map((m) => m.proposal.state));
try {
  // P2-1a: reset invalidates the engine token, so the card must stop offering approval.
  const page = await open(0);
  await page.evaluate(() => { const ws = window.__workspace; ws.select('boom_cylinder'); ws.offerExperiment('boom_cylinder', null); });
  await page.evaluate(() => window.__workspace.dispatch({ type: 'set_mode', mode: 'conversation' }));
  assert.deepEqual(await proposals(page), ['pending']);
  assert.equal(await page.locator('.uw-proposal [data-act="approve"]').count(), 1, 'the live card offers approval (non-vacuous check)');
  await page.evaluate(() => window.__workspace.resetPose());
  assert.deepEqual(await proposals(page), ['cancelled'], 'reset cancels the pending card');
  assert.equal(await page.locator('.uw-proposal [data-act="approve"]').count(), 0, 'no approve button on a dead proposal');
  console.log('PASS reset cancels pending approval cards');

  // P2-1b: a newer proposal supersedes the older card; only the newest can be approved.
  await page.evaluate(() => { const ws = window.__workspace; ws.offerExperiment('boom_cylinder', null); ws.offerExperiment('boom_cylinder', null); });
  assert.deepEqual(await proposals(page), ['cancelled', 'cancelled', 'pending']);
  assert.equal(await page.locator('.uw-proposal [data-act="approve"]').count(), 1);
  console.log('PASS a new proposal supersedes the previous card');

  // P2-1c: seeking or cancelling also discards the engine candidate.
  await page.evaluate(() => { const ws = window.__workspace; ws.cancelEngine(); });
  assert.equal((await proposals(page)).filter((s) => s === 'pending').length, 0);
  console.log('PASS cancel leaves no pending approval card');
  await page.close();

  // P2-2: the timeline thumb follows engine time while playing, and does not fight an active drag.
  const live = await open(0);
  await live.evaluate(() => { const ws = window.__workspace; ws.select('boom_cylinder'); const i = ws.el.inspector.querySelector('[data-el="engineTarget"]'); i.value = '0.65'; ws.previewEngineMove(); ws.approveEngineMove(); });
  // Advance the engine and draw in one synchronous step, so nothing else re-renders the inspector in between.
  const samples = await live.evaluate(() => {
    const ws = window.__workspace, out = [];
    for (const dt of [0.03, 0.04, 0.05]) {
      ws.engineering.advance(dt); ws.showEngineFrame();
      out.push({ time: ws.engineState().timeS, thumb: ws.el.inspector.querySelector('[data-act="engine-seek"]').valueAsNumber });
    }
    return out;
  });
  assert.ok(samples.every((s) => s.time > 0 && Math.abs(s.thumb - s.time) < 1e-6), JSON.stringify(samples));
  assert.equal(new Set(samples.map((s) => s.thumb)).size, 3, 'thumb moves between timestamps');
  console.log('PASS timeline thumb follows engine time during playback');

  const drag = await live.evaluate(() => {
    const ws = window.__workspace; ws.resetPose(); ws.select('boom_cylinder');
    const i = ws.el.inspector.querySelector('[data-el="engineTarget"]'); i.value = '0.65'; ws.previewEngineMove(); ws.approveEngineMove();
    const seek = ws.el.inspector.querySelector('[data-act="engine-seek"]');
    seek.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); seek.value = '0.02';
    ws.engineering.advance(0.2); ws.showEngineFrame();
    const held = seek.value; seek.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); ws.showEngineFrame();
    return { held, afterRelease: seek.valueAsNumber, time: ws.engineState().timeS, same: seek === ws.el.inspector.querySelector('[data-act="engine-seek"]') };
  });
  assert.equal(drag.held, '0.02'); assert.ok(Math.abs(drag.afterRelease - drag.time) < 1e-6 && drag.same, JSON.stringify(drag));
  console.log('PASS thumb does not fight an active drag and resyncs on release');

  // P2-3: the request really sent to the model describes the connected engine and its boundaries (no model call is paid for: the route is intercepted).
  const agent = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  agent.on('pageerror', (error) => errors.push(error.message));
  const bodies = [];
  await agent.route('**/api/spatial-agent', (route) => { bodies.push(JSON.parse(route.request().postData() ?? '{}')); return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":{"code":"NOT_FOUND"}}' }); });
  await agent.goto(`http://127.0.0.1:${port}/living?debug-living=1&rm=1`);
  await agent.waitForFunction(() => window.__foundry?.ready, null, { timeout: 120000 });
  await agent.evaluate(async () => { const ws = window.__workspace; ws.select('boom_cylinder'); await ws.ask('O que acontece se este cilindro se estender?'); });
  assert.equal(bodies.length, 1);
  const constraints = bodies[0].scene.constraints.join(' | ');
  assert.doesNotMatch(constraints, /não está ligado/i);
  assert.match(constraints, /motor de engenharia está ligado/i); assert.match(constraints, /confirmação do utilizador/i); assert.match(constraints, /não executa/i);
  assert.ok(bodies[0].scene.constraints.every((c) => c.length <= 180));
  console.log('PASS outgoing agent request describes the connected engine and its boundaries');
  await agent.close();

  // P2-4: inspector candidate A -> chat proposal B. A's confirm button must disappear; B stays executable.
  const mixed = await open(1);
  await mixed.evaluate(() => { const ws = window.__workspace; ws.dispatch({ type: 'set_mode', mode: 'conversation' }); ws.select('boom_cylinder'); const i = ws.el.inspector.querySelector('[data-el="engineTarget"]'); i.value = '0.65'; ws.previewEngineMove(); });
  assert.equal(await mixed.locator('[data-act="engine-approve"]').count(), 1, 'inspector candidate A is actionable');
  await mixed.evaluate(() => window.__workspace.offerExperiment('boom_cylinder', null));
  assert.equal(await mixed.locator('[data-act="engine-approve"]').count(), 0, 'superseded inspector candidate has no confirm button');
  assert.equal(await mixed.locator('.uw-proposal [data-act="approve"]').count(), 1);
  assert.deepEqual(await proposals(mixed), ['pending']);
  await mixed.evaluate(() => { const ws = window.__workspace; return ws.approveProposal(ws.getState().messages.at(-1).id); });
  assert.deepEqual(await proposals(mixed), ['done'], 'chat candidate B ran');
  assert.equal(await mixed.evaluate(() => window.__workspace.poseSource), 'engine');
  console.log('PASS chat proposal supersedes the inspector candidate and stays executable');
  // chat card -> inspector candidate: the card is cancelled and the inspector candidate is the live one.
  await mixed.evaluate(() => { const ws = window.__workspace; ws.resetPose(); ws.offerExperiment('boom_cylinder', null); const i = ws.el.inspector.querySelector('[data-el="engineTarget"]'); i.value = '0.6'; ws.previewEngineMove(); });
  assert.deepEqual((await proposals(mixed)).slice(-1), ['cancelled']);
  assert.equal(await mixed.locator('[data-act="engine-approve"]').count(), 1);
  console.log('PASS inspector candidate supersedes the chat card');
  await mixed.close();
  assert.deepEqual(errors, []);
} finally { await browser.close(); await server.close(); }
