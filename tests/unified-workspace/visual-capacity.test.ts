import { describe, expect, it } from 'vitest';
import { EXCAVATOR_ASSEMBLY_V1 } from '../../src/living/contracts/fixtures/excavator.assembly.v1';
import type { Assembly } from '../../src/living/contracts';
import { adoptReviewed, BUCKET_WIDTH_VISUAL_RANGE_M, reviewBlockers, visualCapacityIssues, type SessionState } from '../../src/living/unified-workspace';
import { createExcavatorProvider } from '../../src/living/visual-foundry/provider';
import { completeDraft, observation, reviewedBody, SESSION_ID } from './helpers';
import { parseReviewed } from '../../src/living/unified-workspace/reconstruction-client';

const withWidth = (total: number): Assembly => { const a = structuredClone(EXCAVATOR_ASSEMBLY_V1) as Assembly; const box = a.parts.find((p) => p.id === 'bucket')!.shapes.find((s) => s.id === 'bucket-box')!; if (box.kind !== 'box') throw new Error('box'); box.halfExtentsM[2] = total / 2; return a; };

/**
 * The reconstruction API accepts a bucket width of 0.10 to 10 m; the Foundry can draw 0.60 to 2.40 m and throws outside it.
 * The lab must refuse what it cannot draw, before the engine or the workspace ever see it, and never adjust the number.
 */
describe('what the visualiser can draw is a shared limit, not a surprise at mount time', () => {
  it('uses the Foundry\'s own range: 0.60 to 2.40 m in total', () => {
    expect(BUCKET_WIDTH_VISUAL_RANGE_M).toEqual({ min: 0.6, max: 2.4 });
  });

  it.each([0.6, 1.1, 1.4, 2.4])('accepts %s m, and the Foundry really builds it', (w) => {
    expect(visualCapacityIssues(withWidth(w))).toEqual([]);
    expect(() => createExcavatorProvider(withWidth(w))).not.toThrow();
  });

  it.each([0.1, 0.59, 2.41, 5, 10])('refuses %s m with a message that names the limits and the value', (w) => {
    const issues = visualCapacityIssues(withWidth(w));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/0,60 a 2,40 m/);
    expect(issues[0]).toContain(String(w).replace('.', ','));
    expect(() => createExcavatorProvider(withWidth(w))).toThrow(/FOUNDRY_BUCKET_WIDTH_OUT_OF_RANGE/); // what would have happened at mount
  });

  it('reports a missing or non-box bucket shape instead of throwing', () => {
    const noBox = structuredClone(EXCAVATOR_ASSEMBLY_V1) as Assembly; noBox.parts.find((p) => p.id === 'bucket')!.shapes = [];
    expect(visualCapacityIssues(noBox)[0]).toMatch(/caçamba/);
  });

  it('the review cannot be sent with a width the visualiser cannot draw, and says why', () => {
    const obs = observation();
    for (const w of [0.5, 2.5]) expect(reviewBlockers(obs, completeDraft(obs, { bucketWidthM: w })).join()).toMatch(/0,60 a 2,40 m/);
    for (const w of [0.6, 1.1, 2.4]) expect(reviewBlockers(obs, completeDraft(obs, { bucketWidthM: w }))).toEqual([]);
  });

  it('adoption refuses an assembly the visualiser cannot build, whatever the server said', () => {
    const parsed = parseReviewed(reviewedBody(), SESSION_ID); if (!parsed.ok) throw new Error('review');
    const result = parsed.value; const box = result.assembly.parts.find((p) => p.role === 'bucket')!.shapes.find((s) => s.kind === 'box')!; if (box.kind !== 'box') throw new Error('box');
    box.halfExtentsM[2] = 1.5; result.geometry.bucketWidthAfterM = 3; result.review.bucketWidthM = 3;
    const state = { phase: 'reviewed', result } as unknown as SessionState;
    const adopted = adoptReviewed(state);
    expect(adopted.ok).toBe(false);
    if (!adopted.ok) expect(adopted.reasons.join()).toMatch(/0,60 a 2,40 m/);
  });
});
