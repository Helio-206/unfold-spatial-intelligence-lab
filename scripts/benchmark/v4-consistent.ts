// CATEGORY D / D experiment (synthetic on both sides, labelled as such): the plan is wrong the way a self-consistent planner can be wrong,
// i.e. proportions and chain placement are off but the parts are still JOINED; and, as the contrast, the way an assembly can be wrong with every joint broken.
//   ground truth = a hand-authored plan (lungs, microscope reproductions); evidence = 6 calibrated silhouettes of it; held-out = 12 other views
//   consistent  : random scale per part, joints preserved by construction (a "mis-proportioned but connected" plan)
//   disjoint    : independent random scale/shift per part (every joint broken)  -> no contact is supported by the plan, none may be created
//   npx tsx scripts/benchmark/v4-consistent.ts reports/fidelity-v4/benchmark
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Box3, Mesh, Vector3, type Object3D } from 'three';
import { applySpatialOperationV2, validateSpatialPlanV2, type SpatialPlanV2 } from '../../src/universal-spatial/contracts-v2';
import { compileSpatialPlanV2 } from '../../src/universal-spatial/geometry-compiler-v2';
import { buildConstraints, placedGap, type PartGeometry, type Placed } from '../../src/universal-spatial/reconstruction/constraints';
import { fitPlacement } from '../../src/universal-spatial/reconstruction/fit';
import { derivePlacements, fitStructured, forestOf, placeTris, type Params } from '../../src/universal-spatial/reconstruction/structural-fit';
import { makeView, maskIoU, rasterise, viewDirections, type Tri } from '../../src/universal-spatial/reconstruction/silhouette';
import { replyFromPlan } from '../../tests/fixtures/spatial-v2/handauthored';

const out = resolve(process.argv[2] ?? 'reports/fidelity-v4/benchmark'); await mkdir(resolve(out, 'plans'), { recursive: true });
const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const trisByEntity = (root: Object3D) => { root.updateMatrixWorld(true); const m = new Map<string, Tri[]>(); root.traverse((o) => { if (!(o instanceof Mesh) || typeof o.userData.spatialEntityId !== 'string') return; const id = o.userData.spatialEntityId as string, pos = o.geometry.getAttribute('position'), idx = o.geometry.index, n = idx ? idx.count : pos.count, l = m.get(id) ?? []; const v = (i: number) => new Vector3().fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld); for (let i = 0; i + 2 < n; i += 3) l.push([v(i), v(i + 1), v(i + 2)]); m.set(id, l); }); return m; };
const boxOf = (t: Tri[]) => { const b = new Box3(); for (const x of t) for (const p of x) b.expandByPoint(p); return b; };
const round = (n: number, d = 3) => +n.toFixed(d);
const toPlan = (plan: SpatialPlanV2, roots: string[], pivots: Map<string, Vector3>, placements: Map<string, Placed>, provenance?: { origin: 'inferred'; evidence: string }, label = 'x') => {
  let next = plan; for (const id of roots) { const c = plan.components.find((k) => k.id === id)!, pl = placements.get(id)!, piv = pivots.get(id)!, p0 = new Vector3(...c.transform.position), pos = p0.clone().addScaledVector(piv.clone().sub(p0), 1 - pl.s).add(pl.d).toArray().map((n) => round(n, 5)) as [number, number, number], scale = c.transform.scale.map((x) => round(x * pl.s, 5)) as [number, number, number];
    next = provenance ? applySpatialOperationV2(next, { contract: 'unfold.spatial-operation.v2', operationId: `v4-${label}-${id}`.slice(0, 80), kind: 'set-transform', componentId: id, nodeKey: null, value: { ...c.transform, position: pos, scale } }, provenance) : validateSpatialPlanV2({ ...next, components: next.components.map((k) => (k.id === id ? { ...k, transform: { ...k.transform, position: pos, scale } } : k)) }); }
  return next;
};

