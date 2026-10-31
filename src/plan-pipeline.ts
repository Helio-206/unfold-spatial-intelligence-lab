import { decodePlanImage } from './plan-image';
import { detectCandidateIntersections, detectWallCandidates, type CandidateIntersection, type PixelWallCandidate } from './plan-reconstruction';

export type PlanDetection = {
  image: { sha256: string; width: number; height: number; mimeType: string };
  candidates: PixelWallCandidate[];
  intersections: CandidateIntersection[];
};

export async function detectPlanImage(file: Blob, options: { threshold?: number; minimumLengthPx?: number; gapTolerancePx?: number } = {}): Promise<PlanDetection> {
  const image = await decodePlanImage(file);
  const candidates = detectWallCandidates(image, options);
  return {
    image: { sha256: image.sha256, width: image.width, height: image.height, mimeType: image.mimeType },
    candidates,
    intersections: detectCandidateIntersections(candidates),
  };
}
