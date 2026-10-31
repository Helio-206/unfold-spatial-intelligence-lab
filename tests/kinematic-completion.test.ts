import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeMechanicalObservation, type MechanicalGraphSource, type MechanicalGraphV1 } from '../src/mechanical-graph';
import { solveFourBar } from '../src/kinematics';
import {
  FOUR_BAR_MECHANISM,
  KINEMATIC_ASSEMBLY_SCHEMA,
  adaptMechanicalGraph,
  type FourBarJointRole,
  type KinematicAssemblyV1,
  type KinematicParameter,
} from '../src/kinematic-assembly';
import {
  completeKinematicAssembly,
  diagnoseKinematicBlock,
  type CompletionOrigin,
  type KinematicCompletionAnswer,
} from '../src/kinematic-completion';
import type { MechanicalObservation } from '../src/meta';

const TECHNICAL_REFERENCE = 'https://symplectomorphism.github.io/teaching/ug_courses/kinematics/chapter03.html';
const source: MechanicalGraphSource = {
  caseId: 'technical-four-bar-fixture',
  imagePath: 'fixture://technical-four-bar',
  sourceUrl: TECHNICAL_REFERENCE,
  title: 'Technical four-bar example — test fixture only',
};

function parameter<T>(value: T, unit: KinematicParameter<T>['unit'] = 'none', state: KinematicParameter<T>['state'] = 'verified', provenance: KinematicParameter<T>['provenance'] = 'test_fixture'): KinematicParameter<T> {
  return { value, unit, provenance, state, evidence: `TEST_FIXTURE_ONLY; source: ${TECHNICAL_REFERENCE}` };
}

function missing<T>(unit: KinematicParameter<T>['unit']): KinematicParameter<T> {
  return { unit, provenance: 'mechanical_graph_inferred', state: 'missing', evidence: 'TEST_FIXTURE_ONLY; valor ainda não introduzido.' };
}

function createTechnicalGraph(): MechanicalGraphV1 {
  const elements = [
    ['ground', 'bar', 'ground support'], ['crank', 'bar', 'crank link'], ['coupler', 'bar', 'coupler link'], ['rocker', 'bar', 'rocker link'],
    ['j-ground-crank', 'joint', 'ground-crank joint'], ['j-crank-coupler', 'joint', 'crank-coupler joint'], ['j-coupler-rocker', 'joint', 'coupler-rocker joint'], ['j-rocker-ground', 'joint', 'rocker-ground joint'],
  ] as const;
  const observation: MechanicalObservation = {
    elements: elements.map(([id, kind, label]) => ({ id, kind, label, observed: true, evidence: 'TEST_FIXTURE_ONLY; topology transcribed from the technical source.', confidence: 1 })),
    connections: [
      ['ground', 'j-ground-crank'], ['crank', 'j-ground-crank'], ['crank', 'j-crank-coupler'], ['coupler', 'j-crank-coupler'],
      ['coupler', 'j-coupler-rocker'], ['rocker', 'j-coupler-rocker'], ['rocker', 'j-rocker-ground'], ['ground', 'j-rocker-ground'],
    ].map(([from, to]) => ({ from, to, relation: 'connected', observed: true, evidence: 'TEST_FIXTURE_ONLY; relation from documented topology.' })),
    dimensions: [], ambiguities: [], missingInformation: [],
  };
  const graph = normalizeMechanicalObservation(observation, source);
  for (const node of graph.nodes) {
    node.kind = node.sourceElementId.startsWith('j-') ? 'joint' : node.sourceElementId === 'ground' ? 'support' : 'link';
    node.provenance = 'observed';
    node.review = 'verified';
  }
  for (const connection of graph.connections) connection.review = 'verified';
  graph.review = { status: 'verified', proposedActions: [], changes: [], reviewer: { name: 'TEST_FIXTURE reviewer' }, confirmedAt: '2026-10-30T12:00:00Z' };
  return graph;
}

function nodeId(graph: MechanicalGraphV1, sourceElementId: string): string {
  return graph.nodes.find((node) => node.sourceElementId === sourceElementId)!.id;
}

type AssemblySourceIds = {
  ground: string;
  crank: string;
  coupler: string;
  rocker: string;
  joints: Record<FourBarJointRole, string | undefined>;
};

