import {
  adaptMechanicalGraph,
  type FourBarJointRole,
  type FourBarLinkRole,
  type KinematicAdaptation,
  type KinematicAssemblyV1,
  type KinematicParameter,
  type KinematicProvenance,
} from './kinematic-assembly';
import type { AssemblyBranch } from './kinematics';

export type CompletionQuestionKind = 'ground' | 'joints' | 'lengths' | 'input' | 'evidence';

export type CompletionQuestion = {
  id: string;
  kind: CompletionQuestionKind;
  prompt: string;
  paths: string[];
};

export type KinematicBlockDiagnostic = {
  status: 'blocked' | 'ready';
  unresolved: string[];
  questions: CompletionQuestion[];
};

export type CompletionOrigin = {
  kind: 'technical_document' | 'human_measurement' | 'human_statement' | 'test_fixture';
  reference: string;
  note: string;
};

export type CompletionActor = {
  kind: 'human' | 'test_fixture';
  id: string;
  name: string;
};

export type CompletionConfirmation =
  | { state: 'pending' }
  | { state: 'confirmed'; actor: CompletionActor; confirmedAt: string };

export type CompletionComponent<T extends string> = {
  role: T;
  graphNodeId: string;
  sourceElementId?: string;
};

type CompletionAnswerBase<TKind extends string, TValue, TRole extends string> = {
  kind: TKind;
  value: TValue;
  unit: 'mm' | 'rad' | 'none';
  component: CompletionComponent<TRole>;
  origin: CompletionOrigin;
  confirmation: CompletionConfirmation;
};

export type GroundCompletionAnswer = CompletionAnswerBase<'ground', true, 'ground'>;
export type LengthCompletionAnswer = CompletionAnswerBase<'length', number, FourBarLinkRole>;
export type JointCompletionAnswer = CompletionAnswerBase<'joint', {
  type: 'revolute';
  connects: [FourBarLinkRole, FourBarLinkRole];
  connectionIds: string[];
}, FourBarJointRole>;
export type InputAngleCompletionAnswer = CompletionAnswerBase<'input_angle', number, 'input_angle'>;
export type AssemblyBranchCompletionAnswer = CompletionAnswerBase<'assembly_branch', AssemblyBranch, 'assembly_branch'>;

export type KinematicCompletionAnswer =
  | GroundCompletionAnswer
  | LengthCompletionAnswer
  | JointCompletionAnswer
  | InputAngleCompletionAnswer
  | AssemblyBranchCompletionAnswer;

export type CompletionOptions = {
  allowTestFixtures?: boolean;
};

export type CompletionIssue = { path: string; message: string };

export type CompletionResult =
  | {
      status: 'ready';
      assembly: KinematicAssemblyV1;
      solverInput: NonNullable<Extract<KinematicAdaptation, { status: 'ready' }>['solverInput']>;
      trace: KinematicCompletionAnswer[];
    }
  | {
      status: 'blocked';
      assembly: KinematicAssemblyV1;
      diagnostic: KinematicBlockDiagnostic;
      issues: CompletionIssue[];
    };

const QUESTION_DEFINITIONS: Record<CompletionQuestionKind, Omit<CompletionQuestion, 'paths'>> = {
  ground: {
    id: 'ground-identification',
    kind: 'ground',
    prompt: 'Qual é a barra fixa (ground) e que evidência documenta a sua fixação?',
  },
  joints: {
    id: 'revolute-topology',
    kind: 'joints',
    prompt: 'Que elementos estão ligados por cada uma das quatro juntas rotacionais? Indique os IDs das barras, juntas e ligações verificáveis.',
  },
  lengths: {
    id: 'link-lengths',
    kind: 'lengths',
    prompt: 'Quais são os comprimentos de ground, crank, coupler e rocker, em que unidade, e qual é a fonte de cada medida?',
  },
  input: {
    id: 'input-configuration',
    kind: 'input',
    prompt: 'Qual é o ângulo de entrada, a convenção angular e o ramo de montagem? Indique a origem de cada valor.',
  },
  evidence: {
    id: 'evidence-gaps',
    kind: 'evidence',
    prompt: 'Que medidas ou relações ainda não possuem evidência independente ou confirmação humana explícita?',
  },
};

function questionKindForPath(path: string): CompletionQuestionKind {
  if (path.includes('ground')) return 'ground';
  if (path.includes('joint') || path.includes('connection')) return 'joints';
  if (path.includes('length')) return 'lengths';
  if (path.includes('inputAngle') || path.includes('branch') || path.includes('solverInput')) return 'input';
  return 'evidence';
}

export function diagnoseKinematicBlock(adaptation: KinematicAdaptation): KinematicBlockDiagnostic {
  if (adaptation.status === 'ready') return { status: 'ready', unresolved: [], questions: [] };
  const unresolved = [
    ...adaptation.missing,
    ...adaptation.issues.map((issue) => `${issue.path}: ${issue.message}`),
  ];
  const pathsByKind = new Map<CompletionQuestionKind, string[]>();
  for (const item of unresolved) {
    const path = item.split(':', 1)[0] ?? item;
    const kind = questionKindForPath(path);
    const paths = pathsByKind.get(kind) ?? [];
    if (!paths.includes(path)) paths.push(path);
    pathsByKind.set(kind, paths);
  }
  const questions = (Object.keys(QUESTION_DEFINITIONS) as CompletionQuestionKind[])
    .filter((kind) => pathsByKind.has(kind))
    .map((kind) => ({ ...QUESTION_DEFINITIONS[kind], paths: pathsByKind.get(kind)! }));
  return { status: 'blocked', unresolved, questions };
}

