import { describe, expect, it, vi } from 'vitest';
import { Raycaster, Vector2, PerspectiveCamera } from 'three';
import { validateSpatialPlanV2, type SpatialPlanV2 } from '../src/universal-spatial/contracts-v2';
import { PlanSpaceLayer } from '../src/living/spatial-space/layer';

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
const host = () => ({ changed: vi.fn(), redraw: vi.fn(), notify: vi.fn() });

describe('PlanSpaceLayer', () => {
  it('previews a nudge, applies it through the typed operation as user_provided, and undoes it', () => {
    const h = host(), layer = new PlanSpaceLayer(plan(), h);
    layer.highlight('base');
    for (const code of ['x+', 'x-', 'y+', 'y-', 'z+', 'z-', 'scale-up', 'scale-down']) {
      layer.proposeEdit(code);
      expect(layer.pendingEdit, code).not.toBeNull();
      layer.applyEdit();
      expect(h.notify, code).not.toHaveBeenCalledWith(expect.stringMatching(/bloqueada/));
      expect(layer.undo(), code).toBe(true);
    }
    layer.proposeEdit('x+'); layer.applyEdit();
    const moved = layer.currentPlan.components.find((c) => c.id === 'base')!;
    expect(moved.transform.position[0]).toBeGreaterThan(0);
    expect(moved.provenance.transform).toBe('user_provided');
    expect(layer.undo()).toBe(true);
    expect(layer.currentPlan.components.find((c) => c.id === 'base')!.transform.position).toEqual([0, 0.5, 0]);
    layer.dispose();
  });

  it('refuses to touch a user-provided or observed value without an explicit authorisation', () => {
    const h = host(), layer = new PlanSpaceLayer(plan(), h);
    layer.highlight('side'); layer.proposeEdit('y+');
    expect(layer.pendingEdit?.needsAuthorization).toBe(true);
    layer.applyEdit();
    expect(layer.canUndo).toBe(false);
    expect(h.notify).toHaveBeenCalledWith(expect.stringMatching(/autoriza/));
    layer.authorise(true); layer.applyEdit();
    expect(layer.canUndo).toBe(true);
    layer.dispose();
  });

  it('colour edits go through set-material for every shape of the component', () => {
    const layer = new PlanSpaceLayer(plan(), host());
    layer.highlight('top'); layer.proposeColour('#2d6cdf'); layer.applyEdit();
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

  it('keeps the presentation scale fixed across edits so the object does not jump', () => {
    const layer = new PlanSpaceLayer(plan(), host());
    const before = layer.root.children[0]!.scale.x;
    layer.highlight('top'); layer.proposeEdit('y+'); layer.applyEdit();
    expect(layer.root.children[0]!.scale.x).toBe(before);
    layer.dispose();
  });
});
