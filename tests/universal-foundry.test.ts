import { describe, expect, it } from 'vitest';
import { Mesh, type BufferGeometry } from 'three';
import { compileFoundry } from '../src/living/universal-foundry/foundry';
import { topologyReport } from '../src/living/universal-foundry/ops';
import * as plans from '../src/living/universal-foundry/fixtures/plans';

const tri = (root: import('three').Object3D) => { let t = 0; root.traverse((o) => { if (o instanceof Mesh) { const g = o.geometry as BufferGeometry; t += (g.index ? g.index.count : g.getAttribute('position').count) / 3; } }); return t; };
describe('universal foundry compile seam', () => {
  for (const [name, make, category] of [['sedan', plans.sedan, 'vehicle'], ['hatchback', plans.hatchback, 'vehicle'], ['chair', plans.chair, 'furniture'], ['sofa', plans.sofa, 'furniture']] as const) {
    it(`${name}: classified as ${category}, ids kept, geometry richer than V2`, () => {
      const plan = make(), r = compileFoundry(plan), v2 = tri(r.root);
      expect(r.recipe?.category).toBe(category);
      expect(r.readyCount()).toBe(plan.components.length);
      r.buildAll();
      expect(r.readyCount()).toBe(0);
      const ids = new Set<string>(); r.root.traverse((o) => { if (o.userData.spatialComponentRoot) ids.add(o.userData.spatialEntityId as string); });
      expect([...ids].sort()).toEqual(plan.components.map((c) => c.id).sort());
      expect(tri(r.root)).toBeGreaterThan(v2 * 5);
      expect(r.report.decisions.every((d) => d.used === 'universal_foundry')).toBe(true);
      r.root.traverse((o) => { if (o instanceof Mesh) { expect(typeof o.userData.spatialEntityId).toBe('string'); const t = topologyReport(o.geometry); expect(t.degenerate / Math.max(1, t.triangles)).toBeLessThan(0.02); } });
    });
  }
  it('is deterministic', () => {
    const a = compileFoundry(plans.sedan()); a.buildAll(); const b = compileFoundry(plans.sedan()); b.buildAll();
    expect(tri(a.root)).toBe(tri(b.root));
  });
});

describe('every family builds from coarse plans', () => {
  const cases: Array<[string, () => ReturnType<typeof plans.sedan>, string]> = [['laptop', plans.laptop, 'electronics'], ['monitor', plans.monitor, 'electronics'], ['fridge', plans.fridge, 'appliance'], ['washer', plans.washer, 'appliance'], ['house', plans.house, 'architecture'], ['pavilion', plans.pavilion, 'architecture'], ['hammer', plans.hammer, 'tool'], ['wrench', plans.wrench, 'tool'], ['vase', plans.vase, 'organic'], ['apple', plans.apple, 'organic'], ['plant', plans.plant, 'organic'], ['miniExcavator', plans.miniExcavator, 'construction'], ['suv', plans.suv, 'vehicle'], ['table', plans.table, 'furniture']];
  for (const [name, make, category] of cases) it(`${name} -> ${category}`, () => {
    const plan = make(), r = compileFoundry(plan), v2 = tri(r.root); r.buildAll();
    expect(r.recipe?.category).toBe(category);
    expect(r.report.decisions.map((d) => `${d.componentId}:${d.used}:${d.fallback?.code ?? ''}`).filter((s) => !s.includes('universal_foundry'))).toEqual([]);
    expect(tri(r.root)).toBeGreaterThan(v2);
  });
});
