import arrowLeftIcon from 'lucide-static/icons/arrow-left.svg?raw';
import linkIcon from 'lucide-static/icons/link.svg?raw';
import plusIcon from 'lucide-static/icons/plus.svg?raw';
import undoIcon from 'lucide-static/icons/undo-2.svg?raw';
import './space.css';
import { createSpatialPlanV2, SpatialApiError, type SpatialPlanV2Reply } from '../../universal-spatial/api-client';
import type { SpatialPlanV2 } from '../../universal-spatial/contracts-v2';
import { checkFile } from '../experience/intake';
import { canvasTranscoder, prepareImage, TranscodeError, type Transcoder } from '../unified-workspace/image-transcode';
import type { SpatialWorkspace, WorkspaceOptions } from '../workspace-design/workspace';
import { PlanSpaceLayer } from './layer';
import { decide, decideAll, initialSpaceReview, pruneSpatialPlan, removedIds, reviewBlockers, reviewRecord, type SpaceReview } from './review';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const SPACE_TEXT_LIMITS = { min: 12, max: 2000 } as const;
const ORIGIN_LABEL = { observed: 'observado', inferred: 'inferido', user_provided: 'introduzido por si', design_approximation: 'aproximação de desenho', unknown: 'desconhecido' } as const;

export type SpaceSource = { kind: 'text'; text: string } | { kind: 'image'; name: string; size: number; dataUrl: string };
export type SpacePhase = 'closed' | 'intake' | 'waiting' | 'failed' | 'review' | 'built';
type Create = (input: Parameters<typeof createSpatialPlanV2>[0], fetchImpl?: typeof fetch) => Promise<SpatialPlanV2Reply>;

export type SpaceFlowOptions = {
  workspace: SpatialWorkspace;
  /** Where the panels live: the workspace's own panel host. */
  host: HTMLElement;
  /** Called when the person leaves the space (back to the laboratory's own entry). */
  onExit(): void;
  /** Called when the space starts or stops owning the stage, so the host can hide its own panels. */
  onActive?(active: boolean): void;
  create?: Create;
  fetchImpl?: typeof fetch;
  transcode?: Transcoder;
  reducedMotion?: boolean;
};

export const FAILURE_COPY: Record<string, string> = {
  META_CALL_BUDGET_EXHAUSTED: 'O orçamento de chamadas à Meta deste servidor esgotou-se. Nada foi construído.',
  META_CONCURRENCY_LIMIT: 'Há demasiados pedidos à Meta em simultâneo. Tente de novo dentro de instantes.',
  MODEL_API_KEY_MISSING: 'O servidor não tem credenciais da Meta configuradas. Nada foi construído e nenhuma cena foi simulada.',
};