function provenanceFor(origin: CompletionOrigin): KinematicProvenance {
  if (origin.kind === 'test_fixture') return 'test_fixture';
  if (origin.kind === 'technical_document') return 'reference';
  return 'human_review';
}

function confirmationAccepted(confirmation: CompletionConfirmation, options: CompletionOptions): boolean {
  if (confirmation.state !== 'confirmed') return false;
  return confirmation.actor.kind === 'human' || options.allowTestFixtures === true;
}

function parameterFromAnswer<T>(answer: KinematicCompletionAnswer, value: T, unit: KinematicParameter<T>['unit'], options: CompletionOptions): KinematicParameter<T> {
  return {
    value,
    unit,
    provenance: provenanceFor(answer.origin),
    state: confirmationAccepted(answer.confirmation, options) ? 'verified' : 'unverified',
    evidence: `${answer.origin.note} Fonte: ${answer.origin.reference}`,
  };
}

function validIsoUtc(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value);
}

function validateAnswer(answer: KinematicCompletionAnswer, seen: Set<string>): CompletionIssue[] {
  const issues: CompletionIssue[] = [];
  const target = `${answer.kind}:${answer.component.role}`;
  if (seen.has(target)) issues.push({ path: target, message: 'Resposta duplicada para o mesmo parâmetro.' });
  seen.add(target);
  if (!answer.component.graphNodeId) issues.push({ path: `${target}.component.graphNodeId`, message: 'ID do componente é obrigatório.' });
  if (!answer.origin.reference || !answer.origin.note) issues.push({ path: `${target}.origin`, message: 'Origem e nota de evidência são obrigatórias.' });
  if (answer.confirmation.state === 'confirmed') {
    if (!answer.confirmation.actor.id || !answer.confirmation.actor.name) issues.push({ path: `${target}.confirmation.actor`, message: 'Identidade de confirmação é obrigatória.' });
    if (!validIsoUtc(answer.confirmation.confirmedAt)) issues.push({ path: `${target}.confirmation.confirmedAt`, message: 'Data deve estar em ISO UTC.' });
  }
  if (answer.kind === 'length' && (answer.unit !== 'mm' || !Number.isFinite(answer.value) || answer.value <= 0)) issues.push({ path: target, message: 'Comprimento deve ser finito, positivo e estar em mm.' });
  if (answer.kind === 'input_angle' && (answer.unit !== 'rad' || !Number.isFinite(answer.value))) issues.push({ path: target, message: 'Ângulo deve ser finito e estar em rad.' });
  if (answer.kind === 'assembly_branch' && (answer.unit !== 'none' || !['plus', 'minus'].includes(answer.value))) issues.push({ path: target, message: 'Ramo deve ser plus ou minus e não tem unidade.' });
  if (answer.kind === 'ground' && (answer.unit !== 'none' || answer.value !== true)) issues.push({ path: target, message: 'Ground deve confirmar fixed=true sem unidade.' });
  if (answer.kind === 'joint') {
    if (answer.unit !== 'none' || answer.value.type !== 'revolute') issues.push({ path: target, message: 'A junta deve ser revolute sem unidade.' });
    if (answer.value.connectionIds.length !== 2 || answer.value.connectionIds.some((id) => !id)) issues.push({ path: target, message: 'A junta deve referenciar exactamente duas ligações.' });
  }
  return issues;
}

function applyAnswer(assembly: KinematicAssemblyV1, answer: KinematicCompletionAnswer, options: CompletionOptions): void {
  if (answer.kind === 'ground') {
    assembly.ground.nodeId = parameterFromAnswer(answer, answer.component.graphNodeId, 'none', options);
    assembly.ground.fixed = parameterFromAnswer(answer, true, 'none', options);
  } else if (answer.kind === 'length') {
    assembly.links[answer.component.role].length = parameterFromAnswer(answer, answer.value, 'mm', options);
    assembly.parameters.lengthUnit = parameterFromAnswer(answer, 'mm', 'none', options);
  } else if (answer.kind === 'joint') {
    assembly.joints[answer.component.role].nodeId = parameterFromAnswer(answer, answer.component.graphNodeId, 'none', options);
    assembly.joints[answer.component.role].type = parameterFromAnswer(answer, 'revolute', 'none', options);
    assembly.joints[answer.component.role].connects = answer.value.connects;
    assembly.joints[answer.component.role].connectionIds = [...answer.value.connectionIds];
  } else if (answer.kind === 'input_angle') {
    assembly.parameters.inputAngleRad = parameterFromAnswer(answer, answer.value, 'rad', options);
  } else {
    assembly.parameters.branch = parameterFromAnswer(answer, answer.value, 'none', options);
  }
}

export function completeKinematicAssembly(
  graph: unknown,
  baseAssembly: KinematicAssemblyV1,
  answers: KinematicCompletionAnswer[],
  options: CompletionOptions = {},
): CompletionResult {
  const updated = structuredClone(baseAssembly);
  const issues: CompletionIssue[] = [];
  const seen = new Set<string>();
  for (const answer of answers) {
    issues.push(...validateAnswer(answer, seen));
    if (issues.length === 0) applyAnswer(updated, answer, options);
  }
  if (issues.length > 0) {
    return { status: 'blocked', assembly: updated, diagnostic: { status: 'blocked', unresolved: issues.map((issue) => `${issue.path}: ${issue.message}`), questions: [] }, issues };
  }
  const adaptation = adaptMechanicalGraph(graph, updated);
  if (adaptation.status === 'blocked') return { status: 'blocked', assembly: updated, diagnostic: diagnoseKinematicBlock(adaptation), issues: [] };
  return { status: 'ready', assembly: adaptation.assembly, solverInput: adaptation.solverInput, trace: [...answers] };
}
