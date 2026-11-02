import * as THREE from 'three';
import { createContactShadow, CONTACT_LAYER, type ContactShadow } from './contact-shadow';
import { createStudioEnvironment, type StudioEnvironment } from './studio-environment';
import type { CinemaSettings } from './quality';
import type { MachineVisuals } from './visual-provider';

/**
 * The studio set: seamless backdrop that fades the floor into the dark, a glossy floor that shows a faint mirrored machine, a baked studio
 * environment for reflections, three lights (shadow-casting key, cool rim, warm low fill), and the contact shadow.
 * The machine is attached as a `MachineVisuals`; the stage never edits its geometry.
 */
const HORIZON = '#252a32'; const ZENITH = '#08090b';

export type StudioStage = {
  readonly scene: THREE.Scene;
  readonly lights: { key: THREE.DirectionalLight; rim: THREE.DirectionalLight; fill: THREE.HemisphereLight };
  readonly floor: THREE.Mesh;
  readonly contact: ContactShadow;
  readonly environment: StudioEnvironment;
  attach(visuals: MachineVisuals): void;
  /** call after poses changed: syncs the mirrored copy and refreshes the contact shadow */
  poseChanged(): void;
  fit(bounds: THREE.Box3): void;
  apply(settings: CinemaSettings): void;
  /** per frame, before rendering: contact shadow if the pose changed */
  prepare(renderer: THREE.WebGLRenderer): void;
  dispose(): void;
};

export function createStudioStage(renderer: THREE.WebGLRenderer, settings: CinemaSettings): StudioStage {
  const scene = new THREE.Scene(); scene.name = 'cinema-stage';
  scene.fog = new THREE.Fog(HORIZON, 30, 90);
  const environment = createStudioEnvironment(renderer);
  scene.environment = environment.texture; scene.environmentIntensity = settings.environmentIntensity;

  const backdrop = new THREE.Mesh(
    new THREE.SphereGeometry(110, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { horizon: { value: new THREE.Color(HORIZON) }, zenith: { value: new THREE.Color(ZENITH) } },
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 horizon; uniform vec3 zenith; varying vec3 vD; void main(){ float h = clamp(vD.y * 1.6, 0.0, 1.0); vec3 c = mix(horizon, zenith, pow(h, 0.7)); gl_FragColor = vec4(c, 1.0); }',
    }),
  );
  backdrop.name = 'backdrop'; backdrop.renderOrder = -10; backdrop.layers.set(0); scene.add(backdrop);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(70, 96).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#1a1d22', roughness: 0.46, metalness: 0.05, transparent: true, opacity: 0.88 }),
  );
  floor.name = 'floor'; floor.receiveShadow = true; scene.add(floor);

  const key = new THREE.DirectionalLight('#fff1e0', 4.2); key.name = 'key'; key.castShadow = true;
  const rim = new THREE.DirectionalLight('#bcd4ff', 3.0); rim.name = 'rim';
  const fill = new THREE.HemisphereLight('#aab6c8', '#201a14', 0.55); fill.name = 'fill';
  scene.add(key, key.target, rim, rim.target, fill);

  const contact = createContactShadow(settings.contactResolution); scene.add(contact.object);
  const mirrorRoot = new THREE.Group(); mirrorRoot.name = 'mirror'; mirrorRoot.scale.y = -1; scene.add(mirrorRoot);

  let visuals: MachineVisuals | undefined; const mirrorParts = new Map<string, THREE.Object3D>(); let mirrorOn = settings.mirror;
  let radius = 6; let center = new THREE.Vector3(4, 1.5, 0); let poseDirty = true;

  const enableLayers = (root: THREE.Object3D) => root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.layers.enable(CONTACT_LAYER); o.castShadow = true; o.receiveShadow = true; } });
  function buildMirror() {
    mirrorRoot.clear(); mirrorParts.clear(); if (!visuals) return;
    for (const [id, part] of visuals.parts) {
      const copy = part.clone(true); copy.traverse((o) => { o.layers.disableAll(); o.layers.enable(0); o.castShadow = false; o.receiveShadow = false; o.userData = { ...o.userData, mirror: true }; });
      mirrorRoot.add(copy); mirrorParts.set(id, copy);
    }
  }
  function syncMirror() { if (!visuals) return; for (const [id, part] of visuals.parts) { const copy = mirrorParts.get(id); if (copy) { copy.position.copy(part.position); copy.quaternion.copy(part.quaternion); copy.scale.copy(part.scale); } } }

  return {
    scene, lights: { key, rim, fill }, floor, contact, environment,
    attach(next) { if (visuals) scene.remove(visuals.root); visuals = next; scene.add(next.root); enableLayers(next.root); buildMirror(); mirrorRoot.visible = mirrorOn; poseDirty = true; },
    poseChanged() { poseDirty = true; syncMirror(); contact.markDirty(); },
    fit(bounds) {
      center = bounds.getCenter(new THREE.Vector3()); radius = Math.max(2, bounds.getBoundingSphere(new THREE.Sphere()).radius);
      key.position.copy(center).add(new THREE.Vector3(-0.55, 0.85, 0.5).normalize().multiplyScalar(radius * 3)); key.target.position.copy(center);
      const c = key.shadow.camera; c.left = -radius * 1.15; c.right = radius * 1.15; c.top = radius * 1.15; c.bottom = -radius * 1.15; c.near = radius * 0.5; c.far = radius * 7; c.updateProjectionMatrix();
      key.shadow.bias = -0.0003; key.shadow.normalBias = 0.03;
      rim.position.copy(center).add(new THREE.Vector3(0.6, 0.35, -0.75).normalize().multiplyScalar(radius * 3)); rim.target.position.copy(center);
      contact.fit(bounds); poseDirty = true;
    },
    apply(s) {
      key.castShadow = s.shadows; key.shadow.mapSize.set(s.shadowMapSize, s.shadowMapSize); key.shadow.radius = s.softShadowRadius;
      if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
      scene.environmentIntensity = s.environmentIntensity; mirrorOn = s.mirror; mirrorRoot.visible = s.mirror; contact.setEnabled(s.contact);
      floor.material = floor.material as THREE.MeshStandardMaterial; (floor.material as THREE.MeshStandardMaterial).opacity = s.mirror ? 0.86 : 1; (floor.material as THREE.MeshStandardMaterial).needsUpdate = true;
    },
    prepare(renderer) { if (poseDirty) { syncMirror(); poseDirty = false; } contact.update(renderer, scene); },
    dispose() {
      contact.dispose(); environment.dispose();
      for (const o of [backdrop, floor]) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
      mirrorRoot.clear(); scene.clear();
    },
  };
}
