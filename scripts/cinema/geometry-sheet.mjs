// Composes the before/after sheet of scripts/cinema/geometry-evidence.mjs. node scripts/cinema/geometry-sheet.mjs <dir>
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const dir = resolve(process.argv[2] ?? 'reports/cinema/geometry'); const views = ['hero', 'cab-close', 'hood', 'hero-articulated'];
const b64 = (f) => `data:image/png;base64,${readFileSync(join(dir, f)).toString('base64')}`;
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true }); const p = await b.newPage({ viewport: { width: 1636, height: 600 } });
await p.setContent(`<body style="margin:0;background:#fff;font:600 18px system-ui;padding:12px">${views.map((v) => `<div style="display:grid;grid-template-columns:800px 800px;gap:12px;margin-bottom:12px"><figure style="margin:0"><figcaption style="padding:4px 0">${v} · before (premium look, original geometry)</figcaption><img src="${b64(`${v}-before.png`)}" width="800" style="display:block"></figure><figure style="margin:0"><figcaption style="padding:4px 0">${v} · after (cab + hood refinement)</figcaption><img src="${b64(`${v}-after.png`)}" width="800" style="display:block"></figure></div>`).join('')}</body>`);
await p.waitForTimeout(500); await p.screenshot({ path: join(dir, 'before-after-sheet.png'), fullPage: true }); await b.close();
