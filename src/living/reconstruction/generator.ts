import { canonicalize, sha256Hex } from '../../core/canonical';
import type { Provenance } from '../../core/provenance';
import {
  ASSEMBLY_PROPOSAL_SCHEMA,
  type AssemblyActuator,
  type AssemblyDimension,
  type AssemblyJoint,
  type AssemblyModification,
  type AssemblyPart,
  type AssemblyProposalV1,
  type AssemblyValueSource,
  type ExcavatorObservationDimension,
  type ExcavatorObservationEntity,
  type ExcavatorObservationRelation,
  type ExcavatorObservationV1,
  type ReconstructionRequest,
} from './contracts';
import { EXCAVATOR_TEMPLATE_LIBRARY, templateFor, templateSourceDimension, type ExcavatorTemplate } from './library';
import { validateAssemblyProposal } from './contracts';

type PartSpec = { id: string; entityId: string; template: ExcavatorTemplate };

export type ReconstructionExecutionMode = 'live' | 'offline';
export type ExcavatorAssemblyBuildOptions = { mode?: ReconstructionExecutionMode };

const PART_SPECS: readonly PartSpec[] = [
  { id: 'part-chassis', entityId: 'chassis', template: EXCAVATOR_TEMPLATE_LIBRARY[0]! },
  { id: 'part-house', entityId: 'house', template: EXCAVATOR_TEMPLATE_LIBRARY[1]! },
  { id: 'part-boom', entityId: 'boom', template: EXCAVATOR_TEMPLATE_LIBRARY[2]! },
  { id: 'part-stick', entityId: 'stick', template: EXCAVATOR_TEMPLATE_LIBRARY[3]! },
  { id: 'part-bucket', entityId: 'bucket', template: EXCAVATOR_TEMPLATE_LIBRARY[4]! },
  { id: 'part-track-left', entityId: 'track-left', template: EXCAVATOR_TEMPLATE_LIBRARY[5]! },
  { id: 'part-track-right', entityId: 'track-right', template: EXCAVATOR_TEMPLATE_LIBRARY[6]! },
  { id: 'part-boom-cylinder-body', entityId: 'boom-cylinder', template: EXCAVATOR_TEMPLATE_LIBRARY[7]! },
  { id: 'part-boom-cylinder-rod', entityId: 'boom-cylinder', template: EXCAVATOR_TEMPLATE_LIBRARY[8]! },
  { id: 'part-stick-cylinder-body', entityId: 'stick-cylinder', template: EXCAVATOR_TEMPLATE_LIBRARY[9]! },
  { id: 'part-stick-cylinder-rod', entityId: 'stick-cylinder', template: EXCAVATOR_TEMPLATE_LIBRARY[10]! },
  { id: 'part-bucket-cylinder-body', entityId: 'bucket-cylinder', template: EXCAVATOR_TEMPLATE_LIBRARY[11]! },
  { id: 'part-bucket-cylinder-rod', entityId: 'bucket-cylinder', template: EXCAVATOR_TEMPLATE_LIBRARY[12]! },
];

const ACTUATOR_SPECS = [
  { key: 'boom', entityId: 'boom-cylinder', bodyId: 'part-boom-cylinder-body', rodId: 'part-boom-cylinder-rod', parentJoint: 'joint-boom' },
  { key: 'stick', entityId: 'stick-cylinder', bodyId: 'part-stick-cylinder-body', rodId: 'part-stick-cylinder-rod', parentJoint: 'joint-stick' },
  { key: 'bucket', entityId: 'bucket-cylinder', bodyId: 'part-bucket-cylinder-body', rodId: 'part-bucket-cylinder-rod', parentJoint: 'joint-bucket' },
] as const;

