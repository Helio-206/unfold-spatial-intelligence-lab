import { Box3, Group, Matrix4, Mesh, Vector3, type Object3D } from 'three';
import type { MaterialV2 } from '../contracts-v2';
import { createMaterial } from '../geometry-compiler-v2';
import { implicitShapesOf, smoothMin, unionFieldCulled, type ImplicitShape } from './sdf';
import { surfaceNets, type Field } from './surface-nets';
import type { RouterLimits } from './types';

/**
 * Continuous-surface family. A component is drawn as ONE smooth closed surface per material, sampled from the signed distance fields of its own primitives
 * (same parameters and transforms as V2), with the junctions to its parent and touching neighbours filleted: the surface of a part flares into the surface
 * it meets instead of stopping against it.
 *
 * It does not merge components. Each component keeps its own mesh, group, `spatialEntityId` and selection. The blend skirt belongs to the part that
 * flares; it lies on and inside the neighbour's surface, so the neighbour is untouched. It adds no detail the plan lacks.
 */
export type NeighbourField = { id: string; shapes: ImplicitShape[]; /** neighbour space -> this component's space */ toLocal: Matrix4 };
export type ContinuousResult = { group: Group; triangles: number; bytes: number; cells: number; blendRadius: number; blendedWith: string[] } | { fallback: string };

const signature = (m: MaterialV2) => `${m.profile}|${m.color}|${m.roughness}|${m.metalness}|${m.clearcoat}`;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function buildContinuousComponent(input: { key: string; geometry: Parameters<typeof implicitShapesOf>[0]; entityId: string; neighbours: NeighbourField[]; span: number; limits: RouterLimits }): ContinuousResult {
  const own = implicitShapesOf(input.geometry); if ('code' in own) return { fallback: own.code };
  if (!own.length) return { fallback: 'NO_SHAPES' };
  const groups = new Map<string, ImplicitShape[]>(); for (const s of own) groups.set(signature(s.material), [...(groups.get(signature(s.material)) ?? []), s]);
  const result = new Group(); result.name = input.key; result.userData.spatialSubcomponentKey = input.key;
  let triangles = 0, bytes = 0, cells = 0, blend = 0; const blendedWith = new Set<string>();
  const perGroupBudget = Math.floor(input.limits.maxTriangles / 4);

  for (const shapes of groups.values()) {
    const box = new Box3(); for (const s of shapes) box.union(s.box);
    const minFeature = Math.min(...shapes.map((s) => s.featureRadius)), ownField = unionFieldCulled(shapes, clamp(0.8 * minFeature, input.span * 0.002, input.span * 0.03));
    // partners: neighbours whose bounds come within the blend radius of this group
    // One side of a junction draws the fillet: the part with the thinner feature flares into the thicker one (ties: the later id). If both did, the same
    // region would be covered twice in different colours and the two skirts would fight each other.
    const thinnerThan = (n: NeighbourField) => { const f = Math.min(...n.shapes.map((x) => x.featureRadius)); return minFeature < f * 0.999 || (Math.abs(minFeature - f) <= f * 0.001 && input.entityId < n.id); };
    const partners = input.neighbours.filter(thinnerThan).filter((n) => { const nb = new Box3(); for (const s of n.shapes) nb.union(s.box.clone().applyMatrix4(n.toLocal)); return nb.distanceToPoint(box.getCenter(new Vector3())) <= box.getSize(new Vector3()).length() / 2 + clamp(2.5 * minFeature, 0, input.span * 0.08) + 1e-9; });
    const k = partners.length ? clamp(2.5 * Math.min(minFeature, ...partners.flatMap((n) => n.shapes.map((s) => s.featureRadius))), input.span * 0.004, input.span * 0.08) : 0;
    blend = Math.max(blend, k); for (const n of partners) blendedWith.add(n.id);
    const partnerFields: Field[] = partners.map((n) => { const e = n.toLocal.clone().invert().elements, f = unionFieldCulled(n.shapes, 0); const s = Math.min(new Vector3().setFromMatrixColumn(n.toLocal, 0).length(), new Vector3().setFromMatrixColumn(n.toLocal, 1).length(), new Vector3().setFromMatrixColumn(n.toLocal, 2).length()); return (x: number, y: number, z: number) => f(e[0]! * x + e[4]! * y + e[8]! * z + e[12]!, e[1]! * x + e[5]! * y + e[9]! * z + e[13]!, e[2]! * x + e[6]! * y + e[10]! * z + e[14]!) * s; });
    const field: Field = partnerFields.length ? (x, y, z) => { let d = ownField(x, y, z); for (const pf of partnerFields) d = smoothMin(d, pf(x, y, z), k); return d; } : ownField;

    const pad = k * 1.5 + 0.02 * input.span * 0, size3 = box.getSize(new Vector3()).addScalar(2 * pad), extent = Math.max(size3.x, size3.y, size3.z);
    let cell = Math.min(extent / 56, minFeature / 1.2); cell = Math.max(cell, extent / input.limits.maxGridCells);
    if (minFeature < 0.75 * cell) return { fallback: 'FEATURE_BELOW_RESOLUTION' };
    const min = box.min.clone().subScalar(pad + cell), dims = [0, 1, 2].map((a) => Math.max(2, Math.ceil((size3.getComponent(a) + 2 * cell) / cell))) as [number, number, number];
    if (dims[0] * dims[1] * dims[2] > 1_400_000) return { fallback: 'GRID_TOO_LARGE' };
    let geometry;
    try {
      geometry = surfaceNets({ min, cells: dims, size: cell, field, maxTriangles: perGroupBudget, ...(partnerFields.length ? { keep: (x: number, y: number, z: number) => ownField(x, y, z) <= k * 0.6 + cell && partnerFields.every((pf) => pf(x, y, z) >= -cell * 0.2) } : {}) });
    } catch (error) { return { fallback: error instanceof Error && error.message.startsWith('SPATIAL_FIDELITY') ? error.message.replace('SPATIAL_FIDELITY_', '') : 'SURFACE_FAILED' }; }
    if (!geometry.index || geometry.index.count === 0) { geometry.dispose(); return { fallback: 'EMPTY_SURFACE' }; }
    const mesh = new Mesh(geometry, createMaterial(shapes[0]!.material)); mesh.name = `${input.key}:${shapes[0]!.key}`;
    mesh.userData = { spatialEntityId: input.entityId, spatialSubcomponentKey: shapes[0]!.key, spatialSubcomponentKeys: shapes.map((s) => s.key), materialProfile: shapes[0]!.material.profile, geometryFamily: 'continuous_surface', blendRadius: k };
    // where a blend skirt meets the neighbour's surface the two are nearly coincident: without an offset they z-fight into white shards
    if (partnerFields.length) { const m = mesh.material as { polygonOffset: boolean; polygonOffsetFactor: number; polygonOffsetUnits: number }; m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; }
    mesh.castShadow = true; mesh.receiveShadow = true; result.add(mesh);
    triangles += geometry.index.count / 3; bytes += geometry.getAttribute('position').array.byteLength + geometry.getAttribute('normal').array.byteLength + geometry.getAttribute('uv').array.byteLength + geometry.index.array.byteLength; cells += dims[0] * dims[1] * dims[2];
  }
  return { group: result, triangles, bytes, cells, blendRadius: blend, blendedWith: [...blendedWith] };
}

export const disposeObject = (object: Object3D): void => {
  object.traverse((o) => { if (o instanceof Mesh) { o.geometry.dispose(); for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose(); } });
  object.clear();
};
