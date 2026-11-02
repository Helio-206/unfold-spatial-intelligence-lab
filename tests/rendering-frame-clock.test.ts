import { describe, expect, it } from 'vitest';
import { FrameClock } from '../src/rendering/frame-clock';

describe('FrameClock', () => {
  it('reports request-to-callback latency', () => {
    const clock = new FrameClock(); expect(clock.request(100)).toBe(true);
    expect(clock.begin(220)).toEqual({ requestedAt: 100, latencyMs: 120 });
  });
  it('a request made while the frame runs (OrbitControls "change" inside update()) schedules the NEXT frame and never overwrites this frame\'s timestamp', () => {
    const clock = new FrameClock(); clock.request(100);
    const frame = clock.begin(250); // latency is captured before anything in the frame can request another one
    expect(clock.request(255)).toBe(true); // orbit.update() emitted "change" -> invalidate()
    expect(frame.latencyMs).toBe(150);
    expect(clock.begin(275)).toEqual({ requestedAt: 255, latencyMs: 20 });
  });
  it('coalesces requests while one is pending and keeps the earliest timestamp', () => {
    const clock = new FrameClock(); expect(clock.request(10)).toBe(true); expect(clock.request(30)).toBe(false);
    expect(clock.begin(50).latencyMs).toBe(40);
  });
  it('a frame nobody requested (first draw) has zero latency, never negative', () => {
    const clock = new FrameClock(); expect(clock.begin(500).latencyMs).toBe(0);
    clock.request(600); expect(clock.begin(590).latencyMs).toBe(0);
  });
});
