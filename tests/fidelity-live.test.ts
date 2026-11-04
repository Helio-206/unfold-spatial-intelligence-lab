import { describe, expect, it, vi } from 'vitest';
import { Mesh, type Object3D } from 'three';
import { validateSpatialPlanV2, type SpatialPlanV2 } from '../src/universal-spatial/contracts-v2';
import { PlanSpaceLayer } from '../src/living/spatial-space/layer';
import { compileWithRouter, upgradeOnReady } from '../src/universal-spatial/fidelity/router';
import { ContinuousService, createInlineWorker, type WorkerLike } from '../src/universal-spatial/fidelity/continuous-service';
import { runContinuousJob } from '../src/universal-spatial/fidelity/continuous-job';

const T = (position: number[] = [0, 0, 0]) => ({ position, rotationRad: [0, 0, 0], scale: [1, 1, 1] });
const mat = { profile: 'organic', color: '#a04040', roughness: 0.6, metalness: 0, clearcoat: 0 };
const prov = { geometry: 'design_approximation', transform: 'design_approximation', material: 'design_approximation', evidence: 'test' };
const shape = (key: string, operator: string, parameters: object) => ({ type: 'shape', key, operator, parameters, transform: T(), repeat: null, material: mat });
// body + duct touch; `far` is curved but alone, far away: its job never depends on the other two
const plan = (): SpatialPlanV2 => validateSpatialPlanV2({
  contract: 'unfold.spatial-plan.v2', source: { kind: 'image', sha256: 'd'.repeat(64) }, title: 'T', units: 'unitless', presentationProfile: 'organic', relations: [], constraints: [], unknowns: ['Physical scale is unknown.'],
  components: [
    { id: 'body', label: 'Body', parentId: null, transform: T([0, 1.5, 0]), provenance: prov, geometry: shape('body-shape', 'ellipsoid', { radii: [1.1, 1.5, 0.9], widthSegments: 24, heightSegments: 16 }) },
    { id: 'duct', label: 'Duct', parentId: 'body', transform: T(), provenance: prov, geometry: shape('duct-shape', 'tube', { points: [[0, -0.5, 0], [0, 0.6, 0.3], [0.9, 1.2, 0.3]], radius: 0.12, tubularSegments: 24, radialSegments: 10 }) },
    { id: 'far', label: 'Far', parentId: null, transform: T([9, 1, 0]), provenance: prov, geometry: shape('far-shape', 'sphere', { radius: 0.8, widthSegments: 20, heightSegments: 14 }) },
  ],
});
const host = () => ({ changed: vi.fn(), redraw: vi.fn(), notify: vi.fn(), syncLost: vi.fn() });
const flush = async (n = 40) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 2)); };
const family = (root: Object3D, id: string) => { const out = new Set<string>(); root.traverse((o) => { if (o instanceof Mesh && o.userData.spatialEntityId === id) out.add(String(o.userData.geometryFamily ?? 'procedural_v2')); }); return [...out].join(','); };
const groupOf = (root: Object3D, id: string) => { let found: Object3D | undefined; root.traverse((o) => { if (o.userData.spatialComponentRoot && o.userData.spatialEntityId === id) found = o; }); return found!; };

function live() {
  const ran: string[] = [], made: WorkerLike[] = []; let terminated = 0;
  const service = new ContinuousService({ poolSize: 2, createWorker: () => { const w = createInlineWorker((j) => { ran.push(`${j.entityId}`); return runContinuousJob(j); }), t = w.terminate.bind(w); w.terminate = () => { terminated++; t(); }; made.push(w); return w; } });
  let routed: ReturnType<typeof compileWithRouter> | null = null;
  const layer = new PlanSpaceLayer(plan(), host(), (p) => { routed?.retire(); routed = compileWithRouter(p, { service, limits: { maxGridCells: 40 } }); return routed; });
  const stop = upgradeOnReady(service, layer);
  return { service, layer, ran, made, terminated: () => terminated, stop, report: () => routed!.report, routed: () => routed! };
}

