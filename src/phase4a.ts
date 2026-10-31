import {
  AmbientLight,
  Box3,
  BoxGeometry,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  LineBasicMaterial,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PHASE4A_EVIDENCE_STATUS, PHASE4A_LENGTHS, maxResidual, scenePoint } from './phase4a-kinematics';
import { createPhase4AExperimentRequest, validatePhase4AExperimentResponse } from './phase4a-experiment';
import { solveFourBar, type AssemblyBranch, type FourBarLengths, type FourBarResult, type Point } from './kinematics';
import './phase4a.css';

const SCALE = 0.045;
const API_BASE_URL = '/api';
const EXPECTED_BACKEND_CONTRACT = 'unfold.phase4c';
const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Elemento #app não encontrado.');

app.innerHTML = `
  <main class="proof-shell">
    <div id="proof-scene" class="proof-scene" aria-label="Demonstração 3D cinemática de quatro barras"></div>
    <header class="proof-header">
      <a class="proof-back" href="/">UNFOLD <span>/ return to workspace</span></a>
      <div class="proof-title"><span class="proof-kicker">PHASE 4A</span><h1>Kinematic 3D proof</h1></div>
      <div class="proof-badge"><span class="proof-dot"></span> deterministic scene</div>
    </header>

    <section class="proof-panel proof-panel-left" aria-label="Parâmetros do mecanismo">
      <span class="proof-eyebrow">HYPOTHETICAL DESIGN</span>
      <h2>Four-bar assembly</h2>
      <p class="proof-copy">Posições calculadas directamente pelo solver planar. A cena não contém uma trajetória pré-definida.</p>
      <div class="dimension-list">
        <div><span>ground</span><strong id="dimension-ground">100 mm</strong></div>
        <div><span>crank</span><strong id="dimension-crank">40 mm</strong></div>
        <div><span>coupler</span><strong id="dimension-coupler">120 mm</strong></div>
        <div><span>rocker</span><strong id="dimension-rocker">90 mm</strong></div>
      </div>
      <div class="evidence-line"><span>evidence</span><strong>${PHASE4A_EVIDENCE_STATUS}</strong></div>
    </section>

    <section class="proof-panel proof-panel-right" aria-label="Estado do solver">
      <div class="readout-row"><span>solver state</span><strong id="solver-status" class="status-pill">SOLVED</strong></div>
      <div class="readout-row"><span>assembly</span><strong id="assembly-branch">plus branch</strong></div>
      <div class="readout-row"><span>max length error</span><strong id="length-residual">—</strong></div>
      <div class="readout-row"><span>closure residual</span><strong id="closure-residual">—</strong></div>
      <p id="solver-reason" class="solver-reason">All four links satisfy the requested configuration.</p>
    </section>

    <div class="proof-legend" aria-label="Legenda da geometria">
      <span><i class="legend-swatch fixed"></i>fixed pivots</span>
      <span><i class="legend-swatch crank"></i>input crank</span>
      <span><i class="legend-swatch passive"></i>coupler / rocker</span>
    </div>

    <section class="experiment-panel" aria-label="Experiência controlada pelo Muse Spark">
      <div class="experiment-heading"><span class="proof-eyebrow">AI EXPERIMENT</span><span id="experiment-state" class="experiment-state">READY</span></div>
      <label for="experiment-instruction">Instruction</label>
      <div class="experiment-input-row"><input id="experiment-instruction" type="text" value="Aumenta a manivela para 50 mm." autocomplete="off" /><button id="run-experiment" type="button">Run</button></div>
      <div id="experiment-readout" class="experiment-readout" aria-live="polite"><span id="experiment-operation">No operation executed.</span><strong id="experiment-change">—</strong><span id="experiment-states">before — / after —</span></div>
      <p id="experiment-message" class="experiment-message">The backend validates the operation before the scene can change.</p>
      <button id="restore-design" class="restore-design" type="button">Restore original 100 / 40 / 120 / 90 mm</button>
    </section>

    <section class="proof-controls" aria-label="Controlo da configuração">
      <div class="angle-control"><label for="angle-range">INPUT ANGLE <output id="angle-value" for="angle-range">0°</output></label><input id="angle-range" type="range" min="0" max="360" step="1" value="0" /></div>
      <label class="branch-control" for="branch-select">BRANCH<select id="branch-select"><option value="plus">plus</option><option value="minus">minus</option></select></label>
      <button id="reset-camera" type="button">Reset camera</button>
    </section>
    <div class="camera-hint">ORBIT <span>drag</span><i></i> ZOOM <span>scroll</span><i></i> PAN <span>right-drag</span></div>
    <div class="proof-footer"><span>PLANAR FOUR-BAR / 1 DOF</span><span>100 / 40 / 120 / 90 mm</span></div>
  </main>`;

