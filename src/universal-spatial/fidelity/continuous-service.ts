import { runContinuousJob, type ContinuousJob, type JobResult } from './continuous-job';

/**
 * Runs continuous-surface jobs off the main thread, with a content-addressed cache and real limits.
 *
 * - CPU: at most `poolSize` jobs run at once (default: one less than the cores, at most 2), the queue is bounded, and a job that exceeds `jobTimeoutMs`
 *   is killed (its worker is terminated) and remembered as a failure, so it is never retried by accident.
 * - Memory: the cache is an LRU measured in BYTES (`maxCacheBytes`); results are transferred, not copied.
 * - Cancellation: `retain(keys)` drops queued jobs nobody wants any more and terminates running ones nobody wants, so a stale plan never keeps a core busy.
 * - The router stays synchronous: it asks `get(key)`, draws V2 on a miss, and a `ready` event tells the host to rebuild once results exist.
 * No timers or workers exist until the first request, and `dispose()` removes all of them.
 */
export type WorkerLike = { postMessage(message: unknown, transfer?: Transferable[]): void; terminate(): void; onmessage: ((event: { data: unknown }) => void) | null; onerror: ((event: unknown) => void) | null };
export type ServiceOptions = {
  createWorker: () => WorkerLike;
  poolSize?: number; maxCacheBytes?: number; jobTimeoutMs?: number; maxQueue?: number;
  setTimer?: (fn: () => void, ms: number) => unknown; clearTimer?: (handle: unknown) => void;
};
export type ServiceStats = { hits: number; misses: number; queued: number; running: number; cacheEntries: number; cacheBytes: number; completed: number; failed: number; timeouts: number; cancelled: number; evicted: number; rejected: number; workersCreated: number };
type Running = { id: number; key: string; worker: WorkerLike; timer: unknown };
const NEGATIVE_BYTES = 256;
const bytesOf = (r: JobResult) => (r.ok ? r.bytes : NEGATIVE_BYTES);

export class ContinuousService {
  private readonly cache = new Map<string, JobResult>();
  private cacheBytes = 0;
  private readonly queue: ContinuousJob[] = [];
  private readonly queuedKeys = new Set<string>();
  private readonly running = new Map<string, Running>();
  private readonly idle: WorkerLike[] = [];
  private readonly listeners = new Set<(keys: string[]) => void>();
  private readyBatch: string[] = [];
  private readyScheduled = false;
  private nextId = 1;
  private disposed = false;
  private readonly opt: Required<Omit<ServiceOptions, 'createWorker'>> & Pick<ServiceOptions, 'createWorker'>;
  private counters = { hits: 0, misses: 0, completed: 0, failed: 0, timeouts: 0, cancelled: 0, evicted: 0, rejected: 0, workersCreated: 0 };

