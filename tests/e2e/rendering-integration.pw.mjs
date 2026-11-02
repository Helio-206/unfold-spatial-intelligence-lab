// E2E real do viewport arquitectónico integrado no editor (Técnico/Apresentação, exportação, ciclo de vida da GPU).
// Chrome real (Playwright) com SwiftShader: NÃO é uma GPU. Nenhuma chamada paga: /api/** é interceptado.
//   npm i --no-save playwright-core@1.49.1
//   UNFOLD_API_TARGET=http://127.0.0.1:9 npx vite --port 5199 --strictPort &
//   node tests/e2e/rendering-integration.pw.mjs
// Variáveis: UNFOLD_E2E_URL, UNFOLD_E2E_OUT (por omissão reports/rendering/integration), CHROME_PATH, UNFOLD_E2E_4K=0 para saltar 4K.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BASE = process.env.UNFOLD_E2E_URL ?? 'http://127.0.0.1:5199';
const OUT = resolve(process.env.UNFOLD_E2E_OUT ?? 'reports/rendering/integration');
const SHOTS = join(OUT, 'screenshots'); const EXPORTS = join(OUT, 'exports');
mkdirSync(SHOTS, { recursive: true }); mkdirSync(EXPORTS, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), 'unfold-e2e-render-'));
const makeSeed = (variant) => {
  const file = join(scratch, `seed-${variant}.json`);
  execFileSync(resolve('node_modules/.bin/tsx'), ['tests/e2e/wall-removal-merge-seed.ts', file, ...(variant === 'plain' ? [] : [variant])], { stdio: 'ignore' });
  return { text: readFileSync(file, 'utf8'), meta: JSON.parse(readFileSync(`${file}.meta.json`, 'utf8')) };
};
const plain = makeSeed('plain');
const checks = []; const external = [];
function check(scenario, name, ok, observed) {
  checks.push({ scenario, name, ok: Boolean(ok), observed });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${scenario}] ${name}${ok ? '' : `  -> ${JSON.stringify(observed)}`}`);
}
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function openEditor(seed, viewport = { width: 1440, height: 1000 }, reuse) {
  const context = reuse?.context ?? await browser.newContext({ viewport, acceptDownloads: true });
  const page = reuse?.page ?? await context.newPage();
  const errors = reuse?.errors ?? [];
  if (!reuse) {
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/Failed to load resource|GPU stall|swiftshader|GL Driver Message/i.test(m.text())) errors.push(`${m.type()}: ${m.text()}`); });
    page.on('request', (r) => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname) && u.protocol.startsWith('http')) external.push(r.url()); });
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: 'null' }));
  }
  await page.goto(`${BASE}/demo?debug-rendering`);
  await page.waitForSelector('#demo-open-spatial');
  await page.evaluate((s) => localStorage.setItem('unfold-spatial-scene.v1', s), seed.text);
  await page.click('#demo-open-spatial');
  await page.waitForSelector('#component-list [data-scene-node]', { timeout: 30000, state: 'attached' });
  await page.waitForFunction(() => window.__unfoldRendering, null, { timeout: 10000 });
  await page.waitForTimeout(800);
  return { page, context, errors };
}
const R = (page, fn) => page.evaluate(`(${fn})(window.__unfoldRendering)`);
const info = (page) => R(page, (r) => r.info());
const stored = (page) => page.evaluate(() => localStorage.getItem('unfold-spatial-scene.v1'));
const revision = (page) => page.evaluate(() => Number(/R(\d+)/.exec(document.querySelector('#scene-state')?.textContent ?? '')?.[1] ?? NaN));
const waitFor = (page, fn, arg, timeout = 20000) => page.waitForFunction(fn, arg, { timeout }).then(() => true, () => false);
const frames = (page, n = 3) => page.evaluate((k) => new Promise((res) => { let i = 0; const t = () => (++i >= k ? res() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);
const shot = (page, name) => page.screenshot({ path: join(SHOTS, `${name}.png`) });
async function select(page, id) { await page.click(`[data-scene-node="${id}"]`); await page.waitForSelector('#inspector:not([hidden])'); await page.waitForTimeout(300); }
const settle = async (page) => { let prev = ''; for (let i = 0; i < 40; i += 1) { const now = JSON.stringify(await R(page, (r) => r.camera())); if (now === prev) return; prev = now; await page.waitForTimeout(500); } };
const pressed = (page) => page.evaluate(() => ({ t: document.querySelector('#quality-technical').getAttribute('aria-pressed'), p: document.querySelector('#quality-presentation').getAttribute('aria-pressed') }));

try {
  // ---------------------------------------------------------------- 1. restauro, defeito Técnico, alternância repetida
  {
    const sc = '1 técnico/apresentação';
    const { page, errors } = await openEditor(plain);
    const s0 = await stored(page); const r0 = await revision(page);
    check(sc, 'o editor arranca em Técnico', (await R(page, (r) => r.quality())) === 'technical' && (await pressed(page)).t === 'true', await pressed(page));
    await select(page, plain.meta.sharedWall); await settle(page);
    const cam0 = await R(page, (r) => r.camera());
    const sel0 = await page.evaluate(() => document.querySelector('#node-label')?.textContent);
    await shot(page, '01-tecnico');
    const base = await info(page); const sceneGeo0 = await R(page, (r) => r.sceneGeometries()); const lights0 = await R(page, (r) => r.lights());
    const samples = [];
    for (let i = 0; i < 20; i += 1) {
      await page.click('#quality-presentation'); await frames(page);
      const mid = await info(page); const lp = await R(page, (r) => r.lights());
      if (i === 0) await shot(page, '02-apresentacao');
      await page.click('#quality-technical'); await frames(page);
      samples.push({ pres: mid, tech: await info(page), lightsPres: lp, lightsTech: await R(page, (r) => r.lights()) });
    }
    const first = samples[1], last = samples.at(-1);
    check(sc, 'geometrias não crescem entre o ciclo 2 e o 20', last.tech.geometries === first.tech.geometries && last.pres.geometries === first.pres.geometries, { first: first.tech, last: last.tech });
    check(sc, 'texturas não crescem entre o ciclo 2 e o 20', last.tech.textures === first.tech.textures && last.pres.textures === first.pres.textures, { first: first.pres.textures, last: last.pres.textures });
    check(sc, 'programas de shader estabilizam', last.pres.programs === first.pres.programs, { first: first.pres.programs, last: last.pres.programs });
    check(sc, 'luzes constantes por perfil, sem duplicados', samples.every((s) => s.lightsTech === lights0 && s.lightsPres === samples[0].lightsPres), samples.map((s) => [s.lightsTech, s.lightsPres]));
    check(sc, 'a cena volta ao mesmo número de geometrias próprias (renderer.info só conta as já enviadas à GPU)', (await R(page, (r) => r.sceneGeometries())) === sceneGeo0, { before: sceneGeo0, after: await R(page, (r) => r.sceneGeometries()) });
    check(sc, 'a alternância não cria revisão nem altera a cena guardada', (await revision(page)) === r0 && (await stored(page)) === s0, { r0, r: await revision(page) });
    const cam1 = await R(page, (r) => r.camera());
    check(sc, 'câmara e selecção preservadas', JSON.stringify(cam1) === JSON.stringify(cam0) && (await page.evaluate(() => document.querySelector('#node-label')?.textContent)) === sel0 && !!sel0 && (await page.evaluate(() => !document.querySelector('#inspector').hidden)), { cam0, cam1 });
    check(sc, 'estado do botão coerente', (await pressed(page)).t === 'true', await pressed(page));
    // teclado
    await page.focus('#quality-presentation'); await page.keyboard.press('Enter'); await frames(page);
    check(sc, 'Enter no botão activa Apresentação', (await R(page, (r) => r.quality())) === 'presentation');
    await page.focus('#quality-technical'); await page.keyboard.press('Space'); await frames(page);
    check(sc, 'Espaço no botão activa Técnico', (await R(page, (r) => r.quality())) === 'technical');
    check(sc, 'sem erros na consola', errors.length === 0, errors);
    await page.context().close();
  }

  // ---------------------------------------------------------------- 2. remoção de parede em ambos os modos, bloqueio, cancelar, undo/redo
  {
    const sc = '2 remoção e undo/redo';
    const { page, errors } = await openEditor(plain);
    const r0 = await revision(page); const s0 = await stored(page);
    for (const quality of ['technical', 'presentation']) {
      await page.click(`#quality-${quality}`); await frames(page);
      await select(page, plain.meta.sharedWall);
      await page.click('#preview-remove-wall');
      check(sc, `[${quality}] o cartão de preview aparece`, await waitFor(page, () => { const c = document.querySelector('#removal-card'); return c && !c.hidden && c.querySelector('#removal-confirm'); }));
      await page.waitForTimeout(700);
      check(sc, `[${quality}] preview não altera revisão nem persistência`, (await revision(page)) === r0 && (await stored(page)) === s0);
      if (quality === 'technical') {
        await page.click('#quality-presentation'); await frames(page);
        check(sc, 'mudar de qualidade com o preview aberto mantém o cartão e não aplica', (await page.evaluate(() => !document.querySelector('#removal-card').hidden)) && (await revision(page)) === r0);
        await page.click('#quality-technical'); await frames(page);
      }
      if (quality === 'presentation') await shot(page, '03-preview-remocao-apresentacao');
      await page.click('#removal-cancel');
      await page.waitForTimeout(500);
      check(sc, `[${quality}] cancelar não altera nada`, (await revision(page)) === r0 && (await stored(page)) === s0);
    }
    const geoBefore = (await info(page)).geometries;
    // bloqueada
    await select(page, plain.meta.partialWall);
    await page.click('#preview-remove-wall');
    check(sc, 'remoção parcial é bloqueada', await waitFor(page, () => { const c = document.querySelector('#removal-card'); return c && !c.hidden && /bloqueada/.test(c.textContent); }));
    await shot(page, '04-remocao-bloqueada');
    await page.click('#removal-close');
    check(sc, 'bloqueio não altera a cena', (await revision(page)) === r0 && (await stored(page)) === s0);
    // sucesso
    await select(page, plain.meta.sharedWall);
    await page.click('#preview-remove-wall');
    await waitFor(page, () => document.querySelector('#removal-confirm'));
    await page.waitForTimeout(600);
    await page.click('#removal-confirm');
    check(sc, 'confirmar aplica uma revisão', await waitFor(page, () => /aplicada/.test(document.querySelector('#preview-status')?.textContent ?? '')) && (await revision(page)) === r0 + 1, await revision(page));
    await page.waitForTimeout(500);
    const afterTx = JSON.parse(await stored(page));
    check(sc, 'uma entrada de desfazer', afterTx.undoStack.length === 1, afterTx.undoStack.length);
    await shot(page, '05-remocao-aplicada');
    await page.$eval('#undo-scene', (e) => e.click()); await page.waitForTimeout(400);
    check(sc, 'desfazer repõe todos os nós (a revisão de desfazer é nova, por desenho)', JSON.stringify(JSON.parse(await stored(page)).scene.nodes) === JSON.stringify(JSON.parse(s0).scene.nodes), await revision(page));
    await page.$eval('#redo-scene', (e) => e.click()); await page.waitForTimeout(400);
    check(sc, 'refazer reaplica', JSON.stringify(JSON.parse(await stored(page)).scene.nodes) === JSON.stringify(afterTx.scene.nodes));
    const g = await info(page);
    check(sc, 'geometrias não crescem depois de remover/desfazer/refazer', g.geometries <= geoBefore + 4, { before: geoBefore, after: g.geometries });
    check(sc, 'sem erros na consola', errors.length === 0, errors);
    await page.context().close();
  }

  // ---------------------------------------------------------------- 3. exportação a partir do editor real
  {
    const sc = '3 exportação';
    const { page, errors } = await openEditor(plain);
    const s0 = await stored(page); const r0 = await revision(page);
    await select(page, plain.meta.sharedWall);
    await settle(page); const cam0 = await R(page, (r) => r.camera());
    await page.click('#quality-presentation'); await frames(page);
    const sizes = [['1920x1080', '1920x1080'], ['2560x1440', '2560x1440'], ...(process.env.UNFOLD_E2E_4K === '0' ? [] : [['3840x2160', '3840x2160']])];
    const exports = [];
    for (const [key] of sizes) {
      const before = await info(page);
      await page.click('#export-image');
      check(sc, `[${key}] o menu abre e o foco entra no menu`, await page.evaluate(() => !document.querySelector('#export-menu').hidden && document.activeElement?.closest('#export-menu') !== null));
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 180000 }), page.click(`[data-export="${key}"]`)]);
      const busyShown = await page.evaluate(() => document.querySelector('#export-card').dataset.state);
      const file = join(EXPORTS, download.suggestedFilename()); await download.saveAs(file);
      await waitFor(page, () => window.__unfoldLastExport, null, 60000);
      const last = await page.evaluate(() => window.__unfoldLastExport);
      const png = readFileSync(file); const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
      exports.push({ key, file, last, w, h, busyShown });
      check(sc, `[${key}] PNG real com o tamanho relatado`, w === last.report.actual.width && h === last.report.actual.height && png.length > 20000, { w, h, report: last.report.actual, bytes: png.length });
      check(sc, `[${key}] pedido ${key}, obtido ${w}x${h}${last.report.clamped ? ' (reduzido)' : ''}: o cartão diz a verdade`, await page.evaluate((c) => { const t = document.querySelector('#export-card').textContent; return c ? /não permitiu/.test(t) : !/não permitiu/.test(t); }, last.report.clamped));
      check(sc, `[${key}] ficheiro indica a qualidade e o tamanho reais`, download.suggestedFilename().includes('presentation') && download.suggestedFilename().includes(`${w}x${h}`), download.suggestedFilename());
      await page.waitForTimeout(500);
      const after = await info(page);
      check(sc, `[${key}] geometrias e texturas do editor inalteradas`, after.geometries === before.geometries && after.textures === before.textures, { before, after });
      await page.click('#export-close').catch(() => {});
      check(sc, `[${key}] botões voltam a estar activos`, await page.evaluate(() => !document.querySelector('#quality-technical').disabled && !document.querySelector('#export-image').disabled));
    }
    check(sc, 'a câmara do editor não mudou', JSON.stringify(await R(page, (r) => r.camera())) === JSON.stringify(cam0));
    check(sc, 'exportar não cria revisão nem altera a cena', (await revision(page)) === r0 && (await stored(page)) === s0);
    writeFileSync(join(OUT, 'exports.json'), JSON.stringify(exports.map((e) => ({ key: e.key, w: e.w, h: e.h, report: e.last.report, bytes: e.last.bytes, name: e.last.name })), null, 2));
    // cancelar a meio
    await page.click('#export-image');
    page.click(`[data-export="${sizes.at(-1)[0]}"]`).catch(() => {});
    await waitFor(page, () => document.querySelector('#export-card').dataset.state === 'busy');
    await page.click('#export-cancel');
    check(sc, 'cancelar a exportação devolve o editor ao normal', await waitFor(page, () => !document.querySelector('#export-image').disabled && document.querySelector('#export-card').dataset.state !== 'busy', null, 60000));
    const g1 = await info(page);
    await page.click('#quality-technical'); await frames(page, 5);
    check(sc, 'o editor volta a desenhar depois de cancelar', (await info(page)).calls > 0 && g1.geometries > 0);
    check(sc, 'a cena não mudou', (await stored(page)) === s0);
    check(sc, 'sem erros na consola', errors.length === 0, errors);
    await page.context().close();
  }

  // ---------------------------------------------------------------- 4. entrar/sair do editor e reconstruir repetidamente
  {
    const sc = '4 ciclo de vida';
    const ctx = await openEditor(plain);
    const { page, errors } = ctx;
    const counts = [];
    for (let i = 0; i < 4; i += 1) {
      await page.click('#quality-presentation'); await frames(page); await page.click('#quality-technical'); await frames(page);
      counts.push(await info(page));
      await page.goto(`${BASE}/demo?debug-rendering`);
      await page.waitForSelector('#demo-open-spatial');
      await page.click('#demo-open-spatial');
      await page.waitForSelector('#component-list [data-scene-node]', { timeout: 30000, state: 'attached' });
      await page.waitForFunction(() => window.__unfoldRendering);
      await page.waitForTimeout(500);
    }
    check(sc, 'entrar/sair 4 vezes não faz crescer geometrias (página nova de cada vez)', counts.every((c) => c.geometries === counts[0].geometries), counts.map((c) => c.geometries));
    check(sc, 'o editor reentra em Técnico', (await R(page, (r) => r.quality())) === 'technical');
    check(sc, 'sem erros na consola', errors.length === 0, errors);
    await page.context().close();
  }

  // ---------------------------------------------------------------- 5. teclado, foco visível e telemóvel
  {
    const sc = '5 teclado e móvel';
    const { page, errors } = await openEditor(plain, { width: 390, height: 844 });
    await page.keyboard.press('Tab');
    const focusStyle = await page.evaluate(() => { const b = document.querySelector('#quality-presentation'); b.focus(); const cs = getComputedStyle(b); return { outline: cs.outlineStyle, width: cs.outlineWidth, shadow: cs.boxShadow }; });
    check(sc, 'foco visível no botão de qualidade', focusStyle.outline !== 'none' || focusStyle.shadow !== 'none', focusStyle);
    const toolbar = await page.evaluate(() => { const t = document.querySelector('.spatial-toolbar'); const r = t.getBoundingClientRect(); return { right: r.right, left: r.left, vw: innerWidth, scrollW: t.scrollWidth, clientW: t.clientWidth, overflowX: getComputedStyle(t).overflowX }; });
    check(sc, 'a barra cabe no ecrã de 390 px (rola na horizontal se preciso)', toolbar.right <= toolbar.vw + 1 && toolbar.left >= -1 && (toolbar.scrollW <= toolbar.clientW || ['auto', 'scroll'].includes(toolbar.overflowX)), toolbar);
    check(sc, 'a página não rola na horizontal', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]));
    await page.focus('#export-image'); await page.keyboard.press('Enter');
    const menu = await page.evaluate(() => { const m = document.querySelector('#export-menu'); const r = m.getBoundingClientRect(); return { hidden: m.hidden, left: r.left, right: r.right, vw: innerWidth, active: document.activeElement?.dataset.export }; });
    check(sc, 'o menu de exportação abre com o teclado, dentro do ecrã, no primeiro item', !menu.hidden && menu.left >= 0 && menu.right <= menu.vw && menu.active === '1920x1080', menu);
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
    check(sc, 'setas percorrem os itens', (await page.evaluate(() => document.activeElement?.dataset.export)) === '3840x2160');
    await page.keyboard.press('Escape');
    check(sc, 'Escape fecha o menu e devolve o foco', await page.evaluate(() => document.querySelector('#export-menu').hidden && document.activeElement?.id === 'export-image'));
    await shot(page, '06-movel-390');
    const reduced = await browser.newContext({ viewport: { width: 1024, height: 768 }, reducedMotion: 'reduce' });
    const rp = await reduced.newPage(); const rerrors = [];
    rp.on('pageerror', (e) => rerrors.push(e.message));
    await rp.route('**/api/**', (route) => route.fulfill({ status: 404, body: 'null' }));
    await rp.goto(`${BASE}/demo?debug-rendering`); await rp.waitForSelector('#demo-open-spatial');
    await rp.evaluate((s) => localStorage.setItem('unfold-spatial-scene.v1', s), plain.text);
    await rp.click('#demo-open-spatial'); await rp.waitForSelector('#component-list [data-scene-node]', { timeout: 30000, state: 'attached' });
    await rp.waitForTimeout(500);
    await rp.click('#quality-presentation'); await rp.waitForTimeout(300);
    check(sc, 'movimento reduzido: troca de qualidade sem erros', rerrors.length === 0 && (await rp.evaluate(() => window.__unfoldRendering.quality())) === 'presentation', rerrors);
    await reduced.close();
    check(sc, 'sem erros na consola', errors.length === 0, errors);
    await page.context().close();
  }

  check('rede', 'nenhum pedido para fora de localhost', external.length === 0, external);
} finally {
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ at: new Date().toISOString(), passed: checks.length - failed.length, failed: failed.length, checks }, null, 2));
  console.log(`\n${checks.length - failed.length}/${checks.length} verificações passaram`);
  if (failed.length) process.exitCode = 1;
}
