import { AuthorizationLedger, type Actor } from './core';
import { commitValueChange, previewValueChange, type CircuitV1, type ValueChangePreview } from './domains/electrical';
import { EXAMPLE_SOURCE_ID, exampleCircuit, flowSpeed, formatOhm, parseCommand, previewView, readout, solve, type BranchId, type ExampleVariant, type Readout } from './circuit-lab-model';
import { mountStepsHeader } from './steps-header';
import { countTo, dur, EASE, flipState, gsap, prefersReducedMotion } from './motion';
import lockupLight from '../design-system/logos/unfold-lockup-on-light.svg';
import './circuit-lab.css';

/**
 * Circuit lab: "Altera R2 para 220 Ω" on a small DC circuit.
 * The sentence is read deterministically, the numbers come from the solver, the change goes through
 * preview -> commit, and the animation is only the transition between the two states.
 */

type Branch = 'total' | 'r2' | 'r3';
const ACTOR: Actor & { kind: 'human' } = { kind: 'human', id: 'local-user' };

/** Wire segments in the direction of conventional current (out of the + terminal of V1). */
const WIRES: Array<{ d: string; branch: Branch }> = [
  { d: 'M170 230V130H300', branch: 'total' }, { d: 'M460 130H620', branch: 'total' },
  { d: 'M620 130H800', branch: 'r3' }, { d: 'M620 130V200', branch: 'r2' }, { d: 'M620 350V420', branch: 'r2' },
  { d: 'M800 130V200', branch: 'r3' }, { d: 'M800 350V420H620', branch: 'r3' }, { d: 'M620 420H170V276', branch: 'total' },
];

const zig = (x: number): string => `M${x} 200v20l-14 10 28 20-28 20 28 20-28 20 14 10v30`;
const zigH = 'M300 130h24l8-14 16 28 16-28 16 28 16-28 16 28 16-28 8 14h24';

