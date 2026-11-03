import { SPATIAL_PLAN_CONTRACT, validateSpatialPlan, type SpatialOperation, type SpatialPlan } from './contracts';

export class SpatialApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); this.name = 'SpatialApiError'; }
}

export type SpatialPlanReply = { contract: typeof SPATIAL_PLAN_CONTRACT; sessionId: string; revision: number; plan: SpatialPlan; sceneSummary: { entityCount: number; operators: string[]; provenanceCounts: Record<string, number> }; constructionEvents: unknown[]; meta: Record<string, unknown>; limitations: string[] };
export type SpatialMutationReply = { contract: 'unfold.spatial-review.v1'; sessionId: string; revision: number; plan: SpatialPlan; operation?: SpatialOperation; review: { status: 'applied' | 'undone'; actorEvidence: 'client_asserted_unverified'; authenticatedReviewer: false }; meta?: Record<string, unknown>; limitation?: string };

async function post<T>(path: string, body: unknown, fetchImpl: typeof fetch): Promise<T> {
  const response = await fetchImpl(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const payload = await response.json() as { error?: { code?: unknown; message?: unknown } } & Record<string, unknown>;
  if (!response.ok) throw new SpatialApiError(response.status, typeof payload.error?.code === 'string' ? payload.error.code : 'SPATIAL_API_ERROR', typeof payload.error?.message === 'string' ? payload.error.message : `Spatial API returned HTTP ${response.status}.`);
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
