// Geometry metrics for Fidelity V3, computed from the meshes themselves (no GPU, no lighting, no screenshots): silhouette preservation, junction continuity,
// rim artefacts, sliver triangles, build cost. Three variants of the same plan: V2, V3 with whole-triangle rim discard (the earlier behaviour, as a baseline) and V3 final.
//   npx tsx scripts/benchmark/fidelity-metrics.ts reports/fidelity-v3
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Matrix3, Matrix4, Mesh, Vector3, type Object3D } from 'three';
import { validateSpatialPlanV2, type SpatialPlanV2 } from '../../src/universal-spatial/contracts-v2';
import { compileSpatialPlanV2 } from '../../src/universal-spatial/geometry-compiler-v2';
import { compileWithRouter } from '../../src/universal-spatial/fidelity/router';
import { runContinuousJob } from '../../src/universal-spatial/fidelity/continuous-job';
import { ContinuousService, createInlineWorker } from '../../src/universal-spatial/fidelity/continuous-service';
import { implicitShapesOf, unionFieldCulled } from '../../src/universal-spatial/fidelity/sdf';

const out = resolve(process.argv[2] ?? 'reports/fidelity-v3');
const CASES: Array<{ name: string; file: string; origin: string }> = [
  { name: 'lungs-like', file: 'reports/fidelity-v3/fixtures/lungs-like.json', origin: 'hand-authored reproduction of the structure recorded in reports/acceptance (not Meta output)' },
  { name: 'microscope-like', file: 'reports/fidelity-v3/fixtures/microscope-like.json', origin: 'hand-authored reproduction of the structure recorded in reports/acceptance (not Meta output)' },
  { name: 'excavator (saved Meta plan)', file: 'reports/universal-spatial-v2/evidence/live-image-plan.json', origin: 'real plan saved from a Meta call, produced by the OLD repair step (generic placeholder shapes for some components)' },
  { name: 'harp (saved Meta plan)', file: 'reports/universal-spatial-v2/evidence/blind-harp-plan.json', origin: 'real plan saved from a Meta call, produced by the OLD repair step (generic placeholder shapes for some components)' },
];

type Tri = [Vector3, Vector3, Vector3];
const groupOf = (root: Object3D, id: string) => { let found: Object3D | undefined; root.traverse((o) => { if (o.userData.spatialComponentRoot && o.userData.spatialEntityId === id) found = o; }); return found!; };
const ownMeshes = (group: Object3D) => { const out: Mesh[] = []; const walk = (o: Object3D) => { for (const c of o.children) { if (c.userData.spatialComponentRoot) continue; if (c instanceof Mesh) out.push(c); walk(c); } }; walk(group); return out; };
function trianglesOf(mesh: Mesh, matrix: Matrix4): Tri[] {
  const g = mesh.geometry, pos = g.getAttribute('position'), idx = g.index, n = idx ? idx.count : pos.count, out: Tri[] = [];
  const v = (i: number) => new Vector3().fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(matrix);
  for (let i = 0; i + 2 < n; i += 3) out.push([v(i), v(i + 1), v(i + 2)]);
  return out;
}
const worldTriangles = (root: Object3D) => { root.updateMatrixWorld(true); const all: Tri[] = []; root.traverse((o) => { if (o instanceof Mesh) all.push(...trianglesOf(o, o.matrixWorld)); }); return all; };

