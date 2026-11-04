import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { carve, gridFor, makeView, maskIoU, rasterise, viewDirections, type Tri } from '../src/universal-spatial/reconstruction/silhouette';

// a unit cube as triangles (ground truth with a known volume)
const cube = (h: number): Tri[] => {
  const v = (x: number, y: number, z: number) => new Vector3(x * h, y * h, z * h), q = (a: Vector3, b: Vector3, c: Vector3, d: Vector3): Tri[] => [[a, b, c], [a, c, d]];
  const p = [v(-1, -1, -1), v(1, -1, -1), v(1, 1, -1), v(-1, 1, -1), v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1)];
  return [...q(p[0]!, p[1]!, p[2]!, p[3]!), ...q(p[4]!, p[5]!, p[6]!, p[7]!), ...q(p[0]!, p[1]!, p[5]!, p[4]!), ...q(p[2]!, p[3]!, p[7]!, p[6]!), ...q(p[1]!, p[2]!, p[6]!, p[5]!), ...q(p[0]!, p[3]!, p[7]!, p[4]!)];
};

describe('silhouettes and visual hull', () => {
  it('a view along an axis sees a square of the right size', () => {
    const view = makeView(new Vector3(0, 0, 1), new Vector3(), 2, 64), mask = rasterise(cube(1), view), covered = mask.reduce((s, v) => s + v, 0);
    expect(covered).toBeGreaterThan(30 * 30); expect(covered).toBeLessThan(36 * 36);
  });

  it('carving a cube from three axis views gives back the cube (the exact case)', () => {
    const centre = new Vector3(), views = viewDirections(3).map((d) => makeView(d, centre, 2, 96)), masks = views.map((v) => rasterise(cube(1), v)), grid = gridFor(centre, 2, 32), occ = carve(grid, views, masks);
    const volume = occ.reduce((s, v) => s + v, 0) * grid.size ** 3; expect(volume).toBeGreaterThan(7); expect(volume).toBeLessThan(9.6); // true volume 8
  });

  it('one view leaves the depth unconstrained: the hull is a prism twice as long as the cube; three views remove it', () => {
    const centre = new Vector3(), grid = gridFor(centre, 2, 24), v1 = [makeView(new Vector3(0, 0, 1), centre, 2, 64)], v3 = viewDirections(3).map((d) => makeView(d, centre, 2, 64));
    const one = carve(grid, v1, v1.map((v) => rasterise(cube(1), v))).reduce((s, v) => s + v, 0), three = carve(grid, v3, v3.map((v) => rasterise(cube(1), v))).reduce((s, v) => s + v, 0);
    expect(one).toBe(2 * three);
  });

  it('identical masks have IoU 1 and disjoint masks 0', () => {
    const a = new Uint8Array([1, 1, 0, 0]), b = new Uint8Array([0, 0, 1, 1]); expect(maskIoU(a, a)).toBe(1); expect(maskIoU(a, b)).toBe(0);
  });
});
