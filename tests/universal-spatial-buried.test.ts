import { describe, expect, it } from 'vitest';
import { validateSpatialPlanV2, type SpatialPlanV2 } from '../src/universal-spatial/contracts-v2';
import { analyzeAssembly, revealBuriedComponents } from '../src/universal-spatial/assembly-analysis';
import { bicycleReply, jetEngineReply } from './fixtures/spatial-v2/handauthored';

type V3 = [number, number, number];
const T = (position: V3 = [0, 0, 0]) => ({ position, rotationRad: [0, 0, 0] as V3, scale: [1, 1, 1] as V3 });
const box = (id: string, dims: V3, position: V3, origin: 'design_approximation' | 'observed' = 'design_approximation') => ({
  id, label: id, parentId: null, transform: T(position), provenance: { geometry: origin, transform: origin, material: origin, evidence: 'test' },
  geometry: { type: 'shape' as const, key: `${id}-shape`, operator: 'box' as const, parameters: { dimensions: dims }, transform: T(), repeat: null, material: { profile: 'neutral' as const, color: '#999999', roughness: 0.5, metalness: 0, clearcoat: 0 } },
});
const plan = (components: ReturnType<typeof box>[]): SpatialPlanV2 => validateSpatialPlanV2({ contract: 'unfold.spatial-plan.v2', source: { kind: 'text', sha256: 'a'.repeat(64) }, title: 't', units: 'unitless', presentationProfile: 'neutral', components, relations: [], constraints: [], unknowns: [] });
const buried = (p: SpatialPlanV2) => analyzeAssembly(p).defects.filter((d) => d.kind === 'buried').map((d) => d.componentId);

describe('buried components (hidden inside an opaque solid)', () => {
  it('flags a part that no direction can see, and not the solid around it', () => {
    expect(buried(plan([box('case', [4, 4, 4], [0, 0, 0]), box('dial', [1, 1, 0.2], [0, 0, 0])]))).toEqual(['dial']);
  });

  it('does not flag a part that emerges through a face, even partly', () => {
    expect(buried(plan([box('case', [4, 4, 4], [0, 0, 0]), box('dial', [1, 1, 0.4], [0, 0, 2])]))).toEqual([]);
  });

  it('does not flag parts that are visible through openings of hollow shapes (real fixtures, no false positives)', () => {
    expect(buried(jetEngineReply().plan)).toEqual([]); expect(buried(bicycleReply().plan)).toEqual([]);
  });

  it('describes the defect for the person', async () => {
    const { describeDefect } = await import('../src/universal-spatial/assembly-analysis');
    const defect = analyzeAssembly(plan([box('case', [4, 4, 4], [0, 0, 0]), box('dial', [1, 1, 0.2], [0, 0, 0])])).defects.find((d) => d.kind === 'buried')!;
    expect(describeDefect(defect)).toMatch(/dial.*hidden|buried/i);
  });
});

describe('revealing buried components through typed operations', () => {
  it('moves the smallest distance that makes the part visible, touches nothing else, and marks the move as a solver output', () => {
    const p = plan([box('case', [4, 4, 4], [0, 0, 0]), box('dial', [1, 1, 0.2], [0, 0, 0])]), result = revealBuriedComponents(p);
    expect(result.applied).toHaveLength(1); expect(result.applied[0]!.operation).toMatchObject({ kind: 'set-transform', componentId: 'dial', nodeKey: null });
    expect(buried(result.plan)).toEqual([]); expect(result.plan.components[0]).toEqual(p.components[0]); expect(result.plan.components[1]!.geometry).toEqual(p.components[1]!.geometry);
    expect(result.plan.components[1]!.provenance.evidence).toMatch(/Assembly solver/); expect(result.plan.components[1]!.provenance.transform).toBe('inferred');
    const moved = result.plan.components[1]!.transform.position, travel = Math.hypot(...moved); expect(travel).toBeLessThan(2.6);
  });

  it('never moves an observed or confirmed position and reports it as blocked', () => {
    const p = plan([box('case', [4, 4, 4], [0, 0, 0]), box('dial', [1, 1, 0.2], [0, 0, 0], 'observed')]), result = revealBuriedComponents(p);
    expect(result.applied).toEqual([]); expect(result.plan).toEqual(p); expect(result.remaining).toContainEqual(expect.objectContaining({ kind: 'buried', componentId: 'dial', blockedBy: 'confirmed_provenance' }));
  });

  it('is idempotent and leaves a plan without buried parts untouched', () => {
    const p = plan([box('case', [4, 4, 4], [0, 0, 0]), box('dial', [1, 1, 0.2], [0, 0, 0])]), once = revealBuriedComponents(p), twice = revealBuriedComponents(once.plan);
    expect(twice.applied).toEqual([]); expect(twice.plan).toEqual(once.plan);
    const clean = plan([box('a', [1, 1, 1], [0, 0.5, 0])]); expect(revealBuriedComponents(clean).plan).toEqual(clean);
  });
});
