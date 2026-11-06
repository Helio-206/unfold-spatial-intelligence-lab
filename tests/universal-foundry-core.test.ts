import { describe, expect, it } from 'vitest';
import { extractEvidence, silhouetteIoU } from '../src/living/universal-foundry/evidence';
import { blobField, loftSections, subdivide, topologyReport, plateWithOpenings, taperedBox, signedVolume } from '../src/living/universal-foundry/ops';
import { createUniversalMaterials, MATERIAL_KINDS } from '../src/living/universal-foundry/materials';
import { validateRecipe, withParams } from '../src/living/universal-foundry/recipe';
import { compileFoundry } from '../src/living/universal-foundry/foundry';
import { classify } from '../src/living/universal-foundry/interpret';
import * as plans from '../src/living/universal-foundry/fixtures/plans';

describe('operators', () => {
  it('loft is closed, outward and deterministic', () => {
    const g = loftSections([{ x: 0, h: 0.5, w: 1 }, { x: 1, h: 1, w: 1.4 }, { x: 2, h: 0.4, w: 0.8 }]), t = topologyReport(g);
    expect(t.closed).toBe(true); expect(signedVolume(g)).toBeGreaterThan(0);
  });
  it('tapered box and plate with openings are valid', () => { expect(topologyReport(taperedBox([1, 1], [0.5, 0.5], 1)).nonManifoldEdges).toBe(0); expect(plateWithOpenings(2, 2, 0.1, [{ x: 0, y: 0, w: 0.5, h: 0.5 }]).getAttribute('position').count).toBeGreaterThan(24); });
  it('implicit blob is closed, bounded and seed-deterministic', () => {
    const spec = { shapes: [{ type: 'sphere' as const, c: [0, 0, 0] as [number, number, number], r: 0.5 }, { type: 'sphere' as const, c: [0.6, 0, 0] as [number, number, number], r: 0.4 }], k: 0.3, noise: 0.05, seed: 3, maxCells: 32 };
    const a = blobField(spec), b = blobField(spec); expect(a.report.closed).toBe(true); expect(a.report.triangles).toBeLessThan(60000); expect(a.report.triangles).toBe(b.report.triangles);
  });
  it('subdivision multiplies triangles and stays bounded to 3 levels', () => { const g = loftSections([{ x: 0, h: 1, w: 1 }, { x: 1, h: 1, w: 1 }]), n = topologyReport(g).triangles; expect(topologyReport(subdivide(g, 9)).triangles).toBe(n * 64); });
});
describe('materials', () => {
  it('builds every kind with seeded maps and disposes', () => { const lib = createUniversalMaterials(); for (const k of MATERIAL_KINDS) lib.get({ kind: k }); expect(lib.materials().length).toBe(MATERIAL_KINDS.length); expect(lib.textures().length).toBeGreaterThan(5); lib.dispose(); expect(lib.materials().length).toBe(0); });
});
describe('recipe', () => {
  it('validates, clamps overrides and keeps unknowns', () => {
    const r = compileFoundry(plans.sedan()).recipe!; expect(validateRecipe(r)).toEqual([]);
    const o = withParams(r, { cabinHeight: 99, spokes: 'x' as never }); expect(o.params.cabinHeight).toBe(0.55); expect(o.params.spokes).toBe(5); expect(r.unknowns.length).toBeGreaterThan(0);
  });
  it('classification is ranked from the plan vocabulary and refuses unknown objects', () => {
    expect(classify(plans.pavilion())[0]!.category).toBe('architecture');
    const odd = plans.planOf('Blob', [{ id: 'a', label: 'Thing', op: 'box', size: [1, 1, 1], pos: [0, 0.5, 0] }]); const r = compileFoundry(odd); expect(r.recipe).toBeNull(); expect(r.report.decisions[0]!.used).toBe('procedural_v2'); expect(r.readyCount()).toBe(0);
  });
  it('regeneration from parameters changes geometry but not ids, and retire stops upgrades', () => {
    const a = compileFoundry(plans.sedan(), { overrides: { spokes: 3 } }); a.buildAll(); const b = compileFoundry(plans.sedan(), { overrides: { spokes: 9 } }); b.buildAll();
    expect(a.report.totals.triangles).toBeLessThan(b.report.totals.triangles);
    const c = compileFoundry(plans.sedan()); c.retire(); expect(c.upgrade()).toEqual([]);
  });
});
describe('image evidence (local, no model)', () => {
  const img = (fg: [number, number, number]) => { const w = 64, h = 48, d = new Uint8Array(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4, on = x > 12 && x < 52 && y > 14 && y < 40; d.set(on ? [...fg, 255] : [235, 235, 235, 255], i); } return { width: w, height: h, data: d }; };
  it('finds the subject, its aspect, symmetry and colour', () => { const e = extractEvidence(img([200, 40, 40])); expect(e.aspect).toBeCloseTo(39 / 25, 1); expect(e.symmetry).toBeGreaterThan(0.95); expect(e.colours[0]!.hex.startsWith('#c')).toBe(true); expect(silhouetteIoU(e.mask, extractEvidence(img([10, 90, 200])).mask)).toBeGreaterThan(0.99); });
  it('evidence colour outranks the plan placeholder and is labelled evidence', () => { const r = compileFoundry(plans.sedan(), { evidence: extractEvidence(img([200, 40, 40])) }); expect(r.recipe!.paletteKnown).toBe('evidence'); expect(r.recipe!.palette.primary.startsWith('#c')).toBe(true); });
});
