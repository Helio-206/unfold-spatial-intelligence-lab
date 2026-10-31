import { describe, expect, it } from 'vitest';
import { HandInteractionModel, isPinching, mirrorNormalizedCursor, projectCursorToViewport, smoothCursor, type HandLandmark } from '../src/hand-tracking';

function landmarks(indexTip: { x: number; y: number }, thumbTip = { x: 0.5, y: 0.5 }): HandLandmark[] {
  const result = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
  result[0] = { x: 0.5, y: 0 };
  result[9] = { x: 0.5, y: 1 };
  result[4] = thumbTip;
  result[8] = indexTip;
  return result;
}

describe('webcam hand interaction primitives', () => {
  it('detects a valid pinch but rejects malformed landmarks', () => {
    expect(isPinching(landmarks({ x: 0.52, y: 0.5 }, { x: 0.5, y: 0.5 }))).toBe(true);
    expect(isPinching([{ x: Number.NaN, y: 0 }])).toBe(false);
  });

  it('mirrors the camera cursor and projects it to the viewport', () => {
    const cursor = mirrorNormalizedCursor({ x: 0.2, y: 0.25 });
    expect(cursor).toEqual({ x: 0.8, y: 0.25 });
    expect(projectCursorToViewport(cursor!, { left: 10, top: 20, width: 400, height: 200 })).toEqual({ x: 330, y: 70 });
  });

  it('smooths hand motion without creating an artificial jump', () => {
    expect(smoothCursor({ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.6 }, 0.25)).toEqual({ x: 0.35000000000000003, y: 0.3 });
  });

  it('requires stable pinch frames and stable release frames', () => {
    const model = new HandInteractionModel({ pinchConfirmFrames: 3, releaseConfirmFrames: 3 });
    model.setState('ACTIVE');
    const open = landmarks({ x: 1.4, y: 0.5 });
    const pinch = landmarks({ x: 0.52, y: 0.5 });
    expect(model.update(open).state).toBe('ACTIVE');
    expect(model.update(pinch).grabStarted).toBe(false);
    expect(model.update(pinch).grabStarted).toBe(false);
    expect(model.update(pinch).grabStarted).toBe(true);
    expect(model.update(open).grabEnded).toBe(false);
    expect(model.update(open).grabEnded).toBe(false);
    expect(model.update(open).grabEnded).toBe(true);
  });

  it('ends a grab safely after prolonged hand loss', () => {
    const model = new HandInteractionModel({ pinchConfirmFrames: 1, noHandReleaseFrames: 2 });
    model.setState('ACTIVE');
    model.update(landmarks({ x: 0.52, y: 0.5 }));
    expect(model.currentState).toBe('GRABBING');
    expect(model.update(undefined).grabEnded).toBe(false);
    const frame = model.update(undefined);
    expect(frame.state).toBe('NO_HAND');
    expect(frame.grabEnded).toBe(true);
  });
});
