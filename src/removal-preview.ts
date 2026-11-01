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
