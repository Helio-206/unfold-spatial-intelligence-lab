import {
  createSceneTransaction,
  executeSceneCommand,
  assertGeometryMutationSupported,
  serializeSceneTransaction,
  deserializeSceneTransaction,
  type Node,
  type PropertyProvenance,
  type SceneRelation,
  type SceneTransaction,
  type SpatialSceneV1,
  spatialWorldTransform,
  spatialWorldPoseToLocal,
  rotateSpatialVector,
} from './spatial-scene';
import { validateSpatialScene } from './spatial-scene';
import { calibrateScale, type PixelWallCandidate, type PlanRegionCandidate, type Point2 } from './plan-reconstruction';

export type PlanSceneOptions = {
  sceneId: string;
  title: string;
  image: { sha256: string; width: number; height: number };
  technicalDocumentRef?: { documentId: string; sha256: string };
  calibration: { pixelDistance: number; realDistanceMetres: number; evidence: string; actor: string };
  confirmedCandidateIds: string[];
  confirmedRegionIds?: string[];
  /** Accepted semantic links (semantic_spatial_map.v1). Labels only; never geometry. */
  regionSemanticLinks?: Array<{ regionId: string; elementId: string; label: string }>;
  regions?: PlanRegionCandidate[];
  candidates: PixelWallCandidate[];
  wall: { heightM: number; thicknessM: number };
  recordedAt?: string;
};

/** A scene may be overlaid on or edited against a raster only when both source
 * identities match. Candidate IDs are session-local labels, not source IDs. */
export function sceneMatchesPlanSource(
  scene: SpatialSceneV1,
  image: { sha256: string },
  technicalDocumentRef?: { documentId: string; sha256: string },
): boolean {
  const mapping = scene.imageWorldMapping;
  if (!mapping || mapping.sourceImageSha256.toLowerCase() !== image.sha256.toLowerCase()) return false;
  if (!technicalDocumentRef) return scene.sourceDocuments.length === 0;
  return scene.sourceDocuments.some((source) =>
    source.documentId === technicalDocumentRef.documentId
    && source.sha256.toLowerCase() === technicalDocumentRef.sha256.toLowerCase(),
  );
}

export type OpeningInput = { id: string; kind: 'door' | 'window'; offsetM: number; widthM: number; heightM: number; sillM: number; actor?: string };
export type OpeningEdit = { offsetM: number; widthM: number; heightM: number; sillM: number; actor?: string; acknowledgeVerifiedChange?: boolean };
export type WallEdit = { start: Point2; end: Point2; heightM?: number; thicknessM?: number; actor?: string; acknowledgeVerifiedChange?: boolean };

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

