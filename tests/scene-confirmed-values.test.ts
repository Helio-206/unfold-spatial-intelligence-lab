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
