import { Mesh, MeshPhysicalMaterial, Raycaster, Vector2, WebGLRenderer, type Group } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { compileSpatialPlanV2, disposeCompiledSpatialPlan } from './geometry-compiler-v2';
import { applySpatialOperationV2, type GeometryNodeV2, type SpatialOperationV2, type SpatialPlanV2 } from './contracts-v2';
import { analyzeAssembly, describeDefect, refineAssembly, type AssemblyAnalysis } from './assembly-analysis';
import { createSpatialPlanV2, evaluateSpatialPlanV2, refineSpatialPlanV2, type SpatialPlanV2Reply } from './api-client';
import { SHOT_DIRECTIONS, type FramingShotId } from './framing';
import { createStageV2, type StageV2 } from './stage-v2';
import type { FittedPose } from './framing';
import './harness.css';
import './harness-v2.css';

type Pending = { label: string; before: string; after: string; operations: SpatialOperationV2[]; needsAuthorization: boolean };
type DebugApi = { setShot(id: FramingShotId): void; setContentVisible(visible: boolean): void; setShadows(enabled: boolean): void; captureVerified(): { verdict: unknown; analysis: unknown; dataUrlBytes: number }; selectComponent(id: string): void; stats(): unknown };
type HarnessWindow = Window & { unfoldSpatialPlanV2?: unknown; unfoldSpatialStatsV2?: unknown; unfoldSpatialEvaluationV2?: unknown; unfoldLoadSpatialPlanV2?: (value: SpatialPlanV2Reply) => void; unfoldV2Debug?: DebugApi };

const SHOT_LABELS: Record<FramingShotId, string> = { hero: '3/4', px: '+X', nx: '−X', pz: '+Z', nz: '−Z', top: 'Top' };
const CONFIRMED = new Set(['observed', 'user_provided']);

function shapeKeys(node: GeometryNodeV2): string[] { return node.type === 'shape' ? [node.key] : node.children.flatMap(shapeKeys); }

