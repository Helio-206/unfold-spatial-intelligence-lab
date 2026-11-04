import { SPATIAL_PLAN_CONTRACT, validateSpatialPlan, type SpatialOperation, type SpatialPlan } from './contracts';
import { SPATIAL_PLAN_V2_CONTRACT, SPATIAL_TRANSACTION_CONTRACT, SPATIAL_TRANSACTION_RECEIPT_CONTRACT, validateSpatialPlanV2, type SpatialOperationV2, type SpatialPlanV2, type SpatialTransactionReceiptV2, type SpatialTransactionV2 } from './contracts-v2';
import { parseSpatialEvaluationV2, type SpatialEvaluationV2 } from './evaluation-v2';

export class SpatialApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly meta?: Record<string, unknown>) { super(message); this.name = 'SpatialApiError'; }
}

export type SpatialPlanReply = { contract: typeof SPATIAL_PLAN_CONTRACT; sessionId: string; revision: number; plan: SpatialPlan; sceneSummary: { entityCount: number; operators: string[]; provenanceCounts: Record<string, number> }; constructionEvents: unknown[]; meta: Record<string, unknown>; limitations: string[] };
export type SpatialMutationReply = { contract: 'unfold.spatial-review.v1'; sessionId: string; revision: number; plan: SpatialPlan; operation?: SpatialOperation; review: { status: 'applied' | 'undone'; actorEvidence: 'client_asserted_unverified'; authenticatedReviewer: false }; meta?: Record<string, unknown>; limitation?: string };

