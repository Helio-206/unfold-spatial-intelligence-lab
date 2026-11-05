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
  | { status: 'insufficient_evidence'; reason: string }
  | { status: 'unsupported_family'; reason: string }
  | { status: 'aborted'; reason: string };

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

export function fitGeometryToEvidence(plan: SpatialPlanV2, evidence: ImageEvidence, opts: { signal?: AbortSignal; maxCandidates?: number } = {}): FittingResult {
  // Camera hypothesis gate: a frontal silhouette cannot fit side-profile parameters.
  if (evidence.symmetry > 0.72 && evidence.aspect < 1.7) {
    return { status: 'insufficient_evidence', reason: `Silhueta quase frontal (simetria ${evidence.symmetry.toFixed(2)}, aspecto ${evidence.aspect.toFixed(2)}): hipótese de câmara lateral não suportada; apresentação conceptual sem fitting.` };
  }
  if (evidence.foregroundRatio < 0.02) return { status: 'insufficient_evidence', reason: 'Primeiro plano demasiado pequeno na imagem para medir uma silhueta.' };
  const baseline = compileFoundry(plan, {});
  if (!baseline.recipe) return { status: 'unsupported_family', reason: 'Plano sem receita Foundry reconhecida.' };
  if (baseline.recipe.category !== 'vehicle') return { status: 'unsupported_family', reason: `Fitting geométrico disponível apenas para a família vehicle (esta cena: ${baseline.recipe.category}).` };
  baseline.retire?.();
  const target = evidenceProfile(evidence);
  const maxCandidates = opts.maxCandidates ?? CABIN_HEIGHTS.length * REAR_SLOPES.length;
  let best: { overrides: Record<string, number>; objective: number } | null = null;
  let baselineObjective = Number.POSITIVE_INFINITY;
  let evaluated = 0;
  for (const cabinHeight of CABIN_HEIGHTS) {
    for (const rearSlope of REAR_SLOPES) {
      if (evaluated >= maxCandidates) break;
      if (opts.signal?.aborted) return { status: 'aborted', reason: 'Fitting cancelado; nenhum parâmetro foi aplicado.' };
      evaluated++;
      const candidate = compileFoundry(plan, { overrides: { cabinHeight, rearSlope }, lod: 0 });
      if (!candidate.root || !candidate.recipe) { candidate.retire?.(); continue; }
      candidate.buildAll(); // synchronous full build: the profile must measure generated geometry, not the V2 placeholder
      const geo = geometryProfile(candidate.root);
      const objective = profileError(geo.profile, target) + 0.5 * Math.abs(Math.log(geo.aspect / Math.max(0.2, evidence.aspect)));
      const isDefault = Math.abs(cabinHeight - (baseline.recipe.params.cabinHeight as number ?? -1)) < 1e-9;
      if (isDefault && Math.abs(rearSlope - (baseline.recipe.params.rearSlope as number ?? -1)) < 1e-9) baselineObjective = objective;
      if (!best || objective < best.objective - 1e-9) best = { overrides: { cabinHeight, rearSlope }, objective };
      candidate.retire?.();
    }
  }
  if (!best) return { status: 'insufficient_evidence', reason: 'Nenhum candidato compilou dentro dos limites do fitting.' };
  if (!Number.isFinite(baselineObjective)) baselineObjective = best.objective;
  return {
    status: 'fitted', overrides: best.overrides, objective: best.objective, baselineObjective, candidates: evaluated,
    summary: `Fitting por silhueta (${evaluated} candidatos limitados): cabinHeight=${best.overrides.cabinHeight}, rearSlope=${best.overrides.rearSlope}; erro de perfil ${baselineObjective.toFixed(3)} → ${best.objective.toFixed(3)}. Parâmetros inferidos da imagem, não dimensões verificadas.`,
  };
}
