import * as THREE from 'three';

/**
 * An isolated copy of a scene for a render that takes time (the tiled high-resolution export).
 *
 * The export yields between tiles, and the editor stays usable meanwhile: undo/redo, previews, selection and GSAP tweens can rebuild or move
 * things. Locking every one of those paths is fragile, so the export renders a copy that nothing else can reach: objects are cloned, and so are
 * their geometries, materials and lights (with the light targets re-linked inside the copy). Textures are shared but read-only for the duration.
 * `exclude` leaves out editing chrome (gizmo, selection outline) instead of toggling its visibility in the live scene.
 *
 * `dispose()` releases only what the snapshot created.
 */
export type SceneSnapshot = { scene: THREE.Scene; objects: number; dispose(): void };

type Renderable = THREE.Object3D & { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };

export function snapshotScene(source: THREE.Scene, options: { exclude?: Iterable<THREE.Object3D> } = {}): SceneSnapshot {
  const skip = new Set(options.exclude ?? []);
  const copy = new THREE.Scene();
  copy.background = source.background instanceof THREE.Color ? source.background.clone() : source.background;
  copy.environment = source.environment; // read-only texture; the export swaps the pointer on this copy, never on the live scene
  copy.environmentIntensity = source.environmentIntensity; copy.backgroundIntensity = source.backgroundIntensity; copy.backgroundBlurriness = source.backgroundBlurriness;
  copy.fog = source.fog ? source.fog.clone() : null;
  copy.matrixWorld.copy(source.matrixWorld);

  const geometries = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  const materials = new Map<THREE.Material, THREE.Material>();
  const geometry = (g: THREE.BufferGeometry) => { let c = geometries.get(g); if (!c) { c = g.clone(); geometries.set(g, c); } return c; };
  const material = (m: THREE.Material) => { let c = materials.get(m); if (!c) { c = m.clone(); materials.set(m, c); } return c; };

  let objects = 0;
  for (const child of source.children) {
    if (skip.has(child) || child.userData.snapshotExclude) continue;
    const originals: THREE.Object3D[] = []; const clones: THREE.Object3D[] = [];
    const clone = child.clone(true);
    child.traverse((o) => originals.push(o)); clone.traverse((o) => clones.push(o));
    const pair = new Map<THREE.Object3D, THREE.Object3D>(originals.map((o, i) => [o, clones[i]!]));
    // nested exclusions (e.g. a gizmo inside a group) are removed from the copy
    for (const [o, c] of pair) if (o !== child && (skip.has(o) || o.userData.snapshotExclude)) c.removeFromParent();
    for (const [o, c] of pair) {
      const from = o as Renderable; const to = c as Renderable;
      if (from.geometry) to.geometry = geometry(from.geometry);
      if (from.material) to.material = Array.isArray(from.material) ? from.material.map(material) : material(from.material);
      const light = o as THREE.DirectionalLight | THREE.SpotLight;
      if ((light as { isDirectionalLight?: boolean }).isDirectionalLight || (light as { isSpotLight?: boolean }).isSpotLight) {
        const target = pair.get(light.target);
        if (target) (c as THREE.DirectionalLight).target = target; else copy.add((c as THREE.DirectionalLight).target); // target outside the cloned tree: keep it in the copy
      }
    }
    copy.add(clone); objects += clones.length;
  }
  copy.updateMatrixWorld(true);
  let disposed = false;
  return {
    scene: copy, objects,
    dispose() {
      if (disposed) return; disposed = true;
      for (const c of geometries.values()) c.dispose();
      for (const c of materials.values()) c.dispose();
      copy.traverse((o) => (o as THREE.Light).dispose?.());
      copy.clear();
    },
  };
}
