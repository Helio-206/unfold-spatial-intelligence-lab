import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalize } from '../../src/core';
import { AssemblyContractError, validateMotionFrame, type Assembly, type Quat, type Vec3 } from '../../src/living/contracts';
import { EXCAVATOR_ASSEMBLY_V1 } from '../../src/living/contracts/fixtures/excavator.assembly.v1';
import { EngineInputError, referenceConfiguration, solveForwardKinematics } from '../../src/living/engineering/forward-kinematics';
import { applyRigid, quatAngle, rigidFromPose } from '../../src/living/engineering/transform-math';
import { evaluateConfiguration, evaluateReferencePose } from '../../src/living/engineering/engine';

const readJson = (name: string) => JSON.parse(readFileSync(new URL(`../../src/living/contracts/fixtures/${name}`, import.meta.url), 'utf8'));
const REFERENCE = readJson('excavator.reference-pose.json') as { tip: number[]; parts: Array<{ partId: string; translationM: number[]; rotation: number[] }> };
const clone = (): Assembly => structuredClone(EXCAVATOR_ASSEMBLY_V1);
const partWorld = (frame: { parts: Array<{ partId: string; translationM: number[]; rotation: number[] }> }, id: string) => frame.parts.find((p) => p.partId === id)!;
const asRigid = (p: { translationM: number[]; rotation: number[] }) => rigidFromPose({ translationM: p.translationM as Vec3, rotation: p.rotation as Quat });

/**
 * Tolerâncias, justificadas: o script Python calcula em double com matrizes 4×4; o motor calcula com quaterniões. Os erros
 * de arredondamento de ambos são da ordem de 1e-15 m/rad. A tolerância do teste é 1e-6 (o alvo do pedido), 9 ordens de
 * grandeza acima do ruído, e ainda assim apertada o suficiente para apanhar um erro de convenção (um eixo trocado ou um
 * deslocamento de origem dá erros de centímetros ou de radianos).
 */
const POSE_TOLERANCE_M = 1e-6;
const POSE_TOLERANCE_RAD = 1e-6;

describe('cinemática directa: pose de referência do excavador', () => {
  it('calcula as 13 partes, nem mais nem menos, com os mesmos identificadores da montagem', () => {
    const frame = evaluateReferencePose(EXCAVATOR_ASSEMBLY_V1);
    expect(frame.parts.map((p) => p.partId).sort()).toEqual(EXCAVATOR_ASSEMBLY_V1.parts.map((p) => p.id).sort());
    expect(frame.parts).toHaveLength(13);
    expect(REFERENCE.parts.map((p) => p.partId).sort()).toEqual(frame.parts.map((p) => p.partId).sort());
  });

  it('cada transformação calculada bate com o script Python independente (translação e orientação)', () => {
    const frame = evaluateReferencePose(EXCAVATOR_ASSEMBLY_V1);
    const errors = frame.parts.map((part) => {
      const ref = partWorld(REFERENCE, part.partId);
      return { partId: part.partId, translationM: Math.hypot(...part.translationM.map((v, i) => v - ref.translationM[i]!)), rotationRad: quatAngle(part.rotation, ref.rotation) };
    });
    const maxTranslation = Math.max(...errors.map((e) => e.translationM));
    const maxAngle = Math.max(...errors.map((e) => e.rotationRad));
    expect(maxTranslation, JSON.stringify(errors)).toBeLessThan(POSE_TOLERANCE_M);
    expect(maxAngle, JSON.stringify(errors)).toBeLessThan(POSE_TOLERANCE_RAD);
    // O erro medido é ~1e-15: o limite do pedido (1e-6) fica muito acima. Este limite apertado apanha regressões que o de 1e-6 deixaria passar.
    expect(maxTranslation, JSON.stringify(errors)).toBeLessThan(1e-12);
    expect(maxAngle, JSON.stringify(errors)).toBeLessThan(1e-12);
  });

  it('o ponto da ponta da caçamba coincide com o do script Python', () => {
    const frame = evaluateReferencePose(EXCAVATOR_ASSEMBLY_V1);
    const bucket = frame.parts.find((p) => p.partId === 'bucket')!;
    const tip = applyRigid(asRigid(bucket), [1.30, -0.65, 0]);
    expect(Math.hypot(...tip.map((v, i) => v - REFERENCE.tip[i]!))).toBeLessThan(POSE_TOLERANCE_M);
    expect(frame.measurements.find((m) => m.id === 'tip.x')).toMatchObject({ status: 'computed', unit: 'm', subjectIds: ['bucket'] });
  });

  it('o quadro de referência valida com validateMotionFrame e tem estado ok, pose resolvida e solver solved', () => {
    const frame = evaluateReferencePose(EXCAVATOR_ASSEMBLY_V1);
    expect(validateMotionFrame(frame)).toEqual({ ok: true, issues: [] });
    expect(frame).toMatchObject({ status: 'ok', poseBasis: 'solved', blocked: null, solver: { status: 'solved' }, index: null, timestampS: 0 });
  });

  it('o resíduo de fecho dos quatro laços de pinos na referência é quase zero (abaixo de 1e-9 m)', () => {
    const frame = evaluateReferencePose(EXCAVATOR_ASSEMBLY_V1);
    const residuals = frame.measurements.filter((m) => m.id.startsWith('closure.'));
    expect(residuals.map((m) => m.id).sort()).toEqual(EXCAVATOR_ASSEMBLY_V1.constraints.map((c) => `closure.${c.id}`).sort());
    for (const r of residuals) expect(r.value).toBeLessThan(1e-9);
    expect(frame.solver.closureResidualM).toBeLessThan(1e-9);
  });

  it('o comprimento de cada cilindro, medido na geometria, é o comprimento fechado (origem do deslizador) mais o curso de referência', () => {
    const frame = evaluateReferencePose(EXCAVATOR_ASSEMBLY_V1);
    for (const actuator of EXCAVATOR_ASSEMBLY_V1.actuators) {
      if (actuator.kind !== 'hydraulic_cylinder') continue;
      const measured = frame.actuators.find((a) => a.actuatorId === actuator.id)!;
      const slide = EXCAVATOR_ASSEMBLY_V1.joints.find((j) => j.id === actuator.slideJointId)!;
      const closedLength = slide.origin.translationM[0];
      expect(measured.value).toBeCloseTo(actuator.referenceStroke.value, 12);
      expect(measured.lengthM).toBeCloseTo(closedLength + actuator.referenceStroke.value, 9);
      expect(measured.withinLimits).toBe(true);
    }
  });
});

