import * as THREE from 'three';

/**
 * GPU resource lifecycle for scene rebuilds.
 *
 * What a rebuild creates and who owns it:
 *   - BufferGeometry of every Mesh, Line and LineSegments in the architectural group (walls, floors, frames, outlines, fillers): OWNED by the
 *     group, released here on every rebuild.
 *   - Geometry inside a Blender-module clone (`userData.sharedAsset`): shared with the loaded GLB library, never released here.
 *   - Materials and textures: shared per quality profile (see materials.ts); a rebuild must NOT release them. They are released once, at editor
 *     teardown, with disposeMaterials().
 *   - The environment map belongs to the renderer that built it (stage.ts); released with that renderer.
 */

const released = new WeakSet<THREE.BufferGeometry>();

function underSharedAsset(object: THREE.Object3D): boolean {
  for (let current: THREE.Object3D | null = object; current; current = current.parent) if (current.userData.sharedAsset === true) return true;
  return false;
}

/** Releases the geometries owned by `root` (meshes AND lines). Safe to call twice on the same tree; never touches shared geometry. Returns how many were released. */
export function disposeOwnedGeometries(root: THREE.Object3D): number {
  let count = 0;
  root.traverse((object) => {
    const flags = object as unknown as { isMesh?: boolean; isLine?: boolean; isPoints?: boolean; geometry?: THREE.BufferGeometry };
    if (!(flags.isMesh || flags.isLine || flags.isPoints) || underSharedAsset(object)) return;
    const geometry = flags.geometry;
    if (!geometry || released.has(geometry)) return;
    released.add(geometry); geometry.dispose(); count += 1;
  });
  return count;
}
