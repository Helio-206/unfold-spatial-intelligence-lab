// Phase C on the REAL hierarchical plans saved from Meta calls (excavator, harp; old repair step).
// Category C has no ground truth for the original photograph, so NOTHING here measures fidelity to it. Three separate things are reported:
//   1  TRAVERSAL   does the engine read the real hierarchy correctly (frames, depth, world == compiled scene, relation status)? What does it do by default (refuse, with reasons)?
//   2  MECHANICS   category C+D: ground truth = the saved plan itself; input = the same plan with SEEDED, hierarchy-consistent local perturbations; evidence = rendered views of the
//                  ground truth. Compares V3 original (input), V4 non-hierarchical (Phase B engine, roots only) and V4 hierarchical, on what ends up in the plan (compiled), not on what the
//                  solver believes. It tests whether the solver can operate on a real hierarchy without corrupting it. It says nothing about the real object.
//   3  UNRESOLVED  parts the evidence cannot support are listed, not guessed.
//   npx tsx scripts/benchmark/v4-hierarchical.ts reports/fidelity-v4/hierarchical
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Box3, Matrix4, Mesh, Vector3, type Object3D } from 'three';
import { applySpatialOperationV2, validateSpatialPlanV2, type SpatialPlanV2 } from '../../src/universal-spatial/contracts-v2';
import { compileSpatialPlanV2 } from '../../src/universal-spatial/geometry-compiler-v2';
import { reconstructStructure, type EvidenceView } from '../../src/universal-spatial/reconstruction/engine';
import { fitPlacement } from '../../src/universal-spatial/reconstruction/fit';
import { maxDepth, validateHierarchy } from '../../src/universal-spatial/reconstruction/hierarchy';
import { makeView, maskIoU, rasterise, viewDirections, type Tri } from '../../src/universal-spatial/reconstruction/silhouette';

const out = resolve(process.argv[2] ?? 'reports/fidelity-v4/hierarchical'); await mkdir(resolve(out, 'plans'), { recursive: true });
const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const round = (n: number, d = 3) => +n.toFixed(d);
const scene = (plan: SpatialPlanV2) => { const c = compileSpatialPlanV2(plan); c.root.updateMatrixWorld(true); const tris = new Map<string, Tri[]>(), worlds = new Map<string, Matrix4>(); c.root.traverse((o: Object3D) => { if (o.userData.spatialComponentRoot) worlds.set(o.userData.spatialEntityId as string, o.matrixWorld.clone()); if (!(o instanceof Mesh) || typeof o.userData.spatialEntityId !== 'string') return; const id = o.userData.spatialEntityId as string, pos = o.geometry.getAttribute('position'), idx = o.geometry.index, n = idx ? idx.count : pos.count, l = tris.get(id) ?? []; const v = (i: number) => new Vector3().fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld); for (let i = 0; i + 2 < n; i += 3) l.push([v(i), v(i + 1), v(i + 2)]); tris.set(id, l); }); return { tris, worlds, all: [...tris.values()].flat() }; };
const boxOf = (t: Tri[]) => { const b = new Box3(); for (const x of t) for (const p of x) b.expandByPoint(p); return b; };

