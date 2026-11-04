/**
 * UNFOLD unified spatial experience (UX prototype): empty lab → intake → reconstruction → review → transition → lab.
 *
 * Product rules carried by this page:
 *  - The reconstruction comes through a `ReconstructionPort`. Here it is the DEMO port, which never calls Meta and says so
 *    on every screen; the real port is the integration's job (see ACCEPTANCE.md).
 *  - Observed / hypothesis / unknown stay as the reconstruction returned them. A person confirms, corrects or rejects;
 *    an unknown is never turned into a confirmed fact, and a value a person enters is labelled "introduzido por si".
 *  - Human review (gate 1) and engineering validation (gate 2, the engine) are separate and both visible.
 *
 * Query: ?scenario=observation|insufficient|not_identified|failed|unavailable · ?start=review|lab · ?tier=… · ?rm=1 · ?zones=1
 */
import '../../brand.css';
import './experience.css';
import { applyMotionTokens } from '../../motion/tokens';
import { CinemaRuntime, ReferencePoseSource, foundryVisualProvider, type CinemaTier } from '../cinema';
import { EXCAVATOR_ASSEMBLY_V1 } from '../contracts/fixtures/excavator.assembly.v1';
import { EXCAVATOR_ENTITY_KINDS, type ExcavatorEntityKind } from '../reconstruction/contracts';
import { convexHull } from '../visual-foundry/geometry';
import { referencePoses } from '../visual-foundry/poses';
import { renderDrawing, type DrawingResult } from './drawing';
import { initialFlow, PHASE_HEADLINE, reduceFlow, type FlowAction, type FlowState } from './flow';
import { checkFile, checkText, DEMO_SCENARIO_LABEL, DEMO_SCENARIOS, DemoReconstructionPort, MAX_INPUT_BYTES, TEXT_LIMITS, type DemoScenario, type InputKind, type IntakeInput, type ReconstructionPort } from './intake';
import { DRAWING_REFERENCE, ENTITY_PARTS } from './reconstruction-fixture';
import { EXPIRED_MESSAGE, gatewayPanel, missingHtml, missingLines, restartActionsHtml, type GatewayMessage } from './gateway-view';
import type { ComposerMode, ExperienceApi, ExperienceOptions } from './integration';
import {
  CATEGORY_LABEL, ENGINE_GATE_LABEL, initialReview, labCategory, partCategories, PROPERTY_LABEL, propertyState, readiness, reduceReview, summarize,
  type EngineGate, type ReviewAction, type ReviewItem, type ReviewState,
} from './review';
import { buildSheet3d, cameraViews } from './stage-moves';
import { applyDirection, type LiveryName } from './stage-direction';
import { TRANSITION_TOTAL, transitionAt } from './transition';

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const STATUS_LABEL = { observed: 'observado', hypothesis: 'hipótese', unknown: 'desconhecido' } as const;
const KIND_LABEL: Record<ExcavatorEntityKind, string> = { chassis: 'chassis', boom: 'lança', stick: 'braço', bucket: 'caçamba', joint: 'articulação', cylinder: 'cilindro hidráulico', track: 'rasto', counterweight: 'contrapeso', house: 'corpo superior', unknown: 'outra peça' };
const INPUT_LABEL: Record<InputKind, string> = { image: 'Fotografia', drawing: 'Desenho técnico', text: 'Texto' };
const kb = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} kB`);

export async function mountExperience(app: HTMLElement, options: ExperienceOptions = {}): Promise<ExperienceApi> {
  applyMotionTokens();
  const embedded = options.embedded;
  if (embedded) app = embedded.host;
  const q = new URLSearchParams(location.search);
  const reducedMotion = q.has('rm') ? q.get('rm') === '1' : matchMedia('(prefers-reduced-motion: reduce)').matches;
  const port: ReconstructionPort = options.port ?? new DemoReconstructionPort((q.get('scenario') as DemoScenario | null) ?? 'observation', Number(q.get('delay') ?? 1200));
  const assembly = EXCAVATOR_ASSEMBLY_V1;
  let flow: FlowState = initialFlow();
  let review: ReviewState | null = null;
  // with a real reconstruction the primary source is a photograph; the demonstration prototype keeps its drawing
  let inputKind: InputKind = options.handoff ? 'image' : 'drawing';
  let editing: string | null = null;
  let abort: AbortController | null = null;
  let engine: EngineGate = { status: 'not_run' };
  // set only when the real laboratory is plugged in (options.lab); the prototype lab is used otherwise
  let candidate: unknown = null;
  let gwMessage: GatewayMessage = null;
  let gwBusy = false;
  /** Two steps in the review column when a handoff is plugged in: 1 = decide the entities, 2 = what the server asks. */
  let gwStep = false;
  let expiryTimer = 0;

  app.innerHTML = `
    <div class="ux-root u-root" data-theme="dark" data-phase="empty" data-reduced-motion="${reducedMotion}" data-integrated="${Boolean(options.lab)}" data-embedded="${Boolean(embedded)}">
      <div class="ux-stage" id="ux-stage" aria-hidden="true"></div>
      <div class="ux-workspace" id="ux-workspace" hidden></div>
      <div class="ux-chips" id="ux-chips" aria-hidden="true"></div>
      <header class="ux-brand"><img src="/design-system/logos/unfold-lockup-on-dark.svg" alt="UNFOLD"><span class="u-label" id="ux-context">laboratório vazio</span></header>
      ${port.mode === 'demo' ? `<p class="ux-demo u-label" id="ux-demo" role="note"><span class="ux-demo-long">demonstração · nenhuma chamada à Meta · os resultados não dependem do ficheiro que escolher</span><span class="ux-demo-short">demonstração · sem chamada à Meta · resultado não depende do ficheiro</span></p>` : ''}
      <main class="ux-main">
        <section class="ux-intake" id="ux-intake" aria-labelledby="ux-intake-title"></section>
        <section class="ux-recon" id="ux-recon" aria-label="Revisão da reconstrução" hidden>
          <div class="ux-source" id="ux-source"></div>
          <div class="ux-dock">
            <aside class="ux-side" id="ux-side" aria-label="Estado da revisão"></aside>
            <div class="ux-review" id="ux-review"></div>
            <div class="ux-go"><button class="u-btn u-btn--primary" id="ux-enter" type="button">Abrir no laboratório</button><p class="u-label" id="ux-enter-note" aria-live="polite"></p></div>
          </div>
        </section>
        <section class="ux-lab" id="ux-lab" aria-label="Laboratório" hidden>
          <div class="ux-lab-top"><ol class="ux-gates" id="ux-lab-gates" aria-label="Estado da máquina"></ol><aside class="ux-ops" id="ux-ops" aria-label="O que pode fazer"></aside></div>
          <button class="ux-pip" id="ux-pip" type="button" aria-label="Voltar ao desenho original e à revisão"><img id="ux-pip-img" alt=""><span class="u-label">desenho original · rever</span></button>
          <nav class="ux-lab-tools" aria-label="Câmara"><button class="u-btn u-btn--outline" id="ux-hero" type="button">Plano herói</button><button class="u-btn u-btn--outline" id="ux-restart" type="button">Nova máquina</button></nav>
          <p class="ux-caption" id="ux-caption" role="status" aria-live="polite">Clique numa peça para ver o que se sabe dela.</p>
          ${q.get('zones') === '1' ? zonesOverlay() : ''}
        </section>
      </main>
      <p class="ux-loading u-label" id="ux-loading" role="status">a preparar o palco…</p>
    </div>`;
  const $ = <T extends HTMLElement>(id: string) => app.querySelector<T>(`#${id}`)!;
  const root = app.querySelector<HTMLElement>('.ux-root')!;

  // ------------------------------------------------------------------------------------------ stage (empty lab first)
  // Embedded: the host owns the stage. These stand-ins keep every call below valid without a second renderer.
  const inertRuntime = { suspend() {}, resume() {}, screenBox: () => null, controls: { addEventListener() {}, dispatchEvent() {} }, stage: { setMachineVisible() {}, machineVisible: false }, visuals: { registry: undefined }, director: { release() {} } } as unknown as CinemaRuntime;
  const drawing: DrawingResult = embedded ? ({ dataUrl: '', regions: new Map(), projection: { px: [1, 1] } } as unknown as DrawingResult) : renderDrawing(assembly);
  ($('ux-pip-img') as HTMLImageElement).src = drawing.dataUrl;
  const runtime = embedded ? inertRuntime : await CinemaRuntime.create({
    host: $('ux-stage'), assembly, provider: foundryVisualProvider(), reducedMotion, tier: (q.get('tier') as CinemaTier | null),
    poseSource: new ReferencePoseSource(assembly.id, referencePoses().poses), onInspect: (id) => inspect(id),
  });
  const direction = embedded ? ({ setMachineGhost() {}, setReveal() {} } as unknown as ReturnType<typeof applyDirection>) : applyDirection(runtime, (q.get('livery') as LiveryName | null) ?? 'graphite');
  runtime.director.release();
  const sheet3d = embedded ? ({ set() {} } as unknown as ReturnType<typeof buildSheet3d>) : buildSheet3d(runtime, drawing);
  const views = embedded ? ({ blend() {} } as unknown as ReturnType<typeof cameraViews>) : cameraViews(runtime, drawing);
  $('ux-loading').hidden = true;
  const showMachine = (on: boolean) => { runtime.stage.setMachineVisible(on); runtime.controls.dispatchEvent({ type: 'change' }); };
  // the empty lab: stage, light and floor, no machine
  showMachine(false); sheet3d.set(0, 0); views.blend(1);

  // ------------------------------------------------------------------------------------------ flow
  let tick = 0;
  const dispatch = (a: FlowAction) => {
    const before = flow.phase;
    flow = reduceFlow(flow, a);
    if (flow.phase === 'review' && before !== 'review' && before !== 'lab' && before !== 'transition' && flow.observation) review = initialReview(flow.observation);
    if (flow.phase === 'empty' || flow.phase === 'selected') review = null;
    render();
  };
  async function submit(at = Date.now()) {
    if (!flow.input) return;
    abort?.abort(); abort = new AbortController(); const mine = abort;
    clearInterval(tick); tick = window.setInterval(() => { if (flow.phase === 'waiting') renderIntake(); }, 1000);
    try {
      const outcome = await port.submit(flow.input, mine.signal);
      if (mine === abort) dispatch({ type: 'outcome', outcome });
    } catch (e) {
      if ((e as DOMException).name !== 'AbortError' && mine === abort) dispatch({ type: 'outcome', outcome: { kind: 'failed', code: 'NETWORK', message: 'Não foi possível contactar o servidor. Verifique a ligação e tente de novo.', retryable: true } });
    } finally { if (mine === abort) clearInterval(tick); }
    void at;
  }

  function render() {
    root.dataset.phase = flow.phase;
    const intake = ['empty', 'selected', 'waiting', 'not_identified', 'failed', 'unavailable'].includes(flow.phase);
    $('ux-intake').hidden = !intake;
    $('ux-recon').hidden = flow.phase !== 'review';
    $('ux-lab').hidden = flow.phase !== 'lab';
    $('ux-context').textContent = intake ? 'laboratório vazio' : flow.phase === 'review' ? `revisão · ${flow.observation?.source.reference ?? ''}` : 'laboratório · revisão local, não gravada';
    if (intake) { renderIntake(); showMachine(false); sheet3d.set(0, 0); runtime.resume(); }
    if (flow.phase === 'review') { renderReview(); runtime.suspend(); }
    if (flow.phase === 'lab') renderLab();
    placeChips();
    if (embedded) {
      const mode: ComposerMode = intake ? (flow.phase === 'waiting' ? 'busy' : 'intake') : flow.phase === 'review' ? 'review' : 'lab';
      embedded.setComposer(mode, { text: (t) => takeText(t), file: (f) => void takeFile(f) });
    }
  }
  /** The reference machine, openly an example. Embedded, the host puts it on its own stage and the flow goes straight to the lab state. */
  function openExample() { if (!options.example) return; options.example.run(); if (embedded) { cancelAnimationFrame(raf); dispatch({ type: 'enter_example' }); } }
  function takeText(text: string) { const p = checkText(text); if (p) dispatch({ type: 'reject_input', problem: p }); else selectInput({ kind: 'text', text: text.trim() }); }

  // ------------------------------------------------------------------------------------------ intake
  function renderIntake() {
    const p = flow.phase;
    const el = $('ux-intake');
    const head = `<h1 class="ux-h1" id="ux-intake-title">${esc(PHASE_HEADLINE[p])}</h1>`;
    const inputPreview = () => {
      const i = flow.input; if (!i) return '';
      if (i.kind === 'text') return `<figure class="ux-preview ux-preview--text"><blockquote>${esc(i.text.slice(0, 280))}${i.text.length > 280 ? '…' : ''}</blockquote><figcaption class="u-label">texto · ${i.text.trim().length} caracteres</figcaption></figure>`;
      return `<figure class="ux-preview"><img src="${esc(i.dataUrl)}" alt="Pré-visualização de ${esc(i.name)}"><figcaption class="u-label"><span class="ux-name">${esc(i.name)}</span> · ${INPUT_LABEL[i.kind].toLowerCase()} · ${kb(i.size)}</figcaption></figure>`;
    };
    if (p === 'waiting') {
      const s = flow.startedAt ? Math.max(0, Math.round((Date.now() - flow.startedAt) / 1000)) : 0;
      el.innerHTML = `${head}<p class="u-small">${port.mode === 'demo' ? 'Demonstração: o resultado chega sem chamar o modelo.' : 'O modelo está a observar a sua fonte. Pode demorar até um minuto; nada fica guardado até rever.'}</p>
        ${inputPreview()}<p class="ux-wait u-data" role="status" aria-live="polite">${port.mode === 'demo' ? 'a preparar a demonstração' : 'a aguardar o modelo'} · ${s} s</p>
        <div class="ux-row"><button class="u-btn u-btn--outline" type="button" data-flow="cancel">Cancelar</button></div>`;
      return;
    }
    if (p === 'not_identified' || p === 'failed' || p === 'unavailable') {
      const tips = p === 'not_identified'
        ? `<ul class="ux-tips"><li>Use uma fotografia lateral com a máquina inteira e bem iluminada.</li><li>Ou um desenho técnico com o alçado lateral.</li><li>Ou descreva a máquina por texto: tipo, partes e medidas.</li></ul>` : '';
      const code = p === 'failed' && flow.failure ? `<p class="u-label">código: <span class="u-data">${esc(flow.failure.code)}</span></p>` : '';
      const retry = (p === 'not_identified' || (p === 'failed' && flow.failure?.retryable)) ? `<button class="u-btn u-btn--ink" type="button" data-flow="retry">Tentar de novo</button>` : '';
      el.innerHTML = `${head}<p class="ux-problem" role="alert">${esc(flow.message ?? '')}</p>${code}${tips}${inputPreview()}
        <div class="ux-row">${retry}<button class="u-btn u-btn--outline" type="button" data-flow="restart">Escolher outra fonte</button></div>`;
      return;
    }
    const kinds = (['image', 'drawing', 'text'] as InputKind[]).map((k) => `<button type="button" role="radio" aria-checked="${inputKind === k}" data-kind="${k}">${INPUT_LABEL[k]}</button>`).join('');
    const body = inputKind === 'text'
      ? `<label class="ux-field"><span class="u-label">descrição</span><textarea id="ux-text" rows="4" maxlength="${TEXT_LIMITS.max}" placeholder="Ex.: escavadora de rastos de 20 t, lança de 5,4 m, braço de 2,85 m, caçamba de 1,1 m de largura.">${flow.input?.kind === 'text' ? esc(flow.input.text) : ''}</textarea><span class="u-label" id="ux-count">${flow.input?.kind === 'text' ? flow.input.text.length : 0} / ${TEXT_LIMITS.max}</span></label>
         <div class="ux-row"><button class="u-btn u-btn--outline" type="button" id="ux-use-text">Usar este texto</button></div>`
      : `<label class="ux-drop" id="ux-drop"><input id="ux-file" type="file" accept="image/png,image/jpeg,image/webp"><span class="ux-drop-main">Arraste ${inputKind === 'drawing' ? 'o desenho' : 'a fotografia'} para aqui ou <u>escolha um ficheiro</u></span><span class="u-label">PNG, JPEG ou WebP · até ${MAX_INPUT_BYTES / 1e6} MB · até 16 megapixéis</span></label>`;
    el.innerHTML = `${head}<p class="u-small">Importe uma fotografia, um desenho técnico ou descreva a máquina. A IA observa; você confirma o que é verdade.</p>
      <div class="ux-seg" role="radiogroup" aria-label="Tipo de fonte">${kinds}</div>
      ${flow.input ? inputPreview() + `<div class="ux-row"><button class="u-btn u-btn--outline" type="button" data-flow="clear">Remover</button></div>` : body}
      ${flow.problem ? `<p class="ux-problem" role="alert">${esc(flow.problem.message)}</p>` : ''}
      ${flow.message ? `<p class="u-small" role="status">${esc(flow.message)}</p>` : ''}
      <div class="ux-row ux-row--end">${port.mode === 'demo' ? `<label class="ux-scenario u-label">cenário de demonstração <select id="ux-scenario">${DEMO_SCENARIOS.map((sc) => `<option value="${sc}" ${(port as DemoReconstructionPort).scenario === sc ? 'selected' : ''}>${esc(DEMO_SCENARIO_LABEL[sc])}</option>`).join('')}</select></label>` : ''}
        ${options.example ? '<button class="u-btn u-btn--outline" type="button" data-example="open">Abrir exemplo</button>' : ''}
        <button class="u-btn u-btn--primary" type="button" data-flow="submit" ${flow.phase === 'selected' ? '' : 'disabled'}>Reconstruir</button></div>
      ${options.example ? '<p class="u-label ux-example-note">O exemplo é uma máquina sintética de referência: não vem de nenhuma fonte sua.</p>' : ''}`;
  }
  async function takeFile(file: File) {
    const problem = checkFile(file);
    if (problem) { dispatch({ type: 'reject_input', problem }); return; }
    const dataUrl = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
    dispatch({ type: 'select', input: { kind: inputKind === 'text' ? 'drawing' : inputKind, name: file.name, size: file.size, mime: file.type, dataUrl } });
  }
  const selectInput = (input: IntakeInput) => dispatch({ type: 'select', input });

  // ------------------------------------------------------------------------------------------ review
  const regionsFor = (id: string) => {
    if (id === 'e_counterweight') { const r = drawing.regions.get('upper_body') ?? []; const xs = r.map((p) => p[0]); const maxX = Math.max(...xs); return r.filter((p) => p[0] > maxX - (maxX - Math.min(...xs)) * 0.3); }
    return (ENTITY_PARTS[id] ?? []).flatMap((p) => drawing.regions.get(p) ?? []);
  };
  /** Convex hull of each entity's parts on the sheet, grown 14 px; the status is carried by the stroke shape. */
  function regionsSvg(rv: ReviewState): string {
    return rv.items.map((item) => {
      const pts = regionsFor(item.id); if (pts.length < 3) return '';
      const hull = convexHull(pts);
      const cx = hull.reduce((a, p) => a + p[0], 0) / hull.length, cy = hull.reduce((a, p) => a + p[1], 0) / hull.length;
      const grown = hull.map(([x, y]) => { const d = Math.hypot(x - cx, y - cy) || 1; return [x + ((x - cx) / d) * 14, y + ((y - cy) / d) * 14] as [number, number]; });
      const top = grown.reduce((a, p) => (p[1] < a[1] ? p : a), grown[0]!);
      const cat = labCategory(item);
      const word = cat === 'confirmed' ? 'confirmado' : cat === 'corrected' ? 'corrigido' : cat === 'rejected' ? 'rejeitado' : STATUS_LABEL[item.status];
      return `<g class="ux-region" data-status="${item.status}" data-cat="${cat}" data-focus="${rv.focusId === item.id}" data-id="${esc(item.id)}"><polygon points="${grown.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ')}"/><text x="${top[0].toFixed(1)}" y="${(top[1] - 12).toFixed(1)}" text-anchor="middle">${esc(item.correction?.label ?? item.label)} · ${esc(word)}</text></g>`;
    }).join('');
  }
  function renderReview() {
    if (!review || !flow.observation) return;
    const onFixtureDrawing = flow.observation.source.reference === DRAWING_REFERENCE;
    const src = $('ux-source');
    if (onFixtureDrawing) {
      const vb = `0 0 ${drawing.projection.px[0]} ${drawing.projection.px[1]}`;
      src.innerHTML = `<figure class="ux-sheet" data-theme="light"><img src="${drawing.dataUrl}" alt="Alçado lateral da escavadora"><svg viewBox="${vb}" role="img" aria-label="Regiões observadas no desenho">${regionsSvg(review)}</svg></figure>
        <p class="ux-sheet-note u-label">${port.mode === 'demo' ? 'desenho e regiões de demonstração (gerados a partir do modelo canónico), não do seu ficheiro' : `fonte: ${esc(flow.observation.source.reference)}`}</p>`;
    } else {
      const i = flow.input;
      src.innerHTML = `<figure class="ux-sheet ux-sheet--source">${i && i.kind !== 'text' ? `<img src="${esc(i.dataUrl)}" alt="A sua fonte: ${esc(i.name)}" class="ux-contain">` : `<blockquote class="ux-quote">${esc(i?.kind === 'text' ? i.text : '')}</blockquote>`}</figure>
        <p class="ux-sheet-note u-label">a localização das regiões não está disponível para esta fonte${port.mode === 'demo' ? ' · resultado de demonstração, não do seu ficheiro' : ''}</p>`;
    }
    options.handoff?.sync(review);
    clearTimeout(expiryTimer);
    if (options.handoff?.expired?.() && !gwBusy) gwMessage = EXPIRED_MESSAGE;
    else { const at = options.handoff?.expiresAt?.(); if (at) expiryTimer = window.setTimeout(() => { if (flow.phase === 'review') renderReview(); }, Math.max(0, at - Date.now()) + 25); }
    if (readiness(review).status !== 'ready_for_engine') gwStep = false;
    root.dataset.step = gwStep && options.handoff ? 'server' : 'entities';
    $('ux-side').innerHTML = gates(review, engine) + counts(review) + unknownsBlock(review);
    const item = review.items.find((i) => i.id === review!.focusId);
    $('ux-review').innerHTML = gwStep && options.handoff ? `<article class="ux-card ux-gw-card">${gatewayPanel(options.handoff, review, gwMessage, gwBusy)}</article>` : item ? reviewCard(item, review, editing === item.id) : '';
    refreshEnter();
  }
  /** The primary action and its note. With a handoff, the server's confirmations are part of "ready", never assumed. */
  function refreshEnter() {
    if (!review) return;
    if (options.handoff?.expired?.()) {
      ($('ux-enter') as HTMLButtonElement).disabled = true;
      $('ux-enter-note').innerHTML = `A sessão do servidor expirou: a revisão já não pode ser enviada.${restartActionsHtml()}`;
      return;
    }
    const r = readiness(review);
    const blockers = options.handoff ? options.handoff.blockers() : [];
    const stepOne = Boolean(options.handoff) && !gwStep;
    const ready = r.status === 'ready_for_engine' && (stepOne || blockers.length === 0) && !gwBusy;
    $('ux-enter').textContent = stepOne ? 'Continuar' : 'Abrir no laboratório';
    ($('ux-enter') as HTMLButtonElement).disabled = !ready;
    $('ux-enter').setAttribute('aria-busy', String(gwBusy));
    const missing = app.querySelector('#ux-gw-missing'); if (missing && options.handoff) missing.innerHTML = missingHtml(missingLines(options.handoff));
    $('ux-enter-note').innerHTML = gwBusy ? 'a enviar a revisão ao servidor e a pedir a validação ao motor…'
      : r.status === 'ready_for_engine'
        ? (stepOne ? 'As entidades estão decididas. Falta o que o servidor pede antes de abrir o laboratório.' : blockers.length ? `Falta responder ao servidor: ${blockers.length} ${blockers.length === 1 ? 'ponto' : 'pontos'}.` : options.handoff ? 'Tudo respondido. O servidor valida o contrato e o motor tenta resolver a pose de referência.' : 'A sua revisão está completa. O motor valida a montagem no laboratório.')
        : r.status === 'review_pending' ? `Decida ${r.pending} hipótese${r.pending === 1 ? '' : 's'} antes de continuar.`
          : `Dados insuficientes para uma montagem: falta ${esc(r.missing.join(', '))}.${review.items.some((i) => i.status === 'unknown' && i.decision === 'pending') ? ' Se vê essa peça na fonte, pode corrigir a entidade desconhecida; senão, importe outra fonte.' : ''}<br><button class="ux-link" type="button" data-flow="restart">Importar outra fonte</button>`;
  }
  const reviewDispatch = (a: ReviewAction) => { if (!review) return; review = reduceReview(review, a); gwMessage = null; renderReview(); };

  /** Send the review, then open the lab only if both gates allow it. */
  async function openLab() {
    if (!review || !options.handoff || gwBusy) return;
    gwBusy = true; gwMessage = { tone: 'status', lines: ['a enviar a revisão…'] }; renderReview();
    const result = await options.handoff.submit();
    gwBusy = false;
    switch (result.kind) {
      case 'ready': engine = result.engine; candidate = result.candidate; gwMessage = null; renderReview(); enterLab(true); return;
      case 'engine_blocked': engine = result.engine; gwMessage = { tone: 'alert', lines: ['O contrato é válido, mas o motor não consegue resolver esta montagem. O laboratório fica fechado.', ...result.engine.reasons] }; break;
      case 'blocked': gwMessage = { tone: 'alert', lines: ['O servidor bloqueou a revisão:', ...result.reasons] }; break;
      case 'not_adoptable': gwMessage = { tone: 'alert', lines: ['A montagem devolvida não passou as verificações locais e foi descartada:', ...result.reasons] }; break;
      case 'expired': gwMessage = EXPIRED_MESSAGE; break;
      case 'failed': gwMessage = { tone: 'alert', lines: [result.message] }; break;
      case 'ignored': gwMessage = null; break;
    }
    renderReview();
  }

  // inputs of the server confirmations: update the handoff and the primary action without re-rendering the form (keeps focus)
  const onGateway = (t: HTMLElement) => {
    const h = options.handoff; if (!h) return;
    if (t.id === 'gw-reviewer') h.setHuman({ reviewerId: (t as HTMLInputElement).value });
    else if (t.id === 'gw-family') h.setHuman({ familyConfirmed: (t as HTMLInputElement).checked });
    else if (t.id === 'gw-bucket') h.setHuman({ bucketConfirmed: (t as HTMLInputElement).checked });
    else if (t.id === 'gw-width') { const v = (t as HTMLInputElement).valueAsNumber; h.setHuman({ bucketWidthM: Number.isFinite(v) ? v : null }); }
    else if (t.id === 'gw-basis') h.setHuman({ widthBasis: (t as HTMLInputElement).value });
    else return;
    gwMessage = null; refreshEnter();
  };

  // ------------------------------------------------------------------------------------------ transition + lab
  let raf = 0;
  let labMounted = false;
  /** Hand the screen to the real workspace: the cinematic stage stops rendering and is hidden underneath it. */
  function mountLab() {
    if (!options.lab || labMounted || candidate === null) return;
    if (!embedded) { runtime.suspend(); $('ux-stage').style.visibility = 'hidden'; $('ux-workspace').hidden = false; }
    options.lab.mount($('ux-workspace'), candidate, { gates: gateText(review!, engine), back: () => queueMicrotask(backToReview), restart: () => queueMicrotask(restartAll) }); labMounted = true;
  }
  function leaveLab() {
    if (labMounted) { options.lab?.unmount(); labMounted = false; }
    if (!embedded) { $('ux-workspace').hidden = true; $('ux-stage').style.visibility = ''; }
  }
  function resetIntegration() { clearTimeout(expiryTimer); options.example?.close?.(); options.handoff?.reset(); engine = { status: 'not_run' }; candidate = null; gwMessage = null; gwBusy = false; gwStep = false; }
  function enterLab(animated = true) {
    if (!review || readiness(review).status !== 'ready_for_engine') return;
    dispatch({ type: 'open_lab' });
    // embedded: the machine rises on the workspace's own stage, so there is no second stage to animate
    if (embedded) { dispatch({ type: 'lab_ready' }); mountLab(); return; }
    $('ux-recon').hidden = true; runtime.resume(); showMachine(true);
    const cats = partCategories(review, ENTITY_PARTS);
    direction.setMachineGhost([...cats].filter(([, c]) => c === 'rejected' || c === 'unknown').map(([p]) => p));
    const t0 = performance.now();
    const step = () => {
      const f = transitionAt((performance.now() - t0) / 1000, reducedMotion || !animated);
      sheet3d.set(f.sheetAngle, f.sheetOpacity); direction.setReveal(f.reveal >= 1 ? null : f.reveal); views.blend(f.camera);
      root.style.setProperty('--ux-annotations', String(f.annotations));
      if (!f.done) { raf = requestAnimationFrame(step); return; }
      sheet3d.set(Math.PI / 2, 0.035);
      dispatch({ type: 'lab_ready' });
      mountLab();
    };
    step();
  }
  function renderLab() {
    if (!review) return;
    $('ux-lab-gates').innerHTML = gateItems(review, engine);
    $('ux-ops').innerHTML = `<h2 class="u-label">o que pode fazer</h2><ul>
      <li data-ok="true"><b>Inspeccionar peças</b><span>clique numa peça</span></li>
      <li data-ok="true"><b>Comparar com o desenho</b><span>miniatura em baixo à direita</span></li>
      <li data-ok="true"><b>Perguntar ao assistente</b><span>no espaço de trabalho, com a Digital Hand</span></li>
      <li data-ok="false"><b>Simular movimentos</b><span>depois da validação de engenharia</span></li>
      <li data-ok="false"><b>Alterar a máquina</b><span>só por proposta revista e autorizada</span></li></ul>`;
    placeChips();
  }
  function placeChips() {
    if (flow.phase !== 'lab' || !review) { $('ux-chips').innerHTML = ''; return; }
    const marks = review.items.filter((i) => ['unknown', 'rejected'].includes(labCategory(i)));
    const placed: Array<{ x: number; y: number }> = [];
    $('ux-chips').innerHTML = marks.map((i) => {
      const part = i.id === 'e_counterweight' ? 'upper_body' : (ENTITY_PARTS[i.id] ?? [])[0]; const b = part ? runtime.screenBox(part) : null; if (!b) return '';
      const cat = labCategory(i);
      // keep chips off the right-hand column (gates and operations) on wide screens
      const right = innerWidth > 760 ? Math.min(innerWidth * 0.34, 300) + 48 + 140 : 140;
      const x = Math.min(Math.max(b.x + b.w / (i.id === 'e_counterweight' ? 1.25 : 2), 140), innerWidth - right); let y = Math.max(b.y + b.h / 2, 96);
      while (placed.some((p) => Math.abs(p.x - x) < 240 && Math.abs(p.y - y) < 34)) y += 36;
      placed.push({ x, y });
      return `<span class="ux-chip" data-cat="${cat}" style="left:${x}px;top:${y}px">${esc(i.label)} · ${esc(CATEGORY_LABEL[cat])}</span>`;
    }).join('');
  }
  function inspect(partId: string | null) {
    if (flow.phase !== 'lab' || !review) return;
    if (!partId) { $('ux-caption').textContent = 'Clique numa peça para ver o que se sabe dela.'; return; }
    const c = partCategories(review, ENTITY_PARTS).get(partId);
    const entry = runtime.visuals.registry?.ownerOfPart?.(partId);
    $('ux-caption').innerHTML = `<b>${esc(entry?.label ?? partId)}</b> <span class="u-label">${esc(c ? CATEGORY_LABEL[c] : 'sem observação na reconstrução')} · forma de demonstração (modelo canónico)</span>`;
  }

  // ------------------------------------------------------------------------------------------ events
  app.addEventListener('click', (e) => {
    const t = e.target as Element;
    if (t.closest('[data-example]') && options.example) { openExample(); return; }
    const gw = t.closest<HTMLElement>('[data-gw]');
    if (gw && options.handoff && review) {
      const h = options.handoff;
      if (gw.dataset.gw === 'extra') {
        const decision = gw.dataset.decision as 'confirm' | 'reject';
        const current = h.extras().find((x) => x.key === gw.dataset.key)?.decision;
        h.decideExtra(gw.dataset.key!, current === decision ? undefined : decision);
      } else if (gw.dataset.gw === 'extra-all') {
        // an explicit, bulk choice by the person, applied only to what is still undecided; a request can never be confirmed
        for (const x of h.extras()) if (x.decision === undefined && !(x.kind === 'request' && gw.dataset.decision === 'confirm')) h.decideExtra(x.key, gw.dataset.decision as 'confirm' | 'reject');
      } else if (gw.dataset.gw === 'back') gwStep = false;
      gwMessage = null; renderReview(); return;
    }
    const flowBtn = t.closest<HTMLElement>('[data-flow]');
    if (flowBtn) {
      const f = flowBtn.dataset.flow!;
      if (f === 'submit') { dispatch({ type: 'submit', at: Date.now() }); void submit(); }
      else if (f === 'cancel') { abort?.abort(); abort = null; clearInterval(tick); dispatch({ type: 'cancel' }); }
      else if (f === 'retry') { dispatch({ type: 'retry', at: Date.now() }); void submit(); }
      else if (f === 'clear') dispatch({ type: 'clear' });
      else if (f === 'restart') { cancelAnimationFrame(raf); leaveLab(); resetIntegration(); direction.setMachineGhost([]); views.blend(1); dispatch({ type: 'restart' }); }
      return;
    }
    const kind = t.closest<HTMLElement>('[data-kind]');
    if (kind) { inputKind = kind.dataset.kind as InputKind; if (flow.phase === 'selected') dispatch({ type: 'clear' }); else renderIntake(); return; }
    if (t.closest('#ux-use-text')) { const v = ($('ux-text') as HTMLTextAreaElement).value; const p = checkText(v); if (p) dispatch({ type: 'reject_input', problem: p }); else selectInput({ kind: 'text', text: v.trim() }); return; }
    const r = t.closest<HTMLElement | SVGElement>('[data-review], .ux-region');
    if (r && review) {
      const d = (r as HTMLElement).dataset; const id = d.id!;
      if (d.review === 'confirm') reviewDispatch({ type: 'decide', id, decision: 'confirmed' });
      else if (d.review === 'reject') reviewDispatch({ type: 'decide', id, decision: 'rejected' });
      else if (d.review === 'undo') { editing = null; reviewDispatch({ type: 'decide', id, decision: 'pending' }); }
      else if (d.review === 'next') reviewDispatch({ type: 'next' });
      else if (d.review === 'correct') { editing = id; renderReview(); (app.querySelector('#ux-fix-label') as HTMLInputElement | null)?.focus(); }
      else if (d.review === 'cancel-correct') { editing = null; renderReview(); }
      else if (d.review === 'save-correct') { const kindSel = app.querySelector<HTMLSelectElement>('#ux-fix-kind')!; const label = app.querySelector<HTMLInputElement>('#ux-fix-label')!; editing = null; reviewDispatch({ type: 'correct', id, correction: { kind: kindSel.value as ExcavatorEntityKind, label: label.value } }); }
      else if (d.review === 'save-property') { const input = app.querySelector<HTMLInputElement>(`[data-prop-input="${CSS.escape(d.name!)}"]`)!; reviewDispatch({ type: 'enter_property', id, name: d.name!, value: input.value }); }
      else if (d.review === 'clear-property') reviewDispatch({ type: 'enter_property', id, name: d.name!, value: null });
      else if (!d.review || r.classList.contains('ux-region')) reviewDispatch({ type: 'focus', id });
    }
  });
  app.addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    onGateway(t);
    if (t.id === 'ux-file') { const f = (t as HTMLInputElement).files?.[0]; if (f) void takeFile(f); }
    if (t.id === 'ux-scenario' && port instanceof DemoReconstructionPort) port.scenario = (t as HTMLSelectElement).value as DemoScenario;
  });
  app.addEventListener('input', (e) => { const t = e.target as HTMLTextAreaElement; onGateway(t); if (t.id === 'ux-text') $('ux-count').textContent = `${t.value.length} / ${TEXT_LIMITS.max}`; });
  app.addEventListener('dragover', (e) => { if ((e.target as Element).closest('#ux-drop')) { e.preventDefault(); $('ux-drop').dataset.over = 'true'; } });
  app.addEventListener('dragleave', (e) => { if ((e.target as Element).closest('#ux-drop')) delete $('ux-drop').dataset.over; });
  app.addEventListener('drop', (e) => { if (!(e.target as Element).closest('#ux-drop')) return; e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) void takeFile(f); });
  window.addEventListener('keydown', (e) => {
    if (flow.phase !== 'review' || !review || gwStep || (e.target as HTMLElement).closest('input, textarea, select')) return;
    const idx = review.items.findIndex((i) => i.id === review!.focusId);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const n = review.items[(idx + (e.key === 'ArrowRight' ? 1 : review.items.length - 1)) % review.items.length]!; reviewDispatch({ type: 'focus', id: n.id }); }
    else if (e.key === 'c' && review.focusId) reviewDispatch({ type: 'decide', id: review.focusId, decision: 'confirmed' });
    else if (e.key === 'x' && review.focusId) reviewDispatch({ type: 'decide', id: review.focusId, decision: 'rejected' });
  });
  $('ux-enter').addEventListener('click', () => {
    if (!options.handoff) { enterLab(true); return; }
    if (!gwStep) { gwStep = true; gwMessage = null; renderReview(); (app.querySelector('#gw-reviewer') as HTMLInputElement | null)?.focus(); return; }
    void openLab();
  });
  function backToReview() {
    cancelAnimationFrame(raf); leaveLab(); direction.setMachineGhost([]); direction.setReveal(0); sheet3d.set(0, 1); views.blend(0);
    options.handoff?.reopen(); engine = { status: 'not_run' }; candidate = null; gwMessage = null; gwStep = false;
    dispatch({ type: 'back_to_review' });
  }
  function restartAll() { cancelAnimationFrame(raf); leaveLab(); resetIntegration(); direction.setMachineGhost([]); views.blend(1); dispatch({ type: 'restart' }); }
  $('ux-pip').addEventListener('click', backToReview);
  $('ux-hero').addEventListener('click', () => views.blend(1));
  $('ux-restart').addEventListener('click', restartAll);
  runtime.controls.addEventListener('change', () => { if (flow.phase === 'lab') requestAnimationFrame(placeChips); });
  addEventListener('resize', () => requestAnimationFrame(placeChips));

  // deep links for review, tests and captures (still through the same port and reducer)
  render();
  const start = q.get('start');
  if (start === 'review' || start === 'lab') {
    selectInput({ kind: 'drawing', name: 'alcado-escavadora.png', size: 412_000, mime: 'image/png', dataUrl: drawing.dataUrl });
    dispatch({ type: 'submit', at: Date.now() });
    await submit();
    if (start === 'lab' && review) {
      for (const [id, d] of [['e_boom', 'confirmed'], ['e_boom_cyl', 'confirmed'], ['e_stick_cyl', 'confirmed'], ['e_bucket_cyl', 'rejected']] as const) review = reduceReview(review, { type: 'decide', id, decision: d });
      enterLab(false);
    }
  }
  Object.assign(window, { __experience: {
    ready: true, phase: () => flow.phase, flow: () => flow, review: () => review, summary: () => review && summarize(review), readiness: () => review && readiness(review),
    dispatch: reviewDispatch, flowDispatch: dispatch, submit, selectInput, enterLab, setScenario: (s: DemoScenario) => { if (port instanceof DemoReconstructionPort) port.scenario = s; },
    runtime, transitionAt, TRANSITION_TOTAL,
  } });
  return { takeText, takeFile: (f) => void takeFile(f), openExample, restart: () => restartAll(), phase: () => flow.phase };
}

