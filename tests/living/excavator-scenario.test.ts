import { describe, expect, it } from 'vitest';
import { canonicalize } from '../../src/core';
import { validateMotionFrame, type Assembly, type MotionFrame } from '../../src/living/contracts';
import { EXCAVATOR_ASSEMBLY_V1 } from '../../src/living/contracts/fixtures/excavator.assembly.v1';
import { evaluateActuators } from '../../src/living/engineering/engine';
import { advance, closeEngineeringSession, commandMove, createEngineeringSession, createPlayback, pause, play, samplePlayback, seek, sampleEngineeringMotion, type EngineeringSession } from '../../src/living/engineering/runtime';
import { referenceConfiguration } from '../../src/living/engineering/forward-kinematics';
import { applyRigid, rigidFromPose } from '../../src/living/engineering/transform-math';
import type { Vec3 } from '../../src/living/contracts';

/**
 * Cenário de ponta a ponta: «levanta a lança, estende o braço, encolhe a caçamba, roda a superstrutura», depois pausa,
 * procura para trás e reproduz. Em cada passo: coerência das partes, cilindros que seguem os barris, pinos fechados,
 * limites respeitados, resíduos registados, e a montagem original intacta.
 */
const ORIGINAL = canonicalize(EXCAVATOR_ASSEMBLY_V1);
const jointOf = (frame: MotionFrame, id: string) => frame.joints.find((j) => j.jointId === id)!.value;
const partOf = (frame: MotionFrame, id: string) => frame.parts.find((p) => p.partId === id)!;
const stroke = (frame: MotionFrame, id: string) => frame.actuators.find((a) => a.actuatorId === id)!.value;
const cylinders = EXCAVATOR_ASSEMBLY_V1.actuators.filter((a) => a.kind === 'hydraulic_cylinder') as Array<Extract<Assembly['actuators'][number], { kind: 'hydraulic_cylinder' }>>;

/** Invariantes que têm de valer em qualquer instante do cenário. */
function checkInvariants(frame: MotionFrame, label: string): void {
  expect(validateMotionFrame(frame), label).toEqual({ ok: true, issues: [] });
  expect(frame.status, label).toBe('ok');
  expect(frame.parts.map((p) => p.partId).sort(), label).toEqual(EXCAVATOR_ASSEMBLY_V1.parts.map((p) => p.id).sort());
  expect(frame.solver.closureResidualM!, label).toBeLessThan(1e-9);
  for (const m of frame.measurements.filter((x) => x.id.startsWith('closure.'))) expect(m.value!, `${label} ${m.id}`).toBeLessThan(1e-9);
  for (const joint of EXCAVATOR_ASSEMBLY_V1.joints) {
    if (joint.type === 'fixed' || !joint.limits) continue;
    const v = jointOf(frame, joint.id);
    expect(v, `${label} ${joint.id}`).toBeGreaterThanOrEqual(joint.limits.min.value);
    expect(v, `${label} ${joint.id}`).toBeLessThanOrEqual(joint.limits.max.value);
  }
  for (const cyl of cylinders) {
    const closed = EXCAVATOR_ASSEMBLY_V1.joints.find((j) => j.id === cyl.slideJointId)!.origin.translationM[0];
    const barrel = partOf(frame, cyl.barrelPartId).translationM;
    const rod = partOf(frame, cyl.rodPartId).translationM;
    const length = Math.hypot(rod[0] - barrel[0], rod[1] - barrel[1], rod[2] - barrel[2]);
    expect(length, `${label} ${cyl.id}`).toBeCloseTo(closed + stroke(frame, cyl.id), 9);
    expect(frame.actuators.find((a) => a.actuatorId === cyl.id)!.withinLimits, `${label} ${cyl.id}`).toBe(true);
  }
  for (const a of frame.actuators) {
    expect(a.forceStatus, `${label} ${a.actuatorId}`).toBe('unknown');
    expect(a.forceN, `${label} ${a.actuatorId}`).toBeNull();
  }
}

