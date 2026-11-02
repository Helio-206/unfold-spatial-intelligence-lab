import { describe, expect, it } from 'vitest';
import { explainSceneError } from '../src/scene-messages';
import { commitScenePreview, previewSceneCommand } from '../src/spatial-scene';
import { clock } from './helpers/scenes';
import { confirmedScene, failure, transactionOf, model } from './helpers/scene-auth';

// Todos os códigos de AuthorizationFailure do Core, mais os da guarda da cena.
const CORE_CODES = ['AUTHORIZATION_REQUIRED', 'AUTHORIZATION_UNKNOWN', 'AUTHORIZATION_ALREADY_USED', 'AUTHORIZATION_EXPIRED', 'AUTHORIZATION_DIGEST_MISMATCH', 'AUTHORIZATION_REVISION_MISMATCH', 'AUTHORIZATION_SESSION_MISMATCH', 'MODEL_CANNOT_AUTHORIZE'];
// Os motivos por que a fusão de duas divisões fica bloqueada.
const ROOM_MERGE_CODES = ['ROOM_MERGE_SINGLE_ROOM', 'ROOM_MERGE_MORE_THAN_TWO_ROOMS', 'ROOM_MERGE_NOT_POLYGON', 'ROOM_MERGE_UNSUPPORTED_TRANSFORM', 'ROOM_MERGE_EDGE_MISMATCH', 'ROOM_MERGE_TOUCH_ELSEWHERE', 'ROOM_MERGE_NOT_SIMPLE', 'ROOM_MERGE_OTHER_RELATIONS', 'ROOM_MERGE_AREA_NOT_CONSERVED'];
const SCENE_CODES = ['MACHINE_CANNOT_TOUCH_CONFIRMED', 'CONFIRMATION_REQUIRES_HUMAN_ACTOR', 'CONTEXT_INCONSISTENT', 'STALE_PREVIEW', 'PREVIEW_TAMPERED', 'PREVIEW_BLOCKED', 'GEOMETRY_REQUIRED', 'NEW_GEOMETRY_CANNOT_CLAIM_HUMAN_VERIFICATION', 'AUTHORIZED_VALUE_NOT_CORRECTED', ...ROOM_MERGE_CODES];

describe('mensagens para o utilizador', () => {
  it.each([...CORE_CODES, ...SCENE_CODES])('%s tem uma explicação em português, sem o código cru', (code) => {
    const message = explainSceneError(code);
    expect(message).not.toBe(code);
    expect(message).not.toContain(code);
    expect(message.length).toBeGreaterThan(20);
    expect(message).toMatch(/[a-zçãõáéíóú]/);
  });

  it('as mensagens não repetem "Nenhuma revisão foi aplicada", que o editor acrescenta', () => {
    for (const code of [...CORE_CODES, ...SCENE_CODES]) expect(explainSceneError(code)).not.toMatch(/Nenhuma revisão foi aplicada/);
  });

  it('o bloqueio de uma proposta de modelo diz o que fazer em vez disso', () => {
    expect(explainSceneError('MACHINE_CANNOT_TOUCH_CONFIRMED')).toMatch(/Muse|modelo/);
    expect(explainSceneError('MACHINE_CANNOT_TOUCH_CONFIRMED')).toMatch(/confirm/);
    expect(explainSceneError('MACHINE_CANNOT_TOUCH_CONFIRMED')).toMatch(/directamente|inspector/);
  });

  it('o pedido de autorização manda rever a pré-visualização e aplicar', () => {
    expect(explainSceneError('AUTHORIZATION_REQUIRED')).toMatch(/Aplicar/);
  });

  it('as autorizações inválidas mandam pré-visualizar de novo', () => {
    for (const code of ['AUTHORIZATION_UNKNOWN', 'AUTHORIZATION_ALREADY_USED', 'AUTHORIZATION_EXPIRED', 'AUTHORIZATION_DIGEST_MISMATCH', 'AUTHORIZATION_REVISION_MISMATCH', 'AUTHORIZATION_SESSION_MISMATCH', 'STALE_PREVIEW', 'PREVIEW_TAMPERED']) {
      expect(explainSceneError(code), code).toMatch(/pré-visualiz/i);
    }
  });

  it('o que não é um código conhecido passa tal e qual (mensagens já escritas em português)', () => {
    for (const text of ['Seleccione uma parede paramétrica.', 'A abertura excede os limites da parede.', 'REMOVE_HAS_DEPENDENCIES', '', 'Falha desconhecida']) expect(explainSceneError(text)).toBe(text);
  });

  it('só traduz o código quando a mensagem é exactamente esse código', () => {
    expect(explainSceneError('x MACHINE_CANNOT_TOUCH_CONFIRMED y')).toBe('x MACHINE_CANNOT_TOUCH_CONFIRMED y');
  });

  it('cobre os códigos que a cena realmente lança', () => {
    const transaction = transactionOf(confirmedScene(['component.properties', 'geometry']));
    const machine = { origin: 'model_proposal' as const, actor: model };
    const blocked = previewSceneCommand(transaction, { type: 'ResizeComponent', nodeId: 'wall-1', scale: [2, 1, 1] }, 'muse', clock, machine);
    const thrown = [blocked.issues[0]!.code, failure(() => commitScenePreview(transaction, previewSceneCommand(transaction, { type: 'ResizeComponent', nodeId: 'wall-1', scale: [2, 1, 1] }, 'r', clock)))];
    for (const code of thrown) expect(explainSceneError(code), code).not.toBe(code);
  });
});

