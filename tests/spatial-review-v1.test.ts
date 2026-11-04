import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { rawRequest, withGuardedServer, ALLOWED_ORIGIN } from './helpers/paid-routes';

const headers = { 'content-type': 'application/json', origin: ALLOWED_ORIGIN };
const identity = { position: [0, 0, 0], rotationRad: [0, 0, 0], scale: [1, 1, 1] };
const material = { profile: 'metal', color: '#777777', roughness: 0.4, metalness: 0.7, clearcoat: 0 };
const part = (id: string, x: number) => ({ id, label: id, parentId: null, geometry: { type: 'shape', key: `${id}-shell`, operator: 'box', parameters: { dimensions: [1, 1, 1] }, transform: identity, repeat: null, material }, transform: { ...identity, position: [x, 0, 0] }, provenance: { geometry: 'inferred', transform: 'inferred', material: 'inferred', evidence: 'fixture' } });
// base and top touch (centres 1 apart, size 1); base and side are declared attached but far apart (contradicted).
const plan = {
  contract: 'unfold.spatial-plan.v2', source: { kind: 'text', sha256: createHash('sha256').update('uma ventoinha de teste', 'utf8').digest('hex') },
  title: 'Review fan', units: 'unitless', presentationProfile: 'neutral',
  components: [part('base', 0), part('top', 0.9), part('side', 5)],
  relations: [
    { id: 'base-top', fromId: 'base', toId: 'top', kind: 'attached_to', origin: 'inferred', evidence: 'model declared' },
    { id: 'base-side', fromId: 'base', toId: 'side', kind: 'attached_to', origin: 'inferred', evidence: 'model declared' },
  ],
  constraints: [], unknowns: ['Physical scale is unknown.'],
};
const post = (port: number, path: string, body: unknown, hdrs: Record<string, string> = headers) => rawRequest(port, { path, headers: hdrs, body });
const create = async (port: number, extra: Record<string, unknown> = {}) => {
  const r = await post(port, '/api/spatial/v2/reviews', { plan, planRevision: 0, ...extra });
  expect(r.status, r.text).toBe(200);
  return r.json;
};
const decide = (port: number, reviewId: string, baseReviewRevision: number, subjectId: string, decision: string, extra: Record<string, unknown> = {}) =>
  post(port, '/api/spatial/v2/reviews/decide', { reviewId, baseReviewRevision, subjectId, decision, reviewerName: 'Revisora Teste', ...extra });

