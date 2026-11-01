import { describe, expect, it } from 'vitest';
import { AuthorizationError, AuthorizationLedger, categoryOf, type Actor, type CommandOrigin } from '../src/core';
import { commitValueChange, previewValueChange, solveDc, type CircuitV1, type DcResult, type ValueChangeRequest } from '../src/domains/electrical';
import { at, circuit, clock, confirmed, R, V } from './helpers/circuits';

const human: Actor & { kind: 'human' } = { kind: 'human', id: 'local-user' };
const model: Actor = { kind: 'model', id: 'muse-spark-1.3' };

/** Divisor 10 V / R1 = 1 kΩ / R2 = 2 kΩ. Com R2 = 3 kΩ: V(mid) = 10 · 3k/(1k + 3k) = 7.5 V. */
const observedCircuit = () => circuit([V('V1', 'in', 'gnd', 10), R('R1', 'in', 'mid', 1000), R('R2', 'mid', 'gnd', 2000)]);
const confirmedCircuit = () => circuit([V('V1', 'in', 'gnd', 10), R('R1', 'in', 'mid', 1000), R('R2', 'mid', 'gnd', 2000, confirmed)]);

const request = (overrides: Partial<ValueChangeRequest> = {}): ValueChangeRequest => ({ componentId: 'R2', value: 3000, origin: 'ui_direct', actor: human, ...overrides });
const newLedger = (options: { ttlMs?: number } = {}) => { let n = 0; return new AuthorizationLedger({ sessionId: 's1', clock, newId: () => `auth-${++n}`, ...options }); };
const failure = (fn: () => unknown): string => {
  try { fn(); } catch (error) { return error instanceof AuthorizationError ? error.code : error instanceof Error ? error.message : String(error); }
  return 'NO_ERROR';
};
const value = (c: CircuitV1, id: string) => c.components.find((x) => x.id === id)!.value;
const voltage = (result: DcResult | null, net: string) => (result?.status === 'solved' ? result.nodeVoltages[net]!.value : undefined);

describe('alterar valor — valor "observed"', () => {
  it('pode ser alterado sem autorização e o resultado fica "human_entered"', () => {
    const c = observedCircuit();
    const preview = previewValueChange(c, request(), clock);
    expect(preview.status).toBe('ready');
    expect(preview.requiresAuthorization).toBe(false);
    expect(preview.touchesConfirmed).toEqual([]);
    const next = commitValueChange(c, preview, request(), { ledger: newLedger() });
    expect(value(next, 'R2').value).toBe(3000);
    expect(value(next, 'R2').unit).toBe('ohm');
    expect(value(next, 'R2').provenance).toMatchObject({ origin: 'human_entered', validation: 'unreviewed', actor: human, recordedAt: at });
    expect(value(next, 'R2').provenance.previous).toBeUndefined();
    expect(value(next, 'R1').provenance.origin).toBe('observed');
  });

  it('cria uma revisão nova e não mexe no circuito original', () => {
    const c = observedCircuit();
    const before = structuredClone(c);
    const next = commitValueChange(c, previewValueChange(c, request(), clock), request(), { ledger: newLedger() });
    expect(c).toEqual(before);
    expect(next.revision).toEqual({ id: 'c1:r1', number: 1, parentId: 'c1:r0' });
  });

  it('o preview mostra o antes e o depois calculados (20/3 V → 7.5 V) sem alterar nada', () => {
    // Antes: 10 · 2k/3k = 20/3 V.  Depois (R2 = 3 kΩ): 10 · 3k/4k = 7.5 V.
    const c = observedCircuit();
    const preview = previewValueChange(c, request(), clock);
    expect(Math.abs(voltage(preview.before, 'mid')! - 20 / 3)).toBeLessThan(1e-9);
    expect(Math.abs(voltage(preview.after, 'mid')! - 7.5)).toBeLessThan(1e-9);
    expect(preview.operation.changes).toEqual([{ entityId: 'R2', field: 'resistance', from: 2000, to: 3000 }]);
    expect(value(c, 'R2').value).toBe(2000);
  });

  it('os resultados do solver no preview são "calculated" e apontam para as entradas', () => {
    const preview = previewValueChange(observedCircuit(), request(), clock);
    for (const result of [preview.before, preview.after!]) {
      if (result.status !== 'solved') throw new Error('esperava solved');
      for (const field of [...Object.values(result.nodeVoltages), ...Object.values(result.componentCurrents), ...Object.values(result.componentPower)]) {
        expect(categoryOf(field.provenance)).toBe('calculated');
        expect(field.provenance.derivedFrom).toEqual([{ entityId: 'V1', field: 'voltage' }, { entityId: 'R1', field: 'resistance' }, { entityId: 'R2', field: 'resistance' }]);
      }
    }
  });

  it('o depois reflecte o valor novo nas entradas de que depende', () => {
    const preview = previewValueChange(observedCircuit(), request(), clock);
    if (preview.after?.status !== 'solved') throw new Error('esperava solved');
    expect(preview.after.report.inputs.find((input) => input.entityId === 'R2')).toMatchObject({ origin: 'human_entered', validation: 'unreviewed' });
  });

  it('altera uma fonte pelo campo certo (voltage)', () => {
    const c = observedCircuit();
    const req = request({ componentId: 'V1', value: 12 });
    const preview = previewValueChange(c, req, clock);
    expect(preview.operation.changes[0]).toEqual({ entityId: 'V1', field: 'voltage', from: 10, to: 12 });
    expect(value(commitValueChange(c, preview, req, { ledger: newLedger() }), 'V1').value).toBe(12);
  });
});

