import { describe, expect, it } from 'vitest';
import { SpatialActionOrchestrator, type OrchestratorState, type SpatialActionPorts } from '../src/spatial-orchestrator';

function ports(overrides: Partial<SpatialActionPorts> = {}) {
  const calls: string[] = [];
  const states: OrchestratorState[] = [];
  const pending = overrides.updateLength ?? (async () => { calls.push('update'); return true; });
  return {
    calls,
    states,
    orchestrator: new SpatialActionOrchestrator({
      focus: () => calls.push('focus'), fit: () => calls.push('fit'), home: () => calls.push('home'),
      explode: () => calls.push('explode'), reassemble: () => calls.push('reassemble'),
      updateLength: pending, cancelPending: () => calls.push('cancel'), onStateChange: (state) => states.push(state),
      ...overrides,
    }),
  };
}

describe('spatial action orchestrator', () => {
  it('routes local actions through one controller', async () => {
    const test = ports();
    await test.orchestrator.dispatch({ kind: 'explode' });
    await test.orchestrator.dispatch({ kind: 'focus', componentId: 'crank' });
    expect(test.calls).toEqual(['explode', 'focus']);
    expect(test.orchestrator.state).toBe('IDLE');
  });

  it('cancels a pending update before a newer local action can win', async () => {
    let resolveUpdate!: (value: boolean) => void;
    const test = ports({ updateLength: () => new Promise<boolean>((resolve) => { resolveUpdate = resolve; }) });
    const pending = test.orchestrator.dispatch({ kind: 'update_length', componentId: 'crank', value: 50, unit: 'mm' });
    await test.orchestrator.dispatch({ kind: 'reassemble' });
    resolveUpdate(true);
    expect(await pending).toBe(false);
    expect(test.calls).toEqual(['cancel', 'reassemble']);
    expect(test.orchestrator.state).toBe('IDLE');
  });
});
