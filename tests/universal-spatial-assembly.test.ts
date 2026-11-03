import { describe, expect, it } from 'vitest';
import { validateSpatialPlanV2, type SpatialPlanV2 } from '../src/universal-spatial/contracts-v2';
import { analyzeAssembly, describeDefect, refineAssembly } from '../src/universal-spatial/assembly-analysis';

type Origin = 'observed' | 'inferred' | 'user_provided' | 'design_approximation' | 'unknown';
const id3 = { position: [0, 0, 0] as [number, number, number], rotationRad: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] };
const material = { profile: 'neutral' as const, color: '#888888', roughness: 0.5, metalness: 0, clearcoat: 0 };
const box = (key: string, dimensions: [number, number, number]) => ({ type: 'shape' as const, key, operator: 'box' as const, parameters: { dimensions }, transform: id3, repeat: null, material });
function component(idValue: string, geometry: ReturnType<typeof box>, position: [number, number, number], options: { parentId?: string | null; scale?: [number, number, number]; transformOrigin?: Origin; evidence?: string } = {}) {
  return { id: idValue, label: idValue, parentId: options.parentId ?? null, geometry, transform: { ...id3, position, scale: options.scale ?? id3.scale }, provenance: { geometry: 'inferred' as Origin, transform: (options.transformOrigin ?? 'inferred') as Origin, material: 'inferred' as Origin, evidence: options.evidence ?? 'test' } };
}
const plan = (components: ReturnType<typeof component>[]): SpatialPlanV2 => validateSpatialPlanV2({ contract: 'unfold.spatial-plan.v2', source: { kind: 'text', sha256: 'a'.repeat(64) }, title: 't', units: 'unitless', presentationProfile: 'neutral', components, relations: [], constraints: [], unknowns: [] });

