// Browser regressions for the PR #13 review findings (and request overlap). Small viewport so SwiftShader stays fast.
//   node tests/e2e/living-visual-foundry-regressions.pw.mjs
// All /api calls are intercepted in the browser; no model is called.
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const OUT = resolve(process.env.UNFOLD_VF_OUT ?? 'reports/living/visual-foundry');
mkdirSync(OUT, { recursive: true });
const port = Number(process.env.UNFOLD_VF_PORT ?? 5298);
process.env.UNFOLD_API_TARGET = 'http://127.0.0.1:9';
const server = await createServer({ server: { port, host: '127.0.0.1', strictPort: true }, logLevel: 'error' });
await server.listen();
const WS = `http://127.0.0.1:${port}/src/living/workspace-design/harness/index.html`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`); };
const answer = (text, evidenceIds) => ({ result: { schema: 'spatial_agent_result.v1', kind: 'ANSWER', text, basis: 'scene', evidenceIds, question: null, action: null }, meta: { model: 'e2e-mock', requestId: 'mock' } });

async function open(api, agent = 'auto') {
  const context = await browser.newContext({ viewport: { width: 800, height: 500 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/**', api);
  await page.goto(`${WS}?agent=${agent}&rm=0&fixtureDemo=1`);
  await page.waitForFunction(() => window.__foundry?.ready, null, { timeout: 240_000 });
  return { page, context, errors };
}
const fixtureFinal = (page) => page.evaluate(async () => {
  const raw = await (await fetch('/src/living/visual-foundry/fixtures/boom-extension-preview.json')).json();
  const last = raw.frames.at(-1).parts; const now = window.__workspace.partPoses();
  return last.every((p) => { const n = now.find((x) => x.partId === p.partId); return n && p.translationM.every((v, i) => Math.abs(v - n.translationM[i]) < 1e-6); });
});
const msgs = (page) => page.evaluate(() => window.__workspace.getState().messages.map((m) => ({ role: m.role, text: m.text, proposal: m.proposal && { state: m.proposal.state, actuatorId: m.proposal.actuatorId ?? null } })));

// 1. Live answer citing ['boom', 'boom_cylinder']: approval must use the planned actuator, not evidence[0]
{
  const { page, context, errors } = await open((route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer('A lança sobe com o cilindro da lança.', ['boom', 'boom_cylinder'])) }));
  await page.evaluate(() => window.__workspace.select('boom_cylinder'));
  const g = await page.evaluate(async () => { const r = await window.__workspace.ask('O que acontece se eu estender este cilindro?'); return { primary: r.primary?.id, source: r.source }; });
  check('live evidence [boom, boom_cylinder] grounds on boom_cylinder', g.primary === 'boom_cylinder' && g.source === 'live', g);
  const before = await msgs(page);
  check('proposal stores the planned canonical actuator id', before.at(-1)?.proposal?.actuatorId === 'boom_cylinder', before.at(-1)?.proposal);
  const id = await page.evaluate(() => window.__workspace.getState().messages.at(-1).id);
  await page.evaluate((id) => window.__workspace.approveProposal(id), id);
  const after = await msgs(page);
  const final = await fixtureFinal(page);
  check('approval plays the boom-cylinder preview to its last frame', final && after.find((m) => m.proposal)?.proposal?.state === 'done', after.at(-1)?.text?.slice(0, 80));
  check('completion message reports fixture measurements', /concluída/.test(after.at(-1)?.text ?? '') && /0\.888/.test(after.at(-1)?.text ?? ''), after.at(-1)?.text?.slice(0, 120));
  check('no page errors (1)', errors.length === 0, errors.join(' | '));
  await context.close();
}

// 2. Cancellation in the middle of playback: reset, supersession, disposal
{
  const { page, context, errors } = await open(() => {}, 'fixture');
  const start = () => page.evaluate(() => { const ws = window.__workspace; ws.select('boom_cylinder'); const plan = ws.offerExperiment('boom_cylinder', null); const id = ws.getState().messages.at(-1).id; window.__run = ws.approveProposal(id); return { id, plan: plan.kind }; });
  const midway = async () => { await page.waitForFunction(() => window.__workspace.poseSource === 'fixture-preview', null, { timeout: 60_000 }); await page.waitForTimeout(300); };

  const a = await start(); await midway();
  await page.evaluate(() => window.__workspace.resetPose());
  await page.evaluate(() => window.__run);
  const m1 = await msgs(page);
  const p1 = m1.find((m) => m.proposal)?.proposal;
  check('reset mid-playback: proposal marked cancelled, not done', p1?.state === 'cancelled', p1);
  check('reset mid-playback: no completion message or final measurements', !m1.some((m) => /concluída/.test(m.text)) && !m1.some((m) => /0\.888/.test(m.text)), m1.at(-1)?.text?.slice(0, 100));
  check('reset mid-playback: scene back on the reference pose', (await page.evaluate(() => window.__workspace.poseSource)) === 'reference');

  const b = await start(); await midway();
  const c = await start(); // supersedes b
  await page.evaluate(() => window.__run);
  const m2 = await msgs(page);
  const states = m2.filter((m) => m.proposal).map((m) => m.proposal.state);
  check('superseded playback is cancelled; only the newest completes', states.at(-2) === 'cancelled' && states.at(-1) === 'done' && m2.filter((m) => /concluída/.test(m.text)).length === 1, { states, ids: [a.id, b.id, c.id] });

  await page.evaluate(() => window.__workspace.resetPose());
  await start(); await midway();
  const disposed = await page.evaluate(async () => { const ws = window.__workspace; const run = window.__run; ws.dispose(); await run; return { messages: ws.getState().messages.filter((m) => /concluída/.test(m.text)).length }; });
  check('disposal mid-playback publishes no completion', disposed.messages === 1, disposed);
  check('no page errors (2)', errors.length === 0, errors.join(' | '));
  await context.close();
}

// 3. Overlapping requests: an aborted older request must not reset the newer request's processing state
{
  let n = 0;
  const { page, context, errors } = await open(async (route) => {
    const k = ++n; const delay = k === 1 ? 2500 : 1500;
    await new Promise((r) => setTimeout(r, delay));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer(`resposta ${k}`, ['boom_cylinder'])) }).catch(() => {});
  });
  const r = await page.evaluate(async () => {
    const ws = window.__workspace;
    const first = ws.ask('o que levanta a lança (1)');
    await new Promise((res) => setTimeout(res, 200));
    const second = ws.ask('o que levanta a lança (2)');
    await new Promise((res) => setTimeout(res, 300));
    const whileSecond = ws.getState().processing;
    const composerWhile = document.querySelector('.uw-composer').dataset.commandState;
    await Promise.all([first, second]);
    const s = ws.getState();
    return { whileSecond, composerWhile, after: s.processing, assistant: s.messages.filter((m) => m.role === 'assistant').map((m) => m.text) };
  });
  check('newer request keeps processing while the older one is aborted', r.whileSecond === true && r.composerWhile === 'PROCESSING', r);
  check('processing ends when the newer request resolves; aborted reply not shown', r.after === false && r.assistant.length === 1 && r.assistant[0] === 'resposta 2', r.assistant);
  check('no page errors (3)', errors.length === 0, errors.join(' | '));
  await context.close();
}

// 4. Fail closed: a saved actuator id with no available preview never becomes 'done'
{
  const { page, context, errors } = await open(() => {}, 'fixture');
  const r = await page.evaluate(async () => {
    const ws = window.__workspace;
    ws.dispatch({ type: 'assistant_message', message: { id: 'bogus-1', role: 'assistant', text: 't', source: 'local', sourceNote: 'x', evidence: [{ componentId: 'boom_cylinder', label: 'x', status: 'resolved' }], proposal: { id: 'p-bogus', title: 't', detail: 'd', kind: 'preview_fixture', approveLabel: 'ok', state: 'pending', actuatorId: 'stick_cylinder' }, error: null, at: 0 } });
    await ws.approveProposal('bogus-1');
    const m = ws.getState().messages;
    return { state: m.find((x) => x.id === 'bogus-1').proposal.state, completed: m.some((x) => /concluída/.test(x.text)), pose: ws.poseSource };
  });
  check('unresolvable actuator id fails closed (not done, no completion, no pose change)', r.state !== 'done' && r.state !== 'running' && !r.completed && r.pose === 'reference', r);
  check('no page errors (4)', errors.length === 0, errors.join(' | '));
  await context.close();
}

// 5. Supersession: A's cancelled continuation must not clear B's 'performing_approved' agency
{
  const { page, context, errors } = await open(() => {}, 'fixture');
  const r = await page.evaluate(async () => {
    const ws = window.__workspace;
    const offer = () => { ws.offerExperiment('boom_cylinder', null); return ws.getState().messages.at(-1).id; };
    const a = offer(); const runA = ws.approveProposal(a);
    await new Promise((res) => { const t = () => (ws.poseSource === 'fixture-preview' ? res() : requestAnimationFrame(t)); t(); });
    const b = offer(); const runB = ws.approveProposal(b);
    await runA; await new Promise((res) => setTimeout(res, 50));
    ws.renderNow();
    const during = document.querySelector('.uw-hand').dataset.agency;
    await runB; ws.renderNow();
    return { during, after: document.querySelector('.uw-hand').dataset.agency };
  });
  check("superseded playback does not clear the newer playback's approved agency", r.during === 'performing_approved' && r.after !== 'performing_approved', r);
  check('no page errors (5)', errors.length === 0, errors.join(' | '));
  await context.close();
}

// 6. Joint presentation (isolation): material swap only; natural view restored; capture both
{
  const { page, context, errors } = await open(() => {}, 'fixture');
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.evaluate(() => { const ws = window.__workspace; ws.dispatch({ type: 'enter_focus' }); ws.setView({ target: [0.62, 1.0, 0], azimuthDeg: 40, elevationDeg: 14, distance: 2.4 }); });
  const snap = () => page.evaluate(() => { const ws = window.__workspace; const geo = []; document.querySelector('canvas'); return { poses: JSON.stringify(ws.partPoses()), stats: ws.stats().modelTriangles }; });
  const before = await snap();
  await page.waitForTimeout(800); await page.evaluate(() => window.__workspace.renderNow());
  await page.screenshot({ path: join(OUT, 'captures', '06c-hydraulic-joint-natural.png'), timeout: 180_000 });
  const ok = await page.evaluate(() => window.__workspace.presentJoint('boom_cyl_base'));
  await page.evaluate(() => window.__workspace.renderNow());
  const pinVisible = await page.evaluate(() => { const ws = window.__workspace; ws.pointAt('boom_cyl_base', 'inspect', 'user_tool'); ws.renderNow(); const v = ws.handView(); ws.dispatch({ type: 'set_overlay', level: 'hidden' }); return { occluded: v.occluded, onScreen: v.x !== null }; });
  // highlight stays on solid meshes only; the ghosted parent is not tinted
  await page.evaluate(() => window.__workspace.renderNow());
  await page.screenshot({ path: join(OUT, 'captures', '06c-hydraulic-joint-isolated.png'), timeout: 180_000 });
  const during = await snap();
  await page.evaluate(() => window.__workspace.presentJoint(null));
  const after = await snap();
  check('joint presentation isolates boom_cyl_base and the pin is no longer occluded', ok && pinVisible.onScreen && pinVisible.occluded === false, pinVisible);
  check('isolation is presentation only: poses and geometry unchanged, natural view restored', before.poses === during.poses && during.poses === after.poses && before.stats === during.stats, { tris: [before.stats, during.stats] });
  check('no page errors (6)', errors.length === 0, errors.join(' | '));
  await context.close();
}

// 7. Isolated joint + Digital Hand: no highlight rim over the ghosted parent, in both orders
{
  const { page, context, errors } = await open(() => {}, 'fixture');
  const r = await page.evaluate(() => {
    const ws = window.__workspace; const out = {};
    ws.setView({ target: [0.62, 1.0, 0], azimuthDeg: 40, elevationDeg: 14, distance: 2.4 });
    ws.presentJoint('boom_cyl_base'); ws.pointAt('boom_cyl_base', 'inspect', 'user_tool'); ws.renderNow();
    out.presentThenPoint = { ...ws.highlightCoverage(), hand: ws.handView() };
    ws.presentJoint(null); ws.pointAt('boom_cyl_base', 'inspect', 'user_tool'); ws.presentJoint('boom_cyl_base'); ws.renderNow();
    out.pointThenPresent = { ...ws.highlightCoverage(), hand: ws.handView() };
    ws.presentJoint(null); ws.renderNow();
    out.restored = ws.highlightCoverage();
    return out;
  });
  for (const k of ['presentThenPoint', 'pointThenPresent']) {
    const v = r[k];
    check(`${k}: no highlight on ghosted parent, reticle and pin kept`, v.onGhosted === 0 && v.overlays > 0 && v.hand.state === 'inspect' && v.hand.x !== null && v.hand.occluded === false, { overlays: v.overlays, onGhosted: v.onGhosted, occluded: v.hand.occluded });
  }
  check('natural view restores the full highlight', r.restored.onGhosted === 0 && r.restored.overlays > r.presentThenPoint.overlays, r.restored);
  check('no page errors (7)', errors.length === 0, errors.join(' | '));
  await context.close();
}

await browser.close();
await server.close();
const failed = checks.filter((c) => !c.ok);
writeFileSync(join(OUT, 'regressions-report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), apiNote: 'All /api calls mocked in the browser.', checks }, null, 2));
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
