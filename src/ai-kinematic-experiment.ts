import {
  adaptMechanicalGraph,
  FOUR_BAR_LINK_ROLES,
  type FourBarLinkRole,
  type KinematicAssemblyV1,
} from './kinematic-assembly';
import { solveFourBar, type FourBarResult } from './kinematics';
import type { MechanicalGraphV1 } from './mechanical-graph';

export const KINEMATIC_OPERATION_SCHEMA = 'kinematic_operation.v1' as const;
export const DEFAULT_WRITABLE_LENGTH_COMPONENTS: readonly FourBarLinkRole[] = ['crank'];

export type KinematicOperation = {
  schema: typeof KINEMATIC_OPERATION_SCHEMA;
  action: 'update_length';
  componentId: FourBarLinkRole;
  newValue: number;
  unit: 'mm';
};

export type OperationIssue = { path: string; message: string };
export type OperationParseResult =
  | { status: 'accepted'; operation: KinematicOperation }
  | { status: 'blocked'; issues: OperationIssue[] };
export type OperationValidationResult = OperationParseResult;

export type ExperimentOptions = {
  writableLengthComponents?: readonly FourBarLinkRole[];
  requireVerifiedSource?: boolean;
};

export type OperationParameterInfo = {
  value?: number;
  unit: string;
  provenance: string;
  state: string;
};

export type ParameterSnapshot = {
  componentId: FourBarLinkRole;
  value: number;
  unit: 'mm';
  provenance: KinematicAssemblyV1['links'][FourBarLinkRole]['length']['provenance'];
  state: KinematicAssemblyV1['links'][FourBarLinkRole]['length']['state'];
  evidence: string;
};

export type ExperimentResult =
  | {
      status: 'executed';
      operation: KinematicOperation;
      before: { result: FourBarResult; parameter: ParameterSnapshot };
      after: { result: FourBarResult; parameter: ParameterSnapshot };
      differences: {
        lengthDeltaMm: number;
        statusChanged: boolean;
        crankCouplerJointDeltaMm?: number;
        couplerRockerJointDeltaMm?: number;
      };
      provenance: { before: ParameterSnapshot['provenance']; after: ParameterSnapshot['provenance'] };
    }
  | {
      status: 'blocked';
      issues: OperationIssue[];
    };

