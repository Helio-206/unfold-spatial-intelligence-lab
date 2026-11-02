import { describe, expect, it } from 'vitest';
import { addOpeningToScene, editWallInScene, planWallRemoval, removeWallFromScene } from '../src/plan-scene';
import { checkBoundaryIntegrity, planRoomMerge, wallEndpointsXZ } from '../src/room-merge';
import { deserializeSceneTransaction, executeSceneCommand, serializeSceneTransaction, validateSpatialScene, type SceneTransaction, type SpatialSceneV1 } from '../src/spatial-scene';
import { insertVertex, mutateScene, nodeOf, refsOf, sceneFromRooms, setRefs, sharedWallId, shoelace, verticesOf, wallBetween, type RoomSpec } from './helpers/rooms';

const AT = '2026-11-02T09:00:00.000Z';
const A: RoomSpec = { id: 'sala', vertices: [[0, 0], [4, 0], [4, 3], [0, 3]] };
const B: RoomSpec = { id: 'cozinha', vertices: [[4, 0], [7, 0], [7, 3], [4, 3]] };
const code = (fn: () => unknown): string => { try { fn(); } catch (error) { return error instanceof Error ? error.message : String(error); } return 'NO_ERROR'; };
const roomsOf = (scene: SpatialSceneV1) => scene.nodes.filter((n) => n.component?.kind === 'room');
const xz = (room: ReturnType<typeof nodeOf>) => verticesOf(room).map((v) => [Math.round(v[0] * 1e6) / 1e6 + 0, Math.round(v[2] * 1e6) / 1e6 + 0]);
const BLOCK = 'ROOM_MERGE_BOUNDARY_INCOMPLETE';

/** Move uma parede dx em x, mantendo a ordem dos extremos (é o que o editor faz com o gizmo). */
function moveWall(t: SceneTransaction, wallId: string, dx: number, dz = 0): SceneTransaction {
  const [a, b] = wallEndpointsXZ(nodeOf(t.scene, wallId))!;
  return editWallInScene(t, wallId, { start: { x: a[0] + dx, y: a[1] + dz }, end: { x: b[0] + dx, y: b[1] + dz }, actor: 'reviewer' });
}
const mergedRoom = (t: SceneTransaction) => roomsOf(t.scene)[0]!;
/** Todas as invariantes da divisão fundida, ou a lista do que falha. */
const integrity = (scene: SpatialSceneV1, room: string) => checkBoundaryIntegrity(scene, room).map((v) => `${v.code}:${v.wallId ?? ''}`);

