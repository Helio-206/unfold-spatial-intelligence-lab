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
const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:${port}/living?debug-living=1&rm=1`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-space="open"]', { timeout: 60_000 }); await page.click('[data-space="open"]'); await page.click('[data-sp="reality"]');
await page.fill('#rl-elev', '20'); await page.dispatchEvent('#rl-elev', 'change');
await page.setInputFiles('#rl-files', files);
await page.waitForFunction(() => document.querySelector('#rl-files')?.closest('label')?.textContent?.includes('8 vista'), null, { timeout: 60_000 });
await page.click('[data-rl="analyse"]'); await page.waitForSelector('[data-rl-strategy]', { timeout: 60_000 });
const refusedAuto = await page.locator('[data-rl-refusal="MASK_UNRELIABLE"]').count(), strategyAuto = await page.getAttribute('[data-rl-strategy]', 'data-rl-strategy');
await page.screenshot({ path: resolve(out, '01-auto-refused.png') });
record('1 contorno automático recusado em fundo real (fail-closed) e a estratégia pede «Ajustar contorno»', refusedAuto >= 4 && strategyAuto === 'needs-input' && /Ajustar contorno/.test(await page.locator('[data-rl-strategy]').innerText()), `${refusedAuto} vistas recusadas, estratégia ${strategyAuto}`);

// 2. interactive editor on every view: box around the object, one brush stroke inside (object) and one outside (background), compute, accept
let editedOk = 0;
for (let i = 0; i < 8; i++) {
  await page.click(`[data-rl-edit="${i}"]`); await page.waitForSelector('[data-rl-edit-canvas]');
  const canvas = page.locator('[data-rl-edit-canvas]'), cb = (await canvas.boundingBox())!, b = made.boxes[i]!, sx = cb.width / 640, sy = cb.height / 480;
  const px = (x: number, y: number) => ({ x: cb.x + x * sx, y: cb.y + y * sy });
  await page.check('input[name="rl-tool"][value="box"]');
  const p0 = px(b.x0 - 14, b.y0 - 14), p1 = px(b.x1 + 14, b.y1 + 14);
  await page.mouse.move(p0.x, p0.y); await page.mouse.down(); await page.mouse.move(p1.x, p1.y, { steps: 6 }); await page.mouse.up();
  await page.check('input[name="rl-tool"][value="fg"]'); const c = px((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2); await page.mouse.move(c.x - 20 * sx, c.y); await page.mouse.down(); await page.mouse.move(c.x + 20 * sx, c.y, { steps: 6 }); await page.mouse.up();
  await page.check('input[name="rl-tool"][value="bg"]'); const o = px(b.x0 - 8, b.y0 - 8); await page.mouse.move(o.x, o.y); await page.mouse.down(); await page.mouse.move(o.x + 30, o.y, { steps: 4 }); await page.mouse.up();
  await page.click('[data-rl="edit-run"]'); await page.waitForFunction(() => !(document.querySelector('[data-rl="edit-accept"]') as HTMLButtonElement | null)?.disabled, null, { timeout: 120_000 });
  if (i === 0) await page.screenshot({ path: resolve(out, '02-editor.png') });
  await page.click('[data-rl="edit-accept"]'); editedOk++;
}
record('2 contornos ajustados à mão (caixa + pincéis, calculados no Worker) nas 8 vistas', editedOk === 8, `${editedOk}/8 confirmados`);
await page.click('[data-rl="analyse"]'); await page.waitForSelector('[data-rl-strategy]', { timeout: 60_000 });
const refusedAfter = await page.locator('[data-rl-refusal]').count(), strategy = await page.getAttribute('[data-rl-strategy]', 'data-rl-strategy'), issues = await page.locator('[data-rl-issue]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.rlIssue));
const sources = await page.locator('.sp-comp-head .u-label', { hasText: 'contorno confirmado por si' }).count();
await page.screenshot({ path: resolve(out, '03-after-edit-analysis.png') });
record('3 depois do ajuste: sem recusas, estratégia casco, orientação de captura presente', refusedAfter === 0 && strategy === 'silhouette-hull' && issues.includes('NO_ELEVATION_VARIETY') && sources >= 8, `recusas ${refusedAfter}, estratégia ${strategy}, avisos [${issues.join(',')}], contornos confirmados ${sources}`);
await page.click('[data-rl="build"]'); await page.waitForSelector('.sp-root[data-phase="review"]', { timeout: 180_000 });
await page.click('[data-sp="keep-all"]'); await page.check('#sp-ack'); await page.click('[data-sp="build"]');
await page.waitForFunction(() => (window as never as { __workspace: { spaceActive: boolean } }).__workspace.spaceActive, null, { timeout: 180_000 });
await page.waitForSelector('[data-reality-review]', { timeout: 30_000 }); await page.waitForTimeout(1500);
await page.screenshot({ path: resolve(out, '04-built.png') });
const guidance = await page.locator('[data-rr-guidance]').innerText(), structure = await page.locator('[data-rr-structure]').count(), fidelity = await page.getAttribute('[data-reality-review] [data-fidelity]', 'data-fidelity');
record('4 Space construído; revisão mostra o que fotografar a seguir e a estrutura medida; nunca "fiel"', /elevad|cima|45/.test(guidance) && structure === 1 && fidelity !== 'faithful', `fidelidade ${fidelity}`);
record('5 nenhuma chamada paga', providerCalls === 0, `provider=${providerCalls}`);
record('6 sem erros de browser', errors.length === 0, errors.join(' | ') || 'limpo');
writeFileSync(resolve(out, 'e2e-result.json'), JSON.stringify({ asset, background: bgFile, results }, null, 2));
await browser.close(); await vite.close(); await new Promise<void>((r) => backend.close(() => r()));
if (results.some((r) => r.verdict === 'FAIL')) process.exit(1);
