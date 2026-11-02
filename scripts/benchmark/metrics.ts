export type Interval = [number, number];

export type CoverageMetrics = {
  coverage: number;
  coverageGapTolerant: number;
  endpointErrorPx: number | null;
};

function mergeIntervals(intervals: Interval[], joinTolerancePx: number): Interval[] {
  const merged: Interval[] = [];
  for (const current of intervals) {
    const previous = merged.at(-1);
    if (previous && current[0] <= previous[1] + joinTolerancePx) previous[1] = Math.max(previous[1], current[1]);
    else merged.push([...current]);
  }
  return merged;
}

function coveredLength(intervals: Interval[]): number {
  return intervals.reduce((sum, [low, high]) => sum + high - low, 0);
}

export function unionCoverage(
  intervals: Interval[],
  low: number,
  high: number,
  joinTolerancePx: number,
): CoverageMetrics {
  const clipped = intervals
    .map(([start, end]) => [Math.max(low, start), Math.min(high, end)] as Interval)
    .filter(([start, end]) => end > start)
    .sort((first, second) => first[0] - second[0]);
  if (!clipped.length) return { coverage: 0, coverageGapTolerant: 0, endpointErrorPx: null };

  const exact = mergeIntervals(clipped, 0);
  const gapTolerant = mergeIntervals(clipped, joinTolerancePx);
  const denominator = Math.max(1, high - low);
  const predictedLow = Math.min(...intervals.map(([start]) => start));
  const predictedHigh = Math.max(...intervals.map(([, end]) => end));
  return {
    coverage: coveredLength(exact) / denominator,
    coverageGapTolerant: coveredLength(gapTolerant) / denominator,
    endpointErrorPx: (Math.abs(predictedLow - low) + Math.abs(predictedHigh - high)) / 2,
  };
}

export type RegionBox = { id: string; x0: number; y0: number; x1: number; y1: number };

export function boxIoU(first: RegionBox, second: RegionBox): number {
  const intersection = Math.max(0, Math.min(first.x1, second.x1) - Math.max(first.x0, second.x0))
    * Math.max(0, Math.min(first.y1, second.y1) - Math.max(first.y0, second.y0));
  const firstArea = (first.x1 - first.x0) * (first.y1 - first.y0);
  const secondArea = (second.x1 - second.x0) * (second.y1 - second.y0);
  return intersection / Math.max(1, firstArea + secondArea - intersection);
}

export type RegionMatch = { predictionIndex: number; truthIndex: number; boundingBoxIoU: number };

export function matchRegionsOneToOne(
  predictions: RegionBox[],
  truth: RegionBox[],
  minimumIoU = 0.5,
): { matches: RegionMatch[]; bestBoundingBoxIoU: number[] } {
  const scores = truth.map((target) => predictions.map((prediction) => boxIoU(prediction, target)));
  const bestBoundingBoxIoU = scores.map((row) => Math.max(0, ...row));
  const assignedTruthByPrediction = new Map<number, number>();
  const assignedPredictionByTruth = new Map<number, number>();

  const augment = (truthIndex: number, visitedPredictions: Set<number>): boolean => {
    const candidates = scores[truthIndex]!
      .map((score, predictionIndex) => ({ score, predictionIndex }))
      .filter(({ score }) => score >= minimumIoU)
      .sort((first, second) => second.score - first.score);
    for (const { predictionIndex } of candidates) {
      if (visitedPredictions.has(predictionIndex)) continue;
      visitedPredictions.add(predictionIndex);
      const previousTruthIndex = assignedTruthByPrediction.get(predictionIndex);
      if (previousTruthIndex === undefined || augment(previousTruthIndex, visitedPredictions)) {
        const previousPredictionIndex = assignedPredictionByTruth.get(truthIndex);
        if (previousPredictionIndex !== undefined) assignedTruthByPrediction.delete(previousPredictionIndex);
        assignedTruthByPrediction.set(predictionIndex, truthIndex);
        assignedPredictionByTruth.set(truthIndex, predictionIndex);
        return true;
      }
    }
    return false;
  };

  for (let truthIndex = 0; truthIndex < truth.length; truthIndex += 1) augment(truthIndex, new Set());
  const matches = [...assignedTruthByPrediction.entries()].map(([predictionIndex, truthIndex]) => ({
    predictionIndex,
    truthIndex,
    boundingBoxIoU: scores[truthIndex]![predictionIndex]!,
  }));
  return { matches, bestBoundingBoxIoU };
}
