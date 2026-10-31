import { describe, expect, it } from 'vitest';
import { answerSpatialQuestion, createFixturePlan, UnfoldEngine, validatePlan } from '../src/model';

describe('UNFOLD geometric contract', () => {
  it.each(['A', 'B', 'C'] as const)('validates variable fixture %s', (variant) => {
    expect(validatePlan(createFixturePlan(variant))).toEqual([]);
  });

  it('rejects an opening with a missing wall', () => {
    const plan = createFixturePlan('A');
    plan.elements = plan.elements.map((element) => element.id === 'door-main' && element.kind === 'door' ? { ...element, wallId: 'missing' } : element);
    expect(validatePlan(plan).some((issue) => issue.code === 'opening.wall-ref')).toBe(true);
  });

  it('rejects unknown IDs before executing an operation', () => {
    const engine = new UnfoldEngine(createFixturePlan('A'));
    expect(() => engine.apply({ type: 'highlight', ids: ['not-in-plan'] })).toThrow('IDs inexistentes');
  });

  it('preserves semantic operations through explode and reassemble', () => {
    const engine = new UnfoldEngine(createFixturePlan('B'));
    engine.apply({ type: 'explode' });
    expect(engine.state().exploded).toBe(true);
    engine.apply({ type: 'reassemble' });
    expect(engine.state().exploded).toBe(false);
  });

  it('returns declarative spatial actions for a known room', () => {
    const result = answerSpatialQuestion(createFixturePlan('C'), 'Mostra a sala');
    expect(result.ids).toContain('room-living');
    expect(result.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'highlight' }),
      expect.objectContaining({ type: 'select' }),
    ]));
  });

  it('accepts the English spatial term used by the viewer', () => {
    expect(answerSpatialQuestion(createFixturePlan('A'), 'Show me the living room').ids).toContain('room-living');
  });
});
