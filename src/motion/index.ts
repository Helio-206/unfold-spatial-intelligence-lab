import { gsap } from 'gsap';
import { Flip } from 'gsap/Flip';
import { DURATION, EASE, type DurationName, type EaseName } from './tokens';

gsap.registerPlugin(Flip);
export { gsap, Flip };
export * from './tokens';

export const reducedMotionQuery = (): MediaQueryList | undefined => (typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : undefined);
export const prefersReducedMotion = (): boolean => reducedMotionQuery()?.matches ?? false;

/** Duration in seconds for a token; collapses to a short fade when the user asked for less motion. */
export const dur = (name: DurationName): number => (prefersReducedMotion() ? DURATION.fast : DURATION[name]);

/**
 * Tween options from tokens. With reduced motion, geometry-like changes become instant and only
 * `fade` properties keep a short fade (see `set`).
 */
export const tweenVars = (name: DurationName, ease: EaseName = 'inOut'): { duration: number; ease: string } => ({ duration: dur(name), ease: EASE[ease] });

/** Applies final values: instantly under reduced motion, otherwise a tween from tokens. */
export function to(target: gsap.TweenTarget, vars: gsap.TweenVars, name: DurationName = 'base', ease: EaseName = 'inOut'): gsap.core.Tween {
  if (prefersReducedMotion()) {
    const { opacity, onComplete, onUpdate, ...rest } = vars;
    gsap.set(target, rest);
    return opacity === undefined ? gsap.set(target, {}) as unknown as gsap.core.Tween : gsap.fromTo(target, { opacity: 0 }, { opacity: opacity as number, duration: DURATION.fast, ease: EASE.out, onComplete, onUpdate });
  }
  return gsap.to(target, { ...tweenVars(name, ease), ...vars });
}

/** Number of decimals needed to show `step` exactly (0.1 -> 1, 0.01 -> 2, 1 -> 0). */
export const decimalsOf = (step: number): number => Math.max(0, Math.round(-Math.log10(step)));

/**
 * Counts a displayed number from `from` to `to`, snapping to the precision that is shown, so intermediate
 * frames never show digits the final value does not have. Calls `render` with each snapped value.
 */
export function countTo(from: number, to: number, decimals: number, render: (value: number) => void, name: DurationName = 'slow'): gsap.core.Tween {
  const step = 10 ** -decimals;
  if (prefersReducedMotion() || from === to) { render(to); return gsap.delayedCall(0, () => undefined) as unknown as gsap.core.Tween; }
  const state = { value: from };
  return gsap.to(state, { value: to, ...tweenVars(name, 'inOut'), snap: { value: step }, onUpdate: () => render(state.value), onComplete: () => render(to) });
}

/** Flip a state change: capture, mutate, animate with the token curve. */
export function flipState(targets: gsap.DOMTarget, mutate: () => void, name: DurationName = 'base'): void {
  const state = Flip.getState(targets);
  mutate();
  if (prefersReducedMotion()) return;
  Flip.from(state, { duration: DURATION[name], ease: EASE.inOut, absolute: false, nested: false, onEnter: (els) => gsap.fromTo(els, { opacity: 0 }, { opacity: 1, duration: DURATION.fast, ease: EASE.out }) });
}
