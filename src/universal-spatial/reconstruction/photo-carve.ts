import { Vector3 } from 'three';
import type { Grid } from './silhouette';
import { orbitDirection, signedDistance2D, type Frame, type SilhouetteView } from './multiview';
import { rgbToLab, type ColourView } from './appearance-parts';

/**
 * Photo-consistency carving (voxel colouring in the Kutulakos-Seitz spirit) on top of the visual hull. The hull is an upper bound of the shape: it cannot remove
 * concavities that no silhouette shows. A surface voxel that several photographs SEE but that looks different in them cannot be one opaque surface point,
 * so it is carved. Conservative by design: a voxel needs >= minViews views, colour spread is measured in chroma-weighted Lab by median absolute deviation
 * (a specular highlight or a pose error in one view does not carve), and the carve is bounded by `maxRemovedShare` of the hull so a bad colour source
 * cannot eat the object. Returns a NEW occupancy; the hull stays the declared fallback.
 */
export type CarveOptions = { minViews?: number; threshold?: number; passes?: number; lightnessWeight?: number; maxRemovedShare?: number; marginPx?: number };
export type CarveResult = { occupancy: Uint8Array; removed: number; removedShare: number; passes: number };
const OFFS6: Array<[number, number, number]> = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

export function photoCarve(views: readonly ColourView[], hull: Uint8Array, grid: Grid, frame: Frame, res: number, options: CarveOptions = {}): CarveResult {
  const [nx, ny, nz] = grid.cells, N = hull.length, occ = hull.slice(), half = frame.half, minViews = options.minViews ?? 3, thr = options.threshold ?? 14, wL = options.lightnessWeight ?? 0.3, passes = options.passes ?? 3, marginPx = options.marginPx ?? 2.5;
  let hullCount = 0; for (let i = 0; i < N; i++) hullCount += hull[i]!; const cap = Math.floor((options.maxRemovedShare ?? 0.12) * hullCount);
  const bases = views.map((cv) => { const d = orbitDirection(cv.view.azimuthDeg, cv.view.elevationDeg), wu = Math.abs(d.y) > 0.98 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0), right = new Vector3().crossVectors(wu, d).normalize(), up = new Vector3().crossVectors(d, right).normalize(); return { d, right, up }; });
  const sdfs = views.map((cv) => (cv.colour ? signedDistance2D(cv.view.mask, res) : null));
  let removedTotal = 0, done = 0;
  for (let pass = 0; pass < passes; pass++) {
    // visibility by depth buffers of the CURRENT solid
    const depth = views.map((cv, vi) => { if (!cv.colour) return null; const cr = cv.colourRes, b = bases[vi]!, buf = new Float32Array(cr * cr).fill(-Infinity);
      for (let cw = 0; cw < cr; cw++) for (let cu = 0; cu < cr; cu++) { const a = ((cu + 0.5) / cr) * 2 * half - half, c2 = ((cw + 0.5) / cr) * 2 * half - half, base = frame.centre.clone().addScaledVector(b.right, a).addScaledVector(b.up, c2);
        for (let t = half * 1.8; t > -half * 1.8; t -= grid.size * 0.5) { const i = Math.floor((base.x + b.d.x * t - grid.min.x) / grid.size), j = Math.floor((base.y + b.d.y * t - grid.min.y) / grid.size), k = Math.floor((base.z + b.d.z * t - grid.min.z) / grid.size); if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) continue; if (occ[i + nx * (j + ny * k)]) { buf[cw * cr + cu] = t; break; } } }
      return buf; });
    const candidates: Array<{ id: number; spread: number }> = [];
    for (let id = 0; id < N; id++) {
      if (!occ[id]) continue; const i = id % nx, j = Math.floor(id / nx) % ny, k = Math.floor(id / (nx * ny)); let surface = false; for (const [dx, dy, dz] of OFFS6) { const a = i + dx, b2 = j + dy, c = k + dz; if (a < 0 || b2 < 0 || c < 0 || a >= nx || b2 >= ny || c >= nz || !occ[a + nx * (b2 + ny * c)]) { surface = true; break; } } if (!surface) continue;
      const p = new Vector3(grid.min.x + (i + 0.5) * grid.size, grid.min.y + (j + 0.5) * grid.size, grid.min.z + (k + 0.5) * grid.size).sub(frame.centre), lab: Array<[number, number, number]> = [];
      views.forEach((cv, vi) => { if (!cv.colour) return; const b = bases[vi]!, cr = cv.colourRes, a = p.dot(b.right), c2 = p.dot(b.up), t = p.dot(b.d), cu = Math.floor(((a + half) / (2 * half)) * cr), cw = Math.floor(((c2 + half) / (2 * half)) * cr); if (cu < 0 || cw < 0 || cu >= cr || cw >= cr) return;
        const dd = depth[vi]![cw * cr + cu]!; if (!(dd > -Infinity) || Math.abs(dd - t) > grid.size * 1.2) return; // not the first surface along this ray: hidden
        const mu = Math.min(res - 1, Math.floor((cu / cr) * res)), mw = Math.min(res - 1, Math.floor((cw / cr) * res)); if (sdfs[vi]![mw * res + mu]! > -marginPx) return;
        const q = (cw * cr + cu) * 3; lab.push(rgbToLab(cv.colour[q]!, cv.colour[q + 1]!, cv.colour[q + 2]!)); });
      if (lab.length < minViews) continue;
      const med = (ch: number) => { const s = lab.map((x) => x[ch]!).sort((x, y) => x - y); return s[Math.floor(s.length / 2)]!; }, mL = med(0), mA = med(1), mB = med(2);
      const dev = lab.map((x) => Math.hypot(Math.sqrt(wL) * (x[0] - mL), x[1] - mA, x[2] - mB)).sort((x, y) => x - y), mad = dev[Math.floor(dev.length / 2)]!;
      candidates.push({ id, spread: mad });
    }
    const bad = candidates.filter((c) => c.spread > thr).sort((a, b) => b.spread - a.spread); let removed = 0;
    for (const c of bad) { if (removedTotal + removed >= cap) break; occ[c.id] = 0; removed++; }
    removedTotal += removed; done = pass + 1; if (!removed) break;
  }
  return { occupancy: occ, removed: removedTotal, removedShare: hullCount ? removedTotal / hullCount : 0, passes: done };
}
export type { SilhouetteView };
