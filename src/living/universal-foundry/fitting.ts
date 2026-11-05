/**
 * Image-conditioned geometric fitting (first complete path, vehicle family only).
 *
 * Bounded, deterministic grid search over two declared Foundry parameters
 * (`cabinHeight`, `rearSlope`). The objective uses the actual photographic pixels:
 * the evidence mask's column-height profile and bounding-box aspect are compared with
 * the compiled geometry's side-projection profile for each candidate. Colour is never
 * part of the objective, so a colour-only change cannot move the geometry.
 *
 * Camera hypothesis: the evidence is treated as a side view. A near-frontal silhouette
 * (high mirror symmetry with a narrow aspect) is rejected as insufficient evidence and
 * the caller falls back to the conceptual (plan-only) presentation. Nothing here is a
 * measured dimension: fitted values stay `inferred` parameters of the recipe.
 */
import { Box3, type Object3D } from 'three';
import type { SpatialPlanV2 } from '../../universal-spatial/contracts-v2';
import { compileFoundry } from './foundry';
import type { ImageEvidence } from './evidence';

export type SilhouetteReliability = {
  reliable: boolean; reasons: string[];
  metrics: { largestComponentShare: number; bboxFill: number; borderBandShare: number; foregroundRatio: number };
};

/**
 * Fiabilidade da silhueta sem anotação: coerência do objecto extraído. Uma máscara
 * fragmentada, encostada às bordas ou a encher a bbox de forma implausível não é uma
 * silhueta — é contaminação de fundo, e o fitting falha fechado.
 * (Validação contra anotações manuais: IoU 0.20–0.27 nas três fotografias reais actuais.)
 */
export function assessSilhouetteReliability(evidence: ImageEvidence): SilhouetteReliability {
  const { width: w, height: h, mask, bbox } = evidence;
  let band = 0, total = 0;
  const bx = Math.max(1, Math.round(w * 0.06)), by = Math.max(1, Math.round(h * 0.06));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { total++; if (x < bx || x >= w - bx || y < by || y >= h - by) band++; }
  const bboxArea = Math.max(1, (bbox.x1 - bbox.x0 + 1) * (bbox.y1 - bbox.y0 + 1));
  const metrics = {
    largestComponentShare: evidence.largestComponentShare ?? 0,
    bboxFill: total / bboxArea,
    borderBandShare: total ? band / total : 1,
    foregroundRatio: evidence.foregroundRatio,
  };
  // Limiares calibrados no conjunto de validação anotado (3 fotografias reais com IoU
  // 0.20–0.26 recusadas; silhuetas sintéticas limpas com IoU alto aceites). Um gate mais
  // frouxo (0.55/0.30/0.28) APROVAVA as três máscaras más — medido, não presumido.
  const reasons: string[] = [];
  if (metrics.largestComponentShare < 0.75) reasons.push(`objecto fragmentado (maior componente ${(metrics.largestComponentShare * 100).toFixed(0)}% do primeiro plano < 75%)`);
  if (metrics.bboxFill < 0.55) reasons.push(`preenchimento da bbox implausível para uma silhueta de veículo (${(metrics.bboxFill * 100).toFixed(0)}% < 55%)`);
  if (metrics.bboxFill > 0.92) reasons.push(`preenchimento da bbox implausível para uma silhueta de veículo (${(metrics.bboxFill * 100).toFixed(0)}% > 92%: rectângulo, não silhueta)`);
  if (metrics.borderBandShare > 0.15) reasons.push(`contaminação nas bordas (${(metrics.borderBandShare * 100).toFixed(0)}% da máscara na faixa exterior > 15%)`);
  if (metrics.foregroundRatio < 0.03 || metrics.foregroundRatio > 0.7) reasons.push(`primeiro plano fora do intervalo credível (${(metrics.foregroundRatio * 100).toFixed(0)}%)`);
  return { reliable: reasons.length === 0, reasons, metrics };
}

export type FittingResult =
  | { status: 'fitted'; overrides: Record<string, number>; objective: number; baselineObjective: number; candidates: number; summary: string; silhouetteIou?: number; baselineSilhouetteIou?: number; gridSaturated?: string[]; relativeImprovement?: number }
  | { status: 'pending'; reason: string }
  | { status: 'insufficient_evidence'; reason: string }
  | { status: 'unsupported_family'; reason: string }
  | { status: 'aborted'; reason: string };

/** Versão do algoritmo de fitting; faz parte da identidade de qualquer cache de fitting. */
export const FITTING_VERSION = 2;

