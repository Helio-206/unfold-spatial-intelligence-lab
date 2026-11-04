import { afterEach, describe, expect, it, vi } from 'vitest';
import { Mesh, MeshPhysicalMaterial, type Object3D } from 'three';
import { validateSpatialPlanV2, type SpatialPlanV2 } from '../src/universal-spatial/contracts-v2';
import { compileSpatialPlanV2, disposeCompiledSpatialPlan } from '../src/universal-spatial/geometry-compiler-v2';
import { createPresentationDirector } from '../src/living/spatial-presentation';
import { measureComponents } from '../src/living/spatial-presentation/structure';
import { viewForBox } from '../src/living/spatial-presentation/cues';
import type { CameraCue, PresentationDirector, PresentationState, SequenceHandle, ViewContext } from '../src/living/spatial-presentation';

type V3 = [number, number, number];
const T = (position: V3 = [0, 0, 0]) => ({ position, rotationRad: [0, 0, 0] as V3, scale: [1, 1, 1] as V3 });
const part = (id: string, dims: V3, position: V3, parentId: string | null = null, profile: 'neutral' | 'metal' | 'organic' = 'neutral') => ({
  id, label: `Part ${id}`, parentId, transform: T(position),
  geometry: { type: 'shape' as const, key: `${id}-shape`, operator: 'box' as const, parameters: { dimensions: dims }, transform: T(), repeat: null, material: { profile, color: '#a07040', roughness: 0.5, metalness: 0.1, clearcoat: 0 } },
  provenance: { geometry: 'design_approximation' as const, transform: 'design_approximation' as const, material: 'design_approximation' as const, evidence: 'test' },
});
const makePlan = (): SpatialPlanV2 => validateSpatialPlanV2({
  contract: 'unfold.spatial-plan.v2', source: { kind: 'text', sha256: 'a'.repeat(64) }, title: 'tower', units: 'unitless', presentationProfile: 'neutral', constraints: [], unknowns: [],
  components: [part('cap', [1, 0.5, 1], [0, 2.25, 0], 'shaft', 'metal'), part('arm', [2, 0.3, 0.3], [1.4, 0, 0], 'shaft'), part('base', [4, 1, 4], [0, 0.5, 0], null, 'organic'), part('shaft', [1, 4, 1], [0, 2.5, 0], 'base')],
  relations: [{ id: 'r1', fromId: 'shaft', toId: 'base', kind: 'attached_to', origin: 'inferred', evidence: 't' }],
});
const ctx: ViewContext = { viewport: { width: 1440, height: 900 }, insets: { top: 80, right: 330, bottom: 120, left: 80 }, baseFovDeg: 30 };

const disposers: Array<() => void> = [];
afterEach(() => { while (disposers.length) disposers.pop()!(); delete (globalThis as { matchMedia?: unknown }).matchMedia; });
function rig(options: { reducedMotion?: boolean | 'auto'; finish?: boolean; plan?: SpatialPlanV2 } = {}) {
  const plan = options.plan ?? makePlan(), compiled = compileSpatialPlanV2(plan), cues: CameraCue[] = [], states: PresentationState[] = [], render = vi.fn();
  const director = createPresentationDirector({ plan, root: compiled.root, requestRender: render, onCue: (c) => cues.push(c), onState: (s) => states.push(s), view: ctx, reducedMotion: options.reducedMotion ?? false, finish: options.finish ?? false });
  disposers.push(() => { director.dispose(); disposeCompiledSpatialPlan(compiled.root); });
  return { plan, compiled, root: compiled.root, director, cues, states, render };
}
const groups = (root: Object3D) => { const out = new Map<string, Object3D>(); root.traverse((o) => { if (o.userData.spatialComponentRoot) out.set(o.userData.spatialEntityId as string, o); }); return out; };
const snapshot = (root: Object3D) => [...groups(root)].map(([id, g]) => [id, g.position.toArray(), g.scale.toArray(), g.visible] as const);
const colours = (root: Object3D) => { const out: unknown[] = []; root.traverse((o) => { if (o instanceof Mesh && o.material instanceof MeshPhysicalMaterial) out.push([o.userData.spatialEntityId, o.material.color.toArray(), o.material.envMapIntensity]); }); return out; };
function runUntil(director: PresentationDirector, done: () => boolean, dt = 16, limit = 60_000): number { let t = 0; while (!done() && t < limit) { director.update(dt); t += dt; } return t; }
const settle = async (handle: SequenceHandle) => handle.done;

