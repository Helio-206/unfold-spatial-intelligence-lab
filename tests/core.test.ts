import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AuthorizationError,
  AuthorizationLedger,
  canonicalize,
  categoryOf,
  operationDigest,
  sha256Hex,
  summarizeReport,
  type CanonicalOperation,
  type Provenance,
} from '../src/core';

const at = '2026-11-02T10:00:00.000Z';
const human = { kind: 'human' as const, id: 'local-user' };
const operation: CanonicalOperation = {
  domain: 'electrical',
  name: 'setComponentValue',
  subjectId: 'c1',
  baseRevisionId: 'c1:r0',
  changes: [{ entityId: 'R2', field: 'resistance', from: 1000, to: 220 }],
  affected: ['R2'],
};

describe('Core v0 — fronteira estrutural', () => {
  it('src/core não importa nada de fora de src/core', () => {
    const coreDir = resolve(__dirname, '../src/core');
    for (const file of readdirSync(coreDir).filter((name) => name.endsWith('.ts'))) {
      const source = readFileSync(join(coreDir, file), 'utf8');
      for (const match of source.matchAll(/(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/g)) {
        const specifier = match[1]!;
        expect(specifier.startsWith('.'), `${file} importa o pacote externo ${specifier}`).toBe(true);
        const target = resolve(dirname(join(coreDir, file)), specifier);
        expect(relative(coreDir, target).startsWith('..'), `${file} importa ${specifier}, fora de src/core`).toBe(false);
      }
    }
  });
});

describe('Core v0 — categorias de informação', () => {
  const base = (origin: Provenance['origin'], validation: Provenance['validation'] = 'unreviewed'): Provenance => ({ origin, validation, recordedAt: at });

  it('separa extraído, hipótese da IA, confirmação humana e cálculo', () => {
    expect(categoryOf(base('observed'))).toBe('extracted');
    expect(categoryOf(base('heuristic'))).toBe('extracted');
    expect(categoryOf(base('model_inferred'))).toBe('ai_hypothesis');
    expect(categoryOf(base('model_inferred', 'verified'))).toBe('human_confirmed');
    expect(categoryOf(base('solver'))).toBe('calculated');
    expect(categoryOf(base('derived'))).toBe('calculated');
    expect(categoryOf(base('synthetic'))).toBe('example');
    expect(categoryOf(base('unknown'))).toBe('unknown');
  });

  it('uma hipótese da IA rejeitada nunca passa a confirmada', () => {
    expect(categoryOf(base('model_inferred', 'rejected'))).toBe('ai_hypothesis');
  });
});

describe('Core v0 — serialização canónica e SHA-256', () => {
  it('a ordem das chaves não muda o resultado', () => {
    expect(canonicalize({ b: 1, a: { d: [1, 2], c: 'x' } })).toBe(canonicalize({ a: { c: 'x', d: [1, 2] }, b: 1 }));
  });

  it('recusa números não finitos e normaliza -0', () => {
    expect(() => canonicalize({ v: Number.NaN })).toThrow('CANONICAL_NON_FINITE_NUMBER');
    expect(canonicalize({ v: -0 })).toBe('{"v":0}');
  });

  it('o SHA-256 próprio coincide com o do Node', () => {
    for (const text of ['', 'abc', 'UNFOLD — From flat to space', 'x'.repeat(1000), canonicalize(operation)]) {
      expect(sha256Hex(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
    }
  });

  it('o digest muda quando o valor novo muda', () => {
    const other = { ...operation, changes: [{ ...operation.changes[0]!, to: 330 }] };
    expect(operationDigest(other)).not.toBe(operationDigest(operation));
  });
});

describe('Core v0 — autorização de uso único', () => {
  const ledger = () => {
    let n = 0;
    return new AuthorizationLedger({ sessionId: 's1', clock: () => new Date(at), newId: () => `auth-${++n}` });
  };
  const code = (fn: () => unknown) => {
    try { fn(); } catch (error) { return error instanceof AuthorizationError ? error.code : String(error); }
    return 'NO_ERROR';
  };

  it('aceita a operação exacta uma única vez', () => {
    const l = ledger();
    const auth = l.issue(operation, human, 'ui_direct');
    expect(l.consume(auth.id, operation).id).toBe(auth.id);
    expect(code(() => l.consume(auth.id, operation))).toBe('AUTHORIZATION_ALREADY_USED');
  });

  it('recusa outro valor, outra revisão e ausência de autorização', () => {
    const l = ledger();
    const auth = l.issue(operation, human, 'ui_direct');
    expect(code(() => l.consume(auth.id, { ...operation, changes: [{ ...operation.changes[0]!, to: 1 }] }))).toBe('AUTHORIZATION_DIGEST_MISMATCH');
    expect(code(() => l.consume(auth.id, { ...operation, baseRevisionId: 'c1:r1' }))).toBe('AUTHORIZATION_REVISION_MISMATCH');
    expect(code(() => l.consume(undefined, operation))).toBe('AUTHORIZATION_REQUIRED');
    // As tentativas falhadas não queimaram a autorização legítima.
    expect(l.consume(auth.id, operation).id).toBe(auth.id);
  });

  it('um modelo nunca emite autorizações', () => {
    expect(code(() => ledger().issue(operation, human, 'model_proposal'))).toBe('MODEL_CANNOT_AUTHORIZE');
  });

  it('autorizações expiram', () => {
    let now = Date.parse(at);
    const l = new AuthorizationLedger({ sessionId: 's1', clock: () => new Date(now), newId: () => 'a', ttlMs: 1000 });
    const auth = l.issue(operation, human, 'ui_direct');
    now += 1001;
    expect(code(() => l.consume(auth.id, operation))).toBe('AUTHORIZATION_EXPIRED');
  });
});

describe('Core v0 — relatório', () => {
  it('falha prevalece sobre desconhecido; sem verificações o estado é desconhecido', () => {
    const check = (status: 'pass' | 'fail' | 'unknown') => ({ id: status, status, subject: [], reason: 'teste' });
    expect(summarizeReport({ checks: [check('pass'), check('unknown'), check('fail')] }).status).toBe('fail');
    expect(summarizeReport({ checks: [check('pass'), check('unknown')] }).status).toBe('unknown');
    expect(summarizeReport({ checks: [check('pass')] }).status).toBe('pass');
    expect(summarizeReport({ checks: [] }).status).toBe('unknown');
  });
});
