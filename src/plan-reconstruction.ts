export type Point2 = { x: number; y: number };
export type PixelRaster = { width: number; height: number; grayscale: Uint8Array };
export type PixelWallCandidate = {
  id: string;
  orientation: 'horizontal' | 'vertical' | 'diagonal';
  start: Point2;
  end: Point2;
  thicknessPx: number;
  confidence: number;
  origin?: 'automatic_detection' | 'manual_trace' | 'manual_correction';
  sourceCandidateIds?: string[];
};
export type CandidateIntersection = { firstId: string; secondId: string; point: Point2; tolerancePx: number; kind?: 'crossing' | 'endpoint_snap' };
export type ScaleCalibration = { pixelsPerMetre: number; source: 'known_measurement' | 'confirmed_information' };
export type VectorWall = {
  id: string;
  start: Point2;
  end: Point2;
  height: number;
  thickness: number;
};

export type PlanRegionCandidate = {
  id: string;
  boundaryCandidateIds: string[];
  vertices: Point2[];
  areaPx2: number;
  areaM2?: number;
  validation: 'unreviewed';
  eligibility: 'construction_candidate' | 'low_quality_candidate';
  confidence: number;
  evidence: string[];
  topologyMethod?: 'closed_segment_graph' | 'orthogonal_wall_support';
  label?: never;
};
export type PlanVectorModel = {
  coordinateSpace: 'source-image-pixels';
  scale: null | { pixelsPerMetre: number; source: ScaleCalibration['source'] };
  walls: Array<PixelWallCandidate & { origin: NonNullable<PixelWallCandidate['origin']>; validation: 'unreviewed' }>;
  intersections: CandidateIntersection[];
  regions: PlanRegionCandidate[];
  adjacency: Array<{ firstRegionId: string; secondRegionId: string; sharedCandidateIds: string[] }>;
  parallelPairs: Array<{ firstId: string; secondId: string; separationPx: number }>;
  thicknessCandidates: Array<{ firstId: string; secondId: string; estimatedThicknessPx: number; validation: 'ambiguous' }>;
  openingCandidates: Array<{ id: string; start: Point2; end: Point2; validation: 'ambiguous'; reason: string }>;
  limitations: string[];
};

const DEFAULT_THRESHOLD = 112;

function assertRaster(raster: PixelRaster): void {
  if (!Number.isInteger(raster.width) || !Number.isInteger(raster.height) || raster.width < 1 || raster.height < 1 || raster.grayscale.length !== raster.width * raster.height) {
    throw new Error('Raster de planta inválido.');
  }
}

type LineCluster = { firstLine: number; lastLine: number; starts: number[]; ends: number[] };
type AxisOrientation = Extract<PixelWallCandidate['orientation'], 'horizontal' | 'vertical'>;

function runsOnLine(raster: PixelRaster, orientation: AxisOrientation, line: number, threshold: number, gapTolerance: number): Array<[number, number]> {
  const span = orientation === 'horizontal' ? raster.width : raster.height;
  const dark = (offset: number) => orientation === 'horizontal'
    ? raster.grayscale[line * raster.width + offset]! <= threshold
    : raster.grayscale[offset * raster.width + line]! <= threshold;
  const runs: Array<[number, number]> = [];
  let start = -1;
  let lastDark = -1;
  for (let position = 0; position <= span; position += 1) {
    if (position < span && dark(position)) {
      if (start < 0) start = position;
      lastDark = position;
    } else if (start >= 0 && position - lastDark > gapTolerance) {
      runs.push([start, lastDark]);
      start = -1;
    }
  }
  return runs;
}

function candidatesOnAxis(raster: PixelRaster, orientation: AxisOrientation, threshold: number, minimumLength: number, gapTolerance: number): PixelWallCandidate[] {
  const lineCount = orientation === 'horizontal' ? raster.height : raster.width;
  const clusters: LineCluster[] = [];
  for (let line = 0; line < lineCount; line += 1) {
    const runs = runsOnLine(raster, orientation, line, threshold, gapTolerance).filter(([start, end]) => end - start + 1 >= minimumLength);
    const used = new Set<LineCluster>();
    for (const [start, end] of runs) {
      let best: LineCluster | undefined;
      let bestOverlap = 0;
      for (const cluster of clusters) {
        if (line - cluster.lastLine > gapTolerance + 1 || used.has(cluster)) continue;
        const priorStart = cluster.starts.at(-1)!;
        const priorEnd = cluster.ends.at(-1)!;
        const overlap = Math.max(0, Math.min(end, priorEnd) - Math.max(start, priorStart) + 1);
        const ratio = overlap / Math.max(1, Math.min(end - start + 1, priorEnd - priorStart + 1));
        if (ratio > bestOverlap) { best = cluster; bestOverlap = ratio; }
      }
      if (best && bestOverlap >= 0.5) {
        best.lastLine = line;
        best.starts.push(start);
        best.ends.push(end);
        used.add(best);
      } else clusters.push({ firstLine: line, lastLine: line, starts: [start], ends: [end] });
    }
  }
  return clusters.map((cluster, index) => {
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    const start = mean(cluster.starts);
    const end = mean(cluster.ends);
    const centerLine = (cluster.firstLine + cluster.lastLine) / 2;
    return {
      id: `${orientation === 'horizontal' ? 'h' : 'v'}-${index}`,
      orientation,
      start: orientation === 'horizontal' ? { x: start, y: centerLine } : { x: centerLine, y: start },
      end: orientation === 'horizontal' ? { x: end, y: centerLine } : { x: centerLine, y: end },
      thicknessPx: cluster.lastLine - cluster.firstLine + 1,
      confidence: Math.round(cluster.starts.length / (cluster.lastLine - cluster.firstLine + 1) * 100) / 100,
    };
  });
}

