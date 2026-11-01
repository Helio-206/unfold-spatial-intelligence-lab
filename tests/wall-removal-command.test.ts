import { describe, expect, it } from 'vitest';
import { createSpatialCommandEnvelope, parseSpatialIntentV1, resolveSpatialTarget, validateSpatialCommand } from '../src/spatial-command-protocol';
import { SPATIAL_AGENT_JSON_SCHEMA, SPATIAL_AGENT_REQUEST_SCHEMA, authorizeSpatialAgentProposal, parseSpatialAgentResult, validateSpatialAgentRequest, type SpatialAgentAction } from '../src/spatial-agent';
import { executeSceneCommand, type SceneTransaction, type SpatialSceneV1 } from '../src/spatial-scene';
import { mutateScene, nodeOf, sceneFromRooms, sharedWallId, type RoomSpec } from './helpers/rooms';

const A: RoomSpec = { id: 'sala', vertices: [[0, 0], [4, 0], [4, 3], [0, 3]] };
const B: RoomSpec = { id: 'cozinha', vertices: [[4, 0], [7, 0], [7, 3], [4, 3]] };

/** Dá nomes às divisões pelo UpdateParameter de sempre (escrito por uma pessoa, `source: user`). */
function named(transaction: SceneTransaction, names: Record<string, string>): SceneTransaction {
  let next = transaction;
  for (const [id, value] of Object.entries(names)) next = executeSceneCommand(next, { type: 'UpdateParameter', nodeId: id, property: 'name', value }, 'reviewer').transaction;
  return next;
}
const twoNamed = () => named(sceneFromRooms([A, B]), { sala: 'Sala', cozinha: 'Cozinha' });

const parse = (text: string) => {
  const result = parseSpatialIntentV1(text);
  if (result.status !== 'recognized') throw new Error(`não reconhecido: ${text} → ${JSON.stringify(result)}`);
  return result.value.intent;
};
const resolve = (scene: SpatialSceneV1, text: string, selected?: string) => resolveSpatialTarget(scene, parse(text), selected);

describe('gramática: remover uma parede', () => {
  it.each([
    ['Remove a parede entre a cozinha e a sala', 'wall_between:a cozinha e a sala'],
    ['remove a parede entre a Cozinha e a Sala.', 'wall_between:a cozinha e a sala'],
    ['Elimina a parede entre a sala e a cozinha', 'wall_between:a sala e a cozinha'],
    ['apaga a parede entre os quartos', 'wall_between:os quartos'],
    ['remove wall between kitchen and living room', 'wall_between:kitchen and living room'],
    ['Remove the wall between the kitchen and the living room', 'wall_between:the kitchen and the living room'],
    ['delete the wall between kitchen and living room', 'wall_between:kitchen and living room'],
    ['remove a parede W5', 'wall_id:w5'],
    ['Remove a parede wall-edge-120-0', 'wall_id:wall-edge-120-0'],
    ['remove wall W5', 'wall_id:w5'],
    ['remove a parede 3', 'wall_ordinal:3'],
    ['remove esta parede', 'selection'],
    ['Remove this wall', 'selection'],
  ])('«%s» → %s', (text, reference) => {
    const intent = parse(text);
    expect(intent).toMatchObject({ kind: 'RemoveWall', unit: null, parameters: {} });
    expect(intent.target.reference).toBe(reference);
  });

  it('é uma intenção que muda a cena: o envelope pede confirmação e valida', () => {
    const envelope = createSpatialCommandEnvelope({ intent: parse('remove a parede W5'), context: { sceneId: 's', revisionId: 's:r0', selectedNodeId: null, documentId: null, mode: 'architecture' }, inputText: 'remove a parede W5', origin: 'local_deterministic' });
    expect(envelope.preconditions.requiresConfirmation).toBe(true);
    expect(() => validateSpatialCommand(envelope)).not.toThrow();
  });

  it('sem dizer qual parede, pede esclarecimento em vez de adivinhar', () => {
    expect(parseSpatialIntentV1('remove a parede')).toMatchObject({ status: 'clarification' });
    expect(parseSpatialIntentV1('remove wall')).toMatchObject({ status: 'clarification' });
  });

  it('o que não é uma remoção de parede não é apanhado', () => {
    expect(parseSpatialIntentV1('remove tudo')).toMatchObject({ status: 'unsupported' });
    expect(parseSpatialIntentV1('remove a parede que preferires')).not.toMatchObject({ status: 'recognized' });
    expect(parseSpatialIntentV1('remove esta abertura')).toMatchObject({ status: 'recognized', value: { intent: { kind: 'RemoveOpening' } } });
    expect(parseSpatialIntentV1('Aumenta esta parede para 5 m')).toMatchObject({ status: 'recognized', value: { intent: { kind: 'Resize' } } });
  });
});

