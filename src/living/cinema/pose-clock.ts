/**
 * The engineering clock of pose playback. It advances by real elapsed time and is NOT subject to the 100 ms cap that smooths camera and render
 * motion: a frame that arrives late (a slow device, a busy tab) must not slow the machine's timeline down, it just lands further along.
 * `start` begins counting from `nowMs`; while paused `tick` returns 0 and the paused interval is never added back.
 */
export class PoseClock {
  private last: number | null = null;
  start(nowMs: number): void { this.last = nowMs; }
  pause(): void { this.last = null; }
  get running(): boolean { return this.last !== null; }
  /** seconds of pose time elapsed since the previous tick (never negative) */
  tick(nowMs: number, speed = 1): number {
    if (this.last === null) return 0;
    const dt = Math.max(0, nowMs - this.last) / 1000; if (nowMs > this.last) this.last = nowMs;
    return dt * speed;
  }
}
