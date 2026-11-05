/**
 * Fotografias reais de câmara em /living: upload → plano semântico offline rotulado como
 * fixture (casado por sha256 do pedido; NÃO é inferência Muse Spark) → fitting por
 * silhueta projectada (Worker) → com as máscaras actuais, RECUSA FECHADA documentada
 * (IoU 0.20–0.27 vs anotação manual) e geometria conceptual mantida → photoreal →
 * explicação ancorada → interacção transitória suportada. O backend local real serve adopt/sessão; a rota do
 * plano é interceptada com o fixture e o duplo do provider conta chamadas (0 pagas).
 * Run: npx tsx tests/e2e/real-photo-fitting.pw.ts
 */
import { chromium, type Page } from 'playwright-core';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createMetaServer } from '../../server/meta-server';
import { hatchback, suv, sedan } from '../../src/living/universal-foundry/fixtures/plans';
import type { SpatialPlanV2 } from '../../src/universal-spatial/contracts-v2';

const out = resolve(process.env.UNFOLD_RPF_OUT ?? 'reports/product-integration/real-photo-evidence');
mkdirSync(out, { recursive: true });
let providerCalls = 0;
const backend = createMetaServer({ apiKey: 'fixture-key-not-real', fetchImpl: (async () => { providerCalls++; throw new Error('paid provider must not be called in this e2e'); }) as unknown as typeof fetch });
await new Promise<void>((r) => backend.listen(0, '127.0.0.1', r));
const backendPort = (backend.address() as { port: number }).port;
process.env.UNFOLD_API_TARGET = `http://127.0.0.1:${backendPort}`;
const port = Number(process.env.UNFOLD_RPF_PORT ?? 5173); // porta aceite pela allowlist de Host/Origin do backend real
const vite = await createServer({ server: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'error' });
await vite.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const envelope = JSON.parse(readFileSync(resolve('reports/visual-recovery/fixtures/bicycle.json'), 'utf8')) as Record<string, unknown>;
const FLAGS = 'debug-living=1&experimental-foundry=1&experimental-living-intelligence=1&experimental-photoreal=1&rm=1';
const pass = (m: string) => process.stdout.write(`PASS ${m}\n`);
const diagnostics: Record<string, unknown> = {};

