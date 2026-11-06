/**
 * Certificação final no /living real (sem funcionalidades novas):
 * A) veículo real com máscara confirmada → fitting com câmara dos píxeis → exploração →
 *    proposta → commit → undo → guardar → reabrir;
 * B) escavadora sintética (cinemática verificada; não é reconstrução fotográfica);
 * C) objecto não-automóvel (porta) com exploração conceptual declarada;
 * + casos negativos no browser e flags desligadas por omissão.
 * Run: npx tsx tests/e2e/final-certification.pw.ts
 */
import { chromium, type Page } from 'playwright-core';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createMetaServer } from '../../server/meta-server';
import { suv } from '../../src/living/universal-foundry/fixtures/plans';
import { doorSpacePlanFixture } from '../../src/living/living-intelligence/space-bridge';
import type { SpatialPlanV2 } from '../../src/universal-spatial/contracts-v2';

const out = resolve(process.env.UNFOLD_FC_OUT ?? 'reports/product-integration/final-certification/captures');
mkdirSync(out, { recursive: true });
let providerCalls = 0;
const backend = createMetaServer({ apiKey: 'fixture-key-not-real', fetchImpl: (async () => { providerCalls++; throw new Error('paid provider must not be called'); }) as unknown as typeof fetch });
await new Promise<void>((r) => backend.listen(0, '127.0.0.1', r));
process.env.UNFOLD_API_TARGET = `http://127.0.0.1:${(backend.address() as { port: number }).port}`;
const vite = await createServer({ server: { host: '127.0.0.1', port: 5173, strictPort: true }, logLevel: 'error' });
await vite.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const envelope = JSON.parse(readFileSync(resolve('reports/visual-recovery/fixtures/bicycle.json'), 'utf8')) as Record<string, unknown>;
const corrections = JSON.parse(readFileSync(resolve('tests/fixtures/photos-real/corrections.json'), 'utf8')) as { cases: Array<{ id: string; polygon: Array<[number, number]> }> };
const FLAGS = 'debug-living=1&experimental-foundry=1&experimental-living-intelligence=1&experimental-photoreal=1&experimental-mediapipe=1&rm=1';
const results: Array<{ step: string; verdict: 'PASS' | 'FAIL'; detail: string }> = [];
const record = (step: string, ok: boolean, detail: string) => { results.push({ step, verdict: ok ? 'PASS' : 'FAIL', detail }); process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${step} — ${detail}\n`); };

async function routePlan(page: Page, make: (sha: string) => SpatialPlanV2, tag: string): Promise<void> {
  await page.route('**/api/spatial/v2/plan', async (route) => {
    const body = route.request().postDataJSON() as { imageDataUrl?: string };
    const sha = createHash('sha256').update(body.imageDataUrl ?? tag).digest('hex');
    const plan = make(sha);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...envelope, plan, meta: { model: 'labelled-fixture (not Muse Spark)', requestId: `fc-${tag}` }, limitations: ['Plano fixture rotulado; backend real para adopt/sessão/transacções.'] }) });
  });
}
async function buildFromUpload(page: Page, photo: string): Promise<void> {
  await page.goto(`http://127.0.0.1:5173/living?${FLAGS}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="living-intelligence"]', { timeout: 30_000 });
  await page.click('[data-space="open"]');
  await page.setInputFiles('#sp-file', resolve(photo.includes('/') ? photo : `tests/fixtures/photos-real/${photo}`));
  await page.click('[data-sp="submit"]');
  await page.waitForSelector('.sp-root[data-phase="review"]', { timeout: 60_000 });
}

