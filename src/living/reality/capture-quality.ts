/**
 * Capture quality and coverage: what a person needs to be told BEFORE a reconstruction is built from their pictures. Per-view image quality (sharpness,
 * exposure, resolution, cut-off object) and set-level coverage (angular gaps, missing elevation, redundant or insufficient views), each with a plain-language
 * instruction for what to capture next. The thresholds are heuristics (declared as such, not calibrated on real photographs); the guidance never blocks by itself:
 * the credibility gates and the fidelity classification are what refuse or downgrade a result.
 */
import type { RGBA } from '../universal-foundry/evidence';

export type QualityIssueCode = 'BLURRY' | 'OVEREXPOSED' | 'UNDEREXPOSED' | 'LOW_RESOLUTION' | 'OBJECT_CUT_OFF' | 'REDUNDANT_VIEW' | 'ANGULAR_GAP' | 'NO_ELEVATION_VARIETY' | 'TOO_FEW_VIEWS' | 'UNEVEN_FRAMING';
export type QualityIssue = { code: QualityIssueCode; severity: 'warning' | 'blocking-advice'; viewIndexes: number[]; message: string; /** what to do (pt-PT) */ advice: string };
export type ViewQuality = { sharpness: number; clippedHigh: number; clippedLow: number; objectPixels: number; touchesBorder: number };

export const QUALITY_THRESHOLDS = {
  /** a view whose sharpness is below this fraction of the set's median is flagged */ relativeSharpness: 0.4,
  /** share of object pixels at the extremes of the range */ clipped: 0.3,
  /** smaller than this (pixels on the long side of the object) is too small to outline */ minObjectSide: 100,
  /** share of the object's outline length lying on the picture border */ border: 0.03,
  /** largest empty angular sector before advice is given (degrees) */ maxGapDeg: 100,
  /** views closer than this (degrees) with near-identical outlines are redundant */ redundantDeg: 12, redundantIoU: 0.97,
  /** an orbit whose views all lie within this elevation band lacks top/bottom information */ elevationBandDeg: 15,
} as const;

/** Variance of the Laplacian of the luminance inside the object's bounding box (higher = sharper). Scale-normalised to a 256-pixel object side. */
export function sharpness(rgba: RGBA, mask: Uint8Array): number {
  const { width: w, height: h, data } = rgba; let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return 0;
  const side = Math.max(x1 - x0 + 1, y1 - y0 + 1), step = Math.max(1, Math.floor(side / 256)), lum = (x: number, y: number) => { const i = (y * w + x) * 4; return data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114; };
  let sum = 0, sum2 = 0, n = 0;
  for (let y = Math.max(1, y0); y < Math.min(h - 1, y1); y += step) for (let x = Math.max(1, x0); x < Math.min(w - 1, x1); x += step) {
    if (!mask[y * w + x]) continue;
    const l = lum(x - step < 0 ? x : x - step, y) + lum(x + step >= w ? x : x + step, y) + lum(x, y - step < 0 ? y : y - step) + lum(x, y + step >= h ? y : y + step) - 4 * lum(x, y);
    sum += l; sum2 += l * l; n++;
  }
  return n > 1 ? (sum2 / n - (sum / n) ** 2) : 0;
}

export function viewQuality(rgba: RGBA, mask: Uint8Array): ViewQuality {
  const { width: w, height: h, data } = rgba; let hi = 0, lo = 0, n = 0, border = 0, outline = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue; n++;
    const i = (y * w + x) * 4, l = data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114; if (l >= 250) hi++; else if (l <= 5) lo++;
    const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1 || !mask[y * w + x - 1] || !mask[y * w + x + 1] || !mask[(y - 1) * w + x] || !mask[(y + 1) * w + x];
    if (edge) { outline++; if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border++; }
  }
  return { sharpness: sharpness(rgba, mask), clippedHigh: n ? hi / n : 0, clippedLow: n ? lo / n : 0, objectPixels: n, touchesBorder: outline ? border / outline : 0 };
}

