import { describe, expect, it } from 'vitest';
import { Matrix4 } from 'three';
import type { GeometryNodeV2 } from '../src/universal-spatial/contracts-v2';
import { jobKey, runContinuousJob, type ContinuousJob, type JobNeighbour } from '../src/universal-spatial/fidelity/continuous-job';

type V3 = [number, number, number];
const T = (position: V3 = [0, 0, 0]) => ({ position, rotationRad: [0, 0, 0] as V3, scale: [1, 1, 1] as V3 });
const mat = { profile: 'organic' as const, color: '#a04040', roughness: 0.6, metalness: 0, clearcoat: 0 };
const shape = (key: string, operator: string, parameters: Record<string, unknown>, position: V3 = [0, 0, 0]): GeometryNodeV2 => ({ type: 'shape', key, operator: operator as never, parameters, transform: T(position), repeat: null, material: mat });
const sphere = (r: number, at: V3 = [0, 0, 0]) => shape('s', 'sphere', { radius: r, widthSegments: 24, heightSegments: 16 }, at);
const cyl = (r: number, h: number, at: V3 = [0, 0, 0], key = 'c') => shape(key, 'cylinder', { radiusTop: r, radiusBottom: r, height: h, radialSegments: 24 }, at);
const neighbour = (id: string, geometry: GeometryNodeV2, at: V3 = [0, 0, 0]): JobNeighbour => ({ id, geometry, toLocal: new Matrix4().makeTranslation(...at).elements.slice() });
const job = (geometry: GeometryNodeV2, neighbours: JobNeighbour[], entityId = 'part'): ContinuousJob => { const base = { entityId, geometry, neighbours, maxTriangles: 400_000, maxGridCells: 72 }; return { ...base, key: jobKey(base) }; };

describe('continuous job (pure computation)', () => {
  it('returns plain typed arrays and a deviation audit, with no objects that cannot cross a worker boundary', () => {
    const r = runContinuousJob(job(sphere(1), [])); expect(r.ok).toBe(true); if (!r.ok) return;
    expect(r.groups[0]!.positions).toBeInstanceOf(Float32Array); expect(r.groups[0]!.indices).toBeInstanceOf(Uint32Array); expect(() => structuredClone(r)).not.toThrow();
    expect(r.deviation.freeMax).toBeLessThan(r.deviation.cell); // an isolated part is its plan shape, to within one cell
  });

  it('keeps the silhouette: only the blend zone may leave the plan shape, and by at most the smooth-min bound plus a cell', () => {
    const r = runContinuousJob(job(cyl(0.1, 1.2, [0, 1.3, 0]), [neighbour('body', sphere(1))])); expect(r.ok).toBe(true); if (!r.ok) return;
    const k = r.blendRadius; expect(k).toBeGreaterThan(0); expect(r.blendedWith).toEqual(['body']);
    expect(r.deviation.freeMax).toBeLessThan(r.deviation.cell); expect(r.deviation.blendMax).toBeLessThanOrEqual(k + r.deviation.cell); // k = 0.8 of the thinner feature: smoothing adds at most 20% of it
    expect(k).toBeLessThanOrEqual(0.8 * 0.1 + 1e-9);
  });

  it('does not bridge a gap: parts that do not touch are left apart (a gap is a plan defect for the solver and a person)', () => {
    const far = runContinuousJob(job(cyl(0.1, 1.2, [0, 2.0, 0]), [neighbour('body', sphere(1))])); expect(far.ok && far.blendedWith).toEqual([]); expect(far.ok && far.blendRadius).toBe(0);
    const touching = runContinuousJob(job(cyl(0.1, 1.2, [0, 1.3, 0]), [neighbour('body', sphere(1))])); expect(touching.ok && touching.blendedWith).toEqual(['body']);
  });

  it('smooths less when the two parts are similar in thickness (no bulb at a tube-to-tube joint)', () => {
    const similar = runContinuousJob(job(cyl(0.2, 0.8, [0, 0.55, 0], 'eyepiece'), [neighbour('tube', cyl(0.28, 2.0, [0, 0, 0], 'tube'))], 'eyepiece')); expect(similar.ok).toBe(true); if (!similar.ok) return;
    expect(similar.blendRadius).toBeLessThanOrEqual(0.8 * 0.2 + 1e-9); expect(similar.deviation.blendMax).toBeLessThanOrEqual(similar.blendRadius + similar.deviation.cell);
  });

  it('only the thinner side draws a junction', () => {
    const thick = runContinuousJob(job(sphere(1), [neighbour('tube', cyl(0.1, 1.2, [0, 1.3, 0]))], 'body')); expect(thick.ok && thick.blendedWith).toEqual([]);
    const thin = runContinuousJob(job(cyl(0.1, 1.2, [0, 1.3, 0]), [neighbour('body', sphere(1))], 'tube')); expect(thin.ok && thin.blendedWith).toEqual(['body']);
  });

  it('fails with a code, never partially', () => {
    expect(runContinuousJob(job(shape('r', 'revolve', { profile: [[0.3, 0], [0.3, 1]], segments: 16 }), []))).toEqual({ ok: false, code: 'OPERATOR_NOT_IMPLICIT' });
    expect(runContinuousJob(job(shape('t', 'tube', { points: [[0, 0, 0], [0, 40, 0]], radius: 0.01, tubularSegments: 8, radialSegments: 6 }), []))).toEqual({ ok: false, code: 'FEATURE_BELOW_RESOLUTION' });
    expect(runContinuousJob({ ...job(sphere(1), []), maxTriangles: 40 })).toMatchObject({ ok: false, code: 'GRID_LIMIT' });
  });

  it('content key: stable, sensitive to geometry and to the partner placement, blind to what is not an input', () => {
    const a = job(sphere(1), [neighbour('n', cyl(0.1, 1, [0, 1, 0]))]), b = job(sphere(1), [neighbour('n', cyl(0.1, 1, [0, 1, 0]))]);
    expect(a.key).toBe(b.key); expect(job(sphere(1.01), a.neighbours).key).not.toBe(a.key); expect(job(sphere(1), [neighbour('n', cyl(0.1, 1, [0, 1, 0]), [0.2, 0, 0])]).key).not.toBe(a.key);
    expect(job(sphere(1), [neighbour('n', cyl(0.1, 1, [0, 1, 0]))], 'other').key).not.toBe(a.key); // a different component is a different entry
  });
});
