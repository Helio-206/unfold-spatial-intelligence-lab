/**
 * Sistema de comportamentos reutilizável. Um comportamento expõe entradas, saídas, estado,
 * restrições, componentes, efeitos observáveis e tópicos de explicação — sem fingir física validada.
 */
import type { Assembly } from '../contracts';
import type { LivingScene } from './contracts';

export type BehaviourKind = 'hydraulic_cylinder' | 'revolute_arm' | 'wheel_spin' | 'steering' | 'door_hinge' | 'gear_pair' | 'rotary_drive';
export type Behaviour = {
  id: string; kind: BehaviourKind; label: string;
  inputs: string[]; outputs: string[]; constraints: string[];
  componentIds: string[]; observableEffects: string[]; explanationTopics: string[];
  evidenceLevel: 'kinematically_valid' | 'mechanically_plausible';
  /** Para gear_pair: razão de transmissão declarada (saída = -entrada × ratio). */
  gearRatio?: number;
};

export function behavioursFor(_scene: LivingScene, assembly: Assembly): Behaviour[] {
  const out: Behaviour[] = [];
  for (const a of assembly.actuators) {
    if (a.kind === 'hydraulic_cylinder') {
      const driven = assembly.joints.find(j => j.id === a.drives.jointId);
      out.push({
        id: `behaviour:${a.id}`, kind: 'hydraulic_cylinder', label: `${a.label}: estender/retrair`,
        inputs: [`curso do actuador ${a.id} (m)`], outputs: [`ângulo da junta ${a.drives.jointId} (rad)`, `pose de ${driven?.childPartId ?? '?'} e descendentes`],
        constraints: [`curso ∈ [${a.stroke.min.value}, ${a.stroke.max.value}] m`, 'fecho de laço por pinos em cada instante'],
        componentIds: [a.id, a.barrelPartId, a.rodPartId, ...(driven ? [driven.parentPartId, driven.childPartId] : [])],
        observableEffects: ['haste desliza no barril (junta prismática)', 'parte accionada roda em torno do pino', 'descendentes acompanham por hierarquia'],
        explanationTopics: ['função do cilindro', 'como a extensão roda a parte accionada', 'limites de curso e de junta'],
        evidenceLevel: 'kinematically_valid',
      });
    } else {
      out.push({
        id: `behaviour:${a.id}`, kind: 'rotary_drive', label: a.label,
        inputs: [`ângulo da junta ${a.jointId} (rad)`], outputs: [`rotação em torno de ${a.jointId}`],
        constraints: ['limites da junta revolute'], componentIds: [a.id],
        observableEffects: ['rotação em torno do eixo declarado'], explanationTopics: ['função do accionamento rotativo'],
        evidenceLevel: 'kinematically_valid',
      });
    }
  }
  for (const j of assembly.joints) {
    if (j.type !== 'revolute') continue;
    const covered = assembly.actuators.some(a => (a.kind === 'hydraulic_cylinder' ? a.drives.jointId : a.jointId) === j.id);
    if (covered) continue;
    out.push({
      id: `behaviour:joint:${j.id}`, kind: 'revolute_arm', label: `Rotação em ${j.id}`,
      inputs: [`ângulo ${j.id} (rad)`], outputs: [`pose de ${j.childPartId} e descendentes`],
      constraints: j.limits ? [`ângulo ∈ [${j.limits.min.value}, ${j.limits.max.value}] rad`] : ['sem limites declarados — movimento não demonstrável'],
      componentIds: [j.parentPartId, j.childPartId], observableEffects: ['rotação hierárquica dos descendentes'],
      explanationTopics: ['articulação'], evidenceLevel: 'kinematically_valid',
    });
  }
  return out;
}

/** Adaptador de engrenagens: relação cinemática declarada, não simulação de contacto entre dentes. */
export function gearPairBehaviour(id: string, label: string, driverTeeth: number, drivenTeeth: number): Behaviour & { outputAngleRad: (inputRad: number) => number } {
  const ratio = driverTeeth / drivenTeeth;
  return {
    id, kind: 'gear_pair', label, gearRatio: ratio,
    inputs: ['ângulo da engrenagem motora (rad)'], outputs: ['ângulo da engrenagem movida (rad)'],
    constraints: [`razão declarada ${driverTeeth}:${drivenTeeth}`, 'sem modelo de folga, atrito ou carga'],
    componentIds: [], observableEffects: ['rotação inversa proporcional à razão de dentes'],
    explanationTopics: ['razão de transmissão', 'troca velocidade/binário (conceptual, sem valores físicos)'],
    evidenceLevel: 'mechanically_plausible',
    outputAngleRad: (inputRad: number) => -inputRad * ratio,
  };
}

/** Força hidráulica só com pressão e diâmetro conhecidos; caso contrário, resultado conceptual normalizado. */
export function hydraulicForce(pressurePa: number | null, boreDiameterM: number | null):
  | { kind: 'calculated'; forceN: number; basis: string }
  | { kind: 'conceptual_normalised'; forceN: null; basis: string } {
  if (pressurePa !== null && boreDiameterM !== null && pressurePa > 0 && boreDiameterM > 0) {
    const area = Math.PI * (boreDiameterM / 2) ** 2;
    return { kind: 'calculated', forceN: pressurePa * area, basis: 'F = P × A, A = π·(d/2)², com pressão e diâmetro declarados na cena.' };
  }
  return { kind: 'conceptual_normalised', forceN: null, basis: 'Pressão e/ou diâmetro desconhecidos nesta cena: mostra-se apenas a relação conceptual (mais curso → mais deslocamento), sem newtons inventados.' };
}
