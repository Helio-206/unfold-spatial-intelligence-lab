// Live browser acceptance: run with Meta-configured backend + Vite and Chromium/SwiftShader.
// UNFOLD_E2E_URL defaults to the isolated anatomy worktree dev server.
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.UNFOLD_E2E_URL ?? 'http://127.0.0.1:5173';
const OUT = resolve(process.env.UNFOLD_E2E_OUT ?? 'reports/anatomy/evidence'); mkdirSync(OUT, { recursive: true });
const REPLAY = process.env.ANATOMY_E2E_MODE === 'replay';
const checks = []; const errors = []; const external = [];
const check = (name, ok, details) => { checks.push({ name, ok: Boolean(ok), details }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` ${JSON.stringify(details)}`}`); };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1050 }, deviceScaleFactor: 1 }); const page = await context.newPage();
  page.on('pageerror', (e) => { errors.push(`pageerror: ${e.message}`); console.error(`PAGEERROR ${e.message}`); });
  page.on('console', (m) => { if (m.type() === 'error' && !/GPU stall|swiftshader|Failed to load resource/i.test(m.text())) errors.push(`console: ${m.text()}`); });
  page.on('request', (r) => { if (r.url().includes('/api/anatomy/observe')) console.log(`REQUEST ${r.method()} ${r.url()}`); const u = new URL(r.url()); if (!['127.0.0.1','localhost'].includes(u.hostname) && u.protocol.startsWith('http')) external.push(r.url()); });
  page.on('response', (r) => { if (r.url().includes('/api/anatomy/observe')) console.log(`RESPONSE ${r.status()}`); });
  if (REPLAY) {
    const saved = JSON.parse(readFileSync(resolve(OUT, 'live-meta.json'), 'utf8'));
    await page.route('**/api/anatomy/observe', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ contract: 'unfold.anatomy_observation.v1', status: 'review_required', observation: saved.observation, meta: saved.meta }) }));
  }
  await page.goto(`${BASE}/anatomy?debug-anatomy`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('#anatomy-source-image')?.naturalWidth > 0);
  check('Commons illustration loaded with source attribution', await page.locator('.anatomy-credit').innerText().then((s) => /Wikimedia Commons/.test(s) && /CC BY-SA 3.0/.test(s)));
  await page.screenshot({ path: resolve(OUT, '01-source.png'), fullPage: true });
  await page.locator('#analyse-image').click();
  await page.waitForFunction(() => { const value = document.querySelector('#anatomy-status')?.textContent ?? ''; return !['Imagem pronta','A enviar imagem','Nova imagem pronta'].some((prefix) => value.includes(prefix)); }, null, { timeout: 90_000 });
  console.log(`STATUS ${await page.locator('#anatomy-status').innerText()}`);
  const live = await page.evaluate(async () => ({ observation: window.__unfoldAnatomy?.observation(), meta: window.__unfoldAnatomy?.meta(), shaMatches: await window.__unfoldAnatomy?.sourceShaMatches() }));
  const shaMatches = live.shaMatches;
  check('Meta Muse Spark returned a live source-bound observation', live.observation?.schema === 'unfold.anatomy_observation.v1' && live.observation?.source?.sha256?.length === 64 && shaMatches, { subjectDisposition: live.observation?.subjectDisposition, shaMatches });
  check('physical dimensions remain unknown', Array.isArray(live.observation?.dimensions) && live.observation.dimensions.length === 0 && live.observation.uncertainties.some((s) => /scale|dimension|dimension|dimens/i.test(s)));
  writeFileSync(resolve(OUT, 'live-meta.json'), JSON.stringify({ observation: live.observation, meta: live.meta }, null, 2));
  await page.screenshot({ path: resolve(OUT, '02-meta-review.png'), fullPage: true });
  if (live.observation?.subjectDisposition === 'heart_illustration') {
    const selects = page.locator('#review-list [data-review-choice]'); const count = await selects.count();
    check('review decisions are required and independently selectable', count === live.observation.structures.length + live.observation.relations.length + live.observation.hypotheses.length && await page.locator('#build-scene').isDisabled());
    for (let i = 0; i < count; i += 1) await selects.nth(i).selectOption('accept');
    check('incomplete review gate opens only after all decisions', await page.locator('#build-scene').isEnabled());
    await page.locator('#build-scene').click();
    await page.waitForSelector('.anatomy-stage-wrap canvas', { timeout: 60_000 });
    await page.waitForFunction(() => window.__unfoldAnatomy?.componentMeshes().length === 11, null, { timeout: 60_000 });
    const accepted = await page.evaluate(() => ({ review: window.__unfoldAnatomy?.review(), proposal: window.__unfoldAnatomy?.proposal(), names: window.__unfoldAnatomy?.componentMeshes() }));
    check('licensed 11-mesh atlas loads and only reviewed structures are mapped', accepted.names.length === 11 && accepted.proposal?.model?.license === 'CC-BY-4.0' && accepted.proposal?.components.every((c) => accepted.review.decisions.some((d) => d.targetId === c.entityId)), { meshes: accepted.names.length, mapped: accepted.proposal?.components.length });
    check('human interaction is not represented as verified identity', accepted.review?.actor?.kind === 'client_unverified' && accepted.review?.actor?.identityVerified === false);
    const component = page.locator('#component-list [data-component]').first(); const componentId = await component.getAttribute('data-component'); await component.click();
    check('component selection drives the inspector and label', await component.getAttribute('aria-pressed') === 'true' && (await page.locator('#stage-label').innerText()).length > 0);
    const visible = page.locator(`[data-visible="${componentId}"]`); await visible.uncheck(); check('component visibility can be toggled', await visible.isChecked() === false); await visible.check();
    await page.locator('#cycle-time').fill('2.5');
    check('timeline seek highlights ventricular illustrative phase', await page.locator('[data-phase="ventricles"]').getAttribute('class').then((x) => x?.includes('is-active')) && /não está validada|sem validação fisiológica/i.test(await page.locator('#cycle-caption').innerText()));
    await page.locator('#cycle-play').click(); check('illustrative cycle starts and pauses', await page.locator('#cycle-play').innerText() === 'Pausar'); await page.locator('#cycle-play').click();
    await page.screenshot({ path: resolve(OUT, '03-reviewed-heart-cycle.png'), fullPage: true });
  } else {
    check('incompatible or uncertain family blocks the heart atlas', await page.locator('#build-scene').isDisabled());
  }
  check('browser emitted no page or console errors', errors.length === 0, errors);
  check('browser made no third-party HTTP requests', external.length === 0, external);
  const report = { checks, errors, externalRequests: external, browser: 'Chromium headless · SwiftShader', observationDelivery: REPLAY ? 'replayed prior live Meta response' : 'live Meta endpoint', date: new Date().toISOString() };
  writeFileSync(resolve(OUT, 'browser-results.json'), JSON.stringify(report, null, 2));
  if (checks.some((x) => !x.ok)) process.exitCode = 1;
  await context.close();
} finally { await browser.close(); }