describe('alterar valor — valor confirmado', () => {
  it('o preview marca requiresAuthorization e diz que campo confirmado toca', () => {
    const preview = previewValueChange(confirmedCircuit(), request(), clock);
    expect(preview.status).toBe('ready');
    expect(preview.requiresAuthorization).toBe(true);
    expect(preview.touchesConfirmed).toEqual([{ entityId: 'R2', field: 'resistance' }]);
  });

  it('o commit sem autorização falha', () => {
    const c = confirmedCircuit();
    expect(failure(() => commitValueChange(c, previewValueChange(c, request(), clock), request(), { ledger: newLedger() }))).toBe('AUTHORIZATION_REQUIRED');
  });

  it('com a autorização certa passa, e a proveniência antiga fica em "previous"', () => {
    const c = confirmedCircuit();
    const ledger = newLedger();
    const preview = previewValueChange(c, request(), clock);
    const auth = ledger.issue(preview.operation, human, 'ui_direct');
    const next = commitValueChange(c, preview, request(), { ledger, authorizationId: auth.id });
    const provenance = value(next, 'R2').provenance;
    expect(value(next, 'R2').value).toBe(3000);
    expect(provenance).toMatchObject({ origin: 'human_entered', validation: 'corrected', actor: human, authorizationId: auth.id });
    expect(provenance.previous).toEqual({ value: 2000, provenance: confirmed });
    expect(categoryOf(provenance)).toBe('human_confirmed');
  });

  it('autorização emitida para outro valor falha', () => {
    const c = confirmedCircuit();
    const ledger = newLedger();
    const otherPreview = previewValueChange(c, request({ value: 5000 }), clock);
    const auth = ledger.issue(otherPreview.operation, human, 'ui_direct');
    expect(failure(() => commitValueChange(c, previewValueChange(c, request(), clock), request(), { ledger, authorizationId: auth.id }))).toBe('AUTHORIZATION_DIGEST_MISMATCH');
  });

  it('autorização emitida para outra revisão falha', () => {
    const c = confirmedCircuit();
    const ledger = newLedger();
    const later = circuit([V('V1', 'in', 'gnd', 10), R('R1', 'in', 'mid', 1000), R('R2', 'mid', 'gnd', 2000, confirmed)], { revision: 5 });
    const auth = ledger.issue(previewValueChange(later, request(), clock).operation, human, 'ui_direct');
    expect(failure(() => commitValueChange(c, previewValueChange(c, request(), clock), request(), { ledger, authorizationId: auth.id }))).toBe('AUTHORIZATION_REVISION_MISMATCH');
  });

  it('autorização já usada falha, e a segunda tentativa não altera nada', () => {
    const c = confirmedCircuit();
    const ledger = newLedger();
    const preview = previewValueChange(c, request(), clock);
    const auth = ledger.issue(preview.operation, human, 'ui_direct');
    commitValueChange(c, preview, request(), { ledger, authorizationId: auth.id });
    expect(failure(() => commitValueChange(c, preview, request(), { ledger, authorizationId: auth.id }))).toBe('AUTHORIZATION_ALREADY_USED');
    expect(value(c, 'R2').value).toBe(2000);
  });

  it('autorização desconhecida, de outra sessão ou expirada falha', () => {
    const c = confirmedCircuit();
    const preview = previewValueChange(c, request(), clock);
    const ledger = newLedger();
    expect(failure(() => commitValueChange(c, preview, request(), { ledger, authorizationId: 'auth-inventada' }))).toBe('AUTHORIZATION_UNKNOWN');
    const foreign = new AuthorizationLedger({ sessionId: 's2', clock, newId: () => 'auth-x' }).issue(preview.operation, human, 'ui_direct');
    expect(failure(() => commitValueChange(c, preview, request(), { ledger, authorizationId: foreign.id }))).toBe('AUTHORIZATION_UNKNOWN');
    let now = Date.parse(at);
    const shortLived = new AuthorizationLedger({ sessionId: 's1', clock: () => new Date(now), newId: () => 'a', ttlMs: 1000 });
    const auth = shortLived.issue(preview.operation, human, 'ui_direct');
    now += 1001;
    expect(failure(() => commitValueChange(c, preview, request(), { ledger: shortLived, authorizationId: auth.id }))).toBe('AUTHORIZATION_EXPIRED');
  });

  it('tentativas falhadas não queimam a autorização legítima', () => {
    const c = confirmedCircuit();
    const ledger = newLedger();
    const preview = previewValueChange(c, request(), clock);
    const auth = ledger.issue(preview.operation, human, 'ui_direct');
    const wrong = previewValueChange(c, request({ value: 4000 }), clock);
    expect(failure(() => commitValueChange(c, wrong, request({ value: 4000 }), { ledger, authorizationId: auth.id }))).toBe('AUTHORIZATION_DIGEST_MISMATCH');
    expect(failure(() => commitValueChange(c, preview, request(), { ledger }))).toBe('AUTHORIZATION_REQUIRED');
    expect(value(commitValueChange(c, preview, request(), { ledger, authorizationId: auth.id }), 'R2').value).toBe(3000);
  });

  it('um preview com requiresAuthorization forjado a false não dispensa a autorização', () => {
    const c = confirmedCircuit();
    const preview = { ...previewValueChange(c, request(), clock), requiresAuthorization: false, touchesConfirmed: [] };
    expect(failure(() => commitValueChange(c, preview, request(), { ledger: newLedger() }))).toBe('AUTHORIZATION_REQUIRED');
  });
});

