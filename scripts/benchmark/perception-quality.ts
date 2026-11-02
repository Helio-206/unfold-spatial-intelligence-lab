import fs from 'node:fs';
import { performance } from 'node:perf_hooks';

import { selectStructuralWallCandidates } from '../../src/plan-perception-quality';
import { buildPlanVectorModel, detectWallCandidates, type PixelRaster, type PixelWallCandidate, type PlanRegionCandidate, type Point2 } from '../../src/plan-reconstruction';
import { matchRegionsOneToOne, unionCoverage } from './metrics';

type Segment = { id: string; start: Point2; end: Point2 };
type CandidateLabel = { id: string; class: string };

const readJson = <T>(path: string): T => JSON.parse(fs.readFileSync(path, 'utf8')) as T;
const round = (value: number, digits = 3) => Number(value.toFixed(digits));
const candidateLength = (candidate: Segment) => Math.hypot(candidate.end.x - candidate.start.x, candidate.end.y - candidate.start.y);

function orientation(segment: Segment): number {
  return Math.atan2(segment.end.y - segment.start.y, segment.end.x - segment.start.x);
}

function orientationErrorDegrees(first: Segment, second: Segment): number {
  const raw = Math.abs(orientation(first) - orientation(second)) % Math.PI;
  return raw * 180 / Math.PI > 90 ? 180 - raw * 180 / Math.PI : raw * 180 / Math.PI;
}

function lineCoordinate(segment: Segment): number {
  return Math.abs(segment.end.x - segment.start.x) >= Math.abs(segment.end.y - segment.start.y)
    ? (segment.start.y + segment.end.y) / 2
    : (segment.start.x + segment.end.x) / 2;
}

function interval(segment: Segment): [number, number] {
  const horizontal = Math.abs(segment.end.x - segment.start.x) >= Math.abs(segment.end.y - segment.start.y);
  const values = horizontal ? [segment.start.x, segment.end.x] : [segment.start.y, segment.end.y];
  return [Math.min(...values), Math.max(...values)];
}

function compatible(prediction: Segment, truth: Segment, tolerancePx: number): boolean {
  if (orientationErrorDegrees(prediction, truth) > 5 || Math.abs(lineCoordinate(prediction) - lineCoordinate(truth)) > tolerancePx) return false;
  const [p0, p1] = interval(prediction);
  const [t0, t1] = interval(truth);
  return Math.min(p1, t1) - Math.max(p0, t0) >= Math.min(p1 - p0, t1 - t0) * 0.25;
}

function wallMetrics(predictions: PixelWallCandidate[], truth: Segment[], tolerancePx: number) {
  const predictionMatches = predictions.map((prediction) => truth.filter((target) => compatible(prediction, target, tolerancePx)));
  const truePredictions = predictionMatches.filter((matches) => matches.length > 0).length;
  const truthMetrics = truth.map((target) => {
    const matches = predictions.filter((prediction) => compatible(prediction, target, tolerancePx));
    const [low, high] = interval(target);
    const coverage = unionCoverage(matches.map(interval), low, high, tolerancePx);
    return {
      id: target.id,
      matchedCandidates: matches.length,
      coverage: round(coverage.coverage),
      coverageGapTolerant: round(coverage.coverageGapTolerant),
      endpointErrorPx: coverage.endpointErrorPx === null ? null : round(coverage.endpointErrorPx),
    };
  });
  const orientationErrors = predictions.flatMap((prediction, index) => predictionMatches[index]!.map((target) => orientationErrorDegrees(prediction, target)));
  const detectedTruth = truthMetrics.filter((item) => item.coverage >= 0.6).length;
  return {
    predictions: predictions.length,
    matchedPredictions: truePredictions,
    precision: predictions.length ? round(truePredictions / predictions.length) : null,
    truthSegments: truth.length,
    detectedTruth,
    recall: truth.length ? round(detectedTruth / truth.length) : null,
    meanOrientationErrorDegrees: orientationErrors.length ? round(orientationErrors.reduce((sum, value) => sum + value, 0) / orientationErrors.length) : null,
    meanEndpointErrorPx: (() => {
      const matched = truthMetrics.filter((item) => item.endpointErrorPx !== null);
      return matched.length
        ? round(matched.reduce((sum, item) => sum + item.endpointErrorPx!, 0) / matched.length)
        : null;
    })(),
    truth: truthMetrics,
  };
}

