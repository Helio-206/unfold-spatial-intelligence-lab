import { describe, it, expect } from 'vitest';
import { assessCapture, sharpness, viewQuality, type CaptureView } from '../src/living/reality/capture-quality';

const W = 160, H = 120;
function image(blur: number, bright = 120, cut = false) {
  const data = new Uint8ClampedArray(W * H * 4), mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const inside = x >= (cut ? 0 : 30) && x < 130 && y >= 25 && y < 95, i = (y * W + x) * 4;
    // texture: fine checker inside the object, smoothed by `blur` box passes below
    const v = inside ? (((x >> 1) + (y >> 1)) % 2 ? bright + 60 : bright - 60) : 240;
    data[i] = data[i + 1] = data[i + 2] = Math.max(0, Math.min(255, v)); data[i + 3] = 255; mask[y * W + x] = inside ? 1 : 0;
  }
  for (let pass = 0; pass < blur; pass++) { const c = Uint8ClampedArray.from(data); for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = (y * W + x) * 4; const s = (c[i - 4]! + c[i + 4]! + c[i - W * 4]! + c[i + W * 4]! + c[i]!) / 5; data[i] = data[i + 1] = data[i + 2] = s; } }
  return { rgba: { width: W, height: H, data }, mask };
}
const view = (az: number, el: number, over: Partial<CaptureView> = {}, img = image(0)): CaptureView => ({ azimuthDeg: az, elevationDeg: el, quality: viewQuality(img.rgba, img.mask), mask: img.mask, width: W, height: H, bboxSide: 100, ...over });

describe('qualidade de imagem', () => {
  it('a nitidez desce monotonicamente com o desfoque', () => {
    const s = [0, 1, 3, 8].map((b) => { const i = image(b); return sharpness(i.rgba, i.mask); });
    expect(s[0]!).toBeGreaterThan(s[1]!); expect(s[1]!).toBeGreaterThan(s[2]!); expect(s[2]!).toBeGreaterThan(s[3]!);
  });
  it('detecta vista desfocada, sobre/sub-exposta, pequena e cortada, com conselho em português', () => {
    const base = [0, 60, 120, 180, 240, 300].map((a) => view(a, 30));
    base[2] = view(120, 30, {}, image(8));
    base[3] = view(180, 30, {}, image(0, 250));
    base[4] = view(240, 30, { bboxSide: 60 });
    base[5] = view(300, 30, {}, image(0, 120, true));
    const codes = (r: ReturnType<typeof assessCapture>) => r.issues.map((i) => `${i.code}:${i.viewIndexes.join(',')}`);
    const r = assessCapture(base);
    expect(codes(r)).toEqual(expect.arrayContaining(['BLURRY:2', 'OVEREXPOSED:3', 'LOW_RESOLUTION:4', 'OBJECT_CUT_OFF:5']));
    expect(r.ok).toBe(false); // objecto cortado aconselha refazer
    expect(r.issues.every((i) => i.advice.length > 10 && i.message.length > 10)).toBe(true);
  });
  it('conjunto limpo e bem coberto: sem avisos', () => {
    const r = assessCapture([0, 60, 120, 180, 240, 300].map((a, i) => view(a, i % 2 ? 50 : 10)));
    expect(r.issues).toEqual([]); expect(r.ok).toBe(true);
  });
});

describe('cobertura e redundância', () => {
  it('lacuna angular: indica o sector e o azimute a fotografar', () => {
    const r = assessCapture([0, 40, 80, 120, 160].map((a) => view(a, 20)));
    const gap = r.issues.find((i) => i.code === 'ANGULAR_GAP')!;
    expect(gap.message).toMatch(/160° e 0°/); expect(gap.advice).toMatch(/260°/);
    expect(r.coverage.azimuthMaxGapDeg).toBeCloseTo(200, 5);
  });
  it('só uma altura: aconselha vistas de cima; com vistas elevadas deixa de avisar', () => {
    expect(assessCapture([0, 60, 120, 180, 240, 300].map((a) => view(a, 0))).issues.map((i) => i.code)).toContain('NO_ELEVATION_VARIETY');
    expect(assessCapture([0, 60, 120, 180, 240, 300].map((a, i) => view(a, i < 4 ? 0 : 60))).issues.map((i) => i.code)).not.toContain('NO_ELEVATION_VARIETY');
  });
  it('vistas redundantes e vistas a menos', () => {
    const dup = assessCapture([0, 5, 90, 180, 270].map((a) => view(a, 20)));
    expect(dup.issues.find((i) => i.code === 'REDUNDANT_VIEW')!.viewIndexes).toEqual([0, 1]);
    expect(assessCapture([view(0, 0)]).issues.map((i) => i.code)).toContain('TOO_FEW_VIEWS');
  });
  it('escala desigual entre vistas é assinalada', () => {
    const r = assessCapture([0, 90, 180, 270].map((a, i) => view(a, 20, { bboxSide: i === 2 ? 220 : 100 })));
    expect(r.issues.find((i) => i.code === 'UNEVEN_FRAMING')!.viewIndexes).toEqual([2]);
  });
});
