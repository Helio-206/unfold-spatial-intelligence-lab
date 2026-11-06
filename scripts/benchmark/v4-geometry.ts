// Phase D: structural GEOMETRY recovery. Four experiments, each with its evidence category stated; nothing crosses categories.
//   R  rotation in the local frame      (artificial: lungs, microscope = D/D;  Meta plans used as geometry basis = C+D mechanics)
//   S  primitive alternatives           (Lantern, AntiqueCamera: A+D with an independent CC0 mesh as evidence; artificial D/D on microscope and lungs)
//   M  missing-component flags          (leave-one-leaf-out on all four objects; Meta plans as basis = C+D)
//   X  what transforms cannot fix       (the saved Meta plans, from the plans alone, no evidence)
//   npx tsx scripts/benchmark/v4-geometry.ts <dir with Lantern.glb AntiqueCamera.glb> reports/fidelity-v4/geometry
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Box3, Euler, Mesh, Quaternion, Vector3 } from 'three';
import { applySpatialOperationV2, validateSpatialPlanV2, type SpatialPlanV2 } from '../../src/universal-spatial/contracts-v2';
import { compileSpatialPlanV2 } from '../../src/universal-spatial/geometry-compiler-v2';
import { diagnoseContradictions } from '../../src/universal-spatial/reconstruction/diagnose';
import { readParts, reconstructStructure, type EvidenceView } from '../../src/universal-spatial/reconstruction/engine';
import { evidenceToJSON, renderedEvidence } from '../../src/universal-spatial/reconstruction/evidence';
import { readGlbParts } from '../../src/universal-spatial/reconstruction/glb-geometry';
import { proposeShapeAlternatives } from '../../src/universal-spatial/reconstruction/shapes';
import { makeView, maskIoU, rasterise, viewDirections, type Tri } from '../../src/universal-spatial/reconstruction/silhouette';
import { findUnexplained } from '../../src/universal-spatial/reconstruction/unexplained';
import { lanternPlan, cameraPlan } from './v4-benchmark-plans';
import { createHash } from 'node:crypto';

const [assetDir, out] = [resolve(process.argv[2] ?? '.'), resolve(process.argv[3] ?? 'reports/fidelity-v4/geometry')];
await mkdir(resolve(out, 'plans'), { recursive: true }); await mkdir(resolve(out, 'evidence'), { recursive: true });
const round = (n: number, d = 3) => +n.toFixed(d), clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const trisOf = (plan: SpatialPlanV2) => { const c = compileSpatialPlanV2(plan); c.root.updateMatrixWorld(true); const t: Tri[] = [], per = new Map<string, Tri[]>(); c.root.traverse((o) => { if (!(o instanceof Mesh) || typeof o.userData.spatialEntityId !== 'string') return; const id = o.userData.spatialEntityId as string, pos = o.geometry.getAttribute('position'), idx = o.geometry.index, n = idx ? idx.count : pos.count, v = (i: number) => new Vector3().fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld), l = per.get(id) ?? []; for (let i = 0; i + 2 < n; i += 3) { const tri: Tri = [v(i), v(i + 1), v(i + 2)]; t.push(tri); l.push(tri); } per.set(id, l); }); return { all: t, per }; };
const boxOf = (t: Tri[]) => { const b = new Box3(); for (const x of t) for (const p of x) b.expandByPoint(p); return b; };
const heldViews = (tris: Tri[]) => { const b = boxOf(tris); return viewDirections(12).map((d) => makeView(d.clone().applyAxisAngle(new Vector3(0, 1, 0), 0.31).applyAxisAngle(new Vector3(1, 0, 0), 0.2), b.getCenter(new Vector3()), b.getSize(new Vector3()).length() / 2 * 1.05, 128)); };
const heldIou = (plan: SpatialPlanV2, held: ReturnType<typeof heldViews>, heldGt: Uint8Array[]) => { const t = trisOf(plan).all; return round(held.reduce((s, v, i) => s + maskIoU(rasterise(t, v), heldGt[i]!), 0) / held.length); };
const load = async (file: string) => JSON.parse(await readFile(resolve(file), 'utf8'));
const results: Record<string, unknown> = { generatedBy: 'scripts/benchmark/v4-geometry.ts' };

