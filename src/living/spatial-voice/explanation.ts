import type { SpatialExplanationContext } from './context';

const approved = new WeakSet<object>();

export function isApprovedExplanation(value: ApprovedExplanation): boolean { return approved.has(value); }

export type ApprovedExplanation = Readonly<{ text: string; componentId: string | null; revision: string; source: 'local-plan'; evidenceIds: readonly string[] }>;

/** General facts are conditional on the plan's labels, never assertions about physical reconstruction. */
function generalKnowledge(title: string, label: string): string | null {
  const domain = title.toLowerCase(); const name = label.toLowerCase();
  if (/microscop/.test(domain)) {
    if (/eyepiece|ocular/.test(name) && !/tube/.test(name)) return 'Conhecimento geral, condicionado à identificação pelo nome: a ocular é a lente pela qual se observa a imagem ampliada formada pelas objectivas. O plano não demonstra a óptica interna nem o alinhamento entre estas peças.';
    if (/objective|objectiva/.test(name)) return 'Conhecimento geral, condicionado à identificação pelo nome: as objectivas recolhem luz da amostra e formam uma imagem ampliada, observada através da ocular. O plano não demonstra ampliações nem a óptica interna.';
  }
  if (/lung|pulm/.test(domain)) {
    if (/trachea|traqueia/.test(name)) return 'Conhecimento geral, condicionado à identificação pelo nome: a traqueia conduz ar em direcção aos brônquios principais, que se ramificam nos pulmões. A geometria deste Space é conceptual e não comprova precisão anatómica ou funcionamento.';
    if (/bronch|brônqu/.test(name)) return 'Conhecimento geral, condicionado à identificação pelo nome: os brônquios conduzem o ar da traqueia e ramificam-se nos pulmões. A geometria deste Space é conceptual e não comprova precisão anatómica ou funcionamento.';
  }
  return null;
}

/** Local plan data and separately labelled general knowledge. */
export function explainSpatialContext(context: SpatialExplanationContext): ApprovedExplanation {
  const { plan, componentId, revision } = context;
  const component = componentId === null ? null : plan.components.find((item) => item.id === componentId);
  if (componentId !== null && !component) throw new Error('EXPLANATION_COMPONENT_NOT_FOUND');
  const relations = component ? plan.relations.filter((relation) => relation.fromId === component.id || relation.toId === component.id) : [];
  const lines = component
    ? [`No plano «${plan.title}», o componente seleccionado é «${component.label}» (${component.id}).`, `Origem da geometria: ${component.provenance.geometry}; posição: ${component.provenance.transform}; material: ${component.provenance.material}.`, ...(component.provenance.evidence ? [`Evidência registada: ${component.provenance.evidence}`] : []), ...relations.map((relation) => `Relação registada: ${relation.fromId} ${relation.kind} ${relation.toId}; origem: ${relation.origin}.`), generalKnowledge(plan.title, component.label) ?? 'A função deste componente não está estabelecida pelo plano.']
    : [`O Space «${plan.title}» contém ${plan.components.length} componentes no plano.`, `Componentes: ${plan.components.map((item) => item.label).join(', ')}.`];
  if (plan.unknowns.length) lines.push(`Limitações registadas: ${plan.unknowns.join('; ')}.`);
  const result = Object.freeze({ text: lines.join(' '), componentId, revision, source: 'local-plan' as const, evidenceIds: Object.freeze(component ? [component.id] : []) });
  approved.add(result);
  return result;
}
