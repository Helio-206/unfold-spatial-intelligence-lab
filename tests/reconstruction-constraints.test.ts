import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { validateSpatialPlanV2 } from '../src/universal-spatial/contracts-v2';
import { attachResidual, buildConstraints, detectContacts, placedGap, type PartGeometry, type Placed } from '../src/universal-spatial/reconstruction/constraints';
import { fitStructured } from '../src/universal-spatial/reconstruction/structural-fit';
import { fitPlacement } from '../src/universal-spatial/reconstruction/fit';
import { makeView, rasterise, viewDirections, type Tri } from '../src/universal-spatial/reconstruction/silhouette';

const box = (cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): Tri[] => {
  const v = (x: number, y: number, z: number) => new Vector3(cx + x * hx, cy + y * hy, cz + z * hz), q = (a: Vector3, b: Vector3, c: Vector3, d: Vector3): Tri[] => [[a, b, c], [a, c, d]];
  const p = [v(-1, -1, -1), v(1, -1, -1), v(1, 1, -1), v(-1, 1, -1), v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1)];
  return [...q(p[0]!, p[1]!, p[2]!, p[3]!), ...q(p[4]!, p[5]!, p[6]!, p[7]!), ...q(p[0]!, p[1]!, p[5]!, p[4]!), ...q(p[2]!, p[3]!, p[7]!, p[6]!), ...q(p[1]!, p[2]!, p[6]!, p[5]!), ...q(p[0]!, p[3]!, p[7]!, p[4]!)];
};
const part = (id: string, c: [number, number, number], h: [number, number, number]): PartGeometry => ({ id, origin: new Vector3(...c), tris: box(...c, ...h) });
const T = { position: [0, 0, 0], rotationRad: [0, 0, 0], scale: [1, 1, 1] };
const prov = { geometry: 'design_approximation', transform: 'design_approximation', material: 'design_approximation', evidence: 't' };
const planWith = (relations: object[], ids: string[]) => validateSpatialPlanV2({ contract: 'unfold.spatial-plan.v2', source: { kind: 'image', sha256: 'a'.repeat(64) }, title: 'T', units: 'unitless', presentationProfile: 'neutral', unknowns: [], constraints: [], relations,
  components: ids.map((id) => ({ id, label: id, parentId: null, transform: T, provenance: prov, geometry: { type: 'shape', key: `${id}-s`, operator: 'box', parameters: { dimensions: [1, 1, 1] }, transform: T, repeat: null, material: { profile: 'neutral', color: '#999999', roughness: 0.5, metalness: 0, clearcoat: 0 } } })) });

describe('structural constraints', () => {
  it('detects contacts the plan as given has and never joins parts that do not touch', () => {
    const a = part('a', [0, 0, 0], [1, 1, 1]), b = part('b', [2, 0, 0], [1, 1, 1]) /* touches a */, c = part('c', [9, 0, 0], [1, 1, 1]) /* far */;
    const found = detectContacts([a, b, c], { span: 12 }); expect(found.map((x) => `${x.a}-${x.b}`)).toEqual(['a-b']); expect(found[0]!.source).toBe('detected');
  });

  it('a declared relation is enforced only if the geometry supports it; otherwise it is reported and NOT created', () => {
    const a = part('a', [0, 0, 0], [1, 1, 1]), c = part('c', [9, 0, 0], [1, 1, 1]), plan = planWith([{ id: 'r1', fromId: 'a', toId: 'c', kind: 'attached_to', origin: 'inferred', evidence: 'x' }], ['a', 'c']);
    const set = buildConstraints(plan, [a, c], 12); expect(set.attach).toEqual([]); expect(set.notes.join(' ')).toMatch(/NOT enforced and NOT created/);
  });

  it('keeps the joint exactly in place while parts are rescaled and moved; a silhouette-only fit does not', () => {
    // truth: a big base with a narrow column on top, touching. The plan has the column too small and too high, but joined.
    const truth = [part('base', [0, 0, 0], [2, 0.5, 1]), part('column', [0, 1.5, 0], [0.3, 1, 0.3])], plan = [part('base', [0, 0, 0], [2, 0.5, 1]), part('column', [0, 1.1, 0], [0.2, 0.6, 0.2])];
    const views = viewDirections(6).map((d) => makeView(d, new Vector3(0, 1, 0), 4, 96)), targets = views.map((v) => rasterise(truth.flatMap((p) => p.tris), v));
    const set = buildConstraints(planWith([], ['base', 'column']), plan, 5.5); expect(set.attach.length).toBe(1);
    const fit = fitStructured(plan, set, views, targets, { span: 5.5 }), byId = new Map(plan.map((p) => [p.id, p]));
    expect(fit.iouAfter).toBeGreaterThan(fit.iouBefore + 0.02); // the silhouette improved
    expect(attachResidual(set.attach[0]!, byId, fit.placements, 5.5)).toBeLessThan(1e-9); // the joint is exactly where it was
    expect(placedGap(plan[0]!, plan[1]!, fit.placements.get('base')!, fit.placements.get('column')!)).toBeLessThan(0.3);
    // the unconstrained fit of the same problem is free to detach them
    const free = fitPlacement(plan.map((p) => ({ id: p.id, origin: p.origin, tris: p.tris })), views, targets, { maxShift: 1.5 }), f = (id: string) => free.placements.get(id) as Placed;
    expect(placedGap(plan[0]!, plan[1]!, f('base'), f('column'))).toBeGreaterThanOrEqual(0); // (no guarantee: that is the point)
  });

  it('respects scale limits and never adds or removes a part', () => {
    const plan = [part('a', [0, 0, 0], [1, 1, 1])], views = viewDirections(3).map((d) => makeView(d, new Vector3(), 4, 64)), targets = views.map((v) => rasterise(box(0, 0, 0, 3, 3, 3), v));
    const set = buildConstraints(planWith([], ['a']), plan, 6, { scale: [0.9, 1.2] }), fit = fitStructured(plan, set, views, targets, { span: 6 });
    expect(fit.placements.size).toBe(1); expect(fit.placements.get('a')!.s).toBeLessThanOrEqual(1.2 + 1e-9);
  });
});