const CASES = [
  { name: 'excavator', file: 'reports/universal-spatial-v2/evidence/live-image-plan.json' },
  { name: 'harp', file: 'reports/universal-spatial-v2/evidence/blind-harp-plan.json' },
];
const results: Record<string, unknown> = {};
for (const c of CASES) {
  const reply = JSON.parse(await readFile(resolve(c.file), 'utf8')), truth = validateSpatialPlanV2(reply.plan), gt = scene(truth), box = boxOf(gt.all), centre = box.getCenter(new Vector3()), half = box.getSize(new Vector3()).length() / 2 * 1.05, span = Math.max(...box.getSize(new Vector3()).toArray());
  const report: Record<string, unknown> = { origin: 'C: plan saved from a real Meta call (old repair step). No ground truth for the original photograph exists.' };

  // ---- 1 traversal on the plan as it is
  const h = validateHierarchy(truth), compiled = gt.worlds; let consistency = 0; for (const id of h.order) consistency = Math.max(consistency, h.frames.get(id)!.world.elements.reduce((m, v, i) => Math.max(m, Math.abs(v - compiled.get(id)!.elements[i]!)), 0));
  const noEvidence = reconstructStructure(truth, []), views = viewDirections(6).map((d) => makeView(d, centre, half, 128)), evidence: EvidenceView[] = views.map((view, i) => ({ view, mask: rasterise(gt.all, view), calibrated: true, source: 'rendered', label: `r${i}` }));
  const asIs = reconstructStructure(truth, evidence);
  report.traversal = {
    components: truth.components.length, depth: maxDepth(h), levels: h.order.map((id) => `${'  '.repeat(h.frames.get(id)!.depth)}${id}`), hierarchyOk: h.ok, issues: h.issues, worldVsCompiledMaxDiff: consistency,
    relations: asIs.relationSummary, contradicted: asIs.relations.filter((r) => r.status === 'declared_contradicted').map((r) => ({ pair: `${r.a}~${r.b}`, gapPctSpan: round(100 * r.gap / span, 2), declared: r.declaredKind })), hypotheses: asIs.hypotheses.map((r) => `${r.a}~${r.b}`),
    defaultNoEvidence: noEvidence.refusals, defaultWithSyntheticEvidence: asIs.refusals,
  };

  // ---- 2 mechanics: hierarchy-consistent local perturbation of the saved plan
  const r = rng(c.name.length * 97 + 11), inputJson = structuredClone(reply.plan);
  for (const comp of inputJson.components) { const s = 0.8 + r() * 0.45, parentScale = 1; comp.transform.scale = comp.transform.scale.map((x: number) => x * s); comp.transform.position = comp.transform.position.map((x: number) => x + (r() - 0.5) * 0.08 * span / parentScale); }
  const input = validateSpatialPlanV2(inputJson), inScene = scene(input);
  const held = viewDirections(12).map((d) => makeView(d.clone().applyAxisAngle(new Vector3(0, 1, 0), 0.31).applyAxisAngle(new Vector3(1, 0, 0), 0.2), centre, half, 128)), heldGt = held.map((v) => rasterise(gt.all, v));
  const evalPlan = (plan: SpatialPlanV2) => { const s = scene(plan), masks = held.map((v) => rasterise(s.all, v)), iou = masks.reduce((a, m, i) => a + maskIoU(m, heldGt[i]!), 0) / masks.length;
    const perComponent = truth.components.map((k) => { const a = boxOf(gt.tris.get(k.id)!).getCenter(new Vector3()), b = boxOf(s.tris.get(k.id)!).getCenter(new Vector3()); return { id: k.id, centreErrPctSpan: round(100 * a.distanceTo(b) / span, 2) }; });
    const localErr = truth.components.map((k) => { const m = plan.components.find((x) => x.id === k.id)!; return { id: k.id, localScaleErrLog: round(Math.abs(Math.log(m.transform.scale[0]! / k.transform.scale[0]!)), 3) }; });
    return { heldOutIou: round(iou), meanCentreErrPctSpan: round(perComponent.reduce((a, p) => a + p.centreErrPctSpan, 0) / perComponent.length, 2), meanLocalScaleErrLog: round(localErr.reduce((a, p) => a + p.localScaleErrLog, 0) / localErr.length, 3), perComponent, idsPreserved: JSON.stringify(plan.components.map((k) => k.id)) === JSON.stringify(truth.components.map((k) => k.id)), parentsPreserved: JSON.stringify(plan.components.map((k) => k.parentId)) === JSON.stringify(truth.components.map((k) => k.parentId)), hierarchyOk: validateHierarchy(plan).ok }; };
  const mech: Record<string, unknown> = { note: 'ground truth = the saved plan; input = seeded local scale x0.80-1.25 and local shift up to +-4 % of the span on EVERY component; evidence = 6 rendered views; held-out = 12 other views. Mechanics only.', v3Original: evalPlan(input) };

  // V4 non-hierarchical (Phase B engine): fits only parentless components, then writes the result as that component's transform. What matters is what the plan then contains.
  const roots = input.components.filter((k) => k.parentId === null), fitViews = views;
  const parts = roots.map((k) => { const t = inScene.tris.get(k.id)!, b = boxOf(t); return { id: k.id, origin: b.getCenter(new Vector3()), tris: t }; });
  const free = fitPlacement(parts, fitViews, evidence.map((e) => e.mask), { maxShift: 0.3 * span }); let nonHier = input;
  for (const k of roots) { const pl = free.placements.get(k.id); if (!pl) continue; const piv = parts.find((p) => p.id === k.id)!.origin, p0 = new Vector3(...k.transform.position), pos = p0.clone().addScaledVector(piv.clone().sub(p0), 1 - pl.s).add(pl.d); nonHier = applySpatialOperationV2(nonHier, { contract: 'unfold.spatial-operation.v2', operationId: `v4b-${k.id}`.slice(0, 80), kind: 'set-transform', componentId: k.id, nodeKey: null, value: { ...k.transform, position: pos.toArray() as [number, number, number], scale: k.transform.scale.map((x) => x * pl.s) as [number, number, number] } }, { origin: 'inferred', evidence: 'Phase B non-hierarchical fit' }); }
  mech.v4NonHierarchical = { ...evalPlan(nonHier), fittedComponents: roots.map((k) => k.id), note: 'only parentless components were fitted; their new transform also moves and scales every descendant, which the fit never saw', fitIouReportedBySolver: round(free.iouAfter) };

  // V4 hierarchical: default (strict) and with an explicit human override of contradicted declared relations
  for (const [label, options] of [['v4HierarchicalDefault', {}], ['v4HierarchicalOverride', { allowContradicted: true }]] as const) {
    const t0 = performance.now(), o = reconstructStructure(input, evidence, options), ms = performance.now() - t0;
    const row: Record<string, unknown> = { status: o.status, refusals: o.refusals, ms: Math.round(ms), relations: o.relationSummary, unresolved: o.unresolved, hypotheses: o.hypotheses.length };
    if (o.proposal) { let next = input; for (const op of o.proposal.operations) next = applySpatialOperationV2(next, op, { origin: 'inferred', evidence: o.proposal.evidence }); Object.assign(row, evalPlan(next), { changed: o.proposal.changed, fitIou: [round(o.proposal.fitIouBefore), round(o.proposal.fitIouAfter)], leftOutViews: o.proposal.heldOut ? [round(o.proposal.heldOut.before), round(o.proposal.heldOut.after)] : null, checks: o.checks, evaluations: o.metrics.evaluations }); await writeFile(resolve(out, 'plans', `${c.name}-v4-hierarchical.json`), `${JSON.stringify({ ...reply, plan: next }, null, 1)}\n`); }
    else Object.assign(row, { checks: o.checks });
    mech[label] = row;
  }
  await writeFile(resolve(out, 'plans', `${c.name}-input.json`), `${JSON.stringify({ ...reply, plan: input }, null, 1)}\n`); await writeFile(resolve(out, 'plans', `${c.name}-v4-nonhierarchical.json`), `${JSON.stringify({ ...reply, plan: nonHier }, null, 1)}\n`); await writeFile(resolve(out, 'plans', `${c.name}-saved.json`), `${JSON.stringify(reply, null, 1)}\n`);
  report.mechanics = mech; results[c.name] = report;
  const m = mech as Record<string, { heldOutIou?: number; status?: string; refusals?: unknown; meanCentreErrPctSpan?: number }>;
  console.log(c.name, 'depth', maxDepth(h), 'worldDiff', consistency.toExponential(1), JSON.stringify(asIs.relationSummary), 'default:', asIs.refusals.map((x) => x.code).join(','), '| held-out IoU V3', m.v3Original!.heldOutIou, 'V4 nonhier', m.v4NonHierarchical!.heldOutIou, 'V4 hier default', m.v4HierarchicalDefault!.status, 'override', m.v4HierarchicalOverride!.status, m.v4HierarchicalOverride!.heldOutIou ?? JSON.stringify(m.v4HierarchicalOverride!.refusals));
}
await writeFile(resolve(out, 'hierarchical-results.json'), `${JSON.stringify({ generatedBy: 'scripts/benchmark/v4-hierarchical.ts', results }, null, 2)}\n`);
