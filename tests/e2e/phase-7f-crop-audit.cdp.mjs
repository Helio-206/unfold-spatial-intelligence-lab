import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourcePath = path.join(root, 'reports/phase-7e4/evidence/architecture-source.png');
const outputDir = path.join(root, 'reports/phase-7f/evidence/crop-audit');
const source = await readFile(sourcePath);
const sourceSha256 = createHash('sha256').update(source).digest('hex');
const cases = [];
for (const item of [
  { id: 'office-area', file: 'office-region-C-response.json', expectedSha: 'b6d44a9628bf7a9a12adf7a86a9b7c97d63af9e577924c855b158e5bb715d503' },
  { id: 'upper-right-dimension', file: 'upper-right-dimension-region-C-response.json', expectedSha: 'b8b644c22ded836282ae72418c22ff6f6d8935d4d140be46b755bf9365be0454' },
]) {
  const result = JSON.parse(await readFile(path.join(root, 'reports/phase-7e5/live', item.file), 'utf8'));
  cases.push({ id: item.id, region: result.selectedRegion, responseFile: `reports/phase-7e5/live/${item.file}`, expectedCropSha: item.expectedSha });
}

const html = `<!doctype html><meta charset="utf-8"><title>7E.5 crop geometry audit</title>
<style>html,body{margin:0;background:#f4f3ef;color:#151515;font:16px system-ui}main{padding:24px;display:grid;grid-template-columns:650px 1fr;gap:18px;align-items:start}.source{position:relative;width:650px;height:446px}.source img{display:block;width:650px;height:446px}.region{position:absolute;border:3px solid #ef4a37;background:#ef4a3722;box-sizing:border-box}.details{grid-column:1/-1;display:flex;gap:28px;align-items:start}.crop{image-rendering:pixelated;max-width:none;border:1px solid #666}.meta{white-space:pre-wrap;font:14px ui-monospace,monospace}h1{font-size:20px;margin:0 0 8px}p{margin:0 0 14px}.tag{font-weight:700;color:#a82a1c}</style>
<main><section><h1 id="title"></h1><p id="source-meta"></p><div class="source"><img id="original" /><div id="region" class="region"></div></div></section><section class="details"><div><h1>Recorte exacto reconstituído</h1><p id="crop-meta"></p><img id="crop" class="crop" /></div><pre class="meta" id="meta"></pre></section></main>
<script>
const cases=${JSON.stringify(cases)};
const sourceUrl='data:image/png;base64,${source.toString('base64')}';
const image=document.querySelector('#original');image.src=sourceUrl;
window.ready=new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject});
window.renderAudit=async(index)=>{await window.ready;const item=cases[index],r=item.region;
const px={x:Math.floor(r.x*image.naturalWidth),y:Math.floor(r.y*image.naturalHeight),width:Math.min(image.naturalWidth-Math.floor(r.x*image.naturalWidth),Math.max(1,Math.ceil(r.width*image.naturalWidth))),height:Math.min(image.naturalHeight-Math.floor(r.y*image.naturalHeight),Math.max(1,Math.ceil(r.height*image.naturalHeight)))};
const canvas=document.createElement('canvas');canvas.width=px.width;canvas.height=px.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,px.x,px.y,px.width,px.height,0,0,px.width,px.height);const url=canvas.toDataURL('image/png');
const bytes=Uint8Array.from(atob(url.split(',')[1]),c=>c.charCodeAt(0));const digest=await crypto.subtle.digest('SHA-256',bytes);const sha=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
const box=document.querySelector('#region');box.style.left=(r.x*100)+'%';box.style.top=(r.y*100)+'%';box.style.width=(r.width*100)+'%';box.style.height=(r.height*100)+'%';
document.querySelector('#title').textContent=item.id;document.querySelector('#source-meta').textContent='Original PNG · '+image.naturalWidth+'×'+image.naturalHeight+' · sem rotação · recorte à escala nativa';
const crop=document.querySelector('#crop');crop.src=url;crop.style.width=(px.width*4)+'px';crop.style.height=(px.height*4)+'px';
document.querySelector('#crop-meta').textContent='Recorte enviado: '+px.width+'×'+px.height+' px; ampliação de visualização 4× nearest-neighbour (não enviada).';
window.auditResult={id:item.id,sourceSize:{width:image.naturalWidth,height:image.naturalHeight},region:r,pixelBounds:px,cropSize:{width:canvas.width,height:canvas.height},cropSha256:sha,expectedCropSha256:item.expectedCropSha};
document.querySelector('#meta').textContent=JSON.stringify(window.auditResult,null,2);return window.auditResult};
</script>`;

