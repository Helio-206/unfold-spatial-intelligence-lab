import type { PixelWallCandidate } from './plan-reconstruction';

export type WallCandidateQuality = {
  candidateId: string;
  tier: 'structural' | 'review';
  lengthPx: number;
  perpendicularEndpointSupports: number;
  evidence: string[];
};

export type StructuralWallSelection = {
  applied: boolean;
  structural: PixelWallCandidate[];
  review: PixelWallCandidate[];
  quality: WallCandidateQuality[];
  thresholds: {
    minimumThicknessPx: number;
    maximumThicknessPx: number;
    minimumLengthPx: number;
    endpointTolerancePx: number;
    lowerThicknessQuantile: number;
    thicknessQuantile: number;
  } | null;
  fallbackReason?: 'candidate_limit_exceeded' | 'insufficient_candidates';
};

export type StructuralWallSelectionOptions = {
  maximumCandidateCount?: number;
  minimumCandidateCount?: number;
  endpointTolerancePx?: number;
  minimumLengthRatio?: number;
};

const DEFAULT_MAXIMUM_CANDIDATE_COUNT = 2_000;
const DEFAULT_MINIMUM_CANDIDATE_COUNT = 4;

function quantile(sorted: number[], fraction: number): number {
  return sorted[Math.floor((sorted.length - 1) * fraction)]!;
}

function candidateLength(candidate: PixelWallCandidate): number {
  return Math.hypot(candidate.end.x - candidate.start.x, candidate.end.y - candidate.start.y);
}

function distanceToSegment(point: { x: number; y: number }, candidate: PixelWallCandidate): number {
  const dx = candidate.end.x - candidate.start.x;
  const dy = candidate.end.y - candidate.start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-12) return Number.POSITIVE_INFINITY;
  const projection = Math.max(0, Math.min(1, ((point.x - candidate.start.x) * dx + (point.y - candidate.start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (candidate.start.x + projection * dx), point.y - (candidate.start.y + projection * dy));
}

function perpendicular(first: PixelWallCandidate, second: PixelWallCandidate): boolean {
  const ax = first.end.x - first.start.x;
  const ay = first.end.y - first.start.y;
  const bx = second.end.x - second.start.x;
  const by = second.end.y - second.start.y;
  const denominator = Math.hypot(ax, ay) * Math.hypot(bx, by);
  return denominator > 0 && Math.abs(ax * bx + ay * by) / denominator <= 0.25;
}

function perpendicularEndpointSupports(candidate: PixelWallCandidate, candidates: PixelWallCandidate[], tolerancePx: number): number {
  return [candidate.start, candidate.end].filter((endpoint) => candidates.some((other) => (
    other !== candidate
    && perpendicular(candidate, other)
    && distanceToSegment(endpoint, other) <= tolerancePx
  ))).length;
}

/**
 * Selects a conservative, high-precision tier from the existing detector output.
 * Rejected candidates are retained in `review`; this function never confirms a wall.
 */
export function selectStructuralWallCandidates(
  candidates: PixelWallCandidate[],
  imageSize: { width: number; height: number },
  options: StructuralWallSelectionOptions = {},
): StructuralWallSelection {
  if (!Number.isInteger(imageSize.width) || !Number.isInteger(imageSize.height) || imageSize.width < 1 || imageSize.height < 1) {
    throw new Error('Dimensões inválidas para classificação de candidatos.');
  }
  const maximumCandidateCount = options.maximumCandidateCount ?? DEFAULT_MAXIMUM_CANDIDATE_COUNT;
  const minimumCandidateCount = options.minimumCandidateCount ?? DEFAULT_MINIMUM_CANDIDATE_COUNT;
  const minimumLengthRatio = options.minimumLengthRatio ?? 0.08;
  if (!Number.isInteger(maximumCandidateCount) || maximumCandidateCount < 1 || !Number.isInteger(minimumCandidateCount) || minimumCandidateCount < 1 || !Number.isFinite(minimumLengthRatio) || minimumLengthRatio <= 0 || minimumLengthRatio > 1) {
    throw new Error('Parâmetros inválidos para classificação estrutural.');
  }
  if (candidates.length > maximumCandidateCount) {
    return { applied: false, structural: [], review: [...candidates], quality: [], thresholds: null, fallbackReason: 'candidate_limit_exceeded' };
  }
  if (candidates.length < minimumCandidateCount) {
    return { applied: false, structural: [], review: [...candidates], quality: [], thresholds: null, fallbackReason: 'insufficient_candidates' };
  }
  const candidateIds = new Set<string>();
  for (const candidate of candidates) {
    const coordinates = [candidate.start.x, candidate.start.y, candidate.end.x, candidate.end.y, candidate.thicknessPx];
    if (!candidate.id.trim() || candidateIds.has(candidate.id) || !coordinates.every(Number.isFinite) || candidateLength(candidate) <= 0) {
      throw new Error('Candidato inválido para classificação estrutural.');
    }
    candidateIds.add(candidate.id);
  }
  const thicknesses = candidates.map((candidate) => candidate.thicknessPx).filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (thicknesses.length !== candidates.length) throw new Error('Candidato com espessura inválida.');
  const thicknessQuantile = quantile(thicknesses, 0.75);
  const lowerThicknessQuantile = quantile(thicknesses, 0.25);
  const upperThicknessQuantile = quantile(thicknesses, 0.9);
  const minimumThicknessPx = Math.max(2, Math.floor(thicknessQuantile - lowerThicknessQuantile));
  const maximumThicknessPx = Math.max(minimumThicknessPx, upperThicknessQuantile * 3);
  const minimumLengthPx = Math.max(24, Math.min(imageSize.width, imageSize.height) * minimumLengthRatio);
  const endpointTolerancePx = options.endpointTolerancePx ?? Math.max(4, Math.min(12, minimumThicknessPx * 1.6));
  if (!Number.isFinite(endpointTolerancePx) || endpointTolerancePx <= 0) throw new Error('Tolerância de junção inválida.');

  const quality = candidates.map((candidate): WallCandidateQuality => {
    const lengthPx = candidateLength(candidate);
    const supports = perpendicularEndpointSupports(candidate, candidates, endpointTolerancePx);
    const thicknessConsistent = candidate.thicknessPx >= minimumThicknessPx && candidate.thicknessPx <= maximumThicknessPx;
    const continuous = lengthPx >= minimumLengthPx || supports === 2;
    const tier = thicknessConsistent && continuous ? 'structural' : 'review';
    const evidence = [
      `espessura ${candidate.thicknessPx.toFixed(1)} px; intervalo estrutural ${minimumThicknessPx.toFixed(1)}–${maximumThicknessPx.toFixed(1)} px`,
      `comprimento ${lengthPx.toFixed(1)} px; mínimo ${minimumLengthPx.toFixed(1)} px`,
      `${supports}/2 extremos com suporte ortogonal em ${endpointTolerancePx.toFixed(1)} px`,
    ];
    return { candidateId: candidate.id, tier, lengthPx, perpendicularEndpointSupports: supports, evidence };
  });
  const structuralIds = new Set(quality.filter((item) => item.tier === 'structural').map((item) => item.candidateId));
  return {
    applied: true,
    structural: candidates.filter((candidate) => structuralIds.has(candidate.id)),
    review: candidates.filter((candidate) => !structuralIds.has(candidate.id)),
    quality,
    thresholds: { minimumThicknessPx, maximumThicknessPx, minimumLengthPx, endpointTolerancePx, lowerThicknessQuantile, thicknessQuantile },
  };
}
