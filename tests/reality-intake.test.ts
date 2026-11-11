import { describe, it, expect } from 'vitest';
import { BoxGeometry, SphereGeometry, CylinderGeometry, BufferGeometry, Vector3 } from 'three';
import { makeView, rasterise, type Tri } from '../src/universal-spatial/reconstruction/silhouette';
import { orbitDirection } from '../src/universal-spatial/reconstruction/multiview';
import { chamfer, geometryPoints, samplePoints } from '../src/universal-spatial/reconstruction/multiview-metrics';
import { intakeOrbit, intakeDrawing, selectKeyFrames, type IntakeImage } from '../src/living/reality/intake';
import { buildModel, partGeometry, FRAME_HALF_PER_DIAGONAL } from '../src/living/reality/model';
import { validateRealityEvidence, encodeMask, decodeMask, encodeColour, decodeColour, evidenceSha256 } from '../src/living/reality/evidence';

const trisOf = (g: BufferGeometry, offset = new Vector3()): Tri[] => {
  const p = g.getAttribute('position'), idx = g.index, out: Tri[] = [], at = (i: number) => new Vector3(p.getX(i), p.getY(i), p.getZ(i)).add(offset), n = idx ? idx.count : p.count;
  for (let i = 0; i < n; i += 3) out.push(idx ? [at(idx.getX(i)), at(idx.getX(i + 1)), at(idx.getX(i + 2))] : [at(i), at(i + 1), at(i + 2)]);
  return out;
};
const solid = (): Tri[] => [...trisOf(new BoxGeometry(1.2, 0.6, 0.5)), ...trisOf(new SphereGeometry(0.35, 24, 16), new Vector3(0.55, 0.4, 0.1)), ...trisOf(new CylinderGeometry(0.12, 0.12, 0.9, 16), new Vector3(-0.3, -0.5, -0.1))];
const bboxOf = (tris: Tri[]) => { const mn = new Vector3(Infinity, Infinity, Infinity), mx = new Vector3(-Infinity, -Infinity, -Infinity); for (const t of tris) for (const p of t) { mn.min(p); mx.max(p); } return { mn, mx, c: mn.clone().add(mx).multiplyScalar(0.5), diag: mx.clone().sub(mn).length() }; };

/** Renders a "photograph": object colour on a plain background, fixed camera, object at scale k image-heights per world unit, offset in the frame. */
function photo(tris: Tri[], az: number, el: number, k: number, W = 320, Hh = 240, off: [number, number] = [14, -9], colour: [number, number, number] = [180, 60, 40]): IntakeImage {
  const b = bboxOf(tris), half = FRAME_HALF_PER_DIAGONAL * b.diag, res = 192;
  const mask = rasterise(tris, makeView(orbitDirection(az, el), b.c, half, res));
  const data = new Uint8ClampedArray(W * Hh * 4), cx = W / 2 + off[0], cy = Hh / 2 + off[1];
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const u = (x + 0.5 - cx) / (Hh * k), v = (cy - (y + 0.5)) / (Hh * k), X = Math.floor((u / half + 1) / 2 * res), Y = Math.floor((v / half + 1) / 2 * res);
    const inside = X >= 0 && Y >= 0 && X < res && Y < res && mask[Y * res + X];
    const i = (y * W + x) * 4; data[i] = inside ? colour[0] : 238; data[i + 1] = inside ? colour[1] : 240; data[i + 2] = inside ? colour[2] : 236; data[i + 3] = 255;
  }
  return { name: `photo-${az}-${el}.jpg`, rgba: { width: W, height: Hh, data } };
}

describe('evidência guardada', () => {
  it('RLE de máscara e RGB565 fazem ida e volta; a validação recusa lixo', () => {
    const m = new Uint8Array(64 * 64); for (let i = 0; i < m.length; i++) m[i] = (i % 7 < 3 ? 1 : 0);
    expect(Buffer.from(decodeMask(encodeMask(m), m.length)).equals(Buffer.from(m))).toBe(true);
    const rgb = new Uint8Array(8 * 8 * 3).map((_, i) => (i * 37) % 256), back = decodeColour(encodeColour(rgb, 8), 8);
    expect(Math.max(...[...rgb].map((v, i) => Math.abs(v - back[i]!)))).toBeLessThanOrEqual(8);
    expect(() => decodeMask('zz,zz', 10)).toThrow(/INVALID/);
    expect(() => validateRealityEvidence({ contract: 'x' })).toThrow(/CONTRACT/);
  });
});