describe('B · o cenário do achado: parede exterior editada, fusão, edição outra vez, desfazer', () => {
  it('reprodução: depois da fusão todas as paredes de dependsOn têm boundaryRefs, e as invariantes cumprem-se', () => {
    const t0 = sceneFromRooms([A, B]);
    const left = wallBetween(t0.scene, [0, 0], [0, 3]);
    // 1. edita a parede exterior da primeira divisão (para fora, mantendo a ordem dos extremos)
    const t1 = moveWall(t0, left, -1);
    // 2. a divisão que depende dela foi actualizada
    expect(xz(nodeOf(t1.scene, 'sala'))).toEqual([[-1, 0], [4, 0], [4, -3], [-1, -3]]);
    // 3-4. pré-visualiza e funde
    const plan = planWallRemoval(t1, sharedWallId(t1.scene, 'sala', 'cozinha'), 'reviewer');
    const t2 = plan.commit({});
    const room = mergedRoom(t2);
    // 5. invariantes
    const referenced = new Set(refsOf(room).map((r) => r.wallId));
    expect(room.component!.dependsOn.filter((id) => !referenced.has(id))).toEqual([]);
    expect(integrity(t2.scene, room.id)).toEqual([]);
    expect(refsOf(room).every((r) => r.wallId !== sharedWallId(t1.scene, 'sala', 'cozinha'))).toBe(true);
    // 6. edita outra vez a parede exterior: o polígono fundido tem de a seguir
    const t3 = moveWall(t2, left, -2);
    expect(xz(mergedRoom(t3)).filter((p) => p[0]! < -3.5)).toEqual([]);
    expect(xz(mergedRoom(t3)).filter((p) => Math.abs(p[0] + 3) < 1e-6)).toHaveLength(2);
    expect(shoelace(verticesOf(mergedRoom(t3)))).toBeCloseTo(10 * 3, 6);
    expect(integrity(t3.scene, mergedRoom(t3).id)).toEqual([]);
    // 7. cada passo é uma revisão
    expect([t1, t2, t3].map((t) => t.scene.revision.number)).toEqual([t0.scene.revision.number + 1, t0.scene.revision.number + 2, t0.scene.revision.number + 3]);
    // 8. desfazer tudo volta à cena original
    let undone = t3;
    for (let i = 0; i < 3; i += 1) undone = executeSceneCommand(undone, { type: 'Undo' }, 'reviewer').transaction;
    expect(undone.scene.nodes).toEqual(t0.scene.nodes);
    expect(undone.scene.relations).toEqual(t0.scene.relations);
  });

  it('o mesmo, com a edição depois da fusão: a fusão antes de qualquer edição também segue a parede', () => {
    const t0 = sceneFromRooms([A, B]);
    const left = wallBetween(t0.scene, [0, 0], [0, 3]);
    const right = wallBetween(t0.scene, [7, 0], [7, 3]);
    const merged = removeWallFromScene(t0, sharedWallId(t0.scene, 'sala', 'cozinha'), 'reviewer');
    const after = moveWall(moveWall(merged, left, -1), right, 2);
    expect(Math.min(...xz(mergedRoom(after)).map((p) => p[0]!))).toBeCloseTo(-1, 6);
    expect(Math.max(...xz(mergedRoom(after)).map((p) => p[0]!))).toBeCloseTo(9, 6);
  });

  it('editar uma parede que fica, a de cima, depois da fusão também actualiza o polígono (as referências existem)', () => {
    const t0 = sceneFromRooms([A, B]);
    const top = wallBetween(t0.scene, [0, 3], [4, 3]);
    const merged = removeWallFromScene(moveWall(t0, wallBetween(t0.scene, [0, 0], [0, 3]), -1), sharedWallId(t0.scene, 'sala', 'cozinha'), 'reviewer');
    const edited = moveWall(merged, top, 0, -0.5);
    expect(xz(mergedRoom(edited)).some((p) => Math.abs(p[1]! - -3.5) < 1e-6)).toBe(true);
  });
});

