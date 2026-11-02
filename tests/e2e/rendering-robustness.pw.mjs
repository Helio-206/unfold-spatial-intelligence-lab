// Regressões no browser para o PR do viewport arquitectónico:
//  A. exportação determinística: editar, desfazer/refazer, mudar a selecção, mexer na câmara e animar durante uma exportação em vários blocos
//     não pode alterar o PNG (comparado byte a byte com a mesma exportação sem interferência);
//  B. degradação por frames lentos: em Apresentação, com frames de >80 ms de forma sustentada, o monitor tem mesmo de baixar o custo.
//   npm i --no-save playwright-core@1.49.1
//   UNFOLD_API_TARGET=http://127.0.0.1:9 npx vite --port 5199 --strictPort &
//   node tests/e2e/rendering-robustness.pw.mjs
// Variáveis: UNFOLD_E2E_URL, UNFOLD_E2E_OUT (por omissão reports/rendering/integration/robustness), CHROME_PATH, UNFOLD_E2E_TILE (bloco, por omissão 256).
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BASE = process.env.UNFOLD_E2E_URL ?? 'http://127.0.0.1:5199';
const OUT = resolve(process.env.UNFOLD_E2E_OUT ?? 'reports/rendering/integration/robustness'); mkdirSync(OUT, { recursive: true });
const ONLY = process.env.UNFOLD_E2E_ONLY; // A | B
const SIZE = (process.env.UNFOLD_E2E_SIZE ?? '3840x2160').split('x').map(Number);
const TILE = Number(process.env.UNFOLD_E2E_TILE ?? 256);
const scratch = mkdtempSync(join(tmpdir(), 'unfold-e2e-robust-'));
const seedFile = join(scratch, 'seed.json');
execFileSync(resolve('node_modules/.bin/tsx'), ['tests/e2e/wall-removal-merge-seed.ts', seedFile], { stdio: 'ignore' });
const seed = { text: readFileSync(seedFile, 'utf8'), meta: JSON.parse(readFileSync(`${seedFile}.meta.json`, 'utf8')) };
const checks = []; const external = [];
function check(scenario, name, ok, observed) { checks.push({ scenario, name, ok: Boolean(ok), observed }); console.log(`${ok ? 'PASS' : 'FAIL'}  [${scenario}] ${name}${ok ? '' : `  -> ${JSON.stringify(observed)}`}`); }
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function openEditor() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/Failed to load resource|GPU stall|swiftshader|GL Driver Message/i.test(m.text())) errors.push(`${m.type()}: ${m.text()}`); });
  page.on('request', (r) => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname) && u.protocol.startsWith('http')) external.push(r.url()); });
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: 'null' }));
  await page.goto(`${BASE}/demo?debug-rendering`); await page.waitForSelector('#demo-open-spatial');
  await page.evaluate((s) => localStorage.setItem('unfold-spatial-scene.v1', s), seed.text);
  await page.click('#demo-open-spatial'); await page.waitForSelector('#component-list [data-scene-node]', { timeout: 30000, state: 'attached' });
  await page.waitForFunction(() => window.__unfoldRendering, null, { timeout: 10000 });
  await page.waitForTimeout(800); return { page, context, errors };
}
const R = (page, fn, arg) => page.evaluate(`(${fn})(window.__unfoldRendering, ${JSON.stringify(arg ?? null)})`);
const revision = (page) => page.evaluate(() => Number(/R(\d+)/.exec(document.querySelector('#scene-state')?.textContent ?? '')?.[1] ?? NaN));
const stored = (page) => page.evaluate(() => localStorage.getItem('unfold-spatial-scene.v1'));
const waitFor = (page, fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout }).then(() => true, () => false);
const domClick = (page, sel) => page.$eval(sel, (e) => e.click());
const settle = async (page) => { let prev = ''; for (let i = 0; i < 40; i += 1) { const now = JSON.stringify(await R(page, (r) => r.camera())); if (now === prev) return; prev = now; await page.waitForTimeout(500); } };
const hash = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);

async function exportOnce(page, tag, interfere) {
  await page.evaluate(() => { window.__unfoldLastExport = undefined; });
  const download = page.waitForEvent('download', { timeout: 240000 });
  await page.evaluate(([w, h, t]) => { window.__exportDone = window.__unfoldRendering.exportImage(w, h, t); }, [...SIZE, TILE]);
  const log = interfere ? await interfere() : null;
  const file = join(OUT, `${tag}.png`); await (await download).saveAs(file);
  await page.evaluate(() => window.__exportDone);
  return { file, bytes: readFileSync(file), log, last: await page.evaluate(() => window.__unfoldLastExport) };
}

