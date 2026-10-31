import {
  AmbientLight, Box3, BoxGeometry, Color, DirectionalLight, FogExp2, Group, GridHelper, LineBasicMaterial, Mesh, MeshStandardMaterial,
  PerspectiveCamera, Plane, PlaneGeometry, Raycaster, Scene, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { answerSpatialQuestion, createFixturePlan, UnfoldEngine, type FloorPlan, type PlanElement, type Wall } from './model';
import { fourBarLabResidual, FourBarLabScene, FOUR_BAR_LAB_MODE, type FourBarVisualState } from './four-bar-lab';
import { createFitCameraView, createFocusCameraView, type CameraView } from './four-bar-lab-camera';
import { createPhase4AExperimentRequest, validatePhase4AExperimentResponse } from './phase4a-experiment';
import { PHASE4A_LENGTHS } from './phase4a-kinematics';
import { solveFourBar, type AssemblyBranch, type BarName, type FourBarLengths, type FourBarResult } from './kinematics';
import { SpatialActionOrchestrator, type OrchestratorState } from './spatial-orchestrator';
import { instructionForLengthUpdate, parseSpatialCommand, type SpatialAction } from './spatial-command';
import { BrowserVoiceInput, type VoiceStatus } from './voice-input';
import { HandInteractionModel, WebcamHandTracker, type HandInteractionState, type HandLandmark, type HandTrackerMetrics } from './hand-tracking';
import './style.css';

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
const INITIAL_VARIANT = 'A' as const;
const API_BASE_URL = '/api';
const PHASE4A_MECHANISM_ID = 'phase-4a-design-sandbox';
const plan = createFixturePlan(INITIAL_VARIANT);
const engine = new UnfoldEngine(plan);
const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Elemento #app não encontrado.');

app.innerHTML = `
  <main class="stage-shell">
    <div id="scene-3d" class="scene" aria-label="Cena 3D interactiva da planta"></div>
    <header class="stage-header">
      <div class="brand-lockup">
        <span class="brand-mark">UNFOLD</span><span class="brand-rule"></span><span class="brand-context">spatial intelligence instrument</span>
      </div>
      <div class="header-actions">
        <span class="live-state"><i class="state-dot"></i><span id="mode-label">model live</span></span>
        <button id="toggle-four-bar" class="quiet-control" aria-pressed="false">Four-Bar Lab</button>
        <button id="toggle-reference" class="quiet-control" aria-expanded="false" aria-controls="reference-drawer">Reference plan</button>
      </div>
    </header>

    <section class="scene-intro" aria-live="polite"><span class="eyebrow">PHASE 0 / SPATIAL MODEL</span><h1 id="scene-title">Living space</h1><p id="scene-subtitle">A validated room structure, ready to unfold.</p></section>

    <section class="ai-readout" aria-live="polite"><div class="readout-kicker"><span class="signal-line"></span><span>AI spatial readout</span></div><p id="answer">Ask about the model. The scene will answer in space.</p><span id="selection" class="readout-selection">no active focus</span></section>
    <div class="scene-meta"><span id="status">CONTRACT VALID · SCALE UNKNOWN</span><span>ORBIT / ZOOM / SELECT</span></div>

    <section id="four-bar-lab-panel" class="lab-panel" aria-label="Four-Bar Lab" aria-hidden="true" hidden>
      <div class="lab-heading"><div><span class="eyebrow">FOUR-BAR LAB</span><h2>Planar mechanism</h2></div><div class="lab-heading-meta"><span class="lab-evidence">hypothetical_user_design</span><button id="hand-control-toggle" class="lab-hand-control" type="button" aria-pressed="false"><span class="hand-control-dot"></span>Hand Control</button><span id="hand-control-status" class="lab-hand-status">CAMERA OFF</span></div></div>
      <div id="hand-control-layer" class="hand-control-layer" hidden><video id="hand-preview" class="hand-preview" autoplay muted playsinline aria-label="Pré-visualização opcional da webcam"></video><span id="hand-control-metrics" class="hand-control-metrics">NO HAND · 0 INF/S</span></div>
      <p class="lab-copy">Geometria reconstruída exclusivamente a partir do solver determinístico. Não é uma reconstrução física do redutor.</p>
      <div class="lab-dimensions"><span>ground <strong id="lab-length-ground">100 mm</strong></span><span>crank <strong id="lab-length-crank">40 mm</strong></span><span>coupler <strong id="lab-length-coupler">120 mm</strong></span><span>rocker <strong id="lab-length-rocker">90 mm</strong></span></div>
      <div class="lab-selectors" aria-label="Seleccionar barra"><span class="lab-label">FOCUS BAR</span><div><button type="button" data-lab-role="ground">ground</button><button type="button" data-lab-role="crank">crank</button><button type="button" data-lab-role="coupler">coupler</button><button type="button" data-lab-role="rocker">rocker</button></div></div>
      <div class="lab-controls"><label for="lab-angle">INPUT ANGLE <output id="lab-angle-value" for="lab-angle">0°</output><input id="lab-angle" type="range" min="0" max="360" step="1" value="0" /></label><label for="lab-branch">BRANCH<select id="lab-branch"><option value="plus">plus</option><option value="minus">minus</option></select></label></div>
      <section class="lab-experiment" aria-label="AI experiment"><div class="lab-experiment-heading"><span class="lab-label">AI EXPERIMENT</span><strong id="lab-experiment-state">READY</strong></div><div class="lab-experiment-readout" aria-live="polite"><span id="lab-experiment-operation">No operation executed.</span><strong id="lab-experiment-change">—</strong><span id="lab-experiment-states">before — / after —</span></div><p id="lab-experiment-message">The command bar validates operations before the scene can change.</p><button id="lab-restore-original" class="lab-restore" type="button">Restore original 100 / 40 / 120 / 90 mm</button></section>
      <div class="lab-readouts"><span>solver <strong id="lab-status">SOLVED</strong></span><span>visual state <strong id="lab-visual-state">ASSEMBLED</strong></span><span>max length error <strong id="lab-residual">—</strong></span><span>closure residual <strong id="lab-closure">—</strong></span></div>
      <p id="lab-reason" class="lab-reason">All four links satisfy the requested configuration.</p>
    </section>

    <section id="spatial-composer" class="spatial-composer" data-command-state="IDLE" aria-label="Spatial command composer">
      <button id="composer-drag-handle" class="composer-drag-handle" type="button" aria-label="Move command bar" title="Drag to move"><span></span><span></span><span></span></button>
      <div class="composer-main">
        <div class="composer-input-row"><span class="composer-prefix">/</span><textarea id="question" rows="1" aria-label="Spatial command" placeholder="Ask the model to act in space">Show me the living room and its walls.</textarea><button id="submit-question" class="composer-send" type="button" aria-label="Send command" title="Send command">↗</button></div>
        <div id="composer-suggestions" class="composer-suggestions" aria-label="Contextual suggestions" hidden></div>
        <div class="composer-feedback" aria-live="polite"><span id="composer-state">IDLE</span><span id="composer-status">Ready for a spatial command.</span><span id="composer-waveform" class="composer-waveform" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span></div>
      </div>
      <div class="composer-tools" aria-label="Command tools">
        <button id="composer-add-image" class="composer-tool" type="button" aria-label="Attach image" title="Attach image">+</button>
        <button id="lab-voice" class="composer-tool composer-mic" type="button" aria-pressed="false" aria-label="Activate microphone" title="Activate microphone"><span class="voice-glyph">◉</span><span id="lab-voice-label">MIC</span></button>
        <button id="composer-actions-toggle" class="composer-tool composer-actions-toggle" type="button" aria-expanded="false" aria-controls="composer-actions-menu" aria-label="Open spatial actions" title="Spatial actions">···</button>
      </div>
      <div id="composer-actions-menu" class="composer-actions-menu" hidden aria-label="Spatial actions">
        <button id="explode" class="composer-action" type="button"><span>01</span>Explode</button>
        <button id="reassemble" class="composer-action" type="button"><span>02</span>Reassemble</button>
        <button id="isolate" class="composer-action" type="button"><span>03</span>Focus selected</button>
        <button id="composer-fit" class="composer-action" type="button"><span>04</span>Fit</button>
        <button id="composer-home" class="composer-action" type="button"><span>05</span>Home</button>
        <button id="reset" class="composer-action composer-action-reset" type="button"><span>↺</span>Reset</button>
        <button id="composer-reset-position" class="composer-action composer-action-reset" type="button"><span>⌖</span>Reset bar position</button>
      </div>
      <input id="image-input" type="file" accept="image/*" hidden />
      <span id="lab-voice-state" class="sr-only">VOICE READY</span><span id="lab-voice-transcript" class="sr-only">Use text if voice is unavailable.</span>
    </section>

    <aside id="reference-drawer" class="reference-drawer" aria-hidden="true">
      <div class="drawer-topline"><div><span class="eyebrow">SECONDARY REFERENCE</span><h2>Plan trace</h2></div><button id="close-reference" class="close-control" aria-label="Close reference plan">×</button></div>
      <svg id="plan-2d" viewBox="0 0 1000 700" role="img" aria-label="Planta 2D de referência"></svg>
      <div class="drawer-note"><span class="note-mark">i</span><span>2D remains a reference layer. The 3D scene is the source of interaction.</span></div>
      <div class="fixture-row" aria-label="Reference fixtures"><button id="fixture-a">A</button><button id="fixture-b">B</button><button id="fixture-c">C</button></div>
    </aside>
    <div id="drawer-scrim" class="drawer-scrim" aria-hidden="true"></div>
    <div id="hand-cursor" class="hand-cursor" aria-hidden="true" hidden><span></span></div>
  </main>`;

const scene = new Scene();
scene.background = new Color('#070b0e');
scene.fog = new FogExp2('#070b0e', 0.035);
const camera = new PerspectiveCamera(42, 1, 0.1, 100);
camera.position.set(8.4, 7.6, 9.2);
const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = 2;
document.querySelector('#scene-3d')?.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.minDistance = 3.8;
controls.maxDistance = 18;
controls.maxPolarAngle = Math.PI * 0.46;
controls.target.set(4.5, 0, -3.2);
controls.addEventListener('start', cancelCameraMotion);
scene.add(new AmbientLight('#9fb5b9', 1.45));
const keyLight = new DirectionalLight('#fff1d4', 4.2);
keyLight.position.set(3, 10, 5);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
scene.add(keyLight);
const rimLight = new DirectionalLight('#6ea2ad', 1.6);
rimLight.position.set(-6, 5, -8);
scene.add(rimLight);
const group = new Group();
scene.add(group);
let workspaceMode: 'spatial' | 'four-bar-lab' = 'spatial';
let fourBarLab: FourBarLabScene | undefined;
const grid = new GridHelper(18, 18, '#273e43', '#14262c');
grid.position.set(4.5, -0.035, -3.2);
(grid.material as LineBasicMaterial).opacity = 0.23;
(grid.material as LineBasicMaterial).transparent = true;
scene.add(grid);
const objects = new Map<string, Mesh>();
const restPositions = new Map<string, Vector3>();
const motions = new Map<string, { from: Vector3; to: Vector3; started: number; duration: number }>();
let cameraMotion: { fromPosition: Vector3; toPosition: Vector3; fromTarget: Vector3; toTarget: Vector3; started: number; duration: number } | undefined;
let activePlan: FloorPlan = plan;
let activeVariant: 'A' | 'B' | 'C' = INITIAL_VARIANT;
let labLengths: FourBarLengths = { ...PHASE4A_LENGTHS };
let labExperimentBusy = false;
let labExperimentSequence = 0;
let labExperimentAbort: AbortController | undefined;
let labHomeView: CameraView | undefined;
let motionReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let orchestrator: SpatialActionOrchestrator;
let voiceInput: BrowserVoiceInput;
type ComposerState = 'IDLE' | 'TYPING' | 'LISTENING' | 'PROCESSING' | 'EXECUTING' | 'COMPLETE' | 'ERROR';
let composerState: ComposerState = 'IDLE';
let composerDrag: { pointerId: number; startX: number; startY: number; offsetX: number; offsetY: number } | undefined;
let composerPosition = { x: 0, y: 0 };
let handTracker: WebcamHandTracker | undefined;
const handInteraction = new HandInteractionModel();
let handControlEnabled = false;
let handHoverRole: BarName | undefined;
let handGrab: { role: BarName; plane: Plane; startWorld: Vector3; baseOffset: Vector3 } | undefined;

const EASE = (value: number): number => 1 - Math.pow(1 - Math.min(Math.max(value, 0), 1), 4);

function resize(): void {
  const element = document.querySelector<HTMLDivElement>('#scene-3d');
  if (!element) return;
  renderer.setSize(element.clientWidth, element.clientHeight, false);
  camera.aspect = element.clientWidth / Math.max(element.clientHeight, 1);
  camera.updateProjectionMatrix();
}

function wallMesh(wall: Wall, material: MeshStandardMaterial): Mesh {
  const scale = 0.01;
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const length = Math.hypot(dx, dy) * scale;
  const mesh = new Mesh(new BoxGeometry(length, wall.height, wall.thickness * scale), material);
  mesh.position.set(((wall.start.x + wall.end.x) / 2) * scale, wall.height / 2, -((wall.start.y + wall.end.y) / 2) * scale);
  mesh.rotation.y = Math.atan2(dy, dx);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.id = wall.id;
  mesh.userData.baseColor = '#d5dfdb';
  return mesh;
}

function createElementMaterial(color: string): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness: 0.58, metalness: 0.08, emissive: '#000000', emissiveIntensity: 0 });
}

