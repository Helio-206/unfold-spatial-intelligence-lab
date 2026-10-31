import { Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { FourBarLabScene } from '../src/four-bar-lab';
import { createPhase4AExperimentRequest, validatePhase4AExperimentResponse } from '../src/phase4a-experiment';
import { PHASE4A_LENGTHS } from '../src/phase4a-kinematics';
import { solveFourBar, type FourBarLengths } from '../src/kinematics';

function responseFor(lengths: FourBarLengths, newCrank: number): unknown {
  return {
    status: 'executed',
    mode: 'DESIGN_SANDBOX',
    evidenceStatus: 'hypothetical_user_design',
    inputValidity: 'valid',
    operation: { schema: 'kinematic_operation.v1', action: 'update_length', componentId: 'crank', newValue: newCrank, unit: 'mm' },
    before: { result: solveFourBar({ lengths: { ...lengths }, inputAngleRad: 0, branch: 'plus' }) },
    after: { result: solveFourBar({ lengths: { ...lengths, crank: newCrank }, inputAngleRad: 0, branch: 'plus' }) },
    originalPreserved: true,
  };
}

describe('PHASE 5C Four-Bar Lab experiments', () => {
  it('sends the current sandbox parameters, including a previously applied length', () => {
    const first = createPhase4AExperimentRequest('Aumenta a manivela para 50 mm.', PHASE4A_LENGTHS, 0, 'plus');
    const current = { ...PHASE4A_LENGTHS, crank: 50 };
    const second = createPhase4AExperimentRequest('Aumenta a manivela para 80 mm.', current, 0, 'plus');

    expect(first.mode).toBe('DESIGN_SANDBOX');
    expect(first.design.lengths.crank).toEqual({ value: 40, unit: 'mm' });
    expect(second.design.lengths.crank).toEqual({ value: 50, unit: 'mm' });
  });

  it('applies only a validated solved response to the scene', () => {
    const scene = new Scene();
    const lab = new FourBarLabScene();
    lab.mount(scene);
    const validation = validatePhase4AExperimentResponse(responseFor(PHASE4A_LENGTHS, 50), PHASE4A_LENGTHS, 0, 'plus');

    expect(validation.status).toBe('accepted');
    if (validation.status === 'accepted') {
      expect(validation.response.after.result.status).toBe('solved');
      lab.setLengths({ ...PHASE4A_LENGTHS, crank: validation.response.operation.newValue });
    }

    expect(lab.currentLengths.crank).toBe(50);
    expect(lab.currentResult.status).toBe('solved');
    lab.dispose();
  });

  it('keeps the current scene when the accepted proposal is impossible at the requested angle', () => {
    const current = { ...PHASE4A_LENGTHS, crank: 50 };
    const validation = validatePhase4AExperimentResponse(responseFor(current, 80), current, 0, 'plus');

    expect(validation.status).toBe('accepted');
    if (validation.status === 'accepted') expect(validation.response.after.result.status).toBe('impossible');
    expect(current.crank).toBe(50);
  });

  it('blocks a response whose before state is stale', () => {
    const response = responseFor(PHASE4A_LENGTHS, 50);
    expect(validatePhase4AExperimentResponse(response, { ...PHASE4A_LENGTHS, crank: 45 }, 0, 'plus').status).toBe('blocked');
  });
});