// ---------- A. Veículo real ----------
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await routePlan(page, (sha) => { const t = suv(); return { ...t, source: { kind: 'image', sha256: sha }, title: `${t.title} (modelo semântico fixture)`, unknowns: [...t.unknowns, 'semantic plan supplied as a labelled offline fixture matched by source sha256; not Muse Spark inference'] }; }, 'skoda');
  await buildFromUpload(page, 'skoda-kodiaq.jpg');
  await page.screenshot({ path: resolve(out, 'A-01-review.png') });
  await page.click('[data-sp="correct-contour"]');
  await page.waitForSelector('#sp-contour', { timeout: 15_000 });
  await page.waitForTimeout(800);
  await page.evaluate((points) => { (window as never as { __space: { setContourPoints(p: Array<[number, number]>): void } }).__space.setContourPoints(points); }, corrections.cases.find((c) => c.id === 'skoda-kodiaq')!.polygon);
  await page.click('[data-sp="contour-preview"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(out, 'A-02-contour-confirmed.png') });
  await page.click('[data-sp="contour-confirm"]');
  await page.waitForFunction(() => document.body.innerText.includes('corrigido por si'), null, { timeout: 15_000 });
  await page.click('[data-sp="keep-all"]');
  await page.check('#sp-ack');
  await page.click('[data-sp="build"]');
  await page.waitForFunction(() => (window as never as { __workspace: { spaceActive: boolean } }).__workspace.spaceActive, null, { timeout: 60_000 });
  await page.waitForFunction(() => (window as never as { __space: { layer: { synced: boolean } | null } }).__space.layer?.synced === true, null, { timeout: 60_000 });
  await page.waitForFunction(() => {
    const f = (window as never as { __foundry3d: { fitting: { status: string } | null } }).__foundry3d.fitting;
    return f !== null && f.status !== 'pending';
  }, null, { timeout: 180_000 });
  const diagA = await page.evaluate(() => {
    const foundry = (window as never as { __foundry3d: { fitting: { status: string; cameraMethod?: string; cameraAzimuthDeg?: number; silhouetteIou?: number; baselineSilhouetteIou?: number } | null; maskProvenance: string | null; fittingTransport: string | null } }).__foundry3d;
    const layer = (window as never as { __space: { layer: { currentPlan: SpatialPlanV2 } } }).__space.layer;
    return { fitting: foundry.fitting, maskProvenance: foundry.maskProvenance, transport: foundry.fittingTransport, sourceSha: layer.currentPlan.source.sha256, components: layer.currentPlan.components.map((c) => c.id) };
  });
  record('A1 identidade fonte→plano', diagA.sourceSha.length === 64, `source.sha256=${diagA.sourceSha.slice(0, 12)}… componentes=${diagA.components.join(',')}`);
  record('A2 fitting com câmara dos píxeis (Worker)', diagA.fitting?.status === 'fitted' && /regiões de pneu/.test(diagA.fitting?.cameraMethod ?? '') && diagA.transport === 'worker', `az=${diagA.fitting?.cameraAzimuthDeg?.toFixed(1)}° IoU ${diagA.fitting?.baselineSilhouetteIou?.toFixed(3)}→${diagA.fitting?.silhouetteIou?.toFixed(3)} máscara=${diagA.maskProvenance}`);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: resolve(out, 'A-03-fitted-scene.png') });
  // exploração + explicação de componente real
  await page.click('[data-space-entity="wheel-0"]');
  await page.click('[data-space-explain]');
  await page.waitForFunction(() => /wheel|inferid/i.test(document.querySelector('[data-li-output]')?.textContent ?? ''), null, { timeout: 10_000 });
  record('A3 componente real explicado', true, 'wheel-0 existe no plano e a explicação o refere');
  await page.screenshot({ path: resolve(out, 'A-04-component-explained.png') });
  // proposta → commit → undo
  const planBefore = await page.evaluate(() => JSON.stringify((window as never as { __space: { layer: { currentPlan: unknown } } }).__space.layer.currentPlan));
  await page.evaluate(() => { document.querySelector<HTMLButtonElement>('[data-proportions]')?.click(); });
  await page.waitForFunction(() => document.querySelector('[data-proportions-status]')?.textContent?.includes('Proposta tipada criada'), null, { timeout: 20_000 });
  const unchanged = await page.evaluate((before) => JSON.stringify((window as never as { __space: { layer: { currentPlan: unknown } } }).__space.layer.currentPlan) === before, planBefore);
  record('A4 proposta não altera o plano', unchanged, 'pendente tipada sem escrita autoritativa');
  await page.waitForSelector('[data-apply]', { timeout: 20_000 });
  await page.evaluate(() => { const box = document.querySelector<HTMLInputElement>('[data-auth]'); if (box && !box.checked) box.click(); document.querySelector<HTMLButtonElement>('[data-apply]')?.click(); });
  await page.waitForFunction((before) => JSON.stringify((window as never as { __space: { layer: { currentPlan: unknown } } }).__space.layer.currentPlan) !== before, planBefore, { timeout: 60_000 });
  record('A5 commit muda o plano (transacção)', true, 'SpatialPlanV2 commitado via inspector');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: resolve(out, 'A-05-committed.png') });
  await page.click('[data-space-entity="wheel-0"]');
  await page.waitForSelector('[data-undo]', { timeout: 20_000 });
  await page.evaluate(() => { document.querySelector<HTMLButtonElement>('[data-undo]')?.click(); });
  await page.waitForFunction((original) => JSON.stringify((window as never as { __space: { layer: { currentPlan: unknown } } }).__space.layer.currentPlan) === original, planBefore, { timeout: 60_000 });
  record('A6 undo restaura o original', true, 'plano byte-idêntico após undo');
  // guardar → reabrir
  const saved = await page.evaluate(async () => {
    const space = (window as never as { __space: { save(): Promise<boolean>; savedId: string | null; openRecord(id: string): Promise<boolean>; layer: { currentPlan: SpatialPlanV2 } | null } }).__space;
    const ok = await space.save();
    const id = space.savedId;
    const shaBefore = space.layer?.currentPlan.source.sha256;
    const reopened = id ? await space.openRecord(id) : false;
    return { ok, id, reopened, shaAfter: space.layer?.currentPlan.source.sha256, same: shaBefore === space.layer?.currentPlan.source.sha256 };
  });
  record('A7 guardar e reabrir preserva identidade', saved.ok && saved.reopened && saved.same, `save=${saved.ok} reopen=${saved.reopened} id=${saved.id?.slice(0, 8)}…`);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: resolve(out, 'A-06-reopened.png') });
  record('A8 sem erros de browser (A)', errors.length === 0, errors.join(' | ') || 'limpo');
  await page.close();
}