function disposeGroupResources(target: Group): void {
  for (const child of [...target.children]) {
    child.traverse((object) => {
      const mesh = object as Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      materials.forEach((entry) => entry.dispose());
    });
  }
}

function setText(selector: string, text: string): void {
  const element = document.querySelector<HTMLElement>(selector);
  if (element) element.textContent = text;
}

function formatResidual(value: number | undefined): string {
  return value === undefined ? '—' : `${value.toExponential(2)} mm`;
}

function setComposerState(state: ComposerState, message?: string): void {
  composerState = state;
  const composer = document.querySelector<HTMLElement>('#spatial-composer');
  composer?.setAttribute('data-command-state', state);
  setText('#composer-state', state);
  if (message) setText('#composer-status', message);
}
function setHandControlUI(state: HandInteractionState, message?: string): void {
  const label: Record<HandInteractionState, string> = { OFF: 'CAMERA OFF', INITIALIZING: 'STARTING', ACTIVE: 'CAMERA ACTIVE', GRABBING: 'GRABBING', NO_HAND: 'NO HAND', ERROR: 'CAMERA ERROR' };
  setText('#hand-control-status', message ?? label[state]);
  document.querySelector<HTMLButtonElement>('#hand-control-toggle')?.setAttribute('aria-pressed', String(state !== 'OFF' && state !== 'ERROR'));
  document.querySelector<HTMLElement>('#hand-control-layer')?.toggleAttribute('hidden', state === 'OFF' || state === 'ERROR');
  document.querySelector<HTMLElement>('#hand-control-layer')?.setAttribute('data-hand-state', state);
}
function setHandMetrics(metrics: HandTrackerMetrics, state: HandInteractionState): void {
  setText('#hand-control-metrics', `${state} - ${metrics.inferenceHz.toFixed(1)} INF/S - ${metrics.lastInferenceLatencyMs.toFixed(0)} MS`);
}
function handViewportRect(): DOMRect | undefined {
  const surface = renderer.domElement;
  if (!surface.clientWidth || !surface.clientHeight) return undefined;
  return surface.getBoundingClientRect();
}

