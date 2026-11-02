/**
 * Request-to-callback bookkeeping for an on-demand render loop.
 *
 * `request(t)` is called when a frame is asked for; it reports whether the caller should schedule one (false while one is already pending, and the
 * earliest timestamp is kept). `begin(now)` is called first thing in the frame callback: it returns THIS frame's latency and clears the pending state in
 * the same step, so anything inside the frame that asks for another one (OrbitControls emits "change" from `update()`) starts a new pending request
 * instead of overwriting the timestamp the current frame is about to be measured with.
 */
export class FrameClock {
  private pendingAt: number | undefined;
  request(now: number): boolean { if (this.pendingAt !== undefined) return false; this.pendingAt = now; return true; }
  begin(now: number): { requestedAt: number; latencyMs: number } {
    const requestedAt = this.pendingAt ?? now; this.pendingAt = undefined;
    return { requestedAt, latencyMs: Math.max(0, now - requestedAt) };
  }
}
