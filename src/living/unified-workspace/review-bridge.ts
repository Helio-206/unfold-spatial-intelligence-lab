import type { ExcavatorObservationV1 } from '../reconstruction/contracts';
import type { Decision, ReviewState } from '../experience/review';
import type { ReviewHandoff } from '../experience/integration';
import type { EngineVerdict } from './engine-gate';
import { requiredReviewItems, type ReviewItem as BackendItem } from './review-model';
import type { ReconstructionSession } from './reconstruction-session';
import { adoptReviewed, describeFailure, type WorkspaceCandidate } from './workspace-adapter';
import { validateWithEngine } from './engine-gate';
import type { ReviewDecision } from './types';

/**
 * How the interface's review becomes the backend's review. The two are not the same shape:
 *  - the interface decides per ENTITY (confirm / correct / reject / pending);
 *  - the backend needs a confirm|reject for every hypothesis statement, every entity or relation still marked
 *    `hypothesis`, and every request, plus three human confirmations (family, bucket, width and where it came from).
 * Nothing is inferred: an item without an explicit decision stays undecided and blocks the submission.
 */
export type BridgeItem = BackendItem & { source: 'ui_entity' | 'extra' };

export function bridgeItems(observation: ExcavatorObservationV1): BridgeItem[] {
  return requiredReviewItems(observation).map((item) => ({ ...item, source: item.kind === 'entity' ? 'ui_entity' as const : 'extra' as const }));
}

/**
 * confirmed -> confirm. rejected -> reject. corrected -> reject: the person replaced the model's interpretation, so the
 * model's statement is not confirmed. The correction itself cannot be sent (the API has no field for it); see `localOnlyNotes`.
 */
export function backendDecision(decision: Decision): ReviewDecision | undefined {
  return decision === 'confirmed' ? 'confirm' : decision === 'rejected' || decision === 'corrected' ? 'reject' : undefined;
}

/** Decisions the person made that the API cannot receive. They stay local and the interface should say so. */
export function localOnlyNotes(observation: ExcavatorObservationV1, ui: ReviewState): string[] {
  const hypotheses = new Set(observation.entities.filter((e) => e.status === 'hypothesis').map((e) => e.id));
  const notes: string[] = [];
  for (const item of ui.items) {
    if (item.decision === 'pending') continue;
    if (!hypotheses.has(item.id) && item.decision !== 'confirmed') notes.push(`«${item.label}»: a decisão (${item.decision === 'rejected' ? 'rejeitado' : 'corrigido'}) fica só neste ecrã; a API apenas recebe decisões sobre hipóteses.`);
    else if (item.decision === 'corrected') notes.push(`«${item.label}»: a correcção não é aplicada pela API; a interpretação original foi rejeitada.`);
  }
  for (const item of ui.items) if (item.properties.some((p) => p.entered)) notes.push(`«${item.label}»: os valores introduzidos ficam só neste ecrã e não alteram a geometria.`);
  return notes;
}

export type HumanConfirmations = { reviewerId: string; familyConfirmed: boolean; bucketConfirmed: boolean; bucketWidthM: number | null; widthBasis: string };

export type GatewayResult =
  | { kind: 'ready'; candidate: WorkspaceCandidate; engine: Extract<EngineVerdict, { status: 'valid' }> }
  | { kind: 'engine_blocked'; candidate: WorkspaceCandidate; engine: Extract<EngineVerdict, { status: 'blocked' }> }
  | { kind: 'blocked'; reasons: string[] }
  | { kind: 'expired' }
  | { kind: 'failed'; message: string }
  | { kind: 'not_adoptable'; reasons: string[] }
  | { kind: 'ignored' };

/** Sends the review for the session that produced the observation, then runs both gates. Never confirms anything itself. */
export class ReviewGateway {
  constructor(private readonly session: ReconstructionSession) {}

  get state() { return this.session.state; }

  /** Copies the interface's entity decisions into the backend draft. Pending ones are cleared, never defaulted. */
  syncFromUi(ui: ReviewState): void {
    const s = this.session.state;
    if (s.phase !== 'awaiting_review' && s.phase !== 'review_blocked' && s.phase !== 'review_failed') return;
    for (const item of bridgeItems(s.proposal.observation)) {
      if (item.source !== 'ui_entity') continue;
      const entity = ui.items.find((i) => i.id === item.id);
      this.session.decide(item.key, entity ? backendDecision(entity.decision) : undefined);
    }
  }

  /** Items the entity cards do not cover (hypothesis statements, relations, requests), with the decision made so far. */
  extras(): Array<BridgeItem & { decision: ReviewDecision | undefined }> {
    const s = this.session.state;
    if (!('proposal' in s)) return [];
    const draft = this.session.draft;
    return bridgeItems(s.proposal.observation).filter((i) => i.source === 'extra').map((i) => ({ ...i, decision: draft?.decisions[i.key] }));
  }

  decideExtra(key: string, decision: ReviewDecision | undefined): void { this.session.decide(key, decision); }
  setHuman(patch: Partial<HumanConfirmations>): void { this.session.edit(patch); }

  human(): HumanConfirmations {
    const d = this.session.draft;
    return { reviewerId: d?.reviewerId ?? '', familyConfirmed: d?.familyConfirmed ?? false, bucketConfirmed: d?.bucketConfirmed ?? false, bucketWidthM: d?.bucketWidthM ?? null, widthBasis: d?.widthBasis ?? '' };
  }

  blockers(): string[] {
    const s = this.session.state;
    return s.phase === 'awaiting_review' || s.phase === 'review_blocked' || s.phase === 'review_failed' ? s.blockers : ['sem sessão de reconstrução activa'];
  }

  reopen(): void { this.session.reopen(); }
  reset(): void { this.session.reset(); }

  /** Decisions that stay on this screen. Empty when the session has no observation. */
  localNotes(ui: ReviewState): string[] {
    const s = this.session.state;
    return 'proposal' in s ? localOnlyNotes(s.proposal.observation, ui) : [];
  }

  sync(ui: ReviewState): void { this.syncFromUi(ui); }

  async submit(): Promise<GatewayResult> {
    // sending again after a result (usable or not) always starts from the editable draft
    if (this.session.state.phase === 'reviewed') this.session.reopen();
    const state = await this.session.submit();
    switch (state.phase) {
      case 'reviewed': {
        const adopted = adoptReviewed(state);
        if (!adopted.ok) { this.session.reopen(); return { kind: 'not_adoptable', reasons: adopted.reasons }; }
        // structural validity is established; whether the engine can actually pose this assembly is a separate question
        const engine = validateWithEngine(adopted.candidate.assembly);
        // a result the lab cannot use leaves the review editable, so the person can correct it and send it again
        if (engine.status === 'blocked') { this.session.reopen(); return { kind: 'engine_blocked', candidate: adopted.candidate, engine }; }
        return { kind: 'ready', candidate: adopted.candidate, engine };
      }
      case 'review_blocked': return { kind: 'blocked', reasons: state.reasons };
      case 'expired': return { kind: 'expired' };
      case 'review_failed': return { kind: 'failed', message: describeFailure(state.failure) };
      default: return { kind: 'ignored' };
    }
  }
}

/** Compile-time proof that the gateway satisfies the experience's seam. */
export const asReviewHandoff = (gateway: ReviewGateway): ReviewHandoff => gateway;
