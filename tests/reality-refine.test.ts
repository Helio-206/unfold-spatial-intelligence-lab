import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { buildModel, partGeometry } from '../src/living/reality/model';
import { refineModel } from '../src/living/reality/refine';
import { intakeAddView, intakeOrbit, type IntakeImage } from '../src/living/reality/intake';
import { chamfer, geometryPoints, samplePoints } from '../src/universal-spatial/reconstruction/multiview-metrics';
import { makeView, rasterise } from '../src/universal-spatial/reconstruction/silhouette';
import { orbitDirection } from '../src/universal-spatial/reconstruction/multiview';
import { FRAME_HALF_PER_DIAGONAL } from '../src/living/reality/model';
import { bboxOf, solid } from './helpers/reality-fixtures';

const gt = solid(), b = bboxOf(gt), k = 0.5 / (b.mx.y - b.mn.y);
function photo(az: number, el = 0, W = 320, Hh = 240, off: [number, number] = [14, -9]): IntakeImage {
  const half = FRAME_HALF_PER_DIAGONAL * b.diag, res = 192, mask = rasterise(gt, makeView(orbitDirection(az, el), b.c, half, res)), data = new Uint8ClampedArray(W * Hh * 4), cx = W / 2 + off[0], cy = Hh / 2 + off[1];
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const u = (x + 0.5 - cx) / (Hh * k), v = (cy - (y + 0.5)) / (Hh * k), X = Math.floor((u / half + 1) / 2 * res), Y = Math.floor((v / half + 1) / 2 * res), inside = X >= 0 && Y >= 0 && X < res && Y < res && mask[Y * res + X], i = (y * W + x) * 4;
    data[i] = inside ? 180 : 238; data[i + 1] = inside ? 60 : 240; data[i + 2] = inside ? 40 : 236; data[i + 3] = 255;
  }
  return { name: `p${az}.png`, rgba: { width: W, height: Hh, data } };
}
const surfaceError = (model: ReturnType<typeof buildModel>) => {
  const pts = model.parts.flatMap((p) => geometryPoints(partGeometry(p), 1500, 5).map((q) => q.add(new Vector3(...p.origin)))).map((q) => q.clone().divideScalar(k).add(b.c));
  return chamfer(pts, samplePoints(gt, 3000, 2)).symmetric / b.diag;
};

describe('integrar uma nova perspectiva sem reconstruir às cegas', () => {
  const azs = [0, 90, 180, 270], base = intakeOrbit(azs.map((a) => photo(a)), { cells: 56 }).evidence!;
  it('uma vista com informação nova reduz o sólido, melhora o erro e mantém ids e origens das partes', () => {
    const prev = buildModel(base);
    const add = intakeAddView(base, photo(45), { azimuthDeg: 45 });
    expect(add.refusals).toEqual([]);
    const { model, diff } = refineModel(prev, add.evidence!);
    expect(diff.verdict).toBe('informative');
    expect(diff.voxelsAfter).toBeLessThan(diff.voxelsBefore);
    expect(diff.informationGain[0]!.gain).toBeGreaterThan(0.01);
    expect(surfaceError(model)).toBeLessThanOrEqual(surfaceError(prev) + 1e-9);
    for (const m of diff.matched) { const a = prev.parts.find((p) => p.id === m.id)!, c = model.parts.find((p) => p.id === m.id)!; expect(c.origin).toEqual(a.origin); }
    expect(diff.droppedPartIds.length + diff.matched.length).toBe(prev.parts.length);
  }, 120_000);
  it('uma vista redundante (mesma pose) é identificada como tal e não altera nada', () => {
    const prev = buildModel(base), add = intakeAddView(base, photo(90), { azimuthDeg: 90 });
    const { diff } = refineModel(prev, add.evidence!);
    expect(diff.informationGain[0]!.gain).toBeLessThan(0.02);
    expect(diff.removedFraction).toBeLessThan(0.01);
  }, 120_000);
  it('recusa acrescentar a um desenho técnico e vistas sem contorno utilizável', () => {
    const noFraming = { ...base, framing: undefined };
    expect(intakeAddView(noFraming as never, photo(45), { azimuthDeg: 45 }).refusals[0]!.detail).toMatch(/framing/);
    const blank = photo(45); for (let i = 0; i < blank.rgba.data.length; i += 4) { blank.rgba.data[i] = 238; blank.rgba.data[i + 1] = 240; blank.rgba.data[i + 2] = 236; }
    expect(intakeAddView(base, blank, { azimuthDeg: 45 }).evidence).toBeNull();
  });
});
