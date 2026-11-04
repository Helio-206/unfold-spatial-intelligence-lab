import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { validateSpatialPlanV2, type SpatialPlanV2 } from '../src/universal-spatial/contracts-v2';
import { compileSpatialPlanV2, disposeCompiledSpatialPlan } from '../src/universal-spatial/geometry-compiler-v2';
import { assemblySequence, explodeOffsets, measureComponents, pointsOfInterest } from '../src/living/spatial-presentation/structure';

type V3 = [number, number, number];
const material = { profile: 'neutral' as const, color: '#888888', roughness: 0.5, metalness: 0, clearcoat: 0 };
const T = (position: V3 = [0, 0, 0]) => ({ position, rotationRad: [0, 0, 0] as V3, scale: [1, 1, 1] as V3 });
const part = (id: string, dims: V3, position: V3, parentId: string | null = null, origin: 'design_approximation' | 'observed' = 'design_approximation') => ({
  id, label: `Part ${id}`, parentId, transform: T(position),
  geometry: { type: 'shape' as const, key: `${id}-shape`, operator: 'box' as const, parameters: { dimensions: dims }, transform: T(), repeat: null, material },
  provenance: { geometry: origin, transform: origin, material: origin, evidence: 'test' },
});
const plan = (components: ReturnType<typeof part>[], relations: SpatialPlanV2['relations'] = []): SpatialPlanV2 => validateSpatialPlanV2({
  contract: 'unfold.spatial-plan.v2', source: { kind: 'text', sha256: 'a'.repeat(64) }, title: 't', units: 'unitless', presentationProfile: 'neutral', components, relations, constraints: [], unknowns: [],
});
const rel = (id: string, fromId: string, toId: string, kind: SpatialPlanV2['relations'][number]['kind'] = 'attached_to') => ({ id, fromId, toId, kind, origin: 'inferred' as const, evidence: 'test' });
const measured = (p: SpatialPlanV2) => { const compiled = compileSpatialPlanV2(p); const m = measureComponents(p, compiled.root); return { m, done: () => disposeCompiledSpatialPlan(compiled.root), root: compiled.root }; };

// A tower: base, shaft on the base, cap on the shaft, plus a side arm on the shaft. Listed in a scrambled order on purpose. Child positions are local to the parent.
const tower = () => plan([
  part('cap', [1, 0.5, 1], [0, 2.25, 0], 'shaft'), part('arm', [2, 0.3, 0.3], [1.4, 0, 0], 'shaft'), part('base', [4, 1, 4], [0, 0.5, 0]), part('shaft', [1, 4, 1], [0, 2.5, 0], 'base'),
], [rel('r1', 'shaft', 'base'), rel('r2', 'cap', 'shaft'), rel('r3', 'arm', 'shaft')]);

describe('assembly sequence', () => {
  it('starts from the grounded, largest root and never builds a child before its parent', () => {
    const p = tower(), { m, done } = measured(p), steps = assemblySequence(p, m);
    expect(steps.map((s) => s.componentId)[0]).toBe('base');
    const index = new Map(steps.map((s) => [s.componentId, s.order]));
    for (const c of p.components) if (c.parentId) expect(index.get(c.id)!).toBeGreaterThan(index.get(c.parentId)!);
    expect(new Set(steps.map((s) => s.componentId)).size).toBe(p.components.length); done();
  });

  it('grows through contact: a part touching the placed body comes before one far away, whatever the listing order', () => {
    const p = plan([part('far', [1, 1, 1], [8, 0.5, 0]), part('chain-b', [1, 1, 1], [2, 0.5, 0]), part('core', [3, 1, 3], [0, 0.5, 0]), part('chain-c', [1, 1, 1], [3, 0.5, 0])]);
    const { m, done } = measured(p), order = assemblySequence(p, m).map((s) => s.componentId);
    expect(order[0]).toBe('core'); expect(order.indexOf('chain-b')).toBeLessThan(order.indexOf('chain-c')); expect(order.indexOf('chain-c')).toBeLessThan(order.indexOf('far')); done();
  });

  it('gives every step a structural reason and is deterministic', () => {
    const p = tower(), { m, done } = measured(p), a = assemblySequence(p, m), b = assemblySequence(p, m);
    expect(a).toEqual(b); for (const s of a) expect(s.reason.length).toBeGreaterThan(8); expect(a[0]!.reason).toMatch(/lowest|largest|grounded/i); done();
  });

  it('does not modify the plan', () => {
    const p = tower(), before = structuredClone(p), { m, done } = measured(p); assemblySequence(p, m); pointsOfInterest(p, m, assemblySequence(p, m), 8); explodeOffsets(p, m, 0.45);
    expect(p).toEqual(before); done();
  });
});

