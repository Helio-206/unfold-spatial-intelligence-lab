import arrowLeftIcon from 'lucide-static/icons/arrow-left.svg?raw';
import eyeIcon from 'lucide-static/icons/eye.svg?raw';
import folderIcon from 'lucide-static/icons/folder-open.svg?raw';
import linkIcon from 'lucide-static/icons/link.svg?raw';
import saveIcon from 'lucide-static/icons/save.svg?raw';
import undoIcon from 'lucide-static/icons/undo-2.svg?raw';
import './space.css';
import { adoptSpatialPlanV2, applySpatialPlanV2Operation, createSpatialPlanV2, evaluateSpatialPlanV2, proposeSpatialEditV2, SpatialApiError, undoSpatialPlanV2, type SpatialPlanV2Reply } from '../../universal-spatial/api-client';
import type { SpatialOperationV2, SpatialPlanV2 } from '../../universal-spatial/contracts-v2';
import { checkFile } from '../experience/intake';
import { canvasTranscoder, prepareImage, TranscodeError, type Transcoder } from '../unified-workspace/image-transcode';
import type { SpatialWorkspace, WorkspaceOptions } from '../workspace-design/workspace';
import { PlanSpaceLayer, type LayerSync } from './layer';
import { ProductGeometry } from './product-geometry';
import { AtlasSpaceLayer, ATLAS_NOTICE } from './atlas-layer';
import { decide, decideAll, initialSpaceReview, pruneSpatialPlan, removedIds, reviewBlockers, reviewRecord, type SpaceReview } from './review';
import { browserStorage, SpaceStore, type SpaceListing, type SpaceRecord, type StoreProblem } from './store';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const SPACE_TEXT_LIMITS = { min: 12, max: 2000 } as const;
/** The four kinds of information, in the words a person sees. Nothing here promotes one into another. */
export const ORIGIN_LABEL = { observed: 'observado', inferred: 'inferido', user_provided: 'introduzido por si', design_approximation: 'aproximação', unknown: 'desconhecido' } as const;
export const ORIGIN_MEANING: Record<keyof typeof ORIGIN_LABEL, string> = {
  observed: 'lido directamente da sua fonte', inferred: 'dedução da IA a partir da fonte, não confirmada',
  user_provided: 'valor que você indicou', design_approximation: 'escolha de desenho da IA para a cena ficar legível; não vem da sua fonte', unknown: 'a IA não sabe e não inventou',
};

export type SpaceSource = { kind: 'text'; text: string } | { kind: 'image'; name: string; size: number; dataUrl: string };
export type SpacePhase = 'closed' | 'intake' | 'library' | 'waiting' | 'failed' | 'review' | 'built' | 'leaving';
/** What is known about the run that produced the Space on stage (from the server reply, or from the saved record). */
export type RunInfo = { origin: 'meta' | 'reopened'; model: string | null; requestId: string | null; latencyMs: number | null; estimatedCostUsd: number | null; rawResponseSha256: string | null; rawResponseStored: boolean; sourceKind: 'text' | 'image'; sourceSha256: string; limitations: string[] };
type Create = (input: Parameters<typeof createSpatialPlanV2>[0], fetchImpl?: typeof fetch) => Promise<SpatialPlanV2Reply>;
type Api = { adopt: typeof adoptSpatialPlanV2; operation: typeof applySpatialPlanV2Operation; undo: typeof undoSpatialPlanV2; propose: typeof proposeSpatialEditV2; evaluate: typeof evaluateSpatialPlanV2 };

export type SpaceFlowOptions = {
  workspace: SpatialWorkspace;
  /** Where the panels live: the workspace's own panel host. */
  host: HTMLElement;
  /** Called when the person leaves the spaces for good (back to the laboratory's own entry). */
  onExit(): void;
  /** Called when the space starts or stops owning the stage, so the host can hide its own panels. */
  onActive?(active: boolean): void;
  create?: Create;
  store?: SpaceStore;
  api?: Partial<Api>;
  fetchImpl?: typeof fetch;
  transcode?: Transcoder;
  reducedMotion?: boolean;
};

export const FAILURE_COPY: Record<string, string> = {
  META_CALL_BUDGET_EXHAUSTED: 'O orçamento de chamadas à Meta deste servidor esgotou-se. Nada foi construído.',
  META_CONCURRENCY_LIMIT: 'Há demasiados pedidos à Meta em simultâneo. Tente de novo dentro de instantes.',
  MODEL_API_KEY_MISSING: 'O servidor não tem credenciais da Meta configuradas. Nada foi construído e nenhuma cena foi simulada.',
  SPATIAL_V2_META_INCOMPLETE: 'A Meta não conseguiu terminar o plano (resposta cortada). Tente com uma descrição mais curta.',
};
const STORE_COPY = { too_many: 'Já tem o número máximo de Spaces guardados. Elimine algum e tente de novo.', record_too_large: 'Este Space é demasiado grande para guardar localmente.', storage_full: 'O armazenamento deste navegador está cheio. Elimine algum Space e tente de novo.', storage_unavailable: 'Este navegador não permite guardar (janela privada ou dados bloqueados).' } as const;
const PROBLEM_COPY: Record<StoreProblem['reason'], string> = { unreadable: 'ilegível', wrong_contract: 'versão de contrato desconhecida', checksum_mismatch: 'os dados foram alterados (soma de verificação não coincide)', invalid_plan: 'plano inválido' };

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
 * built on the workspace's own stage → explore and edit with the workspace's own inspector, selection and camera → save, reopen, delete.
 * The panels live in the workspace's panel host; nothing here owns a renderer.
 */