describe('V3 geometry arrives later without rebuilding the Space', () => {
  it('shows V2 at once, then swaps only the meshes; groups, plan, selection and the exploded view stay', async () => {
    const { service, layer, report } = live();
    expect(family(layer.root, 'body')).toBe('procedural_v2'); expect(report().pending.sort()).toEqual(['body', 'duct', 'far']);
    const planBefore = layer.currentPlan, groupBefore = groupOf(layer.root, 'body'), positionBefore = groupBefore.position.toArray();
    layer.highlight('body'); layer.setExploded(true, true); const exploded = groupOf(layer.root, 'body').position.toArray(); expect(layer.isExploded).toBe(true);
    await flush();
    expect(family(layer.root, 'body')).toBe('continuous_surface'); expect(family(layer.root, 'far')).toBe('continuous_surface'); expect(report().pending).toEqual([]);
    expect(layer.currentPlan).toBe(planBefore); expect(groupOf(layer.root, 'body')).toBe(groupBefore); expect(groupOf(layer.root, 'body').position.toArray()).toEqual(exploded); expect(exploded).not.toEqual(positionBefore);
    expect(layer.selectedId).toBe('body'); expect(layer.isExploded).toBe(true);
    let lit = 0; layer.root.traverse((o) => { if (o instanceof Mesh && o.userData.spatialEntityId === 'body') { const m = o.material as { emissiveIntensity?: number }; if ((m.emissiveIntensity ?? 0) > 0.4) lit++; } }); expect(lit).toBeGreaterThan(0);
    layer.dispose(); service.dispose();
  });

  it('the new meshes keep the focus dimming and the PBR finish the Director had applied', async () => {
    const { service, layer } = live(); layer.highlight('far'); await flush(); layer.update(1000);
    let dimmed = 0, finished = 0; layer.root.traverse((o) => { if (o instanceof Mesh && o.userData.spatialEntityId === 'body') { const m = o.material as { envMapIntensity: number; userData: Record<string, unknown> }; if (m.userData.presentationFinish) finished++; if (m.envMapIntensity < 1) dimmed++; } });
    expect(finished).toBeGreaterThan(0); expect(dimmed).toBeGreaterThan(0); layer.dispose(); service.dispose();
  });

  it('an edit recomputes only the components whose geometry or partners moved; undo recomputes nothing', async () => {
    const { service, layer, ran } = live(); await flush(); expect(ran.sort()).toEqual(['body', 'duct', 'far']); ran.length = 0;
    // moving a parent with its child keeps their placement relative to each other: the keys are relative, so nothing is recomputed and nothing flashes back to V2
    layer.highlight('body'); layer.proposeEdit('x+'); await layer.applyEdit(); expect(family(layer.root, 'body')).toBe('continuous_surface'); await flush(); expect(ran).toEqual([]);
    // moving the child changes the placement of the pair: only the pair is recomputed, the far part comes straight from the cache
    layer.highlight('duct'); layer.proposeEdit('y+'); await layer.applyEdit();
    expect(family(layer.root, 'far')).toBe('continuous_surface');
    await flush(); expect(ran.sort()).toEqual(['body', 'duct']); expect(family(layer.root, 'body')).toBe('continuous_surface'); ran.length = 0;
    expect(await layer.undo()).toBe(true);
    expect(family(layer.root, 'body')).toBe('continuous_surface'); expect(family(layer.root, 'duct')).toBe('continuous_surface'); await flush(); expect(ran).toEqual([]);
    layer.dispose(); service.dispose();
  });

  it('a result for an older version of the plan never replaces the newer one', async () => {
    const { service, layer, routed } = live(), first = routed();
    layer.highlight('body'); layer.proposeEdit('x+'); await layer.applyEdit(); const second = routed(); expect(second).not.toBe(first);
    await flush(); expect(first.upgrade()).toEqual([]); // retired
    const body = groupOf(layer.root, 'body'); let xs = 0; body.traverse((o) => { if (o instanceof Mesh) xs = Math.max(xs, o.geometry.boundingBox?.max.x ?? 0); });
    expect(layer.currentPlan.components.find((c) => c.id === 'body')!.transform.position[0]).toBeGreaterThan(0); expect(second.report.pending).toEqual([]);
    layer.dispose(); service.dispose();
  });

  it('dispose while jobs are running ends with no worker alive, no timer, no listener and no late write', async () => {
    const { service, layer, made, terminated } = live(); expect(service.stats().running).toBeGreaterThan(0);
    layer.dispose(); service.dispose(); await flush(10);
    expect(service.stats().running).toBe(0); expect(service.stats().queued).toBe(0); expect(terminated()).toBe(made.length);
  });

  it('spreads the arrival over frames: a triangle budget per call, one component at a time, the rest follow by themselves', async () => {
    const s2 = new ContinuousService({ poolSize: 2, createWorker: () => createInlineWorker() }); let routed: ReturnType<typeof compileWithRouter> | null = null;
    const l2 = new PlanSpaceLayer(plan(), host(), (p) => { routed?.retire(); routed = compileWithRouter(p, { service: s2, limits: { maxGridCells: 40 } }); return routed; });
    for (let i = 0; i < 400 && s2.stats().completed < 3; i++) await new Promise((r) => setTimeout(r, 2));
    expect(family(l2.root, 'body')).toBe('procedural_v2'); // arrived in the cache, nobody swapped yet
    const first = l2.upgradeGeometry(1); expect(first.length).toBe(1); // budget 1 triangle: exactly one component this call
    for (let i = 0; i < 100 && routed!.report.pending.length; i++) await new Promise((r) => setTimeout(r, 20));
    expect(routed!.report.pending).toEqual([]); expect(['body', 'duct', 'far'].map((id) => family(l2.root, id))).toEqual(['continuous_surface', 'continuous_surface', 'continuous_surface']);
    l2.dispose(); s2.dispose();
  });

  it('upgradeGeometry after dispose does nothing', async () => {
    const { service, layer } = live(); layer.dispose(); expect(layer.upgradeGeometry()).toEqual([]); service.dispose();
  });

  it('rejects oversized atomic upgrades without blocking the ready queue', async () => {
    const service = new ContinuousService({ poolSize: 2, createWorker: () => createInlineWorker() });
    const routed = compileWithRouter(plan(), { service, limits: { maxGridCells: 40 }, upgradeBudget: { maxWorkMs: 4, maxComponentTriangles: 1 } });
    for (let i = 0; i < 400 && service.stats().completed < 3; i++) await new Promise((r) => setTimeout(r, 2));
    for (let i = 0; i < 10 && routed.report.pending.length; i++) routed.upgrade(12000);
    expect(routed.report.pending).toEqual([]);
    expect(routed.report.decisions.every(d => d.used === 'procedural_v2' && d.fallback?.code === 'UPGRADE_BUDGET')).toBe(true);
    routed.retire(); service.dispose();
  });
});
