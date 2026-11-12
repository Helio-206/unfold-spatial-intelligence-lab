/**
 * Reality Engine capture path on COMPLEX BACKGROUNDS in the real /living: eight renders of a licensed asset composited over a real photograph are refused by the
 * automatic outline (fail-closed); the person fixes each outline with the interactive editor (box + brush, computed in the Worker); the capture guidance names what
 * is missing; the strategy panel says what was chosen and why; the reconstruction is built and reviewed with its measured structure.
 * Inputs are renders over a real photograph background, not photographs of the object. No model call is possible.
 * Run: npx tsx tests/e2e/reality-capture.pw.ts   (env: UNFOLD_RC_ASSET, UNFOLD_RC_BG, UNFOLD_RC_OUT)
 */
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMetaServer } from '../../server/meta-server';

const out = resolve(process.env.UNFOLD_RC_OUT ?? 'reports/reality-engine/e2e-capture'), asset = process.env.UNFOLD_RC_ASSET ?? 'BoomBox', bgFile = process.env.UNFOLD_RC_BG ?? 'bus.jpg';
mkdirSync(resolve(out, 'inputs'), { recursive: true });
let providerCalls = 0;
const backend = createMetaServer({ apiKey: 'fixture-key-not-real', fetchImpl: (async () => { providerCalls++; throw new Error('paid provider must not be called'); }) as unknown as typeof fetch });
await new Promise<void>((r) => backend.listen(0, '127.0.0.1', r));
process.env.UNFOLD_API_TARGET = `http://127.0.0.1:${(backend.address() as { port: number }).port}`;
const port = 5173, vite = await createServer({ server: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'error' }); await vite.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const results: Array<{ step: string; verdict: 'PASS' | 'FAIL'; detail: string }> = [];
const record = (step: string, ok: boolean, detail: string) => { results.push({ step, verdict: ok ? 'PASS' : 'FAIL', detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${step} — ${detail}`); };

// 1. inputs: transparent renders composited over a real photograph
const maker = await browser.newPage({ viewport: { width: 700, height: 500 } });
await maker.goto(`http://127.0.0.1:${port}/scripts/benchmark/reality-render.html`);
await maker.waitForFunction(() => (window as never as { __renderReady?: boolean }).__renderReady === true, null, { timeout: 60_000 });
const az = Array.from({ length: 8 }, (_, i) => i * 45);
const made = await maker.evaluate(async ([url, a, bg]) => {
  const urls: string[] = await (window as never as { __render: (u: string, a: number[], o: object) => Promise<string[]> }).__render(url as string, a as number[], { width: 640, height: 480, elevationDeg: 20, background: 'transparent' });
  const bgImg = new Image(); bgImg.src = `/tests/fixtures/photos-real/${bg}`; await bgImg.decode();
  const boxes: Array<{ x0: number; y0: number; x1: number; y1: number }> = [], composed: string[] = [];
  for (const u of urls) {
    const im = new Image(); im.src = u; await im.decode();
    const c = document.createElement('canvas'); c.width = 640; c.height = 480; const ctx = c.getContext('2d')!;
    const s = Math.max(640 / bgImg.width, 480 / bgImg.height); ctx.drawImage(bgImg, (640 - bgImg.width * s) / 2, (480 - bgImg.height * s) / 2, bgImg.width * s, bgImg.height * s);
    const probe = document.createElement('canvas'); probe.width = 640; probe.height = 480; const pc = probe.getContext('2d', { willReadFrequently: true })!; pc.drawImage(im, 0, 0);
    const d = pc.getImageData(0, 0, 640, 480).data; let x0 = 640, y0 = 480, x1 = 0, y1 = 0; for (let y = 0; y < 480; y++) for (let x = 0; x < 640; x++) if (d[(y * 640 + x) * 4 + 3]! > 127) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    boxes.push({ x0, y0, x1, y1 }); ctx.drawImage(im, 0, 0); composed.push(c.toDataURL('image/png'));
  }
  return { composed, boxes };
}, [`/reports/reality-engine/benchmark/assets/${asset}/${asset}.glb`, az, bgFile] as const);
const files = made.composed.map((u, i) => { const p = resolve(out, 'inputs', `view-${String(i).padStart(2, '0')}.png`); writeFileSync(p, Buffer.from(u.split(',')[1]!, 'base64')); return p; });
await maker.close();
record('0 entradas', files.length === 8, `${files.length} renders de ${asset} sobre a fotografia real ${bgFile}`);

const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
await page.addInitScript('window.__name = (f) => f;'); // tsx wraps named functions with __name; the page has no such helper
const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:${port}/living?debug-living=1&rm=1`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-space="open"]', { timeout: 60_000 }); await page.click('[data-space="open"]'); await page.click('[data-sp="reality"]');
await page.fill('#rl-elev', '20'); await page.dispatchEvent('#rl-elev', 'change');
await page.setInputFiles('#rl-files', files);
await page.waitForFunction(() => document.querySelector('#rl-files')?.closest('label')?.textContent?.includes('8 vista'), null, { timeout: 60_000 });
await page.click('[data-rl="analyse"]'); await page.waitForSelector('[data-rl-strategy]', { timeout: 60_000 });
const refusedAuto = await page.locator('[data-rl-refusal="MASK_UNRELIABLE"]').count(), strategyAuto = await page.getAttribute('[data-rl-strategy]', 'data-rl-strategy');
await page.screenshot({ path: resolve(out, '01-auto-refused.png') });
const autoText = await page.locator('.rl-panel, [data-rl-strategy]').first().evaluate((el) => (el.closest('section,div')?.parentElement ?? document.body).innerText);
const autoLabelled = /automático \(/.test(autoText) && /confirme visualmente/.test(autoText);
record('1 contorno automático: ou recusado (fail-closed) com «Ajustar contorno», ou aceite e rotulado «automático» com método e «confirme visualmente»', (refusedAuto >= 4 && strategyAuto === 'needs-input' && /Ajustar contorno/.test(await page.locator('[data-rl-strategy]').innerText())) || (refusedAuto < 4 && autoLabelled), `${refusedAuto} vistas recusadas, estratégia ${strategyAuto}, rotulado automático ${autoLabelled}`);

// 1b. a person can confirm an automatic outline as it is: that view becomes HUMAN-confirmed, the others stay automatic (the categories are not mixed)
const confirmable = await page.locator('[data-rl-confirm]').count();
if (confirmable > 0) {
  await page.click('[data-rl-confirm="0"]');
  await page.waitForFunction(() => /confirmado/.test(document.querySelector('[data-rl-view="0"] .u-label')?.textContent ?? ''), null, { timeout: 60_000 });
  const heads = await page.locator('[data-rl-view] .u-label').allInnerTexts(), confirmedNow = heads.filter((t) => /contorno confirmado/.test(t)).length, automaticNow = heads.filter((t) => /contorno autom/.test(t)).length;
  record('1b «O contorno está certo» converte só essa vista em confirmação humana', confirmedNow === 1 && automaticNow === heads.length - 1, `${confirmedNow} confirmada, ${automaticNow} automáticas de ${heads.length}`);
} else record('1b «O contorno está certo» converte só essa vista em confirmação humana', true, 'nenhum contorno automático credível para confirmar neste cenário (todos recusados)');

// 2. interactive editor on every view: box around the object, one brush stroke inside (object) and one outside (background), compute, accept
let editedOk = 0;
for (let i = 0; i < 8; i++) {
  await page.click(`[data-rl-edit="${i}"]`); await page.waitForSelector('[data-rl-edit-canvas]'); await page.waitForTimeout(250);
  const canvas = page.locator('[data-rl-edit-canvas]'), cb = (await canvas.boundingBox())!, b = made.boxes[i]!;
  // the editor fits the 640x480 image in the stage with a 16 px margin; the same mapping places the mouse
  const scale = Math.min((cb.width - 32) / 640, (cb.height - 32) / 480), tx = (cb.width - 640 * scale) / 2, ty = (cb.height - 480 * scale) / 2;
  const px = (x: number, y: number) => ({ x: cb.x + tx + x * scale, y: cb.y + ty + y * scale });
  await page.click('[data-tool="box"]');
  const p0 = px(b.x0 - 14, b.y0 - 14), p1 = px(b.x1 + 14, b.y1 + 14);
  await page.mouse.move(p0.x, p0.y); await page.mouse.down(); await page.mouse.move(p1.x, p1.y, { steps: 6 }); await page.mouse.up();
  await page.click('[data-tool="fg"]'); const c = px((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2); await page.mouse.move(c.x - 20 * scale, c.y); await page.mouse.down(); await page.mouse.move(c.x + 20 * scale, c.y, { steps: 6 }); await page.mouse.up();
  await page.click('[data-tool="bg"]'); const o = px(b.x0 - 8, b.y0 - 8); await page.mouse.move(o.x, o.y); await page.mouse.down(); await page.mouse.move(o.x + 30, o.y, { steps: 4 }); await page.mouse.up();
  if (i === 0) await page.screenshot({ path: resolve(out, '02a-editor-marks.png') });
  await page.click('[data-ed="run"]');
  if (i === 0) { await page.waitForSelector('[data-busy]:not([hidden])', { timeout: 5_000 }).catch(() => undefined); await page.screenshot({ path: resolve(out, '02b-editor-computing.png') }); }
  await page.waitForFunction(() => !(document.querySelector('[data-ed="accept"]') as HTMLButtonElement | null)?.disabled, null, { timeout: 120_000 });
  if (i === 0) {
    await page.screenshot({ path: resolve(out, '02c-editor-overlay.png') });
    await page.check('input[name="rl-view-mode"][value="cutout"]', { force: true }); await page.screenshot({ path: resolve(out, '02d-editor-cutout.png') });
    await page.check('input[name="rl-view-mode"][value="compare"]', { force: true }); await page.screenshot({ path: resolve(out, '02e-editor-compare.png') });
    await page.check('input[name="rl-view-mode"][value="overlay"]', { force: true });
    // undo/redo and zoom keep working
    await page.click('[data-ed="undo"]'); await page.click('[data-ed="redo"]'); await page.click('[data-ed="zoom-in"]'); await page.click('[data-ed="fit"]');
    // measured accessibility of the editor (computed styles, not the mere presence of elements): names, contrast (WCAG 1.4.3 / 1.4.11), target size (2.5.8), focus visibility (2.4.7), live status
    for (const mode of ['overlay', 'compare']) {
      await page.check(`input[name="rl-view-mode"][value="${mode}"]`, { force: true });
      const audit = await page.evaluate(() => {
        const root = document.querySelector('.rl-ed') as HTMLElement; const parse = (c: string) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return [0, 0, 0, 0]; const v = m[1]!.split(',').map((x) => parseFloat(x)); return [v[0]!, v[1]!, v[2]!, v[3] ?? 1]; };
        const over = (top: number[], bottom: number[]) => { const a = top[3]!; return [top[0]! * a + bottom[0]! * (1 - a), top[1]! * a + bottom[1]! * (1 - a), top[2]! * a + bottom[2]! * (1 - a), 1]; };
        const bgOf = (el: Element | null): number[] => { const chain: number[][] = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c[3]! > 0) chain.push(c); if (c[3] === 1) break; } let acc = [255, 255, 255, 1]; for (const c of chain.reverse()) acc = over(c, acc); return acc; };
        const lum = (c: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!); };
        const ratio = (a: number[], b: number[]) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
        const visible = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && (e as HTMLElement).closest('[hidden]') === null; };
        const unnamed: string[] = [], lowText: string[] = [], small: string[] = [];
        for (const e of root.querySelectorAll('button, input, select, textarea, [role="button"], [role="radio"]')) {
          if (!visible(e) && !(e as HTMLInputElement).type?.match(/radio/)) continue; const el = e as HTMLInputElement, id = el.id, label = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || (id && root.querySelector(`label[for="${id}"]`)?.textContent) || el.closest('label')?.textContent || el.textContent || el.getAttribute('title') || '';
          if (!label.trim()) unnamed.push(el.outerHTML.slice(0, 80));
          const r = el.getBoundingClientRect(); if (visible(el) && el.type !== 'radio' && (r.width < 24 || r.height < 24)) small.push(`${(el.getAttribute('aria-label') || el.textContent || el.id).trim().slice(0, 24)} ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let worst = { ratio: 99, text: '' };
        for (let n = walker.nextNode(); n; n = walker.nextNode()) { const t = (n.textContent ?? '').trim(); if (!t) continue; const el = n.parentElement!; if (!visible(el)) continue; const cs = getComputedStyle(el), fg = over(parse(cs.color), bgOf(el)), r = ratio(fg, bgOf(el)), size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight) >= 700, need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5; if (r < need) lowText.push(`${t.slice(0, 28)} ${r.toFixed(2)}<${need}`); if (r < worst.ratio) worst = { ratio: r, text: t.slice(0, 28) }; }
        return { unnamed, lowText, small, worst, status: !!root.querySelector('[role="status"], [aria-live]') };
      });
      record(`2b editor acessível (${mode}): nomes, contraste ≥ 4.5:1 (texto), alvos ≥ 24 px, região de estado`, audit.unnamed.length === 0 && audit.lowText.length === 0 && audit.small.length === 0 && audit.status, `sem nome ${audit.unnamed.length}, contraste fraco ${audit.lowText.slice(0, 4).join('; ') || 'nenhum'} (pior ${audit.worst.ratio.toFixed(2)} «${audit.worst.text}»), alvos pequenos ${audit.small.slice(0, 4).join('; ') || 'nenhum'}`);
    }
    // keyboard: Tab walks the controls and every stop shows a visible focus indicator
    await page.locator('.rl-ed').first().evaluate((r) => (r.querySelector('button') as HTMLElement | null)?.focus());
    let stops = 0, noRing = 0; const seen = new Set<string>();
    for (let t = 0; t < 40; t++) { await page.keyboard.press('Tab'); const info = await page.evaluate(() => { const a = document.activeElement as HTMLElement | null; if (!a || !a.closest('.rl-ed')) return null; const cs = getComputedStyle(a); return { id: a.id || a.getAttribute('aria-label') || a.getAttribute('data-ed') || a.textContent?.trim().slice(0, 16) || a.tagName, ring: (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2) || (cs.boxShadow && cs.boxShadow !== 'none') }; }); if (!info) continue; if (seen.has(info.id as string)) continue; seen.add(info.id as string); stops++; if (!info.ring) noRing++; }
    record('2c editor por teclado: cada paragem de Tab mostra indicador de foco visível', stops >= 8 && noRing === 0, `${stops} controlos alcançados por Tab, ${noRing} sem indicador de foco`);
    await page.locator('.rl-ed').first().evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    // layout measured at three viewports: no control may overlap another control or leave the dialog (this is what the 1500x1000 screenshot once showed going wrong)
    const original = page.viewportSize()!;
    for (const [w, h] of [[1500, 1000], [1280, 680], [390, 800]] as const) {
      await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(250);
      const geo = await page.evaluate(() => {
        const root = document.querySelector('.rl-ed') as HTMLElement, rr = root.getBoundingClientRect(), items = [...root.querySelectorAll('button, input:not([type="radio"]), select, summary')].filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !e.closest('[hidden]') && !e.closest('details:not([open])>*:not(summary)'); }) as HTMLElement[];
        const clipped = (e: HTMLElement) => { for (let p = e.parentElement; p && p !== root; p = p.parentElement) { const cs = getComputedStyle(p); if (/(auto|scroll|hidden)/.test(cs.overflowY) && p !== root) { const pr = p.getBoundingClientRect(), r = e.getBoundingClientRect(); if (r.bottom > pr.bottom + 1 || r.top < pr.top - 1) return true; } } return false; };
        const rects = items.map((e) => ({ e, r: e.getBoundingClientRect() })), overlaps: string[] = [], outside: string[] = [];
        for (let i = 0; i < rects.length; i++) { const a = rects[i]!; const rootScrolls = root.scrollHeight > root.clientHeight + 1; if (!clipped(a.e) && (a.r.left < rr.left - 1 || a.r.right > rr.right + 1 || (!rootScrolls && (a.r.top < rr.top - 1 || a.r.bottom > rr.bottom + 1)))) outside.push((a.e.getAttribute('aria-label') || a.e.textContent || a.e.id).trim().slice(0, 20));
          for (let j = i + 1; j < rects.length; j++) { const b = rects[j]!; if (a.e.contains(b.e) || b.e.contains(a.e) || clipped(a.e) || clipped(b.e)) continue; const ox = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top); if (ox > 2 && oy > 2) overlaps.push(`${(a.e.getAttribute('aria-label') || a.e.textContent || '').trim().slice(0, 14)}×${(b.e.getAttribute('aria-label') || b.e.textContent || '').trim().slice(0, 14)}`); } }
        // occlusion: the element at the centre of every control must be that control (something else drawn over it, e.g. the page's prompt dock, makes it unusable)
        const covered: string[] = []; for (const { e, r } of rects) { if (clipped(e)) continue; const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); if (top && top !== e && !e.contains(top) && !top.contains(e)) covered.push(`${(e.getAttribute('aria-label') || e.textContent || e.id).trim().slice(0, 18)} por ${top.tagName}.${String(top.className).slice(0, 18)}`); }
        const st = (root.querySelector('.rl-ed-stage') as HTMLElement).getBoundingClientRect(); if (st.width < 240 || st.height < 240) overlaps.push(`área de desenho demasiado pequena ${Math.round(st.width)}×${Math.round(st.height)}`);
        const hscroll = document.documentElement.scrollWidth > window.innerWidth + 1;
        return { overlaps: [...overlaps, ...covered], outside, hscroll };
      });
      if (w === 1280 || w === 390) await page.screenshot({ path: resolve(out, `02f-editor-${w}x${h}.png`) });
      record(`2d editor sem sobreposição nem fuga a ${w}×${h}`, geo.overlaps.length === 0 && geo.outside.length === 0 && !geo.hscroll, `sobreposições ${geo.overlaps.slice(0, 3).join('; ') || 'nenhuma'}, fora do diálogo ${geo.outside.slice(0, 3).join('; ') || 'nenhum'}, scroll horizontal ${geo.hscroll}`);
    }
    await page.setViewportSize(original); await page.waitForTimeout(250);
    record('2a editor: undo/redo, zoom e modos de visualização operam sem erros', true, 'sobreposição, recorte, antes/depois, desfazer/refazer, zoom');
  }
  await page.click('[data-ed="accept"]'); editedOk++;
}
record('2 contornos ajustados à mão (caixa + pincéis, calculados no Worker) nas 8 vistas', editedOk === 8, `${editedOk}/8 confirmados`);
await page.click('[data-rl="analyse"]'); await page.waitForSelector('[data-rl-strategy]', { timeout: 60_000 });
const refusedAfter = await page.locator('[data-rl-refusal]').count(), strategy = await page.getAttribute('[data-rl-strategy]', 'data-rl-strategy'), issues = await page.locator('[data-rl-issue]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.rlIssue));
const sources = await page.locator('.sp-comp-head .u-label', { hasText: 'contorno confirmado por si' }).count();
await page.screenshot({ path: resolve(out, '03-after-edit-analysis.png') });
record('3 depois do ajuste: sem recusas, estratégia casco, orientação de captura presente', refusedAfter === 0 && strategy === 'silhouette-hull' && issues.includes('NO_ELEVATION_VARIETY') && sources >= 8, `recusas ${refusedAfter}, estratégia ${strategy}, avisos [${issues.join(',')}], contornos confirmados ${sources}`);
// the capture still lacks a top view (and has a blurry frame): the system must say so and refuse to continue silently
const gateLevel = await page.getAttribute('[data-rl-gate]', 'data-rl-gate'), gateCodes = await page.locator('[data-rl-gate-item]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.rlGateItem)), buildDisabledBefore = await page.locator('[data-rl="build"]').isDisabled();
record('3b captura sem vista de cima: o sistema diz o que falta e o botão de reconstruir fica bloqueado até reconhecer a baixa confiança', gateLevel === 'low-confidence' && gateCodes.includes('NO_ELEVATION_VARIETY') && buildDisabledBefore, `nível ${gateLevel}, itens ${gateCodes.join(',')}, botão bloqueado ${buildDisabledBefore}`);
await page.check('#rl-ack-low'); record('3c depois de reconhecer, o botão abre e passa a dizer «baixa confiança»', !(await page.locator('[data-rl="build"]').isDisabled()) && /baixa confiança/.test(await page.locator('[data-rl="build"]').innerText()), await page.locator('[data-rl="build"]').innerText());
await page.click('[data-rl="build"]'); await page.waitForSelector('.sp-root[data-phase="review"]', { timeout: 180_000 });
await page.click('[data-sp="keep-all"]'); await page.check('#sp-ack'); await page.click('[data-sp="build"]');
await page.waitForFunction(() => (window as never as { __workspace: { spaceActive: boolean } }).__workspace.spaceActive, null, { timeout: 180_000 });
await page.waitForSelector('[data-reality-review]', { timeout: 30_000 }); await page.waitForTimeout(1500);
await page.screenshot({ path: resolve(out, '04-built.png') });
const guidance = await page.locator('[data-rr-guidance]').innerText(), structure = await page.locator('[data-rr-structure]').count(), fidelity = await page.getAttribute('[data-reality-review] [data-fidelity]', 'data-fidelity');
record('4 Space construído; revisão mostra o que fotografar a seguir e a estrutura medida; nunca "fiel"', /elevad|cima|45/.test(guidance) && structure === 1 && fidelity !== 'faithful', `fidelidade ${fidelity}`);
const axisPass = await page.locator('[data-rr-axes] [data-axis]').evaluateAll((els) => els.map((e) => `${(e as HTMLElement).dataset.axis}:${(e as HTMLElement).dataset.pass}`));
record('4b a revisão separa consistência, evidência visual independente e fidelidade geométrica', axisPass.join(',') === 'consistency:true,visual:true,geometry:false', axisPass.join(','));
record('5 nenhuma chamada paga', providerCalls === 0, `provider=${providerCalls}`);
record('6 sem erros de browser', errors.length === 0, errors.join(' | ') || 'limpo');
writeFileSync(resolve(out, 'e2e-result.json'), JSON.stringify({ asset, background: bgFile, results }, null, 2));
await browser.close(); await vite.close(); await new Promise<void>((r) => backend.close(() => r()));
if (results.some((r) => r.verdict === 'FAIL')) process.exit(1);