export function detectWallCandidates(raster: PixelRaster, options: { threshold?: number; minimumLengthPx?: number; gapTolerancePx?: number } = {}): PixelWallCandidate[] {
  assertRaster(raster);
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const minimumLength = options.minimumLengthPx ?? Math.max(18, Math.floor(Math.min(raster.width, raster.height) * 0.07));
  const gapTolerance = options.gapTolerancePx ?? 2;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 255 || minimumLength < 1 || gapTolerance < 0) throw new Error('Parâmetros de detecção inválidos.');

  const candidates = [
    ...candidatesOnAxis(raster, 'horizontal', threshold, minimumLength, gapTolerance),
    ...candidatesOnAxis(raster, 'vertical', threshold, minimumLength, gapTolerance),
  ];
  return consolidateWallCandidates(candidates).sort((a, b) => a.start.y - b.start.y || a.start.x - b.start.x || a.orientation.localeCompare(b.orientation)).map((candidate, index) => ({ ...candidate, id: `line-${index}`, origin: 'automatic_detection' }));
}

/**
 * Reduce visual noise before human review. This is a review aid, not a wall
 * classifier: line thickness/length cannot establish architectural meaning.
 * Keep the full detector output when the filter would leave too little evidence.
 */
export function filterCandidatesForReview(candidates: PixelWallCandidate[], imageSize: { width: number; height: number }): { candidates: PixelWallCandidate[]; omitted: number; minimumThicknessPx: number; minimumLengthPx: number; usedFallback: boolean } {
  if (!Number.isInteger(imageSize.width) || !Number.isInteger(imageSize.height) || imageSize.width < 1 || imageSize.height < 1) throw new Error('Dimensões raster inválidas.');
  const minDimension = Math.min(imageSize.width, imageSize.height);
  const minimumThicknessPx = Math.max(2, minDimension * 0.009);
  const minimumLengthPx = Math.max(32, minDimension * 0.075);
  const reviewed = candidates.filter((candidate) => Math.hypot(candidate.end.x - candidate.start.x, candidate.end.y - candidate.start.y) >= minimumLengthPx && candidate.thicknessPx >= minimumThicknessPx);
  const usedFallback = reviewed.length < Math.min(8, candidates.length);
  const result = usedFallback ? candidates : reviewed;
  return { candidates: result, omitted: candidates.length - result.length, minimumThicknessPx, minimumLengthPx, usedFallback };
}

/** Merge overlapping/nearby collinear detections and suppress near-identical duplicates.
 * This is geometric consolidation only; it does not prove that a line is a wall. */
export function consolidateWallCandidates(candidates: PixelWallCandidate[], tolerancePx = 3): PixelWallCandidate[] {
  if (!Number.isFinite(tolerancePx) || tolerancePx < 0) throw new Error('Tolerância de consolidação inválida.');
  const output: PixelWallCandidate[] = [];
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.id.trim() || candidate.id.length > 96 || ids.has(candidate.id) || !['horizontal', 'vertical', 'diagonal'].includes(candidate.orientation) || ![candidate.start.x, candidate.start.y, candidate.end.x, candidate.end.y, candidate.thicknessPx, candidate.confidence].every(Number.isFinite) || candidate.thicknessPx <= 0 || candidate.confidence < 0 || candidate.confidence > 1 || candidate.origin !== undefined && !['automatic_detection', 'manual_trace', 'manual_correction'].includes(candidate.origin) || candidate.sourceCandidateIds !== undefined && (!candidate.sourceCandidateIds.length || candidate.sourceCandidateIds.some((sourceId) => !sourceId.trim() || sourceId.length > 96)) || Math.hypot(candidate.end.x - candidate.start.x, candidate.end.y - candidate.start.y) <= 0) throw new Error('Candidato geométrico inválido ou com ID duplicado.');
    ids.add(candidate.id);
    const dx = candidate.end.x - candidate.start.x;
    const dy = candidate.end.y - candidate.start.y;
    const length = Math.hypot(dx, dy);
    const ux = dx / length; const uy = dy / length;
    const match = output.find((item) => {
      const ix = item.end.x - item.start.x; const iy = item.end.y - item.start.y;
      const il = Math.hypot(ix, iy); const vx = ix / il; const vy = iy / il;
      if (Math.abs(ux * vy - uy * vx) > Math.max(0.015, tolerancePx / Math.max(10, Math.min(length, il)))) return false;
      const perpendicular = Math.abs((candidate.start.x - item.start.x) * vy - (candidate.start.y - item.start.y) * vx);
      if (perpendicular > tolerancePx) return false;
      const a0 = candidate.start.x * vx + candidate.start.y * vy;
      const a1 = candidate.end.x * vx + candidate.end.y * vy;
      const b0 = item.start.x * vx + item.start.y * vy;
      const b1 = item.end.x * vx + item.end.y * vy;
      return Math.min(Math.max(a0, a1), Math.max(b0, b1)) + tolerancePx >= Math.max(Math.min(a0, a1), Math.min(b0, b1));
    });
    if (!match) { output.push({ ...candidate, sourceCandidateIds: [...new Set(candidate.sourceCandidateIds ?? [candidate.id])], start: { ...candidate.start }, end: { ...candidate.end } }); continue; }
    const ix = match.end.x - match.start.x; const iy = match.end.y - match.start.y; const il = Math.hypot(ix, iy);
    const ux2 = ix / il; const uy2 = iy / il;
    const endpoints = [match.start, match.end, candidate.start, candidate.end].map((point) => ({ t: point.x * ux2 + point.y * uy2, point }));
    endpoints.sort((a, b) => a.t - b.t);
    const first = endpoints[0]!.point; const last = endpoints.at(-1)!.point;
    const centerOffset = endpoints.reduce((sum, endpoint) => sum + endpoint.point.x * -uy2 + endpoint.point.y * ux2, 0) / endpoints.length;
    match.start = { x: first.x - -uy2 * (first.x * -uy2 + first.y * ux2 - centerOffset), y: first.y - ux2 * (first.x * -uy2 + first.y * ux2 - centerOffset) };
    match.end = { x: last.x - -uy2 * (last.x * -uy2 + last.y * ux2 - centerOffset), y: last.y - ux2 * (last.x * -uy2 + last.y * ux2 - centerOffset) };
    match.thicknessPx = (match.thicknessPx + candidate.thicknessPx) / 2;
    match.confidence = Math.max(match.confidence, candidate.confidence);
    if (candidate.origin === 'manual_correction' || candidate.origin === 'manual_trace' && match.origin === 'automatic_detection') match.origin = candidate.origin;
    match.sourceCandidateIds = [...new Set([...(match.sourceCandidateIds ?? [match.id]), ...(candidate.sourceCandidateIds ?? [candidate.id])])];
  }
  return output;
}

