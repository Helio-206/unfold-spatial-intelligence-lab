import { describe, expect, it } from 'vitest';
import {
  buildPlanVectorModel, calibrateScale, candidateToWall, consolidateWallCandidates, countClosedCandidateContours, detectCandidateIntersections, detectOrthogonalRoomCandidates, detectWallCandidates,
  mergeWallCandidates, splitWallCandidate, traceWallCandidate, type PixelRaster,
} from '../src/plan-reconstruction';
import { addOpeningToScene, createPlanScene, editOpeningInScene, editWallInScene, removeWallFromScene, saveAndRestoreScene, sceneWallLength } from '../src/plan-scene';
import { buildThreePlanGroup } from '../src/plan-three-adapter';
import { executeSceneCommand } from '../src/spatial-scene';
import { Raycaster, Vector3 } from 'three';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

function raster(width: number, height: number, rectangles: Array<[number, number, number, number]>): PixelRaster {
  const grayscale = new Uint8Array(width * height).fill(255);
  for (const [x0, y0, x1, y1] of rectangles) {
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) grayscale[y * width + x] = 0;
  }
  return { width, height, grayscale };
}

describe('plan reconstruction geometry', () => {
  it('reconstructs independent Case A fixture geometry within 1 percent and merges its rooms transactionally', () => {
    const truth = JSON.parse(readFileSync(new URL('../reports/phase-10-teardown/fixtures/case-a-ground-truth.json', import.meta.url), 'utf8')) as {
      imageSizePx: { width: number; height: number }; scale: { pixels: number; metres: number };
      rooms: Array<{ id: string; label: string; verticesPx: Array<[number, number]>; dimensionsM: [number, number]; areaM2: number }>;
      sharedWall: { lengthM: number; doorOpeningM: { width: number; height: number; offset: number; sill: number } };
      tolerance: { dimensionRelativeErrorMax: number };
    };
    const vertices = truth.rooms.map((room) => room.verticesPx.map(([x, y]) => ({ x, y })));
    const edgeIds = new Map<string, string>();
    const candidates = [] as ReturnType<typeof traceWallCandidate>[];
    const edgeKey = (a: {x:number;y:number}, b: {x:number;y:number}) => [a, b].map((p) => `${p.x},${p.y}`).sort().join(':');
    for (const polygon of vertices) for (let i = 0; i < polygon.length; i += 1) {
      const a = polygon[i]!; const b = polygon[(i + 1) % polygon.length]!; const key = edgeKey(a, b);
      if (edgeIds.has(key)) continue;
      const id = `fixture-edge-${edgeIds.size + 1}`; edgeIds.set(key, id);
      candidates.push(traceWallCandidate(id, a, b, 12));
    }
    const regions = truth.rooms.map((room, index) => ({
      id: room.id, boundaryCandidateIds: vertices[index]!.map((a, i) => edgeIds.get(edgeKey(a, vertices[index]![(i + 1) % vertices[index]!.length]!))!),
      vertices: vertices[index]!, areaPx2: Math.abs(vertices[index]!.reduce((sum, point, i, all) => sum + point.x * all[(i + 1) % all.length]!.y - all[(i + 1) % all.length]!.x * point.y, 0) / 2),
      validation: 'unreviewed' as const, eligibility: 'construction_candidate' as const, confidence: 1, evidence: ['independent ground truth; user-reviewed fixture'], topologyMethod: 'closed_segment_graph' as const,
    }));
    const imageBytes = readFileSync(new URL('../reports/phase-10-teardown/fixtures/case-a-floor-plan.png', import.meta.url));
    const built = createPlanScene({
      sceneId: 'fixture-case-a', title: 'Case A · planta sintética dimensionada', image: { sha256: createHash('sha256').update(imageBytes).digest('hex'), ...truth.imageSizePx },
      calibration: { pixelDistance: truth.scale.pixels, realDistanceMetres: truth.scale.metres, evidence: 'Cota conhecida da fixture: 10,00 m em 1000 px; ground truth separado do reconstrutor.', actor: 'case-a-reviewer' },
      confirmedCandidateIds: [], confirmedRegionIds: truth.rooms.map((room) => room.id), regions, candidates, wall: { heightM: 2.7, thicknessM: 0.12 }, recordedAt: '2026-11-01T00:00:00.000Z',
    });
    const rooms = built.scene.nodes.filter((node) => node.component?.kind === 'room');
    expect(rooms).toHaveLength(2);
    for (let i = 0; i < truth.rooms.length; i += 1) {
      const room = rooms.find((node) => node.id === truth.rooms[i]!.id)!;
      expect(room.geometry?.kind).toBe('polygon');
      if (room.geometry?.kind !== 'polygon') throw new Error('Room polygon expected');
      const width = Math.max(...room.geometry.verticesM.map((point) => point[0])) - Math.min(...room.geometry.verticesM.map((point) => point[0]));
      const depth = Math.max(...room.geometry.verticesM.map((point) => point[2])) - Math.min(...room.geometry.verticesM.map((point) => point[2]));
      const expected = truth.rooms[i]!.dimensionsM;
      expect(Math.max(Math.abs(width - expected[0]) / expected[0], Math.abs(depth - expected[1]) / expected[1])).toBeLessThanOrEqual(truth.tolerance.dimensionRelativeErrorMax);
      const area = Math.abs(room.geometry.verticesM.reduce((sum, point, index, all) => sum + point[0] * all[(index + 1) % all.length]![2] - all[(index + 1) % all.length]![0] * point[2], 0) / 2);
      expect(Math.abs(area - truth.rooms[i]!.areaM2) / truth.rooms[i]!.areaM2).toBeLessThanOrEqual(truth.tolerance.dimensionRelativeErrorMax);
    }
    const [roomA, roomB] = rooms;
    const sharedWallId = roomA!.component!.dependsOn.find((id) => roomB!.component!.dependsOn.includes(id))!;
    const door = addOpeningToScene(built, sharedWallId, { id: 'fixture-door', kind: 'door', offsetM: truth.sharedWall.doorOpeningM.offset, widthM: truth.sharedWall.doorOpeningM.width, heightM: truth.sharedWall.doorOpeningM.height, sillM: truth.sharedWall.doorOpeningM.sill, actor: 'case-a-reviewer' });
    expect(door.scene.relations.filter((relation) => relation.kind === 'bounded_by' && relation.toNodeId === sharedWallId)).toHaveLength(2);
    expect(door.scene.nodes.find((node) => node.id === sharedWallId)?.geometry?.kind === 'box' && (door.scene.nodes.find((node) => node.id === sharedWallId)!.geometry as Extract<NonNullable<typeof door.scene.nodes[number]['geometry']>, {kind:'box'}>).sizeM[0]).toBeCloseTo(truth.sharedWall.lengthM);
    const merged = executeSceneCommand(door, { type: 'RemoveWall', wallId: sharedWallId, targetRoomId: roomA!.id, otherRoomId: roomB!.id }, 'case-a-reviewer').transaction;
    expect(merged.scene.nodes.filter((node) => node.component?.kind === 'room')).toHaveLength(1);
    expect(merged.scene.nodes.some((node) => node.id === 'fixture-door' || node.id === sharedWallId)).toBe(false);
    expect(merged.scene.relations.every((relation) => merged.scene.nodes.some((node) => node.id === relation.fromNodeId) && merged.scene.nodes.some((node) => node.id === relation.toNodeId))).toBe(true);
    expect(executeSceneCommand(merged, { type: 'Undo' }).transaction.scene.nodes).toEqual(door.scene.nodes);
  });
  it('detects horizontal and vertical wall candidates from a new raster without image-specific coordinates', () => {
    const candidates = detectWallCandidates(raster(140, 100, [[10, 20, 115, 24], [35, 24, 39, 82]]), { minimumLengthPx: 30 });
    expect(candidates.some(({ orientation }) => orientation === 'horizontal')).toBe(true);
    expect(candidates.some(({ orientation }) => orientation === 'vertical')).toBe(true);
    expect(candidates.every(({ confidence, thicknessPx }) => confidence > 0 && thicknessPx > 0)).toBe(true);
  });

  it('allows faint lines to be proposed at a higher threshold without confirming them as walls', () => {
    const image = raster(140, 100, []);
    for (let x = 10; x < 120; x += 1) image.grayscale[25 * image.width + x] = 140;
    expect(detectWallCandidates(image, { threshold: 112, minimumLengthPx: 30 })).toHaveLength(0);
    expect(detectWallCandidates(image, { threshold: 150, minimumLengthPx: 30 })).toHaveLength(1);
  });

  it('finds intersections and supports a manual trace for unclear raster regions', () => {
    const manual = traceWallCandidate('manual-a', { x: 5, y: 25 }, { x: 105, y: 25 }, 6);
    const vertical = traceWallCandidate('manual-b', { x: 50, y: 0 }, { x: 50, y: 80 }, 6);
    expect(detectCandidateIntersections([manual, vertical])).toEqual([{ firstId: 'manual-a', secondId: 'manual-b', point: { x: 50, y: 25 }, tolerancePx: 2 }]);
    const diagonal = traceWallCandidate('manual-c', { x: 20, y: 0 }, { x: 80, y: 60 }, 5);
    expect(diagonal.orientation).toBe('diagonal');
    expect(detectCandidateIntersections([diagonal, vertical])[0]?.point).toEqual({ x: 50, y: 30 });
    expect(() => traceWallCandidate('bad', { x: 1, y: 1 }, { x: 1, y: 1 }, 4)).toThrow();
  });

  it('reports raster graph cycles without claiming rooms or verified areas', () => {
    const square = [
      traceWallCandidate('top', { x: 0, y: 0 }, { x: 100, y: 0 }, 4),
      traceWallCandidate('right', { x: 100, y: 0 }, { x: 100, y: 80 }, 4),
      traceWallCandidate('bottom', { x: 100, y: 80 }, { x: 0, y: 80 }, 4),
      traceWallCandidate('left', { x: 0, y: 80 }, { x: 0, y: 0 }, 4),
    ];
    expect(countClosedCandidateContours(square)).toBe(1);
    const partition = traceWallCandidate('partition', { x: 50, y: 0 }, { x: 50, y: 80 }, 4);
    expect(countClosedCandidateContours([...square, partition], 2)).toBe(2);
    expect(countClosedCandidateContours([...square, { ...square[0]!, id: 'duplicate' }], 2)).toBe(1);
    expect(countClosedCandidateContours(square.slice(0, 3))).toBe(0);
    expect(countClosedCandidateContours(square, 8)).toBe(1);
    expect(() => countClosedCandidateContours(square, Number.NaN)).toThrow();
  });

  it('consolidates duplicate collinear segments and supports explicit split/join editing', () => {
    const first = traceWallCandidate('a', { x: 0, y: 0 }, { x: 50, y: 0 }, 4);
    const second = traceWallCandidate('b', { x: 49, y: 1 }, { x: 100, y: 0 }, 5);
    expect(consolidateWallCandidates([first, second], 3)).toHaveLength(1);
    expect(consolidateWallCandidates([first, second], 3)[0]?.sourceCandidateIds).toEqual(['a', 'b']);
    expect(() => consolidateWallCandidates([first, first], 3)).toThrow('ID duplicado');
    expect(mergeWallCandidates([first, second]).start.x).toBeCloseTo(0);
    const [left, right] = splitWallCandidate(first);
    expect(left.end).toEqual(right.start);
    expect(left.sourceCandidateIds).toEqual(['a']);
    expect(mergeWallCandidates([left, right]).sourceCandidateIds).toEqual(['a']);
    expect(() => mergeWallCandidates([first, traceWallCandidate('off-axis', { x: 0, y: 20 }, { x: 50, y: 20 }, 4)])).toThrow('colineares');
  });

  it('builds unreviewed pixel-space regions, adjacency and ambiguous gaps without inventing metric scale', () => {
    const walls = [
      traceWallCandidate('top', { x: 0, y: 0 }, { x: 100, y: 0 }, 6),
      traceWallCandidate('right', { x: 100, y: 0 }, { x: 100, y: 80 }, 6),
      traceWallCandidate('bottom', { x: 100, y: 80 }, { x: 0, y: 80 }, 6),
      traceWallCandidate('left', { x: 0, y: 80 }, { x: 0, y: 0 }, 6),
      traceWallCandidate('partition', { x: 50, y: 0 }, { x: 50, y: 80 }, 5),
    ];
    const model = buildPlanVectorModel(walls, { tolerancePx: 2 });
    expect(model.coordinateSpace).toBe('source-image-pixels');
    expect(model.scale).toBeNull();
    expect(model.regions).toHaveLength(2);
    expect(model.regions.map((region) => region.areaPx2).sort((a, b) => a - b)).toEqual([4000, 4000]);
    expect(model.adjacency).toHaveLength(1);
    expect(model.adjacency[0]?.sharedCandidateIds).toEqual(expect.arrayContaining(['partition', 'top', 'bottom']));
    expect(model.regions.every((region) => region.validation === 'unreviewed' && region.label === undefined)).toBe(true);
    expect(model.walls.every((wall) => wall.validation === 'unreviewed' && wall.origin === 'manual_trace')).toBe(true);
    expect(() => buildPlanVectorModel(walls, { scale: { pixelsPerMetre: 0, source: 'known_measurement' } })).toThrow('Escala vectorial inválida');
    const scaled = buildPlanVectorModel(walls, { tolerancePx: 2, scale: { pixelsPerMetre: 10, source: 'known_measurement' } });
    expect(scaled.regions.map((region) => region.areaM2)).toEqual([40, 40]);
    expect(scaled.regions.every((region) => region.validation === 'unreviewed')).toBe(true);
  });

  it('proposes only wall-supported orthogonal regions and removes a composite face crossing an interior partition', () => {
    const walls = [
      traceWallCandidate('top-left', { x: 10, y: 10 }, { x: 100, y: 10 }, 6),
      traceWallCandidate('top-right', { x: 100, y: 10 }, { x: 190, y: 10 }, 6),
      traceWallCandidate('bottom-left', { x: 10, y: 110 }, { x: 100, y: 110 }, 6),
      traceWallCandidate('bottom-right', { x: 100, y: 110 }, { x: 190, y: 110 }, 6),
      traceWallCandidate('left', { x: 10, y: 10 }, { x: 10, y: 110 }, 6),
      traceWallCandidate('partition', { x: 100, y: 10 }, { x: 100, y: 110 }, 6),
      traceWallCandidate('right', { x: 190, y: 10 }, { x: 190, y: 110 }, 6),
    ];
    const regions = detectOrthogonalRoomCandidates(walls, { width: 220, height: 140 }, { snapTolerancePx: 3 });
    expect(regions).toHaveLength(2);
    expect(regions.every((region) => region.eligibility === 'construction_candidate' && region.validation === 'unreviewed')).toBe(true);
    expect(regions.every((region) => region.boundaryCandidateIds.includes('partition'))).toBe(true);
    expect(regions.some((region) => region.vertices.some((point) => point.x === 10 && point.y === 10))).toBe(true);
    expect(detectOrthogonalRoomCandidates(walls.slice(0, 3), { width: 220, height: 140 }, { snapTolerancePx: 3 })).toHaveLength(0);
  });

  it('marks aligned raster gaps and paired parallel lines as ambiguous evidence only', () => {
    const lower = traceWallCandidate('left', { x: 0, y: 10 }, { x: 30, y: 10 }, 4);
    const upper = traceWallCandidate('right', { x: 42, y: 10 }, { x: 100, y: 10 }, 4);
    const parallel = traceWallCandidate('parallel', { x: 0, y: 18 }, { x: 100, y: 18 }, 4);
    const model = buildPlanVectorModel([lower, upper, parallel], { tolerancePx: 2 });
    expect(model.openingCandidates).toHaveLength(1);
    expect(model.openingCandidates[0]).toMatchObject({ validation: 'ambiguous', reason: expect.stringContaining('pode ser símbolo') });
    expect(model.openingCandidates[0]!.end.x - model.openingCandidates[0]!.start.x).toBeCloseTo(12);
    expect(model.thicknessCandidates).toContainEqual({ firstId: 'left', secondId: 'parallel', estimatedThicknessPx: 8, validation: 'ambiguous' });
  });

  it('requires explicit positive scale calibration before vector conversion', () => {
    const candidate = { id: 'a', orientation: 'horizontal' as const, start: { x: 0, y: 0 }, end: { x: 200, y: 0 }, thicknessPx: 8, confidence: 1 };
    expect(() => calibrateScale(0, 4, 'known_measurement')).toThrow();
    const wall = candidateToWall(candidate, calibrateScale(200, 4, 'known_measurement'), { height: 2.8 });
    expect(Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y)).toBe(4);
    expect(wall.thickness).toBeCloseTo(0.16);
  });

  it('creates, edits, recalculates dependent openings, and persists a calibrated spatial_scene.v1 transaction', () => {
    const candidates = detectWallCandidates(raster(140, 100, [[10, 20, 115, 24]]), { minimumLengthPx: 30 });
    const selected = candidates[0]!;
    const initial = createPlanScene({
      sceneId: 'plan-home', title: 'Planta reconstruída', image: { sha256: 'a'.repeat(64), width: 140, height: 100 },
      calibration: { pixelDistance: 100, realDistanceMetres: 5, evidence: 'Distância confirmada de 5 m em 100 px.', actor: 'reviewer' },
      confirmedCandidateIds: [selected.id], candidates, wall: { heightM: 2.8, thicknessM: 0.2 }, recordedAt: '2026-10-31T00:00:00.000Z',
    });
    const wallId = `wall-${selected.id}`;
    expect(initial.scene.schema).toBe('spatial_scene.v1');
    expect(initial.scene.nodes[0]?.component?.properties.sourceOrigin?.value).toBe('automatic_detection');
    expect(initial.scene.nodes[0]?.component?.properties.sourcePixelSegment?.provenance.validation).toBe('unreviewed');
    expect(JSON.parse(String(initial.scene.nodes[0]?.component?.properties.sourceCandidateIds?.value))).toHaveLength(1);
    expect(initial.scene.imageWorldMapping?.provenance).toMatchObject({ source: 'user', validation: 'unreviewed', actor: 'reviewer' });
    expect(() => createPlanScene({
      sceneId: 'uncalibrated', title: 'Sem escala', image: { sha256: 'a'.repeat(64), width: 140, height: 100 },
      calibration: { pixelDistance: Number.NaN, realDistanceMetres: 5, evidence: '', actor: '' }, confirmedCandidateIds: [selected.id], candidates, wall: { heightM: 2.8, thicknessM: 0.2 },
    })).toThrow();
    expect(() => addOpeningToScene(initial, wallId, { id: 'window-outside', kind: 'window', offsetM: 9, widthM: 1, heightM: 1, sillM: 1 })).toThrow();
    const withDoor = addOpeningToScene(initial, wallId, { id: 'door-main', kind: 'door', offsetM: 1, widthM: 0.8, heightM: 2.05, sillM: 0, actor: 'reviewer' }, '2026-10-31T00:01:00.000Z');
    const withWindow = addOpeningToScene(withDoor, wallId, { id: 'window-main', kind: 'window', offsetM: 3, widthM: 0.8, heightM: 1, sillM: 1, actor: 'reviewer' });
    const cutouts = buildThreePlanGroup(withWindow.scene);
    cutouts.updateMatrixWorld(true);
    const cutWall = cutouts.getObjectByName(wallId)!.children[0] as import('three').Mesh;
    const wallLength = sceneWallLength(withDoor.scene, wallId);
    const castAt = (offset: number, height: number) => {
      const origin = cutWall.localToWorld(new Vector3(-wallLength / 2 + offset, height, 1));
      const direction = new Vector3(0, 0, -1).transformDirection(cutWall.matrixWorld);
      return new Raycaster(origin, direction, 0, 3).intersectObject(cutWall).length;
    };
    expect(castAt(1.4, 1)).toBe(0);
    expect(castAt(3.4, 1.5)).toBe(0);
    expect(castAt(0.4, 1)).toBeGreaterThan(0);
    expect(() => addOpeningToScene(withDoor, wallId, { id: 'overlap', kind: 'window', offsetM: 1.2, widthM: 0.5, heightM: 1, sillM: 1 })).toThrow('sobrepõe-se');
    const widened = editOpeningInScene(withDoor, 'door-main', { offsetM: 1, widthM: 1, heightM: 2.05, sillM: 0, actor: 'reviewer' });
    expect(withDoor.scene.nodes.find((node) => node.id === 'door-main')?.geometry).toMatchObject({ sizeM: [0.8, 2.05, 0.04] });
    expect(widened.scene.nodes.find((node) => node.id === 'door-main')?.geometry).toMatchObject({ sizeM: [1, 2.05, 0.04] });
    expect(widened.scene.nodes.find((node) => node.id === 'door-main')?.component?.properties.width.value).toBe(1);
    expect(executeSceneCommand(widened, { type: 'Undo' }).transaction.scene.nodes).toEqual(withDoor.scene.nodes);
    expect(() => editOpeningInScene(withDoor, 'door-main', { offsetM: 5, widthM: 1, heightM: 2, sillM: 0 })).toThrow('excede');
    const oldLength = sceneWallLength(withDoor.scene, wallId);
    const wall = withDoor.scene.nodes.find((node) => node.id === wallId)!;
    const originalDoorX = withDoor.scene.nodes.find((node) => node.id === 'door-main')!.transform.translationM[0];
    const start = { x: wall.transform.translationM[0] - oldLength / 2, y: wall.transform.translationM[2] };
    const end = { x: wall.transform.translationM[0] + oldLength / 2, y: wall.transform.translationM[2] };
    const taller = editWallInScene(withDoor, wallId, { start, end, heightM: 3, thicknessM: 0.25 });
    const tallerGeometry = taller.scene.nodes.find((node) => node.id === wallId)?.geometry;
    expect(tallerGeometry?.kind).toBe('box');
    if (tallerGeometry?.kind !== 'box') throw new Error('A geometria da parede deve continuar paramétrica.');
    expect(tallerGeometry.sizeM[0]).toBeCloseTo(oldLength);
    expect(tallerGeometry.sizeM[1]).toBeCloseTo(3);
    expect(tallerGeometry.sizeM[2]).toBeCloseTo(0.25);
    expect(taller.scene.nodes.find((node) => node.id === 'door-main')?.transform.translationM[0]).toBeCloseTo(originalDoorX);
    expect(() => editWallInScene(withDoor, wallId, { start, end, heightM: 1.5 })).toThrow('excede a nova parede');
    const edited = editWallInScene(withDoor, wallId, {
      start: { x: wall.transform.translationM[0] - oldLength / 2 + 0.5, y: wall.transform.translationM[2] },
      end: { x: wall.transform.translationM[0] + oldLength / 2 + 1.5, y: wall.transform.translationM[2] },
      actor: 'reviewer',
    });
    expect(sceneWallLength(edited.scene, wallId)).toBeCloseTo(oldLength + 1);
    expect(edited.undoStack).toHaveLength(withDoor.undoStack.length + 1);
    const door = edited.scene.nodes.find((node) => node.id === 'door-main')!;
    expect(door.transform.translationM[0]).toBeCloseTo(originalDoorX + 0.5);
    expect(door.component?.properties.offset?.value).toBe(1);
    expect(saveAndRestoreScene(edited).scene).toEqual(edited.scene);
    const threeGroup = buildThreePlanGroup(edited.scene);
    expect(threeGroup.children.map((child) => child.name)).toEqual([wallId, 'door-main']);
    const wallMesh = threeGroup.getObjectByName(wallId)?.children[0] as import('three').Mesh;
    expect(wallMesh.geometry.attributes.position.count).toBeGreaterThan(24);
    expect(wallMesh.geometry.boundingBox).toBeNull();
    wallMesh.geometry.computeBoundingBox();
    expect(wallMesh.geometry.boundingBox?.max.x! - wallMesh.geometry.boundingBox?.min.x!).toBeCloseTo(oldLength + 1);
    const position = wallMesh.geometry.getAttribute('position');
    const openingX0 = -(oldLength + 1) / 2 + 1;
    let faceInsideOpening = false;
    for (let index = 0; index < position.count; index += 3) {
      if (index + 2 >= position.count) break;
      const vertices = [0, 1, 2].map((offset) => [position.getX(index + offset), position.getY(index + offset), position.getZ(index + offset)]);
      const onWallFace = vertices.every((vertex) => Math.abs(Math.abs(vertex[2]!) - 0.1) < 0.0001);
      if (!onWallFace) continue;
      const centerX = vertices.reduce((sum, vertex) => sum + vertex[0]!, 0) / 3;
      const centerY = vertices.reduce((sum, vertex) => sum + vertex[1]!, 0) / 3;
      if (centerX > openingX0 + 0.02 && centerX < openingX0 + 0.78 && centerY > 0.02 && centerY < 2.03) faceInsideOpening = true;
    }
    expect(faceInsideOpening).toBe(false);
    const removed = removeWallFromScene(edited, wallId);
    expect(removed.scene.nodes).toHaveLength(0);
    expect(withDoor.scene.nodes).toHaveLength(2);
    expect(() => editWallInScene(withDoor, wallId, { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } })).toThrow('excede a nova parede');
    expect(sceneWallLength(withDoor.scene, wallId)).toBe(oldLength);
    const undone = executeSceneCommand(edited, { type: 'Undo' }).transaction;
    expect(undone.scene.nodes).toEqual(withDoor.scene.nodes);
    expect(undone.scene.revision.number).toBeGreaterThan(edited.scene.revision.number);
    const redone = executeSceneCommand(undone, { type: 'Redo' }).transaction;
    expect(redone.scene.nodes).toEqual(edited.scene.nodes);
  });

  it('materializes confirmed image-derived regions as shared parametric walls and editable room polygons', () => {
    const candidates = [
      traceWallCandidate('top-left', { x: 10, y: 10 }, { x: 100, y: 10 }, 6),
      traceWallCandidate('top-right', { x: 100, y: 10 }, { x: 190, y: 10 }, 6),
      traceWallCandidate('bottom-left', { x: 10, y: 110 }, { x: 100, y: 110 }, 6),
      traceWallCandidate('bottom-right', { x: 100, y: 110 }, { x: 190, y: 110 }, 6),
      traceWallCandidate('left', { x: 10, y: 10 }, { x: 10, y: 110 }, 6),
      traceWallCandidate('partition', { x: 100, y: 10 }, { x: 100, y: 110 }, 6),
      traceWallCandidate('right', { x: 190, y: 10 }, { x: 190, y: 110 }, 6),
    ];
    const regions = detectOrthogonalRoomCandidates(candidates, { width: 220, height: 140 }, { snapTolerancePx: 3 });
    const scene = createPlanScene({
      sceneId: 'plan-two-rooms', title: 'Duas regiões propostas', image: { sha256: 'b'.repeat(64), width: 220, height: 140 },
      calibration: { pixelDistance: 180, realDistanceMetres: 9, evidence: 'Escala manualmente confirmada para o teste de integração.', actor: 'test-fixture' },
      confirmedCandidateIds: [], confirmedRegionIds: regions.map((region) => region.id), regions, candidates, wall: { heightM: 2.7, thicknessM: 0.12 }, recordedAt: '2026-10-31T00:00:00.000Z',
    });
    expect(scene.scene.nodes.filter((node) => node.component?.kind === 'room')).toHaveLength(2);
    expect(scene.scene.nodes.filter((node) => node.component?.kind === 'wall')).toHaveLength(7);
    expect(scene.scene.relations.filter((relation) => relation.kind === 'bounded_by')).toHaveLength(8);
    expect(scene.scene.nodes.filter((node) => node.component?.kind === 'room').every((node) => node.geometry?.kind === 'polygon' && node.geometry.provenance.validation === 'unreviewed')).toBe(true);
    const mesh = buildThreePlanGroup(scene.scene);
    expect(mesh.children.filter((node) => node.name.startsWith('room-'))).toHaveLength(2);
    expect(JSON.stringify(saveAndRestoreScene(scene).scene)).toBe(JSON.stringify(scene.scene));
    const wall = scene.scene.nodes.find((node) => node.component?.kind === 'wall')!;
    const room = scene.scene.nodes.find((node) => node.component?.kind === 'room')!;
    const beforeFloor = structuredClone(room.geometry);
    const angle = 2 * Math.atan2(wall.transform.rotation[1], wall.transform.rotation[3]);
    if (wall.geometry?.kind !== 'box') throw new Error('Parede da fixture deve ser uma caixa paramétrica.');
    const half = wall.geometry.sizeM[0] / 2;
    const dx = Math.cos(angle) * half; const dz = -Math.sin(angle) * half;
    const edited = editWallInScene(scene, wall.id, { start: { x: wall.transform.translationM[0] - dx, y: wall.transform.translationM[2] - dz }, end: { x: wall.transform.translationM[0] + dx + 0.15, y: wall.transform.translationM[2] + dz }, actor: 'test-fixture' });
    const updatedRoom = edited.scene.nodes.find((node) => node.id === room.id)!;
    expect(updatedRoom.geometry).not.toEqual(beforeFloor);
    expect(edited.undoStack).toHaveLength(scene.undoStack.length + 1);
    expect(executeSceneCommand(edited, { type: 'Undo' }).transaction.scene.nodes.find((node) => node.id === room.id)?.geometry).toEqual(beforeFloor);
    expect(executeSceneCommand(executeSceneCommand(edited, { type: 'Undo' }).transaction, { type: 'Redo' }).transaction.scene.nodes.find((node) => node.id === room.id)?.geometry).toEqual(updatedRoom.geometry);
  });
});
