/** Stage moves for the experience: the drawing as a hinged plane in the scene, and the elevation → hero camera blend. Presentation only. */
import * as THREE from 'three';
import type { CinemaRuntime } from '../cinema';
import type { DrawingResult } from './drawing';

/** The drawing as a plane in the scene, hinged on its bottom edge at floor level, registered with the elevation camera. */
export function buildSheet3d(runtime: CinemaRuntime, drawing: DrawingResult) {
  const tex = new THREE.TextureLoader().load(drawing.dataUrl, () => runtime.controls.dispatchEvent({ type: 'change' }));
  tex.colorSpace = THREE.SRGBColorSpace;
  const { widthM, heightM, centre } = drawing.projection;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(widthM, heightM), mat);
  plane.rotation.y = Math.PI; // faces −Z (the elevation camera); the image reads correctly from there
  const bottom = centre[1] - heightM / 2;
  plane.position.set(0, heightM / 2, 0);
  const hinge = new THREE.Group(); hinge.name = 'experience:sheet'; hinge.position.set(centre[0], bottom + 0.004, SHEET_Z); hinge.add(plane);
  runtime.stage.scene.add(hinge);
  return {
    set(angle: number, opacity: number) { hinge.rotation.x = -angle; mat.opacity = opacity; hinge.visible = opacity > 0.01; runtime.controls.dispatchEvent({ type: 'change' }); },
  };
}
const SHEET_Z = -1.9;

/** Elevation camera (registered with the sheet) and the hero three-quarter view; blend 0 → 1. */
export function cameraViews(runtime: CinemaRuntime, drawing: DrawingResult) {
  const cam = runtime.camera; const { widthM, heightM, centre } = drawing.projection;
  const dist = 60;
  const sideFov = (2 * Math.atan(heightM / 2 / dist) * 180) / Math.PI;
  const side = { pos: new THREE.Vector3(centre[0], centre[1], SHEET_Z - dist), target: new THREE.Vector3(centre[0], centre[1], SHEET_Z), fov: sideFov };
  const box = new THREE.Box3().setFromObject(runtime.visuals.root); const c = box.getCenter(new THREE.Vector3());
  // hero: low, three-quarter from the front-left, arm on the left of frame (the reference's composition)
  const heroTarget = new THREE.Vector3(c.x - 0.2, c.y - 0.35, c.z);
  const heroDir = new THREE.Vector3(0.62, 0.12, -0.78).normalize();
  // portrait screens: keep the whole machine width inside the horizontal field of view
  const aspect = Math.max(0.3, runtime.renderer.domElement.clientWidth / Math.max(1, runtime.renderer.domElement.clientHeight));
  const hfov = 2 * Math.atan(Math.tan((30 * Math.PI) / 360) * aspect);
  const widthFit = (box.getSize(new THREE.Vector3()).x * 0.55) / Math.tan(hfov / 2);
  const hero = { pos: heroTarget.clone().addScaledVector(heroDir, Math.max(15.5, widthFit)), target: heroTarget, fov: 30 };
  void widthM;
  const maxBefore = runtime.controls.maxDistance;
  return {
    blend(k: number) {
      // the registered elevation camera sits far away; lift the orbit limit only while travelling, restore it at the hero view
      runtime.controls.maxDistance = k < 1 ? Infinity : Math.max(maxBefore, hero.pos.distanceTo(hero.target) * 1.25);
      // travel on a wide arc (through a point pulled away from the machine) so the camera never crosses it
      const mid = side.pos.clone().lerp(hero.pos, 0.5).add(new THREE.Vector3(0, 3, -8));
      const a = side.pos.clone().lerp(mid, k), b = mid.clone().lerp(hero.pos, k);
      cam.position.copy(a.lerp(b, k));
      runtime.controls.target.copy(side.target.clone().lerp(hero.target, k));
      cam.fov = side.fov + (hero.fov - side.fov) * k; cam.updateProjectionMatrix();
      cam.lookAt(runtime.controls.target);
      runtime.controls.update(); runtime.controls.dispatchEvent({ type: 'change' });
    },
  };
}
