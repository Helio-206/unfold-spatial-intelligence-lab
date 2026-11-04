// Peak memory of a real GLB while it is DECODED, in a real Chromium: not only what is left after the textures were reduced.
//   node scripts/benchmark/fidelity-glb-memory.mjs --host http://127.0.0.1:5195 --glb <AntiqueCamera.glb> --out reports/fidelity-v3 [--runs 3]
// Method: a fresh browser per measurement; the OS resident set (VmRSS) of the renderer, GPU and browser processes is sampled every 4 ms from /proc while the
// page decodes. Images are decoded outside the JS heap, so the JS heap is reported only to show that it does NOT see them.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const args = {}; for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const glb = await readFile(resolve(args.glb)), runs = Number(args.runs ?? 3), side = Number(args.side ?? 1024);
const rss = async (pid) => { try { const t = await readFile(`/proc/${pid}/status`, 'utf8'); return Number(/VmRSS:\s+(\d+)/.exec(t)?.[1] ?? 0) / 1024; } catch { return 0; } };
const median = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];

async function once(mode) {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await page.route('**/__assets/AntiqueCamera.glb', (route) => route.fulfill({ status: 200, contentType: 'model/gltf-binary', body: glb }));
    await page.goto(`${args.host}/tests/harness/fidelity/index.html`, { waitUntil: 'networkidle' }); await page.evaluate(() => window.__fid.ready);
    const cdp = await browser.newBrowserCDPSession(), pageCdp = await page.context().newCDPSession(page); await pageCdp.send('Performance.enable');
    const { processInfo } = await cdp.send('SystemInfo.getProcessInfo'), pids = processInfo.filter((p) => ['renderer', 'browser', 'gpu'].includes(p.type)).map((p) => ({ type: p.type, id: p.id }));
    const total = async () => { let sum = 0, renderer = 0; for (const p of pids) { const m = await rss(p.id); sum += m; if (p.type === 'renderer') renderer = Math.max(renderer, m); } return { sum, renderer }; };
    const heap = async () => (await pageCdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'JSHeapUsedSize').value / 1048576;
    await new Promise((r) => setTimeout(r, 1500)); const base = await total(), heap0 = await heap();
    let peak = base, peakHeap = heap0, running = true; const sampler = (async () => { while (running) { const t = await total(); peak = { sum: Math.max(peak.sum, t.sum), renderer: Math.max(peak.renderer, t.renderer) }; peakHeap = Math.max(peakHeap, await heap()); await new Promise((r) => setTimeout(r, 4)); } })();
    const result = await page.evaluate(([m, s]) => window.__fid.decodeGlb(m, s), [mode, side]);
    running = false; await sampler; await new Promise((r) => setTimeout(r, 1200)); const after = await total();
    return { mode, baselineMB: +base.sum.toFixed(0), peakMB: +peak.sum.toFixed(0), afterMB: +after.sum.toFixed(0), peakAboveBaselineMB: +(peak.sum - base.sum).toFixed(0), rendererPeakAboveBaselineMB: +(peak.renderer - base.renderer).toFixed(0), jsHeapPeakAboveBaselineMB: +(peakHeap - heap0).toFixed(0), decodeMs: result.ms, textureSizes: result.textureSizes ?? null, refused: result.refused ?? null };
  } finally { await browser.close(); }
}

const table = {};
for (const mode of ['validate', 'full', 'post', 'pre', 'seq']) {
  const all = []; for (let i = 0; i < runs; i++) all.push(await once(mode));
  table[mode] = { runs: all, median: { peakAboveBaselineMB: median(all.map((r) => r.peakAboveBaselineMB)), rendererPeakAboveBaselineMB: median(all.map((r) => r.rendererPeakAboveBaselineMB)), afterMinusBaselineMB: median(all.map((r) => r.afterMB - r.baselineMB)), jsHeapPeakAboveBaselineMB: median(all.map((r) => r.jsHeapPeakAboveBaselineMB)), decodeMs: median(all.map((r) => r.decodeMs)) }, textureSizes: all[0].textureSizes };
  console.log(mode.padEnd(9), JSON.stringify(table[mode].median), table[mode].textureSizes ?? '');
}
await writeFile(resolve(args.out ?? 'reports/fidelity-v3', 'glb-memory.json'), `${JSON.stringify({ file: 'KhronosGroup/glTF-Sample-Assets AntiqueCamera.glb (CC0), 17.5 MB, 6 textures of 2048x2048', method: 'fresh Chromium per run; VmRSS of renderer+gpu+browser sampled every 4 ms; median of runs', side, modes: { validate: 'header checks only (no decode)', full: 'decode at native size, no reduction', post: 'decode at native size, then redraw at the reduced size (previous behaviour)', pre: 'all images at once, each asked of the browser already at the reduced size (resizeWidth/Height)', seq: 'one image at a time, asked at the reduced size' }, table }, null, 2)}\n`);