const server = createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  response.end(html);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const profileDir = await mkdtemp(path.join(os.tmpdir(), 'unfold-7f-crop-audit-'));
const chrome = spawn(process.env.CHROME_BIN ?? '/usr/bin/google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profileDir}`, '--window-size=1400,900', `http://127.0.0.1:${address.port}/`], { stdio: 'ignore' });
await mkdir(outputDir, { recursive: true });
let socket;
const pending = new Map();
let nextId = 0;
try {
  let debugPort;
  const started = Date.now();
  while (!debugPort && Date.now() - started < 10000) {
    try { debugPort = Number((await readFile(path.join(profileDir, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); } catch { await new Promise((resolve) => setTimeout(resolve, 50)); }
  }
  assert.ok(debugPort, 'Chrome CDP started');
  const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then((r) => r.json());
  socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const task = pending.get(message.id); pending.delete(message.id);
    if (message.error) task.reject(new Error(message.error.message)); else task.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const target = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((r) => r.json());
  const page = target.find((item) => item.type === 'page'); assert.ok(page);
  const sessionId = (await send('Target.attachToTarget', { targetId: page.id, flatten: true })).sessionId;
  const pageSend = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params, sessionId })); });
  const evaluate = async (expression) => { const out = await pageSend('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description ?? out.exceptionDetails.text ?? JSON.stringify(out.exceptionDetails)); return out.result?.value; };
  await pageSend('Page.enable'); await pageSend('Runtime.enable');
  const readyAt = Date.now();
  while (Date.now() - readyAt < 10000 && !(await evaluate('typeof window.renderAudit === "function"'))) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(await evaluate('typeof window.renderAudit'), 'function', `audit page loaded at ${await evaluate('location.href')}`);
  for (let index = 0; index < cases.length; index += 1) {
    const result = await evaluate(`window.renderAudit(${index})`);
    assert.equal(result.sourceSize.width, 650); assert.equal(result.sourceSize.height, 446);
    assert.deepEqual(result.cropSize, { width: result.pixelBounds.width, height: result.pixelBounds.height });
    assert.equal(result.cropSha256, result.expectedCropSha256, `reconstructed crop hash matches real request for ${result.id}`);
    const shot = await pageSend('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    await writeFile(path.join(outputDir, `${result.id}-region-and-exact-crop.png`), Buffer.from(shot.data, 'base64'));
    await writeFile(path.join(outputDir, `${result.id}-audit.json`), `${JSON.stringify({ ...result, sourceImage: { path: 'reports/phase-7e4/evidence/architecture-source.png', sha256: sourceSha256 }, orientation: 'unrotated PNG; naturalWidth/naturalHeight; no EXIF transform applied', transform: 'x/y=floor(normalized*naturalSize), width/height=ceil(normalizedExtent*naturalSize), canvas drawImage at native dimensions, PNG data URL', browserPreviewScale: '4x nearest-neighbour display only; crop bytes are native resolution' }, null, 2)}\n`);
  }
  console.log(JSON.stringify({ status: 'PASS_CROP_GEOMETRY_AUDIT', sourceSha256, sourceSize: '650x446', cases: cases.map(({ id }) => id), callsToMeta: 0, screenshots: cases.map((item) => `${item.id}-region-and-exact-crop.png`) }));
} finally {
  try { socket?.close(); } catch {}
  chrome.kill('SIGTERM');
  server.close();
}
