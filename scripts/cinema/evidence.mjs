// Evidence for the cinematic stage, from the REAL /cinema page (Chrome + SwiftShader, no GPU).
//   node scripts/cinema/evidence.mjs <outDir> [baseUrl]
// Writes: golden-frame-1080p.png, golden-frame-4k.png, sheets/{shots,ablation,tiers}.png, ui-desktop.png, ui-mobile.png, evidence.json
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const OUT = resolve(process.argv[2] ?? 'reports/cinema'); const BASE = process.argv[3] ?? 'http://127.0.0.1:5199';
mkdirSync(join(OUT, 'sheets'), { recursive: true }); mkdirSync(join(OUT, 'raw'), { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const evidence = { at: new Date().toISOString(), renderer: null, frames: {}, notes: [] };
const C = (page, fn, arg) => page.evaluate(`(${fn})(window.__unfoldCinema, ${JSON.stringify(arg ?? null)})`);
async function open(query, viewport, dpr = 1) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: dpr }); const page = await ctx.newPage(); page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errors.push(m.text()); });
  await page.goto(`${BASE}/cinema?debug-cinema&dpr=${dpr}&${query}`); await page.waitForFunction(() => window.__unfoldCinema?.ready, null, { timeout: 120000 });
  return { ctx, page };
}
const grab = async (page) => Buffer.from((await C(page, (c) => { c.renderNow(); return c.canvas().toDataURL('image/png'); })).split(',')[1], 'base64');
const save = (name, buf) => { writeFileSync(join(OUT, name), buf); return `${name}`; };

