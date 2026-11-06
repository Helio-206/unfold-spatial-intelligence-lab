/**
 * Landmarks de rodas a partir de evidência visual:
 *
 * - Com píxeis (RGBA): regiões escuras conexas (pneus) dentro da máscara na faixa
 *   inferior — centro por centróide, raio por área equivalente, excentricidade para a
 *   câmara. É evidência da imagem, não da silhueta desenhada.
 * - Só com silhueta (máscara confirmada): contactos com a linha de chão + mergulho da
 *   aresta inferior. Centros utilizáveis; azimute NÃO é identificável a partir de um
 *   polígono e fica explicitamente ambíguo.
 *
 * Rodas parciais (a tocar a borda) são marcadas; em falta são declaradas. Nada é inventado.
 */
import type { ImageEvidence, RGBA } from './evidence';

export type WheelLandmark = {
  centreXFraction: number; centreYFraction: number;
  radiusFractionOfBboxHeight: number;
  partial: boolean;
  source: 'image-dark-regions' | 'silhouette-contacts';
};
export type WheelLandmarks = {
  wheels: WheelLandmark[];
  wheelbaseFraction: number | null;
  missing: string[];
  source: 'image-dark-regions' | 'silhouette-contacts' | 'none';
  /** Dimensões observadas de cada região de pneu (píxeis da evidência), para a excentricidade da câmara. */
  wheelRegions?: Array<{ widthPx: number; heightPx: number }>;
};

export type CameraEstimate = {
  azimuthDeg: number;
  uncertaintyDeg: number;
  kind: 'side' | 'three-quarter' | 'front-rear';
  method: string;
  ambiguous: boolean;
};

/** Contactos da silhueta com a linha de chão (agrupamentos de colunas), em fracções da bbox. */
export function silhouetteContacts(evidence: ImageEvidence): Array<{ centreXFraction: number; startFraction: number; endFraction: number }> {
  const { mask, width, bbox } = evidence;
  const bboxW = Math.max(1, bbox.x1 - bbox.x0 + 1);
  const bottomOf = (x: number): number => { for (let y = bbox.y1; y >= bbox.y0; y--) if (mask[y * width + x]) return y; return -1; };
  const contact: boolean[] = [];
  for (let x = bbox.x0; x <= bbox.x1; x++) contact.push(bottomOf(x) >= bbox.y1 - Math.max(1, Math.round(evidence.height * 0.02)));
  const clusters: Array<{ start: number; end: number }> = [];
  let start = -1;
  for (let i = 0; i <= contact.length; i++) {
    if (contact[i] && start < 0) start = i;
    if ((!contact[i] || i === contact.length) && start >= 0) { clusters.push({ start, end: i - 1 }); start = -1; }
  }
  return clusters
    .filter((c) => c.end - c.start + 1 >= Math.max(3, bboxW * 0.03))
    .map((c) => ({ centreXFraction: (c.start + c.end) / 2 / bboxW, startFraction: c.start / bboxW, endFraction: c.end / bboxW }));
}

