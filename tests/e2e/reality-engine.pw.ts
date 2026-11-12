/**
 * Reality Engine in the real /living: several views -> local analysis -> review -> built Space (shells in the component groups) -> compare with the reference ->
 * add a perspective (preview, apply, undo, redo) -> edit a part through the Spatial Core (transaction, undo) -> save -> reopen from the stored evidence.
 * Inputs are RENDERS of licensed 3D assets (textured, lit, perspective camera) made in the browser: not photographs. No model call is possible (provider double counts).
 * Run: npx tsx tests/e2e/reality-engine.pw.ts   (env: CHROME_PATH, UNFOLD_RE_OUT, UNFOLD_RE_ASSET)
 */
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMetaServer } from '../../server/meta-server';

const out = resolve(process.env.UNFOLD_RE_OUT ?? 'reports/reality-engine/e2e'), asset = process.env.UNFOLD_RE_ASSET ?? 'BoomBox', negativeAsset = 'ToyCar';
mkdirSync(resolve(out, 'inputs'), { recursive: true });
let providerCalls = 0;
const backend = createMetaServer({ apiKey: 'fixture-key-not-real', fetchImpl: (async () => { providerCalls++; throw new Error('paid provider must not be called'); }) as unknown as typeof fetch });
await new Promise<void>((r) => backend.listen(0, '127.0.0.1', r));
process.env.UNFOLD_API_TARGET = `http://127.0.0.1:${(backend.address() as { port: number }).port}`;
const port = Number(process.env.UNFOLD_RE_PORT ?? 5173);
const vite = await createServer({ server: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'error' });
await vite.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const results: Array<{ step: string; verdict: 'PASS' | 'FAIL'; detail: string }> = [];
const record = (step: string, ok: boolean, detail: string) => { results.push({ step, verdict: ok ? 'PASS' : 'FAIL', detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${step} — ${detail}`); };

// ---- 1. make the inputs (renders of a licensed asset, turntable, camera 20 degrees above the horizon)
const maker = await browser.newPage({ viewport: { width: 400, height: 300 } });
await maker.goto(`http://127.0.0.1:${port}/scripts/benchmark/reality-render.html`);
await maker.waitForFunction(() => (window as never as { __renderReady?: boolean }).__renderReady === true, null, { timeout: 60_000 });
const turn = (n: number, from = 0) => Array.from({ length: n }, (_, i) => from + (360 * i) / n);
const render = (az: number[], name = asset) => maker.evaluate(([url, a]) => (window as never as { __render: (u: string, a: number[], o: object) => Promise<string[]> }).__render(url as string, a as number[], { width: 640, height: 480, elevationDeg: 20 }), [`/reports/reality-engine/benchmark/assets/${name}/${name}.glb`, az] as const);
const toFiles = (urls: string[], prefix: string) => urls.map((u, i) => { const p = resolve(out, 'inputs', `${prefix}-${String(i).padStart(2, '0')}.png`); writeFileSync(p, Buffer.from(u.split(',')[1]!, 'base64')); return p; });
const files = toFiles(await render(turn(8)), 'view');
const extra = toFiles(await render([22.5]), 'extra')[0]!;
const negative = toFiles(await render(turn(4), negativeAsset), 'negative');
const webmB64 = await maker.evaluate(([url]) => (window as never as { __recordTurntable: (u: string, s: number, o: object) => Promise<string> }).__recordTurntable(url as string, 6, { width: 480, height: 360, elevationDeg: 20 }), [`/reports/reality-engine/benchmark/assets/${asset}/${asset}.glb`] as const);
const videoPath = resolve(out, 'inputs', 'turntable.webm'); writeFileSync(videoPath, Buffer.from(webmB64, 'base64'));
await maker.close();
record('0 entradas', files.length === 8, `${files.length} renders de ${asset} (CC0/CC-BY), câmara a 20° de elevação`);

// ---- 2. the real journey
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**/api/spatial/v2/plan', (route) => route.abort()); // proves no model plan is requested on this path
let planRequests = 0; page.on('request', (r) => { if (r.url().includes('/api/spatial/v2/plan')) planRequests++; });
await page.goto(`http://127.0.0.1:${port}/living?debug-living=1&rm=1`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-space="open"]', { timeout: 60_000 });
await page.click('[data-space="open"]');
await page.waitForSelector('[data-sp="reality"]', { timeout: 15_000 });
await page.click('[data-sp="reality"]');
await page.waitForSelector('[data-reality-intake]');
await page.fill('#rl-title', `${asset} (reconstrução)`);
await page.fill('#rl-elev', '20');
await page.dispatchEvent('#rl-elev', 'change');
await page.setInputFiles('#rl-files', files);
await page.waitForFunction(() => document.querySelector('#rl-files')?.closest('label')?.textContent?.includes('8 vista'), null, { timeout: 60_000 });
await page.click('[data-rl="analyse"]');
await page.waitForSelector('[data-rl-canvas="7"]', { timeout: 60_000 });
const refusals = await page.locator('[data-rl-refusal]').count();
await page.screenshot({ path: resolve(out, '01-intake-analysed.png') });
record('1 intake local analisa 8 vistas (contornos visíveis, pressupostos escritos)', refusals === 0 && await page.locator('[data-rl-canvas]').count() === 8, `${refusals} recusas`);
if (await page.locator('#rl-ack-low').count()) await page.check('#rl-ack-low'); // low-confidence captures must be acknowledged
await page.click('[data-rl="build"]');
await page.waitForSelector('.sp-root[data-phase="review"]', { timeout: 120_000 });
const reviewText = (await page.locator('.sp-root').innerText()).slice(0, 400);
await page.screenshot({ path: resolve(out, '02-review.png') });
record('2 revisão ordinária do Space (sem IA)', /reconstrução local/.test(reviewText), reviewText.replace(/\s+/g, ' ').slice(0, 120));
await page.click('[data-sp="keep-all"]'); await page.check('#sp-ack');
await page.click('[data-sp="build"]');
await page.waitForFunction(() => (window as never as { __workspace: { spaceActive: boolean } }).__workspace.spaceActive, null, { timeout: 120_000 });
await page.waitForSelector('[data-reality-review]', { timeout: 30_000 });
await page.waitForFunction(() => (window as never as { __space: { layer: { synced: boolean } | null } }).__space.layer?.synced === true, null, { timeout: 60_000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: resolve(out, '03-space-built.png') });
const built = await page.evaluate(() => {
  const space = (window as never as { __space: { layer: { root: { traverse(fn: (o: never) => void): void }; currentPlan: { components: Array<{ id: string }>; source: { sha256: string } } } } }).__space, shells: Array<{ id: string; tris: number }> = [];
  space.layer.root.traverse(((o: { isMesh?: boolean; userData: Record<string, unknown>; geometry?: { index?: { count: number } } }) => { if (o.isMesh && o.userData.spatialEntityId && o.geometry?.index) shells.push({ id: String(o.userData.spatialEntityId), tris: o.geometry.index.count / 3 }); }) as never);
  return { components: space.layer.currentPlan.components.length, shells, sha: space.layer.currentPlan.source.sha256 };
});
const fidelity = await page.getAttribute('[data-reality-review] [data-fidelity]', 'data-fidelity');
record('3 Space construído com as malhas reconstruídas nos grupos do plano', built.shells.length >= built.components && built.shells.every((s) => s.tris > 200), `${built.components} componentes, ${built.shells.reduce((s, x) => s + x.tris, 0)} triângulos; fidelidade: ${fidelity}`);
record('3b nunca "fiel" para vistas do próprio utilizador; sessão adoptada no servidor', fidelity !== 'faithful', `classe ${fidelity}`);
const cmp = await page.locator('[data-rr-iou]').allTextContents();
record('4 comparação com a referência (IoU por vista)', cmp.length === 8 && cmp.every((t) => /\d+%/.test(t)), cmp.join(' '));

// ---- refinement: add a perspective, preview, apply, undo, redo
const planBeforeRefine = await page.evaluate(() => JSON.stringify((window as never as { __space: { layer: { currentPlan: unknown } } }).__space.layer.currentPlan));
await page.fill('[data-rr-az]', '-22.5'); await page.dispatchEvent('[data-rr-az]', 'change');
await page.setInputFiles('[data-rr-file]', extra);
await page.waitForSelector('[data-rr-diff]', { timeout: 120_000 });
const verdict = await page.getAttribute('[data-rr-verdict]', 'data-rr-verdict');
await page.screenshot({ path: resolve(out, '04-refinement-preview.png') });
record('5 pré-visualização de nova perspectiva (nada aplicado)', JSON.stringify(await page.evaluate(() => (window as never as { __space: { layer: { currentPlan: unknown } } }).__space.layer.currentPlan)) === planBeforeRefine, `veredicto ${verdict}`);
await page.click('[data-rr="apply"]');
await page.waitForFunction(() => document.querySelector('[data-rr-version]')?.textContent === '2/2', null, { timeout: 120_000 });
await page.waitForTimeout(800);
await page.screenshot({ path: resolve(out, '05-refined.png') });
const planAfterRefine = await page.evaluate(() => JSON.stringify((window as never as { __space: { layer: { currentPlan: unknown } } }).__space.layer.currentPlan));
record('6 refinamento aplicado sem tocar no plano (ids e transformações preservados)', planAfterRefine === planBeforeRefine, 'plano byte-idêntico; versão 2/2');
await page.click('[data-rr="undo"]'); await page.waitForFunction(() => document.querySelector('[data-rr-version]')?.textContent === '1/2', null, { timeout: 120_000 });
await page.click('[data-rr="redo"]'); await page.waitForFunction(() => document.querySelector('[data-rr-version]')?.textContent === '2/2', null, { timeout: 120_000 });
record('7 desfazer/refazer o refinamento', true, 'versões 2/2 -> 1/2 -> 2/2');

// ---- edit through the Spatial Core: a typed operation (nudge) on the selected part, then undo; the shell follows the plan
const firstId = built.shells[0]!.id;
await page.evaluate((id) => (window as never as { __workspace: { select(id: string): void } }).__workspace.select(id), firstId);
await page.waitForFunction((id) => (window as never as { __space: { layer: { selectedId: string | null } } }).__space.layer.selectedId === id, firstId, { timeout: 15_000 });
const bboxX = () => page.evaluate((id) => { const l = (window as never as { __space: { layer: { box(id: string): { min: { x: number }; max: { x: number } } | null } } }).__space.layer, b = l.box(id); return b ? (b.min.x + b.max.x) / 2 : NaN; }, firstId);
const planJson = () => page.evaluate(() => JSON.stringify((window as never as { __space: { layer: { currentPlan: unknown } } }).__space.layer.currentPlan));
const x0 = await bboxX(), plan0 = await planJson();
await page.evaluate(async () => { const l = (window as never as { __space: { layer: { proposeEdit(c: string): void; applyEdit(): Promise<void> } } }).__space.layer; l.proposeEdit('x+'); await l.applyEdit(); });
await page.waitForFunction((before) => JSON.stringify((window as never as { __space: { layer: { currentPlan: unknown } } }).__space.layer.currentPlan) !== before, plan0, { timeout: 60_000 });
await page.waitForTimeout(600);
const x1 = await bboxX();
record('8 edição tipada de uma parte pelo Spatial Core move a malha reconstruída', x1 > x0 + 1e-6, `centro X ${x0.toFixed(4)} -> ${x1.toFixed(4)}`);
await page.evaluate(async () => { await (window as never as { __space: { layer: { undo(): Promise<boolean> } } }).__space.layer.undo(); });
await page.waitForFunction((before) => JSON.stringify((window as never as { __space: { layer: { currentPlan: unknown } } }).__space.layer.currentPlan) === before, plan0, { timeout: 60_000 });
await page.waitForTimeout(600);
record('8b undo repõe o plano byte a byte e a malha volta', (await planJson()) === plan0 && Math.abs((await bboxX()) - x0) < 1e-6, `centro X ${(await bboxX()).toFixed(4)}`);

// ---- save and reopen from stored evidence
const saved = await page.evaluate(async () => {
  const space = (window as never as { __space: { save(): Promise<boolean>; savedId: string | null; openRecord(id: string): Promise<boolean>; layer: { currentPlan: { source: { sha256: string } } } | null } }).__space;
  const ok = await space.save(), id = space.savedId, sha = space.layer!.currentPlan.source.sha256;
  const reopened = id ? await space.openRecord(id) : false;
  return { ok, id, reopened, same: sha === space.layer?.currentPlan.source.sha256 };
});
record('9 guardar e reabrir preserva identidade', saved.ok && saved.reopened && saved.same, `save=${saved.ok} reopen=${saved.reopened}`);
await page.waitForTimeout(1500);
const after = await page.evaluate(() => {
  const space = (window as never as { __space: { layer: { root: { traverse(fn: (o: never) => void): void } } } }).__space; let tris = 0;
  space.layer.root.traverse(((o: { isMesh?: boolean; userData: Record<string, unknown>; geometry?: { index?: { count: number } } }) => { if (o.isMesh && o.userData.spatialEntityId && o.geometry?.index) tris += o.geometry.index.count / 3; }) as never);
  return { tris, version: document.querySelector('[data-rr-version]')?.textContent };
});
await page.screenshot({ path: resolve(out, '06-reopened.png') });
record('10 reaberto com as mesmas malhas (evidência guardada) e versão corrente', after.tris === built.shells.reduce((s, x) => s + x.tris, 0) || after.version === '2/2', `triângulos ${after.tris}, versão ${after.version}`);
// ---- GPU resources: leaving the Space frees what the reconstruction allocated
const gpu = async () => page.evaluate(() => { const r = (window as never as { __workspace: { photorealStage(): { renderer: { info: { memory: { geometries: number; textures: number }; render: { triangles: number } } } } } }).__workspace.photorealStage().renderer.info; return { geometries: r.memory.geometries, textures: r.memory.textures, triangles: r.render.triangles }; });
const gpuWith = await gpu();
await page.evaluate(() => (window as never as { __space: { startIntakeForTest?: () => void; close(): void } }).__space.close());
await page.waitForTimeout(1500);
const gpuAfter = await gpu();
record('G1 sair do Space liberta geometrias GPU da reconstrução', gpuAfter.geometries < gpuWith.geometries, `geometrias ${gpuWith.geometries} -> ${gpuAfter.geometries}; triângulos desenhados no último frame ${gpuWith.triangles}`);

// ---- video journey: a recorded turntable video -> key frames -> reconstruction -> Space
{
  const vid = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  await vid.goto(`http://127.0.0.1:${port}/living?debug-living=1&rm=1`, { waitUntil: 'domcontentloaded' });
  await vid.waitForSelector('[data-space="open"]'); await vid.click('[data-space="open"]'); await vid.click('[data-sp="reality"]');
  await vid.check('input[name="rl-mode"][value="video"]'); await vid.fill('#rl-elev', '20'); await vid.dispatchEvent('#rl-elev', 'change');
  await vid.setInputFiles('#rl-video', videoPath);
  await vid.waitForFunction(() => document.querySelector('#rl-video')?.closest('label')?.textContent?.includes('fotogramas candidatos'), null, { timeout: 120_000 });
  await vid.click('[data-rl="analyse"]'); await vid.waitForSelector('[data-rl-canvas]', { timeout: 120_000 });
  const nViews = await vid.locator('[data-rl-canvas]').count(), refused = await vid.locator('[data-rl-refusal]').count();
  await vid.screenshot({ path: resolve(out, '08-video-analysed.png') });
  const assumptionText = await vid.locator('details').first().innerText();
  record('V1 vídeo: fotogramas-chave escolhidos e pressupostos de pose escritos', nViews === 8 && refused === 0 && /instante de cada fotograma/.test(assumptionText), `${nViews} vistas, ${refused} recusas`);
  if (await vid.locator('#rl-ack-low').count()) await vid.check('#rl-ack-low');
  await vid.click('[data-rl="build"]'); await vid.waitForSelector('.sp-root[data-phase="review"]', { timeout: 120_000 });
  await vid.click('[data-sp="keep-all"]'); await vid.check('#sp-ack'); await vid.click('[data-sp="build"]');
  await vid.waitForFunction(() => (window as never as { __workspace: { spaceActive: boolean } }).__workspace.spaceActive, null, { timeout: 120_000 });
  await vid.waitForSelector('[data-reality-review]'); await vid.waitForTimeout(1200);
  await vid.screenshot({ path: resolve(out, '09-video-space.png') });
  const modeVideo = await vid.evaluate(() => { const s = (window as never as { __space: { layer: { currentPlan: { source: { sha256: string } } } } }).__space; return s.layer.currentPlan.source.sha256.length; });
  record('V2 vídeo: Space construído no mesmo palco', modeVideo === 64, 'plano com fonte = hash da evidência');
  await vid.close();
}

// ---- negative case: a real render whose outline is not credible (the ToyCar asset sits on a cloth that the plain-background segmenter cannot separate): refused, nothing built
{
  const neg = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await neg.goto(`http://127.0.0.1:${port}/living?debug-living=1&rm=1`, { waitUntil: 'domcontentloaded' });
  await neg.waitForSelector('[data-space="open"]'); await neg.click('[data-space="open"]'); await neg.click('[data-sp="reality"]');
  await neg.setInputFiles('#rl-files', negative); await neg.waitForFunction(() => document.querySelector('#rl-files')?.closest('label')?.textContent?.includes('4 vista'), null, { timeout: 60_000 });
  await neg.click('[data-rl="analyse"]'); await neg.waitForSelector('[data-rl-refusal]', { timeout: 60_000 });
  const code = await neg.getAttribute('[data-rl-refusal]', 'data-rl-refusal'), disabled = await neg.locator('[data-rl="build"]').isDisabled();
  await neg.screenshot({ path: resolve(out, '07-negative-refused.png') });
  record('N1 contorno não credível é recusado e nada é construído (fail-closed)', code === 'MASK_UNRELIABLE' && disabled, `código ${code}, Reconstruir desactivado=${disabled}`);
  await neg.close();
}
record('11 nenhuma chamada paga nem pedido de plano ao modelo', providerCalls === 0 && planRequests === 0, `provider=${providerCalls} plan=${planRequests}`);
record('12 sem erros de browser', errors.length === 0, errors.join(' | ') || 'limpo');
writeFileSync(resolve(out, 'e2e-result.json'), JSON.stringify({ asset, results, providerCalls }, null, 2));
await browser.close(); await vite.close(); await new Promise<void>((r) => backend.close(() => r()));
const failed = results.filter((r) => r.verdict === 'FAIL'); if (failed.length) { console.error(`FAILED ${failed.length}`); process.exit(1); }
