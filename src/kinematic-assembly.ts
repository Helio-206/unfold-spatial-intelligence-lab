import {
  MECHANICAL_GRAPH_SCHEMA,
  validateMechanicalGraph,
  type MechanicalGraphV1,
  type MechanicalGraphNode,
} from './mechanical-graph';
import {
  type AssemblyBranch,
  type BarName,
  type FourBarInput,
} from './kinematics';

export const KINEMATIC_ASSEMBLY_SCHEMA = 'kinematic_assembly.v1' as const;
export const FOUR_BAR_MECHANISM = 'planar_four_bar' as const;

export const FOUR_BAR_LINK_ROLES = ['ground', 'crank', 'coupler', 'rocker'] as const;
export type FourBarLinkRole = typeof FOUR_BAR_LINK_ROLES[number];

export const FOUR_BAR_JOINT_ROLES = ['ground-crank', 'crank-coupler', 'coupler-rocker', 'rocker-ground'] as const;
export type FourBarJointRole = typeof FOUR_BAR_JOINT_ROLES[number];

export const KINEMATIC_PARAMETER_STATES = ['verified', 'unverified', 'ambiguous', 'missing'] as const;
export type KinematicParameterState = typeof KINEMATIC_PARAMETER_STATES[number];

export type KinematicProvenance =
  | 'reference'
  | 'mechanical_graph_observed'
  | 'mechanical_graph_inferred'
  | 'human_review'
  | 'test_fixture';

export type KinematicUnit = 'mm' | 'rad' | 'none';

export type KinematicParameter<T> = {
  value?: T;
  unit: KinematicUnit;
  provenance: KinematicProvenance;
  state: KinematicParameterState;
  evidence: string;
};

export type KinematicLink = {
  nodeId: KinematicParameter<string>;
  length: KinematicParameter<number>;
};

export type KinematicJoint = {
  nodeId: KinematicParameter<string>;
  type: KinematicParameter<'revolute'>;
  connects: [FourBarLinkRole, FourBarLinkRole];
  connectionIds: string[];
};

export type KinematicAssemblyV1 = {
  schema: typeof KINEMATIC_ASSEMBLY_SCHEMA;
  mechanism: typeof FOUR_BAR_MECHANISM;
  sourceGraph: {
    schema: typeof MECHANICAL_GRAPH_SCHEMA;
    caseId: string;
  };
  ground: {
    nodeId: KinematicParameter<string>;
    fixed: KinematicParameter<true>;
  };
  links: Record<FourBarLinkRole, KinematicLink>;
  joints: Record<FourBarJointRole, KinematicJoint>;
  parameters: {
    lengthUnit: KinematicParameter<'mm'>;
    inputAngleRad: KinematicParameter<number>;
    branch: KinematicParameter<AssemblyBranch>;
  };
};

export type KinematicAssemblyIssue = {
  path: string;
  message: string;
};

export type KinematicAdaptation =
  | {
      status: 'ready';
      assembly: KinematicAssemblyV1;
      solverInput: FourBarInput;
    }
  | {
      status: 'blocked';
      missing: string[];
      issues: KinematicAssemblyIssue[];
    };

const JOINT_CONNECTIONS: Record<FourBarJointRole, [FourBarLinkRole, FourBarLinkRole]> = {
  'ground-crank': ['ground', 'crank'],
  'crank-coupler': ['crank', 'coupler'],
  'coupler-rocker': ['coupler', 'rocker'],
  'rocker-ground': ['rocker', 'ground'],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasValue<T>(parameter: KinematicParameter<T>): parameter is KinematicParameter<T> & { value: T } {
  return parameter.value !== undefined;
}

function addUnique(target: string[], value: string): void {
  if (!target.includes(value)) target.push(value);
}

function addIssue(target: KinematicAssemblyIssue[], path: string, message: string): void {
  if (!target.some((issue) => issue.path === path && issue.message === message)) target.push({ path, message });
}

function parameterIssues<T>(parameter: KinematicParameter<T> | undefined, path: string, expectedUnit: KinematicUnit, missing: string[], issues: KinematicAssemblyIssue[]): void {
  if (!parameter || !isRecord(parameter)) {
    addUnique(missing, `${path}: parâmetro ausente`);
    return;
  }
  if (parameter.unit !== expectedUnit) addIssue(issues, `${path}.unit`, `Unidade esperada: ${expectedUnit}.`);
  if (!KINEMATIC_PARAMETER_STATES.includes(parameter.state)) addIssue(issues, `${path}.state`, 'Estado do parâmetro inválido.');
  if (parameter.state !== 'verified') addUnique(missing, `${path}: requer estado verified; estado actual ${parameter.state}.`);
  if (!hasValue(parameter)) addUnique(missing, `${path}.value: valor ausente.`);
  if (typeof parameter.evidence !== 'string' || !parameter.evidence.trim()) addIssue(issues, `${path}.evidence`, 'Evidência obrigatória.');
}

function graphNode(graph: MechanicalGraphV1, nodeId: string | undefined, path: string, missing: string[], issues: KinematicAssemblyIssue[]): MechanicalGraphNode | undefined {
  if (!nodeId) {
    addUnique(missing, `${path}: elemento do grafo não identificado.`);
    return undefined;
  }
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    addIssue(issues, path, `Referência inexistente no grafo: ${nodeId}.`);
    return undefined;
  }
  return node;
}

