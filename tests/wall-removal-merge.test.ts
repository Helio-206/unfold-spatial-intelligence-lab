import { describe, expect, it } from 'vitest';
import { AuthorizationLedger, type Actor } from '../src/core';
import { addOpeningToScene, editWallInScene, planWallEdit, planWallRemoval, removeWallFromScene } from '../src/plan-scene';
import { commitScenePreview, executeSceneCommand, previewSceneCommand, serializeSceneTransaction, validateSpatialScene, type SceneTransaction, type SpatialSceneV1 } from '../src/spatial-scene';
import { boundedBy, dropVertexKeepRefs, mutateScene, nodeOf, sceneFromRooms, sharedWallId, shoelace, wallBetween, type RoomSpec } from './helpers/rooms';
import { provenanceFor } from './helpers/scenes';

const human: Actor & { kind: 'human' } = { kind: 'human', id: 'reviewer' };
const A: RoomSpec = { id: 'sala', vertices: [[0, 0], [4, 0], [4, 3], [0, 3]] };
const B: RoomSpec = { id: 'cozinha', vertices: [[4, 0], [7, 0], [7, 3], [4, 3]] };
const twoRooms = () => sceneFromRooms([A, B]);
const wallOf = (t: SceneTransaction) => sharedWallId(t.scene, 'sala', 'cozinha');
const rooms = (scene: SpatialSceneV1) => scene.nodes.filter((n) => n.component?.kind === 'room');
const ledger = () => { let n = 0; return new AuthorizationLedger({ sessionId: 's1', newId: () => `auth-${++n}` }); };
const code = (fn: () => unknown): string => { try { fn(); } catch (error) { return error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : error instanceof Error ? error.message : String(error); } return 'NO_ERROR'; };
const polygonArea = (scene: SpatialSceneV1, id: string) => { const g = nodeOf(scene, id).geometry; if (g?.kind !== 'polygon') throw new Error('sem polígono'); return shoelace(g.verticesM); };

describe('remover a parede entre duas divisões funde-as', () => {
  it('antes recusava com REMOVE_HAS_DEPENDENCIES; agora sai uma só divisão de 21 m² e a parede e as duas divisões antigas desaparecem', () => {
    const t = twoRooms();
    const wall = wallOf(t);
    const next = removeWallFromScene(t, wall, 'reviewer');
    expect(() => validateSpatialScene(next.scene)).not.toThrow();
    expect(next.scene.nodes.some((n) => n.id === wall || n.id === 'sala' || n.id === 'cozinha')).toBe(false);
    const left = rooms(next.scene);
    expect(left).toHaveLength(1);
    expect(left[0]!.label).toBe('Divisão proposta 1 + Divisão proposta 2');
    expect(polygonArea(next.scene, left[0]!.id)).toBeCloseTo(21, 9);
    expect(Number(left[0]!.component!.properties.area!.value)).toBeCloseTo(21, 9);
    // As relações das divisões antigas foram-se; as da nova apontam só para paredes que existem.
    expect(next.scene.relations.every((r) => next.scene.nodes.some((n) => n.id === r.fromNodeId) && next.scene.nodes.some((n) => n.id === r.toNodeId))).toBe(true);
    expect(next.scene.relations.filter((r) => r.fromNodeId === left[0]!.id)).toHaveLength(6);
  });

  it('as portas e janelas da parede removida saem como hoje', () => {
    const t = addOpeningToScene(twoRooms(), wallOf(twoRooms()), { id: 'porta-1', kind: 'door', offsetM: 1, widthM: 0.9, heightM: 2.05, sillM: 0, actor: 'u' });
    const next = removeWallFromScene(t, wallOf(t), 'reviewer');
    expect(next.scene.nodes.some((n) => n.id === 'porta-1')).toBe(false);
    expect(rooms(next.scene)).toHaveLength(1);
  });

  it('o plano traz a fusão e o relatório do Core, sem aplicar nada', () => {
    const t = twoRooms();
    const before = serializeSceneTransaction(t);
    const plan = planWallRemoval(t, wallOf(t), 'reviewer');
    expect(plan.merge).toMatchObject({ status: 'merge', roomIds: ['sala', 'cozinha'] });
    expect(plan.merge!.areas.merged).toBeCloseTo(21, 9);
    expect(plan.report!.checks.map((c) => [c.id, c.status])).toEqual([['architecture.room-merge.area', 'pass'], ['architecture.room-merge.simple-polygon', 'pass'], ['architecture.room-merge.structure', 'unknown']]);
    expect(serializeSceneTransaction(t)).toBe(before);
  });

  it('uma parede sem divisões não tem fusão nem relatório', () => {
    const t = sceneFromRooms([A]);
    const outer = nodeOf(t.scene, 'sala').component!.dependsOn[0]!;
    const lone = mutateScene(t, (s) => { s.nodes = s.nodes.filter((n) => n.id !== 'sala'); s.relations = []; });
    const plan = planWallRemoval(lone, outer, 'reviewer');
    expect(plan.merge).toBeUndefined();
    expect(plan.report).toBeUndefined();
    expect(plan.transaction.scene.nodes.some((n) => n.id === outer)).toBe(false);
  });
});

