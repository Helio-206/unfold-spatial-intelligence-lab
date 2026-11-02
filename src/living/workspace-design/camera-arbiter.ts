/**
 * Who may move the camera. There is one camera and one controller; this decides between the people and the assistant.
 *
 * The user always wins: any pointer orbit, wheel, keyboard move or hand-tracking gesture takes ownership at once and
 * cancels an assistant move in progress. The assistant may only request a move when nobody has touched the view for
 * `quietMs`, and never while the user's hand tracking is active. A denied request still lets the Digital Hand point;
 * only the camera stays where the user left it.
 */

export type CameraOwner = 'idle' | 'user_pointer' | 'user_keyboard' | 'user_hand' | 'assistant';
export type UserInput = Exclude<CameraOwner, 'idle' | 'assistant'>;
export type AssistantDecision = { granted: true; token: number } | { granted: false; reason: 'user_active' | 'hand_tracking_active' };

export class CameraArbiter {
  private owner: CameraOwner = 'idle';
  private lastUserAt = Number.NEGATIVE_INFINITY;
  private handActive = false;
  private token = 0;
  private readonly cancelListeners = new Set<(token: number) => void>();

  constructor(private readonly now: () => number = () => performance.now(), readonly quietMs = 2500) {}

  get current(): CameraOwner { return this.owner; }
  get handTracking(): boolean { return this.handActive; }

  /** A user input started (pointerdown on the canvas, wheel, orbit key, hand grab). Cancels assistant motion. */
  userInput(kind: UserInput): void {
    this.lastUserAt = this.now();
    if (this.owner === 'assistant') this.cancelListeners.forEach((fn) => fn(this.token));
    this.owner = kind;
  }

  /** The user input ended; ownership returns to idle, the quiet period counts from now. */
  userRelease(): void { this.lastUserAt = this.now(); if (this.owner !== 'assistant') this.owner = 'idle'; }

  setHandTracking(active: boolean): void {
    this.handActive = active;
    if (active) this.userInput('user_hand');
    else if (this.owner === 'user_hand') this.userRelease();
  }

  requestAssistantMove(): AssistantDecision {
    if (this.handActive) return { granted: false, reason: 'hand_tracking_active' };
    if (this.owner !== 'idle' && this.owner !== 'assistant') return { granted: false, reason: 'user_active' };
    if (this.now() - this.lastUserAt < this.quietMs) return { granted: false, reason: 'user_active' };
    this.owner = 'assistant';
    return { granted: true, token: ++this.token };
  }

  /** The assistant move finished (or was cancelled); only the current token can release. */
  assistantDone(token: number): void { if (this.owner === 'assistant' && token === this.token) this.owner = 'idle'; }

  isCurrent(token: number): boolean { return this.owner === 'assistant' && token === this.token; }

  onCancel(fn: (token: number) => void): () => void { this.cancelListeners.add(fn); return () => this.cancelListeners.delete(fn); }
}