async function post<T>(path: string, body: unknown, fetchImpl: typeof fetch): Promise<T> {
  const response = await fetchImpl(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const payload = await response.json() as { error?: { code?: unknown; message?: unknown }; meta?: Record<string, unknown> } & Record<string, unknown>;
  if (!response.ok) throw new SpatialApiError(response.status, typeof payload.error?.code === 'string' ? payload.error.code : 'SPATIAL_API_ERROR', typeof payload.error?.message === 'string' ? payload.error.message : `Spatial API returned HTTP ${response.status}.`, payload.meta && typeof payload.meta === 'object' ? payload.meta : undefined);
  return payload as T;
}

function validatedReply(reply: SpatialPlanReply | SpatialMutationReply): SpatialPlanReply | SpatialMutationReply {
  if (reply.contract !== 'unfold.spatial-plan.v1' && reply.contract !== 'unfold.spatial-review.v1') throw new SpatialApiError(502, 'INVALID_SPATIAL_API_REPLY', 'Unknown spatial response contract.');
  return { ...reply, plan: validateSpatialPlan(reply.plan) };
}

export async function createSpatialPlan(input: { sourceKind: 'text'; instruction: string } | { sourceKind: 'image'; imageDataUrl: string }, fetchImpl: typeof fetch = fetch): Promise<SpatialPlanReply> {
  const reply = await post<SpatialPlanReply>('/api/spatial/plan', { ...input, mode: 'live' }, fetchImpl);
  return validatedReply(reply) as SpatialPlanReply;
}

export async function editSpatialPlan(input: { sessionId: string; baseRevision: number; instruction: string }, fetchImpl: typeof fetch = fetch): Promise<SpatialMutationReply> {
  return validatedReply(await post<SpatialMutationReply>('/api/spatial/edit', input, fetchImpl)) as SpatialMutationReply;
}

export async function applySpatialPlanOperation(input: { sessionId: string; baseRevision: number; operation: SpatialOperation }, fetchImpl: typeof fetch = fetch): Promise<SpatialMutationReply> {
  return validatedReply(await post<SpatialMutationReply>('/api/spatial/operation', input, fetchImpl)) as SpatialMutationReply;
}

export async function undoSpatialPlan(input: { sessionId: string; baseRevision: number }, fetchImpl: typeof fetch = fetch): Promise<SpatialMutationReply> {
  return validatedReply(await post<SpatialMutationReply>('/api/spatial/undo', input, fetchImpl)) as SpatialMutationReply;
}

export type SpatialPlanV2Reply = { contract: typeof SPATIAL_PLAN_V2_CONTRACT; sessionId: string; revision: number; plan: SpatialPlanV2; sceneSummary: { componentCount: number; geometryNodeCount: number; operators: string[]; constraintReady: boolean }; constraintReport: unknown; constructionEvents: unknown[]; meta: Record<string, unknown>; limitations: string[] };
export type SpatialMutationV2Reply = { contract: 'unfold.spatial-v2-review.v1'; sessionId: string; revision: number; plan: SpatialPlanV2; operation?: SpatialOperationV2; constraintReport: unknown; review: { status: string; actorEvidence: 'client_asserted_unverified'; authenticatedReviewer: false }; meta?: Record<string, unknown>; limitation?: string };
export type SpatialEvaluationV2Reply = { contract: 'unfold.spatial-evaluation.v1'; sessionId: string; revision: number; evaluation: SpatialEvaluationV2; suggestionStatus: 'pending' | 'rejected' | 'none'; refinementBudget: { maximum: number; used: number }; constraintReport: unknown; meta: Record<string, unknown>; limitations: string[] };

function validSpatialPlanV2Reply(reply: SpatialPlanV2Reply | SpatialMutationV2Reply): SpatialPlanV2Reply | SpatialMutationV2Reply {
  if (reply.contract !== SPATIAL_PLAN_V2_CONTRACT && reply.contract !== 'unfold.spatial-v2-review.v1') throw new SpatialApiError(502, 'INVALID_SPATIAL_V2_API_REPLY', 'Unknown spatial V2 response contract.');
  return { ...reply, plan: validateSpatialPlanV2(reply.plan) };
}

export async function createSpatialPlanV2(input: { sourceKind: 'text'; instruction: string; maxRefinements?: number } | { sourceKind: 'image'; imageDataUrl: string; maxRefinements?: number }, fetchImpl: typeof fetch = fetch): Promise<SpatialPlanV2Reply> {
  return validSpatialPlanV2Reply(await post<SpatialPlanV2Reply>('/api/spatial/v2/plan', { ...input, mode: 'live' }, fetchImpl)) as SpatialPlanV2Reply;
}

export async function editSpatialPlanV2(input: { sessionId: string; baseRevision: number; instruction: string }, fetchImpl: typeof fetch = fetch): Promise<SpatialMutationV2Reply> {
  return validSpatialPlanV2Reply(await post<SpatialMutationV2Reply>('/api/spatial/v2/edit', input, fetchImpl)) as SpatialMutationV2Reply;
}

export async function applySpatialPlanV2Operation(input: { sessionId: string; baseRevision: number; operation: SpatialOperationV2; origin?: 'inferred' | 'user_provided'; evidence?: string }, fetchImpl: typeof fetch = fetch): Promise<SpatialMutationV2Reply> {
  return validSpatialPlanV2Reply(await post<SpatialMutationV2Reply>('/api/spatial/v2/operation', input, fetchImpl)) as SpatialMutationV2Reply;
}

export async function refineSpatialPlanV2(input: { sessionId: string; baseRevision: number }, fetchImpl: typeof fetch = fetch): Promise<SpatialMutationV2Reply> {
  return validSpatialPlanV2Reply(await post<SpatialMutationV2Reply>('/api/spatial/v2/refine', input, fetchImpl)) as SpatialMutationV2Reply;
}

export async function undoSpatialPlanV2(input: { sessionId: string; baseRevision: number; idempotencyKey?: string }, fetchImpl: typeof fetch = fetch): Promise<SpatialMutationV2Reply & { replayed?: boolean }> {
  try {
    return validSpatialPlanV2Reply(await post<SpatialMutationV2Reply>('/api/spatial/v2/undo', input, fetchImpl)) as SpatialMutationV2Reply;
  } catch (error) {
    // A lost response may mean the undo already committed; retrying with the same key replays its receipt.
    if (!input.idempotencyKey || error instanceof SpatialApiError) throw error;
    return validSpatialPlanV2Reply(await post<SpatialMutationV2Reply>('/api/spatial/v2/undo', input, fetchImpl)) as SpatialMutationV2Reply;
  }
}

export type SpatialTransactionV2Reply = SpatialTransactionReceiptV2;

function validTransactionReply(reply: SpatialTransactionReceiptV2): SpatialTransactionReceiptV2 {
  if (reply.contract !== SPATIAL_TRANSACTION_RECEIPT_CONTRACT || typeof reply.transactionId !== 'string' || !Number.isSafeInteger(reply.revision)) throw new SpatialApiError(502, 'INVALID_SPATIAL_V2_TRANSACTION_REPLY', 'Unknown spatial transaction response contract.');
  return { ...reply, plan: validateSpatialPlanV2(reply.plan) };
}

/**
 * The client cannot determine whether a transaction committed: the response was lost and the
 * recovery request did not produce an authoritative answer either. This is never reported as a
 * success or as a definitive failure; the caller must keep the idempotency key and reconcile.
 */
export class SpatialTransactionUnresolvedError extends Error {
  readonly code = 'SPATIAL_V2_TRANSACTION_UNRESOLVED' as const;
  constructor(
    readonly sessionId: string,
    readonly idempotencyKey: string,
    readonly reason: 'response-and-recovery-failed' | 'session-not-found',
    cause?: unknown,
  ) { super(`SPATIAL_V2_TRANSACTION_UNRESOLVED:${reason}`); this.name = 'SpatialTransactionUnresolvedError'; this.cause = cause; }
}

/** Submits several operations as one atomic transaction. One revision increment; never partially applied. */
export async function applySpatialPlanV2Transaction(input: Omit<SpatialTransactionV2, 'contract'>, fetchImpl: typeof fetch = fetch): Promise<SpatialTransactionV2Reply> {
  const body: SpatialTransactionV2 = { contract: SPATIAL_TRANSACTION_CONTRACT, ...input };
  try {
    return validTransactionReply(await post<SpatialTransactionReceiptV2>('/api/spatial/v2/transactions', body, fetchImpl));
  } catch (error) {
    if (error instanceof SpatialApiError) throw error;
    // Response lost in transit: recover the authoritative receipt before reporting anything.
    try { return await recoverSpatialPlanV2Transaction({ sessionId: input.sessionId, idempotencyKey: input.idempotencyKey }, fetchImpl); }
    catch (recoveryError) {
      if (recoveryError instanceof SpatialApiError && recoveryError.code === 'SPATIAL_V2_TRANSACTION_NOT_FOUND') {
        // The server authoritatively holds no receipt for this key, so the first submission did not
        // commit. Resubmit once with the same key: it either commits now or replays, never doubles.
        try { return validTransactionReply(await post<SpatialTransactionReceiptV2>('/api/spatial/v2/transactions', body, fetchImpl)); }
        catch (resubmitError) {
          if (resubmitError instanceof SpatialApiError) throw resubmitError;
          throw new SpatialTransactionUnresolvedError(input.sessionId, input.idempotencyKey, 'response-and-recovery-failed', resubmitError);
        }
      }
      if (recoveryError instanceof SpatialApiError && recoveryError.code === 'SPATIAL_V2_SESSION_NOT_FOUND') {
        throw new SpatialTransactionUnresolvedError(input.sessionId, input.idempotencyKey, 'session-not-found', recoveryError);
      }
      throw new SpatialTransactionUnresolvedError(input.sessionId, input.idempotencyKey, 'response-and-recovery-failed', recoveryError);
    }
  }
}

/** Recovers the authoritative receipt of a transaction whose response was lost. */
export async function recoverSpatialPlanV2Transaction(input: { sessionId: string; idempotencyKey: string }, fetchImpl: typeof fetch = fetch): Promise<SpatialTransactionV2Reply> {
  return validTransactionReply(await post<SpatialTransactionReceiptV2>('/api/spatial/v2/transactions/status', input, fetchImpl));
}

export async function evaluateSpatialPlanV2(input: { sessionId: string; baseRevision: number; imageDataUrl: string; plan: SpatialPlanV2 }, fetchImpl: typeof fetch = fetch): Promise<SpatialEvaluationV2Reply> {
  const { plan, ...request } = input;
  const reply = await post<SpatialEvaluationV2Reply>('/api/spatial/v2/evaluate', request, fetchImpl);
  if (reply.contract !== 'unfold.spatial-evaluation.v1' || !reply.evaluation) throw new SpatialApiError(502, 'INVALID_SPATIAL_V2_EVALUATION_REPLY', 'Unknown spatial evaluation contract.');
  return { ...reply, evaluation: parseSpatialEvaluationV2(reply.evaluation, plan) };
}

import { SPATIAL_REVIEW_CONTRACT, canonicalPlanJson, type ReviewDecisionKind, type ReviewRelationValue, type ReviewSolverGate, type SpatialReviewRecord } from './review-v1';

/** sha256 of the canonical plan JSON: the exact plan binding a review record carries. */
export async function spatialPlanFingerprintV2(plan: SpatialPlanV2): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalPlanJson(plan)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export type SpatialReviewReply = { contract: typeof SPATIAL_REVIEW_CONTRACT; review: SpatialReviewRecord; gate: ReviewSolverGate };
export type SpatialReviewSummary = { reviewId: string; reviewRevision: number; planRevision: number; planFingerprint: string; sourceByteVerified: boolean; subjects: number; decisions: number; updatedAt: string };

function validReviewReply(reply: SpatialReviewReply): SpatialReviewReply {
  if (reply.contract !== SPATIAL_REVIEW_CONTRACT || !reply.review || reply.review.contract !== SPATIAL_REVIEW_CONTRACT || !reply.gate) throw new SpatialApiError(502, 'INVALID_SPATIAL_REVIEW_REPLY', 'Unknown spatial review response contract.');
  return reply;
}

/** Creates a persistent review record for one exact plan. Source bytes, when supplied, are hashed by the server. */
export async function createSpatialReview(input: { plan: SpatialPlanV2; planRevision?: number; sourceBytes?: { kind: 'text'; text: string } | { kind: 'image'; imageDataUrl: string }; evidence?: Array<{ evidenceId: string; kind: 'source' | 'silhouette_views' | 'mask' | 'note'; sha256?: string; contentBase64?: string; note?: string }> }, fetchImpl: typeof fetch = fetch): Promise<SpatialReviewReply> {
  return validReviewReply(await post<SpatialReviewReply>('/api/spatial/v2/reviews', input, fetchImpl));
}

export async function getSpatialReview(reviewId: string, fetchImpl: typeof fetch = fetch): Promise<SpatialReviewReply> {
  return validReviewReply(await post<SpatialReviewReply>('/api/spatial/v2/reviews/get', { reviewId }, fetchImpl));
}

export async function listSpatialReviews(sourceSha256: string, planFingerprint?: string, fetchImpl: typeof fetch = fetch): Promise<SpatialReviewSummary[]> {
  const reply = await post<{ contract: typeof SPATIAL_REVIEW_CONTRACT; reviews: SpatialReviewSummary[] }>('/api/spatial/v2/reviews/list', { sourceSha256, ...(planFingerprint ? { planFingerprint } : {}) }, fetchImpl);
  if (reply.contract !== SPATIAL_REVIEW_CONTRACT || !Array.isArray(reply.reviews)) throw new SpatialApiError(502, 'INVALID_SPATIAL_REVIEW_REPLY', 'Unknown spatial review response contract.');
  return reply.reviews;
}

/** Appends one human decision. Never edits earlier decisions; stale writers are rejected by revision. */
export async function decideSpatialReview(input: { reviewId: string; baseReviewRevision: number; subjectId: string; decision: ReviewDecisionKind; correctedValue?: ReviewRelationValue | null; reviewerName: string; note?: string; planRevision?: number; evidenceIds?: string[] }, fetchImpl: typeof fetch = fetch): Promise<SpatialReviewReply> {
  return validReviewReply(await post<SpatialReviewReply>('/api/spatial/v2/reviews/decide', input, fetchImpl));
}

/** The solver gate for a review, optionally pinned to the revision and to the exact plan/source binding the caller expects. */
export async function getSpatialReviewEligibility(input: { reviewId: string; reviewRevision?: number; planFingerprint?: string; sourceSha256?: string }, fetchImpl: typeof fetch = fetch): Promise<SpatialReviewReply> {
  return validReviewReply(await post<SpatialReviewReply>('/api/spatial/v2/reviews/eligibility', input, fetchImpl));
}

export type SpatialProposalV2Reply = { contract: 'unfold.spatial-v2-proposal.v1'; sessionId: string; revision: number; operation: SpatialOperationV2; applied: false; meta?: Record<string, unknown>; limitation?: string };

/** Turns a plan a person has reviewed into a server session (local, not paid), so typed edits, undo and the paid proposals work on exactly that plan. */
export async function adoptSpatialPlanV2(input: { plan: SpatialPlanV2; instruction?: string }, fetchImpl: typeof fetch = fetch): Promise<SpatialMutationV2Reply> {
  return validSpatialPlanV2Reply(await post<SpatialMutationV2Reply>('/api/spatial/v2/adopt', input, fetchImpl)) as SpatialMutationV2Reply;
}

/** Paid. Muse Spark proposes one typed operation; nothing is applied. A person previews it and submits it through `applySpatialPlanV2Operation`. */
export async function proposeSpatialEditV2(input: { sessionId: string; baseRevision: number; instruction: string }, fetchImpl: typeof fetch = fetch): Promise<SpatialProposalV2Reply> {
  const reply = await post<SpatialProposalV2Reply>('/api/spatial/v2/edit', { ...input, propose: true }, fetchImpl);
  if (reply.contract !== 'unfold.spatial-v2-proposal.v1' || reply.applied !== false || !reply.operation) throw new SpatialApiError(502, 'INVALID_SPATIAL_V2_PROPOSAL_REPLY', 'Unknown spatial proposal contract.');
  return reply;
}
