import { describe, expect, it } from 'vitest';
import { ANATOMY_OBSERVATION_SCHEMA, ANATOMY_REVIEW_SCHEMA, ANATOMY_COMPONENTS, bindAnatomySource, validateAnatomyObservation, validateAnatomyReview, validateBoundAnatomyObservation, type AnatomyObservationV1, type ReviewDecision } from '../src/anatomy/contracts';
import { AnatomyDomainAdapter, buildAnatomySceneProposal } from '../src/anatomy/adapter';
import { activePhaseAt } from '../src/anatomy/heart-viewer';

const evidence = [{ id: 'label-right-atrium', kind: 'label_text' as const, detail: 'Printed label identifies the right atrium.', locator: 'left-middle label' }];
function observation(subjectDisposition: AnatomyObservationV1['subjectDisposition'] = 'heart_illustration'): AnatomyObservationV1 {
  return bindAnatomySource(validateAnatomyObservation({
    schema: ANATOMY_OBSERVATION_SCHEMA, subjectDisposition, subjectEvidence: evidence,
    structures: [
      { id: 'right-atrium', label: 'Right atrium', status: 'observed', confidence: 0.92, evidence },
      { id: 'ventricular-wall', label: 'Ventricular wall', status: 'hypothesis', confidence: 0.63, evidence },
      { id: 'left-ventricle', label: 'Unclear chamber', status: 'unknown', confidence: 0.2, evidence: [] },
    ],
    relations: [{ id: 'rel-atrium-wall', relation: 'connects_to', from: 'right-atrium', to: 'ventricular-wall', status: 'hypothesis', confidence: 0.48, evidence }],
    hypotheses: [{ id: 'hyp-label-uncertain', statement: 'One printed label may point at the ventricular wall.', confidence: 0.36, evidence }],
    uncertainties: ['No physical scale is visible.', 'The illustration does not show all structures.'],
  }), 'https://commons.wikimedia.org/wiki/File:Diagram_of_the_human_heart.svg', 'a'.repeat(64));
}
function completeReview(source: AnatomyObservationV1, decisions?: Partial<Record<string, ReviewDecision['decision']>>): unknown {
  const targets = [...source.structures.map((x) => x.id), ...source.relations.map((x) => x.id), ...source.hypotheses.map((x) => x.id)];
  return { schema: ANATOMY_REVIEW_SCHEMA, reviewId: 'local-test', observationId: source.observationId, sourceSha256: source.source.sha256, actor: { kind: 'client_unverified', identityVerified: false }, decisions: targets.map((targetId) => ({ targetId, decision: decisions?.[targetId] ?? 'accept', correctedComponentId: null, note: null })) };
}

describe('anatomy heart domain contract and adapter', () => {
  it('keeps source observations separate, exposes no measured dimensions, and maps only reviewed components', () => {
    const source = observation(); const before = structuredClone(source); const review = validateAnatomyReview(completeReview(source, { 'ventricular-wall': 'reject', 'left-ventricle': 'accept' }), source);
    const proposal = buildAnatomySceneProposal(source, review);
    expect(source).toEqual(before);
    expect(source.dimensions).toEqual([]);
    expect(proposal.components.map((x) => x.componentId)).toEqual(['right-atrium']);
    expect(proposal.model.sha256).toBe('b80a727d022a4ab07ccfcf15caccc228eaccb6d69ec0e72923324946ac35a946');
    expect(proposal.motion).toMatchObject({ kind: 'illustrative', physiologyValidated: false, durationS: 4 });
    expect(proposal.motion.phases).toHaveLength(4);
  });

  it('requires complete review bound to the exact observation and image', () => {
    const source = observation(); const review = completeReview(source);
    expect(() => validateAnatomyReview({ ...(review as object), decisions: [] }, source)).toThrow('ANATOMY_REVIEW_INCOMPLETE');
    expect(() => validateAnatomyReview({ ...(review as object), sourceSha256: 'b'.repeat(64) }, source)).toThrow('ANATOMY_REVIEW_INVALID');
    expect(() => validateAnatomyReview({ ...(review as object), reviewId: '' }, source)).toThrow('ANATOMY_REVIEW_INVALID');
    expect(() => validateAnatomyReview({ ...(review as object), reviewId: 12 }, source)).toThrow('ANATOMY_REVIEW_INVALID');
    expect(() => validateAnatomyReview({ ...(review as object), actor: { kind: 'client_unverified', identityVerified: true } }, source)).toThrow('ANATOMY_REVIEW_INVALID');
  });

  it('validates the API-bound observation and refuses duplicate entity-to-mesh mappings', () => {
    const source = observation();
    const input = { ...source };
    expect(validateBoundAnatomyObservation(input)).toEqual(source);
    expect(() => new AnatomyDomainAdapter().adapt(source, completeReview(source, { 'ventricular-wall': 'correct' }))).toThrow('ANATOMY_REVIEW_INVALID');
    const duplicate = completeReview(source, { 'ventricular-wall': 'correct' }) as { decisions: Array<Record<string, unknown>> };
    duplicate.decisions.find((d) => d.targetId === 'ventricular-wall')!.correctedComponentId = 'right-atrium';
    expect(() => buildAnatomySceneProposal(source, duplicate)).toThrow('ANATOMY_REVIEW_DUPLICATE_MAPPING');
    expect(() => validateBoundAnatomyObservation({ ...source, dimensions: [{ value: 1, unit: 'm' }] })).toThrow('ANATOMY_SOURCE_INVALID');
  });

  it('rejects unsupported families, extra contract fields, unsupported structures, and broken relations', () => {
    const source = observation();
    expect(() => buildAnatomySceneProposal(observation('incompatible'), completeReview(source))).toThrow('ANATOMY_FAMILY_BLOCKED');
    expect(() => validateAnatomyObservation({ schema: ANATOMY_OBSERVATION_SCHEMA, subjectDisposition: 'heart_illustration', subjectEvidence: evidence, structures: [], relations: [], hypotheses: [], uncertainties: ['unknown'], dimensions: [] })).toThrow('ANATOMY_SCHEMA_INVALID');
    expect(() => validateAnatomyObservation({ schema: ANATOMY_OBSERVATION_SCHEMA, subjectDisposition: 'heart_illustration', subjectEvidence: evidence, structures: [{ id: 'lung', label: 'Lung', status: 'observed', confidence: 1, evidence }], relations: [], hypotheses: [], uncertainties: ['unknown'] })).toThrow('ANATOMY_SCHEMA_INVALID');
    expect(ANATOMY_COMPONENTS).toHaveLength(11);
  });

  it('keeps phase selection illustrative and clamps the timeline', () => {
    const scene = buildAnatomySceneProposal(observation(), completeReview(observation()));
    expect(activePhaseAt(scene, -20).id).toBe('fill'); expect(activePhaseAt(scene, 2.5).id).toBe('ventricles'); expect(activePhaseAt(scene, 90).id).toBe('rest');
  });
});