export class SpaceFlow {
  phase: SpacePhase = 'closed';
  reply: SpatialPlanV2Reply | null = null;
  layer: PlanSpaceLayer | null = null;
  /** Anatomy as another provider of Space: the educational heart atlas. Never together with `layer`. */
  atlas: AtlasSpaceLayer | null = null;
  review: SpaceReview = initialSpaceReview();
  failure: { code: string; message: string; detail?: string } | null = null;
  run: RunInfo | null = null;
  /** Server session mirroring the Space on stage. Null when it could not be created or was lost; the reason is in `syncNote`. */
  session: { id: string; revision: number } | null = null;
  syncNote: string | null = null;
  savedId: string | null = null;
  readonly store: SpaceStore;
  private geometry: ProductGeometry | null = null;
  private savedPlanJson: string | null = null;
  private source: SpaceSource | null = null;
  private problem: string | null = null;
  private abort: AbortController | null = null;
  private startedAt = 0;
  private tick = 0;
  private builtRecord: ReturnType<typeof reviewRecord> | null = null;
  private note: string | null = null;
  private busyMeta = false;
  /** Text the Presentation Director requires while an exploded view is shown. */
  presentationNotice: string | null = null;
  private metaCalls = 0;
  private listing: { spaces: SpaceListing[]; damaged: StoreProblem[] } = { spaces: [], damaged: [] };
  private confirmDelete: string | null = null;
  private pendingLeave: (() => void) | null = null;
  private readonly panel: HTMLElement;
  private readonly create: Create;
  private readonly api: Api;
  private readonly transcode: Transcoder;
  private readonly reducedMotion: boolean;

