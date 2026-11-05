/**
 * Image-conditioned geometric fitting (vehicle family).
 *
 * v3: deterministic coarse-to-fine coordinate descent over eight interpretable shape
 * parameters (cabin height/start/end, rear slope, hood height, tail height, roof
 * curvature, body height scale) instead of the former two-parameter grid. The objective
 * compares the compiled geometry's rasterized side-projection silhouette with the
 * evidence mask (total IoU weighted with front/middle/rear regional IoU). Colour is
 * never part of the objective, so a colour-only change cannot move the geometry.
 *
 * Camera hypotheses are explicit and bounded: `side`, `three-quarter` (projection is an
 * approximation, declared in every summary) and `front-rear` (refused). Nothing here is
 * a measured dimension: fitted values stay `inferred` parameters of the recipe.
 */
import { Box3, type Object3D } from 'three';
import type { SpatialPlanV2 } from '../../universal-spatial/contracts-v2';
import { compileFoundry } from './foundry';
import type { ImageEvidence } from './evidence';
import { detectWheelLandmarks, estimateCamera } from './landmarks';

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
  | { status: 'fitted'; overrides: Record<string, number>; objective: number; baselineObjective: number; candidates: number; summary: string; silhouetteIou?: number; baselineSilhouetteIou?: number; gridSaturated?: string[]; relativeImprovement?: number; cameraAzimuthDeg?: number; cameraAmbiguous?: boolean }
  | { status: 'pending'; reason: string }
  | { status: 'insufficient_evidence'; reason: string }
  | { status: 'unsupported_family'; reason: string }
  | { status: 'aborted'; reason: string };

/** Versão do algoritmo de fitting; faz parte da identidade de qualquer cache de fitting. */
export const FITTING_VERSION = 3;

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
export function projectedSilhouette(root: Object3D, azimuthDeg = 0): Uint8Array {
  root.updateMatrixWorld(true);
  const total = new Box3().setFromObject(root);
  const grid = new Uint8Array(SILHOUETTE_COLS * SILHOUETTE_ROWS);
  // Projecção ortográfica a partir do azimute estimado: X' = X·cosθ + Z·sinθ.
  // A grelha abrange a bbox rodada (8 cantos), como a máscara abrange a sua bbox.
  const cosA = Math.cos(azimuthDeg * Math.PI / 180), sinA = Math.sin(azimuthDeg * Math.PI / 180);
  let rotMinX = Infinity, rotMaxX = -Infinity;
  for (const cx of [total.min.x, total.max.x]) for (const cz of [total.min.z, total.max.z]) {
    const xr = cx * cosA + cz * sinA;
    rotMinX = Math.min(rotMinX, xr); rotMaxX = Math.max(rotMaxX, xr);
  }
  const sx = SILHOUETTE_COLS / Math.max(1e-9, rotMaxX - rotMinX);
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
      const worldX = x * e[0]! + y * e[4]! + z * e[8]! + e[12]!;
      const worldY = x * e[1]! + y * e[5]! + z * e[9]! + e[13]!;
      const worldZ = x * e[2]! + y * e[6]! + z * e[10]! + e[14]!;
      // grelha: linha 0 = topo (Y máximo), como nas linhas da imagem
      return [(worldX * cosA + worldZ * sinA - rotMinX) * sx, (total.max.y - worldY) * sy];
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

/** Parâmetros de forma ajustáveis (gamas das ParamSpecs da família; defaults do arquétipo). */
export const FITTING_PARAMS: Array<{ key: string; min: number; max: number }> = [
  { key: 'cabinHeight', min: 0.2, max: 0.55 },
  { key: 'cabinStart', min: 0.04, max: 0.4 },
  { key: 'cabinEnd', min: 0.5, max: 0.9 },
  { key: 'rearSlope', min: 0, max: 1 },
  { key: 'hoodHeight', min: 0.6, max: 1.05 },
  { key: 'tailHeight', min: 0.6, max: 1.05 },
  { key: 'roofCurvature', min: 0.85, max: 1.08 },
  { key: 'bodyHeightScale', min: 0.9, max: 1.1 },
  { key: 'shoulderHeight', min: 0.85, max: 1.05 },
  { key: 'roofFront', min: 0.7, max: 1.15 },
  { key: 'roofRear', min: 0.7, max: 1.15 },
  { key: 'wheelScale', min: 0.85, max: 1.15 },
];
const SEARCH_STEPS = [0.06, 0.03, 0.015];

export type CameraHypothesis = 'side' | 'three-quarter' | 'front-rear';
/**
 * Hipótese de câmara limitada e declarada. Não estima calibração: classifica o que a
 * silhueta permite assumir. `three-quarter` ajusta com a projecção lateral como
 * aproximação declarada; `front-rear` é recusado.
 */
export function cameraHypothesis(evidence: ImageEvidence): { kind: CameraHypothesis; reason: string } {
  if (evidence.symmetry > 0.72 && evidence.aspect < 1.7) return { kind: 'front-rear', reason: `simetria ${evidence.symmetry.toFixed(2)} com aspecto ${evidence.aspect.toFixed(2)}: vista frontal/traseira, sem perfil lateral para ajustar` };
  if (evidence.aspect >= 2.35) return { kind: 'side', reason: `aspecto da silhueta ${evidence.aspect.toFixed(2)} compatível com perfil lateral aproximado` };
  return { kind: 'three-quarter', reason: `aspecto da silhueta ${evidence.aspect.toFixed(2)}: provável vista de três-quartos; a projecção lateral é uma aproximação declarada, não uma medição do perfil` };
}

/** IoU por terços horizontais [frente(+X), meio, traseira] da grelha de silhueta. */
export function regionalIoUs(projected: Uint8Array, target: Uint8Array): [number, number, number] {
  const thirds: Array<[number, number, number]> = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let y = 0; y < SILHOUETTE_ROWS; y++) for (let x = 0; x < SILHOUETTE_COLS; x++) {
    const t = Math.min(2, Math.floor(x / (SILHOUETTE_COLS / 3)));
    const a = projected[y * SILHOUETTE_COLS + x]!, b = target[y * SILHOUETTE_COLS + x]!;
    if (a && b) thirds[t]![0]++;
    if (a || b) thirds[t]![1]++;
  }
  return thirds.map(([i, u]) => (u ? i / u : 0)) as [number, number, number];
}

