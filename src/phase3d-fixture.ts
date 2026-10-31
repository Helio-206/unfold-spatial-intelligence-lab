import { normalizeMechanicalObservation, type MechanicalGraphSource, type MechanicalGraphV1 } from './mechanical-graph';
import {
  FOUR_BAR_MECHANISM,
  KINEMATIC_ASSEMBLY_SCHEMA,
  type FourBarJointRole,
  type KinematicAssemblyV1,
  type KinematicParameter,
} from './kinematic-assembly';
import type { MechanicalObservation } from './meta';

export const PHASE_3D_FIXTURE_CASE_ID = 'technical-four-bar-fixture';
export const PHASE_3D_FIXTURE_MARKER = 'TEST_FIXTURE_ONLY';
export const PHASE_3D_TECHNICAL_REFERENCE = 'https://symplectomorphism.github.io/teaching/ug_courses/kinematics/chapter03.html';

export type Phase3DReferenceFixture = {
  graph: MechanicalGraphV1;
  assembly: KinematicAssemblyV1;
};

function parameter<T>(value: T, unit: KinematicParameter<T>['unit'] = 'none'): KinematicParameter<T> {
  return {
    value,
    unit,
    provenance: 'test_fixture',
    state: 'verified',
    evidence: `${PHASE_3D_FIXTURE_MARKER}; fonte técnica: ${PHASE_3D_TECHNICAL_REFERENCE}`,
  };
}

function createGraph(): MechanicalGraphV1 {
  const elements = [
    ['ground', 'bar', 'ground support'],
    ['crank', 'bar', 'crank link'],
    ['coupler', 'bar', 'coupler link'],
    ['rocker', 'bar', 'rocker link'],
    ['j-ground-crank', 'joint', 'ground-crank revolute joint'],
    ['j-crank-coupler', 'joint', 'crank-coupler revolute joint'],
    ['j-coupler-rocker', 'joint', 'coupler-rocker revolute joint'],
    ['j-rocker-ground', 'joint', 'rocker-ground revolute joint'],
  ] as const;
  const observation: MechanicalObservation = {
    elements: elements.map(([id, kind, label]) => ({
      id,
      kind,
      label,
      observed: true,
      evidence: `${PHASE_3D_FIXTURE_MARKER}; topologia transcrita da fonte técnica.`,
      confidence: 1,
    })),
    connections: [
      ['ground', 'j-ground-crank'], ['crank', 'j-ground-crank'],
      ['crank', 'j-crank-coupler'], ['coupler', 'j-crank-coupler'],
      ['coupler', 'j-coupler-rocker'], ['rocker', 'j-coupler-rocker'],
      ['rocker', 'j-rocker-ground'], ['ground', 'j-rocker-ground'],
    ].map(([from, to]) => ({ from, to, relation: 'connected', observed: true, evidence: `${PHASE_3D_FIXTURE_MARKER}; relação da topologia documentada.` })),
    dimensions: [],
    ambiguities: [],
    missingInformation: [],
  };
  const source: MechanicalGraphSource = {
    caseId: PHASE_3D_FIXTURE_CASE_ID,
    imagePath: 'fixture://technical-four-bar',
    sourceUrl: PHASE_3D_TECHNICAL_REFERENCE,
    title: 'Documented planar four-bar reference — test fixture only',
  };
  const graph = normalizeMechanicalObservation(observation, source);
  for (const node of graph.nodes) {
    node.kind = node.sourceElementId.startsWith('j-') ? 'joint' : node.sourceElementId === 'ground' ? 'support' : 'link';
    node.provenance = 'observed';
    node.review = 'verified';
  }
  for (const connection of graph.connections) connection.review = 'verified';
  graph.review = {
    status: 'verified',
    proposedActions: [],
    changes: [],
    reviewer: { name: `${PHASE_3D_FIXTURE_MARKER} reviewer` },
    confirmedAt: '2026-10-30T12:00:00Z',
  };
  return graph;
}

function nodeId(graph: MechanicalGraphV1, sourceElementId: string): string {
  const node = graph.nodes.find((candidate) => candidate.sourceElementId === sourceElementId);
  if (!node) throw new Error(`Fixture node missing: ${sourceElementId}`);
  return node.id;
}

function createAssembly(graph: MechanicalGraphV1): KinematicAssemblyV1 {
  const node = (sourceElementId: string) => parameter(nodeId(graph, sourceElementId));
  const revolute = (sourceElementId: string, connects: [
    'ground' | 'crank' | 'coupler' | 'rocker',
    'ground' | 'crank' | 'coupler' | 'rocker',
  ], connectionIds: string[]) => ({
    nodeId: node(sourceElementId),
    type: parameter<'revolute'>('revolute'),
    connects,
    connectionIds,
  });
  const joints: Record<FourBarJointRole, ReturnType<typeof revolute>> = {
    'ground-crank': revolute('j-ground-crank', ['ground', 'crank'], ['connection-1', 'connection-2']),
    'crank-coupler': revolute('j-crank-coupler', ['crank', 'coupler'], ['connection-3', 'connection-4']),
    'coupler-rocker': revolute('j-coupler-rocker', ['coupler', 'rocker'], ['connection-5', 'connection-6']),
    'rocker-ground': revolute('j-rocker-ground', ['rocker', 'ground'], ['connection-7', 'connection-8']),
  };
  return {
    schema: KINEMATIC_ASSEMBLY_SCHEMA,
    mechanism: FOUR_BAR_MECHANISM,
    sourceGraph: { schema: 'mechanical_graph.v1', caseId: graph.source.caseId },
    ground: { nodeId: node('ground'), fixed: parameter<true>(true) },
    links: {
      ground: { nodeId: node('ground'), length: parameter(100, 'mm') },
      crank: { nodeId: node('crank'), length: parameter(40, 'mm') },
      coupler: { nodeId: node('coupler'), length: parameter(120, 'mm') },
      rocker: { nodeId: node('rocker'), length: parameter(90, 'mm') },
    },
    joints,
    parameters: {
      lengthUnit: parameter<'mm'>('mm'),
      inputAngleRad: parameter(0, 'rad'),
      branch: parameter<'plus' | 'minus'>('plus'),
    },
  };
}

export function createPhase3DReferenceFixture(): Phase3DReferenceFixture {
  const graph = createGraph();
  return { graph, assembly: createAssembly(graph) };
}
