import { gsap, flipState, dur, EASE, prefersReducedMotion } from './motion';
import './steps-header.css';

/**
 * The six faces of a project. The same header on every screen: complete at the start,
 * then collapsed to numbers (the active step keeps its name). It expands again on hover or focus.
 */
export type StepId = 'observe' | 'understand' | 'materialize' | 'unfold' | 'experiment' | 'verify';

export type StepDef = { id: StepId; n: string; pt: string; href: string | null; note?: string };

export const STEPS: readonly StepDef[] = [
  { id: 'observe', n: '01', pt: 'Observar', href: '/spatial-editor' },
  { id: 'understand', n: '02', pt: 'Compreender', href: '/spatial-editor' },
  { id: 'materialize', n: '03', pt: 'Materializar', href: '/spatial-editor' },
  { id: 'unfold', n: '04', pt: 'Desdobrar', href: '/spatial-editor' },
  { id: 'experiment', n: '05', pt: 'Experimentar', href: '/circuit' },
  { id: 'verify', n: '06', pt: 'Verificar', href: null, note: 'ainda sem ecrã próprio' },
];

const esc = (value: string): string => value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));

export function stepsHeaderHtml(active: StepId): string {
  const items = STEPS.map((step) => {
    const current = step.id === active;
    const label = `<span class="sh-n">${step.n}</span><span class="sh-name">${esc(step.pt)}</span>`;
    const cls = `sh-step${current ? ' is-active' : ''}${step.href ? '' : ' is-unavailable'}`;
    if (!step.href) return `<span class="${cls}" role="link" aria-disabled="true" title="${esc(step.pt)} · ${esc(step.note ?? '')}">${label}</span>`;
    return `<a class="${cls}" href="${step.href}"${current ? ' aria-current="page"' : ''} title="${esc(step.pt)}" aria-label="${step.n} ${esc(step.pt)}">${label}</a>`;
  }).join('');
  return `<nav class="steps-header" data-collapsed="false" aria-label="Os seis passos do projecto">${items}</nav>`;
}

export type StepsHeader = { collapse(): void; expand(): void; destroy(): void };

export function mountStepsHeader(host: HTMLElement, active: StepId, options: { collapseAfterMs?: number } = {}): StepsHeader {
  host.innerHTML = stepsHeaderHtml(active);
  const nav = host.querySelector<HTMLElement>('.steps-header')!;
  let timer = 0;
  let hovering = false;

  const set = (collapsed: boolean) => {
    if (nav.dataset.collapsed === String(collapsed)) return;
    const names = nav.querySelectorAll<HTMLElement>('.sh-step:not(.is-active) .sh-name');
    // Flip carries the change of layout as a transform; the labels fade on the same token curve.
    flipState(nav.querySelectorAll('.sh-step'), () => { nav.dataset.collapsed = String(collapsed); });
    if (!prefersReducedMotion()) gsap.fromTo(names, { opacity: collapsed ? 1 : 0 }, { opacity: collapsed ? 0 : 1, duration: dur('base'), ease: EASE.out });
  };
  const schedule = () => { window.clearTimeout(timer); timer = window.setTimeout(() => { if (!hovering) set(true); }, options.collapseAfterMs ?? 3200); };
  const onEnter = () => { hovering = true; window.clearTimeout(timer); set(false); };
  const onLeave = () => { hovering = false; schedule(); };
  nav.addEventListener('pointerenter', onEnter);
  nav.addEventListener('pointerleave', onLeave);
  nav.addEventListener('focusin', onEnter);
  nav.addEventListener('focusout', onLeave);
  schedule();
  return {
    collapse: () => set(true),
    expand: () => set(false),
    destroy: () => { window.clearTimeout(timer); nav.removeEventListener('pointerenter', onEnter); nav.removeEventListener('pointerleave', onLeave); nav.removeEventListener('focusin', onEnter); nav.removeEventListener('focusout', onLeave); host.innerHTML = ''; },
  };
}
