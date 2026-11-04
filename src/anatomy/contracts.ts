import { canonicalize, sha256Hex } from '../core/canonical';

export const ANATOMY_OBSERVATION_SCHEMA = 'unfold.anatomy_observation.v1' as const;
export const ANATOMY_REVIEW_SCHEMA = 'unfold.anatomy_review.v1' as const;
export const ANATOMY_COMPONENTS = [
  'right-atrium', 'left-atrium', 'ventricular-wall', 'right-ventricle', 'left-ventricle',
  'ascending-aorta', 'aortic-arch', 'pulmonary-trunk', 'superior-vena-cava', 'left-coronary', 'right-coronary',
] as const;
export type AnatomyComponentId = typeof ANATOMY_COMPONENTS[number];
export type FindingStatus = 'observed' | 'hypothesis' | 'unknown';
export type AnatomyEvidence = { id: string; kind: 'image_region' | 'label_text'; detail: string; locator: string | null };
export type AnatomyStructure = { id: AnatomyComponentId; label: string; status: FindingStatus; confidence: number; evidence: AnatomyEvidence[] };
export type AnatomyRelation = { id: string; relation: 'contains' | 'connects_to' | 'continues_as' | 'unknown'; from: string; to: string; status: FindingStatus; confidence: number; evidence: AnatomyEvidence[] };
export type AnatomyObservationV1 = {
  schema: typeof ANATOMY_OBSERVATION_SCHEMA;
  observationId: string;
  source: { kind: 'image'; reference: string; sha256: string };
  subjectDisposition: 'heart_illustration' | 'incompatible' | 'uncertain';
  subjectEvidence: AnatomyEvidence[];
  structures: AnatomyStructure[];
  relations: AnatomyRelation[];
  hypotheses: Array<{ id: string; statement: string; confidence: number; evidence: AnatomyEvidence[] }>;
  uncertainties: string[];
  dimensions: [];
  limitations: ['educational_only', 'not_diagnostic', 'not_measured', 'not_photo_reconstruction'];
};

export const ANATOMY_OBSERVATION_JSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['schema', 'subjectDisposition', 'subjectEvidence', 'structures', 'relations', 'hypotheses', 'uncertainties'],
  properties: {
    schema: { const: ANATOMY_OBSERVATION_SCHEMA },
    subjectDisposition: { enum: ['heart_illustration', 'incompatible', 'uncertain'] },
    subjectEvidence: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'object', additionalProperties: false, required: ['id','kind','detail','locator'], properties: { id: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' }, kind: { enum: ['image_region','label_text'] }, detail: { type: 'string', minLength: 1, maxLength: 400 }, locator: { type: ['string','null'], maxLength: 120 } } } },
    structures: { type: 'array', maxItems: 32, items: {
      type: 'object', additionalProperties: false,
      required: ['id', 'label', 'status', 'confidence', 'evidence'],
      properties: {
        id: { enum: ANATOMY_COMPONENTS }, label: { type: 'string', minLength: 1, maxLength: 120 },
        status: { enum: ['observed', 'hypothesis', 'unknown'] }, confidence: { type: 'number', minimum: 0, maximum: 1 },
        evidence: { type: 'array', maxItems: 6, items: {
          type: 'object', additionalProperties: false, required: ['id', 'kind', 'detail', 'locator'],
          properties: { id: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' }, kind: { enum: ['image_region', 'label_text'] }, detail: { type: 'string', minLength: 1, maxLength: 400 }, locator: { type: ['string', 'null'], maxLength: 120 } },
        } },
      },
    } },
    relations: { type: 'array', maxItems: 48, items: {
      type: 'object', additionalProperties: false, required: ['id', 'relation', 'from', 'to', 'status', 'confidence', 'evidence'],
      properties: {
        id: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' }, relation: { enum: ['contains', 'connects_to', 'continues_as', 'unknown'] },
        from: { enum: ANATOMY_COMPONENTS }, to: { enum: ANATOMY_COMPONENTS }, status: { enum: ['observed', 'hypothesis', 'unknown'] }, confidence: { type: 'number', minimum: 0, maximum: 1 },
        evidence: { type: 'array', maxItems: 6, items: {
          type: 'object', additionalProperties: false, required: ['id', 'kind', 'detail', 'locator'],
          properties: { id: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' }, kind: { enum: ['image_region', 'label_text'] }, detail: { type: 'string', minLength: 1, maxLength: 400 }, locator: { type: ['string', 'null'], maxLength: 120 } },
        } },
      },
    } },
    hypotheses: { type: 'array', maxItems: 24, items: {
      type: 'object', additionalProperties: false, required: ['id', 'statement', 'confidence', 'evidence'],
      properties: { id: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' }, statement: { type: 'string', minLength: 1, maxLength: 400 }, confidence: { type: 'number', minimum: 0, maximum: 1 }, evidence: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'object', additionalProperties: false, required: ['id', 'kind', 'detail', 'locator'], properties: { id: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' }, kind: { enum: ['image_region', 'label_text'] }, detail: { type: 'string', minLength: 1, maxLength: 400 }, locator: { type: ['string', 'null'], maxLength: 120 } } } } },
    } },
    uncertainties: { type: 'array', minItems: 1, maxItems: 32, items: { type: 'string', minLength: 1, maxLength: 300 } },
  },
} as const;

