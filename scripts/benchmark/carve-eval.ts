// Does photo-consistency carving beat the visual hull on geometry? Chamfer of voxel-surface points vs the GT mesh (translation-aligned), hull vs carved, per option set.
//   npx tsx scripts/benchmark/carve-eval.ts [--fov 12|40|65] [--assets A,B] [--sets name,name]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Box3, Vector3 } from 'three';
import { readGlbParts } from '../../src/universal-spatial/reconstruction/glb-geometry';
import type { Tri, Grid } from '../../src/universal-spatial/reconstruction/silhouette';
import { chamfer, samplePoints } from '../../src/universal-spatial/reconstruction/multiview-metrics';
import { reconstructHull } from '../../src/universal-spatial/reconstruction/multiview';
import { photoCarve, type CarveOptions } from '../../src/universal-spatial/reconstruction/photo-carve';
import { decodeColour } from '../../src/living/reality/evidence';
import { intakeOrbit, type IntakeImage } from '../../src/living/reality/intake';
import { viewsOf } from '../../src/living/reality/model';

const W = 480, H = 360, FILL = 0.55, arg = (n: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1]! : null);
const FOV = Number(arg('--fov') ?? 12), only = arg('--assets')?.split(',') ?? null;
const SETS: Record<string, CarveOptions> = { 'thr10': { threshold: 10 }, 'thr14': { threshold: 14 }, 'thr20': { threshold: 20 }, 'thr14-m2': { threshold: 14, minViews: 2 }, 'thr14-p1': { threshold: 14, passes: 1 }, 'thr28': { threshold: 28 } };
const sets = (arg('--sets') ?? Object.keys(SETS).join(',')).split(',');
const manifest = JSON.parse(readFileSync(resolve('reports/reality-engine/benchmark/manifest.json'), 'utf8')) as { assets: Array<{ id: string; split: string }> };
const frames = (id: string): IntakeImage[] => { const buf = gunzipSync(readFileSync(resolve('scripts/benchmark/cache', `${id}.turn8${FOV === 12 ? '' : `.fov${FOV}`}.rgba.gz`))), sz = W * H * 4;
  return Array.from({ length: 8 }, (_, i) => { const data = new Uint8ClampedArray(buf.subarray(i * sz, (i + 1) * sz)), mask = new Uint8Array(W * H); for (let k = 0; k < mask.length; k++) mask[k] = data[k * 4 + 3]! > 127 ? 1 : 0; return { name: `${id}-${i}`, rgba: { width: W, height: H, data }, mask, maskSource: 'confirmed' as const }; }); };
const surfacePoints = (occ: Uint8Array, g: Grid): Vector3[] => { const [nx, ny, nz] = g.cells, out: Vector3[] = []; for (let id = 0; id < occ.length; id++) { if (!occ[id]) continue; const i = id % nx, j = Math.floor(id / nx) % ny, k = Math.floor(id / (nx * ny)); let s = false; for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) { const a = i + dx, b = j + dy, c = k + dz; if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz || !occ[a + nx * (b + ny * c)]) { s = true; break; } } if (s) out.push(new Vector3(g.min.x + (i + 0.5) * g.size, g.min.y + (j + 0.5) * g.size, g.min.z + (k + 0.5) * g.size)); } return out; };
const rows: Array<Record<string, unknown>> = [];
for (const asset of manifest.assets) {
  if (only && !only.includes(asset.id)) continue;
  const tris: Tri[] = readGlbParts(new Uint8Array(readFileSync(resolve('reports/reality-engine/benchmark/assets', asset.id, `${asset.id}.glb`)))).flatMap((p) => p.tris);
  const box = new Box3(); for (const t of tris) for (const p of t) box.expandByPoint(p); const c = box.getCenter(new Vector3()), height = box.getSize(new Vector3()).y, diag = box.getSize(new Vector3()).length();
  const gt = tris.map((t) => t.map((p) => p.clone().sub(c).multiplyScalar(FILL / height)) as Tri), gtPts = samplePoints(gt, 6000, 2), objDiag = (diag * FILL) / height;
  const intake = intakeOrbit(frames(asset.id), { elevationDeg: 20 }); if (!intake.evidence) continue;
  const ev = intake.evidence, frame = { centre: new Vector3(...ev.frame.centre), half: ev.frame.half }, views = viewsOf(ev), hull = reconstructHull(views, { frame, cells: ev.cells });
  const cv = views.map((v, i) => ({ view: v, colour: ev.views[i]!.colour ? decodeColour(ev.views[i]!.colour!, ev.colourRes) : null, colourRes: ev.colourRes }));
  const cen = (a: Vector3[]) => a.reduce((s, v) => s.add(v), new Vector3()).multiplyScalar(1 / a.length), g = hull.grid;
  const score = (occ: Uint8Array) => { const pts = surfacePoints(occ, g), shift = cen(gtPts).sub(cen(pts)), ch = chamfer(pts.map((q) => q.clone().add(shift)), gtPts); return { chamferPct: +((ch.symmetric / objDiag) * 100).toFixed(3), accuracyPct: +((ch.accuracy / objDiag) * 100).toFixed(3), completenessPct: +((ch.completeness / objDiag) * 100).toFixed(3) }; };
  const row: Record<string, unknown> = { id: asset.id, split: asset.split, hull: score(hull.occupancy) };
  for (const s of sets) { const r = photoCarve(cv, hull.occupancy, g, frame, ev.res, SETS[s]); row[s] = { ...score(r.occupancy), removedShare: +r.removedShare.toFixed(4) }; }
  rows.push(row); console.log(asset.id, asset.split, JSON.stringify(Object.fromEntries(Object.entries(row).filter(([k]) => k !== 'id' && k !== 'split').map(([k, v]) => [k, (v as { chamferPct: number }).chamferPct])))); 
}
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]!; };
const summary = Object.fromEntries(['hull', ...sets].map((k) => [k, Object.fromEntries(['development', 'acceptance', 'all'].map((sp) => { const r = rows.filter((x) => sp === 'all' || x.split === sp), v = r.map((x) => (x[k] as { chamferPct: number }).chamferPct); return [sp, { median: +med(v).toFixed(3), mean: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(3) }]; }))]));
console.log(JSON.stringify(summary));
if (!only) writeFileSync(resolve(`reports/reality-engine/benchmark/carve-fov${FOV}.json`), JSON.stringify({ note: 'Voxel-surface chamfer (% of object diagonal, translation-aligned) of the visual hull vs photo-consistency carving variants. Renders, exact alpha masks, 8 turntable views.', fov: FOV, summary, rows }, null, 2) + '\n');