describe('points of interest', () => {
  it('opens with an overview, stays within the budget, and names structural reasons only', () => {
    const p = tower(), { m, done } = measured(p), pois = pointsOfInterest(p, m, assemblySequence(p, m), 6);
    expect(pois[0]!.kind).toBe('overview'); expect(pois.length).toBeLessThanOrEqual(6);
    for (const poi of pois) { expect(poi.why.length).toBeGreaterThan(6); expect(Number.isFinite(poi.radius) && poi.radius > 0).toBe(true); expect(poi.centre.every(Number.isFinite)).toBe(true); }
    expect(pois.some((poi) => poi.kind === 'component' && poi.componentIds[0] === 'shaft')).toBe(true); done();
  });

  it('adds a joint point only where related parts really touch', () => {
    const touching = tower(), { m, done } = measured(touching), joints = pointsOfInterest(touching, m, assemblySequence(touching, m), 12).filter((poi) => poi.kind === 'joint');
    expect(joints.length).toBeGreaterThan(0); for (const j of joints) expect(j.componentIds.length).toBe(2); done();
    const apart = plan([part('a', [1, 1, 1], [0, 0.5, 0]), part('b', [1, 1, 1], [20, 0.5, 0])], [rel('r', 'b', 'a')]), x = measured(apart);
    expect(pointsOfInterest(apart, x.m, assemblySequence(apart, x.m), 12).filter((poi) => poi.kind === 'joint')).toEqual([]); x.done();
  });

  it('is empty-safe: a single component yields an overview and the component', () => {
    const p = plan([part('only', [1, 1, 1], [0, 0.5, 0])]), { m, done } = measured(p), pois = pointsOfInterest(p, m, assemblySequence(p, m), 8);
    expect(pois.map((poi) => poi.kind)).toEqual(['overview', 'component']); done();
  });
});

describe('exploded view offsets', () => {
  it('is zero at amount 0 and pushes a child away from its parent, hierarchically', () => {
    const p = tower(), { m, done } = measured(p);
    for (const v of explodeOffsets(p, m, 0).values()) expect(v.length()).toBe(0);
    const o = explodeOffsets(p, m, 1), parentCentre = m.get('shaft')!.centre, cap = m.get('cap')!.centre, arm = m.get('arm')!.centre;
    expect(o.get('cap')!.clone().dot(cap.clone().sub(parentCentre))).toBeGreaterThan(0);
    expect(o.get('arm')!.clone().dot(arm.clone().sub(parentCentre))).toBeGreaterThan(0);
    expect(o.get('base')!.length()).toBe(0); done();
  });

  it('scales with the assembly size, so the same shape at 100x moves 100x', () => {
    const a = tower(), small = measured(a), grow = (n: number) => n * 100;
    const big = plan([part('cap', [1, 0.5, 1].map(grow) as V3, [0, 2.25, 0].map(grow) as V3, 'shaft'), part('arm', [2, 0.3, 0.3].map(grow) as V3, [1.4, 0, 0].map(grow) as V3, 'shaft'), part('base', [4, 1, 4].map(grow) as V3, [0, 0.5, 0].map(grow) as V3), part('shaft', [1, 4, 1].map(grow) as V3, [0, 2.5, 0].map(grow) as V3, 'base')], a.relations);
    const large = measured(big);
    expect(explodeOffsets(big, large.m, 0.6).get('cap')!.length() / explodeOffsets(a, small.m, 0.6).get('cap')!.length()).toBeCloseTo(100, 0); small.done(); large.done();
  });

  it('never pushes any part below the floor the assembly stood on, at any amount (parts below their parent lift the whole arrangement)', () => {
    const p = plan([part('case', [1.5, 4, 1], [0, 3, 0]), part('plinth', [2, 0.5, 1.4], [0, -2.2, 0], 'case'), part('foot', [0.3, 0.3, 0.3], [0.5, -2.65, 0], 'case')]);
    const { m, done } = measured(p), floor = Math.min(...[...m.values()].map((c) => c.box.min.y));
    const world = (id: string, offsets: Map<string, Vector3>) => { let sum = new Vector3(), cursor: string | null = id; while (cursor) { sum = sum.add(offsets.get(cursor) ?? new Vector3()); cursor = p.components.find((c) => c.id === cursor)?.parentId ?? null; } return sum; };
    for (const amount of [0.25, 0.5, 1]) { const offsets = explodeOffsets(p, m, amount); for (const [id, c] of m) expect(c.box.min.y + world(id, offsets).y).toBeGreaterThanOrEqual(floor - 1e-9); }
    expect(explodeOffsets(p, m, 0).get('case')!.length()).toBe(0); done();
  });

  it('never returns NaN when a child sits exactly on its parent centre', () => {
    const p = plan([part('outer', [2, 2, 2], [0, 1, 0]), part('inner', [1, 1, 1], [0, 1, 0], 'outer')]), { m, done } = measured(p);
    for (const v of explodeOffsets(p, m, 1).values()) expect(Number.isFinite(v.x + v.y + v.z)).toBe(true);
    expect(explodeOffsets(p, m, 1).get('inner')!.length()).toBeGreaterThan(0); done();
  });

  it('measures each component by its own geometry, in world space', () => {
    const p = tower(), { m, done } = measured(p);
    expect(m.get('cap')!.centre.distanceTo(new Vector3(0, 5.25, 0))).toBeLessThan(1e-6); expect(m.get('shaft')!.box.getSize(new Vector3()).y).toBeCloseTo(4, 6); done();
  });
});
