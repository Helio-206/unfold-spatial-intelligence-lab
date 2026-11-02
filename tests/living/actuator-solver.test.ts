import { describe, expect, it } from 'vitest';
import { canonicalize } from '../../src/core';
import { validateMotionFrame, type Assembly } from '../../src/living/contracts';
import { EXCAVATOR_ASSEMBLY_V1 } from '../../src/living/contracts/fixtures/excavator.assembly.v1';
import { EngineInputError, referenceConfiguration, solveForwardKinematics, worldPoint } from '../../src/living/engineering/forward-kinematics';
import { evaluateActuators, evaluateConfiguration } from '../../src/living/engineering/engine';
import { insideWindow, planarCircleAngles, solveActuatorConfiguration } from '../../src/living/engineering/actuator-solver';
import { applyRigid, quatAngle, rotateVector } from '../../src/living/engineering/transform-math';

const clone = (): Assembly => structuredClone(EXCAVATOR_ASSEMBLY_V1);
const referenceStrokes = () => {
  const strokes: Record<string, number> = { swing_drive: 0 };
  for (const actuator of EXCAVATOR_ASSEMBLY_V1.actuators) if (actuator.kind === 'hydraulic_cylinder') strokes[actuator.id] = actuator.referenceStroke.value;
  return strokes;
};
const jointValue = (config: Record<string, number>, id: string) => config[id]!;
const actuator = (a: Assembly, id: string) => a.actuators.find((item) => item.id === id)! as Assembly['actuators'][number] & { stroke: { min: { value: number }; max: { value: number } }; slideJointId: string; barrelPartId: string; rodPartId: string };
const worldOf = (a: Assembly, id: string, strokes: Record<string, number>) => {
  const out = solveActuatorConfiguration(a, strokes);
  if (!out.ok) throw new Error(`${out.code}: ${out.message}`);
  return solveForwardKinematics(a, out.config).parts.get(id)!;
};

describe('solver de cilindros: a pose de referência sai dos cursos de referência', () => {
  it('com os cursos de referência, o solver recupera os valores de referência de todas as juntas (1e-9 rad/m)', () => {
    const out = solveActuatorConfiguration(EXCAVATOR_ASSEMBLY_V1, referenceStrokes());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const reference = referenceConfiguration(EXCAVATOR_ASSEMBLY_V1);
    for (const [id, value] of Object.entries(reference)) expect(Math.abs(jointValue(out.config, id) - value), id).toBeLessThan(1e-9);
  });

  it('a avaliação completa da referência por cursos é ok, com fecho dos laços abaixo de 1e-9 m', () => {
    const frame = evaluateActuators(EXCAVATOR_ASSEMBLY_V1, referenceStrokes());
    expect(validateMotionFrame(frame)).toEqual({ ok: true, issues: [] });
    expect(frame).toMatchObject({ status: 'ok', poseBasis: 'solved' });
    expect(frame.solver.closureResidualM).toBeLessThan(1e-9);
  });
});

