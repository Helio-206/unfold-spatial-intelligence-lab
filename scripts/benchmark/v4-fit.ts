// Phase B proof of concept, controlled by ground truth: plan-constrained multi-view fitting with held-out verification.
//   ground truth  = a plan (hand-authored lungs / microscope reproductions)       [hand-authored]
//   input plan    = the same plan with SYNTHETIC placement errors (seeded)        [synthetic degradation, NOT the error distribution of Meta]
//   evidence      = K calibrated silhouettes of the ground truth
//   result        = typed set-transform operations (basis: inferred), applied through applySpatialOperationV2, ids and provenance preserved
//   npx tsx scripts/benchmark/v4-fit.ts reports/fidelity-v4
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Box3, Mesh, Vector3, type Object3D } from 'three';
import { applySpatialOperationV2, validateSpatialPlanV2, type SpatialPlanV2 } from '../../src/universal-spatial/contracts-v2';
import { compileSpatialPlanV2 } from '../../src/universal-spatial/geometry-compiler-v2';
import { fitPlacement, place, type FitInput } from '../../src/universal-spatial/reconstruction/fit';
import { makeView, maskIoU, rasterise, viewDirections, type Tri } from '../../src/universal-spatial/reconstruction/silhouette';

const out = resolve(process.argv[2] ?? 'reports/fidelity-v4'); await mkdir(resolve(out, 'plans'), { recursive: true });
const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const trisByEntity = (root: Object3D) => {
  root.updateMatrixWorld(true); const map = new Map<string, Tri[]>();
  root.traverse((o) => { if (!(o instanceof Mesh) || typeof o.userData.spatialEntityId !== 'string') return; const id = o.userData.spatialEntityId as string, pos = o.geometry.getAttribute('position'), idx = o.geometry.index, n = idx ? idx.count : pos.count, l = map.get(id) ?? []; const v = (i: number) => new Vector3().fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld); for (let i = 0; i + 2 < n; i += 3) l.push([v(i), v(i + 1), v(i + 2)]); map.set(id, l); });
  return map;
};
const bbox = (tris: Tri[]) => { const b = new Box3(); for (const t of tris) for (const p of t) b.expandByPoint(p); return b; };

