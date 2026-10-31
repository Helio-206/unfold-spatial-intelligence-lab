import {
  buildKinematicOperationPromptFromParameters,
  validateKinematicOperationForParameters,
  type KinematicOperation,
  type OperationIssue,
} from './ai-kinematic-experiment';
import type { AssemblyBranch, FourBarLengths, FourBarResult, Point } from './kinematics';
import { solveFourBar } from './kinematics';

export const DESIGN_SANDBOX_MODE = 'DESIGN_SANDBOX' as const;
export const DESIGN_SANDBOX_EVIDENCE = 'hypothetical_user_design' as const;
export const DESIGN_SANDBOX_CLASSIFICATION = 'mathematical_simulation_hypothetical_project' as const;

export const DESIGN_LINK_ROLES = ['ground', 'crank', 'coupler', 'rocker'] as const;
export type DesignLinkRole = typeof DESIGN_LINK_ROLES[number];

const JOINT_DEFINITIONS: Record<string, [DesignLinkRole, DesignLinkRole]> = {
  'ground-crank': ['ground', 'crank'],
  'crank-coupler': ['crank', 'coupler'],
  'coupler-rocker': ['coupler', 'rocker'],
  'rocker-ground': ['rocker', 'ground'],
};

export type DesignSandboxRequest = {
  mode: typeof DESIGN_SANDBOX_MODE;
  mechanismId: string;
  instruction: string;
  design: {
    lengths: Record<DesignLinkRole, { value: number; unit: 'mm' }>;
    fixedBar: 'ground';
    topology: { joints: Array<{ id: string; type: 'revolute'; connects: [DesignLinkRole, DesignLinkRole] }> };
    inputAngle: { value: number; unit: 'rad' };
    branch: AssemblyBranch;
  };
};

export type DesignSandboxModel = {
  mechanismId: string;
  instruction: string;
  lengths: FourBarLengths;
  fixedBar: 'ground';
  topology: DesignSandboxRequest['design']['topology'];
  inputAngleRad: number;
  branch: AssemblyBranch;
};

export type DesignSandboxValidation =
  | { status: 'valid'; model: DesignSandboxModel }
  | { status: 'invalid'; issues: OperationIssue[] };

