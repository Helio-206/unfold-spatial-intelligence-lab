import type { HandLandmarker, HandLandmarkerResult } from '@mediapipe/tasks-vision';

export interface HandLandmark {
  x: number;
  y: number;
  z?: number;
}

export interface ViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface NormalizedCursor {
  x: number;
  y: number;
}

export interface ViewportCursor {
  x: number;
  y: number;
}

export type HandInteractionState = 'OFF' | 'INITIALIZING' | 'ACTIVE' | 'GRABBING' | 'NO_HAND' | 'ERROR';

export interface HandInteractionFrame {
  state: HandInteractionState;
  cursor?: NormalizedCursor;
  viewportCursor?: ViewportCursor;
  pinch: boolean;
  grabStarted: boolean;
  grabEnded: boolean;
  handVisible: boolean;
}

export interface HandInteractionOptions {
  pinchStartThreshold?: number;
  pinchReleaseThreshold?: number;
  pinchConfirmFrames?: number;
  releaseConfirmFrames?: number;
  noHandReleaseFrames?: number;
  smoothing?: number;
}

const HAND_LANDMARK_COUNT = 21;
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const WRIST = 0;
const MIDDLE_MCP = 9;

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(Math.max(value, min), max);
}

function finiteLandmark(landmark: HandLandmark | undefined): boolean {
  return Boolean(landmark && Number.isFinite(landmark.x) && Number.isFinite(landmark.y));
}

export function isValidHandLandmarks(landmarks: readonly HandLandmark[] | undefined): landmarks is HandLandmark[] {
  return Boolean(landmarks && landmarks.length >= HAND_LANDMARK_COUNT && landmarks.slice(0, HAND_LANDMARK_COUNT).every(finiteLandmark));
}

