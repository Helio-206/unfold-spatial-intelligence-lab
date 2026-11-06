import { validateSpatialPlanV2, type SpatialPlanV2 } from './contracts-v2';

/** Canonical JSON of a plan (object keys sorted recursively): the exact bytes a plan fingerprint binds to. */
export function canonicalPlanJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalPlanJson).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalPlanJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

/**
 * Human review of spatial interpretation (V4 E1). Contract `unfold.spatial-review.v1`.
 *
 * A review record is about a plan as submitted: its relations and contact hypotheses are subjects;
 * a person's decisions are appended, never edited in place. Four kinds of statement are kept apart
 * everywhere in this contract:
 *   - observed_evidence: read directly from the source (an origin the plan declares `observed`);
 *   - model_inference:   proposed by a model or by the plan's own declared relations (`inferred`);
 *   - user_supplied:     a value a person typed into the plan (`user_provided`);
 *   - human_decision:    a decision recorded by this review workflow.
 * A digest (sha256) verifies byte identity only: it does not prove that an image is truthful, that a
 * mask is correct, or who authored anything. Reviewer attribution is a client-asserted display name
 * (`authenticated: false`); this product has no reviewer authentication and none is claimed.
 */
export const SPATIAL_REVIEW_CONTRACT = 'unfold.spatial-review.v1' as const;
export const MAX_REVIEW_SUBJECTS = 256;
export const MAX_REVIEW_DECISIONS = 1_000;
export const MAX_REVIEW_EVIDENCE_ITEMS = 32;

export type ReviewStatementClass = 'observed_evidence' | 'model_inference' | 'user_supplied' | 'detected_geometry' | 'unknown';
export type ReviewDecisionKind = 'confirm' | 'correct' | 'reject' | 'defer';
export type ReviewGeometrySupport = 'supported' | 'contradicted' | 'unknown';
export type ReviewRelationValue = { kind: string; fromId: string; toId: string };

export type ReviewSubject = {
  subjectId: string;
  kind: 'relation' | 'hypothesis';
  /** The original statement, exactly as found. Decisions never rewrite this. */
  original: ReviewRelationValue;
  statementClass: ReviewStatementClass;
  /** How the plan's own geometry treats the statement, when a classifier assessed it. */
  geometrySupport: ReviewGeometrySupport;
  uncertainty: string;
  evidenceIds: string[];
};

export type ReviewEvidenceItem = {
  evidenceId: string;
  kind: 'plan' | 'source' | 'silhouette_views' | 'mask' | 'note';
  sha256: string;
  /** True only when the server computed the digest from bytes it received. */
  byteVerified: boolean;
  note: string;
};

export type ReviewDecision = {
  decisionId: string;
  subjectId: string;
  decision: ReviewDecisionKind;
  correctedValue: ReviewRelationValue | null;
  /** The plan revision the reviewer was looking at; informational, not a precondition. */
  planRevision: number;
  evidenceIds: string[];
  reviewer: { displayName: string; authenticated: false; attribution: 'client_asserted_unverified' };
  /** Server timestamp (ISO). The client's clock is never trusted for ordering. */
  at: string;
  /** The review revision this decision produced. */
  reviewRevision: number;
  note: string;
};

export type SpatialReviewRecord = {
  contract: typeof SPATIAL_REVIEW_CONTRACT;
  reviewId: string;
  createdAt: string;
  updatedAt: string;
  reviewRevision: number;
  source: { kind: 'text' | 'image'; sha256: string; byteVerified: boolean };
  /** sha256 of the canonical plan JSON as received; binds decisions to one exact plan revision. */
  planFingerprint: string;
  planRevision: number;
  componentIds: string[];
  unknowns: string[];
  subjects: ReviewSubject[];
  evidence: ReviewEvidenceItem[];
  /** Append-only audit history. Corrections add decisions; they never overwrite earlier ones. */
  decisions: ReviewDecision[];
  reviewerAuthentication: { authenticated: false; limitation: string };
  limitations: string[];
};