describe('presentation director: entrance', () => {
  it('builds the object in structural order, from nothing to the planned state, bit for bit', async () => {
    const { director, root, plan } = rig(), before = snapshot(root), planBefore = structuredClone(plan);
    const handle = director.playEntrance();
    expect(director.state.phase).toBe('entering'); expect(director.state.shown).toBe(0); expect(groups(root).get('base')!.visible).toBe(false);
    const shownOrder: string[] = [], seen = new Set<string>();
    runUntil(director, () => { for (const [id, g] of groups(root)) if (g.visible && !seen.has(id)) { seen.add(id); shownOrder.push(id); } return director.state.phase !== 'entering'; });
    expect(await settle(handle)).toBe('completed'); expect(director.state.phase).toBe('exploring'); expect(director.state.progress).toBe(1);
    expect(shownOrder).toEqual(director.sequence.map((s) => s.componentId)); expect(shownOrder[0]).toBe('base'); expect(shownOrder.indexOf('shaft')).toBeLessThan(shownOrder.indexOf('cap'));
    expect(snapshot(root)).toEqual(before); expect(plan).toEqual(planBefore);
  });

  it('progress and the shown count never go backwards, and the object is never shown before its parent', () => {
    const { director, root } = rig(); director.playEntrance(); let progress = 0, shown = 0;
    runUntil(director, () => { expect(director.state.progress).toBeGreaterThanOrEqual(progress); expect(director.state.shown).toBeGreaterThanOrEqual(shown); progress = director.state.progress; shown = director.state.shown; const g = groups(root); if (g.get('cap')!.visible) expect(g.get('shaft')!.visible).toBe(true); return director.state.phase !== 'entering'; });
  });

  it('asks the camera for an establishing shot, a follow shot and a final overview, as requests', () => {
    const { director, cues } = rig(); director.playEntrance(); runUntil(director, () => director.state.phase !== 'entering');
    expect(cues.map((c) => c.kind)).toEqual(['establish', 'follow', 'overview']); for (const c of cues) { expect(c.interruptible).toBe(true); expect(c.durationMs).toBeGreaterThan(0); expect(c.reason.length).toBeGreaterThan(8); expect(Number.isFinite(c.view.distance)).toBe(true); }
    expect(cues[0]!.view.distance).toBeGreaterThan(cues[2]!.view.distance);
  });

  it('under reduced motion it completes at once: no intermediate frames, jump cues only', async () => {
    const { director, root, cues, render } = rig({ reducedMotion: true }), before = snapshot(root);
    const handle = director.playEntrance(); expect(await settle(handle)).toBe('completed');
    expect(director.state.phase).toBe('exploring'); expect(director.update(16)).toBe(false); expect(snapshot(root)).toEqual(before); expect(render).toHaveBeenCalled();
    expect(cues.length).toBeGreaterThan(0); for (const c of cues) expect(c.durationMs).toBe(0);
  });

  it('switching reduced motion on mid-sequence finishes the sequence immediately and restores', async () => {
    const { director, root } = rig(), before = snapshot(root), handle = director.playEntrance(); director.update(800); expect(director.state.phase).toBe('entering');
    director.setReducedMotion(true); expect(await settle(handle)).toBe('completed'); expect(snapshot(root)).toEqual(before); expect(director.state.reducedMotion).toBe(true);
  });

  it('cancelling mid-sequence restores everything exactly and resolves the handle as cancelled', async () => {
    const { director, root } = rig(), before = snapshot(root), handle = director.playEntrance(); runUntil(director, () => director.state.shown >= 2 || director.state.phase !== 'entering');
    expect(snapshot(root)).not.toEqual(before); handle.cancel(); expect(await settle(handle)).toBe('cancelled'); expect(snapshot(root)).toEqual(before); expect(director.state.phase).toBe('idle'); expect(director.update(16)).toBe(false);
  });

  it('is deterministic: same plan and same time steps give the same states and cues', () => {
    const a = rig(), b = rig(); for (const r of [a, b]) { r.director.playEntrance(); runUntil(r.director, () => r.director.state.phase !== 'entering', 20); }
    expect(a.states).toEqual(b.states); expect(a.cues).toEqual(b.cues);
  });
});

describe('presentation director: on-demand rendering', () => {
  it('asks for no frame while nothing animates, so the workspace can stay idle', () => {
    const { director, render } = rig(); render.mockClear();
    for (let i = 0; i < 50; i++) expect(director.update(16)).toBe(false);
    expect(render).not.toHaveBeenCalled();
    director.playEntrance(); render.mockClear(); director.update(16); expect(render).toHaveBeenCalled();
    runUntil(director, () => director.state.phase !== 'entering'); render.mockClear(); for (let i = 0; i < 20; i++) director.update(16); expect(render).not.toHaveBeenCalled();
  });
});

