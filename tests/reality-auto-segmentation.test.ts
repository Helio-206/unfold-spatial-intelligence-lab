import { describe, it, expect } from 'vitest';
import { autoOutlines, maskCredibility, selectOutline, type Candidate } from '../src/living/reality/auto-segmentation';
import type { SodRunner } from '../src/living/reality/sod';

const W = 120, H = 90;
const disc = (cx: number, cy: number, r: number) => { const m = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.hypot(x - cx, y - cy) < r) m[y * W + x] = 1; return m; };
const noisyBg = (seed = 1) => { let s = seed; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); return (cx: number, cy: number, r: number) => { const d = new Uint8ClampedArray(W * H * 4); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4, on = Math.hypot(x - cx, y - cy) < r, n = rnd() * 50; d[i] = on ? 210 : 90 + n; d[i + 1] = on ? 60 : 110 + n; d[i + 2] = on ? 50 : 100 + n; d[i + 3] = 255; } return { width: W, height: H, data: d }; }; };

describe('credibilidade de uma máscara', () => {
  it('aceita um objecto compacto, recusa vazio, borda, fragmentado e quase-tudo', () => {
    expect(maskCredibility(disc(60, 45, 25), W, H)).toBe(true);
    expect(maskCredibility(new Uint8Array(W * H), W, H)).toBe(false);
    expect(maskCredibility(disc(2, 45, 25), W, H)).toBe(false); // encostado à borda
    const two = disc(25, 45, 12); two.forEach((v, i) => { if (v === 0) two[i] = disc(95, 45, 12)[i]!; }); expect(maskCredibility(two, W, H)).toBe(false); // metades iguais: nenhuma domina
    expect(maskCredibility(new Uint8Array(W * H).fill(1), W, H)).toBe(false);
  });
});
describe('selecção do contorno por consenso', () => {
  it('prefere o candidato que concorda com os outros e ignora o não credível', () => {
    const good = disc(60, 45, 25), near = disc(61, 45, 25), bad = disc(5, 5, 4);
    const r = selectOutline([{ method: 'classical-colour', mask: bad }, { method: 'salient-network', mask: near }, { method: 'static-background', mask: good }], W, H);
    expect(r.credible).toBe(true); expect(r.method).toBe('static-background'); expect(r.consensus).toBeGreaterThan(0.9);
    expect(r.considered.find((c) => c.method === 'classical-colour')!.credible).toBe(false);
  });
  it('um candidato credível sozinho é aceite mas declarado como sem confirmação; nenhum credível devolve null (vai para o editor)', () => {
    const one = selectOutline([{ method: 'salient-network', mask: disc(60, 45, 25) }], W, H); expect(one.credible).toBe(true); expect(one.note).toMatch(/sem confirmação/);
    const none = selectOutline([{ method: 'classical-colour', mask: new Uint8Array(W * H) }], W, H); expect(none.mask).toBeNull(); expect(none.note).toMatch(/Ajustar contorno/);
  });
  it('em empate de concordância, a estratégia mais específica ganha', () => {
    const m = disc(60, 45, 25), r = selectOutline([{ method: 'classical-colour', mask: m }, { method: 'salient-network', mask: m.slice() }] as Candidate[], W, H);
    expect(r.method).toBe('salient-network');
  });
});
describe('autoOutlines', () => {
  it('sem modelo e sem fundo estático usa a cor clássica e diz qual; com um modelo simulado indisponível não o usa', async () => {
    const make = noisyBg(2), im = make(60, 45, 25), sod: SodRunner = { available: async () => false, run: async () => { throw new Error('must not run'); } };
    const [r] = await autoOutlines([im], { sod });
    expect(r.considered.map((c) => c.method)).toEqual(['classical-colour']);
  });
  it('com um modelo disponível junta o candidato da rede; o fundo estático só entra com ≥ 3 imagens iguais', async () => {
    const make = noisyBg(3), a = make(60, 45, 25), sod: SodRunner = { available: async () => true, run: async (im) => { const s = new Float32Array(im.width * im.height); for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) s[y * im.width + x] = Math.hypot(x - 60, y - 45) < 25 ? 1 : 0; return s; } };
    const one = await autoOutlines([a], { sod }); expect(one[0]!.considered.map((c) => c.method)).toContain('salient-network'); expect(one[0]!.considered.map((c) => c.method)).not.toContain('static-background');
    expect(one[0]!.credible).toBe(true);
  }, 60_000);
});