describe('uma operação composta é uma revisão', () => {
  it('a remoção com fusão avança a revisão em 1, com o nome da operação, e há uma só entrada de desfazer', () => {
    const t = twoRooms();
    const next = removeWallFromScene(t, wallOf(t), 'reviewer');
    expect(next.scene.revision.number).toBe(t.scene.revision.number + 1);
    expect(next.scene.revision).toMatchObject({ id: `${t.scene.id}:r${t.scene.revision.number + 1}`, parentId: t.scene.revision.id, createdBy: 'reviewer' });
    expect(next.scene.revision.operationId).toMatch(/RemoveWall$/);
    expect(next.undoStack).toEqual([...t.undoStack, t.scene]);
    expect(next.redoStack).toEqual([]);
  });

  it('a remoção de uma parede com portas também: uma revisão, uma entrada', () => {
    const base = sceneFromRooms([A]);
    const outer = nodeOf(base.scene, 'sala').component!.dependsOn[0]!;
    const withDoor = addOpeningToScene(base, outer, { id: 'porta-1', kind: 'door', offsetM: 0.5, widthM: 0.9, heightM: 2.05, sillM: 0, actor: 'u' });
    const lone = mutateScene(withDoor, (s) => { s.nodes = s.nodes.filter((n) => n.id !== 'sala'); s.relations = []; });
    const before = lone.scene.revision.number;
    const next = removeWallFromScene(lone, outer, 'reviewer');
    expect(next.scene.nodes.some((n) => n.id === 'porta-1' || n.id === outer)).toBe(false);
    expect(next.scene.revision.number).toBe(before + 1);
    expect(next.undoStack).toHaveLength(lone.undoStack.length + 1);
  });

  it.each([['editWallInScene', (t: SceneTransaction) => editWallInScene(t, wallBetween(t.scene, [0, 0], [4, 0]), { start: { x: 0, y: 0 }, end: { x: 4.5, y: 0 }, actor: 'reviewer' }), /EditWall$/]] as const)('%s também: uma revisão com o nome da operação', (_name, run, pattern) => {
    const t = twoRooms();
    const next = run(t);
    expect(next.scene.revision.number).toBe(t.scene.revision.number + 1);
    expect(next.scene.revision.operationId).toMatch(pattern);
    expect(next.undoStack).toHaveLength(t.undoStack.length + 1);
  });

  it('o digest e a autorização não mudam: a operação canónica não leva a revisão nova, só a base', () => {
    const t = twoRooms();
    const plan = planWallRemoval(t, wallOf(t), 'reviewer');
    expect(plan.operation.baseRevisionId).toBe(t.scene.revision.id);
    expect(JSON.stringify(plan.operation)).not.toContain(plan.transaction.scene.revision.id);
  });

  it('desfazer repõe as duas divisões e a parede, e fica a revisão seguinte', () => {
    const t = twoRooms();
    const wall = wallOf(t);
    const removed = removeWallFromScene(t, wall, 'reviewer');
    const { transaction: undone } = executeSceneCommand(removed, { type: 'Undo' }, 'reviewer');
    expect(undone.scene.nodes.map((n) => n.id).sort()).toEqual(t.scene.nodes.map((n) => n.id).sort());
    expect(undone.scene.nodes).toEqual(t.scene.nodes);
    expect(undone.scene.relations).toEqual(t.scene.relations);
    expect(undone.scene.revision.number).toBe(removed.scene.revision.number + 1);
    expect(undone.redoStack).toHaveLength(1);
  });

  it('refazer volta a ter uma divisão', () => {
    const t = twoRooms();
    const removed = removeWallFromScene(t, wallOf(t), 'reviewer');
    const undone = executeSceneCommand(removed, { type: 'Undo' }, 'reviewer').transaction;
    const redone = executeSceneCommand(undone, { type: 'Redo' }, 'reviewer').transaction;
    expect(rooms(redone.scene)).toHaveLength(1);
  });
});

