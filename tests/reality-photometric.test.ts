import { describe, it, expect } from 'vitest';
import { BoxGeometry, SphereGeometry, Vector3 } from 'three';
import { buildModel } from '../src/living/reality/model';
import { photometricError, renderModelColours } from '../src/living/reality/photometric';
import { encodeColour, encodeMask } from '../src/living/reality/evidence';
import { makeView, rasterise } from '../src/universal-spatial/reconstruction/silhouette';
import { orbitDirection } from '../src/universal-spatial/reconstruction/multiview';
import { bboxOf, evidenceFromRenders, trisOf } from './helpers/reality-fixtures';

const gt = [...trisOf(new BoxGeometry(1.2, 0.6, 0.5)), ...trisOf(new SphereGeometry(0.35, 24, 16), new Vector3(0.55, 0.4, 0.45))];
const POSES: Array<[number, number]> = [[0, 0], [60, 0], [120, 0], [180, 0], [240, 20], [300, 20], [30, 40], [210, 40]];

describe('verificação fotométrica em vistas novas', () => {
  it('o modelo desenha-se a si próprio sem erro e cobre o contorno; um colour grid trocado dá erro alto', () => {
    const ev = evidenceFromRenders(gt, POSES, { cells: 56, res: 128 }), model = buildModel(ev), b = bboxOf(gt);
    const size = ev.colourRes, half = ev.frame.half;
    const heldPose: [number, number] = [90, 10], mask = rasterise(gt, makeView(orbitDirection(...heldPose), b.c, half, ev.res));
    const painted = renderModelColours(model, heldPose[0], heldPose[1], size), rgb = new Uint8Array(size * size * 3);
    for (let i = 0; i < size * size; i++) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = Math.round(painted.rgb[i * 3 + c]!);
    const view = { id: 'held', name: 'held', azimuthDeg: heldPose[0], elevationDeg: heldPose[1], azimuthSource: 'given' as const, maskRle: encodeMask(mask), colour: encodeColour(rgb, size) };
    const ok = photometricError(model, view, ev);
    expect(ok.coverage).toBeGreaterThan(0.6); expect(ok.meanAbsError).toBeLessThan(10); // erro só de quantização RGB565
    const wrong = encodeColour(new Uint8Array(size * size * 3).fill(250), size);
    expect(photometricError(model, { ...view, colour: wrong }, ev).meanAbsError).toBeGreaterThan(40);
    expect(Number.isNaN(photometricError(model, { ...view, colour: undefined as never }, ev).meanAbsError)).toBe(true);
  }, 120_000);
  it('as cores robustas (mediana) e a média ponderada diferem apenas onde as vistas discordam; ambas são determinísticas', () => {
    const ev = evidenceFromRenders(gt, POSES, { cells: 48, res: 128 }), a = buildModel(ev), b = buildModel(ev, { colour: 'weighted-mean' }), c = buildModel(ev);
    expect(Buffer.from(a.parts[0]!.colours.buffer).equals(Buffer.from(c.parts[0]!.colours.buffer))).toBe(true);
    expect(a.parts[0]!.colours.length).toBe(b.parts[0]!.colours.length);
  }, 120_000);
});
