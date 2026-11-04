import { SPATIAL_PLAN_CONTRACT, validateSpatialPlan, type SpatialOperation, type SpatialPlan } from './contracts';
import { SPATIAL_PLAN_V2_CONTRACT, validateSpatialPlanV2, type SpatialOperationV2, type SpatialPlanV2 } from './contracts-v2';
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

export async function undoSpatialPlanV2(input: { sessionId: string; baseRevision: number }, fetchImpl: typeof fetch = fetch): Promise<SpatialMutationV2Reply> {
  return validSpatialPlanV2Reply(await post<SpatialMutationV2Reply>('/api/spatial/v2/undo', input, fetchImpl)) as SpatialMutationV2Reply;
}

export async function evaluateSpatialPlanV2(input: { sessionId: string; baseRevision: number; imageDataUrl: string; plan: SpatialPlanV2 }, fetchImpl: typeof fetch = fetch): Promise<SpatialEvaluationV2Reply> {
  const { plan, ...request } = input;
  const reply = await post<SpatialEvaluationV2Reply>('/api/spatial/v2/evaluate', request, fetchImpl);
  if (reply.contract !== 'unfold.spatial-evaluation.v1' || !reply.evaluation) throw new SpatialApiError(502, 'INVALID_SPATIAL_V2_EVALUATION_REPLY', 'Unknown spatial evaluation contract.');
  return { ...reply, evaluation: parseSpatialEvaluationV2(reply.evaluation, plan) };
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
