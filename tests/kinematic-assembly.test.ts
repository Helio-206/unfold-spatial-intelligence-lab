import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeMechanicalObservation, type MechanicalGraphV1, type MechanicalGraphSource } from '../src/mechanical-graph';
import { solveFourBar } from '../src/kinematics';
import {
  adaptMechanicalGraph,
  KINEMATIC_ASSEMBLY_SCHEMA,
  FOUR_BAR_MECHANISM,
  type KinematicAssemblyV1,
  type KinematicParameter,
} from '../src/kinematic-assembly';
import type { MechanicalObservation } from '../src/meta';

const source: MechanicalGraphSource = {
  caseId: 'reference-four-bar',
  imagePath: 'reference://four-bar',
  sourceUrl: 'https://example.test/reference-four-bar',
  title: 'Documented planar four-bar reference',
};

function parameter<T>(value: T, unit: KinematicParameter<T>['unit'] = 'none'): KinematicParameter<T> {
  return { value, unit, provenance: 'reference', state: 'verified', evidence: 'Especificação matemática documentada para o teste.' };
}

function createReferenceGraph(): MechanicalGraphV1 {
  const elements = [
    ['ground', 'bar', 'ground support'],
    ['crank', 'bar', 'crank link'],
    ['coupler', 'bar', 'coupler link'],
    ['rocker', 'bar', 'rocker link'],
    ['j-ground-crank', 'joint', 'ground-crank joint'],
    ['j-crank-coupler', 'joint', 'crank-coupler joint'],
    ['j-coupler-rocker', 'joint', 'coupler-rocker joint'],
    ['j-rocker-ground', 'joint', 'rocker-ground joint'],
  ] as const;
  const observation: MechanicalObservation = {
    elements: elements.map(([id, kind, label]) => ({ id, kind, label, observed: true, evidence: 'Reference specification.', confidence: 1 })),
    connections: [
      ['ground', 'j-ground-crank'], ['crank', 'j-ground-crank'],
      ['crank', 'j-crank-coupler'], ['coupler', 'j-crank-coupler'],
      ['coupler', 'j-coupler-rocker'], ['rocker', 'j-coupler-rocker'],
      ['rocker', 'j-rocker-ground'], ['ground', 'j-rocker-ground'],
    ].map(([from, to]) => ({ from, to, relation: 'connected', observed: true, evidence: 'Reference connection.' })),
    dimensions: [],
    ambiguities: [],
    missingInformation: [],
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
    reviewer: { name: 'reference fixture maintainer' },
    confirmedAt: '2026-10-30T12:00:00Z',
  };
  return graph;
}

function nodeId(graph: MechanicalGraphV1, sourceElementId: string): string {
  return graph.nodes.find((node) => node.sourceElementId === sourceElementId)!.id;
}

function createReferenceAssembly(graph: MechanicalGraphV1): KinematicAssemblyV1 {
  const node = (sourceElementId: string) => parameter(nodeId(graph, sourceElementId));
  const length = (value: number) => parameter(value, 'mm');
  const revolute = (sourceElementId: string, connects: ['ground' | 'crank' | 'coupler' | 'rocker', 'ground' | 'crank' | 'coupler' | 'rocker'], connectionIds: string[]) => ({ nodeId: node(sourceElementId), type: parameter<'revolute'>('revolute'), connects, connectionIds });
  return {
    schema: KINEMATIC_ASSEMBLY_SCHEMA,
    mechanism: FOUR_BAR_MECHANISM,
    sourceGraph: { schema: 'mechanical_graph.v1', caseId: graph.source.caseId },
    ground: { nodeId: node('ground'), fixed: parameter<true>(true) },
    links: {
      ground: { nodeId: node('ground'), length: length(100) },
      crank: { nodeId: node('crank'), length: length(40) },
      coupler: { nodeId: node('coupler'), length: length(120) },
      rocker: { nodeId: node('rocker'), length: length(90) },
    },
    joints: {
      'ground-crank': revolute('j-ground-crank', ['ground', 'crank'], ['connection-1', 'connection-2']),
      'crank-coupler': revolute('j-crank-coupler', ['crank', 'coupler'], ['connection-3', 'connection-4']),
      'coupler-rocker': revolute('j-coupler-rocker', ['coupler', 'rocker'], ['connection-5', 'connection-6']),
      'rocker-ground': revolute('j-rocker-ground', ['rocker', 'ground'], ['connection-7', 'connection-8']),
    },
    parameters: { lengthUnit: parameter<'mm'>('mm'), inputAngleRad: parameter(0, 'rad'), branch: parameter<'plus' | 'minus'>('plus') },
  };
}

function loadPaderbornGraph(): MechanicalGraphV1 {
  const raw = JSON.parse(readFileSync('reports/phase-2d/paderborn-draft.json', 'utf8')) as unknown;
  return raw as MechanicalGraphV1;
}

