// Geometry beyond the orthographic assumption. Cached perspective renders (exact alpha) -> intakeOrbit (orthographic window) -> hull; compared with the hull built
// with perspective cameras: oracle field of view, and the field of view ESTIMATED by held-out consistency. Chamfer vs the GT mesh, translation-aligned (origin convention).
//   RC_FOV=40 npx tsx scripts/benchmark/recon-eval.ts [--fov 40] [--assets A,B] [--cands 0,15,25,40,55,70]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Box3, Vector3 } from 'three';
import { readGlbParts } from '../../src/universal-spatial/reconstruction/glb-geometry';
import type { Tri } from '../../src/universal-spatial/reconstruction/silhouette';
import { chamfer, geometryPoints, samplePoints } from '../../src/universal-spatial/reconstruction/multiview-metrics';
import { leaveOneOutIoU, orbitPinhole, reconstructHull, type SilhouetteView } from '../../src/universal-spatial/reconstruction/multiview';
import { intakeOrbit, type IntakeImage } from '../../src/living/reality/intake';
import { viewsOf } from '../../src/living/reality/model';

const W = 480, H = 360, FILL = 0.55, arg = (n: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1]! : null);
const FOV = Number(arg('--fov') ?? 40), only = arg('--assets')?.split(',') ?? null, cands = (arg('--cands') ?? '0,15,25,40,55,70').split(',').map(Number);
const manifest = JSON.parse(readFileSync(resolve('reports/reality-engine/benchmark/manifest.json'), 'utf8')) as { assets: Array<{ id: string; split: string }> };
const frames = (id: string): IntakeImage[] => { const buf = gunzipSync(readFileSync(resolve('scripts/benchmark/cache', `${id}.turn8${FOV === 12 ? '' : `.fov${FOV}`}.rgba.gz`))), sz = W * H * 4;
  return Array.from({ length: 8 }, (_, i) => { const data = new Uint8ClampedArray(buf.subarray(i * sz, (i + 1) * sz)), mask = new Uint8Array(W * H); for (let k = 0; k < mask.length; k++) mask[k] = data[k * 4 + 3]! > 127 ? 1 : 0; return { name: `${id}-${i}`, rgba: { width: W, height: H, data }, mask, maskSource: 'confirmed' as const }; }); };
const rows: Array<Record<string, unknown>> = [];
for (const asset of manifest.assets) {
  if (only && !only.includes(asset.id)) continue;
  const tris: Tri[] = readGlbParts(new Uint8Array(readFileSync(resolve('reports/reality-engine/benchmark/assets', asset.id, `${asset.id}.glb`)))).flatMap((p) => p.tris);
  const box = new Box3(); for (const t of tris) for (const p of t) box.expandByPoint(p); const c = box.getCenter(new Vector3()), height = box.getSize(new Vector3()).y, diag = box.getSize(new Vector3()).length();
  const gt = tris.map((t) => t.map((p) => p.clone().sub(c).multiplyScalar(FILL / height)) as Tri), gtPts = samplePoints(gt, 5000, 2), objDiag = (diag * FILL) / height;
  const intake = intakeOrbit(frames(asset.id), { elevationDeg: 20 }); if (!intake.evidence) { console.log(asset.id, 'refused'); continue; }
  const ev = intake.evidence, frame = { centre: new Vector3(...ev.frame.centre), half: ev.frame.half }, base = viewsOf(ev), cen = (a: Vector3[]) => a.reduce((s, v) => s.add(v), new Vector3()).multiplyScalar(1 / a.length);
  const withFov = (fov: number, dy = 0): SilhouetteView[] => (fov === 0 ? base : base.map((v) => { const camera = orbitPinhole(v.azimuthDeg, v.elevationDeg, fov, v.res, frame.half, frame.centre); camera.cy += dy; return { ...v, camera }; }));
  const score = (fov: number, dy = 0) => {
    const vs = withFov(fov, dy), hull = reconstructHull(vs, { frame, cells: ev.cells }), pts = geometryPoints(hull.geometry, 4000, 3), shift = cen(gtPts).sub(cen(pts)), ch = chamfer(pts.map((q) => q.clone().add(shift)), gtPts);
    const loo = leaveOneOutIoU(vs, { frame, cells: 40 }), looMean = loo.reduce((a, b) => a + b, 0) / loo.length;
    return { chamferPct: +((ch.symmetric / objDiag) * 100).toFixed(3), accuracyPct: +((ch.accuracy / objDiag) * 100).toFixed(3), completenessPct: +((ch.completeness / objDiag) * 100).toFixed(3), loo: +looMean.toFixed(4) };
  };
  const DYS = [-8, -6, -4, -2, 0, 2, 4, 6, 8], grid: Array<{ fov: number; dy: number; s: ReturnType<typeof score> }> = [];
  for (const f of cands) for (const dy of f === 0 ? [0] : DYS) grid.push({ fov: f, dy, s: score(f, dy) });
  const best = grid.reduce((b, g) => (g.s.loo > b.s.loo ? g : b), grid[0]!), orthoRow = grid.find((g) => g.fov === 0)!.s;
  const oracleBest = grid.filter((g) => g.fov === FOV).reduce((b, g) => (g.s.loo > b.s.loo ? g : b)), oracleDy0 = score(FOV, 0);
  const row = { id: asset.id, split: asset.split, trueFov: FOV, ortho: orthoRow, oracle: oracleDy0, oracleFovBestDy: { dy: oracleBest.dy, ...oracleBest.s }, estimatedFov: best.fov, estimatedDy: best.dy, estimated: best.s };
  rows.push(row); console.log(asset.id, asset.split, JSON.stringify({ ortho: row.ortho.chamferPct, oracle: row.oracle.chamferPct, est: row.estimated.chamferPct, estFov: best.fov, estDy: best.dy, oracleDy: oracleBest.dy, oracleBestDy: oracleBest.s.chamferPct, looOrtho: row.ortho.loo, looOracle: row.oracle.loo }));
}
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]!; };
const agg = (sel: (r: (typeof rows)[number]) => number, split?: string) => { const v = rows.filter((r) => !split || r.split === split).map(sel); return { median: +med(v).toFixed(3), mean: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(3) }; };
const summary = Object.fromEntries(['development', 'acceptance', undefined].map((s) => [s ?? 'all', { ortho: agg((r) => r.ortho.chamferPct, s), oracle: agg((r) => r.oracle.chamferPct, s), estimated: agg((r) => r.estimated.chamferPct, s) }]));
console.log(JSON.stringify(summary, null, 1));
if (!only) writeFileSync(resolve(`reports/reality-engine/benchmark/recon-perspective-fov${FOV}.json`), JSON.stringify({ note: 'Hull chamfer (% of object diagonal, translation-aligned) with the orthographic assumption vs perspective cameras (oracle FOV / FOV estimated by held-out consistency). Renders, exact alpha masks.', fov: FOV, candidates: cands, summary, rows }, null, 2) + '\n');
