import { meshWorldTriangles } from './mesh-triangles';
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
  compiled.root.traverse((o) => { if (!(o instanceof Mesh)) return; for (const tri of meshWorldTriangles(o)) tris.push(tri); });
  disposeCompiledSpatialPlan(compiled.root);
  const box = new Box3(); for (const t of tris) for (const p of t) box.expandByPoint(p); const centre = box.getCenter(new Vector3()), half = box.getSize(new Vector3()).length() / 2 * 1.05;
  return viewDirections(count).map((d, i) => { const view = makeView(d, centre, half, res); return { view, mask: rasterise(tris, view), calibrated: true, source: 'rendered' as const, label: `rendered-${i}` }; });
}

/** Evidence is plain data (view pose + run-length mask), so a derived set of silhouettes can be stored and replayed without the asset that produced it. */
export type EvidenceJSON = { source: 'rendered' | 'photo'; note: string; views: Array<{ direction: number[]; centre: number[]; half: number; res: number; calibrated: boolean; label?: string; rle: number[] }> };
export function evidenceToJSON(evidence: EvidenceView[], note: string): EvidenceJSON {
  return { source: evidence[0]?.source ?? 'rendered', note, views: evidence.map((e) => { const rle: number[] = []; let cur = 0, run = 0; for (const v of e.mask) { if (v === cur) run++; else { rle.push(run); cur = v; run = 1; } } rle.push(run); return { direction: e.view.direction.toArray(), centre: e.view.centre.toArray(), half: e.view.half, res: e.view.res, calibrated: e.calibrated, ...(e.label ? { label: e.label } : {}), rle }; }) };
}
export function evidenceFromJSON(json: EvidenceJSON): EvidenceView[] {
  return json.views.map((v) => { const mask = new Uint8Array(v.res * v.res); let k = 0, cur = 0; for (const run of v.rle) { if (cur) mask.fill(1, k, k + run); k += run; cur ^= 1; } return { view: makeView(new Vector3(...v.direction), new Vector3(...v.centre), v.half, v.res), mask, calibrated: v.calibrated, source: json.source, ...(v.label ? { label: v.label } : {}) }; });
}
