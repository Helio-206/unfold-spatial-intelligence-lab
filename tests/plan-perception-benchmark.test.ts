import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { matchRegionsOneToOne, unionCoverage, type RegionBox } from '../scripts/benchmark/metrics';
import { selectStructuralWallCandidates } from '../src/plan-perception-quality';
import { traceWallCandidate, type PixelWallCandidate, type Point2 } from '../src/plan-reconstruction';

const readJson = <T>(relativePath: string): T => JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8')) as T;

function candidatesCover(candidates: PixelWallCandidate[], start: Point2, end: Point2, tolerancePx: number): boolean {
  const horizontal = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y);
  const targetCoordinate = horizontal ? (start.y + end.y) / 2 : (start.x + end.x) / 2;
  const target = horizontal ? [start.x, end.x] : [start.y, end.y];
  const [low, high] = [Math.min(...target), Math.max(...target)];
  const intervals = candidates
    .filter((candidate) => {
      if (candidate.orientation !== (horizontal ? 'horizontal' : 'vertical')) return false;
      const coordinate = horizontal ? (candidate.start.y + candidate.end.y) / 2 : (candidate.start.x + candidate.end.x) / 2;
      return Math.abs(coordinate - targetCoordinate) <= tolerancePx;
    })
    .map((candidate) => {
      const values = horizontal ? [candidate.start.x, candidate.end.x] : [candidate.start.y, candidate.end.y];
      return [Math.min(...values), Math.max(...values)] as [number, number];
    });
  return unionCoverage(intervals, low, high, tolerancePx).coverage >= 0.6;
}

describe('perception quality benchmark gates', () => {
  it('raises candidate precision on stored sample-1 evidence without hiding the recall trade-off', () => {
    const raw = readJson<{ image: { width: number; height: number }; candidates: PixelWallCandidate[] }>('../reports/benchmark/data/sample-1.raw.json');
    const labels = readJson<{ candidatesDetail: Array<{ id: string; class: string }> }>('../reports/benchmark/data/sample-1.walls.json');
    const realIds = new Set(labels.candidatesDetail.filter((candidate) => candidate.class.startsWith('wall')).map((candidate) => candidate.id));
    const selected = selectStructuralWallCandidates(raw.candidates, raw.image);
    const truePositive = selected.structural.filter((candidate) => realIds.has(candidate.id)).length;
    const precision = truePositive / selected.structural.length;
    const recall = truePositive / realIds.size;
    expect(selected.applied).toBe(true);
    expect(precision).toBeGreaterThanOrEqual(0.8);
    expect(recall).toBeGreaterThanOrEqual(0.5);
    expect(recall).toBeLessThan(0.6);
    expect(selected.review.length + selected.structural.length).toBe(raw.candidates.length);
  });

  it('retains evidence for at least three prior perimeter traces on the independent Amoureaux plan', () => {
    const raw = readJson<{ image: { width: number; height: number }; candidates: PixelWallCandidate[] }>('../reports/benchmark/data/amoureaux.raw.json');
    const annotations = readJson<{ walls: Array<{ id: string; start: Point2; end: Point2 }> }>('../reports/benchmark/annotations/amoureaux-perimeter.evaluation.json');
    const selected = selectStructuralWallCandidates(raw.candidates, raw.image);
    const matched = annotations.walls.filter((wall) => candidatesCover(selected.structural, wall.start, wall.end, 20));
    expect(matched.length).toBeGreaterThanOrEqual(3);
    expect(selected.structural.length).toBeLessThan(raw.candidates.length);
  });

  it('uses exact physical coverage while exposing gap-tolerant coverage separately', () => {
    const coverage = unionCoverage([[0, 10], [15, 20]], 0, 20, 5);
    expect(coverage.coverage).toBe(0.75);
    expect(coverage.coverageGapTolerant).toBe(1);
    expect(unionCoverage([[0, 10], [15, 20]], 0, 20, 4).coverageGapTolerant).toBe(0.75);
    expect(unionCoverage([[-5, 25]], 0, 20, 0).endpointErrorPx).toBe(5);
    const tiny = { ...traceWallCandidate('tiny', { x: 0, y: 0 }, { x: 1, y: 0 }, 4), origin: 'automatic_detection' as const };
    expect(candidatesCover([tiny], { x: 0, y: 0 }, { x: 100, y: 0 }, 20)).toBe(false);
  });

  it('uses one-to-one matching for bounding-box room recall', () => {
    const prediction: RegionBox = { id: 'wide', x0: 0, y0: 0, x1: 20, y1: 10 };
    const truth: RegionBox[] = [
      { id: 'left', x0: 0, y0: 0, x1: 10, y1: 10 },
      { id: 'right', x0: 10, y0: 0, x1: 20, y1: 10 },
    ];
    const matching = matchRegionsOneToOne([prediction], truth);
    expect(matching.matches).toHaveLength(1);
    expect(matching.bestBoundingBoxIoU).toEqual([0.5, 0.5]);

    const rematched = matchRegionsOneToOne(
      [
        { id: 'shared', x0: 0, y0: 0, x1: 15, y1: 10 },
        { id: 'fallback', x0: 0, y0: 0, x1: 6, y1: 10 },
      ],
      [
        { id: 'first', x0: 0, y0: 0, x1: 10, y1: 10 },
        { id: 'second', x0: 5, y0: 0, x1: 15, y1: 10 },
      ],
    );
    expect(rematched.matches).toHaveLength(2);
    expect(new Set(rematched.matches.map((match) => match.predictionIndex)).size).toBe(2);
    expect(new Set(rematched.matches.map((match) => match.truthIndex)).size).toBe(2);
  });
});
