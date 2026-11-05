import { describe, it, expect } from 'vitest';
import { Box3 } from 'three';
import { extractEvidence, type RGBA } from '../src/living/universal-foundry/evidence';
import { fitGeometryToEvidence, geometryProfile } from '../src/living/universal-foundry/fitting';
import { compileFoundry } from '../src/living/universal-foundry/foundry';
import { sedan } from '../src/living/universal-foundry/fixtures/plans';

/** Silhueta lateral de carro: corpo + cabina deslocada (assimétrica, como uma vista lateral real). */
function carImage(body: { x0: number; y0: number; x1: number; y1: number }, cabin: { x0: number; y0: number; x1: number; y1: number }, colour: [number, number, number]): RGBA {
  const width = 200, height = 100, data = new Uint8ClampedArray(width * height * 4);
  const inRect = (x: number, y: number, r: typeof body) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, inside = inRect(x, y, body) || inRect(x, y, cabin);
    const [r, g, b] = inside ? colour : [240, 240, 240];
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  return { width, height, data };
}
const lowLong = () => extractEvidence(carImage({ x0: 20, y0: 58, x1: 180, y1: 85 }, { x0: 70, y0: 42, x1: 120, y1: 58 }, [170, 30, 30]));
const tallShort = () => extractEvidence(carImage({ x0: 40, y0: 55, x1: 160, y1: 85 }, { x0: 58, y0: 22, x1: 142, y1: 55 }, [30, 90, 40]));

describe('image-conditioned fitting (vehicle)', () => {
  it('silhuetas diferentes produzem geometria diferente e mais próxima da evidência', () => {
    const plan = sedan();
    const fitLow = fitGeometryToEvidence(plan, lowLong());
    const fitTall = fitGeometryToEvidence(plan, tallShort());
    expect(fitLow.status).toBe('fitted'); expect(fitTall.status).toBe('fitted');
    if (fitLow.status !== 'fitted' || fitTall.status !== 'fitted') return;
    expect(fitLow.overrides).not.toEqual(fitTall.overrides);
    const aspectOf = (overrides: Record<string, number>) => {
      const r = compileFoundry(sedan(), { overrides }); r.buildAll();
      const b = new Box3().setFromObject(r.root); r.retire();
      return (b.max.x - b.min.x) / (b.max.y - b.min.y);
    };
    const defaultAspect = aspectOf({});
    // o carro baixo/comprido deve ficar mais baixo (aspecto maior) do que o alto/curto
    expect(aspectOf(fitLow.overrides)).toBeGreaterThan(aspectOf(fitTall.overrides));
    void defaultAspect;
    if (fitLow.status === 'fitted') expect(fitLow.objective).toBeLessThanOrEqual(fitLow.baselineObjective + 1e-9);
  });
  it('controlo negativo: mudar só a cor não muda os parâmetros ajustados', () => {
    const a = fitGeometryToEvidence(sedan(), lowLong());
    const sameShapeBlue = extractEvidence(carImage({ x0: 20, y0: 58, x1: 180, y1: 85 }, { x0: 70, y0: 42, x1: 120, y1: 58 }, [30, 60, 200]));
    const b = fitGeometryToEvidence(sedan(), sameShapeBlue);
    expect(a).toEqual(b);
  });
  it('determinismo: mesma evidência, mesmo resultado', () => {
    expect(fitGeometryToEvidence(sedan(), tallShort())).toEqual(fitGeometryToEvidence(sedan(), tallShort()));
  });
  it('hipótese de câmara frontal é recusada como evidência insuficiente', () => {
    const frontal = { ...tallShort(), symmetry: 0.95, aspect: 1.1 };
    expect(fitGeometryToEvidence(sedan(), frontal)).toMatchObject({ status: 'insufficient_evidence' });
  });
  it('cancelamento não aplica parâmetros', () => {
    const controller = new AbortController(); controller.abort();
    expect(fitGeometryToEvidence(sedan(), lowLong(), { signal: controller.signal })).toMatchObject({ status: 'aborted' });
  });
  it('perfil geométrico é mensurável e finito', () => {
    const r = compileFoundry(sedan(), {}); r.buildAll();
    const g = geometryProfile(r.root); r.retire();
    expect(g.aspect).toBeGreaterThan(1.5);
    expect(g.profile.every(Number.isFinite)).toBe(true);
  });
});