function upstreamDetail(meta: Record<string, unknown> | undefined): string | undefined {
  if (!meta) return undefined;
  const parts = [meta.requestId ? `pedido ${String(meta.requestId)}` : null, meta.incompleteReason ? `motivo: ${String(meta.incompleteReason)}` : null, meta.latencyMs !== undefined ? `${String(meta.latencyMs)} ms` : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

function failureText(error: unknown): { message: string; code: string; detail?: string } {
  if (error instanceof SpatialApiError) return { detail: upstreamDetail(error.meta), code: error.code, message: FAILURE_COPY[error.code] ?? (error.status === 429 ? 'Limite de pedidos atingido. Tente de novo dentro de instantes.' : `O servidor recusou o pedido (${error.code}). Nenhuma cena foi construída.`) };
  if (error instanceof TranscodeError) return { code: 'IMAGE_TRANSCODE', message: error.message };
  if (error instanceof Error && /^SPATIAL_V2_/.test(error.message)) return { code: error.message.split(':')[0]!, message: 'O modelo respondeu com um plano que não passou na validação. Nada foi construído.' };
  return { code: 'NETWORK', message: 'Não foi possível contactar o servidor. Verifique a ligação e tente de novo.' };
}

/**
 * New Space: describe or photograph any object → Muse Spark proposes a plan → a person reviews it component by component → the plan is
 * built on the workspace's own stage → explore and edit with the workspace's own inspector, selection and camera.
 * The panels live in the workspace's panel host; nothing here owns a renderer.
 */
export class SpaceFlow {
  phase: SpacePhase = 'closed';
  reply: SpatialPlanV2Reply | null = null;
  layer: PlanSpaceLayer | null = null;
  review: SpaceReview = initialSpaceReview();
  failure: { code: string; message: string; detail?: string } | null = null;
  private source: SpaceSource | null = null;
  private problem: string | null = null;
  private abort: AbortController | null = null;
  private startedAt = 0;
  private tick = 0;
  private builtRecord: ReturnType<typeof reviewRecord> | null = null;
  private note: string | null = null;
  private readonly panel: HTMLElement;
  private readonly create: Create;
  private readonly transcode: Transcoder;
  private readonly reducedMotion: boolean;

  constructor(private readonly options: SpaceFlowOptions) {
    this.create = options.create ?? createSpatialPlanV2;
    this.transcode = options.transcode ?? canvasTranscoder;
    this.reducedMotion = options.reducedMotion ?? options.workspace.reducedMotion;
    this.panel = document.createElement('section');
    this.panel.className = 'sp-root u-root'; this.panel.dataset.theme = 'dark'; this.panel.hidden = true;
    this.panel.setAttribute('aria-label', 'Novo espaço');
    this.panel.addEventListener('click', (event) => this.onClick(event));
    this.panel.addEventListener('change', (event) => this.onChange(event));
    this.panel.addEventListener('input', (event) => this.onInput(event));
  }

  // ------------------------------------------------------------------------------------------------ lifecycle
  open(): void {
    // the experience writes into the same host when it mounts, so the panel is attached on use, never before
    if (!this.panel.isConnected) this.options.host.append(this.panel);
    if (this.phase === 'closed') this.options.onActive?.(true);
    this.dropScene(); this.abort?.abort(); clearInterval(this.tick);
    this.source = null; this.reply = null; this.failure = null; this.problem = null; this.review = initialSpaceReview(); this.note = null;
    this.phase = 'intake'; this.render();
  }

  close(): void {
    if (this.phase === 'closed') return;
    this.abort?.abort(); clearInterval(this.tick); this.dropScene();
    this.phase = 'closed'; this.panel.hidden = true; this.panel.replaceChildren();
    this.options.workspace.setComposerIntake(null);
    this.options.onActive?.(false);
  }

  dispose(): void { this.abort?.abort(); clearInterval(this.tick); this.layer = null; this.panel.remove(); }

  private dropScene(): void {
    if (this.layer) { this.layer = null; this.options.workspace.clearMachine({ brandLabel: 'laboratório vazio', notices: [], extraTools: [] }); }
  }

  // ------------------------------------------------------------------------------------------------ source
  /** Text from the composer or the panel. */
  takeText(text: string): void {
    if (this.phase !== 'intake') return;
    const t = text.trim();
    if (t.length < SPACE_TEXT_LIMITS.min) { this.problem = `Descreva o objecto com pelo menos ${SPACE_TEXT_LIMITS.min} caracteres.`; this.source = null; }
    else if (t.length > SPACE_TEXT_LIMITS.max) { this.problem = `O texto tem ${t.length} caracteres; o máximo é ${SPACE_TEXT_LIMITS.max}.`; this.source = null; }
    else { this.problem = null; this.source = { kind: 'text', text: t }; }
    this.render();
  }

  async takeFile(file: File): Promise<void> {
    if (this.phase !== 'intake') return;
    const issue = checkFile(file);
    if (issue) { this.problem = issue.message; this.source = null; this.render(); return; }
    const dataUrl = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error); r.readAsDataURL(file); });
    this.problem = null; this.source = { kind: 'image', name: file.name, size: file.size, dataUrl }; this.render();
  }

  async submit(): Promise<void> {
    if (this.phase !== 'intake' || !this.source) return;
    const source = this.source; this.abort?.abort(); const mine = this.abort = new AbortController();
    this.phase = 'waiting'; this.startedAt = Date.now(); this.failure = null; this.render();
    clearInterval(this.tick); this.tick = window.setInterval(() => { if (this.phase === 'waiting') this.render(); }, 1000);
    const base = this.options.fetchImpl ?? fetch.bind(globalThis);
    const fetchImpl: typeof fetch = (input, init) => base(input, { ...init, signal: mine.signal });
    try {
      const request = source.kind === 'text'
        ? { sourceKind: 'text' as const, instruction: source.text, maxRefinements: 0 }
        : { sourceKind: 'image' as const, imageDataUrl: (await prepareImage(source.dataUrl, this.transcode, mine.signal)).dataUrl, maxRefinements: 0 };
      const reply = await this.create(request, fetchImpl);
      if (this.abort !== mine) return;
      this.reply = reply; this.review = initialSpaceReview(); this.phase = 'review';
    } catch (error) {
      if (this.abort !== mine || (error as DOMException)?.name === 'AbortError') return;
      this.failure = failureText(error); this.phase = 'failed';
    } finally { if (this.abort === mine) clearInterval(this.tick); }
    this.render();
  }

  cancel(): void { if (this.phase !== 'waiting') return; this.abort?.abort(); clearInterval(this.tick); this.phase = 'intake'; this.render(); }

  // ------------------------------------------------------------------------------------------------ review → build
  decide(id: string, decision: 'keep' | 'reject'): void { if (this.phase === 'review') { this.review = decide(this.review, id, decision); this.render(); } }
  decideAll(decision: 'keep' | 'reject'): void { if (this.phase === 'review' && this.reply) { this.review = decideAll(this.reply.plan, this.review, decision); this.render(); } }
  acknowledge(value: boolean): void { if (this.phase === 'review') { this.review = { ...this.review, acknowledged: value }; this.render(); } }
  blockers(): string[] { return this.reply ? reviewBlockers(this.reply.plan, this.review) : ['sem plano']; }

  build(): boolean {
    const reply = this.reply; if (this.phase !== 'review' || !reply || this.blockers().length) return false;
    const removed = removedIds(reply.plan, this.review);
    let plan: SpatialPlanV2;
    try { plan = pruneSpatialPlan(reply.plan, removed); } catch (error) { this.failure = { code: 'REVIEW_PRUNE', message: `A revisão deixou um plano inválido (${error instanceof Error ? error.message : 'erro'}). Nada foi construído.` }; this.phase = 'failed'; this.render(); return false; }
    this.builtRecord = reviewRecord(reply.plan, this.review);
    const workspace = this.options.workspace;
    const layer = new PlanSpaceLayer(plan, {
      changed: () => { this.refreshContext(); workspace.spaceChanged(); },
      redraw: () => workspace.redraw(),
      notify: (text) => { this.note = text; this.refreshContext(); },
    });
    this.layer = layer; this.phase = 'built'; this.panel.hidden = true; this.panel.replaceChildren();
    workspace.showSpace(layer, this.context());
    workspace.setComposerIntake({ onText: () => undefined, onFile: () => undefined, placeholder: 'Seleccione um componente na cena', status: 'edição no inspector · com pré-visualização', disabled: true });
    layer.reveal(this.reducedMotion);
    return true;
  }

  private refreshContext(): void { if (this.layer) this.options.workspace.setContext(this.context()); }

  private context(): { brandLabel: string; notices: Array<{ id: string; text: string; detail?: string }>; extraTools: NonNullable<WorkspaceOptions['extraTools']> } {
    const layer = this.layer!, reply = this.reply!, plan = layer.currentPlan, meta = reply.meta as Record<string, unknown>;
    const val = (key: string) => (meta[key] === undefined || meta[key] === null ? 'não indicado' : String(meta[key]));
    const lines = layer.assemblyLines();
    const notices: Array<{ id: string; text: string; detail?: string }> = [{
      id: 'space-origin',
      text: `Concepção da IA · não é uma medição · revisão humana não verificada${lines.length ? ` · ${lines.length} aviso${lines.length > 1 ? 's' : ''} de montagem` : ''}`,
      detail: [
        `Fonte: ${plan.source.kind === 'text' ? 'texto' : 'fotografia'}. Modelo: ${val('model')} · pedido ${val('requestId')} · ${val('latencyMs')} ms · custo estimado ${val('estimatedCostUsd')} USD.`,
        `Resposta bruta da Meta: sha256 ${val('rawResponseSha256')} · ${meta.rawResponseStored === true ? 'guardada no servidor (apenas leitura do dono)' : 'não guardada (evidência desligada neste servidor)'}.`,
        `Revisão: ${this.builtRecord?.kept.length ?? 0} mantidos, ${this.builtRecord?.rejected.length ?? 0} rejeitados; identidade do revisor não verificada.`,
        plan.units === 'm' ? 'Unidades: metros, indicadas no pedido.' : 'Unidades: sem unidade. A escala física é desconhecida.',
        ...reply.limitations, ...plan.unknowns.slice(0, 6).map((u) => `Desconhecido: ${u}`),
        ...(lines.length ? [`Verificação de montagem (caixas envolventes, não prova de contacto): ${lines.join(' ')}`] : []),
      ].join(' '),
    }];
    if (this.note) notices.push({ id: 'space-note', text: this.note });
    const tools: NonNullable<WorkspaceOptions['extraTools']> = [
      { id: 'space-gaps', label: 'Fechar folgas', hint: 'o solver propõe posições; ficam como inferidas e desfazíveis', icon: linkIcon, run: () => { const r = layer.closeGaps(); this.note = r.applied ? `Solver: ${r.applied} folga(s) fechada(s) em ${r.iterations} iteração(ões). Posições marcadas como inferidas.` : 'Nada que o solver possa fechar.'; this.refreshContext(); } },
      { id: 'space-undo', label: 'Desfazer', hint: layer.canUndo ? `${layer.editCount} edição(ões) para desfazer` : 'sem edições', icon: undoIcon, run: () => { this.note = layer.undo() ? 'Última edição desfeita.' : 'Não há nada para desfazer.'; this.refreshContext(); } },
      { id: 'space-new', label: 'Novo espaço', hint: 'descarta esta cena e volta ao pedido', icon: plusIcon, run: () => this.open() },
      { id: 'space-exit', label: 'Voltar ao laboratório', hint: 'sai dos espaços', icon: arrowLeftIcon, run: () => { this.close(); this.options.onExit(); } },
    ];
    return { brandLabel: `espaço · ${plan.title}`, notices, extraTools: tools };
  }

  // ------------------------------------------------------------------------------------------------ panels
  private render(): void {
    if (this.phase === 'closed' || this.phase === 'built') return;
    this.panel.hidden = false; this.panel.dataset.phase = this.phase;
    const w = this.options.workspace;
    if (this.phase === 'intake') {
      w.setComposerIntake({ onText: (t) => this.takeText(t), onFile: (f) => void this.takeFile(f), placeholder: 'Descreva qualquer objecto, ou anexe uma fotografia', status: 'PNG, JPEG ou WebP · até 10 MB · a Meta propõe, você revê' });
    } else w.setComposerIntake({ onText: () => undefined, onFile: () => undefined, placeholder: this.phase === 'waiting' ? 'A aguardar o modelo…' : 'Termine a revisão para construir a cena', status: this.phase === 'waiting' ? 'A pedir o plano; pode cancelar no painel.' : 'A revisão é sua.', disabled: true });
    const keep = this.panel.querySelector<HTMLTextAreaElement>('#sp-text'); const typed = keep ? keep.value : undefined;
    this.panel.innerHTML = this.phase === 'intake' ? this.intakeHtml(typed) : this.phase === 'waiting' ? this.waitingHtml() : this.phase === 'failed' ? this.failedHtml() : this.reviewHtml();
  }

  private sourcePreview(): string {
    const s = this.source; if (!s) return '';
    return s.kind === 'text'
      ? `<figure class="sp-preview"><blockquote>${esc(s.text.slice(0, 280))}${s.text.length > 280 ? '…' : ''}</blockquote><figcaption class="u-label">texto · ${s.text.length} caracteres</figcaption></figure>`
      : `<figure class="sp-preview"><img src="${esc(s.dataUrl)}" alt="Pré-visualização de ${esc(s.name)}"><figcaption class="u-label">${esc(s.name)} · ${Math.max(1, Math.round(s.size / 1e3))} kB</figcaption></figure>`;
  }

  private intakeHtml(typed?: string): string {
    const text = this.source?.kind === 'text' ? this.source.text : typed ?? '';
    return `<div class="sp-card"><h1 class="sp-h1">Novo espaço</h1>
      <p class="u-small">Descreva qualquer objecto ou anexe uma fotografia. A Meta propõe uma concepção em 3D; você revê cada componente antes de ela ser construída. Não há geometria preparada para o seu pedido.</p>
      ${this.source?.kind === 'image' ? '' : `<label class="sp-field"><span class="u-label">descrição</span><textarea id="sp-text" rows="3" maxlength="${SPACE_TEXT_LIMITS.max}" placeholder="Ex.: uma harpa de concerto, ou uma turbina eólica de secretária com três pás (mínimo ${SPACE_TEXT_LIMITS.min} caracteres)">${esc(text)}</textarea></label>`}
      ${this.source?.kind === 'image' ? this.sourcePreview() : `<label class="sp-drop"><input id="sp-file" type="file" accept="image/png,image/jpeg,image/webp"><span>ou <u>escolha uma fotografia</u></span><span class="u-label">PNG, JPEG ou WebP · até 10 MB · sem escala física, a escala fica desconhecida</span></label>`}
      ${this.problem ? `<p class="sp-problem" role="alert">${esc(this.problem)}</p>` : ''}
      <div class="sp-row">${this.source?.kind === 'image' ? '<button class="u-btn u-btn--outline" type="button" data-sp="clear">Remover fotografia</button>' : ''}<span class="sp-grow"></span><button class="u-btn u-btn--outline" type="button" data-sp="exit">Voltar</button><button class="u-btn u-btn--primary" type="button" data-sp="submit" ${this.source ? '' : 'disabled'}>Pedir à Meta</button></div></div>`;
  }

  private waitingHtml(): string {
    const s = Math.max(0, Math.round((Date.now() - this.startedAt) / 1000));
    return `<div class="sp-card"><h1 class="sp-h1">A pedir o plano à Meta</h1><p class="u-small">O modelo está a decompor o objecto em componentes. Pode demorar até um minuto; nada é construído antes da sua revisão.</p>${this.sourcePreview()}
      <p class="sp-wait u-data" role="status" aria-live="polite">a aguardar o modelo · ${s} s</p><div class="sp-row"><button class="u-btn u-btn--outline" type="button" data-sp="cancel">Cancelar</button></div></div>`;
  }

  private failedHtml(): string {
    const f = this.failure!;
    return `<div class="sp-card"><h1 class="sp-h1">Não foi possível construir</h1><p class="sp-problem" role="alert">${esc(f.message)}</p><p class="u-label">código: <span class="u-data">${esc(f.code)}</span>${f.detail ? ` · ${esc(f.detail)}` : ''} · nenhuma cena foi simulada nem substituída por geometria preparada</p>
      <div class="sp-row"><span class="sp-grow"></span><button class="u-btn u-btn--outline" type="button" data-sp="exit">Voltar</button><button class="u-btn u-btn--primary" type="button" data-sp="retry">Tentar de novo</button></div></div>`;
  }

  private reviewHtml(): string {
    const reply = this.reply!, plan = reply.plan, blockers = this.blockers(), meta = reply.meta as Record<string, unknown>;
    const names = new Map(plan.components.map((c) => [c.id, c.label]));
    const rows = plan.components.map((c) => {
      const d = this.review.decisions[c.id];
            return `<li class="sp-comp" data-decided="${d ?? 'none'}"><div class="sp-comp-head"><b>${esc(c.label)}</b><code class="u-label">${esc(c.id)}</code>${c.parentId ? `<span class="u-label">em ${esc(names.get(c.parentId) ?? c.parentId)}</span>` : ''}</div>
        <p class="u-small">${esc(c.provenance.evidence)}</p>
        <div class="sp-comp-foot"><span class="u-chip u-chip--uncertain">geometria · ${esc(ORIGIN_LABEL[c.provenance.geometry])}</span><span class="u-label">${this.shapeCount(c.geometry)} forma(s)</span>
        <span class="sp-grow"></span><button type="button" class="uw-link" data-sp-decide="keep" data-id="${esc(c.id)}" aria-pressed="${d === 'keep'}">manter</button><button type="button" class="uw-link" data-sp-decide="reject" data-id="${esc(c.id)}" aria-pressed="${d === 'reject'}">rejeitar</button></div></li>`;
    }).join('');
    return `<div class="sp-card sp-card--review"><div class="sp-head"><h1 class="sp-h1">Rever «${esc(plan.title)}»</h1><p class="u-label">${plan.components.length} componentes · ${esc(String(meta.model ?? 'modelo não indicado'))} · proposta da IA, ainda não construída</p></div>
      <p class="u-small">Cada componente é uma hipótese do modelo. Mantenha o que reconhece e rejeite o resto; o que rejeitar leva consigo o que dele depende. Manter não torna um valor confirmado.</p>
      <div class="sp-row"><button class="u-btn u-btn--outline" type="button" data-sp="keep-all">Manter todos</button><button class="u-btn u-btn--outline" type="button" data-sp="reject-all">Rejeitar todos</button></div>
      <ul class="sp-list" aria-label="Componentes propostos">${rows}</ul>
      ${plan.unknowns.length ? `<details class="sp-unknowns"><summary class="u-label">${plan.unknowns.length} coisa(s) que o modelo declarou desconhecidas</summary><ul>${plan.unknowns.map((u) => `<li>${esc(u)}</li>`).join('')}</ul></details>` : ''}
      <label class="sp-check"><input type="checkbox" id="sp-ack" ${this.review.acknowledged ? 'checked' : ''}> Percebo que isto é uma concepção gerada por IA, não uma medição nem uma reconstrução fiel.</label>
      <div class="sp-row"><button class="u-btn u-btn--outline" type="button" data-sp="discard">Descartar</button><span class="sp-grow"></span><span class="u-label sp-blockers" aria-live="polite">${blockers.length ? esc(blockers.join(' · ')) : 'pronto a construir'}</span><button class="u-btn u-btn--primary" type="button" data-sp="build" ${blockers.length ? 'disabled' : ''}>Construir em 3D</button></div></div>`;
  }

  private shapeCount(node: SpatialPlanV2['components'][number]['geometry']): number { return node.type === 'shape' ? 1 : node.children.reduce((n, child) => n + this.shapeCount(child), 0); }

  // ------------------------------------------------------------------------------------------------ events
  private onClick(event: Event): void {
    const target = event.target as HTMLElement;
    const decideButton = target.closest<HTMLElement>('[data-sp-decide]');
    if (decideButton) { this.decide(decideButton.dataset.id!, decideButton.dataset.spDecide as 'keep' | 'reject'); return; }
    const action = target.closest<HTMLElement>('[data-sp]')?.dataset.sp; if (!action) return;
    if (action === 'submit') void this.submit();
    else if (action === 'retry') { this.phase = 'intake'; this.render(); }
    else if (action === 'cancel') this.cancel();
    else if (action === 'clear') { this.source = null; this.problem = null; this.render(); }
    else if (action === 'exit' || action === 'discard') { this.close(); this.options.onExit(); }
    else if (action === 'keep-all') this.decideAll('keep');
    else if (action === 'reject-all') this.decideAll('reject');
    else if (action === 'build') this.build();
  }
  private onChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    if (target.id === 'sp-ack') this.acknowledge(target.checked);
    else if (target.id === 'sp-file') { const f = target.files?.[0]; if (f) void this.takeFile(f); }
  }
  private onInput(event: Event): void {
    const target = event.target as HTMLTextAreaElement;
    if (target.id !== 'sp-text') return;
    const t = target.value.trim(), submit = this.panel.querySelector<HTMLButtonElement>('[data-sp="submit"]');
    this.source = t.length >= SPACE_TEXT_LIMITS.min && t.length <= SPACE_TEXT_LIMITS.max ? { kind: 'text', text: t } : null;
    if (submit) submit.disabled = !this.source;
  }
}
