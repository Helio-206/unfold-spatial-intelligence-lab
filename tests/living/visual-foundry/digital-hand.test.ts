import { beforeAll, describe, expect, it } from 'vitest';
import { Mesh, PerspectiveCamera, Quaternion, Vector3, type Object3D } from 'three';
import { EXCAVATOR_ASSEMBLY_V1 } from '../../../src/living/contracts/fixtures/excavator.assembly.v1';
import { buildComponentRegistry, type CanonicalComponent } from '../../../src/living/visual-foundry/component-registry';
import { buildExcavator, type ExcavatorModel } from '../../../src/living/visual-foundry/excavator/build';
import { createMaterialLibrary } from '../../../src/living/visual-foundry/materials';
import { framePoses, loadFixturePreview, referencePoses } from '../../../src/living/visual-foundry/poses';
import { DigitalHand, occlusion, partIdOf, projectToScreen, resolveTarget, uncertaintyLabel } from '../../../src/living/workspace-design/digital-hand';

const registry = buildComponentRegistry(EXCAVATOR_ASSEMBLY_V1);
let model: ExcavatorModel;
let meshes: Object3D[];
const viewport = { width: 1600, height: 1000 };
const camera = (pos: [number, number, number], target: [number, number, number]) => {
  const c = new PerspectiveCamera(30, viewport.width / viewport.height, 0.1, 400);
  c.position.set(...pos); c.lookAt(new Vector3(...target)); c.updateMatrixWorld(); c.updateProjectionMatrix();
  return c;
};

beforeAll(() => {
  model = buildExcavator(EXCAVATOR_ASSEMBLY_V1, createMaterialLibrary());
  model.applyPoses(referencePoses().poses);
  model.root.updateMatrixWorld(true);
  meshes = [];
  model.root.traverse((o) => { if ((o as Mesh).isMesh && partIdOf(o)) meshes.push(o); });
});

describe('digital hand target resolution', () => {
  it('resolves a cylinder by canonical id to the midpoint of its two canonical pins', () => {
    const r = resolveTarget('boom_cylinder', registry, model.parts);
    expect(r.status).toBe('resolved');
    if (r.status !== 'resolved') return;
    const ref = referencePoses().poses;
    const barrel = ref.find((p) => p.partId === 'boom_cyl_barrel')!.translationM, rod = ref.find((p) => p.partId === 'boom_cyl_rod')!.translationM;
    expect(r.anchorWorld.x).toBeCloseTo((barrel[0] + rod[0]) / 2, 9);
    expect(r.anchorWorld.y).toBeCloseTo((barrel[1] + rod[1]) / 2, 9);
    expect(r.component.partIds).toEqual(['boom_cyl_barrel', 'boom_cyl_rod']);
  });

  it('never resolves an unknown id', () => {
    const r = resolveTarget('hydraulic_pump', registry, model.parts);
    expect(r.status).toBe('missing');
    const hand = new DigitalHand(registry, model.parts);
    hand.attend('hydraulic_pump');
    expect(hand.state).toBe('blocked');
    const v = hand.view(camera([12, 4, -10], [2, 1.5, 0]), viewport, { top: 0, right: 0, bottom: 0, left: 0 }, meshes);
    expect(v.x).toBeNull();
    expect(v.problem).toMatch(/Não existe/);
  });

  it('follows changing assembly transforms (fixture frame moves the anchor with the parts)', () => {
    const before = (resolveTarget('stick_cylinder', registry, model.parts) as { anchorWorld: Vector3 }).anchorWorld.clone();
    const preview = loadFixturePreview();
    model.applyPoses(framePoses(preview.frames.at(-1)!));
    model.root.updateMatrixWorld(true);
    const after = (resolveTarget('stick_cylinder', registry, model.parts) as { anchorWorld: Vector3 }).anchorWorld;
    expect(after.distanceTo(before)).toBeGreaterThan(0.5);
    model.applyPoses(referencePoses().poses);
    model.root.updateMatrixWorld(true);
  });

  it('maps display meshes to canonical part ids and treats hoses as display-only', () => {
    let hoses = 0, canonical = 0;
    model.root.traverse((o) => { if (!(o as Mesh).isMesh) return; if (o.userData.displayOnly) { hoses++; expect(partIdOf(o)).toBeNull(); } else { canonical++; expect(registry.get(partIdOf(o)!)).toBeDefined(); } });
    expect(hoses).toBeGreaterThan(0);
    expect(canonical).toBeGreaterThan(20);
  });
});

