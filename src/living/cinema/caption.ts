import type { PoseSample } from './pose-source';

/**
 * The one-line caption under the title. Two kinds of text share it and must not erase each other:
 *  - the FRAME message (blocked reason or first warning of the sample on stage): replaced by the next sample, and cleared when the next sample has none;
 *  - NOTIFICATIONS (shot changed, quality changed, device slow): shown until something else replaces them.
 * A clean frame clears only a frame message it put there itself.
 */
export class CaptionState {
  private current = ''; private ownedByFrame = false;
  get text(): string { return this.current; }
  notify(text: string): string { this.current = text; this.ownedByFrame = false; return this.current; }
  frame(sample: Pick<PoseSample, 'blocked' | 'warnings'>): string {
    const message = sample.blocked ? `Bloqueado: ${sample.blocked.message}` : sample.warnings[0]?.message ?? null;
    if (message !== null) { this.current = message; this.ownedByFrame = true; }
    else if (this.ownedByFrame) { this.current = ''; this.ownedByFrame = false; }
    return this.current;
  }
}
