import { AmbientLight, Box3, Box3Helper, BufferGeometry, Color, DirectionalLight, DoubleSide, Float32BufferAttribute, GridHelper, Group, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, Quaternion, Raycaster, Scene, Texture, TextureLoader, Vector2, Vector3, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { gsap } from 'gsap';
import { decodePlanImage } from './plan-image';
import { buildPlanVectorModel, countClosedCandidateContours, detectCandidateIntersections, detectWallCandidates, mergeWallCandidates, splitWallCandidate, traceWallCandidate, type PixelWallCandidate, type Point2 } from './plan-reconstruction';
import { addOpeningToScene, createPlanScene, planOpeningEdit, planWallEdit, type CompositePlan } from './plan-scene';
import { createSceneAuthorizer } from './scene-authorizer';
import { confirmedNotice, explainSceneError } from './scene-messages';
import type { ConfirmedReference } from './scene-authorization';
import type { CommandOrigin } from './core';
import { ARCHITECTURAL_MODULE_DIMENSIONS, buildThreePlanGroup, type ArchitecturalAssets } from './plan-three-adapter';
import { commitScenePreview, deserializeSceneTransaction, previewSceneCommand, serializeSceneTransaction, type Node, type SceneCommandContext, type ScenePreview, type SceneTransaction, type SpatialCommand, type SpatialSceneV1 } from './spatial-scene';
import { clearSpatialSourceImage, readSpatialSourceImage } from './spatial-source-store';
import { createSpatialCommandEnvelope, parseSpatialIntentV1, resolveSpatialTarget, type SpatialCommandOrigin, type SpatialCommandState, type SpatialCommandV1 } from './spatial-command-protocol';
import { registerSpatialCommandHandler, type SpatialCommandOutcome } from './spatial-command-runtime';
import { prepareSpatialHandoff } from './spatial-handoff';
import { parseSpatialAgentResult, SPATIAL_AGENT_REQUEST_SCHEMA, spatialDomainConflict, type SpatialAgentRequestV1, type SpatialAgentAction } from './spatial-agent';
import type { TechnicalDocumentV1 } from './technical-document';
import { cameraFrameAspect, createSpatialCameraView, createSpatialFocusView } from './spatial-camera';
import './spatial-editor.css';

export type SpatialEditorOptions = { onExit?: () => void; source?: 'accepted-document'; onCommandState?: (state: SpatialCommandState, message: string) => void };

export function mountSpatialEditor(app: HTMLElement, options: SpatialEditorOptions = {}): () => void {
const acceptedDocumentSource = options.source === 'accepted-document' || new URLSearchParams(location.search).get('source') === 'accepted-document';

app.innerHTML = `<main class="spatial-lab" data-state="empty">
  <div id="spatial-canvas" aria-label="Cena tridimensional editável"></div>
  <header class="spatial-header"><a href="/demo" class="brand"><b>UNFOLD</b><span>LABORATÓRIO ESPACIAL</span></a><div class="header-tools"><span id="scene-state">SEM CENA</span><button id="open-scene" type="button">Abrir cena</button><input id="scene-file" type="file" accept=".json,application/json" hidden><button id="save-scene" type="button" disabled>Guardar</button><button id="restore-scene" type="button" disabled>Restaurar</button><button id="exit-spatial-editor" class="return-link" type="button">Voltar ao laboratório</button></div></header>
  <aside id="source-panel" class="source-panel" aria-label="Fonte e tracing da planta">
    <div class="panel-heading"><span>01 / DOCUMENTO-FONTE</span><button id="source-toggle" type="button" aria-expanded="true" aria-label="Recolher referência">−</button></div>
    <label class="file-pick" for="plan-file"><span>Importar planta</span><small>PNG · JPEG · WebP · até 20 MiB</small><input id="plan-file" type="file" accept="image/png,image/jpeg,image/webp"></label>
    <div id="plan-workflow" hidden>
      <div class="source-image-frame"><img id="source-image" alt="Planta original, sem alteração"><svg id="plan-overlay" aria-label="Linhas candidatas e traçados manuais"></svg></div>
      <p id="plan-meta" class="micro-copy">Imagem original preservada.</p><section id="accepted-document-context" class="document-handoff" hidden aria-label="Preparação espacial do documento aceite"></section>
      <div class="reference-modes" role="group" aria-label="Vista da reconstrução"><button type="button" data-view-mode="original" aria-pressed="true">Original</button><button type="button" data-view-mode="trace" aria-pressed="false">Tracing</button><button type="button" data-view-mode="model" aria-pressed="false">3D</button><button type="button" data-view-mode="compare" aria-pressed="false">Sobrepor</button></div>
      <details class="workflow-section" open>
      <summary>02 / TRAÇAR E REVISAR</summary>
      <div class="trace-tools"><button id="detect-lines" type="button">Detectar linhas</button><button id="trace-mode" type="button" aria-pressed="false">Traçar parede</button><button id="scale-mode" type="button" aria-pressed="false">Marcar escala</button><button id="split-segment" type="button" disabled>Dividir</button><button id="join-segments" type="button" disabled>Unir colineares</button></div>
      <label class="field">Sensibilidade das linhas <output id="detection-threshold-value">150</output><input id="detection-threshold" type="range" min="80" max="220" step="5" value="150"></label>
      <p class="micro-copy">O detector só propõe linhas axiais. Confirme visualmente cada segmento; não usa cotas, áreas ou nomes de divisões para inventar escala.</p>
      <div class="candidate-heading"><span>SEGMENTOS A INCLUIR</span><button id="clear-selection" type="button">Limpar</button></div><p id="contour-summary" class="micro-copy">Contornos não avaliados; área métrica não confirmada.</p><div id="candidate-list" class="candidate-list"></div><div class="candidate-heading"><span>REGIÕES FECHADAS CANDIDATAS</span></div><div id="region-list" class="candidate-list"></div><div class="candidate-heading"><span>DESCONTINUIDADES / ABERTURAS AMBÍGUAS</span></div><div id="opening-candidate-list" class="candidate-list"></div>
      </details>
      <details class="workflow-section">
      <summary>03 / CALIBRAR E CONSTRUIR</summary>
      <label class="field">Comprimento da cota seleccionada<input id="scale-distance" type="number" min="0.001" step="any" placeholder="Introduza o valor impresso"></label>
      <label class="field">Unidade<select id="scale-unit"><option value="m">Metros (m)</option><option value="cm">Centímetros (cm)</option><option value="mm">Milímetros (mm)</option><option value="ft">Pés (ft)</option><option value="in">Polegadas (in)</option></select></label>
      <div class="dimensions-grid"><label class="field">Altura de modelação (m)<input id="wall-height" type="number" min="0.01" step="any" placeholder="Obrigatório · hipótese explícita"></label><label class="field">Espessura (m)<input id="wall-thickness" type="number" min="0.01" step="any" placeholder="Obrigatório · hipótese explícita"></label></div>
      <label class="field">Nota da escala / origem<input id="scale-evidence" maxlength="300" placeholder="Ex.: cota impressa seleccionada no original"></label>
      <button id="build-scene" class="primary-action" type="button" disabled>Construir geometria proposta</button>
      </details>
      <details class="module-palette"><summary>MÓDULOS BLENDER · CONCEPTUAIS, NÃO DERIVADOS DA PLANTA</summary><label class="field">Biblioteca<select id="module-choice"><option value="wall_ext_3000">Parede exterior</option><option value="partition_int_3000">Divisória</option><option value="door_single_900">Porta</option><option value="window_double_1200">Janela</option><option value="connector_corner_90">Conector de canto</option><option value="connector_isolated_foot">Apoio isolado</option><option value="mechanical_frame_1000">Estrutura mecânica</option></select></label><button id="add-module" type="button" disabled>Adicionar módulo conceptual</button></details>
    </div>
    <div id="scene-components" class="scene-components" hidden><div class="candidate-heading"><span>COMPONENTES DA CENA</span><span id="component-count"></span></div><div id="component-list"></div></div>
    <p id="source-state" class="source-state" role="status" aria-live="polite">Sem documento-fonte ou cena espacial. Importe uma planta para começar.</p>
    <div id="empty-source" class="empty-source">Ainda não existe um documento técnico associado a esta sessão.</div>
  </aside>
  <aside id="inspector" class="inspector" hidden aria-label="Inspector do componente">
    <div class="panel-heading"><span>02 / COMPONENTE</span><button id="clear-focus" type="button" aria-label="Fechar inspector">×</button></div>
    <h1 id="node-label">—</h1><p id="node-meta" class="micro-copy"></p><p id="node-provenance" class="provenance-note"></p>
    <div id="wall-fields" hidden>
      <div class="dimensions-grid"><label class="field">Comprimento (m)<input id="wall-length" type="number" min="0.01" step="any"></label><label class="field">Altura (m)<input id="wall-height-edit" type="number" min="0.01" step="any"></label><label class="field">Espessura (m)<input id="wall-thickness-edit" type="number" min="0.01" step="any"></label><label class="field">Posição X (m)<input id="wall-x" type="number" step="any"></label><label class="field">Posição Z (m)<input id="wall-z" type="number" step="any"></label></div>
      <button id="preview-wall" type="button">Pré-visualizar alteração</button>
      <div id="opening-fields" class="opening-fields"><span>ABERTURA · PARÂMETROS EXPLÍCITOS</span><label class="field">Tipo<select id="opening-kind"><option value="door">Porta</option><option value="window">Janela</option></select></label><div class="dimensions-grid"><label class="field">Offset na parede (m)<input id="opening-offset" type="number" min="0" step="any" placeholder="m"></label><label class="field">Largura (m)<input id="opening-width" type="number" min="0.01" step="any" placeholder="m"></label><label class="field">Altura (m)<input id="opening-height" type="number" min="0.01" step="any" placeholder="m"></label><label class="field">Peitoril (m)<input id="opening-sill" type="number" min="0" step="any" placeholder="m"></label></div><button id="add-opening" type="button">Adicionar abertura</button></div>
    </div>
    <div id="opening-detail" hidden><div class="dimensions-grid"><label class="field">Offset na parede (m)<input id="edit-opening-offset" type="number" min="0" step="any"></label><label class="field">Largura (m)<input id="edit-opening-width" type="number" min="0.01" step="any"></label><label class="field">Altura (m)<input id="edit-opening-height" type="number" min="0.01" step="any"></label><label class="field">Peitoril (m)<input id="edit-opening-sill" type="number" min="0" step="any"></label></div><button id="preview-opening" type="button">Pré-visualizar abertura</button><button id="remove-opening" type="button">Remover abertura seleccionada</button></div>
    <p id="preview-status" class="preview-status" aria-live="polite"></p><div class="preview-actions"><button id="commit-preview" type="button" disabled>Aplicar</button><button id="cancel-preview" type="button" disabled>Cancelar</button></div>
  </aside>
  <section class="stage-empty" id="stage-empty"><span>ESPAÇO LIVRE</span><h1>Uma cena começa por evidência.</h1><p>Importe uma planta real, revise os segmentos e calibre a escala antes de construir a geometria.</p><a href="/demo">Abrir experiência UNFOLD</a></section>
  <nav class="spatial-toolbar" aria-label="Ferramentas da cena"><button id="mode-translate" type="button" aria-label="Mover" title="Mover">↔</button><button id="mode-rotate" type="button" aria-label="Rodar" title="Rodar">↻</button><button id="mode-scale" type="button" aria-label="Escalar" title="Escalar">⤢</button><i></i><button id="fit-scene" type="button" aria-label="Enquadrar" title="Enquadrar">□</button><button id="home-scene" type="button" aria-label="Início" title="Início">⌂</button><button id="top-view" type="button" aria-label="Vista superior" title="Vista superior">T</button><button id="front-view" type="button" aria-label="Vista frontal" title="Vista frontal">F</button><button id="iso-view" type="button" aria-label="Vista isométrica" title="Vista isométrica">I</button><button id="toggle-reference" type="button" aria-pressed="true" aria-label="Mostrar ou ocultar imagem original" title="Referência">▧</button><button id="compare-scene" type="button" aria-pressed="false" disabled>Antes / Depois</button><button id="undo-scene" type="button" disabled>Desfazer</button><button id="redo-scene" type="button" disabled>Refazer</button></nav>
  <div class="spatial-status" id="spatial-status" role="status" aria-live="polite">À espera de uma planta. Geometria não presumida.</div><div id="spatial-metrics" class="spatial-metrics"></div>
</main>`;

type UiElement = HTMLElement & Pick<HTMLInputElement, 'value'> & Pick<HTMLButtonElement, 'disabled'>;
const $ = <T extends HTMLElement = UiElement>(selector: string) => app!.querySelector<T>(selector)!;
const status = (text: string) => { $('#spatial-status').textContent = text; };
const scene = new Scene();
scene.background = new Color('#111412');
const camera = new PerspectiveCamera(42, 1, 0.02, 10_000);
camera.position.set(8, 7, 9);
const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.7));
renderer.setSize(1, 1, false);
renderer.outputColorSpace = 'srgb';
$('#spatial-canvas').append(renderer.domElement);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.dampingFactor = 0.08;
orbit.maxPolarAngle = Math.PI;
orbit.addEventListener('start', () => { gsap.killTweensOf(camera.position); gsap.killTweensOf(orbit.target); });
const ambient = new AmbientLight(0xc9c7bb, 1.25); scene.add(ambient);
const keyLight = new DirectionalLight(0xffead0, 3.2); keyLight.position.set(-5, 9, 6); scene.add(keyLight);
const fillLight = new DirectionalLight(0xa5b09a, 1.05); fillLight.position.set(7, 4, -7); scene.add(fillLight);
const grid = new GridHelper(36, 36, 0x776e5d, 0x343a34); grid.position.y = -0.035; scene.add(grid);
const root = new Group(); scene.add(root);
const gizmo = new TransformControls(camera, renderer.domElement);
scene.add(gizmo.getHelper());
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const raycaster = new Raycaster(); const pointer = new Vector2();
let transaction: SceneTransaction | undefined;
let preview: ScenePreview | undefined;
let compoundPreview: SceneTransaction | undefined;
// Autorizações de valores confirmados: emitidas só no clique de confirmação, para a operação que o preview mostrou.
// O ledger é de sessão (memória) e serve de salvaguarda de fluxo, não de fronteira de segurança.
const sceneAuthorizer = createSceneAuthorizer();
const compositePlans = new WeakMap<SceneTransaction, CompositePlan>();
let compoundPreviewBaseRevision: string | undefined;
let pendingCommand: SpatialCommandV1 | undefined;
let unregisterSpatialCommands: (() => void) | undefined;
let selectedId: string | undefined;
let visibleReference = true;
let compare = false;
let cameraTween: gsap.core.Timeline | undefined;
let raf = 0; let frameCount = 0; let fps = 0; let fpsAt = performance.now(); let buildMs = 0;
let assets: ArchitecturalAssets = {};
let libraryRoot: Object3D | undefined;
let assetReady = false;
let currentImageFile: File | undefined;
let currentImageUrl: string | undefined;
let imageInfo: { sha256: string; width: number; height: number; mimeType: string } | undefined;
let sourceDocumentRef: { documentId: string; sha256: string } | undefined;
let activeTechnicalDocument: TechnicalDocumentV1 | undefined;
let spatialAgentHistory: Array<{ role: 'user' | 'assistant'; text: string }> = [];
let spatialAgentAbort: AbortController | undefined;
let selectionOutline: Box3Helper | undefined;
let candidates: PixelWallCandidate[] = [];
const selectedCandidates = new Set<string>();
const selectedRegions = new Set<string>();
let traceMode: 'none' | 'wall' | 'scale' = 'none';
let traceStart: { point: Point2; pointerId: number } | undefined;
let traceEnd: Point2 | undefined;
let endpointDrag: { pointerId: number; candidateId: string; endpoint: 'start' | 'end' } | undefined;
let cameraHome: { target: Vector3; position: Vector3 } | undefined;
let referenceGroup: Group | undefined;
let referenceTexture: Texture | undefined;
let referenceTextureUrl: string | undefined;
let currentViewMode: 'original' | 'trace' | 'model' | 'compare' = 'original';
let buildTimeline: gsap.core.Timeline | undefined;
let disposed = false;
const resizeObserver = new ResizeObserver(resize);

