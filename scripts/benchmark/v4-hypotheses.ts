// P1 on the Phase B cases (category D/D): contacts are HYPOTHESES until a person confirms them.
// default -> refused NO_STRUCTURAL_SUPPORT with the hypotheses listed; all confirmed (a person's decision, simulated here explicitly) -> proposal; partly confirmed -> proposal that only keeps those joints.
//   npx tsx scripts/benchmark/v4-hypotheses.ts reports/fidelity-v4/hierarchical
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Box3, Mesh, Vector3 } from 'three';
import { applySpatialOperationV2, validateSpatialPlanV2, type SpatialPlanV2 } from '../../src/universal-spatial/contracts-v2';
import { compileSpatialPlanV2 } from '../../src/universal-spatial/geometry-compiler-v2';
import { reconstructStructure } from '../../src/universal-spatial/reconstruction/engine';
import { renderedEvidence } from '../../src/universal-spatial/reconstruction/evidence';
import { makeView, maskIoU, rasterise, viewDirections, type Tri } from '../../src/universal-spatial/reconstruction/silhouette';

const out = resolve(process.argv[2] ?? 'reports/fidelity-v4/hierarchical');
const tris = (plan: SpatialPlanV2) => { const c = compileSpatialPlanV2(plan); c.root.updateMatrixWorld(true); const t: Tri[] = []; c.root.traverse((o) => { if (!(o instanceof Mesh)) return; const pos = o.geometry.getAttribute('position'), idx = o.geometry.index, n = idx ? idx.count : pos.count, v = (i: number) => new Vector3().fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld); for (let i = 0; i + 2 < n; i += 3) t.push([v(i), v(i + 1), v(i + 2)]); }); return t; };
const results: Record<string, unknown> = {};
for (const name of ['lungs-like', 'microscope-like']) {
  const plans = 'reports/fidelity-v4/benchmark/plans', truth = validateSpatialPlanV2(JSON.parse(await readFile(`${plans}/${name}-ground-truth.json`, 'utf8')).plan), input = validateSpatialPlanV2(JSON.parse(await readFile(`${plans}/${name}-consistent-input.json`, 'utf8')).plan);
  const evidence = renderedEvidence(truth, 6, 128), gt = tris(truth), b = new Box3(); for (const t of gt) for (const p of t) b.expandByPoint(p);
  const held = viewDirections(12).map((d) => makeView(d.clone().applyAxisAngle(new Vector3(0, 1, 0), 0.31).applyAxisAngle(new Vector3(1, 0, 0), 0.2), b.getCenter(new Vector3()), b.getSize(new Vector3()).length() / 2 * 1.05, 128)), heldGt = held.map((v) => rasterise(gt, v));
  const iou = (plan: SpatialPlanV2) => { const t = tris(plan); return +(held.reduce((s, v, i) => s + maskIoU(rasterise(t, v), heldGt[i]!), 0) / held.length).toFixed(3); };
  const row: Record<string, unknown> = { category: 'D/D: synthetic input (joints kept), hand-authored ground truth', inputHeldOutIou: iou(input) };
  const describe = (o: ReturnType<typeof reconstructStructure>) => { const r: Record<string, unknown> = { status: o.status, refusals: o.refusals, relations: o.relationSummary, enforcedJoints: o.relations.filter((x) => x.enforced).length, hypothesesOpen: o.hypotheses.length }; if (o.proposal) { let next = input; for (const op of o.proposal.operations) next = applySpatialOperationV2(next, op, { origin: 'inferred', evidence: o.proposal.evidence }); r.heldOutIou = iou(next); r.checks = o.checks; r.changed = o.proposal.changed.length; } return r; };
  const first = reconstructStructure(input, evidence), ids = first.hypotheses.map((h) => h.id);
  row.default = describe(first); row.allConfirmed = describe(reconstructStructure(input, evidence, { confirmed: new Set(ids) })); row.halfConfirmed = describe(reconstructStructure(input, evidence, { confirmed: new Set(ids.slice(0, Math.ceil(ids.length / 2))) }));
  results[name] = row; console.log(name, JSON.stringify({ input: row.inputHeldOutIou, def: (row.default as { status: string }).status, all: (row.allConfirmed as { heldOutIou?: number }).heldOutIou, half: (row.halfConfirmed as { heldOutIou?: number; status: string }).heldOutIou ?? (row.halfConfirmed as { status: string; refusals: Array<{ code: string }> }).refusals.map((r) => r.code) }));
}
await writeFile(resolve(out, 'hypotheses-results.json'), `${JSON.stringify({ generatedBy: 'scripts/benchmark/v4-hypotheses.ts', results }, null, 2)}\n`);
