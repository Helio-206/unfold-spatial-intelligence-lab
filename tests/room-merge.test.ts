import { describe, expect, it } from 'vitest';
import { summarizeReport } from '../src/core';
import { ROOM_MERGE_TOLERANCE_M, planRoomMerge, type RoomMergeResult } from '../src/room-merge';
import { validateSpatialScene, type Node } from '../src/spatial-scene';
import { boundedBy, dropVertexKeepRefs, insertVertex, mutateScene, nodeOf, sceneFromRooms, sharedWallId, shoelace, wallBetween, type RoomSpec } from './helpers/rooms';

const AT = '2026-11-02T09:00:00.000Z';
const merged = (result: RoomMergeResult) => { if (result.status !== 'merge') throw new Error(`esperava merge, obtive ${JSON.stringify(result)}`); return result; };
const blockedCode = (result: RoomMergeResult) => (result.status === 'blocked' ? result.code : result.status);
const polygon = (node: Node) => { if (node.geometry?.kind !== 'polygon') throw new Error('sem polígono'); return node.geometry.verticesM; };
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

// Contas à mão. Sala A 4×3 = 12 m², sala B 3×3 = 9 m², ao lado uma da outra, a aresta de 3 m (x = 4) é partilhada.
const A: RoomSpec = { id: 'sala', vertices: [[0, 0], [4, 0], [4, 3], [0, 3]] };
const B: RoomSpec = { id: 'cozinha', vertices: [[4, 0], [7, 0], [7, 3], [4, 3]] };