export type ReviewDecision = { targetId: string; decision: 'accept' | 'reject' | 'correct'; correctedComponentId: AnatomyComponentId | null; note: string | null };
export type AnatomyReviewV1 = {
  schema: typeof ANATOMY_REVIEW_SCHEMA;
  reviewId: string;
  observationId: string;
  sourceSha256: string;
  actor: { kind: 'client_unverified'; identityVerified: false };
  decisions: ReviewDecision[];
};

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exactKeys = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every((key) => Object.hasOwn(v, key));
const validEvidence = (e: unknown): e is AnatomyEvidence => isRecord(e) && exactKeys(e, ['id','kind','detail','locator']) && typeof e.id === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(e.id) && (e.kind === 'image_region' || e.kind === 'label_text') && typeof e.detail === 'string' && e.detail.length > 0 && e.detail.length <= 400 && (e.locator === null || typeof e.locator === 'string' && e.locator.length <= 120);
const validConfidence = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

export function validateAnatomyObservation(input: unknown): AnatomyObservationV1 {
  if (!isRecord(input) || !exactKeys(input, ['schema','subjectDisposition','subjectEvidence','structures','relations','hypotheses','uncertainties']) || input.schema !== ANATOMY_OBSERVATION_SCHEMA || !['heart_illustration','incompatible','uncertain'].includes(String(input.subjectDisposition)) || !Array.isArray(input.subjectEvidence) || input.subjectEvidence.length < 1 || input.subjectEvidence.length > 4 || !input.subjectEvidence.every(validEvidence)) throw new Error('ANATOMY_SCHEMA_INVALID: envelope');
  const ids = new Set<string>();
  if (!Array.isArray(input.structures) || input.structures.length > 32 || !Array.isArray(input.relations) || input.relations.length > 48 || !Array.isArray(input.hypotheses) || input.hypotheses.length > 24 || !Array.isArray(input.uncertainties) || input.uncertainties.length < 1 || input.uncertainties.length > 32) throw new Error('ANATOMY_SCHEMA_INVALID: collections');
  const structures = input.structures.map((value): AnatomyStructure => {
    if (!isRecord(value) || !exactKeys(value, ['id','label','status','confidence','evidence']) || !ANATOMY_COMPONENTS.includes(value.id as AnatomyComponentId) || typeof value.label !== 'string' || !value.label.trim() || value.label.length > 120 || !['observed','hypothesis','unknown'].includes(String(value.status)) || !validConfidence(value.confidence) || !Array.isArray(value.evidence) || value.evidence.length > 6 || value.status !== 'unknown' && value.evidence.length === 0 || !value.evidence.every(validEvidence)) throw new Error('ANATOMY_SCHEMA_INVALID: structure');
    if (ids.has(String(value.id))) throw new Error('ANATOMY_SCHEMA_INVALID: duplicate structure'); ids.add(String(value.id));
    return { id: value.id as AnatomyComponentId, label: value.label, status: value.status as FindingStatus, confidence: value.confidence as number, evidence: value.evidence as AnatomyEvidence[] };
  });
  const relations = input.relations.map((value): AnatomyRelation => {
    if (!isRecord(value) || !exactKeys(value, ['id','relation','from','to','status','confidence','evidence']) || typeof value.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value.id) || ids.has(value.id) || !['contains','connects_to','continues_as','unknown'].includes(String(value.relation)) || !ids.has(String(value.from)) || !ids.has(String(value.to)) || value.from === value.to || !['observed','hypothesis','unknown'].includes(String(value.status)) || !validConfidence(value.confidence) || !Array.isArray(value.evidence) || value.evidence.length > 6 || value.status !== 'unknown' && value.evidence.length === 0 || !value.evidence.every(validEvidence)) throw new Error('ANATOMY_SCHEMA_INVALID: relation');
    ids.add(value.id);
    return { id: value.id, relation: value.relation as AnatomyRelation['relation'], from: value.from as string, to: value.to as string, status: value.status as FindingStatus, confidence: value.confidence as number, evidence: value.evidence as AnatomyEvidence[] };
  });
  const hypotheses = input.hypotheses.map((value) => {
    if (!isRecord(value) || !exactKeys(value, ['id','statement','confidence','evidence']) || typeof value.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value.id) || ids.has(value.id) || typeof value.statement !== 'string' || !value.statement.trim() || value.statement.length > 400 || !validConfidence(value.confidence) || !Array.isArray(value.evidence) || value.evidence.length < 1 || value.evidence.length > 6 || !value.evidence.every(validEvidence)) throw new Error('ANATOMY_SCHEMA_INVALID: hypothesis');
    ids.add(value.id); return { id: value.id, statement: value.statement, confidence: value.confidence as number, evidence: value.evidence as AnatomyEvidence[] };
  });
  if (!input.uncertainties.every((value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 300)) throw new Error('ANATOMY_SCHEMA_INVALID: uncertainties');
  return { schema: ANATOMY_OBSERVATION_SCHEMA, observationId: sha256Hex(canonicalize(input)).slice(0, 24), source: { kind: 'image', reference: 'unbound', sha256: '0'.repeat(64) }, subjectDisposition: input.subjectDisposition as AnatomyObservationV1['subjectDisposition'], subjectEvidence: input.subjectEvidence as AnatomyEvidence[], structures, relations, hypotheses, uncertainties: input.uncertainties as string[], dimensions: [], limitations: ['educational_only','not_diagnostic','not_measured','not_photo_reconstruction'] };
}

