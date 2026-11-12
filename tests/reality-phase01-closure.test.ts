import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { CAPABILITIES, PHASE_01_CERTIFICATION } from '../src/living/reality/capabilities';
import { DEBT, evaluateDebt } from '../src/living/reality/debt';
import { acceptProposal, validateProposalSet, type ProposalSet } from '../src/living/reality/ai-proposals';
import { currentDebtMarkdown, loadMeasurement } from '../scripts/reality-debt-report';
import { validateRealityEvidence } from '../src/living/reality/evidence';
import { evidenceFromRenders, solid, ORBIT6 } from './helpers/reality-fixtures';

describe('Phase 01 closure: the state of certification is stated, checkable and not inflated', () => {
  it('the certification is NO-GO and says closing is not approving', () => { expect(PHASE_01_CERTIFICATION.verdict).toBe('NO-GO'); expect(PHASE_01_CERTIFICATION.meaning).toMatch(/Encerrar não é aprovar/); });
  it('every capability has evidence files that exist, and nothing is "demonstrated" without a test or E2E among them', () => {
    const ids = new Set<string>();
    for (const c of CAPABILITIES) { expect(ids.has(c.id)).toBe(false); ids.add(c.id); expect(c.evidence.length).toBeGreaterThan(0); for (const f of c.evidence) expect(existsSync(f), `${c.id}: ${f}`).toBe(true); expect(c.limits.length).toBeGreaterThan(0);
      if (c.status === 'demonstrated') expect(c.evidence.some((f) => /^tests\//.test(f)), c.id).toBe(true); }
  });
  it('the manifest never claims fidelity: no capability promises "fiel", and the geometry capabilities are conditional at best', () => {
    for (const c of CAPABILITIES) { const t = `${c.title} ${c.provides}`; for (const m of t.matchAll(/\bfiel\b/gi)) expect(t.slice(Math.max(0, m.index! - 24), m.index!), `${c.id} claims fidelity`).toMatch(/nunca|não/i); }
    expect(CAPABILITIES.find((c) => c.id === 'multiview-hull')!.status).toBe('conditional'); expect(CAPABILITIES.find((c) => c.id === 'part-structure-automatic')!.status).toBe('not_demonstrated');
    expect(CAPABILITIES.filter((c) => c.status === 'external_dependency').map((c) => c.id)).toEqual(expect.arrayContaining(['external-datasets', 'independent-human-evaluation']));
  });
  it('every debt item has a verifiable criterion; items without a measurement are blocked, never met; the register matches the measurement files', () => {
    const ev = evaluateDebt(loadMeasurement);
    for (const e of ev) { if (!e.item.source) { expect(e.status).toBe('blocked'); expect(e.item.blockedBy).toBeTruthy(); } else { expect(existsSync(e.item.source), e.item.id).toBe(true); expect(e.current, e.item.id).not.toBeNull(); } }
    expect(new Set(DEBT.map((d) => d.id)).size).toBe(DEBT.length);
  });
  it('TECHNICAL-DEBT.md is exactly what the register and the measurements generate (the document cannot drift from the numbers)', () => { expect(readFileSync('reports/reality-engine/TECHNICAL-DEBT.md', 'utf8')).toBe(currentDebtMarkdown()); });
});

describe('AI proposals (Phase 02 seam): never confirmation, never stale, accepted only as a person\'s edit', () => {
  const sha = 'a'.repeat(64), set = (over: Partial<ProposalSet> = {}): ProposalSet => ({ contract: 'unfold.reality-ai-proposals.v1', evidenceSha256: sha, model: 'm', proposals: [{ id: 'p1', kind: 'rename', seed: [0, 0, 0], name: 'perna', rationale: 'parece uma perna', confidence: 0.6 }], ...over });
  it('validates, refuses proposals about other evidence, and refuses malformed ones', () => {
    expect(validateProposalSet(set(), sha).proposals).toHaveLength(1); expect(() => validateProposalSet(set(), 'b'.repeat(64))).toThrow('AI_PROPOSALS_STALE');
    expect(() => validateProposalSet(set({ proposals: [{ id: 'p1', kind: 'rename', seed: [0, 0, 0], name: '', rationale: 'x' }] }), sha)).toThrow('AI_PROPOSAL_INVALID'); expect(() => validateProposalSet({ contract: 'x' }, sha)).toThrow('AI_PROPOSALS_CONTRACT');
    expect(() => validateProposalSet(set({ proposals: [{ id: 'p1', kind: 'rename', seed: [0, 0, 0], name: 'a', rationale: 'x', confidence: 3 }] }), sha)).toThrow('AI_PROPOSAL_INVALID');
  });
  it('accepting turns the proposal into a PERSON edit that the evidence contract accepts; an AI-authored edit is refused by the contract', () => {
    const edit = acceptProposal(set().proposals[0]!, 'muse-spark', 123); expect(edit.by).toBe('person'); expect(edit.origin).toBe('ai_proposal'); expect(edit.proposal).toMatchObject({ kind: 'ai', model: 'muse-spark', proposalId: 'p1', rationale: 'parece uma perna' }); expect(edit.acceptedAt).toBe(123); const ev = evidenceFromRenders(solid(), ORBIT6);
    expect(validateRealityEvidence({ ...ev, partEdits: [edit] }).partEdits).toHaveLength(1); expect(() => validateRealityEvidence({ ...ev, partEdits: [{ ...edit, by: 'ai' }] } as never)).toThrow(); expect(() => validateRealityEvidence({ ...ev, partEdits: [{ ...edit, proposal: undefined }] } as never)).toThrow(); expect(() => validateRealityEvidence({ ...ev, partEdits: [{ ...edit, origin: 'person' }] } as never)).toThrow(); // an AI origin cannot be dropped or disguised
  });
});