export function mountCircuitLab(app: HTMLElement): () => void {
  const variant: ExampleVariant = new URLSearchParams(location.search).get('exemplo') === 'sem-valor' ? 'missing-r3' : 'complete';
  const ledger = new AuthorizationLedger({ sessionId: `circuit-${Math.random().toString(36).slice(2)}` });

  let circuit: CircuitV1 = exampleCircuit(variant);
  let preview: { raw: ValueChangePreview; request: { componentId: string; value: number } } | undefined;
  const revisions: Array<{ id: string; label: string; kind: 'done' | 'current' | 'preview' }> = [{ id: circuit.revision.id, label: 'R0', kind: 'current' }];
  const trail: string[] = [];

  app.innerHTML = `<main class="circuit-lab" data-theme="light">
    <header class="cl-header"><a href="/landing/" class="cl-brand" aria-label="UNFOLD — página inicial"><img src="${lockupLight}" alt="Unfold — Spatial Intelligence Lab" width="120" height="32"></a><div id="cl-steps"></div><div class="cl-title u-label" id="cl-title"></div></header>
    <section class="cl-stage" aria-label="Esquema do divisor resistivo">
      <svg id="cl-svg" viewBox="0 0 1000 520" role="img" aria-labelledby="cl-desc" overflow="visible">
        <desc id="cl-desc">V1 em série com R1; R2 e R3 em paralelo. Os traços animados indicam o sentido e a intensidade da corrente em cada ramo.</desc>
        <g class="cl-wires">${WIRES.map((w, i) => `<path class="cl-wire" data-branch="${w.branch}" data-i="${i}" d="${w.d}"/>`).join('')}</g>
        <g class="cl-parts">
          <path class="cl-part" data-part="r1" d="${zigH}"/>
          <path class="cl-part" data-part="r2" d="${zig(620)}"/>
          <path class="cl-part" data-part="r3" d="${zig(800)}"/>
          <circle class="cl-part-fill" cx="170" cy="253" r="26"/><path class="cl-part" data-part="v1" d="M170 241v12M164 247h12M164 262h12"/>
        </g>
        <g class="cl-nodes"><circle cx="620" cy="130" r="4"/><circle cx="620" cy="420" r="4"/><circle cx="800" cy="130" r="4"/><circle cx="800" cy="420" r="4"/></g>
        <g class="cl-labels" font-family="var(--font-mono)" font-size="12">
          ${label('r1', 380, 40, 'middle', 'R1 · em série')}
          ${label('r2', 560, 258, 'end', 'R2')}
          ${label('r3', 860, 258, 'start', 'R3')}
          <text class="cl-muted" x="110" y="249" text-anchor="end">V1</text><text class="cl-ink" x="110" y="267" text-anchor="end" font-size="14" data-bind="v1.value">12 V</text><text class="cl-muted" x="110" y="283" text-anchor="end" data-bind="v1.tag"></text>
        </g>
      </svg>
      <p class="cl-assume u-label" id="cl-assume">solver DC · componentes ideais · tolerâncias desconhecidas</p>
      <div class="cl-trail u-label" id="cl-trail" aria-live="polite"></div>
    </section>
    <section class="cl-card" id="cl-card" data-theme="light" hidden aria-label="Confirmar alteração"><div class="cl-card-text" id="cl-card-text"></div><div class="cl-card-actions"><button type="button" class="u-btn u-btn--primary" id="cl-confirm">Confirmar</button><button type="button" class="u-btn u-btn--outline" id="cl-cancel">Cancelar</button></div></section>
    <ol class="cl-rev" id="cl-rev" aria-label="Revisões"></ol>
    <div class="cl-pill-wrap"><section class="cl-pill" id="cl-pill" data-theme="light" aria-label="Comando">
      <button type="button" class="cl-more" id="cl-more" aria-label="Mais opções" aria-expanded="false" aria-haspopup="menu"><span aria-hidden="true">···</span></button>
      <div class="cl-menu" id="cl-menu" role="menu" hidden><button role="menuitem" type="button" data-example="complete">Exemplo completo</button><button role="menuitem" type="button" data-example="missing-r3">Exemplo com R3 sem valor</button></div>
      <form id="cl-form" class="cl-form" autocomplete="off"><label class="sr-only" for="cl-input">Comando</label><input id="cl-input" type="text" placeholder="Altera R2 para 220 Ω" spellcheck="false"><button type="submit" class="cl-send" aria-label="Enviar"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button></form>
      <p class="cl-msg u-label" id="cl-msg" role="status" aria-live="polite"></p>
    </section></div>
  </main>`;

  const $ = <T extends Element = HTMLElement>(sel: string) => app.querySelector<T>(sel)!;
  const steps = mountStepsHeader($('#cl-steps'), 'experiment');
  const svg = $<SVGSVGElement>('#cl-svg');
  const bind = (key: string) => svg.querySelector<SVGTextElement>(`[data-bind="${key}"]`)!;
  const wires = [...svg.querySelectorAll<SVGPathElement>('.cl-wire')];
  const parts = Object.fromEntries([...svg.querySelectorAll<SVGPathElement>('.cl-part')].map((p) => [p.dataset.part!, p])) as Record<string, SVGPathElement>;

  // ---- displayed state (what is on screen right now) -------------------------------------------------------
  const shown = { cur: { r1: 0, r2: 0, r3: 0 } as Record<BranchId, number>, volt: { r1: 0, r2: 0, r3: 0 } as Record<BranchId, number>, ohm: { r1: 0, r2: 0, r3: 0 } as Record<BranchId, number>, known: false };
  const speed: Record<Branch, number> = { total: 0, r2: 0, r3: 0 };
  const offset = wires.map(() => 0);

  const ohmOf = (c: CircuitV1): Record<BranchId, number | null> => ({ r1: c.components.find((x) => x.id === 'r1')!.value.value, r2: c.components.find((x) => x.id === 'r2')!.value.value, r3: c.components.find((x) => x.id === 'r3')!.value.value });
  const tagOf = (c: CircuitV1, id: string, preview = false): string => {
    if (preview) return 'pré-visualização';
    const comp = c.components.find((x) => x.id === id)!;
    if (comp.value.value === null) return 'desconhecido';
    const origin = comp.value.provenance.origin;
    return origin === 'fixture' ? 'exemplo' : origin === 'human_entered' ? 'confirmado' : 'observado';
  };

  const setText = (key: string, text: string) => { bind(key).textContent = text; };
  const renderCurrent = (id: BranchId) => setText(`${id}.read`, `${shown.cur[id].toFixed(1)} mA · ${shown.volt[id].toFixed(2)} V`);

  function renderUnknown(why: string, missing: string[]): void {
    shown.known = false;
    (['r1', 'r2', 'r3'] as BranchId[]).forEach((id) => setText(`${id}.read`, missing.includes(id) ? 'falta o valor' : '— mA · — V'));
    $('#cl-assume').textContent = `solver DC recusou: ${why}. Nenhum valor foi estimado.`;
    svg.classList.add('is-unknown');
    gsap.to(speed, { total: 0, r2: 0, r3: 0, duration: dur('base'), ease: EASE.out });
  }

  /** Moves the numbers to a new solver result. Unknown -> number never counts up from nothing: it fades in. */
  function showReadout(target: Readout, animate = true): void {
    if (target.status !== 'solved') { renderUnknown(target.why, target.missing); return; }
    svg.classList.remove('is-unknown');
    $('#cl-assume').textContent = 'solver DC · componentes ideais · tolerâncias desconhecidas';
    const fromKnown = shown.known;
    shown.known = true;
    (['r1', 'r2', 'r3'] as BranchId[]).forEach((id) => {
      const iTo = target.currentMa[id], vTo = target.voltageV[id];
      if (!animate || !fromKnown) {
        shown.cur[id] = iTo; shown.volt[id] = vTo; renderCurrent(id);
        if (animate) gsap.fromTo(bind(`${id}.read`), { opacity: 0 }, { opacity: 1, duration: dur('base'), ease: EASE.out });
      } else {
        countTo(shown.cur[id], iTo, 1, (v) => { shown.cur[id] = v; renderCurrent(id); });
        countTo(shown.volt[id], vTo, 2, (v) => { shown.volt[id] = v; renderCurrent(id); });
      }
    });
    const next: Record<Branch, number> = { total: flowSpeed(target.currentMa.r1 / 1000), r2: flowSpeed(target.currentMa.r2 / 1000), r3: flowSpeed(target.currentMa.r3 / 1000) };
    if (prefersReducedMotion()) Object.assign(speed, next); else gsap.to(speed, { ...next, duration: dur('slow'), ease: EASE.inOut });
  }

  function showOhms(values: Record<BranchId, number | null>, animate: boolean): void {
    (['r1', 'r2', 'r3'] as BranchId[]).forEach((id) => {
      const target = values[id];
      if (target === null) { setText(`${id}.value`, 'sem valor'); shown.ohm[id] = 0; return; }
      const from = shown.ohm[id];
      if (!animate || from === 0) { shown.ohm[id] = target; setText(`${id}.value`, formatOhm(target)); return; }
      countTo(from, target, 0, (v) => { shown.ohm[id] = v; setText(`${id}.value`, formatOhm(v)); });
    });
  }

  const tint = (id: BranchId, mode: 'ink' | 'preview' | 'changed') => {
    const part = parts[id]!;
    const color = mode === 'ink' ? 'var(--ink)' : 'var(--fold)';
    gsap.to(part, { attr: { 'stroke-width': mode === 'preview' ? 3.4 : mode === 'changed' ? 2.8 : 2.2 }, stroke: color, duration: dur('base'), ease: EASE.inOut });
  };

  function setTags(): void {
    (['r1', 'r2', 'r3'] as BranchId[]).forEach((id) => setText(`${id}.tag`, id === preview?.request.componentId ? 'pré-visualização' : tagOf(circuit, id)));
    setText('v1.tag', tagOf(circuit, 'v1'));
    (['r1', 'r2', 'r3'] as BranchId[]).forEach((id) => parts[id]!.classList.toggle('is-unknown', ohmOf(circuit)[id] === null));
  }

  function renderRevisions(): void {
    $('#cl-rev').innerHTML = revisions.map((r) => `<li class="cl-rev-item is-${r.kind}" data-id="${r.id}"><i></i><span>${r.kind === 'current' ? r.label + ' · actual' : r.kind === 'preview' ? r.label + ' · pré-visualização' : ''}</span></li>`).join('');
    $('#cl-title').textContent = `${circuit.title} · R${circuit.revision.number}`;
  }

  function renderTrail(): void {
    const el = $('#cl-trail');
    el.innerHTML = trail.slice(-3).map((line) => `<div>${line}</div>`).join('');
    if (trail.length) gsap.fromTo(el.lastElementChild!, { opacity: 0, y: 4 }, { opacity: 1, y: 0, duration: dur('base'), ease: EASE.out });
  }

  const message = (text: string, kind: 'info' | 'refused' = 'info') => { const el = $('#cl-msg'); el.textContent = text; el.dataset.kind = kind; };

  // ---- card (confirm / cancel) -----------------------------------------------------------------------------
  const card = $('#cl-card');
  function showCard(text: string): void {
    $('#cl-card-text').textContent = text;
    card.hidden = false;
    gsap.fromTo(card, { opacity: 0, x: 16 }, { opacity: 1, x: 0, duration: dur('base'), ease: EASE.out });
    ($('#cl-confirm') as HTMLButtonElement).focus({ preventScroll: true });
  }
  function hideCard(): void {
    if (card.hidden) return;
    const done = () => { card.hidden = true; };
    if (prefersReducedMotion()) { done(); return; }
    gsap.to(card, { opacity: 0, x: 16, duration: dur('base'), ease: EASE.out, onComplete: done });
  }

  // ---- command flow ----------------------------------------------------------------------------------------
  function propose(text: string): void {
    if (preview) cancel(false);
    const cmd = parseCommand(text);
    if (!cmd.ok) { message(cmd.reason, 'refused'); return; }
    const request = { componentId: cmd.componentId, value: cmd.value, origin: 'ui_direct' as const, actor: ACTOR };
    const raw = previewValueChange(circuit, request);
    const view = previewView(raw, cmd.componentId);
    if (view.status === 'blocked') { message(`Recusado: ${view.reason}`, 'refused'); return; }
    if (view.after.status !== 'solved') { message(`Recusado: ${view.after.why}.`, 'refused'); return; }
    preview = { raw, request: { componentId: cmd.componentId, value: cmd.value } };
    message(`${cmd.componentId.toUpperCase()}: ${formatOhm(view.from)} → ${formatOhm(view.to)}. Os números vêm do solver.`);
    (['r1', 'r2', 'r3'] as BranchId[]).forEach((id) => tint(id, id === cmd.componentId ? 'preview' : 'ink'));
    const next = ohmOf(circuit); next[cmd.componentId as BranchId] = view.to;
    showOhms(next, true);
    showReadout(view.after);
    setTags();
    flipState('.cl-rev-item', () => { revisions.push({ id: raw.candidate!.revision.id, label: `R${raw.candidate!.revision.number}`, kind: 'preview' }); renderRevisions(); });
    trail.push(`${cmd.componentId.toUpperCase()} ${formatOhm(view.from)} → ${formatOhm(view.to)} · pré-visualização`); renderTrail();
    showCard(`Aplicar a revisão R${raw.candidate!.revision.number}: ${cmd.componentId.toUpperCase()} passa de ${formatOhm(view.from)} para ${formatOhm(view.to)}.`);
  }

  function cancel(announce = true): void {
    if (!preview) return;
    const id = preview.request.componentId as BranchId;
    preview = undefined;
    tint(id, 'ink');
    showOhms(ohmOf(circuit), true);
    showReadout(readout(solve(circuit)));
    setTags();
    flipState('.cl-rev-item', () => { revisions.pop(); revisions[revisions.length - 1]!.kind = 'current'; renderRevisions(); });
    trail.pop(); renderTrail();
    hideCard();
    if (announce) message('Cancelado. A cena voltou ao que era.');
  }

  function confirm(): void {
    if (!preview) return;
    try {
      const request = { ...preview.request, origin: 'ui_direct' as const, actor: ACTOR };
      circuit = commitValueChange(circuit, preview.raw, request, { ledger });
    } catch (error) { message(`Commit recusado: ${error instanceof Error ? error.message : 'erro'}`, 'refused'); cancel(false); return; }
    const id = preview.request.componentId;
    preview = undefined;
    tint(id as BranchId, 'changed');
    setTags();
    flipState('.cl-rev-item', () => { revisions.forEach((r) => { if (r.kind === 'current') r.kind = 'done'; }); revisions[revisions.length - 1]!.kind = 'current'; renderRevisions(); });
    trail[trail.length - 1] = trail[trail.length - 1]!.replace('pré-visualização', 'confirmado'); renderTrail();
    hideCard();
    message(`Revisão R${circuit.revision.number} aplicada.`);
  }

  function reset(next: ExampleVariant): void {
    circuit = exampleCircuit(next);
    preview = undefined; trail.length = 0;
    revisions.length = 0; revisions.push({ id: circuit.revision.id, label: 'R0', kind: 'current' });
    (['r1', 'r2', 'r3'] as BranchId[]).forEach((id) => tint(id, 'ink'));
    shown.ohm = { r1: 0, r2: 0, r3: 0 }; shown.known = false;
    showOhms(ohmOf(circuit), false); showReadout(readout(solve(circuit)), false); setTags(); renderRevisions(); renderTrail(); hideCard();
    message(next === 'missing-r3' ? 'Falta o valor de R3: o solver recusa em vez de estimar.' : '');
  }

  // ---- events ----------------------------------------------------------------------------------------------
  const input = $<HTMLInputElement>('#cl-input');
  const pill = $('#cl-pill');
  $<HTMLFormElement>('#cl-form').addEventListener('submit', (event) => { event.preventDefault(); if (input.value.trim()) propose(input.value); });
  $('#cl-confirm').addEventListener('click', confirm);
  $('#cl-cancel').addEventListener('click', () => cancel());
  const grow = (open: boolean) => { if (pill.classList.contains('is-open') === open) return; flipState(pill, () => pill.classList.toggle('is-open', open), 'base'); };
  input.addEventListener('focus', () => grow(true));
  input.addEventListener('input', () => grow(true));
  input.addEventListener('blur', () => { if (!input.value) window.setTimeout(() => { if (document.activeElement === input || pill.contains(document.activeElement) && document.activeElement !== document.body) return; grow(false); }, 120); });
  const more = $('#cl-more'), menu = $('#cl-menu');
  more.addEventListener('click', () => { const open = menu.hidden; menu.hidden = !open; more.setAttribute('aria-expanded', String(open)); if (open) gsap.fromTo(menu, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: dur('fast'), ease: EASE.out }); });
  menu.addEventListener('click', (event) => { const target = (event.target as HTMLElement).closest<HTMLElement>('[data-example]'); if (!target) return; menu.hidden = true; more.setAttribute('aria-expanded', 'false'); reset(target.dataset.example as ExampleVariant); });
  const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { if (!menu.hidden) { menu.hidden = true; more.setAttribute('aria-expanded', 'false'); more.focus(); } else if (preview) cancel(); } };
  document.addEventListener('keydown', onKey);

  // ---- dash flow: speed proportional to the branch current ---------------------------------------------------
  let last = performance.now();
  const tick = () => {
    const now = performance.now(); const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (prefersReducedMotion() || svg.classList.contains('is-unknown')) return;
    wires.forEach((wire, i) => { offset[i]! -= speed[wire.dataset.branch as Branch] * dt; wire.setAttribute('stroke-dashoffset', offset[i]!.toFixed(2)); });
  };
  gsap.ticker.add(tick);

  reset(variant);
  void EXAMPLE_SOURCE_ID;
  return () => { gsap.ticker.remove(tick); document.removeEventListener('keydown', onKey); steps.destroy(); gsap.killTweensOf([speed, card, ...Object.values(parts)]); app.innerHTML = ''; };
}

function label(id: string, x: number, y: number, anchor: string, name: string): string {
  return `<text class="cl-muted" x="${x}" y="${y}" text-anchor="${anchor}">${name}</text>
          <text class="cl-ink" x="${x}" y="${y + 20}" text-anchor="${anchor}" font-size="15" data-bind="${id}.value"></text>
          <text class="cl-muted" x="${x}" y="${y + 38}" text-anchor="${anchor}" data-bind="${id}.read"></text>
          <text class="cl-tag" x="${x}" y="${y + 54}" text-anchor="${anchor}" data-bind="${id}.tag"></text>`;
}
