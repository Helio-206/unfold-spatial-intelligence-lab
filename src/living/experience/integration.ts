/**
 * The seams where the real reconstruction and the real laboratory plug into the experience. All optional: without them
 * the page is the prototype (demo port, prototype lab). Interfaces only; the implementations live in
 * `unified-workspace/` so the experience never imports the API client.
 */
import type { EngineGate, ReviewState } from './review';

export type HandoffDecision = 'confirm' | 'reject';
export type HandoffExtra = { key: string; kind: string; label: string; decision: HandoffDecision | undefined };
export type HandoffHuman = { reviewerId: string; familyConfirmed: boolean; bucketConfirmed: boolean; bucketWidthM: number | null; widthBasis: string };

export type HandoffResult =
  /** Both gates passed: `candidate` is whatever the lab host needs to mount the approved assembly. */
  | { kind: 'ready'; engine: Extract<EngineGate, { status: 'valid' }>; candidate: unknown }
  /** The contract is valid but the Engineering Engine cannot pose this assembly: gate 2 is blocked and the lab stays closed. */
  | { kind: 'engine_blocked'; engine: Extract<EngineGate, { status: 'blocked' }> }
  | { kind: 'blocked'; reasons: string[] }
  | { kind: 'expired' }
  | { kind: 'failed'; message: string }
  | { kind: 'not_adoptable'; reasons: string[] }
  | { kind: 'ignored' };

/** Sends the person's review to the server session that produced the observation. Never confirms anything by itself. */
export interface ReviewHandoff {
  /** Copy the review's entity decisions into the backend draft (pending stays undecided). */
  sync(ui: ReviewState): void;
  /** Decisions the entity cards cannot express (statements, relations, requests), made explicitly or not at all. */
  extras(): HandoffExtra[];
  decideExtra(key: string, decision: HandoffDecision | undefined): void;
  human(): HandoffHuman;
  setHuman(patch: Partial<HandoffHuman>): void;
  /** What still blocks the submission, in plain language. Empty means it can be sent. */
  blockers(): string[];
  /** Decisions that stay on this screen because the API has no field for them. */
  localNotes(ui: ReviewState): string[];
  submit(): Promise<HandoffResult>;
  /** Back from the lab: the review becomes editable again with the same draft. */
  reopen(): void;
  /** Start over: forget the session. */
  reset(): void;
}

/** What the lab needs from the experience: the state of both gates as text, and the two ways back out. */
export type LabContext = {
  gates: { review: string; engine: string };
  /** Back to the review, with the person's decisions intact. */
  back(): void;
  /** Forget this reconstruction and start from an empty lab. */
  restart(): void;
};

/** The laboratory that replaces the prototype lab: the same workspace as `/living`. */
export interface LabHost {
  mount(host: HTMLElement, candidate: unknown, context: LabContext): void;
  unmount(): void;
}

/** A secondary way in that does not involve the person's source: open the reference machine, labelled as an example. */
export interface ExampleEntry { run(): void }

export type ExperienceOptions = { port?: import('./intake').ReconstructionPort; handoff?: ReviewHandoff; lab?: LabHost; example?: ExampleEntry };
