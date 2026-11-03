// Quick still from the real cinema page: node scripts/cinema/shot.mjs <out.png> [shot=hero] [t=0] [tier=studio] [w=1600] [h=900] [dpr=1]
import { chromium } from 'playwright-core';
const [out, shot = 'hero', t = '0', tier = 'studio', w = '1600', h = '900', dpr = '1'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr })).newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message)); page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/GPU stall|swiftshader|GL Driver/i.test(m.text())) console.log(m.type(), m.text().slice(0, 300)); });
await page.goto(`${process.env.BASE ?? 'http://127.0.0.1:5199'}/cinema?debug-cinema&ui=0&tier=${tier}&dpr=${dpr}`);
await page.waitForFunction(() => window.__unfoldCinema?.ready, null, { timeout: 60000 });
await page.evaluate(([s, tt]) => { window.__unfoldCinema.seekShot(s, +tt); window.__unfoldCinema.renderNow(); }, [shot, t]);
await page.waitForTimeout(800);
await page.evaluate(() => window.__unfoldCinema.renderNow());
await page.screenshot({ path: out });
console.log(JSON.stringify(await page.evaluate(() => { const s = window.__unfoldCinema.stats(); return { tier: s.tier, calls: s.calls, tris: s.triangles, geo: s.geometries, tex: s.textures, lights: s.lights, contact: s.contactRenders, pr: s.pixelRatio }; })));
await browser.close();
