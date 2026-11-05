/**
 * Local image evidence: a foreground mask, bounding box, aspect, mirror symmetry, dominant colours and silhouette overlap, computed from raw RGBA pixels with no model
 * and no network. It is EVIDENCE about the picture (category `evidence`), never a measured dimension: proportions are relative, colours are palette hints.
 */
import { hexToRgb, rgbToHex } from './recipe';

export type RGBA = { width: number; height: number; data: Uint8Array | Uint8ClampedArray };
export type ImageEvidence = {
  width: number; height: number; foregroundRatio: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  /** width / height of the foreground bounding box (a ratio in the picture, not in metres) */
  aspect: number; symmetry: number; colours: Array<{ hex: string; share: number }>; mask: Uint8Array;
  /** Share of foreground pixels belonging to the largest connected component (1 = one coherent object). */
  largestComponentShare?: number;
};

/**
 * Background = the dominant colour CLUSTERS of the image border (a real photograph's border
 * is sky + road + buildings, not one colour: a single median colour misclassifies most of a
 * real photo as foreground — measured 84–91% foreground on camera photos). Foreground =
 * pixels far from every frequent border cluster (or with alpha > 0 when the picture has a
 * cut-out). Mask quality is the caller's to judge via `foregroundRatio`.
 */
export function extractEvidence(img: RGBA, threshold = 42): ImageEvidence {
  const { width: w, height: h, data } = img, px = (x: number, y: number) => (y * w + x) * 4;
  const borderBins = new Map<number, { n: number; r: number; g: number; b: number }>();
  let borderCount = 0;
  const take = (x: number, y: number) => {
    const i = px(x, y), key = ((data[i]! >> 5) << 6) | ((data[i + 1]! >> 5) << 3) | (data[i + 2]! >> 5);
    const bin = borderBins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bin.n++; bin.r += data[i]!; bin.g += data[i + 1]!; bin.b += data[i + 2]!; borderBins.set(key, bin); borderCount++;
  };
  for (let x = 0; x < w; x++) { take(x, 0); take(x, h - 1); } for (let y = 0; y < h; y++) { take(0, y); take(w - 1, y); }
  const bgColours = [...borderBins.values()].filter((bin) => bin.n >= Math.max(4, borderCount * 0.02))
    .sort((a, b) => b.n - a.n).slice(0, 6)
    .map((bin) => [bin.r / bin.n, bin.g / bin.n, bin.b / bin.n] as const);
  const hasAlpha = (() => { for (let i = 3; i < data.length; i += 4 * 17) if (data[i]! < 250) return true; return false; })();
  const nearBackground = (i: number): boolean => {
    let nearest = Number.POSITIVE_INFINITY;
    for (const bg of bgColours) nearest = Math.min(nearest, Math.hypot(data[i]! - bg[0], data[i + 1]! - bg[1], data[i + 2]! - bg[2]));
    return nearest <= threshold;
  };
  // NOTA medida: region-growing do fundo por gradiente local foi tentado e PIOROU o IoU
  // (0.22→0.01–0.12 nas fotografias reais): os gradientes suaves de asfalto/sombra ligam o
  // fundo ao sujeito. Fica o teste por clusters + limpeza por componentes (abaixo).
  const rawMask = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) rawMask[k] = hasAlpha ? (data[k * 4 + 3]! > 24 ? 1 : 0) : (nearBackground(k * 4) ? 0 : 1);
  // Keep the largest connected foreground component (the subject) and fill its enclosed
  // holes (glass reflecting the sky). Disjoint signs/buildings/other vehicles are dropped.
  const rawForeground = rawMask.reduce((s, v) => s + v, 0);
  const mask = largestComponentFilled(rawMask, w, h);
  const largestShare = rawForeground ? mask.reduce((s, v) => s + v, 0) / rawForeground : 0;
  let count = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue; count++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (!count) return { width: w, height: h, foregroundRatio: 0, bbox: { x0: 0, y0: 0, x1: w - 1, y1: h - 1 }, aspect: w / h, symmetry: 0, colours: [], mask };
  // Robust bbox: rows/columns with at least 1% foreground occupancy. A few stray border
  // pixels (signs, trees in a real photo) otherwise stretch the box to the whole frame.
  {
    const colCount = new Array<number>(w).fill(0), rowCount = new Array<number>(h).fill(0);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { colCount[x]!++; rowCount[y]!++; }
    const firstAbove = (counts: number[], min: number) => counts.findIndex((n) => n >= min);
    const lastAbove = (counts: number[], min: number) => { for (let i = counts.length - 1; i >= 0; i--) if (counts[i]! >= min) return i; return -1; };
    const rx0 = firstAbove(colCount, Math.max(2, h * 0.01)), rx1 = lastAbove(colCount, Math.max(2, h * 0.01));
    const ry0 = firstAbove(rowCount, Math.max(2, w * 0.01)), ry1 = lastAbove(rowCount, Math.max(2, w * 0.01));
    if (rx0 >= 0 && rx1 >= rx0 && ry0 >= 0 && ry1 >= ry0) { x0 = rx0; x1 = rx1; y0 = ry0; y1 = ry1; }
  }
  // mirror symmetry of the mask about the vertical axis of its bbox
  let both = 0, either = 0; const cx = (x0 + x1) / 2;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const mx = Math.round(2 * cx - x), a = mask[y * w + x]!, b = mx >= 0 && mx < w ? mask[y * w + mx]! : 0; if (a & b) both++; if (a | b) either++; }
  // dominant colours: 4-bit quantised histogram of foreground pixels
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let y = y0; y <= y1; y += 2) for (let x = x0; x <= x1; x += 2) {
    if (!mask[y * w + x]) continue; const i = px(x, y), key = ((data[i]! >> 5) << 6) | ((data[i + 1]! >> 5) << 3) | (data[i + 2]! >> 5), e = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += data[i]!; e.g += data[i + 1]!; e.b += data[i + 2]!; bins.set(key, e);
  }
  const total = [...bins.values()].reduce((s, e) => s + e.n, 0) || 1;
  const colours = [...bins.values()].sort((p, q) => q.n - p.n).slice(0, 4).map((e) => ({ hex: rgbToHex(e.r / e.n, e.g / e.n, e.b / e.n), share: e.n / total }));
  return { width: w, height: h, foregroundRatio: count / (w * h), bbox: { x0, y0, x1, y1 }, aspect: (x1 - x0 + 1) / (y1 - y0 + 1), symmetry: either ? both / either : 0, colours, mask, largestComponentShare: largestShare };
}

