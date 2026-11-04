import { Box3, Color, Matrix3, Mesh, MeshPhysicalMaterial, Vector3, type Object3D } from 'three';
import type { SpatialPlanV2 } from '../../universal-spatial/contracts-v2';
import { collectWorldPoints, heroAzimuth } from '../../universal-spatial/framing';
import { establishingView, viewForBox } from './cues';
import { applyPresentationFinish, type FinishHandle } from './finish';
import { assemblySequence, explodeOffsets, measureComponents, pointsOfInterest, type Measures } from './structure';
import type { CueKind, CueView, PointOfInterest, PresentationDirector, PresentationOptions, PresentationPhase, PresentationState, PresentationTuning, SequenceHandle, SequenceStep, ViewContext } from './types';

/**
 * The Universal Spatial Presentation Director.
 *
 * It animates PRESENTATION state on objects it was given (visibility, a local offset of each component group, a colour/reflection multiplier) and asks the
 * host for camera moves through cues. There is no clock, timer, loop, renderer, scene or camera in here: the host calls `update(dtMs)` from its own
 * frame loop (the pattern of the Cinema's `CameraDirector`). Everything it touches is saved first and put back exactly.
 */
const DEFAULTS: PresentationTuning = { entranceMs: 5200, explodeMs: 900, explodeSpread: 0.45, dim: 0.32, maxPois: 8 };
const DEFAULT_VIEW: ViewContext = { viewport: { width: 1280, height: 800 }, insets: { top: 0, right: 0, bottom: 0, left: 0 }, baseFovDeg: 30 };
const EXPLODE_NOTICE = 'Vista explodida · visualização. As peças foram afastadas só para as mostrar; o objecto não se move assim.';
const FOCUS_MS = 240, TOUR_DWELL_MS = 2800, LEAD_MS = 500, SETTLE_MS = 400;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const easeOut = (u: number) => 1 - (1 - clamp01(u)) ** 3; // 'power3.out'
const easeInOut = (u: number) => { const x = clamp01(u); return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2; }; // 'power2.inOut'

type Node = { id: string; group: Object3D; parentId: string | null; pos: Vector3; scale: Vector3; visible: boolean; arrival: Vector3; explode: Vector3; meshes: Mesh[] };
type Bound = { plan: SpatialPlanV2; root: Object3D; nodes: Map<string, Node>; measures: Measures; steps: SequenceStep[]; pois: PointOfInterest[]; heroAz: number; chain: Map<string, string[]>; worldExplode: Map<string, Vector3> };
type Controller = { handle: SequenceHandle; finish(result: 'completed' | 'cancelled'): void; open: boolean };

function controller(onCancel: () => void): Controller {
  let resolve!: (r: 'completed' | 'cancelled') => void; const done = new Promise<'completed' | 'cancelled'>((r) => { resolve = r; });
  const c: Controller = { open: true, finish(result) { if (!c.open) return; c.open = false; resolve(result); }, handle: { done, cancel: () => { if (c.open) onCancel(); } } };
  return c;
}

