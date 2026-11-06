import type { EvidenceJSON } from '../../universal-spatial/reconstruction/evidence';
import type { Outcome } from '../../universal-spatial/reconstruction/engine';
import type { PlanSpaceLayer } from './layer';
import type { ShapeFinding } from '../../universal-spatial/reconstruction/shapes';
import type { SpatialOperationV2 } from '../../universal-spatial/contracts-v2';

import { getSpatialReviewEligibility, spatialPlanFingerprintV2 } from '../../universal-spatial/api-client';
import { projectReviewedPlan } from '../../universal-spatial/review-v1';
import type { SpatialPlanV2 } from '../../universal-spatial/contracts-v2';

/**
 * Solver input. Confirmation flags are NOT accepted from the caller: when `reviewId` is given, the
 * enforced subjects and the contradicted override come from the persistent review record on the
 * server; without one, nothing is confirmed and contradicted relations block the fit (the engine's
 * safe default). The review revision is captured at start and re-read while the Worker runs.
 */
type Input = { sourceSha256: string; evidence: EvidenceJSON; reviewId?: string };
type Ready = { layer: PlanSpaceLayer; version: number; source: string; operations: SpatialOperationV2[]; evidence: string; reviewId: string | null; reviewRevision: number | null; planFingerprint: string | null };