describe('B · o que se preserva e o que se bloqueia', () => {
  const plain = () => sceneFromRooms([A, B]);
  const shared = (t: SceneTransaction) => sharedWallId(t.scene, 'sala', 'cozinha');
  const mutated = (edit: (scene: SpatialSceneV1) => void) => mutateScene(plain(), edit);
  const blocksScenePreserved = (t: SceneTransaction, expected: string) => {
    const before = serializeSceneTransaction(t);
    const result = planRoomMerge(t.scene, shared(t), AT);
    expect(result.status === 'blocked' ? result.code : result.status).toBe(expected);
    expect(code(() => planWallRemoval(t, shared(t), 'reviewer'))).toBe(expected);
    expect(code(() => removeWallFromScene(t, shared(t), 'reviewer'))).toBe(expected);
    expect(serializeSceneTransaction(t)).toBe(before);
  };

  it('cada parede que fica tem as suas referências, os índices são válidos e não sobra nenhuma da parede removida', () => {
    const t = plain();
    const merged = removeWallFromScene(t, shared(t), 'reviewer');
    const room = mergedRoom(merged);
    expect(room.component!.dependsOn).toHaveLength(6);
    expect(integrity(merged.scene, room.id)).toEqual([]);
    for (const ref of refsOf(room)) { expect(ref.startIndex).toBeGreaterThanOrEqual(0); expect(ref.endIndex).toBeLessThan(verticesOf(room).length); }
    // Nada se refere à parede removida: nem dependsOn, nem boundaryRefs, nem relações.
    expect(room.component!.dependsOn).not.toContain(shared(t));
    expect(refsOf(room).some((r) => r.wallId === shared(t))).toBe(false);
    expect(merged.scene.relations.some((r) => r.fromNodeId === shared(t) || r.toNodeId === shared(t))).toBe(false);
    expect(merged.scene.nodes.some((n) => n.id === shared(t))).toBe(false);
  });

  it('extremos das paredes em ordem invertida (e referências coerentes): funde, e a edição seguinte continua a seguir', () => {
    const t = plain();
    const top = wallBetween(t.scene, [0, 3], [4, 3]);
    const reversed = mutateScene(t, (scene) => {
      const wall = nodeOf(scene, top);
      const yaw = 2 * Math.atan2(wall.transform.rotation[1], wall.transform.rotation[3]) + Math.PI;
      wall.transform.rotation = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
      for (const room of roomsOf(scene)) setRefs(room, refsOf(room).map((r) => (r.wallId === top ? { ...r, startEndpoint: r.startEndpoint === 'a' ? 'b' : 'a', endEndpoint: r.endEndpoint === 'a' ? 'b' : 'a' } : r)));
    });
    const merged = removeWallFromScene(reversed, shared(reversed), 'reviewer');
    expect(integrity(merged.scene, mergedRoom(merged).id)).toEqual([]);
    const edited = moveWall(merged, top, 0, -1);
    expect(xz(mergedRoom(edited)).filter((p) => Math.abs(p[1]! - -4) < 1e-6)).toHaveLength(2);
  });

  it('extremos invertidos sem actualizar as referências (incoerente): bloqueado em vez de seguir para o lado errado', () => {
    const t = plain();
    const top = wallBetween(t.scene, [0, 3], [4, 3]);
    const broken = mutateScene(t, (scene) => {
      const wall = nodeOf(scene, top);
      const yaw = 2 * Math.atan2(wall.transform.rotation[1], wall.transform.rotation[3]) + Math.PI;
      wall.transform.rotation = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
    });
    blocksScenePreserved(broken, BLOCK);
  });

  it('paredes que cobrem arestas colineares (4×6 ao lado de 3×3): referências completas e edição seguinte segue', () => {
    const tall: RoomSpec = { id: 'sala', vertices: [[0, 0], [4, 0], [4, 6], [0, 6]] };
    const small: RoomSpec = { id: 'cozinha', vertices: [[4, 0], [7, 0], [7, 3], [4, 3]] };
    const t = sceneFromRooms([tall, small]);
    const merged = removeWallFromScene(t, wallBetween(t.scene, [4, 0], [4, 3]), 'reviewer');
    expect(integrity(merged.scene, mergedRoom(merged).id)).toEqual([]);
    const upper = wallBetween(t.scene, [4, 3], [4, 6]);
    expect(refsOf(mergedRoom(merged)).some((r) => r.wallId === upper)).toBe(true);
    const edited = moveWall(merged, upper, 1);
    expect(xz(mergedRoom(edited)).some((p) => Math.abs(p[0]! - 5) < 1e-6)).toBe(true);
  });

  it('vértices partilhados e juntas: o vértice onde duas paredes se encontram fica, e cada parede tem os seus extremos', () => {
    const t = plain();
    const merged = removeWallFromScene(t, shared(t), 'reviewer');
    const room = mergedRoom(merged);
    const byWall: Record<string, ReturnType<typeof refsOf>> = {};
    for (const ref of refsOf(room)) (byWall[ref.wallId] ??= []).push(ref);
    expect(Object.keys(byWall)).toHaveLength(6);
    // as duas paredes de cima encontram-se em (4,3): partilham exactamente um vértice
    const vertexSet = (ref: (typeof byWall)[string][number]) => new Set([ref.startIndex, ref.endIndex]);
    const left = vertexSet(byWall[wallBetween(t.scene, [0, 3], [4, 3])]![0]!);
    const right = vertexSet(byWall[wallBetween(t.scene, [4, 3], [7, 3])]![0]!);
    expect([...left].filter((index) => right.has(index))).toHaveLength(1);
  });

  it('divisão não rectangular (L) com um anexo: referências completas e a edição de uma parede do anexo segue', () => {
    const L: RoomSpec = { id: 'ele', vertices: [[0, 0], [6, 0], [6, 2], [2, 2], [2, 5], [0, 5]] };
    const annex: RoomSpec = { id: 'anexo', vertices: [[6, 0], [9, 0], [9, 2], [6, 2]] };
    const t = sceneFromRooms([L, annex]);
    const merged = removeWallFromScene(t, wallBetween(t.scene, [6, 0], [6, 2]), 'reviewer');
    expect(integrity(merged.scene, mergedRoom(merged).id)).toEqual([]);
    const edited = moveWall(merged, wallBetween(t.scene, [9, 0], [9, 2]), 1);
    expect(Math.max(...xz(mergedRoom(edited)).map((p) => p[0]!))).toBeCloseTo(10, 6);
    expect(shoelace(verticesOf(mergedRoom(merged)))).toBeCloseTo(24, 9);
  });

  it('as referências sobrevivem à serialização e ao restauro, e a edição continua a seguir', () => {
    const t = plain();
    const merged = removeWallFromScene(t, shared(t), 'reviewer');
    const restored = deserializeSceneTransaction(serializeSceneTransaction(merged));
    expect(refsOf(mergedRoom(restored))).toEqual(refsOf(mergedRoom(merged)));
    expect(integrity(restored.scene, mergedRoom(restored).id)).toEqual([]);
    const edited = moveWall(restored, wallBetween(t.scene, [0, 0], [0, 3]), -1);
    expect(Math.min(...xz(mergedRoom(edited)).map((p) => p[0]!))).toBeCloseTo(-1, 6);
  });

  it('vértices colineares sem parede (acrescentados com referências coerentes) saem; os que uma parede referencia ficam', () => {
    const t = mutated((scene) => { insertVertex(scene, 'sala', 1, [2, 0, 0]); });
    const merged = removeWallFromScene(t, shared(t), 'reviewer');
    expect(verticesOf(mergedRoom(merged))).toHaveLength(6);
    expect(integrity(merged.scene, mergedRoom(merged).id)).toEqual([]);
  });

  it('as aberturas das paredes que ficam sobrevivem e seguem a edição; as da parede removida saem', () => {
    const base = plain();
    const top = wallBetween(base.scene, [0, 3], [4, 3]);
    const withDoors = addOpeningToScene(addOpeningToScene(base, top, { id: 'porta-cima', kind: 'door', offsetM: 1, widthM: 0.9, heightM: 2.05, sillM: 0, actor: 'u' }), shared(base), { id: 'porta-meio', kind: 'door', offsetM: 1, widthM: 0.9, heightM: 2.05, sillM: 0, actor: 'u' });
    const merged = removeWallFromScene(withDoors, shared(withDoors), 'reviewer');
    expect(merged.scene.nodes.some((n) => n.id === 'porta-meio')).toBe(false);
    expect(merged.scene.nodes.some((n) => n.id === 'porta-cima')).toBe(true);
    const doorBefore = nodeOf(merged.scene, 'porta-cima').transform.translationM[2];
    const edited = moveWall(merged, top, 0, -1);
    expect(nodeOf(edited.scene, 'porta-cima').transform.translationM[2]).toBeCloseTo(doorBefore! - 1, 6);
  });

  it('uma coisa que depende de uma das divisões: o motor continua a recusar (REMOVE_HAS_DEPENDENCIES) e a cena fica igual', () => {
    const t = mutated((scene) => { const m = structuredClone(nodeOf(scene, 'cozinha')); m.id = 'mesa'; m.label = 'Mesa'; m.geometry = null; m.component = { kind: 'furniture', dependsOn: ['cozinha'], properties: {} }; scene.nodes.push(m); });
    const before = serializeSceneTransaction(t);
    expect(code(() => removeWallFromScene(t, shared(t), 'reviewer'))).toBe('REMOVE_HAS_DEPENDENCIES');
    expect(serializeSceneTransaction(t)).toBe(before);
  });

  describe('referências inválidas ou em falta nas divisões de partida: bloqueia, nunca filtra e segue', () => {
    it('a divisão não tem a propriedade boundaryRefs', () => { blocksScenePreserved(mutated((s) => { delete nodeOf(s, 'sala').component!.properties.boundaryRefs; }), BLOCK); });
    it('boundaryRefs não é JSON', () => { blocksScenePreserved(mutated((s) => setRefs(nodeOf(s, 'cozinha'), '{não é json')), BLOCK); });
    it('boundaryRefs não é uma lista de referências bem formadas', () => { blocksScenePreserved(mutated((s) => setRefs(nodeOf(s, 'sala'), [{ wallId: 3 }])), BLOCK); });
    it('uma referência aponta para uma parede que não existe', () => { blocksScenePreserved(mutated((s) => { const room = nodeOf(s, 'sala'); setRefs(room, refsOf(room).map((r, i) => (i === 0 ? { ...r, wallId: 'wall-fantasma' } : r))); }), BLOCK); });
    it('um índice de vértice fora do polígono', () => { blocksScenePreserved(mutated((s) => { const room = nodeOf(s, 'cozinha'); setRefs(room, refsOf(room).map((r, i) => (i === 1 ? { ...r, endIndex: 99 } : r))); }), BLOCK); });
    it('um extremo que não é a nem b', () => { blocksScenePreserved(mutated((s) => { const room = nodeOf(s, 'sala'); setRefs(room, refsOf(room).map((r, i) => (i === 0 ? { ...r, startEndpoint: 'c' } : r))); }), BLOCK); });
    it('uma parede em dependsOn sem nenhuma referência (o caso do achado)', () => {
      blocksScenePreserved(mutated((s) => { const room = nodeOf(s, 'sala'); const top = wallBetween(s, [0, 3], [4, 3]); setRefs(room, refsOf(room).filter((r) => r.wallId !== top)); }), BLOCK);
    });
    it('uma dependência da divisão que não é uma parede (o esquema não deixa apontar para um nó que não existe)', () => {
      blocksScenePreserved(mutated((s) => { const room = nodeOf(s, 'sala'); const door = structuredClone(nodeOf(s, 'cozinha')); door.id = 'porta-x'; door.label = 'Porta'; door.geometry = null; door.component = { kind: 'door', dependsOn: [], properties: {} }; s.nodes.push(door); room.component!.dependsOn.push('porta-x'); }), BLOCK);
    });
    it('uma referência a uma parede que não está em dependsOn da divisão', () => { blocksScenePreserved(mutated((s) => { const room = nodeOf(s, 'sala'); room.component!.dependsOn = room.component!.dependsOn.filter((id) => id !== wallBetween(s, [0, 3], [4, 3])); }), BLOCK); });
    it('referências contraditórias: o mesmo vértice com dois extremos diferentes', () => {
      blocksScenePreserved(mutated((s) => { const room = nodeOf(s, 'sala'); const refs = refsOf(room); const first = refs.find((r) => r.wallId !== shared(plain()))!; setRefs(room, [...refs, { ...first, startEndpoint: first.startEndpoint === 'a' ? 'b' : 'a' }]); }), BLOCK);
    });
    it('uma referência de outra parede que aponta para um vértice dentro do troço partilhado (a união não o tem)', () => {
      blocksScenePreserved(mutated((s) => {
        const room = nodeOf(s, 'sala');
        const at = verticesOf(room).findIndex((v) => Math.abs(v[0] - 4) < 1e-9 && Math.abs(v[2]) < 1e-9) + 1;
        insertVertex(s, 'sala', at, [4, 0, -1.5]);
        const top = wallBetween(s, [0, 3], [4, 3]);
        setRefs(room, refsOf(room).map((r) => (r.wallId === top ? { ...r, endIndex: at } : r)));
      }), BLOCK);
    });
    it('os extremos recordados já não correspondem ao vértice (o vértice está do lado oposto da parede)', () => {
      blocksScenePreserved(mutated((s) => { const room = nodeOf(s, 'sala'); const top = wallBetween(s, [0, 3], [4, 3]); setRefs(room, refsOf(room).map((r) => (r.wallId === top ? { ...r, startEndpoint: r.startEndpoint === 'a' ? 'b' : 'a', endEndpoint: r.endEndpoint === 'a' ? 'b' : 'a' } : r))); }), BLOCK);
    });
  });

  it('duas referências iguais na mesma divisão são só uma depois da fusão', () => {
    const t = mutated((s) => { const room = nodeOf(s, 'sala'); const refs = refsOf(room); setRefs(room, [...refs, refs[0]!]); });
    const merged = removeWallFromScene(t, shared(t), 'reviewer');
    const keys = refsOf(mergedRoom(merged)).map((r) => JSON.stringify(r));
    expect(new Set(keys).size).toBe(keys.length);
    expect(integrity(merged.scene, mergedRoom(merged).id)).toEqual([]);
  });

  it('o id da divisão e das referências é determinístico', () => {
    const one = removeWallFromScene(plain(), shared(plain()), 'reviewer');
    const two = removeWallFromScene(plain(), shared(plain()), 'reviewer');
    expect(refsOf(mergedRoom(one))).toEqual(refsOf(mergedRoom(two)));
    expect(mergedRoom(one).id).toBe(mergedRoom(two).id);
  });

  it('a cena resultante é válida (o esquema aceita-a)', () => {
    const t = plain();
    expect(() => validateSpatialScene(removeWallFromScene(t, shared(t), 'reviewer').scene)).not.toThrow();
  });
});

