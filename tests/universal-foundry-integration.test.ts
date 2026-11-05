import { describe, expect, it, vi } from 'vitest';
import { FoundryGeometry } from '../src/living/universal-foundry/provider';
import { PlanSpaceLayer } from '../src/living/spatial-space/layer';
import type { SpatialOperationV2 } from '../src/universal-spatial/contracts-v2';
import * as plans from '../src/living/universal-foundry/fixtures/plans';

const host = () => ({ changed: vi.fn(), redraw: vi.fn(), notify: vi.fn(), syncLost: vi.fn() });

describe('Universal Foundry inside PlanSpaceLayer (integration)', () => {
  it('regeneration is purely visual: plan, history and provenance untouched; the next build follows the authoritative plan', async () => {
    const plan = plans.sedan();
    const geometry = new FoundryGeometry(null);
    const layer = new PlanSpaceLayer(plan, host(), geometry.compile);
    const before = JSON.stringify(layer.currentPlan);
    layer.upgradeGeometry();
    expect(layer.geometryReport?.perFamily.universal_foundry.components).toBeGreaterThan(0);

    // Change a visual parameter and regenerate: same plan bytes, no history, no revision concept touched.
    geometry.set(layer.currentPlan, { spokes: 9 });
    layer.regenerate();
    expect(JSON.stringify(layer.currentPlan)).toBe(before);
    expect(layer.editCount).toBe(0);

    // An authorised edit goes through the normal typed path; the Foundry rebuild follows the new plan.
    const component = layer.currentPlan.components[0]!;
    const operation: SpatialOperationV2 = { contract: 'unfold.spatial-operation.v2', operationId: 'foundry-integration-1', kind: 'set-transform', componentId: component.id, nodeKey: null, value: { ...component.transform, position: [component.transform.position[0] + 0.5, component.transform.position[1], component.transform.position[2]] } };
    expect(layer.proposeOperation(operation, 'meta', 'Move')).toBe(true);
    layer.authorise(true);
    await layer.applyEdit();
    const moved = layer.currentPlan.components.find((c) => c.id === component.id)!;
    expect(moved.transform.position[0]).toBeCloseTo(component.transform.position[0] + 0.5);
    expect(moved.provenance.transform).toBe('inferred'); // an authorised model proposal stays inferred
    expect(layer.editCount).toBe(1);
    const afterCommit = JSON.stringify(layer.currentPlan);
    layer.regenerate();
    expect(JSON.stringify(layer.currentPlan)).toBe(afterCommit); // regeneration after the commit still does not write the plan

    expect(await layer.undo()).toBe(true);
    expect(JSON.stringify(layer.currentPlan)).toBe(before);
    layer.dispose();
  });

  it('keeps all eight families available through the registry', async () => {
    const { FAMILY_LIST } = await import('../src/living/universal-foundry/families/registry');
    expect(FAMILY_LIST.map((f) => f.category).sort()).toEqual(['appliance', 'architecture', 'construction', 'electronics', 'furniture', 'organic', 'tool', 'vehicle']);
  });
});