const CASES = [
  { name: 'lungs-like', file: 'reports/fidelity-v3/fixtures/lungs-like.json', origin: 'hand-authored reproduction' },
  { name: 'microscope-like', file: 'reports/fidelity-v3/fixtures/microscope-like.json', origin: 'hand-authored reproduction' },
];
const summary: Record<string, unknown> = {};
for (const c of CASES) {
  const reply = JSON.parse(await readFile(resolve(c.file), 'utf8')), truth = validateSpatialPlanV2(reply.plan), roots = truth.components.filter((k) => k.parentId === null);
  const truthCompiled = compileSpatialPlanV2(truth), truthTris = trisByEntity(truthCompiled.root), all = [...truthTris.values()].flat(), box = bbox(all), centre = box.getCenter(new Vector3()), half = box.getSize(new Vector3()).length() / 2 * 1.05, span = Math.max(...box.getSize(new Vector3()).toArray());
  // ---- synthetic degradation of the placement of every root component (seeded, bounded)
  const r = rng(c.name.length * 7919 + 13), errors = new Map<string, { s: number; d: [number, number, number] }>();
  const degradedJson = structuredClone(reply.plan);
  for (const comp of degradedJson.components) { if (comp.parentId !== null) continue; const s = 0.72 + r() * 0.58, d: [number, number, number] = [(r() - 0.5) * 0.2 * span, (r() - 0.5) * 0.2 * span, (r() - 0.5) * 0.2 * span]; errors.set(comp.id, { s, d }); comp.transform.scale = comp.transform.scale.map((x: number) => x * s); comp.transform.position = comp.transform.position.map((x: number, i: number) => x + d[i]!); }
  const degraded = validateSpatialPlanV2(degradedJson), degradedTris = trisByEntity(compileSpatialPlanV2(degraded).root);
  const heldViews = viewDirections(10).map((d) => makeView(d.clone().applyAxisAngle(new Vector3(0, 1, 0), 0.37), centre, half, 128)), heldGt = heldViews.map((v) => rasterise(all, v));
  const heldIou = (tris: Tri[]) => heldViews.reduce((s, v, i) => s + maskIoU(rasterise(tris, v), heldGt[i]!), 0) / heldViews.length;
  const rows: Array<Record<string, unknown>> = [];
  await writeFile(resolve(out, 'plans', `${c.name}-ground-truth.json`), `${JSON.stringify(reply, null, 1)}\n`);
  await writeFile(resolve(out, 'plans', `${c.name}-degraded.json`), `${JSON.stringify({ ...reply, plan: degradedJson, meta: { note: 'SYNTHETIC degradation of a hand-authored plan; not Meta output' } }, null, 1)}\n`);
  for (const K of [3, 6, 12]) {
    const views = viewDirections(K).map((d) => makeView(d, centre, half, 96)), targets = views.map((v) => rasterise(all, v));
    const parts: FitInput[] = roots.map((k) => ({ id: k.id, origin: new Vector3(...degraded.components.find((x) => x.id === k.id)!.transform.position), tris: degradedTris.get(k.id)! }));
    const t0 = performance.now(), fit = fitPlacement(parts, views, targets, { maxShift: 0.3 * span }), ms = performance.now() - t0;
    // ---- typed operations through the real contract; provenance says what this is
    let fitted: SpatialPlanV2 = degraded; const proposals: Array<Record<string, unknown>> = [];
    const fittedTris: Tri[] = [...degradedTris].flatMap(([id, t]) => { const p = fit.placements.get(id); return p ? place(t, parts.find((q) => q.id === id)!.origin, p) : t; });
    const held = heldIou(fittedTris);
    for (const comp of degraded.components) {
      const p = fit.placements.get(comp.id); if (!p) continue;
      const position = comp.transform.position.map((x, i) => x + (p.d.toArray()[i] ?? 0)) as [number, number, number], scale = comp.transform.scale.map((x) => x * p.s) as [number, number, number];
      fitted = applySpatialOperationV2(fitted, { contract: 'unfold.spatial-operation.v2', operationId: `v4-fit-${K}-${comp.id}`.slice(0, 80), kind: 'set-transform', componentId: comp.id, nodeKey: null, value: { ...comp.transform, position, scale } }, { origin: 'inferred', evidence: `Placement fitted to ${K} calibrated silhouettes by analysis by synthesis (synthetic ground truth). Held-out silhouette IoU ${held.toFixed(3)}. Proposal, not a measurement.` });
      const e = errors.get(comp.id)!, scaleErrBefore = Math.abs(Math.log(e.s)), scaleErrAfter = Math.abs(Math.log(e.s * p.s)), posErrBefore = new Vector3(...e.d).length() / span, posErrAfter = new Vector3(...e.d).add(p.d).length() / span;
      proposals.push({ id: comp.id, scaleErrLogBefore: +scaleErrBefore.toFixed(3), scaleErrLogAfter: +scaleErrAfter.toFixed(3), positionErrPctSpanBefore: +(100 * posErrBefore).toFixed(1), positionErrPctSpanAfter: +(100 * posErrAfter).toFixed(1) });
    }
    const sameIds = JSON.stringify(fitted.components.map((x) => x.id)) === JSON.stringify(truth.components.map((x) => x.id)), keepsSource = fitted.source.sha256 === truth.source.sha256;
    const mean = (k: string) => +(proposals.reduce((s, p) => s + (p[k] as number), 0) / proposals.length).toFixed(3);
    rows.push({ fitViews: K, fitIouBefore: +fit.iouBefore.toFixed(3), fitIouAfter: +fit.iouAfter.toFixed(3), heldOutIouDegraded: +heldIou([...degradedTris.values()].flat()).toFixed(3), heldOutIouFitted: +held.toFixed(3), meanPositionErrPctSpan: { before: mean('positionErrPctSpanBefore'), after: mean('positionErrPctSpanAfter') }, meanScaleErrLog: { before: mean('scaleErrLogBefore'), after: mean('scaleErrLogAfter') }, ms: Math.round(ms), evaluations: fit.evaluations, idsPreserved: sameIds, sourceHashPreserved: keepsSource, perComponent: proposals });
    await writeFile(resolve(out, 'plans', `${c.name}-v4-fit${K}.json`), `${JSON.stringify({ ...reply, plan: fitted, meta: { note: `V4 fitted placement from ${K} calibrated silhouettes of a synthetic ground truth; not Meta output` } }, null, 1)}\n`);
    console.log(c.name, K, 'held-out IoU', rows.at(-1)!.heldOutIouDegraded, '->', rows.at(-1)!.heldOutIouFitted, 'pos err %span', JSON.stringify(rows.at(-1)!.meanPositionErrPctSpan), 'scale', JSON.stringify(rows.at(-1)!.meanScaleErrLog), `${Math.round(ms)} ms`);
  }
  summary[c.name] = { origin: c.origin, groundTruth: 'the plan itself, rendered to calibrated silhouettes', degradation: 'seeded synthetic: scale x0.72-1.30 and shift up to +-10 % of span on every root component', heldOutViews: 10, rows };
}
await writeFile(resolve(out, 'fit-results.json'), `${JSON.stringify({ generatedBy: 'scripts/benchmark/v4-fit.ts', summary }, null, 2)}\n`);
