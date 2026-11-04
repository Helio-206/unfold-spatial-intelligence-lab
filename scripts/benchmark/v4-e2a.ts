import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { Mesh } from 'three';
import { applySpatialOperationV2, validateSpatialPlanV2, type MaterialV2 } from '../../src/universal-spatial/contracts-v2';
import { compileSpatialPlanV2, disposeCompiledSpatialPlan } from '../../src/universal-spatial/geometry-compiler-v2';
import { diagnoseContradictions } from '../../src/universal-spatial/reconstruction/diagnose';
import { proposeGeometry, taperedBeam } from '../../src/universal-spatial/parametric-e2a';
const start = performance.now();
const plan = validateSpatialPlanV2(JSON.parse(readFileSync('reports/universal-spatial-v2/evidence/live-image-plan.json', 'utf8')).plan);
const diagnoses = diagnoseContradictions(plan);
const material: MaterialV2 = { profile: 'industrial', color: '#aaaaaa', roughness: 0.5, metalness: 0.2, clearcoat: 0 };
const boom = plan.components.find(c => c.id === 'boom')!;
const candidate = taperedBeam(boom.geometry.key, [{ z: 0, width: .5, height: .5 }, { z: 2, width: .35, height: .3 }, { z: 4, width: .2, height: .2 }], material);
const p = proposeGeometry(plan, 'boom', candidate, 'Synthetic arbitrary parameters; not derived from source image.');
const next = applySpatialOperationV2(plan, p.operation, p.provenance);
function counts(value: typeof plan) {
  const c = compileSpatialPlanV2(value); let vertices = 0, triangles = 0, meshes = 0;
  c.root.traverse(o => { if (!(o instanceof Mesh)) return; meshes++; vertices += o.geometry.getAttribute('position').count; triangles += (o.geometry.index?.count ?? o.geometry.getAttribute('position').count) / 3; });
  disposeCompiledSpatialPlan(c.root); return { meshes, vertices, triangles };
}
const result = { fixture: 'saved Meta plan; no photographic ground truth', diagnoses, arbitrarySyntheticBeam: { baseline: counts(plan), candidate: counts(next), physicalUnitsKnown: false, fittedToEvidence: false }, wallMs: performance.now() - start, heapUsedBytes: process.memoryUsage().heapUsed };
writeFileSync('reports/fidelity-v4/e2a-diagnosis.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
