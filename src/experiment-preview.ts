import type { ExperimentResult, KinematicOperation } from './ai-kinematic-experiment';
import type { FourBarResult } from './kinematics';

export type PreviewValidity = {
  state: 'valid' | 'impossible' | 'singular' | 'degenerate';
  limitations: string[];
};

export type PreviewProvenance = {
  originalParameters: {
    componentId: string;
    value: number;
    unit: 'mm';
    provenance: string;
    state: string;
    evidence: string;
  };
  requestedChange: {
    source: 'natural_language_instruction';
    instruction: string;
    interpretedBy: 'muse-spark-1.3';
    confirmed: false;
    componentId: string;
    value: number;
    unit: 'mm';
  };
};

export type ExperimentPreview = {
  status: 'executed';
  mechanismId: string;
  operation: KinematicOperation;
  componentsAffected: string[];
  before: { result: FourBarResult };
  after: { result: FourBarResult };
  reversible: {
    originalPreserved: true;
    reverseOperation: KinematicOperation;
  };
  differences: {
    lengthDeltaMm: number;
    statusChanged: boolean;
    crankCouplerJointDeltaMm?: number;
    couplerRockerJointDeltaMm?: number;
  };
  validity: { before: PreviewValidity; after: PreviewValidity };
  provenance: PreviewProvenance;
};

type ExecutedExperiment = Extract<ExperimentResult, { status: 'executed' }>;

function validity(result: ExecutedExperiment['before']['result']): PreviewValidity {
  const state = result.status === 'solved' ? 'valid' : result.status;
  const limitations = ['TEST_FIXTURE_ONLY; resultado não é validação física nem revisão humana.'];
  if (result.status === 'impossible') limitations.push(result.reason ?? 'A configuração não possui solução geométrica.');
  if (result.status === 'singular') limitations.push(result.reason ?? 'A configuração está num toggle/singularidade.');
  if (result.status === 'degenerate') limitations.push(result.reason ?? 'A configuração é degenerada.');
  return { state, limitations };
}

export function createExperimentPreview(mechanismId: string, instruction: string, result: ExecutedExperiment): ExperimentPreview {
  return {
    status: 'executed',
    mechanismId,
    operation: result.operation,
    componentsAffected: [result.operation.componentId],
    before: { result: result.before.result },
    after: { result: result.after.result },
    reversible: {
      originalPreserved: true,
      reverseOperation: {
        schema: result.operation.schema,
        action: result.operation.action,
        componentId: result.operation.componentId,
        newValue: result.before.parameter.value,
        unit: result.before.parameter.unit,
      },
    },
    differences: result.differences,
    validity: { before: validity(result.before.result), after: validity(result.after.result) },
    provenance: {
      originalParameters: result.before.parameter,
      requestedChange: {
        source: 'natural_language_instruction',
        instruction,
        interpretedBy: 'muse-spark-1.3',
        confirmed: false,
        componentId: result.operation.componentId,
        value: result.operation.newValue,
        unit: result.operation.unit,
      },
    },
  };
}