// ------------------------------------------------------------------------------------------------ R rotation
const ROT: Array<{ name: string; file: string; category: string; parts: Array<[string, number]>; confirm?: boolean; override?: boolean }> = [
  { name: 'lungs-like', file: 'reports/fidelity-v4/benchmark/plans/lungs-like-ground-truth.json', category: 'D/D artificial (hand-authored plan, synthetic rotation errors)', parts: [['trachea', 0.5], ['lung-left', 0.45]], confirm: true },
  { name: 'microscope-like', file: 'reports/fidelity-v4/benchmark/plans/microscope-like-ground-truth.json', category: 'D/D artificial (hand-authored plan, synthetic rotation errors)', parts: [['arm', 0.5], ['stage', -0.5]], confirm: true },
  { name: 'excavator', file: 'reports/universal-spatial-v2/evidence/live-image-plan.json', category: 'C+D mechanics (saved Meta plan as the geometry basis; synthetic rotation errors; NO ground truth for the original photograph)', parts: [['boom', 0.5], ['bucket', -0.5]], override: true },
  { name: 'harp', file: 'reports/universal-spatial-v2/evidence/blind-harp-plan.json', category: 'C+D mechanics (saved Meta plan as the geometry basis; synthetic rotation errors; NO ground truth for the original photograph)', parts: [['harp-pillar', 0.5], ['harp-base', -0.4]], override: true },
];
const rotation: Record<string, unknown> = {};
for (const c of ROT) {
  const reply = await load(c.file), truth = validateSpatialPlanV2(reply.plan), inputJson = clone(reply.plan);
  for (const [id, dz] of c.parts) { const comp = inputJson.components.find((k: { id: string }) => k.id === id); comp.transform.rotationRad[2] += dz; }
  const input = validateSpatialPlanV2(inputJson), tt = trisOf(truth).all, held = heldViews(tt), heldGt = held.map((v) => rasterise(tt, v)), evidence = renderedEvidence(truth, 6, 128);
  const first = reconstructStructure(input, evidence, c.override ? { allowContradicted: true } : {}), confirmed = c.confirm ? new Set(first.hypotheses.map((h) => h.id)) : undefined;
  const opts = { ...(c.override ? { allowContradicted: true } : {}), ...(confirmed ? { confirmed } : {}) };
  const rows: Record<string, unknown> = { category: c.category, perturbed: c.parts.map(([id, d]) => `${id} local rotZ ${d > 0 ? '+' : ''}${d} rad`), inputHeldOutIou: heldIou(input, held, heldGt) };
  const plans: Record<string, SpatialPlanV2> = { input };
  for (const [label, rot] of [['translationScaleOnly', false], ['withRotation', true]] as const) {
    const m0 = process.memoryUsage().rss, t0 = performance.now(), o = reconstructStructure(input, evidence, { ...opts, rotation: rot }), ms = performance.now() - t0;
    const row: Record<string, unknown> = { status: o.status, refusals: o.refusals.map((r) => `${r.code}`), ms: Math.round(ms), evaluations: o.metrics.evaluations, rssDeltaMB: round((process.memoryUsage().rss - m0) / 1048576, 1), unresolved: o.unresolved.map((u) => u.id) };
    if (o.proposal) {
      let next = input; for (const op of o.proposal.operations) next = applySpatialOperationV2(next, op, { origin: 'inferred', evidence: o.proposal.evidence });
      const err = (plan: SpatialPlanV2) => c.parts.map(([id]) => { const a = plan.components.find((k) => k.id === id)!.transform.rotationRad, b = truth.components.find((k) => k.id === id)!.transform.rotationRad; return round(new Quaternion().setFromEuler(new Euler(...(a as [number, number, number]))).angleTo(new Quaternion().setFromEuler(new Euler(...(b as [number, number, number])))), 3); });
      Object.assign(row, { heldOutIou: heldIou(next, held, heldGt), fitIou: [round(o.proposal.fitIouBefore), round(o.proposal.fitIouAfter)], changed: o.proposal.changed, rotationErrorRadPerturbedParts: { before: err(input), after: err(next) }, jointResidualMax: o.checks.jointResidualMax, worldConsistencyAfterMax: o.checks.worldConsistencyAfterMax, idsPreserved: o.checks.idsPreserved, hierarchyPreserved: o.checks.hierarchyPreserved, enforcedJoints: o.relations.filter((r) => r.enforced).length, hypothesesLeftOpen: o.hypotheses.length });
      plans[label] = next;
    }
    rows[label] = row;
  }
  for (const [k, p] of Object.entries(plans)) await writeFile(resolve(out, 'plans', `${c.name}-rot-${k}.json`), `${JSON.stringify({ ...reply, plan: p }, null, 1)}\n`);
  rotation[c.name] = rows; const r = rows as { inputHeldOutIou: number; translationScaleOnly: { heldOutIou?: number; status: string; refusals: string[] }; withRotation: { heldOutIou?: number; status: string; refusals: string[] } };
  console.log('R', c.name, 'input', r.inputHeldOutIou, '| no rotation', r.translationScaleOnly.heldOutIou ?? r.translationScaleOnly.refusals.join(','), '| with rotation', r.withRotation.heldOutIou ?? r.withRotation.refusals.join(','));
}
results.rotation = rotation;

