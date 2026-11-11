import { describe, it, expect } from 'vitest';
import { cameraEvidence } from '../src/living/universal-foundry/camera-evidence';
import type { CameraEstimate, WheelLandmarks } from '../src/living/universal-foundry/landmarks';
import { validateEvidenced } from '../src/core';

const pixelLandmarks: WheelLandmarks = { wheels: [], wheelbaseFraction: 0.5, missing: [], source: 'image-dark-regions', wheelRegions: [{ widthPx: 33, heightPx: 35 }] };
const silLandmarks: WheelLandmarks = { wheels: [], wheelbaseFraction: 0.5, missing: [], source: 'silhouette-contacts' };
const est = (over: Partial<CameraEstimate> = {}): CameraEstimate => ({ azimuthDeg: 12, uncertaintyDeg: 10, kind: 'side', method: 'excentricidade das regiões de pneu', ambiguous: false, ...over });

describe('evidência de câmara', () => {
  it('azimute por regiões de pneu é APPROXIMATED (incerteza declarada, não calibrada), nunca MEASURED', () => {
    const c = cameraEvidence(est(), pixelLandmarks, 'sha-img');
    expect(c.azimuthDeg.kind).toBe('approximated');
    expect(c.azimuthDeg.value).toBe(12);
    expect(c.azimuthDeg.uncertainty).toMatchObject({ quantified: true, plusMinus: 10, unit: 'deg', calibration: 'declared' });
    expect(validateEvidenced(c.azimuthDeg)).toEqual([]);
    expect(c.azimuthDeg.measurement!.assumptions.join(' ')).toMatch(/ortogr|circular/i);
  });
  it('azimute ambíguo, ou só com silhueta, é INFERRED', () => {
    expect(cameraEvidence(est({ ambiguous: true }), pixelLandmarks, 's').azimuthDeg.kind).toBe('inferred');
    expect(cameraEvidence(est({ ambiguous: true, uncertaintyDeg: 28 }), silLandmarks, 's').azimuthDeg.kind).toBe('inferred');
  });
  it('elevação, roll, FOV, escala e sentido (esquerda/direita) são UNKNOWN em todos os casos', () => {
    for (const [e, l] of [[est(), pixelLandmarks], [est({ ambiguous: true }), silLandmarks]] as const) {
      const c = cameraEvidence(e, l, 's');
      for (const f of [c.elevationDeg, c.rollDeg, c.fovDeg, c.scale, c.headingSign]) { expect(f.kind).toBe('unknown'); expect(f.value).toBeNull(); }
    }
  });
  it('imagens diferentes não herdam a mesma orientação: o valor segue a estimativa por foto', () => {
    const a = cameraEvidence(est({ azimuthDeg: 5 }), pixelLandmarks, 'a').azimuthDeg.value;
    const b = cameraEvidence(est({ azimuthDeg: 40, kind: 'three-quarter' }), pixelLandmarks, 'b').azimuthDeg.value;
    expect(a).not.toBe(b);
  });
  it('a referência de evidência aponta para a imagem de origem', () => {
    const c = cameraEvidence(est(), pixelLandmarks, 'sha-img');
    expect(c.azimuthDeg.provenance.evidence).toEqual([{ sourceId: 'sha-img', locator: 'wheel-regions' }]);
  });
});
