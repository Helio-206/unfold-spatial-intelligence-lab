import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { AuthorizationLedger } from '../src/core';
import { commitScenePreview, conversationEditToSceneCommand, createSceneTransaction, deserializeSceneTransaction, deserializeSpatialScene, executeSceneCommand, previewSceneCommand, serializeSceneTransaction, serializeSpatialScene, validateSpatialScene, type SpatialSceneV1 } from '../src/spatial-scene';

const provenance = { source: 'user' as const, validation: 'unreviewed' as const, recordedAt: '2026-01-01T00:00:00.000Z' };
const property = (value: number, validation: 'unreviewed' | 'verified' = 'unreviewed') => ({ value, unit: 'mm', provenance: { ...provenance, validation, ...(validation === 'verified' ? { actor: 'fixture reviewer', evidence: 'Fixture explícita de teste.' } : {}) } });
const makeScene = (): SpatialSceneV1 => validateSpatialScene({
  schema: 'spatial_scene.v1', id: 'scene-main', title: 'Cena de teste',
  coordinateSystem: { handedness: 'right', upAxis: 'Y', horizontalPlane: ['X', 'Z'], unit: 'm' },
  sourceDocuments: [{ documentId: 'plan-1', schema: 'technical_document.v1', sha256: 'a'.repeat(64), immutable: true }],
  imageWorldMapping: null,
  nodes: [
    { id: 'wall-a', label: 'Parede A', nodeType: 'component', parentId: null, transform: { translationM: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], provenance: { translationM: provenance, rotation: provenance, scale: provenance } }, geometry: { kind: 'segment', lengthM: 2, radiusM: 0.05, provenance }, component: { kind: 'wall', properties: { thickness: property(100) }, dependsOn: [] }, properties: {} },
    { id: 'annotation-a', label: 'Texto', nodeType: 'annotation', parentId: null, transform: { translationM: [0, 1, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], provenance: { translationM: provenance, rotation: provenance, scale: provenance } }, geometry: null, component: null, properties: {} },
  ], relations: [], constraints: [], revision: { id: 'scene-main:r0', number: 0, parentId: null, operationId: null, createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'fixture' },
});

describe('spatial_scene.v1 contract', () => {
  it('round-trips validated scenes and retains explicit SI frame and immutable source reference', () => {
    const scene = makeScene();
    expect(deserializeSpatialScene(serializeSpatialScene(scene))).toEqual(scene);
    expect(scene.coordinateSystem).toMatchObject({ handedness: 'right', upAxis: 'Y', unit: 'm' });
    expect(scene.sourceDocuments[0]?.immutable).toBe(true);
    expect(scene.imageWorldMapping).toBeNull();
    const transaction = executeSceneCommand(createSceneTransaction(scene), { type: 'MoveComponent', nodeId: 'wall-a', translationM: [1, 0, 0] }).transaction;
    expect(deserializeSceneTransaction(serializeSceneTransaction(transaction))).toEqual(transaction);
    expect(deserializeSpatialScene(readFileSync(new URL('../reports/phase-8a/fixtures/spatial_scene.v1.example.json', import.meta.url), 'utf8')).schema).toBe('spatial_scene.v1');
  });

  it('rejects invalid node IDs, dangling references, non-normalized rotations and invented mapping values', () => {
    const scene = makeScene();
    expect(() => validateSpatialScene({ ...scene, nodes: [...scene.nodes, scene.nodes[0]] })).toThrow('SCENE_NODE_INVALID_OR_DUPLICATE');
    expect(() => validateSpatialScene({ ...scene, nodes: scene.nodes.map((node, index) => index === 0 ? { ...node, component: { ...node.component!, dependsOn: ['missing'] } } : node) })).toThrow('SCENE_NODE_REFERENCE_INVALID');
    expect(() => validateSpatialScene({ ...scene, nodes: scene.nodes.map((node, index) => index === 0 ? { ...node, transform: { ...node.transform, rotation: [0, 0, 0, 2] } } : node) })).toThrow('SCENE_NODE_INVALID_OR_DUPLICATE');
    expect(() => validateSpatialScene({ ...scene, imageWorldMapping: { sourceImageSha256: 'b'.repeat(64), imageSizePx: { width: 1000, height: 800 }, pixelToWorldXZ: [0, 0, 0, 0, 0, 0], worldY: 0, provenance } })).toThrow('SCENE_IMAGE_MAPPING_INVALID');
    expect(() => deserializeSpatialScene('{')).toThrow('SCENE_JSON_INVALID');
  });
});

