import { describe, expect, it } from 'vitest';
import {
  buildPlanVectorModel, calibrateScale, candidateToWall, consolidateWallCandidates, countClosedCandidateContours, detectCandidateIntersections, detectOrthogonalRoomCandidates, detectWallCandidates, filterCandidatesForReview,
  mergeWallCandidates, splitWallCandidate, traceWallCandidate, type PixelRaster,
} from '../src/plan-reconstruction';
import { addOpeningToScene, createPlanScene, editOpeningInScene, editWallInScene, removeWallFromScene, saveAndRestoreScene, sceneMatchesPlanSource, sceneWallLength } from '../src/plan-scene';
import { buildThreePlanGroup } from '../src/plan-three-adapter';
import { createSceneTransaction, executeSceneCommand, spatialWorldPoseToLocal, spatialWorldTransform, validateSpatialScene } from '../src/spatial-scene';
import { Raycaster, Vector3 } from 'three';

function raster(width: number, height: number, rectangles: Array<[number, number, number, number]>): PixelRaster {
  const grayscale = new Uint8Array(width * height).fill(255);
  for (const [x0, y0, x1, y1] of rectangles) {
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) grayscale[y * width + x] = 0;
  }
  return { width, height, grayscale };
}

describe('plan reconstruction geometry', () => {
  it('creates and edits openings using world transforms when their support wall is under a translated and rotated parent', () => {
    const candidate = traceWallCandidate('hierarchical-wall', { x: 10, y: 20 }, { x: 110, y: 20 }, 4);
    const base = createPlanScene({
      sceneId: 'plan-hierarchy', title: 'Parent transform', image: { sha256: 'a'.repeat(64), width: 140, height: 100 },
      calibration: { pixelDistance: 100, realDistanceMetres: 5, evidence: 'explicit test reference', actor: 'fixture-user' },
      confirmedCandidateIds: [candidate.id], candidates: [candidate], wall: { heightM: 2.7, thicknessM: 0.15 },
    });
    const wallId = `wall-${candidate.id}`;
    const wall = structuredClone(base.scene.nodes.find((node) => node.id === wallId)!);
    const group = structuredClone(base.scene.nodes[0]!);
    group.id = 'group-rotated'; group.label = 'Grupo'; group.nodeType = 'group'; group.component = null; group.geometry = null;
    group.transform.translationM = [5, 0, 0]; group.transform.rotation = [0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)];
    wall.parentId = group.id;
    const transformed = createSceneTransaction({ ...base.scene, nodes: [group, wall] });
    const withOpening = addOpeningToScene(transformed, wallId, { id: 'door-world', kind: 'door', offsetM: 1, widthM: 0.8, heightM: 2, sillM: 0 });
    const door = withOpening.scene.nodes.find((node) => node.id === 'door-world')!;
    expect(door.transform.translationM[0]).toBeCloseTo(4);
    expect(door.transform.translationM[2]).toBeCloseTo(-1.9);
    const moved = editOpeningInScene(withOpening, 'door-world', { offsetM: 2, widthM: 0.8, heightM: 2, sillM: 0 });
    expect(moved.scene.nodes.find((node) => node.id === 'door-world')?.transform.translationM[2]).toBeCloseTo(-2.9);
    const nestedDoor = structuredClone(moved.scene.nodes.find((node) => node.id === 'door-world')!);
    const nestedPose = spatialWorldPoseToLocal(moved.scene.nodes, group.id, nestedDoor.transform.translationM, nestedDoor.transform.rotation);
    nestedDoor.parentId = group.id; nestedDoor.transform.translationM = nestedPose.translation; nestedDoor.transform.rotation = nestedPose.rotation;
    const nestedTransaction = createSceneTransaction({ ...moved.scene, nodes: moved.scene.nodes.map((node) => node.id === nestedDoor.id ? nestedDoor : node) });
    const editedWall = editWallInScene(nestedTransaction, wallId, { start: { x: 4, y: 0 }, end: { x: 4, y: -6 } });
    const editedNestedDoor = editedWall.scene.nodes.find((node) => node.id === nestedDoor.id)!;
    expect(editedNestedDoor.parentId).toBe(group.id);
    expect(spatialWorldTransform(editedWall.scene.nodes, nestedDoor.id)?.translation[2]).toBeCloseTo(-2.4);
    expect(() => validateSpatialScene(editedWall.scene)).not.toThrow();
  });

  it('binds raster scenes to image and document identity, not reusable candidate IDs', () => {
    const candidate = traceWallCandidate('line-0', { x: 10, y: 20 }, { x: 110, y: 20 }, 4);
    const scene = createPlanScene({
      sceneId: 'plan-source-check', title: 'source check',
      image: { sha256: 'a'.repeat(64), width: 140, height: 100 },
      technicalDocumentRef: { documentId: 'doc-a', sha256: 'b'.repeat(64) },
      calibration: { pixelDistance: 100, realDistanceMetres: 2, evidence: 'explicit test reference', actor: 'fixture-user' },
      confirmedCandidateIds: [candidate.id], candidates: [candidate], wall: { heightM: 2.7, thicknessM: 0.15 },
    });
    expect(sceneMatchesPlanSource(scene.scene, { sha256: 'a'.repeat(64) }, { documentId: 'doc-a', sha256: 'b'.repeat(64) })).toBe(true);
    expect(sceneMatchesPlanSource(scene.scene, { sha256: 'c'.repeat(64) }, { documentId: 'doc-a', sha256: 'b'.repeat(64) })).toBe(false);
    expect(sceneMatchesPlanSource(scene.scene, { sha256: 'a'.repeat(64) }, { documentId: 'doc-a', sha256: 'd'.repeat(64) })).toBe(false);
    expect(sceneMatchesPlanSource(scene.scene, { sha256: 'a'.repeat(64) })).toBe(false);
    expect(scene.scene.nodes.find((node) => node.id === 'wall-line-0')?.component?.properties.sourceCandidate?.value).toBe('line-0');
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

  it('reduces thin raster clutter for review without turning the remaining lines into confirmed walls', () => {
    const detected = [
      ...Array.from({ length: 8 }, (_, index) => ({ ...traceWallCandidate(`thick-${index}`, { x: 4, y: index * 8 }, { x: 84, y: index * 8 }, 4), origin: 'automatic_detection' as const })),
      ...Array.from({ length: 8 }, (_, index) => ({ ...traceWallCandidate(`thin-${index}`, { x: 4, y: 70 + index }, { x: 84, y: 70 + index }, 1), origin: 'automatic_detection' as const })),
    ];
    const filtered = filterCandidatesForReview(detected, { width: 160, height: 120 });
    expect(filtered.usedFallback).toBe(false);
    expect(filtered.omitted).toBeGreaterThan(0);
    expect(filtered.candidates.length).toBeLessThan(detected.length);
    expect(filtered.candidates.every((candidate) => candidate.origin === 'automatic_detection')).toBe(true);
    expect(filtered.candidates.every((candidate) => Math.hypot(candidate.end.x - candidate.start.x, candidate.end.y - candidate.start.y) >= filtered.minimumLengthPx && candidate.thicknessPx >= filtered.minimumThicknessPx)).toBe(true);
  });

  it('keeps all raw candidates when thickness/length filtering would leave insufficient evidence', () => {
    const detected = detectWallCandidates(raster(100, 80, [[10, 20, 75, 20]]), { minimumLengthPx: 20 });
    const filtered = filterCandidatesForReview(detected, { width: 100, height: 80 });
    expect(filtered.usedFallback).toBe(true);
    expect(filtered.omitted).toBe(0);
    expect(filtered.candidates).toEqual(detected);
  });

  it('preserves manual provenance when a reviewed trace consolidates with automatic raster support', () => {
    const automatic = { ...traceWallCandidate('auto-edge', { x: 10, y: 20 }, { x: 90, y: 20 }, 5), origin: 'automatic_detection' as const };
    const manual = { ...traceWallCandidate('manual-edge', { x: 12, y: 21 }, { x: 88, y: 21 }, 6), origin: 'manual_trace' as const };
    const [combined] = consolidateWallCandidates([automatic, manual], 3);
    expect(combined?.origin).toBe('manual_trace');
    expect(combined?.sourceCandidateIds).toContain('auto-edge');
    expect(combined?.sourceCandidateIds).toContain('manual-edge');
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
    const confirmedScene = structuredClone(withDoor.scene);
    const confirmedOpening = confirmedScene.nodes.find((node) => node.id === 'door-main')!;
    const confirmed = { source: 'user' as const, validation: 'verified' as const, actor: 'reviewer', evidence: 'Inspeccionado pelo utilizador.', recordedAt: '2026-10-31T00:02:00.000Z' };
    confirmedOpening.geometry!.provenance = confirmed;
    confirmedOpening.transform.provenance.translationM = confirmed;
    confirmedOpening.transform.provenance.rotation = confirmed;
    for (const property of Object.values(confirmedOpening.component!.properties)) property.provenance = confirmed;
    const verifiedDoorTransaction = createSceneTransaction(confirmedScene);
    expect(() => editOpeningInScene(verifiedDoorTransaction, 'door-main', { offsetM: 1, widthM: 0.9, heightM: 2.05, sillM: 0 })).toThrow('REQUIRES_ACKNOWLEDGEMENT');
    const acknowledgedOpening = editOpeningInScene(verifiedDoorTransaction, 'door-main', { offsetM: 1, widthM: 0.9, heightM: 2.05, sillM: 0, acknowledgeVerifiedChange: true, actor: 'reviewer' });
    expect(acknowledgedOpening.scene.nodes.find((node) => node.id === 'door-main')?.component?.properties.width?.provenance).toMatchObject({ validation: 'corrected', sourceValue: 0.8, actor: 'reviewer' });
    expect(acknowledgedOpening.scene.nodes.find((node) => node.id === 'door-main')?.component?.properties.height?.provenance).toEqual(confirmed);
    expect(acknowledgedOpening.scene.nodes.find((node) => node.id === 'door-main')?.transform.provenance.rotation).toEqual(confirmed);
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
    const confirmedSource = structuredClone(withDoor.scene);
    const confirmedWall = confirmedSource.nodes.find((node) => node.id === wallId)!;
    confirmedWall.component!.properties.length!.provenance = { source: 'user', validation: 'verified', actor: 'reviewer', evidence: 'Comprimento confirmado manualmente.', recordedAt: '2026-10-31T00:02:00.000Z' };
    const confirmedDoor = confirmedSource.nodes.find((node) => node.id === 'door-main')!;
    confirmedDoor.transform.provenance.translationM = { source: 'user', validation: 'verified', actor: 'reviewer', evidence: 'Posição confirmada manualmente.', recordedAt: '2026-10-31T00:02:00.000Z' };
    const confirmedTransaction = createSceneTransaction(confirmedSource);
    expect(() => editWallInScene(confirmedTransaction, wallId, { start: { x: start.x + 0.5, y: start.y }, end })).toThrow('CONFIRMED_WALL_CHANGE_REQUIRES_ACKNOWLEDGEMENT');
    const acknowledged = editWallInScene(confirmedTransaction, wallId, { start: { x: start.x + 0.5, y: start.y }, end, acknowledgeVerifiedChange: true, actor: 'reviewer' });
    const acknowledgedWall = acknowledged.scene.nodes.find((node) => node.id === wallId)!;
    expect(acknowledgedWall.component!.properties.length!.provenance).toMatchObject({ validation: 'corrected', sourceValue: oldLength, actor: 'reviewer' });
    expect(acknowledgedWall.component!.properties.height!.provenance.validation).toBe('unreviewed');
    const acknowledgedDoor = acknowledged.scene.nodes.find((node) => node.id === 'door-main')!;
    expect(acknowledgedDoor.transform.provenance.translationM).toMatchObject({ validation: 'corrected', sourceValue: withDoor.scene.nodes.find((node) => node.id === 'door-main')!.transform.translationM });
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

  it('rejects room polygons with incomplete bindings or zero planar area', () => {
    const points = [[10, 10], [110, 10], [110, 90], [10, 90]] as const;
    const candidates = points.map((point, index) => traceWallCandidate(
      'edge-' + index,
      { x: point[0], y: point[1] },
      { x: points[(index + 1) % points.length]![0], y: points[(index + 1) % points.length]![1] },
      6,
    ));
    const region = {
      id: 'room-rect', boundaryCandidateIds: candidates.map((candidate) => candidate.id),
      vertices: points.map(([x, y]) => ({ x, y })), areaPx2: 8000, validation: 'unreviewed' as const,
      eligibility: 'construction_candidate' as const, confidence: 0.9, evidence: ['ciclo fechado'],
      topologyMethod: 'closed_segment_graph' as const,
    };
    const transaction = createPlanScene({
      sceneId: 'plan-topology', title: 'Room topology', image: { sha256: 'b'.repeat(64), width: 140, height: 100 },
      calibration: { pixelDistance: 100, realDistanceMetres: 5, evidence: 'fixture de calibração', actor: 'test-fixture' },
      confirmedCandidateIds: [], confirmedRegionIds: [region.id], regions: [region], candidates,
      wall: { heightM: 2.7, thicknessM: 0.15 },
    });
    const room = transaction.scene.nodes.find((node) => node.component?.kind === 'room')!;
    expect(room.component?.dependsOn).toHaveLength(4);
    expect(validateSpatialScene(transaction.scene)).toEqual(transaction.scene);
    const displacedRoom = structuredClone(transaction.scene);
    displacedRoom.nodes.find((node) => node.id === room.id)!.transform.translationM = [3, 0, 0];
    expect(() => validateSpatialScene(displacedRoom)).toThrow('SCENE_ROOM_BOUNDARY_STALE');
    const incomplete = structuredClone(transaction.scene);
    const incompleteRoom = incomplete.nodes.find((node) => node.id === room.id)!;
    const refs = JSON.parse(String(incompleteRoom.component!.properties.boundaryRefs!.value)) as Array<{ wallId: string }>;
    incompleteRoom.component!.properties.boundaryRefs!.value = JSON.stringify(refs.slice(1));
    expect(() => validateSpatialScene(incomplete)).toThrow('SCENE_ROOM_BOUNDARY_BINDINGS_INCOMPLETE');
    const degenerate = structuredClone(transaction.scene);
    const degenerateRoom = degenerate.nodes.find((node) => node.id === room.id)!;
    if (degenerateRoom.geometry?.kind !== 'polygon') throw new Error('Room polygon expected.');
    degenerateRoom.geometry.verticesM = degenerateRoom.geometry.verticesM.map((_, index) => [index, 0, 0]);
    expect(() => validateSpatialScene(degenerate)).toThrow('SCENE_ROOM_POLYGON_DEGENERATE');
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
    const attempted = { start: { x: wall.transform.translationM[0] - dx, y: wall.transform.translationM[2] - dz }, end: { x: wall.transform.translationM[0] + dx + 0.15, y: wall.transform.translationM[2] + dz } };
    expect(() => editWallInScene(scene, wall.id, { ...attempted, actor: 'test-fixture' })).toThrow('SCENE_ROOM_BOUNDARY_STALE');
    expect(scene.scene.nodes.find((node) => node.id === room.id)?.geometry).toEqual(beforeFloor);
    expect(scene.scene.revision.number).toBe(0);

    const constrainedScene = validateSpatialScene({
      ...scene.scene,
      constraints: [{ id: 'room-wall-alignment', kind: 'custom', nodeIds: [wall.id, room.id], value: null, unit: null, provenance: room.geometry!.provenance }],
    });
    const constrainedTransaction = createSceneTransaction(constrainedScene);
    expect(() => editWallInScene(constrainedTransaction, wall.id, { ...attempted, actor: 'test-fixture' })).toThrow('GEOMETRIC_CONSTRAINT_REQUIRES_SOLVER:room-wall-alignment');
    expect(constrainedTransaction.scene.nodes.find((node) => node.id === wall.id)?.geometry).toEqual(wall.geometry);
    expect(constrainedTransaction.scene.nodes.find((node) => node.id === room.id)?.geometry).toEqual(beforeFloor);
    expect(constrainedTransaction.scene.revision.number).toBe(0);
  });

  it('stores only a user-confirmed visual grounding label on a matching raster-derived room', () => {
    const points = [[10, 10], [110, 10], [110, 90], [10, 90]] as const;
    const candidates = points.map((point, index) => traceWallCandidate(
      `ground-edge-${index}`,
      { x: point[0], y: point[1] },
      { x: points[(index + 1) % points.length]![0], y: points[(index + 1) % points.length]![1] },
      6,
    ));
    const region = { id: 'room-grounded', boundaryCandidateIds: candidates.map((item) => item.id), vertices: points.map(([x, y]) => ({ x, y })), areaPx2: 8000, validation: 'unreviewed' as const, eligibility: 'construction_candidate' as const, confidence: 0.8, evidence: ['closed local region'], topologyMethod: 'closed_segment_graph' as const };
    const options = {
      sceneId: 'plan-grounded-room', title: 'Grounded room', image: { sha256: 'c'.repeat(64), width: 140, height: 100 },
      calibration: { pixelDistance: 100, realDistanceMetres: 5, evidence: 'user reference', actor: 'reviewer' },
      confirmedCandidateIds: [], confirmedRegionIds: [region.id], regions: [region], candidates, wall: { heightM: 2.7, thicknessM: 0.15 },
    };
    expect(() => createPlanScene({ ...options, regionGroundingLinks: [{ regionId: region.id, elementId: 'visual-kitchen', label: 'Cozinha', sourceImageSha256: 'd'.repeat(64), confidence: 0.8, reviewMethod: 'automatic' }] })).toThrow('não corresponde à imagem');
    expect(() => createPlanScene({ ...options, regionGroundingLinks: [{ regionId: region.id, elementId: 'visual-kitchen', label: 'Cozinha', sourceImageSha256: 'c'.repeat(64), confidence: 0.4, reviewMethod: 'automatic' }] })).toThrow('limiar');
    const scene = createPlanScene({ ...options, regionGroundingLinks: [{ regionId: region.id, elementId: 'visual-kitchen', label: 'Cozinha', sourceImageSha256: 'c'.repeat(64), confidence: 0.4, reviewMethod: 'manual' }] });
    const room = scene.scene.nodes.find((node) => node.id === region.id)!;
    expect(room.label).toBe('Cozinha');
    expect(room.component?.properties.visualGroundingElementId).toMatchObject({ value: 'visual-kitchen', provenance: { source: 'user', validation: 'verified', actor: 'reviewer' } });
    expect(room.component?.properties.visualGroundingImageSha256?.value).toBe('c'.repeat(64));
    expect(validateSpatialScene(scene.scene)).toEqual(scene.scene);
  });
});