describe('alterar valor — quem pede', () => {
  // O actor humano conta: a origem sozinha tem de bastar para recusar (um modelo não passa por humano a mudar o campo `origin`).
  it.each<[CommandOrigin, string, Actor]>([
    ['model_proposal', 'actor modelo', model], ['model_proposal', 'actor humano', human],
    ['system', 'actor modelo', model], ['system', 'actor humano', human],
  ])('origem "%s" (%s) nunca faz commit, nem com autorização válida, nem num valor observado', (origin, _label, actor) => {
    for (const c of [observedCircuit(), confirmedCircuit()]) {
      const ledger = newLedger();
      const req = request({ origin, actor });
      const preview = previewValueChange(c, req, clock);
      const auth = ledger.issue(preview.operation, human, 'ui_direct'); // um humano autorizou exactamente esta operação
      expect(failure(() => commitValueChange(c, preview, req, { ledger, authorizationId: auth.id }))).toBe('MODEL_CANNOT_AUTHORIZE');
      // A autorização não foi gasta: o pedido legítimo da interface ainda a pode usar.
      const direct = request();
      expect(value(commitValueChange(c, previewValueChange(c, direct, clock), direct, { ledger, authorizationId: auth.id }), 'R2').value).toBe(3000);
    }
  });

  it('um pedido que diz vir da interface mas tem um modelo como actor não faz commit', () => {
    // Senão o valor ficaria marcado "human_entered" sem nenhum humano.
    const c = observedCircuit();
    for (const actor of [model, { kind: 'system', id: 'job' } as Actor]) {
      const req = request({ actor });
      expect(failure(() => commitValueChange(c, previewValueChange(c, req, clock), req, { ledger: newLedger() }))).toBe('MODEL_CANNOT_AUTHORIZE');
    }
  });

  it('uma proposta de modelo confirmada pelo humano na interface faz commit e guarda o registo da inferência', () => {
    const c = observedCircuit();
    const inference = { provider: 'meta', model: 'muse-spark-1.3', requestId: 'req-1', cached: false };
    const req = request({ origin: 'ui_confirmed_proposal', inference });
    const next = commitValueChange(c, previewValueChange(c, req, clock), req, { ledger: newLedger() });
    expect(value(next, 'R2').provenance).toMatchObject({ origin: 'human_entered', actor: human, inference });
  });
});

