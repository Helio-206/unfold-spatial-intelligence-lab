import { Box3, Mesh, Vector3 } from 'three';
import type { SpatialPlanV2 } from '../contracts-v2';
import { compileSpatialPlanV2, disposeCompiledSpatialPlan } from '../geometry-compiler-v2';
import type { EvidenceView } from './engine';
import { makeView, rasterise, viewDirections, type Tri } from './silhouette';

/**
 * RENDERED evidence views (category A/D tests): calibrated silhouettes of a known plan from `count` well-spread directions. The calibration is exact because we
 * placed the cameras. It is evidence about that plan only; a photograph needs its own calibration and mask and must never be passed off through this function.
 */
export function renderedEvidence(truth: SpatialPlanV2, count = 6, res = 128): EvidenceView[] {
  const compiled = compileSpatialPlanV2(truth); compiled.root.updateMatrixWorld(true); const tris: Tri[] = [];
  compiled.root.traverse((o) => { if (!(o instanceof Mesh)) return; const pos = o.geometry.getAttribute('position'), idx = o.geometry.index, n = idx ? idx.count : pos.count, v = (i: number) => new Vector3().fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld); for (let i = 0; i + 2 < n; i += 3) tris.push([v(i), v(i + 1), v(i + 2)]); });
  disposeCompiledSpatialPlan(compiled.root);
  const box = new Box3(); for (const t of tris) for (const p of t) box.expandByPoint(p); const centre = box.getCenter(new Vector3()), half = box.getSize(new Vector3()).length() / 2 * 1.05;
  return viewDirections(count).map((d, i) => { const view = makeView(d, centre, half, res); return { view, mask: rasterise(tris, view), calibrated: true, source: 'rendered' as const, label: `rendered-${i}` }; });
}