describe('relação curso → ângulo (independente: bissecção sobre o comprimento medido na geometria)', () => {
  // Comprimento do cilindro (pino de base → pino da lança) em função do ângulo da lança, pela cinemática directa.
  // O comprimento barril→haste não depende da lança: o acoplamento faz-se pelo pino da lança, por isso medimos até lá.
  const lengthAt = (a: Assembly, cylinderId: string, jointId: string, q: number, ref: Record<string, number>) => {
    const state = solveForwardKinematics(a, { ...ref, [jointId]: q });
    const cyl = actuator(a, cylinderId);
    const pin = worldPoint(a, state, 'boom', 'cyl_rod_pin');
    const base = state.parts.get(cyl.barrelPartId)!.t;
    return Math.hypot(pin[0] - base[0], pin[1] - base[1], pin[2] - base[2]);
  };
  const bisectAngle = (a: Assembly, cylinderId: string, jointId: string, target: number, lo: number, hi: number) => {
    const ref = referenceConfiguration(a);
    let f = (q: number) => lengthAt(a, cylinderId, jointId, q, ref) - target;
    let left = lo; let right = hi;
    for (let i = 0; i < 200; i += 1) { const mid = (left + right) / 2; if (Math.sign(f(mid)) === Math.sign(f(left))) left = mid; else right = mid; }
    return (left + right) / 2;
  };

  it('o ângulo da lança para vários cursos bate com a bissecção sobre o comprimento (1e-9 rad)', () => {
    for (const stroke of [0.15, 0.3, 0.45, 0.6]) {
      const strokes = { ...referenceStrokes(), boom_cylinder: stroke };
      const out = solveActuatorConfiguration(EXCAVATOR_ASSEMBLY_V1, strokes);
      expect(out.ok, `curso ${stroke}`).toBe(true);
      if (!out.ok) continue;
      const cyl = actuator(EXCAVATOR_ASSEMBLY_V1, 'boom_cylinder');
      const target = EXCAVATOR_ASSEMBLY_V1.joints.find((j) => j.id === cyl.slideJointId)!.origin.translationM[0] + stroke;
      const independent = bisectAngle(EXCAVATOR_ASSEMBLY_V1, 'boom_cylinder', 'boom_joint', target, -0.55, 1.05);
      expect(Math.abs(jointValue(out.config, 'boom_joint') - independent), `curso ${stroke}`).toBeLessThan(1e-9);
    }
  });

  it('o comprimento medido na geometria é exactamente o comprimento fechado mais o curso, para qualquer curso alcançável', () => {
    const strokes: Record<string, number> = { ...referenceStrokes(), boom_cylinder: 0.3, stick_cylinder: 0.5 };
    const out = solveActuatorConfiguration(EXCAVATOR_ASSEMBLY_V1, strokes);
    if (!out.ok) throw new Error(out.message);
    const state = solveForwardKinematics(EXCAVATOR_ASSEMBLY_V1, out.config);
    for (const id of ['boom_cylinder', 'stick_cylinder']) {
      const cyl = actuator(EXCAVATOR_ASSEMBLY_V1, id);
      const closed = EXCAVATOR_ASSEMBLY_V1.joints.find((j) => j.id === cyl.slideJointId)!.origin.translationM[0];
      const barrel = state.parts.get(cyl.barrelPartId)!.t; const rod = state.parts.get(cyl.rodPartId)!.t;
      expect(Math.hypot(rod[0] - barrel[0], rod[1] - barrel[1], rod[2] - barrel[2])).toBeCloseTo(closed + strokes[id]!, 9);
    }
    // Esta configuração alcança o curso, mas a haste do braço fica quase 2 m abaixo do chão: a colisão recusa-a, e diz quem.
    const frame = evaluateActuators(EXCAVATOR_ASSEMBLY_V1, strokes);
    expect(frame).toMatchObject({ status: 'blocked', blocked: { code: 'COLLISION' } });
    expect(frame.blocked!.subjectIds).toContain('stick');
  });

  it('a haste acompanha o barril: a origem da haste fica a (Lc + curso) do barril na direcção do eixo do cilindro', () => {
    const strokes = { ...referenceStrokes(), stick_cylinder: 0.6 };
    const barrel = worldOf(EXCAVATOR_ASSEMBLY_V1, 'stick_cyl_barrel', strokes);
    const rod = worldOf(EXCAVATOR_ASSEMBLY_V1, 'stick_cyl_rod', strokes);
    const axis = rotateVector(barrel.q, [1, 0, 0]);
    const closed = EXCAVATOR_ASSEMBLY_V1.joints.find((j) => j.id === 'stick_cyl_slide')!.origin.translationM[0];
    for (let i = 0; i < 3; i += 1) expect(rod.t[i]! - barrel.t[i]!).toBeCloseTo((closed + 0.6) * axis[i]!, 9);
  });
});