// ------------------------------------------------------------------------------------------------ S primitives
const shapesOut: Record<string, unknown> = {};
const degrade = (plan: SpatialPlanV2, swaps: Record<string, (c: SpatialPlanV2['components'][number]) => object>) => validateSpatialPlanV2({ ...plan, components: plan.components.map((c) => (swaps[c.id] ? { ...c, geometry: swaps[c.id]!(c) } : c)) });
const boxLike = (c: { geometry: { type: string; key?: string; material?: unknown } }, dims: number[]) => ({ type: 'shape', key: (c.geometry as { key: string }).key, operator: 'box', parameters: { dimensions: dims }, transform: { position: [0, 0, 0], rotationRad: [0, 0, 0], scale: [1, 1, 1] }, repeat: null, material: (c.geometry as { material: unknown }).material });
{ // A + D: independent CC0 meshes as evidence
  for (const [name, file, make, swaps] of [
    ['Lantern', 'Lantern.glb', lanternPlan, { pole: (c: SpatialPlanV2['components'][number]) => boxLike(c as never, [1.6, 25.4, 1.6]), lantern: (c: SpatialPlanV2['components'][number]) => boxLike(c as never, [2.6, 5.6, 2.6]) }],
    ['AntiqueCamera', 'AntiqueCamera.glb', cameraPlan, { head: (c: SpatialPlanV2['components'][number]) => boxLike(c as never, [0.9, 0.9, 0.9]) }],
  ] as const) {
    const bytes = new Uint8Array(await readFile(resolve(assetDir, file))), sha = createHash('sha256').update(bytes).digest('hex'), gt = readGlbParts(bytes).flatMap((p) => p.tris), box = boxOf(gt), centre = box.getCenter(new Vector3()), half = box.getSize(new Vector3()).length() / 2 * 1.05;
    const evidence: EvidenceView[] = viewDirections(6).map((d, i) => { const view = makeView(d, centre, half, 128); return { view, mask: rasterise(gt, view), calibrated: true, source: 'rendered' as const, label: `${name}-${i}` }; });
    const held = heldViews(gt), heldGt = held.map((v) => rasterise(gt, v)), original = make(sha), input = degrade(original, swaps as never);
    await writeFile(resolve(out, 'evidence', `${name}-6views.json`), `${JSON.stringify(evidenceToJSON(evidence, `Silhouettes of the CC0-1.0 Khronos ${name} (sha256 ${sha.slice(0, 12)}), 6 orthographic views; derived data, 128x128`))}\n`);
    const t0 = performance.now(), found = proposeShapeAlternatives(input, evidence), ms = performance.now() - t0; let next = input; const applied: string[] = [];
    for (const f of found) if (f.proposal) { next = applySpatialOperationV2(next, f.proposal.operation, { origin: 'inferred', evidence: f.proposal.evidence }); applied.push(`${f.componentId}: ${f.current} -> ${f.proposal.to}${f.proposal.axis ?? ''}`); }
    const tri = (p: SpatialPlanV2) => trisOf(p).all.length;
    shapesOut[name] = { category: 'A (independent CC0 mesh as evidence) + D (hand-built plan, primitives degraded by us)', degradedComponents: Object.keys(swaps), originalPrimitiveHeldOutIou: heldIou(original, held, heldGt), degradedHeldOutIou: heldIou(input, held, heldGt), afterProposalsHeldOutIou: heldIou(next, held, heldGt), proposals: applied, triangles: { degraded: tri(input), after: tri(next) }, ms: Math.round(ms), table: found.map((f) => ({ id: f.componentId, current: f.current, fit: round(f.currentFitIou), heldOut: f.currentHeldOutIou === null ? null : round(f.currentHeldOutIou), best: f.candidates.length ? f.candidates.map((c) => `${c.operator}${c.axis ?? ''} ${round(c.fitIou)}`).join(' | ') : '', proposed: f.proposal ? `${f.proposal.to}${f.proposal.axis ?? ''}` : null, reason: f.reason })) };
    await writeFile(resolve(out, 'plans', `${name}-shape-input.json`), `${JSON.stringify(replyOf(input), null, 1)}\n`); await writeFile(resolve(out, 'plans', `${name}-shape-proposed.json`), `${JSON.stringify(replyOf(next), null, 1)}\n`);
    if (name === 'Lantern') { // A + D rotation: the crossbar is tilted in the plan; the evidence is the independent CC0 mesh
      const tilted = clone(original); tilted.components.find((k: { id: string }) => k.id === 'arm').transform.rotationRad[2] += 0.4; const tiltedPlan = validateSpatialPlanV2(tilted);
      const probe = reconstructStructure(tiltedPlan, evidence), confirm = new Set(probe.hypotheses.map((h) => h.id)), rot: Record<string, unknown> = { category: 'A (independent CC0 mesh as evidence) + D (hand-built plan, crossbar tilted +0.4 rad by us; relations confirmed in the script, simulating a person)', referenceCrossbarRotZ: original.components.find((k) => k.id === 'arm')!.transform.rotationRad[2], inputCrossbarRotZ: 0.4, inputHeldOutIou: heldIou(tiltedPlan, held, heldGt), originalPlanHeldOutIou: heldIou(original, held, heldGt) };
      const plans: Record<string, SpatialPlanV2> = { input: tiltedPlan };
      for (const [label, on] of [['translationScaleOnly', false], ['withRotation', true]] as const) {
        const o = reconstructStructure(tiltedPlan, evidence, { rotation: on, confirmed: confirm }), row: Record<string, unknown> = { status: o.status, refusals: o.refusals.map((r) => r.code), evaluations: o.metrics.evaluations, ms: Math.round(o.metrics.ms) };
        if (o.proposal) { let n2 = tiltedPlan; for (const op of o.proposal.operations) n2 = applySpatialOperationV2(n2, op, { origin: 'inferred', evidence: o.proposal.evidence }); Object.assign(row, { heldOutIou: heldIou(n2, held, heldGt), fitIou: [round(o.proposal.fitIouBefore), round(o.proposal.fitIouAfter)], crossbarRotZ: n2.components.find((k) => k.id === 'arm')!.transform.rotationRad[2], jointResidualMax: o.checks.jointResidualMax, changed: o.proposal.changed, hierarchyPreserved: o.checks.hierarchyPreserved, idsPreserved: o.checks.idsPreserved }); plans[label] = n2; }
        rot[label] = row;
      }
      for (const [k, p] of Object.entries(plans)) await writeFile(resolve(out, 'plans', `Lantern-rot-${k}.json`), `${JSON.stringify(replyOf(p), null, 1)}\n`);
      (results as Record<string, unknown>).rotationCC0 = rot; console.log('RA Lantern', JSON.stringify({ input: rot.inputHeldOutIou, noRot: (rot.translationScaleOnly as { heldOutIou?: number; refusals: string[] }).heldOutIou ?? (rot.translationScaleOnly as { refusals: string[] }).refusals, withRot: (rot.withRotation as { heldOutIou?: number; refusals: string[] }).heldOutIou ?? (rot.withRotation as { refusals: string[] }).refusals, crossbar: (rot.withRotation as { crossbarRotZ?: number }).crossbarRotZ }));
    }
    const s = shapesOut[name] as { degradedHeldOutIou: number; afterProposalsHeldOutIou: number; proposals: string[] }; console.log('S', name, 'held-out', s.degradedHeldOutIou, '->', s.afterProposalsHeldOutIou, s.proposals.join('; '));
  }
}
function replyOf(plan: SpatialPlanV2) { return { contract: 'unfold.spatial-plan.v2', sessionId: '00000000-0000-4000-8000-000000000000', revision: 0, plan, sceneSummary: { componentCount: plan.components.length, geometryNodeCount: plan.components.length, operators: [...new Set(plan.components.flatMap((c) => (c.geometry.type === 'shape' ? [c.geometry.operator] : [])))], constraintReady: false }, constraintReport: { ok: true, results: [] }, constructionEvents: [], meta: { note: 'local benchmark plan; not Meta output' }, limitations: [] }; }
results.shapes = shapesOut;

