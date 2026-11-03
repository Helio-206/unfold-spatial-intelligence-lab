/**
 * SpatialWorkspace: the isolated UNFOLD workspace prototype. The object owns the screen; the interface appears only
 * when needed. Integrates the Visual Foundry renderer, the canonical component registry, the Digital Hand, the
 * camera arbiter and the existing spatial-agent route. Vite-compatible, no framework.
 */
import './workspace.css';
import arrowUpIcon from 'lucide-static/icons/arrow-up.svg?raw';
import chevronsIcon from 'lucide-static/icons/chevrons-up-down.svg?raw';
import expandIcon from 'lucide-static/icons/expand.svg?raw';
import eyeIcon from 'lucide-static/icons/eye.svg?raw';
import eyeOffIcon from 'lucide-static/icons/eye-off.svg?raw';
import fileTextIcon from 'lucide-static/icons/file-text.svg?raw';
import focusIcon from 'lucide-static/icons/focus.svg?raw';
import handIcon from 'lucide-static/icons/hand.svg?raw';
import layersIcon from 'lucide-static/icons/layers-2.svg?raw';
import maximizeIcon from 'lucide-static/icons/maximize-2.svg?raw';
import messageIcon from 'lucide-static/icons/message-square.svg?raw';
import micIcon from 'lucide-static/icons/mic.svg?raw';
import paperclipIcon from 'lucide-static/icons/paperclip.svg?raw';
import playIcon from 'lucide-static/icons/play.svg?raw';
import rotateIcon from 'lucide-static/icons/rotate-ccw.svg?raw';
import sunDimIcon from 'lucide-static/icons/sun-dim.svg?raw';
import xIcon from 'lucide-static/icons/x.svg?raw';
import gsap from 'gsap';
import { Box3, Sphere, Vector2, Vector3 } from 'three';
import { applyMotionTokens, DURATION, EASE } from '../../motion/tokens';
import { HandInteractionModel, WebcamHandTracker, type HandInteractionState } from '../../hand-tracking';
import { BrowserVoiceInput } from '../../voice-input';
import type { Assembly } from '../contracts';
import { buildComponentRegistry, type CanonicalComponent, type ComponentRegistry } from '../visual-foundry/component-registry';
import { buildExcavator, type ExcavatorModel, type PartPose } from '../visual-foundry/excavator/build';
import { createMaterialLibrary, type MaterialLibrary } from '../visual-foundry/materials';
import { framePoses, loadFixturePreview, type FixturePreview } from '../visual-foundry/poses';
import { FoundryRenderer, type RenderProfileName } from '../visual-foundry/renderer';
import { askAgent, buildAgentRequest, type AgentClientOptions, type HistoryItem } from './agent-client';
import { CameraArbiter } from './camera-arbiter';
import { CameraDirector } from './camera-director';
import { fitBoxDistance } from './framing';
import { SceneController } from './scene-controller';
import { DigitalHand, HAND_AGENCY, type HandState, type HandView, type SafeInsets } from './digital-hand';
import { groundOutcome, type Grounded } from './grounding';
import { WorkspaceEngineeringSession } from './engineering-session';
import { planExtendExperiment } from './experiments';
import { initialWorkspaceState, reduceWorkspace, visibility, type Message, type WorkspaceAction, type WorkspaceState } from './workspace-state';

export type WorkspaceOptions = {
  assembly: Assembly;
  agent?: AgentClientOptions;
  profile?: RenderProfileName;
  reducedMotion?: boolean;
  preserveDrawingBuffer?: boolean;
  pixelRatio?: number;
  logoSrc?: string;
  /** Explicitly labelled historical demonstration; normal workspace uses the engine. */
  fixtureDemo?: boolean;
};

const TRANSIENT_MS = 9000;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const icon = (svg: string) => svg.replace(/<!--[\s\S]*?-->/, '').replace('<svg', '<svg aria-hidden="true" focusable="false"');
let idSeq = 0;
const newId = (p: string) => `${p}-${++idSeq}`;
const fmt = (v: number, d = 3) => v.toFixed(d);

export class SpatialWorkspace {
  readonly root: HTMLElement;
  readonly registry: ComponentRegistry;
  readonly arbiter = new CameraArbiter();
  private readonly foundry: FoundryRenderer;
  private readonly lib: MaterialLibrary;
  private readonly model: ExcavatorModel;
  private readonly director: CameraDirector;
  private readonly scene: SceneController;
  private readonly hand: DigitalHand;
  private readonly previews: FixturePreview[];
  private state: WorkspaceState = initialWorkspaceState();
  private history: HistoryItem[] = [];
  private selectedId: string | null = null;
  private inspectorOpen = false;
  private evidenceOpen = false;
  private poseLabel: 'reference' | 'fixture-preview' | 'engine' = 'reference';
  private readonly engineering: WorkspaceEngineeringSession;
  private engineProposal: { token: string; actuatorId: string; target: number; durationS: number } | null = null;
  private engineRaf = 0;
  private engineLast = 0;
  private enginePausedByPage = false;
  private handHiddenForMissingPose = false;
  private engineMessageId: string | null = null;
  private engineCompletion: ((status: 'completed' | 'cancelled') => void) | null = null;
  private transientTimer = 0;
  private insetTween: gsap.core.Tween | null = null;
  private currentInsets: SafeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  private lastHand: HandView | null = null;
  private attachment: { name: string; size: number; dataUrl: string } | null = null;
  private playback: { cancel(): void } | null = null;
  private voice: BrowserVoiceInput | null = null;
  private handTracker: WebcamHandTracker | null = null;
  private readonly handModel = new HandInteractionModel();
  private readonly disposers: Array<() => void> = [];
  private pending: AbortController | null = null;
  readonly reducedMotion: boolean;
  readonly agentOptions: AgentClientOptions;
  private readonly el: Record<string, HTMLElement> = {};
  private readonly options: WorkspaceOptions;

  constructor(host: HTMLElement, options: WorkspaceOptions) {
    this.options = { ...options, assembly: structuredClone(options.assembly) };
    options = this.options;
    applyMotionTokens();
    this.engineering = new WorkspaceEngineeringSession(options.assembly);
    this.reducedMotion = options.reducedMotion ?? globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.agentOptions = options.agent ?? { mode: 'auto' };
    this.root = document.createElement('div');
    this.root.className = 'uw-root u-root';
    this.root.dataset.theme = 'dark';
    this.root.dataset.reducedMotion = String(this.reducedMotion);
    host.append(this.root);
    this.root.innerHTML = this.template();
    for (const n of this.root.querySelectorAll<HTMLElement>('[data-el]')) this.el[n.dataset.el!] = n;

    this.registry = buildComponentRegistry(options.assembly);
    this.foundry = new FoundryRenderer(this.el.stage!, options.profile ?? 'realtime', { preserveDrawingBuffer: options.preserveDrawingBuffer, pixelRatio: options.pixelRatio });
    this.lib = createMaterialLibrary();
    this.model = buildExcavator(options.assembly, this.lib);
    this.foundry.scene.add(this.model.root);
    this.scene = new SceneController(this.model, this.registry, () => this.foundry.requestRender(), () => this.foundry.studio.updateContactShadow(), '#FF5A1F', '#9AA0A8');
    this.scene.reducedMotion = this.reducedMotion;
    this.hand = new DigitalHand(this.registry, this.model.parts);
    this.previews = [loadFixturePreview()];
    this.director = new CameraDirector(this.foundry.camera, this.el.stage!, this.arbiter, () => this.foundry.requestRender());
    this.director.reducedMotion = this.reducedMotion;
    this.showEngineFrame();

    this.disposers.push(this.foundry.onBeforeRender(() => { if (this.director.update()) { this.foundry.markMotion(); this.foundry.requestRender(); } }));
    this.disposers.push(this.foundry.onAfterRender(() => this.updateHandOverlay()));
    const ro = new ResizeObserver(() => { this.foundry.resize(); this.syncInsets(false); });
    ro.observe(this.root); this.disposers.push(() => ro.disconnect());
    this.bindEvents();
    this.syncInsets(false);
    this.frameHome();
    this.render();
  }

