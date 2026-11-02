import type { Provenance } from '../../core/provenance';

export const RECONSTRUCTION_OBSERVATION_SCHEMA = 'unfold.excavator_observation.v1' as const;
export const ASSEMBLY_PROPOSAL_SCHEMA = 'unfold.assembly.v1' as const;

export const EXCAVATOR_ENTITY_KINDS = [
  'chassis', 'boom', 'stick', 'bucket', 'joint', 'cylinder', 'track', 'counterweight', 'house', 'unknown',
] as const;
export type ExcavatorEntityKind = typeof EXCAVATOR_ENTITY_KINDS[number];

export const OBSERVATION_STATUSES = ['observed', 'hypothesis', 'unknown'] as const;
export type ObservationStatus = typeof OBSERVATION_STATUSES[number];

export const SOURCE_KINDS = ['image', 'technical_drawing', 'text'] as const;
export type ReconstructionSourceKind = typeof SOURCE_KINDS[number];

export type SourceEvidence = {
  id: string;
  kind: 'image_region' | 'drawing_annotation' | 'text_span' | 'user_instruction' | 'template';
  detail: string;
  locator?: string;
};

export type ObservedFeature = {
  name: string;
  value: string | null;
  status: ObservationStatus;
  evidence: SourceEvidence[];
};

export type ExcavatorObservationEntity = {
  id: string;
  kind: ExcavatorEntityKind;
  label: string;
  status: ObservationStatus;
  evidence: SourceEvidence[];
  features: ObservedFeature[];
  confidence: number;
};

export type ExcavatorObservationRelation = {
  id: string;
  relation: 'connected' | 'pivot' | 'mounted_on' | 'actuated_by' | 'contains' | 'aligned_with' | 'unknown';
  from: string;
  to: string;
  status: ObservationStatus;
  evidence: SourceEvidence[];
  confidence: number;
};

export type ExcavatorObservationDimension = {
  id: string;
  partId: string | null;
  label: string;
  value: number | null;
  unit: 'mm' | 'm' | 'deg' | 'unknown';
  status: ObservationStatus;
  evidence: SourceEvidence[];
};

export type ReconstructionRequest = {
  id: string;
  operation: 'set_dimension' | 'increase_dimension' | 'decrease_dimension' | 'replace_part' | 'unknown';
  target: string;
  value: number | null;
  unit: 'mm' | 'm' | 'deg' | 'unknown';
  text: string;
  evidence: SourceEvidence[];
};

export type ObservationHypothesis = {
  id: string;
  statement: string;
  evidence: SourceEvidence[];
  confidence: number;
};

export type ExcavatorObservationV1 = {
  schema: typeof RECONSTRUCTION_OBSERVATION_SCHEMA;
  source: {
    kind: ReconstructionSourceKind;
    reference: string;
    sha256?: string;
  };
  machineType: 'excavator' | 'unknown';
  entities: ExcavatorObservationEntity[];
  relations: ExcavatorObservationRelation[];
  dimensions: ExcavatorObservationDimension[];
  requests: ReconstructionRequest[];
  unknowns: string[];
  hypotheses: ObservationHypothesis[];
};

export type AssemblyValueSource = 'observed' | 'hypothesis' | 'template' | 'unknown';
export type AssemblyReviewStatus = 'pending' | 'verified' | 'rejected';

export type AssemblyDimension = {
  value: number | null;
  unit: 'mm' | 'm' | 'deg' | 'unknown';
  source: AssemblyValueSource;
  evidenceIds: string[];
  requiredForVerification: boolean;
};

export type AssemblyPart = {
  id: string;
  role: 'chassis' | 'boom' | 'stick' | 'bucket' | 'cylinder' | 'track' | 'counterweight' | 'house' | 'unknown';
  libraryKey: string;
  parentId: string | null;
  transform: {
    translation: [number, number, number];
    rotationEulerDeg: [number, number, number];
    scale: [number, number, number];
  };
  geometrySource: 'observed' | 'hypothesis' | 'template' | 'mixed' | 'unknown';
  dimensions: Record<string, AssemblyDimension>;
  evidenceIds: string[];
  provenance: Provenance;
  review: AssemblyReviewStatus;
};

