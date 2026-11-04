import {
  ACESFilmicToneMapping, Box3, CircleGeometry, Color, DirectionalLight, Fog, Group, HemisphereLight, Mesh, MeshStandardMaterial, PCFSoftShadowMap,
  PerspectiveCamera, Scene, ShaderMaterial, BackSide, SphereGeometry, Vector3, type Object3D, type WebGLRenderer,
} from 'three';
import { createStudioEnvironment, type StudioEnvironment } from '../living/cinema/studio-environment';
import { CONTACT_LAYER, createContactShadow, type ContactShadow } from '../living/cinema/contact-shadow';
import { blendPoseOrbital, type CameraPose, type Vec3 } from '../living/cinema/choreography';
import { analyzeFrame, verifyFrame, type FrameAnalysis, type FrameVerdict, type RgbaFrame } from './frame-analysis';
import { collectWorldPoints, fitCamera, heroAzimuth, normalizeForPresentation, SHOT_DIRECTIONS, type FittedPose, type FramingShotId, type PresentationStage } from './framing';

/**
 * Presentation stage for the V2 harness. It owns light, floor, environment, camera and capture; it never edits a plan or the compiled geometry.
 *
 * Reused from the Cinema: the procedural studio environment (PMREM soft boxes and strips), the contact shadow, and the orbital camera blend. Not reused:
 * the Cinema's machine-specific `MachineVisuals` stage, post chain and shots, which are authored for one articulated machine (documented in INTEGRATION.md).
 * The assembly is normalised to a fixed presentation size, so every constant here (shadow volume, fog, floor) is independent of the plan's units.
 */
export const PRESENTATION_SIZE = 4;
const HORIZON = '#2a303a', ZENITH = '#12151a';

export type CaptureResult = { dataUrl: string; analysis: FrameAnalysis; verdict: FrameVerdict };

export type StageV2 = {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly environment: StudioEnvironment;
  /** Places a compiled root on the stage (normalised, on the floor) and frames it with the hero shot. */
  setAssembly(root: Group): { presentationScale: number };
  clearAssembly(): void;
  /** Pose of a shot or of a set of component ids (ids framed through their own vertices). */
  poseFor(shot: FramingShotId | { componentIds: string[] }): FittedPose;
  setPose(pose: FittedPose): void;
  /** Animated transition between two poses, swinging around the object (never through it). Returns false when finished. */
  transition(from: FittedPose, to: FittedPose, u: number): void;
  resize(width: number, height: number): void;
  render(): void;
  /** Renders with and without the object in the same task, reads the pixels, and returns a PNG taken from the very same buffer. */
  captureVerified(): CaptureResult;
  setContentVisible(visible: boolean): void;
  /** Key-light shadow and contact shadow on or off (measurement mode turns them off so only the object differs between two frames). */
  setShadows(enabled: boolean): void;
  readonly contentRoot: Group;
  dispose(): void;
};

