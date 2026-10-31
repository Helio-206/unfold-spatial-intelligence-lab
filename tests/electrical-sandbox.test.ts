import { describe, expect, it } from 'vitest';
import { applyElectricalOperation, calculateElectricalSandbox, createIndependentElectricalExample, createUserElectricalCircuit, validateElectricalSandbox } from '../src/electrical-sandbox';

describe('deterministic electrical sandbox', () => {
  it('calculates nominal current from apparent power and keeps example provenance explicit', () => {
    const example = createIndependentElectricalExample();
    const result = calculateElectricalSandbox(example);
    expect(result.evidenceStatus).toBe('independent_example');
    expect(result.branches[0]).toMatchObject({ energized: true, currentA: 520 / 230, currentLimitA: 5, overloaded: false });
  });

  it('requires explicit topology confirmation and validates positive finite values', () => {
    expect(() => createUserElectricalCircuit({ voltageV: 230, currentLimitA: 5, lightingVA: 60, outletVA: 460, confirmedTopology: false })).toThrow('Confirme explicitamente');
    expect(() => createUserElectricalCircuit({ voltageV: 0, currentLimitA: 5, lightingVA: 60, outletVA: 460, confirmedTopology: true })).toThrow();
    expect(() => createUserElectricalCircuit({ voltageV: 230, currentLimitA: 5, lightingVA: 60, outletVA: Number.NaN, confirmedTopology: true })).toThrow();
  });

  it('recalculates an increase and flags overload without simulating protective trip', () => {
    const original = createIndependentElectricalExample();
    const changed = applyElectricalOperation(original, { kind: 'update_load_apparent_power', loadId: 'outlet-1', valueVA: 1380 });
    expect(original.loads.find((load) => load.id === 'outlet-1')?.apparentPowerVA).toBe(460);
    expect(calculateElectricalSandbox(changed).branches[0]).toMatchObject({ currentA: 1440 / 230, overloaded: true, energized: true });
  });

  it('switches a branch off and an open feed de-energizes only its downstream loads', () => {
    const original = createIndependentElectricalExample();
    const disabled = applyElectricalOperation(original, { kind: 'set_branch_enabled', branchId: 'branch-1', enabled: false });
    expect(calculateElectricalSandbox(disabled).loads.every((load) => !load.energized)).toBe(true);
    const open = applyElectricalOperation(original, { kind: 'set_connection_closed', connectionId: 'feed-1', closed: false });
    expect(calculateElectricalSandbox(open).branches[0]).toMatchObject({ energized: false, currentA: 0, overloaded: false });
  });

  it('rejects unknown targets, duplicate node identifiers and dangling connections', () => {
    const original = createIndependentElectricalExample();
    expect(() => applyElectricalOperation(original, { kind: 'set_branch_enabled', branchId: 'absent', enabled: false })).toThrow('não encontrado');
    expect(() => applyElectricalOperation(original, { kind: 'update_load_apparent_power', loadId: 'outlet-1', valueVA: -2 })).toThrow();
    const dangling = structuredClone(original);
    dangling.connections[0]!.to = 'missing-node';
    expect(() => validateElectricalSandbox(dangling)).toThrow('nós inválidos');
    const duplicateBranch = structuredClone(original);
    duplicateBranch.branches.push({ ...duplicateBranch.branches[0]!, nodeId: 'branch-node-2' });
    expect(() => validateElectricalSandbox(duplicateBranch)).toThrow('componentes eléctricos duplicados');
  });
});
