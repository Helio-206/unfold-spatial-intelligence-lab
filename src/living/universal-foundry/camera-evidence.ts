/**
 * Evidência de câmara: converte a estimativa existente (`estimateCamera`) em valores com tipo de
 * evidência. Só o azimute é estimado; elevação, roll, FOV, escala e sentido (esquerda/direita) não
 * são identificáveis com os landmarks actuais e ficam UNKNOWN em vez de herdarem um valor por defeito.
 */
import { makeEvidenced, type EvidencedValue, type Measurement, type Provenance } from '../../core';
import type { CameraEstimate, WheelLandmarks } from './landmarks';

export type CameraEvidence = {
  azimuthDeg: EvidencedValue<number>;
  elevationDeg: EvidencedValue<number>;
  rollDeg: EvidencedValue<number>;
  fovDeg: EvidencedValue<number>;
  scale: EvidencedValue<number>;
  /** Sentido de rotação do azimute (a excentricidade dá a magnitude, não o sinal). */
  headingSign: EvidencedValue<number>;
};

const unknownField = (): EvidencedValue<number> => makeEvidenced<number>(null, { origin: 'unknown', validation: 'unreviewed', recordedAt: '' });

export function cameraEvidence(estimate: CameraEstimate, landmarks: WheelLandmarks, imageSourceId: string): CameraEvidence {
  const pixelBased = landmarks.source === 'image-dark-regions' && !!landmarks.wheelRegions?.length;
  const provenance: Provenance = { origin: 'heuristic', validation: 'unreviewed', recordedAt: '', evidence: [{ sourceId: imageSourceId, locator: pixelBased ? 'wheel-regions' : 'silhouette' }] };
  const measurement: Measurement | undefined = pixelBased && !estimate.ambiguous ? {
    method: estimate.method, unit: 'deg',
    // A incerteza é a do método; nunca foi calibrada contra azimute real (erro medido nos casos reais: 18–22°).
    uncertainty: { quantified: true, plusMinus: estimate.uncertaintyDeg, unit: 'deg', calibration: 'declared' },
    evidence: provenance.evidence!,
    assumptions: ['projecção ortográfica', 'aros de roda circulares', 'sentido de rotação não identificável'],
  } : undefined;
  const azimuthDeg = makeEvidenced(estimate.azimuthDeg, provenance, measurement ? { measurement } : {});
  // Mesmo inferido, o azimute transporta a incerteza declarada pelo estimador (sempre 'declared').
  azimuthDeg.uncertainty = { quantified: true, plusMinus: estimate.uncertaintyDeg, unit: 'deg', calibration: 'declared' };
  return { azimuthDeg, elevationDeg: unknownField(), rollDeg: unknownField(), fovDeg: unknownField(), scale: unknownField(), headingSign: unknownField() };
}