const technicalSourceIds: AssemblySourceIds = {
  ground: 'ground', crank: 'crank', coupler: 'coupler', rocker: 'rocker',
  joints: { 'ground-crank': 'j-ground-crank', 'crank-coupler': 'j-crank-coupler', 'coupler-rocker': 'j-coupler-rocker', 'rocker-ground': 'j-rocker-ground' },
};

function createIncompleteAssembly(graph: MechanicalGraphV1, ids: AssemblySourceIds = technicalSourceIds): KinematicAssemblyV1 {
  const node = (sourceElementId: string | undefined): KinematicParameter<string> => {
    const id = sourceElementId ? graph.nodes.find((candidate) => candidate.sourceElementId === sourceElementId)?.id : undefined;
    return id ? parameter(id) : missing('none');
  };
  const joint = (sourceElementId: string | undefined, connects: ['ground' | 'crank' | 'coupler' | 'rocker', 'ground' | 'crank' | 'coupler' | 'rocker'], connectionIds: string[]) => ({ nodeId: node(sourceElementId), type: missing<'revolute'>('none'), connects, connectionIds });
  return {
    schema: KINEMATIC_ASSEMBLY_SCHEMA,
    mechanism: FOUR_BAR_MECHANISM,
    sourceGraph: { schema: 'mechanical_graph.v1', caseId: graph.source.caseId },
    ground: { nodeId: node(ids.ground), fixed: missing<true>('none') },
    links: {
      ground: { nodeId: node(ids.ground), length: missing('mm') },
      crank: { nodeId: node(ids.crank), length: missing('mm') },
      coupler: { nodeId: node(ids.coupler), length: missing('mm') },
      rocker: { nodeId: node(ids.rocker), length: missing('mm') },
    },
    joints: {
      'ground-crank': joint(ids.joints['ground-crank'], ['ground', 'crank'], ['connection-1', 'connection-2']),
      'crank-coupler': joint(ids.joints['crank-coupler'], ['crank', 'coupler'], ['connection-3', 'connection-4']),
      'coupler-rocker': joint(ids.joints['coupler-rocker'], ['coupler', 'rocker'], ['connection-5', 'connection-6']),
      'rocker-ground': joint(ids.joints['rocker-ground'], ['rocker', 'ground'], ids.joints['rocker-ground'] ? ['connection-7', 'connection-8'] : []),
    },
    parameters: { lengthUnit: missing<'mm'>('none'), inputAngleRad: missing('rad'), branch: missing<'plus' | 'minus'>('none') },
  };
}

const origin: CompletionOrigin = {
  kind: 'test_fixture',
  reference: TECHNICAL_REFERENCE,
  note: 'TEST_FIXTURE_ONLY; valores e topologia transcritos do exemplo técnico para teste automatizado.',
};

function confirmedFixture(): KinematicCompletionAnswer['confirmation'] {
  return { state: 'confirmed', actor: { kind: 'test_fixture', id: 'fixture-reviewer-3c', name: 'TEST_FIXTURE reviewer' }, confirmedAt: '2026-10-30T12:30:00Z' };
}

function pendingAnswer(answer: KinematicCompletionAnswer): KinematicCompletionAnswer {
  return { ...answer, confirmation: { state: 'pending' } } as KinematicCompletionAnswer;
}

