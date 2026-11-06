import { describe, expect, it, vi } from 'vitest';
import type { GeometryNodeV2 } from '../src/universal-spatial/contracts-v2';
import { jobKey, runContinuousJob, type ContinuousJob, type JobResult } from '../src/universal-spatial/fidelity/continuous-job';
import { ContinuousService, createInlineWorker, type WorkerLike } from '../src/universal-spatial/fidelity/continuous-service';

const sphere = (r: number): GeometryNodeV2 => ({ type: 'shape', key: 's', operator: 'sphere', parameters: { radius: r, widthSegments: 16, heightSegments: 12 }, transform: { position: [0, 0, 0], rotationRad: [0, 0, 0], scale: [1, 1, 1] }, repeat: null, material: { profile: 'neutral', color: '#888888', roughness: 0.5, metalness: 0, clearcoat: 0 } });
const job = (r: number, id = 'c'): ContinuousJob => { const base = { entityId: id, geometry: sphere(r), neighbours: [], maxTriangles: 400_000, maxGridCells: 32 }; return { ...base, key: jobKey(base) }; };
const flush = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 1)); };

/** Worker that answers after `delay` ms of FAKE time, counting runs and terminations. */
function fakeTimers() { let now = 0; const timers: Array<{ at: number; fn: () => void; id: number }> = []; let seq = 0; return { setTimer: (fn: () => void, ms: number) => { const id = ++seq; timers.push({ at: now + ms, fn, id }); return id; }, clearTimer: (h: unknown) => { const i = timers.findIndex((t) => t.id === h); if (i >= 0) timers.splice(i, 1); }, advance: (ms: number) => { now += ms; for (const t of [...timers].filter((x) => x.at <= now)) { timers.splice(timers.indexOf(t), 1); t.fn(); } }, pending: () => timers.length }; }

