import type { ReconstructionClient } from './reconstruction-client';
import { buildSubmission, emptyDraft, reviewBlockers, type ReviewDraft } from './review-model';
import type { ProposeRequest, ReconstructionFailure, ReconstructionProposal, ReviewDecision, ReviewedReconstruction } from './types';

/** Server sessions live 30 minutes from creation; the clock starts when the request is *sent*, which is never later than the server's. */
export const SESSION_TTL_MS = 30 * 60_000;

export type SessionState =
  | { phase: 'idle' }
  | { phase: 'proposing' }
  | { phase: 'proposal_failed'; failure: ReconstructionFailure }
  | { phase: 'proposal_blocked'; proposal: ReconstructionProposal; reasons: string[] }
  | { phase: 'awaiting_review'; proposal: ReconstructionProposal; draft: ReviewDraft; blockers: string[]; expiresAt: number }
  | { phase: 'reviewing'; proposal: ReconstructionProposal; draft: ReviewDraft; expiresAt: number }
  | { phase: 'review_blocked'; proposal: ReconstructionProposal; draft: ReviewDraft; blockers: string[]; reasons: string[]; expiresAt: number }
  | { phase: 'review_failed'; proposal: ReconstructionProposal; draft: ReviewDraft; blockers: string[]; failure: ReconstructionFailure; expiresAt: number }
  | { phase: 'reviewed'; proposal: ReconstructionProposal; result: ReviewedReconstruction }
  | { phase: 'expired'; proposal: ReconstructionProposal };

export type SessionOptions = { client: ReconstructionClient; now?: () => number };

/**
 * One reconstruction conversation: propose -> review -> contract-valid assembly (or a precise reason why not).
 * It owns no engineering state and never moves anything. Late answers from a superseded request are discarded.
 */
export class ReconstructionSession {
  private current: SessionState = { phase: 'idle' };
  private generation = 0;
  private abort: AbortController | null = null;
  private sentAt = 0;
  private readonly listeners = new Set<(state: SessionState) => void>();
  private readonly now: () => number;
  private disposed = false;

  constructor(private readonly options: SessionOptions) { this.now = options.now ?? Date.now; }

  get state(): SessionState { this.expireIfNeeded(); return this.current; }
  subscribe(listener: (state: SessionState) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  private set(next: SessionState): void { this.current = next; for (const listener of [...this.listeners]) listener(next); }

  private expireIfNeeded(): void {
    const s = this.current;
    if ((s.phase === 'awaiting_review' || s.phase === 'review_blocked' || s.phase === 'review_failed') && this.now() >= s.expiresAt) this.set({ phase: 'expired', proposal: s.proposal });
  }

  /** Starts a new proposal. Any request in flight is aborted and its answer ignored. */
  async propose(request: ProposeRequest): Promise<SessionState> {
    if (this.disposed) return this.current;
    this.abort?.abort();
    const abort = this.abort = new AbortController();
    const generation = ++this.generation;
    this.sentAt = this.now();
    this.set({ phase: 'proposing' });
    const outcome = await this.options.client.propose(request, abort.signal);
    if (this.stale(generation)) return this.current;
    this.abort = null;
    if (!outcome.ok) { this.set({ phase: 'proposal_failed', failure: outcome.failure }); return this.current; }
    const proposal = outcome.value;
    if (proposal.status === 'blocked') {
      this.set({ phase: 'proposal_blocked', proposal, reasons: proposal.assemblyProposal.validation.issues.length ? proposal.assemblyProposal.validation.issues : ['proposta bloqueada pelo servidor'] });
      return this.current;
    }
    const draft = emptyDraft();
    this.set({ phase: 'awaiting_review', proposal, draft, blockers: reviewBlockers(proposal.observation, draft), expiresAt: this.sentAt + SESSION_TTL_MS });
    return this.current;
  }

  private editable(): Extract<SessionState, { draft: ReviewDraft; expiresAt: number }> | null {
    this.expireIfNeeded();
    const s = this.current;
    return s.phase === 'awaiting_review' || s.phase === 'review_blocked' || s.phase === 'review_failed' ? s : null;
  }

  /** Edits the draft. A decision is always one the person made: nothing here pre-fills a confirmation. */
  edit(patch: Partial<Omit<ReviewDraft, 'decisions'>>): void {
    const s = this.editable(); if (!s) return;
    this.replaceDraft(s, { ...s.draft, ...patch });
  }

  decide(key: string, decision: ReviewDecision | undefined): void {
    const s = this.editable(); if (!s) return;
    this.replaceDraft(s, { ...s.draft, decisions: { ...s.draft.decisions, [key]: decision } });
  }

  private replaceDraft(s: NonNullable<ReturnType<ReconstructionSession['editable']>>, draft: ReviewDraft): void {
    this.set({ phase: 'awaiting_review', proposal: s.proposal, draft, blockers: reviewBlockers(s.proposal.observation, draft), expiresAt: s.expiresAt });
  }

  /** Sends the review. An incomplete draft is refused locally with the same reasons the server would give; a second submit while one is in flight is ignored. */
  async submit(): Promise<SessionState> {
    const s = this.editable();
    if (!s) return this.current;
    const built = buildSubmission(s.proposal.observation, s.draft);
    if (!built.ok) { this.set({ phase: 'review_blocked', proposal: s.proposal, draft: s.draft, blockers: built.reasons, reasons: built.reasons, expiresAt: s.expiresAt }); return this.current; }
    this.abort?.abort();
    const abort = this.abort = new AbortController();
    const generation = ++this.generation;
    this.set({ phase: 'reviewing', proposal: s.proposal, draft: s.draft, expiresAt: s.expiresAt });
    const outcome = await this.options.client.submitReview(s.proposal.sessionId, built.submission, abort.signal);
    if (this.stale(generation)) return this.current;
    this.abort = null;
    const blockers = reviewBlockers(s.proposal.observation, s.draft);
    if (outcome.ok) { this.set({ phase: 'reviewed', proposal: s.proposal, result: outcome.value }); return this.current; }
    const failure = outcome.failure;
    if (failure.kind === 'session_expired') this.set({ phase: 'expired', proposal: s.proposal });
    else if (failure.kind === 'blocked') this.set({ phase: 'review_blocked', proposal: s.proposal, draft: s.draft, blockers, reasons: failure.reasons, expiresAt: s.expiresAt });
    else this.set({ phase: 'review_failed', proposal: s.proposal, draft: s.draft, blockers, failure, expiresAt: s.expiresAt });
    return this.current;
  }

  /** Cancels whatever is in flight. Returns to the last stable phase, or idle if there is none. */
  cancel(): void {
    if (this.current.phase !== 'proposing' && this.current.phase !== 'reviewing') return;
    this.abort?.abort(); this.abort = null; this.generation += 1;
    const s = this.current;
    this.set(s.phase === 'reviewing' ? { phase: 'awaiting_review', proposal: s.proposal, draft: s.draft, blockers: reviewBlockers(s.proposal.observation, s.draft), expiresAt: s.expiresAt } : { phase: 'idle' });
  }

  reset(): void { this.abort?.abort(); this.abort = null; this.generation += 1; this.set({ phase: 'idle' }); }

  dispose(): void { this.disposed = true; this.abort?.abort(); this.abort = null; this.generation += 1; this.listeners.clear(); }

  private stale(generation: number): boolean { return this.disposed || generation !== this.generation; }
}