const surface = document.querySelector<HTMLDivElement>('#proof-scene');
if (!surface) throw new Error('Superfície 3D não encontrada.');
const proofSurface = surface;

const scene = new Scene();
scene.background = new Color('#080d10');
const camera = new PerspectiveCamera(42, 1, 0.05, 100);
const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.domElement.setAttribute('aria-label', 'Palco 3D interactivo do mecanismo de quatro barras');
surface.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = true;
controls.screenSpacePanning = true;
controls.minDistance = 2.2;
controls.maxDistance = 24;
controls.maxPolarAngle = Math.PI * 0.47;

scene.add(new AmbientLight('#a8bbc0', 1.9));
const keyLight = new DirectionalLight('#fff3d5', 3.2);
keyLight.position.set(4, 8, 6);
keyLight.castShadow = true;
scene.add(keyLight);
const fillLight = new DirectionalLight('#75aeb7', 1.1);
fillLight.position.set(-5, 3, -6);
scene.add(fillLight);

const floor = new Mesh(new PlaneGeometry(20, 20), new MeshStandardMaterial({ color: '#0d181c', roughness: 0.9, metalness: 0.02 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.16;
floor.receiveShadow = true;
scene.add(floor);
const grid = new GridHelper(18, 36, '#28454a', '#172b30');
grid.position.y = -0.145;
(grid.material as LineBasicMaterial).opacity = 0.32;
(grid.material as LineBasicMaterial).transparent = true;
scene.add(grid);

const fixedGroup = new Group();
const dynamicGroup = new Group();
scene.add(fixedGroup, dynamicGroup);

function material(color: string, metalness = 0.2): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness: 0.42, metalness });
}

function point3(point: Point): Vector3 {
  const mapped = scenePoint(point, SCALE);
  return new Vector3(mapped.x, 0.18, mapped.z);
}

