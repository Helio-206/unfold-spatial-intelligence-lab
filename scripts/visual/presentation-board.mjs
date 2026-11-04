// Contact sheets from the captured evidence: (1) Foundry premium | PR #25 | new for the pendulum clock plus the two other objects, (2) the cinematic sequence.
//   node scripts/visual/presentation-board.mjs reports/presentation-director
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const dir = resolve(process.argv[2] ?? 'reports/presentation-director');
const result = JSON.parse(await readFile(resolve(dir, 'capture-result.json'), 'utf8'));
const img = async (name) => `data:image/png;base64,${(await readFile(resolve(dir, name))).toString('base64')}`;
const cell = async (title, name, w = 640) => `<figure style="margin:0;width:${w}px"><figcaption style="font:600 13px system-ui;margin:0 0 4px">${title}</figcaption><img src="${await img(name)}" style="width:${w}px;display:block;border:1px solid #2a2f35"></figure>`;
const page = (body, width) => `<body style="margin:0;background:#0d0f12;color:#e8e7e2;font:13px/1.4 system-ui;width:${width}px;padding:20px">${body}</body>`;
const labels = { 'clock-like': 'Pendulum clock: hand-authored reproduction of the real Meta run of PR #25 (primitive-only plan, not Meta output)', bicycle: 'Bicycle: hand-authored fixture (not Meta output); no code written for it', 'jet-engine': 'Aircraft engine: hand-authored fixture (not Meta output); no code written for it' };

let a = '';
a += `<h3 style="margin:0 0 8px">1 · Same workspace, same plan: Foundry premium reference | PR #25 | new presentation layer</h3>`;
a += `<div style="display:flex;gap:12px;margin-bottom:22px">${await cell('Foundry premium (excavator, the reference)', result.foundryExcavator)}${await cell('PR #25 (same plan)', result.objects['clock-like'].pr25)}${await cell('New (after the cinematic entrance)', result.objects['clock-like'].final)}</div>`;
for (const key of ['bicycle', 'jet-engine']) a += `<h3 style="margin:0 0 8px">${labels[key]}</h3><div style="display:flex;gap:12px;margin-bottom:22px">${await cell('PR #25', result.objects[key].pr25, 640)}${await cell('New', result.objects[key].final, 640)}</div>`;

const e = result.objects['clock-like'];
let b = `<h3 style="margin:0 0 8px">2 · Cinematic sequence in the workspace (${labels['clock-like']})</h3><div style="display:flex;gap:10px;margin-bottom:14px">`;
for (const [i, f] of e.filmstrip.entries()) b += await cell(`Entrance · ${i + 1}/${e.filmstrip.length}`, f, 340);
b += `</div><div style="display:flex;gap:10px">${await cell('Exploded view (announced as a visualisation)', e.exploded, 340)}${await cell('Focus: the rest is dimmed', e.focus, 340)}${await cell('Point-of-interest tour', e.tour, 340)}${await cell('Final', e.final, 340)}</div>`;

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox'] });
for (const [name, html, width] of [['board-comparison.png', a, 1980], ['board-sequence.png', b, 1420]]) {
  const p = await browser.newPage({ viewport: { width, height: 800 } }); await p.setContent(page(html, width - 40)); await p.screenshot({ path: resolve(dir, name), fullPage: true }); await p.close();
}
await browser.close(); console.log('boards written');
