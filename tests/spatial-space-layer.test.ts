import { describe, expect, it, vi } from 'vitest';
import { Raycaster, Vector2, PerspectiveCamera } from 'three';
import { validateSpatialPlanV2, type SpatialPlanV2 } from '../src/universal-spatial/contracts-v2';
import type { SpatialOperationV2 } from '../src/universal-spatial/contracts-v2';
import { applySpatialOperationV2 } from '../src/universal-spatial/contracts-v2';
import { PlanSpaceLayer, type LayerSync } from '../src/living/spatial-space/layer';

const id = { position: [0, 0, 0], rotationRad: [0, 0, 0], scale: [1, 1, 1] };
const mat = (color: string) => ({ profile: 'metal', color, roughness: 0.4, metalness: 0.7, clearcoat: 0 });
const part = (name: string, position: number[], origin: 'inferred' | 'user_provided' = 'inferred') => ({
  id: name, label: name.toUpperCase(), parentId: null, transform: { ...id, position },
  provenance: { geometry: origin, transform: origin, material: 'design_approximation', evidence: 'test' },
  geometry: { type: 'shape', key: `${name}-shell`, operator: 'box', parameters: { dimensions: [1, 1, 1] }, transform: id, repeat: null, material: mat('#888888') },
});
const plan = (): SpatialPlanV2 => validateSpatialPlanV2({
  contract: 'unfold.spatial-plan.v2', source: { kind: 'text', sha256: 'a'.repeat(64) }, title: 'T', units: 'unitless', presentationProfile: 'neutral',
  components: [part('base', [0, 0.5, 0]), part('top', [0, 1.5, 0]), part('side', [1, 0.5, 0], 'user_provided')], relations: [], constraints: [], unknowns: [],
});
const host = () => ({ changed: vi.fn(), redraw: vi.fn(), notify: vi.fn(), syncLost: vi.fn() });

