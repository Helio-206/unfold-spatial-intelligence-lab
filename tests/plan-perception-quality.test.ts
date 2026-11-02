import { describe, expect, it } from 'vitest';

import { selectStructuralWallCandidates } from '../src/plan-perception-quality';
import { traceWallCandidate, type PixelWallCandidate } from '../src/plan-reconstruction';

function automatic(id: string, start: [number, number], end: [number, number], thicknessPx: number): PixelWallCandidate {
  return { ...traceWallCandidate(id, { x: start[0], y: start[1] }, { x: end[0], y: end[1] }, thicknessPx), origin: 'automatic_detection' };
}

describe('structural wall candidate selection', () => {
  it('keeps thick continuous walls and places thin furniture lines in the review fallback', () => {
    const candidates = [
      automatic('top', [10, 10], [190, 10], 7), automatic('right', [190, 10], [190, 130], 7),
      automatic('bottom', [190, 130], [10, 130], 7), automatic('left', [10, 130], [10, 10], 7),
      automatic('table-top', [65, 55], [125, 55], 1), automatic('table-right', [125, 55], [125, 85], 1),
      automatic('table-bottom', [125, 85], [65, 85], 1), automatic('table-left', [65, 85], [65, 55], 1),
    ];
    const result = selectStructuralWallCandidates(candidates, { width: 220, height: 150 });
    expect(result.applied).toBe(true);
    expect(result.structural.map((candidate) => candidate.id).sort()).toEqual(['bottom', 'left', 'right', 'top']);
    expect(result.review.map((candidate) => candidate.id).sort()).toEqual(['table-bottom', 'table-left', 'table-right', 'table-top']);
    expect(result.thresholds).toMatchObject({ minimumThicknessPx: 6, maximumThicknessPx: 21 });
  });

  it('retains a short thick segment when both endpoints have orthogonal support', () => {
    const candidates = [
      automatic('short', [50, 50], [80, 50], 6), automatic('left', [50, 20], [50, 90], 6), automatic('right', [80, 20], [80, 90], 6),
      automatic('long', [10, 110], [190, 110], 6), automatic('noise-a', [10, 140], [40, 140], 1), automatic('noise-b', [50, 140], [80, 140], 1),
    ];
    const result = selectStructuralWallCandidates(candidates, { width: 400, height: 300 });
    expect(result.thresholds?.minimumLengthPx).toBe(24);
    expect(result.structural.map((candidate) => candidate.id)).toContain('short');
    expect(result.quality.find((item) => item.candidateId === 'short')?.perpendicularEndpointSupports).toBe(2);
  });

  it('preserves every raw candidate and declines quadratic work above the explicit resource bound', () => {
    const candidates = Array.from({ length: 5 }, (_, index) => automatic(`line-${index}`, [0, index * 10], [100, index * 10], 5));
    const result = selectStructuralWallCandidates(candidates, { width: 100, height: 100 }, { maximumCandidateCount: 4 });
    expect(result).toMatchObject({ applied: false, structural: [], fallbackReason: 'candidate_limit_exceeded', thresholds: null });
    expect(result.review).toEqual(candidates);
  });

  it('rejects invalid dimensions and parameters explicitly', () => {
    const candidates = [automatic('a', [0, 0], [100, 0], 5), automatic('b', [0, 10], [100, 10], 5), automatic('c', [0, 20], [100, 20], 5), automatic('d', [0, 30], [100, 30], 5)];
    expect(() => selectStructuralWallCandidates(candidates, { width: 0, height: 100 })).toThrow('Dimensões inválidas');
    expect(() => selectStructuralWallCandidates(candidates, { width: 100, height: 100 }, { minimumLengthRatio: 0 })).toThrow('Parâmetros inválidos');
    expect(() => selectStructuralWallCandidates([...candidates, { ...candidates[0]! }], { width: 100, height: 100 })).toThrow('Candidato inválido');
  });
});