export function traceWallCandidate(id: string, start: Point2, end: Point2, thicknessPx: number): PixelWallCandidate {
  if (!id.trim() || ![start.x, start.y, end.x, end.y, thicknessPx].every(Number.isFinite) || thicknessPx <= 0 || Math.hypot(end.x - start.x, end.y - start.y) <= 0) throw new Error('Traçado manual inválido.');
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);
  const orientation = dx > dy * 11.43 ? 'horizontal' : dy > dx * 11.43 ? 'vertical' : 'diagonal';
  return { id, orientation, start: { ...start }, end: { ...end }, thicknessPx, confidence: 1, origin: 'manual_trace' };
}

export function splitWallCandidate(candidate: PixelWallCandidate, fraction = 0.5): [PixelWallCandidate, PixelWallCandidate] {
  if (!Number.isFinite(fraction) || fraction <= 0.02 || fraction >= 0.98) throw new Error('Posição da divisão fora dos limites.');
  const middle = { x: candidate.start.x + (candidate.end.x - candidate.start.x) * fraction, y: candidate.start.y + (candidate.end.y - candidate.start.y) * fraction };
  const sourceCandidateIds = candidate.sourceCandidateIds ?? [candidate.id];
  return [
    { ...candidate, id: `${candidate.id}-a`, sourceCandidateIds, end: middle },
    { ...candidate, id: `${candidate.id}-b`, sourceCandidateIds, start: middle },
  ];
}

export function mergeWallCandidates(candidates: PixelWallCandidate[], tolerancePx = 4): PixelWallCandidate {
  if (candidates.length < 2) throw new Error('Seleccione pelo menos dois segmentos.');
  const merged = consolidateWallCandidates(candidates, tolerancePx);
  if (merged.length !== 1) throw new Error('Só é possível unir segmentos colineares e contíguos.');
  return { ...merged[0]!, id: `joined-${candidates.map((candidate) => candidate.id).sort().join('-').slice(0, 70)}` };
}

export function detectCandidateIntersections(candidates: PixelWallCandidate[], tolerancePx = 2): CandidateIntersection[] {
  if (!Number.isFinite(tolerancePx) || tolerancePx < 0) throw new Error('Tolerância de intersecção inválida.');
  const result: CandidateIntersection[] = [];
  for (let i = 0; i < candidates.length; i += 1) {
    const first = candidates[i]!;
    for (let j = i + 1; j < candidates.length; j += 1) {
      const second = candidates[j]!;
      const r = { x: first.end.x - first.start.x, y: first.end.y - first.start.y };
      const s = { x: second.end.x - second.start.x, y: second.end.y - second.start.y };
      const cross = (a: Point2, b: Point2) => a.x * b.y - a.y * b.x;
      const denominator = cross(r, s);
      if (Math.abs(denominator) < 1e-9) continue;
      const delta = { x: second.start.x - first.start.x, y: second.start.y - first.start.y };
      const t = cross(delta, s) / denominator;
      const u = cross(delta, r) / denominator;
      const tTolerance = tolerancePx / Math.max(1, Math.hypot(r.x, r.y));
      const uTolerance = tolerancePx / Math.max(1, Math.hypot(s.x, s.y));
      if (t >= -tTolerance && t <= 1 + tTolerance && u >= -uTolerance && u <= 1 + uTolerance) {
        result.push({ firstId: first.id, secondId: second.id, point: { x: first.start.x + t * r.x, y: first.start.y + t * r.y }, tolerancePx });
      }
    }
  }
  return result;
}

function polygonArea(points: Point2[]): number {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!; const next = points[(index + 1) % points.length]!;
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return twiceArea / 2;
}

function simplePolygon(points: Point2[], tolerance: number): boolean {
  if (points.length < 3) return false;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!; const next = points[(index + 1) % points.length]!;
    if (Math.hypot(next.x - current.x, next.y - current.y) <= tolerance / 10) return false;
    for (let prior = index + 1; prior < points.length; prior += 1) {
      if (prior === index || (prior + 1) % points.length === index || (index + 1) % points.length === prior) continue;
      const a = points[prior]!; const b = points[(prior + 1) % points.length]!;
      const cross = (p: Point2, q: Point2, r: Point2) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
      const c1 = cross(current, next, a); const c2 = cross(current, next, b); const c3 = cross(a, b, current); const c4 = cross(a, b, next);
      if (c1 * c2 < -tolerance * tolerance / 100 && c3 * c4 < -tolerance * tolerance / 100) return false;
      if ([current, next].some((point) => Math.hypot(point.x - a.x, point.y - a.y) <= tolerance / 10)) return false;
    }
  }
  return true;
}

