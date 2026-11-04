// Builds the before/after contact sheet from the captured pairs (same input, same 1440x1000 viewport, same stage box).
//   node scripts/visual/board.mjs reports/visual-recovery
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const dir = resolve(process.argv[2] ?? 'reports/visual-recovery');
const rows = [
  ['harp', 'Blind harp plan (saved Meta output, PR #23)', 'before-harp', 'after-harp'],
  ['excavator', 'Excavator photo plan (saved Meta output, PR #23)', 'before-excavator', 'after-excavator'],
  ['jet-engine', 'Aircraft engine (hand-authored fixture, not Meta output)', 'before-jet-engine', 'after-jet-engine'],
  ['bicycle', 'Bicycle (hand-authored fixture, not Meta output)', 'before-bicycle', 'after-bicycle'],
];
const read = async (label) => { const stats = JSON.parse(await readFile(resolve(dir, `${label.startsWith('before') ? 'before' : 'after'}`, `${label}.json`), 'utf8')); const png = (await readFile(resolve(dir, label.startsWith('before') ? 'before' : 'after', `${label}.png`))).toString('base64'); return { stats, png }; };
let html = '<body style="margin:0;background:#0d0f12;color:#e8e7e2;font:13px/1.4 system-ui;width:2060px;padding:20px">';
for (const [, title, before, after] of rows) {
  const [b, a] = await Promise.all([read(before), read(after)]);
  const cell = (side, item) => `<div style="width:1010px"><div style="margin:0 0 4px">${side} · object height ${(item.stats.stage.objectHeightOfStage * 100).toFixed(1)}% of the stage · canvas ${item.stats.canvas.join('×')}</div><div style="width:1010px;height:680px;background:#101416;position:relative;overflow:hidden"><img src="data:image/png;base64,${item.png}" style="display:block;width:${item.stats.canvas[0]}px;height:${item.stats.canvas[1]}px"></div></div>`;
  html += `<h3 style="margin:18px 0 6px">${title}</h3><div style="display:flex;gap:20px">${cell('BEFORE (ea4c5229)', b)}${cell('AFTER', a)}</div>`;
}
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 2100, height: 800 } });
await page.setContent(`${html}</body>`); await page.screenshot({ path: resolve(dir, 'before-after.png'), fullPage: true }); await browser.close();
console.log('wrote before-after.png');
