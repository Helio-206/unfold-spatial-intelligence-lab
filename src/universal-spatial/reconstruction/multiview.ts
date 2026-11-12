import { BufferGeometry, Vector3 } from 'three';
import { surfaceNets } from '../fidelity/surface-nets';
import { gridFor, makeView, type Grid, type View } from './silhouette';

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
/** A pinhole camera for a SQUARE image of side `res`: pixel column u = fx*Xc/Zc + cx, row w = fy*Yc/Zc + cy (row grows downward, like a photograph); [Xc,Yc,Zc] = R*p + t, R row-major world->camera. */
export type PinholeCamera = { fx: number; fy: number; cx: number; cy: number; R: readonly number[]; t: readonly number[] };
export type SilhouetteView = {
  /** when present the view is a real perspective camera (poses from a dataset or from SfM); azimuth/elevation are then ignored */
  camera?: PinholeCamera;
  /** orbit view seen through a perspective camera of this horizontal field of view (degrees), rebuilt from the view's own azimuth/elevation every time, so pose refinement stays consistent; absent = orthographic */
  fovDeg?: number;
  /** vertical shift of the principal point in window pixels (the window is centred on the silhouettes, not on the optical axis); only with fovDeg */
  principalShiftPx?: number;
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

type Basis = { pin?: PinholeCamera; right: [number, number, number]; up: [number, number, number]; s: number; half: number; res: number; centre: [number, number, number]; mask: Uint8Array };
/** Basis of a view: perspective when it carries a camera, orthographic orbit otherwise. */
const cameraOf = (v: SilhouetteView, frame: Frame): PinholeCamera | undefined => { if (v.camera) return v.camera; if (!v.fovDeg) return undefined; const c = orbitPinhole(v.azimuthDeg, v.elevationDeg, v.fovDeg, v.res, frame.half, frame.centre); return v.principalShiftPx ? { ...c, cy: c.cy + v.principalShiftPx } : c; };
const basisForView = (v: SilhouetteView, frame: Frame, mask: Uint8Array): Basis => { const cam = cameraOf(v, frame); return cam ? { pin: cam, right: [1, 0, 0], up: [0, 1, 0], s: v.res / (2 * frame.half), half: frame.half, res: v.res, centre: [0, 0, 0], mask } : basisOf(viewOf(v, frame), mask); };
/**
 * What every consumer of a view needs, orthographic or perspective: where a world point lands in the view's pixels, and the unit vector from that point toward the
 * camera (constant for an orthographic orbit, point-dependent for a perspective one). Colour sampling, visibility and predicted silhouettes use this instead of
 * assuming parallel rays.
 */
export type ViewProjector = { project(x: number, y: number, z: number): [number, number] | null; towardCamera(x: number, y: number, z: number, out?: Vector3): Vector3 };
export function viewProjector(v: SilhouetteView, frame: Frame): ViewProjector {
  const b = basisForView(v, frame, v.mask), cam = b.pin, d = orbitDirection(v.azimuthDeg, v.elevationDeg), res = v.res;
  if (!cam) return { project: (x, y, z) => { proj(b, x, y, z); return Number.isNaN(U) ? null : [U, W]; }, towardCamera: (_x, _y, _z, out = new Vector3()) => out.copy(d) };
  const R = cam.R, pos = new Vector3(-(R[0]! * cam.t[0]! + R[3]! * cam.t[1]! + R[6]! * cam.t[2]!), -(R[1]! * cam.t[0]! + R[4]! * cam.t[1]! + R[7]! * cam.t[2]!), -(R[2]! * cam.t[0]! + R[5]! * cam.t[1]! + R[8]! * cam.t[2]!));
  return { project: (x, y, z) => { proj(b, x, y, z); return Number.isNaN(U) || U < -res || W < -res || U > 2 * res || W > 2 * res ? null : [U, W]; }, towardCamera: (x, y, z, out = new Vector3()) => out.set(pos.x - x, pos.y - y, pos.z - z).normalize() };
}
/** Projects a world point into pixel (U, W); U = NaN when behind the camera. Writes module variables to avoid allocation in the hot loops. */
let U = 0, W = 0;
function proj(b: Basis, x: number, y: number, z: number): void {
  if (b.pin) { const c = b.pin, R = c.R, X = R[0]! * x + R[1]! * y + R[2]! * z + c.t[0]!, Y = R[3]! * x + R[4]! * y + R[5]! * z + c.t[1]!, Z = R[6]! * x + R[7]! * y + R[8]! * z + c.t[2]!; if (Z <= 1e-9) { U = NaN; W = NaN; return; } U = c.fx * X / Z + c.cx; W = c.fy * Y / Z + c.cy; return; }
  const dx = x - b.centre[0], dy = y - b.centre[1], dz = z - b.centre[2];
  U = (dx * b.right[0] + dy * b.right[1] + dz * b.right[2] + b.half) * b.s; W = (dx * b.up[0] + dy * b.up[1] + dz * b.up[2] + b.half) * b.s;
}
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
      const b = bases[v]!; proj(b, px, py, pz); const u = Math.floor(U), w = Math.floor(W);
      if (!(u >= 0) || !(w >= 0) || u >= b.res || w >= b.res || !b.mask[w * b.res + u]) { inside = 0; break; }
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
    proj(b, grid.min.x + (i + 0.5) * g, grid.min.y + (j + 0.5) * g, grid.min.z + (k + 0.5) * g); if (!(U >= 0)) continue;
    const u = Math.floor(U), w = Math.floor(W), rr = b.pin ? Math.max(0, Math.ceil((g * b.pin.fx) / (2 * Math.max(1e-9, (b.pin.R[6]! * (grid.min.x + (i + 0.5) * g) + b.pin.R[7]! * (grid.min.y + (j + 0.5) * g) + b.pin.R[8]! * (grid.min.z + (k + 0.5) * g) + b.pin.t[2]!))))) : r;
    for (let y = Math.max(0, w - rr); y <= Math.min(b.res - 1, w + rr); y++) for (let x = Math.max(0, u - rr); x <= Math.min(b.res - 1, u + rr); x++) out[y * b.res + x] = 1;
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
  const bases = views.map((v) => basisForView(v, options.frame, dilateMask(v.mask, v.res, options.dilatePx ?? 0)));
  const occupancy = carveFast(grid, bases);
  const [nx, ny, nz] = grid.cells;
  let occupied = 0, clipped = false;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (occupancy[i + nx * (j + ny * k)]) { occupied++; if (i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1) clipped = true; }
  // O contorno toca a fronteira da janela: o casco seria cortado. Esvazia a casca exterior para manter a malha fechada, e declara-o.
  if (clipped) for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1) occupancy[i + nx * (j + ny * k)] = 0;
  // The surface comes from the CONTINUOUS hull field (exact cone intersection), not from the voxel occupancy: measured on the development assets it lowers the
  // surface error and raises held-out silhouette agreement (reports/reality-engine/benchmark), most on thin structures and planar faces.
  const geometry = occupied ? surfaceNets({ min: grid.min, cells: grid.cells, size: grid.size, field: hullField(views, options.frame, options.dilatePx ?? 0), maxTriangles: 400_000 }) : new BufferGeometry();
  const pos = geometry.getAttribute('position'), vertexCount = pos ? pos.count : 0;

  const contours = bases.map((b) => contourOf(b.mask, b.res));
  const tol = Math.max(1.5, grid.size * bases[0]!.s), rad = Math.ceil(tol);
  const vertexSupport = new Uint8Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    const px = pos!.getX(i), py = pos!.getY(i), pz = pos!.getZ(i);
    let count = 0;
    for (let v = 0; v < bases.length; v++) {
      const b = bases[v]!; proj(b, px, py, pz); if (!(U >= 0)) continue; const u = Math.round(U), w = Math.round(W);
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
  const basesOf = (vs: SilhouetteView[]) => vs.map((v) => basisForView(v, options.frame, v.mask));
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
      const score = (az: number) => iou(views[v]!.mask, splat(grid, reference, basisForView({ ...views[v]!, azimuthDeg: az }, options.frame, views[v]!.mask)));
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
  const grid = gridFor(options.frame.centre, options.frame.half, options.cells ?? 64), bases = views.map((v) => basisForView(v, options.frame, v.mask));
  return views.map((v, i) => iou(v.mask, splat(grid, carveFast(grid, bases, i), bases[i]!)));
}

