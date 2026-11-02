import { describe, expect, it } from 'vitest';
import { canonicalize } from '../../src/core';
import { AssemblyContractError, validateMotionFrame, type Assembly } from '../../src/living/contracts';
import { EXCAVATOR_ASSEMBLY_V1 } from '../../src/living/contracts/fixtures/excavator.assembly.v1';
import { evaluateReferencePose } from '../../src/living/engineering/engine';
import { quatAngle } from '../../src/living/engineering/transform-math';
import type { MotionFrame } from '../../src/living/contracts';
import {
  closeEngineeringSession, commandMove, createEngineeringSession, createPlayback, evaluateParameterChange, pause, play, samplePlayback, sampleEngineeringMotion, seek, advance,
} from '../../src/living/engineering/runtime';

const clone = (): Assembly => structuredClone(EXCAVATOR_ASSEMBLY_V1);
const provenance = { origin: 'human_entered' as const, validation: 'unreviewed' as const, recordedAt: '2026-11-02T12:00:00.000Z', actor: { kind: 'human' as const, id: 'local-user' } };
/** Duas quadros são iguais a menos do arredondamento de ponto flutuante (1e-12 m e rad): caminhos de cálculo diferentes. */
const framesClose = (a: MotionFrame, b: MotionFrame, tol = 1e-12) => {
  expect(a.parts.map((p) => p.partId)).toEqual(b.parts.map((p) => p.partId));
  a.parts.forEach((p, i) => {
    p.translationM.forEach((v, k) => expect(Math.abs(v - b.parts[i]!.translationM[k]!), `${p.partId} t${k}`).toBeLessThan(tol));
    expect(quatAngle(p.rotation, b.parts[i]!.rotation), p.partId).toBeLessThan(tol);
  });
  a.actuators.forEach((x, i) => expect(Math.abs(x.value - b.actuators[i]!.value), x.actuatorId).toBeLessThan(tol));
};
const actuatorValue = (frame: { actuators: Array<{ actuatorId: string; value: number }> }, id: string) => frame.actuators.find((a) => a.actuatorId === id)!.value;

describe('sessão: criação, validação e não mutação', () => {
  it('uma montagem inválida não cria sessão', () => {
    const bad = clone(); (bad as { schema: string }).schema = 'x';
    expect(() => createEngineeringSession(bad)).toThrow(AssemblyContractError);
  });

  it('o instante zero é a pose de referência (as mesmas transformações da avaliação directa)', () => {
    const session = createEngineeringSession(EXCAVATOR_ASSEMBLY_V1);
    const at0 = sampleEngineeringMotion(session, 0);
    const reference = evaluateReferencePose(EXCAVATOR_ASSEMBLY_V1);
    framesClose(at0, reference);
    expect(validateMotionFrame(at0)).toEqual({ ok: true, issues: [] });
  });

  it('comandos e amostragens não mudam a montagem de entrada', () => {
    const copy = clone(); const before = canonicalize(copy);
    const session = createEngineeringSession(copy);
    const moved = commandMove(session, { targets: { boom_cylinder: 0.65 } });
    expect(moved.ok).toBe(true);
    if (moved.ok) sampleEngineeringMotion(moved.session, moved.durationS / 2);
    expect(canonicalize(copy)).toBe(before);
  });
});