function createPaderbornCandidate(graph: MechanicalGraphV1): KinematicAssemblyV1 {
  const missing = <T>(unit: KinematicParameter<T>['unit'], evidence: string): KinematicParameter<T> => ({ unit, provenance: 'mechanical_graph_inferred', state: 'missing', evidence });
  const sourceNode = (sourceElementId: string): KinematicParameter<string> => {
    const id = graph.nodes.find((node) => node.sourceElementId === sourceElementId)?.id;
    return id ? { value: id, unit: 'none', provenance: 'mechanical_graph_inferred', state: 'unverified', evidence: 'Proposta visual ainda pendente.' } : missing('none', 'Elemento não disponível na fotografia.');
  };
  const joint = (sourceElementId: string, connects: ['ground' | 'crank' | 'coupler' | 'rocker', 'ground' | 'crank' | 'coupler' | 'rocker'], connectionIds: string[]) => ({ nodeId: sourceNode(sourceElementId), type: missing<'revolute'>('none', 'Tipo revolute não confirmável visualmente.'), connects, connectionIds });
  return {
    schema: KINEMATIC_ASSEMBLY_SCHEMA,
    mechanism: FOUR_BAR_MECHANISM,
    sourceGraph: { schema: 'mechanical_graph.v1', caseId: graph.source.caseId },
    ground: { nodeId: sourceNode('b1'), fixed: missing<true>('none', 'Fixação não confirmada visualmente.') },
    links: {
      ground: { nodeId: sourceNode('b1'), length: missing('mm', 'Comprimento não indicado.') },
      crank: { nodeId: sourceNode('b2'), length: missing('mm', 'Comprimento não indicado.') },
      coupler: { nodeId: sourceNode('b3'), length: missing('mm', 'Comprimento não indicado.') },
      rocker: { nodeId: sourceNode('b4'), length: missing('mm', 'Terminal direito não classificado e sem comprimento.') },
    },
    joints: {
      'ground-crank': joint('j1', ['ground', 'crank'], ['connection-1', 'connection-2']),
      'crank-coupler': joint('j2', ['crank', 'coupler'], ['connection-3', 'connection-4']),
      'coupler-rocker': joint('j3', ['coupler', 'rocker'], ['connection-5', 'connection-6']),
      'rocker-ground': joint('missing-j4', ['rocker', 'ground'], []),
    },
    parameters: {
      lengthUnit: parameter<'mm'>('mm'),
      inputAngleRad: missing('rad', 'Ângulo de entrada não fornecido pela fotografia.'),
      branch: missing<'plus' | 'minus'>('none', 'Ramo de montagem não fornecido.'),
    },
  };
}

describe('kinematic_assembly.v1 adapter', () => {
  it('adapts a complete reference graph into the existing solver input', () => {
    const graph = createReferenceGraph();
    const assembly = createReferenceAssembly(graph);
    const adapted = adaptMechanicalGraph(graph, assembly);
    expect(adapted.status).toBe('ready');
    if (adapted.status !== 'ready') return;
    expect(adapted.solverInput).toMatchObject({ lengths: { ground: 100, crank: 40, coupler: 120, rocker: 90 }, inputAngleRad: 0, branch: 'plus' });
    const solved = solveFourBar(adapted.solverInput);
    expect(solved.status).toBe('solved');
    expect(solved.residuals?.maxLengthErrorMm).toBeLessThan(1e-9);
  });

  it('keeps the Paderborn graph blocked at unknown visual properties', () => {
    const graph = loadPaderbornGraph();
    const adapted = adaptMechanicalGraph(graph, createPaderbornCandidate(graph));
    expect(adapted.status).toBe('blocked');
    if (adapted.status !== 'blocked') return;
    expect(adapted.missing.some((item) => item.includes('graph.review.status'))).toBe(true);
    expect(adapted.missing.some((item) => item.includes('links.crank.length'))).toBe(true);
    expect(adapted.missing.some((item) => item.includes('parameters.inputAngleRad'))).toBe(true);
    expect(adapted.missing.some((item) => item.includes('parameters.branch'))).toBe(true);
    expect(adapted.issues.some((issue) => issue.path === 'links.rocker.nodeId')).toBe(true);
    expect(adapted.missing.some((item) => item.includes('joints.rocker-ground.nodeId'))).toBe(true);
  });

  it('blocks a schema-valid graph whose links do not match the declared joints', () => {
    const graph = createReferenceGraph();
    const brokenConnection = graph.connections.find((connection) => connection.id === 'connection-2')!;
    brokenConnection.from = nodeId(graph, 'rocker');
    const adapted = adaptMechanicalGraph(graph, createReferenceAssembly(graph));
    expect(adapted.status).toBe('blocked');
    if (adapted.status !== 'blocked') return;
    expect(adapted.issues.some((issue) => issue.path === 'connections.connection-2')).toBe(true);
  });

  it('returns blocked, rather than throwing, for an incomplete candidate', () => {
    const graph = createReferenceGraph();
    const incomplete = structuredClone(createReferenceAssembly(graph)) as unknown as { links: Record<string, unknown> };
    delete incomplete.links.rocker;
    const adapted = adaptMechanicalGraph(graph, incomplete);
    expect(adapted.status).toBe('blocked');
  });
});
