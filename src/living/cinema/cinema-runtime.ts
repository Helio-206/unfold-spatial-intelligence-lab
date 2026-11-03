import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FrameClock } from '../../rendering/frame-clock';
import { FrameMonitor, readDeviceCaps, type DeviceCaps } from '../../rendering/quality';
import type { Assembly } from '../contracts';
import { buildShots, CameraDirector, framingOf, type CameraPose, type ShotId, type MachineFraming } from './choreography';
import { createStudioPost, type StudioPost } from './post';
import { CINEMA_TIERS, pickTier, stepDown, type CinemaSettings, type CinemaTier } from './quality';
import { createStudioMaterials, type StudioMaterials } from './studio-materials';
import { createStudioStage, type StudioStage } from './studio-stage';
import { applyPose, machineBounds, proxyVisualProvider, type MachineVisualProvider, type MachineVisuals } from './visual-provider';
import type { PoseSample, PoseSource } from './pose-source';
import { PoseClock } from './pose-clock';

/**
 * The cinematic runtime: a studio stage, a camera director, a post chain and an on-demand render loop around one machine.
 * It consumes an assembly (`unfold.assembly.v1`) and a pose source (the reference pose now, `unfold.motion-frame.v1` playback when the engine delivers it).
 * It owns presentation only: nothing here changes an assembly, a pose or an engineering value, and what a frame says (`status`, `poseBasis`, warnings) is
 * surfaced through `onSample`, never hidden or repaired.
 */
export type CinemaOptions = {
  host: HTMLElement;
  assembly: Assembly;
  poseSource: PoseSource;
  provider?: MachineVisualProvider;
  tier?: CinemaTier | null;
  reducedMotion?: boolean;
  /** upper bound for the device pixel ratio (evidence runs raise it to render 4K from a 1080p viewport) */
  pixelRatio?: number;
  onSample?: (sample: PoseSample) => void;
  onDegrade?: (level: 1 | 2, settings: CinemaSettings) => void;
  onShot?: (shot: ShotId | 'free' | 'tour' | null) => void;
  onContextLost?: () => void;
  /** a canonical part was picked on the canvas (`null` = nothing hit) */
  onInspect?: (partId: string | null) => void;
};
export type CinemaStats = {
  tier: CinemaTier; degrade: 0 | 1 | 2; settings: CinemaSettings; pixelRatio: number; size: [number, number];
  calls: number; triangles: number; geometries: number; textures: number; programs: number; lights: number; contactRenders: number;
  frames: number; lastFrameMs: number; caps: DeviceCaps; visuals: 'proxy' | 'visual-foundry'; poseSource: PoseSource['kind'];
};