/**
 * Identidade normalizada da silhueta: hash determinístico sobre os bytes da máscara,
 * dimensões e bounding box. Duas silhuetas com o mesmo aspecto/simetria/rácio mas
 * perfis diferentes têm identidades diferentes — nunca partilham um resultado cacheado.
 */
export function evidenceMaskHash(evidence: ImageEvidence): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  const mix = (n: number) => { h1 = Math.imul(h1 ^ (n & 0xff), 2654435761); h2 = Math.imul(h2 ^ (n & 0xff), 1597334677); };
  for (const n of [evidence.width, evidence.height, evidence.bbox.x0, evidence.bbox.y0, evidence.bbox.x1, evidence.bbox.y1]) { mix(n); mix(n >> 8); mix(n >> 16); }
  for (let i = 0; i < evidence.mask.length; i++) mix(evidence.mask[i]!);
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}`;
}

/** Chave completa de cache: versão do fitting + identidade do plano + identidade da silhueta. */
export function fittingCacheKey(planIdentity: string, evidence: ImageEvidence): string {
  return `fit-v${FITTING_VERSION}|${planIdentity}|${evidenceMaskHash(evidence)}`;
}

const CABIN_HEIGHTS = [0.2, 0.28, 0.36, 0.44, 0.52];
const REAR_SLOPES = [0, 0.25, 0.5, 0.75, 1];
const COLUMNS = 24;

/** Column-height profile (0..1) of the evidence mask inside its bounding box. */
export function evidenceProfile(evidence: ImageEvidence): number[] {
  const { mask, width, bbox } = evidence;
  const profile = new Array<number>(COLUMNS).fill(0);
  const bw = Math.max(1, bbox.x1 - bbox.x0 + 1), bh = Math.max(1, bbox.y1 - bbox.y0 + 1);
  for (let c = 0; c < COLUMNS; c++) {
    const x = bbox.x0 + Math.min(bw - 1, Math.floor((c + 0.5) * bw / COLUMNS));
    let top = -1;
    for (let y = bbox.y0; y <= bbox.y1; y++) if (mask[y * width + x]) { top = y; break; }
    profile[c] = top < 0 ? 0 : 1 - (top - bbox.y0) / bh;
  }
  return profile;
}

/** Side-projection (X length × Y height) column profile of compiled geometry, from mesh bounds. */
export function geometryProfile(root: Object3D): { profile: number[]; aspect: number } {
  root.updateMatrixWorld(true);
  const total = new Box3().setFromObject(root);
  const length = Math.max(1e-6, total.max.x - total.min.x), height = Math.max(1e-6, total.max.y - total.min.y);
  const boxes: Array<{ minX: number; maxX: number; topY: number }> = [];
  root.traverse((o) => {
    const mesh = o as { isMesh?: boolean };
    if (!mesh.isMesh) return;
    const b = new Box3().setFromObject(o);
    if (Number.isFinite(b.min.x) && Number.isFinite(b.max.x)) boxes.push({ minX: b.min.x, maxX: b.max.x, topY: b.max.y });
  });
  const profile = new Array<number>(COLUMNS).fill(0);
  for (let c = 0; c < COLUMNS; c++) {
    const x = total.min.x + (c + 0.5) * length / COLUMNS;
    let top = total.min.y;
    for (const b of boxes) if (x >= b.minX && x <= b.maxX && b.topY > top) top = b.topY;
    profile[c] = (top - total.min.y) / height;
  }
  return { profile, aspect: length / height };
}

export const SILHOUETTE_COLS = 72;
export const SILHOUETTE_ROWS = 36;

/**
 * Silhueta projectada REAL da geometria: rasterização dos triângulos compilados em
 * vista lateral ortográfica (X = comprimento, Y = altura; hipótese de câmara declarada),
 * numa grelha fixa. Substitui perfis de alturas de AABBs, que não viam a forma projectada.
 */
export function projectedSilhouette(root: Object3D): Uint8Array {
  root.updateMatrixWorld(true);
  const total = new Box3().setFromObject(root);
  const grid = new Uint8Array(SILHOUETTE_COLS * SILHOUETTE_ROWS);
  const sx = SILHOUETTE_COLS / Math.max(1e-9, total.max.x - total.min.x);
  const sy = SILHOUETTE_ROWS / Math.max(1e-9, total.max.y - total.min.y);
  root.traverse((o) => {
    const mesh = o as { isMesh?: boolean; geometry?: { getAttribute(name: string): { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number }; index?: { count: number; getX(i: number): number } | null }; matrixWorld?: { elements: number[] } };
    if (!mesh.isMesh || !mesh.geometry || !mesh.matrixWorld) return;
    const pos = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.index;
    const e = mesh.matrixWorld.elements;
    const triCount = index ? index.count / 3 : pos.count / 3;
    const point = (i: number): [number, number] => {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const worldY = x * e[1]! + y * e[5]! + z * e[9]! + e[13]!;
      // grelha: linha 0 = topo (Y máximo), como nas linhas da imagem
      return [((x * e[0]! + y * e[4]! + z * e[8]! + e[12]!) - total.min.x) * sx, (total.max.y - worldY) * sy];
    };
    for (let t = 0; t < triCount; t++) {
      const ia = index ? index.getX(t * 3) : t * 3, ib = index ? index.getX(t * 3 + 1) : t * 3 + 1, ic = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      const a = point(ia), b = point(ib), c = point(ic);
      const minCx = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), maxCx = Math.min(SILHOUETTE_COLS - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
      const minCy = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), maxCy = Math.min(SILHOUETTE_ROWS - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
      const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.abs(area) < 1e-9) continue;
      // Triângulos sub-célula (a maioria numa malha densa): marcar a célula do centróide
      // chega para a silhueta e evita o teste baricêntrico por célula.
      if (maxCx - minCx <= 1 && maxCy - minCy <= 1) {
        const gx = Math.min(SILHOUETTE_COLS - 1, Math.max(0, Math.floor((a[0] + b[0] + c[0]) / 3)));
        const gy = Math.min(SILHOUETTE_ROWS - 1, Math.max(0, Math.floor((a[1] + b[1] + c[1]) / 3)));
        grid[gy * SILHOUETTE_COLS + gx] = 1;
        continue;
      }
      for (let cy = minCy; cy <= maxCy; cy++) for (let cx = minCx; cx <= maxCx; cx++) {
        const px = cx + 0.5, py = cy + 0.5;
        const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
        const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 >= -1e-6 && w1 >= -1e-6 && w2 >= -1e-6) grid[cy * SILHOUETTE_COLS + cx] = 1;
      }
    }
  });
  return grid;
}

/** Reamostra a máscara de evidência (dentro da sua bbox) para a grelha da silhueta projectada. */
export function resampleEvidenceMask(evidence: ImageEvidence): Uint8Array {
  const grid = new Uint8Array(SILHOUETTE_COLS * SILHOUETTE_ROWS);
  const { mask, width, bbox } = evidence;
  const bw = Math.max(1, bbox.x1 - bbox.x0 + 1), bh = Math.max(1, bbox.y1 - bbox.y0 + 1);
  for (let cy = 0; cy < SILHOUETTE_ROWS; cy++) for (let cx = 0; cx < SILHOUETTE_COLS; cx++) {
    const x = bbox.x0 + Math.min(bw - 1, Math.floor((cx + 0.5) * bw / SILHOUETTE_COLS));
    const y = bbox.y0 + Math.min(bh - 1, Math.floor((cy + 0.5) * bh / SILHOUETTE_ROWS));
    grid[cy * SILHOUETTE_COLS + cx] = mask[y * width + x]!;
  }
  return grid;
}

export function gridIoU(a: Uint8Array, b: Uint8Array): number {
  let i = 0, u = 0;
  for (let k = 0; k < a.length; k++) { if (a[k] && b[k]) i++; if (a[k] || b[k]) u++; }
  return u ? i / u : 0;
}

type Candidate = { cabinHeight: number; rearSlope: number };
const CANDIDATES: Candidate[] = CABIN_HEIGHTS.flatMap((cabinHeight) => REAR_SLOPES.map((rearSlope) => ({ cabinHeight, rearSlope })));

/** Objectivo = 1 − IoU entre a silhueta projectada dos triângulos e a máscara reamostrada. */
function objectiveOf(plan: SpatialPlanV2, overrides: Record<string, number>, targetMask: Uint8Array, evidence: ImageEvidence): number | null {
  const candidate = compileFoundry(plan, { overrides, lod: 0 });
  try {
    if (!candidate.root || !candidate.recipe) return null;
    candidate.buildAll(); // a silhueta mede a geometria gerada, nunca o placeholder V2
    void evidence;
    return 1 - gridIoU(projectedSilhouette(candidate.root), targetMask);
  } finally { candidate.retire?.(); }
}

const MIN_RELATIVE_IMPROVEMENT = 0.05;

/**
 * Conclusão com análise de graus de liberdade: se o melhor candidato da grelha limitada
 * melhora menos de 5% sobre o baseline genuíno, a geometria (2 parâmetros) não tem graus
 * de liberdade suficientes para esta silhueta — recusa honesta, não um número bonito.
 * Vencedor na fronteira da grelha é reportado como saturação, nunca escondido.
 */
function conclude(best: { overrides: Record<string, number>; objective: number }, baselineObjective: number, evaluated: number): FittingResult {
  const relativeImprovement = baselineObjective > 1e-9 ? (baselineObjective - best.objective) / baselineObjective : 0;
  const gridSaturated = [
    ...(best.overrides.cabinHeight === CABIN_HEIGHTS[0] || best.overrides.cabinHeight === CABIN_HEIGHTS[CABIN_HEIGHTS.length - 1] ? ['cabinHeight'] : []),
    ...(best.overrides.rearSlope === REAR_SLOPES[0] || best.overrides.rearSlope === REAR_SLOPES[REAR_SLOPES.length - 1] ? ['rearSlope'] : []),
  ];
  if (relativeImprovement < MIN_RELATIVE_IMPROVEMENT) {
    return {
      status: 'insufficient_evidence',
      reason: `Graus de liberdade insuficientes: o melhor candidato melhora ${(relativeImprovement * 100).toFixed(1)}% sobre o baseline (IoU silhueta ${(1 - baselineObjective).toFixed(3)} → ${(1 - best.objective).toFixed(3)}, mínimo ${(MIN_RELATIVE_IMPROVEMENT * 100).toFixed(0)}%)${gridSaturated.length ? `, com saturação da grelha em ${gridSaturated.join(', ')}` : ''}. Dois parâmetros de cabina não reproduzem esta silhueta; apresentação conceptual sem fitting.`,
    };
  }
  return {
    status: 'fitted', overrides: best.overrides, objective: best.objective, baselineObjective, candidates: evaluated,
    silhouetteIou: 1 - best.objective, baselineSilhouetteIou: 1 - baselineObjective, gridSaturated, relativeImprovement,
    summary: `Fitting por silhueta projectada v${FITTING_VERSION} (${evaluated} candidatos limitados): cabinHeight=${best.overrides.cabinHeight}, rearSlope=${best.overrides.rearSlope}; IoU de silhueta ${(1 - baselineObjective).toFixed(3)} → ${(1 - best.objective).toFixed(3)}${gridSaturated.length ? `; grelha saturada em ${gridSaturated.join(', ')} (fronteira — não estendida para embelezar)` : ''}. Parâmetros inferidos da imagem, não dimensões verificadas.`,
  };
}

function gateAndBaseline(plan: SpatialPlanV2, evidence: ImageEvidence, targetMask: Uint8Array):
  | { ok: true; baselineObjective: number }
  | { ok: false; result: FittingResult } {
  if (evidence.symmetry > 0.72 && evidence.aspect < 1.7) {
    return { ok: false, result: { status: 'insufficient_evidence', reason: `Silhueta quase frontal (simetria ${evidence.symmetry.toFixed(2)}, aspecto ${evidence.aspect.toFixed(2)}): hipótese de câmara lateral não suportada; apresentação conceptual sem fitting.` } };
  }
  if (evidence.foregroundRatio < 0.02) return { ok: false, result: { status: 'insufficient_evidence', reason: 'Primeiro plano demasiado pequeno na imagem para medir uma silhueta.' } };
  if (evidence.foregroundRatio > 0.8) return { ok: false, result: { status: 'insufficient_evidence', reason: `Máscara não credível: o primeiro plano cobre ${(evidence.foregroundRatio * 100).toFixed(0)}% da imagem (fundo e sujeito indistinguíveis); sem fitting a partir desta máscara.` } };
  const reliability = assessSilhouetteReliability(evidence);
  if (!reliability.reliable) {
    return { ok: false, result: { status: 'insufficient_evidence', reason: `Silhueta não fiável (falha fechado): ${reliability.reasons.join('; ')}. Sem máscara de confiança não há fitting — uma recusa correcta vale mais que um modelo enganador.` } };
  }
  const probe = compileFoundry(plan, {});
  try {
    if (!probe.recipe) return { ok: false, result: { status: 'unsupported_family', reason: 'Plano sem receita Foundry reconhecida.' } };
    if (probe.recipe.category !== 'vehicle') return { ok: false, result: { status: 'unsupported_family', reason: `Fitting geométrico disponível apenas para a família vehicle (esta cena: ${probe.recipe.category}).` } };
  } finally { probe.retire?.(); }
  // Baseline GENUÍNO: o objectivo da geometria compilada por omissão (overrides {}),
  // calculado independentemente da grelha. Nunca é substituído pelo objectivo do vencedor.
  const baselineObjective = objectiveOf(plan, {}, targetMask, evidence);
  if (baselineObjective === null) return { ok: false, result: { status: 'insufficient_evidence', reason: 'A geometria por omissão não compilou; sem baseline não há fitting.' } };
  return { ok: true, baselineObjective };
}

export function fitGeometryToEvidence(plan: SpatialPlanV2, evidence: ImageEvidence, opts: { signal?: AbortSignal; maxCandidates?: number } = {}): FittingResult {
  const target = resampleEvidenceMask(evidence);
  const gate = gateAndBaseline(plan, evidence, target);
  if (!gate.ok) return gate.result;
  const maxCandidates = opts.maxCandidates ?? CANDIDATES.length;
  let best: { overrides: Record<string, number>; objective: number } | null = null;
  let evaluated = 0;
  for (const candidate of CANDIDATES) {
    if (evaluated >= maxCandidates) break;
    if (opts.signal?.aborted) return { status: 'aborted', reason: 'Fitting cancelado; nenhum parâmetro foi aplicado.' };
    evaluated++;
    const objective = objectiveOf(plan, { cabinHeight: candidate.cabinHeight, rearSlope: candidate.rearSlope }, target, evidence);
    if (objective === null) continue;
    if (!best || objective < best.objective - 1e-9) best = { overrides: { cabinHeight: candidate.cabinHeight, rearSlope: candidate.rearSlope }, objective };
  }
  if (!best) return { status: 'insufficient_evidence', reason: 'Nenhum candidato compilou dentro dos limites do fitting.' };
  return conclude(best, gate.baselineObjective, evaluated);
}

export type FittingProgress = { evaluated: number; total: number };

/**
 * Fitting assíncrono e interrompível para o caminho interactivo: avalia candidatos em
 * blocos pequenos e cede o event loop entre blocos, com progresso, cancelamento por
 * AbortSignal e o mesmo resultado determinístico da versão síncrona. Quem chama é
 * responsável por rejeitar resultados stale (geração/época) antes de os aplicar.
 */
export async function fitGeometryToEvidenceAsync(plan: SpatialPlanV2, evidence: ImageEvidence, opts: {
  signal?: AbortSignal;
  onProgress?: (progress: FittingProgress) => void;
  chunkSize?: number;
  yieldBetweenChunks?: () => Promise<void>;
} = {}): Promise<FittingResult> {
  const target = resampleEvidenceMask(evidence);
  const gate = gateAndBaseline(plan, evidence, target);
  if (!gate.ok) return gate.result;
  const chunkSize = Math.max(1, Math.min(5, opts.chunkSize ?? 2));
  const yieldNow = opts.yieldBetweenChunks ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  let best: { overrides: Record<string, number>; objective: number } | null = null;
  let evaluated = 0;
  for (let start = 0; start < CANDIDATES.length; start += chunkSize) {
    if (opts.signal?.aborted) return { status: 'aborted', reason: 'Fitting cancelado; nenhum parâmetro foi aplicado.' };
    for (const candidate of CANDIDATES.slice(start, start + chunkSize)) {
      evaluated++;
      const objective = objectiveOf(plan, { cabinHeight: candidate.cabinHeight, rearSlope: candidate.rearSlope }, target, evidence);
      if (objective === null) continue;
      if (!best || objective < best.objective - 1e-9) best = { overrides: { cabinHeight: candidate.cabinHeight, rearSlope: candidate.rearSlope }, objective };
    }
    opts.onProgress?.({ evaluated, total: CANDIDATES.length });
    if (start + chunkSize < CANDIDATES.length) await yieldNow();
  }
  if (opts.signal?.aborted) return { status: 'aborted', reason: 'Fitting cancelado; nenhum parâmetro foi aplicado.' };
  if (!best) return { status: 'insufficient_evidence', reason: 'Nenhum candidato compilou dentro dos limites do fitting.' };
  return conclude(best, gate.baselineObjective, evaluated);
}
