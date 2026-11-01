import { describe, expect, it } from 'vitest';
import { AuthorizationLedger } from '../src/core';
import { commitValueChange, previewValueChange } from '../src/domains/electrical';
import { exampleCircuit, flowSpeed, formatOhm, parseCommand, previewView, readout, solve } from '../src/circuit-lab-model';

const clock = () => new Date('2026-11-01T12:00:00Z');
const actor = { kind: 'human' as const, id: 'tester' };

describe('circuit lab model', () => {
  it('reads values from the solver, rounded to what the screen shows', () => {
    const r = readout(solve(exampleCircuit('complete', clock), clock));
    expect(r.status).toBe('solved');
    if (r.status !== 'solved') return;
    expect(r.currentMa).toEqual({ r1: 21.2, r2: 10.6, r3: 10.6 });
    expect(r.voltageV.r2).toBe(4.99);
    expect(r.category).toBe('calculated');
  });

  it('marks the bundled circuit as an example, not as extracted data', () => {
    const circuit = exampleCircuit('complete', clock);
    expect(circuit.components.every((c) => c.value.provenance.origin === 'fixture')).toBe(true);
  });

  it('"Altera R2 para 220 Ω": preview gives the new currents from the solver, nothing is applied yet', () => {
    const circuit = exampleCircuit('complete', clock);
    const cmd = parseCommand('Altera R2 para 220 Ω');
    expect(cmd).toEqual({ ok: true, componentId: 'r2', value: 220 });
    if (!cmd.ok) return;
    const preview = previewValueChange(circuit, { componentId: cmd.componentId, value: cmd.value, origin: 'ui_direct', actor }, clock);
    const view = previewView(preview, cmd.componentId);
    expect(view.status).toBe('ready');
    if (view.status !== 'ready' || view.after.status !== 'solved' || view.before.status !== 'solved') return;
    expect(view.from).toBe(470);
    expect(view.to).toBe(220);
    expect(view.after.currentMa).toEqual({ r1: 25, r2: 17, r3: 8 });
    expect(view.after.currentMa.r2 + view.after.currentMa.r3).toBeCloseTo(view.after.currentMa.r1, 1);
    expect(circuit.components.find((c) => c.id === 'r2')!.value.value).toBe(470);
  });

  it('commits only through the operation and records a new revision', () => {
    const circuit = exampleCircuit('complete', clock);
    const request = { componentId: 'r2', value: 220, origin: 'ui_direct' as const, actor };
    const preview = previewValueChange(circuit, request, clock);
    const next = commitValueChange(circuit, preview, request, { ledger: new AuthorizationLedger({ sessionId: 's' }), clock });
    expect(next.revision.number).toBe(1);
    expect(next.components.find((c) => c.id === 'r2')!.value.value).toBe(220);
  });

  it('a missing value stays unknown: no number is invented, and it says what is missing', () => {
    const r = readout(solve(exampleCircuit('missing-r3', clock), clock));
    expect(r).toEqual({ status: 'unknown', why: 'falta o valor de R3', missing: ['r3'] });
  });

  it('refuses a value that cannot be a resistance', () => {
    const circuit = exampleCircuit('complete', clock);
    expect(parseCommand('Altera R2 para -5 Ω')).toEqual({ ok: true, componentId: 'r2', value: -5 });
    const view = previewView(previewValueChange(circuit, { componentId: 'r2', value: -5, origin: 'ui_direct', actor }, clock), 'r2');
    expect(view).toMatchObject({ status: 'blocked', reason: expect.stringContaining('positiva') });
    const unknown = previewView(previewValueChange(circuit, { componentId: 'r9', value: 100, origin: 'ui_direct', actor }, clock), 'r9');
    expect(unknown).toMatchObject({ status: 'blocked' });
  });

  it('understands one sentence shape and says so when it does not', () => {
    expect(parseCommand('muda r3 para 2,2k')).toEqual({ ok: true, componentId: 'r3', value: 2200 });
    expect(parseCommand('Altera R2 para 1 kΩ')).toEqual({ ok: true, componentId: 'r2', value: 1000 });
    expect(parseCommand('apaga tudo').ok).toBe(false);
  });

  it('flow speed grows with the current, bounded between 8 and 25 mA', () => {
    expect(flowSpeed(0)).toBe(0);
    expect(flowSpeed(0.008)).toBe(14);
    expect(flowSpeed(0.0165)).toBeCloseTo(28, 5);
    expect(flowSpeed(0.025)).toBe(42);
    expect(flowSpeed(0.05)).toBe(42);
    expect(flowSpeed(0.017)).toBeGreaterThan(flowSpeed(0.0106));
  });

  it('formats resistances', () => {
    expect(formatOhm(220)).toBe('220 Ω');
    expect(formatOhm(2200)).toBe('2.2 kΩ');
  });
});
