import { sha256Hex, type Check, type VerificationReport } from './core';
import { polygonAreaM2 } from './removal-preview';
import { explainSceneError } from './scene-messages';
import type { Node, PropertyProvenance, SceneRelation, SpatialProperty, SpatialSceneV1 } from './spatial-scene';

/**
 * Fusão de duas divisões quando se remove a parede que as separa. Só calcula: lê a cena e devolve a divisão nova, as
 * relações e o relatório de verificações, ou o motivo por que não consegue provar a fusão. Quem aplica é a remoção composta
 * (`planWallRemoval`), com preview, guarda de valores confirmados e autorização como qualquer outra operação.
 *
 * Caso limpo (v1): a parede é referenciada por exactamente duas divisões, cada uma tem uma aresta que coincide com os
 * extremos da parede, as duas divisões ficam em lados opostos dela e a união é um polígono simples sem buracos.
 * Tudo o que isto não prova fica bloqueado com um código; nada é adivinhado.
 */

/** Dois pontos a menos de 1 mm contam como o mesmo ponto. */
export const ROOM_MERGE_TOLERANCE_M = 1e-3;
/** Erro relativo máximo na conservação da área (a área da união contra a soma das duas divisões). */
export const ROOM_MERGE_AREA_TOLERANCE = 1e-9;

export type RoomMergeBlockCode =
  | 'ROOM_MERGE_SINGLE_ROOM'
  | 'ROOM_MERGE_MORE_THAN_TWO_ROOMS'
  | 'ROOM_MERGE_NOT_POLYGON'
  | 'ROOM_MERGE_BOUNDARY_INCOMPLETE'
  | 'ROOM_MERGE_UNSUPPORTED_TRANSFORM'
  | 'ROOM_MERGE_EDGE_MISMATCH'
  | 'ROOM_MERGE_TOUCH_ELSEWHERE'
  | 'ROOM_MERGE_NOT_SIMPLE'
  | 'ROOM_MERGE_OTHER_RELATIONS'
  | 'ROOM_MERGE_AREA_NOT_CONSERVED';

export type RoomMergeResult =
  | { status: 'none' }
  | { status: 'blocked'; code: RoomMergeBlockCode; message: string; roomIds: string[] }
  | {
    status: 'merge';
    wallId: string;
    /** Por ordem na cena. */
    roomIds: [string, string];
    merged: Node;
    /** As relações `bounded_by` da divisão nova, uma por parede que fica. */
    relations: SceneRelation[];
    /** Todas as relações das duas divisões antigas, que desaparecem com elas. */
    removedRelationIds: string[];
    areas: { first: number; second: number; merged: number };
    /** Em que escala assentam os metros quadrados: a que a cena traz, tal como está registada (nunca promovida). */
    scale: ScaleBasis;
    /** `confirmed` só se a geometria das duas divisões de origem estiver verificada ou corrigida por alguém. */
    sourceGeometry: 'confirmed' | 'unreviewed';
    report: VerificationReport;
  };

/**
 * A base da escala (pixels → metros) da cena, lida da proveniência que lá está. `verified` só com `verified`/`corrected`;
 * o que uma pessoa escreveu e ninguém reviu é `unverified`, não confirmado. Sem calibração, `unknown`.
 */
export type ScaleBasis = { state: 'verified' | 'unverified' | 'rejected' | 'unknown'; source: PropertyProvenance['source'] | null; validation: PropertyProvenance['validation'] | null; evidence: string | null };

export function describeScaleBasis(scene: SpatialSceneV1): ScaleBasis {
  const provenance = scene.imageWorldMapping?.provenance;
  if (!provenance) return { state: 'unknown', source: null, validation: null, evidence: null };
  const state = provenance.validation === 'verified' || provenance.validation === 'corrected' ? 'verified' : provenance.validation === 'rejected' ? 'rejected' : 'unverified';
  return { state, source: provenance.source, validation: provenance.validation, evidence: provenance.evidence ?? null };
}

const SCALE_SOURCE_WORDS: Record<PropertyProvenance['source'], string> = {
  user: 'fornecida pelo utilizador', technical_document: 'lida do documento técnico', derived: 'derivada pelo motor', solver: 'calculada por um solver', system: 'definida pelo sistema',
};
/** «fornecida pelo utilizador» e afins: de onde vem a escala, sem dizer nada sobre se está certa. */
const scaleSentence = (scale: ScaleBasis): string => (scale.state === 'unknown' ? 'que não está registada' : `${scaleSourceWords(scale)}${scale.state === 'verified' ? ' e verificada' : scale.state === 'rejected' ? ' e rejeitada' : ', por verificar'}`);
export const scaleSourceWords = (scale: ScaleBasis): string => (scale.source ? SCALE_SOURCE_WORDS[scale.source] : 'sem origem conhecida');

