/**
 * Comparações de câmara fixa por fotografia: entrada | máscara extraída | máscara anotada
 * manualmente | métricas e veredicto. Também escreve mask-metrics.json (IoU, erro de bbox).
 * Run: npx tsx tests/e2e/gen-mask-comparisons.pw.ts
 */
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

process.env.UNFOLD_API_TARGET = 'http://127.0.0.1:9';
const out = resolve('reports/product-integration/real-photo-evidence/comparisons');
mkdirSync(out, { recursive: true });
const vite = await createServer({ server: { host: '127.0.0.1', port: 5369, strictPort: true }, logLevel: 'error' });
await vite.listen();
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 460 } });
await page.goto('http://127.0.0.1:5369/living?debug-living=1', { waitUntil: 'domcontentloaded' });
const annotations = JSON.parse(readFileSync(resolve('tests/fixtures/photos-real/annotations.json'), 'utf8')) as { cases: Array<{ id: string; file: string; polygon: Array<[number, number]>; heldOut?: boolean }> };
const metrics: Record<string, unknown> = {};
for (const c of annotations.cases) {
  const dataUrl = `data:image/jpeg;base64,${readFileSync(resolve('tests/fixtures/photos-real', c.file)).toString('base64')}`;
  const r = await page.evaluate(async ({ url, polygon }) => {
    // @ts-ignore — módulos carregados pelo Vite dentro da página
    const { evidenceFromDataUrl } = await import('/src/living/universal-foundry/browser.ts');
    // @ts-ignore — idem
    const ev2 = await import('/src/living/universal-foundry/evidence.ts');
    // @ts-ignore — idem
    const fit = await import('/src/living/universal-foundry/fitting.ts');
    const ev = await evidenceFromDataUrl(url);
    if (!ev) return null;
    const truth = ev2.polygonMask(polygon as Array<[number, number]>, ev.width, ev.height);
    const truthBox = ev2.maskBbox(truth, ev.width, ev.height);
    const reliability = fit.assessSilhouetteReliability(ev);
    // desenha os três painéis (sem funções nomeadas: o evaluate serializado não as tolera)
    const panels: Record<string, string> = {};
    const variants: Array<[string, Uint8Array | null]> = [['input', null], ['extracted', ev.mask], ['annotated', truth]];
    for (const [name, mask] of variants) {
      const canvas = document.createElement('canvas'); canvas.width = ev.width * 3; canvas.height = ev.height * 3;
      const ctx = canvas.getContext('2d')!;
      const img = new Image();
      img.src = url;
      await img.decode();
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      if (mask) {
        const overlay = ctx.getImageData(0, 0, canvas.width, canvas.height);
        for (let y = 0; y < ev.height; y++) for (let x = 0; x < ev.width; x++) if (mask[y * ev.width + x]) {
          for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) {
            const i = ((y * 3 + dy) * canvas.width + (x * 3 + dx)) * 4;
            overlay.data[i] = 30; overlay.data[i + 1] = 200; overlay.data[i + 2] = 60; overlay.data[i + 3] = 150;
          }
        }
        ctx.putImageData(overlay, 0, 0);
      }
      panels[name] = canvas.toDataURL('image/png');
    }
    return {
      metrics: {
        iou: +ev2.silhouetteIoU(ev.mask, truth).toFixed(3),
        bboxErrorPx: ev2.bboxErrorPx(ev.bbox, truthBox),
        extractedBbox: ev.bbox, annotatedBbox: truthBox,
        reliability,
      },
      input: panels.input!, extracted: panels.extracted!, annotated: panels.annotated!,
    };
  }, { url: dataUrl, polygon: c.polygon });
  if (!r) continue;
  metrics[c.id] = { ...r.metrics, heldOut: !!c.heldOut };
  process.stdout.write(`${c.id} ${JSON.stringify(r.metrics)}\n`);
  await page.setContent(`<body style="margin:0;background:#111;color:#eee;font-family:system-ui">
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;padding:6px">
      <figure><img style="width:100%" src="${r.input}"><figcaption>INPUT ${c.file}${c.heldOut ? ' (held-out)' : ''}</figcaption></figure>
      <figure><img style="width:100%" src="${r.extracted}"><figcaption>MÁSCARA EXTRAÍDA — IoU ${(r.metrics as { iou: number }).iou} vs anotação</figcaption></figure>
      <figure><img style="width:100%" src="${r.annotated}"><figcaption>ANOTAÇÃO MANUAL (1 anotador, não revista)</figcaption></figure>
    </div>
    <p style="padding:0 10px">Veredicto: ${JSON.stringify((r.metrics as { reliability: { reliable: boolean; reasons: string[] } }).reliability)}</p></body>`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(out, `${c.id}-comparison.png`) });
}
writeFileSync(resolve(out, '..', 'mask-metrics.json'), JSON.stringify(metrics, null, 2));
await browser.close();
await vite.close();
process.stdout.write('MASK-COMPARISONS OK\n');