function handRoleAt(viewportCursor: { x: number; y: number }): BarName | undefined {
  if (!fourBarLab) return undefined;
  const rect = handViewportRect();
  if (!rect) return undefined;
  const pointer = new Vector2(((viewportCursor.x - rect.left) / rect.width) * 2 - 1, -((viewportCursor.y - rect.top) / rect.height) * 2 + 1);
  const raycaster = new Raycaster();
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(fourBarLab.selectableMeshes())[0];
  return hit?.object.userData.labRole as BarName | undefined;
}

function handWorldPoint(viewportCursor: { x: number; y: number }, plane: Plane): Vector3 | undefined {
  const rect = handViewportRect();
  if (!rect) return undefined;
  const pointer = new Vector2(((viewportCursor.x - rect.left) / rect.width) * 2 - 1, -((viewportCursor.y - rect.top) / rect.height) * 2 + 1);
  const raycaster = new Raycaster();
  raycaster.setFromCamera(pointer, camera);
  return raycaster.ray.intersectPlane(plane, new Vector3()) ?? undefined;
}

function updateHandCursor(frame: ReturnType<HandInteractionModel['update']>): void {
  const cursor = document.querySelector<HTMLElement>('#hand-cursor');
  if (!cursor || !frame.viewportCursor) { cursor?.setAttribute('hidden', ''); return; }
  const stage = document.querySelector<HTMLElement>('.stage-shell')?.getBoundingClientRect();
  if (!stage) return;
  cursor.removeAttribute('hidden');
  cursor.style.left = `${frame.viewportCursor.x - stage.left}px`;
  cursor.style.top = `${frame.viewportCursor.y - stage.top}px`;
  cursor.dataset.state = frame.pinch ? 'grabbing' : frame.handVisible ? 'pointing' : 'lost';
}

function cancelHandGrab(): void {
  handGrab = undefined;
  handInteraction.release();
  fourBarLab?.hover(undefined);
}

function handleHandLandmarks(landmarks: HandLandmark[] | undefined, metrics: HandTrackerMetrics): void {
  if (!handControlEnabled || !fourBarLab) return;
  const frame = handInteraction.update(landmarks, handViewportRect());
  updateHandCursor(frame);
  setHandMetrics(metrics, frame.state);
  if (frame.viewportCursor) {
    const hoveredRole = handRoleAt(frame.viewportCursor);
    if (hoveredRole !== handHoverRole) {
      handHoverRole = hoveredRole;
      fourBarLab.hover(hoveredRole);
    }
  }
  if (frame.grabStarted && frame.viewportCursor) {
    const role = handRoleAt(frame.viewportCursor);
    if (role) fourBarLab.select(role);
    if (role && fourBarLab.currentVisualState === 'inspection') {
      const center = fourBarLab.boundsFor(role).getCenter(new Vector3());
      const normal = camera.getWorldDirection(new Vector3()).normalize();
      const plane = new Plane().setFromNormalAndCoplanarPoint(normal, center);
      const startWorld = handWorldPoint(frame.viewportCursor, plane);
      if (startWorld) handGrab = { role, plane, startWorld, baseOffset: fourBarLab.inspectionOffset(role) };
      setText('#hand-control-status', `GRABBING - ${role}`);
    } else if (role) {
      setText('#hand-control-status', 'PINCH - EXPLODE TO GRAB');
    }
  }
  if (handGrab && frame.state === 'GRABBING' && frame.viewportCursor && fourBarLab.currentVisualState === 'inspection') {
    const world = handWorldPoint(frame.viewportCursor, handGrab.plane);
    if (world) fourBarLab.setInspectionOffset(handGrab.role, handGrab.baseOffset.clone().add(world).sub(handGrab.startWorld));
  }
  if (frame.grabEnded) {
    handGrab = undefined;
    setText('#hand-control-status', 'CAMERA ACTIVE');
  }
}

function stopHandControl(): void {
  handControlEnabled = false;
  handTracker?.stop();
  handTracker = undefined;
  handInteraction.reset();
  handHoverRole = undefined;
  handGrab = undefined;
  fourBarLab?.hover(undefined);
  document.querySelector<HTMLElement>('#hand-cursor')?.setAttribute('hidden', '');
  setHandControlUI('OFF');
}

async function startHandControl(): Promise<void> {
  if (!fourBarLab || handControlEnabled) return;
  const video = document.querySelector<HTMLVideoElement>('#hand-preview');
  if (!video) return;
  handControlEnabled = true;
  setHandControlUI('INITIALIZING');
  const tracker = new WebcamHandTracker({
    video,
    onState: (state, message) => {
      if (handTracker !== tracker) return;
      handInteraction.setState(state);
      setHandControlUI(state, message);
    },
    onLandmarks: handleHandLandmarks,
    onError: (error) => { if (handTracker === tracker) console.warn('[UNFOLD] hand tracking error', error instanceof Error ? error.message : error); },
    onMetrics: (metrics) => { if (handTracker === tracker) setHandMetrics(metrics, handInteraction.currentState); },
  });
  handTracker = tracker;
  try {
    await tracker.start();
    if (handTracker !== tracker || !handControlEnabled) tracker.stop();
  } catch {
    if (handTracker === tracker) { handControlEnabled = false; handTracker = undefined; handInteraction.reset(); setHandControlUI('ERROR', 'Câmara indisponível ou permissão recusada.'); }
  }
}

function setComposerPosition(position: { x: number; y: number }): void {
  composerPosition = position;
  const composer = document.querySelector<HTMLElement>('#spatial-composer');
  composer?.style.setProperty('--composer-x', `${position.x}px`);
  composer?.style.setProperty('--composer-y', `${position.y}px`);
}

function clampComposerPosition(): void {
  const stage = document.querySelector<HTMLElement>('.stage-shell');
  const composer = document.querySelector<HTMLElement>('#spatial-composer');
  if (!stage || !composer) return;
  const stageRect = stage.getBoundingClientRect();
  const composerRect = composer.getBoundingClientRect();
  const baseLeft = stageRect.left + (stageRect.width - composerRect.width) / 2;
  const baseTop = stageRect.bottom - composerRect.height - 28;
  const minX = stageRect.left + 12 - baseLeft;
  const maxX = stageRect.right - composerRect.width - 12 - baseLeft;
  const minY = stageRect.top + 12 - baseTop;
  const maxY = stageRect.bottom - composerRect.height - 12 - baseTop;
  setComposerPosition({
    x: Math.min(Math.max(composerPosition.x, Math.min(minX, maxX)), Math.max(minX, maxX)),
    y: Math.min(Math.max(composerPosition.y, Math.min(minY, maxY)), Math.max(minY, maxY)),
  });
}

function resetComposerPosition(): void {
  setComposerPosition({ x: 0, y: 0 });
  clampComposerPosition();
}

function updateComposerSuggestions(): void {
  const suggestions = document.querySelector<HTMLElement>('#composer-suggestions');
  if (!suggestions) return;
  const role = workspaceMode === 'four-bar-lab' ? fourBarLab?.selected : undefined;
  if (!role) {
    suggestions.hidden = true;
    suggestions.replaceChildren();
    return;
  }
  suggestions.hidden = false;
  suggestions.innerHTML = `<button type="button" data-suggestion="focus ${escapeHtml(role)}">Focus ${escapeHtml(role)}</button><button type="button" data-suggestion="fit mechanism">Fit mechanism</button>`;
}

