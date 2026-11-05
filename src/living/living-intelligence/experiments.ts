/**
 * Experiências guiadas e limitadas. Estado transitório: nunca muta a montagem autoritativa;
 * parâmetros alterados produzem uma cópia avaliada pelo motor, com antes/depois comparáveis.
 */
import type { Assembly } from '../contracts';
import type { MotionFrame } from '../contracts';
import { evaluateActuators, evaluateReferencePose, createEngineeringSession, evaluateParameterChange, closeEngineeringSession, type ParameterPatch } from './engineering-bridge';
import { hydraulicForce } from './behaviours';
import type { Provenance } from '../../core';

export type Experiment = {
  id: string; question: string; adjustable: string[];
  run: (input: Record<string, number>) => ExperimentResult;
};
export type ExperimentResult =
  | { ok: true; kind: 'measured' | 'conceptual'; summary: string; before: Record<string, number>; after: Record<string, number>; resetHint: string }
  | { ok: false; code: string; message: string };

const partPos = (frame: MotionFrame, partId: string) => frame.parts.find(p => p.partId === partId)?.translationM ?? null;
const dist2d = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[2]! - b[2]!);

function frameAt(assembly: Assembly, actuatorId: string, value: number): MotionFrame {
  const reference = evaluateReferencePose(assembly);
  const values = Object.fromEntries(reference.actuators.map(a => [a.actuatorId, a.value]));
  return evaluateActuators(assembly, { ...values, [actuatorId]: value });
}

/** 1 — Como a extensão do cilindro muda a posição da lança (ângulo e altura da ponta do braço). */
export function experimentCylinderBoom(assembly: Assembly): Experiment {
  return {
    id: 'exp-cylinder-boom', question: 'Como é que estender o cilindro da lança muda a posição da lança?',
    adjustable: ['strokeM'],
    run: (input) => {
      const cyl = assembly.actuators.find(a => a.id === 'boom_cylinder' && a.kind === 'hydraulic_cylinder');
      if (!cyl || cyl.kind !== 'hydraulic_cylinder') return { ok: false, code: 'UNAVAILABLE', message: 'Cilindro da lança indisponível nesta cena.' };
      const stroke = Math.min(cyl.stroke.max.value, Math.max(cyl.stroke.min.value, input.strokeM ?? cyl.referenceStroke.value + 0.3));
      const before = frameAt(assembly, cyl.id, cyl.referenceStroke.value);
      const after = frameAt(assembly, cyl.id, stroke);
      if (before.status !== 'ok' || after.status !== 'ok') return { ok: false, code: after.blocked?.code ?? 'BLOCKED', message: after.blocked?.message ?? 'Movimento bloqueado pelo motor.' };
      const angle = (f: MotionFrame) => f.joints.find(j => j.jointId === 'boom_joint')?.value ?? NaN;
      const tip = (f: MotionFrame) => partPos(f, 'bucket');
      const b = { strokeM: cyl.referenceStroke.value, boomAngleRad: angle(before), tipHeightM: tip(before)?.[1] ?? NaN };
      const a = { strokeM: stroke, boomAngleRad: angle(after), tipHeightM: tip(after)?.[1] ?? NaN };
      const force = hydraulicForce(cyl.hydraulics.supplyPressure?.value ?? null, cyl.hydraulics.boreDiameter?.value ?? null);
      return { ok: true, kind: force.kind === 'calculated' ? 'measured' : 'conceptual', before: b, after: a,
        summary: `Curso ${b.strokeM.toFixed(2)}→${a.strokeM.toFixed(2)} m roda a lança ${b.boomAngleRad.toFixed(3)}→${a.boomAngleRad.toFixed(3)} rad e a caçamba sobe para ${a.tipHeightM.toFixed(2)} m de altura. ${force.basis}`,
        resetHint: 'Repor devolve o curso de referência sem tocar na montagem guardada.' };
    },
  };
}