/** Silhouette of an occupancy grid as seen by a pose (voxel-footprint splat): what the current solid predicts for a view. */
export function hullSilhouette(grid: Grid, occupancy: Uint8Array, pose: Pick<SilhouetteView, 'azimuthDeg' | 'elevationDeg' | 'res'> & Partial<Pick<SilhouetteView, 'fovDeg' | 'principalShiftPx' | 'camera'>>, frame: Frame): Uint8Array {
  return splat(grid, occupancy, basisForView({ id: 'p', mask: new Uint8Array(pose.res * pose.res), azimuthSource: 'given', ...pose }, frame, new Uint8Array(pose.res * pose.res)));
}
export const maskIoUFast = iou;

/** Exact 2D Euclidean distance transform (Felzenszwalb-Huttenlocher), squared distances to the nearest pixel with value `target`. */
function edt(mask: Uint8Array, res: number, target: 0 | 1): Float32Array {
  const INF = 1e12, f = new Float32Array(res * res), d = new Float32Array(res * res);
  for (let i = 0; i < f.length; i++) f[i] = mask[i] === target ? 0 : INF;
  const v = new Int32Array(res), z = new Float32Array(res + 1), col = new Float32Array(res), out = new Float32Array(res);
  const pass = (get: (i: number) => number, set: (i: number, value: number) => void) => {
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < res; q++) {
      let sIntersect: number;
      for (;;) { const p = v[k]!; sIntersect = ((get(q) + q * q) - (get(p) + p * p)) / (2 * q - 2 * p); if (sIntersect <= z[k]! && k > 0) k--; else break; }
      if (sIntersect <= z[k]!) { v[0] = q; z[0] = -INF; z[1] = INF; k = 0; continue; }
      k++; v[k] = q; z[k] = sIntersect; z[k + 1] = INF;
    }
    k = 0; for (let q = 0; q < res; q++) { while (z[k + 1]! < q) k++; const p = v[k]!; set(q, (q - p) * (q - p) + get(p)); }
  };
  for (let x = 0; x < res; x++) { for (let y = 0; y < res; y++) col[y] = f[y * res + x]!; pass((i) => col[i]!, (i, val) => { out[i] = val; }); for (let y = 0; y < res; y++) d[y * res + x] = out[y]!; }
  const row = new Float32Array(res);
  for (let y = 0; y < res; y++) { for (let x = 0; x < res; x++) row[x] = d[y * res + x]!; pass((i) => row[i]!, (i, val) => { out[i] = val; }); for (let x = 0; x < res; x++) f[y * res + x] = out[x]!; }
  return f;
}
/** Signed distance of a silhouette in pixels: negative inside, positive outside, zero on the boundary midway between pixel centres. */
export function signedDistance2D(mask: Uint8Array, res: number): Float32Array {
  const toOutside = edt(mask, res, 0), toInside = edt(mask, res, 1), out = new Float32Array(res * res);
  for (let i = 0; i < out.length; i++) out[i] = mask[i] ? -(Math.sqrt(toOutside[i]!) - 0.5) : Math.sqrt(toInside[i]!) - 0.5;
  return out;
}