function invalidate(): void { if (!disposed && !raf) raf = requestAnimationFrame(draw); }
function cameraFitAspect(): number {
  const canvas = $('#spatial-canvas').getBoundingClientRect();
  const panelInset = (selector: string, edge: 'left' | 'right') => {
    const panel = $(selector);
    if (panel.hidden || getComputedStyle(panel).display === 'none' || getComputedStyle(panel).visibility === 'hidden') return 0;
    const rect = panel.getBoundingClientRect();
    return edge === 'left' ? Math.max(0, rect.right - canvas.left) : Math.max(0, canvas.right - rect.left);
  };
  const header = $('.spatial-header').getBoundingClientRect();
  const toolbar = $('.spatial-toolbar').getBoundingClientRect();
  return cameraFrameAspect(canvas.width, canvas.height, {
    left: panelInset('.source-panel', 'left'),
    right: panelInset('#inspector', 'right'),
    top: Math.max(0, header.bottom - canvas.top),
    bottom: Math.max(0, canvas.bottom - toolbar.top),
  });
}
function draw(now = performance.now()): void {
  raf = 0;
  const moving = orbit.update();
  renderer.render(scene, camera);
  frameCount += 1;
  if (now - fpsAt >= 1000) { fps = Math.round(frameCount * 1000 / (now - fpsAt)); frameCount = 0; fpsAt = now; updateMetrics(); }
  if (moving) invalidate();
}
function updateMetrics(): void {
  const info = renderer.info;
  $('#spatial-metrics').textContent = transaction ? `${fps} FPS · ${info.render.calls} draw calls · ${info.render.triangles.toLocaleString()} triângulos · ${info.memory.geometries} geometrias · cena ${buildMs.toFixed(1)} ms` : '';
}
function resize(): void {
  const host = $('#spatial-canvas'); const width = host.clientWidth; const height = host.clientHeight;
  if (!width || !height) return;
  camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height, false); invalidate();
}
resizeObserver.observe($('#spatial-canvas'));

function disposeSceneGroup(): void {
  gizmo.detach();
  root.traverse((object) => {
    if (!(object instanceof Mesh) || hasSharedAssetParent(object)) return;
    object.geometry.dispose();
  });
  root.clear();
}
function hasSharedAssetParent(object: Object3D): boolean {
  let current: Object3D | null = object;
  while (current) { if (current.userData.sharedAsset === true) return true; current = current.parent; }
  return false;
}
function assetByName(source: Object3D | undefined, name: string): Object3D | undefined {
  if (!source) return undefined;
  let found: Object3D | undefined;
  source.traverse((item) => { if (!found && item.name === name) found = item; });
  return found;
}

function selectNode(id: string | undefined): void {
  selectedId = id;
  if (imageInfo) updateCandidates();
  if (selectionOutline) { scene.remove(selectionOutline); selectionOutline.geometry.dispose(); (selectionOutline.material as import('three').Material).dispose(); selectionOutline = undefined; }
  const node = transaction?.scene.nodes.find((candidate) => candidate.id === id);
  $('#inspector').hidden = !node;
  if (!node) { gizmo.detach(); return; }
  $('#node-label').textContent = node.label;
  const geometry = node.geometry;
  $('#node-meta').textContent = geometry?.kind === 'box' ? `${geometry.sizeM.map((n) => `${n.toFixed(2)} m`).join(' × ')} · ${node.component?.kind ?? 'elemento'}` : `${geometry?.kind ?? 'sem geometria'} · ${node.component?.kind ?? node.nodeType}`;
  const p = geometry?.provenance;
  $('#node-provenance').textContent = p ? `${p.source} · ${p.validation}${p.evidence ? ` · ${p.evidence}` : ''}` : 'Geometria não especificada.';
  const wall = node.component?.kind === 'wall' && geometry?.kind === 'box';
  $('#wall-fields').hidden = !wall;
  const opening = node.component?.kind === 'door' || node.component?.kind === 'window';
  $('#opening-detail').hidden = !opening;
  if (opening) for (const key of ['offset', 'width', 'height', 'sill'] as const) {
    const value = node.component?.properties[key]?.value;
    $(`#edit-opening-${key}`).value = typeof value === 'number' ? value.toFixed(2) : '';
  }
  if (wall && geometry.kind === 'box') {
    $('#wall-length').value = geometry.sizeM[0].toFixed(2); $('#wall-height-edit').value = geometry.sizeM[1].toFixed(2); $('#wall-thickness-edit').value = geometry.sizeM[2].toFixed(2);
    $('#wall-x').value = node.transform.translationM[0].toFixed(2); $('#wall-z').value = node.transform.translationM[2].toFixed(2);
  }
  const object = root.getObjectByName(node.id);
  if (object) {
    gizmo.attach(object); gizmo.showY = !wall; gizmo.showX = true; gizmo.showZ = true;
    root.updateMatrixWorld(true);
    selectionOutline = new Box3Helper(new Box3().setFromObject(object), new Color('#d5a55e'));
    scene.add(selectionOutline);
  }
  invalidate();
}

function animateBuild(model: SpatialSceneV1): void {
  buildTimeline?.kill();
  const home = createSpatialCameraView(new Box3().setFromObject(root), cameraFitAspect(), 'isometric');
  cameraHome = { target: home.target.clone(), position: home.position.clone() };
  if (reduceMotion.matches) { moveCamera(home.target, home.position, 0, home.up); invalidate(); return; }
  moveCamera(home.target, home.position, 0.85, home.up);
  const sequence = buildTimeline = gsap.timeline({ onUpdate: invalidate });
  for (const node of model.nodes.filter((item) => item.nodeType === 'component')) {
    const object = root.getObjectByName(node.id);
    const visual = object?.children[0];
    if (!visual) continue;
    const targetScaleY = visual.scale.y;
    visual.scale.y = targetScaleY * 0.001;
    sequence.to(visual.scale, { y: targetScaleY, duration: 0.34, ease: 'power2.out' }, '+=0.045');
  }
  sequence.call(() => {
    moveCamera(cameraHome!.target, cameraHome!.position, 0.7, home.up);
    status(`Cena construída a partir de ${model.nodes.length} componentes propostos; traços, escala e dimensões mantêm a sua proveniência.`);
  });
}

function animateRevision(previous: SpatialSceneV1, current: SpatialSceneV1, targetId: string | undefined): void {
  if (!targetId || reduceMotion.matches) return;
  const affected = current.nodes.filter((node) => node.id === targetId || node.component?.dependsOn.includes(targetId));
  const sequence = gsap.timeline({ onUpdate: invalidate });
  for (const node of affected) {
    const before = previous.nodes.find((item) => item.id === node.id);
    const object = root.getObjectByName(node.id);
    if (!before || !object) continue;
    const [x, y, z] = node.transform.translationM;
    sequence.fromTo(object.position, { x: before.transform.translationM[0], y: before.transform.translationM[1], z: before.transform.translationM[2] }, { x, y, z, duration: 0.35, ease: 'power2.out' }, 0);
    const [fromX, fromY, fromZ, fromW] = before.transform.rotation;
    const [toX, toY, toZ, toW] = node.transform.rotation;
    sequence.fromTo(object.quaternion, { x: fromX, y: fromY, z: fromZ, w: fromW }, { x: toX, y: toY, z: toZ, w: toW, duration: 0.35, ease: 'power2.out' }, 0);
    if (before.geometry?.kind === 'box' && node.geometry?.kind === 'box') {
      const [sx, sy, sz] = node.transform.scale;
      sequence.fromTo(object.scale, { x: sx * before.geometry.sizeM[0] / node.geometry.sizeM[0], y: sy * before.geometry.sizeM[1] / node.geometry.sizeM[1], z: sz * before.geometry.sizeM[2] / node.geometry.sizeM[2] }, { x: sx, y: sy, z: sz, duration: 0.35, ease: 'power2.out' }, 0);
    }
  }
  buildTimeline = sequence;
}

function renderModel(model = transaction?.scene, animate = false): void {
  buildTimeline?.kill();
  if (!model) { grid.visible = true; updateReferenceView(); invalidate(); return; }
  grid.visible = false;
  const started = performance.now(); disposeSceneGroup();
  const renderGroup = buildThreePlanGroup(model, assets);
  root.add(renderGroup);
  root.traverse((object) => { if (object instanceof Mesh && object.parent && object.userData.id === undefined) { const node = object.parent; if (node.name && model.nodes.some((item) => item.id === node.name)) object.userData.id = node.name; } });
  buildMs = performance.now() - started;
  const bounds = new Box3().setFromObject(root);
  if (!bounds.isEmpty()) {
    const home = createSpatialCameraView(bounds, cameraFitAspect(), 'isometric');
    cameraHome = { target: home.target.clone(), position: home.position.clone() };
  }
  updateReferencePlane(model);
  updateReferenceView();
  if (animate) animateBuild(model); else invalidate();
  selectNode(selectedId);
  updateToolbar();
}

function updateReferencePlane(model: SpatialSceneV1): void {
  if (referenceGroup) {
    scene.remove(referenceGroup);
    referenceGroup.traverse((object) => { if (object instanceof Mesh) { object.geometry.dispose(); object.material.dispose(); } });
    referenceGroup.clear();
    referenceGroup = undefined;
  }
  const mapping = model.imageWorldMapping;
  if (!mapping || !currentImageUrl) return;
  if (referenceTextureUrl !== currentImageUrl) {
    referenceTexture?.dispose();
    referenceTexture = new TextureLoader().load(currentImageUrl, () => invalidate());
    referenceTextureUrl = currentImageUrl;
  }
  if (!referenceTexture) return;
  referenceTexture.colorSpace = 'srgb';
  const [a, b, c, d, e, f] = mapping.pixelToWorldXZ;
  const mapPoint = (u: number, v: number): [number, number, number] => [a * u + b * v + c, mapping.worldY + 0.006, d * u + e * v + f];
  const { width, height } = mapping.imageSizePx;
  const geometry = new BufferGeometry();
  const positions = [...mapPoint(0, 0), ...mapPoint(width, 0), ...mapPoint(width, height), ...mapPoint(0, height)];
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  // Image coordinates originate at the top-left; the world mapping already
  // maps increasing raster Y toward negative Z. Keep the texture upright.
  geometry.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  referenceGroup = new Group();
  referenceGroup.name = 'source-plan-reference';
  const material = new MeshBasicMaterial({ map: referenceTexture, transparent: true, opacity: 0.84, depthWrite: false, side: DoubleSide });
  referenceGroup.add(new Mesh(geometry, material));
  referenceGroup.renderOrder = 1;
  scene.add(referenceGroup);
}