function labeledPrecisionRecall(predictions: PixelWallCandidate[], labels: CandidateLabel[]) {
  const predictedIds = new Set(predictions.map((candidate) => candidate.id));
  const realIds = new Set(labels.filter((candidate) => candidate.class.startsWith('wall')).map((candidate) => candidate.id));
  const truePositive = predictions.filter((candidate) => realIds.has(candidate.id)).length;
  const falsePositive = predictions.length - truePositive;
  const falseNegative = realIds.size - truePositive;
  const precision = predictions.length ? truePositive / predictions.length : 0;
  const recall = realIds.size ? truePositive / realIds.size : 0;
  return {
    predicted: predictions.length, truePositive, falsePositive, falseNegative,
    precision: round(precision), recall: round(recall), f1: truePositive ? round(2 * precision * recall / (precision + recall)) : 0,
    falseByCategory: Object.fromEntries([...new Set(labels.filter((candidate) => !candidate.class.startsWith('wall')).map((candidate) => candidate.class))].sort().map((kind) => [kind, labels.filter((candidate) => candidate.class === kind && predictedIds.has(candidate.id)).length])),
  };
}

function pointInside(point: Point2, vertices: Point2[]): boolean {
  let inside = false;
  for (let index = 0; index < vertices.length; index += 1) {
    const first = vertices[index]!;
    const second = vertices[(index + 1) % vertices.length]!;
    if ((first.y > point.y) !== (second.y > point.y) && point.x < (second.x - first.x) * (point.y - first.y) / (second.y - first.y) + first.x) inside = !inside;
  }
  return inside;
}

function roomPointRecall(regions: PlanRegionCandidate[], points: Array<{ name: string; x: number; y: number }>) {
  const eligible = regions.filter((region) => region.eligibility === 'construction_candidate');
  const detected = points.filter((point) => eligible.some((region) => pointInside(point, region.vertices))).map((point) => point.name);
  return { expected: points.length, detected: detected.length, recall: round(detected.length / points.length), detectedNames: detected, polygonIoU: null };
}

