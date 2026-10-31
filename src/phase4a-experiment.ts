import { parseKinematicOperation, type KinematicOperation } from './ai-kinematic-experiment';
import { DESIGN_SANDBOX_EVIDENCE, DESIGN_SANDBOX_MODE } from './design-sandbox';
import type { AssemblyBranch, FourBarLengths, FourBarResult, FourBarStatus } from './kinematics';

export const PHASE4A_MECHANISM_ID = 'phase-4a-design-sandbox';

export type Phase4AExperimentRequest = {
  mode: typeof DESIGN_SANDBOX_MODE;
  mechanismId: typeof PHASE4A_MECHANISM_ID;
  instruction: string;
  design: {
    lengths: Record<keyof FourBarLengths, { value: number; unit: 'mm' }>;
    fixedBar: 'ground';
    topology: { joints: Array<{ id: string; type: 'revolute'; connects: [keyof FourBarLengths, keyof FourBarLengths] }> };
    inputAngle: { value: number; unit: 'rad' };
    branch: AssemblyBranch;
  };
};

export type Phase4AExperimentResponse = {
  status: 'executed';
  mode: typeof DESIGN_SANDBOX_MODE;
  evidenceStatus: typeof DESIGN_SANDBOX_EVIDENCE;
  inputValidity: 'valid';
  operation: KinematicOperation;
  before: { result: FourBarResult };
  after: { result: FourBarResult };
  originalPreserved: true;
};

export type Phase4AResponseValidation =
  | { status: 'accepted'; response: Phase4AExperimentResponse }
  | { status: 'blocked'; message: string };

const LINK_ROLES: Array<keyof FourBarLengths> = ['ground', 'crank', 'coupler', 'rocker'];
const JOINTS: Phase4AExperimentRequest['design']['topology']['joints'] = [
  { id: 'j1', type: 'revolute', connects: ['ground', 'crank'] },
  { id: 'j2', type: 'revolute', connects: ['crank', 'coupler'] },
  { id: 'j3', type: 'revolute', connects: ['coupler', 'rocker'] },
  { id: 'j4', type: 'revolute', connects: ['rocker', 'ground'] },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isLengthSet(value: unknown): value is FourBarLengths {
  if (!isRecord(value)) return false;
  return LINK_ROLES.every((role) => isPositiveFinite(value[role]));
}

function sameLengths(left: FourBarLengths, right: FourBarLengths): boolean {
  return LINK_ROLES.every((role) => left[role] === right[role]);
}

function isSolverStatus(value: unknown): value is FourBarStatus {
  return value === 'solved' || value === 'singular' || value === 'impossible' || value === 'degenerate';
}

function isSolverResult(value: unknown): value is FourBarResult {
  if (!isRecord(value) || !isSolverStatus(value.status) || (value.branch !== 'plus' && value.branch !== 'minus') || typeof value.inputAngleRad !== 'number' || !Number.isFinite(value.inputAngleRad) || !isLengthSet(value.lengths)) return false;
  if (value.status === 'impossible' || value.status === 'degenerate') return value.coordinates === undefined && value.residuals === undefined;
  return isRecord(value.coordinates) && isRecord(value.residuals);
}

export function createPhase4AExperimentRequest(instruction: string, lengths: FourBarLengths, inputAngleRad: number, branch: AssemblyBranch): Phase4AExperimentRequest {
  return {
    mode: DESIGN_SANDBOX_MODE,
    mechanismId: PHASE4A_MECHANISM_ID,
    instruction,
    design: {
      lengths: Object.fromEntries(LINK_ROLES.map((role) => [role, { value: lengths[role], unit: 'mm' as const }])) as Phase4AExperimentRequest['design']['lengths'],
      fixedBar: 'ground',
      topology: { joints: JOINTS.map((joint) => ({ ...joint, connects: [...joint.connects] as [keyof FourBarLengths, keyof FourBarLengths] })) },
      inputAngle: { value: inputAngleRad, unit: 'rad' },
      branch,
    },
  };
}

export function validatePhase4AExperimentResponse(value: unknown, expectedLengths: FourBarLengths, expectedInputAngleRad: number, expectedBranch: AssemblyBranch, expectedNewValue?: number): Phase4AResponseValidation {
  if (!isRecord(value) || value.status !== 'executed' || value.mode !== DESIGN_SANDBOX_MODE || value.evidenceStatus !== DESIGN_SANDBOX_EVIDENCE || value.inputValidity !== 'valid' || value.originalPreserved !== true || !isRecord(value.operation) || !isSolverResult(isRecord(value.before) ? value.before.result : undefined) || !isSolverResult(isRecord(value.after) ? value.after.result : undefined)) {
    return { status: 'blocked', message: 'Resposta sandbox incompleta ou não autorizada.' };
  }
  const parsedOperation = parseKinematicOperation(JSON.stringify(value.operation));
  if (parsedOperation.status === 'blocked' || parsedOperation.operation.componentId !== 'crank') return { status: 'blocked', message: 'A operação recebida não é uma actualização autorizada da crank.' };
  if (expectedNewValue !== undefined && parsedOperation.operation.newValue !== expectedNewValue) return { status: 'blocked', message: 'A operação devolvida não corresponde ao valor pedido.' };
  const before = (value.before as { result: FourBarResult }).result;
  const after = (value.after as { result: FourBarResult }).result;
  if (before.inputAngleRad !== expectedInputAngleRad || after.inputAngleRad !== expectedInputAngleRad || before.branch !== expectedBranch || after.branch !== expectedBranch) return { status: 'blocked', message: 'A resposta não corresponde ao ângulo ou ramo solicitados.' };
  if (!sameLengths(before.lengths, expectedLengths)) return { status: 'blocked', message: 'O estado before não corresponde aos parâmetros enviados.' };
  const expectedAfter = { ...expectedLengths, crank: parsedOperation.operation.newValue };
  if (!sameLengths(after.lengths, expectedAfter)) return { status: 'blocked', message: 'O estado after não corresponde à operação autorizada.' };
  return {
    status: 'accepted',
    response: {
      status: 'executed',
      mode: DESIGN_SANDBOX_MODE,
      evidenceStatus: DESIGN_SANDBOX_EVIDENCE,
      inputValidity: 'valid',
      operation: parsedOperation.operation,
      before: { result: before },
      after: { result: after },
      originalPreserved: true,
    },
  };
}
