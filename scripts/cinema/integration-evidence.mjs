// Evidence of the integrated path: Visual Foundry excavator + frames computed by the engineering engine, in the real /cinema page.
//   node scripts/cinema/integration-evidence.mjs <outDir> [baseUrl]
// Chrome + SwiftShader (software). Nothing here is a GPU measurement.
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const OUT = resolve(process.argv[2] ?? 'reports/cinema/integration'); const BASE = process.argv[3] ?? 'http://127.0.0.1:5199';
mkdirSync(join(OUT, 'frames'), { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const C = (page, fn, arg) => page.evaluate(`(${fn})(window.__unfoldCinema, ${JSON.stringify(arg ?? null)})`);
const grab = async (page) => Buffer.from((await C(page, (c) => { c.renderNow(); return c.canvas().toDataURL('image/png'); })).split(',')[1], 'base64');
const evidence = { at: new Date().toISOString(), renderer: null, note: 'software rasteriser; not GPU timings', frames: [], errors: [] };
async function open(viewport, query) {
  const ctx = await browser.newContext({ viewport }); const page = await ctx.newPage(); page.on('pageerror', (e) => evidence.errors.push(e.message));
  await page.goto(`${BASE}/cinema?debug-cinema&ui=0&dpr=1&visuals=foundry&${query}`); await page.waitForFunction(() => window.__unfoldCinema?.ready, null, { timeout: 120000 });
  return { ctx, page };
}
// 1080p hero, studio tier, engine frame at t = 0 (the reference configuration) and at the end of the scenario
{
  const { ctx, page } = await open({ width: 1920, height: 1080 }, 'tier=studio&motion=engine');
  evidence.renderer = await C(page, (c) => c.stats().caps.renderer); const geo = await C(page, (c) => c.geometryStats()); evidence.geometry = { source: geo.source, meshes: geo.meshes, triangles: geo.triangles, parts: geo.parts.length };
  for (const [name, frac] of [['hero-engine-t0', 0], ['hero-engine-end', 1]]) {
    await C(page, (c, f) => { c.runtime.seekPose(c.runtime.source.durationS * f); c.seekShot('hero', 3.2); }, frac);
    const png = await grab(page); writeFileSync(join(OUT, `${name}-1080p.png`), png);
    const e = await C(page, (c) => { const s = c.sampleNow(); return { t: s.timestampS, digest: s.inputDigest, origin: s.origin, worstPoseErrorM: Math.max(...s.parts.map((p) => Math.hypot(...c.partWorld(p.partId).p.map((v, i) => v - p.translationM[i])))) }; });
    evidence.frames.push({ name: `${name}-1080p.png`, size: [1920, 1080], sha: createHash('sha256').update(png).digest('hex').slice(0, 16), ...e });
  }
  evidence.benchmarkStudio1080 = await C(page, (c) => c.benchmark(3));
  await ctx.close();
}
// sequence frames (the exported 15-frame scenario), 1280x720 for the sheet
{
  const { ctx, page } = await open({ width: 1280, height: 720 }, 'tier=balanced&motion=sequence');
  const dur = await C(page, (c) => c.sourceInfo().duration);
  // exact instants of the exported frames (the file is read here, not typed): at these the stage shows the engine frame as produced
  const exported = JSON.parse(readFileSync('src/living/engineering/fixtures/excavator.scenario.motion-sequence.json', 'utf8')).frames.map((f) => f.frame).filter((f) => f.status === 'ok');
  const instants = [...new Set(exported.map((f) => f.timestampS))];
  const shots = instants.map((t, i) => [`seq-${i}`, t]);
  for (const [name, t] of shots) {
    await C(page, (c, tt) => { c.runtime.seekPose(tt); c.seekShot('hero', 3.2); }, t); const png = await grab(page); writeFileSync(join(OUT, 'frames', `${name}.png`), png);
    const e = await C(page, (c) => { const s = c.sampleNow(); return { t: s.timestampS, interpolated: s.interpolated, digest: s.inputDigest, origin: s.origin, status: s.status, worstPoseErrorM: Math.max(...s.parts.map((p) => Math.hypot(...c.partWorld(p.partId).p.map((v, i) => v - p.translationM[i])))) }; });
    evidence.frames.push({ name: `frames/${name}.png`, size: [1280, 720], sha: createHash('sha256').update(png).digest('hex').slice(0, 16), ...e });
  }
  for (const key of ['blocked-curso', 'blocked-colisao']) {
    await C(page, (c, k) => { c.setMotion(k); c.seekShot('hero', 3.2); }, key); const png = await grab(page); writeFileSync(join(OUT, 'frames', `${key}.png`), png);
    const e = await C(page, (c) => { const s = c.sampleNow(); return { status: s.status, poseBasis: s.poseBasis, blocked: s.blocked, digest: s.inputDigest, origin: s.origin, caption: c.caption(), worstPoseErrorM: Math.max(...s.parts.map((p) => Math.hypot(...c.partWorld(p.partId).p.map((v, i) => v - p.translationM[i])))) }; });
    evidence.frames.push({ name: `frames/${key}.png`, size: [1280, 720], sha: createHash('sha256').update(png).digest('hex').slice(0, 16), ...e });
  }
  await ctx.close();
}
// sheet
const b64 = (f) => `data:image/png;base64,${readFileSync(join(OUT, f)).toString('base64')}`;
const cells = evidence.frames.filter((f) => f.name.startsWith('frames/')).map((f) => [`${f.name.replace('frames/', '').replace('.png', '')} · t=${(f.t ?? 0).toFixed?.(3) ?? '—'} s${f.interpolated ? ' · blend' : ''}${f.status === 'blocked' ? ' · blocked' : ''}`, f.name]);
const page = await browser.newPage({ viewport: { width: 4 * 652 + 12, height: 800 } });
await page.setContent(`<body style="margin:0;background:#fff;font:600 18px system-ui;display:grid;grid-template-columns:repeat(4,640px);gap:12px;padding:12px">${cells.map(([t, f]) => `<figure style="margin:0"><figcaption style="padding:4px 0">${t}</figcaption><img src="${b64(f)}" width="640" style="display:block"></figure>`).join('')}</body>`);
await page.waitForTimeout(400); await page.screenshot({ path: join(OUT, 'engine-sequence-sheet.png'), fullPage: true }); await page.close();
writeFileSync(join(OUT, 'evidence.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify({ errors: evidence.errors, frames: evidence.frames.length }));
await browser.close();
