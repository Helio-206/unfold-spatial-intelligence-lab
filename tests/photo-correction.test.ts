import { describe, it, expect } from 'vitest';
import { extractEvidence, polygonMask, silhouetteIoU, type RGBA } from '../src/living/universal-foundry/evidence';
import { correctedEvidence, initialOutlineFromEvidence } from '../src/living/universal-foundry/correction';
import { assessSilhouetteReliability, fitGeometryToEvidence } from '../src/living/universal-foundry/fitting';
import { FoundryGeometry } from '../src/living/universal-foundry/provider';
import { validateSpatialPlanV2, type SpatialPlanV2 } from '../src/universal-spatial/contracts-v2';
import { spatialPlanFingerprintV2 } from '../src/universal-spatial/api-client';
import { sedan } from '../src/living/universal-foundry/fixtures/plans';

function carImage(): RGBA {
  const width = 200, height = 100, data = new Uint8ClampedArray(width * height * 4);
  const body = { x0: 40, y0: 55, x1: 160, y1: 85 }, cabin = { x0: 58, y0: 22, x1: 142, y1: 55 };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, inside = (x >= body.x0 && x <= body.x1 && y >= body.y0 && y <= body.y1) || (x >= cabin.x0 && x <= cabin.x1 && y >= cabin.y0 && y <= cabin.y1);
    const [r, g, b] = inside ? [30, 90, 40] : [240, 240, 240];
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  return { width, height, data };
}
const CAR_POLYGON: Array<[number, number]> = [[0.2, 0.55], [0.29, 0.22], [0.71, 0.22], [0.8, 0.55], [0.8, 0.85], [0.68, 0.85], [0.66, 0.72], [0.34, 0.72], [0.32, 0.85], [0.2, 0.85]];

describe('correcção de contorno', () => {
  it('contorno inicial editável nasce da máscara automática e fica dentro da imagem', () => {
    const ev = extractEvidence(carImage());
    const outline = initialOutlineFromEvidence(ev);
    expect(outline.length).toBeGreaterThanOrEqual(6);
    for (const [x, y] of outline) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(1); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(1); }
  });
  it('máscara corrigida coincide com o polígono confirmado e passa a fiabilidade', () => {
    const ev = extractEvidence(carImage());
    const corrected = correctedEvidence(ev, { polygon: CAR_POLYGON, confirmedAt: '2026-11-05T00:00:00.000Z', provenance: 'user_confirmed' });
    const truth = polygonMask(CAR_POLYGON, ev.width, ev.height);
    expect(silhouetteIoU(corrected.mask, truth)).toBe(1);
    expect(corrected.largestComponentShare).toBe(1);
    expect(assessSilhouetteReliability(corrected).reliable).toBe(true);
    // e o fitting já não recusa por máscara: pode ajustar ou recusar por DOF, nunca por fiabilidade
    const result = fitGeometryToEvidence(sedan(), corrected);
    if (result.status === 'insufficient_evidence') expect(result.reason).not.toMatch(/não fiável/);
  }, 60_000);
  it('provider: proveniência user_confirmed distinguível e stale após nova evidência', async () => {
    const plan: SpatialPlanV2 = validateSpatialPlanV2({ ...sedan(), source: { kind: 'image', sha256: 'c'.repeat(64) } });
    const provider = new FoundryGeometry(null);
    const ev = extractEvidence(carImage());
    const fingerprint = await spatialPlanFingerprintV2(plan);
    const binding = { plan, planFingerprint: fingerprint, sourceSha256: plan.source.sha256, originalSha256: 'd'.repeat(64), preparedSha256: plan.source.sha256, preparation: 'test', generationId: 'g1', recipeVersion: 1 as const };
    await provider.setEvidence(ev, { ...binding, correctedMask: { polygon: CAR_POLYGON, confirmedAt: '2026-11-05T00:00:00.000Z' } });
    const withCorrected = provider.compile(plan);
    expect(provider.maskProvenance).toBe('user_confirmed');
    expect(withCorrected.recipe?.unknowns.join(' ')).toMatch(/user_confirmed/);
    withCorrected.retire();
    // nova evidência sem correcção (outro upload): a máscara corrigida anterior não pode vazar
    await provider.setEvidence(ev, { ...binding, generationId: 'g2' });
    const automatic = provider.compile(plan);
    expect(provider.maskProvenance).toBe('automatic');
    expect(automatic.recipe?.unknowns.join(' ')).not.toMatch(/user_confirmed/);
    automatic.retire();
    provider.dispose();
  });
});