function requiredNodeKind(node: MechanicalGraphNode | undefined, path: string, expected: string, issues: KinematicAssemblyIssue[]): void {
  if (node && node.kind !== expected) addIssue(issues, path, `Tipo do nó incompatível: esperado ${expected}, recebido ${node.kind}.`);
}

function nodeReviewIssues(node: MechanicalGraphNode | undefined, path: string, missing: string[]): void {
  if (node && node.review !== 'verified') addUnique(missing, `${path}: confirmação humana do nó está ${node.review}.`);
}

export function validateKinematicAssembly(value: unknown): KinematicAssemblyIssue[] {
  const issues: KinematicAssemblyIssue[] = [];
  if (!isRecord(value)) return [{ path: '$', message: 'Contrato kinematic_assembly.v1 inválido.' }];
  if (value.schema !== KINEMATIC_ASSEMBLY_SCHEMA) addIssue(issues, 'schema', 'Contrato kinematic_assembly.v1 esperado.');
  if (value.mechanism !== FOUR_BAR_MECHANISM) addIssue(issues, 'mechanism', 'Mecanismo planar_four_bar esperado.');
  if (!isRecord(value.sourceGraph) || value.sourceGraph.schema !== MECHANICAL_GRAPH_SCHEMA || typeof value.sourceGraph.caseId !== 'string' || !value.sourceGraph.caseId) {
    addIssue(issues, 'sourceGraph', 'sourceGraph deve referenciar mechanical_graph.v1 com caseId.');
  }
  if (!isRecord(value.ground) || !isRecord(value.ground.nodeId) || !isRecord(value.ground.fixed)) {
    addIssue(issues, 'ground', 'ground, nodeId e fixed são obrigatórios.');
  }
  if (!isRecord(value.links)) addIssue(issues, 'links', 'As quatro barras são obrigatórias.');
  if (!isRecord(value.joints)) addIssue(issues, 'joints', 'As quatro juntas são obrigatórias.');
  if (!isRecord(value.parameters)) addIssue(issues, 'parameters', 'Parâmetros de entrada são obrigatórios.');
  if (issues.length > 0) return issues;

  const ground = value.ground as KinematicAssemblyV1['ground'];
  parameterIssues(ground.nodeId, 'ground.nodeId', 'none', [], issues);
  parameterIssues(ground.fixed, 'ground.fixed', 'none', [], issues);
  if (ground.fixed.value !== undefined && ground.fixed.value !== true) addIssue(issues, 'ground.fixed.value', 'O elemento fixo deve ter valor true.');

  const links = value.links as Record<string, KinematicLink>;
  for (const role of FOUR_BAR_LINK_ROLES) {
    const link = links[role];
    if (!isRecord(link)) {
      addIssue(issues, `links.${role}`, 'Barra obrigatória ausente.');
      continue;
    }
    parameterIssues(link.nodeId, `links.${role}.nodeId`, 'none', [], issues);
    parameterIssues(link.length, `links.${role}.length`, 'mm', [], issues);
    if (isRecord(link.length) && link.length.value !== undefined && (!Number.isFinite(link.length.value) || link.length.value <= 0)) addIssue(issues, `links.${role}.length.value`, 'Comprimento deve ser finito e maior que zero.');
  }

  const joints = value.joints as Record<string, KinematicJoint>;
  for (const role of FOUR_BAR_JOINT_ROLES) {
    const joint = joints[role];
    if (!isRecord(joint)) {
      addIssue(issues, `joints.${role}`, 'Junta obrigatória ausente.');
      continue;
    }
    parameterIssues(joint.nodeId, `joints.${role}.nodeId`, 'none', [], issues);
    parameterIssues(joint.type, `joints.${role}.type`, 'none', [], issues);
    if (isRecord(joint.type) && joint.type.value !== undefined && joint.type.value !== 'revolute') addIssue(issues, `joints.${role}.type.value`, 'A junta deve ser revolute.');
    const expectedConnections = JOINT_CONNECTIONS[role];
    if (!Array.isArray(joint.connects) || joint.connects.length !== 2 || joint.connects[0] !== expectedConnections[0] || joint.connects[1] !== expectedConnections[1]) {
      addIssue(issues, `joints.${role}.connects`, `Ligação esperada: ${expectedConnections.join(' + ')}.`);
    }
    if (!Array.isArray(joint.connectionIds) || joint.connectionIds.length !== 2 || joint.connectionIds.some((id) => typeof id !== 'string' || !id)) {
      addIssue(issues, `joints.${role}.connectionIds`, 'São necessárias exactamente duas ligações do grafo.');
    }
  }

  const parameters = value.parameters as KinematicAssemblyV1['parameters'];
  parameterIssues(parameters.lengthUnit, 'parameters.lengthUnit', 'none', [], issues);
  if (isRecord(parameters.lengthUnit) && parameters.lengthUnit.value !== undefined && parameters.lengthUnit.value !== 'mm') addIssue(issues, 'parameters.lengthUnit.value', 'A unidade de comprimento deve ser mm.');
  parameterIssues(parameters.inputAngleRad, 'parameters.inputAngleRad', 'rad', [], issues);
  if (isRecord(parameters.inputAngleRad) && parameters.inputAngleRad.value !== undefined && !Number.isFinite(parameters.inputAngleRad.value)) addIssue(issues, 'parameters.inputAngleRad.value', 'Ângulo deve ser finito.');
  parameterIssues(parameters.branch, 'parameters.branch', 'none', [], issues);
  if (isRecord(parameters.branch) && parameters.branch.value !== undefined && parameters.branch.value !== 'plus' && parameters.branch.value !== 'minus') addIssue(issues, 'parameters.branch.value', 'Ramo deve ser plus ou minus.');

  return issues;
}

