import { evidenceSha256, validateRealityEvidence, type RealityEvidence } from './evidence';
import { canonicalJson, type StorageLike } from '../spatial-space/store';

/**
 * The evidence behind a reconstructed Space, kept beside the Space record under the Space's own source hash (which IS the evidence hash).
 * Reopening a Space rebuilds the same object from the same masks, poses and colours. The entry is checksummed on every read; a missing or damaged entry
 * is reported (the Space then shows its editable proxies, never an invented shape).
 */
export const REALITY_STORE_PREFIX = 'unfold.reality.v1:';
export type RealityLoad = { ok: true; evidence: RealityEvidence } | { ok: false; reason: 'missing' | 'unreadable' | 'invalid' | 'checksum_mismatch' };

export class RealityStore {
  constructor(private readonly storage: StorageLike | null) {}
  async save(evidence: RealityEvidence): Promise<{ ok: true; sha256: string } | { ok: false; reason: 'storage_unavailable' | 'storage_full' }> {
    if (!this.storage) return { ok: false, reason: 'storage_unavailable' };
    const sha256 = await evidenceSha256(evidence);
    try { this.storage.setItem(REALITY_STORE_PREFIX + sha256, canonicalJson(evidence)); } catch { return { ok: false, reason: 'storage_full' }; }
    return { ok: true, sha256 };
  }
  async load(sha256: string): Promise<RealityLoad> {
    let text: string | null; try { text = this.storage?.getItem(REALITY_STORE_PREFIX + sha256) ?? null; } catch { return { ok: false, reason: 'unreadable' }; }
    if (!text) return { ok: false, reason: 'missing' };
    let parsed: unknown; try { parsed = JSON.parse(text); } catch { return { ok: false, reason: 'unreadable' }; }
    let evidence: RealityEvidence; try { evidence = validateRealityEvidence(parsed); } catch { return { ok: false, reason: 'invalid' }; }
    if (await evidenceSha256(evidence) !== sha256) return { ok: false, reason: 'checksum_mismatch' };
    return { ok: true, evidence };
  }
  remove(sha256: string): void { try { this.storage?.removeItem(REALITY_STORE_PREFIX + sha256); } catch { /* unavailable */ } }
}
