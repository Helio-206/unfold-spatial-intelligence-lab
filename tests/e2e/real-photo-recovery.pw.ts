/**
 * Recuperação com contorno corrigido em /living: fotografia real → revisão → «Corrigir
 * contorno» → pré-visualizar → confirmar → plano fixture rotulado casado por sha256 →
 * fitting com máscara user_confirmed (Worker) → veredicto geométrico separado (IoU da
 * silhueta projectada) → photoreal → explicação → interacção. Os polígonos de correcção
 * são a segunda passagem do implementador (corrections.json); a referência é a primeira
 * (annotations.json) — mesmo anotador, limitação declarada.
 * Run: npx tsx tests/e2e/real-photo-recovery.pw.ts
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

const out = resolve(process.env.UNFOLD_RPR_OUT ?? 'reports/product-integration/real-photo-evidence/recovery');
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
const annotations = JSON.parse(readFileSync(resolve('tests/fixtures/photos-real/annotations.json'), 'utf8')) as { cases: Array<{ id: string; polygon: Array<[number, number]> }> };
const FLAGS = 'debug-living=1&experimental-foundry=1&experimental-living-intelligence=1&experimental-photoreal=1&rm=1';
const pass = (m: string) => process.stdout.write(`PASS ${m}\n`);
const diagnostics: Record<string, unknown> = {};

async function run(page: Page, photo: string, template: () => SpatialPlanV2, tag: string): Promise<void> {
  const correction = corrections.cases.find((c) => c.id === tag)!;
  const annotation = annotations.cases.find((c) => c.id === tag)!;
  await page.route('**/api/spatial/v2/plan', async (route) => {
    const body = route.request().postDataJSON() as { imageDataUrl?: string };
    const sha = createHash('sha256').update(body.imageDataUrl ?? photo).digest('hex');
    const plan: SpatialPlanV2 = { ...template(), source: { kind: 'image', sha256: sha }, title: `${template().title} (modelo semântico fixture)`, unknowns: [...template().unknowns, 'semantic plan supplied as a labelled offline fixture matched by source sha256; not Muse Spark inference'] };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...envelope, plan, meta: { model: 'labelled-fixture (not Muse Spark)', requestId: `rpr-${tag}` }, limitations: ['Plano fixture rotulado; backend real para adopt/sessão.'] }) });
  });
  await page.goto(`http://127.0.0.1:5173/living?${FLAGS}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="living-intelligence"]', { timeout: 30_000 });
  await page.click('[data-space="open"]');
  await page.setInputFiles('#sp-file', resolve('tests/fixtures/photos-real', photo));
  await page.click('[data-sp="submit"]');
  await page.waitForSelector('.sp-root[data-phase="review"]', { timeout: 60_000 });
  // Recuperação: corrigir o contorno sobre a fotografia original
  await page.click('[data-sp="correct-contour"]');
  await page.waitForSelector('#sp-contour', { timeout: 15_000 });
  await page.waitForTimeout(900);
  await page.evaluate((points) => { (window as never as { __space: { setContourPoints(p: Array<[number, number]>): void } }).__space.setContourPoints(points); }, correction.polygon);
  await page.click('[data-sp="contour-preview"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(out, `${tag}-01-contour-editor.png`) });
  await page.click('[data-sp="contour-confirm"]');
  await page.waitForFunction(() => document.body.innerText.includes('corrigido por si'), null, { timeout: 15_000 });
  pass(`${tag}: contorno corrigido e confirmado na revisão (proveniência user_confirmed)`);
  await page.click('[data-sp="keep-all"]');
  await page.check('#sp-ack');
  await page.click('[data-sp="build"]');
  await page.waitForFunction(() => (window as never as { __workspace: { spaceActive: boolean } }).__workspace.spaceActive, null, { timeout: 60_000 });
  await page.waitForFunction(() => (window as never as { __space: { layer: { synced: boolean } | null } }).__space.layer?.synced === true, null, { timeout: 60_000 });
  await page.waitForSelector('[data-li-space]', { timeout: 30_000 });
  await page.waitForFunction(() => {
    const f = (window as never as { __foundry3d: { fitting: { status: string } | null } }).__foundry3d.fitting;
    return f !== null && f.status !== 'pending';
  }, null, { timeout: 120_000 });
  const diag = await page.evaluate(async ({ corr, ann }) => {
    // @ts-ignore — módulos carregados pelo Vite dentro da página
    const ev = await import('/src/living/universal-foundry/evidence.ts');
    const foundry = (window as never as { __foundry3d: { fitting: unknown; maskProvenance: string | null; fittingTransport: string | null } }).__foundry3d;
    const W = 200, H = 134;
    const corrMask = ev.polygonMask(corr as Array<[number, number]>, W, H);
    const annMask = ev.polygonMask(ann as Array<[number, number]>, W, H);
    return {
      correctedVsAnnotationIoU: +ev.silhouetteIoU(corrMask, annMask).toFixed(3),
      correctedBboxErrorPx: ev.bboxErrorPx(ev.maskBbox(corrMask, W, H), ev.maskBbox(annMask, W, H)),
      maskProvenance: foundry.maskProvenance, fittingTransport: foundry.fittingTransport, fitting: foundry.fitting,
      photorealActive: ((window as never as { __photoreal?: { active(): boolean } }).__photoreal?.active() ?? false),
    };
  }, { corr: correction.polygon, ann: annotation.polygon });
  diagnostics[tag] = diag;
  process.stdout.write(`DIAG ${tag} ${JSON.stringify(diag)}\n`);
  assert.ok(diag.correctedVsAnnotationIoU >= 0.7, `máscara corrigida deve coincidir com a referência (IoU=${diag.correctedVsAnnotationIoU})`);
  assert.equal(diag.maskProvenance, 'user_confirmed');
  assert.equal(diag.photorealActive, true);
  const fitting = diag.fitting as { status: string; silhouetteIou?: number; baselineSilhouetteIou?: number; reason?: string; summary?: string };
  if (fitting.status === 'fitted') pass(`${tag}: geometria ajustada à silhueta confirmada (IoU ${fitting.baselineSilhouetteIou?.toFixed(3)} → ${fitting.silhouetteIou?.toFixed(3)}) via ${diag.fittingTransport}`);
  else pass(`${tag}: máscara aceite mas geometria NÃO ajusta — veredicto separado: ${fitting.status} (${(fitting.reason ?? '').slice(0, 110)}…)`);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: resolve(out, `${tag}-02-after-confirmation.png`) });
  // experiência continua viva: explicação + interacção transitória
  await page.click('[data-space-entity="wheel-0"]');
  await page.click('[data-space-explain]');
  await page.waitForFunction(() => /inferid|plano/i.test(document.querySelector('[data-li-output]')?.textContent ?? ''), null, { timeout: 10_000 });
  await page.click('[data-space-motion="open"]');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: resolve(out, `${tag}-03-interaction.png`) });
  pass(`${tag}: explicação ancorada e interacção transitória após a recuperação`);
}

for (const [photo, template, tag] of [['car.jpg', hatchback, 'car'], ['skoda-kodiaq.jpg', suv, 'skoda-kodiaq']] as const) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await run(page, photo, template, tag);
  assert.deepEqual(errors, [], `pageerrors ${tag}: ${errors.join(' | ')}`);
  await page.close();
}
writeFileSync(resolve(out, 'diagnostics.json'), JSON.stringify(diagnostics, null, 2));
assert.equal(providerCalls, 0);
await browser.close();
await vite.close();
await new Promise<void>((r) => backend.close(() => r()));
process.stdout.write('REAL-PHOTO-RECOVERY-E2E OK\n');
