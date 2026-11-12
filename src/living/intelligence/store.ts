import type { StorageLike } from '../spatial-space/store';
import { EXPERIMENT_CONTRACT, type Experiment } from './experiment';
import { validateMechanism, type Mechanism } from './mechanism';

/** Local persistence of the mechanism and the experiments of a Space, keyed by the plan's source hash (like the Reality evidence). Corrupt or foreign data is reported, never half-loaded. */
const MKEY = (sha: string) => `unfold.mechanism.v1:${sha}`, EKEY = (sha: string) => `unfold.experiments.v1:${sha}`, MAX_EXPERIMENTS = 40, MAX_BYTES = 450_000;
export type Loaded<T> = { ok: true; value: T } | { ok: false; reason: 'absent' | 'corrupt' | 'foreign' | 'storage' };
export class IntelligenceStore {
  constructor(private readonly storage: StorageLike | null) {}
  saveMechanism(m: Mechanism): boolean { if (!this.storage) return false; try { const text = JSON.stringify(m); if (text.length > MAX_BYTES) return false; this.storage.setItem(MKEY(m.planSha256), text); return true; } catch { return false; } }
  loadMechanism(sha: string): Loaded<Mechanism> {
    if (!this.storage) return { ok: false, reason: 'storage' }; let raw: string | null; try { raw = this.storage.getItem(MKEY(sha)); } catch { return { ok: false, reason: 'storage' }; } if (raw === null) return { ok: false, reason: 'absent' };
    try { const m = validateMechanism(JSON.parse(raw)); return m.planSha256 === sha ? { ok: true, value: m } : { ok: false, reason: 'foreign' }; } catch { return { ok: false, reason: 'corrupt' }; }
  }
  saveExperiment(e: Experiment): boolean {
    if (!this.storage) return false; const cur = this.loadExperiments(e.objectVersion.planSha256); const list = cur.ok ? cur.value : []; const next = [...list.filter((x) => x.id !== e.id), e].slice(-MAX_EXPERIMENTS);
    try { const text = JSON.stringify(next); if (text.length > MAX_BYTES) return false; this.storage.setItem(EKEY(e.objectVersion.planSha256), text); return true; } catch { return false; }
  }
  loadExperiments(sha: string): Loaded<Experiment[]> {
    if (!this.storage) return { ok: false, reason: 'storage' }; let raw: string | null; try { raw = this.storage.getItem(EKEY(sha)); } catch { return { ok: false, reason: 'storage' }; } if (raw === null) return { ok: true, value: [] };
    try { const v = JSON.parse(raw) as Experiment[]; if (!Array.isArray(v) || v.some((e) => e?.contract !== EXPERIMENT_CONTRACT || e.objectVersion?.planSha256 !== sha || typeof e.resultHash !== 'string')) return { ok: false, reason: 'foreign' }; return { ok: true, value: v }; } catch { return { ok: false, reason: 'corrupt' }; }
  }
  deleteExperiment(sha: string, id: string): boolean { const c = this.loadExperiments(sha); if (!c.ok || !this.storage) return false; try { this.storage.setItem(EKEY(sha), JSON.stringify(c.value.filter((e) => e.id !== id))); return true; } catch { return false; } }
}