type ObjectiveBreakdown = { objective: number; iou: number; regional: [number, number, number] };

/** Objectivo ponderado e documentado: 0.55·IoU total + 0.45·média dos IoU regionais. */
function objectiveOf(plan: SpatialPlanV2, overrides: Record<string, number>, targetMask: Uint8Array, azimuthDeg = 0): ObjectiveBreakdown | null {
  const candidate = compileFoundry(plan, { overrides, lod: 0 });
  try {
    if (!candidate.root || !candidate.recipe) return null;
    candidate.buildAll(); // a silhueta mede a geometria gerada, nunca o placeholder V2
    const projected = projectedSilhouette(candidate.root, azimuthDeg);
    const iou = gridIoU(projected, targetMask);
    const regional = regionalIoUs(projected, targetMask);
    const score = 0.55 * iou + 0.45 * ((regional[0] + regional[1] + regional[2]) / 3);
    return { objective: 1 - score, iou, regional };
  } finally { candidate.retire?.(); }
}

const MIN_RELATIVE_IMPROVEMENT = 0.05;

function conclude(best: { overrides: Record<string, number>; objective: number; iou: number; regional: [number, number, number] }, baseline: ObjectiveBreakdown, evaluated: number, camera: CameraHypothesis, azimuthDeg = 0, cameraAmbiguous = false): FittingResult {
  const relativeImprovement = baseline.objective > 1e-9 ? (baseline.objective - best.objective) / baseline.objective : 0;
  const gridSaturated = FITTING_PARAMS.filter((p) => {
    const v = best.overrides[p.key];
    return v !== undefined && (Math.abs(v - p.min) < 1e-9 || Math.abs(v - p.max) < 1e-9);
  }).map((p) => p.key);
  if (relativeImprovement < MIN_RELATIVE_IMPROVEMENT) {
    return {
      status: 'insufficient_evidence',
      reason: `Graus de liberdade insuficientes: o melhor candidato melhora ${(relativeImprovement * 100).toFixed(1)}% sobre o baseline (IoU silhueta ${baseline.iou.toFixed(3)} → ${best.iou.toFixed(3)}, mínimo ${(MIN_RELATIVE_IMPROVEMENT * 100).toFixed(0)}%)${gridSaturated.length ? `, com saturação em ${gridSaturated.join(', ')}` : ''}. A representação actual não reproduz esta silhueta; apresentação conceptual sem fitting.`,
    };
  }
  return {
    status: 'fitted', overrides: best.overrides, objective: best.objective, baselineObjective: baseline.objective, candidates: evaluated,
    silhouetteIou: best.iou, baselineSilhouetteIou: baseline.iou, gridSaturated, relativeImprovement, cameraAzimuthDeg: azimuthDeg, cameraAmbiguous,
    summary: `Fitting v${FITTING_VERSION} por descida de coordenadas (${evaluated} avaliações, câmara: ${camera} a ${azimuthDeg.toFixed(0)}°${cameraAmbiguous ? ', ambígua — verificada também em perfil lateral' : ''}): IoU de silhueta ${baseline.iou.toFixed(3)} → ${best.iou.toFixed(3)} (regiões frente/meio/traseira ${best.regional.map((v) => v.toFixed(2)).join('/')}); parâmetros ${Object.entries(best.overrides).map(([k, v]) => `${k}=${+v.toFixed(3)}`).join(', ')}${gridSaturated.length ? `; saturação em ${gridSaturated.join(', ')} (fronteira declarada, não estendida)` : ''}. Parâmetros inferidos da imagem, não dimensões verificadas.`,
  };
}

