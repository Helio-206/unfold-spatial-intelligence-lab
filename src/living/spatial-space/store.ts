import { validateSpatialPlanV2, type SpatialPlanV2 } from '../../universal-spatial/contracts-v2';

/**
 * My Spaces: local persistence in this browser only. It is not synchronisation and not a backup: clearing site data deletes it, and nothing leaves the device.
 * A record keeps the reviewed plan (with its per-property provenance), what the model run was (ids and hashes, never keys or image bytes) and a SHA-256
 * over those parts, checked on every read. Records of another contract version, with a wrong checksum or with an invalid plan are reported as damaged and never opened.
 */
export const SPACE_RECORD_CONTRACT = 'unfold.space-record.v1' as const;
export const STORE_PREFIX = 'unfold.space.v1:';
export const STORE_INDEX = 'unfold.spaces.index.v1';
export const STORE_LIMITS = { maxSpaces: 24, maxRecordBytes: 400_000, maxTotalBytes: 3_000_000 } as const;

export type SpaceRunMeta = { model: string | null; requestId: string | null; estimatedCostUsd: number | null; rawResponseSha256: string | null; sourceKind: 'text' | 'image'; sourceSha256: string };
export type SpaceReviewSummary = { reviewer: 'client_asserted_unverified'; kept: string[]; rejected: string[]; edits: number };
export type SpaceRecord = { contract: typeof SPACE_RECORD_CONTRACT; id: string; title: string; savedAt: string; plan: SpatialPlanV2; run: SpaceRunMeta; review: SpaceReviewSummary; checksum: string };
export type SpaceListing = { id: string; title: string; savedAt: string; components: number; bytes: number; sourceKind: 'text' | 'image'; model: string | null };
export type StoreProblem = { id: string; reason: 'unreadable' | 'wrong_contract' | 'checksum_mismatch' | 'invalid_plan' };
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type SaveResult = { ok: true; id: string; bytes: number } | { ok: false; reason: 'too_many' | 'record_too_large' | 'storage_full' | 'storage_unavailable' };

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
/** JSON with sorted keys, so the same content always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value as object).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export async function recordChecksum(parts: Pick<SpaceRecord, 'id' | 'title' | 'plan' | 'run' | 'review'>): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(parts))));
}

export class SpaceStore {
  constructor(private readonly storage: StorageLike | null, private readonly now: () => Date = () => new Date(), private readonly newId: () => string = () => crypto.randomUUID()) {}

  private readIndex(): string[] {
    try { const v = JSON.parse(this.storage?.getItem(STORE_INDEX) ?? '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; } catch { return []; }
  }
  private writeIndex(ids: string[]): void { this.storage?.setItem(STORE_INDEX, JSON.stringify(ids)); }
  get available(): boolean { return this.storage !== null; }

  private totalBytes(): number {
    let n = 0; for (const id of this.readIndex()) n += (this.storage?.getItem(STORE_PREFIX + id) ?? '').length; return n;
  }

  async save(input: { id?: string; plan: SpatialPlanV2; run: SpaceRunMeta; review: SpaceReviewSummary }): Promise<SaveResult> {
    if (!this.storage) return { ok: false, reason: 'storage_unavailable' };
    const ids = this.readIndex(), id = input.id && ids.includes(input.id) ? input.id : this.newId();
    if (!ids.includes(id) && ids.length >= STORE_LIMITS.maxSpaces) return { ok: false, reason: 'too_many' };
    const plan = validateSpatialPlanV2(input.plan), base = { id, title: plan.title.slice(0, 120), plan, run: input.run, review: input.review };
    const record: SpaceRecord = { contract: SPACE_RECORD_CONTRACT, ...base, savedAt: this.now().toISOString(), checksum: await recordChecksum(base) };
    const text = JSON.stringify(record);
    if (text.length > STORE_LIMITS.maxRecordBytes) return { ok: false, reason: 'record_too_large' };
    const others = this.totalBytes() - (ids.includes(id) ? (this.storage.getItem(STORE_PREFIX + id) ?? '').length : 0);
    if (others + text.length > STORE_LIMITS.maxTotalBytes) return { ok: false, reason: 'storage_full' };
    try { this.storage.setItem(STORE_PREFIX + id, text); if (!ids.includes(id)) this.writeIndex([...ids, id]); } catch { return { ok: false, reason: 'storage_full' }; }
    return { ok: true, id, bytes: text.length };
  }

  async open(id: string): Promise<{ ok: true; record: SpaceRecord } | { ok: false; problem: StoreProblem }> {
    const fail = (reason: StoreProblem['reason']) => ({ ok: false as const, problem: { id, reason } });
    let parsed: unknown;
    try { const text = this.storage?.getItem(STORE_PREFIX + id); if (!text) return fail('unreadable'); parsed = JSON.parse(text); } catch { return fail('unreadable'); }
    const r = parsed as Partial<SpaceRecord> | null;
    if (!r || typeof r !== 'object') return fail('unreadable');
    if (r.contract !== SPACE_RECORD_CONTRACT) return fail('wrong_contract');
    let plan: SpatialPlanV2;
    try { plan = validateSpatialPlanV2(r.plan); } catch { return fail('invalid_plan'); }
    if (typeof r.id !== 'string' || r.id !== id || !r.run || !r.review || typeof r.title !== 'string' || typeof r.savedAt !== 'string') return fail('unreadable');
    if (r.checksum !== await recordChecksum({ id: r.id, title: r.title, plan: r.plan as SpatialPlanV2, run: r.run, review: r.review })) return fail('checksum_mismatch');
    return { ok: true, record: { ...(r as SpaceRecord), plan } };
  }

  /** Newest first. Damaged entries are listed separately so the person can delete them. */
  async list(): Promise<{ spaces: SpaceListing[]; damaged: StoreProblem[] }> {
    const spaces: SpaceListing[] = [], damaged: StoreProblem[] = [];
    for (const id of this.readIndex()) {
      const opened = await this.open(id);
      if (opened.ok) spaces.push({ id, title: opened.record.title, savedAt: opened.record.savedAt, components: opened.record.plan.components.length, bytes: (this.storage?.getItem(STORE_PREFIX + id) ?? '').length, sourceKind: opened.record.run.sourceKind, model: opened.record.run.model });
      else damaged.push(opened.problem);
    }
    return { spaces: spaces.sort((a, b) => b.savedAt.localeCompare(a.savedAt)), damaged };
  }

  remove(id: string): void {
    try { this.storage?.removeItem(STORE_PREFIX + id); this.writeIndex(this.readIndex().filter((x) => x !== id)); } catch { /* storage unavailable: nothing to remove */ }
  }

  usage(): { spaces: number; bytes: number; maxSpaces: number; maxBytes: number } { return { spaces: this.readIndex().length, bytes: this.totalBytes(), maxSpaces: STORE_LIMITS.maxSpaces, maxBytes: STORE_LIMITS.maxTotalBytes }; }
}

/** `localStorage` when it works (private windows and blocked site data can throw), otherwise null. */
export function browserStorage(): StorageLike | null {
  try { const s = globalThis.localStorage; const k = '__unfold_probe__'; s.setItem(k, '1'); s.removeItem(k); return s; } catch { return null; }
}
