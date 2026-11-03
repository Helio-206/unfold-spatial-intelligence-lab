import { createOfflineImageObservation } from '../../src/living/reconstruction/observation';
import { buildExcavatorAssembly } from '../../src/living/reconstruction/generator';
import { reviewReconstruction } from '../../src/living/reconstruction/review';
import type { ExcavatorObservationV1 } from '../../src/living/reconstruction/contracts';
import { emptyDraft, requiredReviewItems, type ReviewDraft } from '../../src/living/unified-workspace';

export const PNG_1X1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aX8AAAAASUVORK5CYII=';
export const SESSION_ID = 'session-test-1';

export function observation(): ExcavatorObservationV1 { return createOfflineImageObservation('image', 'test-image', '1'.repeat(64)); }

export function completeDraft(obs: ExcavatorObservationV1, over: Partial<ReviewDraft> = {}): ReviewDraft {
  const draft: ReviewDraft = { ...emptyDraft(), reviewerId: 'rev-1', familyConfirmed: true, bucketConfirmed: true, bucketWidthM: 1.4, widthBasis: 'valor fornecido pelo utilizador', ...over };
  for (const item of requiredReviewItems(obs)) draft.decisions[item.key] = 'reject';
  return draft;
}

export function proposalBody(obs = observation(), sessionId = SESSION_ID) {
  const assemblyProposal = buildExcavatorAssembly(obs, { mode: 'offline' });
  return { contract: 'unfold.reconstruction.v1', sessionId, mode: 'offline', status: assemblyProposal.validation.status, observation: obs, assemblyProposal, engineering: { status: 'blocked', reason: 'adaptador exige revisão' }, metrics: {}, limitations: ['fixture'], meta: {} };
}

export function reviewedBody(obs = observation(), sessionId = SESSION_ID, widthM = 1.4) {
  const review = { reviewerId: 'rev-1', family: 'tracked_excavator', bucketConfirmed: true, decisions: Object.fromEntries(requiredReviewItems(obs).map((i) => [i.key, 'reject'])), bucketWidthM: widthM, widthBasis: 'valor fornecido pelo utilizador' };
  const result = reviewReconstruction(obs, 'offline', review, sessionId);
  return { contract: 'unfold.reconstruction.review.v1', sessionId, mode: 'offline', status: 'contract_valid', ...result };
}

export const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
