import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { lookAtCamera, rasterisePinhole } from '../src/universal-spatial/reconstruction/multiview';
import { intakeOrbit, type IntakeImage } from '../src/living/reality/intake';
import { buildModel, viewsOf } from '../src/living/reality/model';
import { validateRealityEvidence } from '../src/living/reality/evidence';
import { assessReconstruction } from '../src/living/reality/assessment';
import { planFromModel } from '../src/living/reality/plan';
import { evidenceSha256 } from '../src/living/reality/evidence';
import { evidenceFromRenders, solid, ORBIT6 } from './helpers/reality-fixtures';

/** perspective "photographs" of a known solid: masks from a real pinhole projection at the given field of view, 8 turntable views at 20 degrees elevation */
function perspectiveCapture(fovDeg: number): IntakeImage[] {
  const tris = solid(), res = 256, D = 1 / (2 * Math.tan((fovDeg * Math.PI) / 360)) * 1.6, e = (20 * Math.PI) / 180;
  return Array.from({ length: 8 }, (_, i) => { const a = (i * 45 * Math.PI) / 180, cam = lookAtCamera(new Vector3(Math.sin(a) * Math.cos(e) * D, Math.sin(e) * D, Math.cos(a) * Math.cos(e) * D), new Vector3(0, 0.05, 0), res, fovDeg), mask = rasterisePinhole(tris, cam, res), data = new Uint8ClampedArray(res * res * 4).fill(255); return { name: `p${i}.png`, rgba: { width: res, height: res, data }, mask, maskSource: 'confirmed' as const }; });
}

describe('perspective camera: declared or estimated, never presented as measured', () => {
  it('a wide-angle capture gets an ESTIMATED field of view, labelled as such, and a better held-out consistency than the orthographic assumption', { timeout: 60_000 }, () => {
    const photos = perspectiveCapture(55), auto = intakeOrbit(photos, { elevationDeg: 20 }), ortho = intakeOrbit(photos, { elevationDeg: 20, orthographicOnly: true });
    expect(auto.evidence!.camera).toBeDefined(); expect(auto.evidence!.camera!.source).toBe('estimated'); expect(auto.evidence!.camera!.fovDeg).toBeGreaterThanOrEqual(25); expect(auto.evidence!.camera!.gain!).toBeGreaterThanOrEqual(0.04);
    expect(auto.evidence!.assumptions.join(' ')).toMatch(/ESTIMADO.*NÃO foi medido/); expect(ortho.evidence!.camera).toBeUndefined();
    const mean = (m: ReturnType<typeof buildModel>) => m.heldOutIoU!.reduce((s, x) => s + x.iou, 0) / m.heldOutIoU!.length;
    expect(mean(buildModel(auto.evidence!))).toBeGreaterThan(mean(buildModel(ortho.evidence!)) + 0.03);
  });
  it('a near-orthographic capture keeps the orthographic model (the gate refuses gains within noise)', () => {
    expect(intakeOrbit(perspectiveCapture(6), { elevationDeg: 20 }).evidence!.camera).toBeUndefined();
  });
  it('a declared field of view is recorded as declared and used; the views carry the camera through every consumer', () => {
    const r = intakeOrbit(perspectiveCapture(55), { elevationDeg: 20, fovDeg: 55 }).evidence!; expect(r.camera).toMatchObject({ fovDeg: 55, source: 'declared' }); expect(r.assumptions.join(' ')).toMatch(/indicado por si \(não verificado\)/);
    expect(viewsOf(r).every((v) => v.fovDeg === 55)).toBe(true);
  });
  it('the assessment says the field of view is not a measurement and never lifts the fidelity class because of it', async () => {
    const ev = intakeOrbit(perspectiveCapture(55), { elevationDeg: 20 }).evidence!, m = buildModel(ev), a = assessReconstruction(planFromModel(m, await evidenceSha256(ev), 'T'), m, await evidenceSha256(ev));
    expect(a.statements.join(' ')).toMatch(/Câmara: campo de visão ESTIMADO/); expect(a.ledger.fidelity.class).not.toBe('faithful');
  });
  it('old evidence (no camera field) is untouched: same validation, orthographic views, identical model', () => {
    const old = evidenceFromRenders(solid(), ORBIT6), v = validateRealityEvidence(old); expect(v.camera).toBeUndefined(); expect(viewsOf(v).every((x) => x.fovDeg === undefined)).toBe(true);
    expect(() => validateRealityEvidence({ ...old, camera: { fovDeg: 2, principalShiftPx: 0, source: 'estimated' } })).toThrow(); expect(() => validateRealityEvidence({ ...old, camera: { fovDeg: 40, principalShiftPx: 0, source: 'measured' } as never })).toThrow();
  });
});