describe('continuous service', () => {
  it('computes the same result in a worker as inline, and caches it', async () => {
    const run = vi.fn(runContinuousJob), service = new ContinuousService({ createWorker: () => createInlineWorker((j) => run(j)), poolSize: 1 }), j = job(1);
    expect(service.request(j)).toMatch(/queued|running/); expect(service.get(j.key)).toBeUndefined(); await flush();
    const cached = service.get(j.key)!, direct = runContinuousJob(j); expect(cached.ok).toBe(true); expect(cached.ok && direct.ok && cached.triangles).toBe(direct.ok && direct.triangles);
    expect(service.request(j)).toBe('cached'); expect(run).toHaveBeenCalledTimes(1); expect(service.stats().hits).toBeGreaterThan(0); service.dispose();
  });

  it('notifies once per batch with the finished keys', async () => {
    const service = new ContinuousService({ createWorker: () => createInlineWorker(), poolSize: 2 }), seen: string[][] = []; service.onReady((keys) => seen.push(keys));
    service.request(job(1, 'a')); service.request(job(1.1, 'b')); await flush(); expect(seen.flat().sort()).toEqual([job(1, 'a').key, job(1.1, 'b').key].sort()); service.dispose();
  });

  it('deduplicates a key that is queued or running', async () => {
    const run = vi.fn(runContinuousJob), service = new ContinuousService({ createWorker: () => createInlineWorker((j) => run(j)), poolSize: 1 }), j = job(1);
    service.request(j); expect(service.request(j)).toBe('running'); service.request(job(2, 'x')); expect(service.request(job(2, 'x'))).toBe('queued'); await flush(); expect(run).toHaveBeenCalledTimes(2); service.dispose();
  });

  it('never runs more jobs at once than the pool allows, and starts workers lazily', async () => {
    let created = 0, active = 0, peak = 0;
    const service = new ContinuousService({ createWorker: () => { created++; return createInlineWorker((j) => { active++; peak = Math.max(peak, active); const r = runContinuousJob(j); active--; return r; }); }, poolSize: 2 });
    expect(created).toBe(0); for (let i = 0; i < 6; i++) service.request(job(1 + i * 0.1, `p${i}`)); expect(service.stats().running).toBeLessThanOrEqual(2); await flush(12);
    expect(peak).toBeLessThanOrEqual(2); expect(created).toBeLessThanOrEqual(2); expect(service.stats().completed).toBe(6); service.dispose();
  });

  it('cancels queued jobs and terminates running ones that the current plan no longer needs', async () => {
    const terminated = vi.fn(), never = (): WorkerLike => ({ onmessage: null, onerror: null, postMessage() { /* never answers */ }, terminate: terminated });
    const service = new ContinuousService({ createWorker: never, poolSize: 1 }), keep = job(1, 'keep'), drop = job(1.2, 'drop'), queued = job(1.4, 'queued');
    service.request(drop); service.request(keep); service.request(queued); expect(service.stats().running).toBe(1); expect(service.stats().queued).toBe(2);
    service.retain(new Set([keep.key])); expect(terminated).toHaveBeenCalledTimes(1); expect(service.stats().cancelled).toBe(2); expect(service.stats().queued).toBe(0); expect(service.stats().running).toBe(1); // keep took the freed slot
    service.dispose(); expect(terminated).toHaveBeenCalledTimes(2);
  });

  it('kills a job that exceeds its time budget, remembers the failure, and never retries it', () => {
    const timers = fakeTimers(), terminated = vi.fn(), worker = (): WorkerLike => ({ onmessage: null, onerror: null, postMessage() { /* stuck */ }, terminate: terminated });
    const service = new ContinuousService({ createWorker: worker, poolSize: 1, jobTimeoutMs: 1000, setTimer: timers.setTimer, clearTimer: timers.clearTimer }), j = job(1);
    service.request(j); timers.advance(999); expect(service.get(j.key)).toBeUndefined(); timers.advance(2);
    expect(terminated).toHaveBeenCalledTimes(1); expect(service.get(j.key)).toEqual({ ok: false, code: 'TIMEOUT' }); expect(service.stats().timeouts).toBe(1); expect(service.request(j)).toBe('cached'); service.dispose();
  });

  it('turns a worker error into a remembered failure and frees the slot for the next job', async () => {
    let n = 0; const service = new ContinuousService({ createWorker: () => (n++ === 0 ? ({ onmessage: null, onerror: null, postMessage() { setTimeout(() => this.onerror?.(new Error('boom')), 0); }, terminate() { /* gone */ } } as WorkerLike) : createInlineWorker()), poolSize: 1 });
    const bad = job(1, 'bad'), good = job(1.2, 'good'); service.request(bad); service.request(good); await flush(); expect(service.get(bad.key)).toEqual({ ok: false, code: 'WORKER_ERROR' }); expect(service.get(good.key)!.ok).toBe(true); service.dispose();
  });

  it('bounds the queue', () => {
    const service = new ContinuousService({ createWorker: () => ({ onmessage: null, onerror: null, postMessage() { /* stuck */ }, terminate() { /* gone */ } }), poolSize: 1, maxQueue: 2 });
    const answers = [1, 2, 3, 4, 5].map((i) => service.request(job(1 + i * 0.1, `q${i}`))); expect(answers).toEqual(['running', 'queued', 'queued', 'rejected', 'rejected']); expect(service.stats().rejected).toBe(2); service.dispose();
  });

  it('keeps the cache under its byte budget, evicting the least recently used first', async () => {
    const service = new ContinuousService({ createWorker: () => createInlineWorker(), poolSize: 1, maxCacheBytes: 600_000 }), jobs = [1, 1.1, 1.2, 1.3, 1.4].map((r, i) => job(r, `e${i}`));
    for (const j of jobs) { service.request(j); await flush(3); service.get(jobs[0]!.key); } // keep touching the first
    expect(service.stats().cacheBytes).toBeLessThanOrEqual(600_000); expect(service.stats().cacheEntries).toBe(2); /* one result is ~266 KB */ expect(service.stats().evicted).toBeGreaterThan(0); expect(service.get(jobs[0]!.key)).toBeDefined(); service.dispose();
  });

  it('dispose terminates everything, is idempotent, and nothing is delivered afterwards', async () => {
    const terminated = vi.fn(), service = new ContinuousService({ createWorker: () => ({ onmessage: null, onerror: null, postMessage() { /* stuck */ }, terminate: terminated }), poolSize: 2 }); const heard = vi.fn(); service.onReady(heard);
    service.request(job(1, 'a')); service.request(job(1.1, 'b')); service.request(job(1.2, 'c')); service.dispose(); service.dispose(); expect(terminated).toHaveBeenCalledTimes(2); expect(service.request(job(1.3, 'd'))).toBe('rejected');
    await flush(); expect(heard).not.toHaveBeenCalled(); expect(service.stats().cacheBytes).toBe(0);
  });

  it('a late answer from a cancelled worker is ignored', async () => {
    let post: (() => void) | null = null; const w: WorkerLike = { onmessage: null, onerror: null, postMessage(m) { const { id, job: j } = m as { id: number; job: ContinuousJob }; post = () => w.onmessage?.({ data: { id, result: runContinuousJob(j) as JobResult } }); }, terminate() { /* terminated */ } };
    const service = new ContinuousService({ createWorker: () => w, poolSize: 1 }), j = job(1); service.request(j); service.retain(new Set()); post!(); await flush(); expect(service.get(j.key)).toBeUndefined(); service.dispose();
  });
});
