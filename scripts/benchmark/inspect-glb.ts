// Lists the mesh nodes of GLB files (geometry only): npx tsx scripts/benchmark/inspect-glb.ts a.glb b.glb
import { readFile } from 'node:fs/promises';
import { Box3 } from 'three';
import { readGlbParts } from '../../src/universal-spatial/reconstruction/glb-geometry';
for (const file of process.argv.slice(2)) {
  const parts = readGlbParts(new Uint8Array(await readFile(file)));
  console.log(file.split('/').pop(), parts.length, 'parts', parts.reduce((s, p) => s + p.tris.length, 0), 'triangles');
  for (const p of parts) { const b = new Box3(); for (const t of p.tris) for (const v of t) b.expandByPoint(v); console.log('  ', p.path, p.tris.length, b.min.toArray().map((n) => +n.toFixed(2)).join(','), '->', b.max.toArray().map((n) => +n.toFixed(2)).join(',')); }
}