/** Orthographic silhouette on one axis, `res` x `res` cells over a shared window. Returns the covered cells. */
function silhouette(tris: Tri[], axis: 0 | 1 | 2, lo: [number, number], hi: [number, number], res: number): Uint8Array {
  const [a, b] = [0, 1, 2].filter((i) => i !== axis) as [number, number], mask = new Uint8Array(res * res), sx = res / (hi[0] - lo[0]), sy = res / (hi[1] - lo[1]);
  for (const t of tris) {
    const p = t.map((q) => [(q.getComponent(a) - lo[0]) * sx, (q.getComponent(b) - lo[1]) * sy]) as [number, number][];
    const x0 = Math.max(0, Math.floor(Math.min(p[0]![0], p[1]![0], p[2]![0]))), x1 = Math.min(res - 1, Math.ceil(Math.max(p[0]![0], p[1]![0], p[2]![0])));
    const y0 = Math.max(0, Math.floor(Math.min(p[0]![1], p[1]![1], p[2]![1]))), y1 = Math.min(res - 1, Math.ceil(Math.max(p[0]![1], p[1]![1], p[2]![1])));
    const d = (p[1]![1] - p[2]![1]) * (p[0]![0] - p[2]![0]) + (p[2]![0] - p[1]![0]) * (p[0]![1] - p[2]![1]); if (Math.abs(d) < 1e-12) continue;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5, l1 = ((p[1]![1] - p[2]![1]) * (px - p[2]![0]) + (p[2]![0] - p[1]![0]) * (py - p[2]![1])) / d, l2 = ((p[2]![1] - p[0]![1]) * (px - p[2]![0]) + (p[0]![0] - p[2]![0]) * (py - p[2]![1])) / d, l3 = 1 - l1 - l2;
      if (l1 >= -0.01 && l2 >= -0.01 && l3 >= -0.01) mask[y * res + x] = 1;
    }
  }
  return mask;
}
/** iou, plus what V3 adds outside V2's silhouette and what it loses from it, as a fraction of V2's area */
const compare = (a: Uint8Array, b: Uint8Array) => { let i = 0, u = 0, onlyA = 0, onlyB = 0, areaA = 0; for (let k = 0; k < a.length; k++) { i += a[k]! & b[k]!; u += a[k]! | b[k]!; onlyA += a[k]! & ~b[k]! & 1; onlyB += b[k]! & ~a[k]! & 1; areaA += a[k]!; } return { iou: u ? i / u : 1, v2Only: onlyA / Math.max(areaA, 1), v3Only: onlyB / Math.max(areaA, 1) }; };
function silhouetteIoU(base: Tri[], other: Tri[]): Array<{ iou: number; v2OnlyPct: number; v3OnlyPct: number }> {
  const box = (t: Tri[]) => { const lo = new Vector3(Infinity, Infinity, Infinity), hi = new Vector3(-Infinity, -Infinity, -Infinity); for (const tri of t) for (const q of tri) { lo.min(q); hi.max(q); } return { lo, hi }; };
  const A = box(base), B = box(other), lo = A.lo.clone().min(B.lo), hi = A.hi.clone().max(B.hi), pad = hi.clone().sub(lo).multiplyScalar(0.02); lo.sub(pad); hi.add(pad);
  return ([0, 1, 2] as const).map((axis) => { const [a, b] = [0, 1, 2].filter((i) => i !== axis) as [number, number], res = 512; const r = compare(silhouette(base, axis, [lo.getComponent(a), lo.getComponent(b)], [hi.getComponent(a), hi.getComponent(b)], res), silhouette(other, axis, [lo.getComponent(a), lo.getComponent(b)], [hi.getComponent(a), hi.getComponent(b)], res)); return { iou: +r.iou.toFixed(4), v2OnlyPct: +(100 * r.v2Only).toFixed(2), v3OnlyPct: +(100 * r.v3Only).toFixed(2) }; });
}

const quantile = (values: number[], q: number) => { if (!values.length) return null; const s = [...values].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(q * s.length))]!.toFixed(3); };
const mean = (values: number[]) => (values.length ? +(values.reduce((x, y) => x + y, 0) / values.length).toFixed(3) : null);

/** Field of component `b`, evaluated at a point given in component `a`'s local space. */
function partnerFieldIn(root: Object3D, plan: SpatialPlanV2, a: string, b: string) {
  const comp = plan.components.find((c) => c.id === b)!, shapes = implicitShapesOf(comp.geometry); if ('code' in shapes) return null;
  const f = unionFieldCulled(shapes, 0), toB = new Matrix4().multiplyMatrices(groupOf(root, b).matrixWorld.clone().invert(), groupOf(root, a).matrixWorld), e = toB.elements;
  const at = (x: number, y: number, z: number) => f(e[0]! * x + e[4]! * y + e[8]! * z + e[12]!, e[1]! * x + e[5]! * y + e[9]! * z + e[13]!, e[2]! * x + e[6]! * y + e[10]! * z + e[14]!);
  const grad = (x: number, y: number, z: number, h: number) => new Vector3(at(x + h, y, z) - at(x - h, y, z), at(x, y + h, z) - at(x, y - h, z), at(x, y, z + h) - at(x, y, z - h)).normalize();
  return { at, grad };
}

/** Vertices (in the component's local space, with normals) of the meshes the component draws itself. */
function localVertices(root: Object3D, id: string) {
  const g = groupOf(root, id), out: Array<{ p: Vector3; n: Vector3; mesh: Mesh }> = [];
  for (const mesh of ownMeshes(g)) {
    mesh.updateMatrix(); const m = mesh.matrix, nm = new Matrix3().getNormalMatrix(m), pos = mesh.geometry.getAttribute('position'), nor = mesh.geometry.getAttribute('normal');
    for (let i = 0; i < pos.count; i++) out.push({ p: new Vector3().fromBufferAttribute(pos, i).applyMatrix4(m), n: new Vector3().fromBufferAttribute(nor, i).applyMatrix3(nm).normalize(), mesh });
  }
  return out;
}

