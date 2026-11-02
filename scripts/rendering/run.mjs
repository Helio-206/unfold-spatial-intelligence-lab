// Renders every fixture / view / variant with identical scene, camera, viewport and lights, measures cost, and writes images + JSON.
// usage: node scripts/rendering/run.mjs [outDir=reports/rendering]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'vite';
const { chromium } = await (async () => { try { return await import('playwright'); } catch { return createRequire(import.meta.url)(`${execSync('npm root -g').toString().trim()}/playwright`); } })();

const out = process.argv[2] ?? 'reports/rendering';
fs.mkdirSync(`${out}/images`, { recursive: true });
const save = (name, dataUrl) => fs.writeFileSync(`${out}/images/${name}.png`, Buffer.from(dataUrl.split(',')[1], 'base64'));

const server = await createServer({ server: { port: 5191, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
const result = { environment: {}, shots: [], bench: [], hires: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:5191/scripts/rendering/harness.html');
  await page.waitForFunction(() => typeof window.prepare === 'function');
  result.environment = await page.evaluate(() => window.prepare());
  const variants = ['before', 'technical', 'presentation'];
  const plan = [
    ['two-rooms', ['isometric', 'top', 'cutaway', 'door-detail', 'window-detail', 'material-detail', 'corner-detail', 'interior']],
    ['multi-room', ['isometric', 'top', 'cutaway', 'interior']],
    ['provisional', ['isometric', 'top', 'material-detail']],
  ];
  const only = process.env.ONLY; // ONLY=hires renders just the high-resolution stills
  if (only !== 'hires') for (const [fixture, views] of plan) for (const view of views) for (const variant of [...variants, ...(view === 'isometric' && fixture === 'multi-room' ? ['presentation-on-editor-rig'] : [])]) {
    const r = await page.evaluate(([f, v, view]) => window.shot(f, v, view), [fixture, variant, view]);
    save(`${fixture}__${view}__${variant}`, r.png); result.shots.push({ fixture, view, variant, stats: r.stats });
  }
  if (only !== 'hires') for (const fixture of ['two-rooms', 'multi-room']) for (const variant of [...variants, 'presentation-on-editor-rig']) result.bench.push(await page.evaluate(([f, v]) => window.bench(f, v, 60), [fixture, variant]));
  for (const [width, height] of [[2560, 1440], [3840, 2160]]) {
    const h = await page.evaluate(([a, b]) => window.hires(a, b), [width, height]);
    save(`hires__multi-room__${width}x${height}`, h.png); result.hires.push({ report: h.report, canvas: h.canvas, pngBytes: h.bytes });
  }
  result.errors = errors;
  fs.writeFileSync(`${out}/benchmark.json`, JSON.stringify(result, null, 1));
  console.log(JSON.stringify({ shots: result.shots.length, bench: result.bench.length, hires: result.hires.map((h) => [h.report.actual, h.report.ms, h.report.tiles]), errors }));
} finally { await browser.close(); await server.close(); }