export function bindAnatomySource(observation: AnatomyObservationV1, reference: string, sha256: string): AnatomyObservationV1 {
  if (!/^([a-f0-9]{64})$/.test(sha256) || !reference.trim() || reference.length > 500) throw new Error('ANATOMY_SOURCE_INVALID');
  return { ...observation, source: { kind: 'image', reference, sha256 }, observationId: sha256Hex(`${observation.observationId}:${sha256}`).slice(0, 24) };
}

export function validateBoundAnatomyObservation(input: unknown): AnatomyObservationV1 {
  if (!isRecord(input) || !exactKeys(input, ['schema','observationId','source','subjectDisposition','subjectEvidence','structures','relations','hypotheses','uncertainties','dimensions','limitations']) || !isRecord(input.source) || !exactKeys(input.source, ['kind','reference','sha256']) || input.source.kind !== 'image' || typeof input.source.reference !== 'string' || typeof input.source.sha256 !== 'string' || !Array.isArray(input.dimensions) || input.dimensions.length !== 0 || !Array.isArray(input.limitations) || JSON.stringify(input.limitations) !== JSON.stringify(['educational_only','not_diagnostic','not_measured','not_photo_reconstruction'])) throw new Error('ANATOMY_SOURCE_INVALID: bound envelope');
  const parsed = validateAnatomyObservation({ schema: input.schema, subjectDisposition: input.subjectDisposition, subjectEvidence: input.subjectEvidence, structures: input.structures, relations: input.relations, hypotheses: input.hypotheses, uncertainties: input.uncertainties });
  const bound = bindAnatomySource(parsed, input.source.reference, input.source.sha256);
  if (input.observationId !== bound.observationId) throw new Error('ANATOMY_SOURCE_INVALID: observation id mismatch');
  return bound;
}

export function validateAnatomyReview(input: unknown, observation: AnatomyObservationV1): AnatomyReviewV1 {
  if (!isRecord(input) || !exactKeys(input, ['schema','reviewId','observationId','sourceSha256','actor','decisions']) || input.schema !== ANATOMY_REVIEW_SCHEMA || typeof input.reviewId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(input.reviewId) || input.observationId !== observation.observationId || input.sourceSha256 !== observation.source.sha256 || !isRecord(input.actor) || !exactKeys(input.actor, ['kind','identityVerified']) || input.actor.kind !== 'client_unverified' || input.actor.identityVerified !== false || !Array.isArray(input.decisions)) throw new Error('ANATOMY_REVIEW_INVALID: envelope/source binding');
  const expected = [...observation.structures.map((x) => x.id), ...observation.relations.map((x) => x.id), ...observation.hypotheses.map((x) => x.id)];
  const seen = new Set<string>();
  const decisions = input.decisions.map((d): ReviewDecision => {
    if (!isRecord(d) || !exactKeys(d, ['targetId','decision','correctedComponentId','note']) || typeof d.targetId !== 'string' || !expected.includes(d.targetId) || seen.has(d.targetId) || !['accept','reject','correct'].includes(String(d.decision)) || d.decision === 'correct' && !observation.structures.some((s) => s.id === d.targetId) || (d.correctedComponentId !== null && !ANATOMY_COMPONENTS.includes(d.correctedComponentId as AnatomyComponentId)) || d.decision === 'correct' && d.correctedComponentId === null || d.decision !== 'correct' && d.correctedComponentId !== null || d.note !== null && (typeof d.note !== 'string' || d.note.length > 300)) throw new Error('ANATOMY_REVIEW_INVALID: decision');
    seen.add(d.targetId); return { targetId: d.targetId, decision: d.decision as ReviewDecision['decision'], correctedComponentId: d.correctedComponentId as AnatomyComponentId | null, note: d.note as string | null };
  });
  if (seen.size !== expected.length) throw new Error('ANATOMY_REVIEW_INCOMPLETE');
  return { schema: ANATOMY_REVIEW_SCHEMA, reviewId: input.reviewId, observationId: observation.observationId, sourceSha256: observation.source.sha256, actor: { kind: 'client_unverified', identityVerified: false }, decisions };
}