/** Boundary of the drawn surface of a component: edges used by exactly one triangle, with the turning angle at every boundary vertex that joins two of them. */
function boundary(root: Object3D, id: string) {
  const g = groupOf(root, id), verts: Vector3[] = [], turning: number[] = []; let edges = 0;
  for (const mesh of ownMeshes(g)) {
    mesh.updateMatrix(); const pos = mesh.geometry.getAttribute('position'), idx = mesh.geometry.index; if (!idx) continue;
    const count = new Map<string, number>(); const key = (i: number, j: number) => (i < j ? `${i}_${j}` : `${j}_${i}`);
    for (let t = 0; t < idx.count; t += 3) for (let k = 0; k < 3; k++) { const kk = key(idx.getX(t + k), idx.getX(t + (k + 1) % 3)); count.set(kk, (count.get(kk) ?? 0) + 1); }
    const adj = new Map<number, number[]>(); for (const [kk, c] of count) if (c === 1) { const [i, j] = kk.split('_').map(Number) as [number, number]; edges++; (adj.get(i) ?? adj.set(i, []).get(i)!).push(j); (adj.get(j) ?? adj.set(j, []).get(j)!).push(i); }
    const P = (i: number) => new Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrix);
    for (const [i, nb] of adj) { verts.push(P(i)); if (nb.length === 2) { const a = P(nb[0]!).sub(P(i)).normalize(), b = P(nb[1]!).sub(P(i)).normalize(); turning.push((180 / Math.PI) * (Math.PI - Math.acos(Math.max(-1, Math.min(1, a.dot(b)))))); } }
  }
  return { verts, turning, edges };
}

function slivers(root: Object3D): { fraction: number; triangles: number } {
  let bad = 0, total = 0;
  root.updateMatrixWorld(true);
  root.traverse((o) => { if (!(o instanceof Mesh)) return; for (const [a, b, c] of trianglesOf(o, o.matrixWorld)) { total++; const ab = a.distanceTo(b), bc = b.distanceTo(c), ca = c.distanceTo(a), longest = Math.max(ab, bc, ca), area = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).length() / 2; if (longest < 1e-12 || (2 * area) / longest / longest < 0.05) bad++; } });
  return { fraction: +(bad / Math.max(total, 1)).toFixed(4), triangles: total };
}

async function variants(plan: SpatialPlanV2) {
  const t2 = performance.now(), v2 = compileSpatialPlanV2(plan), v2Ms = performance.now() - t2;
  const t3 = performance.now(), final = compileWithRouter(plan, { limits: { maxGridCells: 96 } }), finalMs = performance.now() - t3;
  // baseline: the same router, but the worker draws the rim by dropping whole triangles
  const service = new ContinuousService({ createWorker: () => createInlineWorker((j) => runContinuousJob(j, undefined, { rim: 'discard' })), poolSize: 2 });
  const shell = compileWithRouter(plan, { service, limits: { maxGridCells: 96 } }), ready = new Promise<void>((r) => { if (!shell.report.pending.length) r(); service.onReady(() => { shell.upgrade(); if (!shell.report.pending.length) r(); }); }); await ready;
  const mainThreadMs = (() => { const s = new ContinuousService({ createWorker: () => createInlineWorker(), poolSize: 1 }); const t = performance.now(); const r = compileWithRouter(plan, { service: s, limits: { maxGridCells: 96 } }); const ms = performance.now() - t; s.dispose(); void r; return ms; })();
  service.dispose();
  return { v2, v2Ms, final, finalMs, discard: shell, mainThreadMs };
}

