import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createMetaServer } from '../../server/meta-server';
import { EXCAVATOR_ASSEMBLY_V1 } from '../../src/living/contracts/fixtures/excavator.assembly.v1';
import { createOfflineImageObservation } from '../../src/living/reconstruction/observation';

/**
 * Unified /living: source -> reconstruction -> review -> server confirmations -> transition -> the real workspace.
 * Real backend handler (live mode) with a provider double that counts calls: no paid call is possible.
 * Run: npx tsx tests/e2e/unified-living.pw.ts   (env: CHROME_PATH, UNFOLD_UNIFIED_OUT, UNFOLD_UNIFIED_PORT)
 */
const out = resolve(process.env.UNFOLD_UNIFIED_OUT ?? 'reports/unified-workspace/captures');
mkdirSync(out, { recursive: true });
const port = Number(process.env.UNFOLD_UNIFIED_PORT ?? 5330);
const ALLOWED_ORIGIN = 'http://127.0.0.1:5173';
const log: string[] = [];
const pass = (message: string) => { log.push(message); console.log(`PASS ${message}`); };

const providerCalls: unknown[] = [];
let hold: Promise<void> | null = null;
const provider = async (_url: unknown, init?: RequestInit) => {
  providerCalls.push(JSON.parse(String(init?.body)));
  if (hold) await hold;
  return new Response(JSON.stringify({ id: 'req-e2e-1', status: 'completed', output_text: JSON.stringify(createOfflineImageObservation('image', 'e2e-source', 'a'.repeat(64))), usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }), { status: 200, headers: { 'content-type': 'application/json' } });
};
/** A fresh backend per scenario: the server's per-minute limit (10 reconstruction calls) is shared by proposals and reviews. */
let backend = createMetaServer({ apiKey: 'fixture-key-not-real', fetchImpl: provider as unknown as typeof fetch });
await new Promise<void>((resolveListen) => backend.listen(0, '127.0.0.1', resolveListen));
let backendPort = (backend.address() as { port: number }).port;
async function restartBackend() {
  await new Promise<void>((r, j) => backend.close((e) => e ? j(e) : r()));
  backend = createMetaServer({ apiKey: 'fixture-key-not-real', fetchImpl: provider as unknown as typeof fetch });
  await new Promise<void>((r) => backend.listen(0, '127.0.0.1', r));
  backendPort = (backend.address() as { port: number }).port;
}
const api: Array<{ body: any; status: number }> = [];
const forcedResponses: Array<{ review: boolean; status: number; body: unknown }> = [];
/** Applied to the next real review response, to build a structurally valid assembly the engine cannot pose. */
const reviewMutators: Array<(body: any) => void> = [];

process.env.UNFOLD_API_TARGET = 'http://127.0.0.1:9';
const vite = await createServer({ server: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'error' });
await vite.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const errors: string[] = [];

async function open(viewport = { width: 1440, height: 900 }, query = 'debug-living=1&rm=1&agent=fixture', using: Browser = browser): Promise<Page> {
  const page = await using.newPage({ viewport });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/living/reconstruction', async (route) => {
    const request = route.request();
    const forced = forcedResponses.shift();
    if (forced && (request.postDataJSON()?.action === 'review') === forced.review) { api.push({ body: JSON.parse(request.postData() ?? '{}'), status: forced.status }); await route.fulfill({ status: forced.status, contentType: 'application/json', body: JSON.stringify(forced.body) }); return; }
    const response = await fetch(`http://127.0.0.1:${backendPort}/api/living/reconstruction`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ALLOWED_ORIGIN }, body: request.postData() ?? '' });
    let text = await response.text();
    if (request.postDataJSON()?.action === 'review' && response.status === 200 && reviewMutators.length) { const body = JSON.parse(text); reviewMutators.shift()!(body); text = JSON.stringify(body); }
    api.push({ body: JSON.parse(request.postData() ?? '{}'), status: response.status });
    await route.fulfill({ status: response.status, contentType: 'application/json', body: text });
  });
  await page.goto(`http://127.0.0.1:${port}/living?${query}`);
  await page.waitForFunction(() => (window as any).__experience?.ready, null, { timeout: 120000 });
  return page;
}

const overlap = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
async function geometry(page: Page, label: string, selectors: string[]) {
  const result = await page.evaluate((sel) => ({
    scrollW: document.documentElement.scrollWidth, innerW: innerWidth,
    boxes: Object.fromEntries(sel.map((q) => {
      const el = document.querySelector(q); const r = el && (el as HTMLElement).offsetParent !== null || el?.getClientRects().length ? el!.getBoundingClientRect() : null;
      if (!r) return [q, null];
      // what the person sees: content that scrolls inside the review panel is cut at the panel's edge
      const clip = el!.closest('.ux-main') ? document.querySelector('.ux-main')!.getBoundingClientRect() : null;
      const x0 = clip ? Math.max(r.x, clip.x) : r.x, y0 = clip ? Math.max(r.y, clip.y) : r.y, x1 = clip ? Math.min(r.right, clip.right) : r.right, y1 = clip ? Math.min(r.bottom, clip.bottom) : r.bottom;
      return [q, x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null];
    })),
  }), selectors);
  assert.ok(result.scrollW <= result.innerW, `${label}: no horizontal scroll (${result.scrollW} > ${result.innerW})`);
  const named = selectors.filter((q) => result.boxes[q]);
  for (let i = 0; i < named.length; i++) for (let j = i + 1; j < named.length; j++) if (overlap(result.boxes[named[i]!]!, result.boxes[named[j]!]!)) assert.fail(`${label}: ${named[i]} overlaps ${named[j]}`);
  return result;
}

