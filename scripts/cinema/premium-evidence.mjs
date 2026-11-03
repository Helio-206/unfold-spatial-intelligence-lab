// Before / after of the premium look on the SAME camera: for every view the presentation camera is read, the interactive profile is
// rendered from exactly that pose, then the presentation profile. Real /cinema page, studio tier, Chrome + SwiftShader (software; not GPU timings).
//   node scripts/cinema/premium-evidence.mjs <outDir> [baseUrl]
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const OUT = resolve(process.argv[2] ?? 'reports/cinema/premium'); const BASE = process.argv[3] ?? 'http://127.0.0.1:5200';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const C = (page, fn, arg) => page.evaluate(`(${fn})(window.__unfoldCinema, ${JSON.stringify(arg ?? null)})`);
const grab = async (page) => Buffer.from((await C(page, (c) => { c.renderNow(); return c.canvas().toDataURL('image/png'); })).split(',')[1], 'base64');
const evidence = { at: new Date().toISOString(), renderer: null, note: 'software rasteriser; no GPU timings', views: [], errors: [] };
const views = [['hero', 'hero', 3, 'reference'], ['hero-articulated', 'hero', 3, 'engine-end'], ['profile-articulated', 'profile', 3, 'engine-end'], ['bucket-close', 'bucket', 4, 'reference']];
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } }); const page = await ctx.newPage(); page.on('pageerror', (e) => evidence.errors.push(e.message));
await page.goto(`${BASE}/cinema?debug-cinema&ui=0&dpr=1&tier=studio&visuals=foundry&motion=reference&profile=presentation`); await page.waitForFunction(() => window.__unfoldCinema?.ready, null, { timeout: 120000 });
evidence.renderer = await C(page, (c) => c.stats().caps.renderer);
for (const [name, shot, t, pose] of views) {
  await C(page, (c, p) => { c.setProfile('presentation'); c.setMotion(p === 'engine-end' ? 'engine' : 'reference'); if (p === 'engine-end') c.runtime.seekPose(c.runtime.source.durationS); }, pose);
  await C(page, (c, a) => c.seekShot(a.shot, a.t), { shot, t }); const cam = await C(page, (c) => c.camera());
  const after = await grab(page); const stA = await C(page, (c) => { const s = c.stats(); return { profile: s.profile, premiumMaterials: s.premiumMaterials, lights: s.lights, calls: s.calls }; });
  const poseErr = await C(page, (c) => { const s = c.sampleNow(); return Math.max(...s.parts.map((p) => Math.hypot(...c.partWorld(p.partId).p.map((v, i) => v - p.translationM[i])))); });
  await C(page, (c) => c.setProfile('interactive')); await C(page, (c, k) => c.placeCamera(k.position, k.target, k.fov), cam); const before = await grab(page);
  const stB = await C(page, (c) => { const s = c.stats(); return { profile: s.profile, premiumMaterials: s.premiumMaterials, lights: s.lights, calls: s.calls }; });
  writeFileSync(join(OUT, `${name}-before.png`), before); writeFileSync(join(OUT, `${name}-after.png`), after);
  evidence.views.push({ name, shot, pose, camera: cam, poseErrorM: poseErr, before: { ...stB, sha: createHash('sha256').update(before).digest('hex').slice(0, 16) }, after: { ...stA, sha: createHash('sha256').update(after).digest('hex').slice(0, 16) } });
  await C(page, (c) => c.setProfile('presentation'));
}
await ctx.close();
const b64 = (f) => `data:image/png;base64,${readFileSync(join(OUT, f)).toString('base64')}`;
const sheet = await browser.newPage({ viewport: { width: 2 * 800 + 36, height: 600 } });
await sheet.setContent(`<body style="margin:0;background:#fff;font:600 18px system-ui;padding:12px">${views.map(([n]) => `<div style="display:grid;grid-template-columns:800px 800px;gap:12px;margin-bottom:12px"><figure style="margin:0"><figcaption style="padding:4px 0">${n} · before (interactive, current)</figcaption><img src="${b64(`${n}-before.png`)}" width="800" style="display:block"></figure><figure style="margin:0"><figcaption style="padding:4px 0">${n} · after (presentation, premium look)</figcaption><img src="${b64(`${n}-after.png`)}" width="800" style="display:block"></figure></div>`).join('')}</body>`);
await sheet.waitForTimeout(500); await sheet.screenshot({ path: join(OUT, 'before-after-sheet.png'), fullPage: true }); await sheet.close();
writeFileSync(join(OUT, 'evidence.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify({ errors: evidence.errors, views: evidence.views.length }));
await browser.close();
