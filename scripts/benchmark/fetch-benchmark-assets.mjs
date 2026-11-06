// Downloads the benchmark GLBs listed in reports/fidelity-v4/benchmark/assets.json into <dir> and verifies their sha256. Refuses anything that does not match.
//   node scripts/benchmark/fetch-benchmark-assets.mjs <dir>
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const dir = resolve(process.argv[2] ?? '.benchmark-assets'), manifest = JSON.parse(await readFile('reports/fidelity-v4/benchmark/assets.json', 'utf8')); await mkdir(dir, { recursive: true });
for (const a of manifest.assets) {
  const res = await fetch(a.url); if (!res.ok) throw new Error(`${a.name}: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer()), sha = createHash('sha256').update(bytes).digest('hex');
  if (sha !== a.sha256 || bytes.byteLength !== a.bytes) throw new Error(`${a.name}: hash or size differs from the manifest (${sha}, ${bytes.byteLength}); refusing to use it`);
  await writeFile(resolve(dir, `${a.name}.glb`), bytes); console.log(`${a.name}: ok ${bytes.byteLength} bytes sha256 ${sha.slice(0, 12)}…`);
}
