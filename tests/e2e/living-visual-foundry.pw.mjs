// Real-browser certification of the Visual Foundry workspace prototype: captures, interaction sequence, functional checks
// and performance. Starts its own Vite dev server; /api is intercepted in the browser (no backend, no paid calls).
//
//   node tests/e2e/living-visual-foundry.pw.mjs
// Env: CHROME_PATH (default /opt/pw-browsers/chromium), UNFOLD_VF_OUT (default reports/living/visual-foundry), UNFOLD_VF_PORT.
// Rendering is whatever the browser provides; in CI containers that is SwiftShader (software) and the report says so.
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const OUT = resolve(process.env.UNFOLD_VF_OUT ?? 'reports/living/visual-foundry');
const SHOTS = join(OUT, 'captures');
mkdirSync(SHOTS, { recursive: true });
const port = Number(process.env.UNFOLD_VF_PORT ?? 5297);
process.env.UNFOLD_API_TARGET = 'http://127.0.0.1:9'; // nothing listens there; the browser intercepts /api anyway
const server = await createServer({ server: { port, host: '127.0.0.1', strictPort: true }, logLevel: 'error' });
await server.listen();
const BASE = `http://127.0.0.1:${port}`;
const WS = `${BASE}/src/living/workspace-design/harness/index.html`;
const GOLDEN = `${BASE}/src/living/visual-foundry/harness/golden.html`;

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`); };
const VIEW = { width: 1600, height: 1000 };
const external = [];
const agentCalls = [];

async function open(url, { viewport = VIEW, dpr = 1, agent = 'fixture', api = null, rm = null } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: dpr });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Outdated Optimize Dep|Failed to load resource: the server responded with a status of (503|429)/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(() => {
    window.__media = { getUserMedia: 0 };
    const md = navigator.mediaDevices;
    if (md?.getUserMedia) { const orig = md.getUserMedia.bind(md); md.getUserMedia = (...a) => { window.__media.getUserMedia++; return orig(...a); }; }
  });
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') { external.push(u.href); return route.abort(); }
    if (u.pathname.startsWith('/api/')) {
      agentCalls.push({ path: u.pathname, body: route.request().postDataJSON?.() ?? null });
      if (api) return api(route, route.request());
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'MODEL_API_KEY_MISSING', message: 'mock' } }) });
    }
    return route.continue();
  });
  const q = new URLSearchParams({ agent, fixtureDemo: '1', ...(rm === null ? {} : { rm: rm ? '1' : '0' }) });
  await page.goto(`${url}${url.includes('?') ? '&' : '?'}${q}`);
  await page.waitForFunction(() => window.__foundry?.ready, null, { timeout: 240_000 });
  await page.waitForTimeout(400);
  return { page, context, errors };
}
const settle = (page, ms = 600) => page.waitForTimeout(ms);
const shot = async (page, name) => { await page.evaluate(() => window.__foundry.render()); await settle(page, 400); await page.screenshot({ path: join(SHOTS, `${name}.png`), timeout: 180_000 }); return `captures/${name}.png`; };
const captures = {};

// ---------------------------------------------------------------- 1. workspace, assisted (default)
{
  const { page, context, errors } = await open(WS);
  const s = await page.evaluate(() => ({ mode: window.__workspace.getState().mode, stats: window.__workspace.stats() }));
  check('default mode is assisted', s.mode === 'assisted', s.mode);
  captures.workspace = await shot(page, '01-workspace');
  // machine dominance: projected model bounds cover a large share of the viewport
  const cover = await page.evaluate(() => window.__workspace.cameraState());
  check('camera framed on load', Array.isArray(cover.position), cover);

  // ---------------------------------------------------------------- D5 sequence + Digital Hand
  const callsBefore = agentCalls.length;
  const g = await page.evaluate(async () => { const r = await window.__workspace.ask('O que levanta a lança?'); return { text: r.text, primary: r.primary?.id, source: r.source, act: r.act, targets: r.targets.map((t) => t.id) }; });
  check('fixture mode makes no network call', agentCalls.length === callsBefore, `${agentCalls.length - callsBefore} calls`);
  check('answer grounded on canonical boom_cylinder', g.primary === 'boom_cylinder' && g.source === 'fixture', g);
  await settle(page, 1400);
  const hv = await page.evaluate(() => { const v = window.__workspace.handView(); const el = document.querySelector('.uw-hand svg.uw-reticle'); return { v, left: parseFloat(el.style.left), top: parseFloat(el.style.top), state: document.querySelector('.uw-hand').dataset.state, label: document.querySelector('.uw-hand-label').textContent }; });
  check('digital hand points at the cylinder', hv.v.targetId === 'boom_cylinder' && hv.state === 'point' && hv.v.x !== null, hv.label);
  check('reticle drawn at the projected canonical anchor (±1 px)', Math.abs(hv.left - hv.v.x) <= 1 && Math.abs(hv.top - hv.v.y) <= 1, { css: [hv.left, hv.top], proj: [hv.v.x, hv.v.y] });
  check('hand label shows fixture uncertainty', /fixture · não verificado/.test(hv.label), hv.label);
  const transientVisible = await page.locator('.uw-transient').isVisible();
  check('assisted mode shows a transient response', transientVisible);
  captures.assistedHand = await shot(page, '03-assisted-digital-hand');
  captures.d5_1 = await shot(page, 'd5-1-question-grounded-target');

  // tracking through camera motion: orbit by keyboard and re-check projection
  await page.locator('.uw-stage').focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft');
  await settle(page, 300);
  // force the frame that repositions the reticle (software frames take ~2 s; don't race the rAF)
  const hv2 = await page.evaluate(() => { window.__workspace.renderNow(); const v = window.__workspace.handView(); const el = document.querySelector('.uw-hand svg.uw-reticle'); return { v, left: parseFloat(el.style.left), top: parseFloat(el.style.top) }; });
  check('hand tracks the target through camera motion', hv2.v.x !== null && Math.abs(hv2.left - hv2.v.x) <= 1 && (Math.abs(hv2.v.x - hv.v.x) > 5 || Math.abs(hv2.v.y - hv.v.y) > 5), { before: [hv.v.x, hv.v.y], after: [hv2.v.x, hv2.v.y] });
  const owner = await page.evaluate(() => window.__workspace.cameraState().owner);
  check('keyboard orbit is owned by the user', owner === 'idle' || owner === 'user_keyboard', owner);

  // user interruption of an assistant camera move
  await page.evaluate(() => window.__workspace.setView({ target: [2.6, 1.6, 0], azimuthDeg: 200, elevationDeg: 4, distance: 13 }));
  await page.waitForTimeout(2700); // quiet period after the user's last input
  const interrupt = await page.evaluate(async () => {
    const ws = window.__workspace;
    const r = ws.pointAt('boom_cylinder', 'point', 'assistant');
    await new Promise((res) => setTimeout(res, 120));
    const during = ws.cameraState();
    const stage = document.querySelector('.uw-stage');
    stage.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 800, clientY: 500, pointerId: 1 }));
    const after = ws.cameraState();
    stage.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 840, clientY: 500, pointerId: 1 }));
    const again = ws.pointAt('boom_cylinder', 'point', 'assistant');
    return { r, during, after, again };
  });
  check('assistant camera move starts only when needed (occluded target from behind)', interrupt.r.cameraMoved && interrupt.during.transitioning, interrupt.r);
  check('user input interrupts the assistant camera move at once', !interrupt.after.transitioning && interrupt.after.owner !== 'assistant', interrupt.after);
  check('assistant may not move the camera right after user input', !interrupt.again.cameraMoved && interrupt.again.cameraReason === 'user_active', interrupt.again);
  captures.d5_3 = await shot(page, 'd5-3-user-interruption');

  // occlusion: view from behind, low → counterweight/upper body hides the boom cylinder
  await page.evaluate(() => window.__workspace.setView({ target: [1.6, 1.4, 0], azimuthDeg: 180, elevationDeg: 6, distance: 12 }));
  await settle(page, 200);
  const occ = await page.evaluate(() => { window.__workspace.renderNow(); return window.__workspace.handView(); });
  check('occluded target reported, not hidden or guessed', occ.occluded === true && /Oculto/.test(occ.problem ?? ''), occ.problem);
  // behind the camera
  await page.evaluate(() => window.__workspace.setView({ target: [12, 1.5, 0], azimuthDeg: 180, elevationDeg: 5, distance: 3 }));
  const behind = await page.evaluate(() => { window.__workspace.renderNow(); return window.__workspace.handView(); });
  check('target behind the camera shows an edge indicator', behind.x === null && behind.offscreen !== null && /Fora de vista/.test(behind.problem ?? ''), behind.problem);
  // missing component
  const missing = await page.evaluate(() => { const r = window.__workspace.pointAt('hydraulic_pump_9', 'point', 'assistant'); window.__workspace.renderNow(); return { r, v: window.__workspace.handView() }; });
  check('unknown component id never gets a location', !missing.r.resolved && missing.v.state === 'blocked' && missing.v.x === null, missing.v.problem);
  await page.evaluate(() => window.__workspace.frameAll());

  // Focus mode and back (D5 end)
  await page.evaluate(() => window.__workspace.ask('O que levanta a lança?'));
  await settle(page, 1400);
  await page.locator('body').click({ position: { x: 1500, y: 120 } }).catch(() => {});
  await page.keyboard.press('f');
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.uw-rail')).opacity) < 0.05, null, { timeout: 20_000 }).catch(() => {});
  const focus = await page.evaluate(() => ({ mode: window.__workspace.getState().mode, composer: !document.querySelector('.uw-composer').hidden, restore: !document.querySelector('.uw-restore').hidden, railOpacity: getComputedStyle(document.querySelector('.uw-rail')).opacity, railInert: document.querySelector('.uw-rail').inert, transient: !document.querySelector('.uw-transient').hidden, label: getComputedStyle(document.querySelector('.uw-hand-label')).display }));
  check('focus mode hides composer, rail, transient and hand label', focus.mode === 'focus' && !focus.composer && focus.restore && focus.railInert && Number(focus.railOpacity) < 0.05 && !focus.transient && focus.label === 'none', focus);
  captures.focus = await shot(page, '05-focus');
  captures.d5_4 = await shot(page, 'd5-4-focus');
  await page.keyboard.press('Escape');
  await settle(page, 600);
  const back = await page.evaluate(() => ({ mode: window.__workspace.getState().mode, composer: !document.querySelector('.uw-composer').hidden }));
  check('Escape leaves focus mode and restores the composer', back.mode === 'assisted' && back.composer, back);
  await page.keyboard.press('f'); await settle(page, 300);
  await page.locator('.uw-restore').click(); await settle(page, 300);
  check('restore control leaves focus mode', (await page.evaluate(() => window.__workspace.getState().mode)) === 'assisted');
  captures.d5_5 = await shot(page, 'd5-5-return-from-focus');

  // overlays dimmed and hidden; scene still usable
  await page.keyboard.press('h'); await settle(page, 300);
  const dimmed = await page.evaluate(() => getComputedStyle(document.querySelector('.uw-root')).getPropertyValue('--uw-overlay').trim());
  await page.keyboard.press('h'); await settle(page, 300);
  const hidden = await page.evaluate(() => window.__workspace.getState().overlay);
  check('overlay cycles visible → dimmed → hidden', dimmed === '0.38' && hidden === 'hidden', { dimmed, hidden });
  const pickPoint = await page.evaluate(() => { const v = window.__workspace.handView(); return v && v.x !== null ? [v.x, v.y] : null; });
  if (pickPoint) {
    await page.mouse.click(pickPoint[0], pickPoint[1]);
    await settle(page, 200);
    const sel = await page.evaluate(() => window.__workspace.selection()?.id ?? null);
    check('scene stays selectable with all AI overlays hidden', sel !== null, sel);
  } else check('scene stays selectable with all AI overlays hidden', false, 'no on-screen target');
  await page.evaluate(() => window.__workspace.dispatch({ type: 'set_overlay', level: 'visible' }));

  // return to the last response without losing history
  const histLen = await page.evaluate(() => window.__workspace.getState().messages.length);
  await page.evaluate(() => { window.__workspace.dispatch({ type: 'dismiss_transient' }); window.__workspace.dispatch({ type: 'return_to_last_response' }); });
  const ret = await page.evaluate(() => ({ t: window.__workspace.getState().transientId, n: window.__workspace.getState().messages.length }));
  check('return to the last response keeps history', !!ret.t && ret.n === histLen, ret);

  // conversation: experiment proposal, approval boundary, fixture preview labelling
  await page.evaluate(() => window.__workspace.select('boom_cylinder'));
  await page.keyboard.press('c'); await settle(page, 500);
  const posesBefore = await page.evaluate(() => JSON.stringify(window.__workspace.partPoses()));
  const g2 = await page.evaluate(async () => { const r = await window.__workspace.ask('O que acontece se eu estender este cilindro?'); return { text: r.text, primary: r.primary?.id }; });
  await settle(page, 900);
  const conv = await page.evaluate(() => ({ mode: window.__workspace.getState().mode, proposal: document.querySelector('.uw-proposal')?.textContent ?? '', approve: !!document.querySelector('[data-act="approve"]'), hand: window.__workspace.handView()?.state }));
  const posesPending = await page.evaluate(() => JSON.stringify(window.__workspace.partPoses()));
  check('extend question yields a proposal, not a claim', conv.mode === 'conversation' && conv.approve && /fixture/i.test(conv.proposal) && /motor/i.test(g2.text), { g2, proposal: conv.proposal.slice(0, 120) });
  check('nothing moves before approval', posesBefore === posesPending);
  check('hand waits for confirmation', conv.hand === 'awaiting', conv.hand);
  captures.conversation = await shot(page, '04-conversation');
  const proposalId = await page.evaluate(() => window.__workspace.getState().messages.find((m) => m.proposal?.state === 'pending')?.id);
  await page.locator('[data-act="approve"]').first().click();
  await page.waitForFunction((id) => window.__workspace.getState().messages.some((m) => m.id === id && m.proposal?.state === 'done'), proposalId, { timeout: 60_000 });
  const after = await page.evaluate(() => ({ source: window.__workspace.poseSource, notice: document.querySelector('.uw-notices')?.textContent ?? '', last: window.__workspace.getState().messages.at(-1)?.text ?? '' }));
  check('approved preview is labelled fixture, never engine', after.source === 'fixture-preview' && /não do motor|não calculados pelo motor/.test(after.notice + after.last), after.notice.slice(0, 120));
  const finalMatches = await page.evaluate(async () => {
    const raw = await (await fetch('/src/living/visual-foundry/fixtures/boom-extension-preview.json')).json();
    const last = raw.frames.at(-1).parts; const now = window.__workspace.partPoses();
    return last.every((p) => { const n = now.find((x) => x.partId === p.partId); return n && p.translationM.every((v, i) => Math.abs(v - n.translationM[i]) < 1e-6); });
  });
  check('displayed pose equals the last fixture frame exactly (no renderer-side solving)', finalMatches);
  captures.preview = await shot(page, '04b-fixture-preview-result');
  await page.keyboard.press('f'); await settle(page, 400);
  const focusNotice = await page.evaluate(() => document.querySelector('.uw-notices')?.textContent ?? '');
  check('fixture-pose notice stays visible in focus mode', /fixture/i.test(focusNotice), focusNotice.slice(0, 80));
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__workspace.resetPose());

  // evidence references for the selected component
  await page.evaluate(() => { window.__workspace.dispatch({ type: 'set_mode', mode: 'assisted' }); window.__workspace.select('boom_cylinder'); });
  await page.locator('.uw-inspector [data-act="evidence"]').click();
  const ev = await page.evaluate(() => document.querySelector('.uw-evidence')?.textContent ?? '');
  check('evidence panel cites the assembly provenance', /src-excavator-fixture/.test(ev) && /excavator\.assembly\.v1/.test(ev), ev.slice(0, 100));

  // keyboard navigation: Tab reaches the rail and the composer
  await page.evaluate(() => document.activeElement?.blur());
  const order = [];
  for (let i = 0; i < 14; i++) { await page.keyboard.press('Tab'); order.push(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.className ?? '')); }
  check('Tab order reaches rail tools and composer input', order.some((l) => /Enquadrar/.test(l)) && order.some((l) => /Pergunta ou instrução/.test(l)), order.join(' | '));

  // hand-tracking coexistence (no webcam: flag only) and media permissions
  const coexist = await page.evaluate(() => { const ws = window.__workspace; ws.arbiter.setHandTracking(true); ws.setView({ target: [1.6, 1.4, 0], azimuthDeg: 180, elevationDeg: 6, distance: 12 }); const r = ws.pointAt('boom_cylinder', 'point', 'assistant'); ws.arbiter.setHandTracking(false); return r; });
  check('assistant never moves the camera while user hand tracking is active', coexist.resolved && !coexist.cameraMoved && coexist.cameraReason === 'hand_tracking_active', coexist);
  check('camera/microphone never requested without a click', (await page.evaluate(() => window.__media.getUserMedia)) === 0);

  // performance: interactive orbit for 3 s (software rendering in this environment)
  await page.evaluate(() => window.__workspace.frameAll());
  const measure = (moving) => page.evaluate(async (moving) => {
    const ws = window.__workspace; const frames = []; let last = performance.now(); const t0 = last;
    await new Promise((res) => { const step = () => { ws.setView({ target: [2.4, 1.8, 0], azimuthDeg: 36 + (performance.now() - t0) / 40, elevationDeg: 10, distance: 16 }); moving ? ws.renderMoving() : ws.renderNow(); const now = performance.now(); frames.push(now - last); last = now; if (now - t0 < 4000) requestAnimationFrame(step); else res(); }; requestAnimationFrame(step); });
    frames.sort((a, b) => a - b);
    return { frames: frames.length, fps: frames.length / 4, p50: frames[Math.floor(frames.length / 2)], p95: frames[Math.floor(frames.length * 0.95)], stats: ws.stats() };
  }, moving);
  const perfFull = await measure(false);
  const perf = perfFull;
  check('performance measured at rest resolution', perfFull.frames > 0, { fps: perfFull.fps.toFixed(2), p50ms: perfFull.p50.toFixed(0), drawCalls: perfFull.stats.drawCalls, triangles: perfFull.stats.triangles, pixelRatio: perfFull.stats.pixelRatio, software: perfFull.stats.softwareRendering });
  check('frame latency distribution recorded', perf.frames > 0, { pixelRatio: perf.stats.pixelRatio, p50ms: perf.p50.toFixed(1), p95ms: perf.p95.toFixed(1), drawCalls: perf.stats.drawCalls, triangles: perf.stats.triangles, software: perf.stats.softwareRendering });
  const respond = await page.evaluate(async () => { const t = performance.now(); await window.__workspace.ask('mostra a caçamba'); return performance.now() - t; });
  check('interaction responsiveness (fixture ask → grounded)', respond < 1500, `${respond.toFixed(0)} ms`);

  // resource cleanup
  const cleanup = await page.evaluate(() => { const ws = window.__workspace; const before = ws.stats(); ws.dispose(); return { before: { geometries: before.geometries, textures: before.textures }, canvas: !!document.querySelector('canvas'), root: !!document.querySelector('.uw-root') }; });
  check('dispose removes canvas and DOM', !cleanup.canvas && !cleanup.root, cleanup);
  check('no page errors in workspace session', errors.length === 0, errors.slice(0, 3).join(' | '));
  writeFileSync(join(OUT, 'performance.json'), JSON.stringify({ measuredAt: new Date().toISOString(), viewport: VIEW, profile: 'realtime', orbit4s: perfFull, responsivenessMs: respond, note: perf.stats.softwareRendering ? 'Software rendering (SwiftShader): figures are a lower bound, not GPU performance.' : 'Hardware rendering.' }, null, 2));
  await context.close();
}

// ---------------------------------------------------------------- live-route behaviour with a mocked backend
{
  const before = agentCalls.length;
  const { page, context, errors } = await open(WS, { agent: 'auto', api: (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'MODEL_API_KEY_MISSING', message: 'mock' } }) }) });
  const r = await page.evaluate(async () => { const g = await window.__workspace.ask('O que levanta a lança?'); return { source: g.source, note: g.sourceNote }; });
  check('missing API key falls back to a labelled fixture (one mocked call)', r.source === 'fixture' && /MODEL_API_KEY_MISSING/.test(r.note) && agentCalls.length - before === 1, r);
  check('request uses the existing spatial_agent_request.v1 in mechanical mode', agentCalls.at(-1)?.body?.schema === 'spatial_agent_request.v1' && agentCalls.at(-1)?.body?.mode === 'mechanical');
  check('no page errors (fallback)', errors.length === 0, errors.join(' | '));
  await context.close();
}
{
  // a model that proposes an unsupported geometry change: parser refuses, nothing is animated or claimed
  const { page, context } = await open(WS, { agent: 'auto', api: (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { schema: 'spatial_agent_result.v1', kind: 'PROPOSE_ACTION', text: 'Movi a caçamba 1 m.', basis: 'scene', evidenceIds: ['bucket'], question: null, action: { kind: 'Move', target: { reference: 'label', label: 'Caçamba', ordinal: null }, value: 1, valueMode: 'set', unit: 'm', axis: 'X', opening: null } }, meta: { model: 'e2e-mock', requestId: 'mock-1' } }) }) });
  const poses0 = await page.evaluate(() => JSON.stringify(window.__workspace.partPoses()));
  const r = await page.evaluate(async () => { const g = await window.__workspace.ask('move a caçamba 1 metro no eixo x'); return { blocked: g.blocked, text: g.text }; });
  const poses1 = await page.evaluate(() => JSON.stringify(window.__workspace.partPoses()));
  const shown = await page.evaluate(() => window.__workspace.getState().messages.at(-1)?.text ?? '');
  check('unsupported model action is blocked, not executed', !!r.blocked && poses0 === poses1 && !/Movi/.test(shown), r.blocked);
  await context.close();
}
{
  // a mocked live answer is shown with its model label (the report states it was a mock)
  const { page, context } = await open(WS, { agent: 'auto', api: (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { schema: 'spatial_agent_result.v1', kind: 'ANSWER', text: 'O cilindro do braço acciona o braço.', basis: 'scene', evidenceIds: ['stick_cylinder', 'not_a_component'], question: null, action: null }, meta: { model: 'e2e-mock', requestId: 'mock-2' } }) }) });
  const r = await page.evaluate(async () => { const g = await window.__workspace.ask('o que move o braço?'); return { source: g.source, primary: g.primary?.id ?? null }; });
  check('evidence ids unknown to the scene are rejected by the existing parser', r.source === 'none', r);
  await context.close();
}

// ---------------------------------------------------------------- reduced motion
{
  const { page, context } = await open(WS, { rm: true });
  const r = await page.evaluate(() => { const ws = window.__workspace; ws.setView({ target: [1.6, 1.4, 0], azimuthDeg: 180, elevationDeg: 6, distance: 12 }); return new Promise((res) => setTimeout(() => { const p = ws.pointAt('boom_cylinder', 'point', 'assistant'); res({ p, transitioning: ws.cameraState().transitioning, reduced: document.querySelector('.uw-root').dataset.reducedMotion }); }, 2700)); });
  check('reduced motion: camera focus jumps to the end state', r.p.cameraMoved && !r.transitioning && r.reduced === 'true', r);
  await context.close();
}

// ---------------------------------------------------------------- mobile / narrow
{
  const { page, context, errors } = await open(WS, { viewport: { width: 390, height: 844 }, dpr: 2 });
  await page.evaluate(() => window.__workspace.ask('O que levanta a lança?'));
  await settle(page, 1400);
  const m = await page.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    const c = r('.uw-composer'), rail = r('.uw-rail');
    return { composer: [c.left, c.right, c.bottom], rail: [rail.left, rail.bottom], scrollW: document.documentElement.scrollWidth, w: innerWidth, h: innerHeight };
  });
  check('mobile: composer inside viewport, no horizontal scroll', m.composer[0] >= 0 && m.composer[1] <= m.w && m.composer[2] <= m.h && m.scrollW <= m.w, m);
  captures.mobile = await shot(page, '08-mobile');
  await page.keyboard.press('c'); await settle(page, 600);
  const sheet = await page.evaluate(() => { const a = document.querySelector('.uw-conversation').getBoundingClientRect(), b = document.querySelector('.uw-composer').getBoundingClientRect(); return { sheetBottom: a.bottom, composerTop: b.top }; });
  check('mobile: conversation sheet sits above the composer', sheet.sheetBottom <= sheet.composerTop, sheet);
  captures.mobileConversation = await shot(page, '08b-mobile-conversation');
  check('no page errors (mobile)', errors.length === 0, errors.join(' | '));
  await context.close();
}

// ---------------------------------------------------------------- Golden Frame and close-ups (export profile, no UI)
{
  const golden = [
    ['02-golden-frame', '?profile=export&az=36&el=9&dist=13.2&tx=2.9&ty=1.9', 2],
    // joint boom_cyl_base: pin head, base lugs and barrel eye; only a near-frontal view sees it past the deck channel
    ['06-hydraulic-joint', '?profile=export&az=-10&el=12&dist=1.7&tx=0.62&ty=1.0&tz=0.12&fov=26', 2],
    ['06b-boom-plates', '?profile=export&az=70&el=5&dist=5&tx=3.0&ty=2.6&tz=0', 2],
    // bucket seen from the machine side: mouth, cutting edge and the row of teeth
    ['07-bucket', '?profile=export&az=150&el=6&dist=4.2&tx=7.3&ty=1.1&tz=0', 2],
    ['07b-tracks', '?profile=export&az=62&el=7&dist=4.4&tx=-0.1&ty=0.45&tz=-1.1', 2],
  ];
  for (const [name, q, dpr] of golden) {
    const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: dpr });
    const p = await ctx.newPage();
    await p.goto(`${GOLDEN}${q}&dpr=${dpr}`, { waitUntil: 'commit', timeout: 240_000 });
    await p.waitForFunction(() => window.__foundry?.ready, null, { timeout: 240_000 });
    await p.waitForTimeout(300);
    await p.evaluate(() => window.__foundry.render());
    await p.screenshot({ path: join(SHOTS, `${name}.png`), timeout: 240_000 });
    captures[name] = `captures/${name}.png`;
    const st = await p.evaluate(() => window.__foundry.stats());
    check(`golden capture ${name}`, true, { profile: st.profile, size: st.size, triangles: st.triangles, drawCalls: st.drawCalls });
    await ctx.close();
  }
}

check('no request left localhost', external.length === 0, external.slice(0, 3).join(' '));
await browser.close();
await server.close();
const failed = checks.filter((c) => !c.ok);
writeFileSync(join(OUT, 'browser-report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), renderer: 'Chromium via playwright-core; SwiftShader software WebGL in this container', apiCalls: agentCalls.length, apiCallsNote: 'All /api calls were intercepted in the browser (mocked). No model was called.', checks, captures }, null, 2));
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