const results: Record<string, unknown> = {};
const lines: string[] = [];
for (const c of CASES) {
  const reply = JSON.parse(await readFile(resolve(c.file), 'utf8')), plan = validateSpatialPlanV2(reply.plan), v = await variants(plan);
  const decisions = v.final.report.decisions, continuous = decisions.filter((d) => d.used === 'continuous_surface');
  const span = (() => { const lo = new Vector3(Infinity, Infinity, Infinity), hi = new Vector3(-Infinity, -Infinity, -Infinity); for (const t of worldTriangles(v.v2.root)) for (const q of t) { lo.min(q); hi.max(q); } return Math.max(...hi.sub(lo).toArray()); })();
  const tris = { v2: worldTriangles(v.v2.root), final: worldTriangles(v.final.root), discard: worldTriangles(v.discard.root) };
  const row: Record<string, unknown> = {
    origin: c.origin, components: plan.components.length, continuousComponents: continuous.length,
    v2: { triangles: tris.v2.length, buildMs: +v.v2Ms.toFixed(1), slivers: slivers(v.v2.root) },
    v3: { triangles: tris.final.length, syncBuildMs: +v.finalMs.toFixed(1), mainThreadMsWithWorker: +v.mainThreadMs.toFixed(1), slivers: slivers(v.final.root), fallbacks: decisions.filter((d) => d.fallback).map((d) => `${d.componentId}:${d.fallback!.code}`) },
    v3Discard: { triangles: tris.discard.length, slivers: slivers(v.discard.root) },
    silhouetteIoU_vs_V2: { final_xyz: silhouetteIoU(tris.v2, tris.final), earlierRimDiscard_xyz: silhouetteIoU(tris.v2, tris.discard) },
    deviationPctOfSpan: continuous.map((d) => ({ id: d.componentId, freePct: +(100 * (d.deviation?.freeMax ?? 0) / span).toFixed(2), blendPct: +(100 * (d.deviation?.blendMax ?? 0) / span).toFixed(2), cellPct: +(100 * (d.deviation?.cell ?? 0) / span).toFixed(2) })),
  };
  // junction metrics, per pair the router actually blended
  const pairs: Array<Record<string, unknown>> = [];
  for (const d of continuous) for (const b of d.blendedWith ?? []) {
    const cell = d.deviation!.cell, tol = 1.5 * cell, finalField = partnerFieldIn(v.final.root, plan, d.componentId, b); if (!finalField) continue;
    const angles = (root: Object3D) => { const f = partnerFieldIn(root, plan, d.componentId, b)!, out: number[] = []; for (const { p, n } of localVertices(root, d.componentId)) { if (Math.abs(f.at(p.x, p.y, p.z)) > tol) continue; const g = f.grad(p.x, p.y, p.z, cell * 0.25); out.push((180 / Math.PI) * Math.acos(Math.min(1, Math.abs(n.dot(g))))); } return out; };
    const rim = (root: Object3D) => { const bd = boundary(root, d.componentId); return { openEdges: bd.edges, turningMeanDeg: mean(bd.turning), turningP90Deg: quantile(bd.turning, 0.9) }; };
    pairs.push({ pair: `${d.componentId} -> ${b}`, cell: +cell.toFixed(4), normalAngleToPartner_deg: { v2: { n: angles(v.v2.root).length, median: quantile(angles(v.v2.root), 0.5), p90: quantile(angles(v.v2.root), 0.9) }, v3Final: { n: angles(v.final.root).length, median: quantile(angles(v.final.root), 0.5), p90: quantile(angles(v.final.root), 0.9) }, v3EarlierRimDiscard: { n: angles(v.discard.root).length, median: quantile(angles(v.discard.root), 0.5), p90: quantile(angles(v.discard.root), 0.9) } }, rim: { v3Final: rim(v.final.root), v3EarlierRimDiscard: rim(v.discard.root) } });
  }
  row.junctions = pairs; results[c.name] = row;
  lines.push(`${c.name}: comps=${plan.components.length} continuous=${continuous.length} tri V2=${v.v2.stats.triangleCount} V3=${v.final.stats.triangleCount} IoU(xyz) final=${(row.silhouetteIoU_vs_V2 as { final_xyz: Array<{ iou: number }> }).final_xyz.map((x) => x.iou).join('/')} discard=${(row.silhouetteIoU_vs_V2 as { earlierRimDiscard_xyz: Array<{ iou: number }> }).earlierRimDiscard_xyz.map((x) => x.iou).join('/')} pairs=${pairs.length}`);
}
await writeFile(resolve(out, 'metrics.json'), `${JSON.stringify({ generatedBy: 'scripts/benchmark/fidelity-metrics.ts', note: 'Geometry computed from the meshes; no GPU. Angles: degrees between the drawn surface normal and the partner surface normal at vertices within 1.5 cells of the partner surface (0 = tangent-continuous, 90 = a crease). Rim turning: mean/p90 turning angle (degrees) along the open boundary of a blended skirt, 0 = straight, large = serrated. Deviation is relative to the span of the plan in deviationPctOfSpan.', cases: results }, null, 2)}\n`);
console.log(lines.join('\n'));