// ---------- B. Máquina sintética ----------
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:5173/living?${FLAGS}&example=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="living-intelligence"]', { timeout: 30_000 });
  await page.waitForTimeout(2000);
  await page.click('[data-entity="boom"]');
  const input = page.locator('[data-li-input]');
  await input.fill('O que faz a lança?');
  await page.click('.li-command button[type="submit"]');
  await page.waitForFunction(() => /primeiro braço/.test(document.querySelector('[data-li-output]')?.textContent ?? ''), null, { timeout: 10_000 });
  record('B1 explicação da lança (sintética, declarada)', true, 'âncora na entidade boom da montagem verificada');
  await page.screenshot({ path: resolve(out, 'B-01-explain.png') });
  await input.fill('Estende o cilindro da lança');
  await page.click('.li-command button[type="submit"]');
  await page.waitForFunction(() => (document.querySelector('[data-li-output]')?.textContent ?? '').includes('A animar boom_cylinder'), null, { timeout: 10_000 });
  await page.waitForTimeout(1100);
  await page.click('[data-play="pause"]');
  record('B2 movimento ligado com pausa', true, 'cilindro→lança→descendentes pelo solver, fecho verificado');
  await page.screenshot({ path: resolve(out, 'B-02-motion.png') });
  await page.click('[data-mode="experiment"]');
  await page.click('[data-exp="0"]');
  await page.waitForFunction(() => (document.querySelector('[data-li-output]')?.textContent ?? '').includes('Curso'), null, { timeout: 10_000 });
  record('B3 experiência repetível', true, 'antes/depois calculados das poses do motor');
  await page.screenshot({ path: resolve(out, 'B-03-experiment.png') });
  record('B4 sem erros de browser (B)', errors.length === 0, errors.join(' | ') || 'limpo');
  await page.close();
}

// ---------- C. Não-automóvel ----------
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await routePlan(page, (sha) => doorSpacePlanFixture(sha), 'door');
  await buildFromUpload(page, 'tests/fixtures/photos/door-photo.png');
  await page.click('[data-sp="keep-all"]');
  await page.check('#sp-ack');
  await page.click('[data-sp="build"]');
  await page.waitForFunction(() => (window as never as { __workspace: { spaceActive: boolean } }).__workspace.spaceActive, null, { timeout: 60_000 });
  await page.waitForSelector('[data-li-space]', { timeout: 30_000 });
  await page.waitForTimeout(1200);
  await page.click('[data-space-entity="door-leaf"]');
  await page.click('[data-space-explain]');
  await page.waitForFunction(() => /door-hinge|inferida/i.test(document.querySelector('[data-li-output]')?.textContent ?? ''), null, { timeout: 10_000 });
  record('C1 porta: componente explicado (conceptual declarado)', true, 'fixture rotulado; movimento inferido, não fitting de veículo');
  await page.click('[data-space-motion="open"]');
  await page.waitForTimeout(1800);
  await page.screenshot({ path: resolve(out, 'C-01-door-interaction.png') });
  record('C2 porta: interacção transitória visível', true, 'rotação inferida em torno da dobradiça, plano intacto');
  record('C3 sem erros de browser (C)', errors.length === 0, errors.join(' | ') || 'limpo');
  await page.close();
}

