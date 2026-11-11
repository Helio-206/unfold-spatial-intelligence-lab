import { BufferGeometry, Vector3 } from 'three';
import { surfaceNets } from '../fidelity/surface-nets';
import { gridFor, makeView, occupancyField, type Grid, type View } from './silhouette';

/**
 * Multi-view reconstruction from silhouettes (the product path for several photographs, a turntable video or orthographic technical views).
 *
 * A voxel survives only if every view allows it (visual hull). The hull is an UPPER BOUND of the object: concavities and cavities invisible in every
 * silhouette are filled, depth seen from a single direction is not observed. It never invents detail; it reports, per vertex, how many views have a
 * silhouette contour through that point (`vertexSupport`, informative only). MEASURED (reports/reality-engine/benchmark): this count does NOT predict
 * the error of the vertex (neither does the leave-one-out criticality tried on the development assets), so nothing may present it as a confidence. The
 * honest uncertainty is object-level and calibrated on the benchmark: the whole hull surface is APPROXIMATED with the tolerance measured there.
 *
 * Cameras are orthographic and share one window (`Frame`). Poses marked 'assumed' (e.g. equal turntable steps) can be refined by leave-one-out
 * consistency (`refinePoses`); poses marked 'given' are never touched. Elevation is never refined and is UNKNOWN unless supplied.
 */
export type Frame = { centre: Vector3; half: number };
export type PoseSource = 'given' | 'assumed';
export type SilhouetteView = {
  id: string; res: number; mask: Uint8Array; azimuthDeg: number; elevationDeg: number; azimuthSource: PoseSource;
};
export type HullOptions = { frame: Frame; cells?: number; /** carve against masks grown by this many pixels, so structures thinner than a voxel are not lost (a conservative, larger hull) */ dilatePx?: number };
export type HullStats = {
  viewCount: number; independentViews: number; depthObserved: boolean; vertexCount: number; supportedFraction: number;
  occupiedVoxels: number; clippedByFrame: boolean; voxelSize: number; ms: number;
};
export type HullResult = { grid: Grid; occupancy: Uint8Array; geometry: BufferGeometry; vertexSupport: Uint8Array; stats: HullStats };

/** Direction from the object towards the camera for an orbit pose (y up; azimuth 0 looks from +z). */
export function orbitDirection(azimuthDeg: number, elevationDeg: number): Vector3 {
  const a = (azimuthDeg * Math.PI) / 180, e = (elevationDeg * Math.PI) / 180;
  return new Vector3(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a));
}
export const viewOf = (v: SilhouetteView, frame: Frame): View => makeView(orbitDirection(v.azimuthDeg, v.elevationDeg), frame.centre, frame.half, v.res);

function validate(views: readonly SilhouetteView[]): void {
  if (!views.length) throw new Error('NO_VIEWS');
  const res = views[0]!.res;
  for (const v of views) {
    if (v.res !== res) throw new Error('VIEW_RES_MISMATCH: all views must share one resolution');
    if (v.mask.length !== res * res) throw new Error('VIEW_MASK_SIZE');
    let any = false; for (let i = 0; i < v.mask.length; i++) if (v.mask[i]) { any = true; break; }
    if (!any) throw new Error(`EMPTY_SILHOUETTE ${v.id}`);
  }
}

type Basis = { right: [number, number, number]; up: [number, number, number]; s: number; half: number; res: number; centre: [number, number, number]; mask: Uint8Array };
const basisOf = (view: View, mask: Uint8Array): Basis => ({
  right: [view.right.x, view.right.y, view.right.z], up: [view.up.x, view.up.y, view.up.z], s: view.res / (2 * view.half), half: view.half, res: view.res,
  centre: [view.centre.x, view.centre.y, view.centre.z], mask,
});

