import { describe, expect, it } from 'vitest';
import { CameraArbiter } from '../../../src/living/workspace-design/camera-arbiter';

const clock = () => { let t = 10_000; return { now: () => t, advance: (ms: number) => { t += ms; } }; };

describe('camera arbiter', () => {
  it('grants the assistant a move only after the quiet period', () => {
    const c = clock(); const a = new CameraArbiter(c.now, 2500);
    a.userInput('user_pointer'); a.userRelease();
    expect(a.requestAssistantMove()).toEqual({ granted: false, reason: 'user_active' });
    c.advance(2600);
    const d = a.requestAssistantMove();
    expect(d.granted).toBe(true);
    expect(a.current).toBe('assistant');
  });

  it('user input cancels a running assistant move immediately', () => {
    const c = clock(); const a = new CameraArbiter(c.now, 2500);
    const cancelled: number[] = [];
    a.onCancel((t) => cancelled.push(t));
    const d = a.requestAssistantMove();
    if (!d.granted) throw new Error('expected grant');
    a.userInput('user_pointer');
    expect(cancelled).toEqual([d.token]);
    expect(a.isCurrent(d.token)).toBe(false);
    expect(a.current).toBe('user_pointer');
    a.assistantDone(d.token); // a stale completion cannot steal ownership back
    expect(a.current).toBe('user_pointer');
  });

  it('never lets the assistant move while user hand tracking is active', () => {
    const c = clock(); const a = new CameraArbiter(c.now, 2500);
    a.setHandTracking(true);
    c.advance(10_000);
    expect(a.requestAssistantMove()).toEqual({ granted: false, reason: 'hand_tracking_active' });
    a.setHandTracking(false);
    c.advance(2600);
    expect(a.requestAssistantMove().granted).toBe(true);
  });

  it('denies while the user still holds the view', () => {
    const c = clock(); const a = new CameraArbiter(c.now, 2500);
    a.userInput('user_keyboard');
    c.advance(9000);
    expect(a.requestAssistantMove().granted).toBe(false);
  });
});