function updateReferenceView(): void {
  const hasScene = Boolean(transaction);
  root.visible = currentViewMode === 'model' || currentViewMode === 'compare' || (!currentImageUrl && hasScene) || (!hasScene && currentViewMode === 'original');
  if (referenceGroup) {
    referenceGroup.visible = visibleReference && (currentViewMode === 'original' || currentViewMode === 'trace' || currentViewMode === 'compare');
    const mesh = referenceGroup.children[0];
    if (mesh instanceof Mesh && mesh.material instanceof MeshBasicMaterial) mesh.material.opacity = currentViewMode === 'compare' ? 0.34 : 0.9;
  }
  $('#plan-overlay').classList.toggle('trace-hidden', currentViewMode === 'original' || currentViewMode === 'model');
  for (const button of app.querySelectorAll<HTMLButtonElement>('[data-view-mode]')) button.setAttribute('aria-pressed', String(button.dataset.viewMode === currentViewMode));
  invalidate();
}

function updateToolbar(): void {
  $('#undo-scene').disabled = !transaction?.undoStack.length || !!preview || !!compoundPreview;
  $('#redo-scene').disabled = !transaction?.redoStack.length || !!preview || !!compoundPreview;
  $('#save-scene').disabled = !transaction;
  $('#restore-scene').disabled = !localStorage.getItem('unfold-spatial-scene.v1');
  $('#compare-scene').disabled = !transaction?.undoStack.length || !!preview || !!compoundPreview;
  $('#add-module').disabled = !assetReady || !transaction || !!preview || !!compoundPreview;
  $('#scene-state').textContent = transaction ? `R${transaction.scene.revision.number} · ${transaction.scene.nodes.length} ELEMENTOS` : 'SEM CENA';
  app!.setAttribute('data-state', transaction ? 'ready' : 'empty');
  $('#stage-empty').hidden = Boolean(transaction);
  $('#scene-components').hidden = !transaction;
  $('#component-count').textContent = transaction ? String(transaction.scene.nodes.length) : '';
  $('#component-list').innerHTML = (transaction?.scene.nodes ?? []).map((node) => `<button class="component-row ${node.id === selectedId ? 'is-selected' : ''}" type="button" data-scene-node="${node.id}"><span>${node.label}</span><small>${node.component?.kind ?? node.nodeType} · ${node.geometry?.provenance.validation ?? 'sem geometria'}</small></button>`).join('');
  updateSourceState();
}

function updateSourceState(): void {
  const message = currentImageFile
    ? sourceDocumentRef ? 'Imagem original e documento técnico associados a esta sessão.' : 'Imagem de referência carregada; não existe análise técnica aceite associada.'
    : transaction?.scene.sourceDocuments.length
      ? 'Cena espacial carregada com referência a documento técnico; a imagem original não está ligada a esta sessão.'
      : transaction
        ? 'Cena espacial carregada sem documento-fonte. A geometria não deve ser interpretada como reconstrução confirmada de uma planta.'
        : 'Sem documento-fonte ou cena espacial. Importe uma planta para começar.';
  $('#source-state').textContent = message;
  $('#empty-source').hidden = Boolean(currentImageFile);
  $('#empty-source').textContent = transaction
    ? 'A cena está disponível. Importe a planta original para comparar a geometria com a fonte.'
    : 'Ainda não existe um documento técnico associado a esta sessão.';
}

function updateCandidates(): void {
  const svg = $('#plan-overlay') as unknown as SVGSVGElement;
  if (!imageInfo) return;
  svg.setAttribute('viewBox', `0 0 ${imageInfo.width} ${imageInfo.height}`);
  const mapping = transaction?.scene.imageWorldMapping;
  let vectorScale: { pixelsPerMetre: number; source: 'known_measurement' } | undefined;
  if (mapping && imageInfo?.sha256 === mapping.sourceImageSha256) {
    const [a, b, , d, e] = mapping.pixelToWorldXZ;
    const xScale = Math.hypot(a, d); const yScale = Math.hypot(b, e);
    if (xScale > 0 && Math.abs(xScale - yScale) <= Math.max(xScale, yScale) * 0.01) vectorScale = { pixelsPerMetre: 1 / xScale, source: 'known_measurement' };
  }
  const topologyTolerance = Math.max(6, Math.min(imageInfo.width, imageInfo.height) * 0.008);
  const vectorModel = buildPlanVectorModel(candidates, { tolerancePx: topologyTolerance, imageSize: { width: imageInfo.width, height: imageInfo.height }, ...(vectorScale ? { scale: vectorScale } : {}) });
  const regionShapes = vectorModel.regions.filter((region) => region.eligibility === 'construction_candidate').map((region) => `<polygon data-region="${region.id}" data-selected="${selectedRegions.has(region.id)}" points="${region.vertices.map((point) => `${point.x},${point.y}`).join(' ')}" fill="#c8a873" fill-opacity="${selectedRegions.has(region.id) ? '0.22' : '0.09'}" stroke="${selectedRegions.has(region.id) ? '#efbf68' : '#b99968'}" stroke-opacity=".8" stroke-width="3"/>`).join('');
  const gapMarks = vectorModel.openingCandidates.map((item) => `<line data-opening-candidate="${item.id}" x1="${item.start.x}" y1="${item.start.y}" x2="${item.end.x}" y2="${item.end.y}" stroke="#a65e36" stroke-width="6" stroke-dasharray="4 3" opacity=".9"/>`).join('');
  const intersectionMarks = vectorModel.intersections.map((item) => `<circle data-intersection="${item.firstId}:${item.secondId}" cx="${item.point.x}" cy="${item.point.y}" r="3.5" fill="#e4b05d" stroke="#392b1d" stroke-width="1"/>`).join('');
  svg.innerHTML = regionShapes + gapMarks + candidates.map((candidate) => {
    const active = selectedCandidates.has(candidate.id);
    const linked = transaction?.scene.nodes.find((node) => node.id === selectedId)?.component?.properties.sourceCandidate?.value === candidate.id;
    const width = Math.max(3.2, candidate.thicknessPx);
    const handles = active && !transaction ? `<circle data-endpoint="start" data-candidate-id="${candidate.id}" cx="${candidate.start.x}" cy="${candidate.start.y}" r="7"/><circle data-endpoint="end" data-candidate-id="${candidate.id}" cx="${candidate.end.x}" cy="${candidate.end.y}" r="7"/>` : '';
    return `<line data-id="${candidate.id}" data-thickness="${candidate.thicknessPx}" data-confidence="${candidate.confidence}" x1="${candidate.start.x}" y1="${candidate.start.y}" x2="${candidate.end.x}" y2="${candidate.end.y}" stroke="${linked ? '#fff1ca' : active ? '#e0a943' : '#9a6535'}" stroke-width="${linked ? width + 2 : width}" stroke-linecap="round" opacity="${active || linked ? 1 : 0.78}"/>${handles}`;
  }).join('') + intersectionMarks + (traceStart && traceEnd ? `<line id="manual-preview" x1="${traceStart.point.x}" y1="${traceStart.point.y}" x2="${traceEnd.x}" y2="${traceEnd.y}" stroke="#d5a55e" stroke-width="3"/>` : '');
  const list = $('#candidate-list');
  list.innerHTML = candidates.map((candidate) => `<button type="button" class="candidate-row ${selectedCandidates.has(candidate.id) ? 'is-selected' : ''}" data-candidate="${candidate.id}" aria-pressed="${selectedCandidates.has(candidate.id)}"><span>${candidate.id}</span><small>${candidate.origin === 'manual_trace' ? 'traçado manual' : candidate.origin === 'manual_correction' ? 'correcção manual' : 'detecção automática'} · ${candidate.orientation} · ${Math.round(Math.hypot(candidate.end.x-candidate.start.x,candidate.end.y-candidate.start.y))} px · confiança heurística ${candidate.confidence.toFixed(2)}</small></button>`).join('') || '<p class="micro-copy">Sem candidatos. Use tracing manual.</p>';
  const regionCandidates = vectorModel.regions.filter((region) => region.eligibility === 'construction_candidate');
  const rejectedRegionCount = vectorModel.regions.length - regionCandidates.length;
  $('#region-list').innerHTML = regionCandidates.map((region) => `<button type="button" class="candidate-row ${selectedRegions.has(region.id) ? 'is-selected' : ''}" data-region="${region.id}" aria-label="${selectedRegions.has(region.id) ? 'Remover' : 'Rever'} divisão proposta ${region.id}" aria-pressed="${selectedRegions.has(region.id)}"><span>Divisão proposta ${region.id.slice(6)}</span><small>${region.boundaryCandidateIds.length} segmentos de suporte · ${Math.round(region.areaPx2).toLocaleString()} px² · confiança heurística ${region.confidence.toFixed(2)} · por confirmar</small></button>`).join('') + (rejectedRegionCount ? `<p class="micro-copy">${rejectedRegionCount} faces adicionais excluídas por qualidade geométrica insuficiente.</p>` : '') || '<p class="micro-copy">Sem contornos com suporte suficiente. Isto não exclui divisões abertas ou linhas não detectadas.</p>';
  $('#opening-candidate-list').innerHTML = vectorModel.openingCandidates.map((opening) => `<button type="button" class="candidate-row" data-opening-candidate="${opening.id}"><span>${opening.id}</span><small>${Math.hypot(opening.end.x - opening.start.x, opening.end.y - opening.start.y).toFixed(1)} px · ambígua · confirmar manualmente</small></button>`).join('') || '<p class="micro-copy">Nenhuma descontinuidade candidata no intervalo heurístico configurado; isto não confirma ausência de portas/janelas.</p>';
  $('#split-segment').disabled = selectedCandidates.size !== 1 || !!transaction;
  $('#join-segments').disabled = selectedCandidates.size < 2 || !!transaction;
  $('#build-scene').disabled = !imageInfo || selectedCandidates.size === 0 && selectedRegions.size === 0;
  $('#build-scene').textContent = selectedRegions.size ? `Construir ${selectedRegions.size} divisão(ões) proposta(s)` : 'Construir geometria proposta';
  const loops = countClosedCandidateContours(candidates.filter((candidate) => selectedCandidates.has(candidate.id)), 10);
  const contour = `${regionCandidates.length} divisão(ões) proposta(s) com suporte de parede · ${vectorModel.regions.length - regionCandidates.length} face(s) de baixa qualidade excluída(s) · ${loops} ciclo(s) fechados exactos. Sem escala validada, áreas apenas em px².`;
  $('#contour-summary').textContent = transaction && transaction.scene.revision.number > 0 ? `${contour} As linhas representam o traçado original; a cena pode ter sido editada.` : contour;
}
function selectRegionCandidate(regionId: string): void {
  if (!imageInfo) return;
  const model = buildPlanVectorModel(candidates, { tolerancePx: Math.max(6, Math.min(imageInfo.width, imageInfo.height) * 0.008), imageSize: { width: imageInfo.width, height: imageInfo.height } });
  const region = model.regions.find((item) => item.id === regionId && item.eligibility === 'construction_candidate');
  if (!region) return;
  if (selectedRegions.has(regionId)) {
    selectedRegions.delete(regionId);
    for (const id of region.boundaryCandidateIds) selectedCandidates.delete(id);
    updateCandidates();
    status(`${regionId} removida das propostas a construir.`);
    return;
  }
  selectedRegions.add(regionId);
  selectedCandidates.clear();
  region.boundaryCandidateIds.forEach((id) => selectedCandidates.add(id));
  updateCandidates();
  status(`${regionId} seleccionada para revisão. A inclusão na construção cria uma proposta geométrica não verificada; nome e área métrica não são inferidos.`);
}
function svgPoint(event: PointerEvent): Point2 {
  const rect = $('#plan-overlay').getBoundingClientRect();
  if (!imageInfo || !rect.width || !rect.height) return { x: 0, y: 0 };
  return { x: Math.min(imageInfo.width, Math.max(0, (event.clientX - rect.left) * imageInfo.width / rect.width)), y: Math.min(imageInfo.height, Math.max(0, (event.clientY - rect.top) * imageInfo.height / rect.height)) };
}
function setTraceMode(mode: 'none' | 'wall' | 'scale'): void {
  traceMode = mode;
  $('#trace-mode').setAttribute('aria-pressed', String(mode === 'wall'));
  $('#scale-mode').setAttribute('aria-pressed', String(mode === 'scale'));
  $('#plan-overlay').classList.toggle('is-tracing', mode === 'wall');
  $('#plan-overlay').classList.toggle('is-calibrating', mode === 'scale');
}

