import { describe, expect, it } from 'vitest';
import { buildSubmission, emptyDraft, requiredReviewItems, reviewBlockers } from '../../src/living/unified-workspace';
import { completeDraft, observation } from './helpers';

describe('review model', () => {
  const obs = observation();

  it('lists one decision per hypothesis, hypothesis-status entity/relation and request', () => {
    const keys = requiredReviewItems(obs).map((i) => i.key);
    expect(keys.length).toBeGreaterThan(0);
    for (const h of obs.hypotheses) expect(keys).toContain(`hypothesis:${h.id}`);
    for (const r of obs.requests) expect(keys).toContain(`request:${r.id}`);
    expect(keys.some((k) => k.startsWith('entity:'))).toBe(obs.entities.some((e) => e.status === 'hypothesis'));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('an empty draft is blocked on every human confirmation and on each undecided item', () => {
    const reasons = reviewBlockers(obs, emptyDraft());
    expect(reasons).toEqual(expect.arrayContaining(['identificação do revisor obrigatória', 'a presença de uma caçamba requer confirmação humana', 'origem humana da largura obrigatória']));
    expect(reasons.filter((r) => r.startsWith('item sem decisão:')).length).toBe(requiredReviewItems(obs).length);
  });

  it('a complete draft has no blockers and builds a submission with exactly the required decisions', () => {
    const draft = completeDraft(obs); draft.decisions['entity:not-in-observation'] = 'confirm';
    expect(reviewBlockers(obs, draft)).toEqual([]);
    const built = buildSubmission(obs, draft);
    if (!built.ok) throw new Error(built.reasons.join());
    expect(Object.keys(built.submission.decisions).sort()).toEqual(requiredReviewItems(obs).map((i) => i.key).sort());
    expect(built.submission).toMatchObject({ family: 'tracked_excavator', bucketConfirmed: true, bucketWidthM: 1.4 });
  });

  it.each([[0.05], [10.5], [NaN], [null]])('refuses bucket width %s', (width) => {
    expect(reviewBlockers(obs, completeDraft(obs, { bucketWidthM: width as number | null }))).toContain('largura da caçamba deve estar entre 0,1 e 10 m');
  });

  it('never accepts a confirmed request, because there is no adapter for it', () => {
    const request = obs.requests[0];
    if (!request) return;
    const draft = completeDraft(obs); draft.decisions[`request:${request.id}`] = 'confirm';
    expect(reviewBlockers(obs, draft)).toContain(`pedido confirmado sem adaptação suportada: ${request.id}`);
  });

  it('blocks wheeled machines and unconfirmed machine type', () => {
    const wheeled = structuredClone(obs); wheeled.entities[0]!.label = 'Escavadora de rodas';
    expect(reviewBlockers(wheeled, completeDraft(wheeled)).join()).toMatch(/máquina de rodas/);
    const unknown = structuredClone(obs); unknown.machineType = 'unknown';
    expect(reviewBlockers(unknown, completeDraft(unknown)).join()).toMatch(/não confirmado como escavadora/);
  });

  it('does not accept a reviewer id or basis that is only whitespace', () => {
    expect(reviewBlockers(obs, completeDraft(obs, { reviewerId: '   ', widthBasis: '  ' }))).toEqual(expect.arrayContaining(['identificação do revisor obrigatória', 'origem humana da largura obrigatória']));
  });
});