describe('PlanSpaceLayer', () => {
  it('previews a nudge, applies it through the typed operation as user_provided, and undoes it', async () => {
    const h = host(), layer = new PlanSpaceLayer(plan(), h);
    layer.highlight('base');
    for (const code of ['x+', 'x-', 'y+', 'y-', 'z+', 'z-', 'scale-up', 'scale-down']) {
      layer.proposeEdit(code);
      expect(layer.pendingEdit, code).not.toBeNull();
      await layer.applyEdit();
      expect(h.notify, code).not.toHaveBeenCalledWith(expect.stringMatching(/bloqueada/));
      expect(await layer.undo(), code).toBe(true);
    }
    layer.proposeEdit('x+'); await layer.applyEdit();
    const moved = layer.currentPlan.components.find((c) => c.id === 'base')!;
    expect(moved.transform.position[0]).toBeGreaterThan(0);
    expect(moved.provenance.transform).toBe('user_provided');
    expect(await layer.undo()).toBe(true);
    expect(layer.currentPlan.components.find((c) => c.id === 'base')!.transform.position).toEqual([0, 0.5, 0]);
    layer.dispose();
  });

  it('refuses to touch a user-provided or observed value without an explicit authorisation', async () => {
    const h = host(), layer = new PlanSpaceLayer(plan(), h);
    layer.highlight('side'); layer.proposeEdit('y+');
    expect(layer.pendingEdit?.needsAuthorization).toBe(true);
    await layer.applyEdit();
    expect(layer.canUndo).toBe(false);
    expect(h.notify).toHaveBeenCalledWith(expect.stringMatching(/autoriza/));
    layer.authorise(true); await layer.applyEdit();
    expect(layer.canUndo).toBe(true);
    layer.dispose();
  });

  it('colour edits go through set-material for every shape of the component', async () => {
    const layer = new PlanSpaceLayer(plan(), host());
    layer.highlight('top'); layer.proposeColour('#2d6cdf'); await layer.applyEdit();
    const shape = layer.currentPlan.components.find((c) => c.id === 'top')!.geometry;
    expect(shape.type === 'shape' && shape.material.color).toBe('#2d6cdf');
    layer.dispose();
  });

  it('picks by component id, frames a component, isolates, and frees what it built', () => {
    const layer = new PlanSpaceLayer(plan(), host());
    const camera = new PerspectiveCamera(30, 1, 0.1, 100); camera.position.set(0, 2, 12); camera.lookAt(0, 1.5, 0); camera.updateMatrixWorld(true);
    expect(layer.has('base')).toBe(true); expect(layer.has('nope')).toBe(false);
    const whole = layer.box()!, top = layer.box('top')!;
    expect(top.max.y).toBeGreaterThan(whole.min.y); expect(top.getSize(whole.max.clone()).y).toBeLessThan(whole.getSize(whole.max.clone()).y);
    const ray = new Raycaster(); ray.setFromCamera(new Vector2(0, 0), camera);
    const centre = top.getCenter(whole.max.clone()).clone().project(camera);
    expect(layer.pick(new Vector2(centre.x, centre.y), camera)).toBe('top');
    layer.isolate('top');
    const hidden: string[] = []; layer.root.traverse((o) => { if ((o as { isMesh?: boolean }).isMesh && !o.visible) hidden.push(o.userData.spatialEntityId as string); });
    expect(new Set(hidden)).toEqual(new Set(['base', 'side']));
    layer.dispose();
    expect(layer.root.children.length).toBe(0);
  });

  it('keeps the presentation scale fixed across edits so the object does not jump', async () => {
    const layer = new PlanSpaceLayer(plan(), host());
    const before = layer.root.children[0]!.scale.x;
    layer.highlight('top'); layer.proposeEdit('y+'); await layer.applyEdit();
    expect(layer.root.children[0]!.scale.x).toBe(before);
    layer.dispose();
  });

  it('mirrors every edit and every undo to the server session and adopts the plan the server returns', async () => {
    let server = plan(); const stack: SpatialPlanV2[] = []; const calls: string[] = [];
    const sync: LayerSync = {
      async apply(op: SpatialOperationV2) { calls.push(`apply:${op.operationId.slice(0, 8)}`); stack.push(server); server = applySpatialOperationV2(server, op, { origin: 'user_provided', evidence: 'server' }); return server; },
      async undo() { calls.push('undo'); server = stack.pop()!; return server; },
    };
    const layer = new PlanSpaceLayer(plan(), host()); layer.attachSync(sync);
    layer.highlight('base'); layer.proposeEdit('y+'); await layer.applyEdit();
    expect(calls).toHaveLength(1); expect(layer.currentPlan).toEqual(server);
    expect(await layer.undo()).toBe(true);
    expect(calls).toEqual([calls[0], 'undo']); expect(layer.currentPlan.components.find((c) => c.id === 'base')!.transform.position).toEqual([0, 0.5, 0]);
    layer.dispose();
  });

  it('keeps editing locally when the server cannot confirm, and says the session was lost', async () => {
    const h = host(), layer = new PlanSpaceLayer(plan(), h);
    layer.attachSync({ apply: async () => { throw new Error('SPATIAL_V2_SESSION_NOT_FOUND'); }, undo: async () => { throw new Error('x'); } });
    layer.highlight('base'); layer.proposeEdit('y+'); await layer.applyEdit();
    expect(h.syncLost).toHaveBeenCalledWith('SPATIAL_V2_SESSION_NOT_FOUND');
    expect(layer.synced).toBe(false);
    expect(layer.currentPlan.components.find((c) => c.id === 'base')!.transform.position[1]).toBeGreaterThan(0.5);
    layer.dispose();
  });

  it('never applies a model proposal without an explicit authorisation, and previews it first', async () => {
    const layer = new PlanSpaceLayer(plan(), host());
    const op: SpatialOperationV2 = { contract: 'unfold.spatial-operation.v2', operationId: 'meta-1', kind: 'set-transform', componentId: 'top', nodeKey: null, value: { ...id, position: [0, 4, 0] } };
    expect(layer.proposeOperation(op, 'meta', 'Proposta')).toBe(true);
    expect(layer.pendingEdit?.source).toBe('meta'); expect(layer.pendingEdit?.needsAuthorization).toBe(true);
    await layer.applyEdit();
    expect(layer.currentPlan.components.find((c) => c.id === 'top')!.transform.position).toEqual([0, 1.5, 0]);
    layer.authorise(true); await layer.applyEdit();
    expect(layer.currentPlan.components.find((c) => c.id === 'top')!.transform.position).toEqual([0, 4, 0]);
    expect(layer.proposeOperation({ ...op, componentId: 'ghost' }, 'meta', 'x')).toBe(false);
    layer.dispose();
  });

  it('explodes and restores generically without touching the plan', () => {
    const layer = new PlanSpaceLayer(plan(), host()), before = structuredClone(layer.currentPlan);
    const positions = () => { const out: number[][] = []; layer.root.traverse((o) => { if (o.userData.spatialComponentRoot) out.push(o.position.toArray()); }); return out; };
    const start = positions();
    layer.setExploded(true, true);
    expect(positions()).not.toEqual(start); expect(layer.isExploded).toBe(true);
    expect(layer.box()!.getSize(layer.box()!.max.clone()).y).toBeGreaterThan(0);
    layer.setExploded(false, true);
    expect(positions()).toEqual(start); expect(layer.currentPlan).toEqual(before);
    layer.dispose();
  });

  it('the construction reveal ends with every component visible at its exact place', () => {
    const layer = new PlanSpaceLayer(plan(), host());
    const state = () => { const out: Array<[boolean, number[], number[]]> = []; layer.root.traverse((o) => { if (o.userData.spatialComponentRoot) out.push([o.visible, o.position.toArray(), o.scale.toArray()]); }); return out; };
    const before = state(); layer.reveal(true);
    expect(state()).toEqual(before); expect(state().every(([v]) => v)).toBe(true);
    layer.dispose();
  });
});
