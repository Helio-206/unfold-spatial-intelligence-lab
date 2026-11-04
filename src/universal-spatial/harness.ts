import { AmbientLight, Box3, Color, DirectionalLight, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, Raycaster, Scene, Vector2, Vector3, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { disposeSpatialPlan, spatialPlanToThree } from './three-adapter';
import type { SpatialPlan } from './contracts';
import './harness.css';

export function mountUniversalSpatialHarness(root: HTMLElement): void {
  root.innerHTML = `<main class="us-harness"><header><div><p>UNFOLD / ENGINE LAB</p><h1>Spatial plan harness</h1></div><span>Prototype · no physical simulation</span></header><section class="us-controls"><label>Describe a scene<textarea id="us-prompt" rows="2">Build a small robotic arm with a base, three articulated segments and a magnetic end effector.</textarea></label><div class="us-actions"><button id="us-build">Generate with Meta</button><label class="us-file">Or analyse an image<input id="us-image" type="file" accept="image/png,image/jpeg,image/webp"></label></div><output id="us-status">No source submitted.</output></section><section class="us-work"><div class="us-view"><div id="us-canvas"></div><div id="us-timeline"><label>Construction reveal <input id="us-step" type="range" min="0" value="100"></label><span id="us-step-label">Ready</span></div></div><aside><h2>Inspector</h2><p id="us-summary">Submit text or an image to create a plan.</p><ul id="us-entities"></ul><pre id="us-detail">Select a component in the scene or list.</pre></aside></section><footer>Declarative primitives · bounded plans · image scale is unknown without a reference</footer></main>`;
  const canvasHost = root.querySelector<HTMLElement>('#us-canvas')!;
  const scene = new Scene(); scene.background = new Color('#101416');
  const camera = new PerspectiveCamera(42, 1, 0.01, 1000); camera.position.set(3, 2.5, 4);
  const renderer = new WebGLRenderer({ antialias: true, alpha: false }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.outputColorSpace = 'srgb'; canvasHost.appendChild(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
  scene.add(new AmbientLight(0xffffff, 1.5)); const key = new DirectionalLight(0xffeed8, 3); key.position.set(4, 7, 5); scene.add(key);
  const planRoot = new Group(); scene.add(planRoot);
  let plan: SpatialPlan | undefined;
  const resize = () => { const rect = canvasHost.getBoundingClientRect(); renderer.setSize(rect.width, rect.height); camera.aspect = rect.width / Math.max(1, rect.height); camera.updateProjectionMatrix(); };
  new ResizeObserver(resize).observe(canvasHost); resize();
  const render = () => { requestAnimationFrame(render); controls.update(); renderer.render(scene, camera); }; render();
  const status = root.querySelector<HTMLOutputElement>('#us-status')!;
  const paintPlan = (next: SpatialPlan, sessionId?: string, revision = 0) => {
    for (const child of [...planRoot.children]) { planRoot.remove(child); disposeSpatialPlan(child as Group); }
    plan = next; const group = spatialPlanToThree(next); planRoot.add(group);
    const bounds = new Box3().setFromObject(group); const center = bounds.getCenter(new Vector3()), size = bounds.getSize(new Vector3());
    controls.target.copy(center); camera.position.copy(center).add(new Vector3(Math.max(size.x, size.y, size.z) * 1.9 + 1, size.y * 1.2 + 1, Math.max(size.x, size.y, size.z) * 1.9 + 1)); controls.update();
    root.querySelector<HTMLElement>('#us-summary')!.textContent = `${next.title} · ${next.entities.length} components · ${next.units} · source ${next.source.kind}/${next.source.sha256.slice(0, 12)}`;
    const list = root.querySelector<HTMLUListElement>('#us-entities')!; list.replaceChildren();
    for (const entity of next.entities) { const li = document.createElement('li'), button = document.createElement('button'); button.textContent = `${entity.label} · ${entity.origin}`; button.onclick = () => select(entity.id); li.append(button); list.append(li); }
    root.querySelector<HTMLInputElement>('#us-step')!.max = String(next.entities.length + 2); reveal(Number(root.querySelector<HTMLInputElement>('#us-step')!.value));
    (window as Window & { unfoldSpatialPlan?: SpatialPlan }).unfoldSpatialPlan = next;
    (window as Window & { unfoldSpatialSession?: { sessionId?: string; revision: number } }).unfoldSpatialSession = { sessionId, revision };
    (window as Window & { unfoldLoadSpatialPlan?: (value: SpatialPlan) => void }).unfoldLoadSpatialPlan = paintPlan;
  };
  const select = (id: string) => { if (!plan) return; planRoot.traverse((object) => { const entityId = object.userData.spatialEntityId; if (object instanceof Mesh) { const material = object.material as MeshStandardMaterial; material.emissive.set(entityId === id ? '#6d4b19' : '#000000'); } }); const entity = plan.entities.find((item) => item.id === id)!; root.querySelector<HTMLElement>('#us-detail')!.textContent = JSON.stringify({ ...entity, provenance: { origin: entity.origin, evidence: entity.evidence } }, null, 2); };
  const reveal = (step: number) => { const order = new Map((plan?.entities ?? []).map((entity, i) => [entity.id, i])); planRoot.traverse((object) => { if (typeof object.userData.spatialEntityId === 'string') object.visible = (order.get(object.userData.spatialEntityId) ?? 0) < Math.max(0, step - 1); }); root.querySelector<HTMLElement>('#us-step-label')!.textContent = step > (plan?.entities.length ?? 0) ? 'Assembly ready · reveal' : `Placed ${Math.max(0, step - 1)} / ${plan?.entities.length ?? 0}`; };
  root.querySelector<HTMLInputElement>('#us-step')!.addEventListener('input', (event) => reveal(Number((event.target as HTMLInputElement).value)));
  renderer.domElement.addEventListener('pointerdown', (event) => { if (!plan) return; const rect = renderer.domElement.getBoundingClientRect(); const pointer = new Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1); const ray = new Raycaster(); ray.setFromCamera(pointer, camera); const hit = ray.intersectObjects(planRoot.children, true).find((item) => item.object.userData.spatialEntityId); if (hit) select(hit.object.userData.spatialEntityId as string); });
  root.querySelector<HTMLButtonElement>('#us-build')!.onclick = async () => {
    const instruction = root.querySelector<HTMLTextAreaElement>('#us-prompt')!.value;
    try { status.textContent = 'Meta is interpreting the request…'; const response = await fetch('/api/spatial/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceKind: 'text', instruction }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error?.message ?? `HTTP ${response.status}`); paintPlan(payload.plan, payload.sessionId, payload.revision); status.textContent = `Live ${payload.meta.model} · ${payload.meta.requestId ?? 'no request id'} · ${payload.meta.latencyMs} ms · $${payload.meta.estimatedCostUsd ?? 'n/a'} · ${payload.plan.entities.length} entities`; }
    catch (error) { status.textContent = `Blocked: ${error instanceof Error ? error.message : 'Unknown error'}`; }
  };
  root.querySelector<HTMLInputElement>('#us-image')!.onchange = async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return;
    if (file.size > 10 * 1024 * 1024) { status.textContent = 'Image exceeds the 10 MiB harness limit.'; return; }
    try { status.textContent = 'Meta is analysing the image…'; const imageDataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(reader.error); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(file); }); const response = await fetch('/api/spatial/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceKind: 'image', imageDataUrl }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error?.message ?? `HTTP ${response.status}`); paintPlan(payload.plan, payload.sessionId, payload.revision); status.textContent = `Live ${payload.meta.model} · ${payload.meta.requestId ?? 'no request id'} · ${payload.meta.latencyMs} ms · $${payload.meta.estimatedCostUsd ?? 'n/a'} · scale unknown`; }
    catch (error) { status.textContent = `Blocked: ${error instanceof Error ? error.message : 'Unknown error'}`; }
  };
}