export const REVIEW_AUTHENTICATION_LIMITATION = 'Reviewer names are asserted by the client and are not authenticated; this product has no reviewer identity system.';
export const DIGEST_LIMITATION = 'A sha256 digest verifies byte identity only. It does not verify the physical truth of an image, the correctness of a mask or calibration, or the identity of an author.';

const statementClassOf = (origin: string | null): ReviewStatementClass =>
  origin === 'observed' ? 'observed_evidence' : origin === 'user_provided' ? 'user_supplied' : origin === 'inferred' ? 'model_inference' : 'unknown';

/** Subjects from the plan's declared relations, before any geometry classification. */
export function reviewSubjectsFromPlan(plan: SpatialPlanV2): ReviewSubject[] {
  return plan.relations.map((relation) => ({
    subjectId: `rel-${relation.id}`.slice(0, 48),
    kind: 'relation' as const,
    original: { kind: relation.kind, fromId: relation.fromId, toId: relation.toId },
    statementClass: statementClassOf(relation.origin),
    geometrySupport: 'unknown' as const,
    uncertainty: relation.evidence ? `Declared in the plan. Plan evidence note: ${relation.evidence.slice(0, 200)}` : 'Declared in the plan without an evidence note.',
    evidenceIds: ['plan-geometry'],
  }));
}

export type EffectiveDecision = { subject: ReviewSubject; decision: ReviewDecision | null };

/** The current state of every subject: the latest decision wins, the history keeps them all. */
export function effectiveDecisions(record: SpatialReviewRecord): EffectiveDecision[] {
  const latest = new Map<string, ReviewDecision>();
  for (const decision of record.decisions) latest.set(decision.subjectId, decision);
  return record.subjects.map((subject) => ({ subject, decision: latest.get(subject.subjectId) ?? null }));
}

export type ReviewedProjection = {
  /** A solver-only copy of the plan. The original plan is never modified by this projection. */
  plan: SpatialPlanV2;
  gate: ReviewSolverGate;
  rejectedSubjectIds: string[];
  correctedSubjectIds: string[];
};

/**
 * The reviewed-relationship projection the solver actually consumes (E1.1). Built from the recorded
 * decisions, validated against the current plan:
 *   - rejected relation: absent from the projection, so the solver cannot keep enforcing it merely
 *     because the original plan declares it (the original plan and the history keep it untouched);
 *   - corrected relation/hypothesis: present with the corrected kind and endpoints, marked
 *     `user_provided` (a human decision), so it is evaluated as corrected, not as the original;
 *   - deferred or undecided hypothesis: stays out of the enforced set, never promoted;
 *   - confirmed subjects are reported through the gate for the engine's confirmation set.
 * A correction the plan contract cannot represent (unknown component, invalid kind, self-relation)
 * throws `REVIEW_CORRECTION_UNSUPPORTED` instead of silently falling back to the original relation.
 * A record bound to another source throws `REVIEW_BINDING_MISMATCH`. No physical assumption is added:
 * the projection only restates what a person decided about statements that already exist.
 */