export class CinemaRuntime {
  readonly renderer: THREE.WebGLRenderer; readonly camera: THREE.PerspectiveCamera; readonly stage: StudioStage; readonly controls: OrbitControls; readonly director: CameraDirector;
  readonly caps: DeviceCaps; readonly visuals: MachineVisuals; readonly framing: MachineFraming;
  private post: StudioPost; private materials: StudioMaterials; private settings: CinemaSettings; private baseSettings: CinemaSettings; private degradeLevel: 0 | 1 | 2 = 0;
  private poseSource: PoseSource; private poseClock = new PoseClock(); private poseTimeS = 0; private poseSpeed = 1; private posePlaying = false; private poseLoop = true;
  private raf = 0; private clock = new FrameClock(); private lastFrameAt = 0; private disposed = false; private lost = false; private suspended = false;
  private monitor = new FrameMonitor({ window: 45 }); private probeTurn = false; private readonly probePixel = new Uint8Array(4);
  private frames = 0; private lastFrameMs = 0; private observer: ResizeObserver; private pixelRatioCap: number; private size: [number, number] = [1, 1];
  lastApply: { refused: string | null; unknown: string[] } = { refused: null, unknown: [] };
  private shotNow: ShotId | 'free' | 'tour' | null = null;
  private constructor(private readonly options: CinemaOptions, visuals: MachineVisuals, materials: StudioMaterials) {
    this.visuals = visuals; this.materials = materials; this.poseSource = options.poseSource;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false });
    this.caps = readDeviceCaps(this.renderer.getContext());
    const tier = pickTier(this.caps, options.tier ?? null);
    this.baseSettings = { ...CINEMA_TIERS[tier] }; this.settings = { ...this.baseSettings };
    this.pixelRatioCap = options.pixelRatio ?? 2;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = this.settings.exposure;
    this.renderer.info.autoReset = false; // the post chain renders many passes per frame: count them all, reset once per frame
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    options.host.append(this.renderer.domElement); this.renderer.domElement.classList.add('cinema-canvas'); this.renderer.domElement.setAttribute('aria-hidden', 'true');
    this.renderer.domElement.addEventListener('webglcontextlost', (event) => { event.preventDefault(); this.lost = true; cancelAnimationFrame(this.raf); this.raf = 0; options.onContextLost?.(); });

    this.stage = createStudioStage(this.renderer, this.settings);
    this.stage.attach(visuals);
    applyPose(visuals, this.poseSource.sample(0)); visuals.root.updateWorldMatrix(true, true); this.stage.poseChanged();
    const bounds = machineBounds(visuals);
    this.stage.fit(bounds);
    const tipPart = options.assembly.parts.find((p) => p.points.some((pt) => pt.role === 'tool_tip'));
    let tip: [number, number, number] | null = null;
    if (tipPart) { const point = tipPart.points.find((pt) => pt.role === 'tool_tip')!; const object = visuals.parts.get(tipPart.id); if (object) { const v = new THREE.Vector3(...point.positionM).applyMatrix4(object.matrixWorld); tip = [v.x, v.y, v.z]; } }
    this.framing = framingOf(bounds, tip);
    const shots = buildShots(this.framing);
    const first = shots[0]!.keys[0]!;
    this.camera = new THREE.PerspectiveCamera(first.fov, 1, 0.1, 400);
    this.director = new CameraDirector(shots, this.framing.center, first);
    this.applyCamera(first);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.07; this.controls.maxPolarAngle = Math.PI / 2 - 0.015; this.controls.minDistance = this.framing.radius * 0.25; this.controls.maxDistance = this.framing.radius * 6;
    this.controls.target.fromArray(first.target); this.controls.update();
    this.controls.addEventListener('start', () => { if (this.director.active) { this.director.release(); this.setShot('free'); } });
    this.controls.addEventListener('change', () => this.requestFrame());
    this.post = createStudioPost(this.renderer, this.stage.scene, this.camera, 2, 2, this.settings.msaa);
    this.applySettings();
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(options.host); this.resize();
    options.onSample?.(this.poseSource.sample(this.poseTimeS));
    this.requestFrame();
  }

  static async create(options: CinemaOptions): Promise<CinemaRuntime> {
    const materials = createStudioMaterials();
    const provider = options.provider ?? proxyVisualProvider(materials);
    const visuals = await provider.load(options.assembly);
    try { return new CinemaRuntime(options, visuals, materials); } catch (error) { visuals.dispose(); materials.dispose(); throw error; }
  }

  // --- settings and size -------------------------------------------------------------------------------------------
  get tier(): CinemaTier { return this.settings.tier; }
  get degrade(): 0 | 1 | 2 { return this.degradeLevel; }
  get currentSettings(): CinemaSettings { return this.settings; }
  private applySettings(): void {
    const s = this.settings; this.renderer.toneMappingExposure = s.exposure;
    this.stage.apply(s); this.post.setSettings({ ao: s.ao, bloom: s.bloom, grade: s.grade }); this.materials.setEnvIntensity(1);
  }
  /** user-chosen tier; resets any automatic degradation */
  setTier(tier: CinemaTier): void {
    if (this.disposed) return; this.baseSettings = { ...CINEMA_TIERS[tier] }; this.settings = { ...this.baseSettings }; this.degradeLevel = 0; this.monitor.reset();
    // the MSAA sample count lives in the render target: rebuild the chain
    this.post.dispose(); this.post = createStudioPost(this.renderer, this.stage.scene, this.camera, this.size[0], this.size[1], this.settings.msaa);
    this.applySettings(); this.resize(true); this.stage.contact.markDirty(); this.requestFrame();
  }
  private pixelRatio(): number { return Math.max(0.5, Math.min(window.devicePixelRatio || 1, this.settings.maxPixelRatio, this.pixelRatioCap)); }
  private resize(force = false): void {
    if (this.disposed) return; const host = this.options.host; const w = Math.max(2, host.clientWidth); const h = Math.max(2, host.clientHeight);
    if (!force && w === this.size[0] && h === this.size[1]) return;
    this.size = [w, h]; const pr = this.pixelRatio();
    this.renderer.setPixelRatio(pr); this.renderer.setSize(w, h, false); this.post.setSize(w, h, pr);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.requestFrame();
  }

  // --- camera ------------------------------------------------------------------------------------------------------
  private applyCamera(pose: CameraPose): void {
    this.camera.position.fromArray(pose.position); if (Math.abs(this.camera.fov - pose.fov) > 1e-4) { this.camera.fov = pose.fov; this.camera.updateProjectionMatrix(); }
    this.camera.lookAt(...pose.target); if (this.controls) { this.controls.target.fromArray(pose.target); }
  }
  private setShot(id: ShotId | 'free' | 'tour' | null): void { if (this.shotNow !== id) { this.shotNow = id; this.options.onShot?.(id); } }
  get shot(): ShotId | 'free' | 'tour' | null { return this.shotNow; }
  private currentPose(): CameraPose { return { position: this.camera.position.toArray() as [number, number, number], target: this.controls.target.toArray() as [number, number, number], fov: this.camera.fov }; }
  /** `reducedMotion`: jump straight to the shot's framing, no transition and no camera move */
  cut(id: ShotId): void {
    const reduced = this.options.reducedMotion;
    this.director.cut(id, this.currentPose(), reduced ? 0 : 1.6);
    if (reduced) { this.director.seek(this.director.shots.find((s) => s.id === id)!.durationS * 0.35); this.director.release(); }
    this.applyCamera(this.director.pose); this.setShot(id); this.requestFrame();
  }
  tour(ids: ShotId[] = ['hero', 'profile', 'bucket', 'reach', 'hero']): void { if (this.options.reducedMotion) { this.cut(ids[0]!); return; } this.director.tour(ids, this.currentPose()); this.setShot('tour'); this.requestFrame(); }
  /** deterministic seek used by evidence and tests: puts the camera exactly where `shot` is `timeS` seconds in, no transition */
  seekShot(id: ShotId, timeS: number): CameraPose {
    this.director.cut(id, this.currentPose(), 0); const pose = this.director.seek(timeS); this.director.release(); this.applyCamera(pose); this.setShot(id); this.renderNow(); return pose;
  }
  free(): void { this.director.release(); this.setShot('free'); }

  // --- pose playback -----------------------------------------------------------------------------------------------
  get source(): PoseSource { return this.poseSource; }
  get timeS(): number { return this.poseTimeS; }
  get playing(): boolean { return this.posePlaying; }
  /** swaps the pose source (reference pose -> engine frames); the framing is kept so the camera does not jump */
  setPoseSource(source: PoseSource): void {
    if (source.assemblyId !== this.options.assembly.id) throw new Error(`A fonte de pose é da montagem «${source.assemblyId}», não da montagem em cena («${this.options.assembly.id}»).`);
    this.poseSource = source; this.poseTimeS = 0; this.posePlaying = false; this.poseClock.pause(); this.showPose(); this.requestFrame();
  }
  playPose(playing = !this.posePlaying, loop = true): void { if (this.poseSource.durationS <= 0) return; this.posePlaying = playing; this.poseLoop = loop; if (playing) this.poseClock.start(performance.now()); else this.poseClock.pause(); this.requestFrame(); }
  seekPose(timeS: number): void { this.poseTimeS = Math.min(Math.max(0, timeS), this.poseSource.durationS); this.showPose(); this.requestFrame(); }
  private showPose(): void {
    const sample = this.poseSource.sample(this.poseTimeS);
    // A sample without poses (invalid assembly, blocked with poseBasis none) shows NO machine: nothing is drawn from an older pose.
    this.stage.setMachineVisible(sample.parts.length > 0);
    const r = this.visuals.applyPose ? this.visuals.applyPose(sample) : applyPose(this.visuals, sample);
    this.lastApply = { refused: (r as { refused?: string | null }).refused ?? null, unknown: r.unknown };
    if (this.lastApply.refused) console.warn(`cinema: o fornecedor de geometria recusou o quadro: ${this.lastApply.refused}`);
    if (r.unknown.length) console.warn(`cinema: partes sem objecto visual: ${r.unknown.join(', ')}`);
    this.visuals.root.updateWorldMatrix(true, true); this.stage.poseChanged(); this.options.onSample?.(sample);
  }

  // --- render loop -------------------------------------------------------------------------------------------------
  requestFrame(): void { if (this.disposed || this.lost || this.suspended || this.raf) return; if (this.clock.request(performance.now())) this.raf = requestAnimationFrame((t) => this.frame(t)); }
  private frame(now: number): void {
    const { latencyMs } = this.clock.begin(performance.now()); this.raf = 0; if (this.disposed || this.lost || this.suspended) return;
    const dt = this.lastFrameAt ? Math.min(0.1, Math.max(0, (now - this.lastFrameAt) / 1000)) : 0; this.lastFrameAt = now;
    let moving = false;
    if (this.director.active) { const r = this.director.advance(dt); this.applyCamera(r.pose); moving = r.moving; if (!r.moving) this.setShot(this.shotNow === 'tour' ? 'free' : this.shotNow); }
    if (this.posePlaying) {
      this.poseTimeS += this.poseClock.tick(performance.now(), this.poseSpeed); const end = this.poseSource.durationS;
      if (this.poseTimeS >= end) { if (this.poseLoop) this.poseTimeS %= Math.max(end, 1e-6); else { this.poseTimeS = end; this.posePlaying = false; this.poseClock.pause(); } }
      this.showPose(); moving = moving || this.posePlaying;
    }
    const orbiting = this.controls.update(); moving = moving || orbiting;
    const probe = this.settings.tier !== 'light' && this.degradeLevel < 2 && (this.probeTurn = !this.probeTurn);
    const t0 = performance.now(); this.renderScene(dt); if (probe) { const gl = this.renderer.getContext(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.probePixel); }
    const renderMs = performance.now() - t0; this.lastFrameMs = renderMs + latencyMs; this.frames += 1;
    if (probe) { this.monitor.sample(now, { latencyMs, renderMs }); const step = this.monitor.check(now); if (step) this.degradeTo(step); }
    if (moving) this.requestFrame();
  }
  private renderScene(dt: number, still = false): void { this.renderer.info.reset(); this.stage.prepare(this.renderer); this.post.render(dt, still); }
  /** Canonical id of the part under a canvas position (CSS px), through the `userData.partId` the provider puts on its meshes. No selection state is kept here. */
  pickPart(clientX: number, clientY: number): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect(); const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1));
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, this.camera); this.visuals.root.updateWorldMatrix(true, true);
    for (const hit of ray.intersectObject(this.visuals.root, true)) { for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) { const id = o.userData?.partId as string | undefined; if (id && this.visuals.parts.has(id)) { this.options.onInspect?.(id); return id; } } }
    this.options.onInspect?.(null); return null;
  }
  /** synchronous render for evidence: the stage is fully up to date when this returns */
  renderNow(): void { if (this.disposed || this.lost) return; this.resize(); this.controls.update(); this.camera.updateMatrixWorld(); this.stage.contact.markDirty(); this.renderScene(0, true); }
  private degradeTo(level: 1 | 2): void {
    this.degradeLevel = level; this.settings = stepDown(this.baseSettings, level); this.applySettings();
    if (level >= 2) { this.post.dispose(); this.post = createStudioPost(this.renderer, this.stage.scene, this.camera, this.size[0], this.size[1], this.settings.msaa); this.applySettings(); }
    this.resize(true); this.stage.contact.markDirty(); this.options.onDegrade?.(level, this.settings); this.requestFrame(); // reconfiguring clears the drawing buffer: exactly one more frame
  }

  /** Evidence only: switches individual parts of the pipeline off so their contribution can be measured on the same frame. */
  ablate(flags: { environment?: boolean; post?: boolean; contact?: boolean; mirror?: boolean; shadows?: boolean }): void {
    if (flags.environment !== undefined) this.stage.scene.environment = flags.environment ? this.stage.environment.texture : null;
    if (flags.post !== undefined) this.post.setSettings({ ao: flags.post && this.settings.ao, bloom: flags.post && this.settings.bloom, grade: flags.post && this.settings.grade });
    if (flags.contact !== undefined) this.stage.contact.setEnabled(flags.contact && this.settings.contact);
    if (flags.mirror !== undefined) this.stage.scene.getObjectByName('mirror')!.visible = flags.mirror && this.settings.mirror;
    if (flags.shadows !== undefined) this.stage.lights.key.castShadow = flags.shadows && this.settings.shadows;
  }
  /** Evidence only: the part's bounding box on screen, in CSS pixels relative to the canvas. */
  screenBox(partId: string): { x: number; y: number; w: number; h: number } | null {
    const object = this.visuals.parts.get(partId); if (!object) return null;
    const box = new THREE.Box3().setFromObject(object); const corners: THREE.Vector3[] = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z).project(this.camera));
    const xs = corners.map((c) => (c.x * 0.5 + 0.5) * this.size[0]); const ys = corners.map((c) => (-c.y * 0.5 + 0.5) * this.size[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  /** Evidence only: `frames` synchronous renders, each forced to completion with a 1x1 read, so the time includes the GPU. */
  benchmark(frames = 30): { frames: number; meanMs: number; p95Ms: number; calls: number; triangles: number } {
    const gl = this.renderer.getContext(); const px = new Uint8Array(4); const times: number[] = [];
    for (let i = 0; i < 3; i += 1) this.renderScene(0, true);
    for (let i = 0; i < frames; i += 1) { const t = performance.now(); this.renderScene(0, true); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); times.push(performance.now() - t); }
    times.sort((a, b) => a - b); const info = this.renderer.info.render;
    return { frames, meanMs: times.reduce((a, b) => a + b, 0) / frames, p95Ms: times[Math.floor(frames * 0.95)]!, calls: info.calls, triangles: info.triangles };
  }

  stats(): CinemaStats {
    const info = this.renderer.info; let lights = 0; this.stage.scene.traverse((o) => { if ((o as THREE.Light).isLight) lights += 1; });
    return { tier: this.settings.tier, degrade: this.degradeLevel, settings: this.settings, pixelRatio: this.renderer.getPixelRatio(), size: this.size, calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length ?? 0, lights, contactRenders: this.stage.contact.renders, frames: this.frames, lastFrameMs: this.lastFrameMs, caps: this.caps, visuals: this.visuals.source, poseSource: this.poseSource.kind };
  }

  /** Keep the stage and playback state while a document is in the back-forward cache. */
  suspend(): void {
    if (this.disposed || this.suspended) return;
    this.suspended = true; cancelAnimationFrame(this.raf); this.raf = 0;
    this.clock = new FrameClock(); this.poseClock.pause(); this.lastFrameAt = 0;
  }

  resume(): void {
    if (this.disposed || !this.suspended) return;
    this.suspended = false; this.lastFrameAt = 0; this.monitor.reset();
    if (this.posePlaying) this.poseClock.start(performance.now());
    this.resize(true); this.requestFrame();
  }

  dispose(): void {
    if (this.disposed) return; this.disposed = true; cancelAnimationFrame(this.raf); this.observer.disconnect(); this.controls.dispose();
    this.post.dispose(); this.stage.dispose(); this.visuals.dispose(); this.materials.dispose();
    this.renderer.dispose(); this.renderer.forceContextLoss(); this.renderer.domElement.remove();
  }
}
