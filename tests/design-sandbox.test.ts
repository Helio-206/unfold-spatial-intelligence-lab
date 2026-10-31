import { describe, expect, it } from 'vitest';
import {
  DESIGN_SANDBOX_EVIDENCE,
  DESIGN_SANDBOX_MODE,
  executeDesignSandboxOperation,
  validateDesignSandboxRequest,
  type DesignSandboxRequest,
} from '../src/design-sandbox';

function validRequest(): DesignSandboxRequest {
  return {
    mode: DESIGN_SANDBOX_MODE,
    mechanismId: 'user-design-001',
    instruction: 'Aumenta a manivela para 80 mm.',
    design: {
      lengths: {
        ground: { value: 100, unit: 'mm' },
        crank: { value: 40, unit: 'mm' },
        coupler: { value: 120, unit: 'mm' },
        rocker: { value: 90, unit: 'mm' },
      },
      fixedBar: 'ground',
      topology: {
        joints: [
          { id: 'j1', type: 'revolute', connects: ['ground', 'crank'] },
          { id: 'j2', type: 'revolute', connects: ['crank', 'coupler'] },
          { id: 'j3', type: 'revolute', connects: ['coupler', 'rocker'] },
          { id: 'j4', type: 'revolute', connects: ['rocker', 'ground'] },
        ],
      },
      inputAngle: { value: 0, unit: 'rad' },
      branch: 'plus',
    },
  };
}

const operation = {
  schema: 'kinematic_operation.v1',
  action: 'update_length',
  componentId: 'crank',
  newValue: 80,
  unit: 'mm',
} as const;

describe('DESIGN_SANDBOX', () => {
  it('valida um mecanismo hipotético planar sem o classificar como verificado', () => {
    const validation = validateDesignSandboxRequest(validRequest());
    expect(validation.status).toBe('valid');
    if (validation.status !== 'valid') return;
    expect(validation.model.lengths).toEqual({ ground: 100, crank: 40, coupler: 120, rocker: 90 });
    expect(validation.model.fixedBar).toBe('ground');
    expect(validation.model.topology.joints).toHaveLength(4);
    expect(validation.model).not.toHaveProperty('review');
  });

  it('rejeita parâmetros, unidades, ramo e topologia inválidos', () => {
    const request = validRequest() as unknown as Record<string, unknown>;
    const design = request.design as Record<string, unknown>;
    const lengths = design.lengths as Record<string, unknown>;
    lengths.crank = { value: -40, unit: 'cm' };
    design.fixedBar = 'crank';
    design.branch = 'invalid';
    const topology = design.topology as { joints: Array<Record<string, unknown>> };
    topology.joints[1].connects = ['ground', 'crank'];
    const validation = validateDesignSandboxRequest(request);
    expect(validation.status).toBe('invalid');
    if (validation.status === 'invalid') {
      expect(validation.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
        'design.lengths.crank',
        'design.fixedBar',
        'design.branch',
        'design.topology.joints',
      ]));
    }
  });

  it('calcula antes/depois de forma reversível sem mutar o desenho original', () => {
    const validation = validateDesignSandboxRequest(validRequest());
    expect(validation.status).toBe('valid');
    if (validation.status !== 'valid') return;
    const original = structuredClone(validation.model);
    const result = executeDesignSandboxOperation(validation.model, operation);
    expect(result.status).toBe('executed');
    if (result.status !== 'executed') return;
    expect(result.before.result.status).toBe('solved');
    expect(result.after.result.status).toBe('impossible');
    expect(result.solverStatus).toEqual({
      before: 'solved',
      after: 'impossible',
      scope: 'requested_input_angle_configuration',
      globalMechanismAssessment: 'not_assessed',
    });
    expect(result.differences).toMatchObject({ lengthDeltaMm: 40, statusChanged: true });
    expect(result.originalPreserved).toBe(true);
    expect(result.reversible.reverseOperation.newValue).toBe(40);
    expect(result.provenance.originalParameters.crank).toEqual({
      value: 40,
      unit: 'mm',
      source: 'user_provided',
      evidenceStatus: DESIGN_SANDBOX_EVIDENCE,
      physicallyVerified: false,
    });
    expect(result.provenance.requestedChange.confirmed).toBe(false);
    expect(result).not.toHaveProperty('review');
    expect(validation.model).toEqual(original);
  });

  it('não executa operações fora da política do sandbox', () => {
    const validation = validateDesignSandboxRequest(validRequest());
    expect(validation.status).toBe('valid');
    if (validation.status !== 'valid') return;
    const result = executeDesignSandboxOperation(validation.model, { ...operation, componentId: 'ground' });
    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') expect(result.issues.some((issue) => issue.path === 'componentId')).toBe(true);
  });
});
