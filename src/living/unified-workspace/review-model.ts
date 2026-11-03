import type { ExcavatorObservationV1 } from '../reconstruction/contracts';
import type { ReviewDecision, ReviewSubmission } from './types';

export const MIN_BUCKET_WIDTH_M = 0.1;
export const MAX_BUCKET_WIDTH_M = 10;

export type ReviewItemKind = 'hypothesis' | 'entity' | 'relation' | 'request';
export type ReviewItem = { key: string; kind: ReviewItemKind; id: string; label: string };

/**
 * Every item that needs an explicit decision, in the order the server expects them.
 * Mirrors `reviewReconstruction`: one per hypothesis, per entity/relation still marked `hypothesis`, and per request.
 */
export function requiredReviewItems(observation: ExcavatorObservationV1): ReviewItem[] {
  return [
    ...observation.hypotheses.map((h): ReviewItem => ({ key: `hypothesis:${h.id}`, kind: 'hypothesis', id: h.id, label: h.statement ?? h.id })),
    ...observation.entities.filter((e) => e.status === 'hypothesis').map((e): ReviewItem => ({ key: `entity:${e.id}`, kind: 'entity', id: e.id, label: e.label })),
    ...observation.relations.filter((r) => r.status === 'hypothesis').map((r): ReviewItem => ({ key: `relation:${r.id}`, kind: 'relation', id: r.id, label: `${r.from} → ${r.to}` })),
    ...observation.requests.map((r): ReviewItem => ({ key: `request:${r.id}`, kind: 'request', id: r.id, label: r.text ?? r.id })),
  ];
}

export type ReviewDraft = {
  reviewerId: string;
  familyConfirmed: boolean;
  bucketConfirmed: boolean;
  decisions: Record<string, ReviewDecision | undefined>;
  bucketWidthM: number | null;
  widthBasis: string;
};

export const emptyDraft = (): ReviewDraft => ({ reviewerId: '', familyConfirmed: false, bucketConfirmed: false, decisions: {}, bucketWidthM: null, widthBasis: '' });

const WHEELED = /\b(wheel(?:ed|s)?|rodas|pneus)\b/;

/** Reasons the review cannot be submitted yet. Empty means the draft is complete; it does not mean the server will accept it. */
export function reviewBlockers(observation: ExcavatorObservationV1, draft: ReviewDraft): string[] {
  const reasons: string[] = [];
  if (!draft.reviewerId.trim() || draft.reviewerId.length > 100) reasons.push('identificação do revisor obrigatória');
  if (!draft.familyConfirmed) reasons.push('família de escavadora de rastos requer confirmação humana');
  if (!draft.bucketConfirmed) reasons.push('a presença de uma caçamba requer confirmação humana');
  if (!draft.widthBasis.trim() || draft.widthBasis.length > 500) reasons.push('origem humana da largura obrigatória');
  const w = draft.bucketWidthM;
  if (w === null || !Number.isFinite(w) || w < MIN_BUCKET_WIDTH_M || w > MAX_BUCKET_WIDTH_M) reasons.push('largura da caçamba deve estar entre 0,1 e 10 m');
  for (const item of requiredReviewItems(observation)) {
    const decision = draft.decisions[item.key];
    if (decision !== 'confirm' && decision !== 'reject') reasons.push(`item sem decisão: ${item.key}`);
    else if (item.kind === 'request' && decision === 'confirm') reasons.push(`pedido confirmado sem adaptação suportada: ${item.id}`);
  }
  const text = observation.entities.flatMap((e) => [e.label, ...e.features.map((f) => f.value ?? '')]).join(' ').toLowerCase();
  if (WHEELED.test(text)) reasons.push('possível máquina de rodas incompatível com a família suportada');
  if (observation.machineType !== 'excavator') reasons.push('tipo de máquina não confirmado como escavadora');
  return reasons;
}

/** Builds the submission only from a complete draft; otherwise returns the blockers. Extra decision keys are dropped. */
export function buildSubmission(observation: ExcavatorObservationV1, draft: ReviewDraft): { ok: true; submission: ReviewSubmission } | { ok: false; reasons: string[] } {
  const reasons = reviewBlockers(observation, draft);
  if (reasons.length) return { ok: false, reasons };
  const decisions: Record<string, ReviewDecision> = {};
  for (const item of requiredReviewItems(observation)) decisions[item.key] = draft.decisions[item.key]!;
  return { ok: true, submission: { reviewerId: draft.reviewerId.trim(), family: 'tracked_excavator', bucketConfirmed: true, decisions, bucketWidthM: draft.bucketWidthM!, widthBasis: draft.widthBasis.trim() } };
}
