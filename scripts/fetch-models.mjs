// Fetches optional ML weights (not committed) into public/models and records their sha256.
// U2-Net-P (Apache-2.0, https://github.com/danielgatis/rembg releases). Without it the pipeline
// falls back to static-background / colour strategies and says so.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
const dir = new URL('../public/models/', import.meta.url);
mkdirSync(dir, { recursive: true });
const models = [{ name: 'u2netp.onnx', url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx' }];
for (const m of models) {
  const target = new URL(m.name, dir);
  if (existsSync(target)) { console.log(`${m.name}: already present`); continue; }
  const res = await fetch(m.url);
  if (!res.ok) { console.error(`${m.name}: HTTP ${res.status} (pipeline will declare the model unavailable)`); continue; }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(target, buf);
  console.log(`${m.name}: ${buf.length} bytes sha256=${createHash('sha256').update(buf).digest('hex')}`);
}
