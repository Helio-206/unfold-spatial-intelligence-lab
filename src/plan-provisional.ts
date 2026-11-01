import type { PixelWallCandidate, PlanRegionCandidate, Point2 } from './plan-reconstruction';

export type ProvisionalZone = {
  id: 'room-a' | 'room-b' | 'room-c' | 'room-d' | 'hall';
  label: string;
  vertices: Point2[];
  status: 'provisional';
  sourceCandidateRegionIds: string[];
  evidence: string[];
};

export type ProvisionalPlanModel = {
  status: 'provisional';
  coordinateSpace: 'source-image-pixels';
  persistence: 'ephemeral';
  zones: ProvisionalZone[];
  unresolved: Array<{ id: string; reason: string }>;
  overlaps: Array<{ first: string; second: string; areaPx2: number }>;
  sourceImageSize: { width: number; height: number };
};

type Rect = { minX: number; minY: number; maxX: number; maxY: number };

function bounds(vertices: Point2[]): Rect {
  if (vertices.length < 4 || vertices.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) throw new Error('A região candidata não tem vértices válidos.');
  return { minX: Math.min(...vertices.map((point) => point.x)), minY: Math.min(...vertices.map((point) => point.y)), maxX: Math.max(...vertices.map((point) => point.x)), maxY: Math.max(...vertices.map((point) => point.y)) };
}
function rectangle(rect: Rect): Point2[] {
  return [{ x: rect.minX, y: rect.minY }, { x: rect.maxX, y: rect.minY }, { x: rect.maxX, y: rect.maxY }, { x: rect.minX, y: rect.maxY }];
}
function overlapArea(a: Rect, b: Rect): number {
  return Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)) * Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
}
function coveredIntervals(walls: PixelWallCandidate[], x: number, fromY: number, toY: number, tolerance: number): Array<[number, number]> {
  const intervals = walls.flatMap((wall) => {
    if (wall.orientation !== 'vertical' || Math.abs(wall.start.x - wall.end.x) > tolerance || Math.abs((wall.start.x + wall.end.x) / 2 - x) > tolerance) return [];
    const start = Math.max(fromY, Math.min(wall.start.y, wall.end.y));
    const end = Math.min(toY, Math.max(wall.start.y, wall.end.y));
    return end > start ? [[start, end] as [number, number]] : [];
  }).sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of intervals) {
    const last = merged.at(-1);
    if (!last || start > last[1]) merged.push([start, end]);
    else last[1] = Math.max(last[1], end);
  }
  return merged;
}
function uncoveredIntervals(intervals: Array<[number, number]>, fromY: number, toY: number): Array<[number, number]> {
  const gaps: Array<[number, number]> = [];
  let cursor = fromY;
  for (const [start, end] of intervals) {
    if (start > cursor) gaps.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (cursor < toY) gaps.push([cursor, toY]);
  return gaps.filter(([start, end]) => end - start > 1);
}

/**
 * Builds a non-persistent, pixel-space hypothesis from a two-by-two set of
 * room-shaped candidates. The central corridor is inferred only as the
 * residual band between the left and right room anchors. It is never accepted
 * as a wall or room; missing boundary evidence remains an explicit issue.
 */
export function buildProvisionalPlan(regions: PlanRegionCandidate[], walls: PixelWallCandidate[], imageSize: { width: number; height: number }): ProvisionalPlanModel {
  if (!Number.isFinite(imageSize.width) || !Number.isFinite(imageSize.height) || imageSize.width <= 0 || imageSize.height <= 0) throw new Error('Dimensões da imagem inválidas.');
  const candidates = regions.filter((region) => region.eligibility === 'construction_candidate');
  if (candidates.length !== 4) throw new Error(`A hipótese exige quatro regiões candidatas; foram recebidas ${candidates.length}.`);
  const entries = candidates.map((region) => ({ region, rect: bounds(region.vertices) }));
  const center = (rect: Rect) => ({ x: (rect.minX + rect.maxX) / 2, y: (rect.minY + rect.maxY) / 2 });
  const sortedRows = [...entries].sort((a, b) => center(a.rect).y - center(b.rect).y);
  const upper = sortedRows.slice(0, 2).sort((a, b) => center(a.rect).x - center(b.rect).x);
  const lower = sortedRows.slice(2).sort((a, b) => center(a.rect).x - center(b.rect).x);
  const allRects = [upper[0]!, upper[1]!, lower[0]!, lower[1]!];
  const medianHeight = [...allRects.map((entry) => entry.rect.maxY - entry.rect.minY)].sort((a, b) => a - b)[1]!;
  const medianWidth = [...allRects.map((entry) => entry.rect.maxX - entry.rect.minX)].sort((a, b) => a - b)[1]!;
  const tolerance = Math.max(6, Math.min(imageSize.width, imageSize.height) * 0.008);
  if (upper[0]!.rect.maxX > upper[1]!.rect.minX + tolerance || lower[0]!.rect.maxX > lower[1]!.rect.minX + tolerance || center(upper[0]!.rect).x >= center(upper[1]!.rect).x || center(lower[0]!.rect).x >= center(lower[1]!.rect).x) throw new Error('As regiões não formam duas colunas ordenadas sem sobreposição relevante.');
  if (Math.abs(center(upper[0]!.rect).x - center(lower[0]!.rect).x) > medianWidth * 0.5 || Math.abs(center(upper[1]!.rect).x - center(lower[1]!.rect).x) > medianWidth * 0.5) throw new Error('As regiões não formam duas colunas espacialmente coerentes.');
  if (Math.abs(upper[0]!.rect.maxY - upper[1]!.rect.maxY) > medianHeight * 0.5 || Math.abs(lower[0]!.rect.minY - lower[1]!.rect.minY) > medianHeight * 0.5) throw new Error('As regiões não formam duas fiadas espaciais coerentes.');
  if (upper.some((entry, index) => entry.rect.maxY > lower[index]!.rect.minY + tolerance)) throw new Error('As fiadas superior e inferior sobrepõem-se em excesso para criar uma hipótese provisória.');

  const left = Math.max(upper[0]!.rect.maxX, lower[0]!.rect.maxX);
  const right = upper[1]!.rect.minX;
  const top = Math.min(...entries.map((entry) => entry.rect.minY));
  const bottom = Math.max(...entries.map((entry) => entry.rect.maxY));
  if (right - left <= tolerance || top < 0 || bottom > imageSize.height || left < 0 || right > imageSize.width) throw new Error('A faixa residual central não tem limites espaciais plausíveis.');

  const candidatesByPosition: Array<{ id: ProvisionalZone['id']; label: string; entry: typeof entries[number]; rect: Rect }> = [
    { id: 'room-c', label: 'Room C · semântica pendente', entry: upper[0]!, rect: upper[0]!.rect },
    { id: 'room-a', label: 'Room A · semântica pendente', entry: upper[1]!, rect: upper[1]!.rect },
    { id: 'room-d', label: 'Room D · semântica pendente', entry: lower[0]!, rect: lower[0]!.rect },
    { id: 'room-b', label: 'Room B · fronteira corrigida provisoriamente', entry: lower[1]!, rect: { ...lower[1]!.rect, minX: right } },
  ];
  const zones: ProvisionalZone[] = candidatesByPosition.map(({ id, label, entry, rect }) => ({ id, label, vertices: rectangle(rect), status: 'provisional', sourceCandidateRegionIds: [entry.region.id], evidence: id === 'room-b' ? [`Proposta original ${entry.region.id} recortada no alinhamento da fronteira esquerda da região superior direita ${upper[1]!.region.id}.`, 'A linha de corte é uma hipótese geométrica ancorada em outra região candidata; a continuidade da parede não está confirmada.'] : [`Região candidata ${entry.region.id}; limites conservados em coordenadas de píxel.`, 'Validação raster, topológica e semântica ainda pendente.'] }));
  const hallRect = { minX: left, maxX: right, minY: top, maxY: bottom };
  zones.push({ id: 'hall', label: 'Hall central · região residual por rever', vertices: rectangle(hallRect), status: 'provisional', sourceCandidateRegionIds: [upper[0]!.region.id, upper[1]!.region.id, lower[0]!.region.id, lower[1]!.region.id], evidence: ['Contorno inferido da faixa entre as âncoras das colunas e dos limites superior/inferior das propostas.', 'Não é uma subtração aceite nem uma parede contínua confirmada; exige revisão da imagem original.'] });

  const rectByZone = new Map(zones.map((zone) => [zone.id, bounds(zone.vertices)]));
  const overlaps: ProvisionalPlanModel['overlaps'] = [];
  for (let i = 0; i < zones.length; i += 1) for (let j = i + 1; j < zones.length; j += 1) {
    const areaPx2 = overlapArea(rectByZone.get(zones[i]!.id)!, rectByZone.get(zones[j]!.id)!);
    if (areaPx2 > 1) overlaps.push({ first: zones[i]!.id, second: zones[j]!.id, areaPx2 });
  }
  const cutSupport = coveredIntervals(walls, right, lower[1]!.rect.minY, lower[1]!.rect.maxY, tolerance);
  const cutGaps = uncoveredIntervals(cutSupport, lower[1]!.rect.minY, lower[1]!.rect.maxY);
  const cutCoverage = cutSupport.reduce((sum, [start, end]) => sum + end - start, 0) / Math.max(1, lower[1]!.rect.maxY - lower[1]!.rect.minY);
  const unresolved = [
    { id: 'metric-scale', reason: 'Cotas e extremos arquitectónicos não foram confirmados; esta hipótese permanece em píxeis e sem dimensões métricas.' },
    { id: 'openings', reason: 'Aberturas continuam sem classificação/associação validada.' },
    { id: 'semantics', reason: 'Rótulos Room A–D são associações posicionais pendentes, não correspondências semânticas aceites.' },
    ...upper.flatMap((entry, index) => lower[index]!.rect.minY - entry.rect.maxY > tolerance ? [{ id: `room-row-gap-${index + 1}`, reason: `Intervalo sem região entre as fiadas nesta coluna: y=${entry.rect.maxY.toFixed(1)}–${lower[index]!.rect.minY.toFixed(1)} px; não preenchido nem classificado como parede.` }] : []),
    { id: 'hall-boundary', reason: `A faixa do hall é residual; a divisória inferida tem ${Math.round(cutCoverage * 100)}% de cobertura vertical única por segmentos candidatos e não pode ser tratada como parede contínua.` },
    ...cutGaps.map(([start, end], index) => ({ id: `hall-boundary-gap-${index + 1}`, reason: `Sem segmento de parede candidato na fronteira Room B/Hall entre y=${start.toFixed(1)} e ${end.toFixed(1)} px.` })),
  ];
  return { status: 'provisional', coordinateSpace: 'source-image-pixels', persistence: 'ephemeral', zones, unresolved, overlaps, sourceImageSize: { ...imageSize } };
}
