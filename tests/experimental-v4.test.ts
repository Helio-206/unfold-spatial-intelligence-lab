import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExperimentalV4 } from '../src/living/spatial-space/experimental-v4';
import type { PlanSpaceLayer } from '../src/living/spatial-space/layer';

class FakeWorker {
  static latest: FakeWorker;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  terminate = vi.fn(); postMessage = vi.fn();
  constructor() { FakeWorker.latest = this; }
  reply(outcome: unknown) { this.onmessage?.({ data: { ok: true, outcome } } as MessageEvent); }
}
const evidence = { source: 'rendered' as const, note: 'fixture', views: Array.from({ length: 3 }, () => ({ direction: [0,0,1], centre: [0,0,0], half: 1, res: 8, calibrated: true, rle: [64] })) };
const makeLayer = () => ({ explanationVersion: 1, currentPlan: { source: { sha256: 'a'.repeat(64) } }, isBusy: false, proposeSolverEdit: vi.fn(() => true) });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('experimental V4 worker ownership', () => {
  it('refuses an old result after a revision change and terminates the worker', async () => {
    vi.stubGlobal('Worker', FakeWorker); const layer = makeLayer(); const api = new ExperimentalV4(() => layer as unknown as PlanSpaceLayer);
    const pending = api.run({ sourceSha256: 'a'.repeat(64), evidence }); const worker = FakeWorker.latest;
    layer.explanationVersion++; worker.reply({ proposal: null }); await expect(pending).rejects.toThrow('V4_STALE'); expect(worker.terminate).toHaveBeenCalledOnce(); await expect(api.preview()).resolves.toBe(false);
  });
  it('cancels and disposes without accepting a late response', async () => {
    vi.stubGlobal('Worker', FakeWorker); const layer = makeLayer(); const api = new ExperimentalV4(() => layer as unknown as PlanSpaceLayer);
    const pending = api.run({ sourceSha256: 'a'.repeat(64), evidence }); const worker = FakeWorker.latest; api.dispose();
    await expect(pending).rejects.toThrow('V4_CANCELLED'); worker.reply({ proposal: null }); expect(worker.terminate).toHaveBeenCalledOnce(); await expect(api.preview()).resolves.toBe(false);
  });
  it('rejects results for a replaced Space and refuses stale previews', async () => {
    vi.stubGlobal('Worker', FakeWorker); const first = makeLayer(), second = makeLayer(); let active = first;
    const api = new ExperimentalV4(() => active as unknown as PlanSpaceLayer);
    const pending = api.run({ sourceSha256: 'a'.repeat(64), evidence }); const worker = FakeWorker.latest;
    active = second; worker.reply({ proposal: null }); await expect(pending).rejects.toThrow('V4_STALE'); expect(worker.terminate).toHaveBeenCalledOnce();
    active = first; const next = api.run({ sourceSha256: 'a'.repeat(64), evidence });
    FakeWorker.latest.reply({ proposal: { operations: [], evidence: 'fixture' } }); await next;
    first.currentPlan.source.sha256 = 'b'.repeat(64); await expect(api.preview()).resolves.toBe(false); expect(first.proposeSolverEdit).not.toHaveBeenCalled(); api.dispose();
  });
  it('requires the same source hash and bounded masks', async () => {
    vi.stubGlobal('Worker', FakeWorker); const layer = makeLayer(); const api = new ExperimentalV4(() => layer as unknown as PlanSpaceLayer);
    await expect(api.run({ sourceSha256: 'b'.repeat(64), evidence })).rejects.toThrow('V4_CONTEXT_INVALID');
    await expect(api.run({ sourceSha256: 'a'.repeat(64), evidence: { ...evidence, views: [{ ...evidence.views[0]!, rle: [2] }, ...evidence.views.slice(1)] } })).rejects.toThrow('V4_EVIDENCE_INVALID');
  });
  it('keeps shape alternatives as a preview until explicitly offered', async () => {
    vi.stubGlobal('Worker', FakeWorker); const layer = makeLayer(); const api = new ExperimentalV4(() => layer as unknown as PlanSpaceLayer);
    const pending = api.runShapes({ sourceSha256: 'a'.repeat(64), evidence });
    const operation = { componentId: 'part', kind: 'set-geometry' };
    FakeWorker.latest.reply([{ proposal: { operation, evidence: 'inferred fixture' } }]); await pending;
    expect(layer.proposeSolverEdit).not.toHaveBeenCalled(); await expect(api.preview()).resolves.toBe(true);
    expect(layer.proposeSolverEdit).toHaveBeenCalledWith([operation], 'Proposta experimental V4', 'inferred fixture', expect.objectContaining({ authorisationGuard: expect.any(Function) })); api.dispose();
  });
});