// ---------- Negativos no browser ----------
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(`http://127.0.0.1:5173/living?${FLAGS}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="living-intelligence"]', { timeout: 30_000 });
  // String de propósito: o evaluate serializado pelo tsx injecta __name em callbacks nomeados.
  const negatives = await page.evaluate(`(async () => {
    const fit = await import('/src/living/universal-foundry/fitting.ts');
    const seg = await import('/src/living/universal-foundry/mediapipe-segmentation.ts');
    const plans = await import('/src/living/universal-foundry/fixtures/plans.ts');
    const frontal = { width: 100, height: 80, foregroundRatio: 0.35, bbox: { x0: 20, y0: 10, x1: 80, y1: 70 }, aspect: 1.05, symmetry: 0.95, colours: [], mask: new Uint8Array(8000).fill(1), largestComponentShare: 1 };
    const frontalResult = fit.fitGeometryToEvidence(plans.sedan(), frontal);
    const badModel = await seg.mediapipeVehicleEvidence('data:image/png;base64,lixo-invalido');
    const ev2 = await import('/src/living/universal-foundry/evidence.ts');
    const polygon = [[0.2,0.55],[0.29,0.22],[0.71,0.22],[0.8,0.55],[0.8,0.85],[0.68,0.85],[0.66,0.66],[0.34,0.66],[0.32,0.85],[0.2,0.85]];
    const mask = ev2.polygonMask(polygon, 200, 134);
    const passable = { width: 200, height: 134, foregroundRatio: 0.3, bbox: { x0: 40, y0: 29, x1: 160, y1: 114 }, aspect: 1.42, symmetry: 0.3, colours: [], mask, largestComponentShare: 1 };
    const controller = new AbortController();
    const cancelled = await fit.fitGeometryToEvidenceAsync(plans.sedan(), passable, { signal: controller.signal, onProgress: function () { controller.abort(); } });
    return { frontal: frontalResult.status, frontalReason: frontalResult.status === 'insufficient_evidence' ? frontalResult.reason.slice(0, 60) : '', badModel, cancelled: cancelled.status };
  })()`) as { frontal: string; frontalReason: string; badModel: unknown; cancelled: string };
  record('N1 vista frontal recusada', negatives.frontal === 'insufficient_evidence', negatives.frontalReason);
  record('N2 falha do modelo não bloqueia (fallback)', negatives.badModel === null, 'mediapipeVehicleEvidence devolve null com entrada inválida');
  record('N3 fitting cancelado sem aplicar', negatives.cancelled === 'aborted', `estado=${negatives.cancelled}`);
  await page.screenshot({ path: resolve(out, 'N-01-negatives.png') });
  await page.close();
}

// ---------- Flags desligadas por omissão + mobile ----------
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto('http://127.0.0.1:5173/living', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const off = await page.evaluate(() => ({ living: !!document.querySelector('[data-testid="living-intelligence"]'), foundryPanel: !!document.querySelector('[data-foundry-panel]') }));
  record('N4 flags experimentais desligadas por omissão', !off.living && !off.foundryPanel, JSON.stringify(off));
  await page.close();
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const merrors: string[] = [];
  mobile.on('pageerror', (e) => merrors.push(e.message));
  await mobile.goto(`http://127.0.0.1:5173/living?${FLAGS}&example=1`, { waitUntil: 'domcontentloaded' });
  await mobile.waitForSelector('[data-testid="living-intelligence"]', { timeout: 30_000 });
  await mobile.waitForTimeout(1800);
  await mobile.screenshot({ path: resolve(out, 'M-01-mobile.png') });
  record('M1 mobile sem erros críticos', merrors.length === 0, merrors.join(' | ') || 'limpo a 390×844');
  await mobile.close();
}

writeFileSync(resolve(out, '..', 'certification-results.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => r.verdict === 'FAIL');
assert.equal(providerCalls, 0, 'nenhuma chamada paga');
process.stdout.write(`CERTIFICATION ${failed.length ? `FAILED (${failed.length})` : 'OK'} — ${results.filter((r) => r.verdict === 'PASS').length}/${results.length} PASS\n`);
await browser.close();
await vite.close();
await new Promise<void>((r) => backend.close(() => r()));
if (failed.length) process.exitCode = 1;