function makeBar(start: Vector3, end: Vector3, color: string, thickness = 0.14): Mesh {
  const length = start.distanceTo(end);
  const mesh = new Mesh(new BoxGeometry(length, thickness, thickness * 1.5), material(color));
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.rotation.y = Math.atan2(end.z - start.z, end.x - start.x) * -1;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function makeJoint(position: Vector3, color: string, radius = 0.16): Mesh {
  const mesh = new Mesh(new SphereGeometry(radius, 24, 16), material(color, 0.55));
  mesh.position.copy(position).setY(0.31);
  mesh.castShadow = true;
  return mesh;
}

function disposeGroup(group: Group): void {
  for (const child of [...group.children]) {
    child.traverse((object) => {
      const drawable = object as Mesh;
      if (drawable.geometry) drawable.geometry.dispose();
      const materials = Array.isArray(drawable.material) ? drawable.material : drawable.material ? [drawable.material] : [];
      materials.forEach((entry) => entry.dispose());
    });
  }
  group.clear();
}

function createFixedGeometry(): void {
  const pivotA = point3({ x: 0, y: 0 });
  const pivotB = point3({ x: PHASE4A_LENGTHS.ground, y: 0 });
  const ground = makeBar(pivotA, pivotB, '#d4ddd7', 0.18);
  ground.position.y = 0.13;
  fixedGroup.add(ground, makeJoint(pivotA, '#f0c37f', 0.19), makeJoint(pivotB, '#f0c37f', 0.19));
}

function clearDynamicGeometry(): void {
  disposeGroup(dynamicGroup);
}

function setText(selector: string, text: string): void {
  const element = document.querySelector<HTMLElement>(selector);
  if (element) element.textContent = text;
}

function formatResidual(value: number | undefined): string {
  return value === undefined ? '—' : `${value.toExponential(2)} mm`;
}

function renderResult(result: FourBarResult): void {
  clearDynamicGeometry();
  const status = document.querySelector<HTMLElement>('#solver-status');
  if (status) {
    status.textContent = result.status.toUpperCase();
    status.className = `status-pill ${result.status === 'solved' ? 'is-solved' : result.status === 'singular' ? 'is-singular' : 'is-impossible'}`;
  }
  setText('#assembly-branch', `${result.branch} branch`);
  setText('#length-residual', formatResidual(maxResidual(result)));
  setText('#closure-residual', formatResidual(result.residuals?.closureResidualMm));
  setText('#solver-reason', result.status === 'solved' ? 'All four links satisfy the requested configuration.' : result.reason ?? 'No real coordinates returned for this input angle.');
  if (!result.coordinates) return;

  const { fixedPivotA, fixedPivotB, crankCouplerJoint, couplerRockerJoint } = result.coordinates;
  const a = point3(fixedPivotA);
  const b = point3(fixedPivotB);
  const c = point3(crankCouplerJoint);
  const d = point3(couplerRockerJoint);
  const crank = makeBar(a, c, '#e8b873');
  const coupler = makeBar(c, d, '#79c8c8');
  const rocker = makeBar(d, b, '#93a9a9');
  dynamicGroup.add(crank, coupler, rocker, makeJoint(c, '#e8b873'), makeJoint(d, '#79c8c8'));
}

function resize(): void {
  const width = Math.max(proofSurface.clientWidth, 1);
  const height = Math.max(proofSurface.clientHeight, 1);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function fitCamera(): void {
  const bounds = new Box3().setFromObject(fixedGroup);
  if (dynamicGroup.children.length) bounds.expandByObject(dynamicGroup);
  const center = bounds.getCenter(new Vector3());
  const size = bounds.getSize(new Vector3());
  const span = Math.max(size.x, size.z, 1);
  const distance = span / (2 * Math.tan((camera.fov * Math.PI) / 360)) * 1.45;
  camera.position.copy(center).add(new Vector3(0.92, 0.78, 1.1).normalize().multiplyScalar(distance));
  camera.lookAt(center);
  controls.target.copy(center);
  controls.update();
  controls.saveState();
}

let angleDegrees = 0;
let branch: AssemblyBranch = 'plus';
let currentLengths: FourBarLengths = { ...PHASE4A_LENGTHS };
let experimentBusy = false;
let backendReady = false;

function currentResult(): FourBarResult {
  return solveFourBar({ lengths: { ...currentLengths }, inputAngleRad: angleDegrees * Math.PI / 180, branch });
}

function updateDimensionReadout(): void {
  for (const role of ['ground', 'crank', 'coupler', 'rocker'] as const) setText(`#dimension-${role}`, `${currentLengths[role]} mm`);
}

function setExperimentState(state: 'READY' | 'RUNNING' | 'APPLIED' | 'BLOCKED' | 'ERROR', message: string): void {
  const stateElement = document.querySelector<HTMLElement>('#experiment-state');
  if (stateElement) {
    stateElement.textContent = state;
    stateElement.className = `experiment-state is-${state.toLowerCase()}`;
  }
  setText('#experiment-message', message);
}

function setExperimentReadout(operation: string, change: string, states: string): void {
  setText('#experiment-operation', operation);
  setText('#experiment-change', change);
  setText('#experiment-states', states);
}

function errorMessage(payload: unknown): string {
  if (typeof payload === 'object' && payload !== null && 'error' in payload) {
    const error = (payload as { error?: { message?: unknown } }).error;
    if (typeof error?.message === 'string') return error.message;
  }
  return 'A API não devolveu uma resposta utilizável.';
}

async function checkBackendHealth(): Promise<void> {
  setExperimentState('RUNNING', 'A verificar o contrato do backend.');
  try {
    const response = await fetch(`${API_BASE_URL}/health`, { cache: 'no-store' });
    const payload = await response.json() as { status?: unknown; contract?: unknown };
    if (!response.ok || payload.status !== 'ok' || payload.contract !== EXPECTED_BACKEND_CONTRACT) {
      throw new Error('Backend incompatível ou indisponível.');
    }
    backendReady = true;
    setExperimentState('READY', 'Backend phase4c disponível; pronto para experimentar.');
  } catch {
    backendReady = false;
    setExperimentState('ERROR', 'Backend phase4c indisponível. A cena não pode executar experiências.');
  }
}

async function executeExperiment(): Promise<void> {
  if (experimentBusy) return;
  if (!backendReady) {
    setExperimentState('ERROR', 'Backend phase4c indisponível. Nenhum pedido foi enviado.');
    return;
  }
  const instructionElement = document.querySelector<HTMLInputElement>('#experiment-instruction');
  const button = document.querySelector<HTMLButtonElement>('#run-experiment');
  const instruction = instructionElement?.value.trim() ?? '';
  if (!instruction) {
    setExperimentState('BLOCKED', 'Escreve uma instrução antes de executar.');
    return;
  }
  experimentBusy = true;
  if (button) { button.disabled = true; button.textContent = 'Running…'; }
  setExperimentState('RUNNING', 'A instrução está a ser validada pelo backend.');
  try {
    const beforeLengths = { ...currentLengths };
    const beforeResult = currentResult();
    const response = await fetch(`${API_BASE_URL}/experiments/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createPhase4AExperimentRequest(instruction, beforeLengths, beforeResult.inputAngleRad, branch)),
    });
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error('A API devolveu JSON inválido.');
    }
    if (!response.ok) throw new Error(errorMessage(payload));
    const validation = validatePhase4AExperimentResponse(payload, beforeLengths, beforeResult.inputAngleRad, branch);
    if (validation.status === 'blocked') throw new Error(validation.message);
    const experiment = validation.response;
    const nextLengths: FourBarLengths = { ...beforeLengths, crank: experiment.operation.newValue };
    const nextResult = solveFourBar({ lengths: nextLengths, inputAngleRad: beforeResult.inputAngleRad, branch });
    if (nextResult.status !== experiment.after.result.status || beforeResult.status !== experiment.before.result.status) throw new Error('A resposta não coincide com o cálculo determinístico local.');
    setExperimentReadout(
      `${experiment.operation.action} · ${experiment.operation.componentId}`,
      `${beforeLengths.crank} → ${experiment.operation.newValue} mm`,
      `before ${experiment.before.result.status} / after ${experiment.after.result.status}`,
    );
    if (nextResult.status === 'solved') {
      currentLengths = nextLengths;
      updateScene();
      setExperimentState('APPLIED', 'Operação validada. A cena foi actualizada pelo solver local.');
    } else if (nextResult.status === 'impossible') {
      updateScene();
      setExperimentState('BLOCKED', 'A configuração proposta é impossível neste ângulo. A referência original foi preservada.');
    } else {
      updateScene();
      setExperimentState('BLOCKED', `A configuração proposta terminou em ${nextResult.status}; a referência original foi preservada.`);
    }
  } catch (error) {
    updateScene();
    setExperimentState('ERROR', error instanceof Error ? error.message : 'Falha ao executar a experiência. A cena não foi alterada.');
    setExperimentReadout('No operation applied.', '—', `reference ${currentResult().status}`);
  } finally {
    experimentBusy = false;
    if (button) { button.disabled = false; button.textContent = 'Run'; }
  }
}

function restoreOriginalDesign(): void {
  currentLengths = { ...PHASE4A_LENGTHS };
  updateScene();
  setExperimentReadout('Original design restored.', '40 mm crank', 'reference solved');
  setExperimentState('READY', 'Parâmetros originais restaurados; nenhuma chamada foi necessária.');
}

function updateScene(): void {
  const result = currentResult();
  setText('#angle-value', `${angleDegrees}°`);
  updateDimensionReadout();
  renderResult(result);
}

document.querySelector<HTMLInputElement>('#angle-range')?.addEventListener('input', (event) => {
  angleDegrees = Number((event.target as HTMLInputElement).value);
  updateScene();
});
document.querySelector<HTMLSelectElement>('#branch-select')?.addEventListener('change', (event) => {
  branch = (event.target as HTMLSelectElement).value as AssemblyBranch;
  updateScene();
});
document.querySelector<HTMLButtonElement>('#reset-camera')?.addEventListener('click', () => controls.reset());
document.querySelector<HTMLButtonElement>('#run-experiment')?.addEventListener('click', () => { void executeExperiment(); });
document.querySelector<HTMLInputElement>('#experiment-instruction')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); void executeExperiment(); } });
document.querySelector<HTMLButtonElement>('#restore-design')?.addEventListener('click', restoreOriginalDesign);
window.addEventListener('resize', resize);

createFixedGeometry();
resize();
updateScene();
fitCamera();
void checkBackendHealth();

function animate(): void {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

animate();
