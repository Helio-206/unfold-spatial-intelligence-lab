import { describe, expect, it } from 'vitest';
import { executeSceneCommand } from '../src/spatial-scene';
import { planWallRemoval } from '../src/plan-scene';
import { describeRemovalCard, describeWallRemoval } from '../src/removal-preview';
import { addOpeningToScene } from '../src/plan-scene';
import { mutateScene, nodeOf, sceneFromRooms, sharedWallId, type RoomSpec } from './helpers/rooms';

const A: RoomSpec = { id: 'sala', vertices: [[0, 0], [4, 0], [4, 3], [0, 3]] };
const B: RoomSpec = { id: 'cozinha', vertices: [[4, 0], [7, 0], [7, 3], [4, 3]] };

const named = (rooms: RoomSpec[], names: Record<string, string>) => {
  let t = sceneFromRooms(rooms);
  for (const [id, value] of Object.entries(names)) t = executeSceneCommand(t, { type: 'UpdateParameter', nodeId: id, property: 'name', value }, 'reviewer').transaction;
  return t;
};
const rowsOf = (card: ReturnType<typeof describeRemovalCard>) => Object.fromEntries(card.rows.map((row) => [row.label, row]));

describe('o cartão de remoção lê a operação candidata', () => {
  const setup = () => {
    const t = named([A, B], { sala: 'Sala', cozinha: 'Cozinha' });
    const wall = sharedWallId(t.scene, 'sala', 'cozinha');
    return { t, wall, info: describeWallRemoval(t.scene, wall)!, plan: planWallRemoval(t, wall, 'reviewer') };
  };

  it('diz as duas divisões, a divisão que sai e a área, calculada pelo motor: «Sala + Cozinha → 1 divisão, 21 m² · calculado»', () => {
    const { info, plan } = setup();
    const card = describeRemovalCard(info, { ok: true, plan, notice: '' });
    expect(card.ok).toBe(true);
    expect(rowsOf(card)['divisões']!.value).toBe('Sala + Cozinha → 1 divisão, 21 m² · calculado');
  });

  it('as três verificações do Core: área conservada, polígono simples e estrutura desconhecida', () => {
    const { info, plan } = setup();
    const rows = rowsOf(describeRemovalCard(info, { ok: true, plan, notice: '' }));
    expect(rows['área conservada']!.value).toBe('ok · 21 m² = 12 + 9 m²');
    expect(rows['polígono simples']!.value).toBe('ok');
    expect(rows['estrutura']).toMatchObject({ value: 'desconhecida · sem dados estruturais', tone: 'unknown' });
    expect(Object.keys(rowsOf(describeRemovalCard(info, { ok: true, plan, notice: '' })))).toEqual(['remove', 'divisões', 'área conservada', 'polígono simples', 'estrutura']);
  });

  it('a área vem da geometria candidata: o que estiver escrito nas propriedades da divisão não conta', () => {
    const { t, wall } = setup();
    const lying = mutateScene(t, (scene) => { for (const id of ['sala', 'cozinha']) nodeOf(scene, id).component!.properties.area = { value: 999, unit: 'm2', provenance: nodeOf(scene, id).transform.provenance.scale }; });
    const plan = planWallRemoval(lying, wall, 'reviewer');
    expect(rowsOf(describeRemovalCard(describeWallRemoval(lying.scene, wall)!, { ok: true, plan, notice: '' }))['divisões']!.value).toContain('21 m²');
  });

  it('muda com a cena: dois quartos 5×4 e 3×4 dão 32 m², com vírgula decimal quando há fracção', () => {
    const rooms: RoomSpec[] = [{ id: 'sala', vertices: [[0, 0], [5, 0], [5, 4], [0, 4]] }, { id: 'cozinha', vertices: [[5, 0], [8, 0], [8, 4], [5, 4]] }];
    const t = named(rooms, { sala: 'Sala', cozinha: 'Cozinha' });
    const wall = sharedWallId(t.scene, 'sala', 'cozinha');
    expect(rowsOf(describeRemovalCard(describeWallRemoval(t.scene, wall)!, { ok: true, plan: planWallRemoval(t, wall, 'reviewer'), notice: '' }))['divisões']!.value).toBe('Sala + Cozinha → 1 divisão, 32 m² · calculado');
    const odd: RoomSpec[] = [{ id: 'sala', vertices: [[0, 0], [4.5, 0], [4.5, 3], [0, 3]] }, { id: 'cozinha', vertices: [[4.5, 0], [7.5, 0], [7.5, 3], [4.5, 3]] }];
    const t2 = named(odd, { sala: 'Sala', cozinha: 'Cozinha' });
    const wall2 = sharedWallId(t2.scene, 'sala', 'cozinha');
    expect(rowsOf(describeRemovalCard(describeWallRemoval(t2.scene, wall2)!, { ok: true, plan: planWallRemoval(t2, wall2, 'reviewer'), notice: '' }))['divisões']!.value).toBe('Sala + Cozinha → 1 divisão, 22,5 m² · calculado');
  });

  it('sem divisões: «divisões afectadas: nenhuma», sem verificações de fusão, e a estrutura continua desconhecida', () => {
    const base = sceneFromRooms([A]);
    const outer = nodeOf(base.scene, 'sala').component!.dependsOn[0]!;
    const lone = mutateScene(base, (s) => { s.nodes = s.nodes.filter((n) => n.id !== 'sala'); s.relations = []; });
    const plan = planWallRemoval(lone, outer, 'reviewer');
    const rows = rowsOf(describeRemovalCard(describeWallRemoval(lone.scene, outer)!, { ok: true, plan, notice: '' }));
    expect(rows['divisões afectadas']!.value).toBe('nenhuma');
    expect(rows['área conservada']).toBeUndefined();
    expect(rows['estrutura']).toMatchObject({ tone: 'unknown' });
  });

  it('as aberturas que saem com a parede continuam a contar: «1 parede e 1 abertura»', () => {
    const t = named([A, B], { sala: 'Sala', cozinha: 'Cozinha' });
    const wall = sharedWallId(t.scene, 'sala', 'cozinha');
    const withDoor = addOpeningToScene(t, wall, { id: 'porta-1', kind: 'door', offsetM: 1, widthM: 0.9, heightM: 2.05, sillM: 0, actor: 'u' });
    const plan = planWallRemoval(withDoor, wall, 'reviewer');
    expect(rowsOf(describeRemovalCard(describeWallRemoval(withDoor.scene, wall)!, { ok: true, plan, notice: '' }))['remove']!.value).toBe('1 parede e 1 abertura');
  });

  it('leva o aviso de valores confirmados quando o há', () => {
    const { info, plan } = setup();
    expect(describeRemovalCard(info, { ok: true, plan, notice: 'Atenção: x.' })).toMatchObject({ ok: true, notice: 'Atenção: x.' });
  });

  it('bloqueado: diz a razão numa frase, mostra o código e não mostra verificações nem promete a fusão', () => {
    const t = sceneFromRooms([A]);
    const info = describeWallRemoval(t.scene, nodeOf(t.scene, 'sala').component!.dependsOn[0]!)!;
    const card = describeRemovalCard(info, { ok: false, code: 'ROOM_MERGE_SINGLE_ROOM' });
    expect(card.ok).toBe(false);
    if (card.ok) return;
    expect(card.code).toBe('ROOM_MERGE_SINGLE_ROOM');
    expect(card.reason).toMatch(/abriria a divisão para fora/);
    expect(card.reason).not.toContain('ROOM_MERGE');
    expect(JSON.stringify(card)).not.toMatch(/ainda não existe no motor/);
    expect(rowsOf(card)['estrutura']).toMatchObject({ value: 'desconhecida · sem dados estruturais', tone: 'unknown' });
    expect(rowsOf(card)['área conservada']).toBeUndefined();
  });

  it.each([
    ['ROOM_MERGE_MORE_THAN_TWO_ROOMS', /três ou mais/],
    ['ROOM_MERGE_EDGE_MISMATCH', /não coincide com esta parede/],
    ['ROOM_MERGE_TOUCH_ELSEWHERE', /noutro troço/],
    ['REMOVE_HAS_DEPENDENCIES', /dependem desta parede/],
  ])('bloqueado por %s: frase legível', (code, pattern) => {
    const t = named([A, B], { sala: 'Sala', cozinha: 'Cozinha' });
    const info = describeWallRemoval(t.scene, sharedWallId(t.scene, 'sala', 'cozinha'))!;
    const card = describeRemovalCard(info, { ok: false, code });
    expect(card.ok).toBe(false);
    if (!card.ok) expect(card.reason).toMatch(pattern);
  });

  it('um código que o cartão não conhece mostra-se tal e qual, sem inventar uma razão', () => {
    const t = sceneFromRooms([A, B]);
    const info = describeWallRemoval(t.scene, sharedWallId(t.scene, 'sala', 'cozinha'))!;
    const card = describeRemovalCard(info, { ok: false, code: 'ALGO_NOVO' });
    expect(card.ok === false && card.reason).toContain('ALGO_NOVO');
  });

  it('os nomes das divisões vêm do nome dado por uma pessoa, e sem nome da etiqueta', () => {
    const t = named([A, B], { sala: 'Sala' });
    const wall = sharedWallId(t.scene, 'sala', 'cozinha');
    const card = describeRemovalCard(describeWallRemoval(t.scene, wall)!, { ok: true, plan: planWallRemoval(t, wall, 'reviewer'), notice: '' });
    expect(rowsOf(card)['divisões']!.value).toMatch(/^(Sala \+ Divisão proposta 2|Divisão proposta 2 \+ Sala) → 1 divisão, 21 m² · calculado$/);
  });
});