try {
  // ------------------------------------------------------------------ A. exportação isolada
  if (!ONLY || ONLY === 'A') {
    const sc = 'A exportação isolada';
    const { page, errors, context } = await openEditor();
    await page.click('#quality-presentation'); await page.waitForTimeout(900);
    await domClick(page, '#iso-view'); await settle(page);
    const sel = `[data-scene-node="${seed.meta.sharedWall}"]`;
    await page.click(sel); await page.waitForSelector('#inspector:not([hidden])'); await settle(page);
    const s0 = await stored(page); const r0 = await revision(page); const cam0 = await R(page, (r) => r.camera());

    const base1 = await exportOnce(page, 'baseline-1');
    const base2 = await exportOnce(page, 'baseline-2');
    check(sc, `a exportação base é reprodutível (mesmo PNG duas vezes, ${base1.last.report.tiles} blocos)`, hash(base1.bytes) === hash(base2.bytes), [hash(base1.bytes), hash(base2.bytes)]);
    check(sc, 'a exportação tem vários blocos', base1.last.report.tiles >= 6, base1.last.report.tiles);

    const interfered = await exportOnce(page, 'interfered', async () => {
      const log = { actions: [] };
      const progressed = await waitFor(page, () => /\b[1-9]\d* de \d+ blocos/.test(document.querySelector('#export-text')?.textContent ?? ''), null, 60000);
      log.progressedBeforeEdit = progressed; log.cardAtStart = await page.evaluate(() => document.querySelector('#export-text')?.textContent);
      const busy = () => page.evaluate(() => document.querySelector('#export-card')?.dataset.state === 'busy');
      log.busy = {}; log.busy.start = await busy();
      const geo0 = await R(page, (r) => r.sceneGeometries());
      // 1. câmara e animação: salto e depois uma transição animada
      await R(page, (r) => r.view([-3, 14, 3], [4, 1, -1.5])); log.actions.push('view');
      await domClick(page, '#top-view'); log.actions.push('top-view (tween)');
      // 2. selecção: outro nó e depois limpar
      const other = await page.evaluate((id) => [...document.querySelectorAll('#component-list [data-scene-node]')].map((e) => e.dataset.sceneNode).find((n) => n !== id && n.startsWith('wall')), seed.meta.sharedWall);
      await page.$eval(`[data-scene-node="${other}"]`, (e) => e.click()); log.actions.push(`select ${other}`);
      // 3. edição real: pré-visualizar, cancelar, voltar a pré-visualizar e aplicar a remoção da parede partilhada (reconstrói a geometria)
      await page.$eval(sel, (e) => e.click()); await page.$eval('#preview-remove-wall', (e) => e.click());
      log.cardShown = await waitFor(page, () => document.querySelector('#removal-confirm'), null, 30000);
      await page.waitForTimeout(300); await page.$eval('#removal-cancel', (e) => e.click()); log.actions.push('preview+cancel');
      await page.$eval('#preview-remove-wall', (e) => e.click()); await waitFor(page, () => document.querySelector('#removal-confirm'), null, 30000);
      await page.waitForTimeout(300); log.busy.beforeApply = await busy(); await page.$eval('#removal-confirm', (e) => e.click()); log.actions.push('apply');
      await waitFor(page, () => /aplicada/.test(document.querySelector('#preview-status')?.textContent ?? ''), null, 30000);
      log.busy.afterApply = await busy(); log.revisionAfterApply = await revision(page); log.geometriesAfterApply = await R(page, (r) => r.sceneGeometries());
      // 4. desfazer e refazer
      await domClick(page, '#undo-scene'); await page.waitForTimeout(300); log.revisionAfterUndo = await revision(page);
      await domClick(page, '#redo-scene'); await page.waitForTimeout(300); log.revisionAfterRedo = await revision(page); log.actions.push('undo', 'redo');
      log.stillExporting = await busy();
      log.geo0 = geo0; log.cameraDuring = await R(page, (r) => r.camera());
      return log;
    });
    const L = interfered.log;
    check(sc, 'a edição foi aplicada com a exportação a meio (blocos já feitos, ainda a decorrer antes e depois de aplicar)', L.progressedBeforeEdit && L.busy.start && L.busy.beforeApply && L.busy.afterApply, L.busy);
    check(sc, 'a cena mudou de verdade durante a exportação (revisões)', L.revisionAfterApply > r0 && L.revisionAfterUndo !== L.revisionAfterApply && L.revisionAfterRedo > r0, L);
    check(sc, 'a câmara do editor mudou durante a exportação', JSON.stringify(L.cameraDuring) !== JSON.stringify(cam0), [cam0, L.cameraDuring]);
    check(sc, 'o PNG exportado é idêntico ao da exportação sem interferência (todos os blocos do mesmo estado)', hash(interfered.bytes) === hash(base1.bytes), [hash(interfered.bytes), hash(base1.bytes)]);
    check(sc, 'o relatório descreve o mesmo tamanho e blocos', JSON.stringify(interfered.last.report.actual) === JSON.stringify(base1.last.report.actual) && interfered.last.report.tiles === base1.last.report.tiles);
    check(sc, 'o cartão acaba em «exportada», sem erro', await page.evaluate(() => document.querySelector('#export-card')?.dataset.state === 'done'));
    check(sc, 'depois da exportação o editor continua a responder e os botões voltam', await page.evaluate(() => !document.querySelector('#quality-technical').disabled && !document.querySelector('#export-image').disabled));
    check(sc, 'sem erros na consola', errors.length === 0, errors);
    await context.close();
  }

  // ------------------------------------------------------------------ B. degradação por frames lentos
  if (!ONLY || ONLY === 'B') {
    const sc = 'B degradação';
    const { page, errors, context } = await openEditor();
    check(sc, 'o editor arranca em Técnico e Técnico nunca degrada', (await R(page, (r) => r.quality())) === 'technical' && (await R(page, (r) => r.degrade())) === 0);
    await page.click('#quality-presentation'); await page.waitForTimeout(900);
    const bench = await R(page, (r) => r.benchmark(10));
    check(sc, 'ponto de partida: frames de Apresentação acima de 80 ms neste dispositivo (software)', bench.meanMs > 80, bench.meanMs);
    const p0 = await R(page, (r) => r.profile());
    // rodar a vista com o rato: cada movimento pede um frame de ~100 a 250 ms
    const box = await page.locator('#spatial-canvas').boundingBox();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.4); await page.mouse.down();
    const reached = {}; let moves = 0; const t0 = Date.now();
    while (!(reached[2])) {
      moves += 1; await page.waitForTimeout(30); await page.mouse.move(box.x + box.width * (0.6 + 0.0015 * (moves % 40)), box.y + box.height * (0.4 + 0.001 * (moves % 30)));
      const level = await R(page, (r) => r.degrade());
      if (level >= 1 && !reached[1]) reached[1] = { moves, ms: Date.now() - t0 }; if (level >= 2 && !reached[2]) reached[2] = { moves, ms: Date.now() - t0 };
      if (Date.now() - t0 > 150000) break;
    }
    await page.mouse.up();
    check(sc, 'frames lentos sustentados (>80 ms) fazem descer um nível: sombras mais leves', Boolean(reached[1]), { reached, moves });
    const p1 = await R(page, (r) => r.profile());
    check(sc, 'o perfil aplicado baixou mesmo o custo (mapa de sombras mais pequeno)', reached[1] && p1.shadowMapSize < p0.shadowMapSize, [p0.shadowMapSize, p1.shadowMapSize]);
    check(sc, 'depois do cooldown desce o segundo nível: sem sombras', Boolean(reached[2]) && (await R(page, (r) => r.profile())).shadows === false, { reached });
    check(sc, 'o aviso é mostrado ao utilizador', /este dispositivo est/i.test(await page.evaluate(() => document.querySelector('#spatial-status')?.textContent ?? '')));
    // sem oscilação: mais movimento não volta a subir nem a descer além de 2
    for (let i = 0; i < 12; i += 1) { await page.mouse.move(box.x + 200 + i * 5, box.y + 200); }
    check(sc, 'sem oscilação: fica no nível 2', (await R(page, (r) => r.degrade())) === 2);
    // não degrada por inactividade
    const fresh = await openEditor();
    await fresh.page.click('#quality-presentation'); await fresh.page.waitForTimeout(12000);
    check(sc, 'inactividade não degrada', (await R(fresh.page, (r) => r.degrade())) === 0);
    // trocar de perfil repõe, e Técnico continua o perfil por omissão
    await page.click('#quality-technical'); await page.waitForTimeout(500); await page.click('#quality-presentation'); await page.waitForTimeout(500);
    check(sc, 'voltar a escolher Apresentação repõe o perfil do dispositivo', (await R(page, (r) => r.degrade())) === 0 && (await R(page, (r) => r.profile())).shadowMapSize === p0.shadowMapSize);
    check(sc, 'sem erros na consola', errors.length === 0 && fresh.errors.length === 0, [...errors, ...fresh.errors]);
    await fresh.context.close(); await context.close();
  }
  check('rede', 'nenhum pedido para fora de localhost', external.length === 0, external);
} finally {
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ at: new Date().toISOString(), passed: checks.length - failed.length, failed: failed.length, checks }, null, 2));
  console.log(`\n${checks.length - failed.length}/${checks.length} verificações passaram`);
  if (failed.length) process.exitCode = 1;
}
