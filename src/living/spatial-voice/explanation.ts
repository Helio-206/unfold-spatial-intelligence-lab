import type { SpatialExplanationContext } from './context';

const approved = new WeakSet<object>();

export function isApprovedExplanation(value: ApprovedExplanation): boolean { return approved.has(value); }

export type ApprovedExplanation = Readonly<{ text: string; componentId: string | null; revision: string; source: 'local-plan' | 'meta'; evidenceIds: readonly string[]; evidence: string }>;

/** General facts are conditional on the plan's labels, never assertions about physical reconstruction. */
function generalKnowledge(title: string, label: string): string | null {
  const domain = title.toLowerCase(); const name = label.toLowerCase();
  if (/microscop/.test(domain)) {
    if (/eyepiece|ocular/.test(name) && !/tube/.test(name)) return 'A ocular é a parte do microscópio através da qual observamos a imagem ampliada. Trabalha com as objectivas, que formam a imagem da amostra.';
    if (/objective|objectiva/.test(name)) return 'As objectivas recolhem luz da amostra e formam uma imagem ampliada, que observamos através da ocular.';
  }
  if (/lung|pulm/.test(domain)) {
    if (/trachea|traqueia/.test(name)) return 'A traqueia conduz o ar até aos brônquios principais, que se ramificam nos pulmões. Esta representação é conceptual e não demonstra precisão anatómica.';
    if (/bronch|brônqu/.test(name)) return 'Os brônquios conduzem o ar da traqueia e ramificam-se nos pulmões. Esta representação é conceptual e não demonstra precisão anatómica.';
  }
  return null;
}

/** Local plan data and separately labelled general knowledge. */
export function explainSpatialContext(context: SpatialExplanationContext): ApprovedExplanation {
  const { plan, componentId, revision } = context;
  const component = componentId === null ? null : plan.components.find((item) => item.id === componentId);
  if (componentId !== null && !component) throw new Error('EXPLANATION_COMPONENT_NOT_FOUND');
  const relations = component ? plan.relations.filter((relation) => relation.fromId === component.id || relation.toId === component.id) : [];
  const text = component ? generalKnowledge(plan.title, component.label) ?? `O plano identifica este componente como ${component.label}, mas não estabelece a sua função.` : `Este Space contém ${plan.components.length} componentes. A sua geometria é conceptual.`;
  const evidence = component ? [`Componente ${component.label} (${component.id}).`, `Geometria: ${component.provenance.geometry}; posição: ${component.provenance.transform}; material: ${component.provenance.material}.`, component.provenance.evidence, ...relations.map((relation) => `${relation.fromId} ${relation.kind} ${relation.toId} (${relation.origin}).`), 'A função descrita é conhecimento geral condicionado à identificação pelo nome; não é observação da geometria.'] : [`Space: ${plan.title}.`];
  if (plan.unknowns.length) evidence.push(`Limitações: ${plan.unknowns.join('; ')}.`);
  const result = Object.freeze({ text, evidence: evidence.filter(Boolean).join(' '), componentId, revision, source: 'local-plan' as const, evidenceIds: Object.freeze(component ? [component.id] : []) });
  approved.add(result);
  return result;
}

/** Structural validation is not factual verification; the UI must disclose the model origin. */
export function approveMetaExplanation(text: string, evidence: string, componentId: string, revision: string): ApprovedExplanation {
  if (!text.trim() || text.length > 1200 || !evidence.trim() || evidence.length > 5000 || !componentId || !revision) throw new Error('INVALID_SPATIAL_ANSWER');
  const result: ApprovedExplanation = Object.freeze({ text, evidence, componentId, revision, source: 'meta', evidenceIds: Object.freeze([componentId]) });
  approved.add(result);
  return result;
}
