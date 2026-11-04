import { describe, expect, it } from 'vitest';
import { validateSpatialPlanV2, type SpatialPlanV2 } from '../src/universal-spatial/contracts-v2';
import { SpaceStore, STORE_LIMITS, STORE_PREFIX, type StorageLike } from '../src/living/spatial-space/store';

const id3 = { position: [0, 0, 0], rotationRad: [0, 0, 0], scale: [1, 1, 1] };
const plan = (title = 'T'): SpatialPlanV2 => validateSpatialPlanV2({
  contract: 'unfold.spatial-plan.v2', source: { kind: 'text', sha256: 'a'.repeat(64) }, title, units: 'unitless', presentationProfile: 'neutral', relations: [], constraints: [], unknowns: ['scale unknown'],
  components: [{ id: 'base', label: 'Base', parentId: null, transform: id3, provenance: { geometry: 'inferred', transform: 'inferred', material: 'design_approximation', evidence: 'x' },
    geometry: { type: 'shape', key: 'b', operator: 'box', parameters: { dimensions: [1, 1, 1] }, transform: id3, repeat: null, material: { profile: 'metal', color: '#777777', roughness: 0.4, metalness: 0.7, clearcoat: 0 } } }],
});
const run = { model: 'muse-spark-1.3', requestId: 'r1', estimatedCostUsd: 0.02, rawResponseSha256: 'b'.repeat(64), sourceKind: 'text' as const, sourceSha256: 'a'.repeat(64) };
const review = { reviewer: 'client_asserted_unverified' as const, kept: ['base'], rejected: [], edits: 0 };
class Mem implements StorageLike { m = new Map<string, string>(); quota = Infinity;
  getItem(k: string) { return this.m.get(k) ?? null; } removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { if ([...this.m.values()].join('').length + v.length > this.quota) throw new DOMException('full', 'QuotaExceededError'); this.m.set(k, v); } }
let n = 0; const mk = (s: StorageLike | null) => new SpaceStore(s, () => new Date(Date.UTC(2026, 10, 4, 12, 0, n++)), () => `id-${n++}`);

describe('SpaceStore (local, this browser only)', () => {
  it('saves, lists newest first, reopens the same plan, and deletes', async () => {
    const s = mk(new Mem());
    const a = await s.save({ plan: plan('A'), run, review }), b = await s.save({ plan: plan('B'), run, review });
    expect(a.ok && b.ok).toBe(true);
    const listing = await s.list();
    expect(listing.spaces.map((x) => x.title)).toEqual(['B', 'A']); expect(listing.damaged).toEqual([]);
    const opened = await s.open((b as { id: string }).id);
    expect(opened.ok && opened.record.plan).toEqual(plan('B'));
    s.remove((b as { id: string }).id);
    expect((await s.list()).spaces.map((x) => x.title)).toEqual(['A']);
  });
  it('saving again with the same id replaces the record instead of adding one', async () => {
    const s = mk(new Mem()); const a = await s.save({ plan: plan('A'), run, review }) as { id: string };
    await s.save({ id: a.id, plan: plan('A2'), run, review });
    expect((await s.list()).spaces).toHaveLength(1);
  });
  it('detects a changed record, another contract version, an invalid plan and unreadable text, and never opens them', async () => {
    const mem = new Mem(), s = mk(mem); const a = await s.save({ plan: plan('A'), run, review }) as { id: string };
    const text = mem.getItem(STORE_PREFIX + a.id)!;
    mem.setItem(STORE_PREFIX + a.id, text.replace('"A"', '"Tampered"')); expect(await s.open(a.id)).toMatchObject({ ok: false, problem: { reason: 'checksum_mismatch' } });
    mem.setItem(STORE_PREFIX + a.id, text.replace('unfold.space-record.v1', 'unfold.space-record.v9')); expect(await s.open(a.id)).toMatchObject({ ok: false, problem: { reason: 'wrong_contract' } });
    mem.setItem(STORE_PREFIX + a.id, JSON.stringify({ ...JSON.parse(text), plan: { contract: 'x' } })); expect(await s.open(a.id)).toMatchObject({ ok: false, problem: { reason: 'invalid_plan' } });
    mem.setItem(STORE_PREFIX + a.id, '{nope'); expect(await s.open(a.id)).toMatchObject({ ok: false, problem: { reason: 'unreadable' } });
    expect((await s.list()).damaged.map((d) => d.id)).toEqual([a.id]);
  });
  it('refuses past the space limit, a full device, and a missing storage, without losing what is saved', async () => {
    const mem = new Mem(), s = mk(mem);
    for (let i = 0; i < STORE_LIMITS.maxSpaces; i++) expect((await s.save({ plan: plan(`S${i}`), run, review })).ok).toBe(true);
    expect(await s.save({ plan: plan('extra'), run, review })).toEqual({ ok: false, reason: 'too_many' });
    expect((await s.list()).spaces).toHaveLength(STORE_LIMITS.maxSpaces);
    const full = new Mem(); full.quota = 10; expect(await mk(full).save({ plan: plan(), run, review })).toMatchObject({ ok: false, reason: 'storage_full' });
    expect(await mk(null).save({ plan: plan(), run, review })).toEqual({ ok: false, reason: 'storage_unavailable' });
  });
  it('stores no image bytes and no key: only hashes and ids', async () => {
    const mem = new Mem(), s = mk(mem); const a = await s.save({ plan: plan(), run, review }) as { id: string };
    const text = mem.getItem(STORE_PREFIX + a.id)!;
    expect(text).not.toMatch(/data:image|api[_-]?key|authorization/i);
  });
});