describe('referenciais do mundo e da raiz', () => {
  it('um referencial estático com pose própria desloca a raiz; as partes seguem a raiz', () => {
    const a = clone();
    const { provenance } = a.root.pose;
    a.frames.push({ id: 'site', parentFrameId: 'world', kind: 'static', pose: { translationM: [10, 0, -4], rotation: [0, 0, 0, 1], provenance }, description: 'obra' });
    a.root = { partId: 'chassis', frameId: 'site', pose: { ...a.root.pose } };
    const before = evaluateReferencePose(EXCAVATOR_ASSEMBLY_V1);
    const after = evaluateReferencePose(a);
    const dx = partWorld(after, 'chassis').translationM.map((v, i) => v - partWorld(before, 'chassis').translationM[i]!);
    expect(dx[0]).toBeCloseTo(10, 12); expect(dx[2]).toBeCloseTo(-4, 12); expect(dx[1]).toBeCloseTo(0, 12);
    // A cabeça de uma parte filha também se desloca exactamente pelo mesmo vetor.
    const bBefore = partWorld(before, 'boom').translationM; const bAfter = partWorld(after, 'boom').translationM;
    expect(bAfter.map((v, i) => v - bBefore[i]!)[0]).toBeCloseTo(10, 12);
  });

  it('a pose da raiz actua no referencial da raiz (não no mundo): rodar a raiz em torno de Y roda a máquina inteira', () => {
    const a = clone();
    const ninety = Math.SQRT1_2;
    const rotated = [0, ninety, 0, ninety] as const;
    a.root = { partId: 'chassis', frameId: 'world', pose: { translationM: [0, 0, 0], rotation: [...rotated], provenance: a.root.pose.provenance } };
    const frame = evaluateReferencePose(a);
    expect(quatAngle(partWorld(frame, 'chassis').rotation, [...rotated])).toBeLessThan(1e-12);
    // Um ponto à frente da máquina (+X local da cabina) passa para −Z no mundo, porque a raiz roda +90° em torno de Y.
    const front = applyRigid(asRigid(partWorld(frame, 'chassis')), [1, 0, 0]);
    expect(front[0]).toBeCloseTo(0, 9); expect(front[2]).toBeCloseTo(-1, 9);
  });

  it('um referencial do mundo com pose não identidade é recusado', () => {
    const a = clone();
    a.frames[0]!.pose.translationM = [1, 0, 0];
    expect(() => evaluateReferencePose(a)).toThrow(/ENGINE_WORLD_POSE_NOT_IDENTITY/);
  });
});

