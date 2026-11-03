import * as THREE from 'three';
import { createContactShadow, CONTACT_LAYER, type ContactShadow } from './contact-shadow';
import { createStudioEnvironment, type StudioEnvironment } from './studio-environment';
import type { CinemaSettings } from './quality';
import { PREMIUM_STUDIO } from '../visual-foundry/premium-look';
import type { MachineVisuals } from './visual-provider';

/** `interactive`: the original studio. `presentation`: the premium set (PREMIUM_STUDIO: environment with architecture, key/rim/kick lights, floor pool, polished floor). */
export type StageProfile = 'interactive' | 'presentation';

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
  readonly profile: StageProfile;
  /** switches the set between the two profiles; reversible and idempotent, extra lights and the premium environment are created on demand and released */
  applyProfile(profile: StageProfile): void;
  /** call after the machine's materials were swapped (premium look on/off) so the mirrored copy shows the same finish */
  materialsChanged(): void;
  attach(visuals: MachineVisuals): void;
  /** false when the sample on stage has no pose: the machine, its mirrored copy and its contact shadow are hidden together (nothing is drawn from an older pose) */
  setMachineVisible(visible: boolean): void;
  readonly machineVisible: boolean;
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

  let visuals: MachineVisuals | undefined; const mirrorParts = new Map<string, THREE.Object3D>(); let mirrorOn = settings.mirror; let contactOn = settings.contact;
  let machineVisible = true; let radius = 6; let center = new THREE.Vector3(4, 1.5, 0); let poseDirty = true;

  const enableLayers = (root: THREE.Object3D) => root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.layers.enable(CONTACT_LAYER); o.castShadow = true; o.receiveShadow = true; } });
  // Everything under the machine root that is not a canonical part group (the Foundry's flexible hoses) is mirrored too; their geometry is replaced in
  // place when the hoses are re-routed, so the copy follows the original's geometry on every sync.
  const extras: Array<{ original: THREE.Object3D; copy: THREE.Object3D }> = [];
  function buildMirror() {
    mirrorRoot.clear(); mirrorParts.clear(); extras.length = 0; if (!visuals) return;
    const strip = (copy: THREE.Object3D) => copy.traverse((o) => { o.layers.disableAll(); o.layers.enable(0); o.castShadow = false; o.receiveShadow = false; o.userData = { ...o.userData, mirror: true }; });
    const owned = new Set<THREE.Object3D>(visuals.parts.values());
    for (const [id, part] of visuals.parts) { const copy = part.clone(true); strip(copy); mirrorRoot.add(copy); mirrorParts.set(id, copy); }
    for (const child of visuals.root.children) { if (owned.has(child)) continue; const copy = child.clone(true); strip(copy); mirrorRoot.add(copy); extras.push({ original: child, copy }); }
  }
  function syncMirror() {
    if (!visuals) return;
    for (const [id, part] of visuals.parts) { const copy = mirrorParts.get(id); if (copy) { copy.position.copy(part.position); copy.quaternion.copy(part.quaternion); copy.scale.copy(part.scale); } }
    for (const { original, copy } of extras) { const a: THREE.Object3D[] = []; const b: THREE.Object3D[] = []; original.traverse((o) => a.push(o)); copy.traverse((o) => b.push(o)); a.forEach((o, i) => { const m = o as THREE.Mesh; const c = b[i] as THREE.Mesh | undefined; if (m.isMesh && c && c.geometry !== m.geometry) c.geometry = m.geometry; }); }
  }

  // --- profiles: everything the premium set changes is recorded first, so that `interactive` restores it exactly
  const backdropUniforms = (backdrop.material as THREE.ShaderMaterial).uniforms as { horizon: { value: THREE.Color }; zenith: { value: THREE.Color } };
  const floorMaterial = floor.material as THREE.MeshStandardMaterial; const fog = scene.fog as THREE.Fog;
  const base = {
    horizon: backdropUniforms.horizon.value.clone(), zenith: backdropUniforms.zenith.value.clone(), fog: fog.color.clone(), fogNear: fog.near, fogFar: fog.far, floorColor: floorMaterial.color.clone(), floorRoughness: floorMaterial.roughness, floorMetalness: floorMaterial.metalness,
    key: { color: key.color.clone(), intensity: key.intensity }, rim: { color: rim.color.clone(), intensity: rim.intensity }, fill: { sky: fill.color.clone(), ground: fill.groundColor.clone(), intensity: fill.intensity }, envIntensity: settings.environmentIntensity,
  };
  let premiumEnvironment: StudioEnvironment | undefined; let kick: THREE.DirectionalLight | undefined; let pool: THREE.SpotLight | undefined; let profile: StageProfile = 'interactive'; let mirrorOpacity = 0.86;
  const color = (hex: string) => new THREE.Color().setStyle(hex, THREE.SRGBColorSpace);
  function applyProfile(next: StageProfile) {
    if (next === profile) return; profile = next;
    if (next === 'presentation') {
      const P = PREMIUM_STUDIO;
      premiumEnvironment ??= createStudioEnvironment(renderer, P.environment);
      scene.environment = premiumEnvironment.texture; scene.environmentIntensity = P.environmentIntensity;
      backdropUniforms.horizon.value.copy(color(P.backdrop.horizon)); backdropUniforms.zenith.value.copy(color(P.backdrop.zenith)); fog.color.copy(color(P.backdrop.horizon)); fog.near = 14; fog.far = 52;
      floorMaterial.color.copy(color(P.floor.color)); floorMaterial.roughness = P.floor.roughness; floorMaterial.metalness = P.floor.metalness; mirrorOpacity = P.floor.mirrorOpacity;
      key.color.copy(color(P.lights.key.color)); key.intensity = P.lights.key.intensity; rim.color.copy(color(P.lights.rim.color)); rim.intensity = P.lights.rim.intensity;
      fill.color.copy(color(P.lights.fill.sky)); fill.groundColor.copy(color(P.lights.fill.ground)); fill.intensity = P.lights.fill.intensity;
      kick = new THREE.DirectionalLight(color(P.lights.kick.color), P.lights.kick.intensity); kick.name = 'kick'; scene.add(kick, kick.target);
      pool = new THREE.SpotLight(color(P.lights.floorPool.color), P.lights.floorPool.intensity, 0, P.lights.floorPool.angle, P.lights.floorPool.penumbra, 2); pool.name = 'floor-pool'; scene.add(pool, pool.target);
      place();
    } else {
      scene.environment = environment.texture; scene.environmentIntensity = base.envIntensity;
      backdropUniforms.horizon.value.copy(base.horizon); backdropUniforms.zenith.value.copy(base.zenith); fog.color.copy(base.fog); fog.near = base.fogNear; fog.far = base.fogFar;
      floorMaterial.color.copy(base.floorColor); floorMaterial.roughness = base.floorRoughness; floorMaterial.metalness = base.floorMetalness; mirrorOpacity = 0.86;
      key.color.copy(base.key.color); key.intensity = base.key.intensity; rim.color.copy(base.rim.color); rim.intensity = base.rim.intensity;
      fill.color.copy(base.fill.sky); fill.groundColor.copy(base.fill.ground); fill.intensity = base.fill.intensity;
      for (const l of [kick, pool]) if (l) { scene.remove(l, l.target); l.dispose(); }
      kick = undefined; pool = undefined;
      key.position.copy(center).add(new THREE.Vector3(-0.55, 0.85, 0.5).normalize().multiplyScalar(radius * 3));
      rim.position.copy(center).add(new THREE.Vector3(0.6, 0.35, -0.75).normalize().multiplyScalar(radius * 3));
    }
    floorMaterial.opacity = mirrorOn ? mirrorOpacity : 1; floorMaterial.needsUpdate = true; contact.markDirty();
  }
  /** positions the profile's extra lights around the machine (called on profile change and on fit) */
  function place() {
    if (kick) { kick.position.copy(center).add(new THREE.Vector3(...PREMIUM_STUDIO.lights.kick.direction).normalize().multiplyScalar(radius * 3)); kick.target.position.copy(center); }
    if (pool) { pool.position.set(center.x, PREMIUM_STUDIO.lights.floorPool.height * (radius / 6), center.z - radius * 0.2); pool.target.position.set(center.x, 0, center.z); }
    // the key and rim follow the profile's directions
    if (profile === 'presentation') {
      key.position.copy(center).add(new THREE.Vector3(...PREMIUM_STUDIO.lights.key.direction).normalize().multiplyScalar(radius * 3));
      rim.position.copy(center).add(new THREE.Vector3(...PREMIUM_STUDIO.lights.rim.direction).normalize().multiplyScalar(radius * 3));
    }
  }
  function materialsChanged() {
    if (!visuals) return;
    for (const [id, part] of visuals.parts) { const copy = mirrorParts.get(id); if (!copy) continue; const a: THREE.Object3D[] = []; const b: THREE.Object3D[] = []; part.traverse((o) => a.push(o)); copy.traverse((o) => b.push(o)); a.forEach((o, i) => { const m = o as THREE.Mesh; const c = b[i] as THREE.Mesh | undefined; if (m.isMesh && c) c.material = m.material; }); }
    for (const { original, copy } of extras) { const a: THREE.Object3D[] = []; const b: THREE.Object3D[] = []; original.traverse((o) => a.push(o)); copy.traverse((o) => b.push(o)); a.forEach((o, i) => { const m = o as THREE.Mesh; const c = b[i] as THREE.Mesh | undefined; if (m.isMesh && c) c.material = m.material; }); }
    contact.markDirty();
  }

  return {
    scene, lights: { key, rim, fill }, floor, contact, environment, get profile() { return profile; }, applyProfile, materialsChanged,
    attach(next) { if (visuals) scene.remove(visuals.root); visuals = next; scene.add(next.root); enableLayers(next.root); buildMirror(); mirrorRoot.visible = mirrorOn && machineVisible; next.root.visible = machineVisible; poseDirty = true; },
    setMachineVisible(visible) { machineVisible = visible; if (visuals) visuals.root.visible = visible; mirrorRoot.visible = visible && mirrorOn; contact.object.visible = visible && contactOn; if (visible) { poseDirty = true; contact.markDirty(); } },
    get machineVisible() { return machineVisible; },
    poseChanged() { poseDirty = true; syncMirror(); contact.markDirty(); },
    fit(bounds) {
      center = bounds.getCenter(new THREE.Vector3()); radius = Math.max(2, bounds.getBoundingSphere(new THREE.Sphere()).radius);
      key.position.copy(center).add(new THREE.Vector3(-0.55, 0.85, 0.5).normalize().multiplyScalar(radius * 3)); key.target.position.copy(center);
      const c = key.shadow.camera; c.left = -radius * 1.15; c.right = radius * 1.15; c.top = radius * 1.15; c.bottom = -radius * 1.15; c.near = radius * 0.5; c.far = radius * 7; c.updateProjectionMatrix();
      key.shadow.bias = -0.0003; key.shadow.normalBias = 0.03;
      rim.position.copy(center).add(new THREE.Vector3(0.6, 0.35, -0.75).normalize().multiplyScalar(radius * 3)); rim.target.position.copy(center);
      contact.fit(bounds); place(); poseDirty = true;
    },
    apply(s) {
      key.castShadow = s.shadows; key.shadow.mapSize.set(s.shadowMapSize, s.shadowMapSize); key.shadow.radius = s.softShadowRadius;
      if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
      scene.environmentIntensity = s.environmentIntensity; mirrorOn = s.mirror; mirrorRoot.visible = s.mirror && machineVisible; contactOn = s.contact; contact.setEnabled(s.contact); contact.object.visible = s.contact && machineVisible;
      floor.material = floor.material as THREE.MeshStandardMaterial; (floor.material as THREE.MeshStandardMaterial).opacity = s.mirror ? mirrorOpacity : 1; (floor.material as THREE.MeshStandardMaterial).needsUpdate = true;
    },
    prepare(renderer) { if (poseDirty) { syncMirror(); poseDirty = false; } contact.update(renderer, scene); },
    dispose() {
      contact.dispose(); environment.dispose(); premiumEnvironment?.dispose(); for (const l of [kick, pool]) if (l) l.dispose();
      for (const o of [backdrop, floor]) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
      mirrorRoot.clear(); scene.clear();
    },
  };
}
