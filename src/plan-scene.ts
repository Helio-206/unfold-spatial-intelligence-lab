import {
  createSceneTransaction,
  executeSceneCommand,
  serializeSceneTransaction,
  deserializeSceneTransaction,
  stageSceneCommand,
  withSingleRevision,
  type Node,
  type PropertyProvenance,
  type SceneCommandContext,
  type SceneCommitOptions,
  type SceneRelation,
  type SceneTransaction,
  type SpatialCommand,
  type SpatialSceneV1,
} from './spatial-scene';
import { AuthorizationError, operationDigest, type CanonicalOperation, type CommandOrigin, type VerificationReport } from './core';
import { planRoomMerge, type RoomMergeResult } from './room-merge';
import { sceneOperation, stampAuthorization, touchedConfirmed, type ConfirmedReference } from './scene-authorization';
import { calibrateScale, type PixelWallCandidate, type PlanRegionCandidate, type Point2 } from './plan-reconstruction';

export type PlanSceneOptions = {
  sceneId: string;
  title: string;
  image: { sha256: string; width: number; height: number };
  technicalDocumentRef?: { documentId: string; sha256: string };
  calibration: { pixelDistance: number; realDistanceMetres: number; evidence: string; actor: string };
  confirmedCandidateIds: string[];
  confirmedRegionIds?: string[];
  regions?: PlanRegionCandidate[];
  candidates: PixelWallCandidate[];
  wall: { heightM: number; thicknessM: number };
  recordedAt?: string;
};

export type OpeningInput = { id: string; kind: 'door' | 'window'; offsetM: number; widthM: number; heightM: number; sillM: number; actor?: string };
export type OpeningEdit = { offsetM: number; widthM: number; heightM: number; sillM: number; actor?: string };
export type WallEdit = { start: Point2; end: Point2; heightM?: number; thicknessM?: number; actor?: string };

function assertPositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} deve ser positivo.`);
}

function wallPose(start: Point2, end: Point2): { position: [number, number, number]; angle: number; length: number } {
  const dx = end.x - start.x;
  const dz = end.y - start.y;
  const length = Math.hypot(dx, dz);
  if (length <= 0 || !Number.isFinite(length)) throw new Error('Segmento de parede degenerado.');
  return { position: [(start.x + end.x) / 2, 0, (start.y + end.y) / 2], angle: Math.atan2(-dz, dx), length };
}

function wallWorldEndpoints(wall: Node): [[number, number, number], [number, number, number]] {
  if (wall.geometry?.kind !== 'box') throw new Error(`Geometria da parede ${wall.id} não suportada.`);
  const angle = 2 * Math.atan2(wall.transform.rotation[1], wall.transform.rotation[3]);
  const half = wall.geometry.sizeM[0] / 2;
  const dx = Math.cos(angle) * half; const dz = -Math.sin(angle) * half;
  return [
    [wall.transform.translationM[0] - dx, wall.transform.translationM[1], wall.transform.translationM[2] - dz],
    [wall.transform.translationM[0] + dx, wall.transform.translationM[1], wall.transform.translationM[2] + dz],
  ];
}

function provenance(source: PropertyProvenance['source'], validation: PropertyProvenance['validation'], recordedAt: string, extra: Partial<PropertyProvenance> = {}): PropertyProvenance {
  return { source, validation, recordedAt, ...extra };
}

function property(value: number, recordedAt: string, source: PropertyProvenance['source'], unit = 'm', validation: PropertyProvenance['validation'] = 'unreviewed', extra: Partial<PropertyProvenance> = {}) {
  return { value, unit, provenance: provenance(source, validation, recordedAt, extra) };
}

function wallNode(candidate: PixelWallCandidate, options: PlanSceneOptions, recordedAt: string, pixelsPerMetre: number, ordinal: number): Node {
  const start = { x: candidate.start.x / pixelsPerMetre, y: -candidate.start.y / pixelsPerMetre };
  const end = { x: candidate.end.x / pixelsPerMetre, y: -candidate.end.y / pixelsPerMetre };
  const pose = wallPose(start, end);
  const validation: PropertyProvenance['validation'] = candidate.confidence < 0.55 ? 'ambiguous' : 'unreviewed';
  const observed = provenance('derived', validation, recordedAt, { evidence: `Segmento raster ${candidate.id}, origem ${candidate.origin ?? 'detecção automática não classificada'}, explicitamente incluído. Confiança heurística ${candidate.confidence}; espessura raster ${candidate.thicknessPx} px.` });
  const id = `wall-${candidate.id}`;
  return {
    id,
    label: `Parede ${ordinal}`,
    nodeType: 'component',
    parentId: null,
    transform: {
      translationM: pose.position,
      rotation: [0, Math.sin(pose.angle / 2), 0, Math.cos(pose.angle / 2)],
      scale: [1, 1, 1],
      provenance: { translationM: observed, rotation: observed, scale: observed },
    },
    geometry: { kind: 'box', sizeM: [pose.length, options.wall.heightM, options.wall.thicknessM], provenance: observed },
    component: { kind: 'wall', dependsOn: [], properties: {
      length: property(pose.length, recordedAt, 'system', 'm', validation, { evidence: `Derivado do segmento ${candidate.id} após calibração explícita.` }),
      height: property(options.wall.heightM, recordedAt, 'user'),
      thickness: property(options.wall.thicknessM, recordedAt, 'user'),
      sourceCandidate: { value: candidate.id, provenance: observed },
      sourceCandidateIds: { value: JSON.stringify(candidate.sourceCandidateIds ?? [candidate.id]), provenance: observed },
      sourceOrigin: { value: candidate.origin ?? 'automatic_detection', provenance: observed },
      sourcePixelSegment: { value: `${candidate.start.x},${candidate.start.y} → ${candidate.end.x},${candidate.end.y}`, provenance: observed },
      confidence: { value: candidate.confidence, provenance: observed },
    } },
    properties: {},
  };
}

export function createPlanScene(options: PlanSceneOptions): SceneTransaction {
  const recordedAt = options.recordedAt ?? new Date().toISOString();
  if (!options.sceneId || !options.title || !options.calibration.actor.trim() || !options.calibration.evidence.trim()) throw new Error('Identificação e confirmação explícita da escala são obrigatórias.');
  const scale = calibrateScale(options.calibration.pixelDistance, options.calibration.realDistanceMetres, 'known_measurement');
  assertPositive(options.wall.heightM, 'Altura');
  assertPositive(options.wall.thicknessM, 'Espessura');
  if (!/^[a-f0-9]{64}$/i.test(options.image.sha256) || !Number.isInteger(options.image.width) || options.image.width <= 0 || !Number.isInteger(options.image.height) || options.image.height <= 0) throw new Error('Identidade ou dimensões da imagem inválidas.');
  if (new Set(options.confirmedCandidateIds).size !== options.confirmedCandidateIds.length || new Set(options.confirmedRegionIds ?? []).size !== (options.confirmedRegionIds ?? []).length) throw new Error('IDs de candidatos ou regiões duplicados.');
  const byId = new Map(options.candidates.map((candidate) => [candidate.id, candidate]));
  if (byId.size !== options.candidates.length) throw new Error('IDs de candidatos duplicados.');
  const selectedRegions = (options.confirmedRegionIds ?? []).map((id) => {
    const region = options.regions?.find((item) => item.id === id);
    if (!region || region.eligibility !== 'construction_candidate' || region.validation !== 'unreviewed') throw new Error(`Região ${id} não existe ou não é candidata válida para revisão.`);
    return region;
  });
  const referencedIds = new Set([...options.confirmedCandidateIds, ...selectedRegions.flatMap((region) => region.boundaryCandidateIds)]);
  for (const id of referencedIds) if (!byId.has(id)) throw new Error(`Candidato ${id} não encontrado.`);
  const selected = options.confirmedCandidateIds.map((id) => {
    const candidate = byId.get(id);
    if (!candidate) throw new Error(`Candidato ${id} não encontrado.`);
    return candidate;
  });
  if (!selected.length && !selectedRegions.length) throw new Error('Confirme pelo menos um segmento ou região candidata.');
  const nodes = selected.map((candidate, index) => wallNode(candidate, options, recordedAt, scale.pixelsPerMetre, index + 1));
  const wallByEdge = new Map<string, Node>();
  const relations: SceneRelation[] = [];
  const allRegionVertices = selectedRegions.flatMap((region) => region.vertices);
  for (const region of selectedRegions) {
    const wallIds: string[] = [];
    const boundaryRefs: Array<{ wallId: string; startIndex: number; endIndex: number; startEndpoint: 'a' | 'b'; endEndpoint: 'a' | 'b' }> = [];
    const polygonVertices: Array<[number, number, number]> = [];
    for (let index = 0; index < region.vertices.length; index += 1) {
      const edgeStart = region.vertices[index]!; const edgeEnd = region.vertices[(index + 1) % region.vertices.length]!;
      const dx = edgeEnd.x - edgeStart.x; const dy = edgeEnd.y - edgeStart.y; const length2 = dx * dx + dy * dy;
      const splits = [{ point: edgeStart, t: 0 }, { point: edgeEnd, t: 1 }, ...allRegionVertices.flatMap((point) => {
        const t = ((point.x - edgeStart.x) * dx + (point.y - edgeStart.y) * dy) / length2;
        if (t <= 1e-6 || t >= 1 - 1e-6) return [];
        const projected = { x: edgeStart.x + t * dx, y: edgeStart.y + t * dy };
        return Math.hypot(projected.x - point.x, projected.y - point.y) <= 1 ? [{ point: projected, t }] : [];
      })].sort((a, b) => a.t - b.t).filter((item, splitIndex, sorted) => splitIndex === 0 || item.t - sorted[splitIndex - 1]!.t > 1e-6);
      for (let segmentIndex = 1; segmentIndex < splits.length; segmentIndex += 1) {
      const start = splits[segmentIndex - 1]!.point; const end = splits[segmentIndex]!.point;
      const pointKey = (point: Point2) => `${Math.round(point.x * 2) / 2},${Math.round(point.y * 2) / 2}`;
      const endpoints = [pointKey(start), pointKey(end)].sort();
      const edgeKey = endpoints.join(':');
      let wall = wallByEdge.get(edgeKey);
      if (!wall) {
        const sourceCandidates = region.boundaryCandidateIds.map((id) => byId.get(id)).filter((item): item is PixelWallCandidate => !!item);
        const candidate: PixelWallCandidate = {
          id: `edge-${edgeKey.replaceAll(',', '-').replaceAll(':', '-')}`,
          orientation: Math.abs(end.x - start.x) >= Math.abs(end.y - start.y) ? 'horizontal' : 'vertical',
          start: { ...start }, end: { ...end },
          thicknessPx: sourceCandidates.reduce((sum, item) => sum + item.thicknessPx, 0) / Math.max(1, sourceCandidates.length),
          confidence: region.confidence,
          origin: sourceCandidates.length && sourceCandidates.every((item) => item.origin === 'automatic_detection') ? 'automatic_detection' : 'manual_correction',
          sourceCandidateIds: region.boundaryCandidateIds,
        };
        wall = wallNode(candidate, options, recordedAt, scale.pixelsPerMetre, nodes.filter((node) => node.component?.kind === 'wall').length + 1);
        wallByEdge.set(edgeKey, wall);
        nodes.push(wall);
      }
      wallIds.push(wall.id);
      const startWorld: [number, number, number] = [start.x / scale.pixelsPerMetre, 0, -start.y / scale.pixelsPerMetre];
      const endWorld: [number, number, number] = [end.x / scale.pixelsPerMetre, 0, -end.y / scale.pixelsPerMetre];
      if (!polygonVertices.length) polygonVertices.push(startWorld);
      else if (Math.hypot(polygonVertices.at(-1)![0] - startWorld[0], polygonVertices.at(-1)![2] - startWorld[2]) > 1e-6) polygonVertices.push(startWorld);
      const actualStartIndex = polygonVertices.length - 1;
      polygonVertices.push(endWorld);
      const worldEndpoints = wallWorldEndpoints(wall);
      const endpointFor = (point: [number, number, number]): 'a' | 'b' => Math.hypot(...point.map((value, axis) => value - worldEndpoints[0][axis]!)) <= Math.hypot(...point.map((value, axis) => value - worldEndpoints[1][axis]!)) ? 'a' : 'b';
      boundaryRefs.push({ wallId: wall.id, startIndex: actualStartIndex, endIndex: polygonVertices.length - 1, startEndpoint: endpointFor(startWorld), endEndpoint: endpointFor(endWorld) });
      }
    }
    if (polygonVertices.length > 3 && Math.hypot(polygonVertices[0]![0] - polygonVertices.at(-1)![0], polygonVertices[0]![2] - polygonVertices.at(-1)![2]) <= 1e-6) {
      polygonVertices.pop();
      for (const ref of boundaryRefs) {
        if (ref.endIndex === polygonVertices.length) ref.endIndex = 0;
      }
    }
    const roomProvenance = provenance('derived', 'unreviewed', recordedAt, { evidence: `Polígono ${region.id} proposto a partir de ${region.boundaryCandidateIds.length} segmentos raster; confiança heurística ${region.confidence}. A inclusão pelo utilizador não certifica a geometria.` });
    const roomId = region.id;
    const room: Node = {
      id: roomId, label: `Divisão proposta ${selectedRegions.indexOf(region) + 1}`, nodeType: 'component', parentId: null,
      transform: { translationM: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], provenance: { translationM: roomProvenance, rotation: roomProvenance, scale: roomProvenance } },
      geometry: { kind: 'polygon', verticesM: polygonVertices, provenance: roomProvenance },
      component: { kind: 'room', dependsOn: wallIds, properties: {
        sourceRegion: { value: region.id, provenance: roomProvenance },
        boundaryCandidateIds: { value: JSON.stringify(region.boundaryCandidateIds), provenance: roomProvenance },
        boundaryRefs: { value: JSON.stringify(boundaryRefs), provenance: roomProvenance },
        confidence: { value: region.confidence, provenance: roomProvenance },
        areaRasterPx2: property(region.areaPx2, recordedAt, 'derived', '', 'unreviewed', { evidence: 'Área em píxeis quadrados, não convertida em área física.' }),
        ...(region.areaM2 !== undefined ? { area: property(region.areaM2, recordedAt, 'derived', 'm2', 'unreviewed', { evidence: 'Conversão geométrica com a calibração fornecida; não verificada independentemente.' }) } : {}),
      } }, properties: {},
    };
    nodes.push(room);
    for (const wallId of wallIds) relations.push({ id: `bounded-${roomId}-${wallId}`, fromNodeId: roomId, toNodeId: wallId, kind: 'bounded_by', properties: {}, provenance: roomProvenance });
  }
  const scaleEvidence = provenance('user', 'unreviewed', recordedAt, { actor: options.calibration.actor, evidence: options.calibration.evidence });
  const scene: SpatialSceneV1 = {
    schema: 'spatial_scene.v1',
    id: options.sceneId,
    title: options.title,
    coordinateSystem: { handedness: 'right', upAxis: 'Y', horizontalPlane: ['X', 'Z'], unit: 'm' },
    sourceDocuments: options.technicalDocumentRef ? [{ ...options.technicalDocumentRef, schema: 'technical_document.v1', immutable: true as const }] : [],
    imageWorldMapping: {
      sourceImageSha256: options.image.sha256,
      imageSizePx: { width: options.image.width, height: options.image.height },
      pixelToWorldXZ: [1 / scale.pixelsPerMetre, 0, 0, 0, -1 / scale.pixelsPerMetre, 0],
      worldY: 0,
      provenance: scaleEvidence,
    },
    nodes,
    relations,
    constraints: [],
    revision: { id: `${options.sceneId}:r0`, number: 0, parentId: null, operationId: null, createdAt: recordedAt, createdBy: options.calibration.actor },
  };
  return createSceneTransaction(scene);
}

function nodeProperty(node: Node, key: string): number {
  const value = node.component?.properties[key]?.value;
  if (typeof value !== 'number') throw new Error(`Parâmetro ${key} em falta no componente ${node.id}.`);
  return value;
}

function openingTransform(wall: Node, offset: number, width: number, sill: number, height: number): { position: [number, number, number]; angle: number } {
  if (wall.geometry?.kind !== 'box') throw new Error(`Geometria da parede ${wall.id} não suportada.`);
  const length = wall.geometry.sizeM[0];
  const q = wall.transform.rotation;
  const angle = 2 * Math.atan2(q[1], q[3]);
  const localX = offset + width / 2 - length / 2;
  return {
    position: [wall.transform.translationM[0] + Math.cos(angle) * localX, sill + height / 2, wall.transform.translationM[2] - Math.sin(angle) * localX],
    angle,
  };
}

function validateOpeningPlacement(transaction: SceneTransaction, wall: Node, input: OpeningEdit, exceptId?: string): void {
  if (wall.geometry?.kind !== 'box' || wall.component?.kind !== 'wall') throw new Error('A abertura requer uma parede paramétrica.');
  assertPositive(input.widthM, 'Largura');
  assertPositive(input.heightM, 'Altura');
  if (![input.offsetM, input.sillM].every(Number.isFinite) || input.offsetM < 0 || input.sillM < 0 || input.offsetM + input.widthM > wall.geometry.sizeM[0] || input.sillM + input.heightM > wall.geometry.sizeM[1]) throw new Error('A abertura excede os limites da parede.');
  for (const other of transaction.scene.nodes) {
    if (other.id === exceptId || !other.component?.dependsOn.includes(wall.id) || !['door', 'window'].includes(other.component.kind)) continue;
    const x = nodeProperty(other, 'offset'); const y = nodeProperty(other, 'sill');
    const w = nodeProperty(other, 'width'); const h = nodeProperty(other, 'height');
    if (input.offsetM < x + w && input.offsetM + input.widthM > x && input.sillM < y + h && input.sillM + input.heightM > y) throw new Error(`A abertura sobrepõe-se a ${other.label}; alteração recusada.`);
  }
}

export function addOpeningToScene(transaction: SceneTransaction, wallId: string, input: OpeningInput, recordedAt = new Date().toISOString(), origin?: CommandOrigin): SceneTransaction {
  const wall = transaction.scene.nodes.find((node) => node.id === wallId);
  if (!wall || wall.geometry?.kind !== 'box') throw new Error(`Parede ${wallId} não encontrada ou sem caixa paramétrica.`);
  validateOpeningPlacement(transaction, wall, input);
  const pose = openingTransform(wall, input.offsetM, input.widthM, input.sillM, input.heightM);
  const source = provenance('user', 'unreviewed', recordedAt, input.actor ? { actor: input.actor } : {});
  const node: Node = {
    id: input.id,
    label: input.kind === 'door' ? 'Porta' : 'Janela',
    nodeType: 'component',
    parentId: null,
    transform: { translationM: pose.position, rotation: [0, Math.sin(pose.angle / 2), 0, Math.cos(pose.angle / 2)], scale: [1, 1, 1], provenance: { translationM: source, rotation: source, scale: source } },
    geometry: { kind: 'box', sizeM: [input.widthM, input.heightM, 0.04], provenance: source },
    component: { kind: input.kind, dependsOn: [wallId], properties: {
      offset: property(input.offsetM, recordedAt, 'user'),
      width: property(input.widthM, recordedAt, 'user'),
      height: property(input.heightM, recordedAt, 'user'),
      sill: property(input.sillM, recordedAt, 'user'),
    } },
    properties: {},
  };
  return executeSceneCommand(transaction, { type: 'AddComponent', node }, input.actor ?? 'user', undefined, origin ? { context: compositeContext(input.actor ?? 'user', origin) } : {}).transaction;
}

/** Opções das operações compostas: a autorização e (opcionalmente) a origem de quem pede. */
export type CompositeOptions = SceneCommitOptions & { origin?: CommandOrigin };

/**
 * O preview de uma operação composta: o resultado se for autorizada, a operação canónica sobre o agregado de todos os
 * passos (todas as alterações e todos os afectados, dependentes incluídos), e os valores confirmados que toca.
 * `commit` aplica-a: se tocar confirmados, consome UMA autorização do ledger para este digest e esta revisão.
 * Com `current` (a transacção actual) refaz o plano e recusa se a revisão ou o conteúdo mudaram desde o preview.
 */
export type CompositePlan = {
  baseRevisionId: string;
  /** O resultado, ainda sem o id de autorização nas proveniências corrigidas. É o que um preview deve mostrar. */
  transaction: SceneTransaction;
  operation: CanonicalOperation;
  operationDigest: string;
  touchesConfirmed: ConfirmedReference[];
  requiresAuthorization: boolean;
  /** Só na remoção de uma parede que separa duas divisões: a fusão calculada (divisão nova, áreas) e o seu relatório. */
  merge?: Extract<RoomMergeResult, { status: 'merge' }>;
  report?: VerificationReport;
  commit(options?: SceneCommitOptions, current?: SceneTransaction): SceneTransaction;
};

type Stage = (transaction: SceneTransaction, command: SpatialCommand) => SceneTransaction;

function compositeContext(actor: string, origin: CommandOrigin | undefined): SceneCommandContext {
  const resolved = origin ?? 'ui_direct';
  return { origin: resolved, actor: { kind: resolved === 'model_proposal' ? 'model' : resolved === 'system' ? 'system' : 'human', id: actor } };
}

function planComposite(base: SceneTransaction, name: string, actor: string, origin: CommandOrigin | undefined, evaluatedAt: string, steps: (transaction: SceneTransaction, stage: Stage, evaluatedAt: string) => SceneTransaction): CompositePlan {
  const context = compositeContext(actor, origin);
  const clock = () => new Date(evaluatedAt);
  const staged = steps(base, (transaction, command) => stageSceneCommand(transaction, command, actor, clock, context), evaluatedAt);
  // Os passos internos só existem enquanto se calcula: a operação inteira é uma revisão e uma entrada de desfazer.
  const scene = withSingleRevision(base.scene, staged.scene, name, actor, clock);
  const result: SceneTransaction = { scene, undoStack: [...base.undoStack, base.scene].slice(-100), redoStack: [] };
  const operation = sceneOperation(base.scene, scene, name);
  const touchesConfirmed = touchedConfirmed(base.scene, scene);
  const plan: CompositePlan = {
    baseRevisionId: base.scene.revision.id,
    transaction: result,
    operation,
    operationDigest: operationDigest(operation),
    touchesConfirmed,
    requiresAuthorization: touchesConfirmed.length > 0,
    commit(options = {}, current) {
      if (current) {
        if (current.scene.revision.id !== plan.baseRevisionId) throw new Error('STALE_PREVIEW');
        const replay = planComposite(current, name, actor, origin, evaluatedAt, steps);
        if (replay.operationDigest !== plan.operationDigest || JSON.stringify(replay.transaction.scene) !== JSON.stringify(plan.transaction.scene)) throw new Error('PREVIEW_TAMPERED');
        return replay.commit(options);
      }
      if (!plan.requiresAuthorization) return plan.transaction;
      if (!options.ledger) throw new AuthorizationError('AUTHORIZATION_REQUIRED');
      const authorization = options.ledger.consume(options.authorizationId, plan.operation);
      return { ...plan.transaction, scene: stampAuthorization(base.scene, plan.transaction.scene, plan.touchesConfirmed, authorization.id) };
    },
  };
  return plan;
}

export function planOpeningEdit(transaction: SceneTransaction, openingId: string, edit: OpeningEdit, options: Pick<CompositeOptions, 'origin'> = {}): CompositePlan {
  return planComposite(transaction, 'EditOpening', edit.actor ?? 'user', options.origin, new Date().toISOString(), (base, stage) => applyOpeningEdit(base, openingId, edit, stage));
}
export function editOpeningInScene(transaction: SceneTransaction, openingId: string, edit: OpeningEdit, options: CompositeOptions = {}): SceneTransaction {
  return planOpeningEdit(transaction, openingId, edit, options).commit(options);
}

function applyOpeningEdit(transaction: SceneTransaction, openingId: string, edit: OpeningEdit, stage: Stage): SceneTransaction {
  const opening = transaction.scene.nodes.find((node) => node.id === openingId);
  if (!opening || opening.geometry?.kind !== 'box' || !['door', 'window'].includes(opening.component?.kind ?? '')) throw new Error('Abertura paramétrica não encontrada.');
  const wall = transaction.scene.nodes.find((node) => opening.component!.dependsOn.includes(node.id) && node.component?.kind === 'wall');
  if (!wall) throw new Error('Parede de suporte não encontrada.');
  validateOpeningPlacement(transaction, wall, edit, openingId);
  const pose = openingTransform(wall, edit.offsetM, edit.widthM, edit.sillM, edit.heightM);
  let next = stage(transaction, { type: 'ResizeComponent', nodeId: openingId, scale: [edit.widthM / opening.geometry.sizeM[0], edit.heightM / opening.geometry.sizeM[1], 1] });
  next = stage(next, { type: 'MoveComponent', nodeId: openingId, translationM: pose.position });
  for (const [key, value] of [['offset', edit.offsetM], ['width', edit.widthM], ['height', edit.heightM], ['sill', edit.sillM]] as const) {
    next = stage(next, { type: 'UpdateParameter', nodeId: openingId, property: key, value, unit: 'm' });
  }
  return next;
}

export function planWallEdit(transaction: SceneTransaction, wallId: string, edit: WallEdit, options: Pick<CompositeOptions, 'origin'> = {}): CompositePlan {
  return planComposite(transaction, 'EditWall', edit.actor ?? 'user', options.origin, new Date().toISOString(), (base, stage, evaluatedAt) => applyWallEdit(base, wallId, edit, stage, evaluatedAt));
}
export function editWallInScene(transaction: SceneTransaction, wallId: string, edit: WallEdit, options: CompositeOptions = {}): SceneTransaction {
  return planWallEdit(transaction, wallId, edit, options).commit(options);
}

function applyWallEdit(transaction: SceneTransaction, wallId: string, edit: WallEdit, stage: Stage, evaluatedAt: string): SceneTransaction {
  const previous = transaction.scene.nodes.find((node) => node.id === wallId);
  if (!previous || previous.geometry?.kind !== 'box' || previous.component?.kind !== 'wall') throw new Error(`Parede ${wallId} não encontrada.`);
  const previousGeometry = previous.geometry;
  const oldLength = previousGeometry.sizeM[0];
  const oldHeight = previousGeometry.sizeM[1];
  const oldThickness = previousGeometry.sizeM[2];
  const nextPose = wallPose(edit.start, edit.end);
  const nextHeight = edit.heightM ?? oldHeight;
  const nextThickness = edit.thicknessM ?? oldThickness;
  assertPositive(nextHeight, 'Altura');
  assertPositive(nextThickness, 'Espessura');
  const dependents = transaction.scene.nodes.filter((node) => node.component?.dependsOn.includes(wallId));
  if (dependents.some((item) => !['door', 'window', 'room'].includes(item.component?.kind ?? ''))) throw new Error('Existe uma dependência geométrica não suportada; edição recusada.');
  const recalculated = dependents.filter((item) => item.component?.kind === 'door' || item.component?.kind === 'window').map((opening) => {
    const offset = nodeProperty(opening, 'offset');
    const width = nodeProperty(opening, 'width');
    const height = nodeProperty(opening, 'height');
    const sill = nodeProperty(opening, 'sill');
    if (offset < 0 || offset + width > nextPose.length || sill + height > nextHeight) throw new Error(`A abertura ${opening.id} excede a nova parede; a edição foi recusada.`);
    const proxy: Node = { ...previous, transform: { ...previous.transform, translationM: nextPose.position, rotation: [0, Math.sin(nextPose.angle / 2), 0, Math.cos(nextPose.angle / 2)] }, geometry: { kind: 'box', sizeM: [nextPose.length, nextHeight, nextThickness], provenance: previousGeometry.provenance } };
    return { node: opening, pose: openingTransform(proxy, offset, width, sill, height), offset };
  });
  let next = transaction;
  const oldAngle = 2 * Math.atan2(previous.transform.rotation[1], previous.transform.rotation[3]);
  next = stage(next, { type: 'MoveComponent', nodeId: wallId, translationM: nextPose.position });
  next = stage(next, { type: 'RotateComponent', nodeId: wallId, axis: [0, 1, 0], angleRad: nextPose.angle - oldAngle });
  next = stage(next, { type: 'ResizeComponent', nodeId: wallId, scale: [nextPose.length / oldLength, nextHeight / oldHeight, nextThickness / oldThickness] });
  for (const [key, value] of [['length', nextPose.length], ['height', nextHeight], ['thickness', nextThickness]] as const) {
    next = stage(next, { type: 'UpdateParameter', nodeId: wallId, property: key, value, unit: 'm' });
  }
  for (const { node, pose, offset } of recalculated) {
    const angle = 2 * Math.atan2(node.transform.rotation[1], node.transform.rotation[3]);
    next = stage(next, { type: 'MoveComponent', nodeId: node.id, translationM: pose.position });
    next = stage(next, { type: 'RotateComponent', nodeId: node.id, axis: [0, 1, 0], angleRad: pose.angle - angle });
    next = stage(next, { type: 'UpdateParameter', nodeId: node.id, property: 'offset', value: offset, unit: 'm' });
  }
  const editedWall = next.scene.nodes.find((node) => node.id === wallId)!;
  const endpoints = wallWorldEndpoints(editedWall);
  for (const room of next.scene.nodes.filter((node) => node.component?.kind === 'room' && node.component.dependsOn.includes(wallId))) {
    if (room.geometry?.kind !== 'polygon') throw new Error(`Geometria dependente ${room.id} não é um polígono suportado.`);
    const boundaryRefsValue = room.component?.properties.boundaryRefs?.value;
    if (typeof boundaryRefsValue !== 'string') throw new Error(`Referências de contorno em falta para ${room.id}.`);
    let boundaryRefs: Array<{ wallId: string; startIndex: number; endIndex: number; startEndpoint: 'a' | 'b'; endEndpoint: 'a' | 'b' }>;
    try { boundaryRefs = JSON.parse(boundaryRefsValue); } catch { throw new Error(`Referências de contorno inválidas para ${room.id}.`); }
    if (!Array.isArray(boundaryRefs) || !boundaryRefs.every((ref) => ref && typeof ref.wallId === 'string' && Number.isInteger(ref.startIndex) && Number.isInteger(ref.endIndex) && ['a', 'b'].includes(ref.startEndpoint) && ['a', 'b'].includes(ref.endEndpoint))) throw new Error(`Referências de contorno inválidas para ${room.id}.`);
    const verticesM = room.geometry.verticesM.map((point) => [...point] as [number, number, number]);
    for (const ref of boundaryRefs) {
      if (ref.wallId !== wallId) continue;
      if (!Number.isInteger(ref.startIndex) || !Number.isInteger(ref.endIndex) || !verticesM[ref.startIndex] || !verticesM[ref.endIndex]) throw new Error(`Índice de contorno inválido em ${room.id}.`);
      verticesM[ref.startIndex] = [...endpoints[ref.startEndpoint === 'a' ? 0 : 1]];
      verticesM[ref.endIndex] = [...endpoints[ref.endEndpoint === 'a' ? 0 : 1]];
    }
    next = stage(next, { type: 'UpdateGeometry', nodeId: room.id, geometry: { ...room.geometry, verticesM, provenance: provenance('derived', 'unreviewed', evaluatedAt, { evidence: `Polígono recalculado após edição da parede ${wallId}; geometria derivada permanece por rever.` }) } });
  }
  return next;
}

export function planWallRemoval(transaction: SceneTransaction, wallId: string, actor = 'user', options: Pick<CompositeOptions, 'origin'> = {}): CompositePlan {
  const evaluatedAt = new Date().toISOString();
  const plan = planComposite(transaction, 'RemoveWall', actor, options.origin, evaluatedAt, (base, stage) => {
    const wall = base.scene.nodes.find((node) => node.id === wallId);
    if (!wall) throw new Error(`Parede ${wallId} não encontrada.`);
    // Se a parede separa duas divisões, a remoção funde-as numa só; se o motor não consegue provar a fusão, bloqueia com a razão.
    const merge = planRoomMerge(base.scene, wallId, evaluatedAt);
    if (merge.status === 'blocked') throw new Error(merge.code);
    let next = base;
    if (merge.status === 'merge') {
      next = stage(next, { type: 'AddComponent', node: merge.merged });
      for (const relation of merge.relations) next = stage(next, { type: 'ConnectComponents', relation });
      for (const id of merge.removedRelationIds) next = stage(next, { type: 'DisconnectComponents', relationId: id });
      for (const id of merge.roomIds) next = stage(next, { type: 'RemoveComponent', nodeId: id });
    }
    const dependents = next.scene.nodes.filter((node) => node.component?.dependsOn.includes(wallId)).map((node) => node.id);
    for (const id of dependents.reverse()) next = stage(next, { type: 'RemoveComponent', nodeId: id });
    return stage(next, { type: 'RemoveComponent', nodeId: wallId });
  });
  const merge = planRoomMerge(transaction.scene, wallId, evaluatedAt);
  return merge.status === 'merge' ? Object.assign(plan, { merge, report: merge.report }) : plan;
}
export function removeWallFromScene(transaction: SceneTransaction, wallId: string, actor = 'user', options: CompositeOptions = {}): SceneTransaction {
  return planWallRemoval(transaction, wallId, actor, options).commit(options);
}

export function saveAndRestoreScene(transaction: SceneTransaction): SceneTransaction {
  return deserializeSceneTransaction(serializeSceneTransaction(transaction));
}

export function sceneWallLength(scene: SpatialSceneV1, wallId: string): number {
  const node = scene.nodes.find((item) => item.id === wallId);
  if (node?.geometry?.kind !== 'box' || node.component?.kind !== 'wall') throw new Error(`Parede ${wallId} não encontrada.`);
  return node.geometry.sizeM[0];
}