  constructor(private readonly options: SpaceFlowOptions) {
    this.create = options.create ?? createSpatialPlanV2;
    this.api = { adopt: adoptSpatialPlanV2, operation: applySpatialPlanV2Operation, undo: undoSpatialPlanV2, propose: proposeSpatialEditV2, evaluate: evaluateSpatialPlanV2, ...options.api };
    this.store = options.store ?? new SpaceStore(browserStorage());
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
  private attach(): void {
    // the experience writes into the same host when it mounts, so the panel is attached on use, never before
    if (!this.panel.isConnected) this.options.host.append(this.panel);
    if (this.phase === 'closed') this.options.onActive?.(true);
  }

  /** Something is on stage that has not been saved (or changed since it was). */
  get dirty(): boolean { return !!this.layer && JSON.stringify(this.layer.currentPlan) !== this.savedPlanJson; }

  /** Runs `go` now, or after the person decides what to do with an unsaved Space. */
  private guard(go: () => void): void {
    if (!this.dirty) { go(); return; }
    this.options.workspace.clearSelection();
    this.pendingLeave = go; this.phase = 'leaving'; this.panel.hidden = false; this.panel.dataset.phase = 'leaving'; this.render();
  }

  open(): void { this.guard(() => this.startIntake()); }
  openLibrary(): void { this.guard(() => void this.showLibrary()); }

  private startIntake(): void {
    this.attach();
    this.dropScene(); this.abort?.abort(); clearInterval(this.tick);
    this.source = null; this.reply = null; this.failure = null; this.problem = null; this.review = initialSpaceReview(); this.note = null; this.run = null; this.session = null; this.syncNote = null; this.savedId = null; this.savedPlanJson = null;
    this.phase = 'intake'; this.render();
  }

  private async showLibrary(): Promise<void> {
    this.attach();
    this.dropScene(); this.abort?.abort(); clearInterval(this.tick);
    this.phase = 'library'; this.confirmDelete = null; this.listing = await this.store.list(); this.render();
  }

  close(): void {
    if (this.phase === 'closed') return;
    this.abort?.abort(); clearInterval(this.tick); this.dropScene();
    this.phase = 'closed'; this.panel.hidden = true; this.panel.replaceChildren(); this.pendingLeave = null;
    this.options.workspace.setComposerIntake(null);
    this.options.onActive?.(false);
  }

  /** Leaving for the laboratory: asks first when something unsaved is on stage. */
  exit(): void { this.guard(() => { this.close(); this.options.onExit(); }); }

  dispose(): void { this.abort?.abort(); clearInterval(this.tick); this.geometry?.dispose(); this.geometry = null; this.layer = null; this.panel.remove(); }

  private dropScene(): void {
    this.geometry?.dispose(); this.geometry = null;
    if (this.layer || this.atlas) { this.layer = null; this.atlas = null; this.options.workspace.clearMachine({ brandLabel: 'laboratório vazio', notices: [], extraTools: [] }); }
    this.session = null; this.syncNote = null; this.presentationNotice = null;
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
      this.metaCalls += 1;
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
    const meta = reply.meta as Record<string, unknown>, num = (k: string) => (typeof meta[k] === 'number' ? (meta[k] as number) : null), str = (k: string) => (typeof meta[k] === 'string' ? (meta[k] as string) : null);
    this.run = { origin: 'meta', model: str('model'), requestId: str('requestId'), latencyMs: num('latencyMs'), estimatedCostUsd: num('estimatedCostUsd'), rawResponseSha256: str('rawResponseSha256'), rawResponseStored: meta.rawResponseStored === true, sourceKind: plan.source.kind, sourceSha256: plan.source.sha256, limitations: reply.limitations };
    this.savedId = null; this.savedPlanJson = null;
    this.show(plan, true);
    return true;
  }

  /** A saved Space opens on stage as it was reviewed; it is not asked from the model again. */
  async openRecord(id: string): Promise<boolean> {
    const opened = await this.store.open(id);
    if (!opened.ok) { this.note = `Não foi possível abrir este Space: ${PROBLEM_COPY[opened.problem.reason]}.`; this.listing = await this.store.list(); this.render(); return false; }
    const r = opened.record;
    this.run = { origin: 'reopened', model: r.run.model, requestId: r.run.requestId, latencyMs: null, estimatedCostUsd: r.run.estimatedCostUsd, rawResponseSha256: r.run.rawResponseSha256, rawResponseStored: false, sourceKind: r.run.sourceKind, sourceSha256: r.run.sourceSha256, limitations: ['Space reaberto do armazenamento local deste navegador; a resposta da Meta não é pedida de novo.'] };
    this.reply = null; this.builtRecord = { contract: 'unfold.space-review.v1', reviewer: 'client_asserted_unverified', acknowledgedConceptualPlan: true, kept: r.review.kept, rejected: r.review.rejected, removedWithAncestor: [] };
    this.attach(); this.dropScene();
    this.savedId = r.id; this.savedPlanJson = JSON.stringify(r.plan);
    this.show(r.plan, false);
    return true;
  }

  private show(plan: SpatialPlanV2, cinematic: boolean): void {
    const workspace = this.options.workspace;
    const geometry = new ProductGeometry(); this.geometry = geometry;
    const layer = new PlanSpaceLayer(plan, {
      changed: () => { this.refreshContext(); workspace.spaceChanged(); },
      redraw: () => workspace.redraw(),
      cue: (cue) => { workspace.requestSpaceView(cue.view, cue.durationMs); },
      presentationChanged: (state) => { const notice = state.notice; if (notice !== this.presentationNotice) { this.presentationNotice = notice; this.refreshContext(); } },
      reducedMotion: () => this.reducedMotion,
      viewContext: () => workspace.spaceViewContext(),
      notify: (text) => { this.note = text; this.refreshContext(); this.expireNote(text); },
      syncLost: (reason) => { this.session = null; this.syncNote = `Sessão do servidor perdida (${reason}). As edições continuam locais; propostas da Meta e avaliação visual ficam bloqueadas.`; this.refreshContext(); this.updateComposer(); },
    }, geometry.compile);
    geometry.attach(() => layer.upgradeGeometry(12_000));
    // edits wait for the server session: one made before it exists would be unknown to it and later overwritten
    layer.lockEditing('a preparar a sessão do servidor');
    this.layer = layer; this.phase = 'built'; this.panel.hidden = true; this.panel.replaceChildren();
    workspace.showSpace(layer, this.context());
    this.updateComposer();
    layer.reveal(!cinematic || this.reducedMotion);
    void this.adopt(plan);
  }

  /** Puts the reviewed plan on the server so that edits, undo and the paid proposals refer to exactly what is on stage. */
  private async adopt(plan: SpatialPlanV2): Promise<void> {
    const layer = this.layer; if (!layer) return;
    try {
      const fetchImpl = this.options.fetchImpl;
      const reply = await this.api.adopt({ plan, instruction: `Reviewed space: ${plan.title}` }, fetchImpl);
      if (this.layer !== layer) return;
      const session = { id: reply.sessionId, revision: reply.revision }; this.session = session; this.syncNote = null;
      const sync: LayerSync = {
        apply: async (operation: SpatialOperationV2, provenance) => { const r = await this.api.operation({ sessionId: session.id, baseRevision: session.revision, operation, origin: provenance.origin, evidence: provenance.evidence.slice(0, 300) }, fetchImpl); session.revision = r.revision; return r.plan; },
        undo: async () => { const r = await this.api.undo({ sessionId: session.id, baseRevision: session.revision }, fetchImpl); session.revision = r.revision; return r.plan; },
      };
      layer.attachSync(sync);
    } catch (error) {
      if (this.layer !== layer) return;
      this.session = null; this.syncNote = `Sem sessão no servidor (${error instanceof SpatialApiError ? error.code : 'sem ligação'}). Pode explorar e editar localmente; propostas da Meta e avaliação visual ficam indisponíveis.`;
    }
    layer.unlockEditing(); // with a session (synchronised) or without one (declared local-only): either way the person's edits now have a defined home
    this.refreshContext(); this.updateComposer(); this.options.workspace.spaceChanged();
  }

  // ------------------------------------------------------------------------------------------------ save
  async save(): Promise<boolean> {
    const layer = this.layer, run = this.run; if (!layer || !run) return false;
    const plan = layer.currentPlan;
    const result = await this.store.save({
      id: this.savedId ?? undefined, plan,
      run: { model: run.model, requestId: run.requestId, estimatedCostUsd: run.estimatedCostUsd, rawResponseSha256: run.rawResponseSha256, sourceKind: run.sourceKind, sourceSha256: run.sourceSha256 },
      review: { reviewer: 'client_asserted_unverified', kept: this.builtRecord?.kept ?? [], rejected: this.builtRecord?.rejected ?? [], edits: layer.editCount },
    });
    if (!result.ok) { this.note = STORE_COPY[result.reason]; this.refreshContext(); return false; }
    this.savedId = result.id; this.savedPlanJson = JSON.stringify(plan);
    this.note = 'Guardado só neste navegador (armazenamento local). Não é uma cópia na nuvem nem uma cópia de segurança.'; this.refreshContext(); return true;
  }

  // ------------------------------------------------------------------------------------------------ Meta proposals (paid, never applied here)
  get canAskMeta(): boolean { return !!this.layer && !!this.session && !this.busyMeta && !this.layer.isBusy; }

  private updateComposer(): void {
    const w = this.options.workspace; if (this.phase !== 'built') return;
    const ok = this.canAskMeta;
    w.setComposerIntake({
      onText: (t) => void this.askMeta(t), onFile: () => undefined,
      placeholder: ok ? 'Peça uma alteração · a Meta propõe, você autoriza' : this.busyMeta ? 'A Meta está a preparar uma proposta…' : 'Seleccione um componente na cena',
      status: ok ? 'a proposta fica em pré-visualização; nada muda até autorizar' : this.busyMeta ? 'a aguardar o modelo' : this.syncNote ?? 'edição pelos controlos do inspector',
      disabled: !ok,
    });
  }

  async askMeta(text: string): Promise<boolean> {
    const layer = this.layer, session = this.session; const instruction = text.trim();
    if (!layer || !session || this.busyMeta || instruction.length < 4) return false;
    this.busyMeta = true; this.note = null; this.updateComposer();
    try {
      const reply = await this.api.propose({ sessionId: session.id, baseRevision: session.revision, instruction }, this.options.fetchImpl);
      this.metaCalls += 1;
      if (this.layer !== layer) return false;
      const shown = layer.proposeOperation(reply.operation, 'meta', 'Proposta da Meta');
      if (!shown) { this.note = 'A Meta propôs uma alteração que não se aplica a este Space. Nada mudou.'; return false; }
      this.options.workspace.select(reply.operation.componentId);
      const cost = reply.meta && typeof reply.meta.estimatedCostUsd === 'number' ? ` · custo estimado US$ ${reply.meta.estimatedCostUsd.toFixed(3)}` : '';
      this.note = `Proposta da Meta em pré-visualização${cost}. Nada foi aplicado.`; return true;
    } catch (error) {
      this.note = error instanceof SpatialApiError && error.status === 404 ? 'A sessão do servidor expirou: as propostas da Meta ficam indisponíveis.' : `A Meta não conseguiu propor (${error instanceof SpatialApiError ? error.code : 'sem ligação'}). Nada mudou.`;
      if (error instanceof SpatialApiError && (error.status === 404 || error.status === 409)) { this.session = null; this.layer?.attachSync(null); this.syncNote = this.note; }
      return false;
    } finally { this.busyMeta = false; this.refreshContext(); this.updateComposer(); }
  }

  /** One verified frame to the model, within the server's call budget. The result is a hypothesis; a suggested change is only previewed. */
  async evaluateView(): Promise<boolean> {
    const layer = this.layer, session = this.session; if (!layer || !session || this.busyMeta) { this.note = this.syncNote ?? 'A avaliação visual precisa de uma sessão no servidor.'; this.refreshContext(); return false; }
    // the model should see the whole object from the hero view, not whatever the person was zooming into
    layer.settle(); this.options.workspace.frameAll(); this.options.workspace.renderNow();
    const capture = this.options.workspace.captureSpaceFrame();
    if (!capture) return false;
    if (!capture.verdict.ok) { this.note = `Captura rejeitada (${capture.verdict.problems.join(', ')}): nada foi enviado à Meta.`; this.refreshContext(); return false; }
    this.busyMeta = true; this.note = `Captura verificada (o objecto ocupa ${(capture.analysis.extentFraction * 100).toFixed(0)} % da imagem). A pedir avaliação à Meta…`; this.refreshContext(); this.updateComposer();
    try {
      const result = await this.api.evaluate({ sessionId: session.id, baseRevision: session.revision, imageDataUrl: capture.dataUrl, plan: layer.currentPlan }, this.options.fetchImpl);
      this.metaCalls += 1;
      if (this.layer !== layer) return false;
      const e = result.evaluation;
      this.note = `Hipótese visual da Meta (não é medição): reconhecível ${e.recognizabilityScore}/100 · silhueta ${e.silhouetteScore}/100 · integridade ${e.spatialIntegrityScore}/100. ${e.discrepancies.slice(0, 2).map((d) => d.observation).join(' ')}`;
      if (e.suggestedOperation) {
        const operation: SpatialOperationV2 = { ...e.suggestedOperation, contract: 'unfold.spatial-operation.v2', operationId: `visual-${Date.now().toString(36)}` };
        if (layer.proposeOperation(operation, 'meta-visual', 'Proposta da avaliação visual')) { this.options.workspace.select(operation.componentId); this.note += ' Há uma alteração proposta em pré-visualização.'; }
      }
      return true;
    } catch (error) {
      this.note = `Avaliação indisponível (${error instanceof SpatialApiError ? error.code : 'sem ligação'}). Nada mudou.`; return false;
    } finally { this.busyMeta = false; this.refreshContext(); this.updateComposer(); }
  }

  // ------------------------------------------------------------------------------------------------ chrome while a Space is on stage
  /** A status line is not a log: it leaves after a while unless something newer replaced it. */
  private expireNote(text: string | null): void { window.setTimeout(() => { if (this.note === text && this.layer) { this.note = null; this.refreshContext(); } }, 9000); }

  private refreshContext(): void { if (this.layer) this.options.workspace.setContext(this.context()); else if (this.atlas) this.options.workspace.setContext(this.atlasContext()); }

  /** The educational atlas on stage: always labelled, never editable, never presented as a reconstruction. */
  async openAtlas(): Promise<boolean> {
    return new Promise((resolve) => this.guard(() => void this.showAtlas().then(resolve)));
  }

  private async showAtlas(): Promise<boolean> {
    this.attach(); this.dropScene(); this.abort?.abort(); clearInterval(this.tick);
    this.phase = 'waiting'; this.source = null; this.failure = null; this.startedAt = Date.now(); this.panel.hidden = false; this.panel.dataset.phase = 'atlas-loading';
    this.panel.innerHTML = '<div class="sp-card"><h1 class="sp-h1">A carregar o atlas</h1><p class="u-small">Modelo educativo de referência do coração (BodyParts3D).</p></div>';
    const workspace = this.options.workspace;
    try {
      const atlas = await AtlasSpaceLayer.load({ redraw: () => workspace.redraw(), changed: () => this.refreshContext(), settled: () => workspace.refocusSpace() });
      if (this.phase !== 'waiting') { atlas.dispose(); return false; }
      this.atlas = atlas; this.phase = 'built'; this.panel.hidden = true; this.panel.replaceChildren();
      workspace.showSpace(atlas, this.atlasContext());
      workspace.setComposerIntake({ onText: () => undefined, onFile: () => undefined, placeholder: 'Seleccione uma estrutura na cena', status: 'atlas de referência · sem edição', disabled: true });
      return true;
    } catch (error) {
      this.failure = { code: error instanceof Error ? error.message : 'ATLAS', message: 'Não foi possível carregar o atlas anatómico. Nada foi construído.' }; this.phase = 'failed'; this.render(); return false;
    }
  }

  private atlasContext(): { brandLabel: string; notices: Array<{ id: string; text: string; detail?: string }>; extraTools: NonNullable<WorkspaceOptions['extraTools']> } {
    const notices: Array<{ id: string; text: string; detail?: string }> = [{ id: 'atlas-origin', ...ATLAS_NOTICE }];
    if (this.atlas?.presentationNotice) notices.push({ id: 'atlas-explode', text: this.atlas.presentationNotice });
    return { brandLabel: 'atlas anatómico · coração · educativo', notices, extraTools: [
      { id: 'space-library', label: 'Os meus Spaces', hint: 'guardados neste navegador', icon: folderIcon, run: () => this.openLibrary() },
      { id: 'space-new', label: 'Novo espaço', hint: 'pede um objecto à Meta', icon: arrowLeftIcon, run: () => this.open() },
      { id: 'space-exit', label: 'Voltar ao laboratório', hint: 'sai dos espaços', icon: arrowLeftIcon, run: () => this.exit() },
    ] };
  }

  private context(): { brandLabel: string; notices: Array<{ id: string; text: string; detail?: string }>; extraTools: NonNullable<WorkspaceOptions['extraTools']> } {
    const layer = this.layer!, run = this.run!, plan = layer.currentPlan;
    const val = (v: unknown) => (v === undefined || v === null ? 'não indicado' : String(v));
    const lines = layer.assemblyLines();
    const origin = run.origin === 'meta'
      ? `Fonte: ${run.sourceKind === 'text' ? 'texto' : 'fotografia'}. Modelo: ${val(run.model)} · pedido ${val(run.requestId)} · ${val(run.latencyMs)} ms · custo estimado ${val(run.estimatedCostUsd)} USD. Resposta bruta da Meta: sha256 ${val(run.rawResponseSha256)} · ${run.rawResponseStored ? 'guardada no servidor (apenas leitura do dono)' : 'não guardada (evidência desligada neste servidor)'}.`
      : `Reaberto do armazenamento local deste navegador. Corrida original: modelo ${val(run.model)} · pedido ${val(run.requestId)} · custo estimado ${val(run.estimatedCostUsd)} USD.`;
    const notices: Array<{ id: string; text: string; detail?: string }> = [{
      id: 'space-origin',
      text: `Concepção da IA · não é uma medição · revisão humana não verificada${lines.length ? ` · ${lines.length} aviso${lines.length > 1 ? 's' : ''} de montagem` : ''}`,
      detail: [origin, `Revisão: ${this.builtRecord?.kept.length ?? 0} mantidos, ${this.builtRecord?.rejected.length ?? 0} rejeitados; identidade do revisor não verificada.`,
        plan.units === 'm' ? 'Unidades: metros, indicadas no pedido.' : 'Unidades: sem unidade. A escala física é desconhecida.',
        `Chamadas pagas nesta sessão: ${this.metaCalls}.`,
        ...run.limitations, ...plan.unknowns.slice(0, 6).map((u) => `Desconhecido: ${u}`),
        ...(lines.length ? [`Verificação de montagem (caixas envolventes, não prova de contacto): ${lines.join(' ')}`] : [])].join(' '),
    }];
    const status = [this.syncNote, this.note].filter(Boolean).join(' · ');
    if (this.presentationNotice) notices.push({ id: 'space-presentation', text: this.presentationNotice });
    if (status) notices.push({ id: 'space-note', text: status });
    const tools: NonNullable<WorkspaceOptions['extraTools']> = [
      { id: 'space-save', label: this.dirty ? 'Guardar' : 'Guardado', hint: 'guarda só neste navegador (não é cópia na nuvem)', icon: saveIcon, run: () => void this.save() },
      { id: 'space-eval', label: 'Avaliar vista', hint: this.session ? 'a Meta olha para a imagem (chamada paga; só uma hipótese)' : 'indisponível: sem sessão no servidor', icon: eyeIcon, run: () => void this.evaluateView() },
      { id: 'space-gaps', label: 'Fechar folgas', hint: 'o solver propõe posições; ficam como inferidas e desfazíveis', icon: linkIcon, run: () => void layer.closeGaps().then((r) => { this.note = r.applied ? `Solver: ${r.applied} folga(s) fechada(s) em ${r.iterations} iteração(ões). Posições marcadas como inferidas.` : 'Nada que o solver possa fechar.'; this.refreshContext(); }) },
      { id: 'space-undo', label: 'Desfazer', hint: layer.canUndo ? `${layer.editCount} edição(ões) para desfazer` : 'sem edições', icon: undoIcon, run: () => void layer.undo().then((ok) => { this.note = ok ? 'Última edição desfeita.' : 'Não há nada para desfazer.'; this.refreshContext(); }) },
      { id: 'space-library', label: 'Os meus Spaces', hint: 'guardados neste navegador', icon: folderIcon, run: () => this.openLibrary() },
      { id: 'space-exit', label: 'Voltar ao laboratório', hint: 'sai dos espaços', icon: arrowLeftIcon, run: () => this.exit() },
    ];
    return { brandLabel: `espaço · ${plan.title}${this.dirty ? ' · por guardar' : ''}`, notices, extraTools: tools };
  }

  // ------------------------------------------------------------------------------------------------ panels
  private render(): void {
    if (this.phase === 'closed' || this.phase === 'built') return;
    this.panel.hidden = false; this.panel.dataset.phase = this.phase;
    const w = this.options.workspace;
    if (this.phase === 'intake') {
      w.setComposerIntake({ onText: (t) => this.takeText(t), onFile: (f) => void this.takeFile(f), placeholder: 'Descreva qualquer objecto, ou anexe uma fotografia', status: 'PNG, JPEG ou WebP · até 10 MB · a Meta propõe, você revê' });
    } else w.setComposerIntake({ onText: () => undefined, onFile: () => undefined, placeholder: this.phase === 'waiting' ? 'A aguardar o modelo…' : this.phase === 'library' ? 'Escolha um Space guardado ou comece um novo' : 'Termine este passo para continuar', status: this.phase === 'waiting' ? 'A pedir o plano; pode cancelar no painel.' : this.phase === 'review' ? 'A revisão é sua.' : 'Use o painel.', disabled: true });
    const keep = this.panel.querySelector<HTMLTextAreaElement>('#sp-text'); const typed = keep ? keep.value : undefined;
    this.panel.innerHTML = this.phase === 'intake' ? this.intakeHtml(typed) : this.phase === 'library' ? this.libraryHtml() : this.phase === 'waiting' ? this.waitingHtml() : this.phase === 'failed' ? this.failedHtml() : this.phase === 'leaving' ? this.leavingHtml() : this.reviewHtml();
  }

  private sourcePreview(): string {
    const s = this.source; if (!s) return '';
    return s.kind === 'text'
      ? `<figure class="sp-preview"><blockquote>${esc(s.text.slice(0, 280))}${s.text.length > 280 ? '…' : ''}</blockquote><figcaption class="u-label">texto · ${s.text.length} caracteres</figcaption></figure>`
      : `<figure class="sp-preview"><img src="${esc(s.dataUrl)}" alt="Pré-visualização de ${esc(s.name)}"><figcaption class="u-label">${esc(s.name)} · ${Math.max(1, Math.round(s.size / 1e3))} kB</figcaption></figure>`;
  }

  private intakeHtml(typed?: string): string {
    const text = this.source?.kind === 'text' ? this.source.text : typed ?? '';
    const saved = this.store.available ? this.store.usage().spaces : 0;
    return `<div class="sp-card"><h1 class="sp-h1">Novo espaço</h1>
      <p class="u-small">Descreva qualquer objecto ou anexe uma fotografia. A Meta propõe uma concepção em 3D; você revê cada componente antes de ela ser construída. Não há geometria preparada para o seu pedido.</p>
      ${this.source?.kind === 'image' ? '' : `<label class="sp-field"><span class="u-label">descrição</span><textarea id="sp-text" rows="3" maxlength="${SPACE_TEXT_LIMITS.max}" placeholder="Ex.: uma harpa de concerto, ou uma turbina eólica de secretária com três pás (mínimo ${SPACE_TEXT_LIMITS.min} caracteres)">${esc(text)}</textarea></label>`}
      ${this.source?.kind === 'image' ? this.sourcePreview() : `<label class="sp-drop"><input id="sp-file" type="file" accept="image/png,image/jpeg,image/webp"><span>ou <u>escolha uma fotografia</u></span><span class="u-label">PNG, JPEG ou WebP · até 10 MB · sem escala física, a escala fica desconhecida</span></label>`}
      ${this.problem ? `<p class="sp-problem" role="alert">${esc(this.problem)}</p>` : ''}
      <div class="sp-row">${this.source?.kind === 'image' ? '<button class="u-btn u-btn--outline" type="button" data-sp="clear">Remover fotografia</button>' : ''}${this.store.available ? `<button class="u-btn u-btn--outline" type="button" data-sp="library">Os meus Spaces (${saved})</button>` : ''}<span class="sp-grow"></span><button class="u-btn u-btn--outline" type="button" data-sp="atlas">Atlas do coração (educativo)</button><button class="u-btn u-btn--outline" type="button" data-sp="exit">Voltar</button><button class="u-btn u-btn--primary" type="button" data-sp="submit" ${this.source ? '' : 'disabled'}>Pedir à Meta</button></div></div>`;
  }

  private libraryHtml(): string {
    const { spaces, damaged } = this.listing, usage = this.store.usage();
    const fmtDate = (iso: string) => new Date(iso).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' });
    const row = (s: SpaceListing) => `<li class="sp-comp" data-id="${esc(s.id)}"><div class="sp-comp-head"><b>${esc(s.title)}</b><span class="u-label">${s.components} componentes · ${s.sourceKind === 'text' ? 'texto' : 'fotografia'} · ${fmtDate(s.savedAt)}</span></div>
      <div class="sp-comp-foot"><span class="u-label">${esc(s.model ?? 'modelo não indicado')} · ${Math.max(1, Math.round(s.bytes / 1000))} kB</span><span class="sp-grow"></span>
      ${this.confirmDelete === s.id ? `<span class="u-label">Eliminar mesmo?</span><button class="uw-link" type="button" data-sp-delete="${esc(s.id)}">sim, eliminar</button><button class="uw-link" type="button" data-sp="keep-space">não</button>` : `<button class="uw-link" type="button" data-sp-open="${esc(s.id)}">abrir</button><button class="uw-link" type="button" data-sp-ask-delete="${esc(s.id)}">eliminar</button>`}</div></li>`;
    const bad = (p: StoreProblem) => `<li class="sp-comp" data-decided="reject"><div class="sp-comp-head"><b>Space danificado</b><code class="u-label">${esc(p.id.slice(0, 8))}</code></div><p class="u-small">${esc(PROBLEM_COPY[p.reason])}. Não é aberto; só pode ser eliminado.</p><div class="sp-comp-foot"><span class="sp-grow"></span><button class="uw-link" type="button" data-sp-delete="${esc(p.id)}">eliminar</button></div></li>`;
    return `<div class="sp-card sp-card--review"><div class="sp-head"><h1 class="sp-h1">Os meus Spaces</h1><p class="u-label">${usage.spaces} de ${usage.maxSpaces} · ${(usage.bytes / 1000).toFixed(0)} kB de ${(usage.maxBytes / 1000).toFixed(0)} kB</p></div>
      <p class="u-small">Guardados só neste navegador, neste dispositivo. Não há sincronização nem cópia na nuvem, e limpar os dados do site apaga-os.</p>
      ${this.note ? `<p class="sp-problem" role="alert">${esc(this.note)}</p>` : ''}
      ${spaces.length || damaged.length ? `<ul class="sp-list" aria-label="Spaces guardados">${spaces.map(row).join('')}${damaged.map(bad).join('')}</ul>` : '<p class="sp-empty">Ainda não guardou nenhum Space. Crie um e use «Guardar» no painel de ferramentas.</p>'}
      <div class="sp-row"><button class="u-btn u-btn--outline" type="button" data-sp="exit">Voltar ao laboratório</button><span class="sp-grow"></span><button class="u-btn u-btn--primary" type="button" data-sp="new">Novo espaço</button></div></div>`;
  }

  private leavingHtml(): string {
    return `<div class="sp-card"><h1 class="sp-h1">Este Space não está guardado</h1><p class="u-small">Tem alterações que ainda não guardou. Se sair agora, perdem-se.</p>
      <div class="sp-row"><button class="u-btn u-btn--outline" type="button" data-sp="stay">Ficar</button><span class="sp-grow"></span><button class="u-btn u-btn--outline" type="button" data-sp="leave">Sair sem guardar</button><button class="u-btn u-btn--primary" type="button" data-sp="save-leave">Guardar e sair</button></div></div>`;
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
    const counts: Record<string, number> = { observed: 0, inferred: 0, design_approximation: 0, user_provided: 0, unknown: 0 };
    for (const c of plan.components) for (const k of ['geometry', 'transform', 'material'] as const) counts[c.provenance[k]] = (counts[c.provenance[k]] ?? 0) + 1;
    const chip = (name: string, origin: keyof typeof ORIGIN_LABEL) => `<span class="u-chip ${origin === 'observed' || origin === 'user_provided' ? '' : 'u-chip--uncertain'}" title="${esc(ORIGIN_MEANING[origin])}">${esc(name)} · ${esc(ORIGIN_LABEL[origin])}</span>`;
    const rows = plan.components.map((c) => {
      const d = this.review.decisions[c.id];
      return `<li class="sp-comp" data-decided="${d ?? 'none'}"><div class="sp-comp-head"><b>${esc(c.label)}</b><code class="u-label">${esc(c.id)}</code>${c.parentId ? `<span class="u-label">em ${esc(names.get(c.parentId) ?? c.parentId)}</span>` : ''}</div>
        <p class="u-small">${esc(c.provenance.evidence)}</p>
        <div class="sp-comp-foot">${chip('forma', c.provenance.geometry)}${chip('posição', c.provenance.transform)}${chip('material', c.provenance.material)}<span class="sp-decide"><button type="button" class="uw-link" data-sp-decide="keep" data-id="${esc(c.id)}" aria-pressed="${d === 'keep'}">manter</button><button type="button" class="uw-link" data-sp-decide="reject" data-id="${esc(c.id)}" aria-pressed="${d === 'reject'}">rejeitar</button></span></div></li>`;
    }).join('');
    return `<div class="sp-card sp-card--review"><div class="sp-head"><h1 class="sp-h1">Rever «${esc(plan.title)}»</h1><p class="u-label">${plan.components.length} componentes · ${esc(String(meta.model ?? 'modelo não indicado'))} · proposta da IA, ainda não construída</p></div>
      <details class="sp-why" ${this.options.workspace.root.clientWidth > 760 ? 'open' : ''}><summary class="u-label">O que está a confirmar</summary><p class="u-small">Que estes componentes são uma boa <b>concepção</b> do que pediu. Manter não torna nenhum valor medido nem confirmado; só uma edição sua o faz. O que rejeitar leva consigo o que dele depende.</p></details>
      <div class="sp-row sp-tally" aria-label="Etiquetas nesta proposta">${(['observed', 'inferred', 'design_approximation', 'unknown'] as const).map((k) => `<span class="u-chip ${k === 'observed' ? '' : 'u-chip--uncertain'}" title="${esc(ORIGIN_MEANING[k])}">${ORIGIN_LABEL[k]} · ${counts[k] ?? 0}</span>`).join('')}<span class="sp-grow"></span><button class="uw-link" type="button" data-sp="keep-all">manter todos</button><button class="uw-link" type="button" data-sp="reject-all">rejeitar todos</button></div>
      <details class="sp-meaning"><summary class="u-label">O que significam as etiquetas</summary><dl class="sp-legend">${(['observed', 'inferred', 'design_approximation', 'unknown'] as const).map((k) => `<div><dt><span class="u-chip ${k === 'observed' ? '' : 'u-chip--uncertain'}">${ORIGIN_LABEL[k]}</span></dt><dd class="u-label">${esc(ORIGIN_MEANING[k])}</dd></div>`).join('')}</dl></details>
      <ul class="sp-list" aria-label="Componentes propostos">${rows}</ul>
      <details class="sp-unknowns" aria-label="Desconhecidos" ${plan.units !== 'm' && this.options.workspace.root.clientWidth > 760 ? 'open' : ''}><summary class="u-label">${plan.units === 'm' ? 'O que o modelo declarou desconhecido' : 'Escala física desconhecida · o que o modelo declarou desconhecido'} (${plan.unknowns.length})</summary>${plan.unknowns.length ? `<ul>${plan.unknowns.slice(0, 8).map((u) => `<li>${esc(u)}</li>`).join('')}</ul>${plan.unknowns.length > 8 ? `<p class="u-label">e mais ${plan.unknowns.length - 8}, no aviso da cena.</p>` : ''}` : '<p class="u-small">Nenhum declarado.</p>'}</details>
      <div class="sp-foot">
      <label class="sp-check"><input type="checkbox" id="sp-ack" ${this.review.acknowledged ? 'checked' : ''}> Percebo que isto é uma concepção gerada por IA, não uma medição nem uma reconstrução fiel.</label>
      <div class="sp-row"><button class="u-btn u-btn--outline" type="button" data-sp="discard">Descartar</button><span class="sp-grow"></span><span class="u-label sp-blockers" aria-live="polite">${blockers.length ? esc(blockers.join(' · ')) : 'pronto a construir'}</span><button class="u-btn u-btn--primary" type="button" data-sp="build" ${blockers.length ? 'disabled' : ''}>Construir em 3D</button></div></div></div>`;
  }

  // ------------------------------------------------------------------------------------------------ events
  private onClick(event: Event): void {
    const target = event.target as HTMLElement;
    const decideButton = target.closest<HTMLElement>('[data-sp-decide]');
    if (decideButton) { this.decide(decideButton.dataset.id!, decideButton.dataset.spDecide as 'keep' | 'reject'); return; }
    const open = target.closest<HTMLElement>('[data-sp-open]'); if (open) { void this.openRecord(open.dataset.spOpen!); return; }
    const ask = target.closest<HTMLElement>('[data-sp-ask-delete]'); if (ask) { this.confirmDelete = ask.dataset.spAskDelete!; this.render(); return; }
    const del = target.closest<HTMLElement>('[data-sp-delete]'); if (del) { this.store.remove(del.dataset.spDelete!); this.confirmDelete = null; void this.store.list().then((l) => { this.listing = l; this.render(); }); return; }
    const action = target.closest<HTMLElement>('[data-sp]')?.dataset.sp; if (!action) return;
    if (action === 'submit') void this.submit();
    else if (action === 'retry') { this.phase = 'intake'; this.render(); }
    else if (action === 'cancel') this.cancel();
    else if (action === 'clear') { this.source = null; this.problem = null; this.render(); }
    else if (action === 'exit') this.exit();
    else if (action === 'discard') { this.startIntake(); }
    else if (action === 'library') void this.showLibrary();
    else if (action === 'atlas') void this.openAtlas();
    else if (action === 'new') this.startIntake();
    else if (action === 'keep-space') { this.confirmDelete = null; this.render(); }
    else if (action === 'keep-all') this.decideAll('keep');
    else if (action === 'reject-all') this.decideAll('reject');
    else if (action === 'build') this.build();
    else if (action === 'stay') { this.pendingLeave = null; this.phase = 'built'; this.panel.hidden = true; this.panel.replaceChildren(); this.updateComposer(); }
    else if (action === 'leave') { const go = this.pendingLeave; this.pendingLeave = null; this.savedPlanJson = JSON.stringify(this.layer?.currentPlan ?? null); go?.(); }
    else if (action === 'save-leave') { const go = this.pendingLeave; this.pendingLeave = null; void this.save().then((ok) => { if (ok) go?.(); else { this.phase = 'built'; this.panel.hidden = true; this.panel.replaceChildren(); this.updateComposer(); } }); }
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

export type { SpaceRecord };