describe('resolver a parede pelas divisões que separa', () => {
  it('entre a cozinha e a sala: a parede partilhada', () => {
    const { scene } = twoNamed();
    expect(resolve(scene, 'Remove a parede entre a cozinha e a sala')).toEqual({ status: 'resolved', nodeId: sharedWallId(scene, 'sala', 'cozinha') });
  });

  it.each([
    'remove a parede entre a sala e a cozinha',
    'REMOVE A PAREDE ENTRE A COZINHA E A SALA',
    'remove a parede entre cozinha e sala',
    'remove a parede entre a cozinha e a sala.',
  ])('«%s» resolve a mesma parede (ordem, maiúsculas e artigos não contam)', (text) => {
    const { scene } = twoNamed();
    expect(resolve(scene, text)).toEqual({ status: 'resolved', nodeId: sharedWallId(scene, 'sala', 'cozinha') });
  });

  it('em inglês, com os nomes em inglês', () => {
    const t = named(sceneFromRooms([A, B]), { sala: 'Living room', cozinha: 'Kitchen' });
    expect(resolve(t.scene, 'remove wall between kitchen and living room')).toEqual({ status: 'resolved', nodeId: sharedWallId(t.scene, 'sala', 'cozinha') });
    expect(resolve(t.scene, 'Remove the wall between the kitchen and the living room')).toEqual({ status: 'resolved', nodeId: sharedWallId(t.scene, 'sala', 'cozinha') });
  });

  it('acentos não contam: «Cozinha» e «Sala de Estar» também são encontradas sem acentos', () => {
    const t = named(sceneFromRooms([A, B]), { sala: 'Sala de Estar', cozinha: 'Cozínha' });
    expect(resolve(t.scene, 'remove a parede entre a cozinha e a sala de estar')).toMatchObject({ status: 'resolved' });
  });

  it('nomes que contêm «e»: só uma divisão de partir o texto dá duas divisões que existem', () => {
    const t = named(sceneFromRooms([A, B]), { sala: 'Sala e cozinha', cozinha: 'Quarto' });
    expect(resolve(t.scene, 'remove a parede entre a sala e cozinha e o quarto')).toEqual({ status: 'resolved', nodeId: sharedWallId(t.scene, 'sala', 'cozinha') });
  });

  it('sem nome dado pelo utilizador, a divisão é conhecida pela etiqueta', () => {
    const { scene } = sceneFromRooms([A, B]);
    expect(resolve(scene, 'remove a parede entre a divisão proposta 1 e a divisão proposta 2')).toMatchObject({ status: 'resolved' });
  });

  it('o nome dado por uma pessoa tem prioridade sobre a etiqueta', () => {
    const t = named(sceneFromRooms([A, B]), { sala: 'Sala' });
    expect(resolve(t.scene, 'remove a parede entre a sala e a divisão proposta 2')).toMatchObject({ status: 'resolved' });
    expect(resolve(t.scene, 'remove a parede entre a divisão proposta 1 e a divisão proposta 2')).toMatchObject({ status: 'clarification' });
  });

  describe('recusas, sem escolher por ninguém', () => {
    const clarification = (result: ReturnType<typeof resolve>) => {
      expect(result.status).toBe('clarification');
      return result.status === 'clarification' ? result.question : '';
    };

    it('uma divisão que não existe', () => {
      const { scene } = twoNamed();
      expect(clarification(resolve(scene, 'remove a parede entre a cozinha e a varanda'))).toMatch(/varanda/);
    });

    it('duas divisões com o mesmo nome (ambígua)', () => {
      const t = named(sceneFromRooms([A, B]), { sala: 'Quarto', cozinha: 'Quarto' });
      const question = clarification(resolve(t.scene, 'remove a parede entre o quarto e o quarto'));
      expect(question).toMatch(/mais do que uma divisão|ambígu/i);
    });

    it('uma delas repetida: o nome repete-se mas há duas divisões diferentes com esse nome noutro sítio', () => {
      const t = named(sceneFromRooms([A, B, { id: 'quarto2', vertices: [[7, 0], [9, 0], [9, 3], [7, 3]] }]), { sala: 'Quarto', cozinha: 'Cozinha', quarto2: 'Quarto' });
      expect(clarification(resolve(t.scene, 'remove a parede entre a cozinha e o quarto'))).toMatch(/mais do que uma divisão/i);
    });

    it('as mesmas duas pontas (a divisão contra ela própria)', () => {
      const { scene } = twoNamed();
      expect(clarification(resolve(scene, 'remove a parede entre a sala e a sala'))).toMatch(/mesma divisão|duas divisões diferentes/i);
    });

    it('duas divisões que não partilham nenhuma parede', () => {
      const t = named(sceneFromRooms([A, B, { id: 'longe', vertices: [[10, 0], [12, 0], [12, 3], [10, 3]] }]), { sala: 'Sala', cozinha: 'Cozinha', longe: 'Garagem' });
      expect(clarification(resolve(t.scene, 'remove a parede entre a sala e a garagem'))).toMatch(/não partilham/i);
    });

    it('duas divisões que partilham mais do que uma parede: pede o id', () => {
      const t = named(sceneFromRooms([{ id: 'sala', vertices: [[0, 0], [2, 0], [2, 2], [0, 2]] }, { id: 'cozinha', vertices: [[2, 0], [5, 0], [5, 3], [0, 3], [0, 2], [2, 2]] }]), { sala: 'Sala', cozinha: 'Cozinha' });
      const question = clarification(resolve(t.scene, 'remove a parede entre a sala e a cozinha'));
      expect(question).toMatch(/partilham 2 paredes/);
      expect(question).toMatch(/id/);
    });

    it('um texto que se parte de duas maneiras que dão divisões que existem: não escolhe', () => {
      const row: RoomSpec[] = [{ id: 'r1', vertices: [[0, 0], [2, 0], [2, 2], [0, 2]] }, { id: 'r2', vertices: [[2, 0], [4, 0], [4, 2], [2, 2]] }, { id: 'r3', vertices: [[4, 0], [6, 0], [6, 2], [4, 2]] }, { id: 'r4', vertices: [[6, 0], [8, 0], [8, 2], [6, 2]] }];
      // «sala» | «cozinha e quarto» e também «sala e cozinha» | «quarto»: as duas existem.
      const t = named(sceneFromRooms(row), { r1: 'Sala', r2: 'Cozinha e quarto', r3: 'Sala e cozinha', r4: 'Quarto' });
      expect(clarification(resolve(t.scene, 'remove a parede entre sala e cozinha e quarto'))).toMatch(/mais do que uma maneira|pelo id/);
    });

    it('um texto que não se parte em duas divisões', () => {
      const { scene } = twoNamed();
      expect(clarification(resolve(scene, 'remove a parede entre a sala'))).toMatch(/entre a .* e a/i);
    });

    it('sem divisões na cena', () => {
      const t = mutateScene(sceneFromRooms([A, B]), (s) => { s.nodes = s.nodes.filter((n) => n.component?.kind !== 'room'); s.relations = []; });
      expect(clarification(resolve(t.scene, 'remove a parede entre a sala e a cozinha'))).toMatch(/sala/);
    });
  });
});

