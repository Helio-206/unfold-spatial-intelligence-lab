// Product camera model on perspective renders (12 / 40 / 65 degrees): the product's intake (which estimates a field of view only if held-out consistency gains >= 0.04)
// against the same intake forced orthographic. Chamfer of the hull vs the GT mesh (translation-aligned). Reports how often a camera was adopted and how often it was right.
//   npx tsx scripts/benchmark/camera-eval.ts [--fov 40,65]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Box3, Vector3 } from 'three';
import { readGlbParts } from '../../src/universal-spatial/reconstruction/glb-geometry';
import type { Tri } from '../../src/universal-spatial/reconstruction/silhouette';
import { chamfer, geometryPoints, samplePoints } from '../../src/universal-spatial/reconstruction/multiview-metrics';
import { reconstructHull } from '../../src/universal-spatial/reconstruction/multiview';
import { intakeOrbit, type IntakeImage } from '../../src/living/reality/intake';
import { viewsOf } from '../../src/living/reality/model';

const W = 480, H = 360, FILL = 0.55, arg = (n: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1]! : null);
const fovs = (arg('--fov') ?? '12,40,65').split(',').map(Number);
const manifest = JSON.parse(readFileSync(resolve('reports/reality-engine/benchmark/manifest.json'), 'utf8')) as { assets: Array<{ id: string; split: string }> };
const frames = (id: string, fov: number): IntakeImage[] => { const buf = gunzipSync(readFileSync(resolve('scripts/benchmark/cache', `${id}.turn8${fov === 12 ? '' : `.fov${fov}`}.rgba.gz`))), sz = W * H * 4;
  return Array.from({ length: 8 }, (_, i) => { const data = new Uint8ClampedArray(buf.subarray(i * sz, (i + 1) * sz)), mask = new Uint8Array(W * H); for (let k = 0; k < mask.length; k++) mask[k] = data[k * 4 + 3]! > 127 ? 1 : 0; return { name: `${id}-${i}`, rgba: { width: W, height: H, data }, mask, maskSource: 'confirmed' as const }; }); };
const rows: Array<Record<string, unknown>> = [];
for (const fov of fovs) for (const a of manifest.assets) {
  const tris: Tri[] = readGlbParts(new Uint8Array(readFileSync(resolve('reports/reality-engine/benchmark/assets', a.id, `${a.id}.glb`)))).flatMap((p) => p.tris), box = new Box3(); for (const t of tris) for (const p of t) box.expandByPoint(p);
  const c = box.getCenter(new Vector3()), height = box.getSize(new Vector3()).y, diag = box.getSize(new Vector3()).length(), gtPts = samplePoints(tris.map((t) => t.map((p) => p.clone().sub(c).multiplyScalar(FILL / height)) as Tri), 5000, 2), objDiag = (diag * FILL) / height;
  const cen = (v: Vector3[]) => v.reduce((s, q) => s.add(q), new Vector3()).multiplyScalar(1 / v.length);
  const score = (ev: NonNullable<ReturnType<typeof intakeOrbit>['evidence']>) => { const frame = { centre: new Vector3(...ev.frame.centre), half: ev.frame.half }, pts = geometryPoints(reconstructHull(viewsOf(ev), { frame, cells: ev.cells }).geometry, 4000, 3), sh = cen(gtPts).sub(cen(pts)); return +((chamfer(pts.map((q) => q.clone().add(sh)), gtPts).symmetric / objDiag) * 100).toFixed(3); };
  const photos = frames(a.id, fov), t0 = performance.now(), auto = intakeOrbit(photos, { elevationDeg: 20 }), ms = performance.now() - t0, ortho = intakeOrbit(photos, { elevationDeg: 20, orthographicOnly: true });
  if (!auto.evidence || !ortho.evidence) continue;
  const row = { fov, id: a.id, split: a.split, camera: auto.evidence.camera ? { fovDeg: auto.evidence.camera.fovDeg, shift: auto.evidence.camera.principalShiftPx, gain: auto.evidence.camera.gain } : null, orthoChamferPct: score(ortho.evidence), productChamferPct: score(auto.evidence), intakeMs: Math.round(ms) };
  rows.push(row); console.log(JSON.stringify(row));
}
const med = (v: number[]) => [...v].sort((p, q) => p - q)[Math.floor(v.length / 2)] ?? null;
const summary = Object.fromEntries(fovs.map((f) => { const r = rows.filter((x) => x.fov === f), o = r.map((x) => x.orthoChamferPct as number), p = r.map((x) => x.productChamferPct as number); return [f, { assets: r.length, adopted: r.filter((x) => x.camera).length, medianOrtho: med(o), medianProduct: med(p), meanOrtho: +(o.reduce((s, v) => s + v, 0) / o.length).toFixed(3), meanProduct: +(p.reduce((s, v) => s + v, 0) / p.length).toFixed(3), better: r.filter((x) => (x.productChamferPct as number) < (x.orthoChamferPct as number) - 0.05).length, worse: r.filter((x) => (x.productChamferPct as number) > (x.orthoChamferPct as number) + 0.05).length }]; }));
console.log(JSON.stringify(summary, null, 1));
writeFileSync(resolve('reports/reality-engine/benchmark/camera-eval.json'), JSON.stringify({ note: 'Product intake with estimated perspective camera (gated by held-out gain >= 0.04) vs forced orthographic; hull chamfer % of object diagonal on renders with exact masks.', summary, rows }, null, 2) + '\n');