export function distance2D(a: HandLandmark, b: HandLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function pinchRatio(landmarks: readonly HandLandmark[]): number | undefined {
  if (!isValidHandLandmarks(landmarks)) return undefined;
  const wrist = landmarks[WRIST];
  const middleMcp = landmarks[MIDDLE_MCP];
  const palmScale = distance2D(wrist, middleMcp);
  if (!Number.isFinite(palmScale) || palmScale <= 0) return undefined;
  return distance2D(landmarks[THUMB_TIP], landmarks[INDEX_TIP]) / palmScale;
}

export function isPinching(landmarks: readonly HandLandmark[], threshold = 0.55): boolean {
  const ratio = pinchRatio(landmarks);
  return ratio !== undefined && ratio <= threshold;
}

export function mirrorNormalizedCursor(landmark: HandLandmark): NormalizedCursor | undefined {
  if (!finiteLandmark(landmark)) return undefined;
  return { x: clamp(1 - landmark.x), y: clamp(landmark.y) };
}

export function projectCursorToViewport(cursor: NormalizedCursor, rect: ViewportRect): ViewportCursor {
  return {
    x: rect.left + clamp(cursor.x) * rect.width,
    y: rect.top + clamp(cursor.y) * rect.height,
  };
}

export function smoothCursor(previous: NormalizedCursor | undefined, next: NormalizedCursor, alpha = 0.3): NormalizedCursor {
  const blend = clamp(alpha);
  if (!previous) return { ...next };
  return {
    x: previous.x + (next.x - previous.x) * blend,
    y: previous.y + (next.y - previous.y) * blend,
  };
}

export class HandInteractionModel {
  private readonly options: Required<HandInteractionOptions>;
  private state: HandInteractionState = 'OFF';
  private previousCursor: NormalizedCursor | undefined;
  private pinchFrames = 0;
  private releaseFrames = 0;
  private missingFrames = 0;
  private pinching = false;

  constructor(options: HandInteractionOptions = {}) {
    this.options = {
      pinchStartThreshold: options.pinchStartThreshold ?? 0.55,
      pinchReleaseThreshold: options.pinchReleaseThreshold ?? 0.78,
      pinchConfirmFrames: options.pinchConfirmFrames ?? 3,
      releaseConfirmFrames: options.releaseConfirmFrames ?? 3,
      noHandReleaseFrames: options.noHandReleaseFrames ?? 8,
      smoothing: options.smoothing ?? 0.32,
    };
  }

  get currentState(): HandInteractionState {
    return this.state;
  }

  setState(state: HandInteractionState): void {
    this.state = state;
    if (state === 'OFF' || state === 'ERROR') this.resetGestureState();
  }

  update(landmarks: readonly HandLandmark[] | undefined, rect?: ViewportRect): HandInteractionFrame {
    const wasPinching = this.pinching;
    const wasGrabbing = this.state === 'GRABBING';
    if (!isValidHandLandmarks(landmarks)) {
      this.missingFrames += 1;
      this.pinchFrames = 0;
      this.releaseFrames = 0;
      if ((wasGrabbing || this.pinching) && this.missingFrames >= this.options.noHandReleaseFrames) {
        this.pinching = false;
        this.state = 'NO_HAND';
        return this.frame(undefined, rect, false, false, true, false);
      }
      if (this.state === 'ACTIVE' || this.state === 'GRABBING') this.state = 'NO_HAND';
      return this.frame(undefined, rect, this.pinching, false, false, false);
    }

    this.missingFrames = 0;
    if (this.state === 'OFF' || this.state === 'ERROR') this.state = 'ACTIVE';
    const rawCursor = mirrorNormalizedCursor(landmarks[INDEX_TIP]);
    if (!rawCursor) return this.frame(undefined, rect, this.pinching, false, false, false);
    const cursor = smoothCursor(this.previousCursor, rawCursor, this.options.smoothing);
    this.previousCursor = cursor;

    const ratio = pinchRatio(landmarks);
    const currentlyPinching = ratio !== undefined && (this.pinching ? ratio <= this.options.pinchReleaseThreshold : ratio <= this.options.pinchStartThreshold);
    if (currentlyPinching) {
      this.pinchFrames += 1;
      this.releaseFrames = 0;
      if (!this.pinching && this.pinchFrames >= this.options.pinchConfirmFrames) this.pinching = true;
    } else {
      this.releaseFrames += 1;
      this.pinchFrames = 0;
      if (this.pinching && this.releaseFrames >= this.options.releaseConfirmFrames) this.pinching = false;
    }

    const grabStarted = !wasPinching && this.pinching;
    const grabEnded = wasPinching && !this.pinching;
    if (this.pinching) this.state = 'GRABBING';
    else this.state = 'ACTIVE';
    return this.frame(cursor, rect, this.pinching, grabStarted, grabEnded, true);
  }

  release(): HandInteractionFrame {
    const grabEnded = this.pinching;
    this.resetGestureState();
    this.state = this.state === 'OFF' ? 'OFF' : 'ACTIVE';
    return this.frame(this.previousCursor, undefined, false, false, grabEnded, false);
  }

  reset(): void {
    this.resetGestureState();
    this.previousCursor = undefined;
    this.missingFrames = 0;
    this.state = 'OFF';
  }

  private resetGestureState(): void {
    this.pinchFrames = 0;
    this.releaseFrames = 0;
    this.pinching = false;
  }

  private frame(cursor: NormalizedCursor | undefined, rect: ViewportRect | undefined, pinch: boolean, grabStarted: boolean, grabEnded: boolean, handVisible: boolean): HandInteractionFrame {
    return {
      state: this.state,
      cursor,
      viewportCursor: cursor && rect ? projectCursorToViewport(cursor, rect) : undefined,
      pinch,
      grabStarted,
      grabEnded,
      handVisible,
    };
  }
}

export interface HandTrackerMetrics {
  inferenceCount: number;
  inferenceHz: number;
  lastInferenceLatencyMs: number;
  lastTimestampMs: number;
  delegate: 'GPU' | 'CPU';
}

export interface WebcamHandTrackerOptions {
  video: HTMLVideoElement;
  onState: (state: HandInteractionState, message?: string) => void;
  onLandmarks: (landmarks: HandLandmark[] | undefined, metrics: HandTrackerMetrics) => void;
  onError: (error: unknown) => void;
  onMetrics?: (metrics: HandTrackerMetrics) => void;
  inferenceHz?: number;
  modelAssetPath?: string;
  wasmRoot?: string;
}

export class WebcamHandTracker {
  private readonly options: WebcamHandTrackerOptions;
  private readonly intervalMs: number;
  private stream: MediaStream | undefined;
  private landmarker: HandLandmarker | undefined;
  private animationFrame = 0;
  private running = false;
  private lastInferenceAt = 0;
  private lastTimestamp = 0;
  private inferenceCount = 0;
  private firstInferenceAt = 0;
  private delegate: 'GPU' | 'CPU' = 'CPU';

  constructor(options: WebcamHandTrackerOptions) {
    this.options = options;
    this.intervalMs = 1000 / (options.inferenceHz ?? 15);
  }

  async start(): Promise<void> {
    if (this.running) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este browser não disponibiliza acesso à webcam.');
    this.running = true;
    this.options.onState('INITIALIZING', 'A preparar a câmara e o modelo local.');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 640, max: 960 }, height: { ideal: 480, max: 720 } },
      });
      this.options.video.srcObject = this.stream;
      this.options.video.muted = true;
      this.options.video.playsInline = true;
      await this.options.video.play();
      const created = await this.createLandmarker();
      this.landmarker = created.landmarker;
      this.delegate = created.delegate;
      if (!this.running) return;
      this.options.onState('ACTIVE', `Hand Control activo · ${this.delegate}`);
      this.loop();
    } catch (error) {
      this.running = false;
      this.stopResources();
      this.options.onState('ERROR', error instanceof Error ? error.message : 'Não foi possível iniciar a câmara.');
      this.options.onError(error);
      throw error;
    }
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.animationFrame);
    this.stopResources();
    this.options.onState('OFF', 'Hand Control desligado.');
  }

  private async createLandmarker(): Promise<{ landmarker: HandLandmarker; delegate: 'GPU' | 'CPU' }> {
    const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
    const wasmFileset = await FilesetResolver.forVisionTasks(this.options.wasmRoot ?? '/mediapipe/wasm');
    const baseOptions = {
      modelAssetPath: this.options.modelAssetPath ?? '/models/hand_landmarker.task',
      delegate: 'GPU' as const,
    };
    try {
      return {
        landmarker: await HandLandmarker.createFromOptions(wasmFileset, {
          baseOptions,
          runningMode: 'VIDEO',
          numHands: 1,
          minHandDetectionConfidence: 0.55,
          minHandPresenceConfidence: 0.55,
          minTrackingConfidence: 0.55,
        }),
        delegate: 'GPU',
      };
    } catch {
      return {
        landmarker: await HandLandmarker.createFromOptions(wasmFileset, {
          baseOptions: { ...baseOptions, delegate: 'CPU' },
          runningMode: 'VIDEO',
          numHands: 1,
          minHandDetectionConfidence: 0.55,
          minHandPresenceConfidence: 0.55,
          minTrackingConfidence: 0.55,
        }),
        delegate: 'CPU',
      };
    }
  }

  private loop = (): void => {
    if (!this.running) return;
    const now = performance.now();
    if (this.landmarker && this.options.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && now - this.lastInferenceAt >= this.intervalMs) {
      this.lastInferenceAt = now;
      const timestamp = Math.max(Math.round(now), this.lastTimestamp + 1);
      this.lastTimestamp = timestamp;
      const started = performance.now();
      try {
        const result: HandLandmarkerResult = this.landmarker.detectForVideo(this.options.video, timestamp);
        this.inferenceCount += 1;
        if (!this.firstInferenceAt) this.firstInferenceAt = now;
        const metrics = this.metrics(performance.now() - started, timestamp);
        this.options.onLandmarks(result.landmarks[0] as HandLandmark[] | undefined, metrics);
        this.options.onMetrics?.(metrics);
      } catch (error) {
        this.options.onError(error);
      }
    }
    this.animationFrame = requestAnimationFrame(this.loop);
  };

  private metrics(latency: number, timestamp: number): HandTrackerMetrics {
    const elapsed = Math.max(performance.now() - this.firstInferenceAt, 1);
    return {
      inferenceCount: this.inferenceCount,
      inferenceHz: this.inferenceCount > 1 ? (this.inferenceCount - 1) * 1000 / elapsed : 0,
      lastInferenceLatencyMs: latency,
      lastTimestampMs: timestamp,
      delegate: this.delegate,
    };
  }

  private stopResources(): void {
    this.landmarker?.close();
    this.landmarker = undefined;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    this.options.video.pause();
    this.options.video.srcObject = null;
  }
}