/** Build an image-space planar graph and bounded face candidates from reviewed or detected segments.
 * Faces and openings remain unreviewed/ambiguous and areas stay in px² until a scale is confirmed. */
type AxisSupport = { coordinate: number; entries: Array<{ candidate: PixelWallCandidate; low: number; high: number; coordinate: number }> };

function axisSupports(candidates: PixelWallCandidate[], orientation: 'horizontal' | 'vertical', tolerancePx: number): AxisSupport[] {
  const eligible = candidates.flatMap((candidate) => {
    if (candidate.orientation !== orientation || candidate.thicknessPx < 2.5 || candidate.confidence < 0.5) return [];
    const coordinate = orientation === 'horizontal' ? (candidate.start.y + candidate.end.y) / 2 : (candidate.start.x + candidate.end.x) / 2;
    const low = orientation === 'horizontal' ? Math.min(candidate.start.x, candidate.end.x) : Math.min(candidate.start.y, candidate.end.y);
    const high = orientation === 'horizontal' ? Math.max(candidate.start.x, candidate.end.x) : Math.max(candidate.start.y, candidate.end.y);
    return high - low >= tolerancePx * 1.5 ? [{ candidate, coordinate, low, high } ] : [];
  }).sort((a, b) => a.coordinate - b.coordinate);
  const groups: AxisSupport[] = [];
  for (const entry of eligible) {
    let group = groups.find((item) => Math.abs(item.coordinate - entry.coordinate) <= tolerancePx);
    if (!group) { group = { coordinate: entry.coordinate, entries: [] }; groups.push(group); }
    group.entries.push(entry);
    group.coordinate = group.entries.reduce((sum, item) => sum + item.coordinate, 0) / group.entries.length;
  }
  return groups;
}

function supportCoverage(axis: AxisSupport, low: number, high: number): { ratio: number; candidateIds: string[]; meanThickness: number } {
  const intervals = axis.entries.flatMap((entry) => {
    const start = Math.max(low, entry.low); const end = Math.min(high, entry.high);
    return end > start ? [{ start, end, candidate: entry.candidate }] : [];
  }).sort((a, b) => a.start - b.start);
  let covered = 0; let end = -Infinity;
  for (const interval of intervals) {
    if (interval.start > end) covered += interval.end - interval.start;
    else if (interval.end > end) covered += interval.end - end;
    end = Math.max(end, interval.end);
  }
  const candidateIds = [...new Set(intervals.map((item) => item.candidate.id))];
  const meanThickness = intervals.length ? intervals.reduce((sum, item) => sum + item.candidate.thicknessPx * item.candidate.confidence, 0) / intervals.reduce((sum, item) => sum + item.candidate.confidence, 0) : 0;
  return { ratio: Math.min(1, covered / Math.max(1, high - low)), candidateIds, meanThickness };
}

/** Propose axis-aligned interior regions from multi-segment wall support.
 * Dimensions and scale are not inferred; every output remains unreviewed. */
