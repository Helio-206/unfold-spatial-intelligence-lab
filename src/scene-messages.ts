import type { ConfirmedReference } from './scene-authorization';

/**
 * O que o utilizador lê quando a guarda de valores confirmados recusa alguma coisa. Os códigos (`AUTHORIZATION_REQUIRED`,
 * `MACHINE_CANNOT_TOUCH_CONFIRMED`, ...) são para o código e para os testes; no ecrã não dizem nada a ninguém.
 * Só se traduz uma mensagem que seja exactamente um destes códigos; o resto (mensagens já escritas em português) passa igual.
 */
const REVALIDATE = 'Volte a pré-visualizar e confirme de novo.';

const MESSAGES: Record<string, string> = {
  MACHINE_CANNOT_TOUCH_CONFIRMED: 'Uma proposta do Muse (ou do sistema) não pode alterar, apagar nem repor valores que uma pessoa confirmou. Faça essa alteração directamente no inspector.',
  AUTHORIZATION_REQUIRED: 'Esta alteração toca em valores confirmados e precisa da sua autorização: reveja a pré-visualização e carregue em «Aplicar».',
  AUTHORIZATION_UNKNOWN: `A autorização desta alteração não é reconhecida. ${REVALIDATE}`,
  AUTHORIZATION_ALREADY_USED: `A autorização desta alteração já foi usada. ${REVALIDATE}`,
  AUTHORIZATION_EXPIRED: `A autorização desta alteração expirou. ${REVALIDATE}`,
  AUTHORIZATION_DIGEST_MISMATCH: `A autorização não corresponde ao que seria aplicado agora. ${REVALIDATE}`,
  AUTHORIZATION_REVISION_MISMATCH: `A cena mudou depois de a alteração ter sido autorizada. ${REVALIDATE}`,
  AUTHORIZATION_SESSION_MISMATCH: `A autorização pertence a outra sessão. ${REVALIDATE}`,
  MODEL_CANNOT_AUTHORIZE: 'Só uma pessoa, na interface, pode autorizar alterações a valores confirmados.',
  CONFIRMATION_REQUIRES_HUMAN_ACTOR: 'Só uma pessoa pode confirmar um valor; um modelo ou o sistema não o pode fazer.',
  CONTEXT_INCONSISTENT: 'O pedido diz vir da interface mas não tem uma pessoa associada, por isso foi recusado.',
  STALE_PREVIEW: `A cena mudou depois da pré-visualização. ${REVALIDATE}`,
  PREVIEW_TAMPERED: `A pré-visualização já não corresponde ao que seria aplicado agora. ${REVALIDATE}`,
  PREVIEW_BLOCKED: 'Esta pré-visualização está bloqueada e não pode ser aplicada.',
  GEOMETRY_REQUIRED: 'Este componente não tem geometria para alterar.',
  NEW_GEOMETRY_CANNOT_CLAIM_HUMAN_VERIFICATION: 'Uma geometria nova não pode vir já marcada como verificada por uma pessoa.',
  ROOM_MERGE_SINGLE_ROOM: 'Esta parede fecha uma só divisão: removê-la abriria a divisão para fora, por isso o motor não a remove.',
  ROOM_MERGE_MORE_THAN_TWO_ROOMS: 'Esta parede é limite de três ou mais divisões; o motor só funde duas.',
  ROOM_MERGE_UNSUPPORTED_TRANSFORM: 'Uma das divisões (ou das paredes do seu contorno) tem posição, rotação, escala ou grupo próprios. O motor só funde divisões cujo polígono está já no referencial da cena: converter referenciais a meio podia dar uma união que não é a que se vê, por isso não a faz.',
  ROOM_MERGE_NOT_POLYGON: 'Uma das divisões não tem um polígono que o motor consiga fundir.',
  ROOM_MERGE_EDGE_MISMATCH: 'A aresta que as duas divisões partilham não coincide com esta parede (a parede é mais curta ou mais comprida do que a aresta, ou a partilha é só parcial).',
  ROOM_MERGE_TOUCH_ELSEWHERE: 'As duas divisões tocam-se também noutro troço: a união teria um buraco ou um corte, por isso não é feita.',
  ROOM_MERGE_NOT_SIMPLE: 'O polígono resultante não seria simples (as divisões sobrepõem-se ou o contorno cruza-se), por isso a fusão não é feita.',
  ROOM_MERGE_OTHER_RELATIONS: 'Uma das divisões tem ligações que não são paredes do seu contorno, e o motor não sabe o que fazer com elas.',
  ROOM_MERGE_AREA_NOT_CONSERVED: 'A área da divisão fundida não bate certo com a soma das duas (erro acima de 1e-9): o motor não consegue provar a fusão.',
  AUTHORIZED_VALUE_NOT_CORRECTED: 'Não foi possível registar a autorização desta alteração. Nada foi aplicado.',
};

export function explainSceneError(message: string): string {
  return Object.hasOwn(MESSAGES, message) ? MESSAGES[message]! : message;
}

const FIELD_NAMES: Record<string, string> = {
  geometry: 'geometria',
  'transform.translationM': 'posição',
  'transform.rotation': 'rotação',
  'transform.scale': 'escala',
  node: 'o próprio componente',
  relation: 'relação',
  constraint: 'restrição',
};
const PROPERTY_NAMES: Record<string, string> = { length: 'comprimento', height: 'altura', thickness: 'espessura', width: 'largura', sill: 'peitoril', area: 'área', name: 'nome' };
const MAX_LISTED = 6;

function fieldName(field: string): string {
  if (Object.hasOwn(FIELD_NAMES, field)) return FIELD_NAMES[field]!;
  const property = /^(?:component\.)?properties\.(.+)$/.exec(field)?.[1] ?? field;
  return Object.hasOwn(PROPERTY_NAMES, property) ? PROPERTY_NAMES[property]! : property;
}

/**
 * Frase para o preview quando a alteração toca valores confirmados por uma pessoa: o clique em «Aplicar» é a autorização,
 * por isso quem clica tem de ver o que vai ser alterado. Vazia se não toca em nada.
 */
export function confirmedNotice(touched: readonly ConfirmedReference[], labelOf: (entityId: string) => string): string {
  if (!touched.length) return '';
  const byEntity = new Map<string, string[]>();
  for (const { entityId, field } of touched) {
    const names = byEntity.get(entityId) ?? [];
    const name = fieldName(field);
    if (!names.includes(name)) names.push(name);
    byEntity.set(entityId, names);
  }
  const entries = [...byEntity].map(([entityId, names]) => `${labelOf(entityId)}: ${names.join(', ')}`);
  const listed = entries.slice(0, MAX_LISTED).join('; ') + (entries.length > MAX_LISTED ? ` e mais ${entries.length - MAX_LISTED}` : '');
  return `Atenção: esta alteração toca em valores confirmados (${listed}). «Aplicar» autoriza-a.`;
}