export function createPresentationDirector(options: PresentationOptions): PresentationDirector {
  const tuning: PresentationTuning = { ...DEFAULTS, ...options.tuning };
  let view: ViewContext = options.view ?? DEFAULT_VIEW, disposed = false, editing = false, engaged = false, reduced = false, auto = false;
  let bound: Bound; let finishHandle: FinishHandle | null = null;
  let mediaQuery: { matches: boolean; addEventListener(type: string, fn: (e: { matches: boolean }) => void): void; removeEventListener(type: string, fn: (e: { matches: boolean }) => void): void } | null = null;
  let cueCounter = 0, lastPublished = '';

  // run state
  let entrance: { t: number; d: number; lead: number; stagger: number; total: number; starts: Map<string, number>; emitted: Set<string>; ctl: Controller } | null = null;
  let explodeAmount = 0, explodeRun: { from: number; to: number; t: number; duration: number } | null = null, explodeTarget = 0;
  let focusSet = new Set<string>(), focusId: string | null = null, focusMix = 0, focusTarget = 0;
  let tour: { index: number; dwell: number; manual: boolean; ctl: Controller | null } | null = null;
  const savedMaterials = new Map<MeshPhysicalMaterial, { color: Color; env: number }>();

  // ------------------------------------------------------------------------------------------------ binding
  function bind(plan: SpatialPlanV2, root: Object3D): Bound {
    root.updateMatrixWorld(true);
    const groups = new Map<string, Object3D>(); root.traverse((o) => { if (o.userData.spatialComponentRoot) groups.set(o.userData.spatialEntityId as string, o); });
    const measures = measureComponents(plan, root), steps = assemblySequence(plan, measures), pois = pointsOfInterest(plan, measures, steps, tuning.maxPois);
    const span = measures.span ?? 1, centre = measures.centre ?? new Vector3(), worldRel = explodeOffsets(plan, measures, 1, tuning.explodeSpread);
    const nodes = new Map<string, Node>(); const chain = new Map<string, string[]>(); const worldExplode = new Map<string, Vector3>();
    const parentMatrix = (parentId: string | null) => (parentId && groups.get(parentId) ? groups.get(parentId)!.matrixWorld : root.matrixWorld);
    const toLocal = (world: Vector3, parentId: string | null) => world.clone().applyMatrix3(new Matrix3().setFromMatrix4(parentMatrix(parentId)).invert());
    const ownMeshes = (group: Object3D) => { const out: Mesh[] = []; const walk = (o: Object3D) => { for (const child of o.children) { if (child.userData.spatialComponentRoot) continue; if (child instanceof Mesh) out.push(child); walk(child); } }; walk(group); return out; };
    const firstStep = steps[0]?.componentId;
    for (const component of plan.components) {
      const group = groups.get(component.id); if (!group) continue;
      const mine = measures.get(component.id);
      let arrivalWorld = new Vector3(0, 0.3 * span, 0);
      if (mine && component.id !== firstStep) {
        const out = mine.centre.clone().sub(centre); out.y = 0; const len = out.length();
        arrivalWorld = (len > span * 1e-6 ? out.divideScalar(len) : new Vector3(1, 0, 0)).multiplyScalar(0.22 * span).add(new Vector3(0, 0.28 * span, 0));
      }
      nodes.set(component.id, { id: component.id, group, parentId: component.parentId, pos: group.position.clone(), scale: group.scale.clone(), visible: group.visible, arrival: toLocal(arrivalWorld, component.parentId), explode: toLocal(worldRel.get(component.id) ?? new Vector3(), component.parentId), meshes: ownMeshes(group) });
    }
    for (const component of plan.components) { const ids: string[] = []; let cursor: string | null = component.id; while (cursor) { ids.push(cursor); cursor = plan.components.find((c) => c.id === cursor)?.parentId ?? null; } chain.set(component.id, ids); }
    for (const component of plan.components) worldExplode.set(component.id, (chain.get(component.id) ?? []).reduce((sum, id) => sum.add(worldRel.get(id) ?? new Vector3()), new Vector3()));
    const points = collectWorldPoints(root, 8000), heroAz = points.length ? heroAzimuth(points, [38, 128]) : 38;
    return { plan, root, nodes, measures, steps, pois, heroAz, chain, worldExplode };
  }
  bound = bind(options.plan, options.root);
  if (options.finish !== false) finishHandle = applyPresentationFinish(options.root);

  // ------------------------------------------------------------------------------------------------ reduced motion
  function attachMedia(): void {
    const mm = (globalThis as { matchMedia?: (q: string) => typeof mediaQuery }).matchMedia;
    if (!mm || mediaQuery) { return; }
    mediaQuery = mm('(prefers-reduced-motion: reduce)'); if (!mediaQuery) return;
    reduced = mediaQuery.matches; mediaQuery.addEventListener('change', onMedia);
  }
  const onMedia = (e: { matches: boolean }) => { if (auto) applyReduced(e.matches); };
  function detachMedia(): void { mediaQuery?.removeEventListener('change', onMedia); mediaQuery = null; }
  const optionReduced = options.reducedMotion ?? 'auto';
  if (optionReduced === 'auto') { auto = true; attachMedia(); } else reduced = optionReduced;

  function applyReduced(value: boolean): void {
    reduced = value; if (!value) { publish(); return; }
    // every running sequence completes at once
    if (entrance) completeEntrance();
    if (explodeRun) { explodeAmount = explodeRun.to; explodeRun = null; applyTransforms(); }
    if (focusMix !== focusTarget) { focusMix = focusTarget; if (focusMix === 0) focusSet = new Set(); applyDim(); }
    if (tour?.ctl) { tour.ctl.finish('completed'); tour.ctl = null; tour.manual = true; }
    options.requestRender(); publish();
  }

  // ------------------------------------------------------------------------------------------------ cues
  const boxOf = (ids: Iterable<string>, amount: number): Box3 => {
    const box = new Box3(); for (const id of ids) { const m = bound.measures.get(id); if (!m) continue; box.union(m.box.clone().translate((bound.worldExplode.get(id) ?? new Vector3()).clone().multiplyScalar(amount))); } return box;
  };
  const wholeBox = (amount = 0) => boxOf(bound.measures.keys(), amount);
  function cue(kind: CueKind, reason: string, viewFor: () => CueView, componentId: string | null = null, durationMs = 1100): void {
    if (!options.onCue || disposed) return;
    let v: CueView; try { v = viewFor(); } catch { return; }
    options.onCue({ id: `${kind}:${++cueCounter}`, kind, reason, view: v, durationMs: reduced ? 0 : durationMs, componentId, interruptible: true });
  }
  const overviewView = (azOffset = 0) => viewForBox(wholeBox(0), { azimuthDeg: bound.heroAz + azOffset, elevationDeg: 14, ctx: view, margin: 16 });

  // ------------------------------------------------------------------------------------------------ applying state to the objects
  function applyTransforms(): void {
    for (const n of bound.nodes.values()) {
      const start = entrance?.starts.get(n.id), u = entrance && start !== undefined ? easeOut((entrance.t - start) / entrance.d) : 1;
      if (explodeAmount === 0 && u === 1) { n.group.position.copy(n.pos); n.group.scale.copy(n.scale); n.group.visible = n.visible; continue; }
      n.group.position.copy(n.pos).addScaledVector(n.explode, explodeAmount).addScaledVector(n.arrival, 1 - u);
      if (u === 1) n.group.scale.copy(n.scale); else n.group.scale.copy(n.scale).multiplyScalar(0.9 + 0.1 * u);
      n.group.visible = entrance && start !== undefined ? n.visible && entrance.t >= start : n.visible;
    }
  }
  function applyDim(): void {
    for (const n of bound.nodes.values()) {
      const factor = focusMix === 0 || focusSet.has(n.id) ? 1 : 1 + (tuning.dim - 1) * focusMix;
      for (const mesh of n.meshes) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (!(material instanceof MeshPhysicalMaterial)) continue;
        let saved = savedMaterials.get(material); if (!saved) { saved = { color: material.color.clone(), env: material.envMapIntensity }; savedMaterials.set(material, saved); }
        if (factor === 1) { material.color.copy(saved.color); material.envMapIntensity = saved.env; } else { material.color.copy(saved.color).multiplyScalar(factor); material.envMapIntensity = saved.env * factor; }
      }
    }
    if (focusMix === 0) savedMaterials.clear();
  }
  /** Back to the planned state, exactly. */
  function restoreAll(): void {
    entrance = null; explodeRun = null; explodeAmount = 0; explodeTarget = 0; focusSet = new Set(); focusId = null; focusMix = 0; focusTarget = 0;
    applyTransforms(); applyDim();
  }

  // ------------------------------------------------------------------------------------------------ state
  function phase(): PresentationPhase {
    if (disposed) return 'disposed'; if (editing) return 'editing'; if (tour) return 'touring'; if (entrance) return 'entering'; if (explodeAmount > 0 || (explodeRun && explodeRun.to > 0)) return 'exploded';
    return engaged ? 'exploring' : 'idle';
  }
  function buildState(): PresentationState {
    const active: string[] = [];
    if (entrance) active.push('entrance offsets'); if (focusMix > 0) active.push('dim'); if (explodeAmount > 0 || explodeRun) active.push('exploded view'); if (finishHandle && finishHandle.applied > 0) active.push('PBR finish');
    const shown = entrance ? [...entrance.starts.values()].filter((s) => entrance!.t >= s).length : bound.steps.length;
    const progress = entrance ? clamp01(entrance.t / entrance.total) : explodeRun ? clamp01(explodeRun.t / explodeRun.duration) : 1;
    return { phase: phase(), progress, focusId, exploded: explodeAmount, poiIndex: tour ? tour.index : null, shown, total: bound.steps.length, reducedMotion: reduced, notice: explodeAmount > 0 || (explodeRun && explodeRun.to > 0) ? EXPLODE_NOTICE : null, active };
  }
  let current = buildState();
  function publish(): void {
    current = buildState(); const key = JSON.stringify(current);
    if (key !== lastPublished) { lastPublished = key; options.onState?.(current); }
  }

  // ------------------------------------------------------------------------------------------------ entrance
  function completeEntrance(): void {
    const run = entrance; if (!run) return;
    entrance = null; engaged = true; applyTransforms();
    if (!run.emitted.has('overview')) cue('overview', 'The object is complete: back to the hero view.', () => overviewView(), null, 1300);
    run.ctl.finish('completed'); options.requestRender(); publish();
  }
  function startEntrance(): SequenceHandle {
    if (disposed || editing) { const c = controller(() => {}); c.finish('cancelled'); return c.handle; }
    cancelEverything(false); engaged = false;
    const ctl = controller(() => { if (entrance?.ctl === ctl) { cancelEverything(true); publish(); options.requestRender(); } });
    const steps = bound.steps; if (!steps.length) { ctl.finish('completed'); return ctl.handle; }
    if (reduced) { entrance = null; engaged = true; applyTransforms(); cue('overview', 'Reduced motion: the object is shown complete, framed from the hero view.', () => overviewView(), null, 0); ctl.finish('completed'); options.requestRender(); publish(); return ctl.handle; }
    const n = steps.length, d = Math.min(900, Math.max(360, tuning.entranceMs * 0.3)), stagger = n > 1 ? Math.min(520, Math.max(70, (tuning.entranceMs - LEAD_MS - d) / (n - 1))) : 0;
    const starts = new Map(steps.map((s, i) => [s.componentId, LEAD_MS + i * stagger])); const last = LEAD_MS + (n - 1) * stagger + d;
    entrance = { t: 0, d, lead: LEAD_MS, stagger, total: last + SETTLE_MS, starts, emitted: new Set(['establish']), ctl };
    applyTransforms(); cue('establish', 'Opening shot: the object arrives into a wider frame.', () => establishingView(wholeBox(0), bound.heroAz, view), null, 1100);
    options.requestRender(); publish(); return ctl.handle;
  }
  function stepEntrance(dt: number): void {
    const run = entrance!; run.t += dt;
    const n = bound.steps.length, mid = run.lead + 0.5 * (n - 1) * run.stagger, last = run.lead + (n - 1) * run.stagger + run.d;
    if (!run.emitted.has('follow') && run.t >= mid) {
      run.emitted.add('follow'); const half = bound.steps.slice(0, Math.max(1, Math.ceil(n / 2))).map((s) => s.componentId);
      cue('follow', 'Follows the build: frames the parts placed so far.', () => viewForBox(boxOf(half, 0), { azimuthDeg: bound.heroAz + 14, elevationDeg: 18, ctx: view, margin: 24 }), null, 1200);
    }
    if (!run.emitted.has('overview') && run.t >= last) { run.emitted.add('overview'); cue('overview', 'The last part is in place: settles on the hero view.', () => overviewView(), null, 1300); }
    applyTransforms();
    if (run.t >= run.total) completeEntrance();
  }

  // ------------------------------------------------------------------------------------------------ explode
  function setExplodedInternal(amount: number, animate: boolean, emitCue: boolean): void {
    const target = clamp01(amount); explodeTarget = target;
    if (target > 0) engaged = true;
    if (emitCue && target !== explodeAmount) { if (target > explodeAmount) cue('explode', 'Exploded view: parts are pulled apart, away from their parents, to be seen (a visualisation).', () => viewForBox(wholeBox(target), { azimuthDeg: bound.heroAz, elevationDeg: 20, ctx: view, margin: 20 }), null, tuning.explodeMs + 300); else if (target === 0) cue('restore', 'Back to the planned arrangement.', () => overviewView(), null, tuning.explodeMs + 300); }
    if (!animate || reduced || target === explodeAmount) { explodeRun = null; explodeAmount = target; applyTransforms(); } else explodeRun = { from: explodeAmount, to: target, t: 0, duration: tuning.explodeMs * Math.max(0.35, Math.abs(target - explodeAmount)) };
    options.requestRender(); publish();
  }

  // ------------------------------------------------------------------------------------------------ focus / tour
  function setFocusSet(ids: string[], id: string | null): void {
    focusSet = new Set(ids); focusId = id; focusTarget = ids.length ? 1 : 0; if (ids.length) engaged = true;
    if (reduced) { focusMix = focusTarget; if (!ids.length) focusSet = new Set(); }
    applyDim(); options.requestRender(); publish();
  }
  function gotoPoi(index: number): void {
    const poi = bound.pois[index]; if (!poi || !tour) return;
    tour.index = index; tour.dwell = 0; setFocusSet([...poi.componentIds], null);
    cue('poi', `${poi.label}: ${poi.why}`, () => viewForBox(new Box3().setFromCenterAndSize(new Vector3(...poi.centre), new Vector3(1, 1, 1).multiplyScalar(poi.radius * 2)), { azimuthDeg: bound.heroAz + (index % 2 === 0 ? 18 : -18), elevationDeg: 14, ctx: view, margin: 28 }), poi.componentIds[0] ?? null, 1100);
  }
  function endTour(result: 'completed' | 'cancelled'): void {
    const t = tour; tour = null; setFocusSet([], null);
    if (t) { t.ctl?.finish(result); cue('overview', 'End of the tour: back to the hero view.', () => overviewView(), null, 1100); }
    publish();
  }

  // ------------------------------------------------------------------------------------------------ cancel
  function cancelEverything(restore: boolean): void {
    const e = entrance, t = tour; entrance = null; tour = null;
    if (restore) { restoreAll(); engaged = false; } else { entrance = null; }
    e?.ctl.finish('cancelled'); t?.ctl?.finish('cancelled');
  }

  // ------------------------------------------------------------------------------------------------ public
  const director: PresentationDirector = {
    get state() { return current; },
    get pointsOfInterest() { return bound.pois; },
    get sequence() { return bound.steps; },
    update(dtMs) {
      if (disposed || editing) return false;
      let active = false;
      if (entrance) { stepEntrance(dtMs); active = entrance !== null; }
      if (explodeRun) { explodeRun.t += dtMs; const u = clamp01(explodeRun.t / explodeRun.duration); explodeAmount = explodeRun.from + (explodeRun.to - explodeRun.from) * easeInOut(u); if (u >= 1) { explodeAmount = explodeRun.to; explodeRun = null; } applyTransforms(); active = active || explodeRun !== null; }
      if (focusMix !== focusTarget) { const step = dtMs / FOCUS_MS; focusMix = focusTarget > focusMix ? Math.min(focusTarget, focusMix + step) : Math.max(focusTarget, focusMix - step); if (focusMix === 0 && focusTarget === 0) focusSet = new Set(); applyDim(); active = active || focusMix !== focusTarget; }
      if (tour && !tour.manual && tour.ctl) { tour.dwell += dtMs; if (tour.dwell >= TOUR_DWELL_MS) { if (tour.index >= bound.pois.length - 1) endTour('completed'); else gotoPoi(tour.index + 1); } active = true; }
      options.requestRender(); publish();
      return active || entrance !== null || explodeRun !== null || (tour !== null && !tour.manual) || focusMix !== focusTarget;
    },
    setViewContext(next) { view = next; },
    setReducedMotion(value) {
      if (disposed) return;
      if (value === 'auto') { auto = true; attachMedia(); applyReduced(mediaQuery?.matches ?? false); } else { auto = false; detachMedia(); applyReduced(value); }
    },
    playEntrance: startEntrance,
    focus(id, opts) {
      if (disposed || editing) return;
      if (id !== null && !bound.nodes.has(id)) throw new Error('SPATIAL_PRESENTATION_UNKNOWN_COMPONENT');
      if (tour) { tour = null; }
      setFocusSet(id ? [id] : [], id);
      if (id && opts?.cue !== false) cue('focus', 'Frames the focused part.', () => viewForBox(boxOf([id], explodeAmount), { azimuthDeg: bound.heroAz, elevationDeg: 14, ctx: view, margin: 28 }), id, 1000);
    },
    startTour() {
      if (disposed || editing || !bound.pois.length) { const c = controller(() => {}); c.finish('cancelled'); return c.handle; }
      cancelEverything(true); if (explodeAmount > 0) { explodeAmount = 0; explodeTarget = 0; applyTransforms(); }
      engaged = true;
      if (reduced) { tour = { index: 0, dwell: 0, manual: true, ctl: null }; gotoPoi(0); const c = controller(() => {}); c.finish('completed'); publish(); return c.handle; }
      const ctl = controller(() => { if (tour?.ctl === ctl) endTour('cancelled'); });
      tour = { index: 0, dwell: 0, manual: false, ctl }; gotoPoi(0); publish(); return ctl.handle;
    },
    nextPoi() { if (!disposed && !editing && tour) { gotoPoi(Math.min(bound.pois.length - 1, tour.index + 1)); publish(); } },
    previousPoi() { if (!disposed && !editing && tour) { gotoPoi(Math.max(0, tour.index - 1)); publish(); } },
    stopTour() { if (!disposed && tour) endTour('cancelled'); },
    setExploded(amount, opts) { if (disposed || editing) return; setExplodedInternal(amount, opts?.animate !== false, opts?.cue !== false); },
    toggleExploded() { if (disposed || editing) return; setExplodedInternal(explodeTarget > 0.5 ? 0 : 1, true, true); },
    enterEditing() { if (disposed) return; cancelEverything(true); editing = true; options.requestRender(); publish(); },
    resumeExploring() { if (disposed) return; editing = false; engaged = true; publish(); },
    rebind(next) {
      if (disposed) return;
      cancelEverything(true); finishHandle?.restore(); savedMaterials.clear();
      bound = bind(next.plan, next.root);
      finishHandle = options.finish !== false ? applyPresentationFinish(next.root) : null;
      options.requestRender(); publish();
    },
    cancel() { if (disposed) return; cancelEverything(true); options.requestRender(); publish(); },
    dispose() {
      if (disposed) return;
      cancelEverything(true); finishHandle?.restore(); finishHandle = null; detachMedia(); savedMaterials.clear();
      disposed = true; publish();
    },
  };
  publish();
  return director;
}
