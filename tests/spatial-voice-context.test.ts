import { describe, expect, it } from 'vitest';
import { createSpatialExplanationContext } from '../src/living/spatial-voice/context';
import { explainSpatialContext } from '../src/living/spatial-voice/explanation';
import { lungsLikeReply, microscopeLikeReply } from './fixtures/spatial-v2/handauthored';

describe('spatial explanation context', () => {
  it.each([[microscopeLikeReply, 'eyepiece'], [microscopeLikeReply, 'objectives'], [lungsLikeReply, 'trachea'], [lungsLikeReply, 'branches-left']] as const)('binds a local explanation to the selected fixture entity', (fixture, id) => {
    const plan = fixture().plan;
    const result = explainSpatialContext(createSpatialExplanationContext(plan, id, 'revision-1'));
    expect(result.componentId).toBe(id);
    expect(result.evidenceIds).toEqual([id]);
    expect(result.text).toContain(plan.components.find((component) => component.id === id)!.label);
    expect(result.text).toContain('não está estabelecida');
    expect(result.source).toBe('local-plan');
  });
  it('supports a general explanation and snapshots the plan', () => {
    const plan = microscopeLikeReply().plan;
    const context = createSpatialExplanationContext(plan, null, 'revision-1');
    plan.title = 'changed';
    expect(explainSpatialContext(context).text).not.toContain('changed');
    expect(explainSpatialContext(context).evidenceIds).toEqual([]);
  });
  it('rejects an unknown selection and missing revision', () => {
    const plan = lungsLikeReply().plan;
    expect(() => createSpatialExplanationContext(plan, 'missing', 'r1')).toThrow('EXPLANATION_COMPONENT_NOT_FOUND');
    expect(() => createSpatialExplanationContext(plan, null, '')).toThrow('EXPLANATION_REVISION_REQUIRED');
  });
});
