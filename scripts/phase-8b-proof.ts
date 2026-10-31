import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { detectCandidateIntersections, detectWallCandidates, type PixelRaster } from '../src/plan-reconstruction';
import { addOpeningToScene, createPlanScene, editWallInScene, saveAndRestoreScene, sceneWallLength } from '../src/plan-scene';
import { buildThreePlanGroup } from '../src/plan-three-adapter';

const width = 180;
const height = 120;
const grayscale = new Uint8Array(width * height).fill(255);
const fill = (x0: number, y0: number, x1: number, y1: number) => {
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) grayscale[y * width + x] = 0;
};
fill(20, 20, 150, 24);
fill(20, 90, 150, 94);
fill(20, 20, 24, 94);
fill(146, 20, 150, 94);
const raster: PixelRaster = { width, height, grayscale };
const candidates = detectWallCandidates(raster, { minimumLengthPx: 30 });
const intersections = detectCandidateIntersections(candidates);
const topWall = candidates.find((candidate) => candidate.orientation === 'horizontal' && candidate.start.y <= 24 && candidate.end.x - candidate.start.x > 100);
const leftWall = candidates.find((candidate) => candidate.orientation === 'vertical' && candidate.start.x <= 24 && candidate.end.y - candidate.start.y > 60);
if (!topWall || !leftWall || intersections.length < 4) throw new Error('A detecção de referência não encontrou a estrutura ortogonal esperada.');

const timestamp = '2026-10-31T00:00:00.000Z';
const initial = createPlanScene({
  sceneId: 'phase-8b-proof',
  title: 'Reconstituição paramétrica de planta de referência',
  image: { sha256: createHash('sha256').update(grayscale).digest('hex'), width, height },
  calibration: { pixelDistance: 130, realDistanceMetres: 10, evidence: 'Fixture de verificação: 130 px correspondem a 10 m, confirmação explícita do operador.', actor: 'phase-8b-proof' },
  confirmedCandidateIds: [topWall.id, leftWall.id],
  candidates,
  wall: { heightM: 2.8, thicknessM: 0.2 },
  recordedAt: timestamp,
});
const topId = `wall-${topWall.id}`;
const withDoor = addOpeningToScene(initial, topId, { id: 'proof-door', kind: 'door', offsetM: 2, widthM: 0.9, heightM: 2.1, sillM: 0 }, timestamp);
const oldLength = sceneWallLength(withDoor.scene, topId);
const oldWall = withDoor.scene.nodes.find((node) => node.id === topId)!;
const oldDoor = withDoor.scene.nodes.find((node) => node.id === 'proof-door')!;
const shiftedStart = { x: oldWall.transform.translationM[0] + 0.25 - oldLength / 2, y: oldWall.transform.translationM[2] + 0.5 };
const shiftedEnd = { x: oldWall.transform.translationM[0] + 0.25 + oldLength / 2 + 1, y: oldWall.transform.translationM[2] + 0.5 };
const edited = editWallInScene(withDoor, topId, { start: shiftedStart, end: shiftedEnd, actor: 'phase-8b-proof' });
const newLength = sceneWallLength(edited.scene, topId);
const newDoor = edited.scene.nodes.find((node) => node.id === 'proof-door')!;
const restored = saveAndRestoreScene(edited);
const group = buildThreePlanGroup(restored.scene);
const renderedWall = group.getObjectByName(topId) as import('three').Mesh | undefined;
if (!renderedWall) throw new Error('O adaptador Three.js não gerou a parede seleccionada.');
renderedWall.geometry.computeBoundingBox();
const bounds = renderedWall.geometry.boundingBox!;

const evidence = {
  schema: 'unfold_phase_8b_geometry_evidence.v1',
  source: { kind: 'generated_grayscale_raster_fixture', width, height, sha256: createHash('sha256').update(grayscale).digest('hex') },
  detection: { candidateCount: candidates.length, confirmedWallIds: [topWall.id, leftWall.id], intersections: intersections.length },
  calibration: { pixelsPerMetre: 13, evidence: '130 px = 10 m, explicitly confirmed by the fixture operator.' },
  transformation: {
    wallId: topId,
    originalLengthM: oldLength,
    finalLengthM: newLength,
    lengthDeltaM: newLength - oldLength,
    originalPositionM: oldWall.transform.translationM,
    finalPositionM: edited.scene.nodes.find((node) => node.id === topId)!.transform.translationM,
    openingOffsetMBefore: oldDoor.component?.properties.offset?.value,
    openingOffsetMAfter: newDoor.component?.properties.offset?.value,
    openingWorldTranslationMBefore: oldDoor.transform.translationM,
    openingWorldTranslationMAfter: newDoor.transform.translationM,
  },
  threeJs: { componentMeshes: group.children.length, wallBoundsLocalM: { min: bounds.min.toArray(), max: bounds.max.toArray() } },
  persistence: { schema: restored.scene.schema, revision: restored.scene.revision.number, exactSceneRoundTrip: JSON.stringify(restored.scene) === JSON.stringify(edited.scene) },
  limits: ['Raster fixture is generated, not a photographed or scanned residential plan.', 'Human confirmation is simulated by the named local proof operator.', 'No frontend upload workflow or structural validation is claimed.'],
};
const output = resolve('reports/phase-8b/evidence/geometry-transform.json');
mkdirSync(resolve('reports/phase-8b/evidence'), { recursive: true });
writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'w', mode: 0o600 });
process.stdout.write(`${JSON.stringify({ output, lengthDeltaM: evidence.transformation.lengthDeltaM, exactSceneRoundTrip: evidence.persistence.exactSceneRoundTrip })}\n`);
