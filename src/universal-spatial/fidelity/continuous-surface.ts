import { BufferAttribute, BufferGeometry, Group, Mesh, type Object3D } from 'three';
import { createMaterial } from '../geometry-compiler-v2';
import type { JobResult } from './continuous-job';

/**
 * Continuous-surface family, main-thread half. The computation (signed distance fields, fillets, surface nets, clipping) is pure data in `continuous-job.ts`
 * and may run in a worker. This file only turns the finished arrays into meshes: materials, userData and selection identity.
 *
 * It does not merge components. Each component keeps its own group, `spatialEntityId` and selection. The blend skirt belongs to the part that flares; it
 * lies on and inside the neighbour's surface, so the neighbour is untouched. It adds no detail the plan lacks.
 */
export function assembleContinuous(result: Extract<JobResult, { ok: true }>, entityId: string, key: string): Group {
  const group = new Group(); group.name = key; group.userData.spatialSubcomponentKey = key;
  for (const g of result.groups) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(g.positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(g.normals, 3));
    geometry.setAttribute('uv', new BufferAttribute(g.uvs, 2));
    geometry.setIndex(new BufferAttribute(g.indices, 1));
    geometry.computeBoundingSphere(); geometry.computeBoundingBox();
    const mesh = new Mesh(geometry, createMaterial(g.material)); mesh.name = `${key}:${g.keys[0]}`;
    mesh.userData = { spatialEntityId: entityId, spatialSubcomponentKey: g.keys[0], spatialSubcomponentKeys: g.keys, materialProfile: g.material.profile, geometryFamily: 'continuous_surface', blendRadius: g.blend };
    // where a blend skirt meets the neighbour's surface the two are nearly coincident: without an offset they z-fight into white shards
    if (g.blend > 0) { const m = mesh.material as { polygonOffset: boolean; polygonOffsetFactor: number; polygonOffsetUnits: number }; m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; }
    mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
  }
  return group;
}

export const disposeObject = (object: Object3D): void => {
  object.traverse((o) => { if (o instanceof Mesh) { o.geometry.dispose(); for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose(); } });
  object.clear();
};
