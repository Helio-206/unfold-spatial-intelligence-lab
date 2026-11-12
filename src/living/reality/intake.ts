/**
 * Intake of real inputs for the Reality Engine: several photographs of one object (turntable or orbit), frames from a video, or orthographic views of a
 * technical drawing. It turns them into RealityEvidence and says, in plain words, what it had to ASSUME. It never produces a pose out of nothing:
 * poses are 'given' only when the person declared them, otherwise 'assumed' (equal turntable steps) and open to refinement by consistency.
 * Fails closed: an unreliable segmentation, an inconsistent drawing or too few views is a coded refusal, never a quiet fallback.
 */
import { leaveOneOutIoU, type SilhouetteView } from '../../universal-spatial/reconstruction/multiview';
import type { RGBA } from '../universal-foundry/evidence';
import { assessCapture, viewQuality, type CaptureAssessment, type CaptureView } from './capture-quality';
import { Vector3 } from 'three';
import { decodeMask, encodeColour, encodeMask, REALITY_LIMITS, type RealityEvidence, type StoredView } from './evidence';
import { FRAME_HALF_PER_DIAGONAL } from './model';

export type IntakeImage = { name: string; rgba: RGBA; /** a mask (same size as rgba) that skips the built-in segmentation; confirmed by the person unless `maskSource` says it came from an automatic strategy */ mask?: Uint8Array; maskSource?: 'automatic' | 'confirmed'; /** which automatic strategy produced `mask` (shown to the person) */ maskMethod?: string };
export type RefusalCode = 'TOO_FEW_VIEWS' | 'TOO_MANY_VIEWS' | 'MASK_UNRELIABLE' | 'EMPTY_MASK' | 'DRAWING_INCONSISTENT' | 'POSE_COUNT_MISMATCH' | 'MISSING_DRAWING_VIEW';
export type Refusal = { code: RefusalCode; detail: string; viewName?: string };
export type ViewReport = { name: string; maskSource: 'confirmed' | 'automatic'; maskMethod?: string; reliable: boolean; reasons: string[]; bbox: { x0: number; y0: number; x1: number; y1: number }; foregroundRatio: number };
export type IntakeResult = { evidence: RealityEvidence | null; refusals: Refusal[]; views: ViewReport[]; /** image quality, coverage and what to capture next (null for drawings) */ capture?: CaptureAssessment | null };
export type IntakeOptions = { res?: number; colourRes?: number; cells?: number };

const slug = (s: string, i: number) => (s.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'view') + `-${i + 1}`;
const median = (x: number[]) => { const s = [...x].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : 0; };

type Prepared = { name: string; rgba: RGBA; mask: Uint8Array; report: ViewReport };

/**
 * Background-colour distance threshold from how uniform the picture's border is: a clean, uniform background allows a tight threshold (so a pale object on a
 * pale background is still separated), a noisy border needs a loose one. Bounded; the credibility gate still refuses what segmentation cannot support.
 */
export function adaptiveThreshold(rgba: RGBA): number {
  const { width: w, height: h, data } = rgba; let n = 0, mr = 0, mg = 0, mb = 0;
  const each = (f: (i: number) => void) => { for (let x = 0; x < w; x++) { f((x) * 4); f(((h - 1) * w + x) * 4); } for (let y = 1; y < h - 1; y++) { f((y * w) * 4); f((y * w + w - 1) * 4); } };
  each((i) => { mr += data[i]!; mg += data[i + 1]!; mb += data[i + 2]!; n++; });
  mr /= n; mg /= n; mb /= n; let v = 0;
  each((i) => { v += (data[i]! - mr) ** 2 + (data[i + 1]! - mg) ** 2 + (data[i + 2]! - mb) ** 2; });
  const sigma = Math.sqrt(v / n);
  return Math.max(14, Math.min(42, Math.round(3 * sigma + 12)));
}

/**
 * Generic outline of ONE object on a plain background. Unlike the vehicle extractor (which keeps only the largest blob and fills every hole), this keeps all
 * substantial parts of the silhouette (an object may be disconnected in a view: legs, wheels, a handle), drops specks, fills only SMALL enclosed holes
 * (glare, reflections) and keeps large ones (the opening of a handle is real evidence). `credibility` reports what it did so the gate can still refuse.
 */
