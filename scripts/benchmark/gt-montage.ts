// Silhouette montage of a GLB's parts (front, side, top) as ASCII PGM files, to design and check a hand-built plan against: npx tsx scripts/benchmark/gt-montage.ts <glb> <outPrefix>
import { readFile, writeFile } from 'node:fs/promises';
import { Box3, Vector3 } from 'three';
import { readGlbParts } from '../../src/universal-spatial/reconstruction/glb-geometry';
import { makeView, rasterise } from '../../src/universal-spatial/reconstruction/silhouette';
const [file, prefix] = process.argv.slice(2) as [string, string];
const parts = readGlbParts(new Uint8Array(await readFile(file))), all = parts.flatMap((p) => p.tris), box = new Box3(); for (const t of all) for (const v of t) box.expandByPoint(v);
const centre = box.getCenter(new Vector3()), half = Math.max(...box.getSize(new Vector3()).toArray()) / 2 * 1.05, res = 256;
for (const [name, dir] of [['front', new Vector3(0, 0, 1)], ['side', new Vector3(1, 0, 0)], ['top', new Vector3(0, 1, 0)]] as const) {
  const view = makeView(dir, centre, half, res), layers = parts.map((p) => rasterise(p.tris, view)), img = new Uint8Array(res * res);
  layers.forEach((m, i) => { for (let k = 0; k < m.length; k++) if (m[k]) img[k] = 80 + 60 * i; });
  let text = `P2\n${res} ${res}\n255\n`; for (let y = res - 1; y >= 0; y--) text += Array.from(img.subarray(y * res, (y + 1) * res)).join(' ') + '\n';
  await writeFile(`${prefix}-${name}.pgm`, text);
}
console.log('centre', centre.toArray().map((n) => +n.toFixed(2)), 'half', +half.toFixed(2));