async function runPhoto(page: Page, photo: string, template: () => SpatialPlanV2, tag: string): Promise<void> {
  const photoPath = resolve('tests/fixtures/photos-real', photo);
  await page.route('**/api/spatial/v2/plan', async (route) => {
    const body = route.request().postDataJSON() as { imageDataUrl?: string };
    const sha = createHash('sha256').update(body.imageDataUrl ?? photo).digest('hex');
    const plan: SpatialPlanV2 = { ...template(), source: { kind: 'image', sha256: sha }, title: `${template().title} (modelo semântico fixture)`, unknowns: [...template().unknowns, 'semantic plan supplied as a labelled offline fixture matched by source sha256; not Muse Spark inference', 'dimensions inferred; not measured from the photograph'] };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...envelope, plan, meta: { model: 'labelled-fixture (not Muse Spark)', requestId: `rpf-${tag}` }, limitations: ['Plano semântico fixture rotulado; backend real apenas para adopt/sessão.'] }) });
  });
  await page.goto(`http://127.0.0.1:${port}/living?${FLAGS}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="living-intelligence"]', { timeout: 30_000 });
  await page.click('[data-space="open"]');
  await page.setInputFiles('#sp-file', photoPath);
  await page.click('[data-sp="submit"]');
  await page.waitForSelector('.sp-root[data-phase="review"]', { timeout: 60_000 });
  await page.click('[data-sp="keep-all"]');
  await page.check('#sp-ack');
  await page.click('[data-sp="build"]');
  await page.waitForFunction(() => (window as never as { __workspace: { spaceActive: boolean } }).__workspace.spaceActive, null, { timeout: 60_000 });
  // adopt real no backend local: a sessão fica sincronizada (sem isto, as edições ficariam bloqueadas)
  await page.waitForFunction(() => (window as never as { __space: { layer: { synced: boolean } | null } }).__space.layer?.synced === true, null, { timeout: 60_000 });
  pass(`${tag}: adopt aceite pelo backend local real (sessão sincronizada)`);
  await page.waitForSelector('[data-li-space]', { timeout: 30_000 });
  // fitting assíncrono (Worker): o palco responde já; o resultado terminal chega por onFitted.
  // Com as máscaras reais actuais (IoU 0.20–0.27 vs anotação manual), o resultado CORRECTO é
  // a recusa fechada — nunca um ajuste enganador.
  await page.waitForFunction(() => {
    const f = (window as never as { __foundry3d: { fitting: { status: string } | null } }).__foundry3d.fitting;
    return f !== null && f.status !== 'pending';
  }, null, { timeout: 90_000 });
  const diag = await page.evaluate(async (dataUrl) => {
    // @ts-ignore — módulo carregado pelo Vite dentro da página, não resolvível pelo tsc do Node
    const { evidenceFromDataUrl } = await import('/src/living/universal-foundry/browser.ts');
    const ev = await evidenceFromDataUrl(dataUrl);
    const foundry = (window as never as { __foundry3d: { fitting: unknown; fittingTransport: string | null; recipe: { params: Record<string, unknown>; paramSpec: Array<{ key: string; default: unknown }> } | null } }).__foundry3d;
    const defaults = Object.fromEntries((foundry.recipe?.paramSpec ?? []).map((s) => [s.key, s.default]));
    return {
      evidence: ev ? { aspect: +ev.aspect.toFixed(2), symmetry: +ev.symmetry.toFixed(2), foregroundRatio: +ev.foregroundRatio.toFixed(3), bbox: ev.bbox, largestComponentShare: +(ev.largestComponentShare ?? 0).toFixed(3) } : null,
      fitting: foundry.fitting,
      fittingTransport: foundry.fittingTransport,
      params: { cabinHeight: foundry.recipe?.params.cabinHeight, rearSlope: foundry.recipe?.params.rearSlope },
      defaults: { cabinHeight: defaults.cabinHeight, rearSlope: defaults.rearSlope },
      photorealActive: ((window as never as { __photoreal?: { active(): boolean } }).__photoreal?.active() ?? false),
    };
  }, `data:image/jpeg;base64,${readFileSync(photoPath).toString('base64')}`);
  diagnostics[tag] = diag;
  process.stdout.write(`DIAG ${tag} ${JSON.stringify(diag)}\n`);
  assert.equal(diag.evidence !== null, true);
  const fitting = diag.fitting as { status: string; reason?: string };
  assert.equal(fitting.status, 'insufficient_evidence', `recusa fechada esperada: ${fitting.reason ?? ''}`);
  assert.match(fitting.reason ?? '', /não fiável|Graus de liberdade|frontal|Máscara/);
  assert.deepEqual(diag.params, diag.defaults, 'sem fitting aplicado: parâmetros ficam nos defaults (nada de geometria enganadora)');
  assert.equal(diag.photorealActive, true);
  pass(`${tag}: fitting recusado fechado (${(fitting.reason ?? '').slice(0, 90)}…) via ${diag.fittingTransport}; geometria conceptual mantida, photoreal activo`);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: resolve(out, `${tag}-01-fitted-scene.png`) });
  // explicação ancorada + interacção transitória suportada (roda: rotação inferida declarada)
  const wheel = page.locator('[data-space-entity="wheel-0"]');
  await wheel.click();
  await page.click('[data-space-explain]');
  await page.waitForFunction(() => /roda|wheel|inferid/i.test(document.querySelector('[data-li-output]')?.textContent ?? ''), null, { timeout: 10_000 });
  const quatOf = () => page.evaluate(() => {
    const layer = (window as never as { __space: { layer: { root: { traverse(fn: (o: never) => void): void } } } }).__space.layer;
    let found: number[] | null = null;
    layer.root.traverse((o: never) => {
      const obj = o as { userData?: Record<string, unknown>; quaternion?: { toArray(): number[] } };
      if (obj.userData?.spatialComponentRoot && obj.userData?.spatialEntityId === 'wheel-0') found = obj.quaternion!.toArray();
    });
    return found;
  });
  const before = await quatOf();
  await page.click('[data-space-motion="open"]');
  // espera pela condição (o loop RAF aplica a pose), nunca por um tempo fixo sob carga
  await page.waitForFunction((previous) => {
    const layer = (window as never as { __space: { layer: { root: { traverse(fn: (o: never) => void): void } } } }).__space.layer;
    let moved = false;
    layer.root.traverse((o: never) => {
      const obj = o as { userData?: Record<string, unknown>; quaternion?: { toArray(): number[] } };
      if (obj.userData?.spatialComponentRoot && obj.userData?.spatialEntityId === 'wheel-0') {
        const now = obj.quaternion!.toArray();
        moved = now.some((v, i) => Math.abs(v - (previous as unknown as number[])[i]!) > 0.01);
      }
    });
    return moved;
  }, before, { timeout: 20_000 });
  const after = await quatOf();
  assert.ok(before && after);
  const { Quaternion } = await import('three');
  const angle = new Quaternion(...(before as [number, number, number, number])).angleTo(new Quaternion(...(after as [number, number, number, number])));
  assert.ok(angle > 0.05, `roda devia rodar transitoriamente (ângulo=${angle})`);
  pass(`${tag}: explicação ancorada e interacção transitória na roda real do Space (ângulo ${angle.toFixed(2)})`);
  await page.screenshot({ path: resolve(out, `${tag}-02-explained-interaction.png`) });
  await page.evaluate(() => { const p = document.querySelector<HTMLElement>('[data-testid="living-intelligence"]'); if (p) p.style.display = 'none'; });
  await page.waitForTimeout(600);
  await page.screenshot({ path: resolve(out, `${tag}-03-fitted-3d-clean.png`) });
}

for (const [photo, template, tag] of [['car.jpg', hatchback, 'car'], ['bus.jpg', suv, 'bus'], ['porsche-911.jpg', sedan, 'porsche']] as const) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await runPhoto(page, photo, template, tag);
  assert.deepEqual(errors, [], `pageerrors ${tag}: ${errors.join(' | ')}`);
  await page.close();
}
writeFileSync(resolve(out, 'diagnostics.json'), JSON.stringify(diagnostics, null, 2));
assert.equal(providerCalls, 0, 'nenhuma chamada paga');
pass('provider pago nunca chamado; adopt/sessão servidos pelo backend local real');
await browser.close();
await vite.close();
await new Promise<void>((r) => backend.close(() => r()));
process.stdout.write('REAL-PHOTO-FITTING-E2E OK\n');
