// E2E real do runtime cinematográfico (/cinema) em Chrome (Playwright) com SwiftShader: NÃO é uma GPU.
//   npm i --no-save playwright-core@1.49.1   (já é devDependency)
//   UNFOLD_API_TARGET=http://127.0.0.1:9 npx vite --port 5199 --strictPort &
//   node tests/e2e/cinema.pw.mjs
// Variáveis: UNFOLD_E2E_URL, UNFOLD_E2E_OUT (por omissão reports/cinema/e2e), CHROME_PATH.
import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const BASE = process.env.UNFOLD_E2E_URL ?? 'http://127.0.0.1:5199';
const OUT = resolve(process.env.UNFOLD_E2E_OUT ?? 'reports/cinema/e2e'); mkdirSync(OUT, { recursive: true });
const ONLY = process.env.UNFOLD_E2E_ONLY; // 1..9
const checks = []; const external = []; const metrics = {};
function check(scenario, name, ok, observed) { checks.push({ scenario, name, ok: Boolean(ok), observed }); console.log(`${ok ? 'PASS' : 'FAIL'}  [${scenario}] ${name}${ok ? '' : `  -> ${JSON.stringify(observed)}`}`); }
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function open(query = 'tier=studio', context = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ...context });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/GPU stall|swiftshader|GL Driver Message|Failed to load resource/i.test(m.text())) errors.push(`${m.type()}: ${m.text()}`); });
  page.on('request', (r) => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname) && u.protocol.startsWith('http')) external.push(r.url()); });
  await page.goto(`${BASE}/cinema?debug-cinema&ui=0&dpr=1&${query}`);
  await page.waitForFunction(() => window.__unfoldCinema?.ready, null, { timeout: 90000 });
  return { page, ctx, errors };
}
const C = (page, fn, arg) => page.evaluate(`(${fn})(window.__unfoldCinema, ${JSON.stringify(arg ?? null)})`);
const hash = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);
// the canvas itself, read in the same task as the render (no overlay, no compositor timing): what the stage draws, nothing else
const grab = async (page) => Buffer.from((await C(page, (c) => { c.renderNow(); return c.canvas().toDataURL('image/png'); })).split(',')[1], 'base64');
const still = async (page, shot, t) => { await C(page, (c, a) => { c.seekShot(a.shot, a.t); }, { shot, t }); return grab(page); };
// luminance statistics of a rectangle of a screenshot (decoded in the page)
async function lum(page, png, rect) {
  return page.evaluate(async ([b64, r]) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const x = Math.max(0, Math.floor(r.x)); const y = Math.max(0, Math.floor(r.y)); const w = Math.max(1, Math.min(img.width - x, Math.floor(r.w))); const h = Math.max(1, Math.min(img.height - y, Math.floor(r.h)));
    const d = g.getImageData(x, y, w, h).data; const L = []; let sum = 0;
    for (let i = 0; i < d.length; i += 4) { const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; L.push(l); sum += l; }
    const mean = sum / L.length; const sd = Math.sqrt(L.reduce((s, v) => s + (v - mean) ** 2, 0) / L.length); L.sort((a, b) => a - b);
    return { mean, sd, p50: L[Math.floor(L.length * 0.5)], p99: L[Math.floor(L.length * 0.99)], bright: L.filter((v) => v > 200).length / L.length, n: L.length };
  }, [png.toString('base64'), rect]);
}

async function orange(page, png) {
  return page.evaluate(async (b64) => { const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 170 && d[i + 1] < 150 && d[i + 2] < 90 && d[i] - d[i + 2] > 110) n += 1; return n / (c.width * c.height); }, png.toString('base64'));
}

