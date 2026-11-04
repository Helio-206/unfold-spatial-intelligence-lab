import { Box3, Vector3 } from 'three';
import { fitBoxDistance } from '../workspace-design/framing';
import type { CueView, ViewContext } from './types';

/**
 * Pure maths for camera cues. Reuses the workspace's own `fitBoxDistance` (safe view offset, usable area, panels), so a cue frames exactly as the
 * workspace's Focus tool would. Azimuth is given in the Cinema's convention (from +X toward +Z) and returned in the workspace director's
 * convention (the mirror), which is what `SpatialWorkspace.setView` and `ViewSpec` use.
 */
const REFERENCE_SIZE = 5;
export function viewForBox(box: Box3, options: { azimuthDeg: number; elevationDeg: number; ctx: ViewContext; margin?: number; targetOffset?: Vector3 }): CueView {
  if (box.isEmpty()) throw new Error('SPATIAL_PRESENTATION_EMPTY_BOX');
  const target = box.getCenter(new Vector3()); if (options.targetOffset) target.add(options.targetOffset);
  const directorAz = (-options.azimuthDeg * Math.PI) / 180, el = (options.elevationDeg * Math.PI) / 180;
  // `fitBoxDistance` searches 0.5..400 stage units; solve at a fixed reference size and scale back, so any scale of root works.
  const size = box.getSize(new Vector3()), longest = Math.max(size.x, size.y, size.z, 1e-12), k = REFERENCE_SIZE / longest;
  const reference = new Box3(box.min.clone().sub(target).multiplyScalar(k), box.max.clone().sub(target).multiplyScalar(k));
  const distance = fitBoxDistance(reference, new Vector3(), directorAz, el, options.ctx.viewport, options.ctx.insets, options.ctx.baseFovDeg, options.margin ?? 16) / k;
  return { target: target.toArray() as [number, number, number], azimuthDeg: -options.azimuthDeg, elevationDeg: options.elevationDeg, distance };
}

/** A wider, higher opening shot: the object arrives into a larger frame, then the camera settles on the hero view. */
export function establishingView(box: Box3, heroAzimuthDeg: number, ctx: ViewContext): CueView {
  const base = viewForBox(box, { azimuthDeg: heroAzimuthDeg - 32, elevationDeg: 24, ctx, margin: 16 });
  return { ...base, distance: base.distance * 1.28 };
}

export const cueToViewSpec = <C extends { view: CueView }>(cue: C) => ({ target: new Vector3(...cue.view.target), azimuth: (cue.view.azimuthDeg * Math.PI) / 180, elevation: (cue.view.elevationDeg * Math.PI) / 180, distance: cue.view.distance });
