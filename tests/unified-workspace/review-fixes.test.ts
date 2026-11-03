import { describe, expect, it, vi } from 'vitest';
import { createReconstructionClient, ReconstructionSession, ReviewGateway, SESSION_TTL_MS, type WorkspaceCandidate } from '../../src/living/unified-workspace';
import { candidateNotices } from '../../src/living/unified-workspace/lab-host';
import { PNG_1X1, json, proposalBody } from './helpers';

const candidate = { bucketWidthM: { before: 1.1, after: 1.4 } } as unknown as WorkspaceCandidate;
const gates = { review: '14 de 14 decididas', engine: 'validada pelo motor · solver@0.1.0' };

describe('the lab notice about the bucket width (the Foundry now draws it)', () => {
  const [notice] = candidateNotices(candidate, gates);
  const text = `${notice!.text} ${notice!.detail}`;

  it('no longer says the 3D mesh does not show the width', () => {
    expect(text).not.toMatch(/ainda não mostra|forma que vê é de demonstração|não a mostra/i);
  });
  it('says the mesh follows the width the person gave, with both values', () => {
    expect(notice!.detail).toMatch(/malha 3D[^.]*largura que indicou/i);
    expect(notice!.detail).toContain('1,40 m'); expect(notice!.detail).toContain('1,10 m');
  });
  it('keeps what is still true: not measured or verified, the rest of the geometry is synthetic', () => {
    expect(text).toMatch(/não (foi )?medida nem verificada|não (foram )?verificad/i);
    expect(text).toMatch(/Meta/);
    expect(text).toMatch(/sintétic/i);
    expect(notice!.detail).toMatch(/não certifica segurança/);
  });
});

describe('an expired reconstruction session is visible to the interface', () => {
  async function started(now: () => number) {
    const fetchImpl = vi.fn(async () => json(200, { ...proposalBody(), mode: 'live', meta: { model: 'm', requestId: 'r' } }));
    const session = new ReconstructionSession({ client: createReconstructionClient({ fetchImpl: fetchImpl as unknown as typeof fetch }), now });
    await session.propose({ sourceKind: 'image', imageDataUrl: PNG_1X1, mode: 'live' });
    return { session, gateway: new ReviewGateway(session) };
  }

  it('reports when it will expire, and then that it has', async () => {
    let clock = 5_000;
    const { gateway } = await started(() => clock);
    expect(gateway.expired()).toBe(false);
    expect(gateway.expiresAt()).toBe(5_000 + SESSION_TTL_MS);
    clock += SESSION_TTL_MS;
    expect(gateway.expired()).toBe(true);
  });

  it('has nothing to expire when there is no session, and a reset is not an expiry', async () => {
    const { gateway, session } = await started(() => 0);
    session.reset();
    expect(gateway.expired()).toBe(false); expect(gateway.expiresAt()).toBeNull();
  });

  it('a submit after the local expiry is reported as expired without calling the server', async () => {
    let clock = 0;
    const { gateway } = await started(() => clock);
    clock += SESSION_TTL_MS + 1;
    expect(await gateway.submit()).toEqual({ kind: 'expired' });
  });
});
