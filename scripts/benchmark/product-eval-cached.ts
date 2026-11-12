// End-to-end product path on the cached composites (renders over real photographs, three conditions), WITHOUT a browser: the product's automatic outlines
// (candidateOutlines + selectOutline, salient maps cached from u2netp) -> intakeOrbit -> reconstruction -> the product's fidelity class. Scored against the GT mesh.
// Answers the safety question: when the outlines are wrong, does the product still call the result "partially verified"?   npx tsx scripts/benchmark/product-eval-cached.ts [--cond ...]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Box3, Vector3 } from 'three';
import { readGlbParts } from '../../src/universal-spatial/reconstruction/glb-geometry';
import type { Tri } from '../../src/universal-spatial/reconstruction/silhouette';
import { chamfer, geometryPoints, samplePoints } from '../../src/universal-spatial/reconstruction/multiview-metrics';
import { reconstructHull } from '../../src/universal-spatial/reconstruction/multiview';
import { candidateOutlines, selectOutline } from '../../src/living/reality/auto-segmentation';
import { intakeOrbit } from '../../src/living/reality/intake';
import { buildModel, viewsOf } from '../../src/living/reality/model';
import { assessReconstruction } from '../../src/living/reality/assessment';
import { planFromModel } from '../../src/living/reality/plan';
import { evidenceSha256 } from '../../src/living/reality/evidence';
import type { SodRunner } from '../../src/living/reality/sod';

