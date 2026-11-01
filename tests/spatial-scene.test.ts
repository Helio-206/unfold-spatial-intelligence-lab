import { describe, expect, it } from 'vitest';
import { persistSceneTransaction, type SpatialLockManager } from '../src/spatial-persistence';
import { readFileSync } from 'node:fs';
import { commitScenePreview, conversationEditToSceneCommand, createSceneTransaction, deserializeImportedSceneTransaction, deserializeSceneTransaction, deserializeSpatialScene, executeSceneCommand, previewSceneCommand, serializeSceneTransaction, serializeSpatialScene, validateSpatialScene, type SpatialSceneV1 } from '../src/spatial-scene';

const provenance = { source: 'user' as const, validation: 'unreviewed' as const, recordedAt: '2026-01-01T00:00:00.000Z' };
const property = (value: number, validation: 'unreviewed' | 'verified' = 'unreviewed') => ({ value, unit: 'mm', provenance: { ...provenance, validation, ...(validation === 'verified' ? { actor: 'fixture reviewer', evidence: 'Fixture explícita de teste.' } : {}) } });
const metreProperty = (value: number) => ({ value, unit: 'm', provenance });
const lockManager: SpatialLockManager = { request: async (_name, _options, callback) => callback() };
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

  it('rejects parent cycles before resolving dependent world transforms', () => {
    const scene = makeScene();
    const first = structuredClone(scene.nodes[1]!); first.id = 'group-first'; first.nodeType = 'group'; first.parentId = 'group-second';
    const second = structuredClone(scene.nodes[1]!); second.id = 'group-second'; second.nodeType = 'group'; second.parentId = 'group-first';
    expect(() => validateSpatialScene({ ...scene, nodes: [...scene.nodes, first, second] })).toThrow('SCENE_DEPENDENCY_CYCLE');
  });
});