export type AssemblyJoint = {
  id: string;
  type: 'fixed' | 'revolute' | 'prismatic' | 'unknown';
  parentPartId: string;
  childPartId: string;
  anchor: [number, number, number];
  axis: [number, number, number];
  source: AssemblyValueSource;
  evidenceIds: string[];
  review: AssemblyReviewStatus;
};

export type AssemblyActuator = {
  id: string;
  kind: 'hydraulic_cylinder' | 'unknown';
  bodyPartId: string;
  rodPartId: string;
  jointIds: string[];
  stroke: AssemblyDimension;
  source: AssemblyValueSource;
  evidenceIds: string[];
  review: AssemblyReviewStatus;
};

export type AssemblyModification = {
  id: string;
  operation: ReconstructionRequest['operation'];
  targetPartId: string | null;
  targetText: string;
  value: number | null;
  unit: AssemblyDimension['unit'];
  evidenceIds: string[];
  review: AssemblyReviewStatus;
};

export type AssemblyProposalV1 = {
  schema: typeof ASSEMBLY_PROPOSAL_SCHEMA;
  proposalId: string;
  machineType: 'excavator';
  source: {
    observationSchema: typeof RECONSTRUCTION_OBSERVATION_SCHEMA;
    observationId: string;
    kind: ReconstructionSourceKind;
    reference: string;
  };
  parts: AssemblyPart[];
  joints: AssemblyJoint[];
  actuators: AssemblyActuator[];
  modifications: AssemblyModification[];
  unknowns: string[];
  hypotheses: ObservationHypothesis[];
  validation: {
    status: 'review_required' | 'blocked';
    issues: string[];
    humanCorrectionItems: number;
  };
};

const entityKinds = [...EXCAVATOR_ENTITY_KINDS];
const observationStatuses = [...OBSERVATION_STATUSES];
const sourceKinds = [...SOURCE_KINDS];

const evidenceSchema = {
  type: 'object', additionalProperties: false,
  required: ['id', 'kind', 'detail'],
  properties: {
    id: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' },
    kind: { enum: ['image_region', 'drawing_annotation', 'text_span', 'user_instruction', 'template'] },
    detail: { type: 'string', minLength: 1, maxLength: 1000 },
    locator: { type: 'string', maxLength: 200 },
  },
} as const;

const featureSchema = {
  type: 'object', additionalProperties: false,
  required: ['name', 'value', 'status', 'evidence'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    value: { type: ['string', 'null'], maxLength: 500 },
    status: { enum: observationStatuses },
    evidence: { type: 'array', maxItems: 8, items: evidenceSchema },
  },
} as const;