// ---------------------------------------------------------------------------------------------- view helpers (pure)
/** The two gates as plain text (also handed to the real lab, which shows them as notices). */
export function gateText(review: ReviewState, engine: EngineGate): { review: string; engine: string } {
  const s = summarize(review); const r = readiness(review);
  const g1text = r.status === 'insufficient' ? `faltam dados: ${r.missing.join(', ')}` : `${s.decided} de ${s.total} decididas${s.pendingHypotheses ? ` · ${s.pendingHypotheses} hipótese${s.pendingHypotheses === 1 ? '' : 's'} por decidir` : ''}`;
  return { review: g1text, engine: `${ENGINE_GATE_LABEL[engine.status]}${engine.status === 'valid' ? ` · ${engine.solverId} · âmbito: só a pose de referência desta montagem; não certifica segurança, resistência, colisões nem outros movimentos` : engine.status === 'blocked' ? ` · ${engine.reasons[0] ?? ''}` : ''}` };
}
function gateItems(review: ReviewState, engine: EngineGate): string {
  const r = readiness(review);
  const g1 = r.status === 'ready_for_engine' ? 'done' : r.status === 'insufficient' ? 'blocked' : 'open';
  const g1text = gateText(review, engine).review;
  return `<li data-gate="${g1}"><span class="u-label">1 · revisão humana</span><b>${esc(g1text)}</b></li>
    <li data-gate="${engine.status === 'valid' ? 'done' : engine.status === 'blocked' ? 'blocked' : 'open'}"><span class="u-label">2 · validação de engenharia</span><b>${esc(gateText(review, engine).engine)}</b></li>`;
}
function gates(review: ReviewState, engine: EngineGate): string {
  return `<ol class="ux-gates" aria-label="Estado da reconstrução">${gateItems(review, engine)}</ol><p class="u-label ux-gate-note">confirmar não é validar: a sua revisão diz o que é verdade na fonte; o motor diz se a montagem funciona.</p>`;
}
function counts(review: ReviewState): string {
  const s = summarize(review);
  return `<dl class="ux-counts u-label"><div><dt>confirmados</dt><dd>${s.confirmed}</dd></div><div><dt>corrigidos</dt><dd>${s.corrected}</dd></div><div><dt>observados</dt><dd>${s.observed}</dd></div><div><dt>hipóteses por rever</dt><dd>${s.pendingHypotheses}</dd></div><div><dt>desconhecidos</dt><dd>${s.unknown}</dd></div><div><dt>rejeitados</dt><dd>${s.rejected}</dd></div></dl>`;
}
function unknownsBlock(review: ReviewState): string {
  if (!review.sourceUnknowns.length) return '';
  return `<details class="ux-unknowns"><summary class="u-label">o que a fonte não diz (${review.sourceUnknowns.length})</summary><ul>${review.sourceUnknowns.map((u) => `<li>${esc(u)}</li>`).join('')}</ul></details>`;
}