describe('spatial scene transactions', () => {
  it('converts only a matching explicit conversational edit into a previewable scene command', () => {
    expect(conversationEditToSceneCommand('Aumenta a manivela para 50 mm.', 'crank', { kind: 'update_length', componentId: 'crank', value: 50, unit: 'mm' })).toEqual({ status: 'ready', origin: 'model_proposal', command: { type: 'UpdateParameter', nodeId: 'crank', property: 'length', value: 50, unit: 'mm' } });
    expect(conversationEditToSceneCommand('Para que serve a peça?', 'crank', { kind: 'update_length', componentId: 'crank', value: 50, unit: 'mm' }).status).toBe('blocked');
    expect(conversationEditToSceneCommand('Aumenta a manivela para 50 mm.', 'crank', { kind: 'update_length', componentId: 'crank', value: 80, unit: 'mm' }).status).toBe('blocked');
  });

  it('separates preview from commit and supports undo/redo with monotonically new revisions', () => {
    const initial = createSceneTransaction(makeScene());
    const preview = previewSceneCommand(initial, { type: 'MoveComponent', nodeId: 'wall-a', translationM: [1, 0, 0] });
    expect(preview.status).toBe('ready');
    expect(initial.scene.nodes[0]?.transform.translationM).toEqual([0, 0, 0]);
    const moved = commitScenePreview(initial, preview);
    expect(moved.scene.nodes[0]?.transform.translationM).toEqual([1, 0, 0]);
    const undoPreview = previewSceneCommand(moved, { type: 'Undo' });
    const undone = commitScenePreview(moved, undoPreview);
    expect(undone.scene.nodes[0]?.transform.translationM).toEqual([0, 0, 0]);
    expect(undone.scene.revision).toMatchObject({ number: 2, parentId: 'scene-main:r1' });
    const redone = executeSceneCommand(undone, { type: 'Redo' }).transaction;
    expect(redone.scene.nodes[0]?.transform.translationM).toEqual([1, 0, 0]);
    expect(redone.scene.revision.number).toBe(3);
  });

  it('requires an issued authorization to change verified values and records correction provenance', () => {
    const scene = makeScene();
    scene.nodes[0]!.component!.properties.thickness = property(100, 'verified');
    const transaction = createSceneTransaction(scene);
    // Antes: o preview vinha "blocked" com VERIFIED_PARAMETER_REQUIRES_ACKNOWLEDGEMENT e `acknowledgeVerifiedChange: true`
    // bastava para aplicar. Agora o preview está pronto, diz que precisa de autorização, e o booleano é ignorado.
    const pending = previewSceneCommand(transaction, { type: 'UpdateParameter', nodeId: 'wall-a', property: 'thickness', value: 120, unit: 'mm' });
    expect(pending.status).toBe('ready');
    expect(pending.requiresAuthorization).toBe(true);
    expect(() => commitScenePreview(transaction, pending)).toThrow('AUTHORIZATION_REQUIRED');
    const flagged = previewSceneCommand(transaction, { type: 'UpdateParameter', nodeId: 'wall-a', property: 'thickness', value: 120, unit: 'mm', acknowledgeVerifiedChange: true }, 'reviewer');
    expect(() => commitScenePreview(transaction, flagged)).toThrow('AUTHORIZATION_REQUIRED');
    const ledger = new AuthorizationLedger({ sessionId: 'session-1' });
    const authorization = ledger.issue(flagged.operation!, { kind: 'human', id: 'reviewer' }, 'ui_direct');
    const accepted = commitScenePreview(transaction, flagged, { ledger, authorizationId: authorization.id });
    expect(accepted.scene.nodes[0]?.component?.properties.thickness).toMatchObject({ value: 120, provenance: { validation: 'corrected', source: 'user', sourceValue: 100, sourceUnit: 'mm', actor: 'reviewer', authorizationId: authorization.id } });
    const confirmation = previewSceneCommand(createSceneTransaction(makeScene()), { type: 'ConfirmParameter', nodeId: 'wall-a', property: 'thickness', note: 'Confirmado pelo utilizador após inspecção.' }, 'reviewer');
    expect(confirmation.candidate?.nodes[0]?.component?.properties.thickness?.provenance).toMatchObject({ validation: 'verified', actor: 'reviewer', evidence: 'Confirmado pelo utilizador após inspecção.' });
    expect(previewSceneCommand(transaction, { type: 'UpdateParameter', nodeId: 'wall-a', property: 'thickness', value: { value: 100, unit: 'mm', provenance: { ...provenance, validation: 'verified' } } as never }).status).toBe('blocked');
  });

  it('validates operation IDs, units, dimensions, relation endpoints, and protects referenced removals', () => {
    const scene = makeScene();
    scene.relations.push({ id: 'rel-1', fromNodeId: 'wall-a', toNodeId: 'annotation-a', kind: 'labels', properties: {}, provenance });
    const transaction = createSceneTransaction(scene);
    expect(previewSceneCommand(transaction, { type: 'RemoveComponent', nodeId: 'wall-a' }).issues[0]?.code).toBe('REMOVE_HAS_DEPENDENCIES');
    expect(previewSceneCommand(transaction, { type: 'MoveComponent', nodeId: 'unknown', translationM: [0, 0, 0] }).issues[0]?.code).toBe('NODE_NOT_FOUND');
    expect(previewSceneCommand(transaction, { type: 'ResizeComponent', nodeId: 'wall-a', scale: [1, 0, 1] }).issues[0]?.code).toBe('SCALE_INVALID');
    expect(previewSceneCommand(transaction, { type: 'ConnectComponents', relation: { id: 'r', fromNodeId: 'wall-a', toNodeId: 'missing', kind: 'joint', properties: {}, provenance } }).issues[0]?.code).toBe('RELATION_ENDPOINT_NOT_FOUND');
    expect(previewSceneCommand(transaction, { type: 'AddComponent', node: { ...scene.nodes[0]!, id: 'wall-a' } }).issues[0]?.code).toBe('DUPLICATE_NODE_ID');
    const fakeVerified = { ...scene.nodes[0]!, id: 'new-wall', component: { ...scene.nodes[0]!.component!, properties: { thickness: property(10, 'verified') } } };
    expect(previewSceneCommand(transaction, { type: 'AddComponent', node: fakeVerified }).issues[0]?.code).toBe('NEW_COMPONENT_CANNOT_CLAIM_HUMAN_VERIFICATION');
  });

  it('adds, connects, disconnects, removes, rotates and resizes through validated previews', () => {
    const initial = createSceneTransaction(makeScene());
    const addedNode = { id: 'wall-b', label: 'Parede B', nodeType: 'component' as const, parentId: null, transform: { translationM: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number], scale: [1, 1, 1] as [number, number, number], provenance: { translationM: provenance, rotation: provenance, scale: provenance } }, geometry: { kind: 'box' as const, sizeM: [1, 1, 0.1] as [number, number, number], provenance }, component: { kind: 'wall', properties: {}, dependsOn: [] }, properties: {} };
    let transaction = executeSceneCommand(initial, { type: 'AddComponent', node: addedNode }).transaction;
    transaction = executeSceneCommand(transaction, { type: 'ConnectComponents', relation: { id: 'joint-1', fromNodeId: 'wall-a', toNodeId: 'wall-b', kind: 'joined_to', properties: {}, provenance } }).transaction;
    expect(previewSceneCommand(transaction, { type: 'RemoveComponent', nodeId: 'wall-b' }).status).toBe('blocked');
    transaction = executeSceneCommand(transaction, { type: 'DisconnectComponents', relationId: 'joint-1' }).transaction;
    transaction = executeSceneCommand(transaction, { type: 'RotateComponent', nodeId: 'wall-b', axis: [0, 1, 0], angleRad: Math.PI / 2 }).transaction;
    transaction = executeSceneCommand(transaction, { type: 'ResizeComponent', nodeId: 'wall-b', scale: [2, 1, 1] }).transaction;
    expect(transaction.scene.nodes.find((node) => node.id === 'wall-b')?.geometry).toMatchObject({ kind: 'box', sizeM: [2, 1, 0.1], provenance: { source: 'user', validation: 'unreviewed' } });
    expect(transaction.scene.nodes.find((node) => node.id === 'wall-b')?.transform.rotation[1]).toBeCloseTo(Math.SQRT1_2);
    transaction = executeSceneCommand(transaction, { type: 'RemoveComponent', nodeId: 'wall-b' }).transaction;
    expect(transaction.scene.nodes.some((node) => node.id === 'wall-b')).toBe(false);
  });

  it('rejects dependency cycles and provenance references to absent documents', () => {
    const scene = makeScene();
    scene.nodes[0]!.component!.dependsOn = ['annotation-a'];
    scene.nodes[1]!.parentId = 'wall-a';
    expect(() => validateSpatialScene(scene)).toThrow('SCENE_DEPENDENCY_CYCLE');
    const other = makeScene();
    other.nodes[0]!.component!.properties.thickness!.provenance.documentRef = { documentId: 'missing-doc', schema: 'technical_document.v1', elementId: 'dimension-1' };
    expect(() => validateSpatialScene(other)).toThrow('SCENE_PROVENANCE_REFERENCE_INVALID');
  });

  it('rejects stale previews and leaves the original document reference unchanged', () => {
    const transaction = createSceneTransaction(makeScene());
    const oldDocumentRef = structuredClone(transaction.scene.sourceDocuments);
    const preview = previewSceneCommand(transaction, { type: 'MoveComponent', nodeId: 'wall-a', translationM: [1, 0, 0] });
    const changed = executeSceneCommand(transaction, { type: 'MoveComponent', nodeId: 'annotation-a', translationM: [0, 2, 0] }).transaction;
    expect(() => commitScenePreview(changed, preview)).toThrow('STALE_PREVIEW');
    expect(changed.scene.sourceDocuments).toEqual(oldDocumentRef);
  });

  it('replays previews at commit and rejects tampering, including a forged verified state', () => {
    const transaction = createSceneTransaction(makeScene());
    const preview = previewSceneCommand(transaction, { type: 'MoveComponent', nodeId: 'wall-a', translationM: [1, 0, 0] });
    const candidate = structuredClone(preview.candidate!);
    candidate.nodes[0]!.component!.properties.thickness!.provenance = { source: 'user', validation: 'verified', actor: 'forged caller', evidence: 'Forged state', recordedAt: '2026-01-01T00:00:00.000Z' };
    expect(() => commitScenePreview(transaction, { ...preview, candidate })).toThrow('PREVIEW_TAMPERED');
  });
});
