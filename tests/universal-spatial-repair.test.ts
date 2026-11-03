import { describe, expect, it } from 'vitest';
import { isValidShapeParametersV2 } from '../src/universal-spatial/contracts-v2';
import { OPERATORS_V2, repairModelPlanShapes, repairShapeParameters } from '../src/universal-spatial/geometry-repair';

const ok = (operator: string, parameters: Record<string, unknown>) => expect(isValidShapeParametersV2(operator, parameters)).toBe(true);

describe('field-level geometry repair (replaces whole-shape generic defaults)', () => {
  it('leaves an already valid node untouched and reports nothing', () => {
    const parameters = { radiusTop: 0.2, radiusBottom: 0.4, height: 3, radialSegments: 32 };
    const result = repairShapeParameters('cylinder', parameters);
    expect(result.parameters).toEqual(parameters); expect(result.repairs).toEqual([]); expect(result.defaulted).toEqual([]); expect(result.salvaged).toBe(true);
  });

  it('keeps the proportions the model gave when only a count or an alias is wrong', () => {
    const cylinder = repairShapeParameters('cylinder', { radius: 0.05, height: 2.4 });
    expect(cylinder.parameters).toMatchObject({ radiusTop: 0.05, radiusBottom: 0.05, height: 2.4 }); ok('cylinder', cylinder.parameters);
    expect(cylinder.defaulted).toEqual(['radialSegments']);
    const box = repairShapeParameters('box', { width: 3, height: 0.2, depth: 1 });
    expect(box.parameters).toEqual({ dimensions: [3, 0.2, 1] }); ok('box', box.parameters);
    const sized = repairShapeParameters('box', { size: 2 }); expect(sized.parameters).toEqual({ dimensions: [2, 2, 2] });
  });

  it('drops unknown keys without losing the geometry', () => {
    const tube = repairShapeParameters('tube', { points: [[0, 0, 0], [1, 2, 0], [2, 2, 1]], radius: 0.03, tubularSegments: 40, radialSegments: 8, capped: true });
    expect(tube.parameters.points).toEqual([[0, 0, 0], [1, 2, 0], [2, 2, 1]]); expect(tube.repairs.join(' ')).toMatch(/capped/); ok('tube', tube.parameters);
  });

  it('clamps integers, bevels and radii into the contract ranges', () => {
    expect(repairShapeParameters('cylinder', { radiusTop: 1, radiusBottom: 1, height: 1, radialSegments: 3 }).parameters.radialSegments).toBe(8);
    expect(repairShapeParameters('cylinder', { radiusTop: 1, radiusBottom: 1, height: 1, radialSegments: 5000 }).parameters.radialSegments).toBe(128);
    const rounded = repairShapeParameters('rounded_box', { dimensions: [1, 0.2, 1], bevelM: 0.5, segments: 3 }); expect((rounded.parameters.bevelM as number)).toBeLessThanOrEqual(0.1); ok('rounded_box', rounded.parameters);
    const torus = repairShapeParameters('torus', { majorRadius: 1, tubeRadius: 2, radialSegments: 12, tubularSegments: 48 }); expect(torus.parameters.majorRadius).toBe(1); expect(torus.parameters.tubeRadius as number).toBeLessThan(1); ok('torus', torus.parameters);
    const revolve = repairShapeParameters('revolve', { profile: [[-0.4, 0], [0.3, 1], [0.1, 2]], segments: 32 }); expect(revolve.parameters.profile).toEqual([[0.4, 0], [0.3, 1], [0.1, 2]]); ok('revolve', revolve.parameters);
  });

  it('turns a self-intersecting profile into a simple polygon over the same points', () => {
    const bow = { profile: [[0, 0], [2, 2], [2, 0], [0, 2]], depth: 0.4, bevelM: 0, curveSegments: 4 };
    const result = repairShapeParameters('extrude', bow); ok('extrude', result.parameters);
    expect((result.parameters.profile as number[][]).length).toBe(4);
    expect(result.repairs.join(' ')).toMatch(/profile/);
  });

  it('coerces numeric strings and says so', () => {
    const result = repairShapeParameters('sphere', { radius: '0.5', widthSegments: '24', heightSegments: 16 });
    expect(result.parameters).toEqual({ radius: 0.5, widthSegments: 24, heightSegments: 16 }); expect(result.repairs.length).toBeGreaterThan(0);
  });

  it('falls back to defaults scaled by the characteristic size of the rest of the assembly, and says nothing was salvaged', () => {
    const small = repairShapeParameters('cylinder', null, { characteristicSize: 0.1 }), large = repairShapeParameters('cylinder', null, { characteristicSize: 10 });
    expect(small.salvaged).toBe(false); expect(large.salvaged).toBe(false);
    expect((large.parameters.height as number) / (small.parameters.height as number)).toBeCloseTo(100, 5); ok('cylinder', small.parameters); ok('cylinder', large.parameters);
  });

  it('always produces contract-valid parameters from arbitrary garbage (fuzz, every operator)', () => {
    let seed = 12345; const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const junk = (): unknown => { const r = rand(); return r < 0.15 ? null : r < 0.25 ? 'x' : r < 0.35 ? -rand() * 5 : r < 0.45 ? rand() * 1e6 : r < 0.55 ? Number.NaN : r < 0.65 ? [rand(), rand()] : r < 0.75 ? [[rand(), rand(), rand()]] : r < 0.85 ? { a: 1 } : rand() * 3; };
    for (const operator of OPERATORS_V2) for (let n = 0; n < 300; n++) {
      const raw: Record<string, unknown> = {}; for (let k = 0, count = Math.floor(rand() * 7); k < count; k++) raw[['radius', 'height', 'dimensions', 'profile', 'points', 'segments', 'radialSegments', 'bevelM', 'depth', 'radii', 'sections', 'capEnds', 'majorRadius', 'tubeRadius', 'radiusTop', 'radiusBottom', 'junk'][Math.floor(rand() * 17)]!] = junk();
      const result = repairShapeParameters(operator, rand() < 0.1 ? junk() : raw);
      expect(isValidShapeParametersV2(operator, result.parameters), `${operator} ${JSON.stringify(raw)}`).toBe(true);
    }
  });
});

