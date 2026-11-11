import type { SpatialPlanV2 } from '../../universal-spatial/contracts-v2';
import type { StorageLike } from '../spatial-space/store';
import { assessReconstruction, type RealityAssessment } from './assessment';
import type { RealityEvidence } from './evidence';
import { inlineCompute, replayInline, type RealityCompute } from './compute';
import type { RealityModel } from './model';
import { planFromModel } from './plan';
import type { Refinement } from './refine';
import { newRecord, RealityStore, withVersion, type RealityLoad, type RealityRecord } from './store';

/**
 * Owns the reconstructions of the Spaces in this session: the model drawn on stage, its evidence record with version history, and what has been saved.
 * The Space flow, the geometry seam and the review panel talk to this; the plan itself stays in the Spatial Core and changes only by its transactions.
 */
export type RealityEntry = { record: RealityRecord; model: RealityModel; persisted: boolean };

/** Synchronous rebuild (tests, tooling). The browser path goes through the host's RealityCompute (a Worker). */
export const replay = replayInline;

export class RealityHost {
  private readonly entries = new Map<string, RealityEntry>();
  readonly store: RealityStore;
  constructor(storage: StorageLike | null, private readonly compute: RealityCompute = inlineCompute) { this.store = new RealityStore(storage); }
  dispose(): void { this.compute.dispose(); }

  modelFor = (sourceSha256: string): RealityModel | null => this.entries.get(sourceSha256)?.model ?? null;
  entry(sourceSha256: string): RealityEntry | null { return this.entries.get(sourceSha256) ?? null; }
  has(sourceSha256: string): boolean { return this.entries.has(sourceSha256); }

  /** A new reconstruction from fresh evidence. Not persisted until the Space is saved. */
  async create(evidence: RealityEvidence, title: string, signal?: AbortSignal): Promise<{ sha256: string; plan: SpatialPlanV2; entry: RealityEntry }> {
    const poses = await this.compute.refinePoses(evidence, signal), refined = poses.evidence;
    const record = await newRecord(poses.applied ? refined : poses.note ? { ...evidence, assumptions: [...evidence.assumptions, poses.note].slice(0, 16) } : evidence), model = await this.compute.replay(record, 0, signal), plan = planFromModel(model, record.sourceSha256, title);
    const entry: RealityEntry = { record, model, persisted: false };
    this.entries.set(record.sourceSha256, entry);
    return { sha256: record.sourceSha256, plan, entry };
  }

  /** Loads the evidence of a saved Space and rebuilds exactly what was on stage. */
  async open(sourceSha256: string): Promise<{ ok: true } | Extract<RealityLoad, { ok: false }>> {
    if (this.entries.has(sourceSha256)) return { ok: true };
    const loaded = await this.store.load(sourceSha256);
    if (!loaded.ok) return loaded;
    this.entries.set(sourceSha256, { record: loaded.record, model: await this.compute.replay(loaded.record, loaded.record.current), persisted: true });
    return { ok: true };
  }

  async persist(sourceSha256: string): Promise<boolean> {
    const e = this.entries.get(sourceSha256); if (!e) return false;
    const saved = await this.store.save(e.record); if (saved.ok) e.persisted = true; return saved.ok;
  }
  remove(sourceSha256: string): void { this.entries.delete(sourceSha256); this.store.remove(sourceSha256); }
  forget(sourceSha256: string): void { this.entries.delete(sourceSha256); }

  assess(sourceSha256: string, plan: SpatialPlanV2): RealityAssessment | null {
    const e = this.entries.get(sourceSha256); return e ? assessReconstruction(plan, e.model, sourceSha256) : null;
  }

  /** Computes (without applying) what adding `evidence` would change. */
  async preview(sourceSha256: string, evidence: RealityEvidence, signal?: AbortSignal): Promise<Refinement | null> {
    const e = this.entries.get(sourceSha256); return e ? this.compute.refine(e.record, evidence, signal) : null;
  }
  async apply(sourceSha256: string, evidence: RealityEvidence, note: string): Promise<boolean> {
    const e = this.entries.get(sourceSha256); if (!e) return false;
    let record: RealityRecord; try { record = await withVersion(e.record, evidence, note); } catch { return false; }
    e.record = record; e.model = await this.compute.replay(record, record.current);
    if (e.persisted) await this.store.save(record);
    return true;
  }
  canUndo(sourceSha256: string): boolean { return (this.entries.get(sourceSha256)?.record.current ?? 0) > 0; }
  canRedo(sourceSha256: string): boolean { const r = this.entries.get(sourceSha256)?.record; return !!r && r.current < r.versions.length - 1; }
  async step(sourceSha256: string, delta: -1 | 1): Promise<boolean> {
    const e = this.entries.get(sourceSha256); if (!e) return false;
    const next = e.record.current + delta; if (next < 0 || next >= e.record.versions.length) return false;
    const record = { ...e.record, current: next }; e.model = await this.compute.replay(record, next); e.record = record;
    if (e.persisted) await this.store.save(e.record);
    return true;
  }
}
