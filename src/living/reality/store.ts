import { evidenceSha256, validateRealityEvidence, type RealityEvidence } from './evidence';
import { canonicalJson, type StorageLike } from '../spatial-space/store';

/**
 * The evidence behind a reconstructed Space, kept beside the Space record under the Space's source hash (the hash of its FIRST evidence).
 * It keeps the version history (each refinement is a new version of the evidence, never a replacement) and which version is current, so undoing a
 * refinement and reopening both return exactly what was on stage. Every version is checksummed on read; a missing or damaged record is reported
 * (the Space then shows its editable proxies, never an invented shape).
 */
export const REALITY_STORE_PREFIX = 'unfold.reality.v1:';
export const REALITY_RECORD_CONTRACT = 'unfold.reality-record.v1' as const;
export const REALITY_VERSION_LIMIT = 6;
export type RealityVersion = { sha256: string; note: string; evidence: RealityEvidence };
export type RealityRecord = { contract: typeof REALITY_RECORD_CONTRACT; sourceSha256: string; versions: RealityVersion[]; current: number };
export type RealityLoad = { ok: true; record: RealityRecord } | { ok: false; reason: 'missing' | 'unreadable' | 'invalid' | 'checksum_mismatch' };
export type RealitySave = { ok: true; bytes: number } | { ok: false; reason: 'storage_unavailable' | 'storage_full' | 'too_many_versions' };

export async function newRecord(evidence: RealityEvidence, note = 'Reconstrução inicial'): Promise<RealityRecord> {
  const sha = await evidenceSha256(evidence);
  return { contract: REALITY_RECORD_CONTRACT, sourceSha256: sha, versions: [{ sha256: sha, note, evidence }], current: 0 };
}
/** Appends a refinement as a new version and makes it current. Versions after the current one (undone refinements) are replaced. */
export async function withVersion(record: RealityRecord, evidence: RealityEvidence, note: string): Promise<RealityRecord> {
  const kept = record.versions.slice(0, record.current + 1), sha256 = await evidenceSha256(evidence);
  const versions = [...kept, { sha256, note, evidence }];
  if (versions.length > REALITY_VERSION_LIMIT) throw new Error('REALITY_TOO_MANY_VERSIONS');
  return { ...record, versions, current: versions.length - 1 };
}

export class RealityStore {
  constructor(private readonly storage: StorageLike | null) {}
  async save(record: RealityRecord): Promise<RealitySave> {
    if (!this.storage) return { ok: false, reason: 'storage_unavailable' };
    if (record.versions.length > REALITY_VERSION_LIMIT) return { ok: false, reason: 'too_many_versions' };
    const text = canonicalJson(record);
    try { this.storage.setItem(REALITY_STORE_PREFIX + record.sourceSha256, text); } catch { return { ok: false, reason: 'storage_full' }; }
    return { ok: true, bytes: text.length };
  }
  async load(sourceSha256: string): Promise<RealityLoad> {
    let text: string | null; try { text = this.storage?.getItem(REALITY_STORE_PREFIX + sourceSha256) ?? null; } catch { return { ok: false, reason: 'unreadable' }; }
    if (!text) return { ok: false, reason: 'missing' };
    let parsed: Partial<RealityRecord>; try { parsed = JSON.parse(text); } catch { return { ok: false, reason: 'unreadable' }; }
    if (parsed.contract !== REALITY_RECORD_CONTRACT || parsed.sourceSha256 !== sourceSha256 || !Array.isArray(parsed.versions) || !parsed.versions.length || parsed.versions.length > REALITY_VERSION_LIMIT || !Number.isInteger(parsed.current) || parsed.current! < 0 || parsed.current! >= parsed.versions.length) return { ok: false, reason: 'invalid' };
    const versions: RealityVersion[] = [];
    for (const v of parsed.versions) {
      let evidence: RealityEvidence; try { evidence = validateRealityEvidence(v.evidence); } catch { return { ok: false, reason: 'invalid' }; }
      if (await evidenceSha256(evidence) !== v.sha256) return { ok: false, reason: 'checksum_mismatch' };
      versions.push({ sha256: v.sha256, note: String(v.note ?? ''), evidence });
    }
    if (versions[0]!.sha256 !== sourceSha256) return { ok: false, reason: 'checksum_mismatch' };
    return { ok: true, record: { contract: REALITY_RECORD_CONTRACT, sourceSha256, versions, current: parsed.current! } };
  }
  remove(sourceSha256: string): void { try { this.storage?.removeItem(REALITY_STORE_PREFIX + sourceSha256); } catch { /* unavailable */ } }
}