type Point = [number, number];
type Vertex = [number, number, number];
const TOL = ROOM_MERGE_TOLERANCE_M;

const xz = (vertex: Vertex): Point => [vertex[0], vertex[2]];
const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const near = (a: Point, b: Point) => dist(a, b) <= TOL;
const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];
const minus = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];

function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const ab = minus(b, a); const length2 = ab[0] * ab[0] + ab[1] * ab[1];
  if (length2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / length2));
  return dist(p, [a[0] + t * ab[0], a[1] + t * ab[1]]);
}
/** Parâmetros da intersecção das rectas, ou undefined se forem paralelas. */
function lineIntersection(a0: Point, a1: Point, b0: Point, b1: Point): { t: number; u: number } | undefined {
  const r = minus(a1, a0); const s = minus(b1, b0); const denominator = cross(r, s);
  if (Math.abs(denominator) <= 1e-12 * Math.hypot(...r) * Math.hypot(...s)) return undefined;
  const q = minus(b0, a0);
  return { t: cross(q, s) / denominator, u: cross(q, r) / denominator };
}
function segmentsDistance(a0: Point, a1: Point, b0: Point, b1: Point): number {
  const hit = lineIntersection(a0, a1, b0, b1);
  if (hit && hit.t >= 0 && hit.t <= 1 && hit.u >= 0 && hit.u <= 1) return 0;
  return Math.min(pointSegmentDistance(a0, b0, b1), pointSegmentDistance(a1, b0, b1), pointSegmentDistance(b0, a0, a1), pointSegmentDistance(b1, a0, a1));
}
const signedArea = (ring: Point[]) => ring.reduce((sum, a, index) => { const b = ring[(index + 1) % ring.length]!; return sum + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;

/** Um anel é simples se nenhuma aresta toca outra além de nos vértices comuns e não há vértices repetidos nem dobras de 180°. */
function isSimpleRing(ring: Point[]): boolean {
  const n = ring.length;
  if (n < 3 || Math.abs(signedArea(ring)) <= TOL * TOL) return false;
  const edge = (i: number): [Point, Point] => [ring[i]!, ring[(i + 1) % n]!];
  for (let i = 0; i < n; i += 1) {
    const [a0, a1] = edge(i);
    if (near(a0, a1)) return false;
    for (let j = i + 1; j < n; j += 1) {
      const [b0, b1] = edge(j);
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) {
        // Só partilham o vértice comum: o outro extremo de cada uma não pode cair em cima da outra aresta (dobra sobre si).
        const [shared, far1, far2] = j === i + 1 ? [a1, a0, b1] : [a0, a1, b0];
        if (pointSegmentDistance(far1, b0, b1) <= TOL && !near(far1, shared) || pointSegmentDistance(far2, a0, a1) <= TOL && !near(far2, shared)) return false;
      } else if (segmentsDistance(a0, a1, b0, b1) <= TOL) return false;
    }
  }
  return true;
}

/** Extremos de uma parede no plano do chão (x, z), ou undefined se a parede não tem a caixa paramétrica. */
export function wallEndpointsXZ(wall: Node): [Point, Point] | undefined {
  if (wall.geometry?.kind !== 'box') return undefined;
  const angle = 2 * Math.atan2(wall.transform.rotation[1], wall.transform.rotation[3]);
  const half = wall.geometry.sizeM[0] / 2;
  const dx = Math.cos(angle) * half; const dz = -Math.sin(angle) * half;
  return [[wall.transform.translationM[0] - dx, wall.transform.translationM[2] - dz], [wall.transform.translationM[0] + dx, wall.transform.translationM[2] + dz]];
}

const forward = (n: number, from: number, to: number): number[] => { const out = [from]; for (let i = from; i !== to;) { i = (i + 1) % n; out.push(i); } return out; };

/** O troço do anel que vai de um extremo da parede ao outro em linha recta ao longo dela, e em que sentido. */
function chainAlong(ring: Vertex[], w0: Point, w1: Point): { start: number; end: number } | undefined {
  const points = ring.map(xz);
  const at0 = points.flatMap((p, i) => (near(p, w0) ? [i] : []));
  const at1 = points.flatMap((p, i) => (near(p, w1) ? [i] : []));
  if (at0.length !== 1 || at1.length !== 1) return undefined;
  for (const [start, end] of [[at0[0]!, at1[0]!], [at1[0]!, at0[0]!]] as const) {
    const path = forward(ring.length, start, end);
    if (path.every((index) => pointSegmentDistance(points[index]!, w0, w1) <= TOL)) return { start, end };
  }
  return undefined;
}

/** Como dois segmentos se tocam: não se tocam, num ponto (e se é um cruzamento de lado a lado), ou ao longo de um troço. */
function contact(a0: Point, a1: Point, b0: Point, b1: Point): { kind: 'none' } | { kind: 'overlap' } | { kind: 'point'; at: Point; crossing: boolean } {
  if (segmentsDistance(a0, a1, b0, b1) > TOL) return { kind: 'none' };
  const lengthA = dist(a0, a1); const lengthB = dist(b0, b1);
  const hit = lineIntersection(a0, a1, b0, b1);
  if (!hit) {
    // Paralelas e a menos de TOL: sobrepõem-se ao longo de um troço, ou só se tocam nas pontas.
    const along = (p: Point) => ((p[0] - a0[0]) * (a1[0] - a0[0]) + (p[1] - a0[1]) * (a1[1] - a0[1])) / lengthA;
    const lo = Math.max(0, Math.min(along(b0), along(b1))); const hi = Math.min(lengthA, Math.max(along(b0), along(b1)));
    if (hi - lo > TOL) return { kind: 'overlap' };
    const ends = [a0, a1, b0, b1];
    const touching = ends.find((p, i) => (i < 2 ? pointSegmentDistance(p, b0, b1) : pointSegmentDistance(p, a0, a1)) <= TOL)!;
    return { kind: 'point', at: touching, crossing: false };
  }
  const point: Point = [a0[0] + hit.t * (a1[0] - a0[0]), a0[1] + hit.t * (a1[1] - a0[1])];
  const interior = hit.t * lengthA > TOL && (1 - hit.t) * lengthA > TOL && hit.u * lengthB > TOL && (1 - hit.u) * lengthB > TOL;
  return { kind: 'point', at: point, crossing: interior && hit.t > 0 && hit.t < 1 && hit.u > 0 && hit.u < 1 };
}

/** Abaixo disto uma transformada conta como identidade (ruído de vírgula flutuante); acima, é uma transformada de verdade. */
const FRAME_TOLERANCE = 1e-9;
const isZero = (value: number) => Math.abs(value) <= FRAME_TOLERANCE;
const isOne = (value: number) => Math.abs(value - 1) <= FRAME_TOLERANCE;
/**
 * O polígono de uma divisão está no referencial da cena? O motor compara-o com os extremos das paredes, que calcula em
 * coordenadas da cena, e `applyWallEdit` escreve extremos de parede directamente nos vértices da divisão. Isso só é verdade se
 * a divisão não tiver posição, rotação, escala nem pai próprios. A fusão não tenta converter referenciais: recusa-os.
 */
const roomInSceneFrame = (node: Node): boolean => node.parentId === null && node.transform.translationM.every(isZero) && node.transform.scale.every(isOne)
  && node.transform.rotation.slice(0, 3).every(isZero) && isOne(Math.abs(node.transform.rotation[3]!));
/** Uma parede só serve se os extremos que o motor lê (centro ± metade do comprimento, no plano do chão) são os do mundo. */
const wallInSceneFrame = (node: Node): boolean => node.parentId === null && node.transform.scale.every(isOne) && isZero(node.transform.rotation[0]) && isZero(node.transform.rotation[2]);

// ---------------------------------------------------------------------------------------------------------------------
// Invariantes da fronteira de uma divisão: cada parede de `dependsOn` tem as suas boundaryRefs e cada referência é válida.
// `applyWallEdit` só actualiza o polígono pelas boundaryRefs; uma parede em dependsOn sem elas é uma dependência que não actualiza nada.
// ---------------------------------------------------------------------------------------------------------------------
export type BoundaryRef = { wallId: string; startIndex: number; endIndex: number; startEndpoint: 'a' | 'b'; endEndpoint: 'a' | 'b' };
export type BoundaryViolationCode = 'NOT_A_ROOM' | 'UNREADABLE_REFS' | 'UNKNOWN_WALL' | 'MISSING_REF' | 'STALE_REF' | 'BAD_INDEX' | 'BAD_ENDPOINT' | 'INCONSISTENT_ENDPOINT' | 'DUPLICATE_REF' | 'CONTRADICTORY_REF';
export type BoundaryViolation = { code: BoundaryViolationCode; wallId?: string; detail: string };

type RawRef = { wallId: string; startIndex: number; endIndex: number; startEndpoint: string; endEndpoint: string };
/** Lê o JSON de `boundaryRefs`. Só diz `undefined` se não for uma lista de objectos com a forma certa; os valores errados ficam para o verificador. */
function readBoundaryRefs(node: Node): RawRef[] | undefined {
  const value = node.component?.properties.boundaryRefs?.value;
  if (typeof value !== 'string') return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return undefined; }
  if (!Array.isArray(parsed)) return undefined;
  const wellFormed = parsed.every((ref) => ref && typeof ref === 'object' && typeof ref.wallId === 'string' && typeof ref.startIndex === 'number' && typeof ref.endIndex === 'number' && typeof ref.startEndpoint === 'string' && typeof ref.endEndpoint === 'string');
  return wellFormed ? (parsed as RawRef[]) : undefined;
}

