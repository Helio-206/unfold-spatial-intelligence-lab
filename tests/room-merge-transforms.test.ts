import { describe, expect, it } from 'vitest';
import { planWallRemoval, removeWallFromScene } from '../src/plan-scene';
import { explainSceneError } from '../src/scene-messages';
import { planRoomMerge, type RoomMergeResult } from '../src/room-merge';
import { executeSceneCommand, serializeSceneTransaction, type Node, type SceneTransaction, type SpatialSceneV1 } from '../src/spatial-scene';
import { mutateScene, nodeOf, sceneFromRooms, sharedWallId, type RoomSpec } from './helpers/rooms';

const AT = '2026-11-02T09:00:00.000Z';
const A: RoomSpec = { id: 'sala', vertices: [[0, 0], [4, 0], [4, 3], [0, 3]] };
const B: RoomSpec = { id: 'cozinha', vertices: [[4, 0], [7, 0], [7, 3], [4, 3]] };
const C: RoomSpec = { id: 'despensa', vertices: [[10, 0], [13, 0], [13, 3], [10, 3]] };
const code = (fn: () => unknown): string => { try { fn(); } catch (error) { return error instanceof Error ? error.message : String(error); } return 'NO_ERROR'; };
const status = (result: RoomMergeResult) => (result.status === 'blocked' ? result.code : result.status);

const SQRT_HALF = Math.SQRT1_2;
const TRANSFORMS: Array<[string, (node: Node) => void]> = [
  ['deslocada 100 m', (n) => { n.transform.translationM = [100, 0, 0]; }],
  ['deslocada 1 mm (qualquer deslocamento conta)', (n) => { n.transform.translationM = [0.001, 0, 0]; }],
  ['rodada 90° em torno de Y', (n) => { n.transform.rotation = [0, SQRT_HALF, 0, SQRT_HALF]; }],
  ['rodada 1° em torno de Y', (n) => { const h = Math.PI / 360; n.transform.rotation = [0, Math.sin(h), 0, Math.cos(h)]; }],
  ['rodada em torno de X', (n) => { n.transform.rotation = [SQRT_HALF, 0, 0, SQRT_HALF]; }],
  ['com escala 2×', (n) => { n.transform.scale = [2, 1, 1]; }],
  ['com escala 1,001', (n) => { n.transform.scale = [1.001, 1.001, 1.001]; }],
  ['elevada 1 m em y', (n) => { n.transform.translationM = [0, 1, 0]; }],
];

/** Mete a divisão (ou parede) num grupo que tem a transformada dada: a hierarquia também conta. */
function underGroup(scene: SpatialSceneV1, id: string, translationM: [number, number, number]): void {
  const holder = nodeOf(scene, 'sala');
  const group: Node = {
    id: 'grupo', label: 'Grupo', nodeType: 'group', parentId: null, component: null, geometry: null, properties: {},
    transform: { translationM, rotation: [0, 0, 0, 1], scale: [1, 1, 1], provenance: structuredClone(holder.transform.provenance) },
  };
  scene.nodes.push(group);
  nodeOf(scene, id).parentId = 'grupo';
}

