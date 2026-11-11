/// <reference lib="webworker" />
import { replayInline, type WorkerReply, type WorkerRequest } from './compute';
import { refineModel } from './refine';

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  try {
    if (req.op === 'replay') { const model = replayInline(req.record, req.upTo); (self as unknown as Worker).postMessage({ id: req.id, ok: true, model } satisfies WorkerReply); }
    else { const refinement = refineModel(replayInline(req.record, req.record.current), req.evidence); (self as unknown as Worker).postMessage({ id: req.id, ok: true, refinement } satisfies WorkerReply); }
  } catch (error) { (self as unknown as Worker).postMessage({ id: req.id, ok: false, error: error instanceof Error ? error.message : 'REALITY_ERROR' } satisfies WorkerReply); }
};
