/**
 * Pure HTML for the confirmations the server needs before the laboratory opens. Nothing here is pre-filled: every field
 * starts empty/unchecked and only a person's action changes it. Strings are escaped; no DOM access.
 */
import type { HandoffExtra, HandoffHuman, ReviewHandoff } from './integration';
import type { ReviewState } from './review';

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const KIND: Record<string, string> = { hypothesis: 'afirmação do modelo', relation: 'relação', request: 'pedido de alteração' };

export type GatewayMessage = { tone: 'alert' | 'status'; lines: string[]; /** offer the two ways to start again */ restart?: boolean } | null;

/** The server session is gone: nothing can be sent, and the person must be able to start again without reloading the page. */
export const EXPIRED_MESSAGE: NonNullable<GatewayMessage> = { tone: 'alert', restart: true, lines: ['A sessão do servidor expirou ou o servidor foi reiniciado. Nada foi gravado e esta revisão já não pode ser enviada.'] };
export const restartActionsHtml = (): string => '<div class="ux-row ux-restart-actions"><button class="u-btn u-btn--ink" type="button" data-flow="restart">Importar outra fonte</button><button class="u-btn u-btn--outline" type="button" data-flow="restart">Novo projecto</button></div>';

function extraRow(e: HandoffExtra): string {
  const key = esc(e.key);
  const btn = (d: 'confirm' | 'reject', text: string) => `<button class="u-btn ${e.decision === d ? 'u-btn--ink' : 'u-btn--outline'}" type="button" data-gw="extra" data-key="${key}" data-decision="${d}" aria-pressed="${e.decision === d}">${text}</button>`;
  // a request cannot be confirmed: there is no adapter for it, so the only honest answer is to reject it
  const choices = e.kind === 'request' ? btn('reject', 'Ignorar') : btn('confirm', 'Confirmar') + btn('reject', 'Rejeitar');
  return `<li data-decided="${e.decision ?? 'none'}"><span class="u-label">${esc(KIND[e.kind] ?? e.kind)}</span><span class="ux-gw-label">${esc(e.label)}</span><span class="ux-gw-choices">${choices}</span></li>`;
}

/** What still stops the review from being sent, one plain line each. Per-item "sem decisão" lines are folded into one count. */
export function missingLines(handoff: ReviewHandoff): string[] {
  const blockers = handoff.blockers();
  const undecidedExtras = handoff.extras().filter((e) => e.decision === undefined).length;
  const rest = blockers.filter((b) => !b.startsWith('item sem decisão:'));
  const undecidedOther = blockers.filter((b) => b.startsWith('item sem decisão:') && !b.startsWith('item sem decisão: entity:')).length;
  return [...rest, ...(undecidedExtras || undecidedOther ? [`${Math.max(undecidedExtras, undecidedOther)} relação(ões) ou afirmação(ões) do modelo por decidir (abaixo)`] : [])];
}
export const missingHtml = (lines: string[]): string => lines.length
  ? `<p class="u-label">o que falta para o servidor aceitar:</p><ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`
  : '<p class="u-label">Nada falta: a revisão pode ser enviada.</p>';

/** What this review will do at the server and what it cannot do, so a decision is never mistaken for an applied change. */
export function sentSummary(handoff: ReviewHandoff, ui: ReviewState): string[] {
  const hypotheses = ui.items.filter((i) => i.status === 'hypothesis' && i.decision !== 'pending');
  const confirmed = hypotheses.filter((i) => i.decision === 'confirmed').length;
  const rejected = hypotheses.filter((i) => i.decision === 'rejected').length;
  const corrected = hypotheses.filter((i) => i.decision === 'corrected').length;
  const extras = handoff.extras().filter((e) => e.decision !== undefined).length;
  const lines = [`Vai ser enviado: ${hypotheses.length} decisões sobre entidades em hipótese (${confirmed} confirmadas, ${rejected} rejeitadas${corrected ? `, ${corrected} correcções enviadas como rejeição da interpretação original` : ''}) e ${extras} sobre relações e afirmações do modelo.`];
  lines.push('A API só aplica à montagem a largura da caçamba; nenhuma correcção de texto nem valor introduzido altera a geometria.');
  return lines;
}

