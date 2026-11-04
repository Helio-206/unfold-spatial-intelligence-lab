import { Mesh, type BufferGeometry, type Material, type Object3D, type Texture } from 'three';
import type { AssetProposal } from './types';

/**
 * Ownership of an external mesh, stated once.
 *
 * - An `AssetOffer` OWNS the source scene: its geometries, its materials and its textures. `offer.dispose()` frees each of them exactly once (a texture
 *   shared by three materials is one texture) and is idempotent. After it the offer is never drawn.
 * - A compiled plan that draws the offer owns only the materials it CLONED. Its meshes share the source's geometry and textures by reference; those are
 *   flagged `userData.fidelityShared`, and `disposeCompiledSpatialPlan` leaves flagged resources alone. So an edit, an undo or any other rebuild can recompile
 *   from the same offer as often as it likes without ever reusing a freed resource, and the Space ending is the host disposing its offers.
 * - Teardown order does not matter: plan first or offer first frees every resource exactly once.
 */
export type AssetOffer = { readonly proposal: AssetProposal; readonly scene: Object3D; readonly disposed: boolean; dispose(): void };
export const SHARED_FLAG = 'fidelityShared';

export function createAssetOffer(proposal: AssetProposal, scene: Object3D): AssetOffer {
  let disposed = false;
  return {
    proposal, scene,
    get disposed() { return disposed; },
    dispose() {
      if (disposed) return; disposed = true;
      const geometries = new Set<BufferGeometry>(), materials = new Set<Material>(), textures = new Set<Texture>();
      scene.traverse((o) => { if (!(o instanceof Mesh)) return; geometries.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : [o.material]) { materials.add(m); for (const v of Object.values(m)) if (v && (v as Texture).isTexture) textures.add(v as Texture); } });
      for (const g of geometries) g.dispose(); // flags stay: a compiled plan that outlives the offer must still skip them
      for (const m of materials) m.dispose();
      for (const t of textures) t.dispose();
      scene.clear();
    },
  };
}

/** Marks what a compiled mesh shares with its source, so the compiled plan will not free it. */
export function markShared(mesh: Mesh): void {
  mesh.geometry.userData[SHARED_FLAG] = true;
  for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) for (const v of Object.values(m)) if (v && (v as Texture).isTexture) (v as Texture).userData[SHARED_FLAG] = true;
}
