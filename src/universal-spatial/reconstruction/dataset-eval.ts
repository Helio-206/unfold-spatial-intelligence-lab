import { Vector3 } from 'three';
import { cubeOf } from './dataset-formats';
import { leaveOneOutIoU, reconstructHull, type PinholeCamera, type SilhouetteView } from './multiview';
import { chamfer, geometryPoints } from './multiview-metrics';

/**
 * Evaluation of the pinhole hull against a reference point cloud of a public multi-view benchmark (DTU / ETH3D) once the data is on disk. This is NOT the benchmarks'
 * official metric (those apply their own observability masks and thresholds); it is a Chamfer distance in the dataset's own units plus held-out silhouette IoU,
 * stated as indicative until the official script is run on the same reconstruction. The reference is never used to build anything: it only scores.
 */
export type ScanInput = { cameras: readonly PinholeCamera[]; masks: readonly Uint8Array[]; res: number; reference: readonly Vector3[]; cells?: number };
export type ScanScore = { views: number; cells: number; units: { accuracy: number; completeness: number; chamfer: number }; relativeToReferenceDiagonalPct: { accuracy: number; completeness: number; chamfer: number }; heldOutIoUMean: number | null; occupiedVoxels: number; note: string };

export function evaluatePinholeScan(scan: ScanInput): ScanScore {
  if (scan.cameras.length !== scan.masks.length || scan.cameras.length < 3) throw new Error('DATASET_SCAN_INPUT');
  const { centre, half } = cubeOf(scan.reference), cells = scan.cells ?? 96;
  const views: SilhouetteView[] = scan.cameras.map((camera, i) => ({ id: `v${i}`, res: scan.res, mask: scan.masks[i]!, azimuthDeg: 0, elevationDeg: 0, azimuthSource: 'given' as const, camera }));
  const hull = reconstructHull(views, { frame: { centre, half }, cells }), pts = geometryPoints(hull.geometry, 6000, 3);
  if (!pts.length) throw new Error('DATASET_EMPTY_HULL');
  const ch = chamfer(pts, [...scan.reference]), min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity); for (const p of scan.reference) { min.min(p); max.max(p); }
  const diag = max.clone().sub(min).length(), pct = (v: number) => +((v / diag) * 100).toFixed(3), loo = leaveOneOutIoU(views, { frame: { centre, half }, cells: 48 });
  return { views: views.length, cells, units: { accuracy: ch.accuracy, completeness: ch.completeness, chamfer: ch.symmetric }, relativeToReferenceDiagonalPct: { accuracy: pct(ch.accuracy), completeness: pct(ch.completeness), chamfer: pct(ch.symmetric) }, heldOutIoUMean: loo.length ? loo.reduce((a, b) => a + b, 0) / loo.length : null, occupiedVoxels: hull.stats.occupiedVoxels, note: 'Chamfer em unidades do dataset; NÃO é a métrica oficial do benchmark (sem máscaras de observabilidade); indicativo até correr o script oficial.' };
}