import { confirmedNotice } from '../src/scene-messages';
import { planWallEdit, planWallRemoval } from '../src/plan-scene';
import { confirmDoorForNotice } from './helpers/scene-auth';

describe('aviso de que o preview toca valores confirmados', () => {
  const labelOf = (id: string) => ({ 'wall-1': 'Parede 1', 'door-1': 'Porta' } as Record<string, string>)[id] ?? id;

  it('não diz nada quando não toca em nada', () => {
    expect(confirmedNotice([], labelOf)).toBe('');
  });

  it('diz o que toca, por componente, e que «Aplicar» o autoriza', () => {
    const notice = confirmedNotice([
      { entityId: 'door-1', field: 'transform.translationM', validation: 'verified' },
      { entityId: 'wall-1', field: 'component.properties.length', validation: 'verified' },
      { entityId: 'wall-1', field: 'geometry', validation: 'corrected' },
    ], labelOf);
    expect(notice).toContain('Parede 1: comprimento, geometria');
    expect(notice).toContain('Porta: posição');
    expect(notice).toMatch(/confirmados/);
    expect(notice).toMatch(/«Aplicar» autoriza/);
  });

  it('traduz os campos conhecidos e deixa o nome dos desconhecidos', () => {
    const fields = ['geometry', 'transform.translationM', 'transform.rotation', 'transform.scale', 'component.properties.thickness', 'component.properties.height', 'component.properties.width', 'component.properties.offset', 'component.properties.sill', 'component.properties.area', 'properties.name', 'properties.note', 'node', 'relation'];
    const notice = confirmedNotice(fields.map((field) => ({ entityId: 'wall-1', field, validation: 'verified' as const })), labelOf);
    for (const word of ['geometria', 'posição', 'rotação', 'escala', 'espessura', 'altura', 'largura', 'offset', 'peitoril', 'área', 'nome', 'note', 'o próprio componente', 'relação']) expect(notice, word).toContain(word);
    expect(notice).not.toMatch(/component\.properties|transform\.|translationM/);
  });

  it('não repete o mesmo campo e limita a lista', () => {
    const many = Array.from({ length: 12 }, (_, index) => ({ entityId: `node-${index}`, field: 'geometry', validation: 'verified' as const }));
    const notice = confirmedNotice([...many, ...many], labelOf);
    expect(notice).toMatch(/e mais 6/);
    expect(notice.length).toBeLessThan(400);
    expect(confirmedNotice([{ entityId: 'wall-1', field: 'geometry', validation: 'verified' }, { entityId: 'wall-1', field: 'geometry', validation: 'verified' }], labelOf).match(/geometria/g)).toHaveLength(1);
  });

  it('serve ao plano real de uma operação composta', () => {
    const transaction = confirmDoorForNotice();
    const wallPlan = planWallEdit(transaction, 'wall-1', { start: { x: -2.5, y: 0 }, end: { x: 3.5, y: 0 }, actor: 'reviewer' });
    expect(confirmedNotice(wallPlan.touchesConfirmed, labelOf)).toMatch(/Parede 1: .*geometria/);
    expect(confirmedNotice(planWallRemoval(transaction, 'wall-1', 'reviewer').touchesConfirmed, labelOf)).toContain('Porta: largura');
  });
});
