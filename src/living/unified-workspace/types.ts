import type { Assembly } from '../contracts';
import type { AssemblyProposalV1, ExcavatorObservationV1, ReconstructionSourceKind } from '../reconstruction/contracts';

/**
 * Wire contract of `POST /api/living/reconstruction` (PR #17, 9a3b3e0).
 * Everything here describes what the server *claims*. Nothing in these types is a physical measurement,
 * a solver result or an authorisation to move the machine.
 */
export const RECONSTRUCTION_CONTRACT = 'unfold.reconstruction.v1' as const;
export const REVIEW_CONTRACT = 'unfold.reconstruction.review.v1' as const;
export const RECONSTRUCTION_ENDPOINT = '/api/living/reconstruction';

export type ReconstructionMode = 'live' | 'offline';

export type ProposeRequest =
  | { sourceKind: Exclude<ReconstructionSourceKind, 'text'>; imageDataUrl: string; sourceReference?: string; mode?: ReconstructionMode }
  | { sourceKind: 'text'; instruction: string; sourceReference?: string; mode?: ReconstructionMode };

export type ReconstructionProposal = {
  contract: typeof RECONSTRUCTION_CONTRACT;
  sessionId: string;
  mode: ReconstructionMode;
  status: 'review_required' | 'blocked';
  observation: ExcavatorObservationV1;
  assemblyProposal: AssemblyProposalV1;
  engineering: { status: 'blocked'; reason: string };
  limitations: string[];
  /** Who answered, when the server says so. Null when the server did not report it; never inferred. */
  meta: { model: string | null; requestId: string | null };
};

export type ReviewDecision = 'confirm' | 'reject';

/** What the interface collects from a person. The server cannot verify that a person did. */
export type ReviewSubmission = {
  reviewerId: string;
  family: 'tracked_excavator';
  bucketConfirmed: true;
  decisions: Record<string, ReviewDecision>;
  bucketWidthM: number;
  widthBasis: string;
};

export type ReviewProvenance = {
  observation: { source: 'meta_model' | 'offline_fixture'; statuses: 'model_reported' | 'fixture_generated' };
  review: { source: 'client_submitted'; reviewerIdentity: 'unverified'; humanParticipation: 'unverified' };
  bucketWidth: { source: 'client_submitted'; measurement: 'unverified'; basis: string };
  remainingGeometry: { source: 'synthetic_fixture' };
};

export type ReviewedReconstruction = {
  contract: typeof REVIEW_CONTRACT;
  sessionId: string;
  mode: ReconstructionMode;
  status: 'contract_valid';
  originalObservation: ExcavatorObservationV1;
  review: ReviewSubmission;
  provenance: ReviewProvenance;
  assembly: Assembly;
  proposal: AssemblyProposalV1;
  validation: 'contract_valid';
  geometry: { bucketWidthBeforeM: number; bucketWidthAfterM: number };
  limitations: string[];
};

/** Every way a call can end without a usable result. The interface renders these; none of them is an exception. */
export type ReconstructionFailure =
  | { kind: 'invalid_input'; reasons: string[] }
  | { kind: 'blocked'; reasons: string[] }
  | { kind: 'session_expired' }
  | { kind: 'rate_limited' }
  | { kind: 'budget_exhausted' }
  | { kind: 'capacity' }
  | { kind: 'guard_rejected'; status: number; code: string }
  | { kind: 'upstream'; status: number; code: string }
  | { kind: 'network'; message: string }
  | { kind: 'aborted' }
  | { kind: 'bad_response'; issues: string[] };

export type Outcome<T> = { ok: true; value: T } | { ok: false; failure: ReconstructionFailure };
