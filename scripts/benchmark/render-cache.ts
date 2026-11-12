// Renders every benchmark asset once (perspective, transparent background, exact alpha) and caches the RGBA frames on disk so segmentation / component / reconstruction
// experiments can be repeated without a browser. Cache is gitignored (regenerable from the licensed assets). Run: npx tsx scripts/benchmark/render-cache.ts
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const PORT = Number(process.env.RC_PORT ?? 5397), ELEV = 20, FILL = 0.55, W = 480, H = 360;
const sets: Record<string, number[]> = { turn8: Array.from({ length: 8 }, (_, i) => i * 45), held4: [22.5, 112.5, 202.5, 292.5], turn16: Array.from({ length: 16 }, (_, i) => i * 22.5) };
const manifest = JSON.parse(readFileSync(resolve('reports/reality-engine/benchmark/manifest.json'), 'utf8')) as { assets: Array<{ id: string }> };
const dir = resolve('scripts/benchmark/cache'); mkdirSync(dir, { recursive: true });
const vite = await createServer({ server: { host: '127.0.0.1', port: PORT, strictPort: true, hmr: false, watch: null }, logLevel: 'error' }); await vite.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 500, height: 400 } });
await page.goto(`http://127.0.0.1:${PORT}/scripts/benchmark/reality-render.html`);
await page.waitForFunction(() => (window as never as { __renderReady?: boolean }).__renderReady === true, null, { timeout: 60_000 });
for (const a of manifest.assets) for (const [name, az] of Object.entries(sets)) {
  const file = resolve(dir, `${a.id}.${name}.rgba.gz`); if (existsSync(file)) continue;
  const r = await page.evaluate(([url, azs, elev, fill]) => (window as never as { __renderRaw: (u: string, a: number[], o: object) => Promise<{ width: number; height: number; rgba: string[] }> }).__renderRaw(url as string, azs as number[], { width: 480, height: 360, elevationDeg: elev as number, fill: fill as number, background: 'transparent' }), [`/reports/reality-engine/benchmark/assets/${a.id}/${a.id}.glb`, az, ELEV, FILL] as const);
  writeFileSync(file, gzipSync(Buffer.concat(r.rgba.map((b) => Buffer.from(b, 'base64'))))); console.log(a.id, name, r.rgba.length);
}
await browser.close(); await vite.close();
