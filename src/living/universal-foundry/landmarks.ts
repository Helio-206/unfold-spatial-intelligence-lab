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
};

export type CameraEstimate = {
  azimuthDeg: number;
  uncertaintyDeg: number;
  kind: 'side' | 'three-quarter' | 'front-rear';
  method: string;
  ambiguous: boolean;
};

type Region = { count: number; minX: number; maxX: number; minY: number; maxY: number; sumX: number; sumY: number };

function componentsWhere(width: number, height: number, on: (x: number, y: number) => boolean): Region[] {
  const label = new Int32Array(width * height).fill(-1);
  const regions: Region[] = [];
  const stack: number[] = [];
  for (let start = 0; start < width * height; start++) {
    const sx = start % width, sy = (start / width) | 0;
    if (!on(sx, sy) || label[start] >= 0) continue;
    const region: Region = { count: 0, minX: sx, maxX: sx, minY: sy, maxY: sy, sumX: 0, sumY: 0 };
    const id = regions.length;
    stack.length = 0; stack.push(start); label[start] = id;
    while (stack.length) {
      const k = stack.pop()!, x = k % width, y = (k / width) | 0;
      region.count++; region.sumX += x; region.sumY += y;
      region.minX = Math.min(region.minX, x); region.maxX = Math.max(region.maxX, x);
      region.minY = Math.min(region.minY, y); region.maxY = Math.max(region.maxY, y);
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const nk = ny * width + nx;
        if (on(nx, ny) && label[nk] < 0) { label[nk] = id; stack.push(nk); }
      }
    }
    regions.push(region);
  }
  return regions;
}

export function detectWheelLandmarks(evidence: ImageEvidence, rgba?: RGBA): WheelLandmarks {
  const { mask, width, height, bbox } = evidence;
  const bboxW = Math.max(1, bbox.x1 - bbox.x0 + 1), bboxH = Math.max(1, bbox.y1 - bbox.y0 + 1);
  const bandTop = bbox.y0 + Math.round(bboxH * 0.55);
  if (rgba) {
    const dark = (x: number, y: number): boolean => {
      if (!mask[y * width + x] || y < bandTop) return false;
      const i = (y * width + x) * 4;
      const lum = 0.2126 * rgba.data[i]! + 0.7152 * rgba.data[i + 1]! + 0.0722 * rgba.data[i + 2]!;
      return lum < 95;
    };
    const regions = componentsWhere(width, height, dark).filter((r) => {
      const w = r.maxX - r.minX + 1, h = r.maxY - r.minY + 1;
      const fill = r.count / (w * h);
      return r.count >= bboxW * bboxH * 0.003 && r.count <= bboxW * bboxH * 0.14
        && h >= bboxH * 0.09 && fill >= 0.4 && w / h >= 0.45 && w / h <= 2.4
        && r.maxY >= bbox.y1 - Math.max(3, height * 0.06);
    }).sort((a, b) => a.sumX / a.count - b.sumX / b.count);
    // regiões sobrepostas/quase duplicadas (pneu + sombra): fica a maior de cada centro próximo
    const wheels: WheelLandmark[] = [];
    for (const r of regions) {
      const cx = (r.sumX / r.count - bbox.x0) / bboxW;
      if (wheels.some((w) => Math.abs(w.centreXFraction - cx) < 0.07)) continue;
      wheels.push({
        centreXFraction: cx,
        centreYFraction: (r.sumY / r.count - bbox.y0) / bboxH,
        radiusFractionOfBboxHeight: Math.sqrt(r.count / Math.PI) / bboxH,
        partial: r.minX <= bbox.x0 + 1 || r.maxX >= bbox.x1 - 1,
        source: 'image-dark-regions',
      });
    }
    const missing: string[] = [];
    if (wheels.length < 2) missing.push(`esperadas pelo menos 2 rodas visíveis, detectadas ${wheels.length} regiões de pneu`);
    for (const [i, w] of wheels.entries()) if (w.partial) missing.push(`roda ${i + 1} parcialmente visível (toca a borda da silhueta)`);
    return {
      wheels: wheels.slice(0, 4),
      wheelbaseFraction: wheels.length >= 2 ? wheels[wheels.length - 1]!.centreXFraction - wheels[0]!.centreXFraction : null,
      missing, source: wheels.length ? 'image-dark-regions' : 'none',
    };
  }
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
export function estimateCamera(evidence: ImageEvidence, landmarks: WheelLandmarks, wheelRegions?: Array<{ widthPx: number; heightPx: number }>): CameraEstimate {
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