/** 2 — Como um ângulo de junta diferente muda o alcance horizontal. */
export function experimentReach(assembly: Assembly): Experiment {
  return {
    id: 'exp-reach', question: 'Como é que um ângulo diferente da lança muda o alcance?',
    adjustable: ['strokeM'],
    run: (input) => {
      const cyl = assembly.actuators.find(a => a.id === 'boom_cylinder' && a.kind === 'hydraulic_cylinder');
      if (!cyl || cyl.kind !== 'hydraulic_cylinder') return { ok: false, code: 'UNAVAILABLE', message: 'Indisponível nesta cena.' };
      const base = frameAt(assembly, cyl.id, cyl.referenceStroke.value);
      const stroke = Math.min(cyl.stroke.max.value, Math.max(cyl.stroke.min.value, input.strokeM ?? cyl.referenceStroke.value));
      const moved = frameAt(assembly, cyl.id, stroke);
      if (base.status !== 'ok' || moved.status !== 'ok') return { ok: false, code: 'BLOCKED', message: moved.blocked?.message ?? 'Bloqueado.' };
      const origin = partPos(base, 'chassis') ?? [0, 0, 0];
      const reach = (f: MotionFrame) => { const t = partPos(f, 'bucket'); return t ? dist2d(t, origin) : NaN; };
      const before = { reachM: reach(base) }, after = { reachM: reach(moved) };
      return { ok: true, kind: 'measured', before, after,
        summary: `Alcance horizontal da caçamba: ${before.reachM.toFixed(2)} m → ${after.reachM.toFixed(2)} m (distância no plano ao chassis, calculada das poses do motor).`,
        resetHint: 'Repor restaura a configuração de referência.' };
    },
  };
}

/** 3 — Braço de alavanca: mover o pino da haste muda a relação curso→ângulo. Proposta transitória via motor. */
export function experimentLeverArm(assembly: Assembly, provenance: Provenance): Experiment {
  return {
    id: 'exp-lever-arm', question: 'Como é que mudar o braço de alavanca do cilindro muda a relação curso→ângulo?',
    adjustable: ['offsetM'],
    run: (input) => {
      const cyl = assembly.actuators.find(a => a.id === 'boom_cylinder' && a.kind === 'hydraulic_cylinder');
      if (!cyl || cyl.kind !== 'hydraulic_cylinder') return { ok: false, code: 'UNAVAILABLE', message: 'Indisponível nesta cena.' };
      const constraint = assembly.constraints.find(c => c.id === cyl.drives.constraintIds[0]);
      if (!constraint) return { ok: false, code: 'UNAVAILABLE', message: 'Pino de fecho não declarado.' };
      const rodSide = constraint.a.partId === cyl.rodPartId ? constraint.b : constraint.a;
      const part = assembly.parts.find(p => p.id === rodSide.partId);
      const point = part?.points.find(p => p.id === rodSide.pointId);
      if (!part || !point) return { ok: false, code: 'UNAVAILABLE', message: 'Ponto de ancoragem não encontrado.' };
      const offset = Math.min(0.3, Math.max(-0.3, input.offsetM ?? 0.1));
      const patch: ParameterPatch = { kind: 'point_position', partId: part.id, pointId: point.id, positionM: [point.positionM[0] + offset, point.positionM[1], point.positionM[2]], provenance };
      const session = createEngineeringSession(structuredClone(assembly));
      try {
        const result = evaluateParameterChange(session, patch);
        if (!result.ok) return { ok: false, code: result.code, message: result.message };
        const angle = (f: MotionFrame) => f.joints.find(j => j.jointId === 'boom_joint')?.value ?? NaN;
        return { ok: true, kind: 'measured', before: { boomAngleRad: angle(result.before) }, after: { boomAngleRad: angle(result.after) },
          summary: `Deslocar o pino ${offset >= 0 ? '+' : ''}${offset.toFixed(2)} m muda o ângulo da lança na pose avaliada de ${angle(result.before).toFixed(3)} para ${angle(result.after).toFixed(3)} rad para o mesmo curso — proposta transitória, a montagem guardada não foi alterada (deslocamento máximo ${result.maxPartDisplacementM?.toFixed(3) ?? '?'} m).`,
          resetHint: 'Fechar a experiência descarta a cópia com o parâmetro alterado.' };
      } finally { closeEngineeringSession(session); }
    },
  };
}

export function excavatorExperiments(assembly: Assembly, provenance: Provenance): Experiment[] {
  return [experimentCylinderBoom(assembly), experimentReach(assembly), experimentLeverArm(assembly, provenance)];
}