function boxForRegion(region: PlanRegionCandidate) {
  const xs = region.vertices.map((point) => point.x);
  const ys = region.vertices.map((point) => point.y);
  return { id: region.id, x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

function roomBoxMetrics(regions: PlanRegionCandidate[], truth: ReturnType<typeof boxForRegion>[]) {
  const predictions = regions.filter((region) => region.eligibility === 'construction_candidate').map(boxForRegion);
  const matching = matchRegionsOneToOne(predictions, truth);
  return {
    expected: truth.length,
    detected: matching.matches.length,
    recall: round(matching.matches.length / truth.length),
    meanBestBoundingBoxIoU: round(matching.bestBoundingBoxIoU.reduce((sum, value) => sum + value, 0) / truth.length),
    bestBoundingBoxIoU: matching.bestBoundingBoxIoU.map((value) => round(value)),
  };
}

function openingMetrics(model: ReturnType<typeof buildPlanVectorModel>, points: Array<[number, number]>, tolerancePx: number) {
  const centres = model.openingCandidates.map((candidate) => ({ x: (candidate.start.x + candidate.end.x) / 2, y: (candidate.start.y + candidate.end.y) / 2 }));
  const matched = points.filter(([x, y]) => centres.some((centre) => Math.hypot(centre.x - x, centre.y - y) <= tolerancePx)).length;
  const matchedCandidates = centres.filter((centre) => points.some(([x, y]) => Math.hypot(centre.x - x, centre.y - y) <= tolerancePx)).length;
  return { expected: points.length, detected: matched, recall: points.length ? round(matched / points.length) : null, candidates: centres.length, matchedCandidates, precision: centres.length ? round(matchedCandidates / centres.length) : null, tolerancePx };
}

function drawRectangle(raster: PixelRaster, x0: number, y0: number, x1: number, y1: number, value = 0): void {
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) raster.grayscale[y * raster.width + x] = value;
}

function syntheticPlan(name: 'clean' | 'noisy') {
  const width = name === 'clean' ? 260 : 360;
  const height = name === 'clean' ? 190 : 260;
  const raster: PixelRaster = { width, height, grayscale: new Uint8Array(width * height).fill(255) };
  const thickness = name === 'clean' ? 7 : 6;
  const half = Math.floor(thickness / 2);
  const x0 = 20; const y0 = 20; const x1 = width - 20; const y1 = height - 20; const partition = Math.round(width * 0.52);
  drawRectangle(raster, x0, y0 - half, x1, y0 + half);
  drawRectangle(raster, x0, y1 - half, x1, y1 + half);
  drawRectangle(raster, x0 - half, y0, x0 + half, y1);
  drawRectangle(raster, x1 - half, y0, x1 + half, y1);
  drawRectangle(raster, partition - half, y0, partition + half, y1);
  if (name === 'noisy') {
    for (const [a, b, c, d] of [[55, 70, 125, 71], [55, 110, 125, 111], [55, 70, 56, 111], [124, 70, 125, 111], [205, 65, 300, 66], [205, 92, 300, 93], [205, 119, 300, 120], [78, 145, 150, 146]] as Array<[number, number, number, number]>) drawRectangle(raster, a, b, c, d, 80);
  }
  const walls: Segment[] = [
    { id: 'top', start: { x: x0, y: y0 }, end: { x: x1, y: y0 } }, { id: 'right', start: { x: x1, y: y0 }, end: { x: x1, y: y1 } },
    { id: 'bottom', start: { x: x1, y: y1 }, end: { x: x0, y: y1 } }, { id: 'left', start: { x: x0, y: y1 }, end: { x: x0, y: y0 } },
    { id: 'partition', start: { x: partition, y: y0 }, end: { x: partition, y: y1 } },
  ];
  const rooms: RegionBox[] = [
    { id: 'left-room', x0, y0, x1: partition, y1 }, { id: 'right-room', x0: partition, y0, x1, y1 },
  ];
  return { id: `synthetic-${name}`, raster, walls, rooms, openings: [] as Array<[number, number]> };
}

function methods(candidates: PixelWallCandidate[], image: { width: number; height: number }) {
  const structural = selectStructuralWallCandidates(candidates, image);
  return {
    baseline: candidates,
    fixedThickness6px: candidates.filter((candidate) => candidate.thicknessPx >= 6),
    adaptiveStructural: structural.structural,
    structuralDiagnostics: structural,
  };
}

function benchmarkSelection(candidates: PixelWallCandidate[], image: { width: number; height: number }) {
  const samples: number[] = [];
  const heapBefore = process.memoryUsage().heapUsed;
  let peakHeap = heapBefore;
  for (let index = 0; index < 100; index += 1) {
    const start = performance.now();
    selectStructuralWallCandidates(candidates, image);
    samples.push(performance.now() - start);
    peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
  }
  samples.sort((a, b) => a - b);
  return { medianLatencyMs: round(samples[Math.floor(samples.length / 2)]!, 4), p95LatencyMs: round(samples[Math.floor(samples.length * 0.95)]!, 4), observedHeapIncreaseBytes: Math.max(0, peakHeap - heapBefore), runs: samples.length };
}

const sampleRaw = readJson<{ image: { width: number; height: number; sha256: string }; candidates: PixelWallCandidate[]; timings: Record<string, number>; regions: PlanRegionCandidate[]; openingCandidates: ReturnType<typeof buildPlanVectorModel>['openingCandidates'] }>('reports/benchmark/data/sample-1.raw.json');
const sampleWalls = readJson<{ candidatesDetail: CandidateLabel[]; proxy: Array<{ orientation: 'horizontal' | 'vertical'; x0: number; x1: number; y0: number; y1: number }>; proxyRuns: number; proxyFound: number; maskPixelsCoveredByRealCandidates: number }>('reports/benchmark/data/sample-1.walls.json');
const sampleAnnotations = readJson<{ source: { rasterAvailable: boolean; licenseStatus: string }; roomPoints: Array<{ name: string; x: number; y: number }>; doors: Array<[number, number]>; windows: Array<[number, number]> }>('reports/benchmark/annotations/sample-1.evaluation.json');
const sampleCandidates = sampleRaw.candidates;
const sampleMethods = methods(sampleCandidates, sampleRaw.image);
const sampleMethodMetrics = Object.fromEntries(Object.entries(sampleMethods).filter(([name]) => name !== 'structuralDiagnostics').map(([name, predictions]) => {
  const selected = predictions as PixelWallCandidate[];
  const model = buildPlanVectorModel(selected, { tolerancePx: Math.max(6, Math.min(sampleRaw.image.width, sampleRaw.image.height) * 0.008), imageSize: sampleRaw.image });
  return [name, {
    walls: labeledPrecisionRecall(selected, sampleWalls.candidatesDetail),
    rooms: roomPointRecall(model.regions, sampleAnnotations.roomPoints),
    openings: openingMetrics(model, [...sampleAnnotations.doors, ...sampleAnnotations.windows], 30),
  }];
}));

const amoureauxRaw = readJson<{ image: { width: number; height: number; sha256: string }; candidates: PixelWallCandidate[]; timings: Record<string, number>; errors: string[] }>('reports/benchmark/data/amoureaux.raw.json');
const amoureauxAnnotations = readJson<{ walls: Segment[]; source: { licenseStatus: string; sourceUrl: string }; notes: string[] }>('reports/benchmark/annotations/amoureaux-perimeter.evaluation.json');
const amoureauxMethods = methods(amoureauxRaw.candidates, amoureauxRaw.image);
const amoureauxMethodMetrics = Object.fromEntries(Object.entries(amoureauxMethods).filter(([name]) => name !== 'structuralDiagnostics').map(([name, predictions]) => {
  const metrics = wallMetrics(predictions as PixelWallCandidate[], amoureauxAnnotations.walls, 20);
  return [name, { walls: { ...metrics, precision: null, precisionReason: 'Only the principal perimeter is annotated; interior predictions are not false positives.' } }];
}));

const synthetic = ['clean', 'noisy'].map((name) => {
  const fixture = syntheticPlan(name as 'clean' | 'noisy');
  const candidates = detectWallCandidates(fixture.raster, { threshold: 150, minimumLengthPx: Math.max(24, Math.floor(Math.min(fixture.raster.width, fixture.raster.height) * 0.045)), gapTolerancePx: 3 });
  const candidateMethods = methods(candidates, fixture.raster);
  return {
    id: fixture.id,
    source: 'self-authored deterministic synthetic fixture',
    methods: Object.fromEntries(Object.entries(candidateMethods).filter(([method]) => method !== 'structuralDiagnostics').map(([method, predictions]) => {
      const selected = predictions as PixelWallCandidate[];
      const model = buildPlanVectorModel(selected, { tolerancePx: Math.max(6, Math.min(fixture.raster.width, fixture.raster.height) * 0.008), imageSize: fixture.raster });
      return [method, { walls: wallMetrics(selected, fixture.walls, 6), rooms: roomBoxMetrics(model.regions, fixture.rooms), openings: openingMetrics(model, fixture.openings, 8) }];
    })),
  };
});

const report = {
  schema: 'unfold.perception_benchmark.v1',
  implementationGate: {
    integratedAsDefault: false,
    reason: 'The adaptive tier improves measured precision but intentionally lowers candidate recall. Raw detector output remains available for review until more independently annotated real plans exist.',
  },
  methods: {
    baseline: 'Existing scanline detector output, unchanged.',
    fixedThickness6px: 'A fixed 6 px thickness gate; included to expose resolution generalization failure.',
    adaptiveStructural: 'Adaptive thickness band plus minimum length or two orthogonal endpoint supports; rejected candidates remain in the review fallback.',
  },
  sample1: {
    evidence: 'stored PR #6 output; source raster unavailable, so the detector was not re-executed',
    source: sampleAnnotations.source,
    baselineDetectorTimingsMs: sampleRaw.timings,
    methods: sampleMethodMetrics,
    structuralThresholds: sampleMethods.structuralDiagnostics.thresholds,
    selectorPerformance: benchmarkSelection(sampleCandidates, sampleRaw.image),
    existingProxyRecall: { proxyRuns: sampleWalls.proxyRuns, proxyFound: sampleWalls.proxyFound, recall: round(sampleWalls.proxyFound / sampleWalls.proxyRuns), maskPixelCoverage: sampleWalls.maskPixelsCoveredByRealCandidates },
    limitations: ['Candidate labels use an approximate colour-mask proxy plus one manual balcony correction.', 'Room points support recall only; polygon IoU is unavailable.', 'The source image license remains unconfirmed.'],
  },
  amoureaux: {
    evidence: 'detector re-executed in system Chrome against the SHA-bound public-domain raster',
    source: amoureauxAnnotations.source,
    browserErrors: amoureauxRaw.errors,
    baselineDetectorTimingsMs: amoureauxRaw.timings,
    methods: amoureauxMethodMetrics,
    structuralThresholds: amoureauxMethods.structuralDiagnostics.thresholds,
    selectorPerformance: benchmarkSelection(amoureauxRaw.candidates, amoureauxRaw.image),
    limitations: amoureauxAnnotations.notes,
  },
  synthetic,
  memoryMeasurement: 'Selector heap increase is an observed process-level upper bound across 100 runs, not isolated allocation profiling.',
};

const outputPath = process.argv[2] ?? 'reports/benchmark/data/perception-quality.json';
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  sample1: Object.fromEntries(Object.entries(sampleMethodMetrics).map(([name, value]) => [name, value.walls])),
  amoureaux: Object.fromEntries(Object.entries(amoureauxMethodMetrics).map(([name, value]) => [name, value.walls])),
  synthetic: synthetic.map((fixture) => ({ id: fixture.id, methods: Object.fromEntries(Object.entries(fixture.methods).map(([name, value]) => [name, { walls: value.walls, rooms: value.rooms }])) })),
  outputPath,
}));
