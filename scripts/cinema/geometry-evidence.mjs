// Same fixed cameras, before and after the cab/hood geometry refinement. Presentation profile, studio tier, Chrome + SwiftShader (software).
//   node scripts/cinema/geometry-evidence.mjs <before|after> <outDir> [baseUrl]
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const [label, outArg, base = 'http://127.0.0.1:5200'] = process.argv.slice(2); const OUT = resolve(outArg); mkdirSync(OUT, { recursive: true });
const rad = (d) => (d * Math.PI) / 180;
const cam = (target, az, el, d, fov) => ({ target, fov, position: [target[0] + d * Math.cos(rad(el)) * Math.cos(rad(az)), target[1] + d * Math.sin(rad(el)), target[2] + d * Math.cos(rad(el)) * Math.sin(rad(az))] });
const VIEWS = [
  ['hero', cam([3.2, 2.0, 0], -38, 8, 17, 27), 'reference'],
  ['cab-close', cam([0.5, 2.15, -0.8], -50, 10, 5.5, 34), 'reference'],
  ['hood', cam([-0.9, 1.5, -0.6], -125, 12, 6, 34), 'reference'],
  ['hero-articulated', cam([4.5, 2.2, -1.2], -62, 8, 22, 30), 'engine-end'],
];
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
const C = (fn, arg) => page.evaluate(`(${fn})(window.__unfoldCinema, ${JSON.stringify(arg ?? null)})`);
await page.goto(`${base}/cinema?debug-cinema&ui=0&dpr=1&tier=studio&visuals=foundry&motion=reference&profile=presentation`); await page.waitForFunction(() => window.__unfoldCinema?.ready, null, { timeout: 120000 });
const ev = { label, at: new Date().toISOString(), note: 'software rasteriser; no GPU timings', model: await C((c) => { const g = c.geometryStats(); return { meshes: g.meshes, triangles: g.triangles, parts: g.parts.length }; }), views: [] };
for (const [name, v, motion] of VIEWS) {
  await C((c, m) => { c.setMotion(m === 'engine-end' ? 'engine' : 'reference'); if (m === 'engine-end') c.runtime.seekPose(c.runtime.source.durationS); }, motion);
  await C((c, k) => c.placeCamera(k.position, k.target, k.fov), v);
  const url = await C((c) => { c.renderNow(); return c.canvas().toDataURL('image/png'); }); const png = Buffer.from(url.split(',')[1], 'base64'); writeFileSync(join(OUT, `${name}-${label}.png`), png);
  const st = await C((c) => { const s = c.stats(); return { calls: s.calls, triangles: s.triangles, geometries: s.geometries, textures: s.textures }; });
  const err = await C((c) => { const s = c.sampleNow(); return Math.max(...s.parts.map((p) => Math.hypot(...c.partWorld(p.partId).p.map((x, i) => x - p.translationM[i])))); });
  ev.views.push({ name, camera: v, sha: createHash('sha256').update(png).digest('hex').slice(0, 16), renderStats: st, poseErrorM: err });
}
ev.errors = errors; writeFileSync(join(OUT, `evidence-${label}.json`), JSON.stringify(ev, null, 2)); console.log(JSON.stringify({ label, model: ev.model, errors }));
await b.close();