describe('world-to-screen projection', () => {
  it('projects a point in front of the camera inside the viewport', () => {
    const c = camera([0, 0, 10], [0, 0, 0]);
    const p = projectToScreen(new Vector3(0, 0, 0), c, viewport);
    expect(p.onScreen).toBe(true);
    expect(p.x).toBeCloseTo(800, 6);
    expect(p.y).toBeCloseTo(500, 6);
  });

  it('flags points behind the camera and gives an edge indicator inside the safe area', () => {
    const c = camera([0, 0, 10], [0, 0, 0]);
    const safe = { top: 64, right: 24, bottom: 100, left: 72 };
    const p = projectToScreen(new Vector3(2, 0, 20), c, viewport, safe);
    expect(p.behind).toBe(true);
    expect(p.onScreen).toBe(false);
    expect(p.edge).not.toBeNull();
    expect(p.edge!.x).toBeGreaterThanOrEqual(safe.left);
    expect(p.edge!.x).toBeLessThanOrEqual(viewport.width - safe.right);
    expect(p.edge!.y).toBeGreaterThanOrEqual(safe.top);
    expect(p.edge!.y).toBeLessThanOrEqual(viewport.height - safe.bottom);
  });

  it('treats points under the composer as off the usable area', () => {
    const c = camera([0, 0, 10], [0, 0, 0]);
    const p = projectToScreen(new Vector3(0, -2.4, 0), c, viewport, { top: 0, right: 0, bottom: 300, left: 0 });
    expect(p.onScreen).toBe(false);
  });
});

describe('occlusion and uncertainty', () => {
  it('reports the boom cylinder occluded from behind the counterweight and visible from the front', () => {
    const r = resolveTarget('boom_cylinder', registry, model.parts);
    if (r.status !== 'resolved') throw new Error('unresolved');
    const back = occlusion(r.anchorWorld, r.component.partIds, camera([-12, 1.4, 0], [1.5, 1.4, 0]), meshes);
    expect(back.status).toBe('occluded');
    expect(back.blockerPartId).toBe('upper_body');
    const front = occlusion(r.anchorWorld, r.component.partIds, camera([10, 1.2, -9], [1.5, 1.2, 0]), meshes);
    expect(front.status).toBe('visible');
  });

  it('labels fixture, reconstructed and confirmed components without upgrading them', () => {
    const base = registry.get('boom_cylinder')!;
    expect(uncertaintyLabel(base)).toEqual({ text: 'fixture · não verificado', uncertain: true });
    const reconstructed: CanonicalComponent = { ...base, origin: 'model_inferred', validation: 'unreviewed' };
    expect(uncertaintyLabel(reconstructed).text).toBe('reconstruído · não verificado');
    const confirmed: CanonicalComponent = { ...base, origin: 'human_entered', validation: 'verified' };
    expect(uncertaintyLabel(confirmed).uncertain).toBe(false);
  });

  it('keeps a usable reticle size for small parts', () => {
    const hand = new DigitalHand(registry, model.parts);
    hand.attend('bucket_link', 'point');
    const v = hand.view(camera([40, 8, -40], [4, 1.5, 0]), viewport, { top: 0, right: 0, bottom: 0, left: 0 }, meshes);
    expect(v.radiusPx).toBeGreaterThanOrEqual(14);
  });

  it('distinguishes observing, suggesting and blocked states by shape label, not colour', async () => {
    const { HAND_AGENCY, HAND_STATE_LABEL } = await import('../../../src/living/workspace-design/digital-hand');
    expect(HAND_AGENCY.point).toBe('observing');
    expect(HAND_AGENCY.awaiting).toBe('suggesting');
    expect(HAND_STATE_LABEL.blocked).toBe('bloqueado');
    expect(new Set(Object.values(HAND_STATE_LABEL)).size).toBe(Object.keys(HAND_STATE_LABEL).length);
  });
});

void Quaternion;