describe('alterar valor — preview adulterado ou obsoleto', () => {
  const ready = () => {
    const c = observedCircuit();
    return { c, preview: previewValueChange(c, request(), clock) };
  };

  it('candidato adulterado', () => {
    const { c, preview } = ready();
    const forged = structuredClone(preview);
    forged.candidate!.components.find((x) => x.id === 'R2')!.value.value = 9999;
    expect(failure(() => commitValueChange(c, forged, request(), { ledger: newLedger() }))).toBe('PREVIEW_TAMPERED');
  });

  it('digest adulterado', () => {
    const { c, preview } = ready();
    expect(failure(() => commitValueChange(c, { ...preview, digest: 'f'.repeat(64) }, request(), { ledger: newLedger() }))).toBe('PREVIEW_TAMPERED');
  });

  it('operação adulterada', () => {
    const { c, preview } = ready();
    const forged = structuredClone(preview);
    forged.operation.changes[0]!.to = 1;
    expect(failure(() => commitValueChange(c, forged, request(), { ledger: newLedger() }))).toBe('PREVIEW_TAMPERED');
  });

  it('instante de avaliação adulterado', () => {
    const { c, preview } = ready();
    expect(failure(() => commitValueChange(c, { ...preview, evaluatedAt: '2030-01-01T00:00:00.000Z' }, request(), { ledger: newLedger() }))).toBe('PREVIEW_TAMPERED');
  });

  it('pedido de commit com valor diferente do que foi mostrado', () => {
    const { c, preview } = ready();
    expect(failure(() => commitValueChange(c, preview, request({ value: 4000 }), { ledger: newLedger() }))).toBe('PREVIEW_TAMPERED');
  });

  it('circuito alterado entretanto, com revisão nova: STALE_PREVIEW', () => {
    const { c, preview } = ready();
    const advanced = commitValueChange(c, previewValueChange(c, request({ value: 2500 }), clock), request({ value: 2500 }), { ledger: newLedger() });
    expect(failure(() => commitValueChange(advanced, preview, request(), { ledger: newLedger() }))).toBe('STALE_PREVIEW');
  });

  it('circuito alterado entretanto sem revisão nova: PREVIEW_TAMPERED', () => {
    const { c, preview } = ready();
    value(c, 'R1').value = 1500;
    expect(failure(() => commitValueChange(c, preview, request(), { ledger: newLedger() }))).toBe('PREVIEW_TAMPERED');
  });
});

describe('alterar valor — pedidos recusados no preview', () => {
  it('componente inexistente', () => {
    const c = observedCircuit();
    const req = request({ componentId: 'R9' });
    const preview = previewValueChange(c, req, clock);
    expect(preview).toMatchObject({ status: 'blocked', candidate: null, after: null, issues: [expect.objectContaining({ code: 'COMPONENT_NOT_FOUND' })] });
    expect(failure(() => commitValueChange(c, preview, req, { ledger: newLedger() }))).toBe('PREVIEW_BLOCKED');
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])('valor não finito (%s)', (bad) => {
    const preview = previewValueChange(observedCircuit(), request({ value: bad }), clock);
    expect(preview).toMatchObject({ status: 'blocked', issues: [expect.objectContaining({ code: 'VALUE_INVALID' })] });
  });

  it.each([0, -10])('resistência não positiva (%s) é bloqueada pela validação do circuito candidato', (bad) => {
    const preview = previewValueChange(observedCircuit(), request({ value: bad }), clock);
    expect(preview).toMatchObject({ status: 'blocked', candidate: null, issues: [expect.objectContaining({ code: 'RESISTANCE_NOT_POSITIVE' })] });
  });

  it('um valor em falta (null) pode ser preenchido pelo humano', () => {
    const c = circuit([V('V1', 'in', 'gnd', 10), R('R1', 'in', 'gnd', null)]);
    expect(solveDc(c, { clock }).status).toBe('missing');
    const req = request({ componentId: 'R1', value: 500 });
    const preview = previewValueChange(c, req, clock);
    expect(preview.requiresAuthorization).toBe(false);
    expect(preview.operation.changes[0]).toEqual({ entityId: 'R1', field: 'resistance', from: null, to: 500 });
    expect(solveDc(commitValueChange(c, preview, req, { ledger: newLedger() }), { clock }).status).toBe('solved');
  });
});