function gateAndBaseline(plan: SpatialPlanV2, evidence: ImageEvidence, targetMask: Uint8Array):
  | { ok: true; baseline: ObjectiveBreakdown; defaults: Record<string, number>; camera: CameraHypothesis; azimuthDeg: number; cameraAmbiguous: boolean }
  | { ok: false; result: FittingResult } {
  const estimate = estimateCamera(evidence, detectWheelLandmarks(evidence));
  const camera = estimate.kind;
  if (camera === 'front-rear') {
    return { ok: false, result: { status: 'insufficient_evidence', reason: `Hipótese de câmara recusada: ${estimate.method}. Apresentação conceptual sem fitting.` } };
  }
  if (evidence.foregroundRatio < 0.02) return { ok: false, result: { status: 'insufficient_evidence', reason: 'Primeiro plano demasiado pequeno na imagem para medir uma silhueta.' } };
  if (evidence.foregroundRatio > 0.8) return { ok: false, result: { status: 'insufficient_evidence', reason: `Máscara não credível: o primeiro plano cobre ${(evidence.foregroundRatio * 100).toFixed(0)}% da imagem (fundo e sujeito indistinguíveis); sem fitting a partir desta máscara.` } };
  const reliability = assessSilhouetteReliability(evidence);
  if (!reliability.reliable) {
    return { ok: false, result: { status: 'insufficient_evidence', reason: `Silhueta não fiável (falha fechado): ${reliability.reasons.join('; ')}. Sem máscara de confiança não há fitting — uma recusa correcta vale mais que um modelo enganador.` } };
  }
  const probe = compileFoundry(plan, {});
  let defaults: Record<string, number> = {};
  try {
    if (!probe.recipe) return { ok: false, result: { status: 'unsupported_family', reason: 'Plano sem receita Foundry reconhecida.' } };
    if (probe.recipe.category !== 'vehicle') return { ok: false, result: { status: 'unsupported_family', reason: `Fitting geométrico disponível apenas para a família vehicle (esta cena: ${probe.recipe.category}).` } };
    defaults = Object.fromEntries(FITTING_PARAMS.map((p) => [p.key, Number(probe.recipe!.params[p.key] ?? p.min)]));
  } finally { probe.retire?.(); }
  // Baseline GENUÍNO: o objectivo da geometria compilada por omissão (overrides {}),
  // calculado independentemente da procura. Nunca é substituído pelo objectivo do vencedor.
  const baseline = objectiveOf(plan, {}, targetMask, estimate.azimuthDeg);
  if (baseline === null) return { ok: false, result: { status: 'insufficient_evidence', reason: 'A geometria por omissão não compilou; sem baseline não há fitting.' } };
  return { ok: true, baseline, defaults, camera, azimuthDeg: estimate.azimuthDeg, cameraAmbiguous: estimate.ambiguous };
}

type SearchState = {
  current: Record<string, number>;
  currentObjective: ObjectiveBreakdown;
  evaluated: number;
};

/** Um parâmetro da descida: tenta ±passo e fica com a melhor melhoria. */
function descentParam(plan: SpatialPlanV2, target: Uint8Array, state: SearchState, param: { key: string; min: number; max: number }, step: number, signal?: AbortSignal, budget = Number.POSITIVE_INFINITY, azimuthDeg = 0): void {
  for (const direction of [1, -1] as const) {
    if (state.evaluated >= budget || signal?.aborted) break;
    const value = Math.min(param.max, Math.max(param.min, state.current[param.key]! + direction * step * (param.max - param.min)));
    if (Math.abs(value - state.current[param.key]!) < 1e-9) continue;
    const candidate = { ...state.current, [param.key]: value };
    state.evaluated++;
    const result = objectiveOf(plan, candidate, target, azimuthDeg);
    if (result && result.objective < state.currentObjective.objective - 1e-9) {
      state.current = candidate; state.currentObjective = result;
    }
  }
}

