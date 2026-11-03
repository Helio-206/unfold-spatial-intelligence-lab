/**
 * Deterministic fixture replies in the `spatial_agent_result.v1` shape, used only when the live model is unavailable.
 * They are labelled "fixture" in the interface, pass the same parser as live replies, and only ever cite components
 * that are in the request. Statements are limited to what the assembly says (which actuator drives which joint); they
 * never claim a computed consequence.
 */
import type { SpatialAgentRequestV1, SpatialAgentResultV1 } from '../../spatial-agent';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt');
const isEnglish = (q: string) => /\b(the|what|which|show|me|this|happens|lifts?|raises?|moves?|if|extend)\b/.test(norm(q)) && !/\b(o|a|que|qual|mostra|este|esta|lanca|cacamba)\b/.test(norm(q));

type Result = SpatialAgentResultV1;
const answer = (text: string, evidenceIds: string[], basis: Result['basis'] = 'scene'): Result => ({ schema: 'spatial_agent_result.v1', kind: 'ANSWER', text, basis, evidenceIds, question: null, action: null });

export function fixtureAgentResult(request: SpatialAgentRequestV1): Result {
  const q = norm(request.query);
  const en = isEnglish(request.query);
  const ids = new Set(request.scene?.components.map((c) => c.id) ?? []);
  const keep = (list: string[]) => list.filter((id) => ids.has(id));
  const label = (id: string) => { const l = request.scene?.components.find((c) => c.id === id)?.label ?? id; return l.charAt(0).toLocaleLowerCase('pt') + l.slice(1); };
  const selected = request.scene?.selectedId ?? null;
  const cylinderOf = (id: string | null) => !id ? null : id.endsWith('_cylinder') ? id : id.endsWith('_cyl_barrel') || id.endsWith('_cyl_rod') ? `${id.split('_cyl_')[0]}_cylinder` : null;

  // "what happens if I extend this cylinder?" — no computed claim; offer a supported experiment
  if (/\b(estend\w*|extend\w*|alonga\w*)\b/.test(q) && /\b(cilindro|cylinder|este|esta|this)\b/.test(q)) {
    const cyl = cylinderOf(selected);
    if (!cyl || !ids.has(cyl)) {
      return { schema: 'spatial_agent_result.v1', kind: 'REQUEST_CLARIFICATION', text: en ? 'Which cylinder do you mean?' : 'A que cilindro se refere?', basis: 'scene', evidenceIds: [], question: en ? 'Select a hydraulic cylinder in the scene, then ask again.' : 'Seleccione um cilindro hidráulico na cena e repita a pergunta.', action: null };
    }
    return answer(en
      ? `I don't compute motion; the engineering engine does. I can set up a supported experiment: extend the ${label(cyl)} and show the state the engine returns. The engine is not connected here, so only a labelled fixture preview is available.`
      : `Não calculo o movimento: isso é do motor de engenharia. Posso preparar uma experiência suportada: estender o ${label(cyl)} e mostrar o estado que o motor devolver. O motor não está ligado aqui, por isso só há uma pré-visualização de fixture, rotulada como tal.`, keep([cyl]));
  }
  // what lifts / drives the boom, the stick, the bucket
  const drives = /\b(levanta\w*|eleva\w*|sobe|acciona\w*|aciona\w*|move\w*|roda\w*|lifts?|raises?|drives?|moves?|powers?|curl\w*)\b/.test(q);
  if (drives && /\b(lanca|boom)\b/.test(q)) {
    return answer(en
      ? 'The boom is driven by one hydraulic cylinder: the boom cylinder, between the upper structure and the underside of the boom. In the assembly it drives the boom joint.'
      : 'A lança é accionada por um cilindro hidráulico: o cilindro da lança, entre o corpo superior e a parte de baixo da lança. Na montagem, é ele que acciona a articulação da lança.', keep(['boom_cylinder', 'boom_cyl_barrel', 'boom_cyl_rod', 'boom']));
  }
  if (drives && /\b(braco|stick|arm)\b/.test(q)) {
    return answer(en ? 'The stick is driven by the stick cylinder, mounted on top of the boom.' : 'O braço é accionado pelo cilindro do braço, montado em cima da lança.', keep(['stick_cylinder', 'stick_cyl_barrel', 'stick_cyl_rod', 'stick']));
  }
  if (drives && /\b(cacamba|balde|bucket)\b/.test(q)) {
    return answer(en ? 'The bucket is driven by the bucket cylinder through a two-bar linkage: the idler link and the bucket link.' : 'A caçamba é accionada pelo cilindro da caçamba através de duas barras: o balancé e a barra de ligação.', keep(['bucket_cylinder', 'idler_link', 'bucket_link', 'bucket']));
  }
  // explicit Portuguese commands the product's authorisation accepts: foca/isola/enquadra, mostra/inspeciona, seleciona
  const verb = /\b(foca|isola|enquadra)\b/.test(q) ? 'Focus' : /\b(mostra|inspeciona)\b/.test(q) ? 'Inspect' : /\b(seleciona|selecionar|seleccionar)\b/.test(q) ? 'Select' : null;
  if (verb && !/[?¿]/.test(request.query)) {
    const match = [...(request.scene?.components ?? [])].sort((a, b) => b.label.length - a.label.length).find((c) => q.includes(norm(c.label)));
    if (match) {
      return { schema: 'spatial_agent_result.v1', kind: 'PROPOSE_ACTION', text: `${verb === 'Focus' ? 'Enquadrar' : verb === 'Inspect' ? 'Inspeccionar' : 'Seleccionar'}: ${match.label}.`, basis: 'scene', evidenceIds: [match.id], question: null,
        action: { kind: verb, target: { reference: 'label', label: match.label, ordinal: null }, value: null, valueMode: null, unit: null, axis: null, opening: null } };
    }
  }
  if (/\b(remove\w*|apaga\w*|elimina\w*|delete|desmonta\w*|corta\w*|muda\w*|altera\w*)\b/.test(q)) {
    return answer(en
      ? 'That is not a supported action here: in this mode I can select, inspect and frame components. Nothing was changed.'
      : 'Isso não é uma acção suportada aqui: neste modo posso seleccionar, inspeccionar e enquadrar componentes. Não alterei nada.', [], 'general');
  }
  return answer(en
    ? 'I have no prepared fixture answer for that. With the live model connected I could try; nothing was inferred.'
    : 'Não tenho uma resposta de fixture para isso. Com o modelo ligado poderia tentar; nada foi inferido.', [], 'unknown');
}