describe('comandos: recusas explícitas, duração pela velocidade máxima, interpolação linear', () => {
  it('um actuador desconhecido é recusado', () => {
    const r = commandMove(createEngineeringSession(EXCAVATOR_ASSEMBLY_V1), { targets: { lixo: 1 } });
    expect(r).toMatchObject({ ok: false, code: 'COMMAND_UNKNOWN_ACTUATOR' });
  });

  it('um alvo não finito é recusado', () => {
    const r = commandMove(createEngineeringSession(EXCAVATOR_ASSEMBLY_V1), { targets: { boom_cylinder: Number.NaN } });
    expect(r).toMatchObject({ ok: false, code: 'COMMAND_INVALID_TARGET' });
  });

  it('um comando sem alteração é recusado, e uma duração não positiva também', () => {
    const session = createEngineeringSession(EXCAVATOR_ASSEMBLY_V1);
    expect(commandMove(session, { targets: {} })).toMatchObject({ ok: false, code: 'COMMAND_NO_CHANGE' });
    expect(commandMove(session, { targets: { boom_cylinder: 0.65 }, durationS: 0 })).toMatchObject({ ok: false, code: 'COMMAND_INVALID_DURATION' });
  });

  it('um alvo que a configuração não aceita (curso acima do máximo) é recusado com o código do bloqueio', () => {
    const r = commandMove(createEngineeringSession(EXCAVATOR_ASSEMBLY_V1), { targets: { boom_cylinder: 0.9 } });
    expect(r).toMatchObject({ ok: false, code: 'TARGET_BLOCKED', blockedCode: 'STROKE_OUT_OF_RANGE' });
  });

  it('sem velocidade máxima conhecida e sem duração dada, o comando é recusado (não se inventa a duração)', () => {
    const a = clone();
    (a.actuators.find((x) => x.id === 'swing_drive') as unknown as { maxRate: unknown }).maxRate = null;
    const r = commandMove(createEngineeringSession(a), { targets: { swing_drive: 0.3 } });
    expect(r).toMatchObject({ ok: false, code: 'COMMAND_NO_RATE' });
  });

  it('a duração é o maior tempo entre actuadores à velocidade máxima: (alvo − referência) / velocidade', () => {
    const cylinder = EXCAVATOR_ASSEMBLY_V1.actuators.find((a) => a.id === 'boom_cylinder') as { referenceStroke: { value: number }; maxRate: { value: number } };
    const r = commandMove(createEngineeringSession(EXCAVATOR_ASSEMBLY_V1), { targets: { boom_cylinder: 0.65 } });
    if (!r.ok) throw new Error(r.message);
    expect(r.durationS).toBeCloseTo((0.65 - cylinder.referenceStroke.value) / cylinder.maxRate.value, 12);
  });

  it('a duração dada explicitamente substitui a da velocidade', () => {
    const r = commandMove(createEngineeringSession(EXCAVATOR_ASSEMBLY_V1), { targets: { boom_cylinder: 0.65 }, durationS: 2 });
    if (!r.ok) throw new Error(r.message);
    expect(r.durationS).toBe(2);
  });

  it('a interpolação é linear no espaço dos actuadores: a meia duração o curso é o ponto médio', () => {
    const session = createEngineeringSession(EXCAVATOR_ASSEMBLY_V1);
    const start = sampleEngineeringMotion(session, 0);
    const r = commandMove(session, { targets: { boom_cylinder: 0.65 }, durationS: 4 });
    if (!r.ok) throw new Error(r.message);
    const mid = sampleEngineeringMotion(r.session, 2);
    expect(actuatorValue(mid, 'boom_cylinder')).toBeCloseTo((actuatorValue(start, 'boom_cylinder') + 0.65) / 2, 12);
    expect(sampleEngineeringMotion(r.session, 4).status).toBe('ok');
    expect(actuatorValue(sampleEngineeringMotion(r.session, 4), 'boom_cylinder')).toBeCloseTo(0.65, 12);
  });

  it('comandos sucessivos partem do fim do anterior: o braço mantém o alvo da lança enquanto o balde se move', () => {
    const first = commandMove(createEngineeringSession(EXCAVATOR_ASSEMBLY_V1), { targets: { boom_cylinder: 0.65 }, durationS: 2 });
    if (!first.ok) throw new Error(first.message);
    const second = commandMove(first.session, { targets: { stick_cylinder: 0.5 }, durationS: 2 });
    if (!second.ok) throw new Error(second.message);
    expect(second.startS).toBe(2);
    expect(second.session.durationS).toBe(4);
    const mid = sampleEngineeringMotion(second.session, 3);
    expect(actuatorValue(mid, 'boom_cylinder')).toBeCloseTo(0.65, 12);
    // A meio do segundo movimento (t = 3 s) o braço está a meio caminho entre a referência e o alvo 0,5.
    const stickReference = (EXCAVATOR_ASSEMBLY_V1.actuators.find((x) => x.id === 'stick_cylinder') as { referenceStroke: { value: number } }).referenceStroke.value;
    expect(actuatorValue(mid, 'stick_cylinder')).toBeCloseTo((stickReference + 0.5) / 2, 12);
  });

  it('todos os instantes amostrados são quadros válidos, com fecho de laços e limites respeitados', () => {
    const r = commandMove(createEngineeringSession(EXCAVATOR_ASSEMBLY_V1), { targets: { boom_cylinder: 0.65, stick_cylinder: 0.5, bucket_cylinder: 0.45 } });
    if (!r.ok) throw new Error(r.message);
    for (let i = 0; i <= 20; i += 1) {
      const frame = sampleEngineeringMotion(r.session, (r.durationS * i) / 20);
      expect(validateMotionFrame(frame).ok, `t=${i}`).toBe(true);
      expect(frame.status, `t=${i}`).toBe('ok');
      expect(frame.solver.closureResidualM!, `t=${i}`).toBeLessThan(1e-9);
      for (const a of frame.actuators) expect(a.withinLimits, `${a.actuatorId} t=${i}`).toBe(true);
    }
  });
});