function validateAgainstGraph(assembly: KinematicAssemblyV1, graph: MechanicalGraphV1): { missing: string[]; issues: KinematicAssemblyIssue[] } {
  const missing: string[] = [];
  const issues: KinematicAssemblyIssue[] = [];
  if (graph.review.status !== 'verified') addUnique(missing, 'graph.review.status: confirmação humana explícita do grafo está pendente.');

  const nodesByRole = new Map<FourBarLinkRole, MechanicalGraphNode>();
  for (const role of FOUR_BAR_LINK_ROLES) {
    const reference = assembly.links[role].nodeId;
    const node = graphNode(graph, reference.value, `links.${role}.nodeId`, missing, issues);
    if (node) {
      nodesByRole.set(role, node);
      nodeReviewIssues(node, `links.${role}.nodeId`, missing);
      requiredNodeKind(node, `links.${role}.nodeId`, role === 'ground' ? 'support' : 'link', issues);
    }
  }

  const groundNode = graphNode(graph, assembly.ground.nodeId.value, 'ground.nodeId', missing, issues);
  if (groundNode) {
    nodeReviewIssues(groundNode, 'ground.nodeId', missing);
    requiredNodeKind(groundNode, 'ground.nodeId', 'support', issues);
  }
  if (assembly.ground.nodeId.value !== assembly.links.ground.nodeId.value) addIssue(issues, 'ground.nodeId', 'Ground deve referenciar a mesma barra que links.ground.');

  const referencedConnectionIds = new Set<string>();
  for (const jointRole of FOUR_BAR_JOINT_ROLES) {
    const joint = assembly.joints[jointRole];
    const jointNode = graphNode(graph, joint.nodeId.value, `joints.${jointRole}.nodeId`, missing, issues);
    if (jointNode) {
      nodeReviewIssues(jointNode, `joints.${jointRole}.nodeId`, missing);
      requiredNodeKind(jointNode, `joints.${jointRole}.nodeId`, 'joint', issues);
    }
    const expectedRoles = JOINT_CONNECTIONS[jointRole];
    const expectedNodeIds = expectedRoles.map((role) => nodesByRole.get(role)?.id).filter((id): id is string => id !== undefined);
    const connectedNodeIds = new Set<string>();
    for (const connectionId of joint.connectionIds) {
      if (referencedConnectionIds.has(connectionId)) addIssue(issues, `joints.${jointRole}.connectionIds`, `Ligação repetida: ${connectionId}.`);
      referencedConnectionIds.add(connectionId);
      const connection = graph.connections.find((candidate) => candidate.id === connectionId);
      if (!connection) {
        addIssue(issues, `joints.${jointRole}.connectionIds`, `Ligação inexistente no grafo: ${connectionId}.`);
        continue;
      }
      if (connection.review !== 'verified') addUnique(missing, `connections.${connectionId}: confirmação humana da ligação está ${connection.review}.`);
      const endpoints = [connection.from, connection.to];
      const connectedBarId = expectedNodeIds.find((id) => endpoints.includes(id));
      if (connectedBarId) connectedNodeIds.add(connectedBarId);
      if (!jointNode || expectedNodeIds.length !== 2 || !endpoints.includes(jointNode.id) || !connectedBarId) {
        addIssue(issues, `connections.${connectionId}`, `Ligação não conecta a junta ${jointRole} às barras ${expectedRoles.join(' + ')}.`);
      }
    }
    if (connectedNodeIds.size !== 2) addIssue(issues, `joints.${jointRole}.connectionIds`, `As ligações não cobrem as duas barras esperadas: ${expectedRoles.join(' + ')}.`);
  }
  return { missing, issues };
}