/**
 * Verifica as invariantes de uma divisão contra as paredes da cena. `removedWallIds`: paredes que a operação em curso remove e que
 * já não podem ser referenciadas. Devolve todas as violações (lista vazia = consistente). Reutilizável por outras operações.
 */
export function checkBoundaryIntegrity(scene: SpatialSceneV1, roomId: string, options: { removedWallIds?: string[] } = {}): BoundaryViolation[] {
  const room = scene.nodes.find((node) => node.id === roomId);
  return checkRoomBoundary(room, new Map(scene.nodes.map((node) => [node.id, node])), options.removedWallIds ?? []);
}

function checkRoomBoundary(room: Node | undefined, nodes: Map<string, Node>, removed: string[]): BoundaryViolation[] {
  if (!room || room.component?.kind !== 'room' || room.geometry?.kind !== 'polygon') return [{ code: 'NOT_A_ROOM', detail: 'Não é uma divisão com polígono.' }];
  const violations: BoundaryViolation[] = [];
  const add = (code: BoundaryViolationCode, detail: string, wallId?: string) => violations.push({ code, detail, ...(wallId ? { wallId } : {}) });
  const refs = readBoundaryRefs(room);
  if (!refs) return [{ code: 'UNREADABLE_REFS', detail: 'boundaryRefs em falta, ilegível ou com a forma errada.' }];
  const vertices = room.geometry.verticesM;
  const dependsOn = new Set(room.component.dependsOn);
  const wallOf = (id: string) => { const node = nodes.get(id); return node?.component?.kind === 'wall' && !removed.includes(id) ? node : undefined; };

  for (const id of dependsOn) {
    if (removed.includes(id)) add('STALE_REF', 'dependsOn ainda inclui uma parede removida.', id);
    else if (!wallOf(id)) add('UNKNOWN_WALL', 'dependsOn inclui uma parede que não existe.', id);
    else if (!refs.some((ref) => ref.wallId === id)) add('MISSING_REF', 'A parede está em dependsOn mas não tem nenhuma boundaryRef: editá-la não actualizaria o polígono.', id);
  }
  const seen = new Map<string, RawRef>();
  const startsOf = new Map<string, number>();
  const endpointAt = new Map<string, string>();
  for (const ref of refs) {
    if (!dependsOn.has(ref.wallId) || removed.includes(ref.wallId)) { add('STALE_REF', 'boundaryRef de uma parede que já não é da divisão.', ref.wallId); continue; }
    const wall = wallOf(ref.wallId);
    if (!wall) { add('UNKNOWN_WALL', 'boundaryRef de uma parede que não existe.', ref.wallId); continue; }
    const validIndex = (index: number) => Number.isInteger(index) && index >= 0 && index < vertices.length;
    if (!validIndex(ref.startIndex) || !validIndex(ref.endIndex) || ref.startIndex === ref.endIndex) { add('BAD_INDEX', `Índices de vértice inválidos (${ref.startIndex}, ${ref.endIndex}) num polígono de ${vertices.length} vértices.`, ref.wallId); continue; }
    if (!['a', 'b'].includes(ref.startEndpoint) || !['a', 'b'].includes(ref.endEndpoint)) { add('BAD_ENDPOINT', 'O extremo tem de ser «a» ou «b».', ref.wallId); continue; }
    const key = JSON.stringify([ref.wallId, ref.startIndex, ref.endIndex, ref.startEndpoint, ref.endEndpoint]);
    if (seen.has(key)) { add('DUPLICATE_REF', 'boundaryRef repetida.', ref.wallId); continue; }
    seen.set(key, ref);
    const startKey = `${ref.wallId}|start|${ref.startIndex}`;
    if (startsOf.has(startKey) && startsOf.get(startKey) !== ref.endIndex) add('CONTRADICTORY_REF', 'O mesmo vértice de início liga a dois vértices de fim diferentes.', ref.wallId);
    startsOf.set(startKey, ref.endIndex);
    for (const [index, endpoint] of [[ref.startIndex, ref.startEndpoint], [ref.endIndex, ref.endEndpoint]] as const) {
      const vertexKey = `${ref.wallId}|${index}`;
      if (endpointAt.has(vertexKey) && endpointAt.get(vertexKey) !== endpoint) add('CONTRADICTORY_REF', 'O mesmo vértice está ligado aos dois extremos da parede.', ref.wallId);
      endpointAt.set(vertexKey, endpoint);
    }
    const ends = wallEndpointsXZ(wall);
    if (!ends) { add('UNKNOWN_WALL', 'A parede não tem geometria paramétrica.', ref.wallId); continue; }
    // O extremo recordado tem de ser o mais perto do vértice: uma edição anterior pode ter esticado o polígono para lá da parede,
    // mas não troca de lado. Se trocou (ordem dos extremos invertida), seguir a referência levaria o vértice para o lado errado.
    const nearer = (vertex: Vertex, endpoint: string) => { const at = xz(vertex); const mine = ends[endpoint === 'a' ? 0 : 1]; const other = ends[endpoint === 'a' ? 1 : 0]; return dist(at, mine) <= dist(at, other) + TOL; };
    const separate = dist(ends[0], ends[1]) > TOL;
    if (separate && (!nearer(vertices[ref.startIndex]!, ref.startEndpoint) || !nearer(vertices[ref.endIndex]!, ref.endEndpoint) || ref.startEndpoint === ref.endEndpoint)) add('INCONSISTENT_ENDPOINT', 'Os extremos recordados não correspondem à posição dos vértices.', ref.wallId);
  }
  return violations;
}