export const OBSERVATION_JSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['schema', 'source', 'machineType', 'entities', 'relations', 'dimensions', 'requests', 'unknowns', 'hypotheses'],
  properties: {
    schema: { const: RECONSTRUCTION_OBSERVATION_SCHEMA },
    source: {
      type: 'object', additionalProperties: false, required: ['kind', 'reference'],
      properties: { kind: { enum: sourceKinds }, reference: { type: 'string', minLength: 1, maxLength: 200 }, sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' } },
    },
    machineType: { enum: ['excavator', 'unknown'] },
    entities: {
      type: 'array', minItems: 1, maxItems: 64, items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'kind', 'label', 'status', 'evidence', 'features', 'confidence'],
        properties: {
          id: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' },
          kind: { enum: entityKinds }, label: { type: 'string', minLength: 1, maxLength: 200 }, status: { enum: observationStatuses },
          evidence: { type: 'array', minItems: 1, maxItems: 8, items: evidenceSchema },
          features: { type: 'array', maxItems: 32, items: featureSchema }, confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
    relations: {
      type: 'array', maxItems: 256, items: {
        type: 'object', additionalProperties: false, required: ['id', 'relation', 'from', 'to', 'status', 'evidence', 'confidence'],
        properties: {
          id: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' },
          relation: { enum: ['connected', 'pivot', 'mounted_on', 'actuated_by', 'contains', 'aligned_with', 'unknown'] },
          from: { type: 'string', minLength: 1, maxLength: 64 }, to: { type: 'string', minLength: 1, maxLength: 64 }, status: { enum: observationStatuses },
          evidence: { type: 'array', minItems: 1, maxItems: 8, items: evidenceSchema }, confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
    dimensions: {
      type: 'array', maxItems: 128, items: {
        type: 'object', additionalProperties: false, required: ['id', 'partId', 'label', 'value', 'unit', 'status', 'evidence'],
        properties: {
          id: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' }, partId: { type: ['string', 'null'], maxLength: 64 },
          label: { type: 'string', minLength: 1, maxLength: 160 }, value: { type: ['number', 'null'] }, unit: { enum: ['mm', 'm', 'deg', 'unknown'] }, status: { enum: observationStatuses },
          evidence: { type: 'array', minItems: 1, maxItems: 8, items: evidenceSchema },
        },
      },
    },
    requests: {
      type: 'array', maxItems: 32, items: {
        type: 'object', additionalProperties: false, required: ['id', 'operation', 'target', 'value', 'unit', 'text', 'evidence'],
        properties: {
          id: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' }, operation: { enum: ['set_dimension', 'increase_dimension', 'decrease_dimension', 'replace_part', 'unknown'] },
          target: { type: 'string', minLength: 1, maxLength: 160 }, value: { type: ['number', 'null'] }, unit: { enum: ['mm', 'm', 'deg', 'unknown'] }, text: { type: 'string', minLength: 1, maxLength: 500 },
          evidence: { type: 'array', minItems: 1, maxItems: 8, items: evidenceSchema },
        },
      },
    },
    unknowns: { type: 'array', maxItems: 128, items: { type: 'string', minLength: 1, maxLength: 500 } },
    hypotheses: {
      type: 'array', maxItems: 128, items: {
        type: 'object', additionalProperties: false, required: ['id', 'statement', 'evidence', 'confidence'],
        properties: { id: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' }, statement: { type: 'string', minLength: 1, maxLength: 500 }, evidence: { type: 'array', minItems: 1, maxItems: 8, items: evidenceSchema }, confidence: { type: 'number', minimum: 0, maximum: 1 } },
      },
    },
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }
function fail(path: string, message: string): never { throw new Error(`RECONSTRUCTION_SCHEMA_INVALID:${path}:${message}`); }
function stringAt(value: unknown, path: string, max = 500): string { if (typeof value !== 'string' || !value.trim() || value.length > max) fail(path, 'string inválida'); return value; }
function finite(value: unknown, path: string): number { if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'número finito esperado'); return value; }
function confidence(value: unknown, path: string): number { const result = finite(value, path); if (result < 0 || result > 1) fail(path, 'confidence fora do intervalo'); return result; }
function list(value: unknown, path: string, max: number): unknown[] { if (!Array.isArray(value) || value.length > max) fail(path, 'lista inválida'); return value; }
function uniqueIds(items: Array<{ id: string }>, path: string): void { const ids = new Set<string>(); for (const item of items) { if (ids.has(item.id)) fail(path, `ID duplicado: ${item.id}`); ids.add(item.id); } }

function validateEvidence(value: unknown, path: string): SourceEvidence[] {
  const items = list(value, path, 8).map((item, index) => {
    if (!isRecord(item)) fail(`${path}.${index}`, 'evidência inválida');
    const kind = item.kind;
    if (!['image_region', 'drawing_annotation', 'text_span', 'user_instruction', 'template'].includes(String(kind))) fail(`${path}.${index}.kind`, 'tipo inválido');
    return { id: stringAt(item.id, `${path}.${index}.id`, 64), kind: kind as SourceEvidence['kind'], detail: stringAt(item.detail, `${path}.${index}.detail`, 1000), ...(item.locator === undefined ? {} : { locator: stringAt(item.locator, `${path}.${index}.locator`, 200) }) };
  });
  uniqueIds(items, path);
  if (items.length === 0) fail(path, 'evidência obrigatória');
  return items;
}

function validateStatus(value: unknown, path: string): ObservationStatus { if (!observationStatuses.includes(value as ObservationStatus)) fail(path, 'estado inválido'); return value as ObservationStatus; }

export function validateExcavatorObservation(value: unknown): ExcavatorObservationV1 {
  if (!isRecord(value)) fail('$', 'objecto esperado');
  if (value.schema !== RECONSTRUCTION_OBSERVATION_SCHEMA) fail('schema', 'schema inválido');
  if (!isRecord(value.source)) fail('source', 'source inválido');
  const sourceKind = value.source.kind;
  if (!sourceKinds.includes(sourceKind as ReconstructionSourceKind)) fail('source.kind', 'tipo de fonte inválido');
  const source = { kind: sourceKind as ReconstructionSourceKind, reference: stringAt(value.source.reference, 'source.reference', 200), ...(value.source.sha256 === undefined ? {} : { sha256: stringAt(value.source.sha256, 'source.sha256', 64) }) };
  if (source.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(source.sha256)) fail('source.sha256', 'sha256 inválido');
  if (value.machineType !== 'excavator' && value.machineType !== 'unknown') fail('machineType', 'tipo de máquina inválido');
  const entities = list(value.entities, 'entities', 64).map((item, index) => {
    if (!isRecord(item)) fail(`entities.${index}`, 'entidade inválida');
    if (!entityKinds.includes(item.kind as ExcavatorEntityKind)) fail(`entities.${index}.kind`, 'tipo de entidade inválido');
    const features = list(item.features, `entities.${index}.features`, 32).map((feature, featureIndex) => {
      if (!isRecord(feature)) fail(`entities.${index}.features.${featureIndex}`, 'feature inválida');
      const status = validateStatus(feature.status, `entities.${index}.features.${featureIndex}.status`);
      if (feature.value !== null && feature.value !== undefined && (typeof feature.value !== 'string' || feature.value.length > 500)) fail(`entities.${index}.features.${featureIndex}.value`, 'valor inválido');
      return { name: stringAt(feature.name, `entities.${index}.features.${featureIndex}.name`, 100), value: feature.value === null ? null : String(feature.value), status, evidence: validateEvidence(feature.evidence, `entities.${index}.features.${featureIndex}.evidence`) };
    });
    return { id: stringAt(item.id, `entities.${index}.id`, 64), kind: item.kind as ExcavatorEntityKind, label: stringAt(item.label, `entities.${index}.label`, 200), status: validateStatus(item.status, `entities.${index}.status`), evidence: validateEvidence(item.evidence, `entities.${index}.evidence`), features, confidence: confidence(item.confidence, `entities.${index}.confidence`) };
  });
  uniqueIds(entities, 'entities');
  const entityIds = new Set(entities.map((entity) => entity.id));
  const relations = list(value.relations, 'relations', 256).map((item, index) => {
    if (!isRecord(item)) fail(`relations.${index}`, 'relação inválida');
    if (!['connected', 'pivot', 'mounted_on', 'actuated_by', 'contains', 'aligned_with', 'unknown'].includes(String(item.relation))) fail(`relations.${index}.relation`, 'relação inválida');
    const from = stringAt(item.from, `relations.${index}.from`, 64); const to = stringAt(item.to, `relations.${index}.to`, 64);
    if (!entityIds.has(from) || !entityIds.has(to)) fail(`relations.${index}`, 'relação referencia entidade ausente');
    return { id: stringAt(item.id, `relations.${index}.id`, 64), relation: item.relation as ExcavatorObservationRelation['relation'], from, to, status: validateStatus(item.status, `relations.${index}.status`), evidence: validateEvidence(item.evidence, `relations.${index}.evidence`), confidence: confidence(item.confidence, `relations.${index}.confidence`) };
  });
  uniqueIds(relations, 'relations');
  const dimensions = list(value.dimensions, 'dimensions', 128).map((item, index) => {
    if (!isRecord(item)) fail(`dimensions.${index}`, 'dimensão inválida');
    const status = validateStatus(item.status, `dimensions.${index}.status`);
    const unit = item.unit; if (!['mm', 'm', 'deg', 'unknown'].includes(String(unit))) fail(`dimensions.${index}.unit`, 'unidade inválida');
    const partId = item.partId === null ? null : stringAt(item.partId, `dimensions.${index}.partId`, 64);
    if (partId !== null && !entityIds.has(partId)) fail(`dimensions.${index}.partId`, 'parte ausente');
    const valueNumber = item.value === null ? null : finite(item.value, `dimensions.${index}.value`);
    if (status === 'unknown' && valueNumber !== null) fail(`dimensions.${index}.value`, 'unknown não pode ter valor');
    if (status !== 'unknown' && valueNumber === null) fail(`dimensions.${index}.value`, 'valor obrigatório para estado conhecido');
    return { id: stringAt(item.id, `dimensions.${index}.id`, 64), partId, label: stringAt(item.label, `dimensions.${index}.label`, 160), value: valueNumber, unit: unit as ExcavatorObservationDimension['unit'], status, evidence: validateEvidence(item.evidence, `dimensions.${index}.evidence`) };
  });
  uniqueIds(dimensions, 'dimensions');
  const requests = list(value.requests, 'requests', 32).map((item, index) => {
    if (!isRecord(item)) fail(`requests.${index}`, 'pedido inválido');
    const operation = item.operation; if (!['set_dimension', 'increase_dimension', 'decrease_dimension', 'replace_part', 'unknown'].includes(String(operation))) fail(`requests.${index}.operation`, 'operação inválida');
    const valueNumber = item.value === null ? null : finite(item.value, `requests.${index}.value`);
    const unit = item.unit; if (!['mm', 'm', 'deg', 'unknown'].includes(String(unit))) fail(`requests.${index}.unit`, 'unidade inválida');
    return { id: stringAt(item.id, `requests.${index}.id`, 64), operation: operation as ReconstructionRequest['operation'], target: stringAt(item.target, `requests.${index}.target`, 160), value: valueNumber, unit: unit as ReconstructionRequest['unit'], text: stringAt(item.text, `requests.${index}.text`, 500), evidence: validateEvidence(item.evidence, `requests.${index}.evidence`) };
  });
  uniqueIds(requests, 'requests');
  const unknowns = list(value.unknowns, 'unknowns', 128).map((item, index) => stringAt(item, `unknowns.${index}`, 500));
  const hypotheses = list(value.hypotheses, 'hypotheses', 128).map((item, index) => {
    if (!isRecord(item)) fail(`hypotheses.${index}`, 'hipótese inválida');
    return { id: stringAt(item.id, `hypotheses.${index}.id`, 64), statement: stringAt(item.statement, `hypotheses.${index}.statement`, 500), evidence: validateEvidence(item.evidence, `hypotheses.${index}.evidence`), confidence: confidence(item.confidence, `hypotheses.${index}.confidence`) };
  });
  uniqueIds(hypotheses, 'hypotheses');
  return { schema: RECONSTRUCTION_OBSERVATION_SCHEMA, source, machineType: value.machineType as ExcavatorObservationV1['machineType'], entities, relations, dimensions, requests, unknowns, hypotheses };
}

function vector(value: unknown, path: string, allowZero = true): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) fail(path, 'vector 3D inválido');
  const result = value.map((item, index) => finite(item, `${path}.${index}`)) as [number, number, number];
  const norm = Math.hypot(...result);
  if (!allowZero && norm === 0) fail(path, 'vector não pode ser zero');
  return result;
}

function assemblySource(value: unknown, path: string): AssemblyValueSource {
  if (!['observed', 'hypothesis', 'template', 'unknown'].includes(String(value))) fail(path, 'origem inválida');
  return value as AssemblyValueSource;
}

function assemblyReview(value: unknown, path: string): AssemblyReviewStatus {
  if (!['pending', 'verified', 'rejected'].includes(String(value))) fail(path, 'estado de revisão inválido');
  return value as AssemblyReviewStatus;
}

function evidenceIdList(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !id)) fail(path, 'evidências inválidas');
  return value as string[];
}

export function validateAssemblyProposal(value: unknown): AssemblyProposalV1 {
  if (!isRecord(value)) fail('$', 'objecto esperado');
  if (value.schema !== ASSEMBLY_PROPOSAL_SCHEMA) fail('schema', 'schema inválido');
  if (typeof value.proposalId !== 'string' || !value.proposalId) fail('proposalId', 'ID inválido');
  if (value.machineType !== 'excavator') fail('machineType', 'apenas excavator é suportado');
  if (!isRecord(value.source) || value.source.observationSchema !== RECONSTRUCTION_OBSERVATION_SCHEMA || typeof value.source.observationId !== 'string' || !sourceKinds.includes(value.source.kind as ReconstructionSourceKind) || typeof value.source.reference !== 'string' || !value.source.reference) fail('source', 'source inválido');
  const parts = list(value.parts, 'parts', 64).map((item, index) => {
    if (!isRecord(item)) fail(`parts.${index}`, 'parte inválida');
    const role = item.role; if (!['chassis', 'boom', 'stick', 'bucket', 'cylinder', 'track', 'counterweight', 'house', 'unknown'].includes(String(role))) fail(`parts.${index}.role`, 'role inválido');
    const parentId = item.parentId === null ? null : stringAt(item.parentId, `parts.${index}.parentId`, 64);
    if (!isRecord(item.transform)) fail(`parts.${index}.transform`, 'transform inválido');
    const translation = vector(item.transform.translation, `parts.${index}.transform.translation`);
    const rotationEulerDeg = vector(item.transform.rotationEulerDeg, `parts.${index}.transform.rotationEulerDeg`);
    const scale = vector(item.transform.scale, `parts.${index}.transform.scale`);
    if (scale.some((component) => component <= 0)) fail(`parts.${index}.transform.scale`, 'escala deve ser positiva');
    const geometrySource = item.geometrySource; if (!['observed', 'hypothesis', 'template', 'mixed', 'unknown'].includes(String(geometrySource))) fail(`parts.${index}.geometrySource`, 'fonte geométrica inválida');
    if (!isRecord(item.dimensions)) fail(`parts.${index}.dimensions`, 'dimensões inválidas');
    const dimensions: Record<string, AssemblyDimension> = {};
    for (const [key, raw] of Object.entries(item.dimensions)) {
      if (!isRecord(raw)) fail(`parts.${index}.dimensions.${key}`, 'dimensão inválida');
      const dimensionValue = raw.value === null ? null : finite(raw.value, `parts.${index}.dimensions.${key}.value`);
      const unit = raw.unit; if (!['mm', 'm', 'deg', 'unknown'].includes(String(unit))) fail(`parts.${index}.dimensions.${key}.unit`, 'unidade inválida');
      const source = raw.source; if (!['observed', 'hypothesis', 'template', 'unknown'].includes(String(source))) fail(`parts.${index}.dimensions.${key}.source`, 'origem inválida');
      if (!Array.isArray(raw.evidenceIds) || raw.evidenceIds.some((id) => typeof id !== 'string')) fail(`parts.${index}.dimensions.${key}.evidenceIds`, 'evidências inválidas');
      if (typeof raw.requiredForVerification !== 'boolean') fail(`parts.${index}.dimensions.${key}.requiredForVerification`, 'flag inválida');
      dimensions[key] = { value: dimensionValue, unit: unit as AssemblyDimension['unit'], source: source as AssemblyValueSource, evidenceIds: raw.evidenceIds as string[], requiredForVerification: raw.requiredForVerification };
    }
    if (!Array.isArray(item.evidenceIds) || item.evidenceIds.some((id) => typeof id !== 'string')) fail(`parts.${index}.evidenceIds`, 'evidências inválidas');
    if (!isRecord(item.provenance) || typeof item.provenance.origin !== 'string' || typeof item.provenance.validation !== 'string' || typeof item.provenance.recordedAt !== 'string') fail(`parts.${index}.provenance`, 'proveniência inválida');
    assemblyReview(item.review, `parts.${index}.review`);
    return {
      id: stringAt(item.id, `parts.${index}.id`, 64),
      role: role as AssemblyPart['role'],
      libraryKey: stringAt(item.libraryKey, `parts.${index}.libraryKey`, 160),
      parentId,
      transform: { translation, rotationEulerDeg, scale },
      geometrySource: geometrySource as AssemblyPart['geometrySource'],
      dimensions,
      evidenceIds: evidenceIdList(item.evidenceIds, `parts.${index}.evidenceIds`),
      provenance: item.provenance as AssemblyPart['provenance'],
      review: item.review as AssemblyPart['review'],
    };
  });
  uniqueIds(parts, 'parts');
  const partIds = new Set(parts.map((part) => part.id));
  const roots = parts.filter((part) => part.parentId === null);
  if (roots.length !== 1 || roots[0]?.role !== 'chassis') fail('parts', 'a árvore deve ter exactamente um chassis raiz');
  for (const part of parts) if (part.parentId !== null && !partIds.has(part.parentId)) fail(`parts.${part.id}.parentId`, 'pai ausente');
  for (const part of parts) {
    const visited = new Set<string>(); let cursor: string | null = part.id;
    while (cursor !== null) { if (visited.has(cursor)) fail(`parts.${part.id}.parentId`, 'ciclo na hierarquia'); visited.add(cursor); cursor = parts.find((candidate) => candidate.id === cursor)?.parentId ?? null; }
  }
  const joints = list(value.joints, 'joints', 128).map((item, index) => {
    if (!isRecord(item)) fail(`joints.${index}`, 'junta inválida');
    const type = item.type; if (!['fixed', 'revolute', 'prismatic', 'unknown'].includes(String(type))) fail(`joints.${index}.type`, 'tipo inválido');
    const parentPartId = stringAt(item.parentPartId, `joints.${index}.parentPartId`, 64); const childPartId = stringAt(item.childPartId, `joints.${index}.childPartId`, 64);
    if (!partIds.has(parentPartId) || !partIds.has(childPartId) || parentPartId === childPartId) fail(`joints.${index}`, 'partes da junta inválidas');
    const source = assemblySource(item.source, `joints.${index}.source`);
    return { id: stringAt(item.id, `joints.${index}.id`, 64), type: type as AssemblyJoint['type'], parentPartId, childPartId, anchor: vector(item.anchor, `joints.${index}.anchor`), axis: vector(item.axis, `joints.${index}.axis`, false), source, evidenceIds: evidenceIdList(item.evidenceIds, `joints.${index}.evidenceIds`), review: assemblyReview(item.review, `joints.${index}.review`) };
  });
  uniqueIds(joints, 'joints');
  const jointIds = new Set(joints.map((joint) => joint.id));
  const actuators = list(value.actuators, 'actuators', 64).map((item, index) => {
    if (!isRecord(item)) fail(`actuators.${index}`, 'actuator inválido');
    const bodyPartId = stringAt(item.bodyPartId, `actuators.${index}.bodyPartId`, 64); const rodPartId = stringAt(item.rodPartId, `actuators.${index}.rodPartId`, 64);
    if (!partIds.has(bodyPartId) || !partIds.has(rodPartId)) fail(`actuators.${index}`, 'partes do actuator ausentes');
    if (!Array.isArray(item.jointIds) || item.jointIds.some((id) => typeof id !== 'string' || !jointIds.has(id))) fail(`actuators.${index}.jointIds`, 'juntas do actuator inválidas');
    if (item.kind !== 'hydraulic_cylinder' && item.kind !== 'unknown') fail(`actuators.${index}.kind`, 'tipo de actuator inválido');
    if (!isRecord(item.stroke)) fail(`actuators.${index}.stroke`, 'stroke inválido');
    const strokeValue = item.stroke.value === null ? null : finite(item.stroke.value, `actuators.${index}.stroke.value`);
    const unit = item.stroke.unit; if (!['mm', 'm', 'deg', 'unknown'].includes(String(unit))) fail(`actuators.${index}.stroke.unit`, 'unidade inválida');
    const strokeSource = assemblySource(item.stroke.source, `actuators.${index}.stroke.source`);
    const strokeEvidenceIds = evidenceIdList(item.stroke.evidenceIds, `actuators.${index}.stroke.evidenceIds`);
    if (typeof item.stroke.requiredForVerification !== 'boolean') fail(`actuators.${index}.stroke.requiredForVerification`, 'flag inválida');
    const source = assemblySource(item.source, `actuators.${index}.source`);
    return { id: stringAt(item.id, `actuators.${index}.id`, 64), kind: item.kind as AssemblyActuator['kind'], bodyPartId, rodPartId, jointIds: item.jointIds as string[], stroke: { value: strokeValue, unit: unit as AssemblyDimension['unit'], source: strokeSource, evidenceIds: strokeEvidenceIds, requiredForVerification: item.stroke.requiredForVerification }, source, evidenceIds: evidenceIdList(item.evidenceIds, `actuators.${index}.evidenceIds`), review: assemblyReview(item.review, `actuators.${index}.review`) };
  });
  uniqueIds(actuators, 'actuators');
  const modifications = list(value.modifications, 'modifications', 32).map((item, index) => {
    if (!isRecord(item)) fail(`modifications.${index}`, 'modificação inválida');
    if (!['set_dimension', 'increase_dimension', 'decrease_dimension', 'replace_part', 'unknown'].includes(String(item.operation))) fail(`modifications.${index}.operation`, 'operação inválida');
    const targetPartId = item.targetPartId === null ? null : stringAt(item.targetPartId, `modifications.${index}.targetPartId`, 64);
    if (targetPartId !== null && !partIds.has(targetPartId)) fail(`modifications.${index}.targetPartId`, 'parte ausente');
    if (!['mm', 'm', 'deg', 'unknown'].includes(String(item.unit))) fail(`modifications.${index}.unit`, 'unidade inválida');
    return { id: stringAt(item.id, `modifications.${index}.id`, 64), operation: item.operation as ReconstructionRequest['operation'], targetPartId, targetText: stringAt(item.targetText, `modifications.${index}.targetText`, 160), value: item.value === null ? null : finite(item.value, `modifications.${index}.value`), unit: item.unit as AssemblyDimension['unit'], evidenceIds: evidenceIdList(item.evidenceIds, `modifications.${index}.evidenceIds`), review: assemblyReview(item.review, `modifications.${index}.review`) };
  });
  uniqueIds(modifications, 'modifications');
  if (!Array.isArray(value.unknowns) || value.unknowns.some((item) => typeof item !== 'string')) fail('unknowns', 'unknowns inválidos');
  if (!Array.isArray(value.hypotheses)) fail('hypotheses', 'hypotheses inválidas');
  const humanCorrectionItems = isRecord(value.validation) ? value.validation.humanCorrectionItems : undefined;
  if (!isRecord(value.validation) || !['review_required', 'blocked'].includes(String(value.validation.status)) || !Array.isArray(value.validation.issues) || value.validation.issues.some((item) => typeof item !== 'string') || typeof humanCorrectionItems !== 'number' || !Number.isSafeInteger(humanCorrectionItems) || humanCorrectionItems < 0) fail('validation', 'validação inválida');
  return value as unknown as AssemblyProposalV1;
}

export function parseJsonObject(text: string): unknown {
  if (typeof text !== 'string' || text.length === 0 || text.length > 200_000) throw new Error('RECONSTRUCTION_JSON_INVALID:saída vazia ou demasiado grande');
  try {
    const value = JSON.parse(text) as unknown;
    if (!isRecord(value) || Array.isArray(value)) throw new Error('objecto JSON esperado');
    return value;
  } catch (error) {
    throw new Error(`RECONSTRUCTION_JSON_INVALID:${error instanceof Error ? error.message : 'JSON inválido'}`);
  }
}