async function journey(viewport: { width: number; height: number }, label: string) {
  const page = await open(viewport);
  await page.screenshot({ path: join(out, `${label}-01-empty.png`) });
  await geometry(page, `${label} empty`, ['.uw-brand', '.uw-rail', '.uw-composer', '#ux-intake']);
  await page.locator('[data-kind="text"]').click();
  await page.locator('#ux-text').fill('Escavadora de rastos de 20 t com lança, braço e caçamba.');
  await page.locator('#ux-use-text').click();
  await page.locator('[data-flow="submit"]').click();
  await page.waitForFunction(() => (window as any).__experience.phase() === 'review', null, { timeout: 60000 });
  await page.screenshot({ path: join(out, `${label}-02-review.png`) });
  await geometry(page, `${label} review`, ['.uw-brand', '.uw-rail', '.uw-composer', '.ux-sheet']);
  assert.equal(await page.locator('#ux-demo').count(), 0, 'no demonstration banner with the live port');
  assert.equal(await page.evaluate(() => (window as any).__experience.readiness().status), 'review_pending', 'hypotheses pending, not insufficient');
  assert.equal(await page.locator('#ux-enter').isDisabled(), true);
  const total = await page.evaluate(() => (window as any).__experience.review().items.length);
  await page.locator('.ux-card').focus().catch(() => {});
  for (let i = 0; i < total; i++) { await page.keyboard.press('c'); await page.keyboard.press('ArrowRight'); }
  assert.equal(await page.evaluate(() => (window as any).__experience.readiness().status), 'ready_for_engine');
  assert.equal((await page.locator('#ux-enter').textContent())?.trim(), 'Continuar');
  await page.screenshot({ path: join(out, `${label}-03-entities-decided.png`) });
  await page.locator('#ux-enter').click();
  await page.locator('#gw-reviewer').waitFor();
  assert.equal(await page.locator('#ux-enter').isDisabled(), true, 'nothing is pre-filled: the server step starts blocked');
  assert.equal(await page.locator('#gw-family').isChecked(), false); assert.equal(await page.locator('#gw-bucket').isChecked(), false);
  assert.equal(await page.inputValue('#gw-reviewer'), ''); assert.equal(await page.inputValue('#gw-width'), '');
  await page.screenshot({ path: join(out, `${label}-04-server-step.png`) });
  await geometry(page, `${label} server step`, ['.uw-brand', '.uw-rail', '.uw-composer', '.ux-gw-card']);
  await page.fill('#gw-reviewer', 'revisor-e2e'); await page.check('#gw-family'); await page.check('#gw-bucket');
  await page.fill('#gw-width', '1.4'); await page.fill('#gw-basis', 'valor fictício do E2E');
  assert.equal(await page.locator('#ux-enter').isDisabled(), true, 'extras still undecided');
  await page.locator('[data-gw="extra-all"][data-decision="reject"]').click();
  assert.equal(await page.locator('#ux-enter').isDisabled(), false);
  await page.screenshot({ path: join(out, `${label}-05-server-step-ready.png`) });
  return page;
}


/** Same path as the journey, quicker: decisions through the page API, then the real server fields and clicks. */
async function toServerStep(page: Page, width = '1.4') {
  await page.locator('[data-kind="text"]').click();
  await page.locator('#ux-text').fill('Escavadora de rastos de 20 t com lança, braço e caçamba.');
  await page.locator('#ux-use-text').click();
  await page.locator('[data-flow="submit"]').click();
  await page.waitForFunction(() => (window as any).__experience.phase() === 'review', null, { timeout: 60000 });
  await page.evaluate(() => { const x = (window as any).__experience; for (const i of x.review().items) x.dispatch({ type: 'decide', id: i.id, decision: 'confirmed' }); });
  await page.locator('#ux-enter').click();
  await page.fill('#gw-reviewer', 'revisor-e2e'); await page.check('#gw-family'); await page.check('#gw-bucket');
  await page.fill('#gw-width', width); await page.fill('#gw-basis', 'valor fictício do E2E');
  await page.locator('[data-gw="extra-all"][data-decision="reject"]').click();
}
const phase = (page: Page) => page.evaluate(() => (window as any).__experience.phase());
/** The stage is empty: one workspace, one canvas, and no machine shown, picked, selected or asked about. */
const stageEmpty = (page: Page) => page.evaluate(() => { const ws = (window as any).__workspace; return { empty: ws.isEmpty, visible: ws.model.root.visible, canvases: document.querySelectorAll('.uw-stage canvas').length, workspaces: document.querySelectorAll('.uw-root').length }; });
const EMPTY_STAGE = { empty: true, visible: false, canvases: 1, workspaces: 1 };