describe('spatial scene transactions', () => {
  it('converts only a matching explicit conversational edit into a previewable scene command', () => {
    expect(conversationEditToSceneCommand('Aumenta a manivela para 50 mm.', 'crank', { kind: 'update_length', componentId: 'crank', value: 50, unit: 'mm' })).toEqual({ status: 'ready', command: { type: 'UpdateParameter', nodeId: 'crank', property: 'length', value: 50, unit: 'mm' } });
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

  it('does not report a durable scene write when storage fails', async () => {
    const transaction = createSceneTransaction(makeScene());
    const values = new Map([['unfold-spatial-scene.v1', 'previous-good-snapshot']]);
    const storage = { setItem: (key: string, value: string) => { if (key === 'unfold-spatial-scene.v1') throw new DOMException('quota', 'QuotaExceededError'); values.set(key, value); } };
    await expect(persistSceneTransaction(storage, transaction, undefined, undefined, lockManager)).rejects.toThrow('quota');
    expect(values.get('unfold-spatial-scene.v1')).toBe('previous-good-snapshot');
    expect(transaction.scene.revision.number).toBe(0);
  });

  it('rejects stale writes from another tab instead of overwriting the newer revision', async () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const initial = createSceneTransaction(makeScene());
    await persistSceneTransaction(storage, initial, undefined, undefined, lockManager);
    const tabA = executeSceneCommand(initial, { type: 'MoveComponent', nodeId: 'wall-a', translationM: [1, 0, 0] }).transaction;
    const tabB = executeSceneCommand(initial, { type: 'MoveComponent', nodeId: 'wall-a', translationM: [0, 0, 1] }).transaction;
    await persistSceneTransaction(storage, tabA, undefined, undefined, lockManager);
    await expect(persistSceneTransaction(storage, tabB, undefined, undefined, lockManager)).rejects.toThrow('SCENE_PERSISTENCE_CONFLICT');
    expect(deserializeSceneTransaction(values.get('unfold-spatial-scene.v1')!).scene.nodes[0]?.transform.translationM).toEqual([1, 0, 0]);
  });

  it('serializes truly concurrent tab writes and rejects the second stale parent revision', async () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    let tail = Promise.resolve();
    const serializedLocks: SpatialLockManager = { request: async (_name, _options, callback) => {
      const previous = tail; let release!: () => void; tail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try { return await callback(); } finally { release(); }
    } };
    const initial = createSceneTransaction(makeScene());
    await persistSceneTransaction(storage, initial, undefined, undefined, serializedLocks);
    const tabA = executeSceneCommand(initial, { type: 'MoveComponent', nodeId: 'wall-a', translationM: [1, 0, 0] }).transaction;
    const tabB = executeSceneCommand(initial, { type: 'MoveComponent', nodeId: 'wall-a', translationM: [0, 0, 1] }).transaction;
    const results = await Promise.allSettled([
      persistSceneTransaction(storage, tabA, undefined, undefined, serializedLocks),
      persistSceneTransaction(storage, tabB, undefined, undefined, serializedLocks),
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(results[1]).toMatchObject({ reason: new Error('SCENE_PERSISTENCE_CONFLICT') });
    expect(deserializeSceneTransaction(values.get('unfold-spatial-scene.v1')!).scene.nodes[0]?.transform.translationM).toEqual([1, 0, 0]);
  });

  it('binds confirmed rebuilds to the revision the user actually confirmed', async () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const original = createSceneTransaction(makeScene());
    await persistSceneTransaction(storage, original, undefined, undefined, lockManager);
    const concurrentlyEdited = executeSceneCommand(original, { type: 'MoveComponent', nodeId: 'wall-a', translationM: [2, 0, 0] }).transaction;
    await persistSceneTransaction(storage, concurrentlyEdited, undefined, undefined, lockManager);
    const rebuild = createSceneTransaction({ ...makeScene(), title: 'Rebuild' });
    await expect(persistSceneTransaction(storage, rebuild, undefined, { allowReplace: true, expectedRevisionId: original.scene.revision.id }, lockManager)).rejects.toThrow('SCENE_PERSISTENCE_CONFLICT');
    expect(deserializeSceneTransaction(values.get('unfold-spatial-scene.v1')!).scene.revision.id).toBe(concurrentlyEdited.scene.revision.id);
  });

  it('fails closed when cross-tab locking is unavailable', async () => {
    await expect(persistSceneTransaction({ setItem: () => undefined }, createSceneTransaction(makeScene()), undefined, undefined, null)).rejects.toThrow('SCENE_PERSISTENCE_CROSS_TAB_LOCK_UNAVAILABLE');
  });

  it('downgrades claimed human reviews in imported scene files', () => {
    const scene = makeScene();
    scene.nodes[0]!.component!.properties.thickness = property(100, 'verified');
    const imported = deserializeImportedSceneTransaction(serializeSceneTransaction(createSceneTransaction(scene)));
    expect(imported.scene.nodes[0]?.component?.properties.thickness?.provenance).toMatchObject({ source: 'system', validation: 'unreviewed' });
    expect(imported.scene.nodes[0]?.component?.properties.thickness?.provenance.actor).toBeUndefined();
  });

  it('rejects oversized room contours before quadratic self-intersection validation', () => {
    const scene = makeScene();
    const count = 513;
    const verticesM = Array.from({ length: count }, (_, index) => { const angle = index * 2 * Math.PI / count; return [Math.cos(angle), 0, Math.sin(angle)] as [number, number, number]; });
    const room = { ...scene.nodes[1]!, id: 'room-large', label: 'Região', nodeType: 'component' as const, geometry: { kind: 'polygon' as const, verticesM, provenance }, component: { kind: 'room', properties: { boundaryRefs: { value: '[]', provenance } }, dependsOn: [] } };
    expect(() => validateSpatialScene({ ...scene, nodes: [...scene.nodes, room] })).toThrow('SCENE_ROOM_VERTEX_LIMIT_EXCEEDED');
  });

  it('validates opening attachment in world space through transformed parents', () => {
    const scene = makeScene();
    const wall = structuredClone(scene.nodes[0]!);
    wall.geometry = { kind: 'box', sizeM: [2, 2.7, 0.1], provenance };
    wall.component!.properties = { length: metreProperty(2), height: metreProperty(2.7), thickness: metreProperty(0.1) };
    const group = structuredClone(scene.nodes[1]!);
    group.id = 'group-offset'; group.nodeType = 'group'; group.component = null; group.geometry = null;
    group.transform.translationM = [5, 0, 0];
    group.transform.scale = [2, 1, 1];
    wall.parentId = group.id;
    const door = structuredClone(wall);
    door.id = 'door-a'; door.label = 'Porta'; door.parentId = null;
    door.component = { kind: 'door', dependsOn: [wall.id], properties: { offset: metreProperty(1), width: metreProperty(1), height: metreProperty(2), sill: metreProperty(0) } };
    door.geometry = { kind: 'box', sizeM: [1, 2, 0.04], provenance };
    door.transform.translationM = [4.5, 1, 0];
    expect(() => validateSpatialScene({ ...scene, nodes: [wall, group, door] })).not.toThrow();
    door.transform.translationM = [6, 1, 0];
    expect(() => validateSpatialScene({ ...scene, nodes: [wall, group, door] })).toThrow('SCENE_OPENING_TRANSFORM_STALE');
  });

  it('rejects transformations that break an opening dependency without mutating the base transaction', () => {
    const scene = makeScene();
    const wall: import('../src/spatial-scene').Node = { ...scene.nodes[0]!, geometry: { kind: 'box', sizeM: [2, 2.7, 0.1], provenance }, component: { ...scene.nodes[0]!.component!, properties: {} } };
    const opening = structuredClone(wall);
    opening.id = 'opening-a'; opening.label = 'Porta';
    opening.component = { kind: 'door', dependsOn: [wall.id], properties: { offset: metreProperty(1), width: metreProperty(1), height: metreProperty(2), sill: metreProperty(0) } };
    opening.geometry = { kind: 'box', sizeM: [1, 2, 0.04], provenance };
    opening.transform.translationM = [0.5, 1, 0];
    const scaledOpening = structuredClone(opening); scaledOpening.transform.scale = [2, 1, 1];
    expect(() => validateSpatialScene({ ...scene, nodes: [wall, scene.nodes[1]!, scaledOpening] })).toThrow('SCENE_OPENING_SCALE_UNSUPPORTED');
    const withOpening = createSceneTransaction({ ...scene, nodes: [wall, scene.nodes[1]!, opening] });
    const preview = previewSceneCommand(withOpening, { type: 'MoveComponent', nodeId: wall.id, translationM: [1, 0, 0] });
    expect(preview.status).toBe('blocked');
    expect(preview.issues[0]?.code).toBe('SCENE_OPENING_TRANSFORM_STALE');
    expect(withOpening.scene.nodes[0]?.transform.translationM).toEqual([0, 0, 0]);
  });

  it('blocks edits to verified values unless explicitly acknowledged and records correction provenance', () => {
    const scene = makeScene();
    const wall = scene.nodes[0]!;
    wall.geometry = { kind: 'box', sizeM: [2, 2.7, 0.1], provenance };
    wall.component!.properties = { length: { value: 2, unit: 'm', provenance }, height: { value: 2.7, unit: 'm', provenance }, thickness: property(100, 'verified') };
    const transaction = createSceneTransaction(scene);
    const blocked = previewSceneCommand(transaction, { type: 'UpdateParameter', nodeId: 'wall-a', property: 'thickness', value: 120, unit: 'mm' });
    expect(blocked.status).toBe('blocked');
    expect(blocked.issues[0]?.code).toBe('VERIFIED_PARAMETER_REQUIRES_ACKNOWLEDGEMENT');
    const accepted = previewSceneCommand(transaction, { type: 'UpdateParameter', nodeId: 'wall-a', property: 'thickness', value: 120, unit: 'mm', acknowledgeVerifiedChange: true }, 'reviewer');
    expect(accepted.status).toBe('ready');
    expect(accepted.candidate?.nodes[0]?.component?.properties.thickness).toMatchObject({ value: 120, provenance: { validation: 'corrected', source: 'user', sourceValue: 100, sourceUnit: 'mm', actor: 'reviewer' } });
    expect(accepted.candidate?.nodes[0]?.geometry).toMatchObject({ kind: 'box', sizeM: [2, 2.7, 0.12] });
    expect(() => deserializeSpatialScene(serializeSpatialScene(accepted.candidate!))).not.toThrow();
    const confirmation = previewSceneCommand(createSceneTransaction(makeScene()), { type: 'ConfirmParameter', nodeId: 'wall-a', property: 'thickness', note: 'Confirmado pelo utilizador após inspecção.' }, 'reviewer');
    expect(confirmation.candidate?.nodes[0]?.component?.properties.thickness?.provenance).toMatchObject({ validation: 'verified', actor: 'reviewer', evidence: 'Confirmado pelo utilizador após inspecção.' });
    expect(previewSceneCommand(transaction, { type: 'UpdateParameter', nodeId: 'wall-a', property: 'thickness', value: { value: 100, unit: 'mm', provenance: { ...provenance, validation: 'verified' } } as never }).status).toBe('blocked');
  });

  it('requires a new explicit acknowledgement to change a corrected value and retains the correction chain', () => {
    const scene = makeScene();
    const wall = scene.nodes[0]!;
    wall.geometry = { kind: 'box', sizeM: [2, 2.7, 0.12], provenance };
    wall.component!.properties = {
      length: metreProperty(2), height: metreProperty(2.7),
      thickness: { value: 120, unit: 'mm', provenance: { source: 'user', validation: 'corrected', sourceValue: 100, sourceUnit: 'mm', evidence: 'Leitura corrigida após inspecção.', actor: 'local-user', recordedAt: '2026-01-01T00:00:00.000Z' } },
    };
    const transaction = createSceneTransaction(scene);
    const blocked = previewSceneCommand(transaction, { type: 'UpdateParameter', nodeId: wall.id, property: 'thickness', value: 130, unit: 'mm' });
    expect(blocked.status).toBe('blocked');
    expect(blocked.issues[0]?.code).toBe('VERIFIED_PARAMETER_REQUIRES_ACKNOWLEDGEMENT');
    const acknowledged = previewSceneCommand(transaction, { type: 'UpdateParameter', nodeId: wall.id, property: 'thickness', value: 130, unit: 'mm', acknowledgeVerifiedChange: true }, 'local-user');
    expect(acknowledged.status).toBe('ready');
    expect(acknowledged.candidate?.nodes[0]?.component?.properties.thickness).toMatchObject({
      value: 130,
      provenance: { validation: 'corrected', sourceValue: 120, sourceUnit: 'mm', actor: 'local-user', evidence: 'O utilizador autorizou explicitamente a alteração de um parâmetro previamente confirmado.' },
    });
    expect(acknowledged.candidate?.nodes[0]?.geometry).toMatchObject({ kind: 'box', sizeM: [2, 2.7, 0.13] });
  });

  it('keeps wall parameters and geometry consistent across accepted units and reads legacy scaled walls', () => {
    const scene = makeScene();
    const wall = scene.nodes[0]!;
    wall.geometry = { kind: 'box', sizeM: [2, 2.7, 0.1], provenance };
    wall.component!.properties = { length: { value: 200, unit: 'cm', provenance }, height: { value: 270, unit: 'cm', provenance }, thickness: { value: 100, unit: 'mm', provenance } };
    const transaction = createSceneTransaction(scene);
    const resized = executeSceneCommand(transaction, { type: 'ResizeComponent', nodeId: wall.id, scale: [1.5, 1, 1] }).transaction;
    expect(resized.scene.nodes[0]?.component?.properties.length).toMatchObject({ value: 300, unit: 'cm' });
    expect(resized.scene.nodes[0]?.geometry).toMatchObject({ kind: 'box', sizeM: [3, 2.7, 0.1] });
    const updated = previewSceneCommand(transaction, { type: 'UpdateParameter', nodeId: wall.id, property: 'thickness', value: 120, unit: 'mm' });
    expect(updated.status).toBe('ready');
    expect(updated.candidate?.nodes[0]?.geometry).toMatchObject({ kind: 'box', sizeM: [2, 2.7, 0.12] });
    const scaled = structuredClone(scene); scaled.nodes[0]!.transform.scale = [2, 1, 1];
    expect(validateSpatialScene(scaled).nodes[0]?.transform.scale).toEqual([2, 1, 1]);
    expect(deserializeSpatialScene(serializeSpatialScene(scaled)).nodes[0]?.transform.scale).toEqual([2, 1, 1]);
  });

  it('records the immediately previous confirmed value across consecutive resizes', () => {
    const scene = makeScene();
    const wall = scene.nodes[0]!;
    wall.geometry = { kind: 'box', sizeM: [2, 2.7, 0.1], provenance };
    wall.component!.properties = { length: metreProperty(2), height: metreProperty(2.7), thickness: property(100, 'verified') };
    const initial = createSceneTransaction(scene);
    const first = executeSceneCommand(initial, { type: 'ResizeComponent', nodeId: wall.id, scale: [1, 1, 1.2], acknowledgeVerifiedChange: true }).transaction;
    expect(first.scene.nodes[0]?.component?.properties.thickness?.provenance.sourceValue).toBe(100);
    const second = executeSceneCommand(first, { type: 'ResizeComponent', nodeId: wall.id, scale: [1, 1, 130 / 120], acknowledgeVerifiedChange: true }).transaction;
    expect(second.scene.nodes[0]?.component?.properties.thickness).toMatchObject({ provenance: { validation: 'corrected', sourceValue: 120, sourceUnit: 'mm' } });
    expect(second.scene.nodes[0]?.component?.properties.thickness?.value).toBeCloseTo(130, 10);
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

  it('refuses geometric mutations on constrained nodes when no constraint solver can preserve them', () => {
    const unconstrained = makeScene();
    const constrained = validateSpatialScene({ ...unconstrained, constraints: [{ id: 'fixed-wall-a', kind: 'fixed', nodeIds: ['wall-a'], value: null, unit: null, provenance }] });
    const transaction = createSceneTransaction(constrained);

    for (const command of [
      { type: 'MoveComponent' as const, nodeId: 'wall-a', translationM: [1, 0, 0] as [number, number, number] },
      { type: 'RotateComponent' as const, nodeId: 'wall-a', axis: [0, 1, 0] as [number, number, number], angleRad: Math.PI / 2 },
      { type: 'ResizeComponent' as const, nodeId: 'wall-a', scale: [2, 1, 1] as [number, number, number] },
      { type: 'UpdateGeometry' as const, nodeId: 'wall-a', geometry: { kind: 'box' as const, sizeM: [2, 2.7, 0.1] as [number, number, number], provenance } },
      { type: 'UpdateParameter' as const, nodeId: 'wall-a', property: 'length', value: 3, unit: 'm' },
    ]) {
      const preview = previewSceneCommand(transaction, command);
      expect(preview.status).toBe('blocked');
      expect(preview.issues[0]?.code).toBe('GEOMETRIC_CONSTRAINT_REQUIRES_SOLVER:fixed-wall-a');
      expect(preview.candidate).toBeNull();
      expect(transaction.scene.nodes[0]?.transform.translationM).toEqual([0, 0, 0]);
      expect(transaction.scene.nodes[0]?.geometry?.kind).toBe('segment');
      expect(transaction.scene.revision.number).toBe(0);
    }
  });

  it('includes descendants and dependent nodes when checking mutation constraints', () => {
    const base = makeScene();
    const child = structuredClone(base.nodes[1]!);
    child.id = 'child-group'; child.label = 'Subgrupo'; child.nodeType = 'group'; child.component = null; child.parentId = 'wall-a'; child.geometry = null;
    const constrained = validateSpatialScene({
      ...base,
      nodes: [...base.nodes, child],
      constraints: [{ id: 'fixed-descendant', kind: 'fixed', nodeIds: [child.id], value: null, unit: null, provenance }],
    });
    const preview = previewSceneCommand(createSceneTransaction(constrained), { type: 'MoveComponent', nodeId: 'wall-a', translationM: [1, 0, 0] });
    expect(preview.status).toBe('blocked');
    expect(preview.issues[0]?.code).toBe('GEOMETRIC_CONSTRAINT_REQUIRES_SOLVER:fixed-descendant');
  });

  it('refuses generic geometry edits that would silently invalidate a spatial relation', () => {
    const base = makeScene();
    const connected = validateSpatialScene({
      ...base,
      relations: [{ id: 'wall-joint', fromNodeId: 'wall-a', toNodeId: 'annotation-a', kind: 'joined_to', properties: {}, provenance }],
    });
    const transaction = createSceneTransaction(connected);
    const preview = previewSceneCommand(transaction, { type: 'MoveComponent', nodeId: 'wall-a', translationM: [1, 0, 0] });
    expect(preview.status).toBe('blocked');
    expect(preview.issues[0]?.code).toBe('GEOMETRIC_RELATION_REQUIRES_SUPPORTED_EDIT:wall-joint');
    expect(preview.candidate).toBeNull();
    expect(transaction.scene.nodes[0]?.transform.translationM).toEqual([0, 0, 0]);
    expect(transaction.scene.revision.number).toBe(0);
  });
});