/** Intersection over union of two same-size masks. */
export function silhouetteIoU(a: Uint8Array, b: Uint8Array): number { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { const p = a[k]!, q = b[k]!; if (p & q) i++; if (p | q) u++; } return u ? i / u : 0; }

export type Bbox = { x0: number; y0: number; x1: number; y1: number };
/** Erro de bounding box em píxeis (maior desvio absoluto de qualquer aresta). */
export function bboxErrorPx(a: Bbox, b: Bbox): number {
  return Math.max(Math.abs(a.x0 - b.x0), Math.abs(a.y0 - b.y0), Math.abs(a.x1 - b.x1), Math.abs(a.y1 - b.y1));
}
export function maskBbox(mask: Uint8Array, width: number, height: number): Bbox {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (mask[y * width + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? { x0: 0, y0: 0, x1: width - 1, y1: height - 1 } : { x0, y0, x1, y1 };
}
/** Maior componente conexa (4-vizinhança) com buracos interiores preenchidos. */
export function largestComponentFilled(mask: Uint8Array, w: number, h: number): Uint8Array {
  const label = new Int32Array(w * h).fill(-1);
  let best = -1, bestSize = 0, next = 0;
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || label[start] >= 0) continue;
    let size = 0; stack.length = 0; stack.push(start); label[start] = next;
    while (stack.length) {
      const k = stack.pop()!, x = k % w, y = (k / w) | 0; size++;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nk = ny * w + nx;
        if (mask[nk] && label[nk] < 0) { label[nk] = next; stack.push(nk); }
      }
    }
    if (size > bestSize) { bestSize = size; best = next; }
    next++;
  }
  const out = new Uint8Array(w * h);
  if (best < 0) return out;
  for (let k = 0; k < w * h; k++) out[k] = label[k] === best ? 1 : 0;
  // preencher buracos: fundo que não toca a borda, dentro do componente, vira primeiro plano
  const seen = new Uint8Array(w * h);
  stack.length = 0;
  for (let x = 0; x < w; x++) { if (!out[x]) { seen[x] = 1; stack.push(x); } const b = (h - 1) * w + x; if (!out[b] && !seen[b]) { seen[b] = 1; stack.push(b); } }
  for (let y = 0; y < h; y++) { const l = y * w, r = y * w + w - 1; if (!out[l] && !seen[l]) { seen[l] = 1; stack.push(l); } if (!out[r] && !seen[r]) { seen[r] = 1; stack.push(r); } }
  while (stack.length) {
    const k = stack.pop()!, x = k % w, y = (k / w) | 0;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const nk = ny * w + nx;
      if (!out[nk] && !seen[nk]) { seen[nk] = 1; stack.push(nk); }
    }
  }
  for (let k = 0; k < w * h; k++) if (!out[k] && !seen[k]) out[k] = 1;
  return out;
}

/** Rasteriza um polígono (coordenadas em fracções da imagem) numa máscara do tamanho dado. */
export function polygonMask(polygon: Array<[number, number]>, width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  const inside = (x: number, y: number): boolean => {
    let hit = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, yi] = polygon[i]!, [xj, yj] = polygon[j]!;
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) if (inside((px + 0.5) / width, (py + 0.5) / height)) mask[py * width + px] = 1;
  return mask;
}
/** Hue/lightness test used to pick a body colour that is not near-grey background or glass. */
export const saturation = (hex: string) => { const [r, g, b] = hexToRgb(hex), mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx ? (mx - mn) / mx : 0; };