export function gatewayPanel(handoff: ReviewHandoff, ui: ReviewState, message: GatewayMessage, busy: boolean): string {
  const h: HandoffHuman = handoff.human();
  const extras = handoff.extras();
  const open = extras.filter((e) => e.decision === undefined).length;
  const notes = handoff.localNotes(ui);
  const bulk = extras.some((e) => e.kind !== 'request')
    ? `<div class="ux-row"><button class="u-btn u-btn--outline" type="button" data-gw="extra-all" data-decision="reject">Rejeitar todas as não decididas</button><button class="u-btn u-btn--outline" type="button" data-gw="extra-all" data-decision="confirm">Confirmar todas as não decididas</button></div>`
    : '';
  return `<section class="ux-gw" aria-labelledby="ux-gw-title" ${busy ? 'aria-busy="true"' : ''}>
    <header class="ux-gw-head"><h2 id="ux-gw-title" class="u-label">antes do laboratório · o que o servidor pede</h2><button class="ux-link" type="button" data-gw="back" ${busy ? 'disabled' : ''}>← voltar às entidades</button></header>
    <p class="u-small">Nada vem preenchido por si. O servidor não consegue verificar quem é o revisor nem a medida: ambos ficam «não verificados».</p>
    <fieldset class="ux-gw-fields" ${busy ? 'disabled' : ''}>
      <legend class="u-label">revisor e confirmações</legend>
      <label class="ux-field"><span class="u-label">identificação do revisor</span><input class="u-input" id="gw-reviewer" maxlength="100" autocomplete="off" value="${esc(h.reviewerId)}"></label>
      <label class="ux-check"><input type="checkbox" id="gw-family" ${h.familyConfirmed ? 'checked' : ''}><span>Confirmo que é uma escavadora de rastos</span></label>
      <label class="ux-check"><input type="checkbox" id="gw-bucket" ${h.bucketConfirmed ? 'checked' : ''}><span>Confirmo que a máquina tem uma caçamba</span></label>
      <label class="ux-field"><span class="u-label">largura da caçamba (m) · a visualização desenha de 0,60 a 2,40 m</span><input class="u-input" id="gw-width" type="number" inputmode="decimal" min="0.6" max="2.4" step="0.01" aria-describedby="gw-width-note" value="${h.bucketWidthM ?? ''}"></label>
      <p class="u-label" id="gw-width-note">A API aceita de 0,10 a 10 m, mas uma largura que a visualização não consegue desenhar é recusada, não ajustada.</p>
      <label class="ux-field"><span class="u-label">de onde vem esta largura</span><input class="u-input" id="gw-basis" maxlength="500" autocomplete="off" placeholder="medida no local, ficha técnica…" value="${esc(h.widthBasis)}"></label>
    </fieldset>
    <div class="ux-gw-missing" id="ux-gw-missing" aria-live="polite">${missingHtml(missingLines(handoff))}</div>
    ${extras.length ? `<details class="ux-gw-extras" ${open ? 'open' : ''}><summary class="u-label">relações e afirmações do modelo · ${open ? `${open} por decidir` : 'todas decididas'}</summary>${bulk}<ul>${extras.map(extraRow).join('')}</ul></details>` : ''}
    <div class="ux-gw-sent u-label">${sentSummary(handoff, ui).map((l) => `<p>${esc(l)}</p>`).join('')}</div>
    ${notes.length ? `<ul class="ux-gw-notes u-label" aria-label="Decisões que ficam só neste ecrã">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    <div id="ux-gw-msg" class="ux-gw-msg" ${message?.tone === 'alert' ? 'role="alert"' : 'role="status"'} aria-live="polite">${message ? message.lines.map((l) => `<p>${esc(l)}</p>`).join('') + (message.restart ? restartActionsHtml() : '') : ''}</div>
  </section>`;
}
