import { describe, it, expect } from 'vitest';
import { EXCAVATOR_ASSEMBLY_V1 } from '../src/living/contracts/fixtures/excavator.assembly.v1';
import { validateAssembly } from '../src/living/contracts';
import {
  buildLivingScene, entityById, LivingMotionEngine, parseIntent, validateCommand, actuatorTargetFor,
  explainEntity, whoMoves, buildWalkthrough, WalkthroughPlayer, excavatorExperiments,
  WHEEL_STEERING_ASSEMBLY, DOOR_ASSEMBLY, FIXTURE_PROVENANCE, gearPairBehaviour, hydraulicForce,
  serializeScenario, parseScenario, livingIntelligenceEnabled,
} from '../src/living/living-intelligence';

const scene = buildLivingScene(EXCAVATOR_ASSEMBLY_V1);

describe('LivingScene (A)', () => {
  it('liga entidades, hierarquia, actuadores e capacidades sem inventar estrutura', () => {
    expect(scene.schema).toBe('unfold.living-scene.v1');
    const boom = entityById(scene, 'boom')!;
    expect(boom.parentId).toBe('upper_body');
    expect(boom.childIds).toContain('stick');
    expect(boom.capabilities[0]).toMatchObject({ jointId: 'boom_joint', kind: 'revolute', status: 'supported' });
    const cyl = entityById(scene, 'boom_cylinder')!;
    expect(cyl.parameters.find(p => p.id.endsWith('.pressure'))).toMatchObject({ value: null, status: 'unknown' });
    expect(scene.evidenceLevel).toBe('kinematically_valid');
    expect(scene.unavailable.length).toBeGreaterThan(0);
  });
  it('rejeita montagem inválida', () => {
    expect(() => buildLivingScene({ ...EXCAVATOR_ASSEMBLY_V1, id: 'bad id!' } as never)).toThrow(/LIVING_SCENE_INVALID/);
  });
});

describe('MotionEngine (B/K)', () => {
  it('movimento ligado: cilindro da lança roda a lança e os descendentes acompanham, com fecho de laço', () => {
    const e = new LivingMotionEngine(EXCAVATOR_ASSEMBLY_V1);
    const before = e.frame();
    expect(e.moveToActuators({ boom_cylinder: 0.65 }, 2).ok).toBe(true);
    e.step(10); // além do fim: clamp determinístico
    const after = e.frame();
    const boomAngle = (f: typeof before) => f.joints.find(j => j.jointId === 'boom_joint')!.value;
    expect(boomAngle(after)).not.toBeCloseTo(boomAngle(before), 6);
    const pos = (f: typeof before, id: string) => f.parts.find(p => p.partId === id)!.translationM;
    expect(pos(after, 'bucket')).not.toEqual(pos(before, 'bucket'));
    expect(pos(after, 'chassis')).toEqual(pos(before, 'chassis'));
    expect(e.closureOk()).toBe(true);
    expect(e.closureResidualM()).toBeLessThanOrEqual(1e-6);
  });
  it('limites: curso fora do intervalo e actuador desconhecido são recusados (fail-closed)', () => {
    const e = new LivingMotionEngine(EXCAVATOR_ASSEMBLY_V1);
    expect(e.moveToActuators({ boom_cylinder: 99 })).toMatchObject({ ok: false, code: 'STROKE_OUT_OF_RANGE' });
    expect(e.moveToActuators({ nope: 1 })).toMatchObject({ ok: false, code: 'UNKNOWN_ACTUATOR' });
  });
  it('determinismo, pausa/retoma/inversão/reposição e velocidade', () => {
    const run = () => { const e = new LivingMotionEngine(EXCAVATOR_ASSEMBLY_V1); e.moveToActuators({ stick_cylinder: 0.6 }, 2); e.step(0.5); return e.configuration(); };
    expect(run()).toEqual(run());
    const e = new LivingMotionEngine(EXCAVATOR_ASSEMBLY_V1);
    e.moveToActuators({ stick_cylinder: 0.6 }, 2);
    e.step(0.5); const t1 = e.currentTimeS; e.pause(); e.step(0.5); expect(e.currentTimeS).toBe(t1);
    e.resume(); e.step(0.5); expect(e.currentTimeS).toBeGreaterThan(t1);
    e.reverse(); e.step(0.25); expect(e.currentTimeS).toBeLessThan(1);
    e.setSpeed(2); const t2 = e.currentTimeS; e.play(); e.step(0.1); expect(e.currentTimeS).toBeCloseTo(t2 + 0.2, 6);
    e.reset(); expect(e.currentTimeS).toBe(0); expect(e.configuration()).toEqual(new LivingMotionEngine(EXCAVATOR_ASSEMBLY_V1).configuration());
  });
  it('reduced motion: salta para o fim sem animação intermédia', () => {
    const e = new LivingMotionEngine(EXCAVATOR_ASSEMBLY_V1, { reducedMotion: true });
    e.moveToActuators({ boom_cylinder: 0.65 }); expect(e.state).toBe('finished'); expect(e.progress).toBe(1);
  });
  it('cancelamento e substituição de cena invalidam gerações; disposed rejeita', () => {
    const e = new LivingMotionEngine(EXCAVATOR_ASSEMBLY_V1);
    e.moveToActuators({ boom_cylinder: 0.65 }); const gen = e.generationToken;
    e.cancel(); expect(() => e.frame(gen)).toThrow(/STALE|DISPOSED/);
    e.replaceAssembly(WHEEL_STEERING_ASSEMBLY); expect(e.frame().assemblyId).toBe(WHEEL_STEERING_ASSEMBLY.id);
    e.dispose(); expect(e.moveToActuators({ wheel_drive: 1 })).toMatchObject({ ok: false, code: 'DISPOSED' });
    expect(() => e.frame()).toThrow(/DISPOSED/);
  });
});

