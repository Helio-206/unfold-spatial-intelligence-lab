import { describe, it, expect } from 'vitest';
import { addPoint, boxFromPercent, boxToPercent, canRedo, canUndo, commit, emptyEdit, erase, fitView, HISTORY_LIMIT, newHistory, normaliseBox, panBy, redo, toHint, toImage, toScreen, undo, zoomAt, MAX_ZOOM, MIN_ZOOM, type Edit } from '../src/living/reality/editor-state';

const edit = (n: number): Edit => ({ box: { x0: n, y0: n, x1: n + 50, y1: n + 50 }, strokes: [{ kind: 'fg', points: [[n, n]] }] });
describe('histórico do editor de contorno', () => {
  it('undo/redo restauram exactamente cada passo e uma nova edição descarta o ramo refeito', () => {
    let h = newHistory(); h = commit(h, edit(1)); h = commit(h, edit(2)); h = commit(h, edit(3));
    expect(h.present).toEqual(edit(3)); h = undo(h); expect(h.present).toEqual(edit(2)); h = undo(h); expect(h.present).toEqual(edit(1));
    expect(canRedo(h)).toBe(true); h = redo(h); expect(h.present).toEqual(edit(2));
    h = commit(h, edit(9)); expect(canRedo(h)).toBe(false); expect(undo(h).present).toEqual(edit(2));
    expect(canUndo(newHistory())).toBe(false); expect(undo(newHistory())).toEqual(newHistory());
  });
  it('os estados guardados são cópias: alterar o presente não corrompe o passado; o histórico é limitado', () => {
    let h = newHistory(); const e = edit(1); h = commit(h, e); e.strokes[0]!.points.push([99, 99]); expect(h.present.strokes[0]!.points.length).toBe(1);
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) h = commit(h, edit(i)); expect(h.past.length).toBe(HISTORY_LIMIT);
  });
});
describe('caixa, traços e dica para o segmentador', () => {
  it('normaliza e recusa caixas minúsculas; percentagens fazem ida e volta (alternativa por teclado)', () => {
    expect(normaliseBox({ x0: 90, y0: 80, x1: 10, y1: 20 }, 100, 100)).toEqual({ x0: 10, y0: 20, x1: 90, y1: 80 });
    expect(normaliseBox({ x0: 10, y0: 10, x1: 12, y1: 12 }, 100, 100)).toBeNull(); expect(normaliseBox({ x0: -50, y0: -5, x1: 500, y1: 300 }, 200, 100)).toEqual({ x0: 0, y0: 0, x1: 200, y1: 100 });
    const b = boxFromPercent(10, 20, 50, 40, 400, 200)!; expect(boxToPercent(b, 400, 200)).toEqual({ x: 10, y: 20, w: 50, h: 40 });
  });
  it('toHint junta os pontos por tipo; addPoint espaça; erase remove perto e apaga traços vazios', () => {
    const s = { kind: 'fg' as const, points: [] as Array<[number, number]> }; addPoint(s, [0, 0], 5); addPoint(s, [1, 1], 5); addPoint(s, [10, 0], 5); expect(s.points).toEqual([[0, 0], [10, 0]]);
    const e: Edit = { box: { x0: 0, y0: 0, x1: 50, y1: 50 }, strokes: [s, { kind: 'bg', points: [[40, 40]] }] }, h = toHint(e, 7);
    expect(h.foreground).toEqual([[0, 0], [10, 0]]); expect(h.background).toEqual([[40, 40]]); expect(h.brushRadius).toBe(7); expect(h.box).toEqual(e.box);
    const er = erase(e, [0, 0], 3); expect(er.strokes[0]!.points).toEqual([[10, 0]]); expect(erase(er, [10, 0], 3).strokes.length).toBe(1); // só sobra o traço de fundo
    expect(toHint(emptyEdit(), 5).box).toBeUndefined();
  });
});
describe('zoom e deslocamento', () => {
  it('toImage e toScreen são inversas; fitView centra a imagem', () => {
    const v = fitView(800, 400, 600, 400); expect(v.scale).toBeCloseTo(Math.min(576 / 800, 376 / 400)); const [sx, sy] = toScreen(v, 123, 45), [ix, iy] = toImage(v, sx, sy); expect(ix).toBeCloseTo(123); expect(iy).toBeCloseTo(45);
    expect(v.tx).toBeCloseTo((600 - 800 * v.scale) / 2);
  });
  it('o zoom mantém fixo o ponto da imagem sob o cursor e respeita os limites', () => {
    const v = fitView(800, 400, 600, 400), p = toImage(v, 300, 200), z = zoomAt(v, 300, 200, 3), q = toImage(z, 300, 200);
    expect(q[0]).toBeCloseTo(p[0]); expect(q[1]).toBeCloseTo(p[1]); expect(z.scale).toBeCloseTo(v.scale * 3);
    expect(zoomAt(v, 0, 0, 1e6).scale).toBe(MAX_ZOOM); expect(zoomAt(v, 0, 0, 1e-6).scale).toBe(MIN_ZOOM);
  });
  it('o deslocamento nunca deixa a imagem sair por completo do ecrã', () => {
    const v = panBy(fitView(800, 400, 600, 400), 1e6, -1e6, 800, 400, 600, 400); expect(v.tx).toBeLessThanOrEqual(600 - 48); expect(v.ty).toBeGreaterThanOrEqual(48 - 400 * v.scale);
  });
});

describe('fitView on a canvas smaller than its margin (a narrow phone, a collapsing stage)', () => {
  it('never returns a zero or negative scale, so no drawing radius or coordinate flips sign', () => {
    for (const [cw, ch] of [[20, 20], [24, 400], [400, 10], [0, 0]]) { const v = fitView(640, 480, cw, ch, 16); expect(v.scale).toBeGreaterThan(0); expect(Number.isFinite(v.tx) && Number.isFinite(v.ty)).toBe(true); }
  });
});
