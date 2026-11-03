import { describe, expect, it } from 'vitest';
import { adoptReviewed, createReconstructionClient, describeFailure, ReconstructionSession, type ReconstructionFailure, type SessionState } from '../../src/living/unified-workspace';
import { PNG_1X1, SESSION_ID, json, proposalBody, reviewedBody } from './helpers';
import { parseReviewed } from '../../src/living/unified-workspace/reconstruction-client';

async function reviewedState(mutate?: (body: any) => void): Promise<SessionState> {
  const body: any = reviewedBody(); mutate?.(body);
  const parsed = parseReviewed(body, SESSION_ID);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.failure));
  const proposalResult = createReconstructionClient({ fetchImpl: (async () => json(200, proposalBody())) as unknown as typeof fetch });
  const session = new ReconstructionSession({ client: proposalResult });
  await session.propose({ sourceKind: 'image', imageDataUrl: PNG_1X1, mode: 'offline' });
  const s = session.state; if (s.phase !== 'awaiting_review') throw new Error(s.phase);
  return { phase: 'reviewed', proposal: s.proposal, result: parsed.value };
}

describe('workspace adapter', () => {
  it('adopts a reviewed reconstruction as an unverified, synthetic candidate that authorises no motion', async () => {
    const result = adoptReviewed(await reviewedState());
    if (!result.ok) throw new Error(result.reasons.join());
    expect(result.candidate.motionAuthorized).toBe(false);
    expect(result.candidate.bucketWidthM).toEqual({ before: 1.1, after: 1.4 });
    expect(result.candidate.notes.map((n) => n.id)).toEqual(['observation', 'review', 'width', 'geometry', 'validation']);
    expect(result.candidate.notes.find((n) => n.id === 'review')?.text).toMatch(/não são verificadas/);
    expect(result.candidate.notes.find((n) => n.id === 'validation')?.text).toMatch(/sem cálculo de engenharia/);
    const bucket = result.candidate.assembly.parts.find((p) => p.role === 'bucket')!;
    const box = bucket.shapes.find((s) => s.kind === 'box'); if (!box || box.kind !== 'box') throw new Error('box');
    expect(box.halfExtentsM[2] * 2).toBeCloseTo(1.4, 12);
  });

  it('hands out a copy, so later edits cannot reach the stored result', async () => {
    const state = await reviewedState();
    const result = adoptReviewed(state); if (!result.ok) throw new Error('adopt');
    result.candidate.assembly.title = 'tampered';
    if (state.phase !== 'reviewed') throw new Error('phase');
    expect(state.result.assembly.title).not.toBe('tampered');
  });

  it.each(['idle', 'proposing', 'awaiting_review'] as const)('refuses to adopt from %s', (phase) => {
    expect(adoptReviewed({ phase } as unknown as SessionState)).toMatchObject({ ok: false });
  });

  it('refuses a summary that disagrees with the canonical bucket shape', async () => {
    const state = await reviewedState(); if (state.phase !== 'reviewed') throw new Error('phase');
    state.result.geometry.bucketWidthAfterM = 2.0;
    const result = adoptReviewed(state);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons.join()).toMatch(/largura reportada|largura aplicada/);
  });

  it('refuses an assembly whose provenance was promoted to verified', async () => {
    const state = await reviewedState(); if (state.phase !== 'reviewed') throw new Error('phase');
    state.result.assembly.provenance.validation = 'verified';
    const result = adoptReviewed(state);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons.join()).toMatch(/promovida sem evidência/);
  });

  it('refuses an assembly that no longer validates', async () => {
    const state = await reviewedState(); if (state.phase !== 'reviewed') throw new Error('phase');
    state.result.assembly.parts.pop();
    expect(adoptReviewed(state).ok).toBe(false);
  });

  it('describes every failure kind in Portuguese without leaking raw codes as the only message', () => {
    const kinds: ReconstructionFailure[] = [
      { kind: 'invalid_input', reasons: ['a'] }, { kind: 'blocked', reasons: ['b'] }, { kind: 'session_expired' }, { kind: 'rate_limited' }, { kind: 'budget_exhausted' }, { kind: 'capacity' },
      { kind: 'guard_rejected', status: 403, code: 'INVALID_ORIGIN' }, { kind: 'upstream', status: 502, code: 'X' }, { kind: 'network', message: 'offline' }, { kind: 'aborted' }, { kind: 'bad_response', issues: [] },
    ];
    for (const failure of kinds) expect(describeFailure(failure).length).toBeGreaterThan(10);
    expect(describeFailure({ kind: 'blocked', reasons: ['x', 'y'] })).toContain('x; y');
  });
});
