import { Vector3 } from 'three';
import type { RealityEvidence } from './evidence';
import { buildModel, type RealityModel } from './model';
import { refineModel, type Refinement } from './refine';
import type { RealityRecord } from './store';

/**
 * Where the heavy work runs. Rebuilding a reconstruction costs about a second of CPU, so in the browser it runs in a Worker with cancellation; tests and
 * servers use the inline implementation. Both are the same pure functions of the stored evidence, so the result is identical (asserted in tests).
 */
export type RealityCompute = {
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

export type WorkerRequest = { id: number; op: 'replay'; record: RealityRecord; upTo: number } | { id: number; op: 'refine'; record: RealityRecord; evidence: RealityEvidence };
type NoId<T> = T extends unknown ? Omit<T, 'id'> : never;
export type WorkerReply = { id: number; ok: true; model?: RealityModel; refinement?: Refinement } | { id: number; ok: false; error: string };

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
    replay: (record, upTo, signal) => run({ op: 'replay', record, upTo }, (r) => reviveModel(r.model!), signal),
    refine: (record, evidence, signal) => run({ op: 'refine', record, evidence }, (r) => ({ ...r.refinement!, model: reviveModel(r.refinement!.model) }), signal),
    dispose() { worker?.terminate(); worker = null; },
  };
}