describe('plan-level repair used by the paid plan route', () => {
  const shape = (key: string, operator: string, parameters: unknown) => ({ type: 'shape', key, operator, parameters, transform: { position: [0, 0, 0], rotationRad: [0, 0, 0], scale: [1, 1, 1] }, repeat: null, material: { profile: 'neutral', color: '#888888', roughness: 0.5, metalness: 0, clearcoat: 0 } });
  const component = (id: string, geometry: unknown, position: number[]) => ({ id, label: id, parentId: null, geometry, transform: { position, rotationRad: [0, 0, 0], scale: [1, 1, 1] }, provenance: { geometry: 'inferred', transform: 'inferred', material: 'inferred', evidence: 'x' } });

  it('repairs nested invalid nodes (including the error kinds the old retry loop could not match), keeps valid ones identical and records provenance', () => {
    const valid = { radiusTop: 0.2, radiusBottom: 0.2, height: 4, radialSegments: 24 };
    const plan = {
      unknowns: [] as string[],
      components: [
        component('leg', { type: 'group', key: 'leg-group', transform: { position: [0, 0, 0], rotationRad: [0, 0, 0], scale: [1, 1, 1] }, repeat: null, children: [shape('leg-a', 'cylinder', valid), shape('leg-b', 'rounded_box', { dimensions: [4, 0.2, 1], bevelM: 0.9, segments: 3 })] }, [0, 0, 0]),
        component('top', shape('top-slab', 'torus', { majorRadius: 1, tubeRadius: 3, radialSegments: 12, tubularSegments: 48 }), [10, 0, 0]),
      ],
    };
    const report = repairModelPlanShapes(plan);
    expect((plan.components[0]!.geometry as { children: Array<{ parameters: unknown }> }).children[0]!.parameters).toEqual(valid);
    expect(report.map((entry) => entry.key).sort()).toEqual(['leg-b', 'top-slab']);
    expect(plan.components[0]!.provenance.geometry).toBe('design_approximation');
    expect(plan.components[1]!.provenance.geometry).toBe('design_approximation');
    expect(plan.components[1]!.provenance.evidence).toMatch(/tubeRadius/);
    expect(plan.unknowns.join(' ')).toMatch(/top-slab/);
    expect(isValidShapeParametersV2('torus', (plan.components[1]!.geometry as { parameters: Record<string, unknown> }).parameters)).toBe(true);
  });

  it('does not touch provenance or unknowns when every node is already valid', () => {
    const plan = { unknowns: [] as string[], components: [component('a', shape('a-body', 'box', { dimensions: [2, 2, 2] }), [0, 0, 0])] };
    const before = structuredClone(plan);
    expect(repairModelPlanShapes(plan)).toEqual([]); expect(plan).toEqual(before);
  });

  it('scales unsalvageable fallbacks by the span of the assembly instead of a fixed 0.8', () => {
    const plan = { unknowns: [] as string[], components: [component('a', shape('a-body', 'box', { dimensions: [2, 2, 2] }), [0, 0, 0]), component('b', shape('b-body', 'cylinder', null), [40, 0, 0])] };
    repairModelPlanShapes(plan);
    const params = (plan.components[1]!.geometry as { parameters: { height: number } }).parameters;
    expect(params.height).toBeGreaterThan(5);
  });
});