/** Fast carve: voxel centres that project inside every mask (skipping `skip`). */
function carveFast(grid: Grid, bases: Basis[], skip = -1): Uint8Array {
  const [nx, ny, nz] = grid.cells, out = new Uint8Array(nx * ny * nz), g = grid.size;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const px = grid.min.x + (i + 0.5) * g, py = grid.min.y + (j + 0.5) * g, pz = grid.min.z + (k + 0.5) * g;
    let inside = 1;
    for (let v = 0; v < bases.length; v++) {
      if (v === skip) continue;
      const b = bases[v]!, dx = px - b.centre[0], dy = py - b.centre[1], dz = pz - b.centre[2];
      const u = Math.floor((dx * b.right[0] + dy * b.right[1] + dz * b.right[2] + b.half) * b.s), w = Math.floor((dx * b.up[0] + dy * b.up[1] + dz * b.up[2] + b.half) * b.s);
      if (u < 0 || w < 0 || u >= b.res || w >= b.res || !b.mask[w * b.res + u]) { inside = 0; break; }
    }
    out[i + nx * (j + ny * k)] = inside;
  }
  return out;
}

/** Splats the occupied voxels of `occ` into a mask as seen by `view` (footprint = voxel size). */
function splat(grid: Grid, occ: Uint8Array, b: Basis): Uint8Array {
  const [nx, ny, nz] = grid.cells, g = grid.size, out = new Uint8Array(b.res * b.res), r = Math.max(0, Math.ceil((g * b.s) / 2));
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!occ[i + nx * (j + ny * k)]) continue;
    const dx = grid.min.x + (i + 0.5) * g - b.centre[0], dy = grid.min.y + (j + 0.5) * g - b.centre[1], dz = grid.min.z + (k + 0.5) * g - b.centre[2];
    const u = Math.floor((dx * b.right[0] + dy * b.right[1] + dz * b.right[2] + b.half) * b.s), w = Math.floor((dx * b.up[0] + dy * b.up[1] + dz * b.up[2] + b.half) * b.s);
    for (let y = Math.max(0, w - r); y <= Math.min(b.res - 1, w + r); y++) for (let x = Math.max(0, u - r); x <= Math.min(b.res - 1, u + r); x++) out[y * b.res + x] = 1;
  }
  return out;
}
const iou = (a: Uint8Array, b: Uint8Array): number => { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { i += a[k]! & b[k]!; u += a[k]! | b[k]!; } return u ? i / u : 1; };

const contourOf = (mask: Uint8Array, res: number): Uint8Array => {
  const c = new Uint8Array(res * res);
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
    if (!mask[y * res + x]) continue;
    if (x === 0 || y === 0 || x === res - 1 || y === res - 1 || !mask[y * res + x - 1] || !mask[y * res + x + 1] || !mask[(y - 1) * res + x] || !mask[(y + 1) * res + x]) c[y * res + x] = 1;
  }
  return c;
};

function independentCount(views: readonly SilhouetteView[], minSepDeg: number): number {
  const kept: Vector3[] = [], cos = Math.cos((minSepDeg * Math.PI) / 180);
  for (const v of views) { const d = orbitDirection(v.azimuthDeg, v.elevationDeg); if (kept.every((k) => Math.abs(k.dot(d)) < cos)) kept.push(d); }
  return kept.length;
}

/** Grows a mask by `px` pixels (square structuring element, separable). */
export function dilateMask(mask: Uint8Array, res: number, px: number): Uint8Array {
  if (px <= 0) return mask;
  const tmp = new Uint8Array(mask.length), out = new Uint8Array(mask.length);
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) { let on = 0; for (let d = -px; d <= px && !on; d++) { const xx = x + d; if (xx >= 0 && xx < res && mask[y * res + xx]) on = 1; } tmp[y * res + x] = on; }
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) { let on = 0; for (let d = -px; d <= px && !on; d++) { const yy = y + d; if (yy >= 0 && yy < res && tmp[yy * res + x]) on = 1; } out[y * res + x] = on; }
  return out;
}

