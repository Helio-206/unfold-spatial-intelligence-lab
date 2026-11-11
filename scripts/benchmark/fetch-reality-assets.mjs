// Downloads the licensed ground-truth assets of the Reality Engine benchmark (Khronos glTF-Sample-Assets) and verifies sha256 against the manifest.
//   node scripts/benchmark/fetch-reality-assets.mjs            -> fetch missing, verify all
//   node scripts/benchmark/fetch-reality-assets.mjs --record   -> (re)write sha256 into the manifest from the downloaded files
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve('reports/reality-engine/benchmark');
const manifestPath = resolve(root, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const record = process.argv.includes('--record');
let failed = 0;
for (const a of manifest.assets) {
  const dir = resolve(root, 'assets', a.id), file = resolve(dir, `${a.id}.glb`);
  await mkdir(dir, { recursive: true });
  if (!existsSync(file)) {
    const res = await fetch(a.url);
    if (!res.ok) { console.error(`FETCH_FAILED ${a.id} ${res.status}`); failed++; continue; }
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
  }
  const sha = createHash('sha256').update(await readFile(file)).digest('hex');
  if (record) a.sha256 = sha;
  else if (a.sha256 !== sha) { console.error(`SHA_MISMATCH ${a.id}`); failed++; }
  else console.log(`ok ${a.id}`);
}
if (record) await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
process.exit(failed ? 1 : 0);