async function loadPlanFile(file: File, technicalDocumentRef?: { documentId: string; sha256: string }): Promise<void> {
  try {
    status('A verificar o ficheiro local e a preparar a referência raster…');
    const decoded = await decodePlanImage(file);
    currentImageFile = file; imageInfo = { sha256: decoded.sha256, width: decoded.width, height: decoded.height, mimeType: decoded.mimeType }; sourceDocumentRef = technicalDocumentRef;
    if (currentImageUrl) URL.revokeObjectURL(currentImageUrl);
    currentImageUrl = URL.createObjectURL(file); ($('#source-image') as HTMLImageElement).src = currentImageUrl;
    ($('#source-image').parentElement as HTMLElement).style.aspectRatio = `${decoded.width} / ${decoded.height}`;
    $('#plan-workflow').hidden = false; $('#empty-source').hidden = true;
    updateSourceState();
    $('#plan-meta').textContent = `${file.name} · ${decoded.width} × ${decoded.height} · SHA-256 ${decoded.sha256.slice(0, 16)}… · original preservado`;
    candidates = []; selectedCandidates.clear(); selectedRegions.clear(); updateCandidates(); setTraceMode('none');
    status('Imagem carregada. Detecção é sugestiva; revise e trace os segmentos necessários.');
  } catch (error) { status(`Imagem recusada: ${error instanceof Error ? error.message : 'erro de validação'}`); }
}
$('#plan-file').addEventListener('change', (event) => {
  const file = (event.target as HTMLInputElement).files?.[0]; if (file) void loadPlanFile(file);
});

$('#detect-lines').addEventListener('click', async () => {
  if (!currentImageFile) return;
  try {
    const raster = await decodePlanImage(currentImageFile);
    candidates = detectWallCandidates(raster, { threshold: Number($('#detection-threshold').value), minimumLengthPx: Math.max(24, Math.floor(Math.min(raster.width, raster.height) * 0.045)), gapTolerancePx: 3 });
    selectedCandidates.clear(); updateCandidates();
    status(`${candidates.length} segmentos axiais candidatos. Seleccione apenas os que confirmar no desenho; linhas de texto podem ser falsos positivos.`);
  } catch (error) { status(`Detecção indisponível: ${error instanceof Error ? error.message : 'erro'}`); }
});
$('#detection-threshold').addEventListener('input', () => { $('#detection-threshold-value').textContent = $('#detection-threshold').value; });

$('#plan-overlay').addEventListener('click', (event) => {
  const target = event.target as SVGElement;
  const regionId = target.closest<SVGElement>('[data-region]')?.getAttribute('data-region');
  if (regionId && traceMode === 'none') { selectRegionCandidate(regionId); return; }
  const candidateId = target.getAttribute('data-id');
  if (candidateId && traceMode === 'none') {
    const linkedNode = transaction?.scene.nodes.find((node) => node.component?.properties.sourceCandidate?.value === candidateId);
    if (linkedNode) { selectNode(linkedNode.id); focusNode(linkedNode.id); return; }
    if (selectedCandidates.has(candidateId)) selectedCandidates.delete(candidateId); else selectedCandidates.add(candidateId);
    updateCandidates();
  }
});

// A click on the image either records the two explicit scale anchors or starts a manual segment.
const calibrationPoints: Point2[] = [];
$('#plan-overlay').addEventListener('pointerdown', (event) => {
  const target = event.target as SVGElement;
  const endpoint = target.getAttribute('data-endpoint');
  const candidateId = target.getAttribute('data-candidate-id');
  if (endpoint && candidateId && !transaction && traceMode === 'none') {
    event.preventDefault();
    endpointDrag = { pointerId: event.pointerId, candidateId, endpoint: endpoint as 'start' | 'end' };
    ($('#plan-overlay') as unknown as SVGSVGElement).setPointerCapture(event.pointerId);
    return;
  }
  if (traceMode === 'none') return;
  event.preventDefault(); const point = snapTracePoint(svgPoint(event as PointerEvent));
  if (traceMode === 'scale') {
    calibrationPoints.push(point);
    if (calibrationPoints.length > 2) calibrationPoints.shift();
    if (calibrationPoints.length === 2) {
      const dx = Math.abs(calibrationPoints[1]!.x - calibrationPoints[0]!.x);
      const dy = Math.abs(calibrationPoints[1]!.y - calibrationPoints[0]!.y);
      const distance = Math.hypot(dx, dy);
      if (Math.min(dx, dy) > Math.max(3, distance * 0.025)) {
        calibrationPoints.splice(0, 1);
        status('Para esta calibração, marque os extremos de uma cota horizontal ou vertical no raster. A orientação diagonal não é representável neste mapeamento.');
      }
    }
    const svg = $('#plan-overlay') as unknown as SVGSVGElement;
    const base = candidates.map((candidate) => `<line x1="${candidate.start.x}" y1="${candidate.start.y}" x2="${candidate.end.x}" y2="${candidate.end.y}" stroke="#687567" stroke-width="2" opacity=".35"/>`).join('');
    const marker = calibrationPoints.map((p, i) => `<circle cx="${p.x}" cy="${p.y}" r="5" fill="#d5a55e"/><text x="${p.x + 8}" y="${p.y - 8}" fill="#f0e2ca" font-size="12">${i + 1}</text>`).join('');
    const line = calibrationPoints.length === 2 ? `<line x1="${calibrationPoints[0]!.x}" y1="${calibrationPoints[0]!.y}" x2="${calibrationPoints[1]!.x}" y2="${calibrationPoints[1]!.y}" stroke="#d5a55e" stroke-width="3"/>` : '';
    svg.innerHTML = base + line + marker;
    if (calibrationPoints.length === 2) { setTraceMode('none'); status(`Âncoras da escala marcadas: ${Math.hypot(calibrationPoints[1]!.x-calibrationPoints[0]!.x, calibrationPoints[1]!.y-calibrationPoints[0]!.y).toFixed(1)} px. Introduza a cota impressa e uma nota.`); }
    return;
  }
  traceStart = { point, pointerId: event.pointerId };
  traceEnd = point;
  ($('#plan-overlay') as unknown as SVGSVGElement).setPointerCapture(event.pointerId);
});
$('#plan-overlay').addEventListener('pointerup', (event) => {
  if (endpointDrag?.pointerId === event.pointerId) { endpointDrag = undefined; updateCandidates(); status('Extremo do segmento ajustado no raster; a geometria 3D existente não foi alterada. Reconstrua após confirmar o tracing.'); return; }
  if (!traceStart || traceMode !== 'wall' || traceStart.pointerId !== event.pointerId) return;
  const start = traceStart.point; const end = alignTraceEndpoint(start, snapTracePoint(svgPoint(event as PointerEvent))); traceStart = undefined; traceEnd = undefined;
  try {
    const candidate = traceWallCandidate(`manual-${crypto.randomUUID().slice(0, 8)}`, start, end, 5);
    candidates.push(candidate); selectedCandidates.add(candidate.id); updateCandidates();
    status(`Traçado ${candidate.id} adicionado como candidato manual; continua por confirmar e não é uma medição física.`);
  } catch (error) { status(error instanceof Error ? error.message : 'Traçado inválido.'); }
});
$('#plan-overlay').addEventListener('pointermove', (event) => {
  if (endpointDrag?.pointerId === event.pointerId) {
    const candidate = candidates.find((item) => item.id === endpointDrag!.candidateId);
    if (!candidate) return;
    const point = snapTracePoint(svgPoint(event as PointerEvent), endpointDrag);
    const start = endpointDrag.endpoint === 'start' ? point : candidate.start;
    const end = endpointDrag.endpoint === 'end' ? point : candidate.end;
    const aligned = endpointDrag.endpoint === 'start' ? alignTraceEndpoint(end, start) : alignTraceEndpoint(start, end);
    const nextStart = endpointDrag.endpoint === 'start' ? aligned : start;
    const nextEnd = endpointDrag.endpoint === 'end' ? aligned : end;
    try { candidates = candidates.map((item) => item.id === candidate.id ? { ...traceWallCandidate(item.id, nextStart, nextEnd, item.thicknessPx), origin: 'manual_correction' as const } : item); updateCandidates(); } catch { /* Keep the last valid segment while the pointer crosses a degenerate position. */ }
    return;
  }
  if (!traceStart || traceMode !== 'wall') return;
  traceEnd = svgPoint(event as PointerEvent); updateCandidates();
});

$('#trace-mode').addEventListener('click', () => setTraceMode(traceMode === 'wall' ? 'none' : 'wall'));
$('#scale-mode').addEventListener('click', () => { calibrationPoints.length = 0; setTraceMode(traceMode === 'scale' ? 'none' : 'scale'); status('Seleccione os dois extremos de uma cota visível no original.'); });
$('#clear-selection').addEventListener('click', () => { selectedCandidates.clear(); selectedRegions.clear(); updateCandidates(); status('Selecção de segmentos e divisões limpa.'); });
$('#candidate-list').addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-candidate]'); if (!button) return;
  const id = button.dataset.candidate!; if (selectedCandidates.has(id)) selectedCandidates.delete(id); else selectedCandidates.add(id); updateCandidates();
});
$('#region-list').addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const regionId = target.closest<HTMLElement>('[data-region]')?.dataset.region;
  if (!regionId) return;
  selectRegionCandidate(regionId);
});
$('#opening-candidate-list').addEventListener('click', (event) => {
  const id = (event.target as HTMLElement).closest<HTMLElement>('[data-opening-candidate]')?.dataset.openingCandidate;
  const item = id ? buildPlanVectorModel(candidates).openingCandidates.find((candidate) => candidate.id === id) : undefined;
  if (item) status(`${item.reason} Nenhuma abertura será criada automaticamente.`);
});

$('#split-segment').addEventListener('click', () => {
  const id = [...selectedCandidates][0]; const candidate = candidates.find((item) => item.id === id);
  if (!candidate) return;
  const split = splitWallCandidate(candidate).map((item) => ({ ...item, origin: 'manual_correction' as const }));
  candidates = candidates.filter((item) => item.id !== id).concat(split);
  selectedCandidates.delete(id); split.forEach((item) => selectedCandidates.add(item.id));
  updateCandidates(); status(`Segmento ${id} dividido em duas partes no ponto médio; a alteração é apenas vectorial e reversível pela edição do traçado.`);
});

$('#join-segments').addEventListener('click', () => {
  try {
    const selected = candidates.filter((candidate) => selectedCandidates.has(candidate.id));
    const joined = { ...mergeWallCandidates(selected), origin: 'manual_correction' as const };
    candidates = candidates.filter((candidate) => !selectedCandidates.has(candidate.id)).concat(joined);
    selectedCandidates.clear(); selectedCandidates.add(joined.id);
    updateCandidates(); status(`${selected.length} segmentos colineares unidos numa proposta vectorial. A origem dos IDs anteriores permanece no histórico da sessão apenas até guardar/exportar.`);
  } catch (error) { status(error instanceof Error ? error.message : 'Os segmentos não podem ser unidos.'); }
});
$('#component-list').addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-scene-node]'); if (!button) return;
  const id = button.dataset.sceneNode; selectNode(id);
  const object = id ? root.getObjectByName(id) : undefined;
  if (object) focusNode(object.name);
});