export function mountUniversalSpatialV2Harness(root: HTMLElement): void {
  root.innerHTML = `<main class="us-harness"><header><div><p>UNFOLD / ENGINE LAB</p><h1>Spatial compiler V2</h1></div><span>Technical harness · conceptual geometry only</span></header>
<section class="us-controls"><label>Describe an object<textarea id="v2-prompt" rows="2">Build a compact desktop wind turbine with a tower, nacelle, hub and three curved blades.</textarea></label>
<div class="us-actions"><button id="v2-build">Generate with Meta</button><label class="us-file">Or analyse an image<input id="v2-image" type="file" accept="image/png,image/jpeg,image/webp"></label><button id="v2-evaluate" disabled>Evaluate rendered view</button><button id="v2-refine" disabled>Apply pending refinement</button><output id="v2-status">No source submitted.</output></div></section>
<section class="us-work"><div class="us-view"><div id="v2-canvas"></div><div id="v2-shots" role="toolbar" aria-label="Camera"></div><div id="v2-timeline"><label>Construction reveal <input id="v2-step" type="range" min="0" value="100"></label><span id="v2-step-label">Ready</span></div></div>
<aside><h2>Inspector</h2><p id="v2-summary">Awaiting a validated plan.</p>
<h3>Components</h3><ul id="v2-components"></ul>
<h3>Assembly check</h3><div id="v2-assembly"><p>No plan.</p></div><div class="us-row"><button id="v2-fix" disabled>Close gaps (solver)</button><button id="v2-undo" disabled>Undo</button></div>
<h3>Selected</h3><div id="v2-modify" hidden><div class="us-row"><button data-edit="scale-down">Smaller</button><button data-edit="scale-up">Larger</button><button data-edit="x-">−X</button><button data-edit="x+">+X</button><button data-edit="y-">−Y</button><button data-edit="y+">+Y</button><button data-edit="z-">−Z</button><button data-edit="z+">+Z</button></div>
<div class="us-row"><label>Colour <input id="v2-colour" type="color" value="#888888"></label><label><input id="v2-isolate" type="checkbox"> Isolate</label><button id="v2-frame-sel">Frame</button></div>
<div id="v2-pending" hidden><p id="v2-pending-text"></p><label id="v2-auth-label" hidden><input id="v2-auth" type="checkbox"> I authorise changing a confirmed or observed value</label><div class="us-row"><button id="v2-apply">Apply</button><button id="v2-cancel">Cancel</button></div></div></div>
<pre id="v2-detail">Select a component.</pre></aside></section>
<footer>Hierarchical plans · fixed geometry allowlist · quality estimates are hypotheses, not engineering certification</footer></main>`;
  const $ = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const host = $('#v2-canvas'), status = $<HTMLOutputElement>('#v2-status'), win = window as HarnessWindow;
  const renderer = new WebGLRenderer({ antialias: true, alpha: false }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); host.appendChild(renderer.domElement);
  const stage: StageV2 = createStageV2(renderer);
  const controls = new OrbitControls(stage.camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = 0.08;

  let reply: SpatialPlanV2Reply | undefined, plan: SpatialPlanV2 | undefined, compiledRoot: Group | undefined, analysis: AssemblyAnalysis | undefined;
  let selectedId: string | null = null, pending: Pending | null = null; const history: SpatialPlanV2[] = [];
  let animation: { from: FittedPose; to: FittedPose; start: number } | null = null;

  const currentPose = (): FittedPose => ({ position: stage.camera.position.toArray() as [number, number, number], target: controls.target.toArray() as [number, number, number], fov: stage.camera.fov, near: stage.camera.near, far: stage.camera.far, distance: stage.camera.position.distanceTo(controls.target) });
  const applyPose = (pose: FittedPose) => { stage.setPose(pose); controls.target.set(...pose.target); controls.update(); };
  const goTo = (pose: FittedPose, animate = true) => { if (!animate) { animation = null; applyPose(pose); return; } animation = { from: currentPose(), to: pose, start: performance.now() }; };
  const resize = () => { const rect = host.getBoundingClientRect(); if (rect.width < 2 || rect.height < 2) return; stage.resize(rect.width, rect.height); };
  new ResizeObserver(resize).observe(host); resize();
  const frameLoop = () => {
    requestAnimationFrame(frameLoop);
    if (animation) { const u = (performance.now() - animation.start) / 700; stage.transition(animation.from, animation.to, u); controls.target.set(...animation.to.target); if (u >= 1) { applyPose(animation.to); animation = null; } }
    controls.update(); stage.render();
  };
  frameLoop();

  const shots = $('#v2-shots');
  for (const id of Object.keys(SHOT_DIRECTIONS) as FramingShotId[]) { const button = document.createElement('button'); button.textContent = SHOT_LABELS[id]; button.dataset.shot = id; button.onclick = () => { if (plan) goTo(stage.poseFor(id)); }; shots.append(button); }

  const reveal = (step: number) => {
    const max = reply?.constructionEvents.length ?? 0;
    stage.contentRoot.traverse((object) => { const id = object.userData.spatialEntityId; if (id && object.userData.spatialComponentRoot) { const index = reply?.constructionEvents.findIndex((event) => (event as { entityId?: string }).entityId === id) ?? 0; object.visible = index < 0 || index < step; } });
    $('#v2-step-label').textContent = step >= max ? 'Assembly ready' : `Construction step ${step} / ${max}`;
  };
  const paintSelection = () => {
    const isolate = $<HTMLInputElement>('#v2-isolate').checked;
    stage.contentRoot.traverse((object) => {
      if (object instanceof Mesh && object.material instanceof MeshPhysicalMaterial) {
        const mine = object.userData.spatialEntityId === selectedId; object.material.emissive.set(mine ? '#5d4524' : '#000000');
        object.visible = !(isolate && selectedId && !mine);
      }
    });
  };
  const select = (id: string | null) => {
    selectedId = id; pending = null; $('#v2-pending').hidden = true; paintSelection();
    const component = plan?.components.find((item) => item.id === id);
    $('#v2-modify').hidden = !component;
    $('#v2-detail').textContent = component ? JSON.stringify(component, null, 2) : 'Select a component.';
    if (component) { const first = shapeKeys(component.geometry)[0]; const node = first ? findShape(component.geometry, first) : undefined; if (node) $<HTMLInputElement>('#v2-colour').value = node.material.color.toLowerCase(); }
  };
  const findShape = (node: GeometryNodeV2, key: string): Extract<GeometryNodeV2, { type: 'shape' }> | undefined => node.type === 'shape' ? (node.key === key ? node : undefined) : node.children.map((child) => findShape(child, key)).find(Boolean);

  const renderAssemblyPanel = () => {
    const panel = $('#v2-assembly'); panel.replaceChildren();
    if (!analysis) { panel.textContent = 'No plan.'; return; }
    const lines = analysis.defects.length ? analysis.defects.map(describeDefect) : ['No floating, detached or tiny components found (bounding-box check, not a contact proof).'];
    for (const line of lines) { const p = document.createElement('p'); p.textContent = line; panel.append(p); }
    $<HTMLButtonElement>('#v2-fix').disabled = !analysis.defects.some((d) => d.kind === 'floating' && !('blockedBy' in d && d.blockedBy));
    $<HTMLButtonElement>('#v2-undo').disabled = history.length === 0;
  };
  const build = (next: SpatialPlanV2, keepSelection = false) => {
    if (compiledRoot) { stage.clearAssembly(); disposeCompiledSpatialPlan(compiledRoot); }
    plan = next; const compiled = compileSpatialPlanV2(next); compiledRoot = compiled.root; stage.setAssembly(compiledRoot); controls.target.set(...currentPose().target); applyPose(stage.poseFor('hero'));
    try { analysis = analyzeAssembly(next); } catch { analysis = undefined; }
    const ops = new Set<string>(); const collect = (node: GeometryNodeV2) => { if (node.type === 'group') node.children.forEach(collect); else ops.add(node.operator); }; next.components.forEach((component) => collect(component.geometry));
    $('#v2-summary').textContent = `${next.title} · ${next.components.length} components · ${compiled.stats.nodeCount} geometry nodes · ${[...ops].join(', ')} · ${compiled.stats.triangleCount} triangles${history.length ? ` · ${history.length} local edit(s)` : ''}`;
    const list = $<HTMLUListElement>('#v2-components'); list.replaceChildren();
    for (const item of next.components) {
      const li = document.createElement('li'), button = document.createElement('button');
      const generic = /Parameter repair|Local safe fallback/.test(item.provenance.evidence) ? ' · approximated' : '';
      button.textContent = `${item.label} · ${item.provenance.geometry}${generic}`; button.dataset.id = item.id; button.onclick = () => { select(item.id); goTo(stage.poseFor({ componentIds: [item.id] })); }; li.append(button); list.append(li);
    }
    const slider = $<HTMLInputElement>('#v2-step'); slider.max = String(reply?.constructionEvents.length ?? 0); slider.value = slider.max; reveal(Number(slider.value));
    win.unfoldSpatialPlanV2 = reply; win.unfoldSpatialStatsV2 = compiled.stats;
    $<HTMLButtonElement>('#v2-evaluate').disabled = false; $<HTMLButtonElement>('#v2-refine').disabled = true;
    renderAssemblyPanel(); select(keepSelection && selectedId && next.components.some((c) => c.id === selectedId) ? selectedId : null);
  };
  const paint = (next: SpatialPlanV2Reply) => { reply = next; history.length = 0; build(next.plan); };
  win.unfoldLoadSpatialPlanV2 = paint;

  $<HTMLInputElement>('#v2-step').addEventListener('input', (event) => reveal(Number((event.target as HTMLInputElement).value)));
  $<HTMLInputElement>('#v2-isolate').addEventListener('change', paintSelection);
  $('#v2-frame-sel').onclick = () => { if (selectedId) goTo(stage.poseFor({ componentIds: [selectedId] })); };
  renderer.domElement.addEventListener('pointerdown', (event) => {
    if (!plan) return; const rect = renderer.domElement.getBoundingClientRect();
    const point = new Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1), ray = new Raycaster(); ray.setFromCamera(point, stage.camera);
    const hit = ray.intersectObjects(stage.contentRoot.children, true).find((item) => item.object.userData.spatialEntityId); if (hit) select(hit.object.userData.spatialEntityId as string);
  });

  // Assembly solver: proposals through the typed operation contract, undoable.
  $('#v2-fix').onclick = () => {
    if (!plan) return; const result = refineAssembly(plan);
    if (!result.applied.length) { status.textContent = 'Nothing the solver may close.'; return; }
    history.push(plan); build(result.plan, true);
    status.textContent = `Assembly solver closed ${result.applied.length} gap(s) in ${result.iterations} iteration(s); positions are marked inferred. Bounding-box check only.`;
  };
  $('#v2-undo').onclick = () => { const previous = history.pop(); if (previous) { build(previous, true); status.textContent = 'Last edit undone.'; } };

  // Human edits: preview first, commit only on Apply; confirmed/observed values need an explicit authorisation.
  const propose = (label: string, builder: (component: SpatialPlanV2['components'][number], step: number) => { operations: SpatialOperationV2[]; before: string; after: string }) => {
    const component = plan?.components.find((item) => item.id === selectedId); if (!plan || !component) return;
    const step = (analysis?.span ?? 1) * 0.05, built = builder(component, step);
    pending = { label, before: built.before, after: built.after, operations: built.operations, needsAuthorization: CONFIRMED.has(component.provenance.transform) || CONFIRMED.has(component.provenance.geometry) };
    $('#v2-pending').hidden = false; $('#v2-pending-text').textContent = `${label}: ${built.before} → ${built.after}${pending.needsAuthorization ? ' (touches a confirmed or observed value)' : ''}`;
    $('#v2-auth-label').hidden = !pending.needsAuthorization; $<HTMLInputElement>('#v2-auth').checked = false;
  };
  const opId = (kind: string) => `edit-${kind}-${Date.now().toString(36)}`.slice(0, 80);
  const transformOp = (component: SpatialPlanV2['components'][number], value: SpatialPlanV2['components'][number]['transform'], kind: string): SpatialOperationV2 => ({ contract: 'unfold.spatial-operation.v2', operationId: opId(kind), kind: 'set-transform', componentId: component.id, nodeKey: null, value });
  const fmt = (v: number[]) => `[${v.map((n) => n.toFixed(3)).join(', ')}]`;
  root.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach((button) => {
    button.onclick = () => {
      const code = button.dataset.edit!;
      propose(button.textContent ?? code, (component, step) => {
        if (code.startsWith('scale')) { const factor = code === 'scale-up' ? 1.1 : 1 / 1.1, next = component.transform.scale.map((n) => n * factor) as [number, number, number]; return { operations: [transformOp(component, { ...component.transform, scale: next }, 'scale')], before: `scale ${fmt(component.transform.scale)}`, after: `scale ${fmt(next)}` }; }
        const axis = 'xyz'.indexOf(code[0]!), sign = code[1] === '+' ? 1 : -1, position = [...component.transform.position] as [number, number, number]; position[axis] = Math.round((position[axis]! + sign * step) * 1e6) / 1e6;
        return { operations: [transformOp(component, { ...component.transform, position }, 'move')], before: `position ${fmt(component.transform.position)}`, after: `position ${fmt(position)}` };
      });
    };
  });
  $<HTMLInputElement>('#v2-colour').addEventListener('change', (event) => {
    const colour = (event.target as HTMLInputElement).value;
    propose('Colour', (component) => {
      const keys = shapeKeys(component.geometry), first = findShape(component.geometry, keys[0]!)!;
      return { operations: keys.map((key) => ({ contract: 'unfold.spatial-operation.v2' as const, operationId: opId(`colour-${key}`), kind: 'set-material' as const, componentId: component.id, nodeKey: key, value: { ...findShape(component.geometry, key)!.material, color: colour } })), before: first.material.color, after: colour };
    });
  });
  $('#v2-cancel').onclick = () => { pending = null; $('#v2-pending').hidden = true; };
  $('#v2-apply').onclick = () => {
    if (!plan || !pending) return;
    if (pending.needsAuthorization && !$<HTMLInputElement>('#v2-auth').checked) { status.textContent = 'This edit touches a confirmed or observed value: tick the authorisation first.'; return; }
    try {
      let next = plan; for (const operation of pending.operations) next = applySpatialOperationV2(next, operation, { origin: 'user_provided', evidence: 'Edited by a person in the V2 harness (client-asserted, not authenticated).' });
      history.push(plan); const keep = selectedId; build(next, true); select(keep); status.textContent = `Applied: ${pending?.label ?? 'edit'}. Local only: the server session is not updated.`;
      $<HTMLButtonElement>('#v2-refine').disabled = true;
    } catch (error) { status.textContent = `Edit blocked: ${error instanceof Error ? error.message : 'Unknown error'}`; }
  };

  // Paid calls.
  $('#v2-build').onclick = async () => { try { status.textContent = 'Meta is constructing a bounded V2 plan…'; const next = await createSpatialPlanV2({ sourceKind: 'text', instruction: $<HTMLTextAreaElement>('#v2-prompt').value, maxRefinements: 1 }); paint(next); status.textContent = `Live ${String(next.meta.model)} · ${String(next.meta.requestId)} · ${String(next.meta.latencyMs)} ms · $${String(next.meta.estimatedCostUsd)}`; } catch (error) { status.textContent = `Blocked: ${error instanceof Error ? error.message : 'Unknown error'}`; } };
  $<HTMLInputElement>('#v2-image').onchange = async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return; if (file.size > 10 * 1024 * 1024) { status.textContent = 'Image exceeds the 10 MiB harness limit.'; return; }
    try {
      const imageDataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(reader.error); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(file); });
      status.textContent = 'Meta is analysing visible image evidence; physical scale remains unknown.';
      const next = await createSpatialPlanV2({ sourceKind: 'image', imageDataUrl, maxRefinements: 1 }); paint(next); status.textContent = `Live ${String(next.meta.model)} · ${String(next.meta.requestId)} · ${String(next.meta.latencyMs)} ms · $${String(next.meta.estimatedCostUsd)} · physical scale unknown`;
    } catch (error) { status.textContent = `Blocked: ${error instanceof Error ? error.message : 'Unknown error'}`; }
  };
  $('#v2-evaluate').onclick = async () => {
    if (!reply || !plan) return;
    const capture = stage.captureVerified(), { analysis: frame, verdict } = capture;
    win.unfoldV2LastCapture = { verdict, analysis: frame };
    if (!verdict.ok) { status.textContent = `Capture rejected (${verdict.problems.join(', ')}): object covers ${(frame.extentFraction * 100).toFixed(0)}% of the frame. Nothing was sent to Meta.`; return; }
    try {
      status.textContent = `Verified capture (object fills ${(frame.extentFraction * 100).toFixed(0)}% of the frame). Meta is evaluating it; scores are hypotheses.`;
      const result = await evaluateSpatialPlanV2({ sessionId: reply.sessionId, baseRevision: reply.revision, imageDataUrl: capture.dataUrl, plan });
      win.unfoldSpatialEvaluationV2 = result.evaluation; $<HTMLButtonElement>('#v2-refine').disabled = result.suggestionStatus !== 'pending' || history.length > 0;
      status.textContent = `Visual hypothesis · recognizability ${result.evaluation.recognizabilityScore}/100 · silhouette ${result.evaluation.silhouetteScore}/100 · spatial integrity ${result.evaluation.spatialIntegrityScore}/100 · $${String(result.meta.estimatedCostUsd)} · ${result.suggestionStatus}${history.length ? ' · local edits are not in the server session' : ''}`;
    } catch (error) { status.textContent = `Evaluation blocked: ${error instanceof Error ? error.message : 'Unknown error'}`; }
  };
  $('#v2-refine').onclick = async () => {
    if (!reply) return;
    try { status.textContent = 'Applying the pending bounded operation…'; const revised = await refineSpatialPlanV2({ sessionId: reply.sessionId, baseRevision: reply.revision }); reply = { ...reply, revision: revised.revision, plan: revised.plan, constraintReport: revised.constraintReport }; history.length = 0; build(revised.plan); status.textContent = 'One bounded proposal applied; rebuild and compare before accepting any quality claim.'; }
    catch (error) { status.textContent = `Refinement blocked: ${error instanceof Error ? error.message : 'Unknown error'}`; }
  };

  win.unfoldV2Debug = {
    setShot: (id) => { goTo(stage.poseFor(id), false); },
    setContentVisible: (visible) => stage.setContentVisible(visible),
    setShadows: (enabled) => stage.setShadows(enabled),
    captureVerified: () => { const c = stage.captureVerified(); return { verdict: c.verdict, analysis: c.analysis, dataUrlBytes: c.dataUrl.length }; },
    selectComponent: (id) => select(id),
    stats: () => ({ cameraDistance: currentPose().distance, selectedId, analysis: analysis ? { span: analysis.span, islands: analysis.islands.length, defects: analysis.defects } : null, history: history.length }),
  };
}

declare global { interface Window { unfoldV2LastCapture?: unknown } }