function closeComposerActions(): void {
  const menu = document.querySelector<HTMLElement>('#composer-actions-menu');
  const toggle = document.querySelector<HTMLButtonElement>('#composer-actions-toggle');
  if (!menu) return;
  menu.hidden = true;
  toggle?.setAttribute('aria-expanded', 'false');
}

function getWallFor(element: PlanElement): Wall | undefined {
  if (element.kind === 'wall') return element;
  if (element.kind !== 'door' && element.kind !== 'window') return undefined;
  return activePlan.elements.find((candidate): candidate is Wall => candidate.kind === 'wall' && candidate.id === element.wallId);
}

function renderPlan(): void {
  disposeGroupResources(group);
  group.clear();
  objects.clear();
  restPositions.clear();
  motions.clear();
  const floor = new Mesh(new PlaneGeometry(activePlan.image.width * 0.01, activePlan.image.height * 0.01), createElementMaterial('#162227'));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(activePlan.image.width * 0.005, -0.02, -activePlan.image.height * 0.005);
  floor.receiveShadow = true;
  group.add(floor);
  for (const element of activePlan.elements) {
    if (element.kind === 'room') continue;
    if (element.kind === 'wall') {
      const mesh = wallMesh(element, createElementMaterial('#d5dfdb'));
      group.add(mesh); objects.set(element.id, mesh); restPositions.set(element.id, mesh.position.clone());
      continue;
    }
    const wall = getWallFor(element);
    if (!wall) continue;
    const x = wall.start.x + (wall.end.x - wall.start.x) * element.position;
    const y = wall.start.y + (wall.end.y - wall.start.y) * element.position;
    const angle = Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x);
    const color = element.kind === 'door' ? '#d7a15e' : '#69c6d1';
    const mesh = new Mesh(new BoxGeometry(element.width * 0.01, element.kind === 'door' ? 2.1 : 1.25, 0.08), createElementMaterial(color));
    mesh.position.set(x * 0.01, element.kind === 'door' ? 1.05 : 1.45, -y * 0.01);
    mesh.rotation.y = angle;
    mesh.castShadow = true;
    mesh.userData.id = element.id;
    mesh.userData.baseColor = color;
    group.add(mesh); objects.set(element.id, mesh); restPositions.set(element.id, mesh.position.clone());
  }
  resize();
}

function render2d(): void {
  const svg = document.querySelector<SVGElement>('#plan-2d');
  if (!svg) return;
  svg.setAttribute('viewBox', `0 0 ${activePlan.image.width} ${activePlan.image.height}`);
  const state = engine.state();
  svg.innerHTML = activePlan.elements.map((element) => {
    const classes = `${state.highlighted.includes(element.id) ? 'highlighted' : ''} ${state.selected.includes(element.id) ? 'selected' : ''} ${state.hidden.includes(element.id) ? 'hidden' : ''}`;
    if (element.kind === 'wall') return `<line class="wall ${classes}" data-id="${escapeHtml(element.id)}" x1="${element.start.x}" y1="${element.start.y}" x2="${element.end.x}" y2="${element.end.y}" />`;
    if (element.kind === 'room') return `<polygon class="room ${classes}" data-id="${escapeHtml(element.id)}" points="${element.polygon.map((point) => `${point.x},${point.y}`).join(' ')}" />`;
    const wall = getWallFor(element);
    if (!wall) return '';
    const x = wall.start.x + (wall.end.x - wall.start.x) * element.position;
    const y = wall.start.y + (wall.end.y - wall.start.y) * element.position;
    return `<circle class="opening ${element.kind} ${classes}" data-id="${escapeHtml(element.id)}" cx="${x}" cy="${y}" r="${Math.max(element.width / 10, 8)}" />`;
  }).join('');
  svg.querySelectorAll<SVGElement>('[data-id]').forEach((element) => element.addEventListener('click', () => selectIds([element.dataset.id ?? ''])));
}

function directionFor(element: PlanElement): Vector3 {
  const wall = getWallFor(element);
  if (!wall || element.kind === 'room') return new Vector3(0, 0.4, 0);
  const point = element.kind === 'wall'
    ? { x: (wall.start.x + wall.end.x) / 2, y: (wall.start.y + wall.end.y) / 2 }
    : { x: wall.start.x + (wall.end.x - wall.start.x) * element.position, y: wall.start.y + (wall.end.y - wall.start.y) * element.position };
  const center = new Vector3(activePlan.image.width * 0.005, 0, -activePlan.image.height * 0.005);
  const vector = new Vector3(point.x * 0.01 - center.x, 0, -point.y * 0.01 - center.z);
  if (vector.lengthSq() < 0.001) vector.set(0, 0, 1);
  vector.normalize();
  return vector.multiplyScalar(element.kind === 'wall' ? 0.9 : 0.98).add(new Vector3(0, element.kind === 'wall' ? 0.18 : 0.38, 0));
}

function transitionAssembly(exploded: boolean): void {
  const now = performance.now();
  for (const element of activePlan.elements) {
    const mesh = objects.get(element.id);
    const rest = restPositions.get(element.id);
    if (!mesh || !rest) continue;
    const to = exploded ? rest.clone().add(directionFor(element)) : rest.clone();
    motions.set(element.id, { from: mesh.position.clone(), to, started: now, duration: motionReduced ? 1 : 850 });
  }
  document.querySelector('#mode-label')!.textContent = exploded ? 'assembly separated' : 'assembly restored';
  document.querySelector('#status')!.textContent = exploded ? 'STRUCTURAL GROUPS SEPARATED · RELATIONS PRESERVED' : 'CONTRACT VALID · ASSEMBLY RESTORED';
}

function focusCamera(ids: string[]): void {
  const candidates = ids.map((id) => objects.get(id)).filter((object): object is Mesh => Boolean(object));
  if (candidates.length === 0) return;
  const bounds = new Box3();
  candidates.forEach((object) => bounds.expandByObject(object));
  const center = bounds.getCenter(new Vector3());
  const currentDistance = camera.position.distanceTo(controls.target);
  const direction = camera.position.clone().sub(controls.target).normalize();
  const distance = Math.min(Math.max(currentDistance * 0.72, 4.4), 9);
  startCameraMotion({
    position: center.clone().add(direction.multiplyScalar(distance)).add(new Vector3(0, 1.1, 0)),
    target: center.clone(),
  });
}

function cancelCameraMotion(): void {
  cameraMotion = undefined;
}

function applyCameraView(view: CameraView): void {
  camera.position.copy(view.position);
  controls.target.copy(view.target);
  controls.update();
}

function startCameraMotion(view: CameraView, duration = 720): void {
  if (motionReduced) {
    cancelCameraMotion();
    applyCameraView(view);
    return;
  }
  cameraMotion = {
    fromPosition: camera.position.clone(),
    toPosition: view.position.clone(),
    fromTarget: controls.target.clone(),
    toTarget: view.target.clone(),
    started: performance.now(),
    duration,
  };
}

function fitFourBarLabCamera(transition = false): void {
  if (!fourBarLab) return;
  const view = createFitCameraView(fourBarLab.bounds(), camera.fov);
  if (!labHomeView || fourBarLab.currentVisualState === 'assembled') {
    labHomeView = { position: view.position.clone(), target: view.target.clone() };
  }
  if (transition) startCameraMotion(view);
  else applyCameraView(view);
}

function frameFourBarLabVisualState(exploded: boolean): void {
  if (!fourBarLab) return;
  if (!exploded) {
    cancelHandGrab();
    fourBarLab.clearInspectionOffsets();
  }
  const targetBounds = fourBarLab.boundsForVisualState(exploded);
  fourBarLab.setExploded(exploded, motionReduced);
  startCameraMotion(createFitCameraView(targetBounds, camera.fov));
  updateFourBarLabReadout();
}