export function reconstructHull(views: readonly SilhouetteView[], options: HullOptions): HullResult {
  const t0 = performance.now();
  validate(views);
  const cells = options.cells ?? 64, grid = gridFor(options.frame.centre, options.frame.half, cells);
  const bases = views.map((v) => basisOf(viewOf(v, options.frame), dilateMask(v.mask, v.res, options.dilatePx ?? 0)));
  const occupancy = carveFast(grid, bases);
  const [nx, ny, nz] = grid.cells;
  let occupied = 0, clipped = false;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (occupancy[i + nx * (j + ny * k)]) { occupied++; if (i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1) clipped = true; }
  // O contorno toca a fronteira da janela: o casco seria cortado. Esvazia a casca exterior para manter a malha fechada, e declara-o.
  if (clipped) for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1) occupancy[i + nx * (j + ny * k)] = 0;
  const field = occupancyField(grid, occupancy, 1);
  const geometry = occupied ? surfaceNets({ min: grid.min, cells: grid.cells, size: grid.size, field, maxTriangles: 400_000 }) : new BufferGeometry();
  const pos = geometry.getAttribute('position'), vertexCount = pos ? pos.count : 0;

  const contours = bases.map((b) => contourOf(b.mask, b.res));
  const tol = Math.max(1.5, grid.size * bases[0]!.s), rad = Math.ceil(tol);
  const vertexSupport = new Uint8Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    const px = pos!.getX(i), py = pos!.getY(i), pz = pos!.getZ(i);
    let count = 0;
    for (let v = 0; v < bases.length; v++) {
      const b = bases[v]!, dx = px - b.centre[0], dy = py - b.centre[1], dz = pz - b.centre[2];
      const u = Math.round((dx * b.right[0] + dy * b.right[1] + dz * b.right[2] + b.half) * b.s), w = Math.round((dx * b.up[0] + dy * b.up[1] + dz * b.up[2] + b.half) * b.s);
      let hit = false;
      for (let y = Math.max(0, w - rad); y <= Math.min(b.res - 1, w + rad) && !hit; y++) for (let x = Math.max(0, u - rad); x <= Math.min(b.res - 1, u + rad); x++) if (contours[v]![y * b.res + x]) { hit = true; break; }
      if (hit) count++;
    }
    vertexSupport[i] = Math.min(255, count);
  }
  let supported = 0; for (const s of vertexSupport) if (s >= 2) supported++;
  const independentViews = independentCount(views, 15);
  const wide = (() => { for (let a = 0; a < views.length; a++) for (let b = a + 1; b < views.length; b++) if (Math.abs(orbitDirection(views[a]!.azimuthDeg, views[a]!.elevationDeg).dot(orbitDirection(views[b]!.azimuthDeg, views[b]!.elevationDeg))) < Math.cos((30 * Math.PI) / 180)) return true; return false; })();
  return {
    grid, occupancy, geometry, vertexSupport,
    stats: { viewCount: views.length, independentViews, depthObserved: wide, vertexCount, supportedFraction: vertexCount ? supported / vertexCount : 0, occupiedVoxels: occupied, clippedByFrame: clipped, voxelSize: grid.size, ms: performance.now() - t0 },
  };
}

export type RefinedView = SilhouetteView & { identifiable: boolean; correctionDeg: number };
export type RefineResult = { views: RefinedView[]; consistencyBefore: number; consistencyAfter: number; notes: string[] };
export type RefineOptions = { frame: Frame; cells?: number; rounds?: number; stepsDeg?: number[]; maxShiftDeg?: number };

/**
 * Leave-one-out pose refinement: for each 'assumed' view, the hull of all OTHER views is the reference; the view's azimuth moves (coordinate descent,
 * coarse to fine, bounded) to maximise IoU between its silhouette and that hull's projection. A flat objective (rotationally symmetric object) means
 * the azimuth is not identifiable from silhouettes: the nominal value is kept and the view is flagged `identifiable: false`.
 */