/** Explicit debug-only adapter. Workers are terminated on stale state, timeout, cancellation and dispose. */
export class ExperimentalV4 {
  private worker: Worker | null = null;
  private stop: (() => void) | null = null;
  private ready: Ready | null = null;
  private disposed = false;
  constructor(private readonly active: () => PlanSpaceLayer | null, private readonly select?: (id: string) => void, private readonly reviewIdProvider?: () => string | null) {}
  cancel(): void { this.stop?.(); this.ready = null; }
  dispose(): void { this.disposed = true; this.cancel(); }
  async run(input: Input): Promise<Outcome> {
    return this.execute<Outcome>(input, 'structure');
  }
  async runShapes(input: Input): Promise<ShapeFinding[]> {
    return this.execute<ShapeFinding[]>(input, 'shapes');
  }
  private async execute<T extends Outcome | ShapeFinding[]>(input: Input, mode: 'structure' | 'shapes'): Promise<T> {
    this.cancel();
    const layer = this.active();
    if (this.disposed || !layer || layer.isBusy || !layer.currentPlan.source.sha256 || layer.currentPlan.source.sha256 !== input.sourceSha256) throw new Error('V4_CONTEXT_INVALID');
    // The solver consumes the recorded review state, never caller-supplied confirmation flags.
    let confirmed: string[] = [], allowContradicted = false, reviewRevision: number | null = null;
    let solverPlan: SpatialPlanV2 = layer.currentPlan, planFingerprint: string | null = null;
    const requestedReviewId = input.reviewId ?? this.reviewIdProvider?.() ?? undefined;
    if (requestedReviewId !== undefined) {
      if (typeof requestedReviewId !== 'string' || !requestedReviewId) throw new Error('V4_REVIEW_INVALID');
      planFingerprint = await spatialPlanFingerprintV2(layer.currentPlan);
      // A client-supplied reviewId is never trusted on its own: the server must confirm that this
      // exact record belongs to this exact plan fingerprint and source.
      const { review, gate } = await getSpatialReviewEligibility({ reviewId: requestedReviewId, planFingerprint, sourceSha256: layer.currentPlan.source.sha256 });
      if (this.disposed || this.active() !== layer) throw new Error('V4_STALE');
      if (review.planFingerprint !== planFingerprint || review.source.sha256 !== layer.currentPlan.source.sha256) throw new Error('V4_REVIEW_BINDING_MISMATCH');
      if (!gate.eligible) throw new Error(`V4_REVIEW_BLOCKED:${gate.blockers[0] ?? 'UNRESOLVED'}`);
      // Rejected relations leave the projection, corrected ones enter it with their corrected
      // kind/endpoints: the Worker evaluates the reviewed state, not the original declarations.
      solverPlan = projectReviewedPlan(layer.currentPlan, review).plan;
      confirmed = gate.enforcedSubjectIds; allowContradicted = gate.allowContradicted; reviewRevision = gate.reviewRevision;
    }
    const reviewStale = async (): Promise<boolean> => {
      if (reviewRevision === null || !requestedReviewId) return false;
      try { const { gate } = await getSpatialReviewEligibility({ reviewId: requestedReviewId }); return gate.reviewRevision !== reviewRevision; }
      catch { return true; } // the authoritative state can no longer be confirmed: fail closed
    };
    const views = input.evidence?.views;
    const vec = (v: unknown): v is number[] => Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n));
    if (!['rendered', 'photo'].includes(input.evidence?.source) || typeof input.evidence?.note !== 'string' || input.evidence.note.length > 1000 || !Array.isArray(views) || views.length > 24 || views.length < 3 || views.some(v => !v || !vec(v.direction) || !v.direction.some(n => n !== 0) || !vec(v.centre) || !Number.isFinite(v.half) || v.half <= 0 || typeof v.calibrated !== 'boolean' || !Number.isInteger(v.res) || v.res < 8 || v.res > 256 || !Array.isArray(v.rle) || v.rle.length > v.res * v.res + 1 || v.rle.some(n => !Number.isSafeInteger(n) || n < 0) || v.rle.reduce((a,b) => a+b,0) !== v.res * v.res)) throw new Error('V4_EVIDENCE_INVALID');
    const version = layer.explanationVersion, source = input.sourceSha256;
    const current = () => !this.disposed && this.active() === layer && layer.explanationVersion === version && layer.currentPlan.source.sha256 === source;
    const worker = new Worker(new URL('../../universal-spatial/reconstruction/experimental-worker.ts', import.meta.url), { type: 'module' }); this.worker = worker;
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = (error?: Error, outcome?: T) => {
        if (finished) return; finished = true; clearInterval(poll); clearTimeout(timeout); worker.terminate();
        if (this.worker === worker) { this.worker = null; this.stop = null; }
        if (error) { reject(error); return; }
        if (mode === 'shapes') {
          const proposals = (outcome as ShapeFinding[]).flatMap(f => f.proposal ? [f.proposal] : []);
          this.ready = { layer, version, source, operations: proposals.map(p => p.operation), evidence: proposals.map(p => p.evidence).join(' '), reviewId: requestedReviewId ?? null, reviewRevision, planFingerprint };
        } else {
          const proposal = (outcome as Outcome).proposal;
          this.ready = { layer, version, source, operations: proposal?.operations ?? [], evidence: proposal?.evidence ?? '', reviewId: requestedReviewId ?? null, reviewRevision, planFingerprint };
        }
        resolve(outcome!);
      };
      let reviewCheckInFlight = false;
      const poll = setInterval(() => {
        if (!current()) { finish(new Error('V4_STALE')); return; }
        if (reviewRevision !== null && !reviewCheckInFlight) { reviewCheckInFlight = true; void reviewStale().then((stale) => { reviewCheckInFlight = false; if (stale) finish(new Error('V4_STALE')); }); }
      }, 100);
      const timeout = setTimeout(() => finish(new Error('V4_TIMEOUT')), 15000);
      this.stop = () => finish(new Error('V4_CANCELLED'));
      worker.onerror = () => finish(new Error('V4_WORKER_FAILED'));
      worker.onmessage = (event: MessageEvent<{ ok: boolean; outcome?: T; error?: string }>) => { if (!current()) finish(new Error('V4_STALE')); else if (!event.data.ok || !event.data.outcome) finish(new Error(event.data.error ?? 'V4_WORKER_FAILED')); else void reviewStale().then((stale) => stale ? finish(new Error('V4_STALE')) : finish(undefined, event.data.outcome)); };
      try { worker.postMessage({ plan: structuredClone(solverPlan), evidence: structuredClone(input.evidence), allowContradicted, confirmed, mode }); } catch { finish(new Error('V4_WORKER_FAILED')); }
    });
  }
  /**
   * Revalidates the exact reviewed state this proposal was computed from before offering it, and
   * arms the layer's authorisation guard with the same check, so a review change after preview
   * (or any failure to revalidate, including network uncertainty) prevents application.
   */
  async preview(): Promise<boolean> {
    const r = this.ready; this.ready = null;
    if (!r || this.disposed || this.active() !== r.layer || r.layer.isBusy || r.layer.explanationVersion !== r.version || r.layer.currentPlan.source.sha256 !== r.source) return false;
    const first = r.operations[0];
    if (!first) return false;
    const revalidate = async (): Promise<boolean> => {
      if (r.reviewId === null || r.reviewRevision === null || r.planFingerprint === null) return true;
      try {
        const fingerprint = await spatialPlanFingerprintV2(r.layer.currentPlan);
        if (fingerprint !== r.planFingerprint) return false;
        await getSpatialReviewEligibility({ reviewId: r.reviewId, reviewRevision: r.reviewRevision, planFingerprint: r.planFingerprint, sourceSha256: r.source });
        return true;
      } catch { return false; } // cannot revalidate: fail closed
    };
    if (!await revalidate()) return false;
    if (this.disposed || this.active() !== r.layer || r.layer.explanationVersion !== r.version) return false;
    this.select?.(first.componentId);
    return r.layer.proposeSolverEdit(r.operations, 'Proposta experimental V4', r.evidence, { authorisationGuard: revalidate, ...(r.reviewId !== null && r.reviewRevision !== null && r.planFingerprint !== null ? { reviewBinding: { reviewId: r.reviewId, reviewRevision: r.reviewRevision, planFingerprint: r.planFingerprint, sourceSha256: r.source } } : {}) });
  }
}
