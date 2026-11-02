import { createPlanScene } from '../../src/plan-scene';
import type { PixelWallCandidate, PlanRegionCandidate } from '../../src/plan-reconstruction';
import { validateSpatialScene, type Node, type SceneRelation, type SceneTransaction, type SpatialSceneV1 } from '../../src/spatial-scene';

/** Uma divisão, em metros, com o eixo y do desenho a subir. Os vértices podem ir em qualquer sentido. */
export type RoomSpec = { id: string; vertices: Array<[number, number]> };
const PX_PER_M = 100;

/**
 * Constrói uma cena com `createPlanScene`, tal como o editor faz a partir de uma planta: uma parede por aresta (as arestas
 * comuns dão uma só parede), divisões como polígonos com `bounded_by` e `boundaryRefs`. 1 m = 100 px.
 */
export function sceneFromRooms(rooms: RoomSpec[], options: { sceneId?: string; recordedAt?: string } = {}): SceneTransaction {
  const px = ([x, y]: [number, number]) => ({ x: Math.round(x * PX_PER_M), y: Math.round(y * PX_PER_M) });
  const edgeIds = new Map<string, string>();
  const candidates: PixelWallCandidate[] = [];
  const edgeKey = (a: { x: number; y: number }, b: { x: number; y: number }) => [`${a.x},${a.y}`, `${b.x},${b.y}`].sort().join('|');
  const regions: PlanRegionCandidate[] = rooms.map((room) => {
    const vertices = room.vertices.map(px);
    const boundaryCandidateIds = vertices.map((start, index) => {
      const end = vertices[(index + 1) % vertices.length]!;
      const key = edgeKey(start, end);
      if (!edgeIds.has(key)) {
        const id = `e${edgeIds.size + 1}`;
        edgeIds.set(key, id);
        candidates.push({ id, orientation: start.y === end.y ? 'horizontal' : start.x === end.x ? 'vertical' : 'diagonal', start, end, thicknessPx: 10, confidence: 1, origin: 'manual_correction' });
      }
      return edgeIds.get(key)!;
    });
    let twice = 0;
    vertices.forEach((a, index) => { const b = vertices[(index + 1) % vertices.length]!; twice += a.x * b.y - b.x * a.y; });
    return { id: room.id, boundaryCandidateIds, vertices, areaPx2: Math.abs(twice) / 2, validation: 'unreviewed', eligibility: 'construction_candidate', confidence: 1, evidence: [] };
  });
  return createPlanScene({
    sceneId: options.sceneId ?? 'rooms', title: 'Divisões de teste', image: { sha256: 'a'.repeat(64), width: 2000, height: 2000 },
    calibration: { pixelDistance: PX_PER_M, realDistanceMetres: 1, evidence: 'Escala de teste: 100 px = 1 m.', actor: 'fixture' },
    confirmedCandidateIds: [], confirmedRegionIds: rooms.map((room) => room.id), regions, candidates, wall: { heightM: 2.8, thicknessM: 0.1 },
    recordedAt: options.recordedAt ?? '2026-11-01T10:00:00.000Z',
  });
}

export const nodeOf = (scene: SpatialSceneV1, id: string): Node => scene.nodes.find((node) => node.id === id)!;

/** A parede que as duas divisões partilham (a única referenciada por ambas). */
export function sharedWallId(scene: SpatialSceneV1, firstRoom: string, secondRoom: string): string {
  const walls = (id: string) => new Set(nodeOf(scene, id).component!.dependsOn);
  const common = [...walls(firstRoom)].filter((id) => walls(secondRoom).has(id));
  if (common.length !== 1) throw new Error(`esperava uma parede comum, há ${common.length}`);
  return common[0]!;
}

