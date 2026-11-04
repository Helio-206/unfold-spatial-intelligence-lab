import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { fitPlacement, place, type FitInput } from '../src/universal-spatial/reconstruction/fit';
import { makeView, rasterise, viewDirections, type Tri } from '../src/universal-spatial/reconstruction/silhouette';

const box = (cx: number, cy: number, cz: number, h: number): Tri[] => {
  const v = (x: number, y: number, z: number) => new Vector3(cx + x * h, cy + y * h, cz + z * h), q = (a: Vector3, b: Vector3, c: Vector3, d: Vector3): Tri[] => [[a, b, c], [a, c, d]];
  const p = [v(-1, -1, -1), v(1, -1, -1), v(1, 1, -1), v(-1, 1, -1), v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1)];
  return [...q(p[0]!, p[1]!, p[2]!, p[3]!), ...q(p[4]!, p[5]!, p[6]!, p[7]!), ...q(p[0]!, p[1]!, p[5]!, p[4]!), ...q(p[2]!, p[3]!, p[7]!, p[6]!), ...q(p[1]!, p[2]!, p[6]!, p[5]!), ...q(p[0]!, p[3]!, p[7]!, p[4]!)];
};
const views = (n: number, offset = 0) => viewDirections(n).map((d) => makeView(d.clone().applyAxisAngle(new Vector3(0, 1, 0), offset), new Vector3(), 4, 64));

describe('placement fitting from silhouettes', () => {
  it('recovers a displaced and mis-scaled component, judged on views the fit never saw', () => {
    const truth: FitInput[] = [{ id: 'a', origin: new Vector3(-1.2, 0, 0), tris: box(-1.2, 0, 0, 0.8) }, { id: 'b', origin: new Vector3(1.4, 0.3, 0), tris: box(1.4, 0.3, 0, 0.6) }];
    const fitViews = views(6), heldOut = views(5, 0.4), targets = fitViews.map((v) => rasterise(truth.flatMap((c) => c.tris), v));
    // the plan says: a is 40 % too big and shifted, b is displaced
    const wrong = truth.map((c) => ({ ...c, tris: place(c.tris, c.origin, c.id === 'a' ? { s: 1.4, d: new Vector3(0.5, 0.3, 0) } : { s: 1, d: new Vector3(-0.4, -0.3, 0.2) }) }));
    const result = fitPlacement(wrong, fitViews, targets, { maxShift: 1.5 });
    expect(result.iouAfter).toBeGreaterThan(result.iouBefore + 0.1);
    const score = (parts: FitInput[], withPlacement: boolean) => { const tris = parts.flatMap((c) => withPlacement ? place(c.tris, c.origin, result.placements.get(c.id)!) : c.tris); return heldOut.map((v) => rasterise(tris, v)); };
    const gt = heldOut.map((v) => rasterise(truth.flatMap((c) => c.tris), v)), iou = (a: Uint8Array[]) => a.reduce((s, m, i) => { let n = 0, u = 0; for (let k = 0; k < m.length; k++) { n += m[k]! & gt[i]![k]!; u += m[k]! | gt[i]![k]!; } return s + n / u; }, 0) / a.length;
    expect(iou(score(wrong, true))).toBeGreaterThan(iou(score(wrong, false)) + 0.05); // better on views it did not see
  });

  it('keeps a component fixed when told to, and respects the shift bound', () => {
    const part: FitInput = { id: 'a', origin: new Vector3(), tris: box(0, 0, 0, 1) }, fv = views(3), targets = fv.map((v) => rasterise(box(2, 0, 0, 1), v));
    const fixed = fitPlacement([part], fv, targets, { maxShift: 3, fixed: new Set(['a']) }); expect(fixed.placements.get('a')!.d.length()).toBe(0);
    const bounded = fitPlacement([part], fv, targets, { maxShift: 0.5 }); expect(bounded.placements.get('a')!.d.length()).toBeLessThanOrEqual(0.5 + 1e-9);
  });
});