export function detectOrthogonalRoomCandidates(candidates: PixelWallCandidate[], imageSize: { width: number; height: number }, options: { snapTolerancePx?: number; minimumEdgeCoverage?: number } = {}): PlanRegionCandidate[] {
  if (!Number.isInteger(imageSize.width) || !Number.isInteger(imageSize.height) || imageSize.width < 1 || imageSize.height < 1) throw new Error('Dimensões raster inválidas.');
  const minDimension = Math.min(imageSize.width, imageSize.height);
  const tolerance = options.snapTolerancePx ?? Math.max(3, minDimension * 0.008);
  const minimumCoverage = options.minimumEdgeCoverage ?? 0.42;
  if (!Number.isFinite(tolerance) || tolerance <= 0 || !Number.isFinite(minimumCoverage) || minimumCoverage < 0.25 || minimumCoverage > 1) throw new Error('Parâmetros de proposta de divisões inválidos.');
  const horizontal = axisSupports(candidates, 'horizontal', tolerance);
  const vertical = axisSupports(candidates, 'vertical', tolerance);
  const minimumSide = minDimension * 0.09;
  const rectangles: Array<{ x0: number; y0: number; x1: number; y1: number; edges: Array<{ ratio: number; candidateIds: string[]; meanThickness: number }>; score: number }> = [];
  for (let topIndex = 0; topIndex < horizontal.length; topIndex += 1) for (let bottomIndex = topIndex + 1; bottomIndex < horizontal.length; bottomIndex += 1) {
    const top = horizontal[topIndex]!; const bottom = horizontal[bottomIndex]!; const height = bottom.coordinate - top.coordinate;
    if (height < minimumSide || height > imageSize.height * 0.78) continue;
    for (let leftIndex = 0; leftIndex < vertical.length; leftIndex += 1) for (let rightIndex = leftIndex + 1; rightIndex < vertical.length; rightIndex += 1) {
      const left = vertical[leftIndex]!; const right = vertical[rightIndex]!; const width = right.coordinate - left.coordinate;
      if (width < minimumSide || width > imageSize.width * 0.78 || width / height > 8 || height / width > 8) continue;
      const edges = [
        supportCoverage(top, left.coordinate, right.coordinate), supportCoverage(bottom, left.coordinate, right.coordinate),
        supportCoverage(left, top.coordinate, bottom.coordinate), supportCoverage(right, top.coordinate, bottom.coordinate),
      ];
      if (edges.some((edge) => edge.ratio < minimumCoverage || edge.candidateIds.length === 0)) continue;
      const partitionCoverage = minimumCoverage * 0.83;
      const compositeHorizontal = horizontal.some((axis, index) => index !== topIndex && index !== bottomIndex && axis.coordinate > top.coordinate + tolerance && axis.coordinate < bottom.coordinate - tolerance && supportCoverage(axis, left.coordinate, right.coordinate).ratio >= partitionCoverage);
      const compositeVertical = vertical.some((axis, index) => index !== leftIndex && index !== rightIndex && axis.coordinate > left.coordinate + tolerance && axis.coordinate < right.coordinate - tolerance && supportCoverage(axis, top.coordinate, bottom.coordinate).ratio >= partitionCoverage);
      if (compositeHorizontal || compositeVertical) continue;
      const cornerSupport = ([
        [top, left.coordinate], [top, right.coordinate], [bottom, left.coordinate], [bottom, right.coordinate],
      ] as Array<[AxisSupport, number]>).filter(([axis, point]) => {
        return axis.entries.some((entry) => point >= entry.low - tolerance && point <= entry.high + tolerance);
      }).length;
      if (cornerSupport < 3) continue;
      const score = edges.reduce((sum, edge) => sum + edge.ratio, 0) / 4;
      rectangles.push({ x0: left.coordinate, y0: top.coordinate, x1: right.coordinate, y1: bottom.coordinate, edges, score });
    }
  }
  rectangles.sort((a, b) => b.score - a.score || a.x0 - b.x0 || a.y0 - b.y0);
  const selected: typeof rectangles = [];
  for (const item of rectangles) {
    const overlap = selected.some((prior) => {
      const intersectionWidth = Math.max(0, Math.min(item.x1, prior.x1) - Math.max(item.x0, prior.x0));
      const intersectionHeight = Math.max(0, Math.min(item.y1, prior.y1) - Math.max(item.y0, prior.y0));
      const intersection = intersectionWidth * intersectionHeight;
      const smaller = Math.min((item.x1 - item.x0) * (item.y1 - item.y0), (prior.x1 - prior.x0) * (prior.y1 - prior.y0));
      return intersection / Math.max(1, smaller) > 0.9;
    });
    if (!overlap) selected.push(item);
  }
  return selected.map((item) => {
    const candidateIds = [...new Set(item.edges.flatMap((edge) => edge.candidateIds))].sort();
    const sourceKinds = candidates.filter((candidate) => candidateIds.includes(candidate.id)).map((candidate) => candidate.origin ?? 'automatic_detection');
    const manualCount = sourceKinds.filter((origin) => origin !== 'automatic_detection').length;
    return {
      id: `room-${Math.round(item.x0)}-${Math.round(item.y0)}-${Math.round(item.x1)}-${Math.round(item.y1)}`,
      boundaryCandidateIds: candidateIds,
      vertices: [{ x: item.x0, y: item.y0 }, { x: item.x1, y: item.y0 }, { x: item.x1, y: item.y1 }, { x: item.x0, y: item.y1 }],
      areaPx2: (item.x1 - item.x0) * (item.y1 - item.y0),
      validation: 'unreviewed' as const,
      eligibility: 'construction_candidate' as const,
      confidence: Math.round(item.score * 100) / 100,
      topologyMethod: 'orthogonal_wall_support' as const,
      evidence: [`Quatro bordos apoiados por segmentos detectados; suporte médio ${Math.round(item.score * 100)}%.`, `Tolerância de alinhamento ${tolerance.toFixed(1)} px, dependente da resolução.`, manualCount ? `${manualCount} candidato(s) manual(is) participam da proposta.` : 'Proposta derivada apenas de candidatos automáticos.', 'Rectângulo simples; paredes e função da divisão continuam por confirmar.'],
    };
  });
}

