import type { SpatialOperationV2, SpatialPlanV2 } from './contracts-v2';

export type SpatialEvaluationV2 = {
  contract: 'unfold.spatial-evaluation.v1';
  recognizabilityScore: number;
  silhouetteScore: number;
  spatialIntegrityScore: number;
  confidence: number;
  discrepancies: Array<{ componentId: string | null; kind: 'missing' | 'misplaced' | 'overlap' | 'proportion' | 'silhouette' | 'surface' | 'other'; severity: 'low' | 'medium' | 'high'; observation: string }>;
  suggestedOperation: Omit<SpatialOperationV2, 'contract' | 'operationId'> | null;
  rationale: string;
};

export const SPATIAL_EVALUATION_V2_JSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['recognizabilityScore', 'silhouetteScore', 'spatialIntegrityScore', 'confidence', 'discrepancies', 'suggestedOperation', 'rationale'],
  properties: {
    recognizabilityScore: { type: 'integer', minimum: 0, maximum: 100 }, silhouetteScore: { type: 'integer', minimum: 0, maximum: 100 }, spatialIntegrityScore: { type: 'integer', minimum: 0, maximum: 100 }, confidence: { type: 'number', minimum: 0, maximum: 1 },
    discrepancies: { type: 'array', maxItems: 12, items: { type: 'object', additionalProperties: false, required: ['componentId', 'kind', 'severity', 'observation'], properties: { componentId: { type: 'string', pattern: '^(|[a-z][a-z0-9-]{0,47})$' }, kind: { type: 'string', enum: ['missing', 'misplaced', 'overlap', 'proportion', 'silhouette', 'surface', 'other'] }, severity: { type: 'string', enum: ['low', 'medium', 'high'] }, observation: { type: 'string', minLength: 1, maxLength: 300 } } } },
    suggestedOperation: { type: 'string', minLength: 4, maxLength: 24_000 },
    rationale: { type: 'string', minLength: 1, maxLength: 600 },
  },
} as const;

function exactKeys(value: object, keys: string[]) { return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }

export function buildSpatialEvaluationV2Prompt(instruction: string, plan: SpatialPlanV2): string {
  const describeGeometry = (node: SpatialPlanV2['components'][number]['geometry']): unknown => node.type === 'shape'
    ? { type: node.type, key: node.key, operator: node.operator, transform: node.transform, repeat: node.repeat }
    : { type: node.type, key: node.key, transform: node.transform, repeat: node.repeat, children: node.children.map(describeGeometry) };
  const compactPlan = {
    title: plan.title,
    units: plan.units,
    presentationProfile: plan.presentationProfile,
    components: plan.components.map(({ id, label, parentId, geometry, transform }) => ({ id, label, parentId, transform, geometry: describeGeometry(geometry) })),
    relations: plan.relations,
    constraints: plan.constraints,
    unknowns: plan.unknowns.slice(0, 12),
  };
  return [
    'Evaluate the supplied rendered THREE-DIMENSIONAL SCENE screenshot against the user intent and the declarative plan.',
    'This is a fallible visual quality hypothesis, not ground truth and not a physical, medical, or engineering validation.',
    'Score recognizability, silhouette, and spatial integrity from 0 to 100 using visible evidence only. A low score is acceptable.',
    'List at most 12 concrete discrepancies. Do not invent hidden details or absolute dimensions. Identify a component only by an existing plan ID.',
    'If one bounded change has a clear chance of improvement, return ONE safe operation as a JSON string against one existing component and stable node key. Do not add a new entity or code. Use JSON text in value. If no high-confidence local improvement exists, the suggestedOperation field must be the string "null".',
    'Preserve scale uncertainty and conceptual provenance. Never claim the scene is a faithful reconstruction or validated simulation.',
    `USER INTENT:\n${instruction.slice(0, 1_200)}`,
    `COMPACT PLAN:\n${JSON.stringify(compactPlan).slice(0, 5_000)}`,
  ].join('\n\n');
}

export function parseSpatialEvaluationV2(value: unknown, plan: SpatialPlanV2): SpatialEvaluationV2 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('SPATIAL_V2_EVALUATION_INVALID');
  const raw = value as Record<string, unknown>;
  const evaluationKeys = ['recognizabilityScore', 'silhouetteScore', 'spatialIntegrityScore', 'confidence', 'discrepancies', 'suggestedOperation', 'rationale'];
  if (!exactKeys(value, Object.hasOwn(raw, 'contract') ? ['contract', ...evaluationKeys] : evaluationKeys) || raw.contract !== undefined && raw.contract !== 'unfold.spatial-evaluation.v1') throw new Error('SPATIAL_V2_EVALUATION_INVALID');
  if (!['recognizabilityScore', 'silhouetteScore', 'spatialIntegrityScore'].every((key) => Number.isInteger(raw[key]) && Number(raw[key]) >= 0 && Number(raw[key]) <= 100) || typeof raw.confidence !== 'number' || !Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1 || !Array.isArray(raw.discrepancies) || raw.discrepancies.length > 12 || typeof raw.rationale !== 'string' || !raw.rationale.trim() || raw.rationale.length > 600) throw new Error('SPATIAL_V2_EVALUATION_INVALID');
  const ids = new Set(plan.components.map((component) => component.id));
  for (const issue of raw.discrepancies as Record<string, unknown>[]) if (!issue || typeof issue !== 'object' || Array.isArray(issue) || !exactKeys(issue, ['componentId', 'kind', 'severity', 'observation']) || issue.componentId !== null && (typeof issue.componentId !== 'string' || !ids.has(issue.componentId)) || !['missing', 'misplaced', 'overlap', 'proportion', 'silhouette', 'surface', 'other'].includes(String(issue.kind)) || !['low', 'medium', 'high'].includes(String(issue.severity)) || typeof issue.observation !== 'string' || !issue.observation.trim() || issue.observation.length > 300) throw new Error('SPATIAL_V2_EVALUATION_INVALID');
  const suggestion = raw.suggestedOperation;
  if (suggestion !== null) {
    if (!suggestion || typeof suggestion !== 'object' || Array.isArray(suggestion)) throw new Error('SPATIAL_V2_EVALUATION_INVALID');
    const operation = suggestion as Record<string, unknown>;
    if (!exactKeys(operation, ['kind', 'componentId', 'nodeKey', 'value']) || !['set-transform', 'set-geometry', 'set-material', 'set-repeat'].includes(String(operation.kind)) || typeof operation.componentId !== 'string' || !ids.has(operation.componentId) || operation.nodeKey !== null && typeof operation.nodeKey !== 'string' || typeof operation.value !== 'string' || operation.value.length > 24_000) throw new Error('SPATIAL_V2_EVALUATION_INVALID');
  }
  return { contract: 'unfold.spatial-evaluation.v1', recognizabilityScore: raw.recognizabilityScore as number, silhouetteScore: raw.silhouetteScore as number, spatialIntegrityScore: raw.spatialIntegrityScore as number, confidence: raw.confidence, discrepancies: raw.discrepancies as SpatialEvaluationV2['discrepancies'], suggestedOperation: suggestion as SpatialEvaluationV2['suggestedOperation'], rationale: raw.rationale };
}
