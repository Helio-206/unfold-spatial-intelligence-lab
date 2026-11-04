// CATEGORY D plans: primitive approximations written BY HAND (by this assistant, from the silhouettes of the CC0 asset), standing in for what a planner might propose
// for these objects. They are not Meta output and they were not tuned to the fitter. Their errors (sizes, positions, proportions) are the ordinary errors of an eyeballed
// approximation; the ground truth is the independent CC0 mesh (category A), never these plans.
import { validateSpatialPlanV2, type GeometryNodeV2, type SpatialPlanV2 } from '../../src/universal-spatial/contracts-v2';

type V3 = [number, number, number];
const T = (position: V3 = [0, 0, 0]) => ({ position, rotationRad: [0, 0, 0] as V3, scale: [1, 1, 1] as V3 });
const mat = (color: string, profile: 'neutral' | 'industrial' | 'metal' = 'neutral') => ({ profile, color, roughness: 0.55, metalness: profile === 'metal' ? 0.6 : 0.1, clearcoat: 0 });
type Shape = Extract<GeometryNodeV2, { type: 'shape' }>;
const shape = (key: string, operator: Shape['operator'], parameters: Record<string, unknown>, color: string): Shape => ({ type: 'shape', key, operator, parameters, transform: T(), repeat: null, material: mat(color) });
const comp = (id: string, label: string, geometry: Shape, at: V3) => ({ id, label, parentId: null, transform: T(at), geometry, provenance: { geometry: 'design_approximation' as const, transform: 'design_approximation' as const, material: 'design_approximation' as const, evidence: 'Hand-built primitive approximation for the benchmark (category D); not Meta output.' } });
const plan = (title: string, sha: string, components: ReturnType<typeof comp>[], unknowns: string[]): SpatialPlanV2 => validateSpatialPlanV2({ contract: 'unfold.spatial-plan.v2', source: { kind: 'image', sha256: sha }, title, units: 'unitless', presentationProfile: 'industrial', components, relations: [], constraints: [], unknowns });

/** Lamp post with an arm and a hanging lantern (Khronos Lantern.glb). Coordinates are the asset's own. */
export function lanternPlan(sha: string): SpatialPlanV2 {
  return plan('Lamp post with hanging lantern (hand-built approximation)', sha, [
    comp('pole', 'Pole', shape('pole-s', 'cylinder', { radiusTop: 0.35, radiusBottom: 0.8, height: 25.4, radialSegments: 24 }, '#4a4a4a'), [0, 13.0, 0]),
    comp('base', 'Base', shape('base-s', 'cylinder', { radiusTop: 1.0, radiusBottom: 2.2, height: 4.6, radialSegments: 24 }, '#4a4a4a'), [0, 2.5, 0]),
    comp('arm', 'Arm', shape('arm-s', 'box', { dimensions: [15.4, 0.7, 0.9] }, '#4a4a4a'), [3.8, 22.6, 0]),
    comp('bracket', 'Bracket', shape('bracket-s', 'tube', { points: [[0.3, 16.0, 0], [1.4, 20.2, 0], [4.2, 21.9, 0], [8.0, 22.3, 0]], radius: 0.28, tubularSegments: 36, radialSegments: 10 }, '#4a4a4a'), [0, 0, 0]),
    comp('chain', 'Chain', shape('chain-s', 'cylinder', { radiusTop: 0.1, radiusBottom: 0.1, height: 2.1, radialSegments: 10 }, '#777777'), [9.9, 21.35, 0]),
    comp('lantern', 'Lantern', shape('lantern-s', 'ellipsoid', { radii: [1.3, 2.8, 1.3], widthSegments: 28, heightSegments: 20 }, '#c9c3a8'), [9.9, 18.4, 0]),
  ], ['Hand-built approximation of a CC0 asset; units are the asset\'s own.', 'Physical scale unknown.']);
}

/** Bellows camera on a tripod (Khronos AntiqueCamera.glb). */
export function cameraPlan(sha: string): SpatialPlanV2 {
  const leg = (id: string, foot: V3) => comp(id, id, shape(`${id}-s`, 'tube', { points: [[0, 5.1, 0], foot], radius: 0.13, tubularSegments: 12, radialSegments: 8 }, '#6b4a2b'), [0, 0, 0]);
  return plan('Bellows camera on a tripod (hand-built approximation)', sha, [
    comp('camera', 'Camera body', shape('camera-s', 'box', { dimensions: [1.6, 2.0, 2.4] }, '#2b2b2b'), [0, 6.4, 0]),
    comp('head', 'Tripod head', shape('head-s', 'cylinder', { radiusTop: 0.45, radiusBottom: 0.45, height: 0.9, radialSegments: 20 }, '#3a3a3a'), [0, 5.2, 0]),
    leg('leg-a', [0.67, 0, 1.36]), leg('leg-b', [-1.51, 0, 0.04]), leg('leg-c', [0.56, 0, -1.29]),
  ], ['Hand-built approximation of a CC0 asset; units are the asset\'s own.', 'Physical scale unknown.']);
}