export function refinePoses(input: readonly SilhouetteView[], options: RefineOptions): RefineResult {
  validate(input);
  const cells = options.cells ?? 64, rounds = options.rounds ?? 6, steps = options.stepsDeg ?? [6, 3, 1.5, 0.75], maxShift = options.maxShiftDeg ?? 12;
  const grid = gridFor(options.frame.centre, options.frame.half, cells);
  const notes: string[] = [];
  let views: RefinedView[] = input.map((v) => ({ ...v, identifiable: v.azimuthSource === 'given', correctionDeg: 0 }));
  const basesOf = (vs: SilhouetteView[]) => vs.map((v) => basisOf(viewOf(v, options.frame), v.mask));
  const consistency = (vs: SilhouetteView[]): number => {
    const bases = basesOf(vs); let sum = 0;
    for (let v = 0; v < vs.length; v++) sum += iou(vs[v]!.mask, splat(grid, carveFast(grid, bases, v), bases[v]!));
    return sum / vs.length;
  };
  if (input.length < 3) { notes.push('menos de 3 vistas: refinamento de pose não é possível'); const c = consistency(views); return { views, consistencyBefore: c, consistencyAfter: c, notes }; }
  const before = consistency(views);
  // Simetria de revolução: se as silhuetas de vistas à mesma elevação são quase idênticas, o azimute não é identificável pela silhueta.
  const symmetric = new Set<number>();
  for (let a = 0; a < views.length; a++) {
    const peers = views.filter((o, b) => b !== a && Math.abs(o.elevationDeg - views[a]!.elevationDeg) < 1e-6);
    if (peers.length && peers.every((o) => iou(o.mask, views[a]!.mask) >= 0.97)) symmetric.add(a);
  }
  for (let round = 0; round < rounds; round++) {
    for (let v = 0; v < views.length; v++) {
      if (views[v]!.azimuthSource === 'given') continue;
      if (symmetric.has(v)) { if (round === 0) notes.push(`${views[v]!.id}: silhuetas quase idênticas entre vistas (simetria de revolução); azimute não identificável, mantido`); continue; }
      const bases = basesOf(views), reference = carveFast(grid, bases, v);
      let any = false; for (const x of reference) if (x) { any = true; break; }
      if (!any) { notes.push(`${views[v]!.id}: vistas restantes sem casco comum`); continue; }
      const score = (az: number) => iou(views[v]!.mask, splat(grid, reference, basisOf(viewOf({ ...views[v]!, azimuthDeg: az }, options.frame), views[v]!.mask)));
      const nominal = input[v]!.azimuthDeg;
      // identificabilidade: amplitude da curva de consistência à volta do valor nominal
      if (round === 0) {
        let lo = Infinity, hi = -Infinity; for (let d = -maxShift; d <= maxShift; d += 3) { const s = score(nominal + d); lo = Math.min(lo, s); hi = Math.max(hi, s); }
        views[v]!.identifiable = hi - lo >= 0.02;
        if (!views[v]!.identifiable) notes.push(`${views[v]!.id}: curva de consistência plana (amplitude ${(hi - lo).toFixed(3)}); azimute não identificável, mantido`);
      }
      if (!views[v]!.identifiable) continue;
      let az = views[v]!.azimuthDeg, best = score(az);
      for (const step of steps) {
        for (let guard = 0; guard < 6; guard++) {
          let moved = false;
          for (const d of [-step, step]) {
            const c = az + d; if (Math.abs(c - nominal) > maxShift) continue;
            const s = score(c); if (s > best + 1e-9) { best = s; az = c; moved = true; }
          }
          if (!moved) break;
        }
      }
      views[v] = { ...views[v]!, azimuthDeg: az, correctionDeg: az - nominal };
    }
  }
  views = views.map((v) => ({ ...v }));
  return { views, consistencyBefore: before, consistencyAfter: consistency(views), notes };
}

/**
 * Held-out check that needs no ground truth: for each view, the hull of all OTHER views is projected into it and compared with its silhouette.
 * A view the hull was not built from is a genuine hold-out for that view. It proves the views agree with one another, not that the shape is right
 * (that needs 3D ground truth), and it needs at least 3 views.
 */
export function leaveOneOutIoU(views: readonly SilhouetteView[], options: { frame: Frame; cells?: number }): number[] {
  validate(views);
  if (views.length < 3) return [];
  const grid = gridFor(options.frame.centre, options.frame.half, options.cells ?? 64), bases = views.map((v) => basisOf(viewOf(v, options.frame), v.mask));
  return views.map((v, i) => iou(v.mask, splat(grid, carveFast(grid, bases, i), bases[i]!)));
}