function verifiedValue<T>(parameter: KinematicParameter<T>): T | undefined {
  return parameter.state === 'verified' && parameter.value !== undefined ? parameter.value : undefined;
}

export function adaptMechanicalGraph(graph: unknown, assembly: unknown): KinematicAdaptation {
  const missing: string[] = [];
  const issues: KinematicAssemblyIssue[] = [];
  let validGraph: MechanicalGraphV1;
  try {
    validGraph = validateMechanicalGraph(graph);
  } catch (error) {
    addIssue(issues, 'graph', error instanceof Error ? error.message : 'Grafo mecânico inválido.');
    return { status: 'blocked', missing, issues };
  }

  const assemblyIssues = validateKinematicAssembly(assembly);
  issues.push(...assemblyIssues);
  if (!isRecord(assembly) || !isRecord(assembly.sourceGraph) || !isRecord(assembly.ground) || !isRecord(assembly.links) || !isRecord(assembly.joints) || !isRecord(assembly.parameters)) return { status: 'blocked', missing, issues };
  const candidate = assembly as KinematicAssemblyV1;
  const completeShape = FOUR_BAR_LINK_ROLES.every((role) => isRecord(candidate.links[role]) && isRecord(candidate.links[role].nodeId) && isRecord(candidate.links[role].length))
    && FOUR_BAR_JOINT_ROLES.every((role) => isRecord(candidate.joints[role]) && isRecord(candidate.joints[role].nodeId) && isRecord(candidate.joints[role].type) && Array.isArray(candidate.joints[role].connectionIds))
    && isRecord(candidate.ground.nodeId)
    && isRecord(candidate.ground.fixed)
    && isRecord(candidate.parameters.lengthUnit)
    && isRecord(candidate.parameters.inputAngleRad)
    && isRecord(candidate.parameters.branch);
  if (!completeShape) return { status: 'blocked', missing, issues };
  if (candidate.sourceGraph.caseId !== validGraph.source.caseId) addIssue(issues, 'sourceGraph.caseId', 'O caseId não corresponde ao grafo recebido.');
  const graphChecks = validateAgainstGraph(candidate, validGraph);
  missing.push(...graphChecks.missing);
  issues.push(...graphChecks.issues);

  for (const role of FOUR_BAR_LINK_ROLES) {
    parameterIssues(candidate.links[role].length, `links.${role}.length`, 'mm', missing, issues);
  }
  parameterIssues(candidate.ground.nodeId, 'ground.nodeId', 'none', missing, issues);
  parameterIssues(candidate.ground.fixed, 'ground.fixed', 'none', missing, issues);
  parameterIssues(candidate.parameters.lengthUnit, 'parameters.lengthUnit', 'none', missing, issues);
  parameterIssues(candidate.parameters.inputAngleRad, 'parameters.inputAngleRad', 'rad', missing, issues);
  parameterIssues(candidate.parameters.branch, 'parameters.branch', 'none', missing, issues);
  for (const role of FOUR_BAR_JOINT_ROLES) {
    parameterIssues(candidate.joints[role].nodeId, `joints.${role}.nodeId`, 'none', missing, issues);
    parameterIssues(candidate.joints[role].type, `joints.${role}.type`, 'none', missing, issues);
  }

  const lengths = {
    ground: verifiedValue(candidate.links.ground.length),
    crank: verifiedValue(candidate.links.crank.length),
    coupler: verifiedValue(candidate.links.coupler.length),
    rocker: verifiedValue(candidate.links.rocker.length),
  };
  const inputAngleRad = verifiedValue(candidate.parameters.inputAngleRad);
  const branch = verifiedValue(candidate.parameters.branch);
  const allLengthsAvailable = Object.values(lengths).every((length): length is number => length !== undefined);
  if (!allLengthsAvailable || inputAngleRad === undefined || branch === undefined) {
    addUnique(missing, 'solverInput: comprimentos, ângulo de entrada e ramo verified são obrigatórios.');
  }

  if (missing.length > 0 || issues.length > 0) return { status: 'blocked', missing: [...new Set(missing)], issues };
  return {
    status: 'ready',
    assembly: candidate,
    solverInput: {
      lengths: lengths as Record<BarName, number>,
      inputAngleRad: inputAngleRad!,
      branch: branch!,
    },
  };
}
