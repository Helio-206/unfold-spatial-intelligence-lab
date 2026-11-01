import { describe, expect, it } from 'vitest';
import { createSceneAuthorizer } from '../src/scene-authorizer';
import { commitScenePreview, previewSceneCommand, type SpatialCommand } from '../src/spatial-scene';
import { planWallEdit } from '../src/plan-scene';
import { clock } from './helpers/scenes';
import { confirmedScene, failure, transactionOf } from './helpers/scene-auth';

const UPDATE: SpatialCommand = { type: 'UpdateParameter', nodeId: 'wall-1', property: 'thickness', value: 0.3, unit: 'm' };

describe('emissor de autorizações da interface (salvaguarda de fluxo, não fronteira de segurança)', () => {
  it('não emite nada quando o preview não toca valores confirmados', () => {
    const authorizer = createSceneAuthorizer('session-1');
    const preview = previewSceneCommand(transactionOf(confirmedScene()), UPDATE, 'reviewer', clock);
    expect(authorizer.authorize(preview)).toEqual({});
  });

  it('emite uma autorização ligada à operação mostrada, que o commit consome uma só vez', () => {
    const transaction = transactionOf(confirmedScene(['component.properties']));
    const authorizer = createSceneAuthorizer('session-1');
    const preview = previewSceneCommand(transaction, UPDATE, 'reviewer', clock);
    const options = authorizer.authorize(preview);
    expect(options.authorizationId).toBeTruthy();
    expect(commitScenePreview(transaction, preview, options).scene.nodes[0]!.component!.properties.thickness!.provenance).toMatchObject({ validation: 'corrected', authorizationId: options.authorizationId });
    expect(failure(() => commitScenePreview(transaction, preview, options))).toBe('AUTHORIZATION_ALREADY_USED');
  });

  it('serve também para planos compostos', () => {
    const transaction = transactionOf(confirmedScene(['geometry']));
    const authorizer = createSceneAuthorizer('session-1');
    const plan = planWallEdit(transaction, 'wall-1', { start: { x: -2.5, y: 0 }, end: { x: 2.5, y: 0 }, actor: 'reviewer' });
    expect(plan.requiresAuthorization).toBe(true);
    const next = plan.commit(authorizer.authorize(plan), transaction);
    expect(next.scene.nodes[0]!.geometry!.provenance).toMatchObject({ validation: 'corrected' });
  });

  it('cada autorização é para um digest: a de um preview não serve a outro', () => {
    const transaction = transactionOf(confirmedScene(['component.properties']));
    const authorizer = createSceneAuthorizer('session-1');
    const first = previewSceneCommand(transaction, UPDATE, 'reviewer', clock);
    const second = previewSceneCommand(transaction, { ...UPDATE, value: 0.4 } as SpatialCommand, 'reviewer', clock);
    expect(failure(() => commitScenePreview(transaction, second, authorizer.authorize(first)))).toBe('AUTHORIZATION_DIGEST_MISMATCH');
  });

  it('nunca emite para uma origem de modelo nem de sistema', () => {
    const authorizer = createSceneAuthorizer('session-1');
    const preview = previewSceneCommand(transactionOf(confirmedScene(['component.properties'])), UPDATE, 'reviewer', clock);
    for (const origin of ['model_proposal', 'system'] as const) expect(failure(() => authorizer.authorize(preview, origin))).toBe('MODEL_CANNOT_AUTHORIZE');
  });

  it('um preview bloqueado não tem operação para autorizar', () => {
    const authorizer = createSceneAuthorizer('session-1');
    const blocked = previewSceneCommand(transactionOf(confirmedScene()), { type: 'MoveComponent', nodeId: 'nope', translationM: [0, 0, 0] }, 'reviewer', clock);
    expect(failure(() => authorizer.authorize({ ...blocked, requiresAuthorization: true }))).toBe('PREVIEW_BLOCKED');
  });

  it('cada sessão tem o seu ledger: a autorização de uma não serve noutra', () => {
    const transaction = transactionOf(confirmedScene(['component.properties']));
    const preview = previewSceneCommand(transaction, UPDATE, 'reviewer', clock);
    const options = createSceneAuthorizer('session-1').authorize(preview);
    expect(failure(() => commitScenePreview(transaction, preview, { ledger: createSceneAuthorizer('session-2').ledger, authorizationId: options.authorizationId }))).toBe('AUTHORIZATION_UNKNOWN');
  });
});
