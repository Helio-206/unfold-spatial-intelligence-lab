/**
 * Correcção de contorno pelo utilizador: quando a extracção automática falha, a pessoa
 * define o contorno do objecto sobre a fotografia. A máscara daí resultante tem
 * proveniência `user_confirmed` — distinta da automática em todo o sistema, ligada ao
 * hash exacto da fonte e ao plano revisto, e nunca promovida a medição: é o contorno
 * que a pessoa desenhou, confirmado por ela e por mais ninguém.
 */
import { polygonMask, type ImageEvidence } from './evidence';

export type ContourPoint = [number, number];
export type CorrectedMaskBinding = {
  /** Polígono em fracções da imagem (x, y), na ordem do contorno. */
  polygon: ContourPoint[];
  confirmedAt: string;
  provenance: 'user_confirmed';
};

/** Contorno inicial editável a partir da máscara automática: extremos por fatias verticais. */
export function initialOutlineFromEvidence(evidence: ImageEvidence, slices = 9): ContourPoint[] {
  const { mask, width, height, bbox } = evidence;
  const tops: ContourPoint[] = [], bottoms: ContourPoint[] = [];
  for (let s = 0; s < slices; s++) {
    const x = bbox.x0 + Math.floor((s + 0.5) * (bbox.x1 - bbox.x0 + 1) / slices);
    let top = -1, bottom = -1;
    for (let y = bbox.y0; y <= bbox.y1; y++) if (mask[y * width + x]) { if (top < 0) top = y; bottom = y; }
    if (top >= 0) { tops.push([x / width, top / height]); bottoms.push([x / width, bottom / height]); }
  }
  if (tops.length < 3) {
    // Sem máscara utilizável: rectângulo central editável como ponto de partida honesto.
    return [[0.2, 0.3], [0.8, 0.3], [0.8, 0.75], [0.2, 0.75]];
  }
  return [...tops, ...bottoms.reverse()];
}

/** Máscara rasterizada do contorno confirmado, às dimensões da evidência. */
export function correctedEvidence(evidence: ImageEvidence, binding: CorrectedMaskBinding): ImageEvidence {
  const mask = polygonMask(binding.polygon, evidence.width, evidence.height);
  let x0 = evidence.width, y0 = evidence.height, x1 = -1, y1 = -1, count = 0;
  for (let y = 0; y < evidence.height; y++) for (let x = 0; x < evidence.width; x++) {
    if (!mask[y * evidence.width + x]) continue;
    count++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (!count) return evidence;
  return {
    ...evidence,
    mask,
    bbox: { x0, y0, x1, y1 },
    aspect: (x1 - x0 + 1) / Math.max(1, y1 - y0 + 1),
    foregroundRatio: count / (evidence.width * evidence.height),
    largestComponentShare: 1,
  };
}