  constructor(options: ServiceOptions) {
    const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
    this.opt = { poolSize: Math.max(1, Math.min(2, cores - 1)), maxCacheBytes: 64 * 1024 * 1024, jobTimeoutMs: 15_000, maxQueue: 64, setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>), ...options };
  }

  /** Cached result (also negative results), refreshing its recency. */
  get(key: string): JobResult | undefined {
    const hit = this.cache.get(key);
    if (hit) { this.cache.delete(key); this.cache.set(key, hit); this.counters.hits++; return hit; }
    return undefined;
  }

  request(job: ContinuousJob): 'cached' | 'queued' | 'running' | 'rejected' {
    if (this.disposed) return 'rejected';
    if (this.cache.has(job.key)) return 'cached';
    if (this.running.has(job.key)) return 'running';
    if (this.queuedKeys.has(job.key)) return 'queued';
    this.counters.misses++;
    if (this.queue.length >= this.opt.maxQueue) { this.counters.rejected++; return 'rejected'; }
    this.queue.push(job); this.queuedKeys.add(job.key); this.pump();
    return this.running.has(job.key) ? 'running' : 'queued';
  }

  /** Keep only what the current plan needs: queued jobs outside `keys` are dropped, running ones are terminated. */
  retain(keys: ReadonlySet<string>): void {
    for (let i = this.queue.length - 1; i >= 0; i--) if (!keys.has(this.queue[i]!.key)) { this.queuedKeys.delete(this.queue[i]!.key); this.queue.splice(i, 1); this.counters.cancelled++; }
    for (const [key, run] of [...this.running]) if (!keys.has(key)) { this.opt.clearTimer(run.timer); run.worker.onmessage = null; run.worker.onerror = null; run.worker.terminate(); this.running.delete(key); this.counters.cancelled++; }
    this.pump();
  }

  onReady(listener: (keys: string[]) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  stats(): ServiceStats { return { ...this.counters, queued: this.queue.length, running: this.running.size, cacheEntries: this.cache.size, cacheBytes: this.cacheBytes }; }

  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    for (const run of this.running.values()) { this.opt.clearTimer(run.timer); run.worker.onmessage = null; run.worker.onerror = null; run.worker.terminate(); }
    for (const w of this.idle) w.terminate();
    this.running.clear(); this.idle.length = 0; this.queue.length = 0; this.queuedKeys.clear(); this.cache.clear(); this.cacheBytes = 0; this.listeners.clear();
  }

  private pump(): void {
    while (!this.disposed && this.queue.length && this.running.size < this.opt.poolSize) {
      const job = this.queue.shift()!; this.queuedKeys.delete(job.key);
      const worker = this.idle.pop() ?? this.spawn(), id = this.nextId++;
      const run: Running = { id, key: job.key, worker, timer: this.opt.setTimer(() => this.timeout(run), this.opt.jobTimeoutMs) };
      this.running.set(job.key, run);
      worker.onmessage = (event) => this.done(run, (event.data as { id: number; result: JobResult }).result);
      worker.onerror = () => this.fail(run, 'WORKER_ERROR', false);
      worker.postMessage({ id, job });
    }
  }
  private spawn(): WorkerLike { this.counters.workersCreated++; return this.opt.createWorker(); }
  private done(run: Running, result: JobResult): void {
    if (this.running.get(run.key) !== run) return;
    this.opt.clearTimer(run.timer); this.running.delete(run.key); run.worker.onmessage = null; run.worker.onerror = null; this.idle.push(run.worker);
    this.store(run.key, result); if (result.ok) this.counters.completed++; else this.counters.failed++; this.pump();
  }
  private timeout(run: Running): void { if (this.running.get(run.key) === run) this.fail(run, 'TIMEOUT', true); }
  private fail(run: Running, code: string, killed: boolean): void {
    if (this.running.get(run.key) !== run) return;
    this.opt.clearTimer(run.timer); this.running.delete(run.key); run.worker.onmessage = null; run.worker.onerror = null; run.worker.terminate(); // a stuck or broken worker is never reused
    if (killed) this.counters.timeouts++; this.counters.failed++; this.store(run.key, { ok: false, code }); this.pump();
  }
  private store(key: string, result: JobResult): void {
    const size = bytesOf(result), previous = this.cache.get(key); if (previous) this.cacheBytes -= bytesOf(previous);
    this.cache.set(key, result); this.cacheBytes += size;
    while (this.cacheBytes > this.opt.maxCacheBytes && this.cache.size > 1) { const oldest = this.cache.keys().next().value as string; if (oldest === key) break; this.cacheBytes -= bytesOf(this.cache.get(oldest)!); this.cache.delete(oldest); this.counters.evicted++; }
    this.readyBatch.push(key);
    if (!this.readyScheduled) { this.readyScheduled = true; queueMicrotask(() => { this.readyScheduled = false; const keys = this.readyBatch; this.readyBatch = []; if (!this.disposed) for (const l of this.listeners) l(keys); }); }
  }
}

/** Runs the job on the calling thread, but asynchronously and cancellable. For tests and for environments without Worker. */
export function createInlineWorker(run: (job: ContinuousJob) => JobResult = runContinuousJob, defer: (fn: () => void) => void = (fn) => { setTimeout(fn, 0); }): WorkerLike {
  let alive = true;
  const worker: WorkerLike = {
    onmessage: null, onerror: null,
    postMessage(message) { const { id, job } = message as { id: number; job: ContinuousJob }; defer(() => { if (!alive) return; try { worker.onmessage?.({ data: { id, result: run(job) } }); } catch { worker.onerror?.(new Error('inline job failed')); } }); },
    terminate() { alive = false; },
  };
  return worker;
}

/** A real module worker (browser). Transfers the result buffers back instead of copying them. */
export function createBrowserWorker(): WorkerLike {
  const worker = new Worker(new URL('./continuous.worker.ts', import.meta.url), { type: 'module' });
  return worker as unknown as WorkerLike;
}