export type CaptureView = { azimuthDeg: number; elevationDeg: number; quality: ViewQuality; mask: Uint8Array; width: number; height: number; bboxSide: number };
export type CaptureAssessment = { issues: QualityIssue[]; ok: boolean; coverage: { azimuthMaxGapDeg: number; gapStartDeg: number | null; elevationMinDeg: number; elevationMaxDeg: number; views: number } };

const mod = (a: number) => ((a % 360) + 360) % 360;
export function assessCapture(views: readonly CaptureView[]): CaptureAssessment {
  const T = QUALITY_THRESHOLDS, issues: QualityIssue[] = [];
  const sorted = views.map((v) => v.quality.sharpness).sort((a, b) => a - b), median = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0;
  views.forEach((v, i) => {
    if (views.length >= 3 && median > 0 && v.quality.sharpness < T.relativeSharpness * median) issues.push({ code: 'BLURRY', severity: 'warning', viewIndexes: [i], message: `A vista ${i + 1} está desfocada em relação às outras (nitidez ${(v.quality.sharpness / median * 100).toFixed(0)}% da mediana).`, advice: 'Refaça esta fotografia com o objecto parado, mais luz ou menor velocidade de obturador.' });
    if (v.quality.clippedHigh > T.clipped) issues.push({ code: 'OVEREXPOSED', severity: 'warning', viewIndexes: [i], message: `A vista ${i + 1} tem ${(v.quality.clippedHigh * 100).toFixed(0)}% do objecto sobre-exposto.`, advice: 'Reduza a exposição ou evite luz directa/reflexos; zonas queimadas não têm informação.' });
    if (v.quality.clippedLow > T.clipped) issues.push({ code: 'UNDEREXPOSED', severity: 'warning', viewIndexes: [i], message: `A vista ${i + 1} tem ${(v.quality.clippedLow * 100).toFixed(0)}% do objecto sub-exposto.`, advice: 'Aumente a luz; zonas pretas não têm informação.' });
    if (v.bboxSide < T.minObjectSide) issues.push({ code: 'LOW_RESOLUTION', severity: 'warning', viewIndexes: [i], message: `O objecto ocupa só ${v.bboxSide} píxeis na vista ${i + 1}.`, advice: 'Aproxime-se ou faça zoom para o objecto encher mais a imagem.' });
    if (v.quality.touchesBorder > T.border) issues.push({ code: 'OBJECT_CUT_OFF', severity: 'blocking-advice', viewIndexes: [i], message: `O objecto está cortado pela borda da imagem na vista ${i + 1}.`, advice: 'Afaste-se para o objecto ficar inteiro dentro da imagem; um contorno cortado produz um sólido cortado.' });
  });
  const sizes = views.map((v) => v.bboxSide), medSize = sizes.length ? [...sizes].sort((a, b) => a - b)[Math.floor(sizes.length / 2)]! : 0;
  const uneven = views.map((v, i) => (medSize && Math.abs(v.bboxSide - medSize) / medSize > 0.35 ? i : -1)).filter((i) => i >= 0);
  if (views.length >= 3 && uneven.length) issues.push({ code: 'UNEVEN_FRAMING', severity: 'warning', viewIndexes: uneven, message: `O tamanho do objecto varia muito entre vistas (${uneven.map((i) => i + 1).join(', ')}).`, advice: 'Mantenha a mesma distância e zoom em todas as fotografias: a escala é assumida igual.' });
  if (views.length < 3) issues.push({ code: 'TOO_FEW_VIEWS', severity: 'blocking-advice', viewIndexes: [], message: `${views.length} vista(s): a profundidade quase não é restringida.`, advice: 'Acrescente vistas até cobrir o objecto à volta; com 6 a 8 o erro desce muito (benchmark).' });
  // redundancy: close azimuth and same elevation band
  for (let i = 0; i < views.length; i++) for (let j = i + 1; j < views.length; j++) {
    const a = views[i]!, b = views[j]!, dd = Math.abs(((a.azimuthDeg - b.azimuthDeg + 540) % 360) - 180);
    if (dd < T.redundantDeg && Math.abs(a.elevationDeg - b.elevationDeg) < T.redundantDeg && a.width === b.width && a.height === b.height) {
      let inter = 0, uni = 0; for (let k = 0; k < a.mask.length; k++) { inter += a.mask[k]! & b.mask[k]!; uni += a.mask[k]! | b.mask[k]!; }
      if (uni && inter / uni >= T.redundantIoU) issues.push({ code: 'REDUNDANT_VIEW', severity: 'warning', viewIndexes: [i, j], message: `As vistas ${i + 1} e ${j + 1} são quase idênticas (${dd.toFixed(0)}° de diferença).`, advice: 'Uma delas não acrescenta informação; use esse esforço numa perspectiva em falta.' });
    }
  }
  // angular coverage
  const az = views.map((v) => mod(v.azimuthDeg)).sort((a, b) => a - b); let maxGap = 0, gapStart: number | null = null;
  if (az.length >= 2) for (let i = 0; i < az.length; i++) { const gap = (az[(i + 1) % az.length]! - az[i]! + 360) % 360 || 360; if (gap > maxGap) { maxGap = gap; gapStart = az[i]!; } } else { maxGap = 360; gapStart = az[0] ?? null; }
  if (views.length >= 2 && maxGap > T.maxGapDeg) issues.push({ code: 'ANGULAR_GAP', severity: 'warning', viewIndexes: [], message: `Nenhuma vista entre ${gapStart!.toFixed(0)}° e ${mod(gapStart! + maxGap).toFixed(0)}° (${maxGap.toFixed(0)}° sem cobertura).`, advice: `Fotografe de cerca de ${mod(gapStart! + maxGap / 2).toFixed(0)}° para fechar este sector; sem ele a forma nessa zona é só hipótese.` });
  const els = views.map((v) => v.elevationDeg), emin = els.length ? Math.min(...els) : 0, emax = els.length ? Math.max(...els) : 0;
  if (views.length >= 3 && emax - emin < T.elevationBandDeg && emax < 35) issues.push({ code: 'NO_ELEVATION_VARIETY', severity: 'warning', viewIndexes: [], message: 'Todas as vistas estão à mesma altura: o topo (e a base) do objecto não é visto.', advice: 'Acrescente 2 ou 3 vistas de cima (≈ 45°–60°) e, se possível, de baixo; sem elas o casco "levanta" uma tampa sobre o topo.' });
  return { issues, ok: !issues.some((i) => i.severity === 'blocking-advice'), coverage: { azimuthMaxGapDeg: maxGap, gapStartDeg: gapStart, elevationMinDeg: emin, elevationMaxDeg: emax, views: views.length } };
}

/** Coverage-only assessment for stored evidence (outlines and poses, no pixels): angular gaps, elevation variety, redundancy, view count. */
export function assessCoverage(views: ReadonlyArray<{ azimuthDeg: number; elevationDeg: number; mask: Uint8Array; res: number }>): CaptureAssessment {
  const neutral: ViewQuality = { sharpness: 1, clippedHigh: 0, clippedLow: 0, objectPixels: 1, touchesBorder: 0 };
  const r = assessCapture(views.map((v) => ({ azimuthDeg: v.azimuthDeg, elevationDeg: v.elevationDeg, quality: neutral, mask: v.mask, width: v.res, height: v.res, bboxSide: 1000 })));
  return { ...r, issues: r.issues.filter((i) => ['ANGULAR_GAP', 'NO_ELEVATION_VARIETY', 'TOO_FEW_VIEWS', 'REDUNDANT_VIEW'].includes(i.code)) };
}