  // ------------------------------------------------------------------------------------------------------ template
  private template(): string {
    const tool = (id: string, svg: string, label: string, hint: string, extra = '') => `<button class="uw-tool" type="button" data-el="${id}" aria-label="${esc(label)}" ${extra}>${icon(svg)}<span class="uw-tip" aria-hidden="true">${esc(label)}<small>${esc(hint)}</small></span></button>`;
    return `
      <div class="uw-stage" data-el="stage" tabindex="0" role="application" aria-label="Escavadora em 3D. Arrastar para orbitar, roda para aproximar, clique para seleccionar. Setas orbitam, + e − aproximam."></div>
      <div class="uw-hand" data-el="hand" aria-hidden="true" data-visible="false">
        <svg class="uw-reticle" data-el="reticle" width="1" height="1"><circle class="r-ring" r="10"/><path class="r-bracket" d=""/><path class="r-tick" d=""/><path class="r-slash" d=""/><circle class="r-dot" r="2.5"/><line class="r-leader" x1="0" y1="0" x2="0" y2="0"/></svg>
        <svg class="uw-hand-edge" viewBox="-14 -14 28 28"><path d="M-5 -8 L5 0 L-5 8"/></svg>
        <div class="uw-hand-label uw-surface" data-el="handLabel"></div>
      </div>
      <div class="uw-user-hand" data-el="userHand" hidden></div>
      <header class="uw-brand" data-el="brand"><img src="${esc(this.options.logoSrc ?? '/design-system/logos/unfold-mark-on-dark.svg')}" alt="UNFOLD"><span class="u-label">${esc(this.options.assembly.id)}${this.options.assembly.provenance.origin === 'fixture' ? ' · montagem sintética' : ''}</span></header>
      <nav class="uw-rail uw-surface" data-el="rail" aria-label="Ferramentas da cena">
        <div class="uw-rail-group">
          ${tool('toolFrame', focusIcon, 'Enquadrar', 'componente seleccionado ou máquina inteira')}
          ${tool('toolIsolate', layersIcon, 'Isolar', 'mostra só o componente seleccionado', 'aria-pressed="false"')}
          ${tool('toolExplode', expandIcon, 'Explodir', 'vista explodida · só visual', 'aria-pressed="false"')}
          ${tool('toolSimulate', playIcon, 'Simular', 'experiência suportada para o cilindro')}
          ${tool('toolMore', chevronsIcon, 'Mais ferramentas', 'evidência, câmara, mão', 'aria-expanded="false" aria-controls="uw-rail-more"')}
        </div>
        <div class="uw-rail-group" id="uw-rail-more" data-el="railMore" hidden>
          ${tool('toolEvidence', fileTextIcon, 'Evidência', 'proveniência do seleccionado', 'aria-pressed="false"')}
          ${tool('toolReset', rotateIcon, 'Repor câmara', 'vista inicial · R')}
          ${tool('toolHand', handIcon, 'Controlo por gestos', 'usa a câmara do dispositivo, só após clique', 'aria-pressed="false"')}
        </div>
        <div class="uw-rail-sep" aria-hidden="true"></div>
        ${tool('toolFocus', maximizeIcon, 'Modo foco', 'só o objecto · F, Esc para sair', 'aria-pressed="false"')}
      </nav>
      <div class="uw-notices" data-el="notices" role="alert" aria-live="assertive"></div>
      <section class="uw-transient uw-surface" data-el="transient" role="status" aria-live="polite" hidden></section>
      <aside class="uw-inspector uw-surface" data-el="inspector" aria-label="Inspector" hidden></aside>
      <section class="uw-conversation uw-surface" data-el="conversation" aria-label="Conversa" hidden>
        <div class="uw-conversation-head"><span class="u-label">conversa</span><button class="uw-close" type="button" data-el="convClose" aria-label="Recolher conversa">${icon(xIcon)}</button></div>
        <div class="uw-history" data-el="history" aria-live="polite"></div>
      </section>
      <form class="uw-composer uw-surface" data-el="composer" data-command-state="IDLE" aria-label="Compositor de comandos">
        <div class="uw-composer-tools">
          <button class="uw-ctool" type="button" data-el="attach" aria-label="Anexar imagem de referência">${icon(paperclipIcon)}</button>
          <input type="file" accept="image/png,image/jpeg" data-el="file" hidden>
        </div>
        <div class="uw-composer-main">
          <div class="uw-composer-row"><span class="uw-prefix" aria-hidden="true">/</span><textarea class="uw-input" data-el="input" rows="1" aria-label="Pergunta ou instrução" placeholder="Pergunte o que quiser sobre a máquina"></textarea></div>
          <div class="uw-feedback" aria-live="polite"><b data-el="state">pronto</b><span data-el="status">Modo assistido.</span></div>
        </div>
        <div class="uw-composer-tools">
          <button class="uw-ctool" type="button" data-el="mic" data-optional="true" aria-label="Ditado por voz" aria-pressed="false">${icon(micIcon)}</button>
          <button class="uw-ctool" type="button" data-el="overlay" data-optional="true" aria-label="Respostas visíveis. Atenuar.">${icon(eyeIcon)}</button>
          <button class="uw-ctool" type="button" data-el="expand" aria-label="Expandir conversa" aria-pressed="false">${icon(messageIcon)}</button>
          <button class="uw-ctool uw-send" type="submit" data-el="send" aria-label="Enviar" disabled>${icon(arrowUpIcon)}</button>
        </div>
      </form>
      <button class="uw-restore uw-surface" type="button" data-el="restore" hidden>${icon(maximizeIcon)}<span>Mostrar controlos</span><span class="u-label">Esc</span><span class="uw-unseen u-label" data-el="unseen"></span></button>
      <video data-el="video" hidden playsinline muted></video>`;
  }