/** Endpoints (x, y do desenho, em metros) de uma parede, para os testes escolherem paredes pelo sítio e não pelo id. */
export function wallEnds(scene: SpatialSceneV1, wallId: string): [[number, number], [number, number]] {
  const wall = nodeOf(scene, wallId);
  if (wall.geometry?.kind !== 'box') throw new Error('sem geometria');
  const angle = 2 * Math.atan2(wall.transform.rotation[1], wall.transform.rotation[3]);
  const half = wall.geometry.sizeM[0] / 2;
  const dx = Math.cos(angle) * half; const dz = -Math.sin(angle) * half;
  const [cx, , cz] = wall.transform.translationM;
  return [[cx - dx, -(cz - dz)], [cx + dx, -(cz + dz)]];
}

export function wallBetween(scene: SpatialSceneV1, a: [number, number], b: [number, number]): string {
  const near = (p: [number, number], q: [number, number]) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6;
  const found = scene.nodes.filter((node) => node.component?.kind === 'wall').filter((node) => { const [p, q] = wallEnds(scene, node.id); return near(p, a) && near(q, b) || near(p, b) && near(q, a); });
  if (found.length !== 1) throw new Error(`esperava uma parede entre ${a} e ${b}, há ${found.length}`);
  return found[0]!.id;
}

/** Área dos vértices (x, z) pela fórmula de Gauss, em m². */
export function shoelace(vertices: Array<[number, number, number]>): number {
  let twice = 0;
  vertices.forEach((a, index) => { const b = vertices[(index + 1) % vertices.length]!; twice += a[0] * b[2] - b[0] * a[2]; });
  return Math.abs(twice) / 2;
}

/** Edita a cena à mão (para casos que `createPlanScene` não produz) e volta a validá-la. */
export function mutateScene(transaction: SceneTransaction, edit: (scene: SpatialSceneV1) => void): SceneTransaction {
  const scene = structuredClone(transaction.scene);
  edit(scene);
  return { ...transaction, scene: validateSpatialScene(scene) };
}

export const boundedBy = (room: string, wall: string, template: SceneRelation): SceneRelation => ({ ...structuredClone(template), id: `bounded-${room}-${wall}`, fromNodeId: room, toNodeId: wall });

export type BoundaryRef = { wallId: string; startIndex: number; endIndex: number; startEndpoint: 'a' | 'b'; endEndpoint: 'a' | 'b' };
export const refsOf = (room: Node): BoundaryRef[] => JSON.parse(String(room.component!.properties.boundaryRefs!.value)) as BoundaryRef[];
export const setRefs = (room: Node, refs: unknown): void => { room.component!.properties.boundaryRefs!.value = typeof refs === 'string' ? refs : JSON.stringify(refs); };
export const verticesOf = (room: Node): Array<[number, number, number]> => { if (room.geometry?.kind !== 'polygon') throw new Error('sem polígono'); return room.geometry.verticesM; };

/** Acrescenta um vértice à divisão na posição `at` e desloca os índices de boundaryRefs que o vértice empurra, como faria qualquer edição consistente. */
export function insertVertex(scene: SpatialSceneV1, roomId: string, at: number, vertex: [number, number, number]): void {
  const room = nodeOf(scene, roomId);
  verticesOf(room).splice(at, 0, vertex);
  setRefs(room, refsOf(room).map((ref) => ({ ...ref, startIndex: ref.startIndex >= at ? ref.startIndex + 1 : ref.startIndex, endIndex: ref.endIndex >= at ? ref.endIndex + 1 : ref.endIndex })));
}

/**
 * Tira um vértice à divisão mantendo as referências coerentes: as que acabavam nele passam a acabar no vértice seguinte e as que
 * começavam nele passam a começar no anterior (é a forma de uma divisão em que a aresta é mais comprida do que a parede).
 */
export function dropVertexKeepRefs(scene: SpatialSceneV1, roomId: string, index: number): void {
  const room = nodeOf(scene, roomId);
  verticesOf(room).splice(index, 1);
  const shift = (i: number, role: 'start' | 'end') => (i > index ? i - 1 : i === index ? (role === 'end' ? index : index - 1) : i);
  setRefs(room, refsOf(room).map((ref) => ({ ...ref, startIndex: shift(ref.startIndex, 'start'), endIndex: shift(ref.endIndex, 'end') })));
}