describe('fusão de duas divisões: o caso limpo', () => {
  it('4×3 e 3×3 com a aresta de 3 m partilhada dão 7×3 = 21 m², e 12 + 9 = 21', () => {
    const scene = sceneFromRooms([A, B]).scene;
    const result = merged(planRoomMerge(scene, sharedWallId(scene, 'sala', 'cozinha'), AT));
    const vertices = polygon(result.merged);
    expect(shoelace(polygon(nodeOf(scene, 'sala')))).toBeCloseTo(12, 12);
    expect(shoelace(polygon(nodeOf(scene, 'cozinha')))).toBeCloseTo(9, 12);
    expect(rel(shoelace(vertices), 21)).toBeLessThan(1e-9);
    expect(result.areas.merged).toBeCloseTo(21, 9);
    expect(result.areas.first + result.areas.second).toBeCloseTo(21, 9);
    // 7 m em x e 3 m em z: o rectângulo dos extremos.
    const xs = vertices.map((v) => v[0]); const zs = vertices.map((v) => v[2]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(7, 9);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(3, 9);
  });

  it('o polígono tem os 6 vértices de junção das paredes que ficam (os do topo e da base onde a parede removida acabava)', () => {
    // As paredes de topo e de base de A e B são distintas e acabam em x = 4: esses vértices ficam, são juntas de paredes.
    const scene = sceneFromRooms([A, B]).scene;
    const result = merged(planRoomMerge(scene, sharedWallId(scene, 'sala', 'cozinha'), AT));
    const corners = polygon(result.merged).map(([x, , z]) => `${Math.round(x * 1000) / 1000},${Math.round(-z * 1000) / 1000}`).sort();
    expect(corners).toEqual(['0,0', '0,3', '4,0', '4,3', '7,0', '7,3']);
  });

  it('é um nó novo, derived e unreviewed, sem nada herdado das originais', () => {
    const scene = sceneFromRooms([A, B]).scene;
    const result = merged(planRoomMerge(scene, sharedWallId(scene, 'sala', 'cozinha'), AT));
    const node = result.merged;
    expect(['sala', 'cozinha']).not.toContain(node.id);
    expect(scene.nodes.some((existing) => existing.id === node.id)).toBe(false);
    expect(node).toMatchObject({ nodeType: 'component', parentId: null, component: { kind: 'room' } });
    const provenances = [node.geometry!.provenance, ...Object.values(node.transform.provenance), ...Object.values(node.component!.properties).map((property) => property.provenance)];
    expect(provenances.every((p) => p.source === 'derived' && p.validation === 'unreviewed' && p.recordedAt === AT)).toBe(true);
    expect(node.component!.properties.area).toMatchObject({ unit: 'm2', provenance: { source: 'derived', validation: 'unreviewed' } });
    expect(Number(node.component!.properties.area!.value)).toBeCloseTo(21, 9);
    expect(JSON.stringify(node)).not.toMatch(/"validation":"(verified|corrected)"/);
  });

  it('o id é determinístico e o resultado não depende da ordem em que as divisões estão na cena', () => {
    const forward = sceneFromRooms([A, B]).scene;
    const backward = sceneFromRooms([B, A]).scene;
    const first = merged(planRoomMerge(forward, sharedWallId(forward, 'sala', 'cozinha'), AT));
    const again = merged(planRoomMerge(forward, sharedWallId(forward, 'sala', 'cozinha'), AT));
    const reversed = merged(planRoomMerge(backward, sharedWallId(backward, 'sala', 'cozinha'), AT));
    expect(again.merged).toEqual(first.merged);
    expect(reversed.merged.id).toBe(first.merged.id);
    expect(reversed.areas.merged).toBeCloseTo(first.areas.merged, 9);
  });

  it('dependsOn é a união das paredes das duas divisões menos a removida; relações e boundaryRefs refeitos a partir das que ficam', () => {
    const scene = sceneFromRooms([A, B]).scene;
    const wall = sharedWallId(scene, 'sala', 'cozinha');
    const result = merged(planRoomMerge(scene, wall, AT));
    const expected = [...new Set([...nodeOf(scene, 'sala').component!.dependsOn, ...nodeOf(scene, 'cozinha').component!.dependsOn])].filter((id) => id !== wall);
    expect(expected).toHaveLength(6);
    expect([...result.merged.component!.dependsOn].sort()).toEqual([...expected].sort());
    expect(result.relations.map((r) => [r.fromNodeId, r.toNodeId, r.kind]).sort()).toEqual(expected.map((w) => [result.merged.id, w, 'bounded_by']).sort());
    expect(result.relations.every((r) => r.provenance.source === 'derived' && r.provenance.validation === 'unreviewed')).toBe(true);
    const refs = JSON.parse(String(result.merged.component!.properties.boundaryRefs!.value)) as Array<{ wallId: string; startIndex: number; endIndex: number }>;
    expect(refs.map((ref) => ref.wallId).sort()).toEqual([...expected].sort());
    const vertices = polygon(result.merged);
    for (const ref of refs) { expect(vertices[ref.startIndex]).toBeDefined(); expect(vertices[ref.endIndex]).toBeDefined(); }
    expect(result.removedRelationIds.sort()).toEqual(scene.relations.filter((r) => ['sala', 'cozinha'].includes(r.fromNodeId)).map((r) => r.id).sort());
  });

  it('o nó novo e as relações cabem na cena (esquema válido) depois de as duas divisões saírem', () => {
    const scene = structuredClone(sceneFromRooms([A, B]).scene);
    const wall = sharedWallId(scene, 'sala', 'cozinha');
    const result = merged(planRoomMerge(scene, wall, AT));
    scene.nodes = [...scene.nodes.filter((n) => !['sala', 'cozinha', wall].includes(n.id)), result.merged];
    scene.relations = [...scene.relations.filter((r) => !['sala', 'cozinha'].includes(r.fromNodeId)), ...result.relations];
    expect(() => validateSpatialScene(scene)).not.toThrow();
  });

  it('não altera a cena de entrada', () => {
    const scene = sceneFromRooms([A, B]).scene;
    const before = JSON.stringify(scene);
    planRoomMerge(scene, sharedWallId(scene, 'sala', 'cozinha'), AT);
    expect(JSON.stringify(scene)).toBe(before);
  });
});

describe('fusão: formas, orientação e vértices a mais', () => {
  const sceneOf = (rooms: RoomSpec[]) => sceneFromRooms(rooms);
  it('divisão em L: o braço de 6×2 e o seu vizinho 3×2 dão 18 + 6 = 24 m²', () => {
    // L: 6×2 + 2×3 = 12 + 6 = 18 m². Vizinha: (6,0)-(9,0)-(9,2)-(6,2) = 3×2 = 6 m². Partilham a parede x = 6, y de 0 a 2.
    const L: RoomSpec = { id: 'ele', vertices: [[0, 0], [6, 0], [6, 2], [2, 2], [2, 5], [0, 5]] };
    const N: RoomSpec = { id: 'anexo', vertices: [[6, 0], [9, 0], [9, 2], [6, 2]] };
    const scene = sceneFromRooms([L, N]).scene;
    expect(shoelace(polygon(nodeOf(scene, 'ele')))).toBeCloseTo(18, 12);
    const result = merged(planRoomMerge(scene, wallBetween(scene, [6, 0], [6, 2]), AT));
    expect(result.areas).toMatchObject({ first: expect.closeTo(18, 9), second: expect.closeTo(6, 9) });
    expect(rel(shoelace(polygon(result.merged)), 24)).toBeLessThan(1e-9);
  });

  it('duas divisões que partilham dois troços seguidos (em L): remover só uma das paredes ficaria com uma fenda e é bloqueado', () => {
    // O L (18 m²) e o rectângulo que lhe preenche o canto, (2,2)-(6,5) = 4×3 = 12 m², juntos dariam 6×5 = 30 m², mas partilham
    // a aresta (2,2)-(6,2) e também (2,2)-(2,5). Remover só a primeira deixava a segunda como contacto: a união teria um corte.
    const L: RoomSpec = { id: 'ele', vertices: [[0, 0], [6, 0], [6, 2], [2, 2], [2, 5], [0, 5]] };
    const fill: RoomSpec = { id: 'canto', vertices: [[2, 2], [6, 2], [6, 5], [2, 5]] };
    const scene = sceneFromRooms([L, fill]).scene;
    expect(blockedCode(planRoomMerge(scene, wallBetween(scene, [2, 2], [6, 2]), AT))).toBe('ROOM_MERGE_TOUCH_ELSEWHERE');
  });

  it('a vizinha é mais alta do que a divisão (4×3 e 4×5, parede de 3 m): 12 + 20 = 32 m², com o canto em (4,3) a ficar saliente', () => {
    // A aresta esquerda da vizinha (de y = 0 a 5) é dividida em (4,3), onde a divisão acaba: a parede de 3 m coincide com uma aresta
    // inteira de cada uma. Na união, (4,3) é um canto reentrante e (4,0) uma junção das paredes de baixo.
    const room: RoomSpec = { id: 'sala', vertices: [[0, 0], [4, 0], [4, 3], [0, 3]] };
    const tall: RoomSpec = { id: 'cozinha', vertices: [[4, 0], [8, 0], [8, 5], [4, 5]] };
    const scene = sceneOf([room, tall]).scene;
    const result = merged(planRoomMerge(scene, wallBetween(scene, [4, 0], [4, 3]), AT));
    expect(result.areas.first + result.areas.second).toBeCloseTo(32, 9);
    expect(rel(shoelace(polygon(result.merged)), 32)).toBeLessThan(1e-9);
    const corners = polygon(result.merged).map(([x, , z]) => `${Math.round(x * 1000) / 1000},${Math.round(-z * 1000) / 1000}`).sort();
    expect(corners).toEqual(['0,0', '0,3', '4,0', '4,3', '4,5', '8,0', '8,5']);
  });

  it.each([
    ['sentido anti-horário', A, B],
    ['sentido horário', { ...A, vertices: [...A.vertices].reverse() }, { ...B, vertices: [...B.vertices].reverse() }],
    ['uma de cada sentido', A, { ...B, vertices: [...B.vertices].reverse() }],
    ['começando noutro vértice', { ...A, vertices: [...A.vertices.slice(2), ...A.vertices.slice(0, 2)] }, { ...B, vertices: [...B.vertices.slice(1), ...B.vertices.slice(0, 1)] }],
  ] as Array<[string, RoomSpec, RoomSpec]>)('polígonos em %s dão 21 m²', (_label, first, second) => {
    const scene = sceneFromRooms([first, second]).scene;
    const result = merged(planRoomMerge(scene, sharedWallId(scene, 'sala', 'cozinha'), AT));
    expect(rel(shoelace(polygon(result.merged)), 21)).toBeLessThan(1e-9);
    expect(polygon(result.merged)).toHaveLength(6);
  });

  it('vértices colineares na aresta partilhada (só numa das divisões) não atrapalham: 21 m²', () => {
    const base = sceneFromRooms([A, B]);
    const withExtra = mutateScene(base, (scene) => {
      const room = nodeOf(scene, 'sala');
      if (room.geometry?.kind !== 'polygon') throw new Error('sem polígono');
      // A aresta partilhada é x = 4. Em z, o polígono vai de (4,0) a (4,-3) (z = -y). Acrescenta (4, -1.5) a meio, com as referências coerentes.
      const index = room.geometry.verticesM.findIndex((v) => Math.abs(v[0] - 4) < 1e-9 && Math.abs(v[2]) < 1e-9);
      insertVertex(scene, 'sala', index + 1, [4, 0, -1.5]);
    }).scene;
    const result = merged(planRoomMerge(withExtra, sharedWallId(withExtra, 'sala', 'cozinha'), AT));
    expect(rel(shoelace(polygon(result.merged)), 21)).toBeLessThan(1e-9);
    expect(polygon(result.merged)).toHaveLength(6);
    expect(polygon(result.merged).some((v) => Math.abs(v[0] - 4) < 1e-9 && Math.abs(v[2] + 1.5) < 1e-9)).toBe(false);
  });

  it('um vértice a mais no meio de uma aresta que fica (sem parede a acabar lá) é limpo, e uma junção de paredes mantém-se', () => {
    const base = sceneFromRooms([A, B]);
    const withExtra = mutateScene(base, (scene) => {
      const room = nodeOf(scene, 'sala');
      if (room.geometry?.kind !== 'polygon') throw new Error('sem polígono');
      const index = room.geometry.verticesM.findIndex((v) => Math.abs(v[0]) < 1e-9 && Math.abs(v[2]) < 1e-9);
      insertVertex(scene, 'sala', index + 1, [2, 0, 0]); // meio da parede de baixo de A
    }).scene;
    const result = merged(planRoomMerge(withExtra, sharedWallId(withExtra, 'sala', 'cozinha'), AT));
    expect(polygon(result.merged)).toHaveLength(6);
    expect(rel(shoelace(polygon(result.merged)), 21)).toBeLessThan(1e-9);
  });
});

describe('o que não é uma fusão', () => {
  it('uma parede sem divisões: nada a fundir', () => {
    const scene = sceneFromRooms([A]).scene;
    const outer = nodeOf(scene, 'sala').component!.dependsOn[0]!;
    const emptied = mutateScene({ scene, undoStack: [], redoStack: [] }, (s) => { s.nodes = s.nodes.filter((n) => n.id !== 'sala'); s.relations = []; }).scene;
    expect(planRoomMerge(emptied, outer, AT)).toEqual({ status: 'none' });
  });

  it('uma parede que não é parede ou não existe: nada a fundir', () => {
    const scene = sceneFromRooms([A, B]).scene;
    expect(planRoomMerge(scene, 'nao-existe', AT)).toEqual({ status: 'none' });
  });
});

describe('fusão: casos que ficam bloqueados, com a razão', () => {
  const sceneOf = (rooms: RoomSpec[]) => sceneFromRooms(rooms);
  const blocked = (result: RoomMergeResult, code: string) => {
    expect(result.status).toBe('blocked');
    if (result.status !== 'blocked') return;
    expect(result.code).toBe(code);
    expect(result.message.length).toBeGreaterThan(20);
    expect(result.message).not.toContain(code);
  };

  it('a parede só tem uma divisão: remover abriria a divisão para fora', () => {
    const scene = sceneOf([A]).scene;
    blocked(planRoomMerge(scene, nodeOf(scene, 'sala').component!.dependsOn[0]!, AT), 'ROOM_MERGE_SINGLE_ROOM');
  });

  it('a parede tem três divisões', () => {
    const base = sceneOf([A, B]);
    const three = mutateScene(base, (scene) => {
      const wall = sharedWallId(scene, 'sala', 'cozinha');
      const third = structuredClone(nodeOf(scene, 'cozinha'));
      third.id = 'varanda'; third.label = 'Varanda';
      third.component!.dependsOn = [wall];
      scene.nodes.push(third);
      scene.relations.push(boundedBy('varanda', wall, scene.relations[0]!));
    }).scene;
    const result = planRoomMerge(three, sharedWallId(three, 'sala', 'cozinha'), AT);
    blocked(result, 'ROOM_MERGE_MORE_THAN_TWO_ROOMS');
    if (result.status === 'blocked') expect(result.roomIds.sort()).toEqual(['cozinha', 'sala', 'varanda']);
  });

  it('uma divisão mais alta do que a vizinha: a parede de 3 m fecha mesmo as duas (4×6 + 3×3 = 24 + 9 = 33 m²)', () => {
    // Em cenas feitas a partir de uma planta, a aresta da divisão alta é dividida onde a vizinha toca, por isso há aqui um
    // vértice em (4,3) e a parede de 3 m coincide com uma aresta inteira de cada divisão. É uma fusão limpa.
    const tall: RoomSpec = { id: 'sala', vertices: [[0, 0], [4, 0], [4, 6], [0, 6]] };
    const small: RoomSpec = { id: 'cozinha', vertices: [[4, 0], [7, 0], [7, 3], [4, 3]] };
    const scene = sceneOf([tall, small]).scene;
    const result = merged(planRoomMerge(scene, wallBetween(scene, [4, 0], [4, 3]), AT));
    expect(rel(shoelace(polygon(result.merged)), 33)).toBeLessThan(1e-9);
  });

  it('partilha parcial: a aresta da divisão alta (6 m) é maior do que a parede de 3 m e a divisão não tem vértice onde a parede acaba', () => {
    const tall: RoomSpec = { id: 'sala', vertices: [[0, 0], [4, 0], [4, 6], [0, 6]] };
    const small: RoomSpec = { id: 'cozinha', vertices: [[4, 0], [7, 0], [7, 3], [4, 3]] };
    const base = sceneOf([tall, small]);
    const partial = mutateScene(base, (scene) => {
      const room = nodeOf(scene, 'sala');
      if (room.geometry?.kind !== 'polygon') throw new Error('sem polígono');
      dropVertexKeepRefs(scene, 'sala', room.geometry.verticesM.findIndex((v) => Math.abs(v[0] - 4) < 1e-9 && Math.abs(v[2] + 3) < 1e-9));
    }).scene;
    blocked(planRoomMerge(partial, wallBetween(partial, [4, 0], [4, 3]), AT), 'ROOM_MERGE_EDGE_MISMATCH');
  });

  it('a parede é mais curta do que a aresta das duas divisões', () => {
    // Duas divisões 4×3 lado a lado com a aresta de 3 m; a parede removida é só metade (1,5 m) dessa aresta.
    const base = sceneOf([A, B]);
    const shorter = mutateScene(base, (scene) => {
      const wall = nodeOf(scene, sharedWallId(scene, 'sala', 'cozinha'));
      wall.geometry = { ...wall.geometry!, sizeM: [1.5, 2.8, 0.1] } as never;
      wall.transform.translationM = [4, 0, -0.75];
    }).scene;
    blocked(planRoomMerge(shorter, sharedWallId(shorter, 'sala', 'cozinha'), AT), 'ROOM_MERGE_EDGE_MISMATCH');
  });

  it('as divisões tocam-se também noutro troço: a união teria um buraco', () => {
    // A: quadrado 2×2. B envolve A por cima e pelo lado: partilham a parede x = 2 (y 0..2) e também o topo y = 2 (x 0..2).
    const inner: RoomSpec = { id: 'sala', vertices: [[0, 0], [2, 0], [2, 2], [0, 2]] };
    const wrap: RoomSpec = { id: 'cozinha', vertices: [[2, 0], [5, 0], [5, 3], [0, 3], [0, 2], [2, 2]] };
    const scene = sceneOf([inner, wrap]).scene;
    blocked(planRoomMerge(scene, wallBetween(scene, [2, 0], [2, 2]), AT), 'ROOM_MERGE_TOUCH_ELSEWHERE');
  });

  it('o polígono de uma divisão não é simples (laço)', () => {
    const base = sceneOf([A, B]);
    const bowtie = mutateScene(base, (scene) => {
      const room = nodeOf(scene, 'cozinha');
      if (room.geometry?.kind !== 'polygon') throw new Error('sem polígono');
      // (4,0) (7,3) (7,0) (4,3): as arestas (4,0)-(7,3) e (7,0)-(4,3) cruzam-se.
      room.geometry.verticesM = [[4, 0, 0], [7, 0, -3], [7, 0, 0], [4, 0, -3]];
    }).scene;
    blocked(planRoomMerge(bowtie, sharedWallId(bowtie, 'sala', 'cozinha'), AT), 'ROOM_MERGE_NOT_SIMPLE');
  });

  it('as duas divisões ficam do mesmo lado da parede (sobrepõem-se)', () => {
    const over: RoomSpec = { id: 'cozinha', vertices: [[4, 0], [4, 3], [1, 3], [1, 0]] };
    const scene = sceneOf([A, over]).scene;
    blocked(planRoomMerge(scene, wallBetween(scene, [4, 0], [4, 3]), AT), 'ROOM_MERGE_NOT_SIMPLE');
  });

  it('uma divisão sem polígono', () => {
    const base = sceneOf([A, B]);
    const noPolygon = mutateScene(base, (scene) => { nodeOf(scene, 'cozinha').geometry = { kind: 'box', sizeM: [3, 0.1, 3], provenance: nodeOf(scene, 'cozinha').transform.provenance.scale } as never; }).scene;
    blocked(planRoomMerge(noPolygon, sharedWallId(noPolygon, 'sala', 'cozinha'), AT), 'ROOM_MERGE_NOT_POLYGON');
  });

  it('uma divisão com outra relação que não é bounded_by: o motor não sabe o que fazer com ela', () => {
    const base = sceneOf([A, B]);
    const related = mutateScene(base, (scene) => {
      scene.relations.push({ id: 'etiqueta-1', fromNodeId: 'sala', toNodeId: sharedWallId(scene, 'sala', 'cozinha'), kind: 'labels', properties: {}, provenance: scene.relations[0]!.provenance });
    }).scene;
    blocked(planRoomMerge(related, sharedWallId(related, 'sala', 'cozinha'), AT), 'ROOM_MERGE_OTHER_RELATIONS');
  });

  it('as divisões coincidem à tolerância mas a área não se conserva: bloqueia em vez de adivinhar', () => {
    // B está a 0,5 mm da aresta de A (dentro da tolerância de 1 mm): casam, mas a área da união não é 12 + 9 com erro < 1e-9.
    const base = sceneOf([A, B]);
    const shifted = mutateScene(base, (scene) => {
      const room = nodeOf(scene, 'cozinha');
      if (room.geometry?.kind !== 'polygon') throw new Error('sem polígono');
      room.geometry.verticesM = room.geometry.verticesM.map(([x, y, z]) => (Math.abs(x - 4) < 1e-9 ? [x + ROOM_MERGE_TOLERANCE_M / 2, y, z] : [x, y, z]) as [number, number, number]);
    }).scene;
    blocked(planRoomMerge(shifted, sharedWallId(shifted, 'sala', 'cozinha'), AT), 'ROOM_MERGE_AREA_NOT_CONSERVED');
  });

  it('a tolerância tem nome e é pequena', () => {
    expect(ROOM_MERGE_TOLERANCE_M).toBe(1e-3);
  });
});

describe('verificações do Core no relatório da fusão', () => {
  const report = () => {
    const scene = sceneFromRooms([A, B]).scene;
    return merged(planRoomMerge(scene, sharedWallId(scene, 'sala', 'cozinha'), AT)).report;
  };

  it('tem exactamente as três verificações: área, polígono simples e estrutura', () => {
    expect(report().checks.map((check) => check.id)).toEqual(['architecture.room-merge.area', 'architecture.room-merge.simple-polygon', 'architecture.room-merge.structure']);
  });

  it('a conservação de área passa, com o medido (21) contra o esperado (12 + 9)', () => {
    const check = report().checks.find((c) => c.id === 'architecture.room-merge.area')!;
    expect(check).toMatchObject({ status: 'pass', unit: 'm2' });
    expect(check.measured).toBeCloseTo(21, 9);
    expect(check.expected).toBeCloseTo(21, 9);
    expect(check.tolerance).toBeCloseTo(21e-9, 12);
    expect(check.subject).toEqual(expect.arrayContaining(['sala', 'cozinha']));
  });

  it('o polígono resultante é simples', () => {
    expect(report().checks.find((c) => c.id === 'architecture.room-merge.simple-polygon')).toMatchObject({ status: 'pass' });
  });

  it('a estrutura é "unknown", sempre, com a razão: sem dados estruturais', () => {
    const check = report().checks.find((c) => c.id === 'architecture.room-merge.structure')!;
    expect(check.status).toBe('unknown');
    expect(check.reason).toMatch(/sem dados estruturais/);
    expect(check.reason).toMatch(/estruturalmente seguro/);
  });

  it('o resumo do relatório é "unknown": nada na cena pode passar por estruturalmente verificado', () => {
    expect(summarizeReport(report())).toMatchObject({ pass: 2, fail: 0, unknown: 1, status: 'unknown' });
  });

  it('o relatório cita o domínio, a cena, a revisão e as entradas com a sua proveniência', () => {
    const scene = sceneFromRooms([A, B]).scene;
    const result = merged(planRoomMerge(scene, sharedWallId(scene, 'sala', 'cozinha'), AT));
    expect(result.report).toMatchObject({ domain: 'architecture', subjectId: scene.id, revisionId: scene.revision.id, generatedAt: AT });
    expect(result.report.inputs.map((input) => `${input.entityId}.${input.field}`).sort()).toEqual(['cozinha.geometry', 'sala.geometry']);
    expect(result.report.assumptions.length).toBeGreaterThan(0);
  });
});