function parsePositive(selector: string, label: string): number {
  const value = Number(document.querySelector<HTMLInputElement>(selector)?.value ?? '');
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label}: introduza um número positivo e finito.`);
  return value;
}
function currentScalePixels(): number {
  const distancePx = calibrationPoints.length === 2 ? Math.hypot(calibrationPoints[1]!.x-calibrationPoints[0]!.x, calibrationPoints[1]!.y-calibrationPoints[0]!.y) : 0;
  if (!distancePx) throw new Error('Marque dois pontos de referência na imagem para calibrar a escala.');
  return distancePx;
}
$('#build-scene').addEventListener('click', () => {
  if (!imageInfo) return;
  try {
    const pixelDistance = currentScalePixels();
    const scaleValue = parsePositive('#scale-distance', 'Cota');
    const unit = (document.querySelector<HTMLSelectElement>('#scale-unit')?.value ?? 'm') as 'm' | 'cm' | 'mm' | 'ft' | 'in';
    const realDistanceMetres = scaleValue * ({ m: 1, cm: 0.01, mm: 0.001, ft: 0.3048, in: 0.0254 } as const)[unit];
    const heightM = parsePositive('#wall-height', 'Altura de modelação');
    const thicknessM = parsePositive('#wall-thickness', 'Espessura');
    const evidence = (document.querySelector<HTMLInputElement>('#scale-evidence')?.value ?? '').trim(); if (!evidence) throw new Error('Registe de onde vem a cota usada na escala.');
    const detected = detectCandidateIntersections(candidates);
    const vectorModel = buildPlanVectorModel(candidates, { tolerancePx: Math.max(6, Math.min(imageInfo.width, imageInfo.height) * 0.008), imageSize: { width: imageInfo.width, height: imageInfo.height } });
    const selectedRegionCandidates = vectorModel.regions.filter((region) => selectedRegions.has(region.id));
    const selectedRegionBoundaryIds = new Set(selectedRegionCandidates.flatMap((region) => region.boundaryCandidateIds));
    const candidateIds = [...selectedCandidates].filter((id) => !selectedRegionBoundaryIds.has(id));
    const next = createPlanScene({ sceneId: `plan-${imageInfo.sha256.slice(0, 12)}`, title: 'Reconstrução geométrica proposta', image: imageInfo, ...(sourceDocumentRef ? { technicalDocumentRef: sourceDocumentRef } : {}), calibration: { pixelDistance, realDistanceMetres, evidence, actor: 'local-user-input' }, confirmedCandidateIds: candidateIds, confirmedRegionIds: [...selectedRegions], regions: vectorModel.regions, candidates, wall: { heightM, thicknessM } });
    transaction = next; preview = undefined; compoundPreview = undefined; compoundPreviewBaseRevision = undefined; compare = false; selectedId = undefined; currentViewMode = 'compare'; persistScene();
    // animateBuild owns the camera for the construction sequence and computes
    // its framing from the committed geometry. A subsequent fit would cancel it.
    renderModel(transaction.scene, true);
    $('#candidate-list').setAttribute('data-intersections', String(detected.length));
    $('#source-panel').classList.add('source-compact');
    status(`Cena proposta: ${selectedRegionCandidates.length} divisão(ões), ${next.scene.nodes.filter((node) => node.component?.kind === 'wall').length} paredes únicas e ${candidateIds.length} segmentos adicionais. Escala introduzida pelo utilizador; geometria, altura e espessura não verificadas.`);
    updateToolbar();
  } catch (error) { status(error instanceof Error ? error.message : 'Não foi possível construir a cena.'); }
});

function snapTracePoint(point: Point2, omit?: { candidateId: string; endpoint: 'start' | 'end' }): Point2 {
  const threshold = Math.max(10, Math.min(imageInfo?.width ?? 1, imageInfo?.height ?? 1) * 0.012);
  let closest: Point2 | undefined; let closestDistance = threshold;
  for (const candidate of candidates) for (const endpoint of ['start', 'end'] as const) {
    if (omit?.candidateId === candidate.id && omit.endpoint === endpoint) continue;
    const target = candidate[endpoint]; const distance = Math.hypot(target.x - point.x, target.y - point.y);
    if (distance < closestDistance) { closest = target; closestDistance = distance; }
  }
  return closest ? { ...closest } : point;
}
function alignTraceEndpoint(anchor: Point2, point: Point2): Point2 {
  const dx = Math.abs(point.x - anchor.x); const dy = Math.abs(point.y - anchor.y);
  const tolerance = Math.max(4, Math.hypot(dx, dy) * 0.015);
  if (dx <= tolerance) return { ...point, x: anchor.x };
  if (dy <= tolerance) return { ...point, y: anchor.y };
  return point;
}

$('#add-module').addEventListener('click', () => {
  if (!transaction || !assetReady) return;
  const assetId = (document.querySelector<HTMLSelectElement>('#module-choice')?.value ?? '') as keyof typeof ARCHITECTURAL_MODULE_DIMENSIONS;
  const bounds = ARCHITECTURAL_MODULE_DIMENSIONS[assetId];
  if (!bounds || !assets[assetId]) { status('O módulo seleccionado não está disponível na biblioteca GLB.'); return; }
  const box = new Box3().setFromObject(root);
  const at = box.isEmpty() ? new Vector3() : new Vector3(box.max.x + bounds[0] * 0.65, 0, box.min.z);
  const recordedAt = new Date().toISOString();
  const source = { source: 'user' as const, validation: 'unreviewed' as const, actor: 'local-user-input', recordedAt, evidence: 'Módulo Blender adicionado explicitamente como elemento conceptual; não foi reconhecido na planta.' };
  const node: Node = {
    id: `module-${assetId}-${crypto.randomUUID().slice(0, 6)}`, label: `Módulo conceptual · ${assetId}`, nodeType: 'component', parentId: null,
    transform: { translationM: at.toArray() as [number, number, number], rotation: [0, 0, 0, 1], scale: [1, 1, 1], provenance: { translationM: source, rotation: source, scale: source } },
    geometry: { kind: 'mesh_reference', assetId, boundsM: [...bounds] as [number, number, number], provenance: source },
    component: { kind: 'architectural_module', dependsOn: [], properties: { assetId: { value: assetId, provenance: source } } }, properties: {},
  };
  const candidate = previewSceneCommand(transaction, { type: 'AddComponent', node }, 'local-user-input');
  if (candidate.status === 'blocked') { status(candidate.issues.map((issue) => explainSceneError(issue.message)).join(' ')); return; }
  preview = candidate; compoundPreview = undefined; $('#preview-status').textContent = `Pré-visualização: adicionar ${assetId} como módulo independente.`; $('#commit-preview').disabled = false; $('#cancel-preview').disabled = false; renderModel(candidate.candidate!); selectNode(node.id);
});

function sceneBounds(): Box3 {
  root.updateMatrixWorld(true);
  const bounds = new Box3();
  if (root.children.length) bounds.setFromObject(root);
  if (referenceGroup && referenceGroup.visible) bounds.expandByObject(referenceGroup);
  return bounds;
}
function fitScene(view: 'isometric' | 'top' | 'front' = 'isometric'): void {
  if (!root.children.length && !referenceGroup) return;
  const box = sceneBounds();
  if (box.isEmpty()) return;
  const pose = createSpatialCameraView(box, cameraFitAspect(), view);
  moveCamera(pose.target, pose.position, 0.7, pose.up);
  app!.dataset.cameraView = view;
}
function moveCamera(target: Vector3, position: Vector3, duration = 0.7, up = new Vector3(0, 1, 0)): void {
  cameraTween?.kill();
  camera.up.copy(up);
  cameraTween = gsap.timeline({ onUpdate: invalidate });
  const seconds = reduceMotion.matches ? 0 : duration;
  cameraTween.to(camera.position, { x: position.x, y: position.y, z: position.z, duration: seconds, ease: 'power2.inOut' }, 0);
  cameraTween.to(orbit.target, { x: target.x, y: target.y, z: target.z, duration: seconds, ease: 'power2.inOut' }, 0);
}
$('#fit-scene').addEventListener('click', () => fitScene());
$('#home-scene').addEventListener('click', () => { if (cameraHome) moveCamera(cameraHome.target, cameraHome.position); else moveCamera(new Vector3(), new Vector3(8, 7, 9)); });
$('#top-view').addEventListener('click', () => fitScene('top'));
$('#front-view').addEventListener('click', () => fitScene('front'));
$('#iso-view').addEventListener('click', () => fitScene('isometric'));
$('#toggle-reference').addEventListener('click', () => { visibleReference = !visibleReference; $('#toggle-reference').setAttribute('aria-pressed', String(visibleReference)); updateReferenceView(); });
$('#source-toggle').addEventListener('click', () => { const panel = $('#source-panel'); const collapsed = panel.classList.toggle('source-collapsed'); $('#source-toggle').textContent = collapsed ? '+' : '−'; $('#source-toggle').setAttribute('aria-expanded', String(!collapsed)); $('#source-toggle').setAttribute('aria-label', collapsed ? 'Expandir referência' : 'Recolher referência'); });
$('#clear-focus').addEventListener('click', () => selectNode(undefined));

function candidateWallEdit(node: Node, length: number, height: number, thickness: number, x: number, z: number, actor = 'local-user-input', origin?: CommandOrigin): CompositePlan {
  if (!transaction || node.geometry?.kind !== 'box') throw new Error('A parede seleccionada não tem geometria paramétrica.');
  const q = node.transform.rotation; const angle = 2 * Math.atan2(q[1], q[3]);
  const dx = Math.cos(angle) * length / 2; const dz = -Math.sin(angle) * length / 2;
  return planWallEdit(transaction, node.id, { start: { x: x - dx, y: z - dz }, end: { x: x + dx, y: z + dz }, heightM: height, thicknessM: thickness, actor }, { origin });
}

function focusNode(nodeId: string): void {
  const object = root.getObjectByName(nodeId);
  if (!object) return;
  root.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(object);
  if (bounds.isEmpty()) return;
  const node = transaction?.scene.nodes.find((item) => item.id === nodeId);
  let direction = camera.position.clone().sub(orbit.target);
  if (node?.component?.kind === 'wall') {
    const worldRotation = object.getWorldQuaternion(new Quaternion());
    direction = new Vector3(0, 0, 1).applyQuaternion(worldRotation).setY(0.38);
  }
  const pose = createSpatialFocusView(bounds, cameraFitAspect(), direction);
  moveCamera(pose.target, pose.position, 0.7, pose.up);
  app!.dataset.cameraView = 'focus';
}

function setSpatialCommandState(state: SpatialCommandState, message: string): void { options.onCommandState?.(state, message); }

function createSpatialAgentRequest(query: string): SpatialAgentRequestV1 {
  const nodes = transaction?.scene.nodes ?? [];
  const relevant = nodes.length <= 40 ? nodes : [...new Map([...nodes.slice(0, 39), ...(selectedId ? nodes.filter((node) => node.id === selectedId) : [])].map((node) => [node.id, node])).values()];
  const document = activeTechnicalDocument;
  return {
    schema: SPATIAL_AGENT_REQUEST_SCHEMA,
    query,
    mode: 'architecture',
    capabilities: ['Select', 'Inspect', 'Focus', 'Move', 'Rotate', 'Resize', 'AddOpening', 'RemoveOpening', 'Undo', 'Redo', 'Save', 'Restore'],
    scene: transaction ? {
      id: transaction.scene.id,
      revisionId: transaction.scene.revision.id,
      revisionNumber: transaction.scene.revision.number,
      selectedId: selectedId ?? null,
      components: relevant.map((node) => ({
        id: node.id,
        label: node.label.slice(0, 120),
        kind: node.component?.kind ?? node.nodeType,
        dimensionsM: node.geometry?.kind === 'box' ? [...node.geometry.sizeM] : node.geometry?.kind === 'segment' ? [node.geometry.lengthM] : null,
        verification: node.geometry?.provenance.validation ?? 'unknown',
      })),
      constraints: transaction.scene.constraints.slice(0, 30).map((constraint) => `${constraint.kind}(${constraint.nodeIds.join(',')}) · ${constraint.provenance.validation}`),
    } : null,
    document: document && sourceDocumentRef ? {
      id: sourceDocumentRef.documentId,
      domain: document.primaryDomain,
      summary: document.summary.slice(0, 500),
      elements: document.elements.slice(0, 30).map((element) => ({ id: element.id, label: element.label.slice(0, 140), status: element.status, detail: `${element.rawValue ?? element.value ?? ''}${element.unit ? ` ${element.unit}` : ''}${element.evidence ? ` · ${element.evidence}` : ''}`.slice(0, 240) })),
      relations: document.relations.slice(0, 30).map((relation) => ({ id: relation.id, from: relation.fromId, to: relation.toId, kind: relation.kind, status: relation.status })),
      uncertainties: document.ambiguities.slice(0, 20).map((item) => item.slice(0, 240)),
      missing: document.missingInformation.slice(0, 20).map((item) => item.slice(0, 240)),
    } : null,
    history: spatialAgentHistory.slice(-6),
  };
}

function resolveAgentTarget(action: SpatialAgentAction, query: string): { nodeId: string | null; question?: string } {
  if (!transaction) return { nodeId: null, question: 'Não existe uma cena construída. Posso explicar o documento, mas é necessário criar uma cena antes de editar geometria.' };
  const walls = transaction.scene.nodes.filter((node) => node.component?.kind === 'wall');
  if (action.target.reference === 'none') return { nodeId: null };
  if (action.target.reference === 'selected') {
    if (!selectedId) return { nodeId: null, question: 'Seleccione primeiro o componente a que se refere.' };
    return transaction.scene.nodes.some((node) => node.id === selectedId) ? { nodeId: selectedId } : { nodeId: null, question: 'A selecção já não existe na revisão actual. Seleccione novamente o componente.' };
  }
  if (action.target.reference === 'label') {
    const label = action.target.label!.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt');
    const matches = transaction.scene.nodes.filter((node) => node.label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt') === label);
    if (matches.length === 1) return { nodeId: matches[0]!.id };
    return { nodeId: null, question: matches.length ? `Existem vários elementos chamados “${action.target.label}”. Seleccione um na cena.` : `Não encontrei “${action.target.label}” na revisão actual.` };
  }
  if (action.target.reference === 'ordinal') {
    const node = walls[action.target.ordinal! - 1];
    return node ? { nodeId: node.id } : { nodeId: null, question: `Não existe a parede ${action.target.ordinal} nesta cena.` };
  }
  if (!/\b(?:na|nesta) (?:vista|câmara|camera|ecr[aã])\b/i.test(query)) return { nodeId: null, question: 'Esquerda/direita depende do referencial. Indique “na vista actual” ou use o eixo global X/Z.' };
  camera.updateMatrixWorld(true);
  const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const ranked = walls.map((node) => ({ node, x: node.transform.translationM[0] * right.x + node.transform.translationM[1] * right.y + node.transform.translationM[2] * right.z })).sort((a, b) => a.x - b.x);
  const selected = action.target.reference === 'visual_left' ? ranked[0] : ranked.at(-1);
  return selected ? { nodeId: selected.node.id } : { nodeId: null, question: 'A cena não contém paredes.' };
}

function agentIntent(action: SpatialAgentAction, nodeId: string | null): import('./spatial-command-protocol').ParsedSpatialIntent {
  const factor = action.unit === 'mm' ? 0.001 : action.unit === 'cm' ? 0.01 : 1;
  const target = { nodeId, reference: null };
  switch (action.kind) {
    case 'Resize': {
      const node = transaction?.scene.nodes.find((item) => item.id === nodeId);
      if (!node || node.component?.kind !== 'wall' || node.geometry?.kind !== 'box') throw new Error('A parede proposta já não está disponível para redimensionar.');
      const requested = action.value! * factor;
      const length = action.valueMode === 'increase_by' ? node.geometry.sizeM[0] + requested : action.valueMode === 'decrease_by' ? node.geometry.sizeM[0] - requested : requested;
      if (!Number.isFinite(length) || length <= 0 || length > 1000) throw new Error('O comprimento resultante fica fora dos limites permitidos.');
      return { intent: { kind: 'Resize', target, parameters: { property: 'length', value: length }, unit: 'm' } };
    }
    case 'Move': return { intent: { kind: 'Move', target, parameters: { axis: action.axis!, distance: action.value! * factor }, unit: 'm' } };
    case 'Rotate': return { intent: { kind: 'Rotate', target, parameters: { axis: action.axis!, angle: action.unit === 'deg' ? action.value! * Math.PI / 180 : action.value! }, unit: 'rad' } };
    case 'AddOpening': return { intent: { kind: 'AddOpening', target, parameters: { kind: action.opening!.kind, widthM: action.opening!.widthM, heightM: action.opening!.heightM, offsetM: action.opening!.offsetM, sillM: action.opening!.sillM }, unit: 'm' } };
    case 'Select': case 'Inspect': case 'Focus': case 'RemoveOpening': case 'Undo': case 'Redo': case 'Save': case 'Restore': return { intent: { kind: action.kind, target, parameters: {}, unit: null } };
  }
}

async function handleSpatialCommand(input: string, origin: SpatialCommandOrigin, callerSignal?: AbortSignal): Promise<SpatialCommandOutcome> {
  if (preview || compoundPreview) return { status: 'rejected', message: 'Existe uma pré-visualização pendente. Confirme ou cancele-a antes de enviar outro comando.' };
  const domainConflict = spatialDomainConflict(input, 'architecture');
  if (domainConflict) {
    const message = domainConflict === 'mechanical'
      ? 'Esta instrução pertence ao laboratório mecânico. Não será encaminhada para a geometria arquitectónica.'
      : 'Esta instrução pertence ao domínio eléctrico. Não será encaminhada para a geometria arquitectónica.';
    setSpatialCommandState('Rejected', message);
    return { status: 'clarification', message };
  }
  const originalRevision = transaction?.scene.revision.id;
  const originalSelection = selectedId;
  const request = createSpatialAgentRequest(input);
  const local = parseSpatialIntentV1(input);
  let parsed = local;
  let answerPrefix = '';
  setSpatialCommandState('Understanding', 'A interpretar a instrução e a validar contexto, capacidades e revisão da cena.');
  spatialAgentAbort?.abort();
  const abort = new AbortController();
  spatialAgentAbort = abort;
  const abortFromCaller = () => abort.abort();
  callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
  try {
    const response = await fetch('/api/spatial-agent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request), signal: abort.signal });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const code = payload && typeof payload === 'object' && 'error' in payload && (payload.error as { code?: unknown })?.code;
      if (response.status === 503 && code === 'MODEL_API_KEY_MISSING' || [404, 500].includes(response.status) && payload === null) throw new Error('SPATIAL_AGENT_LOCAL_FALLBACK');
      throw new Error(typeof code === 'string' ? code : 'SPATIAL_AGENT_HTTP_ERROR');
    }
    if (!payload || typeof payload !== 'object' || !('result' in payload)) throw new Error('SPATIAL_AGENT_INVALID_ENVELOPE');
    const agent = parseSpatialAgentResult(JSON.stringify((payload as { result: unknown }).result), request);
    if (transaction && (transaction.scene.revision.id !== originalRevision || selectedId !== originalSelection)) {
      setSpatialCommandState('Rejected', 'A cena ou a selecção mudou durante a interpretação. Repita o comando para rever o contexto actual.');
      return { status: 'clarification', message: 'A cena ou a selecção mudou durante a interpretação. Repita o comando para rever o contexto actual.' };
    }
    spatialAgentHistory = [...spatialAgentHistory, { role: 'user' as const, text: input.slice(0, 300) }, { role: 'assistant' as const, text: agent.text.slice(0, 300) }].slice(-6);
    if (agent.kind === 'ANSWER') {
      setSpatialCommandState('Completed', agent.text);
      return { status: 'completed', message: `${agent.text}${agent.evidenceIds.length ? ` · Evidência: ${agent.evidenceIds.join(', ')}` : ' · Sem referência documental directa.'}` };
    }
    if (agent.kind === 'REQUEST_CLARIFICATION') {
      setSpatialCommandState('Rejected', agent.question);
      return { status: 'clarification', message: agent.question };
    }
    if (activeTechnicalDocument && activeTechnicalDocument.primaryDomain !== 'architecture') {
      const message = 'O documento activo não é arquitectónico. Este editor não encaminha alterações mecânicas ou eléctricas para a geometria de paredes.';
      setSpatialCommandState('Rejected', message); return { status: 'clarification', message };
    }
    const target = resolveAgentTarget(agent.action, input);
    if (target.question) { setSpatialCommandState('Rejected', target.question); return { status: 'clarification', message: target.question }; }
    parsed = { status: 'recognized', value: agentIntent(agent.action, target.nodeId) };
    answerPrefix = 'Muse Spark propôs; executor local validou. ';
  } catch (error) {
    if (abort.signal.aborted || error instanceof DOMException && error.name === 'AbortError') return { status: 'rejected', message: 'Interpretação cancelada. Nenhuma alteração foi aplicada.' };
    const localFallbackAllowed = error instanceof TypeError || error instanceof Error && error.message === 'SPATIAL_AGENT_LOCAL_FALLBACK';
    if (!localFallbackAllowed) {
      const message = error instanceof Error && error.message === 'SPATIAL_AGENT_ACTION_NOT_AUTHORIZED' ? 'A resposta do Muse não correspondeu a um pedido explícito. Nenhuma alteração foi proposta.' : 'Muse Spark não devolveu uma interpretação válida. A cena permaneceu intacta.';
      setSpatialCommandState('Failed', message); return { status: 'failed', message };
    }
    if (local.status !== 'recognized') {
      const message = error instanceof Error && error.message.startsWith('SPATIAL_AGENT_') ? 'Muse Spark está indisponível ou a resposta não passou na validação. A cena permaneceu intacta.' : 'Muse Spark não está disponível. Nenhuma alteração foi aplicada.';
      setSpatialCommandState('Failed', message); return { status: 'failed', message };
    }
    answerPrefix = 'Muse indisponível; parser local determinístico reconheceu o comando. ';
    parsed = local;
  } finally {
    callerSignal?.removeEventListener('abort', abortFromCaller);
    if (spatialAgentAbort === abort) spatialAgentAbort = undefined;
  }
  if (!transaction) return { status: 'clarification', message: 'Não existe cena construída. Carregue e calibre uma planta antes de editar geometria.' };

  let resolvedNodeId: string | null = parsed.value.intent.target.nodeId;
  if (parsed.value.intent.target.reference) {
    camera.updateMatrixWorld(true);
    const screenRight = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion).toArray() as [number, number, number];
    const resolution = resolveSpatialTarget(transaction.scene, parsed.value.intent, selectedId, screenRight);
    if (resolution.status === 'clarification') { setSpatialCommandState('Rejected', resolution.question); return Promise.resolve({ status: 'clarification', message: resolution.question }); }
    resolvedNodeId = resolution.nodeId;
  }
  const intent = { ...parsed.value.intent, target: { ...parsed.value.intent.target, nodeId: resolvedNodeId } };
  const command = createSpatialCommandEnvelope({
    intent,
    context: { sceneId: transaction.scene.id, revisionId: transaction.scene.revision.id, selectedNodeId: selectedId ?? null, documentId: sourceDocumentRef?.documentId ?? null, mode: 'architecture' },
    inputText: input,
    origin: answerPrefix.startsWith('Muse Spark') ? 'muse_spark' : origin,
  });
  const actor = answerPrefix.startsWith('Muse Spark') ? 'user-confirmed:muse-spark' : 'local-user-input';
  // Tudo o que vem de um modelo é uma proposta: não toca valores confirmados, nem os cria, nem autoriza nada.
  const sceneOrigin: CommandOrigin = answerPrefix.startsWith('Muse Spark') || origin === 'muse_spark' ? 'model_proposal' : 'ui_direct';
  const sceneContext: SceneCommandContext = { origin: sceneOrigin, actor: { kind: sceneOrigin === 'model_proposal' ? 'model' : 'human', id: actor } };

  try {
    const node = resolvedNodeId ? transaction.scene.nodes.find((item) => item.id === resolvedNodeId) : undefined;
    switch (intent.kind) {
      case 'Select':
        if (!node) throw new Error('Alvo não encontrado nesta cena.');
        selectNode(node.id); focusNode(node.id); setSpatialCommandState('Completed', `${node.label} seleccionada no contexto da cena.`);
        return Promise.resolve({ status: 'completed', message: `${answerPrefix}${node.label} seleccionada.` });
      case 'Focus':
        if (!node) throw new Error('Indique o componente que pretende focar.');
        selectNode(node.id); focusNode(node.id); setSpatialCommandState('Completed', `Foco em ${node.label}.`);
        return Promise.resolve({ status: 'completed', message: `${answerPrefix}Foco em ${node.label}.` });
      case 'Inspect':
        if (intent.parameters.comparison === 'before-after') {
          if (!transaction.undoStack.length) throw new Error('Ainda não existe uma revisão anterior para comparar.');
          $('#compare-scene').click();
          setSpatialCommandState('Completed', 'Comparação entre revisões reais activada.');
          return Promise.resolve({ status: 'completed', message: `${answerPrefix}Comparação entre revisões reais activada.` });
        }
        if (!node) throw new Error('Indique qual componente pretende inspeccionar.');
        selectNode(node.id); focusNode(node.id);
        if (node.geometry?.kind === 'box') {
          const [length, height, thickness] = node.geometry.sizeM;
          const message = `${node.label}: ${length.toFixed(2)} × ${height.toFixed(2)} × ${thickness.toFixed(2)} m. Proveniência ${node.geometry.provenance.validation}; não é certificação estrutural.`;
          setSpatialCommandState('Completed', message); return Promise.resolve({ status: 'completed', message: `${answerPrefix}${message}` });
        }
        throw new Error(`${node.label} não tem dimensões de caixa disponíveis.`);
      case 'Resize': {
        if (!node || node.geometry?.kind !== 'box' || node.component?.kind !== 'wall') throw new Error('Seleccione uma parede paramétrica.');
        const length = typeof intent.parameters.delta === 'number' ? node.geometry.sizeM[0] + intent.parameters.delta : Number(intent.parameters.value);
        const next = candidateWallEdit(node, length, node.geometry.sizeM[1], node.geometry.sizeM[2], node.transform.translationM[0], node.transform.translationM[2], actor, sceneOrigin);
        pendingCommand = command; previewCompound(next, `${node.label}: ${node.geometry.sizeM[0].toFixed(2)} → ${length.toFixed(2)} m`);
        focusNode(node.id);
        selectNode(node.id); setSpatialCommandState('AwaitingConfirmation', `Pré-visualização pronta para ${node.label}. Confirme no inspector para gravar a revisão.`);
        return Promise.resolve({ status: 'preview', message: `${answerPrefix}${node.label}: pré-visualização criada. Confirme para aplicar.` });
      }
      case 'Move': {
        if (!node || node.geometry?.kind !== 'box' || node.component?.kind !== 'wall') throw new Error('Seleccione uma parede paramétrica.');
        const axis = String(intent.parameters.axis);
        if (axis !== 'X' && axis !== 'Z') throw new Error('Para uma parede, os movimentos permitidos são nos eixos globais X ou Z.');
        const delta = Number(intent.parameters.distance);
        const x = node.transform.translationM[0] + (axis === 'X' ? delta : 0);
        const z = node.transform.translationM[2] + (axis === 'Z' ? delta : 0);
        const next = candidateWallEdit(node, node.geometry.sizeM[0], node.geometry.sizeM[1], node.geometry.sizeM[2], x, z, actor, sceneOrigin);
        pendingCommand = command; previewCompound(next, `${node.label}: deslocar ${delta.toFixed(2)} m no eixo ${axis}`);
        focusNode(node.id);
        selectNode(node.id); setSpatialCommandState('AwaitingConfirmation', `Pré-visualização pronta. Dependências geométricas foram recalculadas; confirme no inspector.`);
        return Promise.resolve({ status: 'preview', message: `${answerPrefix}${node.label}: pré-visualização criada. Confirme para aplicar.` });
      }
      case 'Rotate': {
        if (!node || node.component?.kind !== 'wall') throw new Error('Seleccione uma parede para rodar.');
        const angle = Number(intent.parameters.angle);
        const axis = String(intent.parameters.axis);
        if (!Number.isFinite(angle) || Math.abs(angle) > Math.PI * 2 || axis !== 'Y') throw new Error('A rotação de paredes só é permitida em torno do eixo vertical Y, até 360° por comando.');
        const candidate = previewSceneCommand(transaction!, { type: 'RotateComponent', nodeId: node.id, axis: [0, 1, 0], angleRad: angle }, actor, undefined, sceneContext);
        if (candidate.status === 'blocked') throw new Error(candidate.issues.map((issue) => issue.message).join(' '));
        preview = candidate; compoundPreview = undefined; compoundPreviewBaseRevision = undefined; pendingCommand = command;
        $('#preview-status').textContent = previewText(`Pré-visualização: rodar ${node.label} ${angle.toFixed(3)} rad; dependências recalculadas.`, candidate.touchesConfirmed);
        $('#commit-preview').disabled = false; $('#cancel-preview').disabled = false; renderModel(candidate.candidate!); focusNode(node.id); selectNode(node.id);
        setSpatialCommandState('AwaitingConfirmation', `Pré-visualização angular pronta para ${node.label}. Confirme para gravar.`);
        return Promise.resolve({ status: 'preview', message: `${answerPrefix}${node.label}: rotação pré-visualizada. Confirme para aplicar.` });
      }
      case 'AddOpening': {
        if (!node || node.component?.kind !== 'wall') throw new Error('Seleccione uma parede para alojar a abertura.');
        const next = addOpeningToScene(transaction, node.id, {
          id: `opening-${crypto.randomUUID().slice(0, 8)}`,
          kind: String(intent.parameters.kind) as 'door' | 'window',
          widthM: Number(intent.parameters.widthM), heightM: Number(intent.parameters.heightM),
          offsetM: Number(intent.parameters.offsetM), sillM: Number(intent.parameters.sillM), actor,
        }, undefined, sceneOrigin);
        pendingCommand = command; previewCompound(next, `${String(intent.parameters.kind) === 'door' ? 'porta' : 'janela'} ${Number(intent.parameters.widthM).toFixed(2)} m ligada a ${node.label}`);
        focusNode(node.id);
        selectNode(node.id); setSpatialCommandState('AwaitingConfirmation', 'Abertura e dependência preparadas. Confirme no inspector para gravar.');
        return Promise.resolve({ status: 'preview', message: `${answerPrefix}Pré-visualização da abertura criada. Confirme para aplicar.` });
      }
      case 'RemoveOpening': {
        if (!node || !['door', 'window'].includes(node.component?.kind ?? '')) throw new Error('Seleccione uma porta ou janela para remover.');
        const candidate = previewSceneCommand(transaction, { type: 'RemoveComponent', nodeId: node.id }, actor, undefined, sceneContext);
        if (candidate.status === 'blocked') throw new Error(candidate.issues.map((issue) => issue.message).join(' '));
        preview = candidate; pendingCommand = command; $('#preview-status').textContent = previewText(`Pré-visualização: remover ${node.label}.`, candidate.touchesConfirmed);
        $('#commit-preview').disabled = false; $('#cancel-preview').disabled = false; renderModel(candidate.candidate!); selectNode(node.id);
        setSpatialCommandState('AwaitingConfirmation', `Remoção de ${node.label} proposta. Confirme para gravar.`);
        return Promise.resolve({ status: 'preview', message: `${answerPrefix}Remoção de ${node.label} proposta. Confirme para aplicar.` });
      }
      case 'Undo': case 'Redo': {
        const applied = executeHistory(intent.kind);
        const message = applied ? intent.kind === 'Undo' ? 'Última revisão desfeita.' : 'Revisão refeita.' : `Não foi possível executar ${intent.kind === 'Undo' ? 'desfazer' : 'refazer'} nesta revisão.`;
        setSpatialCommandState(applied ? 'Completed' : 'Rejected', message);
        return Promise.resolve({ status: applied ? 'completed' : 'rejected', message: `${answerPrefix}${message}` });
      }
      case 'Save':
        if (!transaction) throw new Error('Não existe cena para guardar.');
        persistScene(); setSpatialCommandState('Completed', 'Cena guardada na persistência local.');
        spatialAgentHistory = [...spatialAgentHistory, { role: 'assistant' as const, text: `Cena ${transaction.scene.id} guardada na revisão ${transaction.scene.revision.number}.` }].slice(-6);
        return Promise.resolve({ status: 'completed', message: `${answerPrefix}Cena guardada na persistência local.` });
      case 'Restore':
        {
          const saved = localStorage.getItem('unfold-spatial-scene.v1');
          if (!saved) throw new Error('Não existe uma cena guardada para restaurar.');
          transaction = deserializeSceneTransaction(saved); preview = undefined; compoundPreview = undefined; pendingCommand = undefined; selectedId = undefined; renderModel(transaction.scene); fitScene(); updateToolbar();
          setSpatialCommandState('Completed', 'Cena local revalidada e restaurada.');
          return Promise.resolve({ status: 'completed', message: `${answerPrefix}Cena restaurada.` });
        }
      default:
        setSpatialCommandState('Rejected', 'Esta intenção ainda não é suportada pelo executor determinístico.');
        return Promise.resolve({ status: 'rejected', message: 'Esta intenção ainda não é suportada pelo executor determinístico.' });
    }
  } catch (error) {
    const message = error instanceof Error ? explainSceneError(error.message) : 'Comando recusado.';
    pendingCommand = undefined; setSpatialCommandState('Rejected', `${message} Nenhuma revisão foi aplicada.`);
    return Promise.resolve({ status: 'rejected', message: `${message} Nenhuma revisão foi aplicada.` });
  }
}

/** O texto do preview, com o aviso de valores confirmados quando a alteração os toca (o clique em «Aplicar» é a autorização). */
function previewText(text: string, touched: readonly ConfirmedReference[]): string {
  const notice = confirmedNotice(touched, (id) => transaction?.scene.nodes.find((item) => item.id === id)?.label ?? id);
  return notice ? `${text} ${notice}` : text;
}
function previewCompound(shown: SceneTransaction | CompositePlan, label: string): void {
  if (!transaction) throw new Error('SCENE_NOT_READY');
  const plan = 'commit' in shown ? shown : undefined;
  const next = plan ? plan.transaction : shown as SceneTransaction;
  if (plan) compositePlans.set(next, plan);
  compoundPreviewBaseRevision = transaction.scene.revision.id;
  compoundPreview = next; preview = undefined; $('#preview-status').textContent = previewText(`Pré-visualização: ${label}. A revisão canónica ainda não foi alterada.`, plan?.touchesConfirmed ?? []);
  $('#commit-preview').disabled = false; $('#cancel-preview').disabled = false; renderModel(next.scene); updateToolbar();
}
$('#preview-wall').addEventListener('click', () => {
  try {
    const node = transaction?.scene.nodes.find((item) => item.id === selectedId); if (!node) throw new Error('Seleccione uma parede.');
    const x = Number(document.querySelector<HTMLInputElement>('#wall-x')?.value); const z = Number(document.querySelector<HTMLInputElement>('#wall-z')?.value);
    if (!Number.isFinite(x) || !Number.isFinite(z)) throw new Error('Posições X/Z devem ser finitas.');
    const next = candidateWallEdit(node, parsePositive('#wall-length', 'Comprimento'), parsePositive('#wall-height-edit', 'Altura'), parsePositive('#wall-thickness-edit', 'Espessura'), x, z);
    previewCompound(next, `${node.label} · ${$('#wall-length').value} m`);
  } catch (error) { status(error instanceof Error ? explainSceneError(error.message) : 'Alteração inválida.'); }
});
$('#add-opening').addEventListener('click', () => {
  try {
    const wall = transaction?.scene.nodes.find((node) => node.id === selectedId); if (!wall) throw new Error('Seleccione a parede que receberá a abertura.');
    const offsetText = document.querySelector<HTMLInputElement>('#opening-offset')?.value ?? ''; const sillText = document.querySelector<HTMLInputElement>('#opening-sill')?.value ?? '';
    const offset = Number(offsetText); const sill = Number(sillText);
    if (!offsetText || !sillText || !Number.isFinite(offset) || offset < 0 || !Number.isFinite(sill) || sill < 0) throw new Error('Offset e peitoril têm de ser introduzidos explicitamente.');
    const next = addOpeningToScene(transaction!, wall.id, { id: `opening-${crypto.randomUUID().slice(0, 8)}`, kind: (document.querySelector<HTMLSelectElement>('#opening-kind')?.value ?? 'door') as 'door' | 'window', offsetM: offset, widthM: parsePositive('#opening-width', 'Largura'), heightM: parsePositive('#opening-height', 'Altura'), sillM: sill, actor: 'local-user-input' });
    previewCompound(next, 'nova abertura com dimensões explicitamente fornecidas');
  } catch (error) { status(error instanceof Error ? explainSceneError(error.message) : 'A abertura não é válida.'); }
});
$('#preview-opening').addEventListener('click', () => {
  try {
    if (!transaction || !selectedId) throw new Error('Seleccione uma abertura.');
    const offsetText = $('#edit-opening-offset').value; const sillText = $('#edit-opening-sill').value;
    if (!offsetText || !sillText) throw new Error('Offset e peitoril têm de ser introduzidos explicitamente.');
    const next = planOpeningEdit(transaction, selectedId, { offsetM: Number(offsetText), widthM: parsePositive('#edit-opening-width', 'Largura'), heightM: parsePositive('#edit-opening-height', 'Altura'), sillM: Number(sillText), actor: 'local-user-input' });
    previewCompound(next, 'alteração da abertura e do vão na parede');
  } catch (error) { status(error instanceof Error ? explainSceneError(error.message) : 'Abertura inválida.'); }
});
$('#remove-opening').addEventListener('click', () => {
  if (!transaction || !selectedId) return;
  const candidate = previewSceneCommand(transaction, { type: 'RemoveComponent', nodeId: selectedId }, 'local-user-input');
  if (candidate.status === 'blocked') { status(candidate.issues.map((issue) => explainSceneError(issue.message)).join(' ')); return; }
  preview = candidate; compoundPreview = undefined; $('#preview-status').textContent = previewText('Pré-visualização: remover abertura.', candidate.touchesConfirmed); $('#commit-preview').disabled = false; $('#cancel-preview').disabled = false; renderModel(candidate.candidate!);
});
$('#commit-preview').addEventListener('click', () => {
  if (!transaction) return;
  try {
    if (compoundPreview && compoundPreviewBaseRevision !== transaction.scene.revision.id) throw new Error('STALE_SPATIAL_PREVIEW');
    setSpatialCommandState('Executing', 'A validar e aplicar a transacção espacial.');
    const priorScene = transaction.scene;
    const committedCommand = pendingCommand;
    // Se o preview toca valores confirmados, este clique (a confirmação explícita) emite a autorização para a operação mostrada.
    const compoundPlan = compoundPreview ? compositePlans.get(compoundPreview) : undefined;
    transaction = compoundPreview ? (compoundPlan ? compoundPlan.commit(sceneAuthorizer.authorize(compoundPlan), transaction) : compoundPreview) : preview ? commitScenePreview(transaction, preview, sceneAuthorizer.authorize(preview)) : transaction;
    preview = undefined; compoundPreview = undefined; compoundPreviewBaseRevision = undefined; $('#preview-status').textContent = 'Alteração aplicada à cena canónica.'; $('#commit-preview').disabled = true; $('#cancel-preview').disabled = true; persistScene(); renderModel(transaction.scene); animateRevision(priorScene, transaction.scene, committedCommand?.intent.target.nodeId ?? selectedId); selectNode(selectedId); updateToolbar();
    if (committedCommand) {
      const before = committedCommand.intent.target.nodeId ? priorScene.nodes.find((node) => node.id === committedCommand.intent.target.nodeId) : undefined;
      const after = before ? transaction.scene.nodes.find((node) => node.id === before.id) : undefined;
      const change = before?.geometry?.kind === 'box' && after?.geometry?.kind === 'box' ? ` ${before.label}: ${before.geometry.sizeM[0].toFixed(2)} → ${after.geometry.sizeM[0].toFixed(2)} m.` : '';
      spatialAgentHistory = [...spatialAgentHistory, { role: 'assistant' as const, text: `Commit real ${committedCommand.intent.kind}, revisão ${transaction.scene.revision.number}.${change}` }].slice(-6);
      setSpatialCommandState('Completed', `Comando confirmado na revisão ${transaction.scene.revision.number}. Undo/Redo disponíveis.`);
    }
    pendingCommand = undefined;
  } catch (error) { status(`Commit recusado: ${error instanceof Error ? explainSceneError(error.message) : 'erro'}`); cancelPreview(); }
});
function cancelPreview(): void {
  const commandWasPending = Boolean(pendingCommand);
  preview = undefined; compoundPreview = undefined; compoundPreviewBaseRevision = undefined; pendingCommand = undefined;
  $('#preview-status').textContent = 'Pré-visualização cancelada; estado canónico preservado.'; $('#commit-preview').disabled = true; $('#cancel-preview').disabled = true; renderModel(); selectNode(selectedId); updateToolbar();
  if (commandWasPending) setSpatialCommandState('Rejected', 'Pré-visualização cancelada. A cena canónica não foi alterada.');
}
$('#cancel-preview').addEventListener('click', cancelPreview);

let gizmoDragStart: { position: Vector3; quaternion: import('three').Quaternion; scale: Vector3 } | undefined;
gizmo.addEventListener('change', invalidate);
gizmo.addEventListener('dragging-changed', (event) => {
  orbit.enabled = !event.value;
  if (event.value && buildTimeline) { buildTimeline.progress(1).kill(); buildTimeline = undefined; }
  const object = gizmo.object;
  if (event.value && object) { gizmoDragStart = { position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone() }; return; }
  if (!object || !gizmoDragStart || !transaction || !selectedId) return;
  const original = gizmoDragStart; gizmoDragStart = undefined;
  const node = transaction.scene.nodes.find((item) => item.id === selectedId);
  if (!node) { object.position.copy(original.position); object.quaternion.copy(original.quaternion); object.scale.copy(original.scale); return; }
  try {
    if (node.component?.kind === 'wall' && node.geometry?.kind === 'box') {
      const angle = 2 * Math.atan2(object.quaternion.y, object.quaternion.w);
      const direction = new Vector3(Math.cos(angle), 0, -Math.sin(angle));
      const length = node.geometry.sizeM[0] * object.scale.x;
      const start = new Vector3(object.position.x, 0, object.position.z).addScaledVector(direction, -length / 2);
      const end = new Vector3(object.position.x, 0, object.position.z).addScaledVector(direction, length / 2);
      const next = planWallEdit(transaction, node.id, { start: { x: start.x, y: start.z }, end: { x: end.x, y: end.z }, heightM: node.geometry.sizeM[1] * object.scale.y, thicknessM: node.geometry.sizeM[2] * object.scale.z, actor: 'local-user-input' });
      previewCompound(next, 'transformação do gizmo e dependências recalculadas');
    } else {
      const deltaRotation = object.quaternion.clone().multiply(original.quaternion.clone().invert()).normalize();
      if (deltaRotation.w < 0) { deltaRotation.x *= -1; deltaRotation.y *= -1; deltaRotation.z *= -1; deltaRotation.w *= -1; }
      const halfAngle = Math.acos(Math.min(1, Math.max(-1, deltaRotation.w)));
      const sine = Math.sin(halfAngle);
      const axis = sine < 1e-8 ? new Vector3(0, 1, 0) : new Vector3(deltaRotation.x / sine, deltaRotation.y / sine, deltaRotation.z / sine);
      const command: SpatialCommand = gizmo.mode === 'translate'
        ? { type: 'MoveComponent', nodeId: selectedId, translationM: object.position.toArray() as [number, number, number] }
        : gizmo.mode === 'scale'
          ? { type: 'ResizeComponent', nodeId: selectedId, scale: [object.scale.x / original.scale.x, object.scale.y / original.scale.y, object.scale.z / original.scale.z] }
          : { type: 'RotateComponent', nodeId: selectedId, axis: axis.toArray() as [number, number, number], angleRad: halfAngle * 2 };
      const next = previewSceneCommand(transaction, command, 'local-user-input');
      if (next.status === 'blocked') throw new Error(next.issues.map((issue) => issue.message).join(' '));
      preview = next; renderModel(next.candidate!); $('#preview-status').textContent = previewText('Pré-visualização do gizmo; commit pendente.', next.touchesConfirmed); $('#commit-preview').disabled = false; $('#cancel-preview').disabled = false;
    }
  } catch (error) { object.position.copy(original.position); object.quaternion.copy(original.quaternion); object.scale.copy(original.scale); renderModel(); status(error instanceof Error ? explainSceneError(error.message) : 'Transformação recusada.'); }
});
renderer.domElement.addEventListener('pointerdown', (event) => {
  if (gizmo.dragging || preview || compoundPreview) return;
  const bounds = renderer.domElement.getBoundingClientRect(); pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera); root.updateMatrixWorld(true);
  const hit = raycaster.intersectObject(root, true).find((item) => {
    let object: Object3D | null = item.object;
    while (object && object !== root) { if (object.name && transaction?.scene.nodes.some((node) => node.id === object!.name)) return true; object = object.parent; }
    return false;
  });
  let object: Object3D | null = hit?.object ?? null; while (object && object !== root && !transaction?.scene.nodes.some((node) => node.id === object!.name)) object = object.parent;
  selectNode(object && object !== root ? object.name : undefined);
  if (object && object !== root) focusNode(object.name);
});

function persistScene(): void {
  if (!transaction) return;
  try { localStorage.setItem('unfold-spatial-scene.v1', serializeSceneTransaction(transaction)); $('#restore-scene').disabled = false; }
  catch (error) { status(`Cena não foi persistida: ${error instanceof Error ? error.message : 'limite local excedido'}`); }
}
$('#save-scene').addEventListener('click', () => {
  if (!transaction) return;
  persistScene();
  const blob = new Blob([serializeSceneTransaction(transaction)], { type: 'application/vnd.unfold.spatial-scene+json' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${transaction.scene.id}.spatial-scene.json`; link.click(); URL.revokeObjectURL(link.href);
  status(`Cena guardada · revisão ${transaction.scene.revision.number}. A imagem fonte não foi incorporada no JSON.`);
});
$('#restore-scene').addEventListener('click', () => {
  const saved = localStorage.getItem('unfold-spatial-scene.v1'); if (!saved) return;
  try { transaction = deserializeSceneTransaction(saved); preview = undefined; compoundPreview = undefined; selectedId = undefined; renderModel(transaction.scene); fitScene(); updateToolbar(); status('Cena restaurada do armazenamento local e revalidada como spatial_scene.v1.'); }
  catch (error) { status(`Restauro recusado: ${error instanceof Error ? error.message : 'cena inválida'}`); }
});
$('#open-scene').addEventListener('click', () => $('#scene-file').click());
$('#scene-file').addEventListener('change', async (event) => {
  const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return;
  if (file.size > 16 * 1024 * 1024) { status('Ficheiro espacial excede 16 MiB.'); return; }
  try { transaction = deserializeSceneTransaction(await file.text()); renderModel(transaction.scene); fitScene(); updateToolbar(); status('Cena espacial validada e carregada.'); }
  catch (error) { status(`Cena inválida: ${error instanceof Error ? error.message : 'erro de validação'}`); }
});
$('#undo-scene').addEventListener('click', () => executeHistory('Undo'));
$('#redo-scene').addEventListener('click', () => executeHistory('Redo'));
function executeHistory(type: 'Undo' | 'Redo'): boolean {
  if (!transaction || preview || compoundPreview) return false;
  try { const result = previewSceneCommand(transaction, { type }, 'local-user-input'); if (result.status === 'blocked') throw new Error(result.issues.map((issue) => issue.message).join(' ')); transaction = commitScenePreview(transaction, result); persistScene(); renderModel(); selectNode(selectedId); updateToolbar(); status(`${type === 'Undo' ? 'Desfeito' : 'Refeito'} · revisão ${transaction.scene.revision.number}.`); spatialAgentHistory = [...spatialAgentHistory, { role: 'assistant' as const, text: `${type === 'Undo' ? 'Undo' : 'Redo'} confirmado na revisão ${transaction.scene.revision.number}.` }].slice(-6); return true; }
  catch (error) { status(error instanceof Error ? explainSceneError(error.message) : 'Histórico indisponível.'); return false; }
}
$('#compare-scene').addEventListener('click', () => {
  if (!transaction?.undoStack.length || preview || compoundPreview) return;
  compare = !compare; $('#compare-scene').setAttribute('aria-pressed', String(compare));
  renderModel(compare ? transaction.undoStack.at(-1)! : transaction.scene);
  status(compare ? 'A comparar revisão anterior; selecção suspensa.' : 'Revisão canónica actual.');
});
for (const [selector, mode] of [['#mode-translate', 'translate'], ['#mode-rotate', 'rotate'], ['#mode-scale', 'scale']] as const) $(selector).addEventListener('click', () => { gizmo.setMode(mode); gizmo.setTranslationSnap(0.1); gizmo.setRotationSnap(Math.PI / 12); gizmo.setScaleSnap(0.05); status(`Gizmo ${mode} seleccionado · snap 0.10 m / 15° / 5%. Arraste para pré-visualizar; confirme para gravar.`); });

