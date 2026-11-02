import { buildPlanVectorModel, type PixelWallCandidate } from '../plan-reconstruction';
import { addOpeningToScene, createPlanScene } from '../plan-scene';
import type { SceneTransaction, SpatialSceneV1 } from '../spatial-scene';

/**
 * Deterministic architectural scenes for rendering tests and benchmarks. They are built with the product's own functions
 * (createPlanScene / addOpeningToScene) from fixed input and a fixed clock, so they are real scene-engine output, not hand-made objects.
 * One pixel is one centimetre. Every wall is 0.20 m thick and 2.70 m high.
 */

const AT = '2026-11-02T09:00:00.000Z';
const line = (id: string, x1: number, y1: number, x2: number, y2: number): PixelWallCandidate => ({
  id, orientation: y1 === y2 ? 'horizontal' : 'vertical', start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thicknessPx: 20, confidence: 1, origin: 'automatic_detection',
});

function plan(width: number, height: number, lines: PixelWallCandidate[]): SceneTransaction {
  const model = buildPlanVectorModel(lines, { tolerancePx: 6, imageSize: { width, height }, scale: { pixelsPerMetre: 100, source: 'known_measurement' } });
  const regions = model.regions.filter((region) => region.eligibility === 'construction_candidate' && region.id.startsWith('region-'));
  return createPlanScene({
    sceneId: 'fixture', title: 'Fixture', image: { sha256: 'f'.repeat(64), width, height },
    calibration: { pixelDistance: 100, realDistanceMetres: 1, evidence: 'Fixture determinística: 100 px = 1 m.', actor: 'fixture' },
    confirmedCandidateIds: [], confirmedRegionIds: regions.map((region) => region.id), candidates: lines, regions: model.regions,
    wall: { heightM: 2.7, thicknessM: 0.2 }, recordedAt: AT,
  });
}

const wallId = (x1: number, y1: number, x2: number, y2: number) => `wall-edge-${x1}-${y1}-${x2}-${y2}`;

/**
 * Adds an opening to the wall between two plan points, offset measured from (x1, y1). The scene engine names a wall edge after the direction
 * it was traversed in, so the wall may exist as A-B or B-A; the offset is mirrored when it is B-A so the opening lands in the same place.
 */
function opening(t: SceneTransaction, from: [number, number], to: [number, number], id: string, kind: 'door' | 'window', offsetM: number, widthM: number, heightM: number, sillM: number): SceneTransaction {
  const forward = wallId(from[0], from[1], to[0], to[1]); const backward = wallId(to[0], to[1], from[0], from[1]);
  const lengthM = Math.hypot(to[0] - from[0], to[1] - from[1]) / 100;
  const has = (wall: string) => t.scene.nodes.some((n) => n.id === wall);
  if (has(forward)) return addOpeningToScene(t, forward, { id, kind, offsetM, widthM, heightM, sillM, actor: 'fixture' }, AT);
  if (has(backward)) return addOpeningToScene(t, backward, { id, kind, offsetM: lengthM - offsetM - widthM, widthM, heightM, sillM, actor: 'fixture' }, AT);
  throw new Error(`fixture wall ${forward} not found; walls: ${t.scene.nodes.filter((n) => n.component?.kind === 'wall').map((n) => n.id).join(', ')}`);
}

/** Marks every wall and room as human-confirmed. The fixtures are plain data; this only sets provenance on a fresh copy. */
function confirmed(scene: SpatialSceneV1): SpatialSceneV1 {
  const next = structuredClone(scene);
  next.revision.createdAt = AT; // the engine stamps wall-clock time here; a fixed value keeps the fixture byte-for-byte reproducible
  for (const node of next.nodes) if (node.geometry) node.geometry.provenance = { ...node.geometry.provenance, source: 'user', validation: 'verified', actor: 'fixture' };
  return next;
}

/** 1. Two rooms (8 m x 4 m), a door in the partition, a window and an entrance door. */
export function fixtureTwoRooms(): SpatialSceneV1 {
  let t = plan(800, 400, [line('t', 0, 0, 800, 0), line('r', 800, 0, 800, 400), line('b', 800, 400, 0, 400), line('l', 0, 400, 0, 0), line('p', 400, 0, 400, 400)]);
  t = opening(t, [0, 0], [400, 0], 'win-1', 'window', 1.4, 1.2, 1.2, 0.9);
  t = opening(t, [400, 0], [400, 400], 'door-1', 'door', 1.4, 0.9, 2.1, 0);
  t = opening(t, [400, 400], [800, 400], 'door-2', 'door', 1.1, 0.9, 2.1, 0);
  return confirmed(t.scene);
}

/** 2. Five rooms (12 m x 8 m) with T-junctions, three doors and four windows. */
export function fixtureMultiRoom(): SpatialSceneV1 {
  let t = plan(1200, 800, [
    line('t', 0, 0, 1200, 0), line('r', 1200, 0, 1200, 800), line('b', 1200, 800, 0, 800), line('l', 0, 800, 0, 0),
    line('v1', 500, 0, 500, 800), line('h1', 0, 250, 500, 250), line('h2', 500, 400, 1200, 400), line('v2', 900, 400, 900, 800),
  ]);
  t = opening(t, [0, 0], [500, 0], 'win-1', 'window', 1.8, 1.4, 1.2, 0.9);
  t = opening(t, [500, 0], [1200, 0], 'win-2', 'window', 1.5, 1.2, 1.2, 0.9);
  t = opening(t, [500, 0], [1200, 0], 'win-3', 'window', 4.4, 1.2, 1.2, 0.9);
  t = opening(t, [1200, 0], [1200, 400], 'win-4', 'window', 1.4, 1.2, 1.2, 0.9);
  t = opening(t, [500, 0], [500, 250], 'door-1', 'door', 1.0, 0.9, 2.1, 0);
  t = opening(t, [500, 250], [500, 400], 'door-2', 'door', 0.3, 0.9, 2.1, 0);
  t = opening(t, [500, 800], [900, 800], 'door-3', 'door', 1.6, 0.9, 2.1, 0);
  return confirmed(t.scene);
}

/** 3. The two-room scene where one wall is unreviewed and one is ambiguous; everything else stays confirmed. */
export function fixtureProvisional(): SpatialSceneV1 {
  const scene = structuredClone(fixtureTwoRooms());
  const set = (id: string, validation: 'unreviewed' | 'ambiguous') => {
    const node = scene.nodes.find((n) => n.id === id);
    if (!node?.geometry) throw new Error(`fixture node ${id} missing`);
    node.geometry.provenance = { ...node.geometry.provenance, source: 'derived', validation, actor: 'fixture' };
  };
  set(wallId(400, 400, 800, 400), 'unreviewed');
  set(wallId(400, 0, 400, 400), 'ambiguous');
  return scene;
}

export const FIXTURES = [
  { id: 'two-rooms', title: 'Two rooms with openings', build: fixtureTwoRooms },
  { id: 'multi-room', title: 'Five rooms, T-junctions, doors and windows', build: fixtureMultiRoom },
  { id: 'provisional', title: 'Two rooms, one unreviewed and one ambiguous wall', build: fixtureProvisional },
] as const;