const results: Record<string, unknown> = {};
for (const name of ['lungs-like', 'microscope-like']) {
  const reply = JSON.parse(await readFile(resolve(`reports/fidelity-v3/fixtures/${name}.json`), 'utf8')), truth = validateSpatialPlanV2(reply.plan), roots = truth.components.filter((c) => c.parentId === null).map((c) => c.id);
  const tTris = trisByEntity(compileSpatialPlanV2(truth).root), all = [...tTris.values()].flat(), box = boxOf(all), centre = box.getCenter(new Vector3()), half = box.getSize(new Vector3()).length() / 2 * 1.05, span = Math.max(...box.getSize(new Vector3()).toArray());
  const pivots = new Map(roots.map((id) => [id, boxOf(tTris.get(id)!).getCenter(new Vector3())])), tParts: PartGeometry[] = roots.map((id) => ({ id, origin: pivots.get(id)!, tris: tTris.get(id)! }));
  const gtConstraints = buildConstraints(truth, tParts, span), forest = forestOf(tParts, gtConstraints), r = rng(name.length * 31 + 5);
  const fitViews = viewDirections(6).map((d) => makeView(d, centre, half, 128)), targets = fitViews.map((v) => rasterise(all, v)), heldViews = viewDirections(12).map((d) => makeView(d.clone().applyAxisAngle(new Vector3(0, 1, 0), 0.31).applyAxisAngle(new Vector3(1, 0, 0), 0.2), centre, half, 128)), heldGt = heldViews.map((v) => rasterise(all, v));
  const gtCentres = new Map(roots.map((id) => [id, boxOf(tTris.get(id)!).getCenter(new Vector3())]));
  for (const mode of ['consistent', 'disjoint'] as const) {
    // ---- build the input plan
    let inputPlacements: Map<string, Placed>;
    if (mode === 'consistent') { const params: Params = new Map(roots.map((id) => [id, { s: 0.72 + r() * 0.6, d: forest.roots.includes(id) || forest.free.includes(id) ? new Vector3((r() - 0.5) * 0.16 * span, (r() - 0.5) * 0.16 * span, (r() - 0.5) * 0.16 * span) : new Vector3() }])); inputPlacements = derivePlacements(tParts, gtConstraints, forest, params); }
    else inputPlacements = new Map(roots.map((id) => [id, { s: 0.75 + r() * 0.55, d: new Vector3((r() - 0.5) * 0.2 * span, (r() - 0.5) * 0.2 * span, (r() - 0.5) * 0.2 * span) }]));
    const input = toPlan(truth, roots, pivots, inputPlacements), iTris = trisByEntity(compileSpatialPlanV2(input).root);
    const iParts: PartGeometry[] = roots.map((id) => ({ id, origin: boxOf(iTris.get(id)!).getCenter(new Vector3()), tris: iTris.get(id)! })), iPivots = new Map(iParts.map((p) => [p.id, p.origin]));
    const constraints = buildConstraints(input, iParts, span), contacts = constraints.attach.map((c) => ({ a: c.a, b: c.b, gap: c.gap }));
    const t0 = performance.now(), fit = fitStructured(iParts, constraints, fitViews, targets, { span }), structMs = performance.now() - t0, free = fitPlacement(iParts, fitViews, targets, { maxShift: 0.3 * span });
    // ---- evaluation against the ground-truth plan (known placements) on held-out views
    const measure = (placements: Map<string, Placed>) => {
      const placed = iParts.flatMap((p) => placeTris(p.tris, p.origin, placements.get(p.id) ?? { s: 1, d: new Vector3() })), masks = heldViews.map((v) => rasterise(placed, v)), iou = masks.reduce((s, m, i) => s + maskIoU(m, heldGt[i]!), 0) / masks.length;
      const cs = roots.map((id) => boxOf(placeTris(iParts.find((p) => p.id === id)!.tris, iParts.find((p) => p.id === id)!.origin, placements.get(id) ?? { s: 1, d: new Vector3() })).getCenter(new Vector3())), rel: number[] = [];
      for (let i = 0; i < roots.length; i++) for (let j = i + 1; j < roots.length; j++) rel.push(gtCentres.get(roots[i]!)!.clone().sub(gtCentres.get(roots[j]!)!).sub(cs[i]!.clone().sub(cs[j]!)).length() / span);
      const broken = contacts.filter((c) => placedGap(iParts.find((p) => p.id === c.a)!, iParts.find((p) => p.id === c.b)!, placements.get(c.a) ?? { s: 1, d: new Vector3() }, placements.get(c.b) ?? { s: 1, d: new Vector3() }) > Math.max(0.02 * span, 2 * c.gap + 0.01 * span)).length;
      return { heldOutIou: round(iou), relationErrPctSpan: round(100 * rel.reduce((a, b) => a + b, 0) / rel.length, 2), contactsBroken: broken };
    };
    const row = { mode, contactsInInput: contacts.length, constraintSources: [...new Set(constraints.attach.map((c) => c.source))], notes: constraints.notes, input: measure(new Map()), silhouetteOnly: measure(free.placements), structural: measure(fit.placements), structuralMs: Math.round(structMs), frozen: fit.frozen, maxJointResidualPctSpan: round(100 * Math.max(0, ...fit.residuals.map((x) => x.after)), 4) };
    (results[name] ??= {} as Record<string, unknown>) as Record<string, unknown>;
    (results[name] as Record<string, unknown>)[mode] = row;
    console.log(name, mode, 'contacts', contacts.length, JSON.stringify({ input: row.input, sil: row.silhouetteOnly, struct: row.structural }));
    if (mode === 'consistent') {
      const prov = { origin: 'inferred' as const, evidence: 'Structural solver fitted to 6 calibrated silhouettes of the ground-truth plan (synthetic, category D/D). Basis: inferred.' };
      await writeFile(resolve(out, 'plans', `${name}-consistent-input.json`), `${JSON.stringify(replyFromPlan(input), null, 1)}\n`);
      await writeFile(resolve(out, 'plans', `${name}-consistent-structural.json`), `${JSON.stringify(replyFromPlan(toPlan(input, roots, iPivots, fit.placements, prov, 'structural')), null, 1)}\n`);
      await writeFile(resolve(out, 'plans', `${name}-consistent-silhouetteOnly.json`), `${JSON.stringify(replyFromPlan(toPlan(input, roots, iPivots, free.placements, prov, 'sil')), null, 1)}\n`);
      await writeFile(resolve(out, 'plans', `${name}-ground-truth.json`), `${JSON.stringify(replyFromPlan(truth), null, 1)}\n`);
    }
  }
}
await writeFile(resolve(out, 'consistent-results.json'), `${JSON.stringify({ generatedBy: 'scripts/benchmark/v4-consistent.ts', note: 'Category D/D: ground truth is a hand-authored plan, inputs are synthetic. Not Meta output, not a real object.', results }, null, 2)}\n`);