/** Descida por coordenadas determinística (grosso→fino): um parâmetro de cada vez, ±passo. */
function descentRound(plan: SpatialPlanV2, target: Uint8Array, state: SearchState, step: number, signal?: AbortSignal, budget = Number.POSITIVE_INFINITY, azimuthDeg = 0): void {
  for (const param of FITTING_PARAMS) {
    if (state.evaluated >= budget || signal?.aborted) break;
    descentParam(plan, target, state, param, step, signal, budget, azimuthDeg);
  }
}

export function fitGeometryToEvidence(plan: SpatialPlanV2, evidence: ImageEvidence, opts: { signal?: AbortSignal; maxCandidates?: number } = {}): FittingResult {
  const target = resampleEvidenceMask(evidence);
  const gate = gateAndBaseline(plan, evidence, target);
  if (!gate.ok) return gate.result;
  const state: SearchState = { current: { ...gate.defaults }, currentObjective: gate.baseline, evaluated: 1 };
  const budget = opts.maxCandidates ?? 80;
  for (const step of SEARCH_STEPS) {
    if (opts.signal?.aborted) return { status: 'aborted', reason: 'Fitting cancelado; nenhum parâmetro foi aplicado.' };
    descentRound(plan, target, state, step, opts.signal, budget, gate.azimuthDeg);
  }
  if (opts.signal?.aborted) return { status: 'aborted', reason: 'Fitting cancelado; nenhum parâmetro foi aplicado.' };
  return concludeWithCameraCheck(plan, target, state, gate);
}

export type FittingProgress = { evaluated: number; total: number };

/**
 * Com câmara ambígua (só silhueta), a solução tem de continuar a melhorar em perfil
 * lateral (0°): uma solução que só funciona no azimute assumido é rejeitada como
 * ambígua em vez de deformar o objecto silenciosamente.
 */
function concludeWithCameraCheck(plan: SpatialPlanV2, target: Uint8Array, state: SearchState, gate: Extract<ReturnType<typeof gateAndBaseline>, { ok: true }>): FittingResult {
  if (gate.cameraAmbiguous && gate.azimuthDeg !== 0) {
    const baselineSide = objectiveOf(plan, gate.defaults, target, 0);
    const fittedSide = objectiveOf(plan, state.current, target, 0);
    state.evaluated += 2;
    if (baselineSide && fittedSide && fittedSide.iou < baselineSide.iou - 0.01) {
      return { status: 'insufficient_evidence', reason: `Câmara ambígua: a solução melhora no azimute assumido (${gate.azimuthDeg.toFixed(0)}°) mas degrada em perfil lateral (IoU ${baselineSide.iou.toFixed(3)} → ${fittedSide.iou.toFixed(3)}). Recusada em vez de deformar o objecto com uma hipótese incerta (incerteza ±${28}°).` };
    }
  }
  return conclude({ overrides: { ...state.current }, objective: state.currentObjective.objective, iou: state.currentObjective.iou, regional: state.currentObjective.regional }, gate.baseline, state.evaluated, gate.camera, gate.azimuthDeg, gate.cameraAmbiguous);
}

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
  void opts.chunkSize;
  const yieldNow = opts.yieldBetweenChunks ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  const state: SearchState = { current: { ...gate.defaults }, currentObjective: gate.baseline, evaluated: 1 };
  const totalBudget = FITTING_PARAMS.length * 2 * SEARCH_STEPS.length + 1;
  for (const step of SEARCH_STEPS) {
    if (opts.signal?.aborted) return { status: 'aborted', reason: 'Fitting cancelado; nenhum parâmetro foi aplicado.' };
    // descida em fatias: uma ronda parcial por cedência, com progresso entre parâmetros
    for (const param of FITTING_PARAMS) {
      if (opts.signal?.aborted) return { status: 'aborted', reason: 'Fitting cancelado; nenhum parâmetro foi aplicado.' };
      descentParam(plan, target, state, param, step, opts.signal, Number.POSITIVE_INFINITY, gate.azimuthDeg);
      opts.onProgress?.({ evaluated: state.evaluated, total: totalBudget });
      await yieldNow();
    }
  }
  if (opts.signal?.aborted) return { status: 'aborted', reason: 'Fitting cancelado; nenhum parâmetro foi aplicado.' };
  return concludeWithCameraCheck(plan, target, state, gate);
}
