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
const PROPERTY_NAMES: Record<string, string> = { length: 'comprimento', height: 'altura', thickness: 'espessura', width: 'largura', sill: 'peitoril' };
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
