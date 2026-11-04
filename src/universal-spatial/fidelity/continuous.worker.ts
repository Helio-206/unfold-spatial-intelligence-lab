import { runContinuousJob, type ContinuousJob, type JobResult } from './continuous-job';

/** Web Worker entry. Pure computation: no DOM, no Three scene, no GPU. Result buffers are transferred back, not copied. */
const scope = self as unknown as { onmessage: ((event: { data: { id: number; job: ContinuousJob } }) => void) | null; postMessage(message: unknown, transfer?: Transferable[]): void };
scope.onmessage = (event) => {
  const { id, job } = event.data; let result: JobResult;
  try { result = runContinuousJob(job); } catch { result = { ok: false, code: 'EXCEPTION' }; }
  const transfer: Transferable[] = []; if (result.ok) for (const g of result.groups) transfer.push(g.positions.buffer, g.normals.buffer, g.uvs.buffer, g.indices.buffer);
  scope.postMessage({ id, result }, transfer);
};