describe('intake multivista de fotografias', () => {
  const gt = solid(), b = bboxOf(gt), k = 0.5 / (b.mx.y - b.mn.y); // altura do objecto = 50% da imagem
  const azs = [0, 45, 90, 135, 180, 225, 270, 315];
  it('reconstrói a partir de fotografias com enquadramento deslocado; erro de superfície limitado e declara pressupostos', async () => {
    const imgs = azs.map((a, i) => photo(gt, a, 0, k, 320, 240, [14, -9], [180, 60 + i, 40]));
    const r = intakeOrbit(imgs);
    expect(r.refusals).toEqual([]);
    const ev = validateRealityEvidence(r.evidence);
    expect(ev.mode).toBe('turntable'); expect(ev.views.every((v) => v.azimuthSource === 'assumed')).toBe(true);
    expect(ev.assumptions.join(' ')).toMatch(/Elevação.*desconhecida/);
    const model = buildModel(ev);
    const pts = model.parts.flatMap((p) => { const g = partGeometry(p); return geometryPoints(g, 1500, 5).map((q) => q.add(new Vector3(...p.origin))); }).map((q) => q.clone().divideScalar(k).add(b.c));
    const c = chamfer(pts, samplePoints(gt, 3000, 2));
    expect(c.symmetric / b.diag).toBeLessThan(0.05); // < 5% da diagonal com enquadramento realista
    expect(model.hull.depthObserved).toBe(true);
    expect(model.observedFraction).toBeGreaterThan(0.5);
    expect(await evidenceSha256(ev)).toBe(await evidenceSha256(validateRealityEvidence(JSON.parse(JSON.stringify(ev))))); // sha estável
  }, 120_000);
  it('é determinístico: a mesma evidência dá a mesma malha, byte a byte', () => {
    const ev = intakeOrbit(azs.slice(0, 6).map((a) => photo(gt, a, 0, k)), { cells: 48 }).evidence!;
    const a = buildModel(ev), c = buildModel(JSON.parse(JSON.stringify(ev)));
    expect(a.parts.length).toBe(c.parts.length);
    for (let i = 0; i < a.parts.length; i++) expect(Buffer.from(a.parts[i]!.positions.buffer).equals(Buffer.from(c.parts[i]!.positions.buffer))).toBe(true);
  }, 120_000);
  it('recusa: menos de 2 vistas, máscara não fiável (fundo ruidoso), contagem de poses errada', () => {
    expect(intakeOrbit([photo(gt, 0, 0, k)]).refusals[0]!.code).toBe('TOO_FEW_VIEWS');
    expect(intakeOrbit([photo(gt, 0, 0, k), photo(gt, 90, 0, k)], { azimuthsDeg: [0] }).refusals[0]!.code).toBe('POSE_COUNT_MISMATCH');
    const noisy = photo(gt, 0, 0, k); for (let i = 0; i < noisy.rgba.data.length; i += 4) { const n = (Math.sin(i * 12.9898) * 43758.5453) % 1; noisy.rgba.data[i] = 128 + n * 120; noisy.rgba.data[i + 1] = 128 - n * 100; noisy.rgba.data[i + 2] = 90 + n * 150; }
    expect(intakeOrbit([noisy, photo(gt, 90, 0, k)]).refusals.some((x) => x.code === 'MASK_UNRELIABLE')).toBe(true);
  });
  it('azimutes declarados ficam "given" e o intake nunca inventa elevação medida', () => {
    const r = intakeOrbit([photo(gt, 0, 20, k), photo(gt, 90, 20, k), photo(gt, 180, 20, k)], { azimuthsDeg: [0, 90, 180], elevationDeg: 20 });
    expect(r.evidence!.views.every((v) => v.azimuthSource === 'given' && v.elevationDeg === 20)).toBe(true);
    expect(r.evidence!.assumptions.join(' ')).toMatch(/Órbita parcial/);
  }, 60_000);
  it('selectKeyFrames escolhe frames diversos preservando a ordem temporal', () => {
    const frames = Array.from({ length: 30 }, (_, i) => ({ mask: rasterise(gt, makeView(orbitDirection(i * 12, 0), b.c, FRAME_HALF_PER_DIAGONAL * b.diag, 48)) }));
    const picks = selectKeyFrames(frames, 6);
    expect(picks.length).toBe(6); expect([...picks].sort((x, y) => x - y)).toEqual(picks); expect(new Set(picks).size).toBe(6);
  });
});

describe('intake de desenho técnico (3 vistas)', () => {
  const gt = solid(), b = bboxOf(gt), res = 192, half = FRAME_HALF_PER_DIAGONAL * b.diag;
  // desenho: máscaras ortogonais à mesma escala, na convenção documentada (topo = vista da câmara rodada 180°)
  const sheet = (az: number, el: number, rot180 = false): IntakeImage => {
    const m = rasterise(gt, makeView(orbitDirection(az, el), b.c, half, res)), W = 200, Hh = 160, data = new Uint8ClampedArray(W * Hh * 4), s = Hh / (2 * half) * 0.9;
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
      let u = (x + 0.5 - W / 2) / s, v = (Hh / 2 - (y + 0.5)) / s; if (rot180) { u = -u; v = -v; }
      const X = Math.floor((u / half + 1) / 2 * res), Y = Math.floor((v / half + 1) / 2 * res), inside = X >= 0 && Y >= 0 && X < res && Y < res && m[Y * res + X];
      const i = (y * W + x) * 4; data[i] = data[i + 1] = data[i + 2] = inside ? 40 : 255; data[i + 3] = 255;
    }
    return { name: `sheet-${az}-${el}`, rgba: { width: W, height: Hh, data } };
  };
  it('reconstrói sólido coerente com o ground truth a partir de 3 vistas ortográficas', () => {
    const r = intakeDrawing({ front: sheet(0, 0), side: sheet(90, 0), top: sheet(0, 90, true) });
    expect(r.refusals).toEqual([]);
    const model = buildModel(r.evidence!);
    expect(model.parts.length).toBeGreaterThan(0);
    const scale = Math.min(200, 160) / (2 * half) * 0.9; // unidades de pixel -> mundo: as vistas usam 1 unidade = 1 pixel de folha
    void scale;
    expect(model.hull.depthObserved).toBe(true);
    expect(r.evidence!.assumptions.join(' ')).toMatch(/Escala absoluta desconhecida/);
  }, 60_000);
  it('recusa um desenho cujas vistas não partilham dimensões', () => {
    const wrongTop = sheet(0, 90, true); // topo correcto
    const bad = sheet(90, 0); // uma "frente" falsa: é a vista lateral, que tem outra largura
    const r = intakeDrawing({ front: bad, side: sheet(90, 0), top: wrongTop });
    expect(r.refusals[0]?.code).toBe('DRAWING_INCONSISTENT');
    expect(r.evidence).toBeNull();
    expect(intakeDrawing({ front: sheet(0, 0) }).refusals.map((x) => x.code)).toContain('MISSING_DRAWING_VIEW');
  });
});
