import { afterEach, describe, expect, it, vi } from 'vitest';
import { HandInteractionModel, WebcamHandTracker, isPinching, mirrorNormalizedCursor, projectCursorToViewport, smoothCursor, type HandLandmark } from '../src/hand-tracking';

function landmarks(indexTip: { x: number; y: number }, thumbTip = { x: 0.5, y: 0.5 }): HandLandmark[] {
  const result = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
  result[0] = { x: 0.5, y: 0 };
  result[9] = { x: 0.5, y: 1 };
  result[4] = thumbTip;
  result[8] = indexTip;
  return result;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('webcam tracker asynchronous cancellation', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('releases a stream acquired after stop without starting the model or emitting ACTIVE', async () => {
    const media = deferred<MediaStream>();
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    const video = { srcObject: null, pause: vi.fn(), play: vi.fn(async () => {}), muted: false, playsInline: false } as unknown as HTMLVideoElement;
    const onState = vi.fn();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => media.promise } });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const tracker = new WebcamHandTracker({ video, onState, onLandmarks: vi.fn(), onError: vi.fn() });
    const start = tracker.start();
    tracker.stop();
    media.resolve(stream);
    await start;
    expect(stop).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
    expect(video.play).not.toHaveBeenCalled();
    expect(onState.mock.calls.some(([state]) => state === 'ACTIVE')).toBe(false);
  });
  it('closes a model acquired after stop and leaves no stream or video attached', async () => {
    const created = deferred<{ landmarker: { close: () => void }; delegate: 'CPU' }>();
    const stop = vi.fn(); const close = vi.fn();
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    const video = { srcObject: null, pause: vi.fn(), play: vi.fn(async () => {}), muted: false, playsInline: false } as unknown as HTMLVideoElement;
    const onState = vi.fn();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => stream } });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const tracker = new WebcamHandTracker({ video, onState, onLandmarks: vi.fn(), onError: vi.fn() });
    const create = vi.spyOn(tracker as unknown as { createLandmarker: () => Promise<unknown> }, 'createLandmarker').mockReturnValue(created.promise);
    const start = tracker.start();
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
    tracker.stop();
    created.resolve({ landmarker: { close }, delegate: 'CPU' });
    await start;
    expect(stop).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
    expect(onState.mock.calls.some(([state]) => state === 'ACTIVE')).toBe(false);
  });
  it('stops during video playback initialization before creating the model', async () => {
    const playing = deferred<void>();
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    const video = { srcObject: null, pause: vi.fn(), play: vi.fn(() => playing.promise), muted: false, playsInline: false } as unknown as HTMLVideoElement;
    const onState = vi.fn();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => stream } });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const tracker = new WebcamHandTracker({ video, onState, onLandmarks: vi.fn(), onError: vi.fn() });
    const create = vi.spyOn(tracker as unknown as { createLandmarker: () => Promise<unknown> }, 'createLandmarker');
    const start = tracker.start();
    await vi.waitFor(() => expect(video.play).toHaveBeenCalledOnce());
    tracker.stop(); playing.resolve(); await start;
    expect(stop).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(onState.mock.calls.some(([state]) => state === 'ACTIVE')).toBe(false);
  });
  it('does not detach a newer start when an older stream arrives after cancellation', async () => {
    const oldMedia = deferred<MediaStream>();
    const oldStop = vi.fn(); const newStop = vi.fn(); const close = vi.fn();
    const oldStream = { getTracks: () => [{ stop: oldStop }] } as unknown as MediaStream;
    const newStream = { getTracks: () => [{ stop: newStop }] } as unknown as MediaStream;
    const video = { srcObject: null, pause: vi.fn(), play: vi.fn(async () => {}), muted: false, playsInline: false, readyState: 0 } as unknown as HTMLVideoElement;
    const onState = vi.fn();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockReturnValueOnce(oldMedia.promise).mockResolvedValueOnce(newStream) } });
    vi.stubGlobal('cancelAnimationFrame', vi.fn()); vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1)); vi.stubGlobal('HTMLMediaElement', { HAVE_CURRENT_DATA: 2 });
    const tracker = new WebcamHandTracker({ video, onState, onLandmarks: vi.fn(), onError: vi.fn() });
    vi.spyOn(tracker as unknown as { createLandmarker: () => Promise<unknown> }, 'createLandmarker').mockResolvedValue({ landmarker: { close }, delegate: 'CPU' });
    const oldStart = tracker.start(); tracker.stop();
    await tracker.start();
    oldMedia.resolve(oldStream); await oldStart;
    expect(oldStop).toHaveBeenCalledOnce(); expect(newStop).not.toHaveBeenCalled();
    expect(video.srcObject).toBe(newStream);
    expect(onState.mock.calls.filter(([state]) => state === 'ACTIVE')).toHaveLength(1);
    tracker.stop(); tracker.stop();
    expect(newStop).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce(); expect(video.srcObject).toBeNull();
  });
});

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