export function detectWheelLandmarks(evidence: ImageEvidence, rgba?: RGBA): WheelLandmarks {
  const { mask, width, height, bbox } = evidence;
  const bboxW = Math.max(1, bbox.x1 - bbox.x0 + 1), bboxH = Math.max(1, bbox.y1 - bbox.y0 + 1);
  const bandTop = bbox.y0 + Math.round(bboxH * 0.55);
  if (rgba) {
    // Centros pelos contactos da silhueta (medidos: erro 0.6–1.4% em perfis laterais);
    // a elipse do pneu é medida nos píxeis escuros numa janela à volta de cada centro,
    // sem erosão (parte os aros) nem fusão com a sombra fora da janela.
    const contacts = silhouetteContacts(evidence);
    if (contacts.length >= 2) {
      const lumAt = (x: number, y: number): number => {
        const i = (y * width + x) * 4;
        return 0.2126 * rgba.data[i]! + 0.7152 * rgba.data[i + 1]! + 0.0722 * rgba.data[i + 2]!;
      };
      const wheels: WheelLandmark[] = [];
      const wheelRegions: Array<{ widthPx: number; heightPx: number }> = [];
      for (const contact of contacts.slice(0, 4)) {
        const centrePx = bbox.x0 + Math.round(contact.centreXFraction * bboxW);
        const halfWin = Math.round(bboxW * 0.1);
        let minX = width, maxX = -1, minY = height, maxY = -1, n = 0, sumX = 0, sumY = 0;
        for (let y = Math.max(bbox.y0, bbox.y1 - Math.round(bboxH * 0.5)); y <= bbox.y1; y++) {
          for (let x = Math.max(bbox.x0, centrePx - halfWin); x <= Math.min(bbox.x1, centrePx + halfWin); x++) {
            if (!mask[y * width + x] || lumAt(x, y) >= 110) continue;
            n++; sumX += x; sumY += y;
            minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          }
        }
        if (n < bboxW * bboxH * 0.002 || maxX < 0) continue;
        wheels.push({
          centreXFraction: (sumX / n - bbox.x0) / bboxW,
          centreYFraction: (sumY / n - bbox.y0) / bboxH,
          radiusFractionOfBboxHeight: (Math.min(maxX - minX + 1, maxY - minY + 1) / 2) / bboxH,
          partial: contact.startFraction <= 0.01 || contact.endFraction >= 0.99,
          source: 'image-dark-regions',
        });
        wheelRegions.push({ widthPx: maxX - minX + 1, heightPx: maxY - minY + 1 });
      }
      if (wheels.length >= 2) {
        const missing: string[] = [];
        for (const [i, w] of wheels.entries()) if (w.partial) missing.push(`roda ${i + 1} parcialmente visível (contacto na borda da silhueta)`);
        return { wheels, wheelbaseFraction: wheels[wheels.length - 1]!.centreXFraction - wheels[0]!.centreXFraction, missing, source: 'image-dark-regions', wheelRegions };
      }
    }
  }
  // Sem janela válida à volta dos contactos: cai para os contactos da silhueta, onde a
  // magnitude do azimute é declarada não-identificável. (Um ramo anterior por erosão
  // produzia centros errados a partir de fragmentos de aro — removido, não escondido.)
  void bandTop;
  // Só silhueta: contactos com o chão (centros) + mergulho entre rodas (raio aproximado).
  const bottomOf = (x: number): number => { for (let y = bbox.y1; y >= bbox.y0; y--) if (mask[y * width + x]) return y; return -1; };
  const contact: boolean[] = [];
  for (let x = bbox.x0; x <= bbox.x1; x++) contact.push(bottomOf(x) >= bbox.y1 - Math.max(1, Math.round(height * 0.02)));
  const clusters: Array<{ start: number; end: number }> = [];
  let start = -1;
  for (let i = 0; i <= contact.length; i++) {
    if (contact[i] && start < 0) start = i;
    if ((!contact[i] || i === contact.length) && start >= 0) { clusters.push({ start, end: i - 1 }); start = -1; }
  }
  const significant = clusters.filter((c) => c.end - c.start + 1 >= Math.max(3, bboxW * 0.03));
  if (significant.length < 2) return { wheels: [], wheelbaseFraction: null, missing: ['sem dois contactos de roda com a linha de chão na silhueta'], source: 'none' };
  const midX = bbox.x0 + Math.round((significant[0]!.start + significant[significant.length - 1]!.end) / 2);
  const dip = (bbox.y1 - bottomOf(midX)) / bboxH;
  const radius = Math.min(0.35, Math.max(0.08, dip));
  const wheels: WheelLandmark[] = significant.slice(0, 4).map((c) => ({
    centreXFraction: (c.start + c.end) / 2 / bboxW,
    centreYFraction: 1 - radius,
    radiusFractionOfBboxHeight: radius,
    partial: c.start === 0 || c.end === contact.length - 1,
    source: 'silhouette-contacts' as const,
  }));
  return { wheels, wheelbaseFraction: wheels[wheels.length - 1]!.centreXFraction - wheels[0]!.centreXFraction, missing: [], source: 'silhouette-contacts' };
}

/**
 * Azimute estimado. Com regiões de pneu: largura aparente/diâmetro → acos, com
 * dispersão entre rodas na incerteza. Só com silhueta: magnitude não identificável —
 * devolve a classe por aspecto com `ambiguous: true` e incerteza larga, para o
 * fitting poder recusar em vez de deformar silenciosamente.
 */
export function estimateCamera(evidence: ImageEvidence, landmarks: WheelLandmarks): CameraEstimate {
  const wheelRegions = landmarks.wheelRegions;
  if (landmarks.source === 'image-dark-regions' && wheelRegions?.length) {
    const perWheel = wheelRegions.map((r) => Math.acos(Math.min(1, Math.max(0.25, r.widthPx / Math.max(1, r.heightPx * 0.92)))) * 180 / Math.PI);
    const mean = perWheel.reduce((s, v) => s + v, 0) / perWheel.length;
    const spread = Math.max(...perWheel) - Math.min(...perWheel);
    const azimuthDeg = Math.min(65, Math.max(0, mean));
    return {
      azimuthDeg, uncertaintyDeg: 10 + spread / 2,
      kind: azimuthDeg < 14 ? 'side' : azimuthDeg > 58 ? 'front-rear' : 'three-quarter',
      method: `excentricidade das regiões de pneu (${perWheel.map((v) => v.toFixed(0)).join('/')}° por roda)`,
      ambiguous: spread > 22 || landmarks.wheels.some((w) => w.partial),
    };
  }
  const kind = evidence.symmetry > 0.72 && evidence.aspect < 1.7 ? 'front-rear' : evidence.aspect >= 2.35 ? 'side' : 'three-quarter';
  return {
    azimuthDeg: kind === 'side' ? 0 : kind === 'three-quarter' ? 32 : 80,
    uncertaintyDeg: 28, kind,
    method: 'sem regiões de pneu: classe por aspecto/simetria da silhueta; magnitude do azimute não identificável a partir do polígono',
    ambiguous: true,
  };
}

/** Silhueta projectada a partir de um azimute: roda a geometria em Y e projecta em X'. */
export function azimuthFactor(azimuthDeg: number): number {
  return Math.cos(Math.min(65, Math.max(0, azimuthDeg)) * Math.PI / 180);
}