describe('checkBoundaryIntegrity: o verificador de invariantes, para outras operações reutilizarem', () => {
  const merged = () => { const t = sceneFromRooms([A, B]); const m = removeWallFromScene(t, sharedWallId(t.scene, 'sala', 'cozinha'), 'reviewer'); return { scene: m.scene, room: mergedRoom(m).id, removed: sharedWallId(t.scene, 'sala', 'cozinha') }; };
  const codes = (scene: SpatialSceneV1, room: string, removed: string[] = []) => checkBoundaryIntegrity(scene, room, { removedWallIds: removed }).map((v) => v.code);
  const edit = (change: (scene: SpatialSceneV1, room: ReturnType<typeof nodeOf>) => void) => { const { scene, room, removed } = merged(); const copy = structuredClone(scene); change(copy, nodeOf(copy, room)); return { scene: copy, room, removed }; };
  const after = (change: (scene: SpatialSceneV1, room: ReturnType<typeof nodeOf>) => void) => { const { scene, room } = edit(change); return codes(scene, room); };

  it('uma divisão consistente não tem violações', () => { const { scene, room, removed } = merged(); expect(codes(scene, room, [removed])).toEqual([]); });
  it('uma divisão que não existe ou não é uma divisão', () => { const { scene } = merged(); expect(codes(scene, 'nao-existe')).toEqual(['NOT_A_ROOM']); expect(codes(scene, scene.nodes.find((n) => n.component?.kind === 'wall')!.id)).toEqual(['NOT_A_ROOM']); });
  it('referências ilegíveis', () => { const { scene, room } = edit((_s, r) => setRefs(r, 'x')); expect(codes(scene, room)).toEqual(['UNREADABLE_REFS']); });
  it('parede em falta nas referências', () => { const { scene, room } = edit((_s, r) => setRefs(r, refsOf(r).slice(1))); expect(codes(scene, room)).toContain('MISSING_REF'); });
  it('referência a uma parede que não é de dependsOn (obsoleta)', () => { const { scene, room } = edit((_s, r) => r.component!.dependsOn.pop()); expect(codes(scene, room)).toContain('STALE_REF'); });
  it('a parede removida ainda referenciada', () => { const { scene, room, removed } = merged(); const copy = structuredClone(scene); nodeOf(copy, room).component!.dependsOn.push(removed); expect(codes(copy, room, [removed])).toContain('STALE_REF'); });
  it('parede desconhecida', () => { const { scene, room } = edit((s, r) => { r.component!.dependsOn.push('fantasma'); setRefs(r, [...refsOf(r), { wallId: 'fantasma', startIndex: 0, endIndex: 1, startEndpoint: 'a', endEndpoint: 'b' }]); void s; }); expect(codes(scene, room)).toContain('UNKNOWN_WALL'); });
  it('índice fora do polígono ou igual nas duas pontas', () => {
    expect(after((_s, r) => setRefs(r, refsOf(r).map((x, i) => (i === 0 ? { ...x, endIndex: 50 } : x))))).toContain('BAD_INDEX');
    expect(after((_s, r) => setRefs(r, refsOf(r).map((x, i) => (i === 0 ? { ...x, endIndex: x.startIndex } : x))))).toContain('BAD_INDEX');
  });
  it('extremo inválido', () => { const { scene, room } = edit((_s, r) => setRefs(r, refsOf(r).map((x, i) => (i === 0 ? { ...x, startEndpoint: 'z' } : x)))); expect(codes(scene, room)).toContain('BAD_ENDPOINT'); });
  it('extremo incoerente com a geometria (o vértice está mais perto do outro extremo)', () => { const { scene, room } = edit((_s, r) => setRefs(r, refsOf(r).map((x, i) => (i === 0 ? { ...x, startEndpoint: x.startEndpoint === 'a' ? 'b' : 'a', endEndpoint: x.endEndpoint === 'a' ? 'b' : 'a' } : x)))); expect(codes(scene, room)).toContain('INCONSISTENT_ENDPOINT'); });
  it('referência repetida e referência contraditória', () => {
    expect(after((_s, r) => setRefs(r, [...refsOf(r), refsOf(r)[0]!]))).toContain('DUPLICATE_REF');
    expect(after((_s, r) => { const first = refsOf(r)[0]!; const n = verticesOf(r).length; let other = (first.endIndex + 1) % n; if (other === first.startIndex) other = (other + 1) % n; setRefs(r, [...refsOf(r), { ...first, endIndex: other }]); })).toContain('CONTRADICTORY_REF');
  });
});