function reviewCard(item: ReviewItem, state: ReviewState, editing: boolean): string {
  const cat = labCategory(item);
  const pos = state.items.indexOf(item) + 1;
  const id = esc(item.id);
  const decided = item.decision !== 'pending';
  const actions = editing ? ''
    : decided ? `<button class="u-btn u-btn--outline" data-review="undo" data-id="${id}" type="button">Desfazer</button>`
      : item.status === 'unknown'
        ? `<button class="u-btn u-btn--outline" data-review="correct" data-id="${id}" type="button">Corrigir</button><button class="u-btn u-btn--outline" data-review="reject" data-id="${id}" type="button">Rejeitar</button><span class="u-label">não há nada para confirmar: fica desconhecido até saber mais</span>`
        : `<button class="u-btn u-btn--ink" data-review="confirm" data-id="${id}" type="button">Confirmar</button><button class="u-btn u-btn--outline" data-review="correct" data-id="${id}" type="button">Corrigir</button><button class="u-btn u-btn--outline" data-review="reject" data-id="${id}" type="button">Rejeitar</button>`;
  const fix = editing ? `<form class="ux-fix" onsubmit="return false" aria-label="Corrigir interpretação">
      <label class="ux-field"><span class="u-label">é na verdade</span><select id="ux-fix-kind">${EXCAVATOR_ENTITY_KINDS.map((k) => `<option value="${k}" ${k === item.kind ? 'selected' : ''}>${esc(KIND_LABEL[k])}</option>`).join('')}</select></label>
      <label class="ux-field"><span class="u-label">nome</span><input id="ux-fix-label" class="u-input" value="${esc(item.correction?.label ?? item.label)}" maxlength="120"></label>
      <div class="ux-row"><button class="u-btn u-btn--ink" type="button" data-review="save-correct" data-id="${id}">Guardar correcção</button><button class="u-btn u-btn--outline" type="button" data-review="cancel-correct" data-id="${id}">Cancelar</button></div></form>` : '';
  const props = item.properties.length ? `<table class="ux-props"><caption class="u-label">propriedades</caption><tbody>${item.properties.map((p) => {
    const st = propertyState(p);
    const value = st === 'entered' ? `${esc(p.entered!)} <button class="ux-link" type="button" data-review="clear-property" data-id="${id}" data-name="${esc(p.name)}">limpar</button>`
      : p.status === 'unknown' ? `<span class="ux-inline"><input class="u-input" data-prop-input="${esc(p.name)}" placeholder="valor, se o souber" aria-label="Valor para ${esc(p.name)}"><button class="ux-link" type="button" data-review="save-property" data-id="${id}" data-name="${esc(p.name)}">guardar</button></span>`
        : esc(p.value ?? '');
    return `<tr data-state="${st}"><th scope="row">${esc(p.name)}</th><td>${value}</td><td><span class="ux-pstate" data-state="${st}">${esc(PROPERTY_LABEL[st])}</span></td></tr>`;
  }).join('')}</tbody></table>` : '';
  const title = item.decision === 'corrected' && item.correction
    ? `<h2>${esc(item.correction.label)} <span class="u-label">· ${esc(KIND_LABEL[item.correction.kind])}</span></h2><p class="u-label ux-was">a IA interpretou como «${esc(item.label)}»</p>`
    : `<h2>${esc(item.label)}</h2>`;
  return `<article class="ux-card" data-status="${item.status}" aria-label="${pos} de ${state.items.length}: ${esc(item.label)}">
    <header><span class="u-label">${pos} / ${state.items.length}</span><span class="ux-status" data-status="${item.status}">${esc(STATUS_LABEL[item.status])}</span><span class="u-data">confiança ${item.confidence.toFixed(2)}</span>${decided ? `<span class="ux-decision" data-cat="${cat}">${esc(CATEGORY_LABEL[cat])}</span>` : ''}</header>
    ${title}
    <ul class="ux-evidence" aria-label="Evidência">${item.evidence.map((e) => `<li>${esc(e)}</li>`).join('') || '<li>Sem evidência.</li>'}</ul>
    ${props}${fix}
    <div class="ux-actions">${actions}<button class="ux-next" data-review="next" type="button" aria-label="Próxima hipótese por rever">próxima hipótese →</button></div>
  </article>`;
}

function zonesOverlay(): string {
  const z = (cls: string, title: string, what: string) => `<div class="ux-zone ux-zone--${cls}" aria-hidden="true"><b>${esc(title)}</b><span>${esc(what)}</span></div>`;
  return `<div class="ux-zones">
    ${z('rail', 'Ferramentas', 'rail do espaço de trabalho: enquadrar, isolar, explodir, simular, evidência')}
    ${z('hand', 'Digital Hand', 'sobre a máquina; aponta só para ids canónicos')}
    ${z('inspector', 'Inspector', 'canto superior direito; abre ao seleccionar uma peça')}
    ${z('engine', 'Experiências do motor', 'barra temporal por cima do compositor; só depois do portão 2')}
    ${z('chat', 'Conversa', 'painel à direita / folha em baixo no telemóvel')}
    ${z('composer', 'Compositor', 'centro, em baixo; sempre presente fora do modo foco')}
    ${z('review', 'Revisão e desenho', 'miniatura do desenho original, canto inferior direito')}
  </div>`;
}