describe('o que o motor não prova fica bloqueado, com a cena intacta', () => {
  const blocked = (t: SceneTransaction, wall: string, expected: string) => {
    const before = serializeSceneTransaction(t);
    expect(code(() => planWallRemoval(t, wall, 'reviewer'))).toBe(expected);
    expect(code(() => removeWallFromScene(t, wall, 'reviewer'))).toBe(expected);
    expect(serializeSceneTransaction(t)).toBe(before);
  };

  it('uma só divisão (a remoção abriria a divisão para fora)', () => {
    const t = sceneFromRooms([A]);
    blocked(t, nodeOf(t.scene, 'sala').component!.dependsOn[0]!, 'ROOM_MERGE_SINGLE_ROOM');
  });

  it('três divisões', () => {
    const t = mutateScene(twoRooms(), (s) => {
      const wall = sharedWallId(s, 'sala', 'cozinha');
      const third = structuredClone(nodeOf(s, 'cozinha')); third.id = 'varanda'; third.label = 'Varanda'; third.component!.dependsOn = [wall];
      s.nodes.push(third); s.relations.push(boundedBy('varanda', wall, s.relations[0]!));
    });
    blocked(t, wallOf(t), 'ROOM_MERGE_MORE_THAN_TWO_ROOMS');
  });

  it('partilha parcial (a divisão não tem vértice onde a parede acaba)', () => {
    const tall: RoomSpec = { id: 'sala', vertices: [[0, 0], [4, 0], [4, 6], [0, 6]] };
    const small: RoomSpec = { id: 'cozinha', vertices: [[4, 0], [7, 0], [7, 3], [4, 3]] };
    const t = mutateScene(sceneFromRooms([tall, small]), (s) => {
      const room = nodeOf(s, 'sala');
      if (room.geometry?.kind !== 'polygon') throw new Error('sem polígono');
      dropVertexKeepRefs(s, 'sala', room.geometry.verticesM.findIndex((v) => Math.abs(v[0] - 4) < 1e-9 && Math.abs(v[2] + 3) < 1e-9));
    });
    blocked(t, wallBetween(t.scene, [4, 0], [4, 3]), 'ROOM_MERGE_EDGE_MISMATCH');
  });

  it('as divisões tocam-se noutro troço', () => {
    const inner: RoomSpec = { id: 'sala', vertices: [[0, 0], [2, 0], [2, 2], [0, 2]] };
    const wrap: RoomSpec = { id: 'cozinha', vertices: [[2, 0], [5, 0], [5, 3], [0, 3], [0, 2], [2, 2]] };
    const t = sceneFromRooms([inner, wrap]);
    blocked(t, wallBetween(t.scene, [2, 0], [2, 2]), 'ROOM_MERGE_TOUCH_ELSEWHERE');
  });

  it('outra coisa depende de uma das divisões: o motor continua a recusar com REMOVE_HAS_DEPENDENCIES', () => {
    const t = mutateScene(twoRooms(), (s) => {
      const mobiliario = structuredClone(nodeOf(s, 'cozinha')); mobiliario.id = 'mesa'; mobiliario.label = 'Mesa'; mobiliario.component = { kind: 'furniture', dependsOn: ['cozinha'], properties: {} }; mobiliario.geometry = null;
      s.nodes.push(mobiliario);
    });
    blocked(t, wallOf(t), 'REMOVE_HAS_DEPENDENCIES');
  });
});

