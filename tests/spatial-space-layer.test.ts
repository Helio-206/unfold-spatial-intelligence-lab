import { describe, expect, it, vi } from 'vitest';
import { Mesh, MeshPhysicalMaterial, Raycaster, Vector2, PerspectiveCamera } from 'three';
import { validateSpatialPlanV2, type SpatialPlanV2 } from '../src/universal-spatial/contracts-v2';
import type { SpatialOperationV2 } from '../src/universal-spatial/contracts-v2';
import { applySpatialOperationV2 } from '../src/universal-spatial/contracts-v2';
import { PlanSpaceLayer, SpatialTransactionSessionRecoveredError, type LayerSync } from '../src/living/spatial-space/layer';
import { SpatialTransactionUnresolvedError } from '../src/universal-spatial/api-client';

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
const floating = (): SpatialPlanV2 => validateSpatialPlanV2({
  contract: 'unfold.spatial-plan.v2', source: { kind: 'text', sha256: 'a'.repeat(64) }, title: 'F', units: 'unitless', presentationProfile: 'neutral',
  components: [part('base', [0, 0.5, 0]), part('top', [0, 4, 0])], relations: [], constraints: [], unknowns: [],
});
const host = () => ({ changed: vi.fn(), redraw: vi.fn(), notify: vi.fn(), syncLost: vi.fn() });

