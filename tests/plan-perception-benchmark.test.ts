import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { selectStructuralWallCandidates } from '../src/plan-perception-quality';
import type { PixelWallCandidate, Point2 } from '../src/plan-reconstruction';

const readJson = <T>(relativePath: string): T => JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8')) as T;

function candidateCovers(candidate: PixelWallCandidate, start: Point2, end: Point2, tolerancePx: number): boolean {
  const horizontal = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y);
  if (candidate.orientation !== (horizontal ? 'horizontal' : 'vertical')) return false;
  const coordinate = horizontal ? (candidate.start.y + candidate.end.y) / 2 : (candidate.start.x + candidate.end.x) / 2;
  const targetCoordinate = horizontal ? (start.y + end.y) / 2 : (start.x + end.x) / 2;
  if (Math.abs(coordinate - targetCoordinate) > tolerancePx) return false;
  const prediction = horizontal ? [candidate.start.x, candidate.end.x] : [candidate.start.y, candidate.end.y];
  const target = horizontal ? [start.x, end.x] : [start.y, end.y];
  return Math.min(Math.max(...prediction), Math.max(...target)) > Math.max(Math.min(...prediction), Math.min(...target));
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
    const matched = annotations.walls.filter((wall) => selected.structural.some((candidate) => candidateCovers(candidate, wall.start, wall.end, 20)));
    expect(matched.length).toBeGreaterThanOrEqual(3);
    expect(selected.structural.length).toBeLessThan(raw.candidates.length);
  });
});
