/**
 * Geometry validates the outlines. Photographs of one object taken around it must have silhouettes that fit together: the hull carved from the OTHER views
 * has to contain this view's outline. A wrong outline (the background, a neighbour, half the object) disagrees with the rest; the agreement is measured per view
 * (held-out IoU) and used (1) to choose among the automatic candidates of each view, (2) to flag views whose outline contradicts the others.
 * Poses are the intake's assumed ones (equal turntable steps, declared elevation); the direction is chosen by evidence inside the intake.
 */
import { Vector3 } from 'three';
import type { RGBA } from '../universal-foundry/evidence';
import { leaveOneOutIoU } from '../../universal-spatial/reconstruction/multiview';
import { intakeOrbit } from './intake';
import { viewsOf } from './model';
import { maskCredibility, type Candidate } from './auto-segmentation';

/** Held-out IoU of every view against the hull of the others (null when the intake cannot frame them). */
export function perViewAgreement(images: readonly RGBA[], masks: readonly Uint8Array[], elevationDeg: number): number[] | null {
  const r = intakeOrbit(images.map((rgba, i) => ({ name: `v${i}`, rgba, mask: masks[i]!, maskSource: 'automatic' as const })), { elevationDeg, res: 96, colourRes: 8, cells: 40 });
  if (!r.evidence) return null;
  const views = viewsOf(r.evidence), loo = leaveOneOutIoU(views, { frame: { centre: new Vector3(...r.evidence.frame.centre), half: r.evidence.frame.half }, cells: 40 });
  return loo.length ? loo : null;
}

export type GeometricChoice = { index: number[]; agreement: number[] | null; changed: number; rounds: number };
/**
 * Coordinate ascent over the candidates of each view: start from the given choice, then for each view try every credible candidate and keep the one whose
 * silhouette agrees most with the hull of the other views. Stops when a full pass changes nothing. Views with no credible candidate keep index -1.
 */
export function chooseByAgreement(images: readonly RGBA[], cands: readonly (readonly Candidate[])[], start: readonly number[], elevationDeg: number, maxRounds = 2): GeometricChoice {
  const n = images.length, w = images[0]!.width, h = images[0]!.height, choice = start.slice();
  const credible = cands.map((cs) => cs.map((c) => maskCredibility(c.mask, w, h)));
  const masksOf = (ch: number[]) => ch.map((c, i) => (c >= 0 ? cands[i]![c]!.mask : null));
  if (choice.some((c) => c < 0)) return { index: choice, agreement: null, changed: 0, rounds: 0 };
  let changed = 0, rounds = 0;
  for (let round = 0; round < maxRounds; round++) {
    let moved = false; rounds++;
    for (let i = 0; i < n; i++) {
      let bestC = choice[i]!, bestS = -1;
      for (let c = 0; c < cands[i]!.length; c++) {
        if (!credible[i]![c]) continue; const trial = choice.slice(); trial[i] = c;
        const agr = perViewAgreement(images, masksOf(trial) as Uint8Array[], elevationDeg); if (!agr) continue;
        if (agr[i]! > bestS + 1e-9) { bestS = agr[i]!; bestC = c; }
      }
      if (bestC !== choice[i]) { choice[i] = bestC; moved = true; changed++; }
    }
    if (!moved) break;
  }
  return { index: choice, agreement: perViewAgreement(images, masksOf(choice) as Uint8Array[], elevationDeg), changed, rounds };
}