/**
 * The visual hull as a CONTINUOUS field: the largest of the per-view silhouette distances (negative = inside every cone). Its zero set is the exact
 * intersection of the viewing cones, so planar faces and edges are kept where a voxel grid would stair-step and blur them.
 */
export function hullField(views: readonly SilhouetteView[], frame: Frame, dilatePx = 0): (x: number, y: number, z: number) => number {
  validate(views);
  const res = views[0]!.res, per = views.map((v) => { const b = basisForView(v, frame, v.mask); return { b, sdf: signedDistance2D(dilateMask(v.mask, res, dilatePx), res) }; });
  const at = (sdf: Float32Array, u: number, w: number): number => {
    // bilinear in pixel-centre coordinates; outside the window the nearest border value plus the distance to it (always "outside" only if the border is outside)
    const fx = Math.min(res - 1, Math.max(0, u - 0.5)), fy = Math.min(res - 1, Math.max(0, w - 0.5)), x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(res - 1, x0 + 1), y1 = Math.min(res - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
    const v = (sdf[y0 * res + x0]! * (1 - tx) + sdf[y0 * res + x1]! * tx) * (1 - ty) + (sdf[y1 * res + x0]! * (1 - tx) + sdf[y1 * res + x1]! * tx) * ty;
    const ox = u < 0 ? -u : u > res ? u - res : 0, oy = w < 0 ? -w : w > res ? w - res : 0;
    return ox || oy ? Math.max(v, 0) + Math.hypot(ox, oy) : v;
  };
  return (x, y, z) => {
    let m = -Infinity;
    for (const { b, sdf } of per) {
      proj(b, x, y, z); const value = Number.isNaN(U) ? 1e6 : at(sdf, U, W); // behind the camera: outside
      if (value > m) m = value;
    }
    return m;
  };
}

/** Camera looking at `target` from `position` (world), y up; square image of side `res`, horizontal field of view `fovDeg`. Row grows downward. */
export function lookAtCamera(position: Vector3, target: Vector3, res: number, fovDeg: number): PinholeCamera {
  const f = new Vector3().subVectors(target, position).normalize(), right = new Vector3().crossVectors(f, new Vector3(0, 1, 0)); if (right.lengthSq() < 1e-9) right.set(1, 0, 0); right.normalize();
  const down = new Vector3().crossVectors(f, right).normalize(); // camera Y axis points down in the image
  const R = [right.x, right.y, right.z, down.x, down.y, down.z, f.x, f.y, f.z], t = [-right.dot(position), -down.dot(position), -f.dot(position)], focal = res / 2 / Math.tan((fovDeg * Math.PI) / 360);
  return { fx: focal, fy: focal, cx: res / 2, cy: res / 2, R, t };
}
/** Rasterises triangles seen by a pinhole camera into a res x res mask (triangles clipped at the near plane are skipped). */
export function rasterisePinhole(tris: ReadonlyArray<readonly [Vector3, Vector3, Vector3]>, cam: PinholeCamera, res: number): Uint8Array {
  const mask = new Uint8Array(res * res), R = cam.R, P = (v: Vector3) => { const X = R[0]! * v.x + R[1]! * v.y + R[2]! * v.z + cam.t[0]!, Y = R[3]! * v.x + R[4]! * v.y + R[5]! * v.z + cam.t[1]!, Z = R[6]! * v.x + R[7]! * v.y + R[8]! * v.z + cam.t[2]!; return Z > 1e-6 ? [cam.fx * X / Z + cam.cx, cam.fy * Y / Z + cam.cy] as const : null; };
  for (const t of tris) {
    const a = P(t[0]), b = P(t[1]), c = P(t[2]); if (!a || !b || !c) continue;
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(res - 1, Math.ceil(Math.max(a[0], b[0], c[0]))), y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), y1 = Math.min(res - 1, Math.ceil(Math.max(a[1], b[1], c[1]))), d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(d) < 1e-12) continue;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const px = x + 0.5, py = y + 0.5, l1 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / d, l2 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / d; if (l1 >= -0.01 && l2 >= -0.01 && 1 - l1 - l2 >= -0.01) mask[y * res + x] = 1; }
  }
  return mask;
}

