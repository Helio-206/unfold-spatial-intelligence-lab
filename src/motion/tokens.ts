/**
 * Motion tokens. The only place where durations and curves are defined.
 * Three durations, two curves. JS animations (GSAP) read DURATION/EASE; CSS reads the same values
 * through the custom properties set by applyMotionTokens(). Nothing else may hard-code a time or a curve.
 *
 * Hinge logic from the design system: things move on an edge, 0 -> 90 degrees, ease in-out, 300-600 ms in UI.
 */

/** seconds (GSAP) */
export const DURATION = {
  /** hover, press, small state flips */
  fast: 0.18,
  /** the default for any change of state */
  base: 0.42,
  /** one-off reveals and counts that carry meaning */
  slow: 0.9,
} as const;

/** GSAP eases */
export const EASE = {
  /** things arriving or settling */
  out: 'power3.out',
  /** things changing place or value */
  inOut: 'power2.inOut',
} as const;

/** The same two curves for CSS */
export const CSS_EASE = {
  out: 'cubic-bezier(0.215, 0.61, 0.355, 1)',
  inOut: 'cubic-bezier(0.455, 0.03, 0.515, 0.955)',
} as const;

export type DurationName = keyof typeof DURATION;
export type EaseName = keyof typeof EASE;

/** Exposes the tokens to CSS as --dur-fast, --dur-base, --dur-slow, --ease-out, --ease-in-out. */
export function applyMotionTokens(root: HTMLElement = document.documentElement): void {
  for (const [name, seconds] of Object.entries(DURATION)) root.style.setProperty(`--dur-${name}`, `${Math.round(seconds * 1000)}ms`);
  root.style.setProperty('--ease-out', CSS_EASE.out);
  root.style.setProperty('--ease-in-out', CSS_EASE.inOut);
}