function focusFourBarLabRole(role: BarName): void {
  if (!fourBarLab) return;
  startCameraMotion(createFocusCameraView(fourBarLab.boundsFor(role), camera.fov, camera.position, controls.target));
}

function homeFourBarLabCamera(): void {
  if (labHomeView) startCameraMotion(labHomeView);
}

function updateVoiceFeedback(status: VoiceStatus, message?: string): void {
  const labels: Record<VoiceStatus, string> = {
    IDLE: 'VOICE READY', LISTENING: 'LISTENING', PROCESSING: 'PROCESSING', EXECUTING: 'EXECUTING', COMPLETE: 'COMPLETE', ERROR: 'ERROR',
  };
  const state = document.querySelector<HTMLElement>('#lab-voice-state');
  if (state) {
    state.textContent = labels[status];
    state.className = `sr-only lab-voice-state is-${status.toLowerCase()}`;
  }
  if (message) setText('#lab-voice-transcript', message);
  document.querySelector<HTMLButtonElement>('#lab-voice')?.setAttribute('aria-pressed', String(status === 'LISTENING'));
  setComposerState(status, message ?? (status === 'LISTENING' ? 'Speak a spatial command.' : undefined));
}

function focusFourBarLabComponent(role: BarName): void {
  if (!fourBarLab) return;
  fourBarLab.select(role);
  updateFourBarLabReadout();
  focusFourBarLabRole(role);
  updateComposerSuggestions();
}

function dispatchSpatialAction(action: SpatialAction): Promise<boolean> {
  if (workspaceMode !== 'four-bar-lab' || !fourBarLab) {
    if (action.kind === 'explode') { engine.apply({ type: 'explode' }); transitionAssembly(true); updateFocusVisuals(); return Promise.resolve(true); }
    if (action.kind === 'reassemble') { engine.apply({ type: 'reassemble' }); transitionAssembly(false); updateFocusVisuals(); return Promise.resolve(true); }
    if (action.kind === 'fit') { focusCamera(activePlan.elements.filter((element) => element.kind === 'wall').map((element) => element.id)); return Promise.resolve(true); }
    if (action.kind === 'home') { startCameraMotion({ position: new Vector3(8.4, 7.6, 9.2), target: new Vector3(4.5, 0, -3.2) }); return Promise.resolve(true); }
    return Promise.resolve(false);
  }
  return orchestrator.dispatch(action);
}

function dispatchTextCommand(input: string, allowBackendFallback = false): Promise<boolean> {
  const parsed = parseSpatialCommand(input);
  if (parsed.status === 'unknown') {
    if (allowBackendFallback) return executeLabExperiment(input);
    setText('#answer', parsed.reason);
    setLabExperimentState('ERROR', parsed.reason);
    return Promise.resolve(false);
  }
  if (parsed.action.kind === 'update_length') {
    const normalizedInstruction = instructionForLengthUpdate(parsed.action.componentId, parsed.action.value, parsed.action.unit);
    const input = document.querySelector<HTMLTextAreaElement>('#question');
    if (input) input.value = normalizedInstruction;
  }
  setComposerState('EXECUTING', `Executing ${parsed.action.kind.replace('_', ' ')}.`);
  return dispatchSpatialAction(parsed.action).then((succeeded) => {
    if (succeeded && composerState === 'EXECUTING') setComposerState('COMPLETE', 'Spatial action complete.');
    return succeeded;
  });
}

function initializeSpatialOrchestrator(): void {
  orchestrator = new SpatialActionOrchestrator({
    focus: focusFourBarLabComponent,
    fit: () => { if (workspaceMode === 'four-bar-lab') fitFourBarLabCamera(true); },
    home: () => { if (workspaceMode === 'four-bar-lab') homeFourBarLabCamera(); },
    explode: () => { if (workspaceMode === 'four-bar-lab') frameFourBarLabVisualState(true); },
    reassemble: () => { if (workspaceMode === 'four-bar-lab') frameFourBarLabVisualState(false); },
    updateLength: (action) => executeLabExperiment(instructionForLengthUpdate(action.componentId, action.value, action.unit)),
    cancelPending: cancelLabExperiment,
    onStateChange: (state: OrchestratorState) => {
      if (state === 'PENDING') {
        setText('#mode-label', 'processing command');
        setComposerState('PROCESSING', 'Validating the command against the current mechanism.');
      }
      if (state === 'EXECUTING') setComposerState('EXECUTING', 'Executing spatial action.');
    },
  });
  voiceInput = new BrowserVoiceInput({
    onStatus: updateVoiceFeedback,
    onTranscript: (value) => setText('#lab-voice-transcript', value),
    onCommand: async (value) => {
      updateVoiceFeedback('EXECUTING', value);
      return dispatchTextCommand(value);
    },
  });
  if (!voiceInput.supported) updateVoiceFeedback('ERROR', 'Voz indisponível neste browser. A entrada textual continua activa.');
}

initializeSpatialOrchestrator();

function updateLabInteractionAvailability(): void {
  const inspection = fourBarLab?.currentVisualState === 'inspection';
  const disabled = labExperimentBusy;
  for (const selector of ['#question', '#lab-angle', '#lab-branch']) {
    const element = document.querySelector<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(selector);
    if (element) element.disabled = disabled;
  }
  const restore = document.querySelector<HTMLButtonElement>('#lab-restore-original');
  if (restore) restore.disabled = disabled || inspection;
}

function updateFourBarLabReadout(result: FourBarResult = fourBarLab?.currentResult as FourBarResult): void {
  if (!result) return;
  const visualState: FourBarVisualState = fourBarLab?.currentVisualState ?? 'assembled';
  const inspection = visualState === 'inspection';
  setText('#lab-angle-value', `${Math.round(result.inputAngleRad * 180 / Math.PI)}°`);
  setText('#lab-status', result.status.toUpperCase());
  setText('#lab-visual-state', inspection ? 'INSPECTION' : 'ASSEMBLED');
  setText('#lab-residual', formatResidual(fourBarLabResidual(result)));
  setText('#lab-closure', formatResidual(result.residuals?.closureResidualMm));
  setText('#lab-reason', inspection ? 'Inspection mode: visual offsets only; solver coordinates and dimensions are unchanged.' : result.status === 'solved' ? 'All four links satisfy the requested configuration.' : result.reason ?? 'No real coordinates returned for this configuration.');
  setText('#status', inspection ? `FOUR-BAR LAB · INSPECTION · ${result.status.toUpperCase()}` : `FOUR-BAR LAB · ${result.status.toUpperCase()} · ${FOUR_BAR_LAB_MODE}`);
  setText('#mode-label', inspection ? 'inspection mode' : 'four-bar lab');
  if (inspection) {
    setText('#answer', 'Components separated for visual inspection. The deterministic solver state is unchanged.');
  } else if (document.querySelector('#answer')?.textContent?.startsWith('Components separated')) {
    setText('#answer', 'Four-bar lab active. Select a bar or change the input angle.');
  }
  const selected = fourBarLab?.selected;
  setText('#selection', selected ? `active focus · ${selected}` : 'no active focus');
  updateComposerSuggestions();
  updateLabInteractionAvailability();
}

function updateLabDimensionReadout(): void {
  for (const role of ['ground', 'crank', 'coupler', 'rocker'] as const) setText(`#lab-length-${role}`, `${labLengths[role]} mm`);
}