describe('A · uma divisão com transformada própria não se funde (o polígono está em coordenadas locais)', () => {
  const base = () => sceneFromRooms([A, B]);
  const shared = (t: SceneTransaction) => sharedWallId(t.scene, 'sala', 'cozinha');

  it('controlo: duas divisões sem transformada fundem-se como antes (21 m²)', () => {
    const t = base();
    expect(status(planRoomMerge(t.scene, shared(t), AT))).toBe('merge');
  });

  it.each(TRANSFORMS)('uma das divisões %s: bloqueada, com o código próprio', (_label, apply) => {
    for (const room of ['sala', 'cozinha']) {
      const t = mutateScene(base(), (s) => apply(nodeOf(s, room)));
      expect(status(planRoomMerge(t.scene, shared(t), AT)), room).toBe('ROOM_MERGE_UNSUPPORTED_TRANSFORM');
    }
  });

  it('a divisão dentro de um grupo (transformada do pai) também: bloqueada, mesmo com o grupo na origem', () => {
    for (const translation of [[50, 0, 0], [0, 0, 0]] as Array<[number, number, number]>) {
      const t = mutateScene(base(), (s) => underGroup(s, 'cozinha', translation));
      expect(status(planRoomMerge(t.scene, shared(t), AT))).toBe('ROOM_MERGE_UNSUPPORTED_TRANSFORM');
    }
  });

  it('o mesmo para as paredes que o motor usa (a removida e as que ficam): o polígono compara-se com os extremos delas', () => {
    const t = base();
    const remaining = nodeOf(t.scene, 'sala').component!.dependsOn.find((id) => id !== shared(t))!;
    for (const [wall, label] of [[shared(t), 'a removida'], [remaining, 'uma que fica']] as const) {
      for (const [name, apply] of [
        ['rodada em X', (n: Node) => { n.transform.rotation = [SQRT_HALF, 0, 0, SQRT_HALF]; }],
        ['com escala', (n: Node) => { n.transform.scale = [2, 1, 1]; }],
      ] as Array<[string, (n: Node) => void]>) {
        const mutated = mutateScene(t, (s) => apply(nodeOf(s, wall)));
        expect(status(planRoomMerge(mutated.scene, shared(mutated), AT)), `${label} ${name}`).toBe('ROOM_MERGE_UNSUPPORTED_TRANSFORM');
      }
      const grouped = mutateScene(t, (s) => underGroup(s, wall, [0, 0, 0]));
      expect(status(planRoomMerge(grouped.scene, shared(grouped), AT)), `${label} em grupo`).toBe('ROOM_MERGE_UNSUPPORTED_TRANSFORM');
    }
  });

  it('ruído numérico na identidade e o quaternião oposto (a mesma rotação) não contam como transformada', () => {
    const t = mutateScene(base(), (s) => {
      nodeOf(s, 'cozinha').transform.translationM = [1e-13, 0, -1e-13];
      nodeOf(s, 'cozinha').transform.rotation = [0, 0, 0, -1];
      nodeOf(s, 'sala').transform.scale = [1 + 1e-13, 1, 1];
    });
    expect(status(planRoomMerge(t.scene, shared(t), AT))).toBe('merge');
  });

  it('uma divisão que não entra na fusão pode ter transformada: não é tocada e volta tal e qual com o desfazer', () => {
    const t = mutateScene(sceneFromRooms([A, B, C]), (s) => { nodeOf(s, 'despensa').transform.translationM = [3, 0, 0]; nodeOf(s, 'despensa').transform.rotation = [0, SQRT_HALF, 0, SQRT_HALF]; nodeOf(s, 'despensa').transform.scale = [1, 2, 1]; });
    const merged = removeWallFromScene(t, shared(t), 'reviewer');
    expect(nodeOf(merged.scene, 'despensa')).toEqual(nodeOf(t.scene, 'despensa'));
    const { transaction: undone } = executeSceneCommand(merged, { type: 'Undo' }, 'reviewer');
    expect(undone.scene.nodes).toEqual(t.scene.nodes);
    expect(undone.scene.relations).toEqual(t.scene.relations);
    expect(nodeOf(undone.scene, 'despensa').transform).toEqual(nodeOf(t.scene, 'despensa').transform);
  });

  describe('a recusa não altera nada', () => {
    it.each(TRANSFORMS)('divisão %s: planear e remover recusam e a cena serializada fica igual', (_label, apply) => {
      const t = mutateScene(base(), (s) => apply(nodeOf(s, 'cozinha')));
      const before = serializeSceneTransaction(t);
      expect(code(() => planWallRemoval(t, shared(t), 'reviewer'))).toBe('ROOM_MERGE_UNSUPPORTED_TRANSFORM');
      expect(code(() => removeWallFromScene(t, shared(t), 'reviewer'))).toBe('ROOM_MERGE_UNSUPPORTED_TRANSFORM');
      expect(serializeSceneTransaction(t)).toBe(before);
    });
  });

  it('pré-visualizar e cancelar (não confirmar) deixa a cena como estava, com e sem transformada', () => {
    const ok = base();
    const beforeOk = serializeSceneTransaction(ok);
    const plan = planWallRemoval(ok, shared(ok), 'reviewer');
    expect(plan.merge?.status).toBe('merge');
    expect(serializeSceneTransaction(ok)).toBe(beforeOk);
    const moved = mutateScene(base(), (s) => { nodeOf(s, 'cozinha').transform.translationM = [100, 0, 0]; });
    const beforeMoved = serializeSceneTransaction(moved);
    expect(code(() => planWallRemoval(moved, shared(moved), 'reviewer'))).toBe('ROOM_MERGE_UNSUPPORTED_TRANSFORM');
    expect(serializeSceneTransaction(moved)).toBe(beforeMoved);
  });

  it('desfazer uma fusão limpa repõe a geometria e as transformadas exactamente', () => {
    const t = base();
    const merged = removeWallFromScene(t, shared(t), 'reviewer');
    const { transaction: undone } = executeSceneCommand(merged, { type: 'Undo' }, 'reviewer');
    expect(undone.scene.nodes).toEqual(t.scene.nodes);
    for (const room of ['sala', 'cozinha']) expect(nodeOf(undone.scene, room).transform).toEqual(nodeOf(t.scene, room).transform);
  });

  it('a divisão fundida fica no referencial da cena (identidade), porque as que a originaram estavam lá', () => {
    const t = base();
    const merged = removeWallFromScene(t, shared(t), 'reviewer');
    const room = merged.scene.nodes.find((n) => n.component?.kind === 'room')!;
    expect(room).toMatchObject({ parentId: null, transform: { translationM: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } });
  });

  it('a frase explica o limite e diz o que fazer', () => {
    const message = explainSceneError('ROOM_MERGE_UNSUPPORTED_TRANSFORM');
    expect(message).toMatch(/posição, rotação, escala ou grupo/);
    expect(message).toMatch(/referencial da cena/);
    expect(message).not.toContain('ROOM_MERGE');
  });
});