describe('presentation director: focus', () => {
  it('dims every other component, leaves the focused one, emits a focus cue, and restores colours exactly', () => {
    const { director, root, cues } = rig(), before = colours(root);
    director.focus('shaft'); runUntil(director, () => !director.update(0) && director.state.focusId === 'shaft', 16, 2000);
    const now = colours(root) as Array<[string, number[], number]>, base = (before as Array<[string, number[], number]>);
    now.forEach((entry, i) => { if (entry[0] === 'shaft') expect(entry[1]).toEqual(base[i]![1]); else expect(entry[1][0]!).toBeLessThan(base[i]![1][0]!); });
    expect(director.state.active).toContain('dim'); expect(cues.at(-1)).toMatchObject({ kind: 'focus', componentId: 'shaft' });
    const box = measureComponents(makePlan(), root).get('shaft')!.box, expected = viewForBox(box, { azimuthDeg: 0, elevationDeg: 0, ctx });
    expect(cues.at(-1)!.view.distance).toBeGreaterThan(0); expect(Number.isFinite(expected.distance)).toBe(true);
    director.focus(null); runUntil(director, () => !director.update(0), 16, 2000); expect(colours(root)).toEqual(before); expect(director.state.focusId).toBeNull(); expect(director.state.active).not.toContain('dim');
  });

  it('can focus silently, and rejects an unknown component', () => {
    const { director, cues } = rig(); director.focus('arm', { cue: false }); expect(cues).toEqual([]); expect(() => director.focus('nope')).toThrow('SPATIAL_PRESENTATION_UNKNOWN_COMPONENT');
  });

  it('under reduced motion focus is immediate', () => {
    const { director, root } = rig({ reducedMotion: true }), before = colours(root); director.focus('cap'); expect(colours(root)).not.toEqual(before); director.focus(null); expect(colours(root)).toEqual(before);
  });
});

describe('presentation director: exploded view', () => {
  it('moves parts away from their parents, always says it is a visualisation, and returns exactly', () => {
    const { director, root, plan } = rig(), before = snapshot(root), planBefore = structuredClone(plan);
    director.setExploded(1, { animate: false, cue: false });
    const g = groups(root), afterCap = g.get('cap')!.position.toArray(), restCap = (before.find(([id]) => id === 'cap')![1]);
    expect(afterCap[1]!).toBeGreaterThan(restCap[1]!); expect(director.state.exploded).toBe(1); expect(director.state.notice).toMatch(/visualiza/i); expect(director.state.active).toContain('exploded view'); expect(director.state.phase).toBe('exploded');
    director.setExploded(0, { animate: false, cue: false }); expect(snapshot(root)).toEqual(before); expect(director.state.notice).toBeNull(); expect(director.state.phase).toBe('exploring'); expect(plan).toEqual(planBefore);
  });

  it('animates both ways, can be reversed mid-way, and keeps the notice on while any offset remains', () => {
    const { director, root, cues } = rig(), before = snapshot(root);
    director.setExploded(1); runUntil(director, () => director.state.exploded >= 0.4); expect(director.state.notice).not.toBeNull(); director.setExploded(0);
    runUntil(director, () => director.state.exploded === 0 && !director.update(0)); expect(snapshot(root)).toEqual(before); expect(director.state.notice).toBeNull();
    expect(cues.map((c) => c.kind)).toEqual(['explode', 'restore']);
  });

  it('toggle flips between the two states', () => {
    const { director } = rig({ reducedMotion: true }); director.toggleExploded(); expect(director.state.exploded).toBe(1); director.toggleExploded(); expect(director.state.exploded).toBe(0);
  });

  it('keeps child offsets hierarchical: an arm follows its parent shaft', () => {
    const { director, root } = rig(); director.setExploded(1, { animate: false, cue: false }); const g = groups(root);
    expect(g.get('arm')!.position.length()).toBeGreaterThan(1.4 - 1e-9);
  });
});

describe('presentation director: points of interest tour', () => {
  it('walks the points of interest with poi cues, dwell and clean ending', async () => {
    const { director, cues } = rig(); expect(director.pointsOfInterest[0]!.kind).toBe('overview');
    const handle = director.startTour(); expect(director.state.phase).toBe('touring'); expect(director.state.poiIndex).toBe(0);
    runUntil(director, () => director.state.phase !== 'touring', 50); expect(await settle(handle)).toBe('completed');
    expect(cues.filter((c) => c.kind === 'poi').length).toBe(director.pointsOfInterest.length); expect(director.state.focusId).toBeNull(); expect(director.state.phase).toBe('exploring');
  });

  it('next/previous are clamped and stopTour cancels the handle and clears focus', async () => {
    const { director, root } = rig(), before = colours(root), handle = director.startTour();
    director.previousPoi(); expect(director.state.poiIndex).toBe(0); director.nextPoi(); expect(director.state.poiIndex).toBe(1);
    for (let i = 0; i < 20; i++) director.nextPoi(); expect(director.state.poiIndex).toBe(director.pointsOfInterest.length - 1);
    director.stopTour(); expect(await settle(handle)).toBe('cancelled'); runUntil(director, () => !director.update(0), 16, 2000); expect(colours(root)).toEqual(before);
  });

  it('under reduced motion it does not auto-play: it lands on the first point and waits for the person', async () => {
    const { director } = rig({ reducedMotion: true }), handle = director.startTour(); expect(await settle(handle)).toBe('completed'); expect(director.state.poiIndex).toBe(0); director.nextPoi(); expect(director.state.poiIndex).toBe(1);
  });
});