describe('PlanSpaceLayer', () => {
  it('keeps only the last displayed materials until a successful new frame and disposes everything on exit', async () => {
    const layer = new PlanSpaceLayer(plan(), host());
    const material = (id: string) => { let found: MeshPhysicalMaterial | null = null; layer.root.traverse(o => { if (o instanceof Mesh && o.userData.spatialEntityId === id) found = o.material as MeshPhysicalMaterial; }); return found!; };
    const old = material('base'), other = material('top'); expect(old).not.toBe(other);
    const oldDispose = vi.fn(); old.addEventListener('dispose', oldDispose);
    layer.highlight('base'); layer.afterRender();
    layer.proposeEdit('x+'); await layer.applyEdit();
    expect(oldDispose).not.toHaveBeenCalled();
    const intermediate = material('base'), intermediateDispose = vi.fn(); intermediate.addEventListener('dispose', intermediateDispose);
    layer.proposeColour('#2d6cdf'); await layer.applyEdit();
    expect(intermediateDispose).toHaveBeenCalledOnce(); expect(oldDispose).not.toHaveBeenCalled();
    const current = material('base'), currentDispose = vi.fn(); current.addEventListener('dispose', currentDispose);
    expect(current).not.toBe(material('top')); expect(current.color.getHexString()).toBe('2d6cdf');
    expect(layer.selectedId).toBe('base'); layer.afterRender();
    expect(oldDispose).toHaveBeenCalledOnce(); expect(currentDispose).not.toHaveBeenCalled();
    layer.dispose(); expect(currentDispose).toHaveBeenCalledOnce();
  });

  it('releases deferred materials when the Space closes before another frame', async () => {
    const layer = new PlanSpaceLayer(plan(), host()); let old: MeshPhysicalMaterial | null = null;
    layer.root.traverse(o => { if (o instanceof Mesh && o.userData.spatialEntityId === 'base') old = o.material as MeshPhysicalMaterial; });
    const disposed = vi.fn(); old!.addEventListener('dispose', disposed); layer.highlight('base'); layer.afterRender();
    layer.proposeEdit('x+'); await layer.applyEdit(); expect(disposed).not.toHaveBeenCalled();
    layer.dispose(); expect(disposed).toHaveBeenCalledOnce(); layer.afterRender(); expect(disposed).toHaveBeenCalledOnce();
  });

  it('releases deferred materials if no frame arrives', async () => {
    vi.useFakeTimers();
    try {
      const layer = new PlanSpaceLayer(plan(), host()); let old: MeshPhysicalMaterial | null = null;
      layer.root.traverse(o => { if (o instanceof Mesh && o.userData.spatialEntityId === 'base') old = o.material as MeshPhysicalMaterial; });
      const disposed = vi.fn(); old!.addEventListener('dispose', disposed); layer.highlight('base'); layer.afterRender();
      layer.proposeEdit('x+'); await layer.applyEdit(); expect(disposed).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1000); expect(disposed).toHaveBeenCalledOnce(); layer.dispose();
    } finally { vi.useRealTimers(); }
  });
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

  it('does not rebuild after a delayed undo finishes on a disposed layer', async () => {
    const layer = new PlanSpaceLayer(plan(), host()); layer.highlight('base'); layer.proposeEdit('x+'); await layer.applyEdit();
    const before = layer.currentPlan; let release!: (p: SpatialPlanV2) => void;
    layer.attachSync({ apply: async () => before, undo: () => new Promise(resolve => { release = resolve; }) });
    const pending = layer.undo(); layer.dispose(); release(plan());
    expect(await pending).toBe(false); expect(layer.root.children).toHaveLength(0); expect(layer.currentPlan).toBe(before);
  });
  it('does not undo or run a solver after disposal', async () => {
    const layer = new PlanSpaceLayer(plan(), host()); layer.highlight('base'); layer.proposeEdit('x+'); await layer.applyEdit();
    layer.dispose(); expect(await layer.undo()).toBe(false); expect((await layer.closeGaps()).applied).toBe(0); expect(layer.root.children).toHaveLength(0);
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

  it('the Presentation Director owns the exploded view: it is announced, and editing restores the planned positions exactly', async () => {
    const layer = new PlanSpaceLayer(plan(), host());
    const positions = () => { const out: number[][] = []; layer.root.traverse((o) => { if (o.userData.spatialComponentRoot) out.push(o.position.toArray()); }); return out; };
    const planned = positions();
    layer.setExploded(true, true); layer.update(5000);
    expect(positions()).not.toEqual(planned); expect(layer.presentationNotice).toMatch(/explodida/i);
    layer.highlight('base'); layer.proposeEdit('y+'); await layer.applyEdit();
    expect(layer.isExploded).toBe(false);
    expect(layer.currentPlan.components.find((c) => c.id === 'base')!.transform.position[1]).toBeGreaterThan(0.5);
    layer.dispose();
  });

  it('is idle at rest: the layer asks for no more frames once the entrance and the exploded view have finished', () => {
    const layer = new PlanSpaceLayer(plan(), host());
    layer.reveal(true);
    expect(layer.update(16)).toBe(false);
    layer.setExploded(true, true); for (let i = 0; i < 200 && layer.update(50); i++);
    expect(layer.update(16)).toBe(false);
    layer.dispose();
  });

  it('an exploded view never sinks a component below the floor the Space stood on', () => {
    const layer = new PlanSpaceLayer(plan(), host());
    const floor = layer.box()!.min.y;
    layer.setExploded(true, true); for (let i = 0; i < 200 && layer.update(50); i++);
    expect(layer.box()!.min.y).toBeGreaterThanOrEqual(floor - 1e-6);
    layer.dispose();
  });

  it('hands the provenance of every operation to the server session, so a solver result is not promoted to user_provided', async () => {
    const seen: Array<{ origin: string; evidence: string }> = [];
    const stack: SpatialPlanV2[] = []; let server = floating();
    const sync: LayerSync = {
      async apply(op: SpatialOperationV2, provenance) { seen.push(provenance); stack.push(server); server = applySpatialOperationV2(server, op, provenance); return server; },
      async undo() { server = stack.pop()!; return server; },
    };
    const layer = new PlanSpaceLayer(floating(), host()); layer.attachSync(sync);
    const closed = await layer.closeGaps();
    expect(closed.applied).toBeGreaterThan(0);
    expect(seen.length).toBeGreaterThan(0); expect(seen.every((p) => p.origin === 'inferred')).toBe(true);
    expect(layer.currentPlan.components.find((c) => c.id === 'top')!.provenance.transform).toBe('inferred');
    layer.highlight('base'); layer.proposeEdit('x+'); await layer.applyEdit();
    expect(seen.at(-1)!.origin).toBe('user_provided');
    layer.dispose();
  });

  it('refuses every edit while the server session is being prepared, and works once it is ready (PR #27 review, P2)', async () => {
    const h = host(), layer = new PlanSpaceLayer(plan(), h);
    layer.lockEditing('a preparar a sessão');
    layer.highlight('base'); layer.proposeEdit('x+'); await layer.applyEdit();
    expect(layer.canUndo).toBe(false); expect(layer.currentPlan.components.find((c) => c.id === 'base')!.transform.position).toEqual([0, 0.5, 0]);
    expect(h.notify).toHaveBeenCalledWith(expect.stringMatching(/a preparar a sessão/));
    expect(await layer.closeGaps()).toEqual({ applied: 0, iterations: 0 }); expect(await layer.undo()).toBe(false);
    layer.unlockEditing();
    layer.proposeEdit('x+'); await layer.applyEdit();
    expect(layer.canUndo).toBe(true);
    layer.dispose();
  });

  describe('solver proposals (V4 structural fit)', () => {
    const ops = (): SpatialOperationV2[] => ['base', 'top'].map((cid, n) => ({ contract: 'unfold.spatial-operation.v2', operationId: `v4-test-${n}`, kind: 'set-transform', componentId: cid, nodeKey: null, value: { position: [0.4, n ? 1.7 : 0.5, 0], rotationRad: [0, 0, 0], scale: [1.2, 1.2, 1.2] } }));
    it('does not start a non-atomic grouped server operation', async () => {
      const h = host(), layer = new PlanSpaceLayer(plan(), h), before = layer.currentPlan;
      const apply = vi.fn(async () => before); layer.attachSync({ apply, undo: async () => before });
      expect(layer.proposeSolverEdit(ops(), 'batch', 'fixture')).toBe(true); layer.authorise(true); await layer.applyEdit();
      expect(apply).not.toHaveBeenCalled(); expect(layer.currentPlan).toBe(before); expect(layer.editCount).toBe(0);
      expect(h.notify).toHaveBeenCalledWith(expect.stringContaining('BATCH_REQUIRES_ATOMIC_SERVER')); layer.dispose();
    });
    it('does not partially undo a local group after a server session is attached', async () => {
      const h = host(), layer = new PlanSpaceLayer(plan(), h); layer.proposeSolverEdit(ops(), 'batch', 'fixture'); layer.authorise(true); await layer.applyEdit();
      const grouped = layer.currentPlan, undo = vi.fn(async () => grouped);
      layer.attachSync({ apply: async () => grouped, undo });
      expect(await layer.undo()).toBe(false); expect(undo).not.toHaveBeenCalled(); expect(layer.currentPlan).toBe(grouped); expect(layer.editCount).toBe(1); layer.dispose();
    });
    it('is only a preview: the plan does not change until a person authorises, and it says it is a solver result', async () => {
      const h = host(), layer = new PlanSpaceLayer(plan(), h), before = layer.currentPlan;
      expect(layer.proposeSolverEdit(ops(), 'Ajuste estrutural', 'Solver fitted 6 silhouettes.')).toBe(true);
      expect(layer.pendingEdit?.source).toBe('solver'); expect(layer.currentPlan).toBe(before);
      await layer.applyEdit(); expect(layer.currentPlan).toBe(before); expect(h.notify).toHaveBeenCalledWith(expect.stringMatching(/autoriz/i));
    });
    it('applies all operations as one undoable step, keeps ids, and records the solver evidence in the provenance', async () => {
      const layer = new PlanSpaceLayer(plan(), host()); const ids = layer.currentPlan.components.map((c) => c.id);
      layer.proposeSolverEdit(ops(), 'Ajuste estrutural', 'Solver fitted 6 silhouettes.'); layer.authorise(true); await layer.applyEdit();
      const base = layer.currentPlan.components.find((c) => c.id === 'base')!; expect(base.transform.scale[0]).toBeCloseTo(1.2); expect(base.provenance.evidence).toMatch(/Solver fitted 6 silhouettes/); expect(layer.currentPlan.components.map((c) => c.id)).toEqual(ids);
      expect(await layer.undo()).toBe(true); expect(layer.currentPlan.components.find((c) => c.id === 'base')!.transform.scale[0]).toBe(1);
    });
    it('keeps the provenance evidence inside the contract limit however long the solver text is', async () => {
      const layer = new PlanSpaceLayer(plan(), host()); layer.proposeSolverEdit(ops(), 'x', 'e'.repeat(900)); layer.authorise(true); await layer.applyEdit();
      expect(layer.editCount).toBe(1); expect(layer.currentPlan.components.find((c) => c.id === 'base')!.provenance.evidence.length).toBeLessThanOrEqual(500);
    });
    it('after dispose it offers nothing, and a pending proposal is dropped with the layer', () => {
      const layer = new PlanSpaceLayer(plan(), host()); expect(layer.proposeSolverEdit(ops(), 'x', 'y')).toBe(true); layer.dispose();
      expect(layer.proposeSolverEdit(ops(), 'x', 'y')).toBe(false); expect(layer.pendingEdit).toBeNull();
    });
    it('can be cancelled: the plan is unchanged and nothing stays pending', async () => {
      const layer = new PlanSpaceLayer(plan(), host()), before = layer.currentPlan; layer.proposeSolverEdit(ops(), 'x', 'y'); layer.cancelPending();
      expect(layer.pendingEdit).toBeNull(); await layer.applyEdit(); expect(layer.currentPlan).toBe(before); expect(layer.editCount).toBe(0);
    });
    it('refuses a proposal that does not apply to the plan', () => {
      const layer = new PlanSpaceLayer(plan(), host()); expect(layer.proposeSolverEdit([{ ...ops()[0]!, componentId: 'ghost' }], 'x', 'y')).toBe(false); expect(layer.pendingEdit).toBeNull();
    });
    it('commits a solver group through one atomic transaction and undoes it through one grouped undo (V4 E0)', async () => {
      let server = plan(); const stack: SpatialPlanV2[] = [];
      const applyTransaction = vi.fn(async (operations: SpatialOperationV2[], provenance: { origin: 'user_provided' | 'inferred'; evidence: string }) => { stack.push(server); for (const operation of operations) server = applySpatialOperationV2(server, operation, provenance); return server; });
      const undoTransaction = vi.fn(async () => { server = stack.pop()!; return server; });
      const layer = new PlanSpaceLayer(plan(), host());
      layer.attachSync({ apply: async () => { throw new Error('single-op path must not be used for a group'); }, undo: async () => { throw new Error('single undo must not be used for a group'); }, applyTransaction, undoTransaction });
      expect(layer.proposeSolverEdit(ops(), 'Ajuste estrutural', 'Solver fixture.')).toBe(true); layer.authorise(true); await layer.applyEdit();
      expect(applyTransaction).toHaveBeenCalledTimes(1); expect(layer.editCount).toBe(1);
      expect(layer.currentPlan.components.find((c) => c.id === 'base')!.transform.scale[0]).toBeCloseTo(1.2);
      expect(await layer.undo()).toBe(true); expect(undoTransaction).toHaveBeenCalledTimes(1);
      expect(layer.currentPlan.components.find((c) => c.id === 'base')!.transform.scale[0]).toBe(1); layer.dispose();
    });
    it('a failed atomic transaction leaves the local plan and history unchanged', async () => {
      const h = host(), layer = new PlanSpaceLayer(plan(), h), before = layer.currentPlan;
      layer.attachSync({ apply: async () => before, undo: async () => before, applyTransaction: async () => { throw new Error('SPATIAL_V2_REVISION_CONFLICT'); } });
      expect(layer.proposeSolverEdit(ops(), 'x', 'y')).toBe(true); layer.authorise(true); await layer.applyEdit();
      expect(layer.currentPlan).toBe(before); expect(layer.editCount).toBe(0);
      expect(h.notify).toHaveBeenCalledWith(expect.stringContaining('SPATIAL_V2_REVISION_CONFLICT')); layer.dispose();
    });
    it('an unresolved transaction blocks every dependent edit and undo until reconciliation adopts the authoritative plan (V4 E0 audit)', async () => {
      const h = host(), layer = new PlanSpaceLayer(plan(), h), before = layer.currentPlan;
      let server = plan(); const stack: SpatialPlanV2[] = [];
      const apply = vi.fn(async (op: SpatialOperationV2, provenance: { origin: 'user_provided' | 'inferred'; evidence: string }) => applySpatialOperationV2(server, op, provenance));
      const applyTransaction = vi.fn(async () => { throw new SpatialTransactionUnresolvedError('session-1', 'txn-fixed-key', 'response-and-recovery-failed'); });
      const reconcileTransaction = vi.fn(async (key: string) => {
        expect(key).toBe(layer.unresolvedTransactionKey);
        stack.push(server); for (const operation of ops()) server = applySpatialOperationV2(server, operation, { origin: 'inferred', evidence: 'reconciled' });
        return server;
      });
      const undoTransaction = vi.fn(async () => { server = stack.pop()!; return server; });
      layer.attachSync({ apply, undo: async () => server, applyTransaction, undoTransaction, reconcileTransaction });
      expect(layer.proposeSolverEdit(ops(), 'x', 'y')).toBe(true); layer.authorise(true); await layer.applyEdit();
      expect(layer.transactionUnresolved).toBe(true); expect(layer.currentPlan).toBe(before); expect(layer.editCount).toBe(0);
      expect(h.notify).toHaveBeenCalledWith(expect.stringContaining('SPATIAL_V2_TRANSACTION_UNRESOLVED'));
      // Dependent edits and undo are blocked while local and remote state may differ.
      layer.highlight('base'); layer.proposeEdit('x+'); await layer.applyEdit();
      expect(apply).not.toHaveBeenCalled(); expect(layer.currentPlan).toBe(before);
      expect(await layer.undo()).toBe(false); expect((await layer.closeGaps()).applied).toBe(0);
      // Reconciliation adopts the authoritative plan as one undoable history entry.
      expect(await layer.reconcileTransaction()).toBe('committed');
      expect(layer.transactionUnresolved).toBe(false); expect(layer.editCount).toBe(1);
      expect(layer.currentPlan.components.find((c) => c.id === 'base')!.transform.scale[0]).toBeCloseTo(1.2);
      expect(await layer.undo()).toBe(true); expect(undoTransaction).toHaveBeenCalledTimes(1); layer.dispose();
    });
    it('repeated reconciliation failure keeps the unresolved state and the block; a later success clears it', async () => {
      const layer = new PlanSpaceLayer(plan(), host()), before = layer.currentPlan;
      let attempts = 0;
      layer.attachSync({
        apply: async () => before, undo: async () => before,
        applyTransaction: async () => { throw new SpatialTransactionUnresolvedError('s', 'k', 'response-and-recovery-failed'); },
        reconcileTransaction: async () => { attempts += 1; if (attempts < 3) throw new SpatialTransactionUnresolvedError('s', 'k', 'response-and-recovery-failed'); return before; },
      });
      expect(layer.proposeSolverEdit(ops(), 'x', 'y')).toBe(true); layer.authorise(true); await layer.applyEdit();
      expect(await layer.reconcileTransaction()).toBe('still-unresolved'); expect(layer.transactionUnresolved).toBe(true);
      expect(await layer.reconcileTransaction()).toBe('still-unresolved'); expect(layer.currentPlan).toBe(before);
      expect(await layer.reconcileTransaction()).toBe('committed'); expect(layer.transactionUnresolved).toBe(false); layer.dispose();
    });
    it('explicit session recovery clears the block without inventing the transaction: the plan stays pre-transaction and editing resumes', async () => {
      const layer = new PlanSpaceLayer(plan(), host()), before = layer.currentPlan;
      layer.attachSync({
        apply: async (op: SpatialOperationV2, provenance) => applySpatialOperationV2(before, op, provenance), undo: async () => before,
        applyTransaction: async () => { throw new SpatialTransactionUnresolvedError('s', 'k', 'session-not-found'); },
        reconcileTransaction: async () => { throw new SpatialTransactionSessionRecoveredError(); },
      });
      expect(layer.proposeSolverEdit(ops(), 'x', 'y')).toBe(true); layer.authorise(true); await layer.applyEdit();
      expect(layer.transactionUnresolved).toBe(true);
      expect(await layer.reconcileTransaction()).toBe('recovered-not-committed');
      expect(layer.transactionUnresolved).toBe(false); expect(layer.currentPlan).toBe(before); expect(layer.editCount).toBe(0);
      layer.highlight('base'); layer.proposeEdit('x+'); await layer.applyEdit();
      expect(layer.currentPlan.components.find((c) => c.id === 'base')!.transform.position[0]).toBeGreaterThan(0); layer.dispose();
    });
    it('a cancelled or replaced proposal never commits when its guard resolves late, and duplicate applies submit once (E1.2 milestone C)', async () => {
      // Cancelled while the guard is in flight.
      const layerA = new PlanSpaceLayer(plan(), host()), beforeA = layerA.currentPlan;
      let releaseA!: (ok: boolean) => void;
      const applyA = vi.fn(async () => beforeA);
      layerA.attachSync({ apply: applyA, undo: async () => beforeA, applyTransaction: applyA as never });
      expect(layerA.proposeSolverEdit(ops(), 'x', 'y', { authorisationGuard: () => new Promise<boolean>((r) => { releaseA = r; }) })).toBe(true);
      layerA.authorise(true);
      const pendingA = layerA.applyEdit();
      layerA.cancelPending();
      releaseA(true);
      await pendingA;
      expect(layerA.currentPlan).toBe(beforeA); expect(layerA.editCount).toBe(0); expect(applyA).not.toHaveBeenCalled(); layerA.dispose();

      // Replaced while the guard is in flight: the old guard resolving must not commit the old ops.
      const layerB = new PlanSpaceLayer(plan(), host()), beforeB = layerB.currentPlan;
      let releaseB!: (ok: boolean) => void;
      const txB = vi.fn(async (operations: SpatialOperationV2[], provenance: { origin: 'user_provided' | 'inferred'; evidence: string }) => { let next = beforeB; for (const operation of operations) next = applySpatialOperationV2(next, operation, provenance); return next; });
      layerB.attachSync({ apply: async () => beforeB, undo: async () => beforeB, applyTransaction: txB as never });
      expect(layerB.proposeSolverEdit(ops(), 'old', 'y', { authorisationGuard: () => new Promise<boolean>((r) => { releaseB = r; }) })).toBe(true);
      layerB.authorise(true);
      const pendingB = layerB.applyEdit();
      expect(layerB.proposeSolverEdit(ops(), 'new', 'y')).toBe(true); // replaces the pending proposal mid-guard
      releaseB(true);
      await pendingB;
      expect(txB).not.toHaveBeenCalled(); expect(layerB.currentPlan).toBe(beforeB);
      expect(layerB.pendingEdit?.label).toBe('new'); // the replacement survives, unapplied
      layerB.authorise(true); await layerB.applyEdit();
      expect(txB).toHaveBeenCalledTimes(1); expect(layerB.editCount).toBe(1); layerB.dispose();

      // Duplicate concurrent applies: one submission only.
      const layerC = new PlanSpaceLayer(plan(), host());
      let releaseC!: (ok: boolean) => void;
      const txC = vi.fn(async (operations: SpatialOperationV2[], provenance: { origin: 'user_provided' | 'inferred'; evidence: string }) => { let next = layerC.currentPlan; for (const operation of operations) next = applySpatialOperationV2(next, operation, provenance); return next; });
      layerC.attachSync({ apply: async () => layerC.currentPlan, undo: async () => layerC.currentPlan, applyTransaction: txC as never });
      expect(layerC.proposeSolverEdit(ops(), 'x', 'y', { authorisationGuard: () => new Promise<boolean>((r) => { releaseC = r; }) })).toBe(true);
      layerC.authorise(true);
      const first = layerC.applyEdit(), second = layerC.applyEdit();
      releaseC(true);
      await Promise.all([first, second]);
      expect(txC).toHaveBeenCalledTimes(1); expect(layerC.editCount).toBe(1); layerC.dispose();
    });
    it('an authorised solver proposal keeps inferred provenance and records authorisation separately (E1.2 milestone B)', async () => {
      const seen: Array<{ origin: string; evidence: string }> = [];
      const layer = new PlanSpaceLayer(plan(), host());
      layer.attachSync({
        apply: async (op: SpatialOperationV2, provenance) => { seen.push(provenance); return applySpatialOperationV2(layer.currentPlan, op, provenance); },
        undo: async () => layer.currentPlan,
        applyTransaction: async (operations: SpatialOperationV2[], provenance) => { seen.push(provenance); let next = layer.currentPlan; for (const operation of operations) next = applySpatialOperationV2(next, operation, provenance); return next; },
      });
      expect(layer.proposeSolverEdit(ops(), 'Ajuste', 'Solver fitted 6 silhouettes.')).toBe(true);
      layer.authorise(true); await layer.applyEdit();
      expect(seen[0]!.origin).toBe('inferred');
      expect(seen[0]!.evidence).toMatch(/Solver fitted 6 silhouettes/);
      expect(seen[0]!.evidence).toMatch(/Authorisation: a person authorised/);
      expect(seen[0]!.evidence).toMatch(/not authenticated/i);
      expect(layer.currentPlan.components.find((c) => c.id === 'base')!.provenance.transform).toBe('inferred');
      layer.dispose();
    });
    it('a proposal whose authorisation guard fails at apply time is never applied (review changed after preview, E1.1 test 7)', async () => {
      const h = host(), layer = new PlanSpaceLayer(plan(), h), before = layer.currentPlan;
      let guardOk = true;
      expect(layer.proposeSolverEdit(ops(), 'x', 'y', { authorisationGuard: async () => guardOk })).toBe(true);
      layer.authorise(true);
      guardOk = false; // the review changed between preview and authorisation
      await layer.applyEdit();
      expect(layer.currentPlan).toBe(before); expect(layer.editCount).toBe(0);
      expect(h.notify).toHaveBeenCalledWith(expect.stringContaining('invalidada'));
      // With the guard passing, the same flow applies.
      expect(layer.proposeSolverEdit(ops(), 'x', 'y', { authorisationGuard: async () => true })).toBe(true);
      layer.authorise(true); await layer.applyEdit();
      expect(layer.editCount).toBe(1); layer.dispose();
    });
    it('does not rebuild when disposed while a grouped transaction is pending', async () => {
      const layer = new PlanSpaceLayer(plan(), host()); const before = layer.currentPlan;
      let release!: (p: SpatialPlanV2) => void;
      layer.attachSync({ apply: async () => before, undo: async () => before, applyTransaction: () => new Promise((resolve) => { release = resolve; }) });
      expect(layer.proposeSolverEdit(ops(), 'x', 'y')).toBe(true); layer.authorise(true);
      const pending = layer.applyEdit(); layer.dispose(); release(plan());
      await pending; expect(layer.root.children).toHaveLength(0); expect(layer.currentPlan).toBe(before);
    });
  });
});