function normalize(value: string): string { return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
function unique<T>(values: T[]): T[] { return [...new Set(values)]; }
function dimensionUnit(value: number, unit: ExcavatorObservationDimension['unit']): { value: number; unit: AssemblyDimension['unit'] } {
  if (unit === 'mm') return { value: value / 1000, unit: 'm' };
  if (unit === 'm') return { value, unit: 'm' };
  if (unit === 'deg') return { value, unit: 'deg' };
  return { value, unit: 'unknown' };
}
function sourceForStatus(status: ExcavatorObservationEntity['status'] | ExcavatorObservationDimension['status']): AssemblyValueSource {
  return status === 'observed' ? 'observed' : status === 'hypothesis' ? 'hypothesis' : 'unknown';
}
type SemanticEntityRole = PartSpec['entityId'] | 'joint-swing' | 'joint-boom' | 'joint-stick' | 'joint-bucket';

function roleFromText(text: string): SemanticEntityRole | null {
  const value = normalize(text);
  if (value.includes('track left') || value.includes('left track') || value.includes('lagarta esquerda') || value.includes('esteira esquerda')) return 'track-left';
  if (value.includes('track right') || value.includes('right track') || value.includes('lagarta direita') || value.includes('esteira direita')) return 'track-right';
  if (value.includes('boom cylinder') || value.includes('cilindro do boom') || value.includes('boom cilindro')) return 'boom-cylinder';
  if (value.includes('stick cylinder') || value.includes('cilindro do stick') || value.includes('stick cilindro')) return 'stick-cylinder';
  if (value.includes('bucket cylinder') || value.includes('cilindro do balde') || value.includes('bucket cilindro')) return 'bucket-cylinder';
  if (value.includes('joint swing') || value.includes('junta de rotacao') || value.includes('junta swing')) return 'joint-swing';
  if (value.includes('joint boom') || value.includes('junta boom')) return 'joint-boom';
  if (value.includes('joint stick') || value.includes('junta stick')) return 'joint-stick';
  if (value.includes('joint bucket') || value.includes('junta bucket') || value.includes('junta balde')) return 'joint-bucket';
  if (value.includes('chassis') || value.includes('undercarriage') || value.includes('base')) return 'chassis';
  if (value.includes('house') || value.includes('upper body') || value.includes('upper_body') || value.includes('girat')) return 'house';
  if (value.includes('boom') || value.includes('lanca')) return 'boom';
  if (value.includes('stick') || value.includes('braco')) return 'stick';
  if (value.includes('bucket') || value.includes('balde')) return 'bucket';
  if (value.includes('track') || value.includes('lagarta') || value.includes('esteira')) return null;
  return null;
}

function semanticRole(entity: ExcavatorObservationEntity): SemanticEntityRole | null {
  return roleFromText(`${entity.id} ${entity.label}`) ?? (entity.kind === 'chassis' ? 'chassis' : entity.kind === 'house' ? 'house' : entity.kind === 'boom' ? 'boom' : entity.kind === 'stick' ? 'stick' : entity.kind === 'bucket' ? 'bucket' : entity.kind === 'track' ? roleFromText(entity.id) : entity.kind === 'joint' ? roleFromText(entity.id) : entity.kind === 'cylinder' ? roleFromText(entity.id) : null);
}

function entityFor(observation: ExcavatorObservationV1, role: SemanticEntityRole): ExcavatorObservationEntity | undefined {
  const direct = observation.entities
    .filter((entity) => semanticRole(entity) === role)
    .sort((left, right) => right.confidence - left.confidence)[0];
  if (direct) return direct;
  if (!role.endsWith('-cylinder')) return undefined;
  const targetRole = role.replace(/-cylinder$/, '');
  const related = observation.entities.filter((entity) => entity.kind === 'cylinder' && observation.relations.some((relation) => {
    if (relation.relation !== 'actuated_by') return false;
    const other = relation.from === entity.id ? relation.to : relation.to === entity.id ? relation.from : null;
    if (!other) return false;
    const otherEntity = observation.entities.find((candidate) => candidate.id === other);
    return otherEntity !== undefined && semanticRole(otherEntity) === targetRole;
  })).sort((left, right) => right.confidence - left.confidence)[0];
  return related;
}

const DIMENSION_LABELS: Record<string, readonly string[]> = {
  length: ['length', 'comprimento'],
  width: ['width', 'largura'],
  height: ['height', 'altura'],
  depth: ['depth', 'profundidade'],
  stroke: ['stroke', 'curso', 'extensao', 'extensão'],
  bore: ['bore', 'diametro interno', 'diâmetro interno', 'diametro', 'diâmetro'],
};

function dimensionLabelMatches(label: string, name: string): boolean {
  const normalized = normalize(label);
  return (DIMENSION_LABELS[name] ?? [name]).some((alias) => {
    const candidate = normalize(alias);
    return normalized === candidate || normalized.startsWith(`${candidate} `) || normalized.endsWith(` ${candidate}`) || normalized.includes(` ${candidate} `);
  });
}

function dimensionFor(observation: ExcavatorObservationV1, role: SemanticEntityRole, name: string): ExcavatorObservationDimension | undefined {
  return observation.dimensions.find((dimension) => {
    if (dimension.partId === null || !dimensionLabelMatches(dimension.label, name)) return false;
    const entity = observation.entities.find((candidate) => candidate.id === dimension.partId);
    return entity !== undefined && semanticRole(entity) === role;
  });
}
function partSource(entity: ExcavatorObservationEntity | undefined): AssemblyValueSource {
  return entity ? sourceForStatus(entity.status) : 'unknown';
}
function geometrySource(entity: ExcavatorObservationEntity | undefined, dimensions: Record<string, AssemblyDimension>): AssemblyPart['geometrySource'] {
  const sources = [partSource(entity), ...Object.values(dimensions).map((dimension) => dimension.source)].filter((source) => source !== 'unknown');
  const hasObserved = sources.includes('observed'); const hasHypothesis = sources.includes('hypothesis'); const hasTemplate = sources.includes('template');
  if (hasObserved && (hasHypothesis || hasTemplate)) return 'mixed';
  if (hasObserved) return 'observed';
  if (hasHypothesis) return 'hypothesis';
  if (hasTemplate) return 'template';
  return 'unknown';
}
function provenanceFor(source: AssemblyPart['geometrySource'], ids: string[], mode: ReconstructionExecutionMode, sourceKind: ExcavatorObservationV1['source']['kind']): Provenance {
  const origin = source === 'observed' ? 'observed' : source === 'hypothesis' || source === 'mixed' ? 'model_inferred' : source === 'template' ? 'synthetic' : 'unknown';
  const offline = mode === 'offline';
  const safeOrigin = offline && origin === 'model_inferred' ? 'synthetic' : origin;
  const actor = safeOrigin === 'synthetic' || safeOrigin === 'unknown'
    ? { kind: 'system' as const, id: offline ? 'living-reconstruction-offline-template' : 'living-reconstruction-template' }
    : safeOrigin === 'observed' && sourceKind === 'text'
      ? { kind: 'human' as const, id: 'user-instruction' }
      : { kind: 'model' as const, id: 'muse-spark-1.3' };
  return { origin: safeOrigin, validation: 'unreviewed', recordedAt: new Date().toISOString(), actor, evidence: ids.length ? ids.map((sourceId) => ({ sourceId })) : undefined, inference: !offline && safeOrigin === 'model_inferred' ? { provider: 'meta', model: 'muse-spark-1.3', cached: false } : undefined };
}

function assemblyDimension(observation: ExcavatorObservationV1, entityRole: SemanticEntityRole, name: string, template: ExcavatorTemplate): AssemblyDimension {
  const observed = dimensionFor(observation, entityRole, name);
  if (observed && observed.value !== null && observed.status !== 'unknown') {
    const normalized = dimensionUnit(observed.value, observed.unit);
    return { value: normalized.value, unit: normalized.unit, source: sourceForStatus(observed.status), evidenceIds: observed.evidence.map((evidence) => evidence.id), requiredForVerification: true };
  }
  return templateSourceDimension(template, name) ?? { value: null, unit: 'unknown', source: 'unknown', evidenceIds: [], requiredForVerification: true };
}

function partDimensions(observation: ExcavatorObservationV1, spec: PartSpec): Record<string, AssemblyDimension> {
  const dimensions: Record<string, AssemblyDimension> = {};
  for (const name of Object.keys(spec.template.dimensions)) dimensions[name] = assemblyDimension(observation, spec.entityId, name, spec.template);
  return dimensions;
}

function partParentId(spec: PartSpec): string | null {
  if (spec.template.parentRole === null) return null;
  if (spec.template.parentRole === 'chassis') return 'part-chassis';
  if (spec.template.parentRole === 'house') return 'part-house';
  if (spec.template.parentRole === 'boom') return 'part-boom';
  if (spec.template.parentRole === 'stick') return 'part-stick';
  if (spec.template.parentRole === 'bucket') return 'part-bucket';
  return null;
}

function sourceRelation(observation: ExcavatorObservationV1, from: string, to: string): ExcavatorObservationRelation | undefined {
  const endpointRole = (id: string): SemanticEntityRole | string => {
    const entity = observation.entities.find((candidate) => candidate.id === id);
    return entity ? semanticRole(entity) ?? normalize(entity.label) : roleFromText(id) ?? normalize(id);
  };
  return observation.relations.find((relation) => endpointRole(relation.from) === from && endpointRole(relation.to) === to)
    ?? observation.relations.find((relation) => endpointRole(relation.from) === to && endpointRole(relation.to) === from);
}

function jointSource(relation: ExcavatorObservationRelation | undefined): AssemblyValueSource { return relation ? sourceForStatus(relation.status) : 'template'; }
function jointEvidence(relation: ExcavatorObservationRelation | undefined): string[] { return relation?.evidence.map((evidence) => evidence.id) ?? [`template-joint`]; }

function joint(observation: ExcavatorObservationV1, id: string, parentPartId: string, childPartId: string, fromEntity: string, toEntity: string, type: AssemblyJoint['type'] = 'revolute'): AssemblyJoint {
  const relation = sourceRelation(observation, fromEntity, toEntity);
  const axis = id === 'joint-swing' ? [0, 0, 1] as [number, number, number] : [0, -1, 0] as [number, number, number];
  return { id, type, parentPartId, childPartId, anchor: [0, 0, 0], axis, source: jointSource(relation), evidenceIds: jointEvidence(relation), review: 'pending' };
}

function modificationTarget(target: string): string | null {
  const text = normalize(target);
  if (text.includes('chassis') || text.includes('base')) return 'part-chassis';
  if (text.includes('house') || text.includes('girat')) return 'part-house';
  if (text.includes('boom') || text.includes('lanca') || text.includes('lança')) return 'part-boom';
  if (text.includes('stick') || text.includes('braco') || text.includes('braço')) return 'part-stick';
  if (text.includes('bucket') || text.includes('balde')) return 'part-bucket';
  return null;
}

function modifications(requests: ReconstructionRequest[]): AssemblyModification[] {
  return requests.map((request) => ({ id: `mod-${request.id}`, operation: request.operation, targetPartId: modificationTarget(request.target), targetText: request.target, value: request.value, unit: request.unit, evidenceIds: request.evidence.map((evidence) => evidence.id), review: 'pending' }));
}

export function buildExcavatorAssembly(observation: ExcavatorObservationV1, options: ExcavatorAssemblyBuildOptions = {}): AssemblyProposalV1 {
  if (observation.machineType !== 'excavator') throw new Error('ASSEMBLY_UNSUPPORTED_MACHINE: apenas escavadoras são suportadas.');
  const mode = options.mode ?? 'offline';
  const sourceIds = observation.entities.flatMap((entity) => entity.evidence.map((evidence) => evidence.id));
  const parts: AssemblyPart[] = PART_SPECS.map((spec) => {
    const entity = entityFor(observation, spec.entityId);
    const dimensions = partDimensions(observation, spec);
    const partGeometrySource = geometrySource(entity, dimensions);
    const partEvidenceIds = unique([...sourceIds.filter((id) => entity?.evidence.some((evidence) => evidence.id === id)), ...Object.values(dimensions).flatMap((dimension) => dimension.evidenceIds)]);
    return { id: spec.id, role: spec.template.role, libraryKey: spec.template.libraryKey, parentId: partParentId(spec), transform: spec.template.transform, geometrySource: partGeometrySource, dimensions, evidenceIds: partEvidenceIds, provenance: provenanceFor(partGeometrySource, partEvidenceIds, mode, observation.source.kind), review: 'pending' };
  });
  const joints: AssemblyJoint[] = [
    joint(observation, 'joint-swing', 'part-chassis', 'part-house', 'house', 'chassis'),
    joint(observation, 'joint-boom', 'part-house', 'part-boom', 'boom', 'house'),
    joint(observation, 'joint-stick', 'part-boom', 'part-stick', 'stick', 'boom'),
    joint(observation, 'joint-bucket', 'part-stick', 'part-bucket', 'bucket', 'stick'),
  ];
  const actuators: AssemblyActuator[] = [];
  for (const spec of ACTUATOR_SPECS) {
    const entity = entityFor(observation, spec.entityId);
    const body = parts.find((part) => part.id === spec.bodyId)!;
    const stroke = body.dimensions.stroke ?? { value: null, unit: 'unknown', source: 'unknown', evidenceIds: [], requiredForVerification: true };
    const slideJoint: AssemblyJoint = { id: `joint-${spec.key}-cylinder-slide`, type: 'prismatic', parentPartId: spec.bodyId, childPartId: spec.rodId, anchor: [0, 0, 0], axis: [1, 0, 0], source: partSource(entity), evidenceIds: entity?.evidence.map((entry) => entry.id) ?? [`template-${spec.key}-cylinder`], review: 'pending' };
    joints.push(slideJoint);
    actuators.push({ id: `actuator-${spec.key}`, kind: 'hydraulic_cylinder', bodyPartId: spec.bodyId, rodPartId: spec.rodId, jointIds: [spec.parentJoint, slideJoint.id], stroke, source: stroke.source, evidenceIds: unique([...stroke.evidenceIds, ...(entity?.evidence.map((entry) => entry.id) ?? [])]), review: 'pending' });
  }
  const unknowns = unique([...observation.unknowns, ...parts.flatMap((part) => Object.entries(part.dimensions).filter(([, dimension]) => dimension.requiredForVerification && dimension.source === 'unknown').map(([name]) => `Dimensão necessária para verificação: ${part.id}.${name}.`)), ...parts.filter((part) => part.geometrySource === 'template' || part.geometrySource === 'mixed').map((part) => `Geometria de template ainda não confirmada: ${part.id}.`), 'A hierarquia proposta não é uma confirmação de compatibilidade estrutural ou hidráulica.']);
  const hypotheses = [...observation.hypotheses, { id: 'hypothesis-template-geometry', statement: 'Dimensões e transforms sem evidência directa foram preenchidos pelo template e devem ser substituídos ou confirmados pelo utilizador.', evidence: [{ id: 'template-library', kind: 'template' as const, detail: 'Biblioteca paramétrica de escavadora; valores hipotéticos para edição e revisão.' }], confidence: 0.1 }];
  const proposalBase = { schema: ASSEMBLY_PROPOSAL_SCHEMA, proposalId: `proposal-${sha256Hex(canonicalize({ source: observation.source, entities: observation.entities.map((entity) => entity.id), dimensions: observation.dimensions })) .slice(0, 20)}`, machineType: 'excavator' as const, source: { observationSchema: observation.schema, observationId: `observation-${observation.source.sha256?.slice(0, 20) ?? sha256Hex(observation.source.reference).slice(0, 20)}`, kind: observation.source.kind, reference: observation.source.reference }, parts, joints, actuators, modifications: modifications(observation.requests), unknowns, hypotheses, validation: { status: 'review_required' as const, issues: ['Nenhum valor foi promovido a verified.', 'Revisão humana necessária antes de qualquer simulação.'], humanCorrectionItems: unknowns.length + joints.filter((joint) => joint.source !== 'observed').length + actuators.length + observation.requests.length } };
  return validateAssemblyProposal(proposalBase);
}

export function assemblyMetrics(proposal: AssemblyProposalV1): { partRecognition: number; jointConnectivity: number; schemaValid: boolean; humanCorrectionItems: number } {
  const recognized = proposal.parts.filter((part) => part.geometrySource === 'observed' || part.geometrySource === 'mixed').length;
  const connected = proposal.joints.filter((joint) => joint.source === 'observed').length;
  return { partRecognition: proposal.parts.length ? recognized / proposal.parts.length : 0, jointConnectivity: proposal.joints.length ? connected / proposal.joints.length : 0, schemaValid: true, humanCorrectionItems: proposal.validation.humanCorrectionItems };
}

export function supportedLibraryKeys(): string[] { return EXCAVATOR_TEMPLATE_LIBRARY.map((template) => template.libraryKey); }

export function isTemplatePart(part: AssemblyPart): boolean { return part.geometrySource === 'template' || part.geometrySource === 'mixed'; }

export function templatePartKeys(): string[] { return EXCAVATOR_TEMPLATE_LIBRARY.filter((template) => templateFor(template.role, template.libraryKey) !== undefined).map((template) => template.libraryKey); }
