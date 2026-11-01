import { describe, expect, it } from 'vitest';
import { operationDigest } from '../src/core';
import { sceneChanges, sceneOperation, touchedConfirmed } from '../src/scene-authorization';
import { validateSpatialScene, type SpatialSceneV1 } from '../src/spatial-scene';
import { CONFIRMED_LOCATIONS, at, doorNode, makeScene, provenanceFor } from './helpers/scenes';

const confirmedScene = (location: (typeof CONFIRMED_LOCATIONS)[number], validation: 'verified' | 'corrected') => {
  const scene = makeScene();
  location.confirm(scene, validation);
  return validateSpatialScene(scene);
};
const changed = (scene: SpatialSceneV1, location: (typeof CONFIRMED_LOCATIONS)[number]) => {
  const candidate = structuredClone(scene);
  location.change(candidate);
  return candidate;
};

describe('guarda de valores confirmados — touchedConfirmed', () => {
  it.each(CONFIRMED_LOCATIONS.flatMap((location) => (['verified', 'corrected'] as const).map((validation) => [location.name, validation, location] as const)))(
    'alterar %s confirmado como %s é detectado',
    (_name, validation, location) => {
      const base = confirmedScene(location, validation);
      expect(touchedConfirmed(base, changed(base, location))).toEqual([{ entityId: location.nodeId, field: location.field, validation }]);
    },
  );

  it.each(CONFIRMED_LOCATIONS)('alterar $name sem confirmação não toca nada', (location) => {
    const base = makeScene();
    expect(touchedConfirmed(base, changed(base, location))).toEqual([]);
  });

  it.each(['unreviewed', 'ambiguous', 'rejected'] as const)('"%s" não conta como confirmado', (validation) => {
    for (const location of CONFIRMED_LOCATIONS) {
      const base = makeScene();
      location.confirm(base, validation);
      expect(touchedConfirmed(base, changed(base, location))).toEqual([]);
    }
  });

  it('um valor confirmado que não mudou não é tocado (as outras coisas mudarem não o afecta)', () => {
    const location = CONFIRMED_LOCATIONS[0]!;
    const base = confirmedScene(location, 'verified');
    const candidate = structuredClone(base);
    candidate.nodes.find((node) => node.id === 'door-1')!.component!.properties.width!.value = 1.2;
    expect(touchedConfirmed(base, candidate)).toEqual([]);
  });

  it('reescrever a proveniência de um confirmado sem mudar o valor também é tocá-lo', () => {
    // É o que faria um UpdateParameter com o mesmo valor, ou um ConfirmParameter por cima de um verified.
    const base = confirmedScene(CONFIRMED_LOCATIONS[0]!, 'verified');
    const sameValue = structuredClone(base);
    sameValue.nodes[0]!.component!.properties.thickness!.provenance = provenanceFor('corrected');
    expect(touchedConfirmed(base, sameValue)).toEqual([{ entityId: 'wall-1', field: 'component.properties.thickness', validation: 'verified' }]);
    const rewritten = structuredClone(base);
    rewritten.nodes[0]!.component!.properties.thickness!.provenance = { ...rewritten.nodes[0]!.component!.properties.thickness!.provenance, evidence: 'Outra evidência.' };
    expect(touchedConfirmed(base, rewritten)).toHaveLength(1);
  });

  it('remover um nó com valores confirmados toca em todos eles', () => {
    const base = makeScene();
    base.nodes[0]!.component!.properties.thickness!.provenance = provenanceFor('verified');
    base.nodes[0]!.geometry!.provenance = provenanceFor('corrected');
    base.nodes[0]!.transform.provenance.rotation = provenanceFor('verified');
    const valid = validateSpatialScene(base);
    const candidate = structuredClone(valid);
    candidate.nodes = candidate.nodes.filter((node) => node.id !== 'wall-1').map((node) => ({ ...node, component: node.component && { ...node.component, dependsOn: [] } }));
    expect(touchedConfirmed(valid, candidate)).toEqual([
      { entityId: 'wall-1', field: 'component.properties.thickness', validation: 'verified' },
      { entityId: 'wall-1', field: 'geometry', validation: 'corrected' },
      { entityId: 'wall-1', field: 'transform.rotation', validation: 'verified' },
    ]);
  });

  it('cascata: remover uma parede e a porta confirmada que depende dela toca no valor da porta', () => {
    const base = makeScene();
    base.nodes[1]!.component!.properties.width!.provenance = provenanceFor('verified');
    const valid = validateSpatialScene(base);
    const candidate = structuredClone(valid);
    candidate.nodes = [];
    expect(touchedConfirmed(valid, candidate)).toEqual([{ entityId: 'door-1', field: 'component.properties.width', validation: 'verified' }]);
  });

  it('relações e restrições confirmadas contam quando desaparecem', () => {
    const base = makeScene();
    base.relations.push({ id: 'rel-1', fromNodeId: 'door-1', toNodeId: 'wall-1', kind: 'hosted_by', properties: { gap: { value: 0.01, unit: 'm', provenance: provenanceFor('verified') } }, provenance: provenanceFor('corrected') });
    const valid = validateSpatialScene(base);
    const candidate = structuredClone(valid);
    candidate.relations = [];
    expect(touchedConfirmed(valid, candidate)).toEqual([
      { entityId: 'rel-1', field: 'properties.gap', validation: 'verified' },
      { entityId: 'rel-1', field: 'relation', validation: 'corrected' },
    ]);
  });

  it('só olha para valores: etiquetas e estado de revisão da cena não contam', () => {
    const base = confirmedScene(CONFIRMED_LOCATIONS[0]!, 'verified');
    const candidate = structuredClone(base);
    candidate.revision = { ...candidate.revision, id: 'scene-1:r1', number: 1 };
    candidate.title = 'Outro título';
    expect(touchedConfirmed(base, candidate)).toEqual([]);
  });
});

