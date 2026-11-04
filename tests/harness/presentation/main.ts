/**
 * REFERENCE HOST for the Presentation Director (test and evidence only; not product code, not a second workspace).
 *
 * It mounts the real `SpatialWorkspace` (renderer, camera, lights, contact shadow, selection, inspector) and the real `PlanSpaceLayer` of PR #25, and wires the
 * Director exactly as `src/living/spatial-presentation/API.md` describes: `requestRender` -> `workspace.redraw`, a frame loop calling `update(dt)`, cues
 * turned into camera moves. The workspace's camera director is private today, so this host animates cues with `workspace.setView` frame by frame; the
 * Terminal should instead go through the camera arbiter (see "API needs from the workspace" in the PR).
 *
 * Query: fixture=<name> (JSON under /reports/visual-recovery/fixtures), rm=1 reduced motion, auto=1 play the entrance on load, mode=excavator (Foundry reference).
 */
import '../../../src/brand.css';
import { EXCAVATOR_ASSEMBLY_V1 } from '../../../src/living/contracts/fixtures/excavator.assembly.v1';
import { createStudioEnvironment } from '../../../src/living/cinema/studio-environment';
import { SpatialWorkspace } from '../../../src/living/workspace-design/workspace';
import { PlanSpaceLayer } from '../../../src/living/spatial-space/layer';
import { validateSpatialPlanV2 } from '../../../src/universal-spatial/contracts-v2';
import { createPresentationDirector, type CameraCue, type CueView, type PresentationDirector, type PresentationState } from '../../../src/living/spatial-presentation';

const q = new URLSearchParams(location.search);
document.body.style.margin = '0';
const app = document.querySelector<HTMLElement>('#app')!;
const rm = q.has('rm') ? q.get('rm') === '1' : undefined;
const ws = new SpatialWorkspace(app, { assembly: EXCAVATOR_ASSEMBLY_V1, agent: { mode: 'fixture' }, reducedMotion: rm, preserveDrawingBuffer: true, look: 'premium', premiumEnvironment: createStudioEnvironment, startEmpty: Boolean(q.get('fixture')) });
ws.renderNow();

type Api = { ws: SpatialWorkspace; director: PresentationDirector | null; layer: PlanSpaceLayer | null; cues: CameraCue[]; states: PresentationState[]; ready: Promise<void> };
const api: Api = { ws, director: null, layer: null, cues: [], states: [], ready: Promise.resolve() };
Object.assign(window, { __present: api });

// --- cue animation (reference only) -------------------------------------------------------------------------------
let lastView: CueView | null = null, anim: { from: CueView; to: CueView; t: number; duration: number } | null = null;
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
function onCue(cue: CameraCue): void {
  api.cues.push(cue);
  if (cue.durationMs === 0 || !lastView) { anim = null; ws.setView(cue.view); lastView = cue.view; return; }
  anim = { from: lastView, to: cue.view, t: 0, duration: cue.durationMs };
}
function stepCamera(dt: number): void {
  if (!anim) return;
  anim.t += dt; const k = ease(Math.min(1, anim.t / anim.duration)), { from, to } = anim;
  let da = to.azimuthDeg - from.azimuthDeg; da = ((da + 540) % 360) - 180;
  const view: CueView = { target: [0, 1, 2].map((i) => lerp(from.target[i]!, to.target[i]!, k)) as [number, number, number], azimuthDeg: from.azimuthDeg + da * k, elevationDeg: lerp(from.elevationDeg, to.elevationDeg, k), distance: lerp(from.distance, to.distance, k) };
  ws.setView(view); lastView = view; if (anim.t >= anim.duration) { lastView = to; anim = null; }
}

const viewContext = () => ({ viewport: { width: app.clientWidth || innerWidth, height: app.clientHeight || innerHeight }, insets: { ...((ws as unknown as { currentInsets: { top: number; right: number; bottom: number; left: number } }).currentInsets) }, baseFovDeg: 30 });

// --- the space --------------------------------------------------------------------------------------------------------
const fixture = q.get('fixture');
const hud = document.createElement('div');
hud.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:50;display:flex;gap:6px;flex-wrap:wrap;font:12px/1.3 system-ui;max-width:60vw';
const readout = document.createElement('div');
readout.style.cssText = 'position:fixed;left:50%;top:70px;transform:translateX(-50%);z-index:50;font:12px/1.4 ui-monospace,monospace;color:#f3f0e8;background:rgba(16,20,24,.82);padding:6px 12px;border-radius:8px;max-width:70vw;display:none;text-align:center';
document.body.append(hud, readout);
const button = (act: string, label: string, run: () => void) => { const b = document.createElement('button'); b.textContent = label; b.dataset.act = act; b.style.cssText = 'font:inherit;padding:6px 10px;border-radius:8px;border:1px solid #3a4547;background:#172023;color:#e8e7e2;cursor:pointer'; b.onclick = run; hud.append(b); };

if (fixture) {
  api.ready = (async () => {
    const reply = await (await fetch(`/reports/visual-recovery/fixtures/${fixture}.json`)).json();
    const plan = validateSpatialPlanV2(reply.plan);
    const layer = new PlanSpaceLayer(plan, { changed: () => ws.spaceChanged(), redraw: () => ws.redraw(), notify: () => undefined });
    api.layer = layer;
    ws.showSpace(layer, { brandLabel: `espaço · ${plan.title}`, notices: [{ id: 'fixture', text: 'Fixture manual (não é saída da Meta) · visualização' }] });
    if (q.get('director') !== '0') {
      const director = createPresentationDirector({
        plan, root: layer.root, requestRender: () => ws.redraw(), onCue, onState: (s) => { api.states.push(s); readout.style.display = s.notice ? 'block' : 'none'; readout.textContent = s.notice ?? ''; },
        reducedMotion: rm === undefined ? 'auto' : rm, view: viewContext(),
      });
      api.director = director;
      // The Director needs the usable area. The workspace keeps its insets private today (see "API needs from the workspace"), so this reference host reads them.
      addEventListener('resize', () => director.setViewContext(viewContext()));
      button('entrance', 'Entrada', () => { director.setViewContext(viewContext()); director.playEntrance(); }); button('tour', 'Percurso', () => director.startTour()); button('explode', 'Vista explodida', () => director.toggleExploded());
      button('focus', 'Focar', () => director.focus(director.state.focusId ? null : (api.ws.selectedSpaceId ?? director.sequence[1]?.componentId ?? null)));
      button('edit', 'Editar', () => (director.state.phase === 'editing' ? director.resumeExploring() : director.enterEditing()));
      if (q.get('auto') === '1') director.playEntrance();
    }
  })();
}

let last = performance.now();
let lastContext = '';
const loop = (now: number) => {
  const dt = Math.min(100, now - last); last = now;
  if (api.director) { const key = JSON.stringify(viewContext()); if (key !== lastContext) { lastContext = key; api.director.setViewContext(viewContext()); } } // usable area changes when panels open or close
  stepCamera(dt); api.director?.update(dt); requestAnimationFrame(loop);
};
requestAnimationFrame(loop);
