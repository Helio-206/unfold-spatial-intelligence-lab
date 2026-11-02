// Browser side of the plan benchmark. It only calls the existing pipeline; nothing here is product code.
import { decodePlanImage } from '../../src/plan-image';
import { buildPlanVectorModel, countClosedCandidateContours, detectCandidateIntersections, detectWallCandidates } from '../../src/plan-reconstruction';

type Timings = Record<string, number>;
const w = window as unknown as { runPipeline: (b64: string, mime: string, opts?: { threshold?: number }) => Promise<unknown>; drawOverlay: (spec: unknown) => string };

async function timed<T>(timings: Timings, name: string, fn: () => T | Promise<T>): Promise<T> {
  const t0 = performance.now();
  const value = await fn();
  timings[name] = performance.now() - t0;
  return value;
}

w.runPipeline = async (b64, mime, opts = {}) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const file = new Blob([bytes], { type: mime });
  const timings: Timings = {};
  const raster = await timed(timings, 'decode (decodePlanImage)', () => decodePlanImage(file));
  // same parameters the editor uses when you press "Detectar linhas"
  const threshold = opts.threshold ?? 150;
  const candidates = await timed(timings, 'detect walls (detectWallCandidates)', () => detectWallCandidates(raster, { threshold, minimumLengthPx: Math.max(24, Math.floor(Math.min(raster.width, raster.height) * 0.045)), gapTolerancePx: 3 }));
  const intersections = await timed(timings, 'intersections', () => detectCandidateIntersections(candidates));
  const tolerancePx = Math.max(6, Math.min(raster.width, raster.height) * 0.008);
  const model = await timed(timings, 'vector model + regions (buildPlanVectorModel)', () => buildPlanVectorModel(candidates, { tolerancePx, imageSize: { width: raster.width, height: raster.height } }));
  const loops = await timed(timings, 'closed contours (countClosedCandidateContours)', () => countClosedCandidateContours(candidates, 10));
  return {
    image: { width: raster.width, height: raster.height, sha256: raster.sha256 },
    threshold, timings, loops, intersections: intersections.length,
    candidates: candidates.map((c) => ({ id: c.id, orientation: c.orientation, start: c.start, end: c.end, thicknessPx: c.thicknessPx, confidence: c.confidence })),
    regions: model.regions.map((r) => ({ id: r.id, eligibility: r.eligibility, areaPx2: r.areaPx2, confidence: r.confidence, vertices: r.vertices, boundaryCandidateIds: r.boundaryCandidateIds, topologyMethod: r.topologyMethod })),
    openingCandidates: model.openingCandidates,
    scale: model.scale,
    limitations: model.limitations,
  };
};
