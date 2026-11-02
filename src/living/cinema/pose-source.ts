import { Quaternion, Vector3 } from 'three';
import { validateMotionFrame, type BlockedInfo, type FrameWarning, type Measurement, type MotionFrame, type MotionFrameStatus, type PartTransform, type PoseBasis } from '../contracts';

/**
 * Where the cinema gets part poses from. The cinema never solves kinematics: it draws what a pose source gives it and shows its status.
 *  - `ReferencePoseSource`: the reference configuration of the synthetic assembly (poses computed by an independent script, see contracts/fixtures).
 *  - `MotionFramePlayer`: validated `unfold.motion-frame.v1` frames from the engineering engine, replayed in time.
 * Presentation smoothing between two engine frames is allowed (it only blends two poses the engine already solved); across a blocked frame,
 * or when a frame is not `ok`, nothing is blended and the frame's own `poseBasis` is shown.
 */
export type PoseSample = {
  parts: PartTransform[];
  /** `reference` when the source is the static reference pose, otherwise the frame's status */
  status: MotionFrameStatus | 'reference';
  poseBasis: PoseBasis;
  timestampS: number;
  warnings: FrameWarning[];
  /** the engine's measurements for the frame shown, as produced (unknown stays unknown) */
  measurements: Measurement[];
  blocked: BlockedInfo | null;
  /** true when the sample is a blend of two engine frames (presentation smoothing), false when it is a frame as produced */
  interpolated: boolean;
  /** sha-256 of the engine input for the frame shown (null for the reference pose) */
  inputDigest: string | null;
};

export interface PoseSource {
  readonly kind: 'reference-fixture' | 'motion-frames';
  readonly assemblyId: string;
  readonly durationS: number;
  sample(timeS: number): PoseSample;
}

export class ReferencePoseSource implements PoseSource {
  readonly kind = 'reference-fixture' as const;
  readonly durationS = 0;
  constructor(readonly assemblyId: string, private readonly parts: PartTransform[]) {}
  sample(): PoseSample {
    return { parts: this.parts.map((p) => ({ partId: p.partId, translationM: [...p.translationM], rotation: [...p.rotation] })), status: 'reference', poseBasis: 'reference', timestampS: 0, warnings: [], measurements: [], blocked: null, interpolated: false, inputDigest: null };
  }
}

export class MotionFrameRejected extends Error {
  constructor(readonly issues: Array<{ path: string; message: string }>) { super(`Quadro de movimento recusado: ${issues.slice(0, 3).map((i) => `${i.path} ${i.message}`).join('; ')}`); this.name = 'MotionFrameRejected'; }
}

const qa = new Quaternion(); const qb = new Quaternion(); const va = new Vector3(); const vb = new Vector3();

export class MotionFramePlayer implements PoseSource {
  readonly kind = 'motion-frames' as const;
  readonly assemblyId: string;
  readonly durationS: number;
  private readonly frames: MotionFrame[];
  /** `frames` are validated one by one; one invalid frame rejects the whole sequence (no partial playback of untrusted data). */
  constructor(frames: readonly unknown[]) {
    if (!frames.length) throw new MotionFrameRejected([{ path: '$', message: 'Sequência vazia.' }]);
    const accepted: MotionFrame[] = [];
    frames.forEach((frame, i) => { const v = validateMotionFrame(frame); if (!v.ok) throw new MotionFrameRejected(v.issues.map((x) => ({ path: `frames[${i}]${x.path.slice(1)}`, message: x.message }))); accepted.push(frame as MotionFrame); });
    accepted.sort((a, b) => a.timestampS - b.timestampS);
    if (new Set(accepted.map((f) => f.assemblyId)).size !== 1) throw new MotionFrameRejected([{ path: '$', message: 'Os quadros pertencem a montagens diferentes.' }]);
    this.frames = accepted; this.assemblyId = accepted[0]!.assemblyId; this.durationS = accepted.at(-1)!.timestampS;
  }
  get frameCount(): number { return this.frames.length; }
  sample(timeS: number): PoseSample {
    const t = Math.min(Math.max(timeS, this.frames[0]!.timestampS), this.durationS);
    let hi = this.frames.findIndex((f) => f.timestampS >= t); if (hi < 0) hi = this.frames.length - 1;
    const b = this.frames[hi]!; const a = this.frames[Math.max(0, hi - 1)]!;
    const span = b.timestampS - a.timestampS;
    const blend = span > 0 ? (t - a.timestampS) / span : 1;
    if (a === b || blend >= 1 || blend <= 0 || a.status !== 'ok' || b.status !== 'ok') {
      const shown = blend >= 0.5 || a === b ? b : a; // no blend across a frame that is not ok: show the nearest frame as the engine produced it
      return asSample(shown, false);
    }
    const parts = a.parts.map((pa): PartTransform => {
      const pb = b.parts.find((p) => p.partId === pa.partId) ?? pa;
      va.fromArray(pa.translationM); vb.fromArray(pb.translationM); va.lerp(vb, blend);
      qa.fromArray(pa.rotation); qb.fromArray(pb.rotation); qa.slerp(qb, blend);
      return { partId: pa.partId, translationM: [va.x, va.y, va.z], rotation: [qa.x, qa.y, qa.z, qa.w] };
    });
    return { ...asSample(a, true), parts, timestampS: t };
  }
}

function asSample(frame: MotionFrame, interpolated: boolean): PoseSample {
  return { parts: frame.parts.map((p) => ({ partId: p.partId, translationM: [...p.translationM], rotation: [...p.rotation] })), status: frame.status, poseBasis: frame.poseBasis, timestampS: frame.timestampS, warnings: frame.warnings, measurements: frame.measurements, blocked: frame.blocked, interpolated, inputDigest: frame.inputDigest };
}

/** Reads `excavator.reference-pose.json`-shaped data with a real check (3 and 4 finite numbers, unit quaternion) instead of a cast. */
export function referencePartsFrom(json: unknown): PartTransform[] {
  const parts = (json as { parts?: unknown })?.parts;
  if (!Array.isArray(parts) || !parts.length) throw new Error('Pose de referência sem partes.');
  return parts.map((p, i) => {
    const t = (p as { translationM?: unknown }).translationM; const r = (p as { rotation?: unknown }).rotation; const id = (p as { partId?: unknown }).partId;
    const ok = typeof id === 'string' && Array.isArray(t) && t.length === 3 && t.every(Number.isFinite) && Array.isArray(r) && r.length === 4 && r.every(Number.isFinite) && Math.abs(Math.hypot(...(r as number[])) - 1) < 1e-6;
    if (!ok) throw new Error(`Pose de referência inválida na parte ${i}.`);
    return { partId: id, translationM: [t[0], t[1], t[2]] as [number, number, number], rotation: [r[0], r[1], r[2], r[3]] as [number, number, number, number] };
  });
}
