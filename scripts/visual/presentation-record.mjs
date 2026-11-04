// Real screen recording of the cinematic sequence in the real SpatialWorkspace: entrance -> exploded view and back -> focus -> point-of-interest tour ->
// editing handover. Frames come from the browser's own screencast (CDP Page.screencastFrame, with real timestamps) and are encoded with the ffmpeg that ships
// with Playwright (VP8). No editing, no speed change: the pace is whatever software rendering (SwiftShader) managed, so it is slower than on a GPU.
//   node scripts/visual/presentation-record.mjs --mine http://127.0.0.1:5193 --fixture clock-like --out reports/presentation-director
import { execFile } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const args = {}; for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const out = resolve(args.out ?? 'reports/presentation-director'), tmp = resolve(out, '.frames-tmp'), fixture = args.fixture ?? 'clock-like';
const FFMPEG = process.env.FFMPEG ?? '/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux';
await rm(tmp, { recursive: true, force: true }); await mkdir(tmp, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1024, height: 640 }, deviceScaleFactor: 1 });
const page = await context.newPage(); const errors = []; page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(e.message));
const idle = () => page.waitForFunction(() => !window.__present.director.update(0), null, { timeout: 60_000 });
const frames = [], log = []; const cdp = await context.newCDPSession(page);
cdp.on('Page.screencastFrame', async (f) => { frames.push({ t: f.metadata.timestamp, data: f.data }); try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch { /* page closing */ } });
let result = null;
try {
  await page.goto(`${args.mine}/tests/harness/presentation/index.html?fixture=${fixture}`, { waitUntil: 'networkidle' }); await page.evaluate(() => window.__present.ready); await page.waitForTimeout(1200);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 78, everyNthFrame: 1 });
  const t0 = Date.now(), mark = (what) => log.push({ atMs: Date.now() - t0, what });
  mark('start'); await page.click('[data-act="entrance"]'); await page.waitForFunction(() => window.__present.director.state.phase === 'exploring', null, { timeout: 90_000 }); mark('entrance done'); await page.waitForTimeout(900);
  await page.click('[data-act="explode"]'); await page.waitForFunction(() => window.__present.director.state.exploded === 1, null, { timeout: 30_000 }); await idle(); mark('exploded view (announced as a visualisation)'); await page.waitForTimeout(1100);
  await page.click('[data-act="explode"]'); await page.waitForFunction(() => window.__present.director.state.exploded === 0, null, { timeout: 30_000 }); await idle(); mark('assembled again'); await page.waitForTimeout(700);
  await page.click('[data-act="focus"]'); await idle(); mark('focus on one component'); await page.waitForTimeout(1000); await page.click('[data-act="focus"]'); await idle(); await page.waitForTimeout(500);
  await page.click('[data-act="tour"]'); mark('points-of-interest tour'); await page.waitForTimeout(2200);
  for (let i = 0; i < 3; i++) { await page.evaluate(() => window.__present.director.nextPoi()); await page.waitForTimeout(2200); }
  await page.evaluate(() => window.__present.director.stopTour()); await idle(); mark('tour stopped'); await page.waitForTimeout(900);
  await page.click('[data-act="edit"]'); mark('editing: the Director steps aside'); await page.waitForTimeout(900);
  mark('end');
  await cdp.send('Page.stopScreencast'); await page.waitForTimeout(300);
} finally {
  await browser.close();
  if (frames.length > 1) {
    // Playwright's bundled ffmpeg is minimal (no concat demuxer, no filters): resample to a constant 10 fps ourselves and pipe JPEGs in.
    const fps = 10, t0 = frames[0].t, tEnd = frames.at(-1).t, count = Math.ceil((tEnd - t0) * fps) + 1; const buffers = []; let cursor = 0;
    for (let i = 0; i < count; i++) { const t = t0 + i / fps; while (cursor + 1 < frames.length && frames[cursor + 1].t <= t) cursor++; buffers.push(Buffer.from(frames[cursor].data, 'base64')); }
    const target = resolve(out, `demo-${fixture}.webm`);
    await new Promise((done, fail) => {
      const child = execFile(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', 'pipe:0', '-c:v', 'libvpx', '-b:v', '900k', '-an', target], (error) => (error ? fail(error) : done()));
      child.stdin.on('error', () => undefined); for (const b of buffers) child.stdin.write(b); child.stdin.end();
    });
    result = { video: `demo-${fixture}.webm`, frames: frames.length, outputFrames: count, seconds: +(tEnd - t0).toFixed(1) };
  }
  await rm(tmp, { recursive: true, force: true });
  console.log(JSON.stringify({ ...result, errors, log }, null, 1));
}
