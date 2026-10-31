import { describe, expect, it } from 'vitest';
import { createSpatialCommandEnvelope, parseSpatialIntentV1, resolveSpatialTarget, validateSpatialCommand } from '../src/spatial-command-protocol';
import { validateSpatialScene, type SpatialSceneV1 } from '../src/spatial-scene';

const stamp = '2026-10-31T00:00:00.000Z';
const provenance = { source: 'user', validation: 'unreviewed', recordedAt: stamp } as const;
function makeScene(): SpatialSceneV1 {
  const wall = (id: string, label: string, x: number) => ({
    id, label, nodeType: 'component' as const, parentId: null,
    transform: { translationM: [x, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], provenance: { translationM: provenance, rotation: provenance, scale: provenance } },
    geometry: { kind: 'box', sizeM: [4, 2.7, 0.15], provenance },
    component: { kind: 'wall', dependsOn: [], properties: { length: { value: 4, unit: 'm', provenance } } }, properties: {},
  });
  return validateSpatialScene({
    schema: 'spatial_scene.v1', id: 'scene-8e', title: 'Fixture local de teste',
    coordinateSystem: { handedness: 'right', upAxis: 'Y', horizontalPlane: ['X', 'Z'], unit: 'm' },
    sourceDocuments: [], imageWorldMapping: null,
    nodes: [wall('wall-left', 'Parede 1', -2), wall('wall-right', 'Parede 2', 2)],
    relations: [], constraints: [], revision: { id: 'scene-8e:r0', number: 0, parentId: null, operationId: null, createdAt: stamp, createdBy: 'test-fixture' },
  });
}

describe('spatial_command.v1 local deterministic grammar', () => {
  it('recognises explicit length units and converts to SI metres', () => {
    expect(parseSpatialIntentV1('Aumenta esta parede para 5 m')).toMatchObject({ status: 'recognized', value: { intent: { kind: 'Resize', unit: 'm', parameters: { property: 'length', value: 5 } } } });
    expect(parseSpatialIntentV1('Aumenta esta parede para cinco metros')).toMatchObject({ status: 'recognized', value: { intent: { kind: 'Resize', parameters: { value: 5 } } } });
    expect(parseSpatialIntentV1('Aumenta esta parede em 50 centímetros.')).toMatchObject({ status: 'recognized', value: { intent: { kind: 'Resize', parameters: { delta: 0.5 } } } });
    expect(parseSpatialIntentV1('reduz esta parede em 50 cm')).toMatchObject({ status: 'recognized', value: { intent: { kind: 'Resize', parameters: { delta: -0.5 } } } });
    expect(parseSpatialIntentV1('move esta parede 50 cm no eixo X')).toMatchObject({ status: 'recognized', value: { intent: { kind: 'Move', parameters: { axis: 'X', distance: 0.5 } } } });
    expect(parseSpatialIntentV1('aumenta esta parede para 5')).toMatchObject({ status: 'clarification' });
    expect(parseSpatialIntentV1('move esta parede 0.5 no eixo X')).toMatchObject({ status: 'clarification' });
  });

  it('requires a complete explicit opening and rejects vague or excessive values', () => {
    expect(parseSpatialIntentV1('adiciona uma porta de 90 cm')).toMatchObject({ status: 'clarification' });
    expect(parseSpatialIntentV1('adiciona uma porta largura 0.9 altura 2 offset 1 peitoril 0')).toMatchObject({ status: 'clarification' });
    expect(parseSpatialIntentV1('adiciona uma porta largura 0.9 m altura 2 m offset 1 m peitoril 0 m')).toMatchObject({ status: 'recognized', value: { intent: { kind: 'AddOpening', parameters: { kind: 'door', widthM: 0.9, heightM: 2, offsetM: 1, sillM: 0 } } } } as never);
    expect(parseSpatialIntentV1('aumenta esta parede para 5000 m')).toMatchObject({ status: 'unsupported' });
    expect(parseSpatialIntentV1('move esta parede para a direita')).toMatchObject({ status: 'clarification' });
  });

  it('asks for a selection and resolves screen-relative targets only when the view distinguishes them', () => {
    const scene = makeScene();
    const selected = parseSpatialIntentV1('aumenta esta parede para 5 m');
    expect(selected.status).toBe('recognized');
    if (selected.status === 'recognized') expect(resolveSpatialTarget(scene, selected.value.intent, undefined).status).toBe('clarification');
    const left = parseSpatialIntentV1('seleciona a parede da esquerda');
    expect(left.status).toBe('recognized');
    if (left.status === 'recognized') {
      const resolution = resolveSpatialTarget(scene, left.value.intent, undefined);
      expect(resolution.status).toBe('resolved');
      if (resolution.status === 'resolved') expect(resolution.nodeId).toBe('wall-left');
    }
    const overlapping = validateSpatialScene({ ...scene, nodes: scene.nodes.map((node) => ({ ...node, transform: { ...node.transform, translationM: [0, 0, 0] } })) });
    if (left.status === 'recognized') expect(resolveSpatialTarget(overlapping, left.value.intent, undefined).status).toBe('clarification');
  });

  it('validates a versioned envelope and requires confirmation against the exact base revision', () => {
    const scene = makeScene();
    const parsed = parseSpatialIntentV1('aumenta esta parede para 5 m');
    expect(parsed.status).toBe('recognized');
    if (parsed.status !== 'recognized') return;
    const command = createSpatialCommandEnvelope({
      intent: { ...parsed.value.intent, target: { nodeId: 'wall-left', reference: 'selection' } },
      context: { sceneId: scene.id, revisionId: scene.revision.id, selectedNodeId: 'wall-left', documentId: null, mode: 'architecture' },
      inputText: 'Aumenta esta parede para 5 m', origin: 'local_deterministic', recordedAt: stamp,
    });
    expect(validateSpatialCommand(command)).toMatchObject({ schema: 'spatial_command.v1', state: 'ProposedAction', preconditions: { expectedRevisionId: scene.revision.id, requiresConfirmation: true }, provenance: { validation: 'unreviewed' } });
    expect(() => validateSpatialCommand({ ...command, preconditions: { ...command.preconditions, requiresConfirmation: false } })).toThrow('SPATIAL_COMMAND_INVALID');
    const focus = createSpatialCommandEnvelope({ intent: { kind: 'Focus', target: { nodeId: 'wall-left', reference: 'selection' }, parameters: {}, unit: null }, context: { sceneId: scene.id, revisionId: scene.revision.id, selectedNodeId: 'wall-left', documentId: null, mode: 'architecture' }, inputText: 'foca esta parede', origin: 'local_deterministic', recordedAt: stamp });
    expect(focus.preconditions.requiresConfirmation).toBe(false);
    expect(() => validateSpatialCommand({ ...command, intent: { ...command.intent, parameters: { value: Infinity } } })).toThrow('SPATIAL_COMMAND_INVALID');
    expect(() => validateSpatialCommand({ ...command, context: { ...command.context, revisionId: 'stale' } })).toThrow('SPATIAL_COMMAND_INVALID');
  });
});