describe('determinismo, instantes arbitrários e reprodução', () => {
  it('o mesmo instante dá o mesmo quadro, byte a byte, em duas sessões construídas da mesma forma', () => {
    const build = () => {
      const r = commandMove(createEngineeringSession(EXCAVATOR_ASSEMBLY_V1), { targets: { boom_cylinder: 0.65 } });
      if (!r.ok) throw new Error(r.message);
      return r.session;
    };
    const a = build(); const b = build();
    for (const t of [0, 0.37, 1.9, 3.3]) expect(canonicalize(sampleEngineeringMotion(a, t))).toBe(canonicalize(sampleEngineeringMotion(b, t)));
  });

  it('a amostragem não depende da ordem das amostras: amostrar 3.3 antes ou depois de 0.37 dá o mesmo', () => {
    const r = commandMove(createEngineeringSession(EXCAVATOR_ASSEMBLY_V1), { targets: { boom_cylinder: 0.65 } });
    if (!r.ok) throw new Error(r.message);
    const first = canonicalize(sampleEngineeringMotion(r.session, 3.3));
    sampleEngineeringMotion(r.session, 0.37);
    expect(canonicalize(sampleEngineeringMotion(r.session, 3.3))).toBe(first);
  });

  it('um instante negativo ou não finito é recusado; depois do fim a pose mantém-se no alvo', () => {
    const r = commandMove(createEngineeringSession(EXCAVATOR_ASSEMBLY_V1), { targets: { boom_cylinder: 0.65 } });
    if (!r.ok) throw new Error(r.message);
    expect(() => sampleEngineeringMotion(r.session, -1)).toThrow(/ENGINE_INVALID_TIMESTAMP/);
    expect(() => sampleEngineeringMotion(r.session, Number.NaN)).toThrow(/ENGINE_INVALID_TIMESTAMP/);
    expect(actuatorValue(sampleEngineeringMotion(r.session, r.durationS + 100), 'boom_cylinder')).toBeCloseTo(0.65, 12);
  });

  it('reproduzir: pausar, procurar para trás e voltar a reproduzir dá os mesmos quadros nos mesmos instantes', () => {
    const r = commandMove(createEngineeringSession(EXCAVATOR_ASSEMBLY_V1), { targets: { boom_cylinder: 0.65 }, durationS: 2 });
    if (!r.ok) throw new Error(r.message);
    let pb = createPlayback(r.session);
    pb = play(pb);
    const first: string[] = [];
    for (let i = 0; i < 4; i += 1) { pb = advance(pb, 0.5); first.push(canonicalize(samplePlayback(pb))); }
    pb = pause(pb);
    const paused = pb.timeS;
    pb = advance(pb, 1);
    expect(pb.timeS).toBe(paused);
    pb = seek(pb, 0.5);
    expect(canonicalize(samplePlayback(pb))).toBe(first[0]);
    pb = play(pb);
    const second: string[] = [];
    for (let i = 0; i < 3; i += 1) { pb = advance(pb, 0.5); second.push(canonicalize(samplePlayback(pb))); }
    expect(second).toEqual(first.slice(1));
  });

  it('o relógio é o que a chamada diz, não o do ecrã: passos de 1 s ou de 0,1 s dão o mesmo instante e a mesma pose (a 1e-12)', () => {
    const r = commandMove(createEngineeringSession(EXCAVATOR_ASSEMBLY_V1), { targets: { boom_cylinder: 0.65 }, durationS: 2 });
    if (!r.ok) throw new Error(r.message);
    let coarse = play(createPlayback(r.session));
    coarse = advance(coarse, 1.0);
    let fine = play(createPlayback(r.session));
    for (let i = 0; i < 10; i += 1) fine = advance(fine, 0.1);
    expect(fine.timeS).toBeCloseTo(coarse.timeS, 12);
    framesClose(samplePlayback(fine), samplePlayback(coarse));
  });

  it('a velocidade escala o tempo: com velocidade 2, um segundo real é dois segundos de movimento, e para no fim', () => {
    const r = commandMove(createEngineeringSession(EXCAVATOR_ASSEMBLY_V1), { targets: { boom_cylinder: 0.65 }, durationS: 1.5 });
    if (!r.ok) throw new Error(r.message);
    let pb = { ...createPlayback(r.session), speed: 2 };
    pb = play(pb);
    pb = advance(pb, 0.5);
    expect(pb.timeS).toBeCloseTo(1, 12);
    pb = advance(pb, 10);
    expect(pb.timeS).toBeCloseTo(1.5, 12);
    expect(pb.playing).toBe(false);
  });

  it('dt negativo, não finito ou velocidade não positiva são recusados', () => {
    const pb = createPlayback(createEngineeringSession(EXCAVATOR_ASSEMBLY_V1));
    expect(() => advance(play(pb), -0.1)).toThrow(/ENGINE_INVALID_STEP/);
    expect(() => advance(play(pb), Number.NaN)).toThrow(/ENGINE_INVALID_STEP/);
    expect(() => advance(play({ ...pb, speed: 0 }), 0.1)).toThrow(/ENGINE_INVALID_SPEED/);
  });
});

