import { describe, it, expect } from 'vitest';
import { extractEvidence, type RGBA } from '../src/living/universal-foundry/evidence';
import { correctedEvidence } from '../src/living/universal-foundry/correction';
import { detectWheelLandmarks, estimateCamera } from '../src/living/universal-foundry/landmarks';

function blank(w = 200, h = 134): RGBA {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = 235; data[i + 1] = 235; data[i + 2] = 235; data[i + 3] = 255; }
  return { width: w, height: h, data };
}
/** Carro de perfil: corpo claro + dois pneus escuros circulares sobre o chão. */
function sideCarRgba(): RGBA {
  const img = blank();
  const { width: w, height: h, data } = img;
  const set = (x: number, y: number, v: number) => { const i = (y * w + x) * 4; data[i] = v; data[i + 1] = v; data[i + 2] = v; };
  for (let y = 45; y < 105; y++) for (let x = 25; x < 180; x++) set(x, y, 150);
  for (const cx of [55, 150]) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.hypot(x - cx, y - 108) < 17) set(x, y, 25);
  return img;
}

describe('landmarks de rodas e câmara', () => {
  it('regiões escuras dos pneus: dois centros, raio e distância entre eixos', () => {
    const img = sideCarRgba();
    const ev = extractEvidence(img);
    const lm = detectWheelLandmarks(ev, img);
    expect(lm.source).toBe('image-dark-regions');
    expect(lm.wheels.length).toBe(2);
    const [a, b] = lm.wheels;
    expect(Math.abs(a!.centreXFraction - (55 - ev.bbox.x0) / (ev.bbox.x1 - ev.bbox.x0))).toBeLessThan(0.06);
    expect(b!.centreXFraction).toBeGreaterThan(a!.centreXFraction);
    expect(lm.wheelbaseFraction).toBeGreaterThan(0.35);
  });
  it('câmara por excentricidade: perfil lateral dá azimute baixo; sem píxeis é ambígua declarada', () => {
    const img = sideCarRgba();
    const ev = extractEvidence(img);
    const lm = detectWheelLandmarks(ev, img);
    const cam = estimateCamera(ev, lm, [{ widthPx: 33, heightPx: 34 }, { widthPx: 33, heightPx: 34 }]);
    expect(cam.azimuthDeg).toBeLessThan(20);
    expect(cam.kind).toBe('side');
    const silhouetteOnly = estimateCamera(ev, detectWheelLandmarks(ev));
    expect(silhouetteOnly.ambiguous).toBe(true);
    expect(silhouetteOnly.uncertaintyDeg).toBeGreaterThanOrEqual(20);
  });
  it('máscara poligonal (sem píxeis): contactos dão centros; rodas em falta declaradas', () => {
    const base = extractEvidence(blank());
    const ev = correctedEvidence(base, {
      polygon: [[0.08, 0.52], [0.14, 0.38], [0.30, 0.30], [0.55, 0.30], [0.72, 0.38], [0.88, 0.48], [0.90, 0.62], [0.82, 0.64], [0.80, 0.86], [0.68, 0.86], [0.66, 0.66], [0.36, 0.66], [0.34, 0.86], [0.22, 0.86], [0.20, 0.64], [0.09, 0.62]],
      confirmedAt: '2026-11-05T00:00:00.000Z', provenance: 'user_confirmed',
    });
    const lm = detectWheelLandmarks(ev);
    expect(lm.source).toBe('silhouette-contacts');
    expect(lm.wheels.length).toBeGreaterThanOrEqual(2);
  });
});