const W = 480, H = 360, FILL = 0.55, arg = (n: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1]! : null);
const conds = (arg('--cond') ?? 'fixed,varied,degraded').split(','), only = arg('--assets')?.split(',') ?? null;
const manifest = JSON.parse(readFileSync(resolve('reports/reality-engine/benchmark/manifest.json'), 'utf8')) as { assets: Array<{ id: string; split: string }> };
function npy(file: string) { const b = readFileSync(file), hl = b.readUInt16LE(8); return new Uint8Array(b.buffer, b.byteOffset + 10 + hl, b.length - 10 - hl); }
const half = (u: number) => { const s = (u >> 15) & 1, e = (u >> 10) & 31, f = u & 1023; return (s ? -1 : 1) * (e === 0 ? (f / 1024) * 2 ** -14 : e === 31 ? NaN : (1 + f / 1024) * 2 ** (e - 15)); };
const iou = (a: Uint8Array, b: Uint8Array) => { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { i += a[k]! & b[k]!; u += a[k]! | b[k]!; } return u ? i / u : 0; };
const rows: Array<Record<string, unknown>> = [];
for (const a of manifest.assets) {
  if (only && !only.includes(a.id)) continue;
  const rgbaGz = gunzipSync(readFileSync(resolve('scripts/benchmark/cache', `${a.id}.turn8.rgba.gz`))), truths = Array.from({ length: 8 }, (_, i) => { const m = new Uint8Array(W * H); for (let k = 0; k < m.length; k++) m[k] = rgbaGz[i * W * H * 4 + k * 4 + 3]! > 127 ? 1 : 0; return m; });
  const tris: Tri[] = readGlbParts(new Uint8Array(readFileSync(resolve('reports/reality-engine/benchmark/assets', a.id, `${a.id}.glb`)))).flatMap((p) => p.tris), box = new Box3(); for (const t of tris) for (const p of t) box.expandByPoint(p);
  const c = box.getCenter(new Vector3()), height = box.getSize(new Vector3()).y, diag = box.getSize(new Vector3()).length(), gt = tris.map((t) => t.map((p) => p.clone().sub(c).multiplyScalar(FILL / height)) as Tri), gtPts = samplePoints(gt, 5000, 2), objDiag = (diag * FILL) / height;
  for (const cond of conds) {
    const rg = npy(resolve('scripts/benchmark/cache/seg', `${a.id}.${cond}.rgba.npy`)), sd = npy(resolve('scripts/benchmark/cache/seg', `${a.id}.${cond}.sod.npy`)), sd16 = new Uint16Array(sd.buffer, sd.byteOffset, sd.length / 2);
    const images = Array.from({ length: 8 }, (_, i) => ({ width: W, height: H, data: new Uint8ClampedArray(rg.buffer, rg.byteOffset + i * W * H * 4, W * H * 4) })), soft = new Map<unknown, Float32Array>();
    images.forEach((im, i) => { const f = new Float32Array(W * H); for (let k = 0; k < f.length; k++) f[k] = half(sd16[i * W * H + k]!); soft.set(im, f); });
    const sod: SodRunner = { available: async () => true, run: async (im) => soft.get(im)! }, cands = await candidateOutlines(images, { sod }), sel = cands.map((cs) => selectOutline(cs, W, H));
    const row: Record<string, unknown> = { id: a.id, split: a.split, cond, methods: sel.map((s) => s.method), segIoUMean: +(sel.reduce((s, o, i) => s + (o.mask ? iou(o.mask, truths[i]!) : 0), 0) / 8).toFixed(3), wrongViews: sel.filter((o, i) => o.mask && iou(o.mask, truths[i]!) < 0.8).length, refusedViews: sel.filter((o) => !o.mask).length };
    const intake = intakeOrbit(images.map((rgba, i) => ({ name: `${a.id}-${i}`, rgba, ...(sel[i]!.mask ? { mask: sel[i]!.mask!, maskSource: 'automatic' as const, maskMethod: sel[i]!.method! } : {}) })), { elevationDeg: 20 });
    if (!intake.evidence) { row.status = 'refused'; row.refusals = intake.refusals.map((r) => r.code); rows.push(row); console.log(a.id, cond, 'REFUSED', row.refusals); continue; }
    const ev = intake.evidence, model = buildModel(ev), sha = await evidenceSha256(ev); let assess: ReturnType<typeof assessReconstruction>;
    try { assess = assessReconstruction(planFromModel(model, sha, a.id), model, sha); } catch (e) { row.status = 'plan-error'; row.error = `${(e as Error).message} (parts ${model.parts.length})`; rows.push(row); console.log(a.id, cond, 'PLAN ERROR', row.error); continue; }
    const frame = { centre: new Vector3(...ev.frame.centre), half: ev.frame.half }, hull = reconstructHull(viewsOf(ev), { frame, cells: ev.cells }), pts = geometryPoints(hull.geometry, 4000, 3);
    const cen = (v: Vector3[]) => v.reduce((s, q) => s.add(q), new Vector3()).multiplyScalar(1 / v.length), shift = cen(gtPts).sub(cen(pts)), ch = chamfer(pts.map((q) => q.clone().add(shift)), gtPts);
    Object.assign(row, { status: 'reconstructed', chamferPct: +((ch.symmetric / objDiag) * 100).toFixed(3), fidelityClass: assess.ledger.fidelity.class, toleranceStated: assess.benchmarkTolerance !== null });
    rows.push(row); console.log(a.id, cond, JSON.stringify({ seg: row.segIoUMean, wrong: row.wrongViews, chamfer: row.chamferPct, class: row.fidelityClass, tol: row.toleranceStated }));
  }
}
const summary = Object.fromEntries(conds.map((cond) => { const r = rows.filter((x) => x.cond === cond && x.status === 'reconstructed'), bad = r.filter((x) => (x.chamferPct as number) > 6), ver = r.filter((x) => x.fidelityClass === 'partially_verified'), badVer = bad.filter((x) => x.fidelityClass === 'partially_verified'); const med = (v: number[]) => [...v].sort((p, q) => p - q)[Math.floor(v.length / 2)] ?? null;
  return [cond, { assets: rows.filter((x) => x.cond === cond).length, refused: rows.filter((x) => x.cond === cond && x.status === 'refused').length, medianChamferPct: med(r.map((x) => x.chamferPct as number)), medianSegIoU: med(rows.filter((x) => x.cond === cond).map((x) => x.segIoUMean as number)), badGeometryOver6pct: bad.length, partiallyVerified: ver.length, badButPartiallyVerified: badVer.length, withToleranceStated: r.filter((x) => x.toleranceStated).length }]; }));
console.log(JSON.stringify(summary, null, 1));
if (!only) writeFileSync(resolve('reports/reality-engine/benchmark/product-eval-cached.json'), JSON.stringify({ generatedBy: 'scripts/benchmark/product-eval-cached.ts', note: 'Product automatic-outline path on cached composites (renders over real photographs), fidelity class from the product assessment. badGeometry = hull chamfer > 6% of the object diagonal.', summary, rows }, null, 2) + '\n');
