import type { EvidenceJSON } from '../../universal-spatial/reconstruction/evidence';
import type { Outcome } from '../../universal-spatial/reconstruction/engine';
import type { PlanSpaceLayer } from './layer';
import type { ShapeFinding } from '../../universal-spatial/reconstruction/shapes';
import type { SpatialOperationV2 } from '../../universal-spatial/contracts-v2';

type Input = { sourceSha256: string; evidence: EvidenceJSON; allowContradicted?: boolean; confirmed?: string[] };
type Ready = { layer: PlanSpaceLayer; version: number; source: string; operations: SpatialOperationV2[]; evidence: string };

/** Explicit debug-only adapter. Workers are terminated on stale state, timeout, cancellation and dispose. */
export class ExperimentalV4 {
  private worker: Worker | null = null;
  private stop: (() => void) | null = null;
  private ready: Ready | null = null;
  private disposed = false;
  constructor(private readonly active: () => PlanSpaceLayer | null, private readonly select?: (id: string) => void) {}
  cancel(): void { this.stop?.(); this.ready = null; }
  dispose(): void { this.disposed = true; this.cancel(); }
  async run(input: Input): Promise<Outcome> {
    return this.execute<Outcome>(input, 'structure');
  }
  async runShapes(input: Input): Promise<ShapeFinding[]> {
    return this.execute<ShapeFinding[]>(input, 'shapes');
  }
  private async execute<T extends Outcome | ShapeFinding[]>(input: Input, mode: 'structure' | 'shapes'): Promise<T> {
    this.cancel();
    const layer = this.active();
    if (this.disposed || !layer || layer.isBusy || !layer.currentPlan.source.sha256 || layer.currentPlan.source.sha256 !== input.sourceSha256) throw new Error('V4_CONTEXT_INVALID');
    if (input.confirmed && (!Array.isArray(input.confirmed) || input.confirmed.length > 128 || input.confirmed.some(id => typeof id !== 'string' || id.length > 48 || !/^(hyp|rel)-[a-zA-Z0-9_-]+$/.test(id)))) throw new Error('V4_CONFIRMATION_INVALID');
    const views = input.evidence?.views;
    const vec = (v: unknown): v is number[] => Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n));
    if (!['rendered', 'photo'].includes(input.evidence?.source) || typeof input.evidence?.note !== 'string' || input.evidence.note.length > 1000 || !Array.isArray(views) || views.length > 24 || views.length < 3 || views.some(v => !v || !vec(v.direction) || !v.direction.some(n => n !== 0) || !vec(v.centre) || !Number.isFinite(v.half) || v.half <= 0 || typeof v.calibrated !== 'boolean' || !Number.isInteger(v.res) || v.res < 8 || v.res > 256 || !Array.isArray(v.rle) || v.rle.length > v.res * v.res + 1 || v.rle.some(n => !Number.isSafeInteger(n) || n < 0) || v.rle.reduce((a,b) => a+b,0) !== v.res * v.res)) throw new Error('V4_EVIDENCE_INVALID');
    const version = layer.explanationVersion, source = input.sourceSha256;
    const current = () => !this.disposed && this.active() === layer && layer.explanationVersion === version && layer.currentPlan.source.sha256 === source;
    const worker = new Worker(new URL('../../universal-spatial/reconstruction/experimental-worker.ts', import.meta.url), { type: 'module' }); this.worker = worker;
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = (error?: Error, outcome?: T) => {
        if (finished) return; finished = true; clearInterval(poll); clearTimeout(timeout); worker.terminate();
        if (this.worker === worker) { this.worker = null; this.stop = null; }
        if (error) { reject(error); return; }
        if (mode === 'shapes') {
          const proposals = (outcome as ShapeFinding[]).flatMap(f => f.proposal ? [f.proposal] : []);
          this.ready = { layer, version, source, operations: proposals.map(p => p.operation), evidence: proposals.map(p => p.evidence).join(' ') };
        } else {
          const proposal = (outcome as Outcome).proposal;
          this.ready = { layer, version, source, operations: proposal?.operations ?? [], evidence: proposal?.evidence ?? '' };
        }
        resolve(outcome!);
      };
      const poll = setInterval(() => { if (!current()) finish(new Error('V4_STALE')); }, 100);
      const timeout = setTimeout(() => finish(new Error('V4_TIMEOUT')), 15000);
      this.stop = () => finish(new Error('V4_CANCELLED'));
      worker.onerror = () => finish(new Error('V4_WORKER_FAILED'));
      worker.onmessage = (event: MessageEvent<{ ok: boolean; outcome?: T; error?: string }>) => { if (!current()) finish(new Error('V4_STALE')); else if (!event.data.ok || !event.data.outcome) finish(new Error(event.data.error ?? 'V4_WORKER_FAILED')); else finish(undefined, event.data.outcome); };
      try { worker.postMessage({ plan: structuredClone(layer.currentPlan), evidence: structuredClone(input.evidence), allowContradicted: input.allowContradicted === true, confirmed: input.confirmed ?? [], mode }); } catch { finish(new Error('V4_WORKER_FAILED')); }
    });
  }
  preview(): boolean {
    const r = this.ready; this.ready = null;
    if (!r || this.disposed || this.active() !== r.layer || r.layer.isBusy || r.layer.explanationVersion !== r.version || r.layer.currentPlan.source.sha256 !== r.source) return false;
    const first = r.operations[0];
    if (!first) return false;
    this.select?.(first.componentId);
    return r.layer.proposeSolverEdit(r.operations, 'Proposta experimental V4', r.evidence);
  }
}
