import { describe, expect, it } from 'vitest';
import { applyReviewDraft, confirmHumanReview, normalizeMechanicalObservation, validateMechanicalGraph, type MechanicalGraphSource } from '../src/mechanical-graph';
import type { MechanicalObservation } from '../src/meta';

const source: MechanicalGraphSource = { caseId: 'case-a', imagePath: '/tmp/a.jpg', sourceUrl: 'https://example.test/a', title: 'Real mechanism' };
const observation: MechanicalObservation = {
  elements: [
    { id: 'bar-a', kind: 'bar', label: 'metal bar', observed: true, evidence: 'bar visible', confidence: 0.9 },
    { id: 'joint-a', kind: 'joint', label: 'pivot block', observed: true, evidence: 'block visible', confidence: 0.8 },
    { id: 'fixed-a', kind: 'fixed', label: 'fixed base', observed: true, evidence: 'base visible', confidence: 0.7 },
  ],
  connections: [{ from: 'bar-a', to: 'joint-a', relation: 'connected', observed: true, evidence: 'contact visible' }],
  dimensions: [],
  ambiguities: ['role unknown'],
  missingInformation: ['dimensions'],
};

describe('mechanical_graph.v1', () => {
  it('normalizes coarse Meta kinds without promoting them to observed ontology', () => {
    const graph = normalizeMechanicalObservation(observation, source);
    expect(graph.schema).toBe('mechanical_graph.v1');
    expect(graph.nodes.map((node) => [node.kind, node.provenance])).toEqual([
      ['unknown', 'ambiguous'],
      ['unknown', 'inferred'],
      ['unknown', 'inferred'],
    ]);
    expect(() => validateMechanicalGraph(graph)).not.toThrow();
  });

  it('keeps automatic proposals pending and requires explicit human confirmation', () => {
    const graph = normalizeMechanicalObservation(observation, source);
    const changes = [
      { action: 'correct_kind', nodeId: 'node-1-bar-a', kind: 'link', note: 'barra visível revista como link mecânico' },
      { action: 'approve', target: 'node', id: 'node-2-joint-a' },
      { action: 'correct_connection', connectionId: 'connection-1', from: 'node-1-bar-a', to: 'node-3-fixed-a', relation: 'hinged_to', note: 'ligação corrigida na revisão visual' },
      { action: 'mark_uncertain', target: 'node', id: 'node-3-fixed-a', note: 'suporte visível, fixação não demonstrada' },
    ] as const;
    const draft = applyReviewDraft(graph, [...changes]);
    expect(draft.review.status).toBe('pending');
    expect(draft.nodes[0]).toMatchObject({ kind: 'link', provenance: 'inferred', review: 'pending' });
    expect(draft.nodes[1]?.review).toBe('pending');
    expect(draft.nodes[2]).toMatchObject({ provenance: 'ambiguous', review: 'pending' });
    expect(() => confirmHumanReview(draft, { reviewer: { name: 'Reviewer' }, confirmedAt: '2026-10-30T12:00:00Z', confirmationText: 'WRONG' as 'CONFIRM_MECHANICAL_REVIEW', changes: [...changes] })).toThrow('explícita');
    const verified = confirmHumanReview(draft, { reviewer: { name: 'Reviewer' }, confirmedAt: '2026-10-30T12:00:00Z', confirmationText: 'CONFIRM_MECHANICAL_REVIEW', changes: [...changes] });
    expect(verified.review.status).toBe('verified');
    expect(verified.review.reviewer?.name).toBe('Reviewer');
    expect(verified.review.changes).toHaveLength(4);
    expect(verified.nodes[0]).toMatchObject({ kind: 'link', provenance: 'inferred', review: 'verified' });
    expect(verified.nodes[1]?.review).toBe('verified');
    expect(verified.nodes[2]).toMatchObject({ provenance: 'ambiguous', review: 'verified' });
    expect(verified.connections[0]).toMatchObject({ from: 'node-1-bar-a', to: 'node-3-fixed-a', provenance: 'inferred', review: 'verified' });
  });

  it('rejects duplicate IDs and invalid references', () => {
    const graph = normalizeMechanicalObservation(observation, source);
    const duplicate = structuredClone(graph);
    duplicate.nodes[1]!.id = duplicate.nodes[0]!.id;
    expect(() => validateMechanicalGraph(duplicate)).toThrow('duplicado');
    const broken = structuredClone(graph);
    broken.connections[0]!.to = 'missing-node';
    expect(() => validateMechanicalGraph(broken)).toThrow('Referência');
  });
});
