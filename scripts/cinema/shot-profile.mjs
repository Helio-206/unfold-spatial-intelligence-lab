// node scripts/cinema/shot-profile.mjs <out.png> <profile> [shot=hero] [t=3] [w=1600] [h=900] [motion=reference]
import { chromium } from 'playwright-core';
const [out, profile, shot = 'hero', t = '3', w = '1600', h = '900', motion = 'reference'] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: +w, height: +h } })).newPage(); p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto(`${process.env.BASE ?? 'http://127.0.0.1:5200'}/cinema?debug-cinema&ui=0&dpr=1&tier=studio&visuals=foundry&motion=${motion}&profile=${profile}`);
await p.waitForFunction(() => window.__unfoldCinema?.ready, null, { timeout: 120000 });
await p.evaluate(([s, tt]) => { window.__unfoldCinema.seekShot(s, +tt); }, [shot, t]);
const url = await p.evaluate(() => { window.__unfoldCinema.renderNow(); return window.__unfoldCinema.canvas().toDataURL('image/png'); });
(await import('node:fs')).writeFileSync(out, Buffer.from(url.split(',')[1], 'base64')); console.log(JSON.stringify(await p.evaluate(() => { const s = window.__unfoldCinema.stats(); return { profile: s.profile, premium: s.premiumMaterials, lights: s.lights }; })));
await b.close();
