import { describe, expect, it } from 'vitest';
import { createPhase4AExperimentRequest, validatePhase4AExperimentResponse } from '../src/phase4a-experiment';
import { PHASE4A_LENGTHS } from '../src/phase4a-kinematics';
import { solveFourBar } from '../src/kinematics';

function responseFor(newCrank: number): unknown {
  const before = solveFourBar({ lengths: { ...PHASE4A_LENGTHS }, inputAngleRad: 0, branch: 'plus' });
  const after = solveFourBar({ lengths: { ...PHASE4A_LENGTHS, crank: newCrank }, inputAngleRad: 0, branch: 'plus' });
  return {
    status: 'executed',
    mode: 'DESIGN_SANDBOX',
    evidenceStatus: 'hypothetical_user_design',
    inputValidity: 'valid',
    operation: { schema: 'kinematic_operation.v1', action: 'update_length', componentId: 'crank', newValue: newCrank, unit: 'mm' },
    before: { result: before },
    after: { result: after },
    originalPreserved: true,
  };
}

describe('PHASE 4B browser experiment contract', () => {
  it('builds a DESIGN_SANDBOX request from the current immutable parameters', () => {
    const request = createPhase4AExperimentRequest('Aumenta a manivela para 50 mm.', PHASE4A_LENGTHS, 0, 'plus');
    expect(request.mode).toBe('DESIGN_SANDBOX');
    expect(request.design.lengths.crank).toEqual({ value: 40, unit: 'mm' });
    expect(request.design.topology.joints).toHaveLength(4);
    expect(request.design.inputAngle).toEqual({ value: 0, unit: 'rad' });
  });

  it('accepts only a backend response matching the submitted before state', () => {
    const accepted = validatePhase4AExperimentResponse(responseFor(50), PHASE4A_LENGTHS, 0, 'plus');
    expect(accepted.status).toBe('accepted');
    if (accepted.status === 'accepted') expect(accepted.response.operation.newValue).toBe(50);

    const mismatched = validatePhase4AExperimentResponse(responseFor(50), { ...PHASE4A_LENGTHS, crank: 45 }, 0, 'plus');
    expect(mismatched.status).toBe('blocked');
  });

  it('preserves an impossible after-state as a proposal without accepting coordinates', () => {
    const validation = validatePhase4AExperimentResponse(responseFor(80), PHASE4A_LENGTHS, 0, 'plus');
    expect(validation.status).toBe('accepted');
    if (validation.status === 'accepted') {
      expect(validation.response.after.result.status).toBe('impossible');
      expect(validation.response.after.result.coordinates).toBeUndefined();
    }
  });

  it('blocks malformed or unauthorized operation payloads', () => {
    const payload = responseFor(50) as { operation: Record<string, unknown> };
    payload.operation = { schema: 'kinematic_operation.v1', action: 'delete_mechanism', componentId: 'crank', newValue: 50, unit: 'mm' };
    expect(validatePhase4AExperimentResponse(payload, PHASE4A_LENGTHS, 0, 'plus').status).toBe('blocked');
  });

  it('rejects a valid backend operation when it changes a different value than requested', () => {
    expect(validatePhase4AExperimentResponse(responseFor(80), PHASE4A_LENGTHS, 0, 'plus', 50)).toEqual({ status: 'blocked', message: 'A operação devolvida não corresponde ao valor pedido.' });
    expect(validatePhase4AExperimentResponse(responseFor(50), PHASE4A_LENGTHS, 0, 'plus', 50).status).toBe('accepted');
  });
});