describe('divisões com valores confirmados', () => {
  const confirmedRooms = () => mutateScene(twoRooms(), (s) => {
    nodeOf(s, 'sala').component!.properties.area = { value: 12, unit: 'm2', provenance: provenanceFor('verified') };
    nodeOf(s, 'cozinha').geometry!.provenance = provenanceFor('corrected');
  });

  it('o plano di-lo, e o valor antigo fica no preview (de → nada), não é copiado para a divisão nova', () => {
    const t = confirmedRooms();
    const plan = planWallRemoval(t, wallOf(t), 'reviewer');
    expect(plan.requiresAuthorization).toBe(true);
    expect(plan.touchesConfirmed).toEqual([
      { entityId: 'cozinha', field: 'geometry', validation: 'corrected' },
      { entityId: 'sala', field: 'component.properties.area', validation: 'verified' },
    ]);
    const oldValue = plan.operation.changes.find((c) => c.entityId === 'sala' && c.field === 'component.properties.area')!;
    expect(oldValue).toMatchObject({ from: { value: { value: 12, unit: 'm2' }, validation: 'verified' }, to: null });
    const merged = rooms(plan.transaction.scene)[0]!;
    expect(JSON.stringify(merged)).not.toMatch(/"validation":"(verified|corrected)"/);
    expect(plan.operation.affected).toEqual(expect.arrayContaining(['sala', 'cozinha', merged.id, wallOf(t)]));
  });

  it('sem autorização nada muda (cena serializada igual)', () => {
    const t = confirmedRooms();
    const before = serializeSceneTransaction(t);
    expect(code(() => removeWallFromScene(t, wallOf(t), 'reviewer'))).toBe('AUTHORIZATION_REQUIRED');
    expect(code(() => removeWallFromScene(t, wallOf(t), 'reviewer', { ledger: ledger() }))).toBe('AUTHORIZATION_REQUIRED');
    expect(serializeSceneTransaction(t)).toBe(before);
  });

  it('com a autorização certa aplica-se; a divisão nova não herda o confirmado e a autorização gasta-se uma vez', () => {
    const t = confirmedRooms();
    const l = ledger();
    const plan = planWallRemoval(t, wallOf(t), 'reviewer');
    const authorization = l.issue(plan.operation, human, 'ui_direct');
    const next = removeWallFromScene(t, wallOf(t), 'reviewer', { ledger: l, authorizationId: authorization.id });
    expect(rooms(next.scene)).toHaveLength(1);
    expect(JSON.stringify(rooms(next.scene)[0])).not.toMatch(/"validation":"(verified|corrected)"|authorizationId/);
    expect(next.scene.revision.number).toBe(t.scene.revision.number + 1);
    expect(code(() => removeWallFromScene(t, wallOf(t), 'reviewer', { ledger: l, authorizationId: authorization.id }))).toBe('AUTHORIZATION_ALREADY_USED');
  });

  it('uma autorização para outra operação ou outra revisão não serve', () => {
    const t = confirmedRooms();
    const l = ledger();
    const other = planWallEdit(t, wallBetween(t.scene, [0, 0], [4, 0]), { start: { x: 0, y: 0 }, end: { x: 5, y: 0 }, actor: 'reviewer' }).operation;
    expect(code(() => removeWallFromScene(t, wallOf(t), 'reviewer', { ledger: l, authorizationId: l.issue(other, human, 'ui_direct').id }))).toBe('AUTHORIZATION_DIGEST_MISMATCH');
    const later = mutateScene(confirmedRooms(), (s) => { s.revision = { ...s.revision, id: 'rooms:r7', number: 7 }; });
    const stale = planWallRemoval(later, wallOf(later), 'reviewer').operation;
    expect(code(() => removeWallFromScene(t, wallOf(t), 'reviewer', { ledger: l, authorizationId: l.issue(stale, human, 'ui_direct').id }))).toBe('AUTHORIZATION_REVISION_MISMATCH');
  });

  it('origem de modelo: propõe sobre divisões por rever, mas nunca toca em confirmadas nem autoriza', () => {
    const plain = twoRooms();
    const proposal = planWallRemoval(plain, wallOf(plain), 'muse', { origin: 'model_proposal' });
    expect(proposal).toMatchObject({ requiresAuthorization: false, touchesConfirmed: [] });
    expect(JSON.stringify(rooms(proposal.transaction.scene))).not.toMatch(/"validation":"(verified|corrected)"/);
    const t = confirmedRooms();
    expect(code(() => planWallRemoval(t, wallOf(t), 'muse', { origin: 'model_proposal' }))).toBe('MACHINE_CANNOT_TOUCH_CONFIRMED');
    const l = ledger();
    const humanPlan = planWallRemoval(t, wallOf(t), 'reviewer');
    expect(code(() => removeWallFromScene(t, wallOf(t), 'muse', { origin: 'model_proposal', ledger: l, authorizationId: l.issue(humanPlan.operation, human, 'ui_direct').id }))).toBe('MACHINE_CANNOT_TOUCH_CONFIRMED');
  });

  it('o commit refaz o plano: dependentes mudados na mesma revisão → PREVIEW_TAMPERED', () => {
    const t = twoRooms();
    const plan = planWallRemoval(t, wallOf(t), 'reviewer');
    const changed = mutateScene(t, (s) => { nodeOf(s, 'sala').label = 'Outro nome'; });
    expect(code(() => plan.commit({}, changed))).toBe('PREVIEW_TAMPERED');
    expect(plan.commit({}, t).scene.nodes.some((n) => n.id === 'sala')).toBe(false);
  });

  it('previewSceneCommand continua a recusar a remoção directa de uma divisão com relações (o motor não mudou)', () => {
    const t = twoRooms();
    expect(previewSceneCommand(t, { type: 'RemoveComponent', nodeId: 'sala' }, 'reviewer').issues[0]?.code).toBe('REMOVE_HAS_DEPENDENCIES');
    expect(commitScenePreview).toBeTypeOf('function');
  });
});