describe('Comportamentos e multi-domínio (C/I)', () => {
  it('roda/direcção e porta são montagens válidas movidas pelo mesmo motor FK', () => {
    for (const a of [WHEEL_STEERING_ASSEMBLY, DOOR_ASSEMBLY]) expect(validateAssembly(a).ok).toBe(true);
    const wheel = new LivingMotionEngine(WHEEL_STEERING_ASSEMBLY);
    expect(wheel.moveToActuators({ steering_drive: 0.5, wheel_drive: 2 }, 1).ok).toBe(true);
    wheel.step(5);
    const f = wheel.frame(); expect(f.status).toBe('ok');
    expect(f.joints.find(j => j.jointId === 'wheel_spin')!.value).toBeGreaterThan(0);
    const door = new LivingMotionEngine(DOOR_ASSEMBLY);
    expect(door.moveToActuators({ door_manual: 1.2 }, 1).ok).toBe(true); door.step(5);
    expect(door.frame().joints.find(j => j.jointId === 'door_hinge')!.value).toBeCloseTo(1.2, 3);
    expect(door.moveToActuators({ door_manual: 9 })).toMatchObject({ ok: false });
  });
  it('engrenagem: adaptador com razão declarada, sem fingir contacto físico', () => {
    const g = gearPairBehaviour('g', 'Par 12:36', 12, 36);
    expect(g.outputAngleRad(3)).toBeCloseTo(-1, 9);
    expect(g.evidenceLevel).toBe('mechanically_plausible');
  });
  it('força hidráulica: só calcula com pressão e diâmetro; senão conceptual', () => {
    expect(hydraulicForce(10_000_000, 0.1)).toMatchObject({ kind: 'calculated' });
    expect(hydraulicForce(null, null)).toMatchObject({ kind: 'conceptual_normalised', forceN: null });
  });
});

describe('Tutor e walkthrough (F)', () => {
  it('explicação ancorada na cena real, com dependências e desconhecidos', () => {
    const ex = explainEntity(scene, EXCAVATOR_ASSEMBLY_V1, 'boom', 'beginner')!;
    expect(ex.entityId).toBe('boom'); expect(ex.what).toMatch(/lança/i); expect(ex.purpose).toMatch(/braço/i);
    expect(ex.dependencies.join(' ')).toMatch(/cilindro da lança|corpo/i);
    expect(explainEntity(scene, EXCAVATOR_ASSEMBLY_V1, 'fantasma')).toBeNull();
    const tech = explainEntity(scene, EXCAVATOR_ASSEMBLY_V1, 'boom_cylinder', 'technical')!;
    expect(tech.howItWorks).toMatch(/kinematically|cinemática/i);
    expect(tech.unknowns.length).toBeGreaterThan(0);
  });
  it('quem move a lança é o cilindro da lança', () => {
    expect(whoMoves(scene, EXCAVATOR_ASSEMBLY_V1, 'boom')!.movers.join(' ')).toMatch(/boom_cylinder/);
  });
  it('walkthrough progride, pausa e repete com passos ancorados', () => {
    const w = new WalkthroughPlayer(buildWalkthrough(scene, EXCAVATOR_ASSEMBLY_V1));
    expect(w.walkthrough.steps.length).toBeGreaterThanOrEqual(5);
    for (const s of w.walkthrough.steps) expect(entityById(scene, s.entityId)).not.toBeNull();
    const first = w.current(); w.next(); expect(w.current()!.index).toBe(first!.index + 1);
    w.pause(); expect(w.paused).toBe(true); w.restart(); expect(w.index).toBe(0);
  });
});