function setLabExperimentState(state: 'READY' | 'RUNNING' | 'APPLIED' | 'BLOCKED' | 'ERROR', message: string): void {
  const stateElement = document.querySelector<HTMLElement>('#lab-experiment-state');
  if (stateElement) {
    stateElement.textContent = state;
    stateElement.className = `lab-experiment-state is-${state.toLowerCase()}`;
  }
  setText('#lab-experiment-message', message);
  if (state === 'RUNNING') setComposerState('PROCESSING', message);
  if (state === 'APPLIED') setComposerState('COMPLETE', message);
  if (state === 'BLOCKED' || state === 'ERROR') setComposerState('ERROR', message);
  if (state === 'READY' && composerState !== 'LISTENING') setComposerState('IDLE', message);
}

function setLabExperimentReadout(operation: string, change: string, states: string): void {
  setText('#lab-experiment-operation', operation);
  setText('#lab-experiment-change', change);
  setText('#lab-experiment-states', states);
}

function setLabExperimentBusy(busy: boolean): void {
  labExperimentBusy = busy;
  updateLabInteractionAvailability();
}

function isCurrentLabExperiment(sequence: number, scene: FourBarLabScene): boolean {
  return workspaceMode === 'four-bar-lab' && fourBarLab === scene && sequence === labExperimentSequence;
}

function labErrorMessage(payload: unknown): string {
  if (typeof payload === 'object' && payload !== null && 'error' in payload) {
    const error = (payload as { error?: { message?: unknown } }).error;
    if (typeof error?.message === 'string') return error.message;
  }
  return 'A API não devolveu uma resposta utilizável.';
}

function cancelLabExperiment(): void {
  labExperimentSequence += 1;
  labExperimentAbort?.abort();
  labExperimentAbort = undefined;
  setLabExperimentBusy(false);
}

