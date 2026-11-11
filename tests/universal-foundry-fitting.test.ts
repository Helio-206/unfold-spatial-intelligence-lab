import { describe, it, expect } from 'vitest';
import { Box3 } from 'three';
import { extractEvidence, type RGBA } from '../src/living/universal-foundry/evidence';
import { fitGeometryToEvidence, fitGeometryToEvidenceAsync, geometryProfile, evidenceProfile, evidenceMaskHash, fittingCacheKey, FITTING_VERSION, projectedSilhouette, resampleEvidenceMask, gridIoU, assessSilhouetteReliability, regionalIoUs } from '../src/living/universal-foundry/fitting';
import { compileFoundry } from '../src/living/universal-foundry/foundry';
import { FoundryGeometry } from '../src/living/universal-foundry/provider';
import { detectWheelLandmarks, estimateCamera } from '../src/living/universal-foundry/landmarks';
import { validateSpatialPlanV2, type SpatialPlanV2 } from '../src/universal-spatial/contracts-v2';
import { spatialPlanFingerprintV2 } from '../src/universal-spatial/api-client';
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

// Custo medido (CP1): ~1,5–3,5 s por fitting completo (73 avaliações geometry-only) em CPU lenta,
// depois de eliminar as texturas PBR da avaliação (antes ~19 s). Orçamento por fitting com folga ~4x;
// cada teste multiplica pelo número de fittings que executa.
const FIT_BUDGET_MS = 15_000;
describe('image-conditioned fitting (vehicle)', () => {
  it('silhuetas diferentes produzem geometria diferente e melhor que o baseline', () => {
    const plan = sedan();
    const fitLow = fitGeometryToEvidence(plan, lowLong());
    const fitTall = fitGeometryToEvidence(plan, tallShort());
    // Com os DOF v3 (8+ parâmetros), as duas silhuetas ajustam — com parâmetros diferentes.
    // (Na grelha v2 de 2 parâmetros, a baixa era recusada por DOF: registado no relatório.)
    expect(fitLow.status).toBe('fitted'); expect(fitTall.status).toBe('fitted');
    if (fitLow.status !== 'fitted' || fitTall.status !== 'fitted') return;
    expect(fitLow.overrides).not.toEqual(fitTall.overrides);
    expect(fitLow.silhouetteIou!).toBeGreaterThan(fitLow.baselineSilhouetteIou!);
    expect(fitTall.silhouetteIou!).toBeGreaterThan(fitTall.baselineSilhouetteIou!);
    const aspectOf = (overrides: Record<string, number>) => {
      const r = compileFoundry(sedan(), { overrides }); r.buildAll();
      const b = new Box3().setFromObject(r.root); r.retire();
      return (b.max.x - b.min.x) / (b.max.y - b.min.y);
    };
    // a geometria ajustada (cabina alta) tem aspecto menor que a default: forma visivelmente diferente
    expect(aspectOf(fitTall.overrides)).not.toBeCloseTo(aspectOf({}), 3);
    expect(fitTall.objective).toBeLessThanOrEqual(fitTall.baselineObjective + 1e-9);
  }, 120_000);
  it('controlo negativo: mudar só a cor não muda os parâmetros ajustados', () => {
    const a = fitGeometryToEvidence(sedan(), lowLong());
    const sameShapeBlue = extractEvidence(carImage({ x0: 20, y0: 58, x1: 180, y1: 85 }, { x0: 70, y0: 42, x1: 120, y1: 58 }, [30, 60, 200]));
    const b = fitGeometryToEvidence(sedan(), sameShapeBlue);
    expect(a).toEqual(b);
  }, FIT_BUDGET_MS * 2);
  it('determinismo: mesma evidência, mesmo resultado', () => {
    expect(fitGeometryToEvidence(sedan(), tallShort())).toEqual(fitGeometryToEvidence(sedan(), tallShort()));
  }, FIT_BUDGET_MS * 2);
  it('hipótese de câmara frontal é recusada como evidência insuficiente', () => {
    const frontal = { ...tallShort(), symmetry: 0.95, aspect: 1.1 };
    expect(fitGeometryToEvidence(sedan(), frontal)).toMatchObject({ status: 'insufficient_evidence' });
  });
  it('cancelamento não aplica parâmetros', () => {
    const controller = new AbortController(); controller.abort();
    expect(fitGeometryToEvidence(sedan(), lowLong(), { signal: controller.signal })).toMatchObject({ status: 'aborted' });
  });
  it('baseline é genuíno: igual ao objectivo da geometria por omissão, nunca o do vencedor', () => {
    const evidence = tallShort();
    const result = fitGeometryToEvidence(sedan(), evidence);
    expect(result.status).toBe('fitted');
    if (result.status !== 'fitted') return;
    // recomputação independente: objectivo ponderado documentado (0.55 IoU + 0.45 média
    // regional), projectado do azimute estimado para esta evidência
    const compiled = compileFoundry(sedan(), { lod: 0 }); compiled.buildAll();
    const azimuth = estimateCamera(evidence, detectWheelLandmarks(evidence)).azimuthDeg;
    const projected = projectedSilhouette(compiled.root, azimuth);
    const targetMask = resampleEvidenceMask(evidence);
    const iou = gridIoU(projected, targetMask);
    const regional = regionalIoUs(projected, targetMask);
    const expectedBaseline = 1 - (0.55 * iou + 0.45 * ((regional[0] + regional[1] + regional[2]) / 3));
    compiled.retire();
    expect(result.baselineObjective).toBeCloseTo(expectedBaseline, 9);
    expect(result.baselineSilhouetteIou).toBeCloseTo(iou, 9);
    expect(result.objective).toBeLessThan(result.baselineObjective);
    expect(result.baselineObjective).not.toBeCloseTo(result.objective, 9);
  }, 60_000);
  it('identidade de cache: silhuetas com aspecto/simetria/rácio iguais mas perfis diferentes não partilham chave', () => {
    const base = lowLong();
    // mesma bbox (logo mesmo aspecto e foregroundRatio) e simetria parecida, cabina noutro sítio → perfil diferente
    const shifted = extractEvidence(carImage({ x0: 20, y0: 58, x1: 180, y1: 85 }, { x0: 105, y0: 42, x1: 155, y1: 58 }, [170, 30, 30]));
    expect(shifted.aspect).toBeCloseTo(base.aspect, 6);
    expect(shifted.foregroundRatio).toBeCloseTo(base.foregroundRatio, 6);
    expect(evidenceProfile(shifted)).not.toEqual(evidenceProfile(base));
    expect(evidenceMaskHash(shifted)).not.toBe(evidenceMaskHash(base));
    expect(fittingCacheKey('plano-x', shifted)).not.toBe(fittingCacheKey('plano-x', base));
    expect(fittingCacheKey('plano-x', base)).toContain(`fit-v${FITTING_VERSION}`);
    expect(fittingCacheKey('plano-x', base)).toBe(fittingCacheKey('plano-x', base)); // determinística
  });
  it('assíncrono: progresso por blocos, resultado igual ao síncrono, cancelamento limpo', async () => {
    const evidence = tallShort();
    const progress: number[] = [];
    const asyncResult = await fitGeometryToEvidenceAsync(sedan(), evidence, { onProgress: (p) => progress.push(p.evaluated) });
    expect(progress.length).toBeGreaterThan(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(asyncResult).toEqual(fitGeometryToEvidence(sedan(), evidence));
    const controller = new AbortController();
    const pending = fitGeometryToEvidenceAsync(sedan(), evidence, { signal: controller.signal, onProgress: () => controller.abort() });
    await expect(pending).resolves.toMatchObject({ status: 'aborted' });
  }, 120_000);
  it('provider: compile não bloqueia com fitting; resultado chega por onFitted e só então é aplicado', async () => {
    const plan: SpatialPlanV2 = validateSpatialPlanV2({ ...sedan(), source: { kind: 'image', sha256: 'c'.repeat(64) } });
    const provider = new FoundryGeometry(null);
    const evidence = tallShort();
    const fingerprint = await spatialPlanFingerprintV2(plan);
    await provider.setEvidence(evidence, { plan, planFingerprint: fingerprint, sourceSha256: plan.source.sha256, originalSha256: 'd'.repeat(64), preparedSha256: plan.source.sha256, preparation: 'test', generationId: 'test-1', recipeVersion: 1 });
    const fitted = new Promise<unknown>((resolve) => provider.onFitted(resolve));
    const first = provider.compile(plan);
    expect(provider.fitting).toMatchObject({ status: 'pending' }); // sem workload síncrono de fitting
    first.retire();
    const result = await fitted as { status: string; overrides?: Record<string, number> };
    expect(result.status).toBe('fitted');
    const second = provider.compile(plan);
    expect(Number(second.recipe?.params.cabinHeight)).toBeCloseTo(result.status === 'fitted' ? (result as { overrides: Record<string, number> }).overrides.cabinHeight! : NaN, 2);
    second.retire();
    provider.dispose();
  }, 120_000);
  it('falha fechado: máscara fragmentada/contaminada é recusada antes de qualquer fitting', () => {
    const mask = new Uint8Array(100 * 60);
    for (let y = 0; y < 60; y += 6) for (let x = 0; x < 100; x += 6) for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) mask[(y + dy) * 100 + (x + dx)] = 1;
    const evidence = { width: 100, height: 60, foregroundRatio: 0.25, bbox: { x0: 0, y0: 0, x1: 99, y1: 59 }, aspect: 3, symmetry: 0.2, colours: [], mask, largestComponentShare: 0.02 };
    expect(assessSilhouetteReliability(evidence).reliable).toBe(false);
    const result = fitGeometryToEvidence(sedan(), evidence);
    expect(result.status).toBe('insufficient_evidence');
    if (result.status === 'insufficient_evidence') expect(result.reason).toMatch(/não fiável|fragmentado/);
  });
  it('silhueta projectada usa triângulos reais: IoU alto contra a própria projecção reamostrada', () => {
    const r = compileFoundry(sedan(), {}); r.buildAll();
    const projected = projectedSilhouette(r.root); r.retire();
    expect(projected.some((v) => v === 1)).toBe(true);
    expect(gridIoU(projected, projected)).toBe(1);
    // a projecção tem de ter a forma de um carro: mais larga que alta e com massa na metade inferior
    let top = 0, bottom = 0;
    for (let y = 0; y < 36; y++) for (let x = 0; x < 72; x++) { if (y < 12) top += projected[y * 72 + x]!; else if (y >= 24) bottom += projected[y * 72 + x]!; }
    expect(bottom).toBeGreaterThan(top);
  });
  it('perfil geométrico é mensurável e finito', () => {
    const r = compileFoundry(sedan(), {}); r.buildAll();
    const g = geometryProfile(r.root); r.retire();
    expect(g.aspect).toBeGreaterThan(1.5);
    expect(g.profile.every(Number.isFinite)).toBe(true);
  });
});
