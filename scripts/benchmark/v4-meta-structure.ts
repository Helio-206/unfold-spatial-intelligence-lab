// CATEGORY C: plans produced by Meta (saved from real calls, old repair step). There is NO ground truth for them, so nothing here measures fidelity.
// It only reports what structure the plans declare and what the constraint layer could support, i.e. how much the structural solver could even act on.
//   npx tsx scripts/benchmark/v4-meta-structure.ts reports/fidelity-v4/benchmark
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Box3, Mesh, Vector3, type Object3D } from 'three';
import { validateSpatialPlanV2 } from '../../src/universal-spatial/contracts-v2';
import { compileSpatialPlanV2 } from '../../src/universal-spatial/geometry-compiler-v2';
import { buildConstraints, type PartGeometry } from '../../src/universal-spatial/reconstruction/constraints';
import { forestOf } from '../../src/universal-spatial/reconstruction/structural-fit';
import type { Tri } from '../../src/universal-spatial/reconstruction/silhouette';

const trisByEntity = (root: Object3D) => { root.updateMatrixWorld(true); const m = new Map<string, Tri[]>(); root.traverse((o) => { if (!(o instanceof Mesh) || typeof o.userData.spatialEntityId !== 'string') return; const id = o.userData.spatialEntityId as string, pos = o.geometry.getAttribute('position'), idx = o.geometry.index, n = idx ? idx.count : pos.count, l = m.get(id) ?? []; const v = (i: number) => new Vector3().fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld); for (let i = 0; i + 2 < n; i += 3) l.push([v(i), v(i + 1), v(i + 2)]); m.set(id, l); }); return m; };
const out: Record<string, unknown> = {};
for (const [name, file] of [['excavator (saved Meta plan)', 'reports/universal-spatial-v2/evidence/live-image-plan.json'], ['harp (saved Meta plan)', 'reports/universal-spatial-v2/evidence/blind-harp-plan.json']] as const) {
  const plan = validateSpatialPlanV2(JSON.parse(await readFile(resolve(file), 'utf8')).plan), tris = trisByEntity(compileSpatialPlanV2(plan).root), b = new Box3(); for (const t of tris.values()) for (const x of t) for (const p of x) b.expandByPoint(p);
  const span = Math.max(...b.getSize(new Vector3()).toArray()), roots = plan.components.filter((c) => c.parentId === null), parts: PartGeometry[] = roots.map((c) => { const bb = new Box3(); for (const t of tris.get(c.id)!) for (const p of t) bb.expandByPoint(p); return { id: c.id, origin: bb.getCenter(new Vector3()), tris: tris.get(c.id)! }; });
  const set = buildConstraints(plan, parts, span), forest = forestOf(parts, set);
  out[name] = { category: 'C: produced by Meta, no ground truth; structure statistics only', components: plan.components.length, withParent: plan.components.length - roots.length, declaredRelations: plan.relations.length, declaredConstraints: plan.constraints.length, contactsSupportedByGeometry: set.attach.length, rootsOfConnectedGroups: forest.roots.length, isolatedParts: forest.free, notes: set.notes };
  console.log(name, JSON.stringify(out[name]).slice(0, 300));
}
await writeFile(resolve(process.argv[2] ?? 'reports/fidelity-v4/benchmark', 'meta-plan-structure.json'), `${JSON.stringify(out, null, 2)}\n`);
