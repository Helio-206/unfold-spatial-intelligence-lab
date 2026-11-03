import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateExcavatorObservation } from '../../src/living/reconstruction/contracts';
import { EXCAVATOR_ASSEMBLY_V1 } from '../../src/living/contracts/fixtures/excavator.assembly.v1';
import { ENTITY_PARTS, reconstructionFixture } from '../../src/living/experience/reconstruction-fixture';
import { initialReview, labCategory, partCategories, reduceReview, summarize } from '../../src/living/experience/review';
import { TIMELINE, TRANSITION_TOTAL, transitionAt } from '../../src/living/experience/transition';
import { sheetProjectionFor, toSheet } from '../../src/living/experience/drawing';
import { DURATION } from '../../src/motion/tokens';
import { moduleSpecifiers } from '../helpers/module-specifiers';
import { Vector3 } from 'three';

describe('reconstruction fixture', () => {
  it('is a valid unfold.excavator_observation.v1 with all three statuses', () => {
    const obs = reconstructionFixture();
    expect(validateExcavatorObservation(obs).entities).toHaveLength(obs.entities.length);
    expect(new Set(obs.entities.map((e) => e.status))).toEqual(new Set(['observed', 'hypothesis', 'unknown']));
  });
  it('maps every entity to canonical part ids that exist in the assembly', () => {
    const parts = new Set(EXCAVATOR_ASSEMBLY_V1.parts.map((p) => p.id));
    for (const e of reconstructionFixture().entities) { expect(ENTITY_PARTS[e.id]?.length).toBeGreaterThan(0); for (const p of ENTITY_PARTS[e.id]!) expect(parts.has(p)).toBe(true); }
  });
});

describe('human review', () => {
  const obs = reconstructionFixture();
  it('starts with nothing confirmed and the lab closed while hypotheses are undecided', () => {
    const s = summarize(initialReview(obs));
    expect(s.confirmed).toBe(0);
    expect(s.canEnterLab).toBe(false);
    expect(s.pendingHypotheses).toBe(3);
  });
  it('never promotes: observed stays observed until a person confirms it', () => {
    const r = initialReview(obs);
    expect(labCategory(r.items.find((i) => i.id === 'e_boom')!)).toBe('observed');
    const after = reduceReview(r, { type: 'decide', id: 'e_boom', decision: 'confirmed' });
    expect(labCategory(after.items.find((i) => i.id === 'e_boom')!)).toBe('confirmed');
    expect(after.items.find((i) => i.id === 'e_boom')!.status).toBe('observed'); // the reconstruction's own status is kept
  });
  it('cannot confirm an unknown; it can only stay unknown or be rejected', () => {
    const r = reduceReview(initialReview(obs), { type: 'decide', id: 'e_linkage', decision: 'confirmed' });
    expect(labCategory(r.items.find((i) => i.id === 'e_linkage')!)).toBe('unknown');
  });
  it('opens the lab once every hypothesis is decided; unknowns stay unknown', () => {
    let r = initialReview(obs);
    for (const id of ['e_boom_cyl', 'e_stick_cyl']) r = reduceReview(r, { type: 'decide', id, decision: 'confirmed' });
    expect(summarize(r).canEnterLab).toBe(false);
    r = reduceReview(r, { type: 'decide', id: 'e_bucket_cyl', decision: 'rejected' });
    const s = summarize(r);
    expect(s.canEnterLab).toBe(true);
    expect(s.unknown).toBe(2);
    const cats = partCategories(r, ENTITY_PARTS);
    expect(cats.get('bucket_cyl_barrel')).toBe('rejected');
    expect(cats.get('idler_link')).toBe('unknown');
    expect(cats.get('upper_body')).toBe('observed'); // the counterweight's unknown mass does not hide the house
    expect([...cats.values()]).not.toContain('hypothesis');
  });
  it('undo returns a decision to pending', () => {
    let r = reduceReview(initialReview(obs), { type: 'decide', id: 'e_boom_cyl', decision: 'confirmed' });
    r = reduceReview(r, { type: 'decide', id: 'e_boom_cyl', decision: 'pending' });
    expect(labCategory(r.items.find((i) => i.id === 'e_boom_cyl')!)).toBe('hypothesis');
  });
});

describe('transition timeline', () => {
  it('is built from motion tokens and ends in the lab state', () => {
    expect(TIMELINE.fold).toBe(DURATION.slow * 2);
    expect(TRANSITION_TOTAL).toBeCloseTo(DURATION.base * 2 + DURATION.slow * 3, 9);
    const end = transitionAt(TRANSITION_TOTAL);
    expect(end).toMatchObject({ done: true, reveal: 1, camera: 1, annotations: 1 });
    expect(end.sheetAngle).toBeCloseTo(Math.PI / 2, 9);
  });
  it('starts registered on the drawing: upright sheet, nothing revealed, elevation camera', () => {
    expect(transitionAt(0)).toMatchObject({ sheetAngle: 0, reveal: 0, camera: 0, annotations: 0, done: false });
  });
  it('is monotonic (no overshoot, no back-and-forth)', () => {
    let prev = transitionAt(0);
    for (let t = 0.05; t <= TRANSITION_TOTAL; t += 0.05) {
      const f = transitionAt(t);
      expect(f.sheetAngle).toBeGreaterThanOrEqual(prev.sheetAngle - 1e-12);
      expect(f.reveal).toBeGreaterThanOrEqual(prev.reveal - 1e-12);
      expect(f.camera).toBeGreaterThanOrEqual(prev.camera - 1e-12);
      for (const v of [f.reveal, f.camera, f.annotations, f.sheetOpacity]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
      prev = f;
    }
  });
  it('reduced motion jumps to the final state', () => {
    expect(transitionAt(0, true)).toEqual(transitionAt(TRANSITION_TOTAL));
  });
});

describe('drawing projection', () => {
  it('puts the ground line on the sheet bottom edge and machine front on the left', () => {
    const p = sheetProjectionFor(new Vector3(-2, 0, -1.4), new Vector3(8, 5, 1.4));
    expect(toSheet(p, 3, 0)[1]).toBeCloseTo(p.px[1], 6);
    expect(toSheet(p, 8, 2)[0]).toBeLessThan(toSheet(p, -2, 2)[0]);
  });
});

describe('module boundaries and design system', () => {
  const dir = resolve('src/living/experience');
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => join(dir, f));
  it('does not import the engineering engine, server code or the workspace', () => {
    for (const f of files) for (const s of moduleSpecifiers(f, readFileSync(f, 'utf8'))) expect(s, f).not.toMatch(/engineering|server|workspace-design|^node:/);
  });
  it('CSS uses tokens only and defines none', () => {
    const css = readFileSync(join(dir, 'experience.css'), 'utf8');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|box-shadow|gradient|backdrop-filter/);
    expect(css).not.toMatch(/--(surface|ink|line|fold|laser|depth|focus-ring|font-sans|font-mono)[\w-]*\s*:/);
    for (const t of css.match(/transition[^;]*;/g) ?? []) if (!/1ms/.test(t)) expect(t).not.toMatch(/\d+m?s\b/);
  });
});