describe('uma junta com origem e valor de referência próprios é aplicada exactamente uma vez', () => {
  it('a junta da lança com origem (1,0,0) e referência de 90° em Z põe a origem da filha em (1,0,0) e o seu ponto (1,0,0) em (1,1,0), no referencial de cima', () => {
    const a = clone();
    const ref = a.joints.find((j) => j.id === 'boom_joint')!;
    ref.origin.translationM = [1, 0, 0]; ref.origin.rotation = [0, 0, 0, 1];
    ref.axis = [0, 0, 1]; ref.limits = { min: { value: -Math.PI, unit: 'rad', provenance: ref.provenance }, max: { value: Math.PI, unit: 'rad', provenance: ref.provenance } };
    ref.referenceValue = { value: Math.PI / 2, unit: 'rad', provenance: ref.provenance };
    const state = solveForwardKinematics(a, referenceConfiguration(a));
    const upper = state.parts.get('upper_body')!;
    const boom = state.parts.get('boom')!;
    // No referencial de cima: a origem da lança é (1,0,0) e o seu ponto (1,0,0) passa a (1,1,0). Aplicar a origem duas vezes daria (2,1,0).
    const expectedOrigin = applyRigid(upper, [1, 0, 0]);
    const expectedPoint = applyRigid(upper, [1, 1, 0]);
    expect(applyRigid(boom, [0, 0, 0]).map((v, i) => v - expectedOrigin[i]!).map(Math.abs).every((d) => d < 1e-12)).toBe(true);
    expect(applyRigid(boom, [1, 0, 0]).map((v, i) => v - expectedPoint[i]!).map(Math.abs).every((d) => d < 1e-12)).toBe(true);
  });
});

describe('determinismo e validação de entradas', () => {
  it('a mesma montagem dá a mesma saída byte a byte', () => {
    expect(canonicalize(evaluateReferencePose(EXCAVATOR_ASSEMBLY_V1))).toBe(canonicalize(evaluateReferencePose(EXCAVATOR_ASSEMBLY_V1)));
  });
  it('a ordem das partes e das juntas na lista não altera nenhuma transformação', () => {
    const shuffled = clone();
    shuffled.parts.reverse(); shuffled.joints.reverse();
    const a = evaluateReferencePose(EXCAVATOR_ASSEMBLY_V1); const b = evaluateReferencePose(shuffled);
    for (const part of a.parts) expect(partWorld(b, part.partId)).toEqual(part);
  });
  it('não muda a montagem de entrada', () => {
    const copy = clone(); const before = canonicalize(copy);
    evaluateReferencePose(copy);
    expect(canonicalize(copy)).toBe(before);
  });
  it('uma montagem inválida é recusada antes de qualquer simulação', () => {
    const bad = clone(); (bad as { schema: string }).schema = 'unfold.assembly.v0';
    expect(() => evaluateReferencePose(bad)).toThrow(AssemblyContractError);
  });
  it('valores de junta desconhecidos, em falta ou não finitos são recusados como entrada', () => {
    const ref = referenceConfiguration(EXCAVATOR_ASSEMBLY_V1);
    expect(() => evaluateConfiguration(EXCAVATOR_ASSEMBLY_V1, { ...ref, fantasma: 1 })).toThrow(EngineInputError);
    const missing: Record<string, number> = { ...ref }; delete missing.boom_joint;
    expect(() => evaluateConfiguration(EXCAVATOR_ASSEMBLY_V1, missing)).toThrow(/ENGINE_MISSING_JOINT_VALUE/);
    expect(() => evaluateConfiguration(EXCAVATOR_ASSEMBLY_V1, { ...ref, boom_joint: Number.NaN })).toThrow(/ENGINE_NON_FINITE_VALUE/);
    expect(() => evaluateConfiguration(EXCAVATOR_ASSEMBLY_V1, { ...ref, boom_cyl_base: 0.1 })).not.toThrow();
  });
  it('um valor de junta fixa é recusado (a junta de base do cilindro da lança, que nenhum actuador usa, passa a fixa)', () => {
    const a = clone();
    const joint = a.joints.find((j) => j.id === 'boom_cyl_base')!;
    joint.type = 'fixed'; joint.limits = null; joint.referenceValue = null;
    expect(() => evaluateConfiguration(a, { ...referenceConfiguration(a), boom_cyl_base: 0.1 })).toThrow(/ENGINE_FIXED_JOINT_VALUE/);
    expect(() => evaluateConfiguration(a, referenceConfiguration(a))).not.toThrow();
  });
});