describe('resolver a parede pelo id, pelo número ou pela selecção', () => {
  const withIdW5 = () => mutateScene(twoNamed(), (s) => {
    const old = sharedWallId(s, 'sala', 'cozinha');
    for (const node of s.nodes) { if (node.id === old) node.id = 'wall-W5'; if (node.component) node.component.dependsOn = node.component.dependsOn.map((id) => (id === old ? 'wall-W5' : id)); }
    for (const relation of s.relations) { if (relation.toNodeId === old) { relation.toNodeId = 'wall-W5'; relation.id = relation.id.replace(old, 'wall-W5'); } }
  });

  it('«parede W5» encontra o id wall-W5 (maiúsculas e prefixo não contam)', () => {
    const { scene } = withIdW5();
    expect(resolve(scene, 'remove a parede W5')).toEqual({ status: 'resolved', nodeId: 'wall-W5' });
    expect(resolve(scene, 'remove a parede wall-w5')).toEqual({ status: 'resolved', nodeId: 'wall-W5' });
  });

  it('o id tem de ser exacto: um bocado do id não chega', () => {
    const { scene } = withIdW5();
    expect(resolve(scene, 'remove a parede w')).toMatchObject({ status: 'clarification' });
    expect(resolve(scene, 'remove a parede wall-w')).toMatchObject({ status: 'clarification' });
  });

  it('um id que não existe, ou que não é uma parede', () => {
    const { scene } = withIdW5();
    expect(resolve(scene, 'remove a parede W9')).toMatchObject({ status: 'clarification', question: expect.stringMatching(/W9/i) });
    expect(resolve(scene, 'remove a parede sala')).toMatchObject({ status: 'clarification' });
  });

  it('o número é a ordem das paredes, como nos outros comandos', () => {
    const { scene } = twoNamed();
    const walls = scene.nodes.filter((n) => n.component?.kind === 'wall');
    expect(resolve(scene, 'remove a parede 2')).toEqual({ status: 'resolved', nodeId: walls[1]!.id });
    expect(resolve(scene, 'remove a parede 99')).toMatchObject({ status: 'clarification' });
  });

  it('«esta parede» usa a selecção, e recusa sem selecção ou com outra coisa seleccionada', () => {
    const { scene } = twoNamed();
    const wall = sharedWallId(scene, 'sala', 'cozinha');
    expect(resolve(scene, 'remove esta parede', wall)).toEqual({ status: 'resolved', nodeId: wall });
    expect(resolve(scene, 'remove esta parede')).toMatchObject({ status: 'clarification' });
    expect(resolve(scene, 'remove esta parede', 'sala')).toMatchObject({ status: 'clarification' });
  });
});

