/**
 * Reconstruction → lab transition, as a pure function of time. The drawing sheet hinges down onto the floor (0 → 90°,
 * the UNFOLD fold), the machine grows out of it from the ground up, and the camera travels from the drawing's
 * side elevation to the hero three-quarter view. Durations come from the motion tokens; with reduced motion the
 * timeline returns its final state at t = 0.
 */
import { DURATION } from '../../motion/tokens';

/** Phases in seconds, built only from DURATION.base / DURATION.slow. */
export const TIMELINE = {
  hold: DURATION.base,                       // the reviewed sheet holds, registered on the machine's side elevation
  fold: DURATION.slow * 2,                   // sheet hinges down onto the floor
  rise: DURATION.slow * 2,                   // machine grows out of the sheet, overlapping the fold
  riseStart: DURATION.base + DURATION.slow,  // starts half-way through the fold
  camera: DURATION.slow * 3,                 // side elevation → hero view, starts with the fold
  settle: DURATION.base,                     // annotations arrive
} as const;
export const TRANSITION_TOTAL = TIMELINE.hold + TIMELINE.camera + TIMELINE.settle;

export type TransitionFrame = {
  /** sheet rotation about its bottom edge, radians: 0 = upright (facing camera), π/2 = flat on the floor */
  sheetAngle: number;
  sheetOpacity: number;
  /** 0 → 1: height fraction of the machine revealed by the rising clip plane */
  reveal: number;
  /** 0 → 1: camera blend from side elevation to hero */
  camera: number;
  /** 0 → 1: review annotations (chips over parts) */
  annotations: number;
  done: boolean;
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** ease-in-out (same family as EASE.inOut 'power2.inOut') */
const inOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const out = (t: number) => 1 - (1 - t) ** 3; // EASE.out 'power3.out'

export function transitionAt(t: number, reducedMotion = false): TransitionFrame {
  if (reducedMotion) t = TRANSITION_TOTAL;
  const tf = (t - TIMELINE.hold) / TIMELINE.fold;
  const tr = (t - TIMELINE.riseStart) / TIMELINE.rise;
  const tc = (t - TIMELINE.hold) / TIMELINE.camera;
  const ta = (t - TIMELINE.hold - TIMELINE.camera) / TIMELINE.settle;
  const fold = inOut(clamp01(tf));
  return {
    sheetAngle: fold * (Math.PI / 2),
    sheetOpacity: 1 - 0.965 * clamp01((t - TIMELINE.hold - TIMELINE.fold) / TIMELINE.settle),
    reveal: out(clamp01(tr)),
    camera: inOut(clamp01(tc)),
    annotations: out(clamp01(ta)),
    done: t >= TRANSITION_TOTAL,
  };
}