export function buildPlanVectorModel(candidates: PixelWallCandidate[], options: { tolerancePx?: number; scale?: ScaleCalibration; imageSize?: { width: number; height: number } } = {}): PlanVectorModel {
  const tolerance = options.tolerancePx ?? 6;
  if (!Number.isFinite(tolerance) || tolerance <= 0) throw new Error('Tolerância topológica inválida.');
  if (options.scale && (!Number.isFinite(options.scale.pixelsPerMetre) || options.scale.pixelsPerMetre <= 0 || !['known_measurement', 'confirmed_information'].includes(options.scale.source))) throw new Error('Escala vectorial inválida.');
  const walls = consolidateWallCandidates(candidates, tolerance / 2).map((candidate) => ({ ...candidate, origin: candidate.origin ?? 'automatic_detection', validation: 'unreviewed' as const }));
  // Raster plans frequently contain T-junctions: one detected wall stops a few
  // pixels before the centreline of another. Exact segment intersection alone
  // leaves those junctions open and prevents the half-edge walk from closing.
  const intersections: CandidateIntersection[] = detectCandidateIntersections(walls, tolerance / 10).map((item) => ({ ...item, kind: 'crossing' }));
  const projectedJunctions: CandidateIntersection[] = [];
  for (let i = 0; i < walls.length; i += 1) for (let j = 0; j < walls.length; j += 1) {
    if (i === j) continue;
    const source = walls[i]!; const target = walls[j]!;
    const dx = target.end.x - target.start.x; const dy = target.end.y - target.start.y;
    const length2 = dx * dx + dy * dy;
    if (length2 <= 1e-12) continue;
    for (const endpoint of [source.start, source.end]) {
      const t = ((endpoint.x - target.start.x) * dx + (endpoint.y - target.start.y) * dy) / length2;
      if (t <= 0.015 || t >= 0.985) continue;
      const point = { x: target.start.x + t * dx, y: target.start.y + t * dy };
      if (Math.hypot(point.x - endpoint.x, point.y - endpoint.y) > tolerance) continue;
      if (intersections.some((item) => (item.firstId === source.id && item.secondId === target.id || item.firstId === target.id && item.secondId === source.id) && Math.hypot(item.point.x - point.x, item.point.y - point.y) <= tolerance / 2)) continue;
      projectedJunctions.push({ firstId: source.id, secondId: target.id, point, tolerancePx: tolerance, kind: 'endpoint_snap' });
    }
  }
  for (const item of projectedJunctions) {
    const previous = intersections.find((candidate) => candidate.firstId === item.firstId && candidate.secondId === item.secondId && Math.hypot(candidate.point.x - item.point.x, candidate.point.y - item.point.y) <= tolerance);
    if (!previous) intersections.push(item);
  }
  const points: Point2[] = [];
  const intern = (point: Point2): number => {
    const index = points.findIndex((known) => Math.hypot(known.x - point.x, known.y - point.y) <= tolerance);
    if (index >= 0) return index;
    points.push({ ...point }); return points.length - 1;
  };
  const edges: Array<{ from: number; to: number; sourceId: string }> = [];
  for (const wall of walls) {
    const dx = wall.end.x - wall.start.x; const dy = wall.end.y - wall.start.y;
    const length2 = dx * dx + dy * dy;
    const splits = [wall.start, wall.end, ...intersections.filter((item) => item.firstId === wall.id || item.secondId === wall.id).map((item) => item.point)]
      .map((point) => ({ point, t: ((point.x - wall.start.x) * dx + (point.y - wall.start.y) * dy) / length2 }))
      .sort((a, b) => a.t - b.t);
    for (let i = 1; i < splits.length; i += 1) {
      const from = intern(splits[i - 1]!.point); const to = intern(splits[i]!.point);
      if (from === to) continue;
      if (!edges.some((edge) => edge.sourceId === wall.id && (edge.from === from && edge.to === to || edge.from === to && edge.to === from))) edges.push({ from, to, sourceId: wall.id });
    }
  }
  const outgoing = points.map(() => [] as Array<{ to: number; edgeIndex: number; angle: number }>);
  edges.forEach((edge, edgeIndex) => {
    const a = points[edge.from]!; const b = points[edge.to]!;
    outgoing[edge.from]!.push({ to: edge.to, edgeIndex, angle: Math.atan2(b.y - a.y, b.x - a.x) });
    outgoing[edge.to]!.push({ to: edge.from, edgeIndex, angle: Math.atan2(a.y - b.y, a.x - b.x) });
  });
  for (const neighbors of outgoing) neighbors.sort((a, b) => a.angle - b.angle);
  const visited = new Set<string>();
  const faces: Array<{ vertices: Point2[]; edgeIds: string[]; signedArea: number }> = [];
  edges.forEach((edge) => {
    for (const [from, to] of [[edge.from, edge.to], [edge.to, edge.from]] as const) {
      const startKey = `${from}:${to}`;
      if (visited.has(startKey)) continue;
      const cyclePoints: Point2[] = []; const cycleEdges: string[] = [];
      let currentFrom = from; let currentTo = to; let closed = false;
      for (let guard = 0; guard <= edges.length * 2 + 2; guard += 1) {
        const key = `${currentFrom}:${currentTo}`;
        if (visited.has(key)) { closed = key === startKey; break; }
        visited.add(key); cyclePoints.push(points[currentFrom]!);
        const neighbors = outgoing[currentTo]!;
        const reverseIndex = neighbors.findIndex((item) => item.to === currentFrom);
        if (reverseIndex < 0) break;
        const next = neighbors[(reverseIndex + neighbors.length - 1) % neighbors.length]!;
        cycleEdges.push(edges[next.edgeIndex]!.sourceId);
        currentFrom = currentTo; currentTo = next.to;
        if (currentFrom === from && currentTo === to) { closed = true; break; }
      }
      const area = cyclePoints.length >= 3 ? polygonArea(cyclePoints) : 0;
      if (closed && area > tolerance * tolerance && cycleEdges.length >= 3) faces.push({ vertices: cyclePoints, edgeIds: [...new Set(cycleEdges)], signedArea: area });
    }
  });
  const uniqueFaces = new Map<string, typeof faces[number]>();
  for (const face of faces) {
    const key = face.vertices.map((point) => `${Math.round(point.x / tolerance)},${Math.round(point.y / tolerance)}`).sort().join('|');
    const prior = uniqueFaces.get(key);
    if (!prior || face.signedArea < prior.signedArea) uniqueFaces.set(key, face);
  }
  const bounds = walls.flatMap((wall) => [wall.start, wall.end]);
  const spanX = bounds.length ? Math.max(...bounds.map((point) => point.x)) - Math.min(...bounds.map((point) => point.x)) : 0;
  const spanY = bounds.length ? Math.max(...bounds.map((point) => point.y)) - Math.min(...bounds.map((point) => point.y)) : 0;
  const drawingArea = Math.max(1, spanX * spanY);
  const graphRegions = [...uniqueFaces.values()].sort((a, b) => a.signedArea - b.signedArea).map((face, index) => {
    const vertices = face.vertices.filter((point, pointIndex, list) => pointIndex === 0 || Math.hypot(point.x - list[pointIndex - 1]!.x, point.y - list[pointIndex - 1]!.y) > tolerance / 10);
    if (vertices.length > 2 && Math.hypot(vertices[0]!.x - vertices.at(-1)!.x, vertices[0]!.y - vertices.at(-1)!.y) <= tolerance / 10) vertices.pop();
    const xs = face.vertices.map((point) => point.x); const ys = face.vertices.map((point) => point.y);
    const boxArea = Math.max(1, (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)));
    const compactness = Math.min(1, face.signedArea / boxArea);
    const relativeArea = face.signedArea / drawingArea;
    const eligible = relativeArea >= 0.008 && compactness >= 0.12 && face.edgeIds.length >= 4 && simplePolygon(vertices, tolerance);
    const sources = face.edgeIds.map((id) => walls.find((wall) => wall.id === id)).filter((wall): wall is NonNullable<typeof wall> => !!wall);
    const manual = sources.filter((wall) => wall.origin !== 'automatic_detection').length;
    const evidence = [`Fecho planar derivado de ${face.edgeIds.length} segmentos da imagem original.`, `${projectedJunctions.filter((item) => face.edgeIds.includes(item.firstId) || face.edgeIds.includes(item.secondId)).length} junções T aproximadas dentro de ${tolerance.toFixed(1)} px.`, manual ? `${manual} segmento(s) têm origem manual.` : 'Todos os segmentos de contorno têm origem na detecção automática.', eligible ? 'Área relativa e forma compatíveis com uma região interior candidata.' : 'Forma/área fora dos critérios heurísticos de proposta espacial.'];
    return {
    id: `region-${index + 1}`,
    boundaryCandidateIds: face.edgeIds,
    vertices,
    areaPx2: face.signedArea,
    ...(options.scale && Number.isFinite(options.scale.pixelsPerMetre) && options.scale.pixelsPerMetre > 0 ? { areaM2: face.signedArea / (options.scale.pixelsPerMetre ** 2) } : {}),
    validation: 'unreviewed' as const,
    eligibility: eligible ? 'construction_candidate' as const : 'low_quality_candidate' as const,
    confidence: Math.round(Math.min(0.95, Math.max(0.15, compactness * 0.45 + Math.min(relativeArea * 4, 0.5))) * 100) / 100,
    evidence,
  };
  });
  const regions = options.imageSize
    ? [...graphRegions, ...detectOrthogonalRoomCandidates(walls, options.imageSize, { snapTolerancePx: Math.max(tolerance, Math.min(options.imageSize.width, options.imageSize.height) * 0.008) })]
    : graphRegions;
  const parallelPairs: PlanVectorModel['parallelPairs'] = [];
  const thicknessCandidates: PlanVectorModel['thicknessCandidates'] = [];
  for (let i = 0; i < walls.length; i += 1) for (let j = i + 1; j < walls.length; j += 1) {
    const first = walls[i]!; const second = walls[j]!;
    const a = { x: first.end.x - first.start.x, y: first.end.y - first.start.y };
    const b = { x: second.end.x - second.start.x, y: second.end.y - second.start.y };
    const denominator = Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y);
    if (!denominator || Math.abs(a.x * b.y - a.y * b.x) / denominator > 0.015) continue;
    const separation = Math.abs((second.start.x - first.start.x) * a.y - (second.start.y - first.start.y) * a.x) / Math.hypot(a.x, a.y);
    if (separation > tolerance && separation < 80) {
      parallelPairs.push({ firstId: first.id, secondId: second.id, separationPx: separation });
      const projectedFirst = [first.start.x * (a.x / Math.hypot(a.x, a.y)) + first.start.y * (a.y / Math.hypot(a.x, a.y)), first.end.x * (a.x / Math.hypot(a.x, a.y)) + first.end.y * (a.y / Math.hypot(a.x, a.y))].sort((x, y) => x - y);
      const projectedSecond = [second.start.x * (a.x / Math.hypot(a.x, a.y)) + second.start.y * (a.y / Math.hypot(a.x, a.y)), second.end.x * (a.x / Math.hypot(a.x, a.y)) + second.end.y * (a.y / Math.hypot(a.x, a.y))].sort((x, y) => x - y);
      if (Math.min(projectedFirst[1]!, projectedSecond[1]!) - Math.max(projectedFirst[0]!, projectedSecond[0]!) >= Math.min(Math.hypot(a.x, a.y), Math.hypot(b.x, b.y)) * 0.7) thicknessCandidates.push({ firstId: first.id, secondId: second.id, estimatedThicknessPx: separation, validation: 'ambiguous' });
    }
  }
  const openingCandidates: PlanVectorModel['openingCandidates'] = [];
  for (let i = 0; i < walls.length; i += 1) for (let j = i + 1; j < walls.length; j += 1) {
    const first = walls[i]!; const second = walls[j]!;
    const ax = first.end.x - first.start.x; const ay = first.end.y - first.start.y; const length = Math.hypot(ax, ay);
    const bx = second.end.x - second.start.x; const by = second.end.y - second.start.y; const otherLength = Math.hypot(bx, by);
    if (!length || !otherLength || Math.abs(ax * by - ay * bx) / (length * otherLength) > 0.015) continue;
    const normalDistance = Math.abs((second.start.x - first.start.x) * ay - (second.start.y - first.start.y) * ax) / length;
    if (normalDistance > tolerance) continue;
    const ux = ax / length; const uy = ay / length;
    const firstInterval = [first.start.x * ux + first.start.y * uy, first.end.x * ux + first.end.y * uy].sort((a, b) => a - b);
    const secondInterval = [second.start.x * ux + second.start.y * uy, second.end.x * ux + second.end.y * uy].sort((a, b) => a - b);
    const gap = Math.max(firstInterval[0]!, secondInterval[0]!) - Math.min(firstInterval[1]!, secondInterval[1]!);
    if (gap >= 6 && gap <= 36) {
      const firstAfter = firstInterval[0]! > secondInterval[1]!;
      const edgeA = firstAfter ? secondInterval[1]! : firstInterval[1]!;
      const edgeB = firstAfter ? firstInterval[0]! : secondInterval[0]!;
      const originProjection = first.start.x * ux + first.start.y * uy;
      const start = { x: first.start.x + ux * (edgeA - originProjection), y: first.start.y + uy * (edgeA - originProjection) };
      const end = { x: first.start.x + ux * (edgeB - originProjection), y: first.start.y + uy * (edgeB - originProjection) };
      openingCandidates.push({ id: `gap-${first.id}-${second.id}`, start, end, validation: 'ambiguous', reason: `Descontinuidade colinear de ${gap.toFixed(1)} px; pode ser símbolo, falha de detecção ou abertura e exige confirmação.` });
    }
  }
  const adjacency: PlanVectorModel['adjacency'] = [];
  for (let i = 0; i < regions.length; i += 1) for (let j = i + 1; j < regions.length; j += 1) {
    const sharedCandidateIds = regions[i]!.boundaryCandidateIds.filter((id) => regions[j]!.boundaryCandidateIds.includes(id));
    if (sharedCandidateIds.length) adjacency.push({ firstRegionId: regions[i]!.id, secondRegionId: regions[j]!.id, sharedCandidateIds });
  }
  return {
    coordinateSpace: 'source-image-pixels', scale: options.scale ? { ...options.scale } : null,
    walls, intersections, regions, adjacency, parallelPairs, thicknessCandidates, openingCandidates,
    limitations: ['Linhas são candidatos geométricos, não paredes confirmadas.', 'Regiões são faces fechadas do grafo e não divisões semanticamente confirmadas.', 'Sem escala confirmada, áreas e espessuras permanecem em píxeis.', 'Descontinuidades são ambiguidades, não portas ou janelas identificadas.'],
  };
}

