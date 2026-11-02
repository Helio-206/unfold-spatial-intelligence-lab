// Composes before | technical | presentation sheets from the raw editor screenshots of editor-evidence.mjs.
//   node scripts/rendering/editor-sheets.mjs <evidenceDir> <outDir>
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const [dir, outArg] = process.argv.slice(2); const RAW = join(resolve(dir), 'raw'); const OUT = resolve(outArg); mkdirSync(OUT, { recursive: true });
const names = new Set(readdirSync(RAW).filter((f) => f.startsWith('after__technical__')).map((f) => f.replace('after__technical__', '').replace('.png', '')));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 3180, height: 900 } });
const img = (f) => `data:image/png;base64,${readFileSync(f).toString('base64')}`;
for (const name of names) {
  const cells = [['before (main)', join(RAW, `before__before__${name}.png`)], ['technical (this branch)', join(RAW, `after__technical__${name}.png`)], ['presentation (this branch)', join(RAW, `after__presentation__${name}.png`)]];
  const html = `<body style="margin:0;background:#fff;font:600 22px system-ui;display:flex;gap:10px;padding:10px">${cells.map(([t, f]) => `<figure style="margin:0;width:1040px"><figcaption style="padding:6px 0">${t}</figcaption>${existsSync(f) ? `<img src="${img(f)}" width="1040">` : `<div style="height:788px;border:1px dashed #999;display:grid;place-items:center;font-weight:400;color:#555;text-align:center;padding:20px">not available on main:<br>no camera control for this view</div>`}</figure>`).join('')}</body>`;
  await page.setContent(html); await page.waitForTimeout(150);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
}
await browser.close(); console.log([...names].sort().join('\n'));
