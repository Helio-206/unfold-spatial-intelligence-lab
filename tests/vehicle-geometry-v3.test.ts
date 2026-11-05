import { describe, it, expect } from 'vitest';
import { Box3, Mesh } from 'three';
import { compileFoundry } from '../src/living/universal-foundry/foundry';
import { sedan, hatchback, suv } from '../src/living/universal-foundry/fixtures/plans';
import { projectedSilhouette, gridIoU, cameraHypothesis } from '../src/living/universal-foundry/fitting';

function build(plan: ReturnType<typeof sedan>, overrides: Record<string, number> = {}) {
  const r = compileFoundry(plan, { overrides, lod: 0 });
  r.buildAll();
  return r;
}

describe('geometria vehicle v3', () => {
  it('malhas válidas: sem NaN, com normais, bbox finita e triângulos reais', () => {
    const r = build(sedan());
    let triangles = 0;
    r.root.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const pos = o.geometry.getAttribute('position');
      const normal = o.geometry.getAttribute('normal');
      expect(normal).toBeTruthy();
      for (let i = 0; i < pos.count; i += 37) {
        expect(Number.isFinite(pos.getX(i)) && Number.isFinite(pos.getY(i)) && Number.isFinite(pos.getZ(i))).toBe(true);
        expect(Number.isFinite(normal.getX(i))).toBe(true);
      }
      triangles += (o.geometry.index ? o.geometry.index.count : pos.count) / 3;
    });
    expect(triangles).toBeGreaterThan(1000);
    const box = new Box3().setFromObject(r.root);
    expect([box.min.x, box.max.x, box.max.y].every(Number.isFinite)).toBe(true);
    r.retire();
  });
  it('arquétipos diferenciam-se na forma projectada (hatchback ≠ SUV ≠ sedan)', () => {
    const sil = (p: ReturnType<typeof sedan>) => { const r = build(p); const s = projectedSilhouette(r.root); r.retire(); return s; };
    const a = sil(sedan()), b = sil(hatchback()), c = sil(suv());
    expect(gridIoU(a, b)).toBeLessThan(0.97);
    expect(gridIoU(a, c)).toBeLessThan(0.97);
    expect(gridIoU(b, c)).toBeLessThan(0.99);
  });
  it('os novos DOF mudam a silhueta de forma independente e interpretável', () => {
    const iouWith = (overrides: Record<string, number>) => { const r = build(sedan(), overrides); const s = projectedSilhouette(r.root); r.retire(); return s; };
    const base = iouWith({});
    expect(gridIoU(base, iouWith({ hoodHeight: 0.7 }))).toBeLessThan(0.98);
    expect(gridIoU(base, iouWith({ tailHeight: 0.7 }))).toBeLessThan(0.98);
    expect(gridIoU(base, iouWith({ bodyHeightScale: 1.08 }))).toBeLessThan(0.999);
    expect(gridIoU(base, iouWith({ wheelScale: 1.12 }))).toBeLessThan(0.995);
    // mudar só um parâmetro de detalhe (raios) não pode deformar a carroçaria
    expect(gridIoU(base, iouWith({ spokes: 8 }))).toBeGreaterThan(0.98);
  });
  it('hipóteses de câmara: frontais recusadas, lateral e três-quartos declaradas', () => {
    const base = { width: 100, height: 60, foregroundRatio: 0.3, bbox: { x0: 10, y0: 10, x1: 90, y1: 50 }, colours: [], mask: new Uint8Array(6000), largestComponentShare: 1 };
    expect(cameraHypothesis({ ...base, aspect: 1.2, symmetry: 0.9 }).kind).toBe('front-rear');
    expect(cameraHypothesis({ ...base, aspect: 2.8, symmetry: 0.3 }).kind).toBe('side');
    expect(cameraHypothesis({ ...base, aspect: 2.0, symmetry: 0.4 }).kind).toBe('three-quarter');
  });
});