function wallWorldEndpoints(nodes: Node[], wall: Node): [[number, number, number], [number, number, number]] {
  if (wall.geometry?.kind !== 'box') throw new Error(`Geometria da parede ${wall.id} não suportada.`);
  const world = spatialWorldTransform(nodes, wall.id);
  if (!world) throw new Error(`Transformação da parede ${wall.id} indisponível.`);
  const offset = rotateSpatialVector([wall.geometry.sizeM[0] * world.scale[0] / 2, 0, 0], world.rotation);
  return [
    world.translation.map((value, axis) => value - offset[axis]!) as [number, number, number],
    world.translation.map((value, axis) => value + offset[axis]!) as [number, number, number],
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
      const worldEndpoints = wallWorldEndpoints(nodes, wall);
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
    const semantic = options.regionSemanticLinks?.find((link) => link.regionId === region.id);
    const semanticProvenance = semantic && options.technicalDocumentRef ? provenance('technical_document', 'unreviewed', recordedAt, { documentRef: { documentId: options.technicalDocumentRef.documentId, schema: 'technical_document.v1', elementId: semantic.elementId }, evidence: `Associação semântica aceite pelo utilizador (semantic_spatial_map.v1) para o elemento ${semantic.elementId}; apenas o rótulo foi associado, sem conversão de nome/área/cota em geometria.` }) : roomProvenance;
    const roomId = region.id;
    const room: Node = {
      id: roomId, label: semantic?.label ?? `Divisão proposta ${selectedRegions.indexOf(region) + 1}`, nodeType: 'component', parentId: null,
      transform: { translationM: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], provenance: { translationM: roomProvenance, rotation: roomProvenance, scale: roomProvenance } },
      geometry: { kind: 'polygon', verticesM: polygonVertices, provenance: roomProvenance },
      component: { kind: 'room', dependsOn: wallIds, properties: {
        ...(semantic ? { semanticElementId: { value: semantic.elementId, provenance: semanticProvenance }, semanticLabel: { value: semantic.label, provenance: semanticProvenance } } : {}),
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

function openingTransform(nodes: Node[], wall: Node, offset: number, width: number, sill: number, height: number): { position: [number, number, number]; angle: number } {
  if (wall.geometry?.kind !== 'box') throw new Error(`Geometria da parede ${wall.id} não suportada.`);
  const world = spatialWorldTransform(nodes, wall.id);
  if (!world) throw new Error(`Transformação da parede ${wall.id} indisponível.`);
  const q = world.rotation;
  const angle = 2 * Math.atan2(q[1], q[3]);
  const localX = (offset + width / 2) / world.scale[0] - wall.geometry.sizeM[0] / 2;
  const localY = (sill + height / 2) / world.scale[1];
  const offsetWorld = rotateSpatialVector([localX * world.scale[0], localY * world.scale[1], 0], q);
  return {
    position: world.translation.map((value, axis) => value + offsetWorld[axis]!) as [number, number, number],
    angle,
  };
}

function localOpeningPose(nodes: Node[], parentId: string | null, pose: { position: [number, number, number]; angle: number }): { translation: [number, number, number]; rotation: [number, number, number, number] } {
  const rotation: [number, number, number, number] = [0, Math.sin(pose.angle / 2), 0, Math.cos(pose.angle / 2)];
  return spatialWorldPoseToLocal(nodes, parentId, pose.position, rotation);
}

function validateOpeningPlacement(transaction: SceneTransaction, wall: Node, input: OpeningEdit, exceptId?: string): void {
  if (wall.geometry?.kind !== 'box' || wall.component?.kind !== 'wall') throw new Error('A abertura requer uma parede paramétrica.');
  assertPositive(input.widthM, 'Largura');
  assertPositive(input.heightM, 'Altura');
  const world = spatialWorldTransform(transaction.scene.nodes, wall.id);
  if (!world || ![input.offsetM, input.sillM].every(Number.isFinite) || input.offsetM < 0 || input.sillM < 0 || input.offsetM + input.widthM > wall.geometry.sizeM[0] * world.scale[0] || input.sillM + input.heightM > wall.geometry.sizeM[1] * world.scale[1]) throw new Error('A abertura excede os limites da parede.');
  for (const other of transaction.scene.nodes) {
    if (other.id === exceptId || !other.component?.dependsOn.includes(wall.id) || !['door', 'window'].includes(other.component.kind)) continue;
    const x = nodeProperty(other, 'offset'); const y = nodeProperty(other, 'sill');
    const w = nodeProperty(other, 'width'); const h = nodeProperty(other, 'height');
    if (input.offsetM < x + w && input.offsetM + input.widthM > x && input.sillM < y + h && input.sillM + input.heightM > y) throw new Error(`A abertura sobrepõe-se a ${other.label}; alteração recusada.`);
  }
}

export function addOpeningToScene(transaction: SceneTransaction, wallId: string, input: OpeningInput, recordedAt = new Date().toISOString()): SceneTransaction {
  const wall = transaction.scene.nodes.find((node) => node.id === wallId);
  if (!wall || wall.geometry?.kind !== 'box') throw new Error(`Parede ${wallId} não encontrada ou sem caixa paramétrica.`);
  validateOpeningPlacement(transaction, wall, input);
  const pose = openingTransform(transaction.scene.nodes, wall, input.offsetM, input.widthM, input.sillM, input.heightM);
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
  return executeSceneCommand(transaction, { type: 'AddComponent', node }, input.actor ?? 'user').transaction;
}

export function editOpeningInScene(transaction: SceneTransaction, openingId: string, edit: OpeningEdit): SceneTransaction {
  const opening = transaction.scene.nodes.find((node) => node.id === openingId);
  if (!opening || opening.geometry?.kind !== 'box' || !['door', 'window'].includes(opening.component?.kind ?? '')) throw new Error('Abertura paramétrica não encontrada.');
  const wall = transaction.scene.nodes.find((node) => opening.component!.dependsOn.includes(node.id) && node.component?.kind === 'wall');
  if (!wall) throw new Error('Parede de suporte não encontrada.');
  const changed = [edit.offsetM !== nodeProperty(opening, 'offset'), edit.widthM !== nodeProperty(opening, 'width'), edit.heightM !== nodeProperty(opening, 'height'), edit.sillM !== nodeProperty(opening, 'sill')].some(Boolean);
  if (changed) assertGeometryMutationSupported(transaction.scene, [openingId]);
  const confirmed = (state: PropertyProvenance['validation']) => state === 'verified' || state === 'corrected';
  const priorConfirmed = changed && (confirmed(opening.geometry.provenance.validation) || Object.values(opening.component!.properties).some((item) => confirmed(item.provenance.validation)) || confirmed(opening.transform.provenance.translationM.validation) || confirmed(opening.transform.provenance.rotation.validation));
  if (priorConfirmed && edit.acknowledgeVerifiedChange !== true) throw new Error('CONFIRMED_OPENING_CHANGE_REQUIRES_ACKNOWLEDGEMENT');
  validateOpeningPlacement(transaction, wall, edit, openingId);
  const pose = openingTransform(transaction.scene.nodes, wall, edit.offsetM, edit.widthM, edit.sillM, edit.heightM);
  const localPose = localOpeningPose(transaction.scene.nodes, opening.parentId, pose);
  const actor = edit.actor ?? 'user';
  const recordedAt = new Date().toISOString();
  const revised = (prior: PropertyProvenance, sourceValue: unknown, evidence: string): PropertyProvenance => confirmed(prior.validation)
    ? provenance('user', 'corrected', recordedAt, { actor, sourceValue, ...(prior.sourceUnit ? { sourceUnit: prior.sourceUnit } : {}), evidence: `${evidence} Estado anterior preservado.` })
    : provenance('user', 'unreviewed', recordedAt, { actor });
  const geometryChanged = edit.widthM !== nodeProperty(opening, 'width') || edit.heightM !== nodeProperty(opening, 'height');
  const translationChanged = changed;
  const geometrySource = geometryChanged ? (confirmed(opening.geometry.provenance.validation) ? revised(opening.geometry.provenance, opening.geometry.sizeM, 'Alteração explícita confirmada da abertura.') : provenance('user', 'unreviewed', recordedAt, { actor })) : opening.geometry.provenance;
  const translationSource = translationChanged ? (confirmed(opening.transform.provenance.translationM.validation) ? revised(opening.transform.provenance.translationM, opening.transform.translationM, 'Reposicionamento explícito da abertura.') : provenance('user', 'unreviewed', recordedAt, { actor })) : opening.transform.provenance.translationM;
  const rotationSource = opening.transform.provenance.rotation;
  const nextProperty = (key: 'offset' | 'width' | 'height' | 'sill', value: number) => {
    const prior = opening.component!.properties[key];
    const changedValue = value !== prior.value;
    return { value, unit: prior.unit ?? 'm', provenance: changedValue && confirmed(prior.provenance.validation) ? revised(prior.provenance, prior.value, `Alteração explícita do parâmetro ${key}.`) : changedValue ? provenance('user', 'unreviewed', recordedAt, { actor }) : prior.provenance };
  };
  const nextScene: SpatialSceneV1 = {
    ...transaction.scene,
    nodes: transaction.scene.nodes.map((item) => item.id !== openingId ? item : {
      ...item,
      transform: { ...item.transform, translationM: localPose.translation, rotation: localPose.rotation.map(cleanZero) as [number, number, number, number], provenance: { ...item.transform.provenance, translationM: translationSource, rotation: rotationSource } },
      geometry: { ...item.geometry!, kind: 'box', sizeM: [edit.widthM, edit.heightM, item.geometry!.kind === 'box' ? item.geometry!.sizeM[2] : 0.04], provenance: geometrySource },
      component: { ...item.component!, properties: { ...item.component!.properties, offset: nextProperty('offset', edit.offsetM), width: nextProperty('width', edit.widthM), height: nextProperty('height', edit.heightM), sill: nextProperty('sill', edit.sillM) } },
    }),
    revision: { id: `${transaction.scene.id}:r${transaction.scene.revision.number + 1}`, number: transaction.scene.revision.number + 1, parentId: transaction.scene.revision.id, operationId: `${transaction.scene.id}:op${transaction.scene.revision.number + 1}:EditOpening`, createdAt: recordedAt, createdBy: actor },
  };
  return { scene: validateSpatialScene(nextScene), undoStack: [...transaction.undoStack.slice(-99), transaction.scene], redoStack: [] };
}

export function editWallInScene(transaction: SceneTransaction, wallId: string, edit: WallEdit): SceneTransaction {
  const previous = transaction.scene.nodes.find((node) => node.id === wallId);
  if (!previous || previous.geometry?.kind !== 'box' || previous.component?.kind !== 'wall') throw new Error(`Parede ${wallId} não encontrada.`);
  const previousGeometry = previous.geometry;
  const oldLength = previousGeometry.sizeM[0];
  const oldHeight = previousGeometry.sizeM[1];
  const oldThickness = previousGeometry.sizeM[2];
  const nextPose = wallPose(edit.start, edit.end);
  const previousWorld = spatialWorldTransform(transaction.scene.nodes, wallId);
  if (!previousWorld) throw new Error('SCENE_WALL_WORLD_TRANSFORM_INVALID');
  if (previousWorld.scale.some((value) => Math.abs(value - 1) > 1e-5)) throw new Error('SCENE_PARAMETRIC_WALL_SCALE_EDIT_UNSUPPORTED');
  const desiredRotation: [number, number, number, number] = [0, Math.sin(nextPose.angle / 2), 0, Math.cos(nextPose.angle / 2)];
  const localPose = spatialWorldPoseToLocal(transaction.scene.nodes, previous.parentId, nextPose.position, desiredRotation);
  const nextHeight = edit.heightM ?? oldHeight;
  const nextThickness = edit.thicknessM ?? oldThickness;
  assertPositive(nextHeight, 'Altura');
  assertPositive(nextThickness, 'Espessura');
  const geometryChanged = !close(nextPose.length, oldLength) || !close(nextHeight, oldHeight) || !close(nextThickness, oldThickness);
  const angleChanged = localPose.rotation.some((value, axis) => !close(value, previous.transform.rotation[axis]!));
  const translationChanged = localPose.translation.some((value, axis) => !close(value, previous.transform.translationM[axis]!));
  const transformChanged = angleChanged || translationChanged;
  if (geometryChanged || transformChanged) {
    const dependents = transaction.scene.nodes.filter((node) => node.component?.dependsOn.includes(wallId));
    const affectedIds = [wallId, ...dependents.map((node) => node.id)];
    const rooms = new Map(dependents.filter((node) => node.component?.kind === 'room').map((node) => [node.id, node]));
    const relationIdsPreservedByRoomRecalculation = transaction.scene.relations.filter((relation) => {
      if (relation.kind !== 'bounded_by') return false;
      const roomId = rooms.has(relation.fromNodeId) ? relation.fromNodeId : rooms.has(relation.toNodeId) ? relation.toNodeId : undefined;
      const boundaryId = roomId === relation.fromNodeId ? relation.toNodeId : relation.fromNodeId;
      const boundaryRefs = rooms.get(roomId ?? '')?.component?.properties.boundaryRefs?.value;
      if (typeof boundaryRefs !== 'string') return false;
      try { return (JSON.parse(boundaryRefs) as Array<{ wallId?: unknown }>).some((ref) => ref?.wallId === boundaryId); } catch { return false; }
    }).map((relation) => relation.id);
    assertGeometryMutationSupported(transaction.scene, affectedIds, relationIdsPreservedByRoomRecalculation);
  }
  const confirmed = (state: PropertyProvenance['validation']) => state === 'verified' || state === 'corrected';
  const confirmedWallParameters = ['length', 'height', 'thickness'].some((key) => confirmed(previous.component!.properties[key]?.provenance.validation ?? 'unreviewed'));
  if ((geometryChanged && (confirmed(previousGeometry.provenance.validation) || confirmedWallParameters) || translationChanged && confirmed(previous.transform.provenance.translationM.validation) || angleChanged && confirmed(previous.transform.provenance.rotation.validation)) && edit.acknowledgeVerifiedChange !== true) throw new Error('CONFIRMED_WALL_CHANGE_REQUIRES_ACKNOWLEDGEMENT');
  const dependents = transaction.scene.nodes.filter((node) => node.component?.dependsOn.includes(wallId));
  if (dependents.some((item) => !['door', 'window', 'room'].includes(item.component?.kind ?? ''))) throw new Error('Existe uma dependência geométrica não suportada; edição recusada.');
  const recalculated = dependents.filter((item) => item.component?.kind === 'door' || item.component?.kind === 'window').map((opening) => {
    const offset = nodeProperty(opening, 'offset');
    const width = nodeProperty(opening, 'width');
    const height = nodeProperty(opening, 'height');
    const sill = nodeProperty(opening, 'sill');
    if (offset < 0 || offset + width > nextPose.length || sill + height > nextHeight) throw new Error(`A abertura ${opening.id} excede a nova parede; a edição foi recusada.`);
    if (transformChanged && ['verified', 'corrected'].some((state) => [opening.transform.provenance.translationM.validation, opening.transform.provenance.rotation.validation].includes(state as PropertyProvenance['validation'])) && edit.acknowledgeVerifiedChange !== true) throw new Error(`A posição confirmada da abertura ${opening.id} requer confirmação explícita para ser alterada.`);
    const proxy: Node = { ...previous, transform: { ...previous.transform, translationM: localPose.translation, rotation: localPose.rotation }, geometry: { kind: 'box', sizeM: [nextPose.length, nextHeight, nextThickness], provenance: previousGeometry.provenance } };
    const proxyNodes = transaction.scene.nodes.map((item) => item.id === wallId ? proxy : item);
    return { node: opening, pose: openingTransform(proxyNodes, proxy, offset, width, sill, height), offset };
  });
  const actor = edit.actor ?? 'user';
  const recordedAt = new Date().toISOString();
  const revisedProvenance = (prior: PropertyProvenance, sourceValue: unknown, evidence: string): PropertyProvenance => confirmed(prior.validation)
    ? provenance('user', 'corrected', recordedAt, { actor, sourceValue, ...(prior.sourceUnit ? { sourceUnit: prior.sourceUnit } : {}), evidence: `${evidence} Estado anterior preservado.` })
    : provenance('user', 'unreviewed', recordedAt, { actor });
  const wallSource = geometryChanged ? revisedProvenance(previousGeometry.provenance, previousGeometry.sizeM, 'Alteração explícita da geometria da parede.') : previousGeometry.provenance;
  const transformSource = translationChanged ? revisedProvenance(previous.transform.provenance.translationM, previous.transform.translationM, 'Alteração explícita da transformação da parede.') : previous.transform.provenance.translationM;
  const rotationSource = angleChanged ? revisedProvenance(previous.transform.provenance.rotation, previous.transform.rotation, 'Alteração explícita da rotação da parede.') : previous.transform.provenance.rotation;
  const wallProperty = (key: 'length' | 'height' | 'thickness', value: number) => {
    const prior = previous.component?.properties[key];
    const propertyProvenance = !prior ? wallSource : prior.value === value ? prior.provenance : revisedProvenance(prior.provenance, prior.value, `Alteração explícita do parâmetro ${key}.`);
    return { value, unit: 'm', provenance: propertyProvenance };
  };
  const editedWall: Node = { ...previous, transform: { ...previous.transform, translationM: localPose.translation, rotation: localPose.rotation.map(cleanZero) as [number, number, number, number], provenance: { ...previous.transform.provenance, translationM: transformSource, rotation: rotationSource } }, geometry: { kind: 'box', sizeM: [nextPose.length, nextHeight, nextThickness], provenance: wallSource }, component: { ...previous.component!, properties: { ...previous.component!.properties, length: wallProperty('length', nextPose.length), height: wallProperty('height', nextHeight), thickness: wallProperty('thickness', nextThickness) } } };
  const byOpening = new Map(recalculated.map(({ node, pose, offset }) => [node.id, { node, pose, offset }]));
  const nodes = transaction.scene.nodes.map((item) => {
    if (item.id === wallId) return editedWall;
    const changed = byOpening.get(item.id);
    if (changed) {
      const localOpening = localOpeningPose(transaction.scene.nodes, item.parentId, changed.pose);
      const rotation = localOpening.rotation.map(cleanZero) as [number, number, number, number];
      const positionChanged = localOpening.translation.some((value, axis) => !close(value, item.transform.translationM[axis]!));
      const rotationChanged = rotation.some((value, axis) => !close(value, item.transform.rotation[axis]!));
      if (!positionChanged && !rotationChanged) return item;
      return { ...item, transform: { ...item.transform, translationM: localOpening.translation, rotation, provenance: { ...item.transform.provenance, translationM: positionChanged ? revisedProvenance(item.transform.provenance.translationM, item.transform.translationM, `Transformação derivada recalculada após editar ${wallId}.`) : item.transform.provenance.translationM, rotation: rotationChanged ? revisedProvenance(item.transform.provenance.rotation, item.transform.rotation, `Rotação derivada recalculada após editar ${wallId}.`) : item.transform.provenance.rotation } } };
    }
    return item;
  });
  let nextScene: SpatialSceneV1 = { ...transaction.scene, nodes };
  const edited = nodes.find((node) => node.id === wallId)!;
  const endpoints = wallWorldEndpoints(nextScene.nodes, edited);
  nextScene = { ...nextScene, nodes: nextScene.nodes.map((room) => {
    if (room.component?.kind !== 'room' || !room.component.dependsOn.includes(wallId)) return room;
    if (transformChanged && room.geometry && confirmed(room.geometry.provenance.validation) && edit.acknowledgeVerifiedChange !== true) throw new Error(`A geometria confirmada da divisão ${room.id} requer confirmação explícita para ser alterada.`);
    if (room.geometry?.kind !== 'polygon') throw new Error(`Geometria dependente ${room.id} não é um polígono suportado.`);
    const previousVertices = room.geometry.verticesM;
    const boundaryRefsValue = room.component?.properties.boundaryRefs?.value;
    if (typeof boundaryRefsValue !== 'string') throw new Error(`Referências de contorno em falta para ${room.id}.`);
    let boundaryRefs: Array<{ wallId: string; startIndex: number; endIndex: number; startEndpoint: 'a' | 'b'; endEndpoint: 'a' | 'b' }>;
    try { boundaryRefs = JSON.parse(boundaryRefsValue); } catch { throw new Error(`Referências de contorno inválidas para ${room.id}.`); }
    if (!Array.isArray(boundaryRefs) || !boundaryRefs.every((ref) => ref && typeof ref.wallId === 'string' && Number.isInteger(ref.startIndex) && Number.isInteger(ref.endIndex) && ['a', 'b'].includes(ref.startEndpoint) && ['a', 'b'].includes(ref.endEndpoint))) throw new Error(`Referências de contorno inválidas para ${room.id}.`);
    const verticesM = previousVertices.map((point) => [...point] as [number, number, number]);
    for (const ref of boundaryRefs) {
      if (ref.wallId !== wallId) continue;
      if (!Number.isInteger(ref.startIndex) || !Number.isInteger(ref.endIndex) || !verticesM[ref.startIndex] || !verticesM[ref.endIndex]) throw new Error(`Índice de contorno inválido em ${room.id}.`);
      verticesM[ref.startIndex] = [...endpoints[ref.startEndpoint === 'a' ? 0 : 1]];
      verticesM[ref.endIndex] = [...endpoints[ref.endEndpoint === 'a' ? 0 : 1]];
    }
    if (verticesM.every((point, index) => point.every((value, axis) => close(value, previousVertices[index]![axis]!)))) return room;
    return { ...room, geometry: { ...room.geometry, verticesM, provenance: revisedProvenance(room.geometry.provenance, previousVertices, `Polígono recalculado após edição da parede ${wallId}; geometria derivada permanece por rever.`) } };
  }) };
  const number = transaction.scene.revision.number + 1;
  nextScene = { ...nextScene, revision: { id: `${transaction.scene.id}:r${number}`, number, parentId: transaction.scene.revision.id, operationId: `${transaction.scene.id}:op${number}:EditWall-${wallId}`, createdAt: recordedAt, createdBy: actor } };
  return { scene: validateSpatialScene(nextScene), undoStack: [...transaction.undoStack.slice(-99), transaction.scene], redoStack: [] };
}

function close(left: number, right: number): boolean { return Math.abs(left - right) <= 1e-7; }
function cleanZero(value: number): number { return Math.abs(value) < 1e-15 ? 0 : value; }

export function removeWallFromScene(transaction: SceneTransaction, wallId: string, actor = 'user'): SceneTransaction {
  const wall = transaction.scene.nodes.find((node) => node.id === wallId);
  if (!wall) throw new Error(`Parede ${wallId} não encontrada.`);
  const dependents = transaction.scene.nodes.filter((node) => node.component?.dependsOn.includes(wallId)).map((node) => node.id);
  let next = transaction;
  for (const id of dependents.reverse()) next = executeSceneCommand(next, { type: 'RemoveComponent', nodeId: id }, actor).transaction;
  next = executeSceneCommand(next, { type: 'RemoveComponent', nodeId: wallId }, actor).transaction;
  return { scene: next.scene, undoStack: [...transaction.undoStack, transaction.scene].slice(-100), redoStack: [] };
}

export function saveAndRestoreScene(transaction: SceneTransaction): SceneTransaction {
  return deserializeSceneTransaction(serializeSceneTransaction(transaction));
}

export function sceneWallLength(scene: SpatialSceneV1, wallId: string): number {
  const node = scene.nodes.find((item) => item.id === wallId);
  if (node?.geometry?.kind !== 'box' || node.component?.kind !== 'wall') throw new Error(`Parede ${wallId} não encontrada.`);
  return node.geometry.sizeM[0];
}