export type GenericSegmentation = { mask: Uint8Array; foregroundRatio: number; largestShare: number; keptShare: number; bbox: { x0: number; y0: number; x1: number; y1: number }; borderShare: number; fill: number };
export function segmentGeneric(rgba: RGBA, threshold = adaptiveThreshold(rgba)): GenericSegmentation {
  const { width: w, height: h, data } = rgba, hasAlpha = (() => { for (let i = 3; i < data.length; i += 4 * 17) if (data[i]! < 250) return true; return false; })();
  // background colours from the border (dominant clusters), as the vehicle extractor does
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>(); let border = 0;
  const take = (x: number, y: number) => { const i = (y * w + x) * 4, k = ((data[i]! >> 5) << 6) | ((data[i + 1]! >> 5) << 3) | (data[i + 2]! >> 5), b = bins.get(k) ?? { n: 0, r: 0, g: 0, b: 0 }; b.n++; b.r += data[i]!; b.g += data[i + 1]!; b.b += data[i + 2]!; bins.set(k, b); border++; };
  for (let x = 0; x < w; x++) { take(x, 0); take(x, h - 1); } for (let y = 0; y < h; y++) { take(0, y); take(w - 1, y); }
  const bg = [...bins.values()].filter((b) => b.n >= Math.max(4, border * 0.02)).sort((a, b) => b.n - a.n).slice(0, 6).map((b) => [b.r / b.n, b.g / b.n, b.b / b.n] as const);
  const raw = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) {
    if (hasAlpha) { raw[k] = data[k * 4 + 3]! > 24 ? 1 : 0; continue; }
    let near = Infinity; for (const c of bg) near = Math.min(near, Math.hypot(data[k * 4]! - c[0], data[k * 4 + 1]! - c[1], data[k * 4 + 2]! - c[2]));
    raw[k] = near <= threshold ? 0 : 1;
  }
  // connected components (4-neighbour) of the foreground
  const label = new Int32Array(w * h).fill(-1), sizes: number[] = [], stack: number[] = [];
  const flood = (start: number, id: number, on: number, arr: Uint8Array, lab: Int32Array): number => {
    let n = 0; stack.push(start); lab[start] = id;
    while (stack.length) { const p = stack.pop()!, x = p % w, y = (p - x) / w; n++; for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) if (q >= 0 && arr[q] === on && lab[q]! < 0) { lab[q] = id; stack.push(q); } }
    return n;
  };
  for (let k = 0; k < w * h; k++) if (raw[k] && label[k]! < 0) sizes.push(flood(k, sizes.length, 1, raw, label));
  const total = sizes.reduce((a, b) => a + b, 0) || 1, largest = Math.max(0, ...sizes), minPart = Math.max(30, Math.round(total * 0.02));
  const keep = sizes.map((n) => n >= minPart), mask = new Uint8Array(w * h); let kept = 0;
  for (let k = 0; k < w * h; k++) if (raw[k] && keep[label[k]!]) { mask[k] = 1; kept++; }
  // fill small enclosed holes: background components that do not touch the border and are small relative to the object
  const hole = new Int32Array(w * h).fill(-1), invert = mask.map((v) => 1 - v) as Uint8Array;
  const holeLimit = Math.max(12, Math.round(kept * 0.015));
  for (let k = 0; k < w * h; k++) if (invert[k] && hole[k]! < 0) {
    const members: number[] = []; let touches = false; stack.push(k); hole[k] = 1;
    while (stack.length) { const p = stack.pop()!, x = p % w, y = (p - x) / w; members.push(p); if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches = true; for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) if (q >= 0 && invert[q] && hole[q]! < 0) { hole[q] = 1; stack.push(q); } }
    if (!touches && members.length <= holeLimit) for (const p of members) { mask[p] = 1; kept++; }
  }
  let x0 = w, y0 = h, x1 = -1, y1 = -1, band = 0; const bx = Math.max(1, Math.round(w * 0.04)), by = Math.max(1, Math.round(h * 0.04));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (x < bx || x >= w - bx || y < by || y >= h - by) band++; }
  const boxArea = Math.max(1, (x1 - x0 + 1) * (y1 - y0 + 1));
  return { mask, foregroundRatio: kept / (w * h), largestShare: largest / total, keptShare: kept ? sizes.reduce((a, n, i) => a + (keep[i] ? n : 0), 0) / total : 0, bbox: { x0, y0, x1, y1 }, borderShare: kept ? band / kept : 1, fill: kept / boxArea };
}

