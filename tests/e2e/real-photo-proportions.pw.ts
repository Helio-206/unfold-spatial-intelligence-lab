/**
 * Proporções derivadas da evidência no /living real: (1) Skoda com contorno confirmado →
 * fitting → «Propor proporções derivadas da evidência» cria a proposta tipada pendente na
 * layer (nada aplicado sem autorização); (2) carro com segmentação aprendida local
 * (MediaPipe DeepLab v3, flag experimental-mediapipe) como evidência automática.
 * Run: npx tsx tests/e2e/real-photo-proportions.pw.ts
 */
import { chromium, type Page } from 'playwright-core';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createMetaServer } from '../../server/meta-server';
import { hatchback, suv } from '../../src/living/universal-foundry/fixtures/plans';
import type { SpatialPlanV2 } from '../../src/universal-spatial/contracts-v2';

const out = resolve(process.env.UNFOLD_RPP_OUT ?? 'reports/product-integration/real-photo-evidence/proportions');
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
const pass = (m: string) => process.stdout.write(`PASS ${m}\n`);
const diagnostics: Record<string, unknown> = {};

async function buildSpace(page: Page, photo: string, template: () => SpatialPlanV2, tag: string, extraFlags: string): Promise<void> {
  await page.route('**/api/spatial/v2/plan', async (route) => {
    const body = route.request().postDataJSON() as { imageDataUrl?: string };
    const sha = createHash('sha256').update(body.imageDataUrl ?? photo).digest('hex');
    const plan: SpatialPlanV2 = { ...template(), source: { kind: 'image', sha256: sha }, title: `${template().title} (modelo semântico fixture)`, unknowns: [...template().unknowns, 'semantic plan supplied as a labelled offline fixture matched by source sha256; not Muse Spark inference'] };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...envelope, plan, meta: { model: 'labelled-fixture (not Muse Spark)', requestId: `rpp-${tag}` }, limitations: ['Plano fixture rotulado.'] }) });
  });
  await page.goto(`http://127.0.0.1:5173/living?debug-living=1&experimental-foundry=1&experimental-living-intelligence=1&experimental-photoreal=1&rm=1${extraFlags}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="living-intelligence"]', { timeout: 30_000 });
  await page.click('[data-space="open"]');
  await page.setInputFiles('#sp-file', resolve('tests/fixtures/photos-real', photo));
  await page.click('[data-sp="submit"]');
  await page.waitForSelector('.sp-root[data-phase="review"]', { timeout: 60_000 });
}

// --- 1) Skoda: contorno confirmado → fitting → proposta tipada pendente (não aplicada)
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await buildSpace(page, 'skoda-kodiaq.jpg', suv, 'skoda', '');
  await page.click('[data-sp="correct-contour"]');
  await page.waitForSelector('#sp-contour', { timeout: 15_000 });
  await page.waitForTimeout(800);
  await page.evaluate((points) => { (window as never as { __space: { setContourPoints(p: Array<[number, number]>): void } }).__space.setContourPoints(points); }, corrections.cases.find((c) => c.id === 'skoda-kodiaq')!.polygon);
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
  }, null, { timeout: 120_000 });
  const planBefore = await page.evaluate(() => JSON.stringify((window as never as { __space: { layer: { currentPlan: unknown } } }).__space.layer.currentPlan));
  // seleccionar ANTES de propor: highlight() na layer limpa propostas pendentes anteriores
  await page.click('[data-space-entity="wheel-0"]');
  // os dois painéis experimentais sobrepõem-se à direita: despachar o clique no botão real
  await page.evaluate(() => { document.querySelector<HTMLButtonElement>('[data-proportions]')?.click(); });
  await page.waitForFunction(() => document.querySelector('[data-proportions-status]')?.textContent?.includes('Proposta tipada criada'), null, { timeout: 20_000 });
  const pending = await page.evaluate((before) => {
    const layer = (window as never as { __space: { layer: { pendingEdit: { label: string; operations: unknown[] } | null; currentPlan: unknown } } }).__space.layer;
    return { pendingLabel: layer.pendingEdit?.label ?? null, operations: layer.pendingEdit?.operations.length ?? 0, planUnchanged: JSON.stringify(layer.currentPlan) === before };
  }, planBefore);
  diagnostics.skodaProportions = pending;
  process.stdout.write(`DIAG skodaProportions ${JSON.stringify(pending)}\n`);
  assert.ok(pending.pendingLabel, 'a proposta tipada ficou pendente na layer');
  assert.ok(pending.operations > 0);
  assert.equal(pending.planUnchanged, true, 'propor não aplica: o plano autoritativo não mudou');
  pass('proposta de proporções criada como edição pendente tipada; plano intacto sem autorização');
  await page.screenshot({ path: resolve(out, 'skoda-01-proportions-proposed.png') });
  // Integração autoritativa completa: aplicar pela UI do inspector (transacção E1.4.1 no
  // backend real) → plano commitado muda → geometria regenera → undo restaura o original.
  await page.waitForSelector('[data-apply]', { timeout: 20_000 });
  await page.evaluate(() => { const box = document.querySelector<HTMLInputElement>('[data-auth]'); if (box && !box.checked) box.click(); });
  await page.evaluate(() => { document.querySelector<HTMLButtonElement>('[data-apply]')?.click(); });
  await page.waitForFunction((before) => JSON.stringify((window as never as { __space: { layer: { currentPlan: unknown } } }).__space.layer.currentPlan) !== before, planBefore, { timeout: 60_000 });
  const planAfterApply = await page.evaluate(() => JSON.stringify((window as never as { __space: { layer: { currentPlan: unknown } } }).__space.layer.currentPlan));
  assert.notEqual(planAfterApply, planBefore);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: resolve(out, 'skoda-02-proportions-committed.png') });
  pass('proposta aplicada pela transacção existente: SpatialPlanV2 commitado e geometria regenerada');
  await page.click('[data-space-entity="wheel-0"]');
  await page.waitForSelector('[data-undo]', { timeout: 20_000 });
  await page.evaluate(() => { document.querySelector<HTMLButtonElement>('[data-undo]')?.click(); });
  await page.waitForFunction((original) => JSON.stringify((window as never as { __space: { layer: { currentPlan: unknown } } }).__space.layer.currentPlan) === original, planBefore, { timeout: 60_000 });
  pass('undo restaurou exactamente o plano original');
  diagnostics.skodaCommitted = { appliedChangedPlan: true, undoRestored: true };
  assert.deepEqual(errors, [], errors.join(' | '));
  await page.close();
}

// --- 2) Carro com segmentação aprendida local (sem correcção manual)
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await buildSpace(page, 'car.jpg', hatchback, 'car-mediapipe', '&experimental-mediapipe=1');
  await page.click('[data-sp="keep-all"]');
  await page.check('#sp-ack');
  await page.click('[data-sp="build"]');
  await page.waitForFunction(() => (window as never as { __workspace: { spaceActive: boolean } }).__workspace.spaceActive, null, { timeout: 60_000 });
  await page.waitForFunction(() => {
    const f = (window as never as { __foundry3d: { fitting: { status: string } | null } }).__foundry3d.fitting;
    return f !== null && f.status !== 'pending';
  }, null, { timeout: 180_000 });
  const diag = await page.evaluate(() => {
    const foundry = (window as never as { __foundry3d: { fitting: unknown; maskProvenance: string | null; segmentationSource: string | null } }).__foundry3d;
    return { fitting: foundry.fitting, maskProvenance: foundry.maskProvenance, segmentationSource: foundry.segmentationSource };
  });
  diagnostics.carMediapipe = diag;
  process.stdout.write(`DIAG carMediapipe ${JSON.stringify(diag)}\n`);
  assert.equal(diag.segmentationSource, 'model-mediapipe-deeplab-v3');
  assert.equal(diag.maskProvenance, 'automatic');
  pass(`segmentação aprendida local usada como evidência automática (veredicto do fitting: ${(diag.fitting as { status: string }).status})`);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: resolve(out, 'car-mediapipe-01-scene.png') });
  assert.deepEqual(errors, [], errors.join(' | '));
  await page.close();
}
writeFileSync(resolve(out, 'diagnostics.json'), JSON.stringify(diagnostics, null, 2));
assert.equal(providerCalls, 0);
await browser.close();
await vite.close();
await new Promise<void>((r) => backend.close(() => r()));
process.stdout.write('REAL-PHOTO-PROPORTIONS-E2E OK\n');
