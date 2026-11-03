/**
 * Cenário de demonstração do excavador, como sequência de quadros validados. Usado pelo exportador (JSON para os visuais) e
 * pelo teste que confirma que o JSON exportado é o que o motor produz hoje.
 */
import { canonicalize } from '../../core';
import { validateMotionFrame, type MotionFrame } from '../contracts';
import { EXCAVATOR_ASSEMBLY_V1 } from '../contracts/fixtures/excavator.assembly.v1';
import { evaluateActuators, evaluateReferencePose } from './engine';
import { commandMove, createEngineeringSession, sampleEngineeringMotion } from './runtime';

export const SCENARIO_SCHEMA = 'unfold.motion-sequence.v1' as const;

export type ScenarioFrame = { label: string; frame: MotionFrame };
export type ScenarioPayload = { schema: typeof SCENARIO_SCHEMA; assemblyId: string; frames: ScenarioFrame[] };

/** Passos do cenário: cada um é um comando de movimento, com a duração que a velocidade máxima dá. */
export const SCENARIO_STEPS: Array<[string, Record<string, number>]> = [
  ['levantar a lança', { boom_cylinder: 0.65 }],
  ['estender o braço', { stick_cylinder: 0.25 }],
  ['encolher a caçamba', { bucket_cylinder: 0.5 }],
  ['rodar a superstrutura', { swing_drive: 0.3 }],
];

export function buildExcavatorScenario(): ScenarioPayload {
  const frames: ScenarioFrame[] = [];
  const add = (label: string, frame: MotionFrame) => {
    const check = validateMotionFrame(frame);
    if (!check.ok) throw new Error(`Quadro «${label}» inválido: ${JSON.stringify(check.issues)}`);
    frames.push({ label, frame: JSON.parse(canonicalize(frame)) as MotionFrame });
  };
  add('referência', evaluateReferencePose(EXCAVATOR_ASSEMBLY_V1, { timestampS: 0, index: 0 }));

  let session = createEngineeringSession(EXCAVATOR_ASSEMBLY_V1);
  for (const [label, targets] of SCENARIO_STEPS) {
    const result = commandMove(session, { targets });
    if (!result.ok) throw new Error(`Comando «${label}» recusado: ${result.code} ${result.message}`);
    session = result.session;
    for (const [name, fraction] of [['início', 0], ['meio', 0.5], ['fim', 1]] as const) {
      add(`${label} · ${name}`, sampleEngineeringMotion(session, result.startS + result.durationS * fraction));
    }
  }

  add('exemplo bloqueado · curso acima do máximo', evaluateActuators(EXCAVATOR_ASSEMBLY_V1, { swing_drive: 0, boom_cylinder: 0.9, stick_cylinder: 0.327, bucket_cylinder: 0.477 }));
  add('exemplo bloqueado · colisão com o chão', evaluateActuators(EXCAVATOR_ASSEMBLY_V1, { swing_drive: 0, boom_cylinder: 0.3, stick_cylinder: 0.5, bucket_cylinder: 0.477 }));
  return { schema: SCENARIO_SCHEMA, assemblyId: EXCAVATOR_ASSEMBLY_V1.id, frames };
}
