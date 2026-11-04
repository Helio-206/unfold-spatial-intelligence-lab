import { describe, expect, it } from 'vitest';
import { validateSpatialPlanV2 } from '../src/universal-spatial/contracts-v2';
import { compileSpatialPlanV2, disposeCompiledSpatialPlan } from '../src/universal-spatial/geometry-compiler-v2';
import { analyzeAssembly } from '../src/universal-spatial/assembly-analysis';
import { collectWorldPoints, fitCamera, projectedExtent, SHOT_DIRECTIONS } from '../src/universal-spatial/framing';
import { bicycleReply, jetEngineReply } from './fixtures/spatial-v2/handauthored';

describe.each([['aircraft engine', jetEngineReply], ['bicycle', bicycleReply]] as const)('hand-authored %s fixture through the generic pipeline', (_name, make) => {
  const reply = make();

  it('is labelled as hand-authored everywhere, never as model output', () => {
    expect(reply.meta.model).toBe('hand-authored-fixture'); expect(reply.plan.unknowns[0]).toMatch(/not a Meta response/);
    for (const component of reply.plan.components) { expect(component.provenance.geometry).toBe('design_approximation'); expect(component.provenance.evidence).toMatch(/Hand-authored/); }
  });

  it('validates, compiles within budget and has selectable components', () => {
    const plan = validateSpatialPlanV2(reply.plan), compiled = compileSpatialPlanV2(plan);
    expect(compiled.stats.componentCount).toBeGreaterThanOrEqual(6); expect(compiled.stats.triangleCount).toBeLessThan(120_000);
    const ids = new Set<string>(); compiled.root.traverse((object) => { if (object.userData.spatialComponentRoot) ids.add(object.userData.spatialEntityId as string); });
    expect(ids.size).toBe(plan.components.length); disposeCompiledSpatialPlan(compiled.root);
  });

  it('is one connected assembly (bounding-box level) with no repaired or tiny parts', () => {
    const defects = analyzeAssembly(reply.plan).defects;
    expect(defects.filter((d) => d.kind === 'floating' || d.kind === 'detached' || d.kind === 'generic_geometry')).toEqual([]);
  });

  it('frames to the same screen fraction at every shot', () => {
    const compiled = compileSpatialPlanV2(reply.plan), points = collectWorldPoints(compiled.root);
    for (const shot of Object.values(SHOT_DIRECTIONS)) { const pose = fitCamera(points, { aspect: 1.5, ...shot }); expect(projectedExtent(points, pose, 1.5).maxAbsNdc).toBeLessThanOrEqual(0.9 + 1e-6); }
    disposeCompiledSpatialPlan(compiled.root);
  });
});