export function createStageV2(renderer: WebGLRenderer): StageV2 {
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.toneMapping = ACESFilmicToneMapping; renderer.toneMappingExposure = 0.88; renderer.outputColorSpace = 'srgb';
  const scene = new Scene(); scene.fog = new Fog(HORIZON, 14, 44);
  const environment = createStudioEnvironment(renderer); scene.environment = environment.texture; scene.environmentIntensity = 0.95;

  const backdrop = new Mesh(new SphereGeometry(90, 40, 20), new ShaderMaterial({
    side: BackSide, depthWrite: false, fog: false,
    uniforms: { horizon: { value: new Color(HORIZON) }, zenith: { value: new Color(ZENITH) } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 horizon; uniform vec3 zenith; varying vec3 vD; void main(){ float h = clamp(vD.y * 1.2, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, zenith, pow(h, 0.6)), 1.0);\n#include <colorspace_fragment>\n}',
  }));
  backdrop.name = 'backdrop'; backdrop.renderOrder = -10; backdrop.userData.framingIgnore = true; scene.add(backdrop);
  const floor = new Mesh(new CircleGeometry(60, 96).rotateX(-Math.PI / 2), new MeshStandardMaterial({ color: '#1b1f25', roughness: 0.82, metalness: 0, envMapIntensity: 0.3 }));
  floor.name = 'floor'; floor.receiveShadow = true; floor.userData.framingIgnore = true; scene.add(floor);

  const key = new DirectionalLight('#fff1e0', 3.0); key.name = 'key'; key.position.set(-6, 10, 7); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048); key.shadow.camera.left = -7; key.shadow.camera.right = 7; key.shadow.camera.top = 7; key.shadow.camera.bottom = -7; key.shadow.camera.near = 1; key.shadow.camera.far = 30; key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
  const rim = new DirectionalLight('#bcd4ff', 2.4); rim.name = 'rim'; rim.position.set(8, 5, -9);
  const fill = new HemisphereLight('#aab6c8', '#201a14', 0.5);
  scene.add(key, key.target, rim, rim.target, fill);

  const contentRoot = new Group(); contentRoot.name = 'content'; scene.add(contentRoot);
  const contact: ContactShadow = createContactShadow(512); contentRoot.add(contact.object);
  const camera = new PerspectiveCamera(30, 1, 0.1, 200); let aspect = 1;
  let presentation: PresentationStage | undefined, contentVisible = true, shadowsOn = true;
  const applyVisibility = () => { if (presentation) presentation.wrapper.visible = contentVisible; contact.object.visible = contentVisible && shadowsOn; key.castShadow = shadowsOn; };

  const boundsOf = (points: Vector3[]) => new Box3().setFromPoints(points);
  const stage: StageV2 = {
    scene, camera, environment, contentRoot,
    setAssembly(root) {
      stage.clearAssembly();
      presentation = normalizeForPresentation(root, PRESENTATION_SIZE);
      contentRoot.add(presentation.wrapper);
      root.traverse((object: Object3D) => { if (object instanceof Mesh) object.layers.enable(CONTACT_LAYER); });
      contact.fit(boundsOf(collectWorldPoints(presentation.wrapper, 20_000, (object) => object.userData.framingIgnore === true))); contact.markDirty();
      stage.setPose(stage.poseFor('hero'));
      return { presentationScale: presentation.scale };
    },
    clearAssembly() { if (presentation) { contentRoot.remove(presentation.wrapper); presentation = undefined; } },
    poseFor(target) {
      if (!presentation) throw new Error('SPATIAL_STAGE_EMPTY');
      if (typeof target === 'string') {
        const points = collectWorldPoints(presentation.wrapper), direction = SHOT_DIRECTIONS[target];
        return fitCamera(points, { aspect, ...direction, ...(target === 'hero' ? { azimuthDeg: heroAzimuth(points) } : {}) });
      }
      const wanted = new Set(target.componentIds), points: Vector3[] = [];
      presentation.wrapper.traverse((object) => { if (object.userData.spatialComponentRoot && wanted.has(object.userData.spatialEntityId as string)) points.push(...collectWorldPoints(object, 2000, (child) => child !== object && Boolean(child.userData.spatialComponentRoot))); });
      return fitCamera(points.length ? points : collectWorldPoints(presentation.wrapper), { aspect, ...SHOT_DIRECTIONS.hero });
    },
    setPose(pose) {
      camera.fov = pose.fov; camera.near = pose.near; camera.far = pose.far; camera.aspect = aspect;
      camera.position.set(...pose.position); camera.lookAt(...pose.target); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    },
    transition(from, to, u) {
      const around: Vec3 = to.target, eased = 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));
      const mixed: CameraPose = blendPoseOrbital(from, to, eased, around);
      stage.setPose({ ...mixed, near: from.near + (to.near - from.near) * eased, far: Math.max(from.far, to.far), distance: to.distance });
    },
    resize(width, height) { aspect = width / Math.max(1, height); renderer.setSize(width, height, false); camera.aspect = aspect; camera.updateProjectionMatrix(); },
    render() { contact.update(renderer, scene); renderer.setRenderTarget(null); renderer.render(scene, camera); },
    setContentVisible(visible) { contentVisible = visible; applyVisibility(); },
    setShadows(enabled) { shadowsOn = enabled; applyVisibility(); },
    captureVerified() {
      const gl = renderer.getContext(), width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
      const read = (): RgbaFrame => { const data = new Uint8Array(width * height * 4); gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data); return { data, width, height }; };
      const wasVisible = contentVisible, hadShadows = shadowsOn;
      // Object mask: shadow-free views with and without the object, so a shadow on the floor never counts as object.
      stage.setShadows(false); stage.setContentVisible(false); stage.render(); const reference = read();
      stage.setContentVisible(wasVisible); stage.render(); const mask = read(); // what is on screen: a hidden object or an empty construction step gives an empty mask
      // The frame that is shown and sent: with shadows, read and encoded in the same task as its render (the drawing buffer is still intact).
      stage.setShadows(true); stage.render(); const presented = read(); const dataUrl = renderer.domElement.toDataURL('image/png');
      stage.setContentVisible(wasVisible); stage.setShadows(hadShadows);
      const analysis = analyzeFrame(mask, reference, presented);
      return { dataUrl, analysis, verdict: verifyFrame(analysis) };
    },
    dispose() {
      stage.clearAssembly(); contact.dispose(); environment.dispose();
      for (const mesh of [backdrop, floor]) { mesh.geometry.dispose(); (mesh.material as MeshStandardMaterial | ShaderMaterial).dispose(); }
    },
  };
  return stage;
}