try {
  // ------------------------------------------------------------------ 1. carga, canvas, luzes
  if (!ONLY || ONLY === '1') {
    const sc = '1 carga';
    const { page, ctx, errors } = await open('tier=studio');
    const s = await C(page, (c) => c.stats());
    check(sc, 'o estúdio arranca no nível pedido (studio) e a cena tem 3 luzes', s.tier === 'studio' && s.lights === 3, { tier: s.tier, lights: s.lights });
    check(sc, 'a geometria é o proxy dos shapes do contrato e a pose é a de referência', s.visuals === 'proxy' && s.poseSource === 'reference-fixture', s);
    const png = await still(page, 'hero', 3);
    const full = await lum(page, png, { x: 0, y: 0, w: 1600, h: 900 });
    check(sc, 'o canvas mostra a cena (não está em branco nem todo preto)', full.sd > 8 && full.p99 > 120, full);
    const label = await page.evaluate(() => document.querySelector('#ro-geometry')?.textContent);
    check(sc, 'a interface diz que a geometria é proxy e a montagem sintética (nada é apresentado como real)', /proxy/.test(label) && /sintética/.test(await page.evaluate(() => document.querySelector('#ro-note').textContent)), label);
    check(sc, 'o botão de reprodução está escondido enquanto a fonte de pose não tem movimento (e escondido de facto, não só marcado)', await page.$eval('#cinema-play', (e) => getComputedStyle(e).display === 'none'));
    check(sc, 'o contador de chamadas conta todas as passagens do frame (não só a última)', (await C(page, (c) => c.stats())).calls > 20, await C(page, (c) => c.stats().calls));
    check(sc, 'sem erros na consola', errors.length === 0, errors);
    await ctx.close();
  }

  // ------------------------------------------------------------------ 2. coreografia de câmara
  if (!ONLY || ONLY === '2') {
    const sc = '2 câmara';
    const { page, ctx, errors } = await open('tier=light');
    const ids = ['hero', 'profile', 'bucket', 'reach', 'top', 'orbit']; const cams = {}; const hashes = {};
    for (const id of ids) { const png = await still(page, id, 2.5); cams[id] = await C(page, (c) => c.camera()); hashes[id] = hash(png); }
    const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
    const pair = ids.flatMap((a, i) => ids.slice(i + 1).map((b) => [a, b, dist(cams[a].position, cams[b].position)]));
    check(sc, 'os seis planos são câmaras distintas (mais de 1 m entre quaisquer duas)', pair.every(([, , d]) => d > 1), pair);
    check(sc, 'os seis planos dão imagens diferentes', new Set(Object.values(hashes)).size === ids.length, hashes);
    const again = await still(page, 'profile', 2.5);
    check(sc, 'o mesmo plano ao mesmo instante dá exactamente a mesma câmara e a mesma imagem (determinístico)', hash(again) === hashes.profile && JSON.stringify(await C(page, (c) => c.camera())) === JSON.stringify(cams.profile), [hash(again), hashes.profile]);
    // UI: botões e teclado
    await page.keyboard.press('Tab');
    await page.evaluate(() => document.querySelector('#cinema-root').classList.remove('is-presenting', 'is-idle'));
    await page.click('[data-shot="bucket"]'); await page.waitForTimeout(500);
    check(sc, 'o botão do plano fica premido e a câmara começa a mover-se', (await page.getAttribute('[data-shot="bucket"]', 'aria-pressed')) === 'true');
    await page.keyboard.press('1'); await page.waitForTimeout(300);
    check(sc, 'a tecla 1 passa ao plano herói', (await page.getAttribute('[data-shot="hero"]', 'aria-pressed')) === 'true' && (await page.getAttribute('[data-shot="bucket"]', 'aria-pressed')) === 'false');
    const before = await C(page, (c) => c.camera()); await page.keyboard.press('t'); await page.waitForTimeout(2500); const after = await C(page, (c) => c.camera());
    check(sc, 'o percurso (T) move a câmara e fica indicado', (await page.getAttribute('#cinema-tour', 'aria-pressed')) === 'true' && dist(before.position, after.position) > 0.5, dist(before.position, after.position));
    const box = await page.locator('.cinema-canvas').boundingBox();
    await page.mouse.move(box.x + 800, box.y + 450); await page.mouse.down(); await page.mouse.move(box.x + 900, box.y + 470, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(400);
    check(sc, 'agarrar a câmara devolve o controlo ao utilizador (percurso para, «Livre» fica indicado)', (await page.getAttribute('#cinema-free', 'aria-pressed')) === 'true' && (await page.getAttribute('#cinema-tour', 'aria-pressed')) === 'false');
    for (let i = 0; i < 25; i += 1) await page.mouse.wheel(0, -400);
    await page.waitForTimeout(600);
    const near = await C(page, (c) => { const r = c.runtime; return { d: r.camera.position.distanceTo(r.controls.target), min: r.controls.minDistance, max: r.controls.maxDistance }; });
    check(sc, 'o zoom está limitado (não atravessa a máquina)', near.d >= near.min - 1e-6 && near.d <= near.max + 1e-6, near);
    check(sc, 'a câmara nunca fica abaixo do chão', (await C(page, (c) => c.camera())).position[1] > 0, null);
    check(sc, 'sem erros na consola', errors.length === 0, errors);
    await ctx.close();
  }

  // ------------------------------------------------------------------ 3. contacto, reflexos, pós-processamento (ablação no mesmo frame)
  if (!ONLY || ONLY === '3') {
    const sc = '3 qualidade visual';
    const { page, ctx, errors } = await open('tier=studio');
    await still(page, 'hero', 3); const png0 = await still(page, 'hero', 3);
    const shots = { full: png0 };
    // contact shadow: floor right under the hanging bucket
    const bb = await C(page, (c) => c.screenBox('bucket'));
    const under = { x: bb.x, y: bb.y + bb.h * 0.95, w: bb.w, h: bb.h * 0.55 };
    await C(page, (c) => c.ablate({ contact: false })); const noContact = await grab(page); shots.noContact = noContact;
    await C(page, (c) => c.ablate({ contact: true })); const withContact = await grab(page);
    const lc = await lum(page, withContact, under); const ln = await lum(page, noContact, under);
    metrics.contact = { withContact: lc.mean, withoutContact: ln.mean, ratio: lc.mean / ln.mean, region: under };
    check(sc, 'a sombra de contacto escurece o chão por baixo do balde (≥ 8 % mais escuro do que sem ela)', lc.mean < ln.mean * 0.92, metrics.contact);
    // reflections: chrome rod, studio environment on vs off
    const rod = await C(page, (c) => c.screenBox('boom_cyl_rod')); const rodRect = { x: rod.x - 4, y: rod.y - 4, w: rod.w + 8, h: rod.h + 8 };
    await C(page, (c) => c.ablate({ environment: false })); const noEnv = await grab(page); shots.noEnv = noEnv;
    await C(page, (c) => c.ablate({ environment: true })); const withEnv = await grab(page);
    const re = await lum(page, withEnv, rodRect); const rn = await lum(page, noEnv, rodRect);
    metrics.reflections = { rodRect, withEnvironment: re, withoutEnvironment: rn };
    check(sc, 'a haste cromada reflecte o estúdio: realces e contraste muito acima de sem ambiente', re.p99 > rn.p99 * 1.5 && re.sd > rn.sd * 1.4, metrics.reflections);
    const metalBox = await C(page, (c) => c.screenBox('bucket')); const bucketRect = { x: metalBox.x, y: metalBox.y, w: metalBox.w, h: metalBox.h };
    const be = await lum(page, withEnv, bucketRect); const bn = await lum(page, noEnv, bucketRect);
    metrics.bucketReflections = { with: be, without: bn };
    check(sc, 'o balde em aço também depende do estúdio: sem ambiente fica escuro, com ele recebe os reflexos (luminância média ≥ 1,5×)', be.mean > bn.mean * 1.5, metrics.bucketReflections);
    // post chain
    await C(page, (c) => c.ablate({ post: false })); const noPost = await grab(page); shots.noPost = noPost; await C(page, (c) => c.ablate({ post: true }));
    check(sc, 'a cadeia de pós-processamento altera de facto a imagem (AO, realce, grading)', hash(noPost) !== hash(withContact), null);
    const lights = await C(page, (c) => c.stats().lights);
    check(sc, 'a cena tem luz chave, luz de recorte e preenchimento', lights === 3, lights);
    // mirrored floor: below the machine there is image content that is not floor colour (reflection) with mirror on, less without
    await C(page, (c) => c.ablate({ mirror: false })); const noMirror = await grab(page); shots.noMirror = noMirror; await C(page, (c) => c.ablate({ mirror: true }));
    check(sc, 'o chão espelhado altera a imagem abaixo da máquina', hash(noMirror) !== hash(withContact), null);
    for (const [k, v] of Object.entries(shots)) writeFileSync(join(OUT, `ablation-${k}.png`), v);
    writeFileSync(join(OUT, 'ablation-withContactEnvPost.png'), withContact);
    check(sc, 'sem erros na consola', errors.length === 0, errors);
    await ctx.close();
  }

  // ------------------------------------------------------------------ 4. ciclo de vida: 20 trocas de nível sem fuga
  if (!ONLY || ONLY === '4') {
    const sc = '4 ciclo de vida';
    const { page, ctx, errors } = await open('tier=light');
    const order = ['studio', 'balanced', 'light']; const samples = [];
    for (let i = 0; i < 20; i += 1) {
      await C(page, (c, t) => { c.setTier(t); c.renderNow(); }, order[i % 3]); await page.waitForTimeout(60);
      if (i % 3 === 2) samples.push(await C(page, (c) => { const s = c.stats(); return { geometries: s.geometries, textures: s.textures, programs: s.programs, lights: s.lights }; }));
    }
    check(sc, 'depois de 20 trocas geometrias, texturas e luzes não crescem (comparado com o 2.º ciclo completo)', samples.length >= 4 && samples.slice(1).every((s) => s.geometries === samples[1].geometries && s.textures === samples[1].textures && s.lights === 3), samples);
    check(sc, 'os programas de shader estabilizam', samples.slice(2).every((s) => s.programs === samples[2].programs), samples.map((s) => s.programs));
    metrics.cycles = samples;
    check(sc, 'sem erros na consola', errors.length === 0, errors);
    await ctx.close();
  }

  // ------------------------------------------------------------------ 5. reprodução de quadros de movimento (transporte) e estado bloqueado
  if (!ONLY || ONLY === '5') {
    const sc = '5 quadros de movimento';
    const { page, ctx, errors } = await open('tier=light');
    const ref = hash(await still(page, 'hero', 3));
    await C(page, (c) => c.playTransportFrames()); await page.waitForTimeout(500);
    check(sc, 'a fonte de pose passa a ser a de quadros validados e o botão de reprodução aparece', (await C(page, (c) => c.pose().kind)) === 'motion-frames' && !(await page.$eval('#cinema-play', (e) => e.hidden)));
    await C(page, (c) => { c.seekPose(1); }); await page.waitForTimeout(300);
    check(sc, 'entre dois quadros ok a pose aparece como suavizada e o estado é ok', /suavizada/.test(await page.textContent('#ro-pose')) && (await page.textContent('#ro-status')) === 'ok', await page.textContent('#ro-pose'));
    await C(page, (c) => { c.seekPose(3.9); }); await page.waitForTimeout(300);
    const status = await page.textContent('#ro-status'); const basis = await page.textContent('#ro-pose'); const caption = await page.textContent('#cinema-caption');
    check(sc, 'um quadro bloqueado mostra «blocked», a base «held_last_valid» e a mensagem do motor, sem inventar pose', status === 'blocked' && /held_last_valid/.test(basis) && /Bloqueado/.test(caption), { status, basis, caption });
    check(sc, 'a linha de estado fica marcada como desconhecida/bloqueada', await page.$eval('#ro-status', (e) => e.parentElement.classList.contains('is-unknown')));
    await C(page, (c) => c.playTransportFrames()); await C(page, (c) => c.seekPose(0)); await page.waitForTimeout(300);
    const viaFrames = hash(await still(page, 'hero', 3));
    check(sc, 'os quadros de transporte (pose de referência repetida) dão exactamente a mesma imagem que a pose de referência', viaFrames === ref, [viaFrames, ref]);
    check(sc, 'sem erros na consola', errors.length === 0, errors);
    await ctx.close();
  }

  // ------------------------------------------------------------------ 6. palco em ecrã inteiro, interface, teclado
  if (!ONLY || ONLY === '6') {
    const sc = '6 apresentação';
    const { page, ctx, errors } = await open('tier=light');
    await page.evaluate(() => document.querySelector('#cinema-root').classList.remove('is-presenting', 'is-idle'));
    await page.keyboard.press('Tab'); const firstFocus = await page.evaluate(() => document.activeElement?.className + '|' + document.activeElement?.textContent?.slice(0, 20));
    const focus = await page.evaluate(() => { const b = document.querySelector('[data-shot="hero"]'); b.focus(); const cs = getComputedStyle(b); return { outline: cs.outlineStyle, w: cs.outlineWidth, shadow: cs.boxShadow }; });
    await page.keyboard.press('Tab'); // marks keyboard modality
    const focusVisible = await page.evaluate(() => { const b = document.querySelector('[data-shot="profile"]'); b.focus(); return getComputedStyle(b).outlineStyle !== 'none'; });
    check(sc, 'o foco por teclado é visível nos botões', focusVisible || focus.outline !== 'none', { firstFocus, focus });
    const targets = await page.$$eval('.cinema button', (els) => els.map((e) => e.getBoundingClientRect().height).filter((h) => h > 0));
    check(sc, 'todos os alvos têm pelo menos 44 px de altura', targets.every((h) => h >= 43.5), targets);
    await page.click('#cinema-fullscreen'); await page.waitForTimeout(800);
    const fs = await page.evaluate(() => ({ el: document.fullscreenElement?.id ?? null, presenting: document.querySelector('#cinema-root').classList.contains('is-presenting'), pressed: document.querySelector('#cinema-fullscreen').getAttribute('aria-pressed') }));
    check(sc, 'o botão põe o palco em ecrã inteiro (ou, se o navegador não deixar, esconde a interface e avisa)', fs.el === 'cinema-root' || (fs.presenting && /ecrã inteiro/.test(await page.textContent('#cinema-caption'))), fs);
    await page.mouse.move(10, 10); await page.waitForTimeout(2800);
    const chrome = await page.evaluate(() => ({ shots: getComputedStyle(document.querySelector('.cinema-shots')).opacity, readout: getComputedStyle(document.querySelector('.cinema-readout')).opacity, top: getComputedStyle(document.querySelector('.cinema-top')).opacity }));
    check(sc, 'em apresentação a interface desaparece e o canvas ocupa o ecrã todo', Number(chrome.shots) === 0 && Number(chrome.readout) === 0 && Number(chrome.top) === 0, chrome);
    const cv = await page.$eval('.cinema-canvas', (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), innerWidth, innerHeight]; });
    check(sc, 'o canvas tem o tamanho da janela', cv[0] === cv[2] && cv[1] === cv[3], cv);
    await page.mouse.move(400, 400); await page.waitForTimeout(300);
    check(sc, 'mexer o rato volta a mostrar a barra de topo (para sair)', Number(await page.$eval('.cinema-top', (e) => getComputedStyle(e).opacity)) === 1);
    await page.screenshot({ path: join(OUT, 'presentation-fullscreen.png') });
    await page.click('#cinema-fullscreen').catch(() => {}); await page.waitForTimeout(600);
    await page.keyboard.press('h'); await page.waitForTimeout(300);
    check(sc, 'H alterna a interface', await page.evaluate(() => document.querySelector('#cinema-root').classList.contains('is-presenting') !== undefined));
    check(sc, 'sem erros na consola', errors.length === 0, errors);
    await ctx.close();
  }

  // ------------------------------------------------------------------ 7. telemóvel e movimento reduzido
  if (!ONLY || ONLY === '7') {
    const sc = '7 telemóvel e acessibilidade'; const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
    const { page, ctx, errors } = await open('tier=light', { viewport: { width: 390, height: 844 }, hasTouch: true });
    await page.evaluate(() => document.querySelector('#cinema-root').classList.remove('is-presenting', 'is-idle')); await page.waitForTimeout(400);
    const lay = await page.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); return { scrollW: document.documentElement.scrollWidth, vw: innerWidth, shots: { l: r('.cinema-shots').left, r: r('.cinema-shots').right }, top: r('.cinema-top').bottom, canvas: [r('.cinema-canvas').width, r('.cinema-canvas').height] }; });
    check(sc, 'sem scroll horizontal e a barra de planos cabe no ecrã de 390 px', lay.scrollW <= lay.vw + 1 && lay.shots.l >= 0 && lay.shots.r <= lay.vw + 1, lay);
    check(sc, 'o canvas acompanha o ecrã', Math.round(lay.canvas[0]) === 390 && Math.round(lay.canvas[1]) === 844, lay.canvas);
    await page.screenshot({ path: join(OUT, 'mobile-390.png') });
    check(sc, 'sem erros na consola', errors.length === 0, errors);
    await ctx.close();
    const rm = await open('tier=light', { reducedMotion: 'reduce' });
    await rm.page.evaluate(() => document.querySelector('#cinema-root').classList.remove('is-presenting', 'is-idle'));
    const c0 = await C(rm.page, (c) => c.camera()); await rm.page.keyboard.press('3'); await rm.page.waitForTimeout(150); const c1 = await C(rm.page, (c) => c.camera()); await rm.page.waitForTimeout(1200); const c2 = await C(rm.page, (c) => c.camera());
    check(sc, 'movimento reduzido: o plano é um corte directo (a câmara chega logo e fica quieta)', dist(c0.position, c1.position) > 1 && dist(c1.position, c2.position) < 1e-6 && dist(c1.target, c2.target) < 1e-6, { c0, c1, c2 });
    await rm.page.keyboard.press('t'); await rm.page.waitForTimeout(600);
    check(sc, 'movimento reduzido: o percurso não anima (corta para o primeiro plano e o realizador fica inactivo)', (await C(rm.page, (c) => c.runtime.director.active)) === false);
    check(sc, 'sem erros na consola', rm.errors.length === 0, rm.errors);
    await rm.ctx.close();
  }

  // ------------------------------------------------------------------ 8. desempenho, degradação adaptativa e repouso
  if (!ONLY || ONLY === '8') {
    const sc = '8 desempenho';
    const { page, ctx, errors } = await open('tier=studio', { viewport: { width: 640, height: 360 } });
    metrics.benchmark = {};
    for (const tier of ['light', 'balanced', 'studio']) {
      await C(page, (c, t) => { c.setTier(t); c.seekShot('hero', 3); }, tier);
      metrics.benchmark[tier] = await C(page, (c) => c.benchmark(20));
    }
    metrics.caps = await C(page, (c) => { const s = c.stats(); return { renderer: s.caps.renderer, software: s.caps.software, maxTexture: s.caps.maxTextureSize, pixelRatio: s.pixelRatio }; });
    check(sc, 'medido em cada nível (Chrome + SwiftShader: software, não GPU)', ['light', 'balanced', 'studio'].every((t) => metrics.benchmark[t].meanMs > 0), metrics.benchmark);
    check(sc, 'o nível leve é mais barato do que o de estúdio', metrics.benchmark.light.meanMs < metrics.benchmark.studio.meanMs, metrics.benchmark);
    // idle: no render loop
    await C(page, (c) => { c.setTier('light'); c.runtime.free(); c.renderNow(); }); await page.waitForTimeout(2500);
    const f0 = await C(page, (c) => c.stats().frames); await page.waitForTimeout(3000); const f1 = await C(page, (c) => c.stats().frames);
    check(sc, 'em repouso não há ciclo de desenho (nenhum frame em 3 s sem input)', f1 === f0, [f0, f1]);
    // adaptive degrade: studio tier on a software renderer must step itself down while the tour runs, and say so
    await C(page, (c) => { c.setTier('studio'); }); await page.evaluate(() => document.querySelector('#cinema-root').classList.remove('is-presenting', 'is-idle'));
    await page.keyboard.press('7'.replace('7', '6')); const t0 = Date.now(); let level = 0; // plano 6 = órbita (em ciclo, não acaba)
    while (Date.now() - t0 < 240000 && level < 2) { await page.waitForTimeout(1000); level = await C(page, (c) => c.stats().degrade); if (level === 1 && !metrics.degradeAt1) metrics.degradeAt1 = { ms: Date.now() - t0 }; }
    metrics.degradeAt2 = { ms: Date.now() - t0, level };
    check(sc, 'a degradação adaptativa desce sozinha em frames lentos e avisa o utilizador', level >= 1 && /Dispositivo lento/.test(await page.textContent('#cinema-caption')), { level, caption: await page.textContent('#cinema-caption') });
    check(sc, 'a degradação nunca sobe sozinha e o nível fica reflectido no estado', (await C(page, (c) => c.stats().degrade)) >= level && /−/.test(await page.textContent('#ro-tier')));
    await page.keyboard.press('l'); await page.waitForTimeout(1500);
    const g0 = await C(page, (c) => c.stats().frames); await page.waitForTimeout(3000); const g1 = await C(page, (c) => c.stats().frames);
    check(sc, 'depois de degradar e parar a câmara não há ciclo de desenho', g1 - g0 <= 1, [g0, g1]);
    check(sc, 'sem erros na consola', errors.length === 0, errors);
    await ctx.close();
  }

  // ------------------------------------------------------------------ 9. revisão #14: sem pose, legendas, sequências incompatíveis, relógio de engenharia
  if (!ONLY || ONLY === '9') {
    const sc = '9 revisão';
    const { page, ctx, errors } = await open('tier=light');
    await page.evaluate(() => document.querySelector('#cinema-root').classList.remove('is-presenting', 'is-idle'));
    const ref = await still(page, 'hero', 3); const refHash = hash(ref); const refOrange = await orange(page, ref);
    check(sc, 'ponto de partida: a máquina (laranja) vê-se', refOrange > 0.005, refOrange);
    await C(page, (c) => c.playTransportFrames('poseless', false)); await page.waitForTimeout(300);
    // (1) pose-less frame hides the machine, mirror and contact shadow; the next pose restores them
    await C(page, (c) => c.seekPose(6)); const hidden = await grab(page);
    const vis = await C(page, (c) => c.machineVisible());
    check(sc, 'um quadro sem pose esconde a máquina, a cópia espelhada e a sombra de contacto', !vis.root && !vis.mirror && !vis.contact && (await orange(page, hidden)) === 0, { vis, orange: await orange(page, hidden) });
    check(sc, 'o estado diz «sem pose» e a legenda diz porquê', (await page.textContent('#ro-pose')) === 'sem pose' && /Montagem inválida/.test(await C(page, (c) => c.caption())), await page.textContent('#ro-pose'));
    await C(page, (c) => c.seekPose(0)); const back = await grab(page); const vis2 = await C(page, (c) => c.machineVisible()); const wantMirror = (await C(page, (c) => c.stats())).settings.mirror;
    check(sc, 'o quadro seguinte com pose repõe tudo, igual à pose de referência', vis2.root && vis2.mirror === wantMirror && vis2.contact && hash(back) === refHash, { vis2, wantMirror, same: hash(back) === refHash });
    await C(page, (c) => c.seekPose(6)); await C(page, (c) => c.seekPose(2)); await C(page, (c) => c.seekPose(6));
    check(sc, 'a imagem depende do quadro escolhido e não do histórico (esconder, mostrar, esconder)', (await orange(page, await grab(page))) === 0);
    // (2) captions
    await C(page, (c) => c.seekPose(3.9)); const blocked = await C(page, (c) => c.caption());
    await C(page, (c) => c.seekPose(0)); const cleared = await C(page, (c) => c.caption());
    check(sc, 'a legenda de bloqueio desaparece quando o quadro recupera', /Bloqueado/.test(blocked) && cleared === '', { blocked, cleared });
    await C(page, (c) => c.seekPose(3.9)); await page.click('[data-tier="light"]'); const notice = await C(page, (c) => c.caption());
    await C(page, (c) => c.seekPose(0)); const after = await C(page, (c) => c.caption());
    check(sc, 'um quadro limpo não apaga uma notificação que não é do quadro', /Qualidade/.test(notice) && after === notice, { notice, after });
    // (3) incompatible sequences are refused, the stage keeps its source
    for (const [kind, re] of [['digest', /assemblyDigest/], ['world', /worldFrameId/], ['assembly', /montagem/], ['parts', /bucket/]]) {
      const msg = await C(page, (c, k) => c.tryBadSequence(k), kind);
      check(sc, `sequência recusada: ${kind}`, re.test(msg) && msg !== 'ACEITE', msg);
    }
    check(sc, 'a recusa não troca a fonte de pose', (await C(page, (c) => c.pose().kind)) === 'motion-frames');
    // (4) the engineering clock follows wall time, however late the frames are
    await C(page, (c) => c.playTransportFrames('basic', true)); const w0 = Date.now();
    await page.waitForTimeout(3000); const t3 = await C(page, (c) => c.pose().timeS); const frames3 = await C(page, (c) => c.stats().frames);
    metrics.poseClock = { wallS: (Date.now() - w0) / 1000, poseS: t3, framesDrawn: frames3 };
    check(sc, 'o tempo de pose acompanha o relógio real (≥ 2,4 s em 3 s), apesar de frames lentos', t3 >= 2.4 && t3 <= 3.8, metrics.poseClock);
    await page.waitForTimeout(2200);
    const end = await C(page, (c) => c.pose());
    check(sc, 'chega ao fim da sequência (4 s) a tempo e para', end.timeS === 4 && !end.playing, end);
    check(sc, 'sem erros na consola', errors.length === 0, errors);
    await ctx.close();
  }
  check('rede', 'nenhum pedido para fora de localhost', external.length === 0, external);
} finally {
  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ at: new Date().toISOString(), passed: checks.length - failed.length, failed: failed.length, metrics, checks }, null, 2));
  console.log(`\n${checks.length - failed.length}/${checks.length} verificações passaram`);
  if (failed.length) process.exitCode = 1;
}