describe('alteração de parâmetros: antes e depois, com a mesma entrada', () => {
  it('mudar um parâmetro depois de mover a máquina: a sessão devolvida começa nos valores comparados, não na referência', () => {
    const moved = commandMove(createEngineeringSession(EXCAVATOR_ASSEMBLY_V1), { targets: { boom_cylinder: 0.65 } });
    if (!moved.ok) throw new Error(moved.message);
    const changed = evaluateParameterChange(moved.session, { kind: 'actuator_max_rate', actuatorId: 'boom_cylinder', value: 0.3, unit: 'm/s', provenance });
    if (!changed.ok) throw new Error(changed.code);
    expect(actuatorValue(changed.after, 'boom_cylinder')).toBeCloseTo(0.65, 12);
    const atZero = sampleEngineeringMotion(changed.session, 0);
    expect(actuatorValue(atZero, 'boom_cylinder')).toBeCloseTo(0.65, 12);
    framesClose(atZero, changed.after);
    // A continuação parte do mesmo sítio: de 0,65 para 0,6 a 0,3 m/s são 1/6 s.
    const next = commandMove(changed.session, { targets: { boom_cylinder: 0.6 } });
    if (!next.ok) throw new Error(next.message);
    expect(next.durationS).toBeCloseTo(0.05 / 0.3, 12);
  });

  it('uma velocidade máxima diferente muda a duração do mesmo movimento (exactamente o dobro com metade da velocidade)', () => {
    const base = createEngineeringSession(EXCAVATOR_ASSEMBLY_V1);
    const slow = evaluateParameterChange(base, { kind: 'actuator_max_rate', actuatorId: 'boom_cylinder', value: 0.075, unit: 'm/s', provenance });
    if (!slow.ok) throw new Error(slow.code);
    const before = commandMove(base, { targets: { boom_cylinder: 0.65 } });
    const after = commandMove(slow.session, { targets: { boom_cylinder: 0.65 } });
    if (!before.ok || !after.ok) throw new Error('falhou');
    expect(after.durationS).toBeCloseTo(2 * before.durationS, 9);
    expect(slow.maxPartDisplacementM).toBe(0);
  });

  it('mudar o pino de base da lança muda a pose: a lança fica noutro ângulo para o mesmo curso, e a comparação diz quanto', () => {
    const base = createEngineeringSession(EXCAVATOR_ASSEMBLY_V1);
    const joint = clone().joints.find((j) => j.id === 'boom_cyl_base')!;
    const moved = evaluateParameterChange(base, { kind: 'joint_origin', jointId: 'boom_cyl_base', translationM: [joint.origin.translationM[0] + 0.05, joint.origin.translationM[1], joint.origin.translationM[2]], provenance });
    if (!moved.ok) throw new Error(moved.code);
    expect(moved.maxPartDisplacementM).toBeGreaterThan(1e-3);
    expect(moved.before.parts).not.toEqual(moved.after.parts);
    expect(moved.after.status).toBe('ok');
  });

  it('um valor sem proveniência, com unidade errada ou inválido é recusado com os problemas, sem nova sessão', () => {
    const base = createEngineeringSession(EXCAVATOR_ASSEMBLY_V1);
    const wrongUnit = evaluateParameterChange(base, { kind: 'actuator_max_rate', actuatorId: 'boom_cylinder', value: 0.1, unit: 'rad/s' as 'm/s', provenance });
    expect(wrongUnit).toMatchObject({ ok: false, code: 'PARAMETER_INVALID' });
    const noProvenance = evaluateParameterChange(base, { kind: 'joint_origin', jointId: 'boom_cyl_base', translationM: [0, 0, 0], provenance: undefined as never });
    expect(noProvenance).toMatchObject({ ok: false, code: 'PARAMETER_INVALID' });
    expect(() => sampleEngineeringMotion(base, 0)).not.toThrow();
  });

  it('um limite de junta que deixa a referência fora dos limites é recusado pelo validador', () => {
    const base = createEngineeringSession(EXCAVATOR_ASSEMBLY_V1);
    const r = evaluateParameterChange(base, { kind: 'joint_limits', jointId: 'boom_joint', min: 0.5, max: 1.05, provenance });
    expect(r).toMatchObject({ ok: false, code: 'PARAMETER_INVALID' });
  });
});

describe('fecho da sessão', () => {
  it('uma sessão fechada recusa tudo, e fechar outra vez não falha', () => {
    const session = createEngineeringSession(EXCAVATOR_ASSEMBLY_V1);
    const playback = createPlayback(session);
    closeEngineeringSession(session);
    expect(() => sampleEngineeringMotion(session, 0)).toThrow(/ENGINE_SESSION_CLOSED/);
    expect(() => commandMove(session, { targets: { boom_cylinder: 0.65 } })).toThrow(/ENGINE_SESSION_CLOSED/);
    expect(() => samplePlayback(playback)).toThrow(/ENGINE_SESSION_CLOSED/);
    expect(() => closeEngineeringSession(session)).not.toThrow();
  });

  it('fechar uma sessão não afecta outra criada a partir da mesma montagem', () => {
    const a = createEngineeringSession(EXCAVATOR_ASSEMBLY_V1);
    const b = createEngineeringSession(EXCAVATOR_ASSEMBLY_V1);
    closeEngineeringSession(a);
    expect(validateMotionFrame(sampleEngineeringMotion(b, 0)).ok).toBe(true);
  });
});