export type DesignSandboxResult =
  | {
      status: 'executed';
      mode: typeof DESIGN_SANDBOX_MODE;
      classification: typeof DESIGN_SANDBOX_CLASSIFICATION;
      evidenceStatus: typeof DESIGN_SANDBOX_EVIDENCE;
      inputValidity: 'valid';
      mechanismId: string;
      operation: KinematicOperation;
      componentsAffected: string[];
      before: { result: FourBarResult };
      after: { result: FourBarResult };
      solverStatus: {
        before: FourBarResult['status'];
        after: FourBarResult['status'];
        scope: 'requested_input_angle_configuration';
        globalMechanismAssessment: 'not_assessed';
      };
      differences: {
        lengthDeltaMm: number;
        statusChanged: boolean;
        crankCouplerJointDeltaMm?: number;
        couplerRockerJointDeltaMm?: number;
      };
      originalPreserved: true;
      reversible: { reverseOperation: KinematicOperation };
      provenance: {
        originalParameters: Record<DesignLinkRole, { value: number; unit: 'mm'; source: 'user_provided'; evidenceStatus: typeof DESIGN_SANDBOX_EVIDENCE; physicallyVerified: false }>;
        requestedChange: { source: 'natural_language_instruction'; interpretedBy: 'muse-spark-1.3'; confirmed: false; componentId: string; value: number; unit: 'mm' };
      };
      limitations: string[];
    }
  | { status: 'blocked'; issues: OperationIssue[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function addIssue(issues: OperationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function stringField(value: unknown, path: string, issues: OperationIssue[], maxLength: number): value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    addIssue(issues, path, `Texto obrigatório com no máximo ${maxLength} caracteres.`);
    return false;
  }
  return true;
}

export function validateDesignSandboxRequest(value: unknown): DesignSandboxValidation {
  const issues: OperationIssue[] = [];
  if (!isRecord(value)) return { status: 'invalid', issues: [{ path: '$', message: 'Request sandbox deve ser um objecto.' }] };
  if (value.mode !== DESIGN_SANDBOX_MODE) addIssue(issues, 'mode', 'mode=DESIGN_SANDBOX esperado.');
  const mechanismId = stringField(value.mechanismId, 'mechanismId', issues, 128) ? value.mechanismId as string : '';
  const instruction = stringField(value.instruction, 'instruction', issues, 1_000) ? value.instruction as string : '';
  const design = value.design;
  if (!isRecord(design)) return { status: 'invalid', issues: [...issues, { path: 'design', message: 'design é obrigatório.' }] };
  if (design.fixedBar !== 'ground') addIssue(issues, 'design.fixedBar', 'O solver planar existente requer ground como barra fixa.');
  if (!isRecord(design.lengths)) addIssue(issues, 'design.lengths', 'Os quatro comprimentos são obrigatórios.');
  if (!isRecord(design.inputAngle)) addIssue(issues, 'design.inputAngle', 'inputAngle.value e unit=rad são obrigatórios.');
  if (design.branch !== 'plus' && design.branch !== 'minus') addIssue(issues, 'design.branch', 'branch deve ser plus ou minus.');
  const lengths = {} as FourBarLengths;
  if (isRecord(design.lengths)) {
    for (const role of DESIGN_LINK_ROLES) {
      const parameter = design.lengths[role];
      if (!isRecord(parameter) || parameter.unit !== 'mm' || typeof parameter.value !== 'number' || !Number.isFinite(parameter.value) || parameter.value <= 0) {
        addIssue(issues, `design.lengths.${role}`, 'Cada comprimento deve ser finito, positivo e estar em mm.');
      } else {
        lengths[role] = parameter.value;
      }
    }
  }
  let inputAngleRad = Number.NaN;
  if (isRecord(design.inputAngle)) {
    if (design.inputAngle.unit !== 'rad' || typeof design.inputAngle.value !== 'number' || !Number.isFinite(design.inputAngle.value)) addIssue(issues, 'design.inputAngle', 'Ângulo deve ser finito e estar em rad.');
    else inputAngleRad = design.inputAngle.value;
  }
  const topologyValue = design.topology;
  if (!isRecord(topologyValue) || !Array.isArray(topologyValue.joints) || topologyValue.joints.length !== 4) {
    addIssue(issues, 'design.topology.joints', 'São necessárias exactamente quatro juntas revolutas.');
  }
  const joints: DesignSandboxRequest['design']['topology']['joints'] = [];
  if (isRecord(topologyValue) && Array.isArray(topologyValue.joints) && topologyValue.joints.length === 4) {
    const ids = new Set<string>();
    for (const [index, joint] of topologyValue.joints.entries()) {
      if (!isRecord(joint) || !stringField(joint.id, `design.topology.joints.${index}.id`, issues, 128) || joint.type !== 'revolute' || !Array.isArray(joint.connects) || joint.connects.length !== 2 || !DESIGN_LINK_ROLES.includes(joint.connects[0] as DesignLinkRole) || !DESIGN_LINK_ROLES.includes(joint.connects[1] as DesignLinkRole)) {
        addIssue(issues, `design.topology.joints.${index}`, 'Junta deve ter ID único, type=revolute e duas barras válidas.');
        continue;
      }
      const id = joint.id as string;
      if (ids.has(id)) addIssue(issues, `design.topology.joints.${index}.id`, 'ID de junta duplicado.');
      ids.add(id);
      joints.push({ id, type: 'revolute', connects: [joint.connects[0] as DesignLinkRole, joint.connects[1] as DesignLinkRole] });
    }
    const expectedPairs = Object.values(JOINT_DEFINITIONS).map((pair) => pair.join(':')).sort();
    const actualPairs = joints.map((joint) => joint.connects.join(':')).sort();
    if (joints.length === 4 && JSON.stringify(actualPairs) !== JSON.stringify(expectedPairs)) addIssue(issues, 'design.topology.joints', 'A topologia deve conter ground-crank, crank-coupler, coupler-rocker e rocker-ground exactamente uma vez.');
  }
  if (issues.length > 0) return { status: 'invalid', issues };
  return {
    status: 'valid',
    model: {
      mechanismId,
      instruction,
      lengths,
      fixedBar: 'ground',
      topology: { joints },
      inputAngleRad,
      branch: design.branch as AssemblyBranch,
    },
  };
}

export function buildDesignSandboxPrompt(model: DesignSandboxModel): string {
  return buildKinematicOperationPromptFromParameters(model.instruction, {
    mechanism: 'planar_four_bar_design_sandbox',
    components: DESIGN_LINK_ROLES.map((componentId) => ({ componentId, name: componentId, currentLength: model.lengths[componentId], unit: 'mm', writable: componentId === 'crank' })),
    inputAngleRad: model.inputAngleRad,
    branch: model.branch,
  });
}

function pointDelta(before: Point | undefined, after: Point | undefined): number | undefined {
  if (!before || !after) return undefined;
  return Math.hypot(after.x - before.x, after.y - before.y);
}

export function executeDesignSandboxOperation(model: DesignSandboxModel, operation: unknown): DesignSandboxResult {
  const parameters = Object.fromEntries(DESIGN_LINK_ROLES.map((role) => [role, { value: model.lengths[role], unit: 'mm', provenance: 'user_provided', state: DESIGN_SANDBOX_EVIDENCE }])) as Partial<Record<DesignLinkRole, { value: number; unit: string; provenance: string; state: string }>>;
  const validation = validateKinematicOperationForParameters(operation, parameters, { requireVerifiedSource: false });
  if (validation.status === 'blocked') return validation;
  const accepted = validation.operation;
  const beforeResult = solveFourBar({ lengths: { ...model.lengths }, inputAngleRad: model.inputAngleRad, branch: model.branch });
  const updatedLengths = { ...model.lengths, [accepted.componentId]: accepted.newValue };
  const afterResult = solveFourBar({ lengths: updatedLengths, inputAngleRad: model.inputAngleRad, branch: model.branch });
  const originalParameters = Object.fromEntries(DESIGN_LINK_ROLES.map((role) => [role, { value: model.lengths[role], unit: 'mm' as const, source: 'user_provided' as const, evidenceStatus: DESIGN_SANDBOX_EVIDENCE, physicallyVerified: false as const }])) as Record<DesignLinkRole, { value: number; unit: 'mm'; source: 'user_provided'; evidenceStatus: typeof DESIGN_SANDBOX_EVIDENCE; physicallyVerified: false }>;
  return {
    status: 'executed',
    mode: DESIGN_SANDBOX_MODE,
    classification: DESIGN_SANDBOX_CLASSIFICATION,
    evidenceStatus: DESIGN_SANDBOX_EVIDENCE,
    inputValidity: 'valid',
    mechanismId: model.mechanismId,
    operation: accepted,
    componentsAffected: [accepted.componentId],
    before: { result: beforeResult },
    after: { result: afterResult },
    solverStatus: {
      before: beforeResult.status,
      after: afterResult.status,
      scope: 'requested_input_angle_configuration',
      globalMechanismAssessment: 'not_assessed',
    },
    differences: {
      lengthDeltaMm: accepted.newValue - model.lengths[accepted.componentId],
      statusChanged: beforeResult.status !== afterResult.status,
      crankCouplerJointDeltaMm: pointDelta(beforeResult.coordinates?.crankCouplerJoint, afterResult.coordinates?.crankCouplerJoint),
      couplerRockerJointDeltaMm: pointDelta(beforeResult.coordinates?.couplerRockerJoint, afterResult.coordinates?.couplerRockerJoint),
    },
    originalPreserved: true,
    reversible: { reverseOperation: { schema: accepted.schema, action: accepted.action, componentId: accepted.componentId, newValue: model.lengths[accepted.componentId], unit: 'mm' } },
    provenance: {
      originalParameters,
      requestedChange: { source: 'natural_language_instruction', interpretedBy: 'muse-spark-1.3', confirmed: false, componentId: accepted.componentId, value: accepted.newValue, unit: accepted.unit },
    },
    limitations: ['Dados fornecidos pelo utilizador; não são dimensões fisicamente verificadas.', 'Resultado é uma simulação matemática de um projecto hipotético.', 'Um estado impossible refere-se apenas à configuração no ângulo de entrada pedido; a viabilidade global do mecanismo não foi avaliada.', 'A resposta Meta não cria revisão humana nem altera a proveniência.'],
  };
}
