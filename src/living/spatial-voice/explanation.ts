import type { SpatialExplanationContext } from './context';

const approved = new WeakSet<object>();

export function isApprovedExplanation(value: ApprovedExplanation): boolean { return approved.has(value); }

export type ApprovedExplanation = Readonly<{ text: string; componentId: string | null; revision: string; source: 'local-plan'; evidenceIds: readonly string[] }>;

/** Deterministic descriptions only: the plan has no validated component-function field. */
export function explainSpatialContext(context: SpatialExplanationContext): ApprovedExplanation {
  const { plan, componentId, revision } = context;
  const component = componentId === null ? null : plan.components.find((item) => item.id === componentId);
  if (componentId !== null && !component) throw new Error('EXPLANATION_COMPONENT_NOT_FOUND');
  const relations = component ? plan.relations.filter((relation) => relation.fromId === component.id || relation.toId === component.id) : [];
  const lines = component
    ? [`No plano «${plan.title}», o componente seleccionado é «${component.label}» (${component.id}).`, `Origem da geometria: ${component.provenance.geometry}; posição: ${component.provenance.transform}; material: ${component.provenance.material}.`, ...(component.provenance.evidence ? [`Evidência registada: ${component.provenance.evidence}`] : []), ...relations.map((relation) => `Relação registada: ${relation.fromId} ${relation.kind} ${relation.toId}; origem: ${relation.origin}.`), 'A função deste componente não está estabelecida pelo plano.']
    : [`O Space «${plan.title}» contém ${plan.components.length} componentes no plano.`, `Componentes: ${plan.components.map((item) => item.label).join(', ')}.`];
  if (plan.unknowns.length) lines.push(`Limitações registadas: ${plan.unknowns.join('; ')}.`);
  const result = Object.freeze({ text: lines.join(' '), componentId, revision, source: 'local-plan' as const, evidenceIds: Object.freeze(component ? [component.id] : []) });
  approved.add(result);
  return result;
}