describe('V4 E1 human review (real HTTP, persistent store)', () => {
  it('derives relation and hypothesis subjects with statement classes, and records confirm/correct/reject/defer without overwriting history', async () => {
    await withGuardedServer({}, async (port) => {
      const { review, gate } = await create(port);
      const byId = new Map(review.subjects.map((s: { subjectId: string }) => [s.subjectId, s]));
      expect(byId.get('rel-base-top')).toMatchObject({ kind: 'relation', statementClass: 'model_inference', geometrySupport: 'supported' });
      expect(byId.get('rel-base-side')).toMatchObject({ geometrySupport: 'contradicted' });
      expect(review.reviewerAuthentication).toMatchObject({ authenticated: false });
      expect(review.source.byteVerified).toBe(false);
      expect(gate.blockers).toContain('CONTRADICTED_UNRESOLVED:rel-base-side');

      const confirmed = await decide(port, review.reviewId, 0, 'rel-base-top', 'confirm');
      expect(confirmed.status, confirmed.text).toBe(200);
      expect(confirmed.json.review.decisions[0]).toMatchObject({ decision: 'confirm', reviewRevision: 1, reviewer: { displayName: 'Revisora Teste', authenticated: false, attribution: 'client_asserted_unverified' } });
      expect(confirmed.json.gate.enforcedSubjectIds).toContain('rel-base-top');

      const corrected = await decide(port, review.reviewId, 1, 'rel-base-side', 'correct', { correctedValue: { kind: 'adjacent_to', fromId: 'base', toId: 'side' } });
      expect(corrected.status, corrected.text).toBe(200);
      expect(corrected.json.gate).toMatchObject({ allowContradicted: true, eligible: true });
      expect(corrected.json.gate.correctedValues['rel-base-side']).toEqual({ kind: 'adjacent_to', fromId: 'base', toId: 'side' });
      // The original statement and the first decision are untouched by the correction.
      expect(corrected.json.review.subjects.find((s: { subjectId: string }) => s.subjectId === 'rel-base-side').original.kind).toBe('attached_to');
      expect(corrected.json.review.decisions.map((d: { decision: string }) => d.decision)).toEqual(['confirm', 'correct']);

      const rejected = await decide(port, review.reviewId, 2, 'rel-base-top', 'reject');
      expect(rejected.json.gate.enforcedSubjectIds).not.toContain('rel-base-top');
      expect(rejected.json.gate.rejectedSubjectIds).toContain('rel-base-top');
      const deferred = await decide(port, review.reviewId, 3, 'rel-base-top', 'defer');
      expect(deferred.json.gate.deferredSubjectIds).toContain('rel-base-top');
      expect(deferred.json.review.decisions).toHaveLength(4);
    });
  });

  it('rejects concurrent stale decisions and decisions citing evidence from another review (another Space)', async () => {
    await withGuardedServer({}, async (port) => {
      const a = await create(port);
      const b = await create(port, { evidence: [{ evidenceId: 'other-space-mask', kind: 'mask', sha256: 'b'.repeat(64) }] });
      const [first, second] = await Promise.all([
        decide(port, a.review.reviewId, 0, 'rel-base-top', 'confirm'),
        decide(port, a.review.reviewId, 0, 'rel-base-top', 'reject'),
      ]);
      expect([first.status, second.status].sort()).toEqual([200, 409]);
      const stale = await decide(port, a.review.reviewId, 0, 'rel-base-top', 'confirm');
      expect(stale.status).toBe(409); expect(stale.json.error.code).toBe('SPATIAL_REVIEW_REVISION_CONFLICT');
      const substituted = await decide(port, a.review.reviewId, 1, 'rel-base-top', 'confirm', { evidenceIds: ['other-space-mask'] });
      expect(substituted.status).toBe(400); expect(substituted.json.error.code).toBe('SPATIAL_REVIEW_EVIDENCE_NOT_IN_REVIEW');
      expect(b.review.evidence.some((e: { evidenceId: string }) => e.evidenceId === 'other-space-mask')).toBe(true);
    });
  });

  it('verifies source and evidence digests from actual bytes, and rejects mismatches', async () => {
    await withGuardedServer({}, async (port) => {
      const verified = await create(port, { sourceBytes: { kind: 'text', text: 'uma ventoinha de teste' } });
      expect(verified.review.source.byteVerified).toBe(true);
      const mismatch = await post(port, '/api/spatial/v2/reviews', { plan, sourceBytes: { kind: 'text', text: 'outra fonte qualquer' } });
      expect(mismatch.status).toBe(422); expect(mismatch.json.error.code).toBe('SPATIAL_REVIEW_SOURCE_HASH_MISMATCH');
      const content = Buffer.from('mask-bytes').toString('base64');
      const withEvidence = await create(port, { evidence: [{ evidenceId: 'mask-1', kind: 'mask', contentBase64: content, sha256: createHash('sha256').update('mask-bytes').digest('hex') }] });
      expect(withEvidence.review.evidence.find((e: { evidenceId: string }) => e.evidenceId === 'mask-1')).toMatchObject({ byteVerified: true });
      // Stored records never contain the source/evidence bytes themselves.
      expect(JSON.stringify(withEvidence.review)).not.toContain(content);
      const badEvidence = await post(port, '/api/spatial/v2/reviews', { plan, evidence: [{ evidenceId: 'mask-2', kind: 'mask', contentBase64: content, sha256: 'c'.repeat(64) }] });
      expect(badEvidence.status).toBe(422); expect(badEvidence.json.error.code).toBe('SPATIAL_REVIEW_EVIDENCE_HASH_MISMATCH');
      const missing = await post(port, '/api/spatial/v2/reviews/get', { reviewId: 'nonexistent' });
      expect(missing.status).toBe(404);
    });
  });

  it('binds a review to the exact plan fingerprint: same source, different plan cannot reuse decisions (E1.1 tests 1-2)', async () => {
    await withGuardedServer({}, async (port) => {
      const a = await create(port);
      const otherPlan = { ...plan, components: plan.components.map((c, i) => (i === 2 ? { ...c, transform: { ...c.transform, position: [9, 0, 0] } } : c)) };
      const b = await post(port, '/api/spatial/v2/reviews', { plan: otherPlan, planRevision: 0 });
      expect(b.status, b.text).toBe(200);
      expect(b.json.review.planFingerprint).not.toBe(a.review.planFingerprint);
      expect(b.json.review.source.sha256).toBe(a.review.source.sha256); // same source, different plan
      // Lookup by source + exact fingerprint returns only the matching record.
      const listA = await post(port, '/api/spatial/v2/reviews/list', { sourceSha256: plan.source.sha256, planFingerprint: a.review.planFingerprint });
      expect(listA.json.reviews.map((r: { reviewId: string }) => r.reviewId)).toEqual([a.review.reviewId]);
      const listAll = await post(port, '/api/spatial/v2/reviews/list', { sourceSha256: plan.source.sha256 });
      expect(listAll.json.reviews).toHaveLength(2);
      // Eligibility pinned to the other plan's fingerprint is rejected, never silently reused.
      const foreign = await post(port, '/api/spatial/v2/reviews/eligibility', { reviewId: a.review.reviewId, planFingerprint: b.json.review.planFingerprint });
      expect(foreign.status).toBe(409); expect(foreign.json.error.code).toBe('SPATIAL_REVIEW_BINDING_MISMATCH');
      const bound = await post(port, '/api/spatial/v2/reviews/eligibility', { reviewId: a.review.reviewId, planFingerprint: a.review.planFingerprint, sourceSha256: plan.source.sha256 });
      expect(bound.status).toBe(200);
      const wrongSource = await post(port, '/api/spatial/v2/reviews/eligibility', { reviewId: a.review.reviewId, sourceSha256: 'e'.repeat(64) });
      expect(wrongSource.status).toBe(409); expect(wrongSource.json.error.code).toBe('SPATIAL_REVIEW_BINDING_MISMATCH');
    });
  });

  it('rejects review changes without an allowed local origin or local token (no invented authentication)', async () => {
    await withGuardedServer({}, async (port) => {
      const { review } = await create(port);
      const noOrigin = await rawRequest(port, { path: '/api/spatial/v2/reviews/decide', headers: { 'content-type': 'application/json' }, body: { reviewId: review.reviewId, baseReviewRevision: 0, subjectId: 'rel-base-top', decision: 'confirm', reviewerName: 'Atacante' } });
      expect(noOrigin.status).toBe(403);
      const badOrigin = await decide(port, review.reviewId, 0, 'rel-base-top', 'confirm', {});
      expect(badOrigin.status).toBe(200); // allowed browser origin still works
      const evil = await rawRequest(port, { path: '/api/spatial/v2/reviews/get', headers: { 'content-type': 'application/json', origin: 'http://evil.example' }, body: { reviewId: review.reviewId } });
      expect(evil.status).toBe(403);
      const after = await post(port, '/api/spatial/v2/reviews/get', { reviewId: review.reviewId });
      expect(after.json.review.decisions).toHaveLength(1); // only the allowed one
    });
  });

  it('persists across server restart with the same store file, and quarantines corrupted data', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'unfold-review-'));
    const file = join(directory, 'reviews.json');
    try {
      let reviewId = '';
      await withGuardedServer({ reviewStoreFile: file }, async (port) => {
        const { review } = await create(port);
        reviewId = review.reviewId;
        const done = await decide(port, reviewId, 0, 'rel-base-top', 'confirm');
        expect(done.status).toBe(200);
      });
      const onDisk = readFileSync(file, 'utf8');
      expect(onDisk).toContain(reviewId);
      await withGuardedServer({ reviewStoreFile: file }, async (port) => {
        const reopened = await post(port, '/api/spatial/v2/reviews/get', { reviewId });
        expect(reopened.status, reopened.text).toBe(200);
        expect(reopened.json.review.decisions).toHaveLength(1);
        const listed = await post(port, '/api/spatial/v2/reviews/list', { sourceSha256: plan.source.sha256 });
        expect(listed.json.reviews[0]).toMatchObject({ reviewId, decisions: 1 });
      });
      writeFileSync(file, '{corrupted json', 'utf8');
      await withGuardedServer({ reviewStoreFile: file }, async (port) => {
        const gone = await post(port, '/api/spatial/v2/reviews/get', { reviewId });
        expect(gone.status).toBe(404); // quarantined, server healthy, nothing partial trusted
        const fresh = await create(port);
        expect(fresh.review.reviewId).toBeTruthy();
      });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