describe('ponte cena → operação canónica — sceneOperation', () => {
  const locationGeometry = CONFIRMED_LOCATIONS.find((location) => location.name === 'geometry')!;

  it('usa o domínio "architecture", o id da cena e a revisão base', () => {
    const base = makeScene('scene-9', 3);
    const operation = sceneOperation(base, changed(base, locationGeometry), 'ResizeComponent');
    expect(operation).toMatchObject({ domain: 'architecture', name: 'ResizeComponent', subjectId: 'scene-9', baseRevisionId: 'scene-9:r3' });
  });

  it('as alterações levam o valor antigo e o novo (sem proveniência nem datas)', () => {
    const base = makeScene();
    const operation = sceneOperation(base, changed(base, locationGeometry), 'ResizeComponent');
    expect(operation.changes).toEqual([{ entityId: 'wall-1', field: 'geometry', from: { value: { kind: 'box', sizeM: [4, 2.7, 0.2] }, validation: 'unreviewed' }, to: { value: { kind: 'box', sizeM: [5, 2.7, 0.2] }, validation: 'unreviewed' } }]);
    expect(JSON.stringify(operation)).not.toContain(at);
  });

  it('o estado de validação faz parte do que se autoriza', () => {
    const base = confirmedScene(locationGeometry, 'verified');
    const candidate = changed(base, locationGeometry);
    expect(sceneChanges(base, candidate)[0]).toMatchObject({ from: { validation: 'verified' }, to: { validation: 'unreviewed' } });
    const corrected = structuredClone(candidate);
    corrected.nodes[0]!.geometry!.provenance = provenanceFor('corrected');
    expect(operationDigest(sceneOperation(base, candidate, 'x'))).not.toBe(operationDigest(sceneOperation(base, corrected, 'x')));
  });

  it('o digest não depende de quando a proveniência foi escrita', () => {
    const base = makeScene();
    const first = changed(base, locationGeometry);
    const second = structuredClone(first);
    second.nodes[0]!.geometry!.provenance = { ...second.nodes[0]!.geometry!.provenance, recordedAt: '2030-01-01T00:00:00.000Z', actor: 'outro' };
    expect(operationDigest(sceneOperation(base, first, 'ResizeComponent'))).toBe(operationDigest(sceneOperation(base, second, 'ResizeComponent')));
  });

  it('o digest muda com o valor novo, com a revisão base e com o nome da operação', () => {
    const base = makeScene();
    const candidate = changed(base, locationGeometry);
    const digest = operationDigest(sceneOperation(base, candidate, 'ResizeComponent'));
    const other = structuredClone(candidate);
    (other.nodes[0]!.geometry as { sizeM: number[] }).sizeM = [6, 2.7, 0.2];
    expect(operationDigest(sceneOperation(base, other, 'ResizeComponent'))).not.toBe(digest);
    expect(operationDigest(sceneOperation(makeScene('scene-1', 1), changed(makeScene('scene-1', 1), locationGeometry), 'ResizeComponent'))).not.toBe(digest);
    expect(operationDigest(sceneOperation(base, candidate, 'UpdateGeometry'))).not.toBe(digest);
  });

  it('affected inclui os dependentes em cascata, mesmo os que não mudaram', () => {
    const base = makeScene();
    const operation = sceneOperation(base, changed(base, locationGeometry), 'ResizeComponent');
    expect(operation.affected).toEqual(['door-1', 'wall-1']);
  });

  it('dependentes transitivos e filhos também entram', () => {
    const scene = makeScene();
    scene.nodes.push({ ...doorNode('frame-1', 'door-1') });
    scene.nodes.push({ ...doorNode('trim-1', 'frame-1'), parentId: 'door-1' });
    const base = validateSpatialScene(scene);
    expect(sceneOperation(base, changed(base, locationGeometry), 'ResizeComponent').affected).toEqual(['door-1', 'frame-1', 'trim-1', 'wall-1']);
  });

  it('se a lista de dependentes mudar, o digest muda', () => {
    const base = makeScene();
    const candidate = changed(base, locationGeometry);
    const digest = operationDigest(sceneOperation(base, candidate, 'ResizeComponent'));
    const withWindow = structuredClone(base);
    withWindow.nodes.push(doorNode('window-1'));
    const valid = validateSpatialScene(withWindow);
    expect(operationDigest(sceneOperation(valid, changed(valid, locationGeometry), 'ResizeComponent'))).not.toBe(digest);
  });

  it('remover um nó regista o que se perde (de → null) e arrasta os dependentes', () => {
    const base = makeScene();
    base.nodes[1]!.component!.properties.width!.provenance = provenanceFor('verified');
    const valid = validateSpatialScene(base);
    const candidate = structuredClone(valid);
    candidate.nodes = [];
    const operation = sceneOperation(valid, candidate, 'RemoveWall');
    const removedDoor = operation.changes.filter((change) => change.entityId === 'door-1');
    expect(removedDoor.length).toBeGreaterThan(0);
    expect(removedDoor.every((change) => change.to === null && change.from !== null)).toBe(true);
    expect(removedDoor.find((change) => change.field === 'component.properties.width')).toMatchObject({ from: { value: { value: 0.9, unit: 'm' }, validation: 'verified' } });
    expect(operation.affected).toEqual(['door-1', 'wall-1']);
  });

  it('adicionar um nó regista (null → valores)', () => {
    const base = makeScene();
    const candidate = structuredClone(base);
    candidate.nodes.push(doorNode('door-2'));
    const operation = sceneOperation(base, candidate, 'AddComponent');
    expect(operation.changes.every((change) => change.entityId === 'door-2' && change.from === null && change.to !== null)).toBe(true);
    expect(operation.affected).toEqual(['door-2']);
  });

  it('duas alterações iguais produzem o mesmo digest, seja qual for a ordem em que as cenas foram construídas', () => {
    const base = makeScene();
    const a = changed(changed(base, CONFIRMED_LOCATIONS[0]!), locationGeometry);
    const b = changed(changed(base, locationGeometry), CONFIRMED_LOCATIONS[0]!);
    expect(operationDigest(sceneOperation(base, a, 'x'))).toBe(operationDigest(sceneOperation(base, b, 'x')));
  });
});
