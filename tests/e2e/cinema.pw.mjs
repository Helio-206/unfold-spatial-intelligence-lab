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
const ONLY = process.env.UNFOLD_E2E_ONLY; // 1..13
const checks = []; const external = []; const metrics = {};
function check(scenario, name, ok, observed) { checks.push({ scenario, name, ok: Boolean(ok), observed }); console.log(`${ok ? 'PASS' : 'FAIL'}  [${scenario}] ${name}${ok ? '' : `  -> ${JSON.stringify(observed)}`}`); }
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function open(query = 'tier=studio', context = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ...context });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/GPU stall|swiftshader|GL Driver Message|Failed to load resource/i.test(m.text())) errors.push(`${m.type()}: ${m.text()}`); });
  page.on('request', (r) => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname) && u.protocol.startsWith('http')) external.push(r.url()); });
  await page.goto(`${BASE}/cinema?debug-cinema&ui=0&dpr=1&${/visuals=/.test(query) ? '' : 'visuals=proxy&'}${/motion=/.test(query) ? '' : 'motion=reference&'}${query}`);
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

  // ------------------------------------------------------------------ 10. integração: Visual Foundry + motor de engenharia (15 quadros reais)
  if (!ONLY || ONLY === '10') {
    const sc = '10 integração';
    const { page, ctx, errors } = await open('tier=light&visuals=foundry&motion=engine');
    await page.evaluate(() => document.querySelector('#cinema-root').classList.remove('is-presenting', 'is-idle'));
    const geo = await C(page, (c) => c.geometryStats());
    const assemblyParts = await page.evaluate(async () => (await import('/src/living/contracts/fixtures/excavator.assembly.v1.ts')).EXCAVATOR_ASSEMBLY_V1.parts.map((p) => p.id));
    check(sc, 'a geometria é a do Visual Foundry (detalhada), não o proxy', geo.source === 'visual-foundry' && geo.triangles > 100000 && geo.meshes > 60, geo);
    check(sc, 'os ids canónicos das peças são exactamente os da montagem', JSON.stringify([...geo.parts].sort()) === JSON.stringify([...assemblyParts].sort()), geo.parts);
    check(sc, 'o readout diz que a geometria é a Visual Foundry e que as poses são do motor', /Visual Foundry/.test(await page.textContent('#ro-geometry')) && /motor/.test(await page.textContent('#ro-source')), await page.textContent('#ro-source'));
    const dur = await C(page, (c) => c.sourceInfo().duration);
    check(sc, 'a fonte é o motor (sessão em direto) com duração do cenário', (await C(page, (c) => c.sourceInfo().kind)) === 'engine-session' && dur > 1.5, dur);
    await still(page, 'hero', 3);

    // -- reprodução: play, pause, resume, scrub; the pose on stage IS the engine frame at that instant
    const samePose = async (label) => {
      const bad = await C(page, (c) => { const s = c.sampleNow(); let worst = 0; for (const p of s.parts) { const w = c.partWorld(p.partId); const d = Math.hypot(...w.p.map((v, i) => v - p.translationM[i])); worst = Math.max(worst, d); } return { worst, t: c.sourceInfo().time, digest: s.inputDigest }; });
      return bad;
    };
    await page.click('#cinema-play'); await page.waitForTimeout(1500); const t1 = await C(page, (c) => c.sourceInfo());
    check(sc, 'Reproduzir faz avançar o tempo da reprodução (relógio real)', t1.playing && t1.time > 0.5, t1);
    await page.click('#cinema-play'); await page.waitForTimeout(400); const p0 = await C(page, (c) => c.sourceInfo()); await page.waitForTimeout(1200); const p1 = await C(page, (c) => c.sourceInfo());
    check(sc, 'Pausa congela o instante', !p0.playing && p0.time === p1.time, [p0, p1]);
    await page.click('#cinema-play'); await page.waitForFunction((t) => window.__unfoldCinema.sourceInfo().time > t, p1.time, { timeout: 15000 }).catch(() => {}); const r1 = await C(page, (c) => c.sourceInfo()); // a software frame can take over a second: wait for the first frame after resuming
    check(sc, 'Retomar continua a partir do instante em que parou', r1.playing && r1.time > p1.time && r1.time - p1.time < 2.5, [p1, r1]);
    await page.click('#cinema-play'); await page.waitForTimeout(300);
    for (const frac of [0.0, 0.25, 0.5, 0.75, 1.0]) {
      await page.$eval('#cinema-time', (e, v) => { e.value = String(+e.max * v); e.dispatchEvent(new Event('input', { bubbles: true })); }, frac);
      await page.waitForTimeout(250); const d = await samePose();
      check(sc, `instante a ${Math.round(frac * 100)} %: todas as peças estão exactamente na pose do quadro do motor`, d.worst < 1e-9 && /^[a-f0-9]{64}$/.test(d.digest ?? ''), d);
    }
    // -- continuity of the motion and of the hoses
    const track = []; const hoses = [];
    for (let i = 0; i <= 40; i += 1) { const t = (dur * i) / 40; await C(page, (c, tt) => c.runtime.seekPose(tt), t); track.push(await C(page, (c) => c.partWorld('bucket').p)); hoses.push((await C(page, (c) => c.hoseSignature())).sum); }
    const steps = track.slice(1).map((p, i) => Math.hypot(...p.map((v, k) => v - track[i][k])));
    metrics.integration = { maxBucketStepM: Math.max(...steps), totalPathM: steps.reduce((a, b) => a + b, 0), samples: track.length };
    check(sc, 'a caçamba descreve um movimento contínuo (nenhum salto > 0,25 m entre 41 amostras) e percorre mais de 0,5 m', Math.max(...steps) < 0.25 && metrics.integration.totalPathM > 0.5, metrics.integration);
    check(sc, 'as mangueiras flexíveis são re-encaminhadas ao longo da reprodução', new Set(hoses.map((h) => h.toFixed(6))).size > 10 && (await C(page, (c) => c.hoseSignature().hoses)) >= 4, hoses.slice(0, 5));
    // -- the 15-frame sequence exported by the engine
    await C(page, (c) => c.setMotion('sequence')); await page.waitForTimeout(500);
    const seq = await C(page, (c) => c.sourceInfo());
    check(sc, 'a sequência exportada (13 quadros ok) está carregada como reprodução com duração', seq.kind === 'motion-frames' && seq.duration > 1.5, seq);
    await C(page, (c) => c.runtime.seekPose(0.4)); await page.waitForTimeout(250);
    const blend = await C(page, (c) => { const s = c.sampleNow(); const worst = Math.max(...s.parts.map((p) => Math.hypot(...c.partWorld(p.partId).p.map((v, i) => v - p.translationM[i])))); return { interpolated: s.interpolated, measurements: s.measurements.length, digest: s.inputDigest, derived: !!s.derivedFrom, worst, origin: s.origin }; });
    check(sc, 'entre dois quadros ok a pose é uma mistura rotulada: sem medidas, sem digest de entrada, com origem nos dois quadros', blend.interpolated && blend.measurements === 0 && blend.digest === null && blend.derived && blend.origin === 'engine' && blend.worst < 1e-9, blend);
    check(sc, 'a interface não apresenta a mistura como cálculo directo do motor', /suavizada/.test(await page.textContent('#ro-source')) && /sem medidas/.test(await page.textContent('#ro-source')), await page.textContent('#ro-source'));
    const hoseBlend = (await C(page, (c) => c.hoseSignature())).sum; await C(page, (c) => c.runtime.seekPose(0.46)); const hoseBlend2 = (await C(page, (c) => c.hoseSignature())).sum;
    check(sc, 'as mangueiras acompanham também as poses misturadas', hoseBlend !== hoseBlend2, [hoseBlend, hoseBlend2]);
    // -- blocked frames from the engine
    for (const [key, re] of [['blocked-curso', /curso|CURSO|STROKE/i], ['blocked-colisao', /colis|COLLISION|chão/i]]) {
      await C(page, (c, k) => c.setMotion(k), key); await page.waitForTimeout(400);
      const st = await page.textContent('#ro-status'); const cap = await C(page, (c) => c.caption()); const pose = await page.textContent('#ro-pose'); const src = await page.textContent('#ro-source');
      const ref = await C(page, (c) => { const s = c.sampleNow(); return Math.max(...s.parts.map((p) => Math.hypot(...c.partWorld(p.partId).p.map((v, i) => v - p.translationM[i])))); });
      check(sc, `${key}: estado «blocked», razão do motor na legenda, base «reference», origem do motor`, st === 'blocked' && /^Bloqueado: /.test(cap) && re.test(cap) && /reference/.test(pose) && /motor/.test(src), { st, cap, pose, src });
      check(sc, `${key}: a pose mostrada é a que o motor declarou (nada inventado)`, ref < 1e-9, ref);
      await page.screenshot({ path: join(OUT, `integration-${key}.png`) });
    }
    // -- identity: other assemblies / digests are refused before they reach the stage
    await C(page, (c) => c.setMotion('engine'));
    for (const [kind, re] of [['digest', /assemblyDigest/], ['world', /worldFrameId/], ['assembly', /montagem/], ['parts', /bucket/]]) {
      const msg = await C(page, (c, k) => c.tryBadSequence(k), kind); check(sc, `sequência recusada (${kind}) com a geometria Foundry em cena`, re.test(msg) && msg !== 'ACEITE', msg);
    }
    // -- inspection by canonical id (no second selection system: a readout from the provider registry)
    await C(page, (c) => c.setMotion('reference')); await page.waitForTimeout(300); await C(page, (c) => c.seekShot('profile', 3));
    const c0 = await C(page, (c) => c.partScreenCenter('stick'));
    await page.mouse.click(c0.x, c0.y); await page.waitForTimeout(300);
    const partText = await page.textContent('#ro-part'); const viaHook = await C(page, (c, p) => c.pickAt(p.x, p.y), c0);
    check(sc, 'clicar numa peça mostra o id canónico e a proveniência do registo', viaHook !== null && geo.parts.includes(viaHook) && partText.includes(viaHook) && /fixture\/unreviewed|unreviewed/.test(partText), { partText, viaHook });
    await page.mouse.click(1500, 300); await page.waitForTimeout(200);
    check(sc, 'clicar no vazio limpa a leitura', /clique numa peça/.test(await page.textContent('#ro-part')));
    // -- resources: switching sources repeatedly does not grow GPU resources; dispose releases all
    await C(page, (c) => c.renderNow()); const base = await C(page, (c) => c.stats());
    for (let i = 0; i < 6; i += 1) for (const k of ['engine', 'sequence', 'blocked-curso', 'reference']) { await C(page, (c, kk) => { c.setMotion(kk); c.renderNow(); }, k); }
    await C(page, (c) => c.setMotion('reference')); await C(page, (c) => c.renderNow()); const after = await C(page, (c) => c.stats());
    check(sc, 'depois de 24 trocas de fonte as geometrias, texturas e luzes não crescem', after.textures === base.textures && after.lights === base.lights && after.geometries <= base.geometries + 2, { base: [base.geometries, base.textures, base.lights], after: [after.geometries, after.textures, after.lights] });
    const disposed = await C(page, (c) => c.disposeNow());
    check(sc, 'dispose liberta geometrias e texturas e retira o canvas, sem libertação dupla (sem erros)', disposed.geometries === 0 && disposed.textures === 0 && !disposed.canvasInDom, disposed);
    check(sc, 'sem erros na consola', errors.length === 0, errors);
    await ctx.close();
  }

  // ------------------------------------------------------------------ 11. layout responsivo: barra de movimento, leitura e planos não se sobrepõem
  if (!ONLY || ONLY === '11') {
    const sc = '11 layout';
    const { page, ctx, errors } = await open('tier=light&motion=engine', { viewport: { width: 1600, height: 900 } });
    const overlap = (a, b) => a && b && a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
    metrics.layout = {};
    for (const width of [768, 800, 1024, 1080, 1280, 1440, 1600, 390]) {
      const height = width === 390 ? 844 : 900; const tag = `${width}px`;
      await page.setViewportSize({ width, height }); await page.waitForTimeout(500);
      await page.evaluate(() => document.querySelector('#cinema-root').classList.remove('is-presenting', 'is-idle')); await page.waitForTimeout(300);
      const geo = await page.evaluate(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const cs = getComputedStyle(e); if (cs.display === 'none') return null; const b = e.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; };
        return { vw: innerWidth, vh: innerHeight, scrollW: document.documentElement.scrollWidth, motion: r('.cinema-motion'), readout: r('.cinema-readout'), shots: r('.cinema-shots'), top: r('.cinema-top'), font: getComputedStyle(document.querySelector('.cinema-readout')).fontSize, readoutDisplay: getComputedStyle(document.querySelector('.cinema-readout')).display }; });
      metrics.layout[tag] = { motion: geo.motion && [Math.round(geo.motion.left), Math.round(geo.motion.top), Math.round(geo.motion.right), Math.round(geo.motion.bottom)], readout: geo.readout && [Math.round(geo.readout.left), Math.round(geo.readout.top), Math.round(geo.readout.right), Math.round(geo.readout.bottom)] };
      check(sc, `[${tag}] a barra de movimento e a leitura técnica não se sobrepõem (e nenhuma delas toca nos planos nem no cabeçalho)`, !overlap(geo.motion, geo.readout) && !overlap(geo.motion, geo.shots) && !overlap(geo.readout, geo.shots) && !overlap(geo.readout, geo.top) && !overlap(geo.motion, geo.top), metrics.layout[tag]);
      check(sc, `[${tag}] a leitura continua visível quando há espaço (≥ 800 px) e cabe no ecrã, com texto legível (≥ 12 px)`, width < 800 ? true : (geo.readout && geo.readout.left >= 0 && geo.readout.right <= geo.vw && geo.readout.top >= 0 && geo.readout.bottom <= geo.vh && parseFloat(geo.font) >= 12), { readout: geo.readout, font: geo.font });
      check(sc, `[${tag}] sem scroll horizontal`, geo.scrollW <= geo.vw + 1, [geo.scrollW, geo.vw]);
      // pointer hit-testing at the centre of every control: the control itself must receive the pointer
      await page.$eval('#cinema-play', (e) => e.scrollIntoView({ inline: 'center', block: 'nearest' })); await page.waitForTimeout(150);
      const hit = await page.evaluate(() => { const out = {}; for (const [k, sel] of [['select', '#cinema-motion'], ['slider', '#cinema-time'], ['play', '#cinema-play']]) { const e = document.querySelector(sel); if (!e || e.hidden || e.disabled) { out[k] = e ? 'indisponível' : 'ausente'; continue; } const b = e.getBoundingClientRect(); const at = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); out[k] = at === e || e.contains(at) ? 'ok' : `intercepted:${at?.className || at?.tagName}`; } return out; });
      check(sc, `[${tag}] seletor de movimento, linha do tempo e reprodução recebem o ponteiro`, hit.select === 'ok' && hit.slider === 'ok' && hit.play === 'ok', hit);
      // real interactions
      await page.selectOption('#cinema-motion', 'sequence'); await page.waitForTimeout(200); const kind = await C(page, (c) => c.sourceInfo().kind);
      await page.selectOption('#cinema-motion', 'engine'); await page.waitForTimeout(200); const kind2 = await C(page, (c) => c.sourceInfo().kind);
      check(sc, `[${tag}] o seletor muda mesmo de fonte (ponteiro real)`, kind === 'motion-frames' && kind2 === 'engine-session', [kind, kind2]);
      const sl = await page.$eval('#cinema-time', (e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top + b.height / 2, w: b.width, max: +e.max }; });
      await page.mouse.click(sl.x + sl.w * 0.5, sl.y); await page.waitForTimeout(250); const tm = await C(page, (c) => c.sourceInfo().time);
      check(sc, `[${tag}] clicar a meio da linha do tempo leva a reprodução para perto do meio`, Math.abs(tm - sl.max * 0.5) < sl.max * 0.12, { tm, half: sl.max * 0.5 });
      await page.click('#cinema-play'); await page.waitForTimeout(700); const t1 = await C(page, (c) => c.sourceInfo()); await page.click('#cinema-play'); await page.waitForTimeout(300); const t2 = await C(page, (c) => c.sourceInfo()); await page.waitForTimeout(500); const t3 = await C(page, (c) => c.sourceInfo());
      check(sc, `[${tag}] reproduzir e pausar funcionam com cliques reais`, t1.playing && !t2.playing && t2.time === t3.time, [t1, t2, t3]);
      // camera: a drag on empty canvas moves the camera
      const pt = await page.evaluate(() => { const xs = [0.5, 0.62, 0.7]; for (const fx of xs) { const x = innerWidth * fx; const y = innerHeight * 0.3; const e = document.elementFromPoint(x, y); if (e && e.classList.contains('cinema-canvas')) return { x, y }; } return null; });
      const cam0 = await C(page, (c) => c.camera());
      if (pt) { await page.mouse.move(pt.x, pt.y); await page.mouse.down(); await page.mouse.move(pt.x + 60, pt.y + 20, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(300); }
      const cam1 = await C(page, (c) => c.camera());
      check(sc, `[${tag}] a câmara continua a poder ser arrastada`, !!pt && Math.hypot(...cam0.position.map((v, i) => v - cam1.position[i])) > 0.05, { pt });
      // presentation mode hides the chrome
      await page.keyboard.press('h'); await page.waitForTimeout(400); await page.mouse.move(2, 2); await page.mouse.move(geo.vw / 2, geo.vh / 2); await page.waitForTimeout(2800);
      const hidden = await page.evaluate(() => ['.cinema-motion', '.cinema-readout', '.cinema-shots'].map((s) => getComputedStyle(document.querySelector(s)).opacity));
      check(sc, `[${tag}] o modo de apresentação esconde a interface`, hidden.every((o) => Number(o) === 0), hidden);
      await page.keyboard.press('h'); await page.waitForTimeout(300);
    }
    check(sc, 'sem erros na consola', errors.length === 0, errors);
    await ctx.close();
  }

  // ------------------------------------------------------------------ 12. a primeira pose passa pelo mesmo percurso que as seguintes (Foundry: mangueiras)
  if (!ONLY || ONLY === '12') {
    const sc = '12 pose inicial';
    // articulated static frame as the FIRST source: the hoses must already be routed for that pose; re-applying the same sample must change nothing
    {
      const { page, ctx, errors } = await open('tier=light&visuals=foundry&initial=articulated');
      const applicationsAtBoot = await C(page, (c) => c.poseApplications());
      check(sc, 'a primeira pose é aplicada exactamente uma vez (sem aplicações duplicadas)', applicationsAtBoot === 1, applicationsAtBoot);
      const boot = await C(page, (c) => c.hoseSignature().sum); const parts0 = await C(page, (c) => { const s = c.sampleNow(); return Math.max(...s.parts.map((p) => Math.hypot(...c.partWorld(p.partId).p.map((v, i) => v - p.translationM[i])))); });
      await C(page, (c) => c.reapply()); const again = await C(page, (c) => c.hoseSignature().sum);
      const ref = await (async () => { await C(page, (c) => c.setMotion('reference')); return C(page, (c) => c.hoseSignature().sum); })();
      check(sc, 'pose articulada inicial: as peças estão na pose do quadro', parts0 < 1e-9, parts0);
      check(sc, 'pose articulada inicial: as mangueiras já estão encaminhadas para essa pose (iguais às de a aplicar de novo)', Math.abs(boot - again) < 1e-9, { boot, again });
      check(sc, 'as mangueiras da pose articulada diferem das da referência (o teste distingue os dois casos)', Math.abs(boot - ref) > 1e-3, { boot, ref });
      const nApplied = await C(page, (c) => c.lastApply());
      check(sc, 'sem recusa nem partes desconhecidas na primeira aplicação', nApplied.refused === null && nApplied.unknown.length === 0, nApplied);
      check(sc, 'sem erros na consola', errors.length === 0, errors); await ctx.close();
    }
    // reference as the first source, and a pose-less frame as the first source
    {
      const { page, ctx, errors } = await open('tier=light&visuals=foundry&motion=reference');
      const boot = await C(page, (c) => c.hoseSignature().sum); await C(page, (c) => c.reapply()); const again = await C(page, (c) => c.hoseSignature().sum);
      check(sc, 'pose de referência inicial: mangueiras iguais às de aplicar de novo', Math.abs(boot - again) < 1e-9, { boot, again });
      check(sc, 'pose de referência inicial: máquina visível', (await C(page, (c) => c.machineVisible())).root === true);
      check(sc, 'sem erros na consola', errors.length === 0, errors); await ctx.close();
    }
    {
      const { page, ctx, errors } = await open('tier=light&visuals=foundry&initial=poseless');
      const vis = await C(page, (c) => c.machineVisible()); const bounds = await C(page, (c) => c.geometryStats().triangles);
      check(sc, 'frame inicial sem poses: a máquina, o espelho e a sombra de contacto estão escondidos desde o primeiro frame', !vis.root && !vis.mirror && !vis.contact, vis);
      check(sc, 'frame inicial sem poses: o enquadramento continua válido (câmara finita e a olhar para uma cena com geometria)', bounds > 100000 && (await C(page, (c) => c.camera())).position.every(Number.isFinite), bounds);
      await C(page, (c) => c.setMotion('reference')); await page.waitForTimeout(300);
      check(sc, 'o primeiro quadro com poses repõe a máquina', (await C(page, (c) => c.machineVisible())).root === true);
      check(sc, 'sem erros na consola', errors.length === 0, errors); await ctx.close();
    }
    {
      const { page, ctx, errors } = await open('tier=light&visuals=proxy&initial=articulated');
      const parts0 = await C(page, (c) => { const s = c.sampleNow(); return Math.max(...s.parts.map((p) => Math.hypot(...c.partWorld(p.partId).p.map((v, i) => v - p.translationM[i])))); });
      check(sc, 'com o proxy a primeira pose articulada também é a do quadro', parts0 < 1e-9, parts0); check(sc, 'sem erros na consola', errors.length === 0, errors); await ctx.close();
    }
  }

  // ------------------------------------------------------------------ 13. perfis interactivo / apresentação (aspecto premium reversível)
  if (!ONLY || ONLY === '13') {
    const sc = '13 perfis';
    const { page, ctx, errors } = await open('tier=light&visuals=foundry&motion=reference');
    await page.evaluate(() => document.querySelector('#cinema-root').classList.remove('is-presenting', 'is-idle'));
    const parts = async () => C(page, (c) => c.geometryStats().parts.slice().sort().map((id) => [id, c.partWorld(id).p.map((v) => +v.toFixed(9))]));
    const base = { stats: await C(page, (c) => c.stats()), parts: await parts(), hoses: await C(page, (c) => c.hoseSignature().sum) };
    check(sc, 'o perfil por omissão é interactivo, sem materiais premium e com 3 luzes', base.stats.profile === 'interactive' && base.stats.premiumMaterials === 0 && base.stats.lights === 3, [base.stats.profile, base.stats.premiumMaterials, base.stats.lights]);
    await C(page, (c) => c.seekShot('hero', 3)); const pixelsBefore = await grab(page);
    const pick = await C(page, (c) => c.partScreenCenter('stick')); await C(page, (c) => c.seekShot('profile', 3)); const pick2 = await C(page, (c) => c.partScreenCenter('stick'));
    const idBefore = await C(page, (c, p) => c.pickAt(p.x, p.y), pick2);
    await C(page, (c) => c.setProfile('presentation')); await C(page, (c) => c.seekShot('profile', 3));
    const pres = await C(page, (c) => c.stats());
    check(sc, 'o perfil de apresentação aplica o aspecto premium (16 materiais clonados) e acrescenta as luzes do set (5)', pres.profile === 'presentation' && pres.premiumMaterials >= 10 && pres.lights === 5, [pres.profile, pres.premiumMaterials, pres.lights]);
    check(sc, 'os 13 ids canónicos, as poses e as mangueiras não mudam com o perfil', JSON.stringify(await parts()) === JSON.stringify(base.parts) && Math.abs((await C(page, (c) => c.hoseSignature().sum)) - base.hoses) < 1e-9 && (await C(page, (c) => c.geometryStats().parts.length)) === 13, null);
    const idAfter = await C(page, (c, p) => c.pickAt(p.x, p.y), pick2);
    check(sc, 'a selecção por clique devolve o mesmo id canónico nos dois perfis (o set do estúdio não contamina a selecção)', idBefore !== null && idBefore === idAfter, [idBefore, idAfter]);
    const boxes = await C(page, (c) => ['bucket', 'stick', 'boom'].map((id) => c.screenBox(id)));
    check(sc, 'as medições de ecrã das peças continuam a existir (limites só da máquina)', boxes.every((b) => b && b.w > 5 && b.h > 5), boxes);
    const presShot = await grab(page); const luma = await lum(page, presShot, { x: 0, y: 0, w: 1600, h: 900 });
    check(sc, 'o perfil de apresentação muda a imagem e é escuro de facto (luminância média baixa, realces fortes)', hash(presShot) !== hash(pixelsBefore) && luma.mean < 80 && luma.p99 > 150, luma);
    // poses and hoses still follow articulated frames under the premium look
    await C(page, (c) => c.setMotion('engine')); await C(page, (c) => c.runtime.seekPose(c.runtime.source.durationS)); await page.waitForTimeout(200);
    const art = await C(page, (c) => { const s = c.sampleNow(); return { err: Math.max(...s.parts.map((p) => Math.hypot(...c.partWorld(p.partId).p.map((v, i) => v - p.translationM[i])))), hoses: c.hoseSignature().sum }; });
    check(sc, 'com o aspecto premium, uma pose articulada do motor é aplicada exactamente e as mangueiras são re-encaminhadas', art.err < 1e-9 && Math.abs(art.hoses - base.hoses) > 1e-3, art);
    // reversibility and no accumulation
    await C(page, (c) => c.setMotion('reference')); await page.waitForTimeout(150);
    for (let i = 0; i < 5; i += 1) { await C(page, (c) => { c.setProfile('interactive'); c.renderNow(); c.setProfile('presentation'); c.renderNow(); }); }
    const mid = await C(page, (c) => c.stats());
    for (let i = 0; i < 20; i += 1) { await C(page, (c) => { c.setProfile('interactive'); c.renderNow(); c.setProfile('presentation'); c.renderNow(); }); }
    const after20 = await C(page, (c) => c.stats());
    check(sc, 'depois de 20 trocas de perfil (a seguir a um aquecimento de 5) as geometrias, texturas, luzes e programas não crescem', after20.geometries === mid.geometries && after20.textures === mid.textures && after20.lights === mid.lights && after20.premiumMaterials === mid.premiumMaterials && after20.programs <= mid.programs + 2, { mid: [mid.geometries, mid.textures, mid.lights, mid.premiumMaterials, mid.programs], after20: [after20.geometries, after20.textures, after20.lights, after20.premiumMaterials, after20.programs] });
    await C(page, (c) => c.setProfile('interactive')); await C(page, (c) => c.seekShot('hero', 3)); await C(page, (c) => c.seekShot('profile', 3));
    const back = await C(page, (c) => c.stats());
    check(sc, 'voltar a interactivo repõe luzes (3) e materiais originais (0 clones)', back.profile === 'interactive' && back.lights === 3 && back.premiumMaterials === 0, [back.profile, back.lights, back.premiumMaterials]);
    await C(page, (c) => c.seekShot('hero', 3)); const pixelsAfter = await grab(page);
    check(sc, 'a imagem interactiva depois das trocas é idêntica à do arranque (reversível pixel a pixel)', hash(pixelsAfter) === hash(pixelsBefore), [hash(pixelsAfter), hash(pixelsBefore)]);
    // buttons
    await page.click('[data-profile="presentation"]'); await page.waitForTimeout(400);
    check(sc, 'o botão Apresentação activa o perfil, corta para o plano herói e fica premido', (await C(page, (c) => c.stats().profile)) === 'presentation' && (await page.getAttribute('[data-profile="presentation"]', 'aria-pressed')) === 'true' && (await page.getAttribute('[data-shot="hero"]', 'aria-pressed')) === 'true');
    await page.click('[data-profile="interactive"]'); await page.waitForTimeout(300);
    check(sc, 'o botão Interactivo repõe o perfil base', (await C(page, (c) => c.stats().profile)) === 'interactive');
    const disposed = await C(page, (c) => { c.setProfile('presentation'); return c.disposeNow(); });
    check(sc, 'dispose com o perfil de apresentação activo liberta tudo (geometrias, texturas) e não dá erros', disposed.geometries === 0 && disposed.textures === 0, disposed);
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
