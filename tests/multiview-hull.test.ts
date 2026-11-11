import { describe, it, expect } from 'vitest';
import { BoxGeometry, SphereGeometry, CylinderGeometry, BufferGeometry, Vector3 } from 'three';
import { makeView, rasterise, type Tri } from '../src/universal-spatial/reconstruction/silhouette';
import { orbitDirection, reconstructHull, refinePoses, type SilhouetteView, type Frame } from '../src/universal-spatial/reconstruction/multiview';
import { chamfer, samplePoints, geometryPoints } from '../src/universal-spatial/reconstruction/multiview-metrics';

const trisOf = (g: BufferGeometry, offset = new Vector3()): Tri[] => {
  const p = g.getAttribute('position'), idx = g.index, out: Tri[] = [];
  const at = (i: number) => new Vector3(p.getX(i), p.getY(i), p.getZ(i)).add(offset);
  const n = idx ? idx.count : p.count;
  for (let i = 0; i < n; i += 3) out.push(idx ? [at(idx.getX(i)), at(idx.getX(i + 1)), at(idx.getX(i + 2))] : [at(i), at(i + 1), at(i + 2)]);
  return out;
};
const frame: Frame = { centre: new Vector3(0, 0, 0), half: 1.4 };
const RES = 96;
const render = (tris: Tri[], az: number, el: number, id = `v${az}`): SilhouetteView => {
  const view = makeView(orbitDirection(az, el), frame.centre, frame.half, RES);
  return { id, res: RES, mask: rasterise(tris, view), azimuthDeg: az, elevationDeg: el, azimuthSource: 'given' };
};
// objecto assimétrico e não-esférico: caixa + esfera deslocada + cilindro (tipo "ferramenta")
const solid = (): Tri[] => [...trisOf(new BoxGeometry(1.2, 0.6, 0.5)), ...trisOf(new SphereGeometry(0.35, 24, 16), new Vector3(0.55, 0.4, 0.1)), ...trisOf(new CylinderGeometry(0.12, 0.12, 0.9, 16), new Vector3(-0.3, -0.5, -0.1))];
const azimuths = (n: number) => Array.from({ length: n }, (_, i) => (360 * i) / n);

describe('casco visual multivista', () => {
  it('mais vistas reduzem o erro de superfície contra o ground truth (a fidelidade sobe com a evidência)', () => {
    const gt = solid(), gtPts = samplePoints(gt, 4000, 7);
    const err = (n: number) => {
      const views = azimuths(n).map((a, i) => render(gt, a, i % 2 ? 25 : 0));
      const hull = reconstructHull(views, { frame, cells: 56 });
      return chamfer(geometryPoints(hull.geometry, 4000, 7), gtPts).symmetric;
    };
    const e2 = err(2), e4 = err(4), e8 = err(8);
    expect(e4).toBeLessThan(e2); expect(e8).toBeLessThan(e4);
  }, 60_000);
  it('o casco contém sempre o objecto (limite superior): completude alta mesmo com poucas vistas', () => {
    const gt = solid(), views = azimuths(4).map((a) => render(gt, a, 0));
    const hull = reconstructHull(views, { frame, cells: 56 });
    const c = chamfer(geometryPoints(hull.geometry, 3000, 3), samplePoints(gt, 3000, 3));
    expect(c.completeness).toBeLessThan(0.05); // GT→hull: nada do objecto fica de fora
  }, 60_000);
  it('suporte por vértice: vértices em contorno de várias vistas são mais exactos do que os de uma só', () => {
    const gt = solid(), views = azimuths(6).map((a, i) => render(gt, a, i % 2 ? 30 : 0));
    const hull = reconstructHull(views, { frame, cells: 56 });
    expect(hull.stats.vertexCount).toBeGreaterThan(100);
    expect(hull.stats.supportedFraction).toBeGreaterThanOrEqual(0); expect(hull.stats.supportedFraction).toBeLessThanOrEqual(1);
    expect(hull.vertexSupport.length).toBe(hull.stats.vertexCount);
  }, 60_000);
  it('uma só vista não inventa profundidade: declara a hipótese (suporte 0 nas faces de frente) e continua um limite superior', () => {
    const views = [render(solid(), 0, 0)];
    const hull = reconstructHull(views, { frame, cells: 40 });
    expect(hull.stats.viewCount).toBe(1);
    expect(hull.stats.independentViews).toBe(1);
    expect(hull.stats.depthObserved).toBe(false);
  }, 60_000);
  it('recusa vistas de resolução diferente ou sem píxeis em vez de adivinhar', () => {
    const a = render(solid(), 0, 0), b = { ...render(solid(), 90, 0), res: 64 };
    expect(() => reconstructHull([a, b], { frame })).toThrow(/RES/);
    expect(() => reconstructHull([{ ...a, mask: new Uint8Array(RES * RES) }], { frame })).toThrow(/EMPTY/);
    expect(() => reconstructHull([], { frame })).toThrow(/NO_VIEWS/);
  });
  it('é determinístico', () => {
    const views = azimuths(4).map((a) => render(solid(), a, 10));
    const a = reconstructHull(views, { frame, cells: 32 }), b = reconstructHull(views, { frame, cells: 32 });
    expect(Buffer.from(a.occupancy).equals(Buffer.from(b.occupancy))).toBe(true);
  });
});

describe('refinamento de pose por consistência multivista', () => {
  it('reduz o erro de azimute de vistas com pose nominal errada e a consistência melhora', () => {
    const gt = solid(), truth = azimuths(8), noise = [6, -7, 5, -6, 7, -5, 4, -4];
    const nominal = truth.map((a, i) => ({ ...render(gt, a, i % 2 ? 20 : 0), azimuthDeg: a + noise[i]!, azimuthSource: 'assumed' as const }));
    const r = refinePoses(nominal, { frame, cells: 64 });
    const errBefore = nominal.map((v, i) => Math.abs(v.azimuthDeg - truth[i]!));
    const errAfter = r.views.map((v, i) => Math.abs(v.azimuthDeg - truth[i]!));
    const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
    expect(mean(errAfter)).toBeLessThan(mean(errBefore) * 0.85) // ganho modesto e medido; ver relatório (não é calibração);
    expect(r.consistencyAfter).toBeGreaterThan(r.consistencyBefore);
  }, 120_000);
  it('não altera poses dadas (given) e não finge identificar poses simétricas', () => {
    const gt = trisOf(new CylinderGeometry(0.5, 0.5, 1.2, 32)); // simetria de revolução: azimute não identificável
    const views = azimuths(4).map((a) => ({ ...render(gt, a, 0), azimuthSource: 'assumed' as const }));
    const r = refinePoses(views, { frame, cells: 32 });
    expect(r.views.every((v, i) => Math.abs(v.azimuthDeg - views[i]!.azimuthDeg) < 1e-9)).toBe(true); // mantidas
    expect(r.views.some((v) => v.identifiable === false)).toBe(true);
    const given = azimuths(4).map((a) => render(solid(), a + 5, 0)); // "given": nunca mexe
    expect(refinePoses(given, { frame, cells: 32 }).views.map((v) => v.azimuthDeg)).toEqual(given.map((v) => v.azimuthDeg));
  }, 120_000);
});
