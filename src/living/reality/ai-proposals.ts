import type { StoredPartEdit } from './evidence';

/**
 * Contract for what an AI (Living Intelligence, Phase 02) may PROPOSE about a reconstruction. It is deliberately a different type from a person's correction:
 * an AI proposal never enters the evidence on its own and is never rendered as confirmed. The only way it becomes part of the structure is `acceptProposal`, which
 * turns it into a StoredPartEdit made `by: 'person'` — the human confirmation category — with the proposal kept as the stated reason. Nothing here calls a model.
 */
export type AiPartProposal =
  | { id: string; kind: 'rename'; seed: [number, number, number]; name: string; rationale: string; confidence?: number }
  | { id: string; kind: 'merge'; seeds: [[number, number, number], [number, number, number]]; rationale: string; confidence?: number }
  | { id: string; kind: 'split'; seed: [number, number, number]; axis: 'x' | 'y' | 'z'; at: number; rationale: string; confidence?: number };
export type ProposalSet = { contract: 'unfold.reality-ai-proposals.v1'; evidenceSha256: string; model: string; proposals: AiPartProposal[] };

const pt = (q: unknown): q is [number, number, number] => Array.isArray(q) && q.length === 3 && q.every(Number.isFinite);
export function validateProposalSet(value: unknown, evidenceSha256: string): ProposalSet {
  const v = value as Partial<ProposalSet> | null;
  if (!v || v.contract !== 'unfold.reality-ai-proposals.v1' || typeof v.model !== 'string') throw new Error('AI_PROPOSALS_CONTRACT');
  if (v.evidenceSha256 !== evidenceSha256) throw new Error('AI_PROPOSALS_STALE'); // proposals about other evidence are never applied
  if (!Array.isArray(v.proposals) || v.proposals.length > 32) throw new Error('AI_PROPOSALS_COUNT');
  const ids = new Set<string>();
  for (const p of v.proposals as Array<Record<string, unknown>>) {
    const ok = typeof p.id === 'string' && /^[a-z0-9-]{1,40}$/.test(p.id) && !ids.has(p.id) && typeof p.rationale === 'string' && p.rationale.trim().length > 0 && p.rationale.length <= 400 && (p.confidence === undefined || (typeof p.confidence === 'number' && p.confidence >= 0 && p.confidence <= 1)) &&
      ((p.kind === 'rename' && pt(p.seed) && typeof p.name === 'string' && p.name.trim().length > 0 && p.name.length <= 60) || (p.kind === 'merge' && Array.isArray(p.seeds) && p.seeds.length === 2 && p.seeds.every(pt)) || (p.kind === 'split' && pt(p.seed) && ['x', 'y', 'z'].includes(p.axis as string) && Number.isFinite(p.at)));
    if (!ok) throw new Error('AI_PROPOSAL_INVALID'); ids.add(p.id as string);
  }
  return v as ProposalSet;
}
/** The person accepts a proposal: it becomes THEIR edit. The AI's authorship is not carried into the evidence as confirmation. */
export function acceptProposal(p: AiPartProposal): StoredPartEdit {
  if (p.kind === 'rename') return { kind: 'rename', seed: p.seed, name: p.name, by: 'person' };
  if (p.kind === 'merge') return { kind: 'merge', seeds: p.seeds, by: 'person' };
  return { kind: 'split', seed: p.seed, axis: p.axis, at: p.at, by: 'person' };
}
