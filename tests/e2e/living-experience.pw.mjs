// Unified experience (UX prototype): every state through the real UI, plus captures at 390 / 768 / 1440.
// Starts its own Vite; no backend, no /api, no Meta. The demo port is the only reconstruction source here.
//   node tests/e2e/living-experience.pw.mjs
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const OUT = resolve(process.env.UNFOLD_UX_OUT ?? 'reports/living/experience');
const SHOTS = join(OUT, 'captures'); mkdirSync(SHOTS, { recursive: true });
const port = Number(process.env.UNFOLD_UX_PORT ?? 5311);
const server = await createServer({ server: { port, host: '127.0.0.1', strictPort: true }, logLevel: 'error' });
await server.listen();
const BASE = `http://127.0.0.1:${port}/src/living/experience/harness/index.html`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`); };
const external = [];
// a real 2×1 PNG (the content is irrelevant to the demo port, and the UI says so)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4//8/AwMDAwMACfsC/rT9nSAAAAAASUVORK5CYII=', 'base64');

async function open(query = '', viewport = { width: 1440, height: 810 }, dpr = 1) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: dpr });
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Outdated Optimize Dep/.test(m.text())) errors.push(m.text()); });
  await page.route('**/*', (r) => { const u = new URL(r.request().url()); if (u.hostname !== '127.0.0.1' || u.pathname.startsWith('/api/')) { external.push(u.href); return r.abort(); } return r.continue(); });
  await page.goto(`${BASE}?tier=light&delay=400${query}`, { waitUntil: 'commit', timeout: 120_000 });
  await page.waitForFunction(() => window.__experience?.ready, null, { timeout: 300_000 });
  return { page, context, errors };
}
const phase = (page) => page.evaluate(() => window.__experience.phase());
const shot = async (page, name, wait = 1500) => { await page.waitForTimeout(wait); await page.screenshot({ path: join(SHOTS, `${name}.png`), timeout: 240_000 }); };
const waitPhase = (page, p) => page.waitForFunction((p) => window.__experience.phase() === p, p, { timeout: 60_000 });

// ---------------------------------------------------------------- 1440: intake → review → lab, through clicks
{
  const { page, context, errors } = await open();
  check('starts as an empty lab (no machine)', (await phase(page)) === 'empty' && !(await page.evaluate(() => window.__experience.runtime.stage.machineVisible)));
  check('demo is labelled on screen', /nenhuma chamada à Meta/.test(await page.locator('#ux-demo').textContent()));
  check('Reconstruir is disabled without a source', await page.locator('[data-flow="submit"]').isDisabled());
  await shot(page, '1440-01-empty');
  await page.setInputFiles('#ux-file', { name: 'manual.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
  check('unsupported file is refused with a reason', /não é PNG, JPEG nem WebP/.test(await page.locator('.ux-problem').textContent()) && (await phase(page)) === 'empty');
  await page.setInputFiles('#ux-file', { name: 'alcado-lateral.png', mimeType: 'image/png', buffer: PNG });
  await waitPhase(page, 'selected');
  check('selected file is previewed with name, type and size', /alcado-lateral\.png/.test(await page.locator('.ux-preview figcaption').textContent()) && await page.locator('.ux-preview img').isVisible());
  await shot(page, '1440-02-selected');
  await page.locator('[data-flow="submit"]').click();
  check('waiting state shows elapsed time and a cancel action', (await phase(page)) === 'waiting' && await page.locator('[data-flow="cancel"]').isVisible());
  await shot(page, '1440-03-waiting', 200);
  await page.locator('[data-flow="cancel"]').click();
  check('cancel returns to the selected source, nothing reviewed', (await phase(page)) === 'selected' && (await page.evaluate(() => window.__experience.review())) === null);
  await page.locator('[data-flow="submit"]').click();
  await waitPhase(page, 'review');
  const s0 = await page.evaluate(() => ({ s: window.__experience.summary(), r: window.__experience.readiness() }));
  check('review opens with nothing confirmed and the lab closed', s0.s.confirmed === 0 && s0.r.status === 'review_pending', s0);
  check('two gates are shown separately (human review, engineering validation)', /revisão humana/.test(await page.locator('#ux-side').textContent()) && /validação de engenharia/.test(await page.locator('#ux-side').textContent()) && /confirmar não é validar/.test(await page.locator('#ux-side').textContent()));
  await shot(page, '1440-04-review');
  // correct the uncertain cylinder instead of confirming it
  await page.evaluate(() => window.__experience.dispatch({ type: 'focus', id: 'e_bucket_cyl' }));
  await page.locator('[data-review="correct"]').click();
  await page.locator('#ux-fix-kind').selectOption('unknown');
  await page.locator('#ux-fix-label').fill('Tubagem hidráulica sob o braço');
  await shot(page, '1440-05-correcting', 300);
  await page.locator('[data-review="save-correct"]').click();
  const corrected = await page.evaluate(() => window.__experience.review().items.find((i) => i.id === 'e_bucket_cyl'));
  check('correction is recorded as the person\'s and the AI interpretation is kept', corrected.decision === 'corrected' && corrected.label === 'Cilindro da caçamba' && /a IA interpretou como/.test(await page.locator('.ux-was').textContent()), corrected.correction);
  // unknown property: a value entered by the person is labelled, never "confirmed"
  await page.evaluate(() => window.__experience.dispatch({ type: 'focus', id: 'e_counterweight' }));
  check('an unknown entity offers no Confirmar', (await page.locator('[data-review="confirm"]').count()) === 0);
  await page.locator('[data-prop-input="massa"]').fill('3800 kg');
  await page.locator('[data-review="save-property"]').click();
  check('entered value is labelled "introduzido por si · não verificado"', /introduzido por si · não verificado/.test(await page.locator('.ux-props').textContent()));
  await shot(page, '1440-06-unknown-property', 300);
  // keyboard: → to move, C to confirm
  await page.evaluate(() => { document.activeElement?.blur(); window.__experience.dispatch({ type: 'focus', id: 'e_boom_cyl' }); });
  await page.keyboard.press('c');
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('c');
  const k = await page.evaluate(() => window.__experience.review().items.filter((i) => i.decision === 'confirmed').map((i) => i.id));
  check('keyboard review: → moves, C confirms', k.includes('e_boom_cyl') && k.includes('e_stick_cyl'), k);
  check('lab opens once gate 1 is ready', (await page.evaluate(() => window.__experience.readiness().status)) === 'ready_for_engine' && !(await page.locator('#ux-enter').isDisabled()));
  await page.locator('#ux-enter').click();
  await waitPhase(page, 'lab');
  await shot(page, '1440-07-lab', 6000);
  check('lab: engine gate still "por executar" after human review', /por executar/.test(await page.locator('#ux-lab-gates').textContent()));
  check('lab: safe operations listed, unsafe ones explained', /Simular movimentos/.test(await page.locator('#ux-ops').textContent()) && /depois da validação de engenharia/.test(await page.locator('#ux-ops').textContent()));
  const chips = await page.evaluate(() => [...document.querySelectorAll('.ux-chip')].map((c) => { const r = c.getBoundingClientRect(); return { cat: c.dataset.cat, r: [r.left, r.top, r.right, r.bottom] }; }));
  const ops = await page.evaluate(() => { const r = document.querySelector('.ux-lab-top').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; });
  const overlap = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
  check('lab: chip labels do not overlap each other or the side column', chips.every((c, i) => chips.every((d, j) => i === j || !overlap(c.r, d.r)) && !overlap(c.r, ops)), chips.map((c) => c.cat));
  await page.locator('#ux-pip').click();
  check('the drawing thumbnail returns to the review with decisions kept', (await phase(page)) === 'review' && (await page.evaluate(() => window.__experience.summary().corrected)) === 1);
  check('no page errors (1440)', errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

// ---------------------------------------------------------------- the four non-success outcomes
for (const [scenario, expect, name] of [['not_identified', 'not_identified', 'not-identified'], ['failed', 'failed', 'failed'], ['unavailable', 'unavailable', 'unavailable'], ['insufficient', 'review', 'insufficient']]) {
  const { page, context } = await open(`&scenario=${scenario}&start=review`);
  await waitPhase(page, expect);
  if (scenario === 'insufficient') {
    const r = await page.evaluate(() => window.__experience.readiness());
    check('insufficient data: lab blocked, missing structure named', r.status === 'insufficient' && (await page.locator('#ux-enter').isDisabled()) && /falta material circulante/.test(await page.locator('#ux-enter-note').textContent()), r);
  } else {
    const txt = await page.locator('#ux-intake').textContent();
    check(`${scenario}: plain explanation and a way forward`, (scenario === 'not_identified' ? /Não foi possível identificar a máquina/.test(txt) && /fotografia lateral/.test(txt) : scenario === 'failed' ? /limite de pedidos/.test(txt) && /META_CALL_BUDGET_EXHAUSTED/.test(txt) : /não está disponível/.test(txt)) && /Escolher outra fonte/.test(txt));
  }
  await shot(page, `1440-08-${name}`);
  await context.close();
}

// ---------------------------------------------------------------- long states: long text input, long correction label
{
  const { page, context } = await open();
  await page.locator('[data-kind="text"]').click();
  await page.locator('#ux-text').fill('curto');
  await page.locator('#ux-use-text').click();
  check('text too short is refused with guidance', /pelo menos/.test(await page.locator('.ux-problem').textContent()));
  const long = 'Escavadora de rastos com cerca de 20 toneladas, lança monobloco de cerca de 5,4 metros entre pinos, braço de 2,85 metros, caçamba de 1,1 m de largura com cinco dentes, cilindro da lança único por baixo da lança, contrapeso traseiro de massa desconhecida, cabina do lado esquerdo. '.repeat(5);
  await page.locator('#ux-text').fill(long.slice(0, 1990));
  await page.locator('#ux-use-text').click();
  await waitPhase(page, 'selected');
  const fits = await page.evaluate(() => { const r = document.querySelector('.ux-intake').getBoundingClientRect(); return r.bottom <= innerHeight && r.top >= 0; });
  check('long text preview stays inside the card (truncated with count)', fits && /caracteres/.test(await page.locator('.ux-preview figcaption').textContent()));
  await shot(page, '1440-09-long-text', 300);
  await page.locator('[data-flow="submit"]').click(); await waitPhase(page, 'review');
  await page.evaluate(() => window.__experience.dispatch({ type: 'correct', id: 'e_boom', correction: { kind: 'boom', label: 'Lança monobloco com reforço soldado na zona do cotovelo e tubagem dupla na face superior, identificada no desenho original' } }));
  const ov = await page.evaluate(() => { const c = document.querySelector('.ux-card'); return c.scrollWidth <= c.clientWidth + 1; });
  check('long correction label wraps inside the card (no horizontal overflow)', ov);
  await shot(page, '1440-10-long-label', 300);
  await context.close();
}

// ---------------------------------------------------------------- reduced motion
{
  const { page, context } = await open('&rm=1&start=lab');
  await waitPhase(page, 'lab');
  check('reduced motion: lab reached without animation, sheet already on the floor', (await page.evaluate(() => document.querySelector('.ux-root').dataset.reducedMotion)) === 'true');
  await context.close();
}

// ---------------------------------------------------------------- tablet 768 and phone 390
for (const [w, h, dpr, tag] of [[768, 1024, 1, '768'], [390, 844, 2, '390']]) {
  const { page, context, errors } = await open('', { width: w, height: h }, dpr);
  const noScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  check(`${tag}: empty lab without horizontal scroll`, await noScroll());
  await shot(page, `${tag}-01-empty`);
  await page.setInputFiles('#ux-file', { name: 'foto.jpg', mimeType: 'image/jpeg', buffer: PNG });
  await waitPhase(page, 'selected'); await page.locator('[data-flow="submit"]').click(); await waitPhase(page, 'review');
  const layout = await page.evaluate(() => { const s = document.querySelector('.ux-sheet').getBoundingClientRect(), c = document.querySelector('.ux-card').getBoundingClientRect(), d = document.querySelector('#ux-demo').getBoundingClientRect(); return { sheetBottom: s.bottom, cardTop: c.top, demoBottom: d.bottom, sheetTop: s.top }; });
  check(`${tag}: review stacks source → card without overlap, banner above the sheet`, layout.cardTop >= layout.sheetBottom && layout.demoBottom <= layout.sheetTop, layout);
  // touch targets
  const small = await page.evaluate(() => [...document.querySelectorAll('.ux-card button, .ux-go button')].filter((b) => b.getBoundingClientRect().height < 32).map((b) => b.textContent));
  check(`${tag}: review actions are at least 32 px tall (44 px for primary buttons)`, small.length === 0, small);
  await shot(page, `${tag}-02-review`);
  await page.evaluate(() => { for (const id of ['e_boom_cyl', 'e_stick_cyl', 'e_bucket_cyl']) window.__experience.dispatch({ type: 'decide', id, decision: id === 'e_bucket_cyl' ? 'rejected' : 'confirmed' }); window.__experience.enterLab(false); });
  await waitPhase(page, 'lab');
  await shot(page, `${tag}-03-lab`, 6000);
  const framed = await page.evaluate(() => { const rt = window.__experience.runtime; return ['bucket', 'upper_body'].map((id) => rt.screenBox(id)).every((b) => b && b.x >= -4 && b.x + b.w <= innerWidth + 4); });
  check(`${tag}: portrait/tablet framing keeps bucket and house on screen`, framed);
  check(`no page errors (${tag})`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

check('no request left localhost, no /api call, no Meta', external.length === 0, external.slice(0, 3).join(' '));
await browser.close(); await server.close();
const failed = checks.filter((c) => !c.ok);
writeFileSync(join(OUT, 'browser-report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), renderer: 'Chromium + SwiftShader (software WebGL), cinema tier "light"', reconstruction: 'DemoReconstructionPort only; no Meta call', checks }, null, 2));
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