describe('presentation director: editing, rebinding, teardown', () => {
  it('editing stops everything and restores the true plan state; resuming goes back to exploring', async () => {
    const { director, root } = rig(), before = snapshot(root), colourBefore = colours(root), handle = director.playEntrance(); director.update(900); director.focus('cap', { cue: false });
    director.enterEditing(); expect(await settle(handle)).toBe('cancelled'); expect(director.state.phase).toBe('editing'); expect(snapshot(root)).toEqual(before); expect(colours(root)).toEqual(colourBefore); expect(director.update(16)).toBe(false);
    director.resumeExploring(); expect(director.state.phase).toBe('exploring');
  });

  it('rebinding to a recompiled plan drops the old state and works on the new objects', async () => {
    const { director, plan, compiled } = rig(); director.setExploded(1, { animate: false, cue: false });
    const next = compileSpatialPlanV2(plan); disposeCompiledSpatialPlan(compiled.root); const fresh = snapshot(next.root);
    director.rebind({ plan, root: next.root }); expect(director.state.exploded).toBe(0); expect(snapshot(next.root)).toEqual(fresh);
    const handle = director.playEntrance(); runUntil(director, () => director.state.phase !== 'entering'); expect(await settle(handle)).toBe('completed'); expect(snapshot(next.root)).toEqual(fresh);
    director.dispose(); disposeCompiledSpatialPlan(next.root);
  });

  it('dispose restores, is idempotent, and nothing runs afterwards', async () => {
    const { director, root, render } = rig(), before = snapshot(root), handle = director.playEntrance(); director.update(700);
    director.dispose(); expect(await settle(handle)).toBe('cancelled'); expect(snapshot(root)).toEqual(before); expect(director.state.phase).toBe('disposed');
    render.mockClear(); director.dispose(); expect(director.update(16)).toBe(false); director.focus(null); director.setExploded(1); director.playEntrance(); expect(render).not.toHaveBeenCalled();
  });

  it('creates no geometry and releases the textures it created (no GPU leak)', () => {
    const { director, root, plan } = rig({ finish: true }), geometries = new Set<string>(); root.traverse((o) => { if (o instanceof Mesh) geometries.add(o.geometry.uuid); });
    const textures = new Set<{ dispose(): void; addEventListener: (n: 'dispose', f: () => void) => void }>(); root.traverse((o) => { if (o instanceof Mesh && o.material instanceof MeshPhysicalMaterial) for (const t of [o.material.map, o.material.roughnessMap, o.material.bumpMap]) if (t) textures.add(t as never); });
    expect(textures.size).toBeGreaterThan(0); expect(director.state.active).toContain('PBR finish'); let disposed = 0; for (const t of textures) t.addEventListener('dispose', () => { disposed++; });
    director.playEntrance(); runUntil(director, () => director.state.phase !== 'entering'); director.setExploded(1, { animate: false, cue: false }); director.focus('cap', { cue: false });
    const after = new Set<string>(); root.traverse((o) => { if (o instanceof Mesh) after.add(o.geometry.uuid); }); expect(after).toEqual(geometries);
    director.dispose(); expect(disposed).toBe(textures.size); root.traverse((o) => { if (o instanceof Mesh && o.material instanceof MeshPhysicalMaterial) expect(o.material.roughnessMap).toBeNull(); }); expect(plan.components.length).toBe(4);
  });

  it('follows prefers-reduced-motion live and removes its listener on dispose', () => {
    const listeners = new Set<(e: { matches: boolean }) => void>(); let adds = 0, removes = 0;
    (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false, addEventListener: (_: string, f: (e: { matches: boolean }) => void) => { adds++; listeners.add(f); }, removeEventListener: (_: string, f: (e: { matches: boolean }) => void) => { removes++; listeners.delete(f); } });
    const { director } = rig({ reducedMotion: 'auto' }); expect(director.state.reducedMotion).toBe(false); listeners.forEach((f) => f({ matches: true })); expect(director.state.reducedMotion).toBe(true);
    director.dispose(); expect(adds).toBe(1); expect(removes).toBe(1); expect(listeners.size).toBe(0);
  });
});