$('#source-image').addEventListener('load', invalidate);
function cleanup(notifyExit = false): void {
  if (disposed) return;
  disposed = true;
  if (raf) cancelAnimationFrame(raf);
  spatialAgentAbort?.abort(); spatialAgentAbort = undefined;
  cameraTween?.kill(); buildTimeline?.kill();
  resizeObserver.disconnect();
  window.removeEventListener('beforeunload', onUnload);
  window.removeEventListener('keydown', onEditorKeydown);
  unregisterSpatialCommands?.(); unregisterSpatialCommands = undefined;
  disposeSceneGroup(); gizmo.dispose(); orbit.dispose(); renderer.forceContextLoss(); renderer.dispose();
  referenceGroup?.traverse((object) => { if (object instanceof Mesh) { object.geometry.dispose(); object.material.dispose(); } });
  referenceTexture?.dispose();
  if (libraryRoot) libraryRoot.traverse((object) => { if (object instanceof Mesh) { object.geometry.dispose(); const materials = Array.isArray(object.material) ? object.material : [object.material]; materials.forEach((material) => material.dispose()); } });
  if (currentImageUrl) URL.revokeObjectURL(currentImageUrl);
  renderer.domElement.remove();
  if (notifyExit) {
    if (options.onExit) options.onExit();
    else window.location.assign('/demo');
  }
}
const onUnload = () => cleanup();
function onEditorKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && (preview || compoundPreview)) cancelPreview();
  else if (event.key === 'Escape') cleanup(true);
  else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); executeHistory(event.shiftKey ? 'Redo' : 'Undo'); }
}
window.addEventListener('keydown', onEditorKeydown);
window.addEventListener('beforeunload', onUnload, { once: true });
$('#exit-spatial-editor').addEventListener('click', () => cleanup(true));
app.querySelectorAll<HTMLButtonElement>('[data-view-mode]').forEach((button) => button.addEventListener('click', () => {
  currentViewMode = button.dataset.viewMode as typeof currentViewMode;
  updateReferenceView();
  status(({ original: 'Referência raster original; sem sobreposição.', trace: 'Tracing editável em coordenadas do raster.', model: 'Geometria paramétrica da cena.', compare: 'Sobreposição raster/3D usando o mapeamento espacial da cena.' } as const)[currentViewMode]);
}));

