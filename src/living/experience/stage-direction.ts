/**
 * Premium art direction applied on top of the cinema stage, from outside and reversibly. Presentation only: it
 * recolours the Visual Foundry's shared materials by key, swaps the mirror floor for a matte concrete pool of light,
 * adds one overhead spot and a few dark architectural columns. No geometry, pose or engineering value is touched.
 *
 * Reference: premium studio photography of graphite machines on dark concrete under a single hard pool of light.
 * UNFOLD reading: the machine is graphite and Paper-free; the only orange on screen is attention (`fold`), never paint.
 */
import * as THREE from 'three';
import type { CinemaRuntime } from '../cinema';

export type LiveryName = 'graphite' | 'paper';

/** sRGB hex → linear colour; values come from the Void/Paper palette or are physical machine colours. */
const c = (hex: string) => new THREE.Color().setStyle(hex, THREE.SRGBColorSpace);

type MaterialOverride = { color?: THREE.Color; roughness?: number; metalness?: number; clearcoat?: number; clearcoatRoughness?: number; envMapIntensity?: number };

/** Graphite livery: deep painted graphite body with a crisp clear coat (catches the softboxes as long highlights). */
export const LIVERIES: Record<LiveryName, Partial<Record<string, MaterialOverride>>> = {
  graphite: {
    paint: { color: c('#3A3B3E'), roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.25 },
    paintDark: { color: c('#17191C'), roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.18 },
    castDark: { color: c('#3E4045'), roughness: 0.5 },
    shoe: { color: c('#34363A'), roughness: 0.55 },
    chrome: { envMapIntensity: 1.6 },
    glass: { envMapIntensity: 1.6 },
  },
  paper: {},
};

export type Direction = { livery: LiveryName; dispose(): void; setMachineGhost(partIds: Iterable<string>): void; setReveal(fraction: number | null): void };

export function applyDirection(runtime: CinemaRuntime, livery: LiveryName = 'graphite'): Direction {
  const restoreMats: Array<() => void> = [];
  const machineMaterials = new Map<string, THREE.MeshPhysicalMaterial>();
  runtime.visuals.root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshPhysicalMaterial | undefined;
    if ((o as THREE.Mesh).isMesh && m && typeof m.userData?.materialKey === 'string') machineMaterials.set(m.userData.materialKey as string, m);
  });
  for (const [key, mat] of machineMaterials) {
    const o = LIVERIES[livery][key]; if (!o) continue;
    const before = { color: mat.color.clone(), roughness: mat.roughness, metalness: mat.metalness, clearcoat: mat.clearcoat, clearcoatRoughness: mat.clearcoatRoughness, envMapIntensity: mat.envMapIntensity };
    if (o.color) mat.color.copy(o.color);
    for (const k of ['roughness', 'metalness', 'clearcoat', 'clearcoatRoughness', 'envMapIntensity'] as const) if (o[k] !== undefined) mat[k] = o[k]!;
    restoreMats.push(() => { mat.color.copy(before.color); Object.assign(mat, { roughness: before.roughness, metalness: before.metalness, clearcoat: before.clearcoat, clearcoatRoughness: before.clearcoatRoughness, envMapIntensity: before.envMapIntensity }); });
  }

  // stage: matte concrete instead of a mirror, a single hard overhead pool, a few dark columns far behind
  const scene = runtime.stage.scene;
  runtime.ablate({ mirror: false });
  // the stage floor is a semi-transparent gloss tuned for the mirror; hide it and lay an opaque matte concrete floor
  runtime.stage.floor.visible = false;
  const concrete = new THREE.Mesh(new THREE.CircleGeometry(70, 96).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: c('#121315'), roughness: 0.88, metalness: 0, envMapIntensity: 0.12 }));
  concrete.name = 'experience:concrete'; concrete.receiveShadow = true; concrete.position.y = -0.0005;
  // light: a single hard overhead pool does the work; the stage's even key and fill drop so the floor falls to dark
  const lights = runtime.stage.lights;
  const lightBefore = { key: lights.key.intensity, fill: lights.fill.intensity, rim: lights.rim.intensity };
  lights.key.intensity = lightBefore.key * 0.35; lights.fill.intensity = lightBefore.fill * 0.4; lights.rim.intensity = lightBefore.rim * 1.1;
  const added = new THREE.Group(); added.name = 'experience:direction';
  const box = new THREE.Box3().setFromObject(runtime.visuals.root);
  const centre = box.getCenter(new THREE.Vector3()); const size = box.getSize(new THREE.Vector3());
  const pool = new THREE.SpotLight(0xfff3e6, 320, 0, 0.3, 0.6, 1.8); // ≈ 4 m pool at floor level
  pool.castShadow = true; pool.shadow.mapSize.set(1024, 1024); pool.shadow.bias = -0.0004; pool.shadow.radius = 4;
  pool.position.set(centre.x + size.x * 0.15, centre.y + 14, centre.z - 2.5); pool.target.position.set(centre.x, 0, centre.z);
  added.add(pool, pool.target);
  const columnMat = new THREE.MeshStandardMaterial({ color: c('#111317'), roughness: 0.95 });
  for (const x of [-9, -2.5, 4, 10.5]) { const col = new THREE.Mesh(new THREE.BoxGeometry(1.1, 22, 1.1), columnMat); col.position.set(centre.x + x, 11, centre.z + 16); added.add(col); }
  added.add(concrete);
  scene.add(added);

  // presentation helpers for the transition and the lab: ghost parts by canonical id, reveal by a rising clip plane
  const ghost = new THREE.MeshBasicMaterial({ color: c('#9AA0A8'), transparent: true, opacity: 0.1, depthWrite: false });
  const ghosted = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  const clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  runtime.renderer.localClippingEnabled = true;
  const allMachine = [...machineMaterials.values()];
  const poke = () => runtime.controls.dispatchEvent({ type: 'change' });

  return {
    livery,
    setMachineGhost(partIds) {
      for (const [m, mat] of ghosted) m.material = mat; ghosted.clear();
      for (const id of partIds) runtime.visuals.parts.get(id)?.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { ghosted.set(m, m.material); m.material = ghost; } });
      poke();
    },
    setReveal(fraction) {
      if (fraction === null) { for (const m of allMachine) m.clippingPlanes = null; ghost.clippingPlanes = null; poke(); return; }
      clip.constant = box.min.y + (box.max.y - box.min.y + 0.05) * fraction - 0.01;
      for (const m of allMachine) if (m.clippingPlanes?.[0] !== clip) { m.clippingPlanes = [clip]; m.needsUpdate = true; }
      ghost.clippingPlanes = [clip];
      poke();
    },
    dispose() {
      for (const r of restoreMats) r();
      for (const [m, mat] of ghosted) m.material = mat;
      for (const m of allMachine) m.clippingPlanes = null;
      runtime.stage.floor.visible = true; (concrete.material as THREE.Material).dispose();
      runtime.ablate({ mirror: true });
      lights.key.intensity = lightBefore.key; lights.fill.intensity = lightBefore.fill; lights.rim.intensity = lightBefore.rim;
      pool.shadow.map?.dispose();
      added.removeFromParent(); columnMat.dispose(); ghost.dispose();
      added.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); });
    },
  };
}