/** Counts graph cycles in traced segments; it does not assert a room or metric area. */
export function countClosedCandidateContours(candidates: PixelWallCandidate[], tolerancePx = 8): number {
  if (!Number.isFinite(tolerancePx) || tolerancePx < 0) throw new Error('Tolerância de fecho inválida.');
  const points: Point2[] = [];
  const edges: Array<[number, number]> = [];
  const pointId = (point: Point2): number => {
    const existing = points.findIndex((candidate) => Math.hypot(candidate.x - point.x, candidate.y - point.y) <= tolerancePx);
    if (existing >= 0) return existing;
    points.push(point);
    return points.length - 1;
  };
  const intersections = detectCandidateIntersections(candidates, tolerancePx);
  const edgeKeys = new Set<string>();
  for (const candidate of candidates) {
    const dx = candidate.end.x - candidate.start.x; const dy = candidate.end.y - candidate.start.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared < 1e-12) continue;
    const pointsOnSegment = [candidate.start, candidate.end, ...intersections.filter((item) => item.firstId === candidate.id || item.secondId === candidate.id).map((item) => item.point)]
      .map((point) => {
        const t = Math.max(0, Math.min(1, ((point.x - candidate.start.x) * dx + (point.y - candidate.start.y) * dy) / lengthSquared));
        return { t, point: { x: candidate.start.x + t * dx, y: candidate.start.y + t * dy } };
      }).sort((a, b) => a.t - b.t);
    for (let index = 1; index < pointsOnSegment.length; index += 1) {
      const from = pointId(pointsOnSegment[index - 1]!.point); const to = pointId(pointsOnSegment[index]!.point);
      if (from === to) continue;
      const key = from < to ? `${from}:${to}` : `${to}:${from}`;
      if (!edgeKeys.has(key)) { edges.push([from, to]); edgeKeys.add(key); }
    }
  }
  const parent = points.map((_, index) => index);
  const find = (node: number): number => { while (parent[node] !== node) { parent[node] = parent[parent[node]!]!; node = parent[node]!; } return node; };
  let cycles = 0;
  for (const [from, to] of edges) {
    const a = find(from); const b = find(to);
    if (a === b) cycles += 1;
    else parent[b] = a;
  }
  return cycles;
}

export function calibrateScale(pixelDistance: number, realDistanceMetres: number, source: ScaleCalibration['source']): ScaleCalibration {
  if (!Number.isFinite(pixelDistance) || pixelDistance <= 0 || !Number.isFinite(realDistanceMetres) || realDistanceMetres <= 0) throw new Error('A calibração exige uma distância positiva confirmada.');
  return { pixelsPerMetre: pixelDistance / realDistanceMetres, source };
}

export function candidateToWall(candidate: PixelWallCandidate, calibration: ScaleCalibration, dimensions: { height: number; thickness?: number }): Omit<VectorWall, 'id'> {
  if (!Number.isFinite(calibration.pixelsPerMetre) || calibration.pixelsPerMetre <= 0) throw new Error('Escala por calibrar.');
  if (!Number.isFinite(dimensions.height) || dimensions.height <= 0) throw new Error('Altura de parede inválida.');
  const scale = calibration.pixelsPerMetre;
  return {
    start: { x: candidate.start.x / scale, y: -candidate.start.y / scale },
    end: { x: candidate.end.x / scale, y: -candidate.end.y / scale },
    height: dimensions.height,
    thickness: dimensions.thickness ?? candidate.thicknessPx / scale,
  };
}

