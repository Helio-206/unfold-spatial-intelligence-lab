import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { gridFor } from '../src/universal-spatial/reconstruction/silhouette';
import { segmentParts } from '../src/universal-spatial/reconstruction/parts';

const N = 48, grid = gridFor(new Vector3(), 1, N);
const at = (i: number, j: number, k: number) => i + N * (j + N * k);
function solid(f: (x: number, y: number, z: number) => boolean): Uint8Array {
  const occ = new Uint8Array(N * N * N);
  for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) occ[at(i, j, k)] = f(grid.min.x + (i + 0.5) * grid.size, grid.min.y + (j + 0.5) * grid.size, grid.min.z + (k + 0.5) * grid.size) ? 1 : 0;
  return occ;
}
// halteres: duas esferas ligadas por um pescoço fino
const dumbbell = () => solid((x, y, z) => Math.hypot(x + 0.5, y, z) < 0.38 || Math.hypot(x - 0.5, y, z) < 0.38 || (Math.abs(x) < 0.6 && Math.hypot(y, z) < 0.07));
const ball = () => solid((x, y, z) => Math.hypot(x, y, z) < 0.6);

describe('segmentação em partes (watershed com persistência)', () => {
  it('separa duas massas ligadas por um pescoço fino', () => {
    const r = segmentParts(dumbbell(), grid);
    expect(r.parts.length).toBe(2);
    const xs = r.parts.map((p) => p.centroid.x).sort((a, b) => a - b);
    expect(xs[0]).toBeLessThan(-0.3); expect(xs[1]).toBeGreaterThan(0.3);
  });
  it('um sólido compacto fica numa única parte', () => {
    expect(segmentParts(ball(), grid).parts.length).toBe(1);
  });
  it('cobre todos os voxels ocupados exactamente uma vez e nenhum vazio', () => {
    const occ = dumbbell(), r = segmentParts(occ, grid); let covered = 0;
    for (let i = 0; i < occ.length; i++) { if (occ[i]) { expect(r.labels[i]).toBeGreaterThan(0); covered++; } else expect(r.labels[i]).toBe(0); }
    expect(r.parts.reduce((s, p) => s + p.voxels, 0)).toBe(covered);
  });
  it('identificadores estáveis e determinísticos (ordenados por posição), e adjacência declarada', () => {
    const a = segmentParts(dumbbell(), grid), b = segmentParts(dumbbell(), grid);
    expect(a.parts.map((p) => p.id)).toEqual(b.parts.map((p) => p.id));
    expect(a.parts.map((p) => p.id)).toEqual(['part-1', 'part-2']);
    expect(a.parts[0]!.centroid.x).toBeLessThan(a.parts[1]!.centroid.x);
    expect(a.adjacency).toEqual([['part-1', 'part-2']]);
  });
  it('limita o número de partes e funde as minúsculas', () => {
    const r = segmentParts(dumbbell(), grid, { maxParts: 1 });
    expect(r.parts.length).toBe(1);
    const tiny = solid((x, y, z) => Math.hypot(x, y, z) < 0.6 || Math.hypot(x - 0.65, y, z) < 0.05);
    const t = segmentParts(tiny, grid, { minVoxels: 40 });
    expect(t.parts.length).toBe(1); expect(t.discardedVoxels).toBeGreaterThan(0); // removido e declarado
  });
  it('limbs (opcional): um assento espesso e quatro pernas finas separam-se por abertura morfológica, e só se pedido', () => {
    const stool = solid((x, y, z) => (Math.abs(x) < 0.7 && Math.abs(y - 0.35) < 0.18 && Math.abs(z) < 0.5) || ([[-0.55, -0.35], [0.55, -0.35], [-0.55, 0.35], [0.55, 0.35]] as const).some(([lx, lz]) => Math.hypot(x - lx, z - lz) < 0.09 && y < 0.25 && y > -0.6));
    expect(segmentParts(stool, grid).parts.length).toBe(1); // a espessura sozinha não separa membros de espessura constante
    expect(segmentParts(stool, grid, { limbs: true }).parts.length).toBe(5);
  });
  it('vazio devolve zero partes sem lançar', () => {
    expect(segmentParts(new Uint8Array(N * N * N), grid).parts).toEqual([]);
  });
});