describe('cenário do excavador: comandos, pausa, procura e reprodução', () => {
  it('passo a passo, com as invariantes em cada instante, e a montagem nunca muda', () => {
    const log: string[] = [];
    let session: EngineeringSession = createEngineeringSession(EXCAVATOR_ASSEMBLY_V1);

    // 1. Carregar, validar e mostrar a pose de referência.
    const reference = sampleEngineeringMotion(session, 0);
    checkInvariants(reference, 'referência');
    expect(reference.poseBasis).toBe('solved');
    log.push(`0 referência: stick y=${partOf(reference, 'stick').translationM[1].toFixed(4)}`);

    // 2. Levantar a lança: o cilindro da lança estende-se, a lança roda no sentido «raise» (positivo).
    const raise = commandMove(session, { targets: { boom_cylinder: 0.65 } });
    if (!raise.ok) throw new Error(raise.message);
    session = raise.session;
    expect(EXCAVATOR_ASSEMBLY_V1.joints.find((j) => j.id === 'boom_joint')!.motion).toEqual({ positive: 'raise', negative: 'lower' });
    const raised = sampleEngineeringMotion(session, raise.durationS);
    checkInvariants(raised, 'lança levantada');
    expect(jointOf(raised, 'boom_joint')).toBeGreaterThan(jointOf(reference, 'boom_joint'));
    expect(partOf(raised, 'stick').translationM[1]).toBeGreaterThan(partOf(reference, 'stick').translationM[1]);
    log.push(`${raise.durationS.toFixed(3)} lança levantada`);

    // 3. Estender o braço dentro dos limites. O cilindro do braço RECOLHE-SE para o braço sair (joint positivo = extend):
    //    curso maior encolhe o braço contra a cabina, por isso o curso desce de 0,327 para 0,25 m.
    const extend = commandMove(session, { targets: { stick_cylinder: 0.25 } });
    if (!extend.ok) throw new Error(extend.message);
    session = extend.session;
    const extended = sampleEngineeringMotion(session, session.durationS);
    checkInvariants(extended, 'braço estendido');
    expect(EXCAVATOR_ASSEMBLY_V1.joints.find((j) => j.id === 'stick_joint')!.motion).toEqual({ positive: 'extend', negative: 'retract' });
    // Alcance: distância da ponta da caçamba (tool_tip) à articulação da lança. O braço roda em torno do pino da lança;
    // medir até à articulação do braço não serviria, porque a ponta e essa articulação estão na mesma parte rígida.
    const tipLocal = EXCAVATOR_ASSEMBLY_V1.parts.find((p) => p.id === 'bucket')!.points.find((p) => p.role === 'tool_tip')!.positionM as Vec3;
    const reach = (frame: MotionFrame) => {
      const bucket = partOf(frame, 'bucket');
      const tip = applyRigid(rigidFromPose({ translationM: bucket.translationM as Vec3, rotation: bucket.rotation as [number, number, number, number] }), tipLocal);
      const pivot = partOf(frame, 'boom').translationM;
      return Math.hypot(tip[0] - pivot[0], tip[1] - pivot[1], tip[2] - pivot[2]);
    };
    expect(jointOf(extended, 'stick_joint')).toBeGreaterThan(jointOf(raised, 'stick_joint'));
    expect(reach(extended)).toBeGreaterThan(reach(raised));
    log.push(`${extend.durationS.toFixed(3)} braço estendido`);

    // 4. Encolher a caçamba: a caçamba roda no sentido «curl» (negativo).
    const curl = commandMove(session, { targets: { bucket_cylinder: 0.5 } });
    if (!curl.ok) throw new Error(curl.message);
    session = curl.session;
    const curled = sampleEngineeringMotion(session, session.durationS);
    checkInvariants(curled, 'caçamba encolhida');
    expect(EXCAVATOR_ASSEMBLY_V1.joints.find((j) => j.id === 'bucket_joint')!.motion).toEqual({ positive: 'dump', negative: 'curl' });
    expect(jointOf(curled, 'bucket_joint')).toBeLessThan(jointOf(extended, 'bucket_joint'));
    log.push(`${curl.durationS.toFixed(3)} caçamba encolhida`);

    // 5. Rodar a superstrutura. Só a rotação da superstrutura muda a orientação da cabina.
    const swing = commandMove(session, { targets: { swing_drive: 0.3 } });
    if (!swing.ok) throw new Error(swing.message);
    session = swing.session;
    const swung = sampleEngineeringMotion(session, session.durationS);
    checkInvariants(swung, 'superstrutura rodada');
    expect(jointOf(swung, 'swing')).toBeCloseTo(0.3, 12);
    expect(jointOf(swung, 'boom_joint')).toBeCloseTo(jointOf(curled, 'boom_joint'), 12);
    log.push(`${swing.durationS.toFixed(3)} superstrutura rodada`);

    // 6. Um comando que sai dos limites é recusado com a razão; a sessão não muda.
    const refused = commandMove(session, { targets: { boom_cylinder: 0.9 } });
    expect(refused).toMatchObject({ ok: false, code: 'TARGET_BLOCKED', blockedCode: 'STROKE_OUT_OF_RANGE' });
    expect(sampleEngineeringMotion(session, session.durationS).solver.closureResidualM!).toBeLessThan(1e-9);

    // 7. Reproduzir: passos fixos, pausa, procura para trás, e voltar a reproduzir. Os mesmos instantes dão os mesmos quadros.
    const total = session.durationS;
    const step = total / 12;
    let pb = play(createPlayback(session));
    const first: string[] = [];
    for (let i = 0; i < 12; i += 1) { pb = advance(pb, step); first.push(canonicalize(samplePlayback(pb))); }
    expect(pb.playing).toBe(false);
    expect(pb.timeS).toBeCloseTo(total, 12);

    pb = pause(seek(pb, total / 3));
    const paused = pb.timeS;
    pb = advance(pb, 5);
    expect(pb.timeS).toBe(paused);
    expect(canonicalize(samplePlayback(pb))).toBe(canonicalize(sampleEngineeringMotion(session, total / 3)));

    pb = seek(pb, 0);
    expect(canonicalize(samplePlayback(pb))).toBe(canonicalize(sampleEngineeringMotion(session, 0)));
    pb = play(pb);
    const second: string[] = [];
    for (let i = 0; i < 12; i += 1) { pb = advance(pb, step); second.push(canonicalize(samplePlayback(pb))); }
    expect(second).toEqual(first);

    // 8. Fechar a sessão: nada mais se calcula com ela, e a montagem original continua igual.
    closeEngineeringSession(session);
    expect(() => sampleEngineeringMotion(session, 0)).toThrow(/ENGINE_SESSION_CLOSED/);
    expect(canonicalize(EXCAVATOR_ASSEMBLY_V1)).toBe(ORIGINAL);
    expect(log).toHaveLength(5);
  });

  it('a pose calculada é a que o motor dá para a mesma configuração (sem depender do caminho)', () => {
    const raise = commandMove(createEngineeringSession(EXCAVATOR_ASSEMBLY_V1), { targets: { boom_cylinder: 0.65 } });
    if (!raise.ok) throw new Error(raise.message);
    const after = sampleEngineeringMotion(raise.session, raise.durationS);
    // O mesmo valor de actuador, avaliado directamente e sem sessão: o resultado não pode depender do caminho.
    const strokes: Record<string, number> = {};
    for (const a of EXCAVATOR_ASSEMBLY_V1.actuators) strokes[a.id] = a.kind === 'hydraulic_cylinder' ? a.referenceStroke.value : referenceConfiguration(EXCAVATOR_ASSEMBLY_V1)[a.jointId]!;
    const direct = evaluateActuators(EXCAVATOR_ASSEMBLY_V1, { ...strokes, boom_cylinder: 0.65 });
    expect(after.parts.map((p) => p.partId)).toEqual(direct.parts.map((p) => p.partId));
    for (const p of after.parts) {
      const d = direct.parts.find((x) => x.partId === p.partId)!;
      p.translationM.forEach((v, k) => expect(Math.abs(v - d.translationM[k]!), p.partId).toBeLessThan(1e-12));
    }
  });
});