export function segmentationCredibility(g: GenericSegmentation): { reliable: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (g.keptShare < 0.9) reasons.push(`o primeiro plano está demasiado fragmentado (${(g.keptShare * 100).toFixed(0)}% do primeiro plano bruto em partes substanciais; maior parte ${(g.largestShare * 100).toFixed(0)}%)`);
  if (g.largestShare < 0.5 && g.keptShare >= 0.9) reasons.push(`nenhuma parte domina o objecto (maior ${(g.largestShare * 100).toFixed(0)}%)`);
  if (g.borderShare > 0.15) reasons.push(`contaminação nas bordas (${(g.borderShare * 100).toFixed(0)}% > 15%)`);
  if (g.foregroundRatio < 0.008 || g.foregroundRatio > 0.85) reasons.push(`primeiro plano fora do intervalo credível (${(g.foregroundRatio * 100).toFixed(0)}%)`);
  if (g.fill < 0.12) reasons.push(`preenchimento da caixa degenerado (${(g.fill * 100).toFixed(0)}%)`);
  return { reliable: reasons.length === 0, reasons };
}

function prepare(image: IntakeImage, refusals: Refusal[]): Prepared | null {
  const { width, height } = image.rgba;
  let mask: Uint8Array, source: ViewReport['maskSource'], reasons: string[] = [], reliable = true;
  if (image.mask) {
    if (image.mask.length !== width * height) { refusals.push({ code: 'EMPTY_MASK', detail: 'confirmed mask size differs from the image', viewName: image.name }); return null; }
    mask = image.mask; source = image.maskSource ?? 'confirmed';
  } else {
    const seg = segmentGeneric(image.rgba); mask = seg.mask; source = 'automatic';
    const r = segmentationCredibility(seg); reliable = r.reliable; reasons = r.reasons;
    if (!r.reliable) { refusals.push({ code: 'MASK_UNRELIABLE', detail: `automatic segmentation is not credible (${r.reasons.join('; ')}); confirm or correct the outline`, viewName: image.name }); }
  }
  let x0 = width, y0 = height, x1 = -1, y1 = -1, count = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (mask[y * width + x]) { count++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (!count) { refusals.push({ code: 'EMPTY_MASK', detail: 'no foreground pixels', viewName: image.name }); return null; }
  return { name: image.name, rgba: image.rgba, mask, report: { name: image.name, maskSource: source, ...(image.maskMethod ? { maskMethod: image.maskMethod } : {}), reliable, reasons, bbox: { x0, y0, x1, y1 }, foregroundRatio: count / (width * height) } };
}

/** Samples a prepared view into the shared orthographic window. `map(X, Y)` gives the source pixel (floating) for window pixel (X, Y). */
function resample(p: Prepared, res: number, colourRes: number, map: (X: number, Y: number, size: number) => [number, number]): { mask: Uint8Array; rgb: Uint8Array } {
  const { width, height, data } = p.rgba, mask = new Uint8Array(res * res), rgb = new Uint8Array(colourRes * colourRes * 3);
  const at = (sx: number, sy: number) => { const x = Math.floor(sx), y = Math.floor(sy); return x < 0 || y < 0 || x >= width || y >= height ? -1 : y * width + x; };
  for (let Y = 0; Y < res; Y++) for (let X = 0; X < res; X++) { const [sx, sy] = map(X + 0.5, Y + 0.5, res), k = at(sx, sy); if (k >= 0 && p.mask[k]) mask[Y * res + X] = 1; }
  for (let Y = 0; Y < colourRes; Y++) for (let X = 0; X < colourRes; X++) {
    const [sx, sy] = map(X + 0.5, Y + 0.5, colourRes), k = at(sx, sy);
    if (k >= 0) { rgb[(Y * colourRes + X) * 3] = data[k * 4]!; rgb[(Y * colourRes + X) * 3 + 1] = data[k * 4 + 1]!; rgb[(Y * colourRes + X) * 3 + 2] = data[k * 4 + 2]!; }
  }
  return { mask, rgb };
}

export type OrbitOptions = IntakeOptions & {
  /** declared azimuths in degrees (one per image). Absent: equal steps over 360 degrees in the given order (assumed). */
  azimuthsDeg?: number[];
  /** declared camera elevation in degrees. Absent: 0 and recorded as an assumption (elevation is never measured here). */
  elevationDeg?: number;
  /** the azimuths were DERIVED (e.g. from video time at constant angular speed), not declared by the person: poses stay 'assumed' and the direction is chosen by evidence */
  azimuthsAssumed?: boolean;
  /** 'video' marks the evidence mode (frames of one turn of the object) */
  mode?: 'video';
};

export function intakeOrbit(images: readonly IntakeImage[], options: OrbitOptions = {}): IntakeResult {
  const refusals: Refusal[] = [];
  if (images.length < 2) return { evidence: null, refusals: [{ code: 'TOO_FEW_VIEWS', detail: 'at least 2 views of the same object are needed to observe depth; one photograph stays on the AI interpretation path' }], views: [] };
  if (images.length > REALITY_LIMITS.maxViews) return { evidence: null, refusals: [{ code: 'TOO_MANY_VIEWS', detail: `at most ${REALITY_LIMITS.maxViews} views` }], views: [] };
  if (options.azimuthsDeg && options.azimuthsDeg.length !== images.length) return { evidence: null, refusals: [{ code: 'POSE_COUNT_MISMATCH', detail: 'one azimuth per image is required' }], views: [] };
  const prepared = images.map((im) => prepare(im, refusals));
  const views = prepared.filter((p): p is Prepared => !!p).map((p) => p.report);
  if (refusals.length || prepared.some((p) => !p)) return { evidence: null, refusals, views };
  const ps = prepared as Prepared[], res = options.res ?? 160, colourRes = options.colourRes ?? 80, cells = options.cells ?? 96;
  const elevation = options.elevationDeg ?? 0, assumptions: string[] = [];
  const turntable = !options.azimuthsDeg, assumed = turntable || options.azimuthsAssumed === true;
  const azimuths = options.azimuthsDeg ?? ps.map((_, i) => (360 * i) / ps.length);
  assumptions.push(options.azimuthsAssumed ? 'Azimutes derivados do instante de cada fotograma, a velocidade angular constante numa volta completa do vídeo. Não foram medidos.' : turntable ? `Azimutes assumidos: passos iguais de ${(360 / ps.length).toFixed(1)}° na ordem enviada (volta completa). Não foram medidos.` : 'Azimutes indicados por si; não verificados.');
  assumptions.push(options.elevationDeg === undefined ? 'Elevação da câmara desconhecida: assumida 0° (vista horizontal).' : `Elevação ${options.elevationDeg}° indicada por si; não verificada.`);
  assumptions.push('Mesma distância e zoom em todas as vistas (a escala é a mesma fracção da altura da imagem); projecção ortográfica aproximada.');

  // shared scale: one image height = one length unit, so the pixel size follows each image's own height
  const heightUnits = ps.map((p) => (p.report.bbox.y1 - p.report.bbox.y0 + 1) / p.rgba.height);
  const widthUnits = ps.map((p) => (p.report.bbox.x1 - p.report.bbox.x0 + 1) / p.rgba.height);
  const H = median(heightUnits), Wmax = Math.max(...widthUnits);
  const diag = Math.sqrt(H * H + 2 * Wmax * Wmax), half = FRAME_HALF_PER_DIAGONAL * diag * 1.0;
  // rotation axis: for a full orbit the mean of the bbox centres is the axis; for a partial orbit each bbox centre is used (declared as approximate)
  const fullOrbit = turntable || spanOf(azimuths) >= 270 || (options.azimuthsAssumed === true && spanOf(azimuths) >= 200);
  const centresX = ps.map((p) => (p.report.bbox.x0 + p.report.bbox.x1 + 1) / 2);
  const axisX = fullOrbit ? centresX.map((c, i) => c / ps[i]!.rgba.height).reduce((a, b) => a + b, 0) / ps.length : null;
  assumptions.push(fullOrbit ? 'Eixo de rotação na média dos centros horizontais das silhuetas (órbita completa).' : 'Órbita parcial: eixo de rotação assumido no centro horizontal de cada silhueta (aproximação).');
  const medianCy = median(ps.map((p) => (p.report.bbox.y0 + p.report.bbox.y1 + 1) / 2 / p.rgba.height));
  const storedViews: StoredView[] = ps.map((p, i) => {
    const hImg = p.rgba.height, ppu = hImg; // pixels per length unit of this image
    // fixed camera + rotating object (turntable): the axis and the vertical middle are the same in every view; otherwise each silhouette is centred on its own
    const cx = (axisX === null ? centresX[i]! : axisX * hImg), cy = assumed ? medianCy * hImg : (p.report.bbox.y0 + p.report.bbox.y1 + 1) / 2;
    const map = (X: number, Y: number, size: number): [number, number] => {
      const u = ((X / size) * 2 - 1) * half, v = ((Y / size) * 2 - 1) * half; // v grows upward in the window
      return [cx + u * ppu, cy - v * ppu];
    };
    const sampled = resample(p, res, colourRes, map);
    return { id: slug(p.name, i), name: p.name, azimuthDeg: azimuths[i]!, elevationDeg: elevation, azimuthSource: assumed ? 'assumed' : 'given', outline: p.report.maskSource, ...(p.report.maskSource === 'automatic' && p.report.maskMethod ? { outlineMethod: p.report.maskMethod.split(' · ')[0]! } : {}), maskRle: encodeMask(sampled.mask), colour: encodeColour(sampled.rgb, colourRes), window: { cx, cy, ppu } };
  });
  // Turntable direction is not known from the order of the files. Wrong direction makes the cones inconsistent (the hull collapses), right direction is
  // consistent, so the sign is CHOSEN BY EVIDENCE; a symmetric object cannot tell and keeps the default, which is then harmless and declared.
  let viewsOut = storedViews;
  if (assumed) {
    const consistency = (sign: 1 | -1) => {
      const vs: SilhouetteView[] = storedViews.map((v) => ({ id: v.id, res, mask: decodeMask(v.maskRle, res * res), azimuthDeg: sign * v.azimuthDeg, elevationDeg: v.elevationDeg, azimuthSource: 'assumed' }));
      const l = leaveOneOutIoU(vs, { frame: { centre: new Vector3(0, 0, 0), half }, cells: 40 });
      return l.length ? l.reduce((a, b) => a + b, 0) / l.length : 0;
    }, plus = consistency(1), minus = consistency(-1);
    if (minus > plus + 0.02) { viewsOut = storedViews.map((v) => ({ ...v, azimuthDeg: -v.azimuthDeg || 0 })); assumptions.push(`Sentido da volta escolhido pela evidência: o sentido contrário é mais coerente entre vistas (${(minus * 100).toFixed(0)}% contra ${(plus * 100).toFixed(0)}%).`); }
    else if (plus > minus + 0.02) assumptions.push(`Sentido da volta escolhido pela evidência (${(plus * 100).toFixed(0)}% contra ${(minus * 100).toFixed(0)}% no sentido contrário).`);
    else assumptions.push(elevation === 0 ? 'Sentido da volta não identificável: a elevação 0° não distingue um objecto do seu espelho (e um objecto simétrico não precisa). A reconstrução pode estar espelhada (esquerda/direita trocadas); inverta a ordem das imagens se for o caso. Com a câmara elevada isto deixa de ser ambíguo.' : 'Sentido da volta não identificável a partir das silhuetas (objecto aproximadamente simétrico): mantido o sentido por defeito.');
  }
  const evidence: RealityEvidence = { contract: 'unfold.reality-evidence.v1', mode: options.mode === 'video' ? 'video' : turntable ? 'turntable' : 'orbit', res, colourRes, cells, frame: { centre: [0, 0, 0], half }, views: viewsOut, framing: { axisXFrac: axisX, cyFrac: assumed ? medianCy : null }, assumptions };
  // quality and coverage are assessed on the FINAL poses (direction already chosen) so the advice names the right sectors
  const captureViews: CaptureView[] = ps.map((p, i) => ({ azimuthDeg: viewsOut[i]!.azimuthDeg, elevationDeg: viewsOut[i]!.elevationDeg, quality: viewQuality(p.rgba, p.mask), mask: p.mask, width: p.rgba.width, height: p.rgba.height, bboxSide: Math.max(p.report.bbox.x1 - p.report.bbox.x0 + 1, p.report.bbox.y1 - p.report.bbox.y0 + 1) }));
  return { evidence, refusals: [], views, capture: assessCapture(captureViews) };
}

const spanOf = (az: number[]): number => { const s = [...az].map((a) => ((a % 360) + 360) % 360).sort((a, b) => a - b); let maxGap = 0; for (let i = 0; i < s.length; i++) maxGap = Math.max(maxGap, (s[(i + 1) % s.length]! - s[i]! + 360) % 360 || 360); return 360 - maxGap; };

export type DrawingViews = { front: IntakeImage; side: IntakeImage; top: IntakeImage };
export type DrawingOptions = IntakeOptions & {
  /** relative tolerance for the shared dimensions between views (default 3%) */
  tolerance?: number;
  /** the side view shows the front of the object at the left (view from the right, default) or at the right */
  sideFrontAt?: 'left' | 'right';
};

/**
 * Three orthographic views from a technical drawing (front, right side, top), all at the same scale (drawing convention). The views share dimensions:
 * height (front/side), width (front/top) and depth (side/top). The intake CHECKS that they agree and refuses the drawing otherwise, so an inconsistent
 * sheet never produces a quiet, wrong solid. Top view uses the standard layout (front of the object towards the bottom of the sheet).
 */
export function intakeDrawing(drawing: Partial<DrawingViews>, options: DrawingOptions = {}): IntakeResult {
  const refusals: Refusal[] = [];
  for (const k of ['front', 'side', 'top'] as const) if (!drawing[k]) refusals.push({ code: 'MISSING_DRAWING_VIEW', detail: `missing ${k} view` });
  if (refusals.length) return { evidence: null, refusals, views: [] };
  const d = drawing as DrawingViews, order = [d.front, d.side, d.top] as const;
  const prepared = order.map((im) => prepare(im, refusals));
  if (refusals.length || prepared.some((p) => !p)) return { evidence: null, refusals, views: prepared.filter((p): p is Prepared => !!p).map((p) => p.report) };
  const [pf, ps, pt] = prepared as [Prepared, Prepared, Prepared], reports = [pf.report, ps.report, pt.report];
  const dim = (p: Prepared) => ({ w: p.report.bbox.x1 - p.report.bbox.x0 + 1, h: p.report.bbox.y1 - p.report.bbox.y0 + 1 });
  const f = dim(pf), s = dim(ps), t = dim(pt), tol = options.tolerance ?? 0.03;
  const pairs: Array<[string, number, number]> = [['height (front vs side)', f.h, s.h], ['width (front vs top)', f.w, t.w], ['depth (side vs top)', s.w, t.h]];
  const bad = pairs.filter(([, a, b]) => Math.abs(a - b) / Math.max(a, b) > tol);
  if (bad.length) return { evidence: null, refusals: [{ code: 'DRAWING_INCONSISTENT', detail: `the views do not share their dimensions: ${bad.map(([n, a, b]) => `${n} ${a} vs ${b} px`).join('; ')}` }], views: reports };
  const res = options.res ?? 160, colourRes = options.colourRes ?? 80, cells = options.cells ?? 96;
  const Wd = (f.w + t.w) / 2, Hd = (f.h + s.h) / 2, Dd = (s.w + t.h) / 2, scale = Math.max(Wd, Hd, Dd);
  const diag = Math.sqrt(Wd * Wd + Hd * Hd + Dd * Dd), half = FRAME_HALF_PER_DIAGONAL * diag;
  const cxOf = (p: Prepared) => (p.report.bbox.x0 + p.report.bbox.x1 + 1) / 2, cyOf = (p: Prepared) => (p.report.bbox.y0 + p.report.bbox.y1 + 1) / 2;
  const flipSide = (options.sideFrontAt ?? 'left') === 'right';
  const mk = (p: Prepared, sx: 1 | -1, sy: 1 | -1) => (X: number, Y: number, size: number): [number, number] => {
    const u = ((X / size) * 2 - 1) * half * sx, v = ((Y / size) * 2 - 1) * half * sy; return [cxOf(p) + u, cyOf(p) - v];
  };
  const stored = (p: Prepared, id: string, az: number, el: number, map: ReturnType<typeof mk>): StoredView => {
    const sampled = resample(p, res, colourRes, map); return { id, name: p.name, azimuthDeg: az, elevationDeg: el, azimuthSource: 'given', maskRle: encodeMask(sampled.mask), colour: encodeColour(sampled.rgb, colourRes) };
  };
  void scale;
  const assumptions = [
    'Desenho técnico: três vistas ortogonais (frente, lado direito, topo) à mesma escala; dimensões partilhadas verificadas entre vistas.',
    `Vista lateral: a frente do objecto fica à ${flipSide ? 'direita' : 'esquerda'}. Vista de topo: frente do objecto para baixo na folha.`,
    'Escala absoluta desconhecida: as dimensões são relativas (sem cotas lidas).',
  ];
  const evidence: RealityEvidence = {
    contract: 'unfold.reality-evidence.v1', mode: 'orthographic', res, colourRes, cells, frame: { centre: [0, 0, 0], half },
    views: [
      stored(pf, 'front', 0, 0, mk(pf, 1, 1)),
      stored(ps, 'side', 90, 0, mk(ps, flipSide ? -1 : 1, 1)),
      stored(pt, 'top', 0, 90, mk(pt, -1, -1)), // standard sheet layout is the camera view rotated by 180 degrees
    ],
    assumptions,
  };
  return { evidence, refusals: [], views: reports };
}

/**
 * Picks `count` frames of a video whose silhouettes differ most (greedy farthest-point on mask IoU), preserving temporal order. Frames are assumed to
 * come from one slow turn of the object (equal angular speed) - declared by the caller via intakeOrbit's turntable assumption, never measured.
 */
export function selectKeyFrames<T extends { mask: Uint8Array }>(frames: readonly T[], count: number): number[] {
  if (frames.length <= count) return frames.map((_, i) => i);
  const dist = (a: Uint8Array, b: Uint8Array) => { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { i += a[k]! & b[k]!; u += a[k]! | b[k]!; } return u ? 1 - i / u : 0; };
  const picked = [0]; const d = frames.map((f) => dist(f.mask, frames[0]!.mask));
  while (picked.length < count) {
    let best = -1, bd = -1; for (let i = 0; i < frames.length; i++) if (!picked.includes(i) && d[i]! > bd) { bd = d[i]!; best = i; }
    picked.push(best); for (let i = 0; i < frames.length; i++) d[i] = Math.min(d[i]!, dist(frames[i]!.mask, frames[best]!.mask));
  }
  return picked.sort((a, b) => a - b);
}

export type AddViewResult = { evidence: RealityEvidence | null; refusals: Refusal[]; view: ViewReport | null };
/**
 * Frames ONE more photograph exactly as the original views were framed (same window, same scale convention, same axis), with a declared pose, so a new
 * perspective can be integrated without redoing the others. Refuses drawings (no framing record) and unusable outlines.
 */
export function intakeAddView(evidence: RealityEvidence, image: IntakeImage, pose: { azimuthDeg: number; elevationDeg?: number }): AddViewResult {
  const refusals: Refusal[] = [];
  if (!evidence.framing) return { evidence: null, refusals: [{ code: 'POSE_COUNT_MISMATCH', detail: 'this reconstruction has no framing record (technical drawing): add views by redoing the drawing set' }], view: null };
  if (evidence.views.length >= REALITY_LIMITS.maxViews) return { evidence: null, refusals: [{ code: 'TOO_MANY_VIEWS', detail: `at most ${REALITY_LIMITS.maxViews} views` }], view: null };
  const p = prepare(image, refusals);
  if (!p || refusals.length) return { evidence: null, refusals, view: p?.report ?? null };
  const hImg = p.rgba.height, cx = evidence.framing.axisXFrac === null ? (p.report.bbox.x0 + p.report.bbox.x1 + 1) / 2 : evidence.framing.axisXFrac * hImg;
  const cy = evidence.framing.cyFrac === null ? (p.report.bbox.y0 + p.report.bbox.y1 + 1) / 2 : evidence.framing.cyFrac * hImg, half = evidence.frame.half;
  const map = (X: number, Y: number, size: number): [number, number] => [cx + ((X / size) * 2 - 1) * half * hImg, cy - ((Y / size) * 2 - 1) * half * hImg];
  const sampled = resample(p, evidence.res, evidence.colourRes, map);
  const used = new Set(evidence.views.map((v) => v.id)); let id = slug(p.name, evidence.views.length); while (used.has(id)) id += 'x';
  const view: StoredView = { id, name: p.name, azimuthDeg: pose.azimuthDeg, elevationDeg: pose.elevationDeg ?? 0, azimuthSource: 'given', outline: p.report.maskSource, ...(p.report.maskSource === 'automatic' && p.report.maskMethod ? { outlineMethod: p.report.maskMethod.split(' · ')[0]! } : {}), maskRle: encodeMask(sampled.mask), colour: encodeColour(sampled.rgb, evidence.colourRes), window: { cx, cy, ppu: hImg } };
  return { evidence: { ...evidence, views: [...evidence.views, view], assumptions: [...evidence.assumptions, `Vista adicionada «${p.name}» com azimute ${pose.azimuthDeg}° indicado por si; não verificado.`].slice(0, REALITY_LIMITS.maxAssumptions) }, refusals: [], view: p.report };
}