try {
  for (const [viewport, label] of [[{ width: 1440, height: 900 }, '1440'], [{ width: 768, height: 1024 }, '768'], [{ width: 390, height: 844 }, '390']] as const) {
    await restartBackend(); providerCalls.length = 0; api.length = 0;
    const page = await journey(viewport, label);
    await page.locator('#ux-enter').scrollIntoViewIfNeeded();
    await page.locator('#ux-enter').click();
    await page.waitForFunction(() => (window as any).__experience.phase() === 'lab', null, { timeout: 60000 });
    await page.waitForFunction(() => (window as any).__workspace?.partPoses, null, { timeout: 60000 });
    assert.equal(providerCalls.length, 1, 'one provider call in total'); assert.equal(api.length, 2);
    assert.equal(api[1]!.body.action, 'review'); assert.equal(api[1]!.status, 200);
    await page.waitForTimeout(900);
    await page.screenshot({ path: join(out, `${label}-06-lab.png`) });
    await geometry(page, `${label} lab`, []);
    const rects = await page.evaluate(() => Object.fromEntries(['.uw-brand', '.uw-notices', '.uw-rail', '.uw-composer'].map((q) => { const el = document.querySelector(q); const r = el?.getBoundingClientRect(); const shown = el && getComputedStyle(el).visibility !== 'hidden'; return [q, shown && r && r.width ? { x: r.x, y: r.y, width: r.width, height: r.height } : null]; })));
    const names = Object.keys(rects) as Array<keyof typeof rects>;
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) { const A = rects[names[i]!], B = rects[names[j]!]; if (A && B && overlap(A, B)) assert.fail(`${label} lab: ${String(names[i])} overlaps ${String(names[j])}`); }
    assert.ok(rects['.uw-notices'] && rects['.uw-rail'] && rects['.uw-composer'], `${label}: workspace chrome present`);
    for (const id of ['extra_review', 'extra_restart']) assert.equal(await page.locator(`[data-el="${id}"]`).count(), 1, `${id} tool in the rail`);
    assert.equal(await page.locator('.ux-lab').isVisible(), false, 'the prototype lab overlay is not shown over the real workspace');
    const noticeHeight = await page.evaluate(() => document.querySelector('.uw-notices')!.getBoundingClientRect().height);
    assert.ok(noticeHeight <= 96, `${label}: the provenance notice is compact when collapsed (${noticeHeight}px)`);
    await page.locator('.uw-notice-details summary').click();
    const detail = (await page.locator('.uw-notice-details p').textContent()) ?? '';
    // the Foundry draws the width the person gave; what stays true is that it is theirs, unmeasured, and the rest is synthetic
    for (const phrase of [/malha 3D da caçamba segue a largura que indicou/, /não foi medida nem verificada pela Meta/, /forward-kinematics@/, /não certifica segurança/, /1,40 m, antes 1,10 m/, /resto da geometria é sintético/]) assert.match(detail, phrase);
    assert.doesNotMatch(detail, /ainda não mostra|forma que vê é de demonstração/);
    await page.screenshot({ path: join(out, `${label}-07-lab-notice-expanded.png`) });
    await page.locator('.uw-notice-details summary').click();
    pass(`${label}: live flow reaches the real workspace through both gates, no overflow, no overlap`);
    await page.close();
  }

  // ---- behaviours that must survive inside the integrated lab, and the error paths
  await restartBackend(); providerCalls.length = 0; api.length = 0;
  {
    const page = await open();
    await toServerStep(page);
    await page.locator('#ux-enter').click();
    await page.waitForFunction(() => (window as any).__experience.phase() === 'lab' && (window as any).__workspace?.partPoses, null, { timeout: 60000 });
    // the workspace runs on the approved assembly, with the engine, the inspector and the Digital Hand
    const first = await page.evaluate(() => { const ws = (window as any).__workspace; ws.select('boom_cylinder'); return { id: ws.selection()?.id, assembly: ws.options.assembly.id, same: ws.options.assembly.id === 'excavator-reference' }; });
    assert.equal(first.id, 'boom_cylinder'); assert.ok(first.assembly.startsWith('assembly-proposal-'), 'built from the reconstructed assembly, not the reference one');
    assert.equal(await page.locator('[data-el="engineSlider"]').count(), 1, 'the engine controls are in the inspector');
    const before = await page.evaluate(() => JSON.stringify((window as any).__workspace.partPoses()));
    await page.locator('[data-el="engineTarget"]').fill('0.65'); await page.locator('[data-act="engine-preview"]').click();
    assert.equal(await page.evaluate(() => JSON.stringify((window as any).__workspace.partPoses())), before, 'a proposal never changes the scene');
    await page.locator('[data-act="engine-approve"]').click();
    await page.waitForFunction(() => (window as any).__workspace.engineState().timeS > 0 || (window as any).__workspace.poseSource === 'engine', null, { timeout: 30000 });
    await page.evaluate(() => { const ws = (window as any).__workspace; ws.renderNow(); });
    assert.notEqual(await page.evaluate(() => JSON.stringify((window as any).__workspace.partPoses())), before, 'the engine moved the reconstructed machine');
    assert.equal(await page.evaluate(() => (window as any).__workspace.handView()?.targetId), 'boom_cylinder', 'Digital Hand follows the selected part');
    await page.evaluate(async () => { const ws = (window as any).__workspace; ws.select('boom_cylinder'); await ws.ask('O que acontece se este cilindro se estender?'); });
    assert.deepEqual(await page.evaluate(() => (window as any).__workspace.getState().messages.at(-1)?.proposal?.kind), 'engine_move');
    pass('inside the lab: reconstructed assembly, engine move, Digital Hand and conversation work');

    // back to the review from the rail: the SAME workspace and canvas stay, the machine leaves the stage, decisions and fields are kept
    const stageBefore = await page.evaluate(() => { const ws = (window as any).__workspace; Object.assign(window as any, { __oldWs: ws, __canvas: document.querySelector('.uw-stage canvas'), __engine: ws.engineering, __registry: ws.registry }); return { canvases: document.querySelectorAll('.uw-stage canvas').length, empty: ws.isEmpty }; });
    assert.deepEqual(stageBefore, { canvases: 1, empty: false });
    await page.locator('[data-el="extra_review"]').click();
    await page.waitForFunction(() => (window as any).__experience.phase() === 'review', null, { timeout: 30000 });
    assert.deepEqual(await stageEmpty(page), EMPTY_STAGE, 'the machine left the stage; the workspace did not');
    assert.equal(await page.evaluate(() => (window as any).__workspace === (window as any).__oldWs && document.querySelector('.uw-stage canvas') === (window as any).__canvas), true, 'same workspace, same canvas');
    assert.equal(await page.evaluate(() => (window as any).__engine.disposed), true, 'the old engine session was closed');
    assert.equal(await page.evaluate(() => (window as any).__oldWs.engineRaf), 0, 'no engine loop left running');
    assert.equal(await page.evaluate(() => (window as any).__experience.summary().confirmed), 14, 'review decisions are intact');
    assert.equal(await page.evaluate(() => (window as any).__unified.gateway.human().bucketWidthM), 1.4, 'server fields are intact');
    pass('back to the review: same workspace and canvas, machine replaced by the empty stage, decisions and fields kept');

    // change the width and open the lab again: the machine is rebuilt on the same stage from the new assembly
    await page.locator('#ux-enter').click();
    await page.fill('#gw-width', '1.8');
    await page.locator('#ux-enter').click();
    await page.waitForFunction(() => (window as any).__experience.phase() === 'lab' && !(window as any).__workspace.isEmpty, null, { timeout: 60000 });
    assert.equal(await page.evaluate(() => (window as any).__workspace === (window as any).__oldWs && document.querySelector('.uw-stage canvas') === (window as any).__canvas), true, 'still the same workspace and canvas');
    assert.equal(await page.evaluate(() => { const ws = (window as any).__workspace; return ws.engineering !== (window as any).__engine && ws.registry !== (window as any).__registry; }), true, 'a new engine session and component registry');
    assert.equal(await page.evaluate(() => (window as any).__workspace.selection()), null, 'no selection carried over from the old assembly');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.uw-stage canvas').length), 1, 'exactly one canvas');
    const widths = await page.evaluate(() => { const ws = (window as any).__workspace; const box = ws.options.assembly.parts.find((p: any) => p.role === 'bucket').shapes.find((x: any) => x.kind === 'box'); return box.halfExtentsM[2] * 2; });
    assert.ok(Math.abs(widths - 1.8) < 1e-9, 'the new machine carries the new width');
    assert.equal(providerCalls.length, 1, 'still a single provider call'); assert.equal(api.filter((a) => a.body.action === 'review').length, 2);
    pass('opening the lab again rebuilds engine session, registry and scene from the new assembly, on the same stage');

    // "Nova máquina" forgets everything
    await page.locator('[data-el="extra_restart"]').click();
    await page.waitForFunction(() => (window as any).__experience.phase() === 'empty', null, { timeout: 30000 });
    assert.equal(await page.evaluate(() => (window as any).__unified.port.session.state.phase), 'idle');
    assert.deepEqual(await stageEmpty(page), EMPTY_STAGE);
    pass('new machine: session forgotten, empty stage, same workspace');
    await page.close();
  }

  // cancel during the wait: the late answer is ignored and nothing is kept
  await restartBackend(); providerCalls.length = 0; api.length = 0;
  {
    const page = await open();
    let release!: () => void; hold = new Promise<void>((r) => { release = r; });
    await page.locator('[data-kind="text"]').click();
    await page.locator('#ux-text').fill('Escavadora de rastos de 20 t com lança, braço e caçamba.');
    await page.locator('#ux-use-text').click();
    await page.locator('[data-flow="submit"]').click();
    await page.waitForFunction(() => (window as any).__experience.phase() === 'waiting');
    await page.waitForFunction(() => true); await new Promise((r) => setTimeout(r, 300));
    await page.locator('[data-flow="cancel"]').click();
    assert.equal(await phase(page), 'selected');
    hold = null; release(); await new Promise((r) => setTimeout(r, 600));
    assert.equal(await phase(page), 'selected', 'the late answer is ignored');
    assert.equal(await page.evaluate(() => (window as any).__unified.port.session.state.phase), 'idle', 'no session kept for a cancelled request');
    pass('cancel while waiting: late answer ignored, nothing kept');
    await page.close();
  }


  // failures of the Meta request, as the person sees them: a clear message, the code, a way on, and never a machine
  await restartBackend(); providerCalls.length = 0; api.length = 0;
  for (const [status, code, phaseExpected, retry, text] of [
    [429, 'META_CALL_BUDGET_EXHAUSTED', 'failed', false, /limite de pedidos ao modelo/],
    [429, 'RECONSTRUCTION_RATE_LIMITED', 'failed', true, /Demasiados pedidos/],
    [502, 'RECONSTRUCTION_SCHEMA_INVALID', 'failed', true, /RECONSTRUCTION_SCHEMA_INVALID|não foi aceite|falhou/],
    [503, 'MODEL_API_KEY_MISSING', 'unavailable', false, /não está configurada/],
  ] as const) {
    const page = await open();
    forcedResponses.push({ review: false, status, body: { error: { code, message: 'x' } } });
    await page.locator('[data-kind="text"]').click();
    await page.locator('#ux-text').fill('Escavadora de rastos de 20 t com lança, braço e caçamba.');
    await page.locator('#ux-use-text').click();
    await page.locator('[data-flow="submit"]').click();
    await page.waitForFunction((p) => (window as any).__experience.phase() === p, phaseExpected, { timeout: 30000 });
    assert.match(await page.locator('#ux-intake').innerText(), text);
    if (phaseExpected === 'failed') assert.match(await page.locator('#ux-intake').innerText(), new RegExp(code === 'RECONSTRUCTION_SCHEMA_INVALID' ? 'RECONSTRUCTION_SCHEMA_INVALID' : code));
    assert.equal(await page.locator('[data-flow="retry"]').count(), retry ? 1 : 0, `${code}: retry only when it can help`);
    assert.equal(await page.locator('[data-flow="restart"]').count() > 0, true, 'always a way to choose another source');
    assert.deepEqual(await stageEmpty(page), EMPTY_STAGE);
    assert.equal(await page.evaluate(() => (window as any).__unified.port.session.state.phase), phaseExpected === 'failed' ? 'proposal_failed' : 'proposal_failed');
    await page.close();
  }
  pass('budget exhausted, rate limit, invalid model output and a missing key are each shown clearly, with the code, and no machine appears');

  // server blocks the review (422) and later says the session is gone (404)
  await restartBackend(); providerCalls.length = 0; api.length = 0;
  {
    const page = await open();
    await toServerStep(page);
    forcedResponses.push({ review: true, status: 422, body: { contract: 'unfold.reconstruction.review.v1', sessionId: 'x', status: 'blocked', reasons: ['família não confirmada'] } });
    await page.locator('#ux-enter').click();
    await page.waitForSelector('#ux-gw-msg[role="alert"] p');
    assert.match(await page.locator('#ux-gw-msg').innerText(), /bloqueou a revisão[\s\S]*família não confirmada/);
    assert.equal(await phase(page), 'review'); assert.equal(await page.inputValue('#gw-reviewer'), 'revisor-e2e', 'the form is kept after a 422');
    pass('a 422 is shown with the server\'s reasons and keeps the form');
    forcedResponses.push({ review: true, status: 404, body: { error: { code: 'RECONSTRUCTION_SESSION_NOT_FOUND', message: 'x' } } });
    await page.locator('#ux-enter').click();
    await page.waitForFunction(() => /expirou/.test(document.querySelector('#ux-gw-msg')?.textContent ?? ''));
    assert.equal(await phase(page), 'review');
    pass('an expired server session is reported and the lab stays closed');
    // the way on is explicit, and it works without reloading the page
    assert.deepEqual(await page.locator('#ux-gw-msg [data-flow="restart"]').allTextContents(), ['Importar outra fonte', 'Novo projecto']);
    await page.evaluate(() => { (window as any).__noReload = true; });
    await page.locator('#ux-gw-msg [data-flow="restart"]', { hasText: 'Importar outra fonte' }).click();
    assert.equal(await phase(page), 'empty'); assert.equal(await page.evaluate(() => (window as any).__noReload === true), true, 'no page reload');
    assert.equal(await page.evaluate(() => (window as any).__unified.port.session.state.phase), 'idle');
    assert.deepEqual(await stageEmpty(page), EMPTY_STAGE);
    await page.locator('[data-kind="text"]').click(); await page.locator('#ux-text').fill('Escavadora de rastos de 20 t com lança, braço e caçamba.'); await page.locator('#ux-use-text').click();
    assert.equal(await phase(page), 'selected', 'a new source can be imported straight away');
    pass('after an expired session the person can import another source without reloading');
    await page.close();
  }

  // local expiry (30 minutes), with the browser clock advanced: the interface reacts by itself and offers the same two ways on
  await restartBackend(); providerCalls.length = 0; api.length = 0;
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/api/living/reconstruction', async (route) => {
      const request = route.request();
      const response = await fetch(`http://127.0.0.1:${backendPort}/api/living/reconstruction`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ALLOWED_ORIGIN }, body: request.postData() ?? '' });
      await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() });
    });
    await page.clock.install({ time: new Date() });
    await page.goto(`http://127.0.0.1:${port}/living?debug-living=1&rm=1&agent=fixture`);
    await page.waitForFunction(() => (window as any).__experience?.ready, null, { timeout: 120000 });
    await toServerStep(page);
    assert.equal(await page.locator('#ux-enter').isDisabled(), false);
    await page.clock.fastForward('30:05');
    await page.waitForFunction(() => /expirou/.test(document.querySelector('#ux-gw-msg')?.textContent ?? ''), null, { timeout: 10000 });
    assert.equal(await page.locator('#ux-enter').isDisabled(), true, 'nothing can be sent any more');
    assert.deepEqual(await page.locator('#ux-gw-msg [data-flow="restart"]').allTextContents(), ['Importar outra fonte', 'Novo projecto']);
    assert.equal(api.filter((a) => a.body.action === 'review').length, 0, 'the server was never asked: the expiry is known locally');
    await page.screenshot({ path: join(out, 'session-expired.png') });
    await page.locator('#ux-gw-msg [data-flow="restart"]', { hasText: 'Novo projecto' }).click();
    assert.equal(await phase(page), 'empty'); assert.deepEqual(await stageEmpty(page), EMPTY_STAGE);
    pass('a session that expires locally is shown without a click, with both ways on, and "Novo projecto" starts over');
    await page.close();
  }



  // geometry: the width comes from the contract and shows in the 3D mesh (case A 1.10 m, case B 1.40 m)
  const measured: Record<string, { sizeZ: number; triangles: number; parts: number; look: string; picked: string | null; pins: number }> = {};
  for (const width of ['1.1', '1.4']) {
    await restartBackend(); providerCalls.length = 0; api.length = 0;
    const page = await open({ width: 1440, height: 900 }, 'debug-living=1&rm=1&agent=fixture');
    await toServerStep(page, width);
    await page.locator('#ux-enter').click();
    await page.waitForFunction(() => (window as any).__experience.phase() === 'lab' && (window as any).__workspace?.partPoses, null, { timeout: 60000 });
    await page.waitForTimeout(500);
    measured[width] = await page.evaluate(() => {
      const ws = (window as any).__workspace; const group = ws.model.parts.get('bucket'); const V = group.position.constructor;
      ws.renderNow(); group.updateMatrixWorld(true); let min = Infinity, max = -Infinity, triangles = 0;
      group.traverse((m: any) => { if (!m.isMesh) return; m.geometry.computeBoundingBox(); const bb = m.geometry.boundingBox; triangles += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
        for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) { const v = new V(x, y, z).applyMatrix4(m.matrixWorld); min = Math.min(min, v.z); max = Math.max(max, v.z); } });
      // picking, through the code the pointer uses: some point on the bucket's projected area resolves to the bucket
      const pts: any[] = []; group.traverse((m: any) => { if (!m.isMesh) return; const bb = m.geometry.boundingBox; for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) pts.push(new V(x, y, z).applyMatrix4(m.matrixWorld).project(ws.foundry.camera)); });
      const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y); const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      let picked: string | null = null;
      for (let i = 1; i < 12 && picked !== 'bucket'; i++) for (let j = 1; j < 12 && picked !== 'bucket'; j++) { const hit = ws.scene.pick({ x: x0 + (x1 - x0) * i / 12, y: y0 + (y1 - y0) * j / 12 }, ws.foundry.camera)?.id ?? null; if (hit === 'bucket') picked = hit; }
      const pins = ws.options.assembly.joints.length;
      return { sizeZ: max - min, triangles, parts: ws.model.parts.size, look: ws.look.name, picked, pins };
    });
    const m = measured[width]!;
    assert.equal(m.parts, 13, 'the 13 canonical parts'); assert.equal(m.look, 'premium'); assert.equal(m.pins, EXCAVATOR_ASSEMBLY_V1.joints.length, 'every joint of the contract is kept'); assert.equal(m.picked, 'bucket', 'picking at the bucket resolves to the bucket');
    await page.evaluate(() => { const ws = (window as any).__workspace; ws.select('bucket'); ws.frameSelection(); });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(out, `bucket-${width}m-lab.png`) });
    await page.close();
  }
  {
    const narrow = measured['1.1']!, wide = measured['1.4']!;
    assert.ok(narrow.sizeZ > 1.10 && narrow.sizeZ < 1.16, `case A: mesh width ${narrow.sizeZ} follows 1.10 m`);
    assert.ok(wide.sizeZ > 1.40 && wide.sizeZ < 1.46, `case B: mesh width ${wide.sizeZ} follows 1.40 m`);
    assert.ok(Math.abs(wide.sizeZ - narrow.sizeZ - 0.30) < 0.02, `the difference is the 0.30 m that was asked (${wide.sizeZ - narrow.sizeZ})`);
    assert.ok(wide.triangles > narrow.triangles, 'the wider bucket has an extra tooth');
    assert.equal(wide.parts, narrow.parts);
    writeFileSync(join(out, 'bucket-width-measurements.json'), JSON.stringify({ note: 'measured in the real workspace mesh (Chromium, SwiftShader), world Z extent of the bucket group', caseA_1_10m: narrow, caseB_1_40m: wide, meshDifferenceM: wide.sizeZ - narrow.sizeZ }, null, 2));
    pass(`case A 1.10 m -> mesh ${narrow.sizeZ.toFixed(3)} m; case B 1.40 m -> mesh ${wide.sizeZ.toFixed(3)} m (+${(wide.sizeZ - narrow.sizeZ).toFixed(3)}); 13 parts, premium look, extra tooth`);
  }

  // a width the visualiser cannot draw is refused with the reason, before anything is sent or built
  await restartBackend(); providerCalls.length = 0; api.length = 0;
  for (const bad of ['0.5', '2.5', '3']) {
    const page = await open({ width: 1440, height: 900 }, 'debug-living=1&rm=1&agent=fixture');
    await toServerStep(page, bad);
    assert.equal(await page.locator('#ux-enter').isDisabled(), true, `${bad} m: the primary action stays blocked`);
    assert.match(await page.locator('#ux-gw-missing').innerText(), /0,60 a 2,40 m/);
    await page.screenshot({ path: join(out, `width-${bad}m-refused.png`) });
    assert.equal(api.filter((a) => a.body.action === 'review').length, 0, `${bad} m is never sent to the server`);
    assert.deepEqual(await stageEmpty(page), EMPTY_STAGE);
    await page.close();
  }
  pass('widths outside 0,60 a 2,40 m are refused with the reason; nothing is sent, adjusted or built');

  // gate 2: a structurally valid assembly that the Engineering Engine cannot pose keeps the lab closed, and says why
  await restartBackend(); providerCalls.length = 0; api.length = 0;
  {
    const page = await open();
    await toServerStep(page);
    reviewMutators.push((body) => { for (const a of body.assembly.actuators) if (a.kind === 'hydraulic_cylinder') a.stroke.max.value = 0.0001; });
    await page.locator('#ux-enter').click();
    await page.waitForFunction(() => /motor não consegue resolver/.test(document.querySelector('#ux-gw-msg')?.textContent ?? ''), null, { timeout: 30000 });
    const message = await page.locator('#ux-gw-msg').innerText();
    assert.match(message, /contrato é válido/); assert.match(message, /STROKE_OUT_OF_RANGE/);
    assert.match(await page.locator('#ux-side .ux-gates').innerText(), /bloqueada pelo motor[\s\S]*STROKE_OUT_OF_RANGE/, 'gate 2 shows the engine blocked it');
    assert.equal(await phase(page), 'review'); assert.deepEqual(await stageEmpty(page), EMPTY_STAGE, 'no machine is shown that the engine cannot pose');
    pass('structurally valid but unposable by the engine: gate 2 blocked, lab closed, reason shown');
    await page.locator('#ux-enter').click();
    await page.waitForFunction(() => (window as any).__experience.phase() === 'lab' && (window as any).__workspace?.partPoses, null, { timeout: 60000 });
    assert.match(await page.evaluate(() => (window as any).__experience.flow().phase), /lab/);
    pass('after a correct review the same session opens the lab');
    await page.close();
  }

  // WebP through the real file input: converted to PNG before it leaves the page
  await restartBackend(); providerCalls.length = 0; api.length = 0;
  {
    const page = await open();
    const webp = await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 64; c.height = 32; const g = c.getContext('2d')!; g.fillStyle = '#888'; g.fillRect(0, 0, 64, 32); const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/webp')); const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; buf.forEach((b) => { s += String.fromCharCode(b); }); return { type: blob.type, b64: btoa(s) }; });
    assert.equal(webp.type, 'image/webp');
    await page.locator('[data-kind="image"]').click();
    await page.setInputFiles('#ux-file', { name: 'foto.webp', mimeType: 'image/webp', buffer: Buffer.from(webp.b64, 'base64') });
    await page.locator('[data-flow="submit"]').click();
    await page.waitForFunction(() => (window as any).__experience.phase() === 'review', null, { timeout: 60000 });
    assert.match(api[0]!.body.imageDataUrl, /^data:image\/png;base64,/, 'the API received a PNG');
    assert.equal(api[0]!.status, 200);
    pass('a WebP chosen in the interface is sent to the API as PNG');
    await page.close();
  }

  // browser history: leave the lab and come back, with and without the back-forward cache
  for (const cache of [false, true]) {
    await restartBackend(); providerCalls.length = 0; api.length = 0;
    const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', ignoreDefaultArgs: cache ? ['--disable-back-forward-cache'] : [], args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', ...(cache ? ['--enable-features=BackForwardCache'] : [])] });
    try {
      const page = await open({ width: 1000, height: 700 }, 'debug-living=1&rm=0&agent=fixture', b);
      await page.addInitScript(() => { (window as any).__shows = []; addEventListener('pageshow', (e) => (window as any).__shows.push((e as PageTransitionEvent).persisted)); });
      await toServerStep(page);
      await page.locator('#ux-enter').click();
      await page.waitForFunction(() => (window as any).__experience.phase() === 'lab' && (window as any).__workspace?.partPoses, null, { timeout: 90000 });
      await page.evaluate(() => { const ws = (window as any).__workspace; ws.select('boom_cylinder'); (window as any).__canvas = document.querySelector('.uw-stage canvas'); (window as any).__shows = (window as any).__shows ?? []; addEventListener('pageshow', (e) => (window as any).__shows.push((e as PageTransitionEvent).persisted)); });
      for (let cycle = 1; cycle <= 2; cycle++) {
        await page.goto(`http://127.0.0.1:${port}/landing/`, { waitUntil: 'domcontentloaded' });
        await page.goBack({ waitUntil: 'commit' });
        await page.waitForFunction(() => (window as any).__experience?.ready, null, { timeout: 120000 });
        const r = await page.evaluate(() => ({ persisted: (window as any).__shows.at(-1), phase: (window as any).__experience.phase(), stageCanvases: document.querySelectorAll('.uw-stage canvas').length, labCanvases: document.querySelectorAll('.uw-stage canvas').length, same: (window as any).__canvas === document.querySelector('.uw-stage canvas'), empty: (window as any).__workspace?.isEmpty ?? null, playing: (window as any).__workspace?.engineState().playing ?? null, selection: (window as any).__workspace?.selection()?.id ?? null, lost: (window as any).__workspace?.foundry.renderer.getContext().isContextLost() ?? null, look: (window as any).__workspace?.look.name ?? null }));
        if (cache) { assert.equal(r.persisted, true); assert.equal(r.phase, 'lab'); assert.equal(r.labCanvases, 1); assert.equal(r.same, true); assert.equal(r.selection, 'boom_cylinder'); assert.equal(r.playing, false); assert.equal(r.lost, false); assert.equal(r.look, 'premium'); }
        else { assert.equal(r.persisted, false); assert.equal(r.phase, 'empty', 'a fresh page starts from an empty lab, never from a half-restored one'); assert.equal(r.empty, true); assert.equal(r.stageCanvases, 1); }
        pass(`history cycle=${cycle} cache=${cache} persisted=${r.persisted}`);
      }
      await page.close();
    } finally { await b.close(); }
  }

  // first use: /living is an EMPTY lab; the example is a separate, openly labelled choice, on the same stage
  await restartBackend(); providerCalls.length = 0; api.length = 0;
  {
    const page = await open({ width: 1440, height: 900 }, 'debug-living=1&rm=1&agent=fixture');
    assert.equal(await phase(page), 'empty');
    assert.deepEqual(await stageEmpty(page), EMPTY_STAGE, 'one workspace, one canvas, no machine');
    assert.equal(await page.locator('#ux-demo').count(), 0);
    const chrome = await page.evaluate(() => ({ rail: !!document.querySelector('.uw-rail'), composer: !!document.querySelector('.uw-composer'), brand: document.querySelector('.uw-brand')?.textContent, toolsDisabled: (document.querySelector('[data-el="toolFrame"]') as HTMLButtonElement).disabled, placeholder: (document.querySelector('[data-el="input"]') as HTMLTextAreaElement).placeholder }));
    assert.ok(chrome.rail && chrome.composer); assert.match(chrome.brand ?? '', /laboratório vazio/); assert.equal(chrome.toolsDisabled, true, 'machine tools are present but unavailable');
    assert.match(chrome.placeholder, /Descreva a máquina ou anexe uma fotografia/, 'the composer is the way in');
    const intake = await page.locator('#ux-intake').innerText();
    assert.match(intake, /PNG, JPEG ou WebP/); assert.match(intake, /10 MB/); assert.match(intake, /16 megapixéis/);
    assert.equal(await page.locator('[data-example="open"]').count(), 1); assert.equal(await page.locator('[data-example="open"]').textContent(), 'Abrir exemplo');
    assert.match(await page.locator('.ux-example-note').innerText(), /sintética[\s\S]*não vem de nenhuma fonte sua/);
    assert.equal(await page.locator('[data-flow="submit"]').isDisabled(), true, 'the primary action needs a source');
    pass('/living opens as one workspace with an empty stage, the formats, the limits and a separate "Abrir exemplo"');
    await page.screenshot({ path: join(out, 'unified-01-empty.png') });

    // the composer takes a description: it becomes the source, with a preview, on the same stage
    await page.fill('[data-el="input"]', 'Escavadora de rastos de 20 t com lança, braço e caçamba.');
    await page.locator('[data-el="send"]').click();
    await page.locator('.ux-preview').waitFor();
    assert.equal(await phase(page), 'selected'); assert.match(await page.locator('.ux-preview').innerText(), /Escavadora de rastos/);
    assert.equal(await page.evaluate(() => (window as any).__workspace.getState().messages.length), 0, 'the text went to the import, not to the assistant');
    await page.locator('[data-flow="clear"]').click();
    // the paperclip takes a photograph
    const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 96; c.height = 48; c.getContext('2d')!.fillRect(0, 0, 96, 48); return c.toDataURL('image/png').split(',')[1]; });
    await page.setInputFiles('[data-el="file"]', { name: 'minha-foto.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await page.locator('.ux-preview img').waitFor();
    assert.match(await page.locator('.ux-preview').innerText(), /minha-foto\.png/);
    assert.deepEqual(await stageEmpty(page), EMPTY_STAGE);
    await page.locator('[data-flow="submit"]').click();
    await page.waitForFunction(() => (window as any).__experience.phase() === 'review', null, { timeout: 60000 });
    assert.deepEqual(await stageEmpty(page), EMPTY_STAGE, 'nothing appears on stage while importing and reviewing');
    const review = await page.evaluate(() => ({ disabled: (document.querySelector('[data-el="input"]') as HTMLTextAreaElement).disabled, placeholder: (document.querySelector('[data-el="input"]') as HTMLTextAreaElement).placeholder }));
    assert.equal(review.disabled, true); assert.match(review.placeholder, /Termine a revisão/);
    await page.screenshot({ path: join(out, 'unified-02-review.png') });
    pass('the composer and the paperclip import a source; the stage stays empty through import and review');

    // the example opens on the same stage, labelled as an example, without leaving the page
    const fresh = await open({ width: 1440, height: 900 }, 'debug-living=1&rm=1&agent=fixture');
    await fresh.evaluate(() => { (window as any).__canvas = document.querySelector('.uw-stage canvas'); (window as any).__oldWs = (window as any).__workspace; });
    const urlBefore = await fresh.evaluate(() => location.href);
    await fresh.locator('[data-example="open"]').click();
    await fresh.waitForFunction(() => !(window as any).__workspace.isEmpty, null, { timeout: 60000 });
    await fresh.waitForTimeout(1200);
    const example = await fresh.evaluate(() => { const ws = (window as any).__workspace; return { same: ws === (window as any).__oldWs && document.querySelector('.uw-stage canvas') === (window as any).__canvas, url: location.href, assembly: ws.options.assembly.id, brand: document.querySelector('.uw-brand')?.textContent, look: ws.look, notice: document.querySelector('.uw-notices')?.textContent, phase: (window as any).__experience.phase(), panels: getComputedStyle(document.querySelector('.ux-root')!).display }; });
    assert.equal(example.same, true, 'the same workspace and canvas'); assert.equal(example.url, urlBefore, 'no navigation');
    assert.equal(example.assembly, EXCAVATOR_ASSEMBLY_V1.id); assert.equal(example.phase, 'lab'); assert.equal(example.panels, 'none', 'the import panels are gone');
    assert.match(example.brand ?? '', /exemplo/); assert.match(example.notice ?? '', /Exemplo[\s\S]*não foi reconstruída a partir de nenhuma fotografia/);
    assert.equal(example.look.name, 'premium'); assert.ok(example.look.materials > 0);
    assert.equal(await fresh.evaluate(() => { const ws = (window as any).__workspace; return ws.premium.environment !== null && ws.foundry.scene.environment === ws.premium.environment.texture; }), true, 'the premium studio environment is the one in the scene');
    assert.equal(await fresh.locator('[data-el="extra_new"]').count(), 1);
    await fresh.screenshot({ path: join(out, 'unified-03-example.png') });
    pass('"Abrir exemplo" puts the synthetic reference machine on the same stage, labelled as an example, with the premium look');
    await fresh.locator('[data-el="extra_new"]').click();
    await fresh.waitForFunction(() => (window as any).__experience.phase() === 'empty', null, { timeout: 30000 });
    assert.deepEqual(await stageEmpty(fresh), EMPTY_STAGE);
    assert.equal(await fresh.evaluate(() => (window as any).__workspace === (window as any).__oldWs), true);
    pass('"Novo projecto" empties the stage again, in the same workspace');
    await fresh.close();

    // ?example=1 goes straight to the example
    const deep = await open({ width: 1440, height: 900 }, 'example=1&debug-living=1&rm=1&agent=fixture');
    await deep.waitForFunction(() => !(window as any).__workspace.isEmpty, null, { timeout: 60000 });
    assert.match(await deep.evaluate(() => document.querySelector('.uw-brand')?.textContent ?? ''), /exemplo/);
    await deep.close(); await page.close();
  }
} finally { await browser.close(); await vite.close(); await new Promise<void>((r, j) => backend.close((e) => e ? j(e) : r())); }
assert.deepEqual(errors, []);