resize();
updateToolbar();
if (!acceptedDocumentSource) {
  const saved = localStorage.getItem('unfold-spatial-scene.v1');
  if (saved) {
    try { transaction = deserializeSceneTransaction(saved); renderModel(transaction.scene); fitScene(); updateToolbar(); status('Última cena espacial restaurada e revalidada; a referência raster original pode necessitar de novo carregamento.'); }
    catch { status('A cena guardada foi recusada; carregue um ficheiro válido ou crie uma nova cena.'); }
  }
}
if (acceptedDocumentSource) {
  void readSpatialSourceImage().then(async (file) => {
    if (!file) { status('Não foi encontrada uma imagem transferida da análise documental. Importe a planta manualmente.'); return; }
    await loadPlanFile(file.file, file.technicalDocumentRef);
    if (file.technicalDocumentRef && file.technicalDocument) {
      activeTechnicalDocument = file.technicalDocument;
      const handoff = prepareSpatialHandoff(file.technicalDocument, file.technicalDocumentRef.documentId, imageInfo!.sha256);
      const context = $('#accepted-document-context');
      context.hidden = false;
      context.textContent = `${file.technicalDocument.documentType} · ${handoff.observedElementIds.length} elementos observados. ${handoff.explanation} Falta: ${handoff.missing.join('; ')}.`;
      status(`Documento aceite associado. Preparação ${handoff.state}; serão necessários tracing, escala e confirmação. Nenhuma geometria foi gerada automaticamente.`);
    } else if (file.technicalDocumentRef) status('Documento aceite associado à imagem original, mas o conteúdo técnico estruturado não está disponível. Trace paredes e confirme escala explicitamente.');
    await clearSpatialSourceImage();
  }).catch((error: unknown) => status(`Não foi possível recuperar a imagem local: ${error instanceof Error ? error.message : 'erro de armazenamento'}`));
}
new GLTFLoader().load('/assets/architectural_library.glb', (gltf) => {
  libraryRoot = gltf.scene; assets = {
    wall_ext_3000: assetByName(libraryRoot, 'wall_ext_3000'),
    partition_int_3000: assetByName(libraryRoot, 'partition_int_3000'),
    door_single_900: assetByName(libraryRoot, 'door_single_900'),
    window_double_1200: assetByName(libraryRoot, 'window_double_1200'),
    connector_corner_90: assetByName(libraryRoot, 'connector_corner_90'),
    connector_isolated_foot: assetByName(libraryRoot, 'connector_isolated_foot'),
    mechanical_frame_1000: assetByName(libraryRoot, 'mechanical_frame_1000'),
  };
  assetReady = Object.keys(ARCHITECTURAL_MODULE_DIMENSIONS).every((name) => Boolean(assets[name as keyof ArchitecturalAssets]));
  $('#add-module').disabled = !assetReady || !transaction;
    if (assetReady) { status(transaction ? 'Biblioteca Blender carregada; activos parede, porta e janela.' : 'Cena vazia. Biblioteca Blender pronta: parede, porta e janela.'); if (transaction) renderModel(); else invalidate(); }
}, undefined, () => { assetReady = false; status('Biblioteca Blender indisponível; a geometria paramétrica Three.js permanece disponível.'); });

// A single demand-driven render loop is kept alive only while camera damping is active.
void assetReady;
unregisterSpatialCommands = registerSpatialCommandHandler(handleSpatialCommand);
return cleanup;
}
