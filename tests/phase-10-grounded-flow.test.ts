import { describe, expect, it } from 'vitest';
import { buildPlanVectorModel, detectWallCandidates, type PixelRaster } from '../src/plan-reconstruction';
import { createPlanScene, sceneWallLength } from '../src/plan-scene';
import { commitScenePreview, createSceneTransaction, previewSceneCommand } from '../src/spatial-scene';
import {
  acceptSemanticLink, answerGroundedQuery, createSemanticSpatialMap, describeSemanticProposal,
  proposeSemanticLink, resolveSemanticSceneLinks, selectWellDefinedRegionIds,
} from '../src/semantic-spatial-map';
import { makeDocument, makeRegion } from './semantic-spatial-map.test';

const SHA = 'b'.repeat(64);

function syntheticPlanRaster(): PixelRaster {
  const width = 220; const height = 160;
  const grayscale = new Uint8Array(width * height).fill(255);
  const rect = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) grayscale[y * width + x] = 0;
  };
  // Outer rectangle + one partition: two closed rooms, purely synthetic fixture.
  rect(20, 20, 200, 25); rect(20, 134, 200, 139); rect(20, 20, 25, 139); rect(195, 20, 200, 139); rect(107, 20, 112, 139);
  return { width, height, grayscale };
}

describe('Phase 10 grounded E2E (offline, synthetic image, no Meta credentials)', () => {
  it('image → regions → semantic association → scene → alteration → confirmation → undo', () => {
    // 1. Synthetic image → candidates → regions
    const raster = syntheticPlanRaster();
    const candidates = detectWallCandidates(raster, { minimumLengthPx: 30 });
    expect(candidates.length).toBeGreaterThanOrEqual(4);
    const model = buildPlanVectorModel(candidates, { tolerancePx: 6, imageSize: { width: raster.width, height: raster.height } });
    expect(model.regions.length).toBeGreaterThanOrEqual(1);
    const wellDefined = selectWellDefinedRegionIds(model.regions, 0.5);
    expect(wellDefined.length).toBeGreaterThanOrEqual(1);

    // Use a deterministic region fixture boundary referencing detected candidates is
    // exercised in unit tests; here the region from the real detector is proposed.
    const region = model.regions.find((item) => item.id === wellDefined[0]) ?? makeRegion(model.regions[0]!.id);
    const document = makeDocument();
    let map = createSemanticSpatialMap(document, 'doc-0123456789abcdef0123', SHA);

    // 2. Semantic association: proposal shown before acceptance
    map = proposeSemanticLink(map, document, region, 'el-kitchen', { documentId: map.documentId, imageSha256: map.sourceImageSha256 });
    const proposalId = map.links[0]!.id;
    expect(describeSemanticProposal(map, proposalId)).toContain('Cozinha');
    expect(map.links[0]?.review.state).toBe('proposed');
    map = acceptSemanticLink(map, proposalId, 'e2e-tester', { document, currentRegion: region, source: { documentId: map.documentId, imageSha256: map.sourceImageSha256 } });
    expect(map.links[0]?.review.state).toBe('accepted');

    // 3. Scene built from the validated graph: explicit scale, height, thickness
    let transaction = createPlanScene({
      sceneId: 'plan-phase10-e2e', title: 'Phase 10 synthetic plan',
      image: { sha256: SHA, width: raster.width, height: raster.height },
      technicalDocumentRef: { documentId: 'doc-0123456789abcdef0123', sha256: SHA },
      calibration: { pixelDistance: 180, realDistanceMetres: 9, evidence: 'synthetic fixture: outer wall spans 180 px = 9 m', actor: 'e2e-tester' },
      confirmedCandidateIds: [],
      confirmedRegionIds: [region.id],
      regions: model.regions,
      candidates,
      wall: { heightM: 2.7, thicknessM: 0.15 },
      regionSemanticLinks: [{ regionId: region.id, elementId: 'el-kitchen', label: 'Cozinha' }],
    });
    const room = transaction.scene.nodes.find((node) => node.id === region.id);
    expect(room?.label).toBe('Cozinha');
    expect(room?.component?.properties.semanticElementId?.value).toBe('el-kitchen');
    expect(room?.component?.properties.semanticElementId?.provenance.source).toBe('technical_document');

    map = resolveSemanticSceneLinks(map, transaction.scene);
    expect(map.links[0]?.sceneNodeIds).toContain(region.id);
    expect(map.links[0]!.sceneNodeIds.length).toBeGreaterThan(1); // room + boundary walls

    // 4. Grounded conversation over document + scene + selection
    const identified = answerGroundedQuery('O que identificaste neste projecto?', { document, map, scene: transaction.scene, selectedId: null, undoDepth: 0, redoDepth: 0 });
    expect(identified?.kind).toBe('ANSWER');
    expect(identified?.kind === 'ANSWER' && identified.text).toContain('Cozinha');
    const focus = answerGroundedQuery('Mostra-me a cozinha.', { document, map, scene: transaction.scene, selectedId: null, undoDepth: 0, redoDepth: 0 });
    expect(focus).toMatchObject({ kind: 'FOCUS', nodeId: region.id });

    const wall = transaction.scene.nodes.find((node) => node.component?.kind === 'wall')!;
    const originalLength = sceneWallLength(transaction.scene, wall.id);
    const dimension = answerGroundedQuery('Qual é a dimensão desta parede?', { document, map, scene: transaction.scene, selectedId: wall.id, undoDepth: 0, redoDepth: 0 });
    expect(dimension?.kind === 'ANSWER' && dimension.text).toContain(originalLength.toFixed(2));

    // 5. Alteration (+50 cm) via deterministic executor: preview does not mutate
    const scaleX = (originalLength + 0.5) / originalLength;
    const unsafePreview = previewSceneCommand(transaction, { type: 'ResizeComponent', nodeId: wall.id, scale: [scaleX, 1, 1] }, 'e2e-tester');
    expect(unsafePreview.status).toBe('blocked');
    expect(unsafePreview.issues[0]?.code).toMatch(/^GEOMETRIC_RELATION_REQUIRES_SUPPORTED_EDIT:/);
    expect(sceneWallLength(transaction.scene, wall.id)).toBeCloseTo(originalLength);
    // The same transform is a valid edit only after removing the spatially dependent room model;
    // this verifies the executor while retaining the stricter rejection above.
    const standalone = createSceneTransaction({ ...transaction.scene, nodes: transaction.scene.nodes.filter((node) => node.component?.kind !== 'room'), relations: transaction.scene.relations.filter((relation) => transaction.scene.nodes.some((node) => node.component?.kind !== 'room' && node.id === relation.fromNodeId) && transaction.scene.nodes.some((node) => node.component?.kind !== 'room' && node.id === relation.toNodeId)) });
    const preview = previewSceneCommand(standalone, { type: 'ResizeComponent', nodeId: wall.id, scale: [scaleX, 1, 1] }, 'e2e-tester');
    expect(preview.status).toBe('ready');
    expect(sceneWallLength(standalone.scene, wall.id)).toBeCloseTo(originalLength); // no early mutation
    transaction = commitScenePreview(standalone, preview);
    expect(sceneWallLength(transaction.scene, wall.id)).toBeGreaterThan(originalLength);

    const changed = answerGroundedQuery('O que mudou?', { document, map, scene: transaction.scene, selectedId: wall.id, undoDepth: transaction.undoStack.length, redoDepth: transaction.redoStack.length });
    expect(changed?.kind === 'ANSWER' && changed.text).toContain('Revisão actual 1');

    // 6. Undo restores the original length
    const undoPreview = previewSceneCommand(transaction, { type: 'Undo' }, 'e2e-tester');
    expect(undoPreview.status).toBe('ready');
    transaction = commitScenePreview(transaction, undoPreview);
    expect(sceneWallLength(transaction.scene, wall.id)).toBeCloseTo(originalLength);
    const undone = answerGroundedQuery('O que mudou?', { document, map, scene: transaction.scene, selectedId: wall.id, undoDepth: transaction.undoStack.length, redoDepth: transaction.redoStack.length });
    expect(undone?.kind === 'ANSWER' && undone.text).toContain('A última alteração foi desfeita');
  });
});
