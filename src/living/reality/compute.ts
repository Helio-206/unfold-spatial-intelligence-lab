import { Vector3 } from 'three';
import type { RealityEvidence } from './evidence';
import { segmentInteractive, type SegmentationHint } from './interactive-segmentation';
import type { RGBA } from '../universal-foundry/evidence';
import { buildModel, viewsOf, type RealityModel } from './model';
import { refinePoses } from '../../universal-spatial/reconstruction/multiview';
import { encodeMask, type StoredView } from './evidence';
import { refineModel, type Refinement } from './refine';
import type { RealityRecord } from './store';

/**
 * Where the heavy work runs. Rebuilding a reconstruction costs about a second of CPU, so in the browser it runs in a Worker with cancellation; tests and
 * servers use the inline implementation. Both are the same pure functions of the stored evidence, so the result is identical (asserted in tests).
 */
export type PoseRefinement = { evidence: RealityEvidence; applied: boolean; note: string };

/**
 * Poses marked 'assumed' (equal turntable steps, video time) are refined by leave-one-out consistency. The refinement is ACCEPTED only if the agreement
 * between views improves measurably (>= MIN_GAIN); otherwise the nominal poses are kept. Measured on the benchmark: it recovers part of a few-degree error
 * on most objects, does nothing on rotationally symmetric ones (flagged as not identifiable) and can be neutral or slightly worse on some, hence the gate.
 */
export const POSE_REFINE_MIN_GAIN = 0.005;
export function refinePosesOf(evidence: RealityEvidence): PoseRefinement {
  const assumed = evidence.views.filter((v) => v.azimuthSource === 'assumed').length;
  if (assumed < 3 || evidence.views.length < 4) return { evidence, applied: false, note: '' };
  const views = viewsOf(evidence), frame = { centre: new Vector3(...evidence.frame.centre), half: evidence.frame.half };
  const r = refinePoses(views, { frame, cells: 48, rounds: 4 });
  const gain = r.consistencyAfter - r.consistencyBefore, moved = r.views.filter((v) => Math.abs(v.correctionDeg) > 1e-9);
  if (gain < POSE_REFINE_MIN_GAIN || !moved.length) return { evidence, applied: false, note: `Azimutes assumidos mantidos: o refinamento por consistência não melhorou a concordância entre vistas de forma mensurável (${(gain * 100).toFixed(1)} pontos).` };
  const byId = new Map(r.views.map((v) => [v.id, v]));
  const views2: StoredView[] = evidence.views.map((v) => { const n = byId.get(v.id)!; return { ...v, azimuthDeg: Math.round(n.azimuthDeg * 100) / 100, maskRle: v.maskRle ?? encodeMask(views.find((x) => x.id === v.id)!.mask) }; });
  const mean = moved.reduce((s, v) => s + Math.abs(v.correctionDeg), 0) / moved.length;
  return { evidence: { ...evidence, views: views2, assumptions: [...evidence.assumptions, `Azimutes assumidos refinados por consistência entre vistas: ${moved.length} vistas corrigidas (média ${mean.toFixed(1)}°), concordância ${(r.consistencyBefore * 100).toFixed(1)}% → ${(r.consistencyAfter * 100).toFixed(1)}%. Melhora a consistência; não é uma medição do ângulo.`].slice(0, 16) }, applied: true, note: '' };
}

export type SegmentRequest = { rgba: { width: number; height: number; data: Uint8ClampedArray }; hint: SegmentationHint };
export type RealityCompute = {
  /** interactive foreground segmentation (box + strokes); returns a full-resolution mask */
  segment(request: SegmentRequest, signal?: AbortSignal): Promise<Uint8Array>;
  /** refines assumed poses (see refinePosesOf) */
  refinePoses(evidence: RealityEvidence, signal?: AbortSignal): Promise<PoseRefinement>;
  /** model of version `upTo` of a record, rebuilt by replaying the refinements in order */
  replay(record: RealityRecord, upTo: number, signal?: AbortSignal): Promise<RealityModel>;
  /** what adding `evidence` to the current model would change (nothing is applied) */
  refine(record: RealityRecord, evidence: RealityEvidence, signal?: AbortSignal): Promise<Refinement>;
  dispose(): void;
};