describe('assembly analysis', () => {
  it('finds nothing in a connected assembly and changes nothing', () => {
    const connected = plan([component('base', box('base-box', [4, 1, 4]), [0, 0.5, 0]), component('post', box('post-box', [0.5, 3, 0.5]), [0, 2.5, 0])]);
    const analysis = analyzeAssembly(connected);
    expect(analysis.defects.filter((d) => d.kind === 'floating')).toEqual([]);
    const refined = refineAssembly(connected);
    expect(refined.plan).toEqual(connected); expect(refined.applied).toEqual([]);
  });

  it('reports a floating component and closes the gap with a typed set-transform that only moves that component', () => {
    const floating = plan([component('base', box('base-box', [4, 1, 4]), [0, 0.5, 0]), component('post', box('post-box', [0.5, 3, 0.5]), [0, 4.5, 0])]);
    const analysis = analyzeAssembly(floating);
    expect(analysis.defects).toContainEqual(expect.objectContaining({ kind: 'floating', componentId: 'post', nearestId: 'base' }));
    const refined = refineAssembly(floating);
    expect(refined.applied).toHaveLength(1);
    expect(refined.applied[0]!.operation).toMatchObject({ contract: 'unfold.spatial-operation.v2', kind: 'set-transform', componentId: 'post', nodeKey: null });
    expect(analyzeAssembly(refined.plan).defects.filter((d) => d.kind === 'floating')).toEqual([]);
    expect(refined.plan.components[0]).toEqual(floating.components[0]);
    expect(refined.plan.components[1]!.geometry).toEqual(floating.components[1]!.geometry);
    expect(refined.plan.components[1]!.provenance.transform).toBe('inferred');
    expect(refined.plan.components[1]!.provenance.evidence).toMatch(/assembly solver/i);
    expect(refined.plan.components[1]!.transform.position[1]).toBeLessThan(4.5);
  });

  it('closes gaps in world space for children of scaled parents', () => {
    const nested = plan([
      component('frame', box('frame-box', [2, 2, 2]), [0, 1, 0], { scale: [2, 2, 2] }),
      component('knob', box('knob-box', [0.2, 0.2, 0.2]), [0, 3, 0], { parentId: 'frame' }),
    ]);
    expect(analyzeAssembly(nested).defects.some((d) => d.kind === 'floating' && d.componentId === 'knob')).toBe(true);
    const refined = refineAssembly(nested);
    expect(analyzeAssembly(refined.plan).defects.filter((d) => d.kind === 'floating')).toEqual([]);
  });

  it('never moves a component whose position was observed or confirmed by a person, and says why', () => {
    for (const origin of ['observed', 'user_provided'] as const) {
      const guarded = plan([component('base', box('base-box', [4, 1, 4]), [0, 0.5, 0]), component('post', box('post-box', [0.5, 3, 0.5]), [0, 4.5, 0], { transformOrigin: origin })]);
      const refined = refineAssembly(guarded);
      expect(refined.plan).toEqual(guarded); expect(refined.applied).toEqual([]);
      expect(refined.remaining).toContainEqual(expect.objectContaining({ kind: 'floating', componentId: 'post', blockedBy: 'confirmed_provenance' }));
    }
  });

  it('leaves a clearly separate object alone instead of dragging it onto the rest', () => {
    const apart = plan([component('base', box('base-box', [2, 1, 2]), [0, 0.5, 0]), component('other', box('other-box', [2, 1, 2]), [60, 0.5, 0])]);
    const refined = refineAssembly(apart);
    expect(refined.plan).toEqual(apart);
    expect(analyzeAssembly(apart).defects).toContainEqual(expect.objectContaining({ kind: 'detached', componentId: 'other' }));
  });

  it('is bounded and idempotent', () => {
    const floating = plan([component('base', box('base-box', [4, 1, 4]), [0, 0.5, 0]), component('post', box('post-box', [0.5, 3, 0.5]), [0, 6, 0]), component('cap', box('cap-box', [1, 0.2, 1]), [0, 9, 0])]);
    const once = refineAssembly(floating, { maxIterations: 4 });
    expect(once.iterations).toBeLessThanOrEqual(4);
    const twice = refineAssembly(once.plan);
    expect(twice.applied).toEqual([]); expect(twice.plan).toEqual(once.plan);
    expect(refineAssembly(floating, { maxIterations: 0 }).plan).toEqual(floating);
  });

  it('describes every defect kind in one plain line, naming the component and the neighbour', () => {
    const lines = [
      describeDefect({ kind: 'floating', componentId: 'post', nearestId: 'base', gap: 2 }),
      describeDefect({ kind: 'floating', componentId: 'post', nearestId: 'base', gap: 2, blockedBy: 'confirmed_provenance' }),
      describeDefect({ kind: 'detached', componentId: 'other', nearestId: 'base', gap: 58 }),
      describeDefect({ kind: 'tiny', componentId: 'speck', ratio: 0.002 }),
      describeDefect({ kind: 'generic_geometry', componentId: 'speck', detail: 'x' }),
    ];
    expect(lines[0]).toMatch(/post.*base.*2\.00/); expect(lines[1]).toMatch(/confirmed|observed/i); expect(lines[2]).toMatch(/other.*separate/i); expect(lines[3]).toMatch(/speck.*0\.2%/); expect(lines[4]).toMatch(/approximat/i);
  });

  it('flags components that are tiny compared with the assembly and shapes that were approximated by repair', () => {
    const odd = plan([component('base', box('base-box', [10, 1, 10]), [0, 0.5, 0]), component('speck', box('speck-box', [0.02, 0.02, 0.02]), [0, 1.01, 0], { evidence: 'Parameter repair: speck-box (box): dimensions assumed.' })]);
    const kinds = analyzeAssembly(odd).defects.map((d) => `${d.kind}:${d.componentId}`);
    expect(kinds).toContain('tiny:speck'); expect(kinds).toContain('generic_geometry:speck');
  });
});
