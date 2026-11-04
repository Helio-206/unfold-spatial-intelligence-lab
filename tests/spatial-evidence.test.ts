import { describe, expect, it } from 'vitest';
import { addAssociation, addRegion, addSource, associationsForComponent, associationsForRegion, createEvidence, deserializeEvidence, reconcileComponents, serializeEvidence, validateEvidence, verifyAssociation, type EvidenceSnapshot } from '../src/spatial-evidence';

const image = { id: 'img', kind: 'image' as const, sha256: 'a'.repeat(64), pages: [{ page: 1, width: 1200, height: 800 }] };
const document = { id: 'doc', kind: 'document' as const, sha256: 'b'.repeat(64), pages: [{ page: 1, width: 600, height: 900 }, { page: 2, width: 2400, height: 3600 }] };
const component = { id: 'eyepiece', identity: 'eye-identity', correspondenceVersion: 'v1' };
const region = { id: 'r1', sourceId: 'img', page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
const association = { id: 'a1', componentId: 'eyepiece', regionId: 'r1', nature: 'inferred' as const, origin: 'ai' as const, provenance: 'Model proposal; not reviewed.' };
function seed(): EvidenceSnapshot {
  let s = createEvidence('r0');
  s = reconcileComponents(s, 'r0', 'r1', [component]);
  s = addSource(s, 'r1', 'r2', image);
  s = addRegion(s, 'r2', 'r3', region);
  return addAssociation(s, 'r3', 'r4', association);
}

describe('spatial evidence', () => {
  it('links both ways and keeps inference a hypothesis until explicit review', () => {
    const s = seed(); expect(associationsForComponent(s, 'eyepiece')).toEqual(associationsForRegion(s, 'r1'));
    expect(s.associations[0]).toMatchObject({ nature: 'inferred', origin: 'ai', status: 'hypothesis', review: null });
    const reviewed = verifyAssociation(s, 'r4', 'r5', 'a1', 'client-asserted-user');
    expect(reviewed.associations[0]).toMatchObject({ nature: 'inferred', status: 'verified', review: { revision: 'r5', actor: 'client-asserted-user' } });
    expect(s.associations[0]!.status).toBe('hypothesis');
  });
  it('supports independent sources and multi-page documents with different raster sizes', () => {
    let s = addSource(seed(), 'r4', 'r5', document);
    s = addRegion(s, 'r5', 'r6', { id: 'r2', sourceId: 'doc', page: 2, x: 0.1, y: 0.2, width: 0.3, height: 0.4 });
    s = addAssociation(s, 'r6', 'r7', { ...association, id: 'a2', regionId: 'r2' });
    expect(associationsForComponent(s, 'eyepiece')).toHaveLength(2); expect(associationsForRegion(s, 'r2')[0]!.id).toBe('a2');
    expect(s.sources.map(x => x.pages.at(-1)!.width)).toEqual([1200, 2400]);
  });
  it.each([{ ...region, x: -0.1 }, { ...region, width: 0 }, { ...region, x: 0.9, width: 0.2 }, { ...region, x: NaN }, { ...region, page: 2 }])('rejects invalid or unbound regions', bad => {
    const s = addSource(createEvidence('r0'), 'r0', 'r1', image);
    expect(() => addRegion(s, 'r1', 'r2', bad)).toThrow('EVIDENCE_REGION_INVALID');
  });
  it('keeps stable bindings, marks changed correspondences for review and invalidates deleted or replaced components', () => {
    let s = verifyAssociation(seed(), 'r4', 'r5', 'a1', 'reviewer');
    s = reconcileComponents(s, 'r5', 'r6', [component]); expect(s.associations[0]!.status).toBe('verified');
    s = reconcileComponents(s, 'r6', 'r7', [{ ...component, correspondenceVersion: 'v2' }]); expect(s.associations[0]!.status).toBe('needs_review');
    expect(s.associations[0]!.nature).toBe('inferred');
    s = verifyAssociation(s, 'r7', 'r8', 'a1', 'reviewer'); expect(s.associations[0]).toMatchObject({ status: 'verified', correspondenceVersion: 'v2', nature: 'inferred' });
    s = reconcileComponents(s, 'r8', 'r9', []); expect(s.associations[0]!.status).toBe('invalidated'); expect(associationsForComponent(s, 'eyepiece')).toEqual([]);
    s = reconcileComponents(s, 'r9', 'r10', [{ ...component, identity: 'new-identity' }]); expect(s.associations[0]!.status).toBe('invalidated');
  });
  it('rejects stale revisions and contradictory duplicate associations', () => {
    const s = seed(); expect(() => addSource(s, 'r3', 'r5', document)).toThrow('EVIDENCE_STALE_REVISION');
    expect(() => addSource(s, 'r4', 'r0', document)).toThrow('EVIDENCE_REVISION_INVALID');
    expect(() => addAssociation(s, 'r4', 'r5', { ...association, id: 'a2', nature: 'observed' })).toThrow('EVIDENCE_CONTRADICTION');
    const duplicate = addRegion(s, 'r4', 'r5', { ...region, id: 'copy' });
    expect(() => addAssociation(duplicate, 'r5', 'r6', { ...association, id: 'a2', regionId: 'copy' })).toThrow('EVIDENCE_CONTRADICTION');
  });
  it('round trips strictly and rejects invalid hashes, broken references and unknown evidence as verified', () => {
    const s = seed(); expect(deserializeEvidence(serializeEvidence(s))).toEqual(s);
    expect(() => validateEvidence({ ...s, sources: [{ ...image, sha256: 'bad' }] })).toThrow('EVIDENCE_SOURCE_INVALID');
    expect(() => validateEvidence({ ...s, associations: [{ ...s.associations[0]!, status: 'verified', review: { actor: 'reviewer', revision: 'nonexistent', decision: 'verified' } }] })).toThrow('EVIDENCE_ASSOCIATION_INVALID');
    expect(() => validateEvidence({ ...s, regions: [{ ...region, sourceId: 'missing' }] })).toThrow('EVIDENCE_REGION_INVALID');
    expect(() => verifyAssociation({ ...s, associations: [{ ...s.associations[0]!, nature: 'unknown' }] }, 'r4', 'r5', 'a1', 'reviewer')).toThrow('EVIDENCE_REVIEW_INVALID');
  });
  it('returns no evidence without creating a coordinate or association', () => {
    const empty = createEvidence('start'); expect(associationsForRegion(empty, 'absent')).toEqual([]); expect(associationsForComponent(empty, 'absent')).toEqual([]); expect(empty.regions).toEqual([]);
  });
});
