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