const propertyString = (node: Node, key: string): string | undefined => {
  const value = (node.component?.properties[key] ?? node.properties[key])?.value;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};
/** O nome pelo qual uma divisão é conhecida: a propriedade `name` (escrita por uma pessoa) ou, sem ela, a etiqueta. */
export const roomDisplayName = (node: Node): string => propertyString(node, 'name') ?? node.label;

function blocked(code: RoomMergeBlockCode, roomIds: string[]): RoomMergeResult {
  return { status: 'blocked', code, message: explainSceneError(code), roomIds };
}

const toProvenance = (source: PropertyProvenance['source']): 'observed' | 'human_entered' | 'solver' | 'derived' => (source === 'technical_document' ? 'observed' : source === 'user' ? 'human_entered' : source === 'solver' ? 'solver' : 'derived');

/**
 * `none` se a parede não é limite de nenhuma divisão (não há nada a fundir); `blocked` com o código se há divisões que o
 * motor não consegue fundir com prova; `merge` com a divisão nova e o relatório. `recordedAt` é o instante da avaliação, para
 * o resultado ser reproduzível no commit.
 */
export function planRoomMerge(scene: SpatialSceneV1, wallId: string, recordedAt: string): RoomMergeResult {
  const wall = scene.nodes.find((node) => node.id === wallId);
  if (!wall || wall.component?.kind !== 'wall') return { status: 'none' };
  const roomIds = new Set(scene.nodes.filter((node) => node.component?.kind === 'room' && node.component.dependsOn.includes(wallId)).map((node) => node.id));
  for (const relation of scene.relations) {
    if (relation.kind === 'bounded_by' && relation.toNodeId === wallId && scene.nodes.find((node) => node.id === relation.fromNodeId)?.component?.kind === 'room') roomIds.add(relation.fromNodeId);
  }
  const rooms = scene.nodes.filter((node) => roomIds.has(node.id));
  if (rooms.length === 0) return { status: 'none' };
  const ids = rooms.map((room) => room.id);
  if (rooms.length === 1) return blocked('ROOM_MERGE_SINGLE_ROOM', ids);
  if (rooms.length > 2) return blocked('ROOM_MERGE_MORE_THAN_TWO_ROOMS', ids);

  const [first, second] = rooms as [Node, Node];
  const rings = [first, second].map((room) => (room.geometry?.kind === 'polygon' && room.geometry.verticesM.length >= 3 ? room.geometry.verticesM.map((v) => [...v] as Vertex) : undefined));
  if (!rings[0] || !rings[1]) return blocked('ROOM_MERGE_NOT_POLYGON', ids);
  // Só `bounded_by` com paredes sabe o motor refazer. Qualquer outra relação ligada a uma das divisões fica sem dono.
  const involved = new Set(ids);
  if (scene.relations.some((relation) => (involved.has(relation.fromNodeId) || involved.has(relation.toNodeId)) && !(relation.kind === 'bounded_by' && involved.has(relation.fromNodeId) && !involved.has(relation.toNodeId)))) return blocked('ROOM_MERGE_OTHER_RELATIONS', ids);

  // Referenciais: nada de converter, nada de adivinhar. Uma fusão nunca se prova com relações que são falsas no mundo.
  const involvedWalls = [...new Set([wallId, ...first.component!.dependsOn, ...second.component!.dependsOn])].flatMap((id) => scene.nodes.filter((node) => node.id === id));
  if (!roomInSceneFrame(first) || !roomInSceneFrame(second) || involvedWalls.some((node) => node.component?.kind === 'wall' && !wallInSceneFrame(node))) return blocked('ROOM_MERGE_UNSUPPORTED_TRANSFORM', ids);

  // Fronteira: as referências de partida têm de estar completas e ser válidas. Nada de filtrar o que falha e seguir.
  const sourceRefs: BoundaryRef[][] = [];
  for (const room of [first, second]) {
    const raw = readBoundaryRefs(room);
    const polygonLength = room.geometry!.kind === 'polygon' ? room.geometry!.verticesM.length : 0;
    const keep = (raw ?? []).filter((ref) => ref.wallId !== wallId);
    const dependsOn = room.component!.dependsOn;
    const nodesById = new Map(scene.nodes.map((node) => [node.id, node]));
    const usable = !!raw
      && dependsOn.every((id) => nodesById.get(id)?.component?.kind === 'wall' && (id === wallId || keep.some((ref) => ref.wallId === id)))
      && keep.every((ref) => dependsOn.includes(ref.wallId) && Number.isInteger(ref.startIndex) && Number.isInteger(ref.endIndex) && ref.startIndex >= 0 && ref.endIndex >= 0 && ref.startIndex < polygonLength && ref.endIndex < polygonLength && ref.startIndex !== ref.endIndex && ['a', 'b'].includes(ref.startEndpoint) && ['a', 'b'].includes(ref.endEndpoint));
    if (!usable) return blocked('ROOM_MERGE_BOUNDARY_INCOMPLETE', ids);
    const unique = new Map(keep.map((ref) => [JSON.stringify([ref.wallId, ref.startIndex, ref.endIndex, ref.startEndpoint, ref.endEndpoint]), ref as BoundaryRef]));
    sourceRefs.push([...unique.values()]);
  }

  const ends = wallEndpointsXZ(wall);
  if (!ends) return blocked('ROOM_MERGE_EDGE_MISMATCH', ids);
  const [w0, w1] = ends;

  // Anéis no mesmo sentido (área positiva), sem a repetição do primeiro vértice no fim.
  type Tagged = { v: Vertex; key: string };
  const taggedRings = rings.map((ring, which) => { const tagged: Tagged[] = ring!.map((v, i) => ({ v, key: `${which}:${i}` })); return signedArea(ring!.map(xz)) < 0 ? tagged.reverse() : tagged; }) as [Tagged[], Tagged[]];
  const oriented = taggedRings.map((ring) => ring.map((item) => item.v)) as [Vertex[], Vertex[]];
  if (!oriented.every((ring) => isSimpleRing(ring.map(xz)))) return blocked('ROOM_MERGE_NOT_SIMPLE', ids);
  const chains = oriented.map((ring) => chainAlong(ring, w0, w1));
  if (!chains[0] || !chains[1]) return blocked('ROOM_MERGE_EDGE_MISMATCH', ids);
  const [A, B] = oriented;
  const [ca, cb] = chains as [{ start: number; end: number }, { start: number; end: number }];
  // Lados opostos da parede: o troço de B percorre-se ao contrário do de A.
  if (!near(xz(B[cb.start]!), xz(A[ca.end]!)) || !near(xz(B[cb.end]!), xz(A[ca.start]!))) return blocked('ROOM_MERGE_NOT_SIMPLE', ids);

  const restA = forward(A.length, ca.end, ca.start).map((i) => taggedRings[0][i]!);
  const restB = forward(B.length, cb.end, cb.start).map((i) => taggedRings[1][i]!);
  const q = xz(A[ca.end]!); const p = xz(A[ca.start]!);
  for (let i = 0; i + 1 < restA.length; i += 1) {
    for (let j = 0; j + 1 < restB.length; j += 1) {
      const found = contact(xz(restA[i]!.v), xz(restA[i + 1]!.v), xz(restB[j]!.v), xz(restB[j + 1]!.v));
      if (found.kind === 'none') continue;
      if (found.kind === 'overlap') return blocked('ROOM_MERGE_TOUCH_ELSEWHERE', ids);
      if (near(found.at, p) || near(found.at, q)) continue;
      return blocked(found.crossing ? 'ROOM_MERGE_NOT_SIMPLE' : 'ROOM_MERGE_TOUCH_ELSEWHERE', ids);
    }
  }
  const union: Tagged[] = [...restA, ...restB.slice(1, -1)];
  // Os dois extremos do troço partilhado existem nas duas divisões; na união fica a versão de A, e as referências de B apontam para ela.
  const alias = new Map<string, string>([[taggedRings[1][cb.start]!.key, taggedRings[0][ca.end]!.key], [taggedRings[1][cb.end]!.key, taggedRings[0][ca.start]!.key]]);

  // Paredes que ficam e as suas referências (as das duas divisões, já validadas), com os vértices de origem mapeados para a união.
  const remainingIds = [...new Set([...first.component!.dependsOn, ...second.component!.dependsOn])].filter((id) => id !== wallId);
  const ring: Tagged[] = [];
  for (const item of union) {
    if (ring.length && near(xz(item.v), xz(ring[ring.length - 1]!.v))) alias.set(item.key, ring[ring.length - 1]!.key);
    else ring.push(item);
  }
  while (ring.length > 1 && near(xz(ring[0]!.v), xz(ring[ring.length - 1]!.v))) alias.set(ring.pop()!.key, ring[0]!.key);
  const resolve = (key: string) => alias.get(key) ?? key;
  const carried = sourceRefs.flatMap((refs, which) => refs.map((ref) => ({ ...ref, startKey: resolve(`${which}:${ref.startIndex}`), endKey: resolve(`${which}:${ref.endIndex}`) })));
  const present = new Set(ring.map((item) => item.key));
  // Uma referência que aponta para um vértice que a união não tem (por exemplo, dentro do troço partilhado) não se consegue representar.
  if (carried.some((ref) => !present.has(ref.startKey) || !present.has(ref.endKey) || ref.startKey === ref.endKey)) return blocked('ROOM_MERGE_BOUNDARY_INCOMPLETE', ids);
  // Um vértice colinear só sai se nenhuma referência o usar: são as referências, não a geometria, que dizem onde as paredes se juntam.
  const referenced = new Set(carried.flatMap((ref) => [ref.startKey, ref.endKey]));
  for (let changed = true; changed && ring.length > 3;) {
    changed = false;
    for (let i = 0; i < ring.length; i += 1) {
      const before = xz(ring[(i + ring.length - 1) % ring.length]!.v); const here = xz(ring[i]!.v); const after = xz(ring[(i + 1) % ring.length]!.v);
      const straight = pointSegmentDistance(here, before, after) <= TOL && (here[0] - before[0]) * (after[0] - here[0]) + (here[1] - before[1]) * (after[1] - here[1]) > 0;
      if (straight && !referenced.has(ring[i]!.key)) { ring.splice(i, 1); changed = true; break; }
    }
  }
  const points = ring.map((item) => xz(item.v));
  if (!isSimpleRing(points)) return blocked('ROOM_MERGE_NOT_SIMPLE', ids);

  const areaFirst = polygonAreaM2(first)!; const areaSecond = polygonAreaM2(second)!;
  const areaMerged = Math.abs(signedArea(points));
  const expected = areaFirst + areaSecond;
  const areaTolerance = ROOM_MERGE_AREA_TOLERANCE * expected;
  const areaConserved = Math.abs(areaMerged - expected) <= areaTolerance;
  if (!areaConserved) return blocked('ROOM_MERGE_AREA_NOT_CONSERVED', ids);

  const scale = describeScaleBasis(scene);
  const sourceGeometry = [first, second].every((room) => room.geometry!.provenance.validation === 'verified' || room.geometry!.provenance.validation === 'corrected') ? 'confirmed' : 'unreviewed';
  const mergedId = `room-merged-${sha256Hex([first.id, second.id].sort().join('|')).slice(0, 12)}`;
  const provenance = (evidence: string): PropertyProvenance => ({ source: 'derived', validation: 'unreviewed', recordedAt, evidence });
  const geometryEvidence = `Divisão resultante da remoção de ${wall.label}: união de ${roomDisplayName(first)} e ${roomDisplayName(second)}, calculada pelo motor a partir dos dois polígonos.`;
  const base = provenance(geometryEvidence);

  // boundaryRefs: as que já existiam, com os índices novos. Os extremos recordados (a/b) mantêm-se: foram escritos quando as paredes foram ligadas.
  const indexOf = new Map(ring.map((item, index) => [item.key, index]));
  const refs: BoundaryRef[] = [];
  for (const ref of carried) {
    const mapped: BoundaryRef = { wallId: ref.wallId, startIndex: indexOf.get(ref.startKey)!, endIndex: indexOf.get(ref.endKey)!, startEndpoint: ref.startEndpoint, endEndpoint: ref.endEndpoint };
    if (!refs.some((existing) => JSON.stringify(existing) === JSON.stringify(mapped))) refs.push(mapped);
  }
  const text = (value: string): SpatialProperty => ({ value, provenance: base });
  const merged: Node = {
    id: mergedId,
    label: `${roomDisplayName(first)} + ${roomDisplayName(second)}`,
    nodeType: 'component',
    parentId: null,
    transform: { translationM: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], provenance: { translationM: base, rotation: base, scale: base } },
    geometry: { kind: 'polygon', verticesM: ring.map((item) => [...item.v] as Vertex), provenance: base },
    component: {
      kind: 'room',
      dependsOn: remainingIds,
      properties: {
        boundaryRefs: text(JSON.stringify(refs)),
        mergedFrom: text(JSON.stringify([first.id, second.id])),
        removedWall: text(wallId),
        area: { value: areaMerged, unit: 'm2', provenance: provenance(`Área calculada pelo motor a partir do polígono resultante; não vem de nenhum documento nem foi escrita à mão. Os metros dependem da escala da cena, ${scaleSentence(scale)}.`) },
      },
    },
    properties: {},
  };
  // Prova final: a divisão que vamos devolver cumpre as invariantes contra as paredes da cena (a removida já não conta).
  if (checkRoomBoundary(merged, new Map(scene.nodes.map((node) => [node.id, node])), [wallId]).length > 0) return blocked('ROOM_MERGE_BOUNDARY_INCOMPLETE', ids);
  const relations: SceneRelation[] = remainingIds.map((id) => ({ id: `bounded-${mergedId}-${id}`, fromNodeId: mergedId, toNodeId: id, kind: 'bounded_by', properties: {}, provenance: base }));
  const removedRelationIds = scene.relations.filter((relation) => involved.has(relation.fromNodeId) || involved.has(relation.toNodeId)).map((relation) => relation.id);

  const scaleCheck: Check = scale.state === 'unknown'
    ? { id: 'architecture.room-merge.scale', status: 'unknown', subject: [scene.id], reason: 'A cena não tem calibração de escala: os metros quadrados não têm base conhecida.' }
    : scale.state === 'rejected'
      ? { id: 'architecture.room-merge.scale', status: 'fail', subject: [scene.id], reason: `A escala (${scaleSourceWords(scale)}) foi rejeitada: a área calculada não é fiável.` }
      : scale.state === 'unverified'
        ? { id: 'architecture.room-merge.scale', status: 'unknown', subject: [scene.id], reason: `A área em m² assenta numa escala ${scaleSourceWords(scale)} que ninguém verificou (${scale.validation}): conservar a área não prova que a escala esteja certa.` }
        : sourceGeometry === 'confirmed'
          ? { id: 'architecture.room-merge.scale', status: 'pass', subject: [scene.id, first.id, second.id], reason: `A escala foi verificada (${scale.validation}) e a geometria das duas divisões também.` }
          : { id: 'architecture.room-merge.scale', status: 'unknown', subject: [scene.id, first.id, second.id], reason: `A escala foi verificada (${scale.validation}), mas a geometria das duas divisões ainda não foi revista por ninguém.` };
  const checks: Check[] = [
    {
      id: 'architecture.room-merge.area', status: 'pass', subject: [first.id, second.id, mergedId], measured: areaMerged, expected, tolerance: areaTolerance, unit: 'm2',
      reason: `A área da divisão nova (${areaMerged.toFixed(3)} m²) é a soma das duas (${areaFirst.toFixed(3)} + ${areaSecond.toFixed(3)} m²).`,
    },
    { id: 'architecture.room-merge.simple-polygon', status: 'pass', subject: [mergedId], reason: 'O polígono resultante não tem auto-intersecções, vértices repetidos nem buracos.' },
    scaleCheck,
    { id: 'architecture.room-merge.structure', status: 'unknown', subject: [wallId], reason: 'Estrutura desconhecida, sem dados estruturais: não se sabe se a parede é de carga. Geometricamente possível não é estruturalmente seguro.' },
  ];
  const report: VerificationReport = {
    domain: 'architecture',
    subjectId: scene.id,
    revisionId: scene.revision.id,
    generatedAt: recordedAt,
    checks,
    assumptions: ['Divisões planas no plano do chão (x, z), em metros.', `Dois pontos a menos de ${TOL * 1000} mm contam como o mesmo.`, 'Só se funde uma parede entre exactamente duas divisões em lados opostos.'],
    inputs: [
      ...[first, second].map((room) => ({ entityId: room.id, field: 'geometry', origin: toProvenance(room.geometry!.provenance.source), validation: room.geometry!.provenance.validation })),
      // A escala também é uma entrada: sem ela os metros quadrados não querem dizer nada. Entra com a proveniência que tem, sem promoção.
      ...(scene.imageWorldMapping ? [{ entityId: scene.id, field: 'imageWorldMapping', origin: toProvenance(scene.imageWorldMapping.provenance.source), validation: scene.imageWorldMapping.provenance.validation }] : []),
    ],
  };
  return { status: 'merge', wallId, roomIds: [first.id, second.id], merged, relations, removedRelationIds, areas: { first: areaFirst, second: areaSecond, merged: areaMerged }, scale, sourceGeometry, report };
}
