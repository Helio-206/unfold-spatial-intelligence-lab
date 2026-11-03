import { describe, expect, it } from 'vitest';
import { assemblyDigest, closeEngineeringSession, commandMove, createEngineeringSession, sampleEngineeringMotion } from '../../src/living/engineering';
import { EXCAVATOR_ASSEMBLY_V1 } from '../../src/living/contracts/fixtures/excavator.assembly.v1';
import { adoptReviewed, createReconstructionClient, ReconstructionSession } from '../../src/living/unified-workspace';
import { PNG_1X1, json, proposalBody, reviewedBody, SESSION_ID } from './helpers';
import { parseReviewed } from '../../src/living/unified-workspace/reconstruction-client';

async function candidate() {
  const parsed = parseReviewed(reviewedBody(), SESSION_ID); if (!parsed.ok) throw new Error('review');
  const session = new ReconstructionSession({ client: createReconstructionClient({ fetchImpl: (async () => json(200, proposalBody())) as unknown as typeof fetch }) });
  await session.propose({ sourceKind: 'image', imageDataUrl: PNG_1X1, mode: 'offline' });
  const s = session.state; if (s.phase !== 'awaiting_review') throw new Error(s.phase);
  const adopted = adoptReviewed({ phase: 'reviewed', proposal: s.proposal, result: parsed.value });
  if (!adopted.ok) throw new Error(adopted.reasons.join());
  return adopted.candidate;
}

describe('an adopted reconstruction against the Engineering Engine (read-only)', () => {
  it('is a different assembly from the reference fixture, with its own digest', async () => {
    const c = await candidate();
    expect(assemblyDigest(c.assembly)).not.toBe(assemblyDigest(EXCAVATOR_ASSEMBLY_V1));
  });

  it('produces a valid reference frame for the same 13 parts, computed by the engine and not by the adapter', async () => {
    const c = await candidate();
    const session = createEngineeringSession(c.assembly);
    try {
      const frame = sampleEngineeringMotion(session, 0);
      expect(frame.status).toBe('ok');
      expect(frame.assemblyId).toBe(c.assembly.id);
      expect(frame.assemblyDigest).toBe(assemblyDigest(c.assembly));
      expect(frame.parts.map((p) => p.partId).sort()).toEqual(c.assembly.parts.map((p) => p.id).sort());
    } finally { closeEngineeringSession(session); }
  });

  it('accepts a valid stroke and refuses an out-of-range one with a code, exactly as for the reference assembly', async () => {
    const c = await candidate();
    const session = createEngineeringSession(c.assembly);
    try {
      const valid = commandMove(session, { targets: { boom_cylinder: 0.65 } });
      expect(valid.ok).toBe(true);
      if (valid.ok) closeEngineeringSession(valid.session);
      const invalid = commandMove(session, { targets: { boom_cylinder: 5 } });
      expect(invalid.ok).toBe(false);
      if (!invalid.ok) expect(invalid.code).toBeTruthy();
    } finally { closeEngineeringSession(session); }
  });
});
