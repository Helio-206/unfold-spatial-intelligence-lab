import type { RoomMergeResult } from './room-merge';
import { explainSceneError } from './scene-messages';
import type { Node, SpatialSceneV1 } from './spatial-scene';

/**
 * What the wall-removal card says. Everything is read from the scene state: the openings that depend on
 * the wall, the rooms that are bounded by it, their areas (shoelace over the room polygon, in the scene's own units).
 * Nothing here decides whether the removal is allowed: that stays with the scene engine (previewSceneCommand /
 * removeWallFromScene). It only describes the situation.
 */

export type RemovalDescription = {
  wallId: string;
  wallLabel: string;
  lengthM: number | null;
  openings: Array<{ id: string; label: string }>;
  /** Rooms whose boundary relation points at this wall. The engine refuses to remove a wall while any exist. */
  rooms: Array<{ id: string; label: string; areaM2: number | null }>;
  /** The scene carries no structural data, so this is always unknown. */
  structure: 'unknown';
};

/** Area of a room polygon on the floor plane (x, z). null when it is not a proper polygon. */
export function polygonAreaM2(node: Node): number | null {
  if (node.geometry?.kind !== 'polygon') return null;
  const v = node.geometry.verticesM;
  if (v.length < 3) return null;
  let sum = 0;
  for (let i = 0; i < v.length; i += 1) { const a = v[i]!; const b = v[(i + 1) % v.length]!; sum += a[0] * b[2] - b[0] * a[2]; }
  return Math.abs(sum) / 2;
}

export function describeWallRemoval(scene: SpatialSceneV1, wallId: string): RemovalDescription | undefined {
  const wall = scene.nodes.find((node) => node.id === wallId);
  if (!wall || wall.component?.kind !== 'wall') return undefined;
  const openings = scene.nodes.filter((node) => node.component?.dependsOn.includes(wallId) && (node.component.kind === 'door' || node.component.kind === 'window')).map((node) => ({ id: node.id, label: node.label }));
  const roomIds = new Set(scene.relations.filter((relation) => relation.toNodeId === wallId || relation.fromNodeId === wallId).map((relation) => (relation.fromNodeId === wallId ? relation.toNodeId : relation.fromNodeId)));
  const rooms = scene.nodes.filter((node) => roomIds.has(node.id) && node.component?.kind === 'room').map((node) => ({ id: node.id, label: node.label, areaM2: polygonAreaM2(node) }));
  return { wallId, wallLabel: wall.label, lengthM: wall.geometry?.kind === 'box' ? wall.geometry.sizeM[0] : null, openings, rooms, structure: 'unknown' };
}

// ---------------------------------------------------------------------------------------------------------------------
// O texto do cartão de remoção. Pura: o editor só a desenha.
// ---------------------------------------------------------------------------------------------------------------------
export type CardRow = { label: string; value: string; tone?: 'unknown' };
export type RemovalCard =
  | { ok: true; title: string; rows: CardRow[]; notice: string }
  | { ok: false; title: string; reason: string; code: string; rows: CardRow[] };
export type RemovalOutcome =
  | { ok: true; plan: { merge?: Extract<RoomMergeResult, { status: 'merge' }> }; notice: string }
  | { ok: false; code: string };

/** Áreas em m² com vírgula decimal, sem zeros a mais: 21 → «21», 22,5 → «22,5». */
const m2 = (value: number) => value.toLocaleString('pt-PT', { maximumFractionDigits: 2, useGrouping: false });
const STATUS_WORD = { pass: 'ok', fail: 'falhou', unknown: 'desconhecida' } as const;
const STRUCTURE: CardRow = { label: 'estrutura', value: 'desconhecida · sem dados estruturais', tone: 'unknown' };

function removesRow(info: RemovalDescription): CardRow {
  const count = info.openings.length;
  return { label: 'remove', value: `1 parede${count ? ` e ${count} abertura${count > 1 ? 's' : ''}` : ''}` };
}

/**
 * O que o cartão diz sobre uma remoção, lido da operação candidata (o plano) e não da cena de partida: a divisão que sai, a sua
 * área (calculada pelo motor a partir do polígono resultante) e as verificações do Core. A estrutura é sempre desconhecida.
 */
export function describeRemovalCard(info: RemovalDescription, outcome: RemovalOutcome): RemovalCard {
  if (!outcome.ok) {
    const reason = outcome.code === 'REMOVE_HAS_DEPENDENCIES' ? `O motor recusa porque há elementos que dependem desta parede${info.rooms.length ? ` (${info.rooms.map((room) => room.label).join(', ')} ${info.rooms.length > 1 ? 'dependem' : 'depende'} dela)` : ''}.` : (explainSceneError(outcome.code));
    return { ok: false, title: info.wallLabel, reason, code: outcome.code, rows: [STRUCTURE] };
  }
  const rows: CardRow[] = [removesRow(info)];
  const merge = outcome.plan.merge;
  if (!merge) rows.push({ label: 'divisões afectadas', value: 'nenhuma' });
  else {
    rows.push({ label: 'divisões', value: `${merge.merged.label} → 1 divisão, ${m2(merge.areas.merged)} m² · calculado` });
    for (const check of merge.report.checks) {
      if (check.id === 'architecture.room-merge.area') rows.push({ label: 'área conservada', value: `${STATUS_WORD[check.status]} · ${m2(merge.areas.merged)} m² = ${m2(merge.areas.first)} + ${m2(merge.areas.second)} m²` });
      else if (check.id === 'architecture.room-merge.simple-polygon') rows.push({ label: 'polígono simples', value: STATUS_WORD[check.status] });
    }
  }
  rows.push(STRUCTURE);
  return { ok: true, title: `Remover ${info.wallLabel}`, rows, notice: outcome.notice };
}
