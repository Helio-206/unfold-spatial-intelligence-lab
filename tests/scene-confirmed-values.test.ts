import { describe, expect, it } from 'vitest';
import { operationDigest } from '../src/core';
import { commitScenePreview, executeSceneCommand, previewSceneCommand, serializeSpatialScene, validateSpatialScene, type SpatialCommand } from '../src/spatial-scene';
import { at, clock, later } from './helpers/scenes';
import { confirmedScene, failure, human, newLedger, snapshot, transactionOf } from './helpers/scene-auth';

const thickness = (scene: ReturnType<typeof confirmedScene>) => scene.nodes.find((node) => node.id === 'wall-1')!.component!.properties.thickness!;
const update = (value = 0.3, extra: Partial<Extract<SpatialCommand, { type: 'UpdateParameter' }>> = {}): SpatialCommand => ({ type: 'UpdateParameter', nodeId: 'wall-1', property: 'thickness', value, unit: 'm', ...extra });

describe('F1 — UpdateParameter trata verified e corrected como confirmados', () => {
  it.each(['verified', 'corrected'] as const)('um parâmetro "%s" exige autorização: o preview di-lo e o commit sem ela falha', (validation) => {
    const transaction = transactionOf(confirmedScene([{ name: 'component.properties', validation }]));
    const preview = previewSceneCommand(transaction, update(), 'reviewer', clock);
    expect(preview.status).toBe('ready');
    expect(preview.requiresAuthorization).toBe(true);
    expect(preview.touchesConfirmed).toEqual([{ entityId: 'wall-1', field: 'component.properties.thickness', validation }]);
    expect(preview.operation).toMatchObject({ domain: 'architecture', name: 'UpdateParameter', subjectId: 'scene-1', baseRevisionId: 'scene-1:r0' });
    expect(preview.operationDigest).toBe(operationDigest(preview.operation!));
    expect(failure(() => commitScenePreview(transaction, preview))).toBe('AUTHORIZATION_REQUIRED');
    expect(failure(() => commitScenePreview(transaction, preview, { ledger: newLedger() }))).toBe('AUTHORIZATION_REQUIRED');
  });

  it('um parâmetro "corrected" já não é sobrescrito e despromovido a unreviewed sem aviso', () => {
    // Antes: executeSceneCommand aplicava e o valor ficava "unreviewed", sem pedir nada.
    const transaction = transactionOf(confirmedScene([{ name: 'component.properties', validation: 'corrected' }]));
    const before = snapshot(transaction);
    expect(failure(() => executeSceneCommand(transaction, update(), 'reviewer', clock))).toBe('AUTHORIZATION_REQUIRED');
    expect(snapshot(transaction)).toBe(before);
  });

  it('um parâmetro por rever continua a alterar-se sem autorização, como hoje', () => {
    const transaction = transactionOf(confirmedScene());
    const preview = previewSceneCommand(transaction, update(), 'reviewer', clock);
    expect(preview).toMatchObject({ status: 'ready', requiresAuthorization: false, touchesConfirmed: [] });
    const { transaction: next } = executeSceneCommand(transaction, update(), 'reviewer', clock);
    expect(thickness(next.scene)).toMatchObject({ value: 0.3, provenance: { source: 'user', validation: 'unreviewed', actor: 'reviewer' } });
    expect(thickness(next.scene).provenance.authorizationId).toBeUndefined();
  });

  it.each(['verified', 'corrected'] as const)('com a autorização certa passa e fica "corrected", com o valor anterior, a evidência e o id da autorização (era %s)', (validation) => {
    const scene = confirmedScene([{ name: 'component.properties', validation }]);
    const transaction = transactionOf(scene);
    const ledger = newLedger();
    const preview = previewSceneCommand(transaction, update(), 'reviewer', clock);
    const authorization = ledger.issue(preview.operation!, human, 'ui_direct');
    const next = commitScenePreview(transaction, preview, { ledger, authorizationId: authorization.id });
    expect(thickness(next.scene)).toMatchObject({
      value: 0.3,
      unit: 'm',
      provenance: { source: 'user', validation: 'corrected', sourceValue: 0.2, sourceUnit: 'm', actor: 'reviewer', authorizationId: authorization.id, recordedAt: later },
    });
    expect(thickness(next.scene).provenance.evidence).toMatch(/autoriza/i);
    expect(thickness(next.scene).provenance.evidence).toContain(authorization.id);
    expect(next.scene.revision.number).toBe(1);
    expect(thickness(scene).value).toBe(0.2);
    expect(() => validateSpatialScene(JSON.parse(serializeSpatialScene(next.scene)))).not.toThrow();
  });

  it('o valor confirmado de origem fica em sourceValue mesmo depois de um valor "corrected"', () => {
    const transaction = transactionOf(confirmedScene([{ name: 'component.properties', validation: 'corrected' }]));
    const ledger = newLedger();
    const preview = previewSceneCommand(transaction, update(0.45), 'reviewer', clock);
    const authorization = ledger.issue(preview.operation!, human, 'ui_direct');
    const next = commitScenePreview(transaction, preview, { ledger, authorizationId: authorization.id });
    expect(thickness(next.scene).provenance).toMatchObject({ validation: 'corrected', sourceValue: 0.2 });
  });

  it('nunca volta a "verified" sozinho nem fica "unreviewed" depois de autorizado', () => {
    const transaction = transactionOf(confirmedScene(['component.properties']));
    const ledger = newLedger();
    const preview = previewSceneCommand(transaction, update(), 'reviewer', clock);
    const next = commitScenePreview(transaction, preview, { ledger, authorizationId: ledger.issue(preview.operation!, human, 'ui_direct').id });
    expect(['verified', 'unreviewed']).not.toContain(thickness(next.scene).provenance.validation);
  });

  describe('autorizações que não servem', () => {
    const setup = () => {
      const transaction = transactionOf(confirmedScene(['component.properties']));
      const ledger = newLedger();
      const preview = previewSceneCommand(transaction, update(), 'reviewer', clock);
      return { transaction, ledger, preview };
    };

    it('emitida para outro valor', () => {
      const { transaction, ledger, preview } = setup();
      const other = previewSceneCommand(transaction, update(0.35), 'reviewer', clock);
      const authorization = ledger.issue(other.operation!, human, 'ui_direct');
      expect(failure(() => commitScenePreview(transaction, preview, { ledger, authorizationId: authorization.id }))).toBe('AUTHORIZATION_DIGEST_MISMATCH');
    });

    it('emitida para outra revisão', () => {
      const { transaction, ledger, preview } = setup();
      const laterScene = transactionOf(confirmedScene(['component.properties'], 4));
      const authorization = ledger.issue(previewSceneCommand(laterScene, update(), 'reviewer', clock).operation!, human, 'ui_direct');
      expect(failure(() => commitScenePreview(transaction, preview, { ledger, authorizationId: authorization.id }))).toBe('AUTHORIZATION_REVISION_MISMATCH');
    });

    it('já usada', () => {
      const { transaction, ledger, preview } = setup();
      const authorization = ledger.issue(preview.operation!, human, 'ui_direct');
      commitScenePreview(transaction, preview, { ledger, authorizationId: authorization.id });
      expect(failure(() => commitScenePreview(transaction, preview, { ledger, authorizationId: authorization.id }))).toBe('AUTHORIZATION_ALREADY_USED');
    });

    it('expirada', () => {
      const { transaction, preview } = setup();
      let now = Date.parse(at);
      const ledger = newLedger({ ttlMs: 1000, now: () => new Date(now) });
      const authorization = ledger.issue(preview.operation!, human, 'ui_direct');
      now += 1001;
      expect(failure(() => commitScenePreview(transaction, preview, { ledger, authorizationId: authorization.id }))).toBe('AUTHORIZATION_EXPIRED');
    });

    it('inexistente, ou sem id', () => {
      const { transaction, ledger, preview } = setup();
      expect(failure(() => commitScenePreview(transaction, preview, { ledger, authorizationId: 'auth-inventada' }))).toBe('AUTHORIZATION_UNKNOWN');
      expect(failure(() => commitScenePreview(transaction, preview, { ledger }))).toBe('AUTHORIZATION_REQUIRED');
    });

    it('as tentativas falhadas não queimam a autorização boa nem aplicam nada', () => {
      const { transaction, ledger, preview } = setup();
      const before = snapshot(transaction);
      const authorization = ledger.issue(preview.operation!, human, 'ui_direct');
      const other = previewSceneCommand(transaction, update(0.35), 'reviewer', clock);
      expect(failure(() => commitScenePreview(transaction, other, { ledger, authorizationId: authorization.id }))).toBe('AUTHORIZATION_DIGEST_MISMATCH');
      expect(failure(() => commitScenePreview(transaction, preview))).toBe('AUTHORIZATION_REQUIRED');
      expect(snapshot(transaction)).toBe(before);
      expect(thickness(commitScenePreview(transaction, preview, { ledger, authorizationId: authorization.id }).scene).value).toBe(0.3);
    });
  });

  describe('o booleano acknowledgeVerifiedChange já não autoriza nada', () => {
    it('sozinho, com ou sem ledger, o commit continua a exigir autorização', () => {
      const transaction = transactionOf(confirmedScene(['component.properties']));
      const before = snapshot(transaction);
      const preview = previewSceneCommand(transaction, update(0.3, { acknowledgeVerifiedChange: true }), 'reviewer', clock);
      expect(preview).toMatchObject({ status: 'ready', requiresAuthorization: true });
      expect(failure(() => commitScenePreview(transaction, preview))).toBe('AUTHORIZATION_REQUIRED');
      expect(failure(() => commitScenePreview(transaction, preview, { ledger: newLedger() }))).toBe('AUTHORIZATION_REQUIRED');
      expect(failure(() => executeSceneCommand(transaction, update(0.3, { acknowledgeVerifiedChange: true }), 'reviewer', clock))).toBe('AUTHORIZATION_REQUIRED');
      expect(snapshot(transaction)).toBe(before);
    });

    it('o digest é o mesmo com ou sem o booleano: não faz parte do que se autoriza', () => {
      const transaction = transactionOf(confirmedScene(['component.properties']));
      const plain = previewSceneCommand(transaction, update(), 'reviewer', clock);
      const flagged = previewSceneCommand(transaction, update(0.3, { acknowledgeVerifiedChange: true }), 'reviewer', clock);
      expect(flagged.operationDigest).toBe(plain.operationDigest);
    });
  });

  describe('previews adulterados', () => {
    it('requiresAuthorization forjado a false não dispensa a autorização', () => {
      const transaction = transactionOf(confirmedScene(['component.properties']));
      const preview = previewSceneCommand(transaction, update(), 'reviewer', clock);
      const forged = { ...preview, requiresAuthorization: false, touchesConfirmed: [] };
      expect(failure(() => commitScenePreview(transaction, forged, { ledger: newLedger() }))).toBe('AUTHORIZATION_REQUIRED');
    });

    it('digest ou operação forjados são recusados', () => {
      const transaction = transactionOf(confirmedScene(['component.properties']));
      const ledger = newLedger();
      const preview = previewSceneCommand(transaction, update(), 'reviewer', clock);
      const authorization = ledger.issue(preview.operation!, human, 'ui_direct');
      expect(failure(() => commitScenePreview(transaction, { ...preview, operationDigest: 'f'.repeat(64) }, { ledger, authorizationId: authorization.id }))).toBe('PREVIEW_TAMPERED');
      const operation = structuredClone(preview.operation!);
      operation.changes[0]!.to = null;
      expect(failure(() => commitScenePreview(transaction, { ...preview, operation }, { ledger, authorizationId: authorization.id }))).toBe('PREVIEW_TAMPERED');
    });
  });

  it('o preview não altera a transacção', () => {
    const transaction = transactionOf(confirmedScene(['component.properties']));
    const before = snapshot(transaction);
    previewSceneCommand(transaction, update(), 'reviewer', clock);
    expect(snapshot(transaction)).toBe(before);
  });

  it('o esquema aceita authorizationId opcional e recusa valores que não são ids', () => {
    const scene = confirmedScene(['component.properties']);
    const property = scene.nodes[0]!.component!.properties.thickness!;
    property.provenance = { ...property.provenance, authorizationId: 'auth-1' };
    expect(() => validateSpatialScene(scene)).not.toThrow();
    for (const bad of ['', ' ', 'a b', 'x'.repeat(101), 5 as unknown as string]) {
      property.provenance = { ...property.provenance, authorizationId: bad };
      expect(() => validateSpatialScene(scene), String(bad)).toThrow();
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// F2 — Move, Rotate, Resize e UpdateGeometry
// ---------------------------------------------------------------------------------------------------------------------
import { editWallInScene } from '../src/plan-scene';
import { CONFIRMED_LOCATIONS, provenanceFor } from './helpers/scenes';

const wall = (scene: ReturnType<typeof confirmedScene>) => scene.nodes.find((node) => node.id === 'wall-1')!;
const door = (scene: ReturnType<typeof confirmedScene>) => scene.nodes.find((node) => node.id === 'door-1')!;
const BOX: SpatialCommand = { type: 'UpdateGeometry', nodeId: 'wall-1', geometry: { kind: 'box', sizeM: [6, 2.7, 0.2], provenance: { source: 'derived', validation: 'unreviewed', recordedAt: at } } };

/** Para cada sítio confirmado, o comando que o escreve e o valor original que deve ficar em sourceValue. */
const COMMANDS = [
  { location: 'geometry', label: 'ResizeComponent', field: 'geometry', command: { type: 'ResizeComponent', nodeId: 'wall-1', scale: [1.5, 1, 1] } as SpatialCommand, original: { kind: 'box', sizeM: [4, 2.7, 0.2] }, read: (s: ReturnType<typeof confirmedScene>) => wall(s).geometry!.provenance },
  { location: 'geometry', label: 'UpdateGeometry', field: 'geometry', command: BOX, original: { kind: 'box', sizeM: [4, 2.7, 0.2] }, read: (s: ReturnType<typeof confirmedScene>) => wall(s).geometry!.provenance },
  { location: 'transform.translationM', label: 'MoveComponent', field: 'transform.translationM', command: { type: 'MoveComponent', nodeId: 'wall-1', translationM: [1, 0, 0] } as SpatialCommand, original: [0, 0, 0], read: (s: ReturnType<typeof confirmedScene>) => wall(s).transform.provenance.translationM },
  { location: 'transform.rotation', label: 'RotateComponent', field: 'transform.rotation', command: { type: 'RotateComponent', nodeId: 'wall-1', axis: [0, 1, 0], angleRad: Math.PI / 2 } as SpatialCommand, original: [0, 0, 0, 1], read: (s: ReturnType<typeof confirmedScene>) => wall(s).transform.provenance.rotation },
  { location: 'node.properties', label: 'UpdateParameter (node.properties)', field: 'properties.note', command: { type: 'UpdateParameter', nodeId: 'wall-1', property: 'note', value: 'tijolo' } as SpatialCommand, original: 'reboco', read: (s: ReturnType<typeof confirmedScene>) => wall(s).properties.note!.provenance },
] as const;

describe.each(COMMANDS)('F2 — $label sobre $location confirmado', ({ location, field, command, original, read }) => {
  it.each(['verified', 'corrected'] as const)('"%s": o preview exige autorização, o commit sem ela falha e a cena fica intacta', (validation) => {
    const transaction = transactionOf(confirmedScene([{ name: location, validation }]));
    const before = snapshot(transaction);
    const preview = previewSceneCommand(transaction, command, 'reviewer', clock);
    expect(preview.status).toBe('ready');
    expect(preview).toMatchObject({ requiresAuthorization: true, touchesConfirmed: [{ entityId: 'wall-1', field, validation }] });
    expect(failure(() => commitScenePreview(transaction, preview))).toBe('AUTHORIZATION_REQUIRED');
    expect(failure(() => executeSceneCommand(transaction, command, 'reviewer', clock))).toBe('AUTHORIZATION_REQUIRED');
    expect(snapshot(transaction)).toBe(before);
  });

  it.each(['verified', 'corrected'] as const)('"%s": com a autorização certa fica corrected, com o valor anterior, a evidência e o id da autorização', (validation) => {
    const transaction = transactionOf(confirmedScene([{ name: location, validation }]));
    const ledger = newLedger();
    const preview = previewSceneCommand(transaction, command, 'reviewer', clock);
    // O candidato do preview (o que a interface desenha) já leva o valor original, antes de haver autorização.
    expect(read(preview.candidate!)).toMatchObject({ validation: 'corrected', sourceValue: original });
    expect(read(preview.candidate!).authorizationId).toBeUndefined();
    const authorization = ledger.issue(preview.operation!, human, 'ui_direct');
    const next = commitScenePreview(transaction, preview, { ledger, authorizationId: authorization.id });
    const provenance = read(next.scene);
    expect(provenance).toMatchObject({ source: 'user', validation: 'corrected', sourceValue: original, actor: 'reviewer', authorizationId: authorization.id, recordedAt: later });
    expect(provenance.evidence).toContain(authorization.id);
    expect(() => validateSpatialScene(JSON.parse(serializeSpatialScene(next.scene)))).not.toThrow();
  });

  it('sem confirmação nada muda: sem autorização, e fica unreviewed como hoje', () => {
    const transaction = transactionOf(confirmedScene());
    const preview = previewSceneCommand(transaction, command, 'reviewer', clock);
    expect(preview).toMatchObject({ requiresAuthorization: false, touchesConfirmed: [] });
    const { transaction: next } = executeSceneCommand(transaction, command, 'reviewer', clock);
    // UpdateGeometry traz a sua própria proveniência (a do cálculo que a produziu); os outros escrevem a do utilizador.
    expect(read(next.scene)).toMatchObject(command.type === 'UpdateGeometry' ? { source: 'derived', validation: 'unreviewed' } : { source: 'user', validation: 'unreviewed', actor: 'reviewer' });
    expect(read(next.scene).authorizationId).toBeUndefined();
  });
});

describe('F2 — cada comando só toca o que escreve', () => {
  it('mover não toca na proveniência da rotação nem da escala', () => {
    const transaction = transactionOf(confirmedScene());
    const scene = structuredClone(transaction.scene);
    CONFIRMED_LOCATIONS.find((l) => l.name === 'transform.rotation')!.confirm(scene, 'verified');
    CONFIRMED_LOCATIONS.find((l) => l.name === 'transform.scale')!.confirm(scene, 'verified');
    CONFIRMED_LOCATIONS.find((l) => l.name === 'geometry')!.confirm(scene, 'verified');
    const preview = previewSceneCommand(transactionOf(validateSpatialScene(scene)), { type: 'MoveComponent', nodeId: 'wall-1', translationM: [1, 0, 0] }, 'reviewer', clock);
    expect(preview).toMatchObject({ requiresAuthorization: false, touchesConfirmed: [] });
  });

  it('rodar não toca na translação nem na geometria, e redimensionar não toca nos transforms', () => {
    const scene = structuredClone(confirmedScene());
    CONFIRMED_LOCATIONS.find((l) => l.name === 'transform.translationM')!.confirm(scene, 'verified');
    CONFIRMED_LOCATIONS.find((l) => l.name === 'transform.scale')!.confirm(scene, 'corrected');
    const transaction = transactionOf(validateSpatialScene(scene));
    expect(previewSceneCommand(transaction, { type: 'RotateComponent', nodeId: 'wall-1', axis: [0, 1, 0], angleRad: 1 }, 'reviewer', clock).requiresAuthorization).toBe(false);
    expect(previewSceneCommand(transaction, { type: 'ResizeComponent', nodeId: 'wall-1', scale: [2, 1, 1] }, 'reviewer', clock).requiresAuthorization).toBe(false);
  });

  it('dois comandos sobre o mesmo valor confirmado preservam o valor original em sourceValue', () => {
    const transaction = transactionOf(confirmedScene(['geometry']));
    const ledger = newLedger();
    const first = previewSceneCommand(transaction, COMMANDS[0].command, 'reviewer', clock);
    const afterFirst = commitScenePreview(transaction, first, { ledger, authorizationId: ledger.issue(first.operation!, human, 'ui_direct').id });
    const second = previewSceneCommand(afterFirst, COMMANDS[0].command, 'reviewer', clock);
    expect(second.requiresAuthorization).toBe(true);
    const afterSecond = commitScenePreview(afterFirst, second, { ledger, authorizationId: ledger.issue(second.operation!, human, 'ui_direct').id });
    expect(wall(afterSecond.scene).geometry!.provenance).toMatchObject({ validation: 'corrected', sourceValue: { kind: 'box', sizeM: [6, 2.7, 0.2] } });
  });
});

describe('F2 — ResizeComponent já não contorna o bloqueio de geometria confirmada', () => {
  it('antes: reescrevia a geometria confirmada para unreviewed sem pedir nada', () => {
    const transaction = transactionOf(confirmedScene(['geometry']));
    expect(failure(() => executeSceneCommand(transaction, { type: 'ResizeComponent', nodeId: 'wall-1', scale: [2, 1, 1] }, 'reviewer', clock))).toBe('AUTHORIZATION_REQUIRED');
    expect(wall(transaction.scene).geometry!.provenance.validation).toBe('verified');
  });

  it('UpdateGeometry sobre geometria confirmada deixou de ser um bloqueio absoluto: pede autorização, como os outros', () => {
    const transaction = transactionOf(confirmedScene(['geometry']));
    const preview = previewSceneCommand(transaction, BOX, 'reviewer', clock);
    expect(preview).toMatchObject({ status: 'ready', requiresAuthorization: true });
    expect(preview.issues).toEqual([]);
  });

  it('UpdateGeometry não pode reivindicar verified nem corrected na geometria que traz', () => {
    const transaction = transactionOf(confirmedScene());
    for (const validation of ['verified', 'corrected'] as const) {
      const command: SpatialCommand = { type: 'UpdateGeometry', nodeId: 'wall-1', geometry: { kind: 'box', sizeM: [6, 2.7, 0.2], provenance: provenanceFor(validation) } };
      expect(previewSceneCommand(transaction, command, 'reviewer', clock)).toMatchObject({ status: 'blocked', issues: [{ code: 'NEW_GEOMETRY_CANNOT_CLAIM_HUMAN_VERIFICATION' }] });
    }
  });
});

describe('F2 — editWallInScene com geometria confirmada', () => {
  const edit = { start: { x: -2.5, y: 0 }, end: { x: 2.5, y: 0 }, actor: 'reviewer' };

  it('já não apaga a confirmação sem pedir: recusa e a cena fica intacta', () => {
    const transaction = transactionOf(confirmedScene(['geometry']));
    const before = snapshot(transaction);
    expect(failure(() => editWallInScene(transaction, 'wall-1', edit))).toBe('AUTHORIZATION_REQUIRED');
    expect(snapshot(transaction)).toBe(before);
    expect(wall(transaction.scene).geometry!.provenance.validation).toBe('verified');
  });

  it('numa parede sem nada confirmado comporta-se como hoje', () => {
    const transaction = transactionOf(confirmedScene());
    const next = editWallInScene(transaction, 'wall-1', edit);
    expect(wall(next.scene).geometry).toMatchObject({ kind: 'box', sizeM: [5, 2.7, 0.2], provenance: { source: 'user', validation: 'unreviewed', actor: 'reviewer' } });
    expect(wall(next.scene).component!.properties.length).toMatchObject({ value: 5, unit: 'm', provenance: { source: 'user', validation: 'unreviewed', actor: 'reviewer' } });
    expect(door(next.scene).transform.translationM[0]).toBeCloseTo(-1.55);
    expect(door(next.scene).transform.translationM[1]).toBeCloseTo(1.05);
    expect(door(next.scene).component!.properties.offset).toMatchObject({ value: 0.5, provenance: { validation: 'unreviewed' } });
    expect(next.scene.revision.number).toBe(9);
    expect(next.undoStack).toHaveLength(1);
    expect(next.redoStack).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// F3 — remoções directas e em cascata; operações compostas com uma única autorização sobre o agregado
// ---------------------------------------------------------------------------------------------------------------------
import { addOpeningToScene, editOpeningInScene, planOpeningEdit, planWallEdit, planWallRemoval, removeWallFromScene } from '../src/plan-scene';
import { doorNode } from './helpers/scenes';
import type { SpatialSceneV1 } from '../src/spatial-scene';

/** Marca valores da porta (que `confirmedScene` não cobre) como confirmados. */
function confirmDoor(scene: SpatialSceneV1, validation: 'verified' | 'corrected' = 'verified', fields: Array<'width' | 'offset' | 'geometry' | 'translationM'> = ['width']): SpatialSceneV1 {
  const copy = structuredClone(scene);
  const target = copy.nodes.find((node) => node.id === 'door-1')!;
  for (const field of fields) {
    if (field === 'geometry') target.geometry!.provenance = provenanceFor(validation);
    else if (field === 'translationM') target.transform.provenance.translationM = provenanceFor(validation);
    else target.component!.properties[field]!.provenance = provenanceFor(validation);
  }
  return validateSpatialScene(copy);
}
const WALL_EDIT = { start: { x: -2.5, y: 0 }, end: { x: 2.5, y: 0 }, actor: 'reviewer' };

describe('F3 — RemoveComponent directo', () => {
  it.each(['verified', 'corrected'] as const)('remover um nó com um valor "%s" exige autorização e a cena fica intacta sem ela', (validation) => {
    const transaction = transactionOf(confirmDoor(confirmedScene(), validation));
    const before = snapshot(transaction);
    const command: SpatialCommand = { type: 'RemoveComponent', nodeId: 'door-1' };
    const preview = previewSceneCommand(transaction, command, 'reviewer', clock);
    expect(preview).toMatchObject({ status: 'ready', requiresAuthorization: true, touchesConfirmed: [{ entityId: 'door-1', field: 'component.properties.width', validation }] });
    expect(preview.operation).toMatchObject({ name: 'RemoveComponent', affected: ['door-1'] });
    expect(preview.operation!.changes.every((change) => change.to === null)).toBe(true);
    expect(failure(() => executeSceneCommand(transaction, command, 'reviewer', clock))).toBe('AUTHORIZATION_REQUIRED');
    expect(snapshot(transaction)).toBe(before);
  });

  it('com a autorização certa remove', () => {
    const transaction = transactionOf(confirmDoor(confirmedScene()));
    const ledger = newLedger();
    const command: SpatialCommand = { type: 'RemoveComponent', nodeId: 'door-1' };
    const preview = previewSceneCommand(transaction, command, 'reviewer', clock);
    const next = commitScenePreview(transaction, preview, { ledger, authorizationId: ledger.issue(preview.operation!, human, 'ui_direct').id });
    expect(next.scene.nodes.map((node) => node.id)).toEqual(['wall-1']);
  });

  it('um nó sem valores confirmados remove-se como hoje', () => {
    const transaction = transactionOf(confirmedScene());
    const { transaction: next, preview } = executeSceneCommand(transaction, { type: 'RemoveComponent', nodeId: 'door-1' }, 'reviewer', clock);
    expect(preview).toMatchObject({ requiresAuthorization: false, touchesConfirmed: [] });
    expect(next.scene.nodes.map((node) => node.id)).toEqual(['wall-1']);
  });
});

describe('F3 — removeWallFromScene em cascata', () => {
  const confirmedDoorTransaction = () => transactionOf(confirmDoor(confirmedScene()));

  it('antes: apagava a porta confirmada sem pedir nada. Agora recusa e a cena (serializada) fica intacta', () => {
    const transaction = confirmedDoorTransaction();
    const before = snapshot(transaction);
    expect(failure(() => removeWallFromScene(transaction, 'wall-1', 'reviewer'))).toBe('AUTHORIZATION_REQUIRED');
    expect(snapshot(transaction)).toBe(before);
    expect(failure(() => removeWallFromScene(transaction, 'wall-1', 'reviewer', { ledger: newLedger() }))).toBe('AUTHORIZATION_REQUIRED');
    expect(snapshot(transaction)).toBe(before);
  });

  it('o plano diz o que toca nos dependentes e o digest cobre a parede e a porta', () => {
    const plan = planWallRemoval(confirmedDoorTransaction(), 'wall-1', 'reviewer');
    expect(plan).toMatchObject({ requiresAuthorization: true, touchesConfirmed: [{ entityId: 'door-1', field: 'component.properties.width', validation: 'verified' }], baseRevisionId: 'scene-1:r0' });
    expect(plan.operation).toMatchObject({ domain: 'architecture', subjectId: 'scene-1', baseRevisionId: 'scene-1:r0', affected: ['door-1', 'wall-1'] });
    expect(new Set(plan.operation.changes.map((change) => change.entityId))).toEqual(new Set(['door-1', 'wall-1']));
    expect(plan.operationDigest).toBe(operationDigest(plan.operation));
  });

  it('com uma autorização para a operação inteira remove a porta e a parede, e só gasta uma autorização', () => {
    const transaction = confirmedDoorTransaction();
    const ledger = newLedger();
    const plan = planWallRemoval(transaction, 'wall-1', 'reviewer');
    const authorization = ledger.issue(plan.operation, human, 'ui_direct');
    const next = removeWallFromScene(transaction, 'wall-1', 'reviewer', { ledger, authorizationId: authorization.id });
    expect(next.scene.nodes).toEqual([]);
    expect(next.undoStack).toHaveLength(1);
    expect(next.redoStack).toEqual([]);
    expect(failure(() => removeWallFromScene(transaction, 'wall-1', 'reviewer', { ledger, authorizationId: authorization.id }))).toBe('AUTHORIZATION_ALREADY_USED');
  });

  it('autorização só para a porta, de outra revisão, ou para outro valor não serve', () => {
    const transaction = confirmedDoorTransaction();
    const ledger = newLedger();
    const doorOnly = previewSceneCommand(transaction, { type: 'RemoveComponent', nodeId: 'door-1' }, 'reviewer', clock).operation!;
    expect(failure(() => removeWallFromScene(transaction, 'wall-1', 'reviewer', { ledger, authorizationId: ledger.issue(doorOnly, human, 'ui_direct').id }))).toBe('AUTHORIZATION_DIGEST_MISMATCH');
    const otherRevision = planWallRemoval(transactionOf(confirmDoor(confirmedScene([], 4))), 'wall-1', 'reviewer').operation;
    expect(failure(() => removeWallFromScene(transaction, 'wall-1', 'reviewer', { ledger, authorizationId: ledger.issue(otherRevision, human, 'ui_direct').id }))).toBe('AUTHORIZATION_REVISION_MISMATCH');
  });

  it('se a lista de dependentes mudou desde o preview, o digest muda e o commit falha', () => {
    const transaction = confirmedDoorTransaction();
    const ledger = newLedger();
    const authorization = ledger.issue(planWallRemoval(transaction, 'wall-1', 'reviewer').operation, human, 'ui_direct');
    // Mesma revisão, mas agora há uma janela a depender da parede (a lista de dependentes mudou).
    const grown = structuredClone(transaction.scene);
    grown.nodes.push(doorNode('window-1'));
    const changed = transactionOf(validateSpatialScene(grown));
    expect(failure(() => removeWallFromScene(changed, 'wall-1', 'reviewer', { ledger, authorizationId: authorization.id }))).toBe('AUTHORIZATION_DIGEST_MISMATCH');
    expect(changed.scene.nodes).toHaveLength(3);
  });

  it('a parede confirmada, com a porta por rever, também exige autorização', () => {
    const transaction = transactionOf(confirmedScene(['geometry']));
    expect(failure(() => removeWallFromScene(transaction, 'wall-1', 'reviewer'))).toBe('AUTHORIZATION_REQUIRED');
    const plan = planWallRemoval(transaction, 'wall-1', 'reviewer');
    expect(plan.touchesConfirmed).toEqual([{ entityId: 'wall-1', field: 'geometry', validation: 'verified' }]);
  });

  it('sem nada confirmado remove como hoje', () => {
    const transaction = transactionOf(confirmedScene());
    const plan = planWallRemoval(transaction, 'wall-1', 'reviewer');
    expect(plan).toMatchObject({ requiresAuthorization: false, touchesConfirmed: [] });
    const next = removeWallFromScene(transaction, 'wall-1', 'reviewer');
    expect(next.scene.nodes).toEqual([]);
    expect(next.scene.revision.number).toBe(2);
    expect(next.undoStack).toEqual([transaction.scene]);
    expect(next.redoStack).toEqual([]);
  });
});

describe('operações compostas — uma autorização cobre a operação inteira', () => {
  // Comprimento 4 → 6 m e centro da parede 0 → 0,5 m: muda a geometria, a posição da parede e a posição da porta.
  const MOVING_EDIT = { start: { x: -2.5, y: 0 }, end: { x: 3.5, y: 0 }, actor: 'reviewer' };
  const everything = () => transactionOf(confirmDoor(confirmedScene(['geometry', 'transform.translationM']), 'corrected', ['translationM']));

  it('editWallInScene: o plano agrega tudo o que os ~9 passos tocam e o digest cobre o agregado', () => {
    const plan = planWallEdit(everything(), 'wall-1', MOVING_EDIT);
    expect(plan.touchesConfirmed).toEqual([
      { entityId: 'door-1', field: 'transform.translationM', validation: 'corrected' },
      { entityId: 'wall-1', field: 'geometry', validation: 'verified' },
      { entityId: 'wall-1', field: 'transform.translationM', validation: 'verified' },
    ]);
    expect(plan.requiresAuthorization).toBe(true);
    expect(plan.operation.name).toBe('EditWall');
    expect(plan.operation.affected).toEqual(['door-1', 'wall-1']);
    expect(plan.operation.changes.map((change) => `${change.entityId}:${change.field}`)).toEqual(expect.arrayContaining(['wall-1:geometry', 'wall-1:transform.translationM', 'door-1:transform.translationM']));
    expect(plan.transaction.scene.revision.number).toBe(9);
  });

  it('sem autorização nada é aplicado (tudo ou nada)', () => {
    const transaction = everything();
    const before = snapshot(transaction);
    expect(failure(() => editWallInScene(transaction, 'wall-1', MOVING_EDIT))).toBe('AUTHORIZATION_REQUIRED');
    expect(failure(() => editWallInScene(transaction, 'wall-1', MOVING_EDIT, { ledger: newLedger() }))).toBe('AUTHORIZATION_REQUIRED');
    expect(snapshot(transaction)).toBe(before);
  });

  it('uma única autorização aplica todos os passos; os confirmados ficam corrected com o mesmo id e o valor original', () => {
    const transaction = everything();
    const ledger = newLedger();
    const authorization = ledger.issue(planWallEdit(transaction, 'wall-1', MOVING_EDIT).operation, human, 'ui_direct');
    const next = editWallInScene(transaction, 'wall-1', MOVING_EDIT, { ledger, authorizationId: authorization.id });
    expect(wall(next.scene).geometry).toMatchObject({ sizeM: [6, 2.7, 0.2], provenance: { validation: 'corrected', sourceValue: { kind: 'box', sizeM: [4, 2.7, 0.2] }, authorizationId: authorization.id, actor: 'reviewer' } });
    expect(wall(next.scene).transform.provenance.translationM).toMatchObject({ validation: 'corrected', sourceValue: [0, 0, 0], authorizationId: authorization.id });
    expect(door(next.scene).transform.provenance.translationM).toMatchObject({ validation: 'corrected', sourceValue: [1, 1, 0], authorizationId: authorization.id });
    // O que não era confirmado segue as regras de hoje.
    expect(wall(next.scene).transform.provenance.rotation).toMatchObject({ validation: 'unreviewed' });
    expect(wall(next.scene).transform.provenance.rotation.authorizationId).toBeUndefined();
    expect(wall(next.scene).component!.properties.length!.provenance).toMatchObject({ validation: 'unreviewed' });
    expect(next.undoStack).toEqual([transaction.scene]);
    expect(() => validateSpatialScene(JSON.parse(serializeSpatialScene(next.scene)))).not.toThrow();
  });

  it('a autorização de um único passo não cobre a operação composta', () => {
    const transaction = everything();
    const ledger = newLedger();
    const resizeOnly = previewSceneCommand(transaction, { type: 'ResizeComponent', nodeId: 'wall-1', scale: [1.25, 1, 1] }, 'reviewer', clock).operation!;
    expect(failure(() => editWallInScene(transaction, 'wall-1', MOVING_EDIT, { ledger, authorizationId: ledger.issue(resizeOnly, human, 'ui_direct').id }))).toBe('AUTHORIZATION_DIGEST_MISMATCH');
  });

  it('autorização para outro valor, outra revisão ou já usada falha', () => {
    const transaction = everything();
    const ledger = newLedger();
    const other = planWallEdit(transaction, 'wall-1', { ...MOVING_EDIT, end: { x: 3, y: 0 } }).operation;
    expect(failure(() => editWallInScene(transaction, 'wall-1', MOVING_EDIT, { ledger, authorizationId: ledger.issue(other, human, 'ui_direct').id }))).toBe('AUTHORIZATION_DIGEST_MISMATCH');
    const futureScene = transactionOf(confirmDoor(confirmedScene(['geometry', 'transform.translationM'], 4), 'corrected', ['translationM']));
    expect(failure(() => editWallInScene(transaction, 'wall-1', MOVING_EDIT, { ledger, authorizationId: ledger.issue(planWallEdit(futureScene, 'wall-1', MOVING_EDIT).operation, human, 'ui_direct').id }))).toBe('AUTHORIZATION_REVISION_MISMATCH');
    const good = ledger.issue(planWallEdit(transaction, 'wall-1', MOVING_EDIT).operation, human, 'ui_direct');
    editWallInScene(transaction, 'wall-1', MOVING_EDIT, { ledger, authorizationId: good.id });
    expect(failure(() => editWallInScene(transaction, 'wall-1', MOVING_EDIT, { ledger, authorizationId: good.id }))).toBe('AUTHORIZATION_ALREADY_USED');
  });

  it('o digest do agregado não depende de quando o plano foi feito, e muda com os dependentes', () => {
    const transaction = everything();
    const first = planWallEdit(transaction, 'wall-1', MOVING_EDIT);
    const second = planWallEdit(transaction, 'wall-1', MOVING_EDIT);
    expect(second.operationDigest).toBe(first.operationDigest);
    const grown = structuredClone(transaction.scene);
    grown.nodes.push(doorNode('door-2'));
    grown.nodes.find((node) => node.id === 'door-2')!.component!.properties.offset!.value = 3;
    expect(planWallEdit(transactionOf(validateSpatialScene(grown)), 'wall-1', MOVING_EDIT).operationDigest).not.toBe(first.operationDigest);
  });

  it('commit com a transacção actual refaz o plano: dependentes mudados na mesma revisão → PREVIEW_TAMPERED; revisão nova → STALE_PREVIEW', () => {
    const transaction = everything();
    const ledger = newLedger();
    const plan = planWallEdit(transaction, 'wall-1', MOVING_EDIT);
    const authorization = ledger.issue(plan.operation, human, 'ui_direct');
    const grown = structuredClone(transaction.scene);
    grown.nodes.push(doorNode('door-2'));
    grown.nodes.find((node) => node.id === 'door-2')!.component!.properties.offset!.value = 3;
    expect(failure(() => plan.commit({ ledger, authorizationId: authorization.id }, transactionOf(validateSpatialScene(grown))))).toBe('PREVIEW_TAMPERED');
    const advanced = executeSceneCommand(transaction, { type: 'UpdateParameter', nodeId: 'wall-1', property: 'note2', value: 'x' }, 'reviewer', clock).transaction;
    expect(failure(() => plan.commit({ ledger, authorizationId: authorization.id }, advanced))).toBe('STALE_PREVIEW');
    expect(wall(plan.commit({ ledger, authorizationId: authorization.id }, transaction).scene).geometry!.provenance.authorizationId).toBe(authorization.id);
  });

  it('editOpeningInScene também: valores confirmados da abertura exigem uma autorização para o conjunto', () => {
    const transaction = transactionOf(confirmDoor(confirmedScene(), 'verified', ['width', 'geometry']));
    const edit = { offsetM: 0.6, widthM: 1, heightM: 2.1, sillM: 0, actor: 'reviewer' };
    const before = snapshot(transaction);
    expect(failure(() => editOpeningInScene(transaction, 'door-1', edit))).toBe('AUTHORIZATION_REQUIRED');
    expect(snapshot(transaction)).toBe(before);
    const plan = planOpeningEdit(transaction, 'door-1', edit);
    expect(plan.touchesConfirmed.map((item) => `${item.entityId}:${item.field}`)).toEqual(['door-1:component.properties.width', 'door-1:geometry']);
    const ledger = newLedger();
    const next = editOpeningInScene(transaction, 'door-1', edit, { ledger, authorizationId: ledger.issue(plan.operation, human, 'ui_direct').id });
    expect(door(next.scene).geometry).toMatchObject({ sizeM: [1, 2.1, 0.04], provenance: { validation: 'corrected', sourceValue: { kind: 'box', sizeM: [0.9, 2.1, 0.04] } } });
    expect(door(next.scene).component!.properties.width).toMatchObject({ value: 1, provenance: { validation: 'corrected', sourceValue: 0.9 } });
  });

  it('sem nada confirmado, as operações compostas não pedem nada e o plano di-lo', () => {
    const transaction = transactionOf(confirmedScene());
    expect(planWallEdit(transaction, 'wall-1', MOVING_EDIT)).toMatchObject({ requiresAuthorization: false, touchesConfirmed: [] });
    expect(planOpeningEdit(transaction, 'door-1', { offsetM: 0.6, widthM: 1, heightM: 2.1, sillM: 0 })).toMatchObject({ requiresAuthorization: false });
  });
});

describe('F3 — DisconnectComponents sobre uma relação confirmada', () => {
  const withRelation = (validation: 'unreviewed' | 'verified' | 'corrected') => {
    const scene = structuredClone(confirmedScene());
    scene.relations.push({ id: 'rel-1', fromNodeId: 'door-1', toNodeId: 'wall-1', kind: 'hosted_by', properties: { gap: { value: 0.01, unit: 'm', provenance: provenanceFor(validation) } }, provenance: provenanceFor('unreviewed') });
    return transactionOf(validateSpatialScene(scene));
  };

  it.each(['verified', 'corrected'] as const)('desligar uma relação com um valor "%s" exige autorização', (validation) => {
    const transaction = withRelation(validation);
    const before = snapshot(transaction);
    const command: SpatialCommand = { type: 'DisconnectComponents', relationId: 'rel-1' };
    expect(previewSceneCommand(transaction, command, 'reviewer', clock)).toMatchObject({ requiresAuthorization: true, touchesConfirmed: [{ entityId: 'rel-1', field: 'properties.gap', validation }] });
    expect(failure(() => executeSceneCommand(transaction, command, 'reviewer', clock))).toBe('AUTHORIZATION_REQUIRED');
    expect(snapshot(transaction)).toBe(before);
  });

  it('sem confirmação desliga-se como hoje', () => {
    const { transaction } = executeSceneCommand(withRelation('unreviewed'), { type: 'DisconnectComponents', relationId: 'rel-1' }, 'reviewer', clock);
    expect(transaction.scene.relations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// F4 — origem e actor
// ---------------------------------------------------------------------------------------------------------------------
import { conversationEditToSceneCommand, type SceneCommandContext } from '../src/spatial-scene';
import { createSceneAuthorizer } from '../src/scene-authorizer';
import { model } from './helpers/scene-auth';

const asModel: SceneCommandContext = { origin: 'model_proposal', actor: model };
const asSystem: SceneCommandContext = { origin: 'system', actor: { kind: 'system', id: 'pipeline' } };
const asHuman: SceneCommandContext = { origin: 'ui_direct', actor: human };
const MACHINES: Array<[string, SceneCommandContext]> = [['model_proposal', asModel], ['system', asSystem]];

describe.each(MACHINES)('F4 — origem %s', (_name, context) => {
  const ALL_GUARDED: Array<[string, string, SpatialCommand]> = [
    ['component.properties', 'UpdateParameter', { type: 'UpdateParameter', nodeId: 'wall-1', property: 'thickness', value: 0.3, unit: 'm' }],
    ['node.properties', 'UpdateParameter (node)', { type: 'UpdateParameter', nodeId: 'wall-1', property: 'note', value: 'x' }],
    ['geometry', 'ResizeComponent', { type: 'ResizeComponent', nodeId: 'wall-1', scale: [2, 1, 1] }],
    ['geometry', 'UpdateGeometry', BOX],
    ['transform.translationM', 'MoveComponent', { type: 'MoveComponent', nodeId: 'wall-1', translationM: [1, 0, 0] }],
    ['transform.rotation', 'RotateComponent', { type: 'RotateComponent', nodeId: 'wall-1', axis: [0, 1, 0], angleRad: 1 }],
  ];

  it.each(ALL_GUARDED)('não toca em %s confirmado (%s): o preview fica bloqueado', (location, _label, command) => {
    for (const validation of ['verified', 'corrected'] as const) {
      const transaction = transactionOf(confirmedScene([{ name: location, validation }]));
      const before = snapshot(transaction);
      const preview = previewSceneCommand(transaction, command, 'muse', clock, context);
      expect(preview).toMatchObject({ status: 'blocked', candidate: null, requiresAuthorization: false, issues: [{ code: 'MACHINE_CANNOT_TOUCH_CONFIRMED' }] });
      expect(failure(() => executeSceneCommand(transaction, command, 'muse', clock, { context }))).toBe('MACHINE_CANNOT_TOUCH_CONFIRMED');
      expect(snapshot(transaction)).toBe(before);
    }
  });

  it('não remove nem desliga nada que tenha valores confirmados', () => {
    const transaction = transactionOf(confirmDoor(confirmedScene()));
    expect(previewSceneCommand(transaction, { type: 'RemoveComponent', nodeId: 'door-1' }, 'muse', clock, context)).toMatchObject({ status: 'blocked', issues: [{ code: 'MACHINE_CANNOT_TOUCH_CONFIRMED' }] });
  });

  it('não confirma: ConfirmParameter é recusado', () => {
    const transaction = transactionOf(confirmedScene());
    const command: SpatialCommand = { type: 'ConfirmParameter', nodeId: 'wall-1', property: 'thickness', note: 'Confirmado.' };
    expect(previewSceneCommand(transaction, command, 'muse', clock, context)).toMatchObject({ status: 'blocked', issues: [{ code: 'CONFIRMATION_REQUIRES_HUMAN_ACTOR' }] });
  });

  it('não cria verified nem corrected por nenhum caminho (AddComponent e UpdateGeometry a reivindicá-los)', () => {
    const transaction = transactionOf(confirmedScene());
    const claim = { ...doorNode('door-9'), properties: { note: { value: 'x', provenance: provenanceFor('verified') } } };
    expect(previewSceneCommand(transaction, { type: 'AddComponent', node: claim }, 'muse', clock, context).status).toBe('blocked');
    expect(previewSceneCommand(transaction, { type: 'UpdateGeometry', nodeId: 'wall-1', geometry: { kind: 'box', sizeM: [6, 2.7, 0.2], provenance: provenanceFor('verified') } }, 'muse', clock, context).status).toBe('blocked');
  });

  it('não repõe valores confirmados por Undo/Redo', () => {
    // Um humano confirma e depois alguém tenta desfazer: desfazer apagaria a confirmação.
    const start = transactionOf(confirmedScene());
    const confirmedTx = executeSceneCommand(start, { type: 'ConfirmParameter', nodeId: 'wall-1', property: 'thickness', note: 'Confirmado em obra.' }, 'reviewer', clock).transaction;
    expect(previewSceneCommand(confirmedTx, { type: 'Undo' }, 'muse', clock, context)).toMatchObject({ status: 'blocked', issues: [{ code: 'MACHINE_CANNOT_TOUCH_CONFIRMED' }] });
    expect(previewSceneCommand(confirmedTx, { type: 'Undo' }, 'reviewer', clock, asHuman)).toMatchObject({ status: 'ready', requiresAuthorization: false });
    const undone = executeSceneCommand(confirmedTx, { type: 'Undo' }, 'reviewer', clock).transaction;
    expect(previewSceneCommand(undone, { type: 'Redo' }, 'muse', clock, context)).toMatchObject({ status: 'blocked' });
  });

  it('continua a poder criar conteúdo unreviewed: alterar, mover, adicionar', () => {
    const transaction = transactionOf(confirmedScene());
    const { transaction: edited } = executeSceneCommand(transaction, { type: 'UpdateParameter', nodeId: 'wall-1', property: 'thickness', value: 0.3, unit: 'm' }, 'muse', clock, { context });
    expect(thickness(edited.scene).provenance).toMatchObject({ validation: 'unreviewed', source: 'user' });
    const { transaction: moved } = executeSceneCommand(edited, { type: 'MoveComponent', nodeId: 'wall-1', translationM: [1, 0, 0] }, 'muse', clock, { context });
    expect(wall(moved.scene).transform.provenance.translationM.validation).toBe('unreviewed');
    const { transaction: added } = executeSceneCommand(moved, { type: 'AddComponent', node: doorNode('door-9') }, 'muse', clock, { context });
    expect(added.scene.nodes.map((node) => node.id)).toContain('door-9');
    for (const scene of [edited.scene, moved.scene, added.scene]) {
      const states = JSON.stringify(scene);
      expect(states).not.toMatch(/"validation":"(verified|corrected)"/);
    }
  });

  it('nunca consome uma autorização do ledger, nem sequer uma válida', () => {
    const transaction = transactionOf(confirmedScene());
    const ledger = newLedger();
    const humanPreview = previewSceneCommand(transactionOf(confirmedScene(['component.properties'])), update(), 'reviewer', clock, asHuman);
    const authorization = ledger.issue(humanPreview.operation!, human, 'ui_direct');
    let consumed = 0;
    const spy = { consume: (...args: Parameters<typeof ledger.consume>) => { consumed += 1; return ledger.consume(...args); } } as unknown as typeof ledger;
    const machinePreview = previewSceneCommand(transaction, update(), 'muse', clock, context);
    expect(machinePreview.requiresAuthorization).toBe(false);
    commitScenePreview(transaction, machinePreview, { ledger: spy, authorizationId: authorization.id });
    expect(consumed).toBe(0);
    // A autorização continua inteira para o pedido humano a que pertence.
    const humanTx = transactionOf(confirmedScene(['component.properties']));
    expect(thickness(commitScenePreview(humanTx, humanPreview, { ledger, authorizationId: authorization.id }).scene).provenance.validation).toBe('corrected');
  });

  it('um preview de máquina forjado como "ready" não faz commit mesmo com autorização válida', () => {
    const transaction = transactionOf(confirmedScene(['component.properties']));
    const ledger = newLedger();
    const humanPreview = previewSceneCommand(transaction, update(), 'reviewer', clock, asHuman);
    const authorization = ledger.issue(humanPreview.operation!, human, 'ui_direct');
    const machinePreview = previewSceneCommand(transaction, update(), 'muse', clock, context);
    expect(failure(() => commitScenePreview(transaction, machinePreview, { ledger, authorizationId: authorization.id }))).toBe('PREVIEW_BLOCKED');
    const forged = { ...machinePreview, status: 'ready' as const, candidate: humanPreview.candidate, operation: humanPreview.operation, operationDigest: humanPreview.operationDigest, requiresAuthorization: true };
    expect(failure(() => commitScenePreview(transaction, forged, { ledger, authorizationId: authorization.id }))).toBe('PREVIEW_TAMPERED');
    expect(thickness(transaction.scene).provenance.validation).toBe('verified');
  });

  it('as operações compostas também: editar ou remover paredes com confirmados é recusado, e sem eles funciona', () => {
    const origin = context.origin;
    const confirmedTx = transactionOf(confirmedScene(['geometry']));
    expect(failure(() => planWallEdit(confirmedTx, 'wall-1', WALL_EDIT, { origin }))).toBe('MACHINE_CANNOT_TOUCH_CONFIRMED');
    expect(failure(() => planWallRemoval(transactionOf(confirmDoor(confirmedScene())), 'wall-1', 'muse', { origin }))).toBe('MACHINE_CANNOT_TOUCH_CONFIRMED');
    expect(failure(() => editOpeningInScene(transactionOf(confirmDoor(confirmedScene(), 'verified', ['width'])), 'door-1', { offsetM: 0.6, widthM: 1, heightM: 2.1, sillM: 0 }, { origin }))).toBe('MACHINE_CANNOT_TOUCH_CONFIRMED');
    const plan = planWallEdit(transactionOf(confirmedScene()), 'wall-1', WALL_EDIT, { origin });
    expect(plan.requiresAuthorization).toBe(false);
    expect(JSON.stringify(plan.transaction.scene)).not.toMatch(/"validation":"(verified|corrected)"/);
  });
});

describe('F4 — ConfirmParameter só com um actor humano, e grava esse actor', () => {
  const confirm: SpatialCommand = { type: 'ConfirmParameter', nodeId: 'wall-1', property: 'thickness', note: 'Medido em obra.' };

  it('com um actor humano grava source "user" e o id desse actor', () => {
    const transaction = transactionOf(confirmedScene());
    const { transaction: next } = executeSceneCommand(transaction, confirm, 'ignorado', clock, { context: { origin: 'ui_direct', actor: { kind: 'human', id: 'maria' } } });
    expect(thickness(next.scene).provenance).toMatchObject({ source: 'user', validation: 'verified', actor: 'maria', evidence: 'Medido em obra.' });
  });

  it('o actor vem do contexto, não do texto livre: sem contexto, o texto é o id do humano de hoje', () => {
    const transaction = transactionOf(confirmedScene());
    const { transaction: next } = executeSceneCommand(transaction, confirm, 'reviewer', clock);
    expect(thickness(next.scene).provenance).toMatchObject({ source: 'user', actor: 'reviewer' });
  });

  it.each<[string, SceneCommandContext]>([
    ['actor de modelo com origem da interface', { origin: 'ui_direct', actor: model }],
    ['actor de sistema com origem da interface', { origin: 'ui_direct', actor: { kind: 'system', id: 'job' } }],
    ['actor humano com origem de modelo', { origin: 'model_proposal', actor: human }],
    ['actor humano com origem de sistema', { origin: 'system', actor: human }],
  ])('recusa %s', (_label, context) => {
    const transaction = transactionOf(confirmedScene());
    expect(previewSceneCommand(transaction, confirm, 'x', clock, context)).toMatchObject({ status: 'blocked', issues: [{ code: expect.stringMatching(/CONFIRMATION_REQUIRES_HUMAN_ACTOR|CONTEXT_INCONSISTENT/) }] });
  });

  it('aceita uma proposta de modelo confirmada na interface (ui_confirmed_proposal) com actor humano', () => {
    const transaction = transactionOf(confirmedScene());
    const { transaction: next } = executeSceneCommand(transaction, confirm, 'x', clock, { context: { origin: 'ui_confirmed_proposal', actor: human } });
    expect(thickness(next.scene).provenance.validation).toBe('verified');
  });

  it('voltar a confirmar um valor já confirmado reescreve a proveniência e por isso exige autorização', () => {
    const transaction = transactionOf(confirmedScene(['component.properties']));
    const preview = previewSceneCommand(transaction, confirm, 'reviewer', clock);
    expect(preview).toMatchObject({ requiresAuthorization: true, touchesConfirmed: [{ entityId: 'wall-1', field: 'component.properties.thickness', validation: 'verified' }] });
    expect(failure(() => commitScenePreview(transaction, preview))).toBe('AUTHORIZATION_REQUIRED');
    const authorizer = createSceneAuthorizer('s');
    const next = commitScenePreview(transaction, preview, authorizer.authorize(preview));
    expect(thickness(next.scene).provenance).toMatchObject({ validation: 'verified', authorizationId: expect.any(String) });
  });
});

describe('F4 — contexto coerente e propostas de modelo', () => {
  it('origem da interface com actor que não é humano é recusada para qualquer comando', () => {
    const transaction = transactionOf(confirmedScene());
    const preview = previewSceneCommand(transaction, update(), 'x', clock, { origin: 'ui_direct', actor: model });
    expect(preview).toMatchObject({ status: 'blocked', issues: [{ code: 'CONTEXT_INCONSISTENT' }] });
  });

  it('conversationEditToSceneCommand marca a proposta como vinda de um modelo', () => {
    const result = conversationEditToSceneCommand('Aumenta a manivela para 50 mm', 'crank', { kind: 'update_length', componentId: 'crank', value: 50, unit: 'mm' });
    expect(result).toMatchObject({ status: 'ready', origin: 'model_proposal' });
  });

  it('o contexto do preview acompanha-o: o commit refaz-o com a mesma origem', () => {
    const transaction = transactionOf(confirmedScene());
    const preview = previewSceneCommand(transaction, update(), 'muse', clock, asModel);
    expect(preview.context).toEqual(asModel);
    expect(commitScenePreview(transaction, preview).scene.revision.number).toBe(1);
  });
});

describe('F4 — addOpeningToScene com origem', () => {
  const opening = { id: 'door-new', kind: 'door' as const, offsetM: 2, widthM: 0.9, heightM: 2.1, sillM: 0, actor: 'user-confirmed:muse-spark' };

  it.each(['model_proposal', 'system'] as const)('origem %s acrescenta uma abertura por rever, sem tocar nem criar confirmados', (origin) => {
    const transaction = transactionOf(confirmedScene(['geometry', 'transform.translationM']));
    const next = addOpeningToScene(transaction, 'wall-1', opening, later, origin);
    const added = next.scene.nodes.find((node) => node.id === 'door-new')!;
    expect(added.component!.properties.offset!.provenance).toMatchObject({ validation: 'unreviewed' });
    expect(added.geometry!.provenance).toMatchObject({ validation: 'unreviewed', actor: 'user-confirmed:muse-spark' });
    expect(wall(next.scene).geometry!.provenance.validation).toBe('verified');
    expect(JSON.stringify(added)).not.toMatch(/"validation":"(verified|corrected)"/);
  });

  it('sem origem comporta-se como hoje', () => {
    const next = addOpeningToScene(transactionOf(confirmedScene()), 'wall-1', { ...opening, actor: 'reviewer' }, later);
    expect(next.scene.nodes.find((node) => node.id === 'door-new')!.component!.properties.width!.provenance).toMatchObject({ validation: 'unreviewed' });
  });
});

describe('UpdateGeometry num nó sem geometria', () => {
  it('diz GEOMETRY_REQUIRED, não que a geometria está bloqueada por estar confirmada', () => {
    const scene = structuredClone(confirmedScene());
    scene.nodes.find((node) => node.id === 'wall-1')!.geometry = null;
    const transaction = transactionOf(validateSpatialScene(scene));
    const preview = previewSceneCommand(transaction, BOX, 'reviewer', clock);
    expect(preview).toMatchObject({ status: 'blocked', issues: [{ code: 'GEOMETRY_REQUIRED' }] });
    expect(failure(() => executeSceneCommand(transaction, BOX, 'reviewer', clock))).toBe('GEOMETRY_REQUIRED');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Passos sem efeito não reescrevem a proveniência de valores confirmados.
// Apanhado no browser: mover uma parede só em X deixava a geometria e o comprimento confirmados como "corrected",
// com autorização, sem o tamanho ter mudado, porque editWallInScene emite sempre Resize(1), Rotate(0) e UpdateParameter(igual).
// ---------------------------------------------------------------------------------------------------------------------
describe('passos sem efeito num valor confirmado', () => {
  const noOps: Array<[string, string, SpatialCommand]> = [
    ['geometry', 'ResizeComponent com escala 1', { type: 'ResizeComponent', nodeId: 'wall-1', scale: [1, 1, 1] }],
    ['geometry', 'ResizeComponent com ruído de vírgula flutuante', { type: 'ResizeComponent', nodeId: 'wall-1', scale: [1 + 1e-12, 1 - 1e-12, 1] }],
    ['transform.translationM', 'MoveComponent para a mesma posição', { type: 'MoveComponent', nodeId: 'wall-1', translationM: [0, 0, 0] }],
    ['transform.rotation', 'RotateComponent de 0 rad', { type: 'RotateComponent', nodeId: 'wall-1', axis: [0, 1, 0], angleRad: 0 }],
    ['transform.rotation', 'RotateComponent de ruído', { type: 'RotateComponent', nodeId: 'wall-1', axis: [0, 1, 0], angleRad: 1e-13 }],
    ['component.properties', 'UpdateParameter com o mesmo valor e unidade', { type: 'UpdateParameter', nodeId: 'wall-1', property: 'thickness', value: 0.2, unit: 'm' }],
    ['node.properties', 'UpdateParameter de texto com o mesmo valor', { type: 'UpdateParameter', nodeId: 'wall-1', property: 'note', value: 'reboco' }],
  ];

  it.each(noOps.flatMap(([location, label, command]) => (['verified', 'corrected'] as const).map((validation) => [location, label, command, validation] as const)))(
    'sobre %s confirmado: %s (%s) não pede autorização e não mexe na proveniência',
    (location, _label, command, validation) => {
      const transaction = transactionOf(confirmedScene([{ name: location, validation }]));
      const preview = previewSceneCommand(transaction, command, 'reviewer', clock);
      expect(preview).toMatchObject({ status: 'ready', requiresAuthorization: false, touchesConfirmed: [] });
      const { transaction: next } = executeSceneCommand(transaction, command, 'reviewer', clock);
      const confirmedOf = (scene: ReturnType<typeof confirmedScene>) => JSON.stringify([wall(scene).transform.provenance, wall(scene).geometry!.provenance, wall(scene).component!.properties, wall(scene).properties]);
      expect(confirmedOf(next.scene)).toBe(confirmedOf(transaction.scene));
      expect(next.scene.revision.number).toBe(1);
    },
  );

  it('um valor que muda a sério continua a exigir autorização (controlo)', () => {
    for (const [location, command] of [
      ['geometry', { type: 'ResizeComponent', nodeId: 'wall-1', scale: [1.001, 1, 1] }],
      ['transform.translationM', { type: 'MoveComponent', nodeId: 'wall-1', translationM: [0.001, 0, 0] }],
      ['transform.rotation', { type: 'RotateComponent', nodeId: 'wall-1', axis: [0, 1, 0], angleRad: 0.001 }],
      ['component.properties', { type: 'UpdateParameter', nodeId: 'wall-1', property: 'thickness', value: 0.2001, unit: 'm' }],
      ['component.properties', { type: 'UpdateParameter', nodeId: 'wall-1', property: 'thickness', value: 0.2 }],
    ] as Array<[string, SpatialCommand]>) {
      const preview = previewSceneCommand(transactionOf(confirmedScene([location])), command, 'reviewer', clock);
      expect(preview.requiresAuthorization, `${location} ${JSON.stringify(command)}`).toBe(true);
    }
  });

  const provenanceAt = (scene: ReturnType<typeof confirmedScene>, location: string) => ({
    'geometry': wall(scene).geometry!.provenance,
    'transform.translationM': wall(scene).transform.provenance.translationM,
    'transform.rotation': wall(scene).transform.provenance.rotation,
    'component.properties': wall(scene).component!.properties.thickness!.provenance,
    'node.properties': wall(scene).properties.note!.provenance,
  } as Record<string, ReturnType<typeof provenanceFor>>)[location]!;

  it.each(noOps.filter(([, label]) => !/ruído/.test(label)))('em valores que não estão confirmados nada muda: %s continua a reescrever a proveniência, como hoje', (location, _label, command) => {
    const transaction = transactionOf(confirmedScene());
    const { transaction: next } = executeSceneCommand(transaction, command, 'reviewer', clock);
    expect(provenanceAt(next.scene, location)).toMatchObject({ source: 'user', validation: 'unreviewed', actor: 'reviewer', recordedAt: later });
  });

  describe('editWallInScene', () => {
    // Parede com a geometria e a espessura confirmadas. Só a posição muda: o centro passa de 0 para 0,5 m e o comprimento fica em 4 m.
    const confirmedWall = () => transactionOf(confirmedScene(['geometry', 'component.properties']));
    const MOVE_ONLY = { start: { x: -1.5, y: 0 }, end: { x: 2.5, y: 0 }, actor: 'reviewer' };

    it('mover a parede não toca na geometria nem na espessura confirmadas, e não pede autorização', () => {
      const transaction = confirmedWall();
      const plan = planWallEdit(transaction, 'wall-1', MOVE_ONLY);
      expect(plan).toMatchObject({ requiresAuthorization: false, touchesConfirmed: [] });
      const next = editWallInScene(transaction, 'wall-1', MOVE_ONLY);
      expect(wall(next.scene).transform.translationM[0]).toBeCloseTo(0.5);
      expect(wall(next.scene).geometry!.provenance).toEqual(wall(transaction.scene).geometry!.provenance);
      expect(wall(next.scene).geometry).toMatchObject({ sizeM: [4, 2.7, 0.2] });
      expect(wall(next.scene).component!.properties.thickness!.provenance).toEqual(wall(transaction.scene).component!.properties.thickness!.provenance);
      // Centro da parede em x = 0,5; porta a 0,5 + 0,9/2 − 4/2 = −1,05 do centro.
      expect(door(next.scene).transform.translationM[0]).toBeCloseTo(-0.55);
    });

    it('mudar o comprimento continua a exigir autorização e só a geometria confirmada é tocada', () => {
      const plan = planWallEdit(confirmedWall(), 'wall-1', { ...MOVE_ONLY, end: { x: 3.5, y: 0 } });
      expect(plan.requiresAuthorization).toBe(true);
      expect(plan.touchesConfirmed).toEqual([{ entityId: 'wall-1', field: 'geometry', validation: 'verified' }]);
    });

    it('uma posição confirmada que muda continua a exigir autorização', () => {
      const plan = planWallEdit(transactionOf(confirmedScene(['transform.translationM'])), 'wall-1', MOVE_ONLY);
      expect(plan.touchesConfirmed).toEqual([{ entityId: 'wall-1', field: 'transform.translationM', validation: 'verified' }]);
    });

    it('numa parede sem nada confirmado o número de revisões e os valores são os de sempre', () => {
      const next = editWallInScene(transactionOf(confirmedScene()), 'wall-1', MOVE_ONLY);
      expect(next.scene.revision.number).toBe(9);
      expect(wall(next.scene).geometry!.provenance).toMatchObject({ validation: 'unreviewed', actor: 'reviewer' });
    });
  });
});
