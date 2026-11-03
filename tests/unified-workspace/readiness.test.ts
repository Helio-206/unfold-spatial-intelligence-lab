import { describe, expect, it } from 'vitest';
import { initialReview, readiness, reduceReview } from '../../src/living/experience/review';
import { insufficientObservation } from '../../src/living/experience/reconstruction-fixture';
import { observation } from './helpers';

/**
 * A live reconstruction usually returns hypotheses, not observed facts. "Insufficient data" must mean that even confirming
 * everything would not give a machine; while hypotheses are still undecided the honest state is "review pending".
 */
describe('gate 1 with a reconstruction made only of hypotheses', () => {
  const obs = observation();

  it('is review_pending, not insufficient, before the person has decided anything', () => {
    expect(obs.entities.every((e) => e.status === 'hypothesis')).toBe(true);
    expect(readiness(initialReview(obs)).status).toBe('review_pending');
  });

  it('becomes insufficient only when a rejection removes a structure the machine needs, and names it', () => {
    let ui = initialReview(obs);
    ui = reduceReview(ui, { type: 'decide', id: 'boom', decision: 'rejected' });
    expect(readiness(ui)).toMatchObject({ status: 'insufficient', missing: ['lança'] });
  });

  it('is ready when every hypothesis is decided and the structure survives', () => {
    let ui = initialReview(obs);
    for (const item of ui.items) ui = reduceReview(ui, { type: 'decide', id: item.id, decision: 'confirmed' });
    expect(readiness(ui)).toEqual({ status: 'ready_for_engine' });
  });

  it('still reports the prototype\'s insufficient scenario as insufficient', () => {
    expect(readiness(initialReview(insufficientObservation())).status).toBe('insufficient');
  });
});