describe('Intérprete offline (E/J)', () => {
  it('mapeia comandos PT/EN para IDs reais e valida fail-closed', () => {
    expect(parseIntent(scene, 'Mostra o cilindro hidráulico')).toMatchObject({ type: 'show' });
    expect(parseIntent(scene, 'O que faz a lança?')).toMatchObject({ type: 'explain', entityId: 'boom' });
    expect(parseIntent(scene, 'Estende o pistão')).toMatchObject({ type: 'move_actuator', direction: 'extend' });
    expect(parseIntent(scene, 'Para a animação')).toMatchObject({ type: 'playback', action: 'stop' });
    expect(parseIntent(scene, 'Repõe a máquina')).toMatchObject({ type: 'playback', action: 'reset' });
    expect(parseIntent(scene, 'Que componente move a lança?')).toMatchObject({ type: 'who_moves', entityId: 'boom' });
    expect(parseIntent(scene, 'Explain the bucket step by step')).toBeTruthy();
    expect(validateCommand(scene, EXCAVATOR_ASSEMBLY_V1, { type: 'show', entityId: 'fantasma' }, scene.sourceRevision)).toMatchObject({ ok: false, code: 'UNKNOWN_COMPONENT' });
    expect(validateCommand(scene, EXCAVATOR_ASSEMBLY_V1, { type: 'show', entityId: 'boom' }, 'revisão-velha')).toMatchObject({ ok: false, code: 'STALE_SCENE' });
    expect(parseIntent(scene, 'Apaga o plano')).toMatchObject({ type: 'unsupported' });
    expect(parseIntent(scene, 'E se eu mudar o comprimento do braço?')).toMatchObject({ type: 'propose_parameter' });
    expect(actuatorTargetFor(EXCAVATOR_ASSEMBLY_V1, 'boom_cylinder', 1)).toBeCloseTo(0.76, 9);
  });
});

describe('Experiências (D/G)', () => {
  it('as três experiências da escavadora produzem antes/depois explicáveis e repetíveis', () => {
    const exps = excavatorExperiments(EXCAVATOR_ASSEMBLY_V1, FIXTURE_PROVENANCE);
    expect(exps).toHaveLength(3);
    const r1 = exps[0]!.run({ strokeM: 0.55 }); expect(r1.ok).toBe(true);
    if (r1.ok) { expect(r1.after.boomAngleRad).not.toBeCloseTo(r1.before.boomAngleRad!, 6); expect(r1.kind).toBe('conceptual'); }
    const r2 = exps[1]!.run({ strokeM: 0.55 }); expect(r2.ok && r2.after.reachM !== r2.before.reachM).toBe(true);
    const r3a = exps[2]!.run({ offsetM: 0.1 }); const r3b = exps[2]!.run({ offsetM: 0.1 });
    expect(r3a).toEqual(r3b);
    const snapshot = JSON.stringify(EXCAVATOR_ASSEMBLY_V1);
    exps[2]!.run({ offsetM: 0.2 });
    expect(JSON.stringify(EXCAVATOR_ASSEMBLY_V1)).toBe(snapshot); // experiência nunca muta a montagem
  });
});

describe('Cenário guardado/reaberto e flag (K/J)', () => {
  it('serializa, valida assembly e rejeita lixo', () => {
    const raw = serializeScenario({ assemblyId: 'a1', actuatorValues: { boom_cylinder: 0.3 }, experimentId: null, experimentInput: {}, walkthroughStep: 2 });
    expect(parseScenario(raw, 'a1')?.actuatorValues.boom_cylinder).toBe(0.3);
    expect(parseScenario(raw, 'outra')).toBeNull();
    expect(parseScenario('{lixo', 'a1')).toBeNull();
    expect(parseScenario(null, 'a1')).toBeNull();
  });
  it('flag experimental nunca activa por omissão', () => {
    expect(livingIntelligenceEnabled(new URLSearchParams('debug-living=1'))).toBe(false);
    expect(livingIntelligenceEnabled(new URLSearchParams('experimental-living-intelligence=1'))).toBe(true);
  });
});
