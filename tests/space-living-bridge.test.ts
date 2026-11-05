import { describe, it, expect, vi } from 'vitest';
import { Quaternion, type Object3D } from 'three';
import { validateSpatialPlanV2 } from '../src/universal-spatial/contracts-v2';
import { PlanSpaceLayer } from '../src/living/spatial-space/layer';
import { buildSpaceLivingScene, explainSpaceComponent, SpaceMotionController, doorSpacePlanFixture, CONCEPTUAL_DEMO_RANGE_RAD } from '../src/living/living-intelligence/space-bridge';
import { sedan } from '../src/living/universal-foundry/fixtures/plans';

const host = () => ({ changed: vi.fn(), redraw: vi.fn(), notify: vi.fn(), syncLost: vi.fn() });
const doorPlan = () => validateSpatialPlanV2(doorSpacePlanFixture('a'.repeat(64)));

function groupOf(root: Object3D, id: string): Object3D {
  let found: Object3D | null = null;
  root.traverse((o) => { if (o.userData.spatialComponentRoot && o.userData.spatialEntityId === id) found = o; });
  return found!;
}

describe('Space → LivingScene bridge', () => {
  it('resolve identidades, fonte e fingerprint; articulação inferida só com evidência no plano', () => {
    const plan = doorPlan();
    const scene = buildSpaceLivingScene(plan, 'f'.repeat(64));
    expect(scene.sourceSha256).toBe('a'.repeat(64));
    expect(scene.planFingerprint).toBe('f'.repeat(64));
    const leaf = scene.entities.find((e) => e.id === 'door-leaf')!;
    expect(leaf.parentId).toBe('door-frame');
    expect(leaf.capability).toMatchObject({ kind: 'revolute', status: 'inferred', axis: 'y', limits: null });
    const frame = scene.entities.find((e) => e.id === 'door-frame')!;
    expect(frame.capability.kind).not.toBe('revolute');
    expect(scene.motionSupported).toBe(true);
    expect(scene.missingForMotion.join(' ')).toMatch(/limite/);
  });
  it('plano sem articulação: movimento indisponível e a cena diz o que falta (sem fabricar juntas)', () => {
    const plan = sedan();
    const scene = buildSpaceLivingScene(plan, 'e'.repeat(64));
    // sedan é um plano V2 de texto com rodas rotuladas: rodas têm capacidade inferida; o corpo não
    const body = scene.entities.find((e) => /body/i.test(e.label))!;
    expect(body.capability.kind).not.toBe('revolute');
    const explanation = explainSpaceComponent(scene, plan, body.id)!;
    expect(explanation).toMatch(/Desconhecido|desconhecido|origem/);
    // nenhum componente ganha limites fabricados
    for (const e of scene.entities) if (e.capability.kind === 'revolute') expect(e.capability.limits).toBeNull();
  });
  it('explicação ancorada cita relações, proveniência e unknowns do próprio plano', () => {
    const plan = doorPlan();
    const scene = buildSpaceLivingScene(plan, 'f'.repeat(64));
    const text = explainSpaceComponent(scene, plan, 'door-leaf')!;
    expect(text).toMatch(/door-hinge/);
    expect(text).toMatch(/fixture/);
    expect(text).toMatch(/inferida/);
    expect(explainSpaceComponent(scene, plan, 'fantasma')).toBeNull();
  });
  it('poses transitórias movem o grupo real do componente e Repor restaura exactamente; o plano não muda', () => {
    const plan = doorPlan();
    const before = JSON.stringify(plan);
    const layer = new PlanSpaceLayer(plan, host());
    const leaf = groupOf(layer.root, 'door-leaf');
    const original = leaf.quaternion.clone();
    expect(layer.applyTransientRotation('door-leaf', 0.6, 'y')).toBe(true);
    expect(leaf.quaternion.angleTo(original)).toBeCloseTo(0.6, 5);
    expect(layer.applyTransientRotation('fantasma', 0.6, 'y')).toBe(false);
    layer.clearTransientPoses();
    expect(leaf.quaternion.equals(original)).toBe(true);
    expect(JSON.stringify(plan)).toBe(before);
    layer.regenerate(); // rebuild limpa poses transitórias
    expect(layer.applyTransientRotation('door-leaf', 0.3, 'y')).toBe(true);
    layer.dispose();
  });
  it('controlador de movimento: determinístico, limitado à amplitude conceptual e stale-safe', () => {
    const run = () => { const c = new SpaceMotionController(); c.start(CONCEPTUAL_DEMO_RANGE_RAD, CONCEPTUAL_DEMO_RANGE_RAD); c.step(0.8); return c.angleRad; };
    expect(run()).toEqual(run());
    const c = new SpaceMotionController();
    const token = c.token;
    c.start(99, CONCEPTUAL_DEMO_RANGE_RAD); // alvo absurdo é limitado à amplitude conceptual
    c.step(10);
    expect(c.angleRad).toBeCloseTo(CONCEPTUAL_DEMO_RANGE_RAD, 6);
    c.reset(); expect(c.angleRad).toBe(0);
    expect(() => c.step(0.1, token)).toThrow(/STALE/);
  });
  it('Quaternion sanity (guard de regressão do helper)', () => {
    expect(new Quaternion().angleTo(new Quaternion())).toBe(0);
  });
});