async function executeLabExperiment(instructionOverride?: string): Promise<boolean> {
  if (labExperimentBusy || workspaceMode !== 'four-bar-lab' || !fourBarLab) return false;
  if (fourBarLab.currentVisualState === 'inspection') {
    setLabExperimentState('BLOCKED', 'Remonta o mecanismo antes de executar uma experiência cinemática.');
    return false;
  }
  const instruction = instructionOverride?.trim() ?? document.querySelector<HTMLTextAreaElement>('#question')?.value.trim() ?? '';
  if (!instruction) {
    setLabExperimentState('BLOCKED', 'Escreve uma instrução antes de executar.');
    return false;
  }

  const sceneAtRequest = fourBarLab;
  const beforeLengths = { ...labLengths };
  const beforeResult = sceneAtRequest.currentResult;
  const sequence = ++labExperimentSequence;
  const abort = new AbortController();
  labExperimentAbort = abort;
  setLabExperimentBusy(true);
  setLabExperimentState('RUNNING', 'A instrução está a ser validada pelo backend.');

  try {
    const request = createPhase4AExperimentRequest(instruction, beforeLengths, beforeResult.inputAngleRad, sceneAtRequest.currentBranch);
    request.mechanismId = PHASE4A_MECHANISM_ID;
    const response = await fetch(`${API_BASE_URL}/experiments/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal: abort.signal,
    });
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error('A API devolveu JSON inválido.');
    }
    if (!isCurrentLabExperiment(sequence, sceneAtRequest)) return false;
    if (!response.ok) throw new Error(labErrorMessage(payload));
    const validation = validatePhase4AExperimentResponse(payload, beforeLengths, beforeResult.inputAngleRad, sceneAtRequest.currentBranch);
    if (validation.status === 'blocked') throw new Error(validation.message);

    const experiment = validation.response;
    const nextLengths: FourBarLengths = { ...beforeLengths, crank: experiment.operation.newValue };
    const nextResult = solveFourBar({ lengths: nextLengths, inputAngleRad: beforeResult.inputAngleRad, branch: sceneAtRequest.currentBranch });
    if (nextResult.status !== experiment.after.result.status || beforeResult.status !== experiment.before.result.status) {
      throw new Error('A resposta não coincide com o cálculo determinístico local.');
    }
    setLabExperimentReadout(
      `${experiment.operation.action} · ${experiment.operation.componentId}`,
      `${beforeLengths.crank} → ${experiment.operation.newValue} mm`,
      `before ${experiment.before.result.status} / after ${experiment.after.result.status}`,
    );
    if (nextResult.status === 'solved') {
      labLengths = nextLengths;
      sceneAtRequest.setLengths(nextLengths);
      updateLabDimensionReadout();
      updateFourBarLabReadout(sceneAtRequest.currentResult);
      fitFourBarLabCamera(true);
      setLabExperimentState('APPLIED', 'Operação validada. A cena foi actualizada pelo solver local.');
    } else if (nextResult.status === 'impossible') {
      updateFourBarLabReadout(sceneAtRequest.currentResult);
      setLabExperimentState('BLOCKED', 'A configuração proposta é impossível neste ângulo. A montagem actual foi preservada.');
    } else {
      updateFourBarLabReadout(sceneAtRequest.currentResult);
      setLabExperimentState('BLOCKED', `A configuração proposta terminou em ${nextResult.status}; a montagem actual foi preservada.`);
    }
    return true;
  } catch (error) {
    if (!isCurrentLabExperiment(sequence, sceneAtRequest) || (error instanceof DOMException && error.name === 'AbortError')) return false;
    setLabExperimentState('ERROR', error instanceof Error ? error.message : 'Falha ao executar a experiência. A cena não foi alterada.');
    setLabExperimentReadout('No operation applied.', '—', `reference ${sceneAtRequest.currentResult.status}`);
    return false;
  } finally {
    if (isCurrentLabExperiment(sequence, sceneAtRequest)) {
      labExperimentAbort = undefined;
      setLabExperimentBusy(false);
    }
  }
}

function restoreOriginalLabDesign(): void {
  if (labExperimentBusy || workspaceMode !== 'four-bar-lab' || !fourBarLab) return;
  if (fourBarLab.currentVisualState === 'inspection') {
    setLabExperimentState('BLOCKED', 'Remonta o mecanismo antes de restaurar os parâmetros.');
    return;
  }
  const previousCrank = labLengths.crank;
  labLengths = { ...PHASE4A_LENGTHS };
  fourBarLab.setLengths(labLengths);
  updateLabDimensionReadout();
  updateFourBarLabReadout();
  setLabExperimentReadout('Original design restored.', `${previousCrank} → 40 mm`, 'reference solved');
  setLabExperimentState('READY', 'Parâmetros originais restaurados; nenhuma chamada foi necessária.');
    fitFourBarLabCamera(true);
}

function setSpatialCopy(): void {
  setText('#scene-title', activeVariant === 'A' ? 'Living space' : activeVariant === 'B' ? 'Hand-drawn trace' : 'Reserved test plan');
  setText('#scene-subtitle', activeVariant === 'A' ? 'A validated room structure, ready to unfold.' : 'A different structure, rendered through the same semantic engine.');
}

function setWorkspaceMode(mode: 'spatial' | 'four-bar-lab'): void {
  if (workspaceMode === mode) return;
  const panel = document.querySelector<HTMLElement>('#four-bar-lab-panel');
  const toggle = document.querySelector<HTMLButtonElement>('#toggle-four-bar');
  workspaceMode = mode;
  if (mode === 'four-bar-lab') {
    closeComposerActions();
    orchestrator.cancel();
    group.visible = false;
    labLengths = { ...PHASE4A_LENGTHS };
    fourBarLab = new FourBarLabScene();
    fourBarLab.mount(scene);
    setText('#scene-title', FOUR_BAR_LAB_MODE);
    setText('#scene-subtitle', 'A solver-driven planar mechanism, ready to inspect.');
    setText('#answer', 'Four-bar lab active. Select a bar or change the input angle.');
    setText('#question-label', 'Command the mechanism');
    setText('#mode-label', 'four-bar lab');
    setText('#selection', 'no active focus');
    setComposerState('IDLE', 'Ready for a spatial command.');
    updateComposerSuggestions();
    panel?.removeAttribute('hidden');
    panel?.setAttribute('aria-hidden', 'false');
    toggle?.setAttribute('aria-pressed', 'true');
    updateLabDimensionReadout();
    setLabExperimentReadout('No operation executed.', '—', 'before — / after —');
    setLabExperimentState('READY', 'The backend validates the operation before the scene can change.');
    fitFourBarLabCamera();
    updateFourBarLabReadout();
    return;
  }
  stopHandControl();
  voiceInput.stop();
  closeComposerActions();
  orchestrator.cancel();
  cancelLabExperiment();
  cancelCameraMotion();
  fourBarLab?.dispose();
  fourBarLab = undefined;
  labHomeView = undefined;
  group.visible = true;
  panel?.setAttribute('hidden', '');
  panel?.setAttribute('aria-hidden', 'true');
  toggle?.setAttribute('aria-pressed', 'false');
  setSpatialCopy();
  setText('#mode-label', 'model live');
  setText('#status', 'CONTRACT VALID · SCALE UNKNOWN');
  setText('#answer', 'Ask about the model. The scene will answer in space.');
  setText('#question-label', 'Ask what the model knows');
  updateFocusVisuals();
  updateComposerSuggestions();
  focusCamera(activePlan.elements.filter((element) => element.kind === 'wall').map((element) => element.id));
}

function selectFourBarRole(role: BarName | undefined): void {
  if (role) void dispatchSpatialAction({ kind: 'focus', componentId: role });
}

function updateFocusVisuals(): void {
  const state = engine.state();
  for (const [id, object] of objects) {
    object.visible = !state.hidden.includes(id);
    const material = object.material as MeshStandardMaterial;
    const focused = state.selected.includes(id) || state.highlighted.includes(id);
    material.color.set(focused ? '#f0c67e' : object.userData.baseColor ?? '#d5dfdb');
    material.emissive.set(focused ? '#b97835' : '#000000');
    material.emissiveIntensity = focused ? 0.56 : 0;
  }
  render2d();
  document.querySelector('#selection')!.textContent = state.selected.length ? `active focus · ${state.selected.join(' / ')}` : 'no active focus';
}

function selectIds(ids: string[]): void {
  const validIds = ids.filter((id) => id && activePlan.elements.some((element) => element.id === id));
  if (!validIds.length) return;
  engine.apply({ type: 'select', ids: validIds });
  engine.apply({ type: 'highlight', ids: validIds });
  focusCamera(validIds);
  document.querySelector('#mode-label')!.textContent = 'AI focus locked';
  updateFocusVisuals();
}

function applyQuestion(): void {
  if (workspaceMode === 'four-bar-lab') {
    const input = document.querySelector<HTMLTextAreaElement>('#question')?.value ?? '';
    void dispatchTextCommand(input);
    return;
  }
  const question = document.querySelector<HTMLTextAreaElement>('#question')!.value;
  const answer = answerSpatialQuestion(activePlan, question);
  engine.apply({ type: 'reset' });
  if (answer.ids.length) {
    engine.apply({ type: 'highlight', ids: answer.ids });
    engine.apply({ type: 'select', ids: answer.ids.filter((id) => id.startsWith('room-')) });
    focusCamera(answer.ids);
  }
  document.querySelector('#answer')!.textContent = answer.text;
  document.querySelector('#mode-label')!.textContent = answer.ids.length ? 'AI focus active' : 'model uncertain';
  setComposerState(answer.ids.length ? 'COMPLETE' : 'ERROR', answer.text);
  updateFocusVisuals();
}

function loadFixture(variant: 'A' | 'B' | 'C'): void {
  activeVariant = variant;
  activePlan = createFixturePlan(variant);
  engine.apply({ type: 'reset' });
  setSpatialCopy();
  renderPlan();
  updateFocusVisuals();
  if (workspaceMode === 'spatial') focusCamera(activePlan.elements.filter((element) => element.kind === 'wall').map((element) => element.id));
}

function toggleReference(open?: boolean): void {
  const drawer = document.querySelector('#reference-drawer')!;
  const scrim = document.querySelector('#drawer-scrim')!;
  const isOpen = open ?? !drawer.classList.contains('is-open');
  drawer.classList.toggle('is-open', isOpen);
  scrim.classList.toggle('is-visible', isOpen);
  drawer.setAttribute('aria-hidden', String(!isOpen));
  document.querySelector('#toggle-reference')!.setAttribute('aria-expanded', String(isOpen));
}

document.querySelector('#explode')!.addEventListener('click', () => {
  if (workspaceMode === 'four-bar-lab' && fourBarLab) { void dispatchSpatialAction({ kind: 'explode' }); return; }
  engine.apply({ type: 'explode' }); transitionAssembly(true); updateFocusVisuals();
});
document.querySelector('#reassemble')!.addEventListener('click', () => {
  if (workspaceMode === 'four-bar-lab' && fourBarLab) { void dispatchSpatialAction({ kind: 'reassemble' }); return; }
  engine.apply({ type: 'reassemble' }); transitionAssembly(false); updateFocusVisuals();
});
document.querySelector('#reset')!.addEventListener('click', () => {
  if (labExperimentBusy) return;
  if (workspaceMode === 'four-bar-lab' && fourBarLab) {
    void dispatchSpatialAction({ kind: 'reassemble' });
    fourBarLab.setAngle(0);
    fourBarLab.setBranch('plus');
    fourBarLab.select(undefined);
    const angle = document.querySelector<HTMLInputElement>('#lab-angle');
    const branch = document.querySelector<HTMLSelectElement>('#lab-branch');
    if (angle) angle.value = '0';
    if (branch) branch.value = 'plus';
    updateFourBarLabReadout();
    setLabExperimentState('READY', 'Configuração angular restaurada; a montagem continua com os parâmetros actuais.');
    return;
  }
  engine.apply({ type: 'reset' }); transitionAssembly(false); setText('#mode-label', 'model live'); updateFocusVisuals();
});
document.querySelector('#isolate')!.addEventListener('click', () => {
  if (workspaceMode === 'four-bar-lab') { setText('#answer', 'Isolate focus is available for spatial elements. Use FOCUS BAR in Four-Bar Lab.'); return; }
  const state = engine.state();
  const ids = state.highlighted.length ? state.highlighted : state.selected;
  if (ids.length) { engine.apply({ type: 'isolate', ids }); document.querySelector('#mode-label')!.textContent = 'focus isolated'; updateFocusVisuals(); }
});
document.querySelector('#submit-question')!.addEventListener('click', applyQuestion);
document.querySelector('#toggle-reference')!.addEventListener('click', () => toggleReference());
document.querySelector('#toggle-four-bar')!.addEventListener('click', () => setWorkspaceMode(workspaceMode === 'spatial' ? 'four-bar-lab' : 'spatial'));
document.querySelector('#hand-control-toggle')!.addEventListener('click', () => {
  if (handControlEnabled) stopHandControl();
  else void startHandControl();
});
document.querySelector('#close-reference')!.addEventListener('click', () => toggleReference(false));
document.querySelector('#drawer-scrim')!.addEventListener('click', () => toggleReference(false));
for (const variant of ['A', 'B', 'C'] as const) document.querySelector(`#fixture-${variant.toLowerCase()}`)!.addEventListener('click', () => loadFixture(variant));
document.querySelector<HTMLSelectElement>('#lab-branch')!.addEventListener('change', (event) => {
  if (!fourBarLab || labExperimentBusy) return;
  const result = fourBarLab.setBranch((event.target as HTMLSelectElement).value as AssemblyBranch);
  updateFourBarLabReadout(result);
  setLabExperimentState('READY', 'Parâmetros alterados; executa uma nova instrução para obter uma comparação.');
});
document.querySelector<HTMLInputElement>('#lab-angle')!.addEventListener('input', (event) => {
  if (!fourBarLab || labExperimentBusy) return;
  const result = fourBarLab.setAngle(Number((event.target as HTMLInputElement).value));
  updateFourBarLabReadout(result);
  setLabExperimentState('READY', 'Parâmetros alterados; executa uma nova instrução para obter uma comparação.');
});
document.querySelectorAll<HTMLButtonElement>('[data-lab-role]').forEach((button) => {
  button.addEventListener('click', () => selectFourBarRole(button.dataset.labRole as BarName));
});
document.querySelector('#composer-fit')!.addEventListener('click', () => {
  void dispatchSpatialAction({ kind: 'fit' });
});
document.querySelector('#composer-home')!.addEventListener('click', () => {
  void dispatchSpatialAction({ kind: 'home' });
});
document.querySelector<HTMLTextAreaElement>('#question')!.addEventListener('input', (event) => {
  const input = event.currentTarget as HTMLTextAreaElement;
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 132)}px`;
  if (!labExperimentBusy) setComposerState(input.value.trim() ? 'TYPING' : 'IDLE', input.value.trim() ? 'Command ready to send.' : 'Ready for a spatial command.');
});
document.querySelector<HTMLTextAreaElement>('#question')!.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    applyQuestion();
  }
});
document.querySelector('#lab-restore-original')!.addEventListener('click', restoreOriginalLabDesign);
document.querySelector('#lab-voice')!.addEventListener('click', () => {
  if (voiceInput.status === 'LISTENING') voiceInput.stop();
  else voiceInput.start();
});
document.querySelector('#composer-add-image')!.addEventListener('click', () => document.querySelector<HTMLInputElement>('#image-input')?.click());
document.querySelector('#composer-actions-toggle')!.addEventListener('click', () => {
  const menu = document.querySelector<HTMLElement>('#composer-actions-menu');
  const toggle = document.querySelector<HTMLButtonElement>('#composer-actions-toggle');
  if (!menu || !toggle) return;
  const open = menu.hidden;
  menu.hidden = !open;
  toggle.setAttribute('aria-expanded', String(open));
});
document.querySelector('#composer-reset-position')!.addEventListener('click', resetComposerPosition);
document.querySelector('#composer-actions-menu')!.addEventListener('click', closeComposerActions);
document.querySelector('#lab-voice')!.addEventListener('click', closeComposerActions);
document.querySelector('#submit-question')!.addEventListener('click', closeComposerActions);
document.querySelector('#composer-add-image')!.addEventListener('click', closeComposerActions);
document.querySelector('#composer-suggestions')!.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-suggestion]');
  if (button?.dataset.suggestion) void dispatchTextCommand(button.dataset.suggestion);
});
document.addEventListener('pointerdown', (event) => {
  const target = event.target as Node;
  const composer = document.querySelector('#spatial-composer');
  const menu = document.querySelector<HTMLElement>('#composer-actions-menu');
  if (menu && !menu.hidden && composer && !composer.contains(target)) {
    closeComposerActions();
  }
});
document.querySelector('#composer-drag-handle')!.addEventListener('pointerdown', (event) => {
  const pointer = event as PointerEvent;
  if (pointer.button !== 0) return;
  composerDrag = { pointerId: pointer.pointerId, startX: pointer.clientX, startY: pointer.clientY, offsetX: composerPosition.x, offsetY: composerPosition.y };
  (pointer.currentTarget as HTMLElement).setPointerCapture(pointer.pointerId);
  document.querySelector('#spatial-composer')?.classList.add('is-dragging');
});
document.addEventListener('pointermove', (event) => {
  if (!composerDrag || event.pointerId !== composerDrag.pointerId) return;
  setComposerPosition({ x: composerDrag.offsetX + event.clientX - composerDrag.startX, y: composerDrag.offsetY + event.clientY - composerDrag.startY });
  clampComposerPosition();
});
document.addEventListener('pointerup', (event) => {
  if (!composerDrag || event.pointerId !== composerDrag.pointerId) return;
  composerDrag = undefined;
  document.querySelector('#spatial-composer')?.classList.remove('is-dragging');
});
document.querySelector('#composer-drag-handle')!.addEventListener('keydown', (event) => {
  const keyboard = event as KeyboardEvent;
  const step = keyboard.shiftKey ? 64 : 24;
  if (keyboard.key === 'Home') { keyboard.preventDefault(); resetComposerPosition(); return; }
  const deltas: Record<string, { x: number; y: number }> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } };
  const delta = deltas[keyboard.key];
  if (delta) { keyboard.preventDefault(); setComposerPosition({ x: composerPosition.x + delta.x, y: composerPosition.y + delta.y }); clampComposerPosition(); }
});
document.querySelector('#image-input')!.addEventListener('change', (event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) { document.querySelector('#answer')!.textContent = `Image loaded: ${file.name}. Meta interpretation is unavailable until MODEL_API_KEY is configured.`; document.querySelector('#mode-label')!.textContent = 'input awaiting interpretation'; setComposerState('COMPLETE', 'Image attached. Interpretation remains explicit and server-side.'); }
});
renderer.domElement.addEventListener('pointerdown', (event) => {
  const rect = renderer.domElement.getBoundingClientRect();
  const pointer = new Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  const raycaster = new Raycaster(); raycaster.setFromCamera(pointer, camera);
  if (workspaceMode === 'four-bar-lab') {
    const hit = raycaster.intersectObjects(fourBarLab?.selectableMeshes() ?? [])[0];
    if (hit?.object.userData.labRole) selectFourBarRole(hit.object.userData.labRole as BarName);
    return;
  }
  const hit = raycaster.intersectObjects([...objects.values()])[0];
  if (hit?.object.userData.id) selectIds([hit.object.userData.id]);
});
window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (event) => { motionReduced = event.matches; });
window.addEventListener('resize', () => { resize(); clampComposerPosition(); });
window.visualViewport?.addEventListener('resize', clampComposerPosition);
renderPlan();
updateFocusVisuals();
focusCamera(activePlan.elements.filter((element) => element.kind === 'wall').map((element) => element.id));
setComposerPosition({ x: 0, y: 0 });
clampComposerPosition();

function animate(): void {
  requestAnimationFrame(animate);
  const now = performance.now();
  for (const [id, motion] of motions) {
    const object = objects.get(id);
    if (!object) continue;
    const progress = Math.min((now - motion.started) / motion.duration, 1);
    object.position.lerpVectors(motion.from, motion.to, EASE(progress));
    if (progress >= 1) motions.delete(id);
  }
  if (cameraMotion) {
    const progress = Math.min((now - cameraMotion.started) / cameraMotion.duration, 1);
    const eased = EASE(progress);
    camera.position.lerpVectors(cameraMotion.fromPosition, cameraMotion.toPosition, eased);
    controls.target.lerpVectors(cameraMotion.fromTarget, cameraMotion.toTarget, eased);
    if (progress >= 1) cameraMotion = undefined;
  }
  if (fourBarLab) {
    const previousVisualState = fourBarLab.currentVisualState;
    fourBarLab.update(now);
    if (previousVisualState !== fourBarLab.currentVisualState) updateFourBarLabReadout();
  }
  controls.update();
  renderer.render(scene, camera);
}
animate();
window.addEventListener('beforeunload', () => {
  stopHandControl();
  fourBarLab?.dispose();
  disposeGroupResources(group);
  controls.dispose();
  renderer.dispose();
});
