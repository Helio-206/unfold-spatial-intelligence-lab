// Premium experience prototype: captures + browser checks. Starts its own Vite; no backend, no model calls.
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
const URL_ = `http://127.0.0.1:${port}/src/living/experience/harness/index.html`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`); };
const external = [];

async function open(query, viewport = { width: 1440, height: 810 }, dpr = 1) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: dpr });
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Outdated Optimize Dep/.test(m.text())) errors.push(m.text()); });
  await page.route('**/*', (r) => { const u = new URL(r.request().url()); if (u.hostname !== '127.0.0.1') { external.push(u.href); return r.abort(); } if (u.pathname.startsWith('/api/')) { external.push(u.href); return r.abort(); } return r.continue(); });
  await page.goto(`${URL_}?tier=balanced&${query}`, { waitUntil: 'commit', timeout: 120_000 });
  await page.waitForFunction(() => window.__experience?.ready, null, { timeout: 300_000 });
  return { page, context, errors };
}
const shot = async (page, name, wait = 4000) => { await page.waitForTimeout(wait); await page.screenshot({ path: join(SHOTS, `${name}.png`), timeout: 240_000 }); };
/** Freeze the page clock so the transition is captured at exact timeline instants. */
const freeze = (page) => page.evaluate(() => { window.__t = 0; const start = performance.now(); performance.now = () => start + window.__t * 1000; });

// ---------------------------------------------------------------- desktop: review → transition → lab
{
  const { page, context, errors } = await open('');
  const s0 = await page.evaluate(() => window.__experience.summary());
  check('review opens with nothing confirmed and the lab closed', s0.confirmed === 0 && !s0.canEnterLab && s0.pendingHypotheses === 3, s0);
  check('primary action disabled with a reason', await page.locator('#ux-enter').isDisabled() && /hipótese/.test(await page.locator('#ux-enter-note').textContent()));
  await shot(page, '01-reconstruction-desktop');
  // review by keyboard and buttons: confirm two cylinders, reject the uncertain one
  await page.locator('[data-review="confirm"]').click();
  await page.locator('[data-review="next"]').click(); await page.locator('[data-review="confirm"]').click();
  await page.locator('[data-review="next"]').click(); await page.locator('[data-review="reject"]').click();
  const s1 = await page.evaluate(() => window.__experience.summary());
  check('after deciding the hypotheses the lab opens; unknowns stay unknown', s1.canEnterLab && s1.unknown === 2 && s1.confirmed === 2 && s1.rejected === 1, s1);
  const unk = await page.evaluate(() => { window.__experience.dispatch({ type: 'focus', id: 'e_linkage' }); return { confirmButton: !!document.querySelector('[data-review="confirm"]') }; });
  check('an unknown offers no "confirm"', !unk.confirmButton, unk);
  await shot(page, '02-reconstruction-reviewed', 1500);
  await freeze(page);
  await page.locator('#ux-enter').click();
  for (const [t, name] of [[0.2, '03a-transition-registered'], [1.5, '03b-transition-fold'], [2.3, '03c-transition-rise']]) { await page.evaluate((t) => { window.__t = t; }, t); await shot(page, name, 9000); }
  await page.evaluate((t) => { window.__t = t; }, 10);
  await page.waitForFunction(() => window.__experience.phase() === 'lab', null, { timeout: 60_000 });
  await shot(page, '04-lab-desktop', 9000);
  const chips = await page.evaluate(() => [...document.querySelectorAll('.ux-chip')].map((c) => c.dataset.cat));
  check('lab marks only uncertainty on the parts (unknown, rejected), never confirmed', chips.length === 3 && chips.every((c) => c === 'unknown' || c === 'rejected'), chips);
  const state = await page.locator('#ux-lab-state').textContent();
  check('lab summary keeps the four categories apart', /confirmados/.test(state) && /observados/.test(state) && /desconhecidos/.test(state) && /rejeitados/.test(state), state);
  const ghosts = await page.evaluate(() => { const rt = window.__experience.runtime; let n = 0; rt.visuals.parts.get('bucket_cyl_barrel').traverse((o) => { if (o.isMesh && o.material.opacity < 0.5) n++; }); return n; });
  check('rejected component is ghosted, not drawn as solid', ghosts > 0, `${ghosts} ghost meshes`);
  await page.locator('#ux-back').click();
  check('back to review keeps the decisions', (await page.evaluate(() => window.__experience.summary())).confirmed === 2);
  check('no page errors (desktop)', errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

// ---------------------------------------------------------------- reduced motion
{
  const { page, context } = await open('demo=reviewed&rm=1');
  await page.evaluate(() => window.__experience.enterLab(true));
  check('reduced motion: the lab is reached without animation', (await page.evaluate(() => window.__experience.phase())) === 'lab');
  await context.close();
}

// ---------------------------------------------------------------- mobile
{
  const { page, context, errors } = await open('', { width: 390, height: 844 }, 2);
  const m = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, w: innerWidth, enter: document.querySelector('#ux-enter').getBoundingClientRect().bottom, h: innerHeight }));
  check('mobile review: no horizontal scroll, primary action on screen', m.scrollW <= m.w && m.enter <= m.h, m);
  await shot(page, '05-reconstruction-mobile');
  await page.evaluate(() => { for (const [id, d] of [['e_boom_cyl', 'confirmed'], ['e_stick_cyl', 'confirmed'], ['e_bucket_cyl', 'rejected']]) window.__experience.dispatch({ type: 'decide', id, decision: d }); window.__experience.enterLab(false); });
  await shot(page, '06-lab-mobile', 9000);
  check('no page errors (mobile)', errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

check('no request left localhost, no /api call', external.length === 0, external.slice(0, 3).join(' '));
await browser.close(); await server.close();
const failed = checks.filter((c) => !c.ok);
writeFileSync(join(OUT, 'browser-report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), renderer: 'Chromium + SwiftShader (software WebGL), cinema tier "balanced"', checks }, null, 2));
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