  // ------------------------------------------------------------------------------------------------------- events
  private bindEvents(): void {
    const on = <K extends keyof HTMLElementEventMap>(el: EventTarget, type: K | string, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(type, fn as EventListener, opts); this.disposers.push(() => el.removeEventListener(type, fn as EventListener, opts));
    };
    const stage = this.el.stage!;
    let down: { x: number; y: number } | null = null;
    on(stage, 'pointerdown', (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; this.arbiter.userInput('user_pointer'); this.director.cancel(); });
    on(stage, 'pointerup', (e: PointerEvent) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) this.pickAt(e.clientX, e.clientY);
      down = null; this.arbiter.userRelease();
    });
    on(stage, 'wheel', () => { this.arbiter.userInput('user_pointer'); this.director.cancel(); this.arbiter.userRelease(); }, { passive: true });
    on(stage, 'keydown', (e: KeyboardEvent) => {
      const step = 0.08;
      const map: Record<string, [number, number, number]> = { ArrowLeft: [-step, 0, 1], ArrowRight: [step, 0, 1], ArrowUp: [0, step, 1], ArrowDown: [0, -step, 1], '+': [0, 0, 0.9], '=': [0, 0, 0.9], '-': [0, 0, 1.1] };
      const m = map[e.key];
      if (m) { e.preventDefault(); this.director.nudge(m[0], m[1], m[2]); }
      if (e.key === 'Enter' && this.hand.targetId) this.select(this.hand.targetId);
    });
    on(window, 'keydown', (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.('textarea, input');
      if (e.key === 'Escape') { e.preventDefault(); this.escape(); return; }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'f' || e.key === 'F') { e.preventDefault(); this.toggleFocus(); }
      else if (e.key === 'c' || e.key === 'C') { e.preventDefault(); this.dispatch({ type: 'toggle_conversation' }); }
      else if (e.key === 'h' || e.key === 'H') { e.preventDefault(); this.dispatch({ type: 'cycle_overlay' }); }
      else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); this.director.reset(); }
      else if (e.key === '/') { e.preventDefault(); if (this.state.mode === 'focus') this.dispatch({ type: 'exit_focus' }); this.el.input!.focus(); }
    });
    on(window, 'pagehide', () => { this.enginePausedByPage = this.engineering.state().playing; if (this.enginePausedByPage) this.pauseEngine(); });
    on(window, 'pageshow', (event: Event) => {
      if (!(event as PageTransitionEvent).persisted || this.disposed) return;
      this.foundry.resize(); this.foundry.requestRender();
      if (this.enginePausedByPage) this.notice('engine-restored', 'A experiência ficou pausada durante a navegação. Retome quando quiser.', 'info');
      this.enginePausedByPage = false;
    });
    // rail
    on(this.el.toolFrame!, 'click', () => this.frameSelection());
    on(this.el.toolIsolate!, 'click', () => this.toggleIsolate());
    on(this.el.toolExplode!, 'click', () => { const exploded = !this.scene.exploded; this.scene.setExploded(exploded); this.notice('explode', exploded ? 'Vista explodida · deslocamento só visual, não é uma pose do motor.' : null, 'info'); this.renderRail(); });
    on(this.el.toolSimulate!, 'click', () => this.offerExperiment(this.selectedId, null));
    on(this.el.toolMore!, 'click', () => this.dispatch({ type: 'toggle_rail' }));
    on(this.el.toolEvidence!, 'click', () => { if (!this.selectedId) return; this.inspectorOpen = true; this.evidenceOpen = !this.evidenceOpen; this.renderInspector(); this.renderRail(); });
    on(this.el.toolReset!, 'click', () => this.director.reset());
    on(this.el.toolHand!, 'click', () => void this.toggleHandTracking());
    on(this.el.toolFocus!, 'click', () => this.toggleFocus());
    on(this.el.restore!, 'click', () => this.dispatch({ type: 'exit_focus' }));
    // composer
    const input = this.el.input as HTMLTextAreaElement;
    on(input, 'input', () => { this.autoGrow(); this.setComposerState(input.value.trim() ? 'TYPING' : 'IDLE'); (this.el.send as HTMLButtonElement).disabled = !input.value.trim() && !this.attachment; });
    on(input, 'keydown', (e: KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.submit(); } });
    on(this.el.composer!, 'submit', (e: Event) => { e.preventDefault(); this.submit(); });
    on(this.el.expand!, 'click', () => this.dispatch({ type: 'toggle_conversation' }));
    on(this.el.convClose!, 'click', () => this.dispatch({ type: 'toggle_conversation' }));
    on(this.el.overlay!, 'click', () => this.dispatch({ type: 'cycle_overlay' }));
    on(this.el.attach!, 'click', () => (this.el.file as HTMLInputElement).click());
    on(this.el.file!, 'change', () => void this.readAttachment());
    on(this.el.mic!, 'click', () => this.toggleVoice());
    // delegated clicks inside overlays (evidence chips, proposals, links)
    on(this.root, 'click', (e: MouseEvent) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]'); if (!t) return;
      const act = t.dataset.act!, arg = t.dataset.arg ?? '';
      if (act === 'point') this.pointAt(arg, 'point', 'user_tool');
      else if (act === 'select') this.select(arg);
      else if (act === 'expand') this.dispatch({ type: 'set_mode', mode: 'conversation' });
      else if (act === 'dismiss') this.dispatch({ type: 'dismiss_transient' });
      else if (act === 'approve') void this.approve(arg);
      else if (act === 'reject') this.reject(arg);
      else if (act === 'reset-pose') this.resetPose();
      else if (act === 'close-inspector') { this.inspectorOpen = false; this.evidenceOpen = false; this.renderInspector(); this.renderRail(); }
      else if (act === 'frame') this.frameSelection();
      else if (act === 'isolate') this.toggleIsolate();
      else if (act === 'simulate') this.offerExperiment(this.selectedId, null);
      else if (act === 'evidence') { this.evidenceOpen = !this.evidenceOpen; this.renderInspector(); this.renderRail(); }
      else if (act === 'review') this.dispatch({ type: 'set_mode', mode: 'conversation' });
      else if (act === 'clear-notice') this.dispatch({ type: 'clear_notice', id: arg });
      else if (act === 'engine-preview') this.previewEngineMove();
      else if (act === 'engine-approve') this.approveEngineMove();
      else if (act === 'engine-reject') { if (this.engineProposal) this.engineering.reject(this.engineProposal.token); this.engineProposal = null; this.renderInspector(); }
      else if (act === 'engine-pause') this.pauseEngine();
      else if (act === 'engine-resume') this.resumeEngine();
      else if (act === 'engine-cancel') this.cancelEngine();
      else if (act === 'engine-reset') this.resetPose();
    });
    on(this.root, 'change', (e: Event) => {
      const input = e.target as HTMLInputElement;
      if (input.dataset.act !== 'engine-seek') return;
      this.pauseEngine(); this.engineering.seek(input.valueAsNumber); this.engineProposal = null;
      if (this.showEngineFrame() && this.engineering.state().timeS >= this.engineering.state().durationS) this.finishEngineMessage();
      this.renderInspector();
    });
    on(this.root, 'input', (e: Event) => {
      const input = e.target as HTMLInputElement;
      if (input.dataset.el !== 'engineSlider') return;
      const target = this.el.inspector!.querySelector<HTMLInputElement>('[data-el="engineTarget"]');
      if (target) target.value = input.value;
    });
    this.voice = new BrowserVoiceInput({
      onStatus: (status, message) => { this.setComposerState(status === 'LISTENING' ? 'LISTENING' : status === 'ERROR' ? 'ERROR' : 'IDLE', message); (this.el.mic as HTMLButtonElement).setAttribute('aria-pressed', String(status === 'LISTENING')); },
      onTranscript: (value) => { (this.el.input as HTMLTextAreaElement).value = value; this.autoGrow(); (this.el.send as HTMLButtonElement).disabled = !value.trim(); },
      onCommand: async (value) => { await this.ask(value); return true; },
    });
    if (!this.voice.supported) this.el.mic!.hidden = true;
  }

  private autoGrow(): void { const i = this.el.input as HTMLTextAreaElement; i.style.height = 'auto'; i.style.height = `${Math.min(120, i.scrollHeight)}px`; this.syncInsets(true); }

  // ------------------------------------------------------------------------------------------------- state & view
  dispatch(action: WorkspaceAction): void {
    const before = this.state;
    this.state = reduceWorkspace(this.state, action);
    if (this.state.transientId && this.state.transientId !== before.transientId) this.armTransientTimer();
    this.render();
    if (before.mode !== this.state.mode || before.railOpen !== this.state.railOpen) this.syncInsets(true);
  }

  getState(): WorkspaceState { return this.state; }

  private armTransientTimer(): void {
    clearTimeout(this.transientTimer);
    this.transientTimer = window.setTimeout(() => { if (!this.el.transient!.matches(':hover, :focus-within')) this.dispatch({ type: 'dismiss_transient' }); else this.armTransientTimer(); }, TRANSIENT_MS);
  }

  private render(): void {
    const v = visibility(this.state);
    this.root.dataset.mode = this.state.mode;
    this.root.dataset.overlay = this.state.overlay;
    this.root.style.setProperty('--uw-overlay', String(v.overlayOpacity));
    this.el.restore!.hidden = v.composer !== 'restore_only';
    this.el.unseen!.textContent = v.unseen ? `${v.unseen} nova${v.unseen > 1 ? 's' : ''}` : '';
    this.el.composer!.hidden = v.composer === 'restore_only';
    this.el.conversation!.hidden = !v.conversation;
    this.el.railMore!.hidden = !this.state.railOpen;
    this.el.toolMore!.setAttribute('aria-expanded', String(this.state.railOpen));
    (this.el.rail as HTMLElement).inert = v.rail === 'hidden';
    (this.el.brand as HTMLElement).inert = v.rail === 'hidden';
    this.el.expand!.setAttribute('aria-pressed', String(v.conversation));
    this.el.expand!.setAttribute('aria-label', v.conversation ? 'Recolher conversa' : 'Expandir conversa');
    const ov = this.state.overlay;
    this.el.overlay!.innerHTML = icon(ov === 'visible' ? eyeIcon : ov === 'dimmed' ? sunDimIcon : eyeOffIcon);
    this.el.overlay!.setAttribute('aria-label', ov === 'visible' ? 'Respostas visíveis. Atenuar.' : ov === 'dimmed' ? 'Respostas atenuadas. Ocultar.' : 'Respostas ocultas. Mostrar.');
    this.el.toolFocus!.setAttribute('aria-pressed', String(this.state.mode === 'focus'));
    this.scene.setHighlightOpacity(this.state.mode === 'focus' ? 0.45 : Math.max(0.35, v.overlayOpacity));
    this.renderTransient(v.transient);
    this.renderHistory();
    this.renderNotices(v);
    this.renderRail();
    this.renderInspector();
    this.foundry.requestRender();
  }

  private sourceChip(m: Message): string {
    if (m.role !== 'assistant') return '';
    const cls = m.source === 'live' ? 'u-chip' : 'u-chip u-chip--uncertain';
    return `<span class="${cls}">${esc(m.sourceNote ?? m.source)}</span>`;
  }

  private evidenceChips(m: Message): string {
    if (!m.evidence.length) return '';
    return `<div class="uw-msg-evidence">${m.evidence.map((e) => e.status === 'resolved'
      ? `<button type="button" class="uw-ref" data-act="point" data-arg="${esc(e.componentId)}" aria-label="Apontar para ${esc(e.label)}" title="${esc(e.label)}">${esc(e.componentId)}</button>`
      : `<span class="uw-ref uw-ref-missing">${esc(e.componentId)}? · não encontrado</span>`).join('')}</div>`;
  }

  private proposalHtml(m: Message): string {
    const p = m.proposal; if (!p) return '';
    const actions = p.state === 'pending' && (p.kind === 'preview_fixture' || p.kind === 'engine_move')
      ? `<div class="uw-proposal-actions"><button type="button" class="u-btn u-btn--primary" data-act="approve" data-arg="${esc(m.id)}">${esc(p.approveLabel)}</button><button type="button" class="u-btn u-btn--outline" data-act="reject" data-arg="${esc(m.id)}">Rejeitar</button></div>`
      : `<p class="u-label">${p.state === 'running' ? 'movimento em execução' : p.state === 'done' ? (p.kind === 'engine_move' ? 'movimento aprovado · motor' : 'pré-visualização mostrada · fixture') : p.state === 'cancelled' ? 'interrompida · nada concluído' : p.state === 'failed' ? 'sem execução' : p.state === 'rejected' ? 'rejeitada · nada mudou' : 'sem acção disponível'}</p>`;
    return `<div class="uw-proposal" data-state="${p.state}"><h3>${esc(p.title)}</h3><p>${esc(p.detail)}</p>${actions}</div>`;
  }

  private renderTransient(m: Message | null): void {
    const el = this.el.transient!;
    if (!m) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = `<div class="uw-transient-head">${this.sourceChip(m)}<button type="button" class="uw-close" data-act="dismiss" aria-label="Fechar resposta">${icon(xIcon)}</button></div>
      <p>${esc(m.text)}</p>${m.error ? `<div class="uw-msg-error">${esc(m.error)}</div>` : ''}${this.evidenceChips(m)}
      <div class="uw-transient-actions">${m.proposal?.state === 'pending' ? `<button type="button" class="uw-link" data-act="review">rever proposta</button>` : ''}<button type="button" class="uw-link" data-act="expand">expandir</button></div>`;
  }

  private renderHistory(): void {
    if (this.el.conversation!.hidden) return;
    const el = this.el.history!;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
    el.innerHTML = this.state.messages.length ? this.state.messages.map((m) => `
      <article class="uw-msg" data-role="${m.role}" data-id="${esc(m.id)}">
        ${m.role === 'assistant' ? `<div class="uw-msg-head">${this.sourceChip(m)}</div>` : m.role === 'system' ? `<div class="uw-msg-head"><span class="u-label">sistema</span></div>` : ''}
        <p>${esc(m.text)}</p>${m.error ? `<div class="uw-msg-error">${esc(m.error)}</div>` : ''}
        ${this.evidenceChips(m)}${this.proposalHtml(m)}
        ${m.attachment ? `<img class="uw-msg-image" src="${esc(m.attachment.dataUrl)}" alt="Imagem de referência: ${esc(m.attachment.name)}">` : ''}
      </article>`).join('') + (this.state.processing ? '<p class="u-label">a interpretar…</p>' : '')
      : '<p class="uw-empty">Sem conversa. Pergunte, por exemplo: «O que levanta a lança?»</p>';
    if (atBottom) el.scrollTop = el.scrollHeight;
  }

  private renderNotices(v: ReturnType<typeof visibility>): void {
    const pending = v.pendingApprovals.length && (this.state.mode === 'focus' || this.state.mode === 'assisted' && !this.state.transientId)
      ? `<div class="uw-notice uw-surface" data-severity="approval"><p>${v.pendingApprovals.length} proposta aguarda a sua decisão.</p><button type="button" class="u-btn u-btn--outline" data-act="review">Rever</button></div>` : '';
    this.el.notices!.innerHTML = v.critical.map((n) => `<div class="uw-notice uw-surface" data-severity="${n.severity}" data-id="${esc(n.id)}"><p>${esc(n.text)}</p>${n.id === 'pose' ? '<button type="button" class="u-btn u-btn--outline" data-act="reset-pose">Repor referência</button>' : n.id === 'agent-error' ? `<button type="button" class="uw-close" data-act="clear-notice" data-arg="${esc(n.id)}" aria-label="Fechar aviso">${icon(xIcon)}</button>` : ''}</div>`).join('') + pending
      + this.state.notices.filter((n) => n.severity === 'info' && this.state.mode !== 'focus').map((n) => `<div class="uw-notice uw-surface" data-severity="info"><p class="u-label">${esc(n.text)}</p></div>`).join('');
    const h = this.el.notices!.childElementCount ? this.el.notices!.offsetHeight + 8 : 0;
    this.root.style.setProperty('--uw-notices-h', `${h}px`);
  }

  private renderRail(): void {
    const sel = this.selectedId ? this.registry.get(this.selectedId) : null;
    (this.el.toolIsolate as HTMLButtonElement).disabled = !sel;
    this.el.toolIsolate!.setAttribute('aria-pressed', String(!!this.scene.isolatedId));
    this.el.toolExplode!.setAttribute('aria-pressed', String(this.scene.exploded));
    const cyl = sel && (sel.role === 'hydraulic_cylinder' ? sel : this.registry.ownerOfPart(sel.id));
    (this.el.toolSimulate as HTMLButtonElement).disabled = !(cyl && cyl.role === 'hydraulic_cylinder') || !!this.playback;
    (this.el.toolEvidence as HTMLButtonElement).disabled = !sel;
    this.el.toolEvidence!.setAttribute('aria-pressed', String(this.evidenceOpen));
    this.el.toolHand!.setAttribute('aria-pressed', String(!!this.handTracker));
  }

  private renderInspector(): void {
    const el = this.el.inspector!;
    const c = this.selectedId ? this.registry.get(this.selectedId) : null;
    if (!c || !this.inspectorOpen || this.state.mode === 'focus') { el.hidden = true; return; }
    el.hidden = false;
    const rows: Array<[string, string]> = [];
    const a = this.options.assembly.actuators.find((x) => x.id === c.id);
    if (a && a.kind === 'hydraulic_cylinder') {
      rows.push(['Curso', `${fmt(a.stroke.min.value)} – ${fmt(a.stroke.max.value)} m`], ['Curso de referência', `${fmt(a.referenceStroke.value)} m`], ['Velocidade máx.', a.maxRate ? `${fmt(a.maxRate.value, 2)} m/s` : 'desconhecida']);
      rows.push(['Diâmetro interno', a.hydraulics.boreDiameter ? `${fmt(a.hydraulics.boreDiameter.value)} m` : 'desconhecido'], ['Força', 'desconhecida']);
      const joint = this.options.assembly.joints.find((j) => j.id === a.drives.jointId);
      rows.push(['Acciona', joint ? joint.id : a.drives.jointId]);
    } else if (c.kind === 'part') {
      const part = this.options.assembly.parts.find((p) => p.id === c.id)!;
      const box = part.shapes.find((s) => s.kind === 'box');
      rows.push(['Papel', part.role]);
      if (box && box.kind === 'box') rows.push(['Envolvente de colisão', `${box.halfExtentsM.map((h) => (h * 2).toFixed(2)).join(' × ')} m`]);
      rows.push(['Massa', part.massKg ? `${part.massKg.value} kg` : 'desconhecida']);
    }
    const unc = c.validation === 'verified' || c.validation === 'corrected' ? '' : `<span class="u-chip u-chip--uncertain">${esc(c.origin)} · ${esc(c.validation === 'unreviewed' ? 'não verificado' : c.validation)}</span>`;
    const source = this.options.assembly.sources.find((s) => c.evidence.some((e) => e.sourceId === s.id));
    const evidence = this.evidenceOpen ? `<ul class="uw-evidence" aria-label="Evidência">${c.evidence.map((e) => `<li><code>${esc(e.sourceId)}</code>${e.locator ? ` · <code>${esc(e.locator)}</code>` : ''}<br>${esc(e.excerpt ?? '')}</li>`).join('') || '<li>Sem evidência registada.</li>'}${source ? `<li>${esc(source.title)}</li>` : ''}</ul>` : '';
    const engineState = this.engineering.state();
    let current: ReturnType<WorkspaceEngineeringSession['frame']>['actuators'][number] | undefined;
    try { current = this.engineering.frame().actuators.find((item) => item.actuatorId === c.id); } catch { current = undefined; }
    const proposal = this.engineProposal?.actuatorId === c.id ? this.engineProposal : null;
    const engineControls = !this.options.fixtureDemo && a?.kind === 'hydraulic_cylinder' ? `<div class="uw-inspector-actions"><label>Curso alvo (m) <input data-el="engineTarget" ${current ? '' : 'disabled'} type="number" step="0.001" min="${a.stroke.min.value}" max="${a.stroke.max.value}" value="${current?.value ?? ''}"></label><label>Ajustar curso <input data-el="engineSlider" ${current ? '' : 'disabled'} type="range" step="0.001" min="${a.stroke.min.value}" max="${a.stroke.max.value}" value="${current?.value ?? ''}"></label><button type="button" class="uw-link" data-act="engine-preview" ${current ? '' : 'disabled'}>Pré-visualizar movimento</button></div><p class="u-label" data-el="engineStatus">Motor · curso actual ${current ? `${fmt(current.value)} m` : 'desconhecido'} · ${engineState.timeS.toFixed(2)} / ${engineState.durationS.toFixed(2)} s · ${engineState.playing ? 'em execução' : 'pausado'}</p>${proposal ? `<p>Proposta: ${fmt(proposal.target)} m, duração ${proposal.durationS.toFixed(2)} s.</p><div class="uw-inspector-actions"><button type="button" class="uw-link" data-act="engine-approve">Confirmar movimento</button><button type="button" class="uw-link" data-act="engine-reject">Rejeitar</button></div>` : ''}<label>Tempo da experiência <input type="range" data-act="engine-seek" min="0" max="${engineState.durationS}" step="0.001" value="${engineState.timeS}" ${engineState.durationS === 0 ? 'disabled' : ''}></label><div class="uw-inspector-actions"><button type="button" class="uw-link" data-act="engine-pause">Pausar</button><button type="button" class="uw-link" data-act="engine-resume">Retomar</button><button type="button" class="uw-link" data-act="engine-cancel">Cancelar movimento</button><button type="button" class="uw-link" data-act="engine-reset">Repor referência</button></div>` : '';
    el.innerHTML = `<div class="uw-transient-head"><span class="u-label">${esc(c.kind === 'actuator' ? 'actuador' : c.kind === 'joint' ? 'articulação' : 'parte')} · ${esc(c.id)}</span><button type="button" class="uw-close" data-act="close-inspector" aria-label="Fechar inspector">${icon(xIcon)}</button></div>
      <h2>${esc(c.label)}</h2><div class="uw-chips">${unc}${this.poseLabel === 'fixture-preview' ? '<span class="u-chip u-chip--uncertain">pose · fixture</span>' : this.poseLabel === 'engine' ? `<span class="u-label">pose calculada pelo motor${this.options.assembly.provenance.origin === 'fixture' ? ' · montagem sintética' : ''}</span>` : '<span class="u-label">pose de referência</span>'}${this.options.assembly.provenance.origin === 'fixture' ? '<span class="u-chip u-chip--uncertain">montagem sintética</span>' : ''}</div>
      ${rows.length ? `<dl class="u-readout">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
      ${engineControls}
      <div class="uw-inspector-actions"><button type="button" class="uw-link" data-act="frame">enquadrar</button><button type="button" class="uw-link" data-act="isolate">${this.scene.isolatedId ? 'mostrar tudo' : 'isolar'}</button>${c.role === 'hydraulic_cylinder' ? '<button type="button" class="uw-link" data-act="simulate">simular</button>' : ''}<button type="button" class="uw-link" data-act="evidence" aria-pressed="${this.evidenceOpen}">evidência</button></div>${evidence}`;
  }

  private setComposerState(state: 'IDLE' | 'TYPING' | 'LISTENING' | 'PROCESSING' | 'COMPLETE' | 'ERROR', message?: string): void {
    this.el.composer!.dataset.commandState = state;
    this.el.state!.textContent = ({ IDLE: 'pronto', TYPING: 'a escrever', LISTENING: 'a ouvir', PROCESSING: 'a interpretar', COMPLETE: 'concluído', ERROR: 'erro' } as const)[state];
    if (message !== undefined) this.el.status!.textContent = message;
  }

  private notice(id: string, text: string | null, severity: 'critical' | 'approval' | 'info' = 'critical'): void {
    if (text === null) this.dispatch({ type: 'clear_notice', id }); else this.dispatch({ type: 'notice', notice: { id, text, severity } });
  }

  // ----------------------------------------------------------------------------------------------- safe area / camera
  private targetInsets(): SafeInsets {
    const W = this.root.clientWidth, narrow = W <= 680;
    if (this.state.mode === 'focus') return { top: 16, right: 16, bottom: 72, left: 16 };
    const composerH = this.el.composer!.offsetHeight || 64;
    this.root.style.setProperty('--uw-composer-h', `${composerH}px`);
    const bottom = composerH + 32 + (narrow && this.state.mode === 'conversation' ? this.el.conversation!.offsetHeight + 8 : 0);
    const right = !narrow && this.state.mode === 'conversation' ? Math.min(420, W * 0.38) + 32 : 24;
    return { top: 64, right, bottom, left: narrow ? 56 : 72 };
  }

  private syncInsets(animate: boolean): void {
    const to = this.targetInsets();
    const viewport = { width: this.root.clientWidth || 1, height: this.root.clientHeight || 1 };
    this.insetTween?.kill();
    if (!animate || this.reducedMotion) { this.currentInsets = to; this.director.setViewport(viewport, to); return; }
    const s = { ...this.currentInsets };
    this.insetTween = gsap.to(s, { ...to, duration: DURATION.base, ease: EASE.inOut, onUpdate: () => { this.currentInsets = { ...s }; this.director.setViewport({ width: this.root.clientWidth, height: this.root.clientHeight }, this.currentInsets); } });
  }


  private frameHome(): void {
    const box = new Box3().setFromObject(this.model.root);
    const viewport = { width: this.root.clientWidth || 1, height: this.root.clientHeight || 1 };
    const target = box.getCenter(new Vector3());
    const azimuth = (36 * Math.PI) / 180, elevation = (10 * Math.PI) / 180;
    const distance = fitBoxDistance(box, target, azimuth, elevation, viewport, this.currentInsets, this.director.baseFov, 12);
    const home = { target, azimuth, elevation, distance };
    this.director.setHome(home);
    this.director.jumpTo(home);
  }

  /** Re-frames the whole machine for the current usable area (used after a resize or a visibility change). */
  frameAll(): void { this.frameHome(); }

  setView(view: { target: [number, number, number]; azimuthDeg: number; elevationDeg: number; distance: number }): void {
    this.director.jumpTo({ target: new Vector3(...view.target), azimuth: (view.azimuthDeg * Math.PI) / 180, elevation: (view.elevationDeg * Math.PI) / 180, distance: view.distance });
  }

  private frameSelection(): void {
    const id = this.selectedId;
    if (!id) { this.director.reset(); return; }
    const r = this.componentSphere(id); if (r) this.director.focusSphere(r, 'user_tool');
  }

  private componentSphere(id: string): Sphere | null {
    const c = this.registry.get(id); if (!c) return null;
    const box = new Box3();
    for (const p of c.partIds) { const g = this.model.parts.get(p); if (g) box.expandByObject(g); }
    return box.isEmpty() ? null : box.getBoundingSphere(new Sphere());
  }

  // ---------------------------------------------------------------------------------------------- selection & hand
  private pickAt(clientX: number, clientY: number): void {
    const rect = this.el.stage!.getBoundingClientRect();
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const c = this.scene.pick(ndc, this.foundry.camera);
    if (c) this.select(c.id); else this.clearSelection();
  }

  select(id: string): void {
    const c = this.registry.get(id);
    if (!c) { this.hand.attend(id, 'blocked'); this.updateHandOverlay(); return; }
    this.setSelectedComponent(c, true);
    this.scene.highlight(c);
    this.hand.attend(id, 'select');
    this.render();
  }

  private setSelectedComponent(component: CanonicalComponent, inspectorOpen: boolean): void {
    this.selectedId = component.id; this.inspectorOpen = inspectorOpen;
    if (this.scene.isolatedId && this.scene.isolatedId !== component.id) this.scene.isolate(component);
  }

  clearSelection(): void {
    this.selectedId = null; this.inspectorOpen = false; this.evidenceOpen = false;
    this.scene.highlight(null); if (this.scene.isolatedId) this.scene.isolate(null);
    if (this.hand.state === 'select') this.hand.release();
    this.render();
  }

  private toggleIsolate(): void {
    if (this.scene.isolatedId) this.scene.isolate(null);
    else if (this.selectedId) this.scene.isolate(this.registry.get(this.selectedId) ?? null);
    this.renderRail(); this.renderInspector();
  }

  /** Points the Digital Hand at a canonical component; moves the camera only if the target is not usable from here. */
  pointAt(id: string, state: Exclude<HandState, 'hidden'>, by: 'assistant' | 'user_tool', note: string | null = null): { resolved: boolean; cameraMoved: boolean; cameraReason?: string } {
    if (!this.model.root.visible) { this.handHiddenForMissingPose = true; this.hand.release(); this.updateHandOverlay(); return { resolved: false, cameraMoved: false }; }
    const r = this.hand.attend(id, state, note);
    if (r.status !== 'resolved') { this.scene.highlight(null); this.updateHandOverlay(); return { resolved: false, cameraMoved: false }; }
    this.scene.highlight(r.component);
    this.foundry.renderNow();
    const view = this.handView();
    const needsCamera = !view || view.x === null || view.occluded || view.radiusPx < 18;
    let moved = false, reason: string | undefined;
    if (needsCamera) {
      const sphere = this.componentSphere(id);
      if (sphere) { const res = this.director.focusSphere(sphere, by, 0.45); moved = res.moved; reason = res.reason; }
    }
    this.foundry.requestRender();
    return { resolved: true, cameraMoved: moved, cameraReason: reason };
  }

  handView(): HandView | null {
    if (!this.model.root.visible) { this.handHiddenForMissingPose = true; this.hand.release(); }
    const viewport = { width: this.root.clientWidth, height: this.root.clientHeight };
    return this.hand.view(this.foundry.camera, viewport, this.currentInsets, this.scene.canonicalMeshes());
  }

  private updateHandOverlay(): void {
    const el = this.el.hand!;
    const v = this.handView();
    this.lastHand = v;
    if (!v || v.state === 'hidden') { el.dataset.visible = 'false'; return; }
    el.dataset.visible = 'true';
    el.dataset.state = v.state;
    el.dataset.occluded = String(v.occluded);
    const agency = this.approvedRunning ? 'performing_approved' : HAND_AGENCY[v.state];
    el.dataset.agency = agency;
    el.dataset.offscreen = String(v.x === null && !!v.offscreen);
    const reticle = this.el.reticle as unknown as SVGSVGElement;
    const label = this.el.handLabel!;
    const rr = v.radiusPx;
    let ax: number, ay: number;
    if (v.x !== null && v.y !== null) { ax = v.x; ay = v.y; }
    else if (v.offscreen) { ax = v.offscreen.x; ay = v.offscreen.y; (el.querySelector('.uw-hand-edge') as SVGElement).style.cssText = `left:${ax}px;top:${ay}px;transform:rotate(${v.offscreen.angle}rad)`; }
    else { ax = this.root.clientWidth / 2; ay = 96; }
    if (v.x !== null) {
      reticle.style.cssText = `left:${ax}px;top:${ay}px`;
      const b = rr, k = Math.max(6, rr * 0.35);
      reticle.querySelector('.r-bracket')!.setAttribute('d', `M${-b} ${-b + k}V${-b}H${-b + k}M${b - k} ${-b}H${b}V${-b + k}M${b} ${b - k}V${b}H${b - k}M${-b + k} ${b}H${-b}V${b - k}`);
      reticle.querySelector('.r-ring')!.setAttribute('r', String(rr));
      reticle.querySelector('.r-tick')!.setAttribute('d', `M0 ${-rr - 6}V${-rr + 4}M0 ${rr - 4}V${rr + 6}M${-rr - 6} 0H${-rr + 4}M${rr - 4} 0H${rr + 6}`);
      reticle.querySelector('.r-slash')!.setAttribute('d', `M${-rr * 0.7} ${rr * 0.7}L${rr * 0.7} ${-rr * 0.7}`);
    }
    // label beside the reticle, kept inside the usable area, with a leader to the reticle edge
    const W = this.root.clientWidth, H = this.root.clientHeight, ins = this.currentInsets;
    label.innerHTML = `<span class="u-label">${esc(v.stateLabel)}${agency === 'suggesting' ? ' · sugestão' : agency === 'performing_approved' ? ' · acção aprovada' : agency === 'observing' ? ' · observa' : ''}</span><strong>${esc(v.label || v.targetId || '')}</strong>${v.problem ? `<span class="uw-hand-problem">${esc(v.problem)}</span>` : ''}${v.uncertainty ? `<span class="u-chip ${v.uncertainty.uncertain ? 'u-chip--uncertain' : ''}">${esc(v.uncertainty.text)}</span>` : ''}`;
    const lw = label.offsetWidth || 200, lh = label.offsetHeight || 64;
    // candidate positions around the reticle; the first that stays in the usable area and clears open overlays wins
    const rootRect = this.root.getBoundingClientRect();
    const blockers = ['inspector', 'transient', 'conversation', 'notices'].map((k) => this.el[k]!).filter((n) => !n.hidden && n.offsetWidth).map((n) => { const r = n.getBoundingClientRect(); return { l: r.left - rootRect.left - 8, t: r.top - rootRect.top - 8, r: r.right - rootRect.left + 8, b: r.bottom - rootRect.top + 8 }; });
    const candidates: Array<[number, number]> = [[ax + rr + 20, ay - rr - lh - 8], [ax - rr - 20 - lw, ay - rr - lh - 8], [ax + rr + 20, ay + rr + 12], [ax - rr - 20 - lw, ay + rr + 12], [ax - lw / 2, ay + rr + 16], [ax - lw / 2, ay - rr - lh - 16]];
    const clamp = ([x, y]: [number, number]): [number, number] => [Math.max(ins.left, Math.min(W - ins.right - lw, x)), Math.max(ins.top, Math.min(H - ins.bottom - lh, y))];
    const clear = ([x, y]: [number, number]) => blockers.every((b) => x + lw < b.l || x > b.r || y + lh < b.t || y > b.b);
    const pick = candidates.map(clamp).find(clear) ?? clamp(candidates[0]!);
    const [lx, ly] = pick;
    label.style.cssText = `left:${lx}px;top:${ly}px`;
    const leader = reticle.querySelector('.r-leader')!;
    if (v.x !== null) {
      const tx = (lx + (lx > ax ? 0 : lw)) - ax, ty = (ly + lh / 2) - ay; const d = Math.hypot(tx, ty) || 1;
      leader.setAttribute('x1', String((tx / d) * (rr + 4))); leader.setAttribute('y1', String((ty / d) * (rr + 4))); leader.setAttribute('x2', String(tx)); leader.setAttribute('y2', String(ty));
    }
  }

  // ------------------------------------------------------------------------------------------------- intelligence
  private submit(): void {
    const input = this.el.input as HTMLTextAreaElement;
    const text = input.value.trim();
    if (!text && !this.attachment) return;
    input.value = ''; this.autoGrow(); (this.el.send as HTMLButtonElement).disabled = true;
    void this.ask(text || 'Imagem de referência anexada.');
  }

  private async readAttachment(): Promise<void> {
    const file = (this.el.file as HTMLInputElement).files?.[0]; if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 10_000_000) { this.setComposerState('ERROR', 'Só PNG ou JPEG até 10 MB.'); return; }
    const dataUrl = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
    this.attachment = { name: file.name, size: file.size, dataUrl };
    this.setComposerState('TYPING', `Imagem: ${file.name} (${Math.round(file.size / 1024)} kB). Fica como referência na conversa.`);
    (this.el.send as HTMLButtonElement).disabled = false;
  }

  /** User question → agent → grounded spatial act. Returns the grounded result (also for tests and the harness). */
  async ask(text: string): Promise<Grounded> {
    const attachment = this.attachment; this.attachment = null;
    this.dispatch({ type: 'user_message', message: { id: newId('u'), role: 'user', text, source: 'local', sourceNote: null, evidence: [], proposal: null, error: null, at: Date.now(), attachment: attachment ?? undefined } });
    if (attachment) this.dispatch({ type: 'assistant_message', message: { id: newId('s'), role: 'system', text: `Imagem «${attachment.name}» guardada como referência nesta conversa. A rota spatial_agent_request.v1 não recebe imagens, por isso não foi enviada ao modelo.`, source: 'local', sourceNote: null, evidence: [], proposal: null, error: null, at: Date.now() } });
    this.dispatch({ type: 'processing', value: true });
    this.setComposerState('PROCESSING', 'A interpretar com o contexto da cena.');
    this.pending?.abort(); const abort = new AbortController(); this.pending = abort;
    const request = buildAgentRequest(text, this.registry, this.selectedId, this.history);
    const outcome = await askAgent(request, this.agentOptions, abort.signal);
    // superseded or cancelled: the newer request owns processing state and the composer; this one touches nothing
    if (abort.signal.aborted || this.pending !== abort || this.disposed) return groundOutcome(outcome, this.registry, request.scene?.selectedId ?? null);
    this.pending = null;
    const g = groundOutcome(outcome, this.registry, request.scene?.selectedId ?? null);
    // a supported experiment, decided locally (never by the model)
    let plan: ReturnType<SpatialWorkspace['planExperiment']> | null = null;
    if (/\b(estend\w*|extend\w*)\b/i.test(text.normalize('NFD').replace(/[̀-ͯ]/g, '')) && g.primary && !g.blocked && !g.clarification) {
      plan = /\d/.test(text) && !this.options.fixtureDemo
        ? { kind: 'unavailable', actuatorId: g.primary.id, title: 'Definir curso', detail: 'Para um valor numérico, indique o curso alvo no controlo do actuador e confirme a proposta.' }
        : this.planExperiment(g.primary.id);
    }
    const safeText = this.options.fixtureDemo ? g.text : this.engineExplanation(g.primary, Boolean(g.clarification), Boolean(g.blocked));
    this.history = [...this.history, { role: 'user' as const, text }, { role: 'assistant' as const, text: safeText }].slice(-6);
    const message: Message = {
      id: newId('a'), role: 'assistant', text: plan ? (plan.kind === 'engine_move' ? 'O motor avaliou a proposta; confirme antes de executar.' : plan.kind === 'preview_fixture' ? g.text : plan.detail) : this.options.fixtureDemo && g.clarification ? `${g.text} ${g.clarification}` : safeText, source: this.options.fixtureDemo && g.source !== 'none' ? g.source : 'local', sourceNote: this.options.fixtureDemo ? (g.source === 'none' ? 'Erro · nada executado' : g.sourceNote) : 'Interpretação do pedido · valores do motor',
      evidence: g.targets.map((t) => ({ componentId: t.id, label: t.status === 'resolved' ? t.component.label : t.id, status: t.status })),
      proposal: plan ? { id: newId('p'), title: plan.title, detail: plan.detail, kind: plan.kind, approveLabel: plan.kind === 'preview_fixture' ? 'Pré-visualizar fixture' : 'Confirmar movimento', state: plan.kind === 'unavailable' ? 'failed' : 'pending', actuatorId: plan.actuatorId, engineToken: plan.token } : null,
      error: g.blocked ? `${g.blocked.code} · ${g.blocked.message}` : null, at: Date.now(),
    };
    this.dispatch({ type: 'processing', value: false });
    this.dispatch({ type: 'assistant_message', message });
    if (outcome.status === 'error' && !g.blocked?.code.startsWith('SPATIAL_AGENT_ACTION')) this.notice('agent-error', `Assistente: ${outcome.code}. Nada foi executado.`, 'critical');
    this.setComposerState(g.blocked ? 'ERROR' : 'COMPLETE', g.blocked ? 'Nada foi executado.' : this.options.fixtureDemo ? (g.source === 'fixture' ? 'Resposta de fixture (sem modelo).' : 'Resposta do Muse Spark.') : 'Interpretação fundamentada; valores do motor.');
    // spatial act
    if (g.blocked) { if (g.primary) this.pointAt(g.primary.id, 'blocked', 'assistant', g.blocked.message); else this.hand.release(); }
    else if (g.primary) {
      const state: HandState = plan && plan.kind !== 'unavailable' ? 'awaiting' : g.act === 'select' ? 'select' : g.act === 'inspect' ? 'inspect' : 'point';
      if (g.act === 'select' || g.act === 'inspect') this.setSelectedComponent(g.primary, g.act === 'inspect');
      const res = this.pointAt(g.primary.id, state, 'assistant', res0(plan));
      if (!res.cameraMoved && res.cameraReason === 'user_active') this.setComposerState('COMPLETE', 'Câmara mantida: está a interagir com a vista.');
      if (g.act === 'select' || g.act === 'inspect') { this.renderInspector(); this.renderRail(); }
      if (g.act === 'focus') { const s = this.componentSphere(g.primary.id); if (s) this.director.focusSphere(s, 'assistant', 0.5); }
    } else this.hand.release();
    this.foundry.requestRender();
    return g;
    function res0(p: ReturnType<SpatialWorkspace['planExperiment']> | null): string | null { return p && p.kind !== 'unavailable' ? 'Proposta: precisa da sua aprovação.' : null; }
  }

  /** Offer the extend experiment for a component without going through the model (Simulate tool). */
  offerExperiment(componentId: string | null, _text: string | null): ReturnType<SpatialWorkspace['planExperiment']> {
    const plan = this.planExperiment(componentId ?? '');
    const m: Message = { id: newId('a'), role: 'assistant', text: plan.kind === 'engine_move' ? 'O motor avaliou a proposta; confirme antes de executar.' : plan.kind === 'preview_fixture' ? 'Experiência suportada para o cilindro seleccionado.' : plan.detail, source: 'local', sourceNote: plan.kind === 'preview_fixture' ? 'Demonstração · fixture' : 'Planeador local · motor de engenharia', evidence: plan.actuatorId ? [{ componentId: plan.actuatorId, label: this.registry.get(plan.actuatorId)?.label ?? plan.actuatorId, status: 'resolved' }] : [], proposal: { id: newId('p'), title: plan.title, detail: plan.detail, kind: plan.kind, approveLabel: plan.kind === 'preview_fixture' ? 'Pré-visualizar fixture' : 'Confirmar movimento', state: plan.kind === 'unavailable' ? 'failed' : 'pending', actuatorId: plan.actuatorId, engineToken: plan.token }, error: null, at: Date.now() };
    this.dispatch({ type: 'assistant_message', message: m });
    if (plan.actuatorId) this.pointAt(plan.actuatorId, plan.kind !== 'unavailable' ? 'awaiting' : 'blocked', 'user_tool', plan.kind !== 'unavailable' ? 'Proposta: precisa da sua aprovação.' : plan.detail);
    return plan;
  }

  /** Approve a pending proposal (same path as the button). */
  approveProposal(messageId: string): Promise<void> { return this.approve(messageId); }

  private planExperiment(componentId: string): { kind: 'engine_move' | 'preview_fixture' | 'unavailable'; actuatorId: string | null; title: string; detail: string; token?: string } {
    if (this.options.fixtureDemo) return planExtendExperiment(componentId, this.registry, this.previews);
    return this.planEngineExperiment(componentId);
  }

  private planEngineExperiment(componentId: string): { kind: 'engine_move' | 'unavailable'; actuatorId: string | null; title: string; detail: string; token?: string } {
    const component = this.registry.get(componentId);
    const cylinder = component?.role === 'hydraulic_cylinder' ? component : component ? this.registry.ownerOfPart(component.id) : undefined;
    const actuator = this.options.assembly.actuators.find((item) => item.id === cylinder?.id);
    if (!cylinder || actuator?.kind !== 'hydraulic_cylinder') return { kind: 'unavailable', actuatorId: null, title: 'Sem experiência', detail: 'Seleccione um cilindro hidráulico.' };
    let current: number | undefined;
    try { current = this.engineering.frame().actuators.find((item) => item.actuatorId === actuator.id)?.value; } catch { current = undefined; }
    if (current === undefined || this.playback) return { kind: 'unavailable', actuatorId: actuator.id, title: 'Sem experiência', detail: 'O estado do actuador não está disponível.' };
    const target = Math.min(actuator.stroke.max.value, current + 0.05);
    const preview = this.engineering.preview(actuator.id, target);
    if (!preview.ok) return { kind: 'unavailable', actuatorId: actuator.id, title: 'Movimento bloqueado', detail: `${preview.code} · ${preview.message}` };
    this.notice('engine-error', null);
    return { kind: 'engine_move', actuatorId: actuator.id, title: `Estender ${cylinder.label}`, detail: `Curso ${fmt(current)} → ${fmt(target)} m; duração ${preview.durationS.toFixed(2)} s. O motor validou a trajectória por amostragem; nada mudou.`, token: preview.token };
  }

  private engineExplanation(component: CanonicalComponent | null, clarification: boolean, blocked: boolean): string {
    if (clarification) return 'Indique qual o componente e a operação pretendida.';
    if (blocked) return 'Não foi possível fundamentar a acção no componente seleccionado; nada foi executado.';
    const failure = this.state.notices.find((notice) => notice.id === 'engine-error');
    if (failure) return `Último bloqueio do motor: ${failure.text}`;
    if (!component) return 'Não foi possível identificar um componente canónico para esta pergunta.';
    let actuator: ReturnType<WorkspaceEngineeringSession['frame']>['actuators'][number] | undefined;
    try { actuator = this.engineering.frame().actuators.find((item) => item.actuatorId === component.id); } catch { return 'Quadro do motor indisponível; nenhuma propriedade física foi confirmada.'; }
    if (!actuator) return `${component.label} está identificado na montagem. Propriedades não calculadas pelo motor permanecem desconhecidas.`;
    const force = actuator.forceStatus === 'computed' && actuator.forceN !== null ? `${fmt(actuator.forceN)} N` : 'desconhecida';
    return `${component.label}: valor actual ${fmt(actuator.value)} ${actuator.unit}; força ${force}. O resultado vem do quadro validado do motor.`;
  }

  private async approve(messageId: string): Promise<void> {
    const m = this.state.messages.find((x) => x.id === messageId);
    if (m?.proposal?.state === 'pending' && m.proposal.kind === 'engine_move') {
      if (!m.proposal.engineToken || this.playback) { this.dispatch({ type: 'proposal_state', messageId, state: 'failed' }); return; }
      const result = this.engineering.approve(m.proposal.engineToken);
      if (!result.ok) { this.dispatch({ type: 'proposal_state', messageId, state: 'failed' }); this.notice('engine-error', result.message, 'critical'); return; }
      this.engineProposal = null; this.engineMessageId = messageId; this.poseLabel = 'engine';
      this.approvedRunning = true;
      const completion = new Promise<'completed' | 'cancelled'>((resolve) => { this.engineCompletion = resolve; });
      this.dispatch({ type: 'proposal_state', messageId, state: 'running' });
      this.notice('pose', 'Movimento calculado pelo motor; propriedades físicas desconhecidas continuam desconhecidas.', 'critical');
      if (this.reducedMotion) { this.engineering.advance(this.engineering.state().durationS); if (this.showEngineFrame()) this.finishEngineMessage(); }
      else { this.engineLast = 0; this.runEngine(); }
      this.renderInspector(); await completion; return;
    }
    if (!m?.proposal || m.proposal.state !== 'pending' || m.proposal.kind !== 'preview_fixture') return;
    const actuatorId = m.proposal.actuatorId;
    const preview = actuatorId ? this.previews.find((p) => p.actuatorId === actuatorId) : undefined;
    if (!preview) {
      // fail closed: the planned actuator has no available preview, so nothing ran and nothing is reported as done
      this.dispatch({ type: 'proposal_state', messageId, state: 'failed' });
      this.notice('agent-error', `Sem pré-visualização disponível para «${actuatorId ?? 'desconhecido'}». Nada foi executado.`, 'critical');
      return;
    }
    this.dispatch({ type: 'proposal_state', messageId, state: 'running' });
    this.notice('pose', 'Pré-visualização de fixture: estas poses vêm de um script independente, não do motor de engenharia.', 'critical');
    this.pointAt(preview.actuatorId, 'point', 'user_tool', 'Pré-visualização de fixture aprovada por si.');
    const generation = ++this.playbackGeneration;
    this.approvedRunning = true;
    const outcome = await this.play(preview);
    // only the newest playback may clear the agency; a superseded one returns here after the newer one started
    if (generation === this.playbackGeneration) this.approvedRunning = false;
    if (this.disposed) return;
    if (outcome === 'cancelled') {
      // reset, disposal or a newer preview stopped it: no completion, no final measurements
      this.dispatch({ type: 'proposal_state', messageId, state: 'cancelled' });
      return;
    }
    const first = preview.frames[0]!, last = preview.frames[preview.frames.length - 1]!;
    const meas = (f: typeof first, id: string) => f.measurements.find((x) => x.id === id);
    const a0 = meas(first, 'boom_angle'), a1 = meas(last, 'boom_angle'), h0 = meas(first, 'tip_height'), h1 = meas(last, 'tip_height'), force = meas(last, 'boom_cylinder_force');
    this.dispatch({ type: 'proposal_state', messageId, state: 'done' });
    this.dispatch({ type: 'assistant_message', message: { id: newId('s'), role: 'system', text: `Pré-visualização de fixture concluída. Ângulo da lança ${fmt(a0?.value ?? NaN)} → ${fmt(a1?.value ?? NaN)} rad; altura da ponta ${fmt(h0?.value ?? NaN, 2)} → ${fmt(h1?.value ?? NaN, 2)} m. Força: ${force?.status === 'unknown' ? 'desconhecida' : fmt(force?.value ?? NaN)}. Valores do fixture, não calculados pelo motor.`, source: 'fixture', sourceNote: `Fixture · ${preview.frames[0]!.solver.id}`, evidence: [{ componentId: preview.actuatorId, label: this.registry.get(preview.actuatorId)?.label ?? preview.actuatorId, status: 'resolved' }], proposal: null, error: null, at: Date.now() } });
  }

  /** True while an action the person approved is being shown (the hand says so). */
  private approvedRunning = false;
  /** Incremented for every approved playback; a continuation acts only if it is still the current generation. */
  private playbackGeneration = 0;

  /** Plays fixture frames on their own clock (frame timestamps), never interpolated: each shown pose is one frame. */
  private play(preview: FixturePreview): Promise<'completed' | 'cancelled'> {
    this.playback?.cancel();
    this.poseLabel = 'fixture-preview';
    const frames = preview.frames;
    if (this.reducedMotion) { this.scene.setPoses(framePoses(frames[frames.length - 1]!)); this.renderInspector(); return Promise.resolve('completed'); }
    return new Promise((resolve) => {
      const t0 = performance.now(); let raf = 0; let shown = -1;
      const tick = () => {
        const t = (performance.now() - t0) / 1000;
        let i = shown;
        while (i + 1 < frames.length && frames[i + 1]!.timestampS <= t) i++;
        if (i !== shown && i >= 0) { shown = i; this.foundry.markMotion(); this.scene.setPoses(framePoses(frames[i]!)); }
        if (shown >= frames.length - 1) { this.playback = null; this.renderRail(); resolve('completed'); return; }
        raf = requestAnimationFrame(tick);
      };
      this.playback = { cancel: () => { cancelAnimationFrame(raf); this.playback = null; resolve('cancelled'); } };
      this.renderRail();
      raf = requestAnimationFrame(tick);
    });
  }

  private reject(messageId: string): void {
    const proposal = this.state.messages.find((message) => message.id === messageId)?.proposal;
    if (proposal?.kind === 'engine_move' && proposal.engineToken) this.engineering.reject(proposal.engineToken);
    this.dispatch({ type: 'proposal_state', messageId, state: 'rejected' });
    if (this.hand.state === 'awaiting' || this.hand.state === 'proposal') this.hand.setState('attention', 'Proposta rejeitada. Nada mudou.');
    this.foundry.requestRender();
  }

  /**
   * Presentation view of a joint: the child part stays solid, the parent part keeps only its pin hardware solid
   * (machined, cast bosses, brushed keepers), everything else is ghosted. Existing isolation, no geometry or pose change.
   */
  presentJoint(jointId: string | null): boolean {
    if (!jointId) { this.scene.isolate(null); this.notice('presentation', null); this.renderRail(); return true; }
    const c = this.registry.get(jointId);
    if (!c || c.kind !== 'joint') return false;
    const [parent, child] = c.partIds;
    const hardware = new Set(['machined', 'castDark', 'brushed']);
    this.scene.isolate({ ...c, partIds: [child!] }, (mesh) => mesh.userData.partId === parent && hardware.has(String(mesh.userData.materialKey)));
    this.notice('presentation', `Vista isolada de ${c.id} · só apresentação: geometria e poses inalteradas.`, 'info');
    this.renderRail();
    return true;
  }

  highlightCoverage(): { overlays: number; onGhosted: number } { return this.scene.highlightCoverage(); }

  resetPose(): void {
    this.playback?.cancel();
    if (this.engineMessageId) { this.dispatch({ type: 'proposal_state', messageId: this.engineMessageId, state: 'cancelled' }); this.engineMessageId = null; }
    this.approvedRunning = false; this.engineCompletion?.('cancelled'); this.engineCompletion = null;
    cancelAnimationFrame(this.engineRaf); this.engineRaf = 0; this.engineLast = 0;
    this.engineering.reset(); this.engineProposal = null; this.model.root.visible = true;
    this.poseLabel = 'reference';
    this.notice('pose', null);
    this.notice('engine-error', null); this.notice('engine-restored', null);
    this.showEngineFrame();
    this.renderInspector();
  }

  private previewEngineMove(): void {
    const actuatorId = this.selectedId;
    const input = this.el.inspector!.querySelector<HTMLInputElement>('[data-el="engineTarget"]');
    if (!actuatorId || !input || this.playback) return;
    if (!this.engineering.frame().actuators.some((item) => item.actuatorId === actuatorId)) { this.notice('engine-error', 'O estado do actuador é desconhecido.', 'critical'); return; }
    const target = input.valueAsNumber;
    const result = this.engineering.preview(actuatorId, target);
    if (!result.ok) {
      this.engineProposal = null;
      this.notice('engine-error', `${result.code} · ${result.message}`, 'critical');
      this.renderInspector(); return;
    }
    this.engineProposal = { token: result.token, actuatorId, target, durationS: result.durationS };
    this.notice('engine-error', null);
    this.renderInspector();
  }

  private approveEngineMove(): void {
    const proposal = this.engineProposal;
    if (!proposal || proposal.actuatorId !== this.selectedId || this.playback) return;
    const result = this.engineering.approve(proposal.token); this.engineProposal = null;
    if (!result.ok) { this.notice('engine-error', `${result.code} · ${result.message}`, 'critical'); this.renderInspector(); return; }
    this.poseLabel = 'engine'; this.notice('pose', 'Movimento calculado pelo motor; propriedades físicas desconhecidas continuam desconhecidas.', 'critical');
    if (this.reducedMotion) { this.engineering.advance(this.engineering.state().durationS); this.showEngineFrame(); this.renderInspector(); return; }
    this.engineLast = 0; this.runEngine(); this.renderInspector();
  }

  private showEngineFrame(): boolean {
    let frame: ReturnType<WorkspaceEngineeringSession['frame']>;
    try { frame = this.engineering.frame(); }
    catch {
      this.engineering.pause(); this.model.root.visible = false; this.handHiddenForMissingPose = true; this.hand.release(); this.updateHandOverlay(); this.foundry.studio.updateContactShadow();
      if (this.engineMessageId) { this.state = reduceWorkspace(this.state, { type: 'proposal_state', messageId: this.engineMessageId, state: 'failed' }); this.engineMessageId = null; }
      this.state = reduceWorkspace(this.state, { type: 'notice', notice: { id: 'engine-error', severity: 'critical', text: 'Quadro do motor inválido ou incompatível; pose ocultada.' } });
      this.renderNotices(visibility(this.state)); this.approvedRunning = false;
      this.engineCompletion?.('cancelled'); this.engineCompletion = null; this.foundry.requestRender(); return false;
    }
    this.model.root.visible = frame.parts.length > 0;
    if (frame.parts.length) {
      this.scene.setPoses(frame.parts);
      if (this.handHiddenForMissingPose && this.selectedId) this.hand.attend(this.selectedId, 'select');
      this.handHiddenForMissingPose = false;
    } else { this.handHiddenForMissingPose = true; this.hand.release(); this.updateHandOverlay(); this.foundry.studio.updateContactShadow(); }
    const status = this.el.inspector!.querySelector<HTMLElement>('[data-el="engineStatus"]');
    if (status) {
      const actuator = frame.actuators.find((item) => item.actuatorId === this.selectedId);
      const state = this.engineering.state();
      status.textContent = `Motor · curso actual ${actuator ? `${fmt(actuator.value)} ${actuator.unit}` : 'desconhecido'} · ${state.timeS.toFixed(2)} / ${state.durationS.toFixed(2)} s · ${state.playing ? 'em execução' : 'pausado'}`;
    }
    if (frame.status !== 'ok') {
      this.engineering.pause(); this.notice('engine-error', `${frame.blocked?.code ?? frame.status} · ${frame.blocked?.message ?? 'Quadro sem solução válida.'}`, 'critical');
      if (this.engineMessageId) { this.dispatch({ type: 'proposal_state', messageId: this.engineMessageId, state: 'failed' }); this.engineMessageId = null; }
      this.approvedRunning = false; this.engineCompletion?.('cancelled'); this.engineCompletion = null;
    }
    this.foundry.markMotion(); this.foundry.requestRender();
    return frame.status === 'ok';
  }

  private runEngine(): void {
    if (this.engineRaf || this.disposed) return;
    const tick = (now: number) => {
      this.engineRaf = 0;
      if (this.disposed || !this.engineering.state().playing) return;
      if (this.engineLast) this.engineering.advance(Math.max(0, (now - this.engineLast) / 1000));
      this.engineLast = now; this.showEngineFrame();
      if (this.engineering.state().playing) this.engineRaf = requestAnimationFrame(tick);
      else { this.engineLast = 0; this.finishEngineMessage(); this.renderInspector(); }
    };
    this.engineRaf = requestAnimationFrame(tick);
  }

  private finishEngineMessage(): void {
    if (this.engineMessageId) {
      const messageId = this.engineMessageId; this.engineMessageId = null;
      const actuatorId = this.state.messages.find((message) => message.id === messageId)?.proposal?.actuatorId;
      const actuator = this.engineering.frame().actuators.find((item) => item.actuatorId === actuatorId);
      this.dispatch({ type: 'proposal_state', messageId, state: 'done' });
      this.dispatch({ type: 'assistant_message', message: { id: newId('s'), role: 'system', text: `Movimento calculado concluído. Curso: ${actuator ? `${fmt(actuator.value)} ${actuator.unit}` : 'desconhecido'}. Força: ${actuator?.forceN == null ? 'desconhecida' : `${fmt(actuator.forceN)} N`}.`, source: 'local', sourceNote: 'Motor de engenharia · quadro validado', evidence: actuatorId ? [{ componentId: actuatorId, label: this.registry.get(actuatorId)?.label ?? actuatorId, status: 'resolved' }] : [], proposal: null, error: null, at: Date.now() } });
    }
    this.approvedRunning = false; this.engineCompletion?.('completed'); this.engineCompletion = null;
  }

  private pauseEngine(): void {
    this.engineering.pause(); cancelAnimationFrame(this.engineRaf); this.engineRaf = 0; this.engineLast = 0; this.renderInspector();
  }

  private resumeEngine(): void {
    this.engineering.resume(); this.engineLast = 0; this.runEngine(); this.renderInspector();
  }

  private cancelEngine(): void {
    cancelAnimationFrame(this.engineRaf); this.engineRaf = 0; this.engineLast = 0;
    this.engineering.pause(); this.engineering.cancel(); this.engineProposal = null;
    this.poseLabel = this.engineering.state().durationS === 0 ? 'reference' : 'engine';
    if (this.poseLabel === 'reference') this.notice('pose', null);
    if (this.engineMessageId) { this.dispatch({ type: 'proposal_state', messageId: this.engineMessageId, state: 'cancelled' }); this.engineMessageId = null; }
    this.approvedRunning = false; this.engineCompletion?.('cancelled'); this.engineCompletion = null;
    this.showEngineFrame(); this.renderInspector();
  }

  // --------------------------------------------------------------------------------------------- modes & inputs
  toggleFocus(): void { this.dispatch({ type: this.state.mode === 'focus' ? 'exit_focus' : 'enter_focus' }); if (this.state.mode !== 'focus') this.el.toolFocus!.focus({ preventScroll: true }); }

  escape(): void {
    if (this.director.transitioning) { this.director.cancel(); return; }
    if (this.state.mode !== 'focus' && !this.state.transientId && this.state.mode !== 'conversation' && !this.state.railOpen && this.hand.state !== 'hidden') { this.hand.release(); this.foundry.requestRender(); return; }
    this.dispatch({ type: 'escape' });
  }

  private toggleVoice(): void {
    if (!this.voice) return;
    if (this.voice.status === 'LISTENING') this.voice.stop(); else this.voice.start();
  }

  /** Webcam hand control (existing module). Starts only on an explicit click; while active the assistant never moves the camera. */
  async toggleHandTracking(): Promise<void> {
    if (this.handTracker) { this.handTracker.stop(); this.handTracker = null; this.arbiter.setHandTracking(false); this.el.userHand!.hidden = true; this.renderRail(); return; }
    const video = this.el.video as HTMLVideoElement;
    let last: { x: number; y: number } | null = null;
    const tracker = new WebcamHandTracker({
      video,
      onState: (state: HandInteractionState, message?: string) => { if (this.handTracker === tracker && !this.disposed) this.setComposerState(state === 'ERROR' ? 'ERROR' : 'IDLE', message ?? `Gestos: ${state}`); },
      onLandmarks: (landmarks) => {
        if (this.handTracker !== tracker || this.disposed) return;
        const rect = this.el.stage!.getBoundingClientRect();
        const f = this.handModel.update(landmarks, { left: rect.left, top: rect.top, width: rect.width, height: rect.height });
        const cur = this.el.userHand!;
        if (f.viewportCursor) { cur.hidden = false; cur.style.left = `${f.viewportCursor.x - rect.left}px`; cur.style.top = `${f.viewportCursor.y - rect.top}px`; }
        cur.dataset.state = f.state === 'GRABBING' ? 'grabbing' : f.handVisible ? 'active' : 'lost';
        if (f.pinch && f.viewportCursor) {
          this.arbiter.userInput('user_hand');
          if (last) this.director.nudge((f.viewportCursor.x - last.x) * -0.006, (f.viewportCursor.y - last.y) * 0.004);
          last = { x: f.viewportCursor.x, y: f.viewportCursor.y };
        } else last = null;
      },
      onError: () => {},
    });
    this.handTracker = tracker; this.arbiter.setHandTracking(true); this.renderRail();
    try {
      await tracker.start();
      if (this.handTracker !== tracker || this.disposed) tracker.stop();
    } catch {
      if (this.handTracker === tracker && !this.disposed) { this.handTracker = null; this.arbiter.setHandTracking(false); this.renderRail(); }
    }
  }

  // ------------------------------------------------------------------------------------------------ diagnostics
  stats() {
    let meshes = 0, tris = 0; const mats = new Set<string>();
    this.model.root.traverse((o) => { const m = o as import('three').Mesh; if (m.isMesh && !m.userData.highlightOverlay) { meshes++; const g = m.geometry; tris += (g.index ? g.index.count : g.attributes.position!.count) / 3; mats.add((m.material as import('three').Material).uuid); } });
    return { ...this.foundry.stats(), modelMeshes: meshes, modelTriangles: Math.round(tris), modelMaterials: mats.size, libraryMaterials: this.lib.materials().length, libraryTextures: this.lib.textures().length };
  }

  get poseSource(): string { return this.poseLabel; }
  engineState() { return this.engineering.state(); }
  engineFrame() { return this.engineering.frame(); }
  get currentHand(): HandView | null { return this.lastHand; }
  get insets(): SafeInsets { return this.currentInsets; }
  renderNow(): void { this.foundry.renderNow(); }
  /** For measurements: render while flagged as moving (real-time motion resolution). */
  renderMoving(): void { this.foundry.markMotion(); this.foundry.renderNow(); }
  cameraState() { return { position: this.foundry.camera.position.toArray(), target: this.director.controls.target.toArray(), transitioning: this.director.transitioning, owner: this.arbiter.current }; }
  partPoses(): PartPose[] { return [...this.model.parts.entries()].map(([partId, g]) => ({ partId, translationM: g.position.toArray() as [number, number, number], rotation: g.quaternion.toArray() as [number, number, number, number] })); }
  selection(): CanonicalComponent | null { return this.selectedId ? this.registry.get(this.selectedId) ?? null : null; }

  private disposed = false;

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.engineCompletion?.('cancelled'); this.engineCompletion = null; this.approvedRunning = false;
    cancelAnimationFrame(this.engineRaf); this.engineRaf = 0; this.engineering.dispose();
    clearTimeout(this.transientTimer);
    this.pending?.abort();
    this.playback?.cancel();
    this.insetTween?.kill();
    this.handTracker?.stop();
    this.voice?.stop?.();
    for (const d of this.disposers.splice(0)) d();
    this.director.dispose();
    this.scene.dispose();
    this.model.dispose();
    this.lib.dispose();
    this.foundry.dispose();
    this.root.remove();
  }
}