// ---- Golden Frame, 1920x1080 --------------------------------------------------------------------------------------
{
  const { ctx, page } = await open('tier=studio&ui=0', { width: 1920, height: 1080 });
  evidence.renderer = await C(page, (c) => c.stats().caps.renderer);
  await C(page, (c) => c.seekShot('hero', 3.2)); const png = await grab(page); save('golden-frame-1080p.png', png);
  evidence.frames.golden1080 = { size: [1920, 1080], sha: createHash('sha256').update(png).digest('hex').slice(0, 16), camera: await C(page, (c) => c.camera()), stats: await C(page, (c) => { const s = c.stats(); return { tier: s.tier, calls: s.calls, triangles: s.triangles, geometries: s.geometries, textures: s.textures, lights: s.lights, pixelRatio: s.pixelRatio, size: s.size }; }) };
  // ---- shot sheet at 1280x720 each (same page, camera seek only)
  for (const id of ['hero', 'profile', 'bucket', 'reach', 'top', 'orbit']) { await C(page, (c, a) => c.seekShot(a, 4), id); save(`raw/shot-${id}.png`, await grab(page)); }
  // ---- ablation: same frame, one part of the pipeline off at a time
  await C(page, (c) => c.seekShot('hero', 3.2));
  const steps = [['full', {}], ['no-environment', { environment: false }], ['no-contact-shadow', { contact: false }], ['no-postprocessing', { post: false }], ['no-mirror-floor', { mirror: false }], ['no-key-shadow', { shadows: false }]];
  for (const [name, flags] of steps) { await C(page, (c) => c.ablate({ environment: true, contact: true, post: true, mirror: true, shadows: true })); await C(page, (c, f) => c.ablate(f), flags); save(`raw/ablate-${name}.png`, await grab(page)); }
  await C(page, (c) => c.ablate({ environment: false, contact: false, post: false, mirror: false, shadows: false })); save('raw/ablate-plain.png', await grab(page));
  await C(page, (c) => c.ablate({ environment: true, contact: true, post: true, mirror: true, shadows: true }));
  // ---- tiers, same frame
  for (const tier of ['studio', 'balanced', 'light']) { await C(page, (c, t) => { c.setTier(t); c.seekShot('hero', 3.2); }, tier); save(`raw/tier-${tier}.png`, await grab(page)); evidence.frames[`tier_${tier}`] = await C(page, (c) => c.benchmark(10)); }
  // ---- UI with chrome, desktop
  await C(page, (c) => c.setTier('light')); await page.evaluate(() => { document.querySelector('#cinema-root').classList.remove('is-presenting', 'is-idle'); }); await C(page, (c) => { c.setTier('studio'); c.seekShot('hero', 3.2); });
  await page.waitForTimeout(600); await C(page, (c) => c.renderNow()); await page.waitForTimeout(400); await page.screenshot({ path: join(OUT, 'ui-desktop.png') });
  evidence.errors = page.errors; await ctx.close();
}
// ---- UI mobile -----------------------------------------------------------------------------------------------------
{
  const { ctx, page } = await open('tier=balanced', { width: 390, height: 844 }, 2);
  await page.evaluate(() => document.querySelector('#cinema-root').classList.remove('is-presenting', 'is-idle')); await C(page, (c) => c.seekShot('hero', 3.2)); await page.waitForTimeout(500); await C(page, (c) => c.renderNow()); await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, 'ui-mobile.png') }); await ctx.close();
}
// ---- Golden Frame in 4K: a 1920x1080 viewport at device pixel ratio 2 -> a 3840x2160 drawing buffer ------------------
{
  const { ctx, page } = await open('tier=studio&ui=0', { width: 1920, height: 1080 }, 2);
  await C(page, (c) => c.seekShot('hero', 3.2)); const png = await grab(page); save('golden-frame-4k.png', png);
  const size = [png.readUInt32BE(16), png.readUInt32BE(20)];
  evidence.frames.golden4k = { size, sha: createHash('sha256').update(png).digest('hex').slice(0, 16), bytes: png.length, stats: await C(page, (c) => { const s = c.stats(); return { tier: s.tier, pixelRatio: s.pixelRatio, size: s.size, maxTexture: s.caps.maxTextureSize }; }), note: 'native 3840x2160 drawing buffer (no upscaling); software rasteriser' };
  evidence.errors4k = page.errors; await ctx.close();
}
// ---- sheets ---------------------------------------------------------------------------------------------------------
const b64 = (f) => `data:image/png;base64,${readFileSync(join(OUT, f)).toString('base64')}`;
async function sheet(name, cells, cols, cellW) {
  const page = await browser.newPage({ viewport: { width: cols * (cellW + 12) + 12, height: 800 } });
  const html = `<body style="margin:0;background:#fff;font:600 20px system-ui;display:grid;grid-template-columns:repeat(${cols},${cellW}px);gap:12px;padding:12px">${cells.map(([t, f]) => `<figure style="margin:0"><figcaption style="padding:4px 0">${t}</figcaption><img src="${b64(f)}" width="${cellW}" style="display:block"></figure>`).join('')}</body>`;
  await page.setContent(html); await page.waitForTimeout(300); await page.screenshot({ path: join(OUT, 'sheets', `${name}.png`), fullPage: true }); await page.close();
}
await sheet('shots', ['hero', 'profile', 'bucket', 'reach', 'top', 'orbit'].map((id) => [`${id}`, `raw/shot-${id}.png`]), 3, 640);
await sheet('ablation', [['full pipeline', 'raw/ablate-full.png'], ['no studio environment (no reflections)', 'raw/ablate-no-environment.png'], ['no contact shadow', 'raw/ablate-no-contact-shadow.png'], ['no post-processing', 'raw/ablate-no-postprocessing.png'], ['no mirrored floor', 'raw/ablate-no-mirror-floor.png'], ['plain: all of the above off', 'raw/ablate-plain.png']], 3, 640);
await sheet('tiers', [['studio', 'raw/tier-studio.png'], ['balanced', 'raw/tier-balanced.png'], ['light', 'raw/tier-light.png']], 3, 640);
writeFileSync(join(OUT, 'evidence.json'), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ errors: evidence.errors, errors4k: evidence.errors4k, golden4k: evidence.frames.golden4k.size }));
await browser.close();