describe('recusas explícitas: cursos e geometrias que o motor não consegue provar', () => {
  it('um curso negativo sai do intervalo e é bloqueado, sem pose inventada', () => {
    const frame = evaluateActuators(EXCAVATOR_ASSEMBLY_V1, { ...referenceStrokes(), boom_cylinder: -0.01 });
    expect(frame).toMatchObject({ status: 'blocked', poseBasis: 'reference', blocked: { code: 'STROKE_OUT_OF_RANGE' } });
    expect(validateMotionFrame(frame).ok).toBe(true);
  });

  it('um curso que o comprimento geométrico não alcança é bloqueado com o alcance geométrico na mensagem', () => {
    const a = clone();
    const cyl = actuator(a, 'boom_cylinder');
    cyl.stroke.max.value = 5; (a.joints.find((j) => j.id === cyl.slideJointId)!.limits!.max as { value: number }).value = 5;
    const frame = evaluateActuators(a, { ...referenceStrokes(), boom_cylinder: 3.0 });
    expect(frame).toMatchObject({ status: 'blocked', blocked: { code: 'CYLINDER_UNREACHABLE' } });
    expect(frame.blocked!.message).toMatch(/alcance geométrico \[/);
    expect(validateMotionFrame(frame).ok).toBe(true);
  });

  it('um curso que pede um ângulo fora dos limites da junta é bloqueado (CYLINDER_OUT_OF_JOINT_RANGE)', () => {
    // Um milímetro além do curso do limite: ainda alcançável pela geometria (≈2.884 m < 2.891 m), mas fora do limite da lança.
    const top = jointAtLimit(1.05);
    const frame = evaluateActuators(EXCAVATOR_ASSEMBLY_V1, { ...referenceStrokes(), boom_cylinder: top + 0.001 });
    expect(frame).toMatchObject({ status: 'blocked', blocked: { code: 'CYLINDER_OUT_OF_JOINT_RANGE' } });
    expect(validateMotionFrame(frame).ok).toBe(true);
  });

  it('no limite exacto da junta a configuração é aceite (limites inclusivos) e logo acima é recusada', () => {
    const atLimit = jointAtLimit(1.05);
    expect(evaluateActuators(EXCAVATOR_ASSEMBLY_V1, { ...referenceStrokes(), boom_cylinder: atLimit })).toMatchObject({ status: 'ok' });
    expect(evaluateActuators(EXCAVATOR_ASSEMBLY_V1, { ...referenceStrokes(), boom_cylinder: atLimit + 1e-6 })).toMatchObject({ status: 'blocked' });
  });

  it('uma geometria que não está no plano da junta (eixo não planar) é recusada como UNSUPPORTED_GEOMETRY', () => {
    const a = clone();
    const joint = a.joints.find((j) => j.id === 'boom_joint')!;
    joint.axis = [1, 0, 0];
    const frame = evaluateActuators(a, referenceStrokes());
    expect(frame).toMatchObject({ status: 'blocked', blocked: { code: 'UNSUPPORTED_GEOMETRY' } });
    expect(validateMotionFrame(frame).ok).toBe(true);
  });

  it('um pino fora do plano da junta é recusado: a base de um cilindro planar não o pode orientar', () => {
    const a = clone();
    const pin = a.parts.find((part) => part.id === 'boom')!.points.find((point) => point.id === 'cyl_rod_pin')!;
    pin.positionM = [pin.positionM[0], pin.positionM[1], 0.3];
    const frame = evaluateActuators(a, referenceStrokes());
    expect(frame).toMatchObject({ status: 'blocked', blocked: { code: 'UNSUPPORTED_GEOMETRY' } });
  });

  it('um valor de actuador em falta, desconhecido ou não finito é recusado como entrada (erro tipado)', () => {
    const strokes = referenceStrokes();
    const missing: Record<string, number> = { ...strokes }; delete missing.stick_cylinder;
    expect(() => evaluateActuators(EXCAVATOR_ASSEMBLY_V1, missing)).toThrow(EngineInputError);
    expect(() => evaluateActuators(EXCAVATOR_ASSEMBLY_V1, { ...strokes, lixo: 1 })).toThrow(EngineInputError);
    expect(() => evaluateActuators(EXCAVATOR_ASSEMBLY_V1, { ...strokes, boom_cylinder: Number.NaN })).toThrow(EngineInputError);
  });

  it('um ponto do pivô coincidente com o pino de base não tem ângulo definido: recusado', () => {
    expect(() => planarCircleAngles({ r2: [0, 0], vB: [1, 0], K: 1, sign: 1 })).toThrow(/UNSUPPORTED_GEOMETRY/);
  });
});

describe('escolha de ramo: quando dois ângulos alcançam o curso', () => {
  it('com limites largos, a lança tem dois ângulos para o mesmo curso: escolhe o mais próximo da referência e avisa', () => {
    const narrow = solveActuatorConfiguration(EXCAVATOR_ASSEMBLY_V1, { ...referenceStrokes(), boom_cylinder: 0.3 });
    const wide = clone();
    const joint = wide.joints.find((j) => j.id === 'boom_joint')!;
    joint.limits = { min: { value: -Math.PI, unit: 'rad', provenance: joint.provenance }, max: { value: Math.PI, unit: 'rad', provenance: joint.provenance } };
    const both = solveActuatorConfiguration(wide, { ...referenceStrokes(), boom_cylinder: 0.3 });
    if (!narrow.ok || !both.ok) throw new Error('falhou');
    expect(jointValue(both.config, 'boom_joint')).toBeCloseTo(jointValue(narrow.config, 'boom_joint'), 12);
    expect(both.warnings.map((w) => w.code)).toContain('BRANCH_AMBIGUOUS');
    expect(narrow.warnings.map((w) => w.code)).not.toContain('BRANCH_AMBIGUOUS');
  });
});

describe('janela dos limites: tolerância numérica no limite, recusa fora dele', () => {
  it('um ângulo a 1e-10 rad do limite conta como no limite e é fixado nele', () => {
    expect(insideWindow(1.05 + 1e-10, -0.55, 1.05)).toBe(1.05);
    expect(insideWindow(-0.55 - 1e-10, -0.55, 1.05)).toBe(-0.55);
  });
  it('um ângulo 1e-6 rad além do limite é recusado', () => {
    expect(insideWindow(1.05 + 1e-6, -0.55, 1.05)).toBeNull();
    expect(insideWindow(-0.55 - 1e-6, -0.55, 1.05)).toBeNull();
  });
  it('um ângulo dentro dos limites, mesmo dando voltas de 2π, é aceite na sua volta', () => {
    expect(insideWindow(0.5 + 2 * Math.PI, -0.55, 1.05)).toBeCloseTo(0.5, 12);
    expect(insideWindow(0.5 - 4 * Math.PI, -0.55, 1.05)).toBeCloseTo(0.5, 12);
  });
});

describe('revisão: extremos aceites, ângulo verdadeiro no alcance máximo, sem pose tangente inventada', () => {
  it('um curso que põe a caçamba exactamente no limite superior é aceite: a extremidade também é raiz', () => {
    const frame = evaluateActuators(EXCAVATOR_ASSEMBLY_V1, { ...referenceStrokes(), bucket_cylinder: 0.0509951824124073 });
    expect(frame.blocked?.code ?? null).not.toBe('CYLINDER_OUT_OF_JOINT_RANGE');
    expect(frame.status).toBe('ok');
    expect(frame.joints.find((j) => j.jointId === 'bucket_joint')!.value).toBeCloseTo(0, 9);
  });

  it('no alcance máximo geométrico (c = −1) o ângulo é π, não o mínimo de extensão', () => {
    const { candidates, singular } = planarCircleAngles({ r2: [2, 0], vB: [1, 0], K: 9, sign: 1 });
    expect(singular).toBe(true);
    expect(candidates.some((t) => Math.abs(Math.abs(t) - Math.PI) < 1e-12)).toBe(true);
    expect(candidates.some((t) => Math.abs(t) < 1e-12)).toBe(false);
  });

  it('quase tangente, mas não singular (c = 1 − 1e-7): dá os dois ângulos exactos, não uma pose tangente aproximada', () => {
    const { candidates, singular } = planarCircleAngles({ r2: [2, 0], vB: [1, 0], K: 1 + 4e-7, sign: 1 });
    expect(singular).toBe(false);
    expect(candidates).toHaveLength(2);
    expect(Math.abs(candidates[0]! - candidates[1]!)).toBeCloseTo(2 * Math.acos(1 - 1e-7), 12);
  });
});

describe('ângulos de um círculo: forma fechada e singularidades', () => {
  it('um caso geral dá dois ângulos: sin θ = 3/8, ou seja θ = asin(3/8) e π − asin(3/8)', () => {
    // r₂ = (2,0), v_B = (0,2): |R(θ)r₂ − v_B|² = 8 − 8·sin θ. Igualar a K = 5 dá sin θ = 3/8.
    const { candidates, singular } = planarCircleAngles({ r2: [2, 0], vB: [0, 2], K: 5, sign: 1 });
    expect(singular).toBe(false);
    const expected = [Math.asin(3 / 8), Math.PI - Math.asin(3 / 8)].sort((a, b) => a - b);
    const got = [...candidates].sort((a, b) => a - b);
    expect(got).toHaveLength(2);
    got.forEach((t, i) => expect(t).toBeCloseTo(expected[i]!, 12));
  });
  it('o caso tangente (|c| = 1: os dois ângulos coincidem) é marcado como singular', () => {
    // r₂ = (2,0), v_B = (1,0), K = (2−1)² = 1: a trajectória toca o pino de base num único ângulo (θ = 0).
    const { candidates, singular } = planarCircleAngles({ r2: [2, 0], vB: [1, 0], K: 1, sign: 1 });
    expect(singular).toBe(true);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toBeCloseTo(0, 12);
  });
  it('um K impossível (círculo que não toca a trajectória) é recusado como CYLINDER_UNREACHABLE', () => {
    expect(() => planarCircleAngles({ r2: [2, 0], vB: [0, 2], K: 100, sign: 1 })).toThrow(/CYLINDER_UNREACHABLE/);
  });
});

describe('a caçamba: cadeia de duas barras e o cilindro que a acciona', () => {
  it('o cilindro da caçamba com curso de referência reproduz a caçamba de referência e a ponta', () => {
    const frame = evaluateActuators(EXCAVATOR_ASSEMBLY_V1, referenceStrokes());
    const tip = frame.measurements.find((m) => m.id === 'tip.x')!.value!;
    expect(tip).toBeCloseTo(7.1469082050510435, 9);
  });

  it('o curso da caçamba mexe a caçamba de forma monótona e com fecho em todo o intervalo bem dentro dos limites', () => {
    const angles: number[] = [];
    for (const stroke of [0.2, 0.3, 0.4, 0.5]) {
      const out = solveActuatorConfiguration(EXCAVATOR_ASSEMBLY_V1, { ...referenceStrokes(), bucket_cylinder: stroke });
      expect(out.ok, `curso ${stroke}`).toBe(true);
      if (!out.ok) continue;
      angles.push(jointValue(out.config, 'bucket_joint'));
      const frame = evaluateConfiguration(EXCAVATOR_ASSEMBLY_V1, out.config);
      expect(frame.status, `curso ${stroke}`).toBe('ok');
      expect(frame.solver.closureResidualM!).toBeLessThan(1e-9);
    }
    const increasing = angles.every((v, i) => i === 0 || v > angles[i - 1]!);
    const decreasing = angles.every((v, i) => i === 0 || v < angles[i - 1]!);
    expect(increasing || decreasing).toBe(true);
  });

  it('a ligação de duas barras fecha: o pino da haste coincide com a extremidade do balancé, e o da barra com a caçamba', () => {
    const out = solveActuatorConfiguration(EXCAVATOR_ASSEMBLY_V1, { ...referenceStrokes(), bucket_cylinder: 0.4 });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const frame = evaluateConfiguration(EXCAVATOR_ASSEMBLY_V1, out.config);
    for (const m of frame.measurements.filter((item) => item.id.startsWith('closure.'))) expect(m.value!, m.id).toBeLessThan(1e-9);
  });
});

describe('a rotação superior e a coerência das partes', () => {
  it('rodar a parte superior move a lança, a cabina e a caçamba juntas, sem tocar nos valores das juntas do braço', () => {
    const base = solveActuatorConfiguration(EXCAVATOR_ASSEMBLY_V1, referenceStrokes());
    const turned = solveActuatorConfiguration(EXCAVATOR_ASSEMBLY_V1, { ...referenceStrokes(), swing_drive: 0.5 });
    expect(base.ok && turned.ok).toBe(true);
    if (!base.ok || !turned.ok) return;
    expect(jointValue(turned.config, 'boom_joint')).toBeCloseTo(jointValue(base.config, 'boom_joint'), 12);
    expect(jointValue(turned.config, 'swing')).toBeCloseTo(0.5, 12);
    const frame = evaluateConfiguration(EXCAVATOR_ASSEMBLY_V1, turned.config);
    expect(frame.status).toBe('ok');
  });

  it('a pose da caçamba sob rotação superior é a pose de referência rodada em torno do eixo de giro', () => {
    const angle = 0.5;
    const ref = solveForwardKinematics(EXCAVATOR_ASSEMBLY_V1, referenceConfiguration(EXCAVATOR_ASSEMBLY_V1));
    const out = solveActuatorConfiguration(EXCAVATOR_ASSEMBLY_V1, { ...referenceStrokes(), swing_drive: angle });
    if (!out.ok) throw new Error('falhou');
    const turned = solveForwardKinematics(EXCAVATOR_ASSEMBLY_V1, out.config);
    const tipRef = applyRigid(ref.parts.get('bucket')!, [1.30, -0.65, 0]);
    const tipTurned = applyRigid(turned.parts.get('bucket')!, [1.30, -0.65, 0]);
    // Rodar em torno de +Y do ponto de giro: o ponto de referência roda o mesmo ângulo em torno do mesmo eixo.
    const rel = [tipRef[0], tipRef[1] - 0.95, tipRef[2]] as [number, number, number];
    const expected = rotateVector([0, Math.sin(angle / 2), 0, Math.cos(angle / 2)], rel);
    expect(tipTurned[0]).toBeCloseTo(expected[0], 9);
    expect(tipTurned[1]).toBeCloseTo(expected[1] + 0.95, 9);
    expect(tipTurned[2]).toBeCloseTo(expected[2], 9);
    const expectedUpper = [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];
    expect(quatAngle(turned.parts.get('upper_body')!.q, expectedUpper)).toBeLessThan(1e-12);
  });
});

describe('determinismo e não mutação', () => {
  it('o mesmo pedido dá o mesmo quadro, byte a byte, e a ordem das chaves não conta', () => {
    const a = canonicalize(evaluateActuators(EXCAVATOR_ASSEMBLY_V1, { ...referenceStrokes(), boom_cylinder: 0.3 }));
    const reversed = Object.fromEntries(Object.entries({ ...referenceStrokes(), boom_cylinder: 0.3 }).reverse());
    expect(canonicalize(evaluateActuators(EXCAVATOR_ASSEMBLY_V1, reversed))).toBe(a);
  });
  it('não muda a montagem', () => {
    const copy = clone(); const before = canonicalize(copy);
    evaluateActuators(copy, { ...referenceStrokes(), bucket_cylinder: 0.4 });
    expect(canonicalize(copy)).toBe(before);
  });
  it('a relação curso → ângulo depende da geometria: mudar o pino de base da lança muda o ângulo para o mesmo curso', () => {
    const moved = clone();
    const base = moved.joints.find((j) => j.id === 'boom_cyl_base')!;
    base.origin.translationM = [base.origin.translationM[0] + 0.05, base.origin.translationM[1], base.origin.translationM[2]];
    const original = solveActuatorConfiguration(EXCAVATOR_ASSEMBLY_V1, { ...referenceStrokes(), boom_cylinder: 0.3 });
    const changed = solveActuatorConfiguration(moved, { ...referenceStrokes(), boom_cylinder: 0.3 });
    if (!original.ok || !changed.ok) throw new Error('alcance');
    expect(Math.abs(jointValue(original.config, 'boom_joint') - jointValue(changed.config, 'boom_joint'))).toBeGreaterThan(1e-4);
  });
});

/** Ângulo (rad) da lança com o curso exacto que o põe no valor pedido, calculado pela cinemática directa (bissecção). */
function jointAtLimit(target: number): number {
  const a = EXCAVATOR_ASSEMBLY_V1;
  const ref = referenceConfiguration(a);
  const cyl = actuator(a, 'boom_cylinder');
  const closed = a.joints.find((j) => j.id === cyl.slideJointId)!.origin.translationM[0];
  const length = (q: number) => {
    const s = solveForwardKinematics(a, { ...ref, boom_joint: q });
    const pin = worldPoint(a, s, 'boom', 'cyl_rod_pin');
    const base = s.parts.get(cyl.barrelPartId)!.t;
    return Math.hypot(pin[0] - base[0], pin[1] - base[1], pin[2] - base[2]);
  };
  return length(target) - closed;
}