/**
 * Perspective camera of an orbit view in the SAME window convention as the orthographic one (window pixel (X, Y), Y growing upward, `half` = half window in length
 * units, one length unit = one image height measured at the rotation axis). The camera sits at distance D = 1 / (2 tan(fov / 2)) from the frame centre on the
 * orbit direction, so the axis plane keeps scale 1 image height per unit and `fovDeg` -> 0 converges to the orthographic window.
 */
export function orbitPinhole(azimuthDeg: number, elevationDeg: number, fovDeg: number, res: number, half: number, centre: Vector3 = new Vector3()): PinholeCamera {
  const d = orbitDirection(azimuthDeg, elevationDeg), worldUp = Math.abs(d.y) > 0.98 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
  const right = new Vector3().crossVectors(worldUp, d).normalize(), up = new Vector3().crossVectors(d, right).normalize(), f = d.clone().multiplyScalar(-1);
  const D = 1 / (2 * Math.tan((fovDeg * Math.PI) / 360)), pos = centre.clone().addScaledVector(d, D), focal = D * (res / (2 * half));
  return { fx: focal, fy: focal, cx: res / 2, cy: res / 2, R: [right.x, right.y, right.z, up.x, up.y, up.z, f.x, f.y, f.z], t: [-right.dot(pos), -up.dot(pos), -f.dot(pos)] };
}