export function projectReviewedPlan(plan: SpatialPlanV2, record: SpatialReviewRecord): ReviewedProjection {
  if (record.source.sha256 !== plan.source.sha256 || record.source.kind !== plan.source.kind) throw new Error('REVIEW_BINDING_MISMATCH:source');
  const gate = reviewSolverGate(record);
  const latest = new Map<string, ReviewDecision>();
  for (const decision of record.decisions) latest.set(decision.subjectId, decision);
  const correctedSubjectIds: string[] = [];
  const relations: SpatialPlanV2['relations'] = [];
  for (const relation of plan.relations) {
    const decision = latest.get(`rel-${relation.id}`.slice(0, 48));
    if (decision?.decision === 'reject') continue;
    if (decision?.decision === 'correct' && decision.correctedValue) {
      correctedSubjectIds.push(decision.subjectId);
      relations.push({ id: relation.id, fromId: decision.correctedValue.fromId, toId: decision.correctedValue.toId, kind: decision.correctedValue.kind as SpatialPlanV2['relations'][number]['kind'], origin: 'user_provided', evidence: `Human review correction (decision ${decision.decisionId}); the original statement is preserved in the review record.` });
      continue;
    }
    relations.push(relation);
  }
  for (const subject of record.subjects) {
    if (subject.kind !== 'hypothesis') continue;
    const decision = latest.get(subject.subjectId);
    if (decision?.decision !== 'correct' || !decision.correctedValue) continue;
    correctedSubjectIds.push(subject.subjectId);
    relations.push({ id: `rev-${subject.subjectId}`.slice(0, 48), fromId: decision.correctedValue.fromId, toId: decision.correctedValue.toId, kind: decision.correctedValue.kind as SpatialPlanV2['relations'][number]['kind'], origin: 'user_provided', evidence: `Human review correction of a contact hypothesis (decision ${decision.decisionId}).` });
  }
  let projected: SpatialPlanV2;
  try { projected = validateSpatialPlanV2({ ...plan, relations }); }
  catch (error) { throw new Error(`REVIEW_CORRECTION_UNSUPPORTED:${error instanceof Error ? error.message : 'invalid correction'}`); }
  return { plan: projected, gate, rejectedSubjectIds: gate.rejectedSubjectIds, correctedSubjectIds };
}

export type ReviewSolverGate = {
  /** Review revision this gate was computed from; a solver run must carry it and reject drift. */
  reviewRevision: number;
  eligible: boolean;
  /** Subjects a solver may enforce: confirmed, corrected (with the corrected value), or already human-supplied and supported. */
  enforcedSubjectIds: string[];
  correctedValues: Record<string, ReviewRelationValue>;
  rejectedSubjectIds: string[];
  deferredSubjectIds: string[];
  pendingSubjectIds: string[];
  /** True only when every geometrically contradicted subject carries an explicit recorded decision. */
  allowContradicted: boolean;
  blockers: string[];
};

/**
 * What the solver may consume. Derived only from the recorded review state: a client cannot promote
 * a hypothesis by sending a flag, a rejected or deferred subject is never enforced, and a contradicted
 * relation blocks eligibility until a person records a decision about it (confirm, correct or reject).
 */
export function reviewSolverGate(record: SpatialReviewRecord): ReviewSolverGate {
  const enforcedSubjectIds: string[] = [], correctedValues: Record<string, ReviewRelationValue> = {}, rejectedSubjectIds: string[] = [], deferredSubjectIds: string[] = [], pendingSubjectIds: string[] = [], blockers: string[] = [];
  let contradictedTotal = 0, contradictedDecided = 0;
  for (const { subject, decision } of effectiveDecisions(record)) {
    const contradicted = subject.geometrySupport === 'contradicted';
    if (contradicted) contradictedTotal += 1;
    if (!decision) {
      pendingSubjectIds.push(subject.subjectId);
      if (contradicted) blockers.push(`CONTRADICTED_UNRESOLVED:${subject.subjectId}`);
      continue;
    }
    if (contradicted) contradictedDecided += 1;
    if (decision.decision === 'confirm') enforcedSubjectIds.push(subject.subjectId);
    else if (decision.decision === 'correct') { enforcedSubjectIds.push(subject.subjectId); if (decision.correctedValue) correctedValues[subject.subjectId] = decision.correctedValue; }
    else if (decision.decision === 'reject') rejectedSubjectIds.push(subject.subjectId);
    else { deferredSubjectIds.push(subject.subjectId); if (contradicted) blockers.push(`CONTRADICTED_DEFERRED:${subject.subjectId}`); }
  }
  return {
    reviewRevision: record.reviewRevision, eligible: blockers.length === 0,
    enforcedSubjectIds, correctedValues, rejectedSubjectIds, deferredSubjectIds, pendingSubjectIds,
    allowContradicted: contradictedTotal > 0 && contradictedDecided === contradictedTotal, blockers,
  };
}
