import { Vector3 } from 'three';

/**
 * Calibrated orthographic silhouettes and multi-view visual-hull carving. This is the classical, resource-free baseline of the V4 reconstruction study:
 * it takes ONLY silhouettes and camera poses (what a person could provide as several views of an object) and returns a solid, so every number it
 * produces can be checked against a ground-truth solid. It is not the product path and it invents nothing: a voxel survives only if every view allows it.
 * Known limits (stated, measured in reports/fidelity-v4): concavities and holes invisible in every silhouette are filled; thin parts need views along them.
 */
export type Tri = [Vector3, Vector3, Vector3];
export type View = { direction: Vector3; up: Vector3; right: Vector3; /** half extent of the square window, world units */ half: number; centre: Vector3; res: number };

export function makeView(directionFromObject: Vector3, centre: Vector3, half: number, res: number): View {
  const direction = directionFromObject.clone().normalize(), worldUp = Math.abs(direction.y) > 0.98 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
  const right = new Vector3().crossVectors(worldUp, direction).normalize(), up = new Vector3().crossVectors(direction, right).normalize();
  return { direction, up, right, half, centre: centre.clone(), res };
}

/** Evenly spread viewing directions (Fibonacci sphere); `count` 3 gives the three principal axes instead. */
export function viewDirections(count: number): Vector3[] {
  if (count === 3) return [new Vector3(0, 0, 1), new Vector3(1, 0, 0), new Vector3(0, 1, 0)];
  const out: Vector3[] = [], golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) { const y = 1 - (2 * (i + 0.5)) / count, r = Math.sqrt(1 - y * y), a = i * golden; out.push(new Vector3(Math.cos(a) * r, y, Math.sin(a) * r)); }
  return out;
}

export const project = (view: View, p: Vector3): [number, number] => {
  const d = p.clone().sub(view.centre), s = view.res / (2 * view.half);
  return [(d.dot(view.right) + view.half) * s, (d.dot(view.up) + view.half) * s];
};

/** Rasterises triangles into a `res x res` mask (1 = covered). */
export function rasterise(tris: Tri[], view: View): Uint8Array {
  const res = view.res, mask = new Uint8Array(res * res);
  for (const t of tris) {
    const p = t.map((q) => project(view, q)) as [number, number][];
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

export function maskIoU(a: Uint8Array, b: Uint8Array): number { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { i += a[k]! & b[k]!; u += a[k]! | b[k]!; } return u ? i / u : 1; }

export type Grid = { min: Vector3; cells: [number, number, number]; size: number };
export const gridFor = (centre: Vector3, half: number, n: number): Grid => ({ min: centre.clone().subScalar(half), cells: [n, n, n], size: (2 * half) / n });

/** Occupancy of a grid by carving: a voxel centre survives iff it projects inside the silhouette of every view. Returns one byte per voxel (1 = inside). */
export function carve(grid: Grid, views: View[], masks: Uint8Array[]): Uint8Array {
  const [nx, ny, nz] = grid.cells, out = new Uint8Array(nx * ny * nz), p = new Vector3();
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    p.set(grid.min.x + (i + 0.5) * grid.size, grid.min.y + (j + 0.5) * grid.size, grid.min.z + (k + 0.5) * grid.size);
    let inside = 1;
    for (let v = 0; v < views.length && inside; v++) { const [u, w] = project(views[v]!, p), x = Math.floor(u), y = Math.floor(w); if (x < 0 || y < 0 || x >= views[v]!.res || y >= views[v]!.res || !masks[v]![y * views[v]!.res + x]) inside = 0; }
    out[i + nx * (j + ny * k)] = inside;
  }
  return out;
}

/** Smooth signed field from an occupancy grid (box blur of the occupancy, 0.5 iso): negative inside. Trilinear lookup in world coordinates. */
export function occupancyField(grid: Grid, occ: Uint8Array, blur = 1): (x: number, y: number, z: number) => number {
  const [nx, ny, nz] = grid.cells; let a = Float32Array.from(occ, (v) => v);
  for (let pass = 0; pass < blur; pass++) {
    const b = new Float32Array(a.length);
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      let s = 0, c = 0; for (let dk = -1; dk <= 1; dk++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj, kk = k + dk; if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) { c++; continue; } s += a[ii + nx * (jj + ny * kk)]!; c++; }
      b[i + nx * (j + ny * k)] = s / c;
    }
    a = b;
  }
  const at = (i: number, j: number, k: number) => (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? 0 : a[i + nx * (j + ny * k)]!);
  return (x, y, z) => {
    const fx = (x - grid.min.x) / grid.size - 0.5, fy = (y - grid.min.y) / grid.size - 0.5, fz = (z - grid.min.z) / grid.size - 0.5, i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz), tx = fx - i, ty = fy - j, tz = fz - k;
    const lerp = (p: number, q: number, t: number) => p + (q - p) * t;
    const c00 = lerp(at(i, j, k), at(i + 1, j, k), tx), c10 = lerp(at(i, j + 1, k), at(i + 1, j + 1, k), tx), c01 = lerp(at(i, j, k + 1), at(i + 1, j, k + 1), tx), c11 = lerp(at(i, j + 1, k + 1), at(i + 1, j + 1, k + 1), tx);
    return 0.5 - lerp(lerp(c00, c10, ty), lerp(c01, c11, ty), tz);
  };
}
