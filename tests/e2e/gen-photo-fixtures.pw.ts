/**
 * Gera os fixtures raster usados nos testes de fitting/upload (desenhos nossos, direitos limpos).
 * NÃO são fotografias de câmara: são imagens raster desenhadas por código, rotuladas como tal.
 * Run: npx tsx tests/e2e/gen-photo-fixtures.pw.ts
 */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const out = resolve('tests/fixtures/photos');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const page = await browser.newPage();

async function render(name: string, draw: string): Promise<void> {
  const dataUrl = await page.evaluate(`(() => {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 400;
    const ctx = canvas.getContext('2d'); ${draw}
    return canvas.toDataURL('image/png');
  })()`) as string;
  const bytes = Buffer.from(dataUrl.split(',')[1]!, 'base64');
  writeFileSync(resolve(out, name), bytes);
  console.log(name, bytes.length, createHash('sha256').update(bytes).digest('hex'));
}

await render('door-photo.png', `
  ctx.fillStyle = '#cfc8bd'; ctx.fillRect(0,0,640,400);
  ctx.fillStyle = '#ddd6cb'; ctx.fillRect(0,340,640,60);
  ctx.fillStyle = '#7c4f2a'; ctx.fillRect(238,38,164,330);
  ctx.fillStyle = '#96683c'; ctx.fillRect(250,50,140,306);
  ctx.fillStyle = '#7c4f2a'; ctx.fillRect(262,66,116,120); ctx.fillRect(262,206,116,134);
  ctx.fillStyle = '#c9ccd1'; ctx.beginPath(); ctx.arc(368,205,7,0,7); ctx.fill();
`);
await render('car-long-photo.png', `
  ctx.fillStyle = '#e8e8e8'; ctx.fillRect(0,0,640,400);
  ctx.fillStyle = '#b3302a';
  ctx.beginPath(); ctx.moveTo(60,300); ctx.lineTo(90,255); ctx.lineTo(200,245); ctx.lineTo(260,205); ctx.lineTo(420,200); ctx.lineTo(500,240); ctx.lineTo(580,255); ctx.lineTo(585,300); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#202226';
  for (const x of [150, 490]) { ctx.beginPath(); ctx.arc(x,300,34,0,7); ctx.fill(); }
  ctx.fillStyle = '#9aa0a6';
  for (const x of [150, 490]) { ctx.beginPath(); ctx.arc(x,300,17,0,7); ctx.fill(); }
`);
await render('car-tall-photo.png', `
  ctx.fillStyle = '#e8e8e8'; ctx.fillRect(0,0,640,400);
  ctx.fillStyle = '#2e5d3a';
  ctx.beginPath(); ctx.moveTo(130,310); ctx.lineTo(140,220); ctx.lineTo(200,130); ctx.lineTo(440,125); ctx.lineTo(505,215); ctx.lineTo(510,310); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#202226';
  for (const x of [205, 440]) { ctx.beginPath(); ctx.arc(x,310,40,0,7); ctx.fill(); }
  ctx.fillStyle = '#9aa0a6';
  for (const x of [205, 440]) { ctx.beginPath(); ctx.arc(x,310,20,0,7); ctx.fill(); }
`);
await browser.close();
console.log('PHOTO-FIXTURES OK');