// ------------------------------------------------------------------------------------------------ M missing components (flags only)
const MISS = [
  { name: 'lungs-like', file: 'reports/fidelity-v4/benchmark/plans/lungs-like-ground-truth.json', category: 'D/D artificial' },
  { name: 'microscope-like', file: 'reports/fidelity-v4/benchmark/plans/microscope-like-ground-truth.json', category: 'D/D artificial' },
  { name: 'excavator', file: 'reports/universal-spatial-v2/evidence/live-image-plan.json', category: 'C+D mechanics (saved Meta plan as the basis)' },
  { name: 'harp', file: 'reports/universal-spatial-v2/evidence/blind-harp-plan.json', category: 'C+D mechanics (saved Meta plan as the basis)' },
];
const missing: Record<string, unknown> = {};
for (const c of MISS) {
  const truth = validateSpatialPlanV2((await load(c.file)).plan), evidence = renderedEvidence(truth, 6, 128), tt = trisOf(truth), parents = new Set(truth.components.map((k) => k.parentId)), leaves = truth.components.filter((k) => !parents.has(k.id));
  const run = (plan: SpatialPlanV2) => { const read = readParts(plan)!; return findUnexplained(evidence, read.parts.map((p) => ({ id: p.id, tris: p.tris }))); };
  const full = run(truth), rows: Array<Record<string, unknown>> = [];
  for (const leaf of leaves) {
    const plan = validateSpatialPlanV2({ ...truth, components: truth.components.filter((k) => k.id !== leaf.id), relations: truth.relations.filter((r) => r.fromId !== leaf.id && r.toId !== leaf.id), constraints: truth.constraints.filter((k) => !k.componentIds.includes(leaf.id)) }), rep = run(plan), b = boxOf(tt.per.get(leaf.id)!), diagLen = b.getSize(new Vector3()).length(), grown = b.clone().expandByScalar(0.25 * diagLen);
    const hits = rep.candidates.map((k) => grown.containsPoint(k.centre)), rank = hits.indexOf(true);
    rows.push({ removed: leaf.id, sizePctOfSpan: round(100 * diagLen / Math.max(...boxOf(tt.all).getSize(new Vector3()).toArray()), 1), candidates: rep.candidates.length, hitRank: rank < 0 ? null : rank + 1, top: rep.candidates[0] ? { supportViews: rep.candidates[0].supportViews.length, areaPct: round(rep.candidates[0].meanAreaPct, 2), confidence: rep.candidates[0].confidence, nearest: rep.candidates[0].nearestParts.map((n) => n.id).slice(0, 2) } : null });
  }
  const hit1 = rows.filter((r) => r.hitRank === 1).length, hitAny = rows.filter((r) => r.hitRank !== null).length;
  missing[c.name] = { category: c.category, leavesTested: leaves.length, recallTop1: `${hit1}/${leaves.length}`, recallAny: `${hitAny}/${leaves.length}`, falseCandidatesOnCompletePlan: full.candidates.length, rows };
  console.log('M', c.name, 'top1', hit1, 'any', hitAny, 'of', leaves.length, 'candidates on complete plan', full.candidates.length);
}
results.missing = missing;

