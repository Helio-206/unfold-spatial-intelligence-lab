import { describe, expect, it } from 'vitest';
import { Vector3, type BufferGeometry } from 'three';
import { surfaceNets, type Field } from '../src/universal-spatial/fidelity/surface-nets';

const sphere = (r: number): Field => (x, y, z) => Math.hypot(x, y, z) - r;
const torus = (R: number, r: number): Field => (x, y, z) => Math.hypot(Math.hypot(x, y) - R, z) - r;
const run = (field: Field, extent: number, cells: number, extra: Partial<Parameters<typeof surfaceNets>[0]> = {}) => surfaceNets({ min: new Vector3(-extent, -extent, -extent), cells: [cells, cells, cells], size: (2 * extent) / cells, field, ...extra });
const edgeUse = (g: BufferGeometry) => { const m = new Map<string, number>(), idx = g.index!; for (let t = 0; t < idx.count; t += 3) for (let e = 0; e < 3; e++) { const a = idx.getX(t + e), b = idx.getX(t + ((e + 1) % 3)), key = a < b ? `${a}_${b}` : `${b}_${a}`; m.set(key, (m.get(key) ?? 0) + 1); } return m; };

describe('surface nets', () => {
  it('turns a sphere into a closed surface close to the true radius with outward normals', () => {
    const g = run(sphere(1), 1.4, 24), p = g.getAttribute('position'), n = g.getAttribute('normal'); let worst = 0, outward = 0;
    for (let i = 0; i < p.count; i++) { const v = new Vector3().fromBufferAttribute(p, i); worst = Math.max(worst, Math.abs(v.length() - 1)); if (v.clone().normalize().dot(new Vector3().fromBufferAttribute(n, i)) > 0.9) outward++; }
    expect(worst).toBeLessThan((2 * 1.4) / 24); expect(outward / p.count).toBeGreaterThan(0.99);
    for (const uses of edgeUse(g).values()) expect(uses).toBe(2);
  });

  it('keeps the topology of a torus (Euler characteristic 0) and faces every triangle outward', () => {
    const g = run(torus(1, 0.35), 1.6, 40), vertices = g.getAttribute('position').count, edges = edgeUse(g).size, faces = g.index!.count / 3;
    expect(vertices - edges + faces).toBe(0);
    const pos = g.getAttribute('position'), idx = g.index!; let outward = 0;
    for (let t = 0; t < idx.count; t += 3) { const a = new Vector3().fromBufferAttribute(pos, idx.getX(t)), b = new Vector3().fromBufferAttribute(pos, idx.getX(t + 1)), c = new Vector3().fromBufferAttribute(pos, idx.getX(t + 2)); const n = b.clone().sub(a).cross(c.clone().sub(a)), centroid = a.clone().add(b).add(c).divideScalar(3); const radial = new Vector3(centroid.x, centroid.y, 0).normalize().multiplyScalar(1); if (n.dot(centroid.clone().sub(radial)) > 0) outward++; }
    expect(outward / faces).toBeGreaterThan(0.99);
  });

  it('keeps only the triangles a predicate accepts and drops unused vertices', () => {
    const all = run(sphere(1), 1.4, 20), half = run(sphere(1), 1.4, 20, { keep: (x) => x > 0 });
    expect(half.index!.count).toBeLessThan(all.index!.count * 0.6); expect(half.index!.count).toBeGreaterThan(0);
    const used = new Set<number>(); for (let i = 0; i < half.index!.count; i++) used.add(half.index!.getX(i)); expect(used.size).toBe(half.getAttribute('position').count);
  });

  it('stops at the triangle limit instead of growing without bound', () => {
    expect(() => run(sphere(1), 1.4, 40, { maxTriangles: 500 })).toThrow('SPATIAL_FIDELITY_GRID_LIMIT');
  });

  it('returns an empty geometry when the field never crosses zero', () => {
    expect(run(() => 5, 1, 8).index!.count).toBe(0);
  });
});