function issue(path: string, message: string): OperationIssue {
  return { path, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() ?? trimmed;
}

export function parseKinematicOperation(raw: string): OperationParseResult {
  let value: unknown;
  try {
    value = JSON.parse(stripJsonFence(raw));
  } catch {
    return { status: 'blocked', issues: [issue('$', 'Resposta Meta não é JSON válido.')] };
  }
  if (!isRecord(value)) return { status: 'blocked', issues: [issue('$', 'Operação deve ser um objecto JSON.')] };
  const issues: OperationIssue[] = [];
  const allowedKeys = new Set(['schema', 'action', 'componentId', 'newValue', 'unit']);
  for (const key of Object.keys(value)) if (!allowedKeys.has(key)) issues.push(issue(key, 'Campo não permitido no contrato declarativo.'));
  if (value.schema !== KINEMATIC_OPERATION_SCHEMA) issues.push(issue('schema', 'Schema kinematic_operation.v1 esperado.'));
  if (value.action !== 'update_length') issues.push(issue('action', 'Operação não permitida; apenas update_length é suportada.'));
  if (typeof value.componentId !== 'string' || !(FOUR_BAR_LINK_ROLES as readonly string[]).includes(value.componentId)) {
    issues.push(issue('componentId', 'componentId deve identificar uma barra do mecanismo.'));
  }
  if (typeof value.newValue !== 'number' || !Number.isFinite(value.newValue) || value.newValue <= 0) {
    issues.push(issue('newValue', 'newValue deve ser finito e maior que zero.'));
  }
  if (value.unit !== 'mm') issues.push(issue('unit', 'A unidade permitida é mm.'));
  if (issues.length > 0) return { status: 'blocked', issues };
  return {
    status: 'accepted',
    operation: {
      schema: KINEMATIC_OPERATION_SCHEMA,
      action: 'update_length',
      componentId: value.componentId as FourBarLinkRole,
      newValue: value.newValue as number,
      unit: 'mm',
    },
  };
}

export type OperationPromptInput = {
  mechanism: string;
  components: Array<{ componentId: FourBarLinkRole; name: string; currentLength: number | undefined; unit: string; writable: boolean }>;
  inputAngleRad: number | undefined;
  branch: string | undefined;
};

export function buildKinematicOperationPromptFromParameters(instruction: string, input: OperationPromptInput): string {
  if (!instruction.trim() || instruction.length > 1_000) throw new Error('Instrução inválida.');
  return [
    'Interpretar uma instrução mecânica como uma operação declarativa segura.',
    'Não executar código, não alterar proveniência e não inventar parâmetros.',
    'Responder exclusivamente com JSON válido, sem markdown, usando exactamente este schema:',
    JSON.stringify({ schema: KINEMATIC_OPERATION_SCHEMA, action: 'update_length', componentId: 'crank', newValue: 80, unit: 'mm' }),
    `Instrução: ${instruction.trim()}`,
    `Mecanismo: ${JSON.stringify(input)}`,
    'Só é permitida a alteração de comprimento da componente com writable=true.',
  ].join('\n');
}

export function buildKinematicOperationPrompt(instruction: string, assembly: KinematicAssemblyV1): string {
  return buildKinematicOperationPromptFromParameters(instruction, {
    mechanism: assembly.mechanism,
    components: FOUR_BAR_LINK_ROLES.map((componentId) => ({
      componentId,
      name: componentId,
      currentLength: assembly.links[componentId].length.value,
      unit: assembly.links[componentId].length.unit,
      writable: componentId === 'crank',
    })),
    inputAngleRad: assembly.parameters.inputAngleRad.value,
    branch: assembly.parameters.branch.value,
  });
}

export function validateKinematicOperationForParameters(
  operation: unknown,
  parameters: Partial<Record<FourBarLinkRole, OperationParameterInfo>>,
  options: ExperimentOptions = {},
): OperationValidationResult {
  const writable = options.writableLengthComponents ?? DEFAULT_WRITABLE_LENGTH_COMPONENTS;
  const requireVerifiedSource = options.requireVerifiedSource ?? true;
  const issues: OperationIssue[] = [];
  if (!isRecord(operation)) return { status: 'blocked', issues: [issue('$', 'Operação deve ser um objecto.')] };
  if (operation.schema !== KINEMATIC_OPERATION_SCHEMA) issues.push(issue('schema', 'Schema kinematic_operation.v1 esperado.'));
  if (operation.action !== 'update_length') issues.push(issue('action', 'Operação não autorizada.'));
  if (typeof operation.componentId !== 'string' || !(FOUR_BAR_LINK_ROLES as readonly string[]).includes(operation.componentId)) {
    issues.push(issue('componentId', 'Componente inexistente.'));
  }
  if (typeof operation.newValue !== 'number' || !Number.isFinite(operation.newValue) || operation.newValue <= 0) issues.push(issue('newValue', 'O valor deve ser finito e positivo.'));
  if (operation.unit !== 'mm') issues.push(issue('unit', 'Unidade desconhecida ou incorrecta; esperado mm.'));
  if (typeof operation.componentId === 'string' && (FOUR_BAR_LINK_ROLES as readonly string[]).includes(operation.componentId) && !writable.includes(operation.componentId as FourBarLinkRole)) {
    issues.push(issue('componentId', 'A política não autoriza alterar o comprimento desta componente.'));
  }
  const componentId = operation.componentId as FourBarLinkRole;
  const parameter = FOUR_BAR_LINK_ROLES.includes(componentId) ? parameters[componentId] : undefined;
  if (!parameter || (requireVerifiedSource ? parameter.state !== 'verified' : parameter.state !== 'hypothetical_user_design')) issues.push(issue(`links.${componentId}.length.state`, requireVerifiedSource ? 'O parâmetro de origem não está verified.' : 'O parâmetro sandbox não está classificado como hypothetical_user_design.'));
  if (!parameter?.provenance) issues.push(issue(`links.${componentId}.length.provenance`, 'Proveniência do parâmetro ausente.'));
  if (issues.length > 0) return { status: 'blocked', issues };
  return {
    status: 'accepted',
    operation: {
      schema: KINEMATIC_OPERATION_SCHEMA,
      action: 'update_length',
      componentId,
      newValue: operation.newValue as number,
      unit: 'mm',
    },
  };
}

export function validateKinematicOperation(
  operation: unknown,
  assembly: KinematicAssemblyV1,
  options: ExperimentOptions = {},
): OperationValidationResult {
  return validateKinematicOperationForParameters(operation, {
    ground: assembly.links.ground.length,
    crank: assembly.links.crank.length,
    coupler: assembly.links.coupler.length,
    rocker: assembly.links.rocker.length,
  }, options);
}

function parameterSnapshot(assembly: KinematicAssemblyV1, componentId: FourBarLinkRole): ParameterSnapshot {
  const parameter = assembly.links[componentId].length;
  if (parameter.value === undefined) throw new Error(`Comprimento ausente: ${componentId}`);
  return { componentId, value: parameter.value, unit: 'mm', provenance: parameter.provenance, state: parameter.state, evidence: parameter.evidence };
}

function pointDelta(before: { x: number; y: number } | undefined, after: { x: number; y: number } | undefined): number | undefined {
  if (!before || !after) return undefined;
  return Math.hypot(after.x - before.x, after.y - before.y);
}

export function executeKinematicOperation(
  graph: MechanicalGraphV1,
  assembly: KinematicAssemblyV1,
  operation: unknown,
  options: ExperimentOptions = {},
): ExperimentResult {
  const adaptation = adaptMechanicalGraph(graph, assembly);
  if (adaptation.status === 'blocked') {
    return { status: 'blocked', issues: [
      ...adaptation.missing.map((message) => issue('assembly', message)),
      ...adaptation.issues.map(({ path, message }) => issue(path, message)),
    ] };
  }
  const validation = validateKinematicOperation(operation, assembly, options);
  if (validation.status === 'blocked') return validation;
  const accepted = validation.operation;
  const beforeParameter = parameterSnapshot(assembly, accepted.componentId);
  const beforeResult = solveFourBar(adaptation.solverInput);
  const updated = structuredClone(assembly);
  updated.links[accepted.componentId].length = {
    ...updated.links[accepted.componentId].length,
    value: accepted.newValue,
  };
  const afterAdaptation = adaptMechanicalGraph(graph, updated);
  if (afterAdaptation.status === 'blocked') {
    return { status: 'blocked', issues: [
      ...afterAdaptation.missing.map((message) => issue('updatedAssembly', message)),
      ...afterAdaptation.issues.map(({ path, message }) => issue(`updatedAssembly.${path}`, message)),
    ] };
  }
  const afterParameter = parameterSnapshot(updated, accepted.componentId);
  const afterResult = solveFourBar(afterAdaptation.solverInput);
  return {
    status: 'executed',
    operation: accepted,
    before: { result: beforeResult, parameter: beforeParameter },
    after: { result: afterResult, parameter: afterParameter },
    differences: {
      lengthDeltaMm: afterParameter.value - beforeParameter.value,
      statusChanged: beforeResult.status !== afterResult.status,
      crankCouplerJointDeltaMm: pointDelta(beforeResult.coordinates?.crankCouplerJoint, afterResult.coordinates?.crankCouplerJoint),
      couplerRockerJointDeltaMm: pointDelta(beforeResult.coordinates?.couplerRockerJoint, afterResult.coordinates?.couplerRockerJoint),
    },
    provenance: { before: beforeParameter.provenance, after: afterParameter.provenance },
  };
}
