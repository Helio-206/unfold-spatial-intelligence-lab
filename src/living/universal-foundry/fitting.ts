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

export type FittingResult =
  | { status: 'fitted'; overrides: Record<string, number>; objective: number; baselineObjective: number; candidates: number; summary: string }
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

const profileError = (a: number[], b: number[]) => a.reduce((s, v, i) => s + Math.abs(v - (b[i] ?? 0)), 0) / a.length;

type Candidate = { cabinHeight: number; rearSlope: number };
const CANDIDATES: Candidate[] = CABIN_HEIGHTS.flatMap((cabinHeight) => REAR_SLOPES.map((rearSlope) => ({ cabinHeight, rearSlope })));

function objectiveOf(plan: SpatialPlanV2, overrides: Record<string, number>, target: number[], evidence: ImageEvidence): number | null {
  const candidate = compileFoundry(plan, { overrides, lod: 0 });
  try {
    if (!candidate.root || !candidate.recipe) return null;
    candidate.buildAll(); // o perfil mede a geometria gerada, nunca o placeholder V2
    const geo = geometryProfile(candidate.root);
    return profileError(geo.profile, target) + 0.5 * Math.abs(Math.log(geo.aspect / Math.max(0.2, evidence.aspect)));
  } finally { candidate.retire?.(); }
}

function gateAndBaseline(plan: SpatialPlanV2, evidence: ImageEvidence, target: number[]):
  | { ok: true; baselineObjective: number }
  | { ok: false; result: FittingResult } {
  if (evidence.symmetry > 0.72 && evidence.aspect < 1.7) {
    return { ok: false, result: { status: 'insufficient_evidence', reason: `Silhueta quase frontal (simetria ${evidence.symmetry.toFixed(2)}, aspecto ${evidence.aspect.toFixed(2)}): hipótese de câmara lateral não suportada; apresentação conceptual sem fitting.` } };
  }
  if (evidence.foregroundRatio < 0.02) return { ok: false, result: { status: 'insufficient_evidence', reason: 'Primeiro plano demasiado pequeno na imagem para medir uma silhueta.' } };
  if (evidence.foregroundRatio > 0.8) return { ok: false, result: { status: 'insufficient_evidence', reason: `Máscara não credível: o primeiro plano cobre ${(evidence.foregroundRatio * 100).toFixed(0)}% da imagem (fundo e sujeito indistinguíveis); sem fitting a partir desta máscara.` } };
  const probe = compileFoundry(plan, {});
  try {
    if (!probe.recipe) return { ok: false, result: { status: 'unsupported_family', reason: 'Plano sem receita Foundry reconhecida.' } };
    if (probe.recipe.category !== 'vehicle') return { ok: false, result: { status: 'unsupported_family', reason: `Fitting geométrico disponível apenas para a família vehicle (esta cena: ${probe.recipe.category}).` } };
  } finally { probe.retire?.(); }
  // Baseline GENUÍNO: o objectivo da geometria compilada por omissão (overrides {}),
  // calculado independentemente da grelha. Nunca é substituído pelo objectivo do vencedor.
  const baselineObjective = objectiveOf(plan, {}, target, evidence);
  if (baselineObjective === null) return { ok: false, result: { status: 'insufficient_evidence', reason: 'A geometria por omissão não compilou; sem baseline não há fitting.' } };
  return { ok: true, baselineObjective };
}

const fitted = (best: { overrides: Record<string, number>; objective: number }, baselineObjective: number, evaluated: number): FittingResult => ({
  status: 'fitted', overrides: best.overrides, objective: best.objective, baselineObjective, candidates: evaluated,
  summary: `Fitting por silhueta v${FITTING_VERSION} (${evaluated} candidatos limitados): cabinHeight=${best.overrides.cabinHeight}, rearSlope=${best.overrides.rearSlope}; erro de perfil ${baselineObjective.toFixed(3)} → ${best.objective.toFixed(3)}. Parâmetros inferidos da imagem, não dimensões verificadas.`,
});

export function fitGeometryToEvidence(plan: SpatialPlanV2, evidence: ImageEvidence, opts: { signal?: AbortSignal; maxCandidates?: number } = {}): FittingResult {
  const target = evidenceProfile(evidence);
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
  return fitted(best, gate.baselineObjective, evaluated);
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
  const target = evidenceProfile(evidence);
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
  return fitted(best, gate.baselineObjective, evaluated);
}