// ------------------------------------------------------------------------------------------------ X what transforms cannot fix (plans only)
const diag: Record<string, unknown> = {};
for (const [name, file] of [['excavator', 'reports/universal-spatial-v2/evidence/live-image-plan.json'], ['harp', 'reports/universal-spatial-v2/evidence/blind-harp-plan.json']] as const) {
  const plan = validateSpatialPlanV2((await load(file)).plan), d = diagnoseContradictions(plan)!;
  diag[name] = { category: 'C: saved Meta plan, analysed from the plan alone (no evidence, no ground truth)', components: plan.components.length, declaredContradicted: d.diagnoses.length, closableByTransform: d.diagnoses.filter((x) => x.verdict === 'closable_by_transform').length, notClosableByTransform: d.diagnoses.filter((x) => x.verdict === 'not_closable_by_transform').length, partsNeedingMoreThanTransforms: d.notCorrectableByTransforms, partsCorrectableByTransform: d.closable, diagnoses: d.diagnoses };
  const x = diag[name] as { closableByTransform: number; notClosableByTransform: number; partsNeedingMoreThanTransforms: string[] }; console.log('X', name, 'closable', x.closableByTransform, 'not', x.notClosableByTransform, x.partsNeedingMoreThanTransforms.join(','));
}
results.transformsCannotFix = diag;
await writeFile(resolve(out, 'geometry-results.json'), `${JSON.stringify(results, null, 2)}\n`);
