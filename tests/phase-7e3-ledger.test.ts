import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { finishAuthorizedCall, reserveAuthorizedCall } from '../server/phase-7e3-live';

function ledgerFixture() {
  return {
    schema: 'unfold.global_meta_call_ledger.v1',
    authorization: { maximumCalls: 6, previouslyConsumed: 5, phaseAllowance: 1 },
    history: [
      { phase: '7D', realCalls: 4, source: '7D ledger fixture' },
      { phase: '7E', realCalls: 0, source: '7E ledger fixture' },
      { phase: '7E.1', realCalls: 1, requestId: 'prior-live-request-fixture', source: '7E.1 ledger fixture' },
    ],
    phase: { name: '7E.3', authorizedCalls: 1, usedCalls: 0 },
    limit: 6, used: 5, remaining: 1, status: 'READY_FOR_SINGLE_CALL',
  };
}

describe('PHASE 7E.3 single-call global ledger', () => {
  it('reserves only the final globally authorized call and preserves historical entries', () => {
    const directory = mkdtempSync(join(tmpdir(), 'unfold-7e3-ledger-'));
    const path = join(directory, 'ledger.json');
    writeFileSync(path, JSON.stringify(ledgerFixture()));
    try {
      const reserved = reserveAuthorizedCall(path, '2026-10-31T00:00:00.000Z');
      expect(reserved).toMatchObject({ used: 6, remaining: 0, phase: { usedCalls: 1 }, status: 'CALL_RESERVED' });
      const saved = JSON.parse(readFileSync(path, 'utf8'));
      expect(saved.history).toEqual(ledgerFixture().history);
      expect(() => reserveAuthorizedCall(path)).toThrow('PHASE7E3_BUDGET_NOT_AVAILABLE');
      expect(JSON.parse(readFileSync(path, 'utf8')).used).toBe(6);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('records the terminal call outcome without reopening the budget', () => {
    const directory = mkdtempSync(join(tmpdir(), 'unfold-7e3-finish-'));
    const path = join(directory, 'ledger.json');
    writeFileSync(path, JSON.stringify(ledgerFixture()));
    try {
      reserveAuthorizedCall(path, '2026-10-31T00:00:00.000Z');
      finishAuthorizedCall(path, { requestId: 'new-live-request-fixture', httpStatus: 200, responseStatus: 'completed', completedAt: '2026-10-31T00:00:01.000Z', success: true });
      expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ used: 6, remaining: 0, phase: { usedCalls: 1 }, status: 'CALL_COMPLETED', lastCall: { requestId: 'new-live-request-fixture', httpStatus: 200 } });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