export function replayInline(record: RealityRecord, upTo: number): RealityModel {
  let model = buildModel(record.versions[0]!.evidence);
  for (let i = 1; i <= upTo; i++) model = refineModel(model, record.versions[i]!.evidence).model;
  return model;
}

export const inlineCompute: RealityCompute = {
  async segment(r) { return segmentInteractive(r.rgba as RGBA, r.hint).mask; },
  async refinePoses(evidence) { return refinePosesOf(evidence); },
  async replay(record, upTo) { return replayInline(record, upTo); },
  async refine(record, evidence) { return refineModel(replayInline(record, record.current), evidence); },
  dispose() { /* nothing to release */ },
};

/** structured clone drops prototypes: Vector3 fields are restored here */
export function reviveModel<T extends RealityModel>(model: T): T {
  const v = (o: { x: number; y: number; z: number }) => new Vector3(o.x, o.y, o.z);
  model.frame = { centre: v(model.frame.centre), half: model.frame.half };
  model.solid.grid = { ...model.solid.grid, min: v(model.solid.grid.min) };
  return model;
}

export type WorkerRequest = { id: number; op: 'segment'; request: SegmentRequest } | { id: number; op: 'poses'; evidence: RealityEvidence } | { id: number; op: 'replay'; record: RealityRecord; upTo: number } | { id: number; op: 'refine'; record: RealityRecord; evidence: RealityEvidence };
type NoId<T> = T extends unknown ? Omit<T, 'id'> : never;
export type WorkerReply = { id: number; ok: true; model?: RealityModel; refinement?: Refinement; poses?: PoseRefinement; mask?: Uint8Array } | { id: number; ok: false; error: string };

/** Browser compute: one Worker, one job at a time (bounded concurrency), cancelled by terminating and recreating it. */
export function workerCompute(create: () => Worker): RealityCompute {
  let worker: Worker | null = null, next = 0, tail: Promise<unknown> = Promise.resolve();
  const run = <T>(request: NoId<WorkerRequest>, pick: (r: Extract<WorkerReply, { ok: true }>) => T, signal?: AbortSignal): Promise<T> => {
    const job = () => new Promise<T>((resolve, reject) => {
      if (signal?.aborted) { reject(new DOMException('aborted', 'AbortError')); return; }
      const w = (worker ??= create()), id = ++next;
      const done = () => { w.removeEventListener('message', onMessage); w.removeEventListener('error', onError); signal?.removeEventListener('abort', onAbort); };
      const onMessage = (e: MessageEvent<WorkerReply>) => { if (e.data.id !== id) return; done(); if (e.data.ok) resolve(pick(e.data)); else reject(new Error(e.data.error)); };
      const onError = (e: ErrorEvent) => { done(); worker?.terminate(); worker = null; reject(new Error(e.message || 'REALITY_WORKER_ERROR')); };
      const onAbort = () => { done(); w.terminate(); if (worker === w) worker = null; reject(new DOMException('aborted', 'AbortError')); };
      w.addEventListener('message', onMessage); w.addEventListener('error', onError); signal?.addEventListener('abort', onAbort);
      w.postMessage({ ...request, id } as WorkerRequest);
    });
    const result = tail.then(job, job); tail = result.catch(() => undefined); return result;
  };
  return {
    segment: (request, signal) => run({ op: 'segment', request }, (r) => r.mask!, signal),
    refinePoses: (evidence, signal) => run({ op: 'poses', evidence }, (r) => r.poses!, signal),
    replay: (record, upTo, signal) => run({ op: 'replay', record, upTo }, (r) => reviveModel(r.model!), signal),
    refine: (record, evidence, signal) => run({ op: 'refine', record, evidence }, (r) => ({ ...r.refinement!, model: reviveModel(r.refinement!.model) }), signal),
    dispose() { worker?.terminate(); worker = null; },
  };
}