describe('o Muse pode propor, o executor local resolve', () => {
  const request = (query: string, capabilities: SpatialAgentAction['kind'][] = ['Select', 'RemoveWall']) => validateSpatialAgentRequest({
    schema: SPATIAL_AGENT_REQUEST_SCHEMA, query, mode: 'architecture', capabilities,
    scene: { id: 'scene-a', revisionId: 'r1', revisionNumber: 1, selectedId: null, components: [{ id: 'sala', label: 'Sala', kind: 'room', dimensionsM: null, verification: 'unreviewed' }], constraints: [] },
    document: null, history: [],
  });
  const proposal = (label: string | null, reference: SpatialAgentAction['target']['reference'] = 'label', overrides: Partial<SpatialAgentAction> = {}) => ({
    schema: 'spatial_agent_result.v1', kind: 'PROPOSE_ACTION', text: 'Proponho remover a parede entre as duas divisões.', basis: 'scene', evidenceIds: ['sala'], question: null,
    action: { kind: 'RemoveWall', target: { reference, label, ordinal: null }, value: null, valueMode: null, unit: null, axis: null, opening: null, ...overrides },
  });
  const query = 'Remove a parede entre a cozinha e a sala';

  it('uma proposta RemoveWall com o texto do utilizador como alvo passa', () => {
    const result = parseSpatialAgentResult(JSON.stringify(proposal('entre a cozinha e a sala')), request(query));
    expect(result).toMatchObject({ kind: 'PROPOSE_ACTION', action: { kind: 'RemoveWall' } });
  });

  it('«esta parede» com a referência «selected» também', () => {
    expect(() => parseSpatialAgentResult(JSON.stringify(proposal(null, 'selected')), request('Remove esta parede'))).not.toThrow();
  });

  it.each([
    ['uma pergunta', 'Posso remover a parede entre a cozinha e a sala?', 'entre a cozinha e a sala'],
    ['um alvo que não está no que o utilizador disse', query, 'W5'],
    ['um comando que a gramática local não percebe', 'Remove a parede que preferires entre as divisões', 'que preferires entre as divisões'],
    ['outro verbo', 'Mostra a parede entre a cozinha e a sala', 'entre a cozinha e a sala'],
  ])('recusa %s', (_label, text, label) => {
    expect(() => parseSpatialAgentResult(JSON.stringify(proposal(label)), request(text))).toThrow('SPATIAL_AGENT_ACTION_NOT_AUTHORIZED');
  });

  it('só se a capacidade foi oferecida', () => {
    expect(() => parseSpatialAgentResult(JSON.stringify(proposal('entre a cozinha e a sala')), request(query, ['Select']))).toThrow('SPATIAL_AGENT_ACTION_NOT_ALLOWED');
  });

  it('a acção não leva valores nem aberturas', () => {
    expect(() => parseSpatialAgentResult(JSON.stringify(proposal('entre a cozinha e a sala', 'label', { value: 3, unit: 'm', valueMode: 'set' })), request(query))).toThrow();
    expect(authorizeSpatialAgentProposal(query, proposal('entre a cozinha e a sala').action as SpatialAgentAction)).toBe(true);
  });

  it('o schema da resposta oferece RemoveWall e o modo mecânico não', () => {
    expect(JSON.stringify(SPATIAL_AGENT_JSON_SCHEMA)).toContain('RemoveWall');
    expect(() => validateSpatialAgentRequest({ schema: SPATIAL_AGENT_REQUEST_SCHEMA, query, mode: 'mechanical', capabilities: ['RemoveWall'], scene: null, document: null, history: [] })).toThrow('SPATIAL_AGENT_CAPABILITY_NOT_ALLOWED_FOR_MODE');
  });

  it('nodeOf continua a achar as divisões (sanidade dos helpers)', () => {
    expect(nodeOf(sceneFromRooms([A, B]).scene, 'sala').component?.kind).toBe('room');
  });
});