function createAnswers(graph: MechanicalGraphV1, confirmation: KinematicCompletionAnswer['confirmation']): KinematicCompletionAnswer[] {
  const node = (sourceElementId: string) => nodeId(graph, sourceElementId);
  const length = (role: 'ground' | 'crank' | 'coupler' | 'rocker', value: number): KinematicCompletionAnswer => ({ kind: 'length', value, unit: 'mm', component: { role, graphNodeId: node(role) }, origin, confirmation });
  const joint = (role: 'ground-crank' | 'crank-coupler' | 'coupler-rocker' | 'rocker-ground', sourceElementId: string, connects: ['ground' | 'crank' | 'coupler' | 'rocker', 'ground' | 'crank' | 'coupler' | 'rocker'], connectionIds: string[]): KinematicCompletionAnswer => ({ kind: 'joint', value: { type: 'revolute', connects, connectionIds }, unit: 'none', component: { role, graphNodeId: node(sourceElementId) }, origin, confirmation });
  return [
    { kind: 'ground', value: true, unit: 'none', component: { role: 'ground', graphNodeId: node('ground') }, origin, confirmation },
    length('ground', 100), length('crank', 40), length('coupler', 120), length('rocker', 90),
    joint('ground-crank', 'j-ground-crank', ['ground', 'crank'], ['connection-1', 'connection-2']),
    joint('crank-coupler', 'j-crank-coupler', ['crank', 'coupler'], ['connection-3', 'connection-4']),
    joint('coupler-rocker', 'j-coupler-rocker', ['coupler', 'rocker'], ['connection-5', 'connection-6']),
    joint('rocker-ground', 'j-rocker-ground', ['rocker', 'ground'], ['connection-7', 'connection-8']),
    { kind: 'input_angle', value: 0, unit: 'rad', component: { role: 'input_angle', graphNodeId: node('crank') }, origin, confirmation },
    { kind: 'assembly_branch', value: 'plus', unit: 'none', component: { role: 'assembly_branch', graphNodeId: node('crank') }, origin, confirmation },
  ];
}

function loadPaderborn(): MechanicalGraphV1 {
  return JSON.parse(readFileSync('reports/phase-2d/paderborn-draft.json', 'utf8')) as MechanicalGraphV1;
}

describe('evidence-backed mechanical completion', () => {
  it('diagnoses an incomplete assembly into specific questions', () => {
    const graph = createTechnicalGraph();
    const assembly = createIncompleteAssembly(graph);
    const blocked = completeKinematicAssembly(graph, assembly, [], { allowTestFixtures: true });
    expect(blocked.status).toBe('blocked');
    if (blocked.status !== 'blocked') return;
    const diagnostic = diagnoseKinematicBlock(adaptMechanicalGraph(graph, assembly));
    expect(diagnostic.questions.map((question) => question.kind)).toEqual(expect.arrayContaining(['ground', 'joints', 'lengths', 'input']));
  });

  it('requires explicit confirmation and keeps fixture provenance traceable through the solver', () => {
    const graph = createTechnicalGraph();
    const assembly = createIncompleteAssembly(graph);
    const answers = createAnswers(graph, confirmedFixture());
    const pending = completeKinematicAssembly(graph, assembly, answers.map(pendingAnswer));
    expect(pending.status).toBe('blocked');

    const fixtureWithoutOptIn = completeKinematicAssembly(graph, assembly, answers);
    expect(fixtureWithoutOptIn.status).toBe('blocked');

    const ready = completeKinematicAssembly(graph, assembly, answers, { allowTestFixtures: true });
    expect(ready.status).toBe('ready');
    if (ready.status !== 'ready') return;
    expect(ready.assembly.links.crank.length).toMatchObject({ value: 40, unit: 'mm', provenance: 'test_fixture', state: 'verified' });
    expect(ready.assembly.parameters.inputAngleRad).toMatchObject({ value: 0, unit: 'rad', provenance: 'test_fixture', state: 'verified' });
    expect(ready.trace.every((answer) => answer.origin.kind === 'test_fixture')).toBe(true);
    const solved = solveFourBar(ready.solverInput);
    expect(solved.status).toBe('solved');
    expect(solved.residuals?.maxLengthErrorMm).toBeLessThan(1e-9);
  });

  it('keeps Paderborn blocked and asks for evidence instead of completing it', () => {
    const graph = loadPaderborn();
    const paderbornIds: AssemblySourceIds = {
      ground: 'b1', crank: 'b2', coupler: 'b3', rocker: 'b4',
      joints: { 'ground-crank': 'j1', 'crank-coupler': 'j2', 'coupler-rocker': 'j3', 'rocker-ground': undefined },
    };
    const blocked = completeKinematicAssembly(graph, createIncompleteAssembly(graph, paderbornIds), []);
    expect(blocked.status).toBe('blocked');
    if (blocked.status !== 'blocked') return;
    expect(blocked.diagnostic.questions.map((question) => question.kind)).toEqual(expect.arrayContaining(['ground', 'joints', 'lengths', 'input', 'evidence']));
    expect(blocked.diagnostic.unresolved.some((item) => item.includes('graph.review.status'))).toBe(true);
    expect(blocked.diagnostic.unresolved.some((item) => item.includes('parameters.inputAngleRad'))).toBe(true);
  });
});
