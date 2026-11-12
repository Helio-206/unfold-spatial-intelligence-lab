import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { MAX_SPATIAL_ENTITIES, type Source, type ValueOrigin } from './contracts';

export const SPATIAL_PLAN_V2_CONTRACT = 'unfold.spatial-plan.v2' as const;
export const MAX_V2_GEOMETRY_NODES = 512;
export const MAX_V2_GEOMETRY_DEPTH = 12;
export const MAX_V2_RENDERED_MESHES = 1_000;
export const MAX_V2_TRIANGLES = 400_000;

export type GeometryTransformV2 = { position: [number, number, number]; rotationRad: [number, number, number]; scale: [number, number, number] };
export type RepeatPatternV2 = { kind: 'radial' | 'linear'; count: number; axis: 'x' | 'y' | 'z'; spacingOrRadius: number };
export type MaterialV2 = {
  profile: 'neutral' | 'industrial' | 'organic' | 'glass' | 'rubber' | 'metal' | 'accent';
  color: string;
  roughness: number;
  metalness: number;
  clearcoat: number;
};
export type GeometryNodeV2 =
  | { type: 'group'; key: string; transform: GeometryTransformV2; repeat: RepeatPatternV2 | null; children: GeometryNodeV2[] }
  | { type: 'shape'; key: string; operator: 'box' | 'rounded_box' | 'sphere' | 'ellipsoid' | 'cylinder' | 'cone' | 'torus' | 'extrude' | 'tube' | 'revolve' | 'loft'; parameters: Record<string, unknown>; transform: GeometryTransformV2; repeat: RepeatPatternV2 | null; material: MaterialV2 };

export type ConstraintV2 = {
  id: string;
  kind: 'coaxial' | 'aligned' | 'attached_at' | 'centered_on' | 'symmetric' | 'parallel' | 'perpendicular' | 'distributed_around' | 'connected_by_curve' | 'maintains_clearance';
  componentIds: string[];
  axis: 'x' | 'y' | 'z' | null;
  tolerance: number;
};
export type SpatialPlanV2 = {
  contract: typeof SPATIAL_PLAN_V2_CONTRACT;
  source: Source;
  title: string;
  units: 'm' | 'unitless';
  presentationProfile: 'neutral' | 'industrial' | 'organic' | 'educational';
  components: Array<{
    id: string;
    label: string;
    parentId: string | null;
    geometry: GeometryNodeV2;
    transform: GeometryTransformV2;
    provenance: { geometry: ValueOrigin; transform: ValueOrigin; material: ValueOrigin; evidence: string };
  }>;
  relations: Array<{ id: string; fromId: string; toId: string; kind: 'attached_to' | 'contains' | 'adjacent_to' | 'aligned_with' | 'connected_to'; origin: ValueOrigin; evidence: string }>;
  constraints: ConstraintV2[];
  unknowns: string[];
};
export type SpatialOperationV2 = {
  contract: 'unfold.spatial-operation.v2';
  operationId: string;
  /**
   * set-* edit one component in place. The structural kinds change WHICH components exist, as one transactional step (preview -> authorisation -> commit, one undo):
   *  add-component    componentId = new id; value = the full component                                   (nothing else changes)
   *  remove-component componentId = the component; value = { children: 'reparent' | 'remove' }          (relations/constraints that mention it go with it)
   *  merge-components componentId = target; value = { sourceIds: string[] }                              (sources' geometry joins the target's; references move to the target)
   *  split-component  componentId = source; value = { newId, label, childKeys: string[] }                (a group's direct children become a new component; both keep their ids/poses)
   * Components not named by the operation keep their ids, geometry, transforms and provenance byte for byte.
   */
  kind: 'set-transform' | 'set-geometry' | 'set-material' | 'set-repeat' | 'add-component' | 'remove-component' | 'merge-components' | 'split-component';
  componentId: string;
  nodeKey: string | null;
  value: unknown;
};

export const MAX_SPATIAL_BATCH_OPERATIONS = 32;
export const SPATIAL_TRANSACTION_CONTRACT = 'unfold.spatial-transaction.v2' as const;
export const SPATIAL_TRANSACTION_RECEIPT_CONTRACT = 'unfold.spatial-transaction-receipt.v1' as const;
export type SpatialTransactionProvenance = { origin: 'user_provided' | 'inferred'; evidence: string };
/**
 * Optional review fence (E1.2): the server revalidates, inside the transaction's critical section,
 * that this exact reviewed state (record, revision, plan fingerprint, source) is still current.
 * Transactions without it keep the original E0 semantics.
 */
export type SpatialReviewPrecondition = { reviewId: string; reviewRevision: number; planFingerprint: string; sourceSha256: string };
/**
 * Structured approval (E1.3): recorded on the transaction receipt by the server, separate from the
 * plan provenance. The actor name is client-asserted and never authenticated; the geometry keeps its
 * own inferred origin. Approval, inference and commit are three independent facts.
 */
export type SpatialApprovalRecord = {
  contract: 'unfold.spatial-approval.v1';
  transactionId: string;
  reviewId: string;
  reviewRevision: number;
  planFingerprint: string;
  sourceSha256: string;
  actor: { displayName: string; authenticated: false; attribution: 'client_asserted_unverified' };
  approvedAt: string;
  commitRevision: number;
};
export type SpatialTransactionV2 = {
  contract: typeof SPATIAL_TRANSACTION_CONTRACT;
  sessionId: string;
  baseRevision: number;
  idempotencyKey: string;
  operations: SpatialOperationV2[];
  provenance: SpatialTransactionProvenance;
  reviewPrecondition?: SpatialReviewPrecondition;
  /** Client-asserted name of the person who authorised this commit (never authenticated). */
  approvalActor?: string;
};
export type SpatialTransactionReceiptV2 = {
  contract: typeof SPATIAL_TRANSACTION_RECEIPT_CONTRACT;
  transactionId: string;
  sessionId: string;
  baseRevision: number;
  revision: number;
  replayed: boolean;
  operationIds: string[];
  plan: SpatialPlanV2;
  reviewPrecondition?: SpatialReviewPrecondition;
  approval?: SpatialApprovalRecord;
  constraintReport?: unknown;
  review: { status: 'applied' | 'undone'; actorEvidence: 'client_asserted_unverified'; authenticatedReviewer: false };
};

const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

/** Validates the envelope of a transaction; each operation is fully validated when applied to the isolated plan copy. */
export function parseSpatialTransactionV2(value: unknown): SpatialTransactionV2 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('SPATIAL_V2_TRANSACTION_INVALID');
  const raw = value as Record<string, unknown>;
  if (!keysAre(raw, ['contract', 'sessionId', 'baseRevision', 'idempotencyKey', 'operations', 'provenance', ...(Object.hasOwn(raw, 'reviewPrecondition') ? ['reviewPrecondition'] : []), ...(Object.hasOwn(raw, 'approvalActor') ? ['approvalActor'] : [])]) || raw.contract !== SPATIAL_TRANSACTION_CONTRACT) fail('SPATIAL_V2_TRANSACTION_INVALID');
  if (raw.approvalActor !== undefined && (typeof raw.approvalActor !== 'string' || !raw.approvalActor.trim() || raw.approvalActor.length > 80)) fail('SPATIAL_V2_TRANSACTION_APPROVAL_ACTOR_INVALID');
  if (raw.reviewPrecondition !== undefined) {
    const fence = raw.reviewPrecondition as Record<string, unknown>;
    if (!fence || typeof fence !== 'object' || Array.isArray(fence) || !keysAre(fence, ['reviewId', 'reviewRevision', 'planFingerprint', 'sourceSha256']) || typeof fence.reviewId !== 'string' || !fence.reviewId || fence.reviewId.length > 80 || !Number.isSafeInteger(fence.reviewRevision) || Number(fence.reviewRevision) < 0 || typeof fence.planFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(fence.planFingerprint) || typeof fence.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(fence.sourceSha256)) fail('SPATIAL_V2_TRANSACTION_REVIEW_PRECONDITION_INVALID');
  }
  if (typeof raw.sessionId !== 'string' || !raw.sessionId || !Number.isSafeInteger(raw.baseRevision) || Number(raw.baseRevision) < 0) fail('SPATIAL_V2_TRANSACTION_INVALID');
  if (typeof raw.idempotencyKey !== 'string' || !IDEMPOTENCY_KEY.test(raw.idempotencyKey)) fail('SPATIAL_V2_TRANSACTION_IDEMPOTENCY_KEY_INVALID');
  if (!Array.isArray(raw.operations) || raw.operations.length < 1 || raw.operations.length > MAX_SPATIAL_BATCH_OPERATIONS) fail('SPATIAL_V2_TRANSACTION_OPERATIONS_INVALID');
  const ids = new Set<string>();
  for (const operation of raw.operations as Array<Record<string, unknown>>) {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation) || operation.contract !== 'unfold.spatial-operation.v2' || typeof operation.operationId !== 'string' || ids.has(operation.operationId as string)) fail('SPATIAL_V2_TRANSACTION_OPERATIONS_INVALID');
    ids.add(operation.operationId as string);
  }
  const provenance = raw.provenance as SpatialTransactionProvenance;
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance) || !keysAre(provenance, ['origin', 'evidence']) || !['user_provided', 'inferred'].includes(provenance.origin) || typeof provenance.evidence !== 'string' || !provenance.evidence.trim() || provenance.evidence.length > 500) fail('SPATIAL_V2_TRANSACTION_PROVENANCE_INVALID');
  return raw as unknown as SpatialTransactionV2;
}

export function isValidIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string' && IDEMPOTENCY_KEY.test(value);
}

const ORIGINS = new Set<ValueOrigin>(['observed', 'inferred', 'user_provided', 'design_approximation', 'unknown']);
const ID = /^[a-z][a-z0-9-]{0,47}$/;
const keysAre = (value: object, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const fail = (code: string): never => { throw new Error(code); };
const vector = (value: unknown, maxAbs = 1_000): value is [number, number, number] => Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= maxAbs);

export const SPATIAL_PLAN_V2_JSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['title', 'units', 'presentationProfile', 'components', 'relations', 'constraints', 'unknowns'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 120 }, units: { type: 'string', enum: ['m', 'unitless'] },
    presentationProfile: { type: 'string', enum: ['neutral', 'industrial', 'organic', 'educational'] },
    components: { type: 'array', minItems: 1, maxItems: MAX_SPATIAL_ENTITIES, items: {
      type: 'object', additionalProperties: false, required: ['id', 'label', 'parentId', 'geometry', 'transform', 'provenance'], properties: {
        id: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,47}$' }, label: { type: 'string', minLength: 1, maxLength: 100 }, parentId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        geometry: { $ref: '#/$defs/node' },
        transform: { $ref: '#/$defs/transform' },
        provenance: { type: 'object', additionalProperties: false, required: ['geometry', 'transform', 'material', 'evidence'], properties: { geometry: { type: 'string', enum: ['observed', 'inferred', 'user_provided', 'design_approximation', 'unknown'] }, transform: { type: 'string', enum: ['observed', 'inferred', 'user_provided', 'design_approximation', 'unknown'] }, material: { type: 'string', enum: ['observed', 'inferred', 'user_provided', 'design_approximation', 'unknown'] }, evidence: { type: 'string', maxLength: 500 } } },
      },
    } },
    relations: { type: 'array', maxItems: 200, items: { type: 'object', additionalProperties: false, required: ['id', 'fromId', 'toId', 'kind', 'origin', 'evidence'], properties: { id: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,47}$' }, fromId: { type: 'string', minLength: 1, maxLength: 48 }, toId: { type: 'string', minLength: 1, maxLength: 48 }, kind: { type: 'string', enum: ['attached_to', 'contains', 'adjacent_to', 'aligned_with', 'connected_to'] }, origin: { type: 'string', enum: ['observed', 'inferred', 'user_provided', 'design_approximation', 'unknown'] }, evidence: { type: 'string', maxLength: 500 } } } },
    constraints: { type: 'array', maxItems: 200, items: { type: 'object', additionalProperties: false, required: ['id', 'kind', 'componentIds', 'axis', 'tolerance'], properties: { id: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,47}$' }, kind: { type: 'string', enum: ['coaxial', 'aligned', 'attached_at', 'centered_on', 'symmetric', 'parallel', 'perpendicular', 'distributed_around', 'connected_by_curve', 'maintains_clearance'] }, componentIds: { type: 'array', minItems: 2, maxItems: 4, items: { type: 'string', minLength: 1, maxLength: 48 } }, axis: { anyOf: [{ type: 'string', enum: ['x', 'y', 'z'] }, { type: 'null' }] }, tolerance: { type: 'number', exclusiveMinimum: 0, maximum: 100 } } } },
    unknowns: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 300 } },
  },
  $defs: {
    transform: { type: 'object', additionalProperties: false, required: ['position', 'rotationRad', 'scale'], properties: { position: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } }, rotationRad: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } }, scale: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } } } },
    repeat: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false, required: ['kind', 'count', 'axis', 'spacingOrRadius'], properties: { kind: { type: 'string', enum: ['radial', 'linear'] }, count: { type: 'integer', minimum: 2, maximum: 64 }, axis: { type: 'string', enum: ['x', 'y', 'z'] }, spacingOrRadius: { type: 'number', exclusiveMinimum: 0, maximum: 100 } } }] },
    material: { type: 'object', additionalProperties: false, required: ['profile', 'color', 'roughness', 'metalness', 'clearcoat'], properties: { profile: { type: 'string', enum: ['neutral', 'industrial', 'organic', 'glass', 'rubber', 'metal', 'accent'] }, color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }, roughness: { type: 'number', minimum: 0, maximum: 1 }, metalness: { type: 'number', minimum: 0, maximum: 1 }, clearcoat: { type: 'number', minimum: 0, maximum: 1 } } },
    node: { anyOf: [
      { type: 'object', additionalProperties: false, required: ['type', 'key', 'transform', 'repeat', 'children'], properties: { type: { const: 'group' }, key: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,47}$' }, transform: { $ref: '#/$defs/transform' }, repeat: { $ref: '#/$defs/repeat' }, children: { type: 'array', minItems: 1, maxItems: 16, items: { $ref: '#/$defs/node2' } } } },
      { $ref: '#/$defs/shapeNode' },
    ] },
    node2: { anyOf: [
      { type: 'object', additionalProperties: false, required: ['type', 'key', 'transform', 'repeat', 'children'], properties: { type: { const: 'group' }, key: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,47}$' }, transform: { $ref: '#/$defs/transform' }, repeat: { $ref: '#/$defs/repeat' }, children: { type: 'array', minItems: 1, maxItems: 16, items: { $ref: '#/$defs/shapeNode' } } } },
      { $ref: '#/$defs/shapeNode' },
    ] },
    shapeNode: { type: 'object', additionalProperties: false, required: ['type', 'key', 'operator', 'parameters', 'transform', 'repeat', 'material'], properties: { type: { const: 'shape' }, key: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,47}$' }, operator: { type: 'string', enum: ['box', 'rounded_box', 'sphere', 'ellipsoid', 'cylinder', 'cone', 'torus', 'extrude', 'tube', 'revolve', 'loft'] }, parameters: { $ref: '#/$defs/parameters' }, transform: { $ref: '#/$defs/transform' }, repeat: { $ref: '#/$defs/repeat' }, material: { $ref: '#/$defs/material' } } },
    parameters: { anyOf: [
      { type: 'object', additionalProperties: false, required: ['dimensions'], properties: { dimensions: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number', exclusiveMinimum: 0 } } } },
      { type: 'object', additionalProperties: false, required: ['dimensions', 'bevelM', 'segments'], properties: { dimensions: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number', exclusiveMinimum: 0 } }, bevelM: { type: 'number', minimum: 0 }, segments: { type: 'integer', minimum: 1, maximum: 8 } } },
      { type: 'object', additionalProperties: false, required: ['radius', 'widthSegments', 'heightSegments'], properties: { radius: { type: 'number', exclusiveMinimum: 0 }, widthSegments: { type: 'integer', minimum: 8, maximum: 128 }, heightSegments: { type: 'integer', minimum: 6, maximum: 64 } } },
      { type: 'object', additionalProperties: false, required: ['radii', 'widthSegments', 'heightSegments'], properties: { radii: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number', exclusiveMinimum: 0 } }, widthSegments: { type: 'integer', minimum: 8, maximum: 128 }, heightSegments: { type: 'integer', minimum: 6, maximum: 64 } } },
      { type: 'object', additionalProperties: false, required: ['radiusTop', 'radiusBottom', 'height', 'radialSegments'], properties: { radiusTop: { type: 'number', exclusiveMinimum: 0 }, radiusBottom: { type: 'number', exclusiveMinimum: 0 }, height: { type: 'number', exclusiveMinimum: 0 }, radialSegments: { type: 'integer', minimum: 8, maximum: 128 } } },
      { type: 'object', additionalProperties: false, required: ['radius', 'height', 'radialSegments'], properties: { radius: { type: 'number', exclusiveMinimum: 0 }, height: { type: 'number', exclusiveMinimum: 0 }, radialSegments: { type: 'integer', minimum: 8, maximum: 128 } } },
      { type: 'object', additionalProperties: false, required: ['majorRadius', 'tubeRadius', 'radialSegments', 'tubularSegments'], properties: { majorRadius: { type: 'number', exclusiveMinimum: 0 }, tubeRadius: { type: 'number', exclusiveMinimum: 0 }, radialSegments: { type: 'integer', minimum: 8, maximum: 128 }, tubularSegments: { type: 'integer', minimum: 8, maximum: 256 } } },
      { type: 'object', additionalProperties: false, required: ['profile', 'depth', 'bevelM', 'curveSegments'], properties: { profile: { type: 'array', minItems: 3, maxItems: 128, items: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } } }, depth: { type: 'number', exclusiveMinimum: 0 }, bevelM: { type: 'number', minimum: 0 }, curveSegments: { type: 'integer', minimum: 1, maximum: 32 } } },
      { type: 'object', additionalProperties: false, required: ['points', 'radius', 'tubularSegments', 'radialSegments'], properties: { points: { type: 'array', minItems: 2, maxItems: 64, items: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } } }, radius: { type: 'number', exclusiveMinimum: 0 }, tubularSegments: { type: 'integer', minimum: 8, maximum: 512 }, radialSegments: { type: 'integer', minimum: 6, maximum: 64 } } },
      { type: 'object', additionalProperties: false, required: ['profile', 'segments'], properties: { profile: { type: 'array', minItems: 2, maxItems: 128, items: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } } }, segments: { type: 'integer', minimum: 8, maximum: 128 } } },
      { type: 'object', additionalProperties: false, required: ['profile', 'sections', 'capEnds'], properties: { profile: { type: 'array', minItems: 3, maxItems: 128, items: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } } }, sections: { type: 'array', minItems: 2, maxItems: 64, items: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } } }, capEnds: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'boolean' } } } },
    ] },
  },
} as const;

// Meta's structured-output service rejects recursive schemas and enforces a shallow nesting cap.
// Keep its envelope bounded and serialize operator parameters as JSON text; hydrate and fully
// validate them locally before any geometry is compiled.
const metaShape = { type: 'object', additionalProperties: false, required: ['type', 'key', 'operator', 'parameters', 'transform', 'repeat', 'material'], properties: { type: { const: 'shape' }, key: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,47}$' }, operator: { type: 'string', enum: ['box', 'rounded_box', 'sphere', 'ellipsoid', 'cylinder', 'cone', 'torus', 'extrude', 'tube', 'revolve', 'loft'] }, parameters: { type: 'string', minLength: 2, maxLength: 12_000 }, transform: { type: 'string', minLength: 2, maxLength: 512 }, repeat: { type: 'string', minLength: 2, maxLength: 256 }, material: { type: 'string', minLength: 2, maxLength: 256 } } };
const metaGeometry = { anyOf: [metaShape, { type: 'object', additionalProperties: false, required: ['type', 'key', 'transform', 'repeat', 'children'], properties: { type: { const: 'group' }, key: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,47}$' }, transform: { type: 'string', minLength: 2, maxLength: 512 }, repeat: { type: 'string', minLength: 2, maxLength: 256 }, children: { type: 'array', minItems: 1, maxItems: 16, items: metaShape } } }] };
export const SPATIAL_PLAN_V2_META_JSON_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['title', 'units', 'presentationProfile', 'components', 'relations', 'constraints', 'unknowns'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 120 }, units: { type: 'string', enum: ['m', 'unitless'] }, presentationProfile: { type: 'string', enum: ['neutral', 'industrial', 'organic', 'educational'] },
    components: { type: 'array', minItems: 1, maxItems: MAX_SPATIAL_ENTITIES, items: { type: 'object', additionalProperties: false, required: ['id', 'label', 'parentId', 'geometry', 'transform', 'provenance'], properties: { id: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,47}$' }, label: { type: 'string', minLength: 1, maxLength: 100 }, parentId: { anyOf: [{ type: 'string' }, { type: 'null' }] }, geometry: metaGeometry, transform: { type: 'string', minLength: 2, maxLength: 512 }, provenance: { type: 'object', additionalProperties: false, required: ['geometry', 'transform', 'material', 'evidence'], properties: { geometry: { type: 'string', enum: ['observed', 'inferred', 'user_provided', 'design_approximation', 'unknown'] }, transform: { type: 'string', enum: ['observed', 'inferred', 'user_provided', 'design_approximation', 'unknown'] }, material: { type: 'string', enum: ['observed', 'inferred', 'user_provided', 'design_approximation', 'unknown'] }, evidence: { type: 'string', maxLength: 500 } } } } } },
    relations: { type: 'array', maxItems: 200, items: { type: 'object', additionalProperties: false, required: ['id', 'fromId', 'toId', 'kind', 'origin', 'evidence'], properties: { id: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,47}$' }, fromId: { type: 'string', minLength: 1, maxLength: 48 }, toId: { type: 'string', minLength: 1, maxLength: 48 }, kind: { type: 'string', enum: ['attached_to', 'contains', 'adjacent_to', 'aligned_with', 'connected_to'] }, origin: { type: 'string', enum: ['observed', 'inferred', 'user_provided', 'design_approximation', 'unknown'] }, evidence: { type: 'string', maxLength: 500 } } } },
    constraints: { type: 'array', maxItems: 200, items: { type: 'object', additionalProperties: false, required: ['id', 'kind', 'componentIds', 'axis', 'tolerance'], properties: { id: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,47}$' }, kind: { type: 'string', enum: ['coaxial', 'aligned', 'attached_at', 'centered_on', 'symmetric', 'parallel', 'perpendicular', 'distributed_around', 'connected_by_curve', 'maintains_clearance'] }, componentIds: { type: 'array', minItems: 2, maxItems: 4, items: { type: 'string', minLength: 1, maxLength: 48 } }, axis: { anyOf: [{ type: 'string', enum: ['x', 'y', 'z'] }, { type: 'null' }] }, tolerance: { type: 'number', exclusiveMinimum: 0, maximum: 100 } } } },
    unknowns: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 300 } },
  },
} as const;

export const SPATIAL_OPERATION_V2_JSON_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['kind', 'componentId', 'nodeKey', 'value'],
  properties: { kind: { type: 'string', enum: ['set-transform', 'set-geometry', 'set-material', 'set-repeat'] }, componentId: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,47}$' }, nodeKey: { anyOf: [{ type: 'string', pattern: '^[a-z][a-z0-9-]{0,47}$' }, { type: 'null' }] }, value: { type: 'string', minLength: 2, maxLength: 24_000 } },
} as const;

const TRANSFORM_KEYS = ['position', 'rotationRad', 'scale'] as const;
const GEOMETRY_KEYS = new Set(['box', 'rounded_box', 'sphere', 'ellipsoid', 'cylinder', 'cone', 'torus', 'extrude', 'tube', 'revolve', 'loft']);
const MATERIAL_PROFILES = new Set(['neutral', 'industrial', 'organic', 'glass', 'rubber', 'metal', 'accent']);

function validateTransform(value: unknown, path: string): asserts value is GeometryTransformV2 {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !keysAre(value, TRANSFORM_KEYS)) fail(`SPATIAL_V2_TRANSFORM_INVALID:${path}`);
  const t = value as GeometryTransformV2;
  if (!vector(t.position) || !vector(t.rotationRad, 50 * Math.PI) || !vector(t.scale, 100) || t.scale.some((n) => n <= 0)) fail(`SPATIAL_V2_TRANSFORM_INVALID:${path}`);
}

function validateMaterial(value: unknown, path: string): asserts value is MaterialV2 {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !keysAre(value, ['profile', 'color', 'roughness', 'metalness', 'clearcoat'])) fail(`SPATIAL_V2_MATERIAL_INVALID:${path}`);
  const m = value as MaterialV2;
  if (!MATERIAL_PROFILES.has(m.profile) || typeof m.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(m.color) || ![m.roughness, m.metalness, m.clearcoat].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)) fail(`SPATIAL_V2_MATERIAL_INVALID:${path}`);
}

function positive(values: unknown[], path: string, max = 1_000): void {
  if (!values.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= max)) fail(`SPATIAL_V2_PARAMETERS_INVALID:${path}`);
}

/** The exact parameter keys of each operator: the single source for validation and for the generation guidance. */
export const SHAPE_PARAMETER_KEYS: Readonly<Record<string, readonly string[]>> = {
  box: ['dimensions'], rounded_box: ['dimensions', 'bevelM', 'segments'], sphere: ['radius', 'widthSegments', 'heightSegments'], ellipsoid: ['radii', 'widthSegments', 'heightSegments'],
  cylinder: ['radiusTop', 'radiusBottom', 'height', 'radialSegments'], cone: ['radius', 'height', 'radialSegments'], torus: ['majorRadius', 'tubeRadius', 'radialSegments', 'tubularSegments'],
  extrude: ['profile', 'depth', 'bevelM', 'curveSegments'], tube: ['points', 'radius', 'tubularSegments', 'radialSegments'], revolve: ['profile', 'segments'],
  loft: ['profile', 'sections', 'capEnds'],
};

function validateParameters(operator: string, raw: Record<string, unknown>, path: string): void {
  const expected = SHAPE_PARAMETER_KEYS[operator];
  if (!expected || !keysAre(raw, expected)) fail(`SPATIAL_V2_PARAMETERS_INVALID:${path}`);
  const p = raw as Record<string, unknown>;
  const points = (name: string, min: number, max: number, dimensions = 2) => {
    const value = p[name];
    if (!Array.isArray(value) || value.length < min || value.length > max || !value.every((point) => Array.isArray(point) && point.length === dimensions && point.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1_000))) fail(`SPATIAL_V2_PARAMETERS_INVALID:${path}.${name}`);
  };
  if (operator === 'box' || operator === 'rounded_box') {
    if (!vector(p.dimensions)) fail(`SPATIAL_V2_PARAMETERS_INVALID:${path}.dimensions`); const dimensions = p.dimensions as number[]; positive(dimensions, path);
    if (operator === 'rounded_box' && (typeof p.bevelM !== 'number' || !Number.isFinite(p.bevelM) || p.bevelM < 0 || p.bevelM > Math.min(...dimensions) / 2 || !Number.isInteger(p.segments) || Number(p.segments) < 1 || Number(p.segments) > 8)) fail(`SPATIAL_V2_PARAMETERS_INVALID:${path}.bevelM`);
  } else if (operator === 'sphere') {
    positive([p.radius], path); if (!Number.isInteger(p.widthSegments) || Number(p.widthSegments) < 8 || Number(p.widthSegments) > 128 || !Number.isInteger(p.heightSegments) || Number(p.heightSegments) < 6 || Number(p.heightSegments) > 64) fail(`SPATIAL_V2_PARAMETERS_INVALID:${path}.segments`);
  } else if (operator === 'ellipsoid') {
    if (!vector(p.radii)) fail(`SPATIAL_V2_PARAMETERS_INVALID:${path}.radii`); positive(p.radii as number[], path); if (!Number.isInteger(p.widthSegments) || Number(p.widthSegments) < 8 || Number(p.widthSegments) > 128 || !Number.isInteger(p.heightSegments) || Number(p.heightSegments) < 6 || Number(p.heightSegments) > 64) fail(`SPATIAL_V2_PARAMETERS_INVALID:${path}.segments`);
  } else if (operator === 'cylinder') {
    positive([p.radiusTop, p.radiusBottom, p.height], path); if (!Number.isInteger(p.radialSegments) || Number(p.radialSegments) < 8 || Number(p.radialSegments) > 128) fail(`SPATIAL_V2_PARAMETERS_INVALID:${path}.radialSegments`);
  } else if (operator === 'cone') {
    positive([p.radius, p.height], path); if (!Number.isInteger(p.radialSegments) || Number(p.radialSegments) < 8 || Number(p.radialSegments) > 128) fail(`SPATIAL_V2_PARAMETERS_INVALID:${path}.radialSegments`);
  } else if (operator === 'torus') {
    positive([p.majorRadius, p.tubeRadius], path); if (Number(p.tubeRadius) >= Number(p.majorRadius) || !Number.isInteger(p.radialSegments) || Number(p.radialSegments) < 8 || Number(p.radialSegments) > 128 || !Number.isInteger(p.tubularSegments) || Number(p.tubularSegments) < 8 || Number(p.tubularSegments) > 256) fail(`SPATIAL_V2_PARAMETERS_INVALID:${path}.torus`);
  } else if (operator === 'extrude') {
    points('profile', 3, 128); positive([p.depth], path); if (typeof p.bevelM !== 'number' || !Number.isFinite(p.bevelM) || p.bevelM < 0 || p.bevelM > Number(p.depth) / 2 || !Number.isInteger(p.curveSegments) || Number(p.curveSegments) < 1 || Number(p.curveSegments) > 32 || !simplePolygon(p.profile as [number, number][])) fail(`SPATIAL_V2_PARAMETERS_INVALID:${path}.profile`);
  } else if (operator === 'tube') {
    points('points', 2, 64, 3); positive([p.radius], path); if (!Number.isInteger(p.tubularSegments) || Number(p.tubularSegments) < 8 || Number(p.tubularSegments) > 512 || !Number.isInteger(p.radialSegments) || Number(p.radialSegments) < 6 || Number(p.radialSegments) > 64) fail(`SPATIAL_V2_PARAMETERS_INVALID:${path}.tube`);
  } else if (operator === 'revolve') {
    points('profile', 2, 128); if (!Number.isInteger(p.segments) || Number(p.segments) < 8 || Number(p.segments) > 128 || !(p.profile as number[][]).every((point) => point[0]! >= 0)) fail(`SPATIAL_V2_PARAMETERS_INVALID:${path}.profile`);
  } else {
    points('profile', 3, 128); points('sections', 2, 64, 3);
    if (!(p.sections as number[][]).every((section) => section[0]! >= -1_000 && section[0]! <= 1_000 && section[1]! > 0 && section[1]! <= 1_000 && section[2]! > 0 && section[2]! <= 1_000) || !Array.isArray(p.capEnds) || p.capEnds.length !== 2 || !p.capEnds.every((flag) => typeof flag === 'boolean') || !simplePolygon(p.profile as [number, number][])) fail(`SPATIAL_V2_PARAMETERS_INVALID:${path}.sections`);
  }
}

/** True when `parameters` satisfy the operator's exact contract. Used by repair code to prove a repaired shape is valid without throwing. */
export function isValidShapeParametersV2(operator: string, parameters: unknown): boolean {
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) return false;
  try { validateParameters(operator, parameters as Record<string, unknown>, 'repair'); return true; } catch { return false; }
}

function cross(a: number[], b: number[], c: number[]) { return (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!); }
function segmentsIntersect(a: number[], b: number[], c: number[], d: number[]): boolean {
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  return (abC > 1e-9 && abD < -1e-9 || abC < -1e-9 && abD > 1e-9) && (cdA > 1e-9 && cdB < -1e-9 || cdA < -1e-9 && cdB > 1e-9);
}
function simplePolygon(points: number[][]): boolean {
  if (points.length < 3 || points.some((p) => !Array.isArray(p) || p.length !== 2 || !p.every((n) => Number.isFinite(n) && Math.abs(n) <= 1_000))) return false;
  let area = 0; for (let i = 0; i < points.length; i++) { const a = points[i]!, b = points[(i + 1) % points.length]!; area += a[0]! * b[1]! - b[0]! * a[1]!; }
  if (Math.abs(area) < 1e-8) return false;
  for (let a = 0; a < points.length; a++) for (let b = a + 1; b < points.length; b++) {
    if (b === a || b === (a + 1) % points.length || a === (b + 1) % points.length) continue;
    if (segmentsIntersect(points[a]!, points[(a + 1) % points.length]!, points[b]!, points[(b + 1) % points.length]!)) return false;
  }
  return true;
}

function validateNode(value: unknown, counters: { nodes: number }, depth: number, path: string, keys: Set<string>): asserts value is GeometryNodeV2 {
  counters.nodes++;
  if (counters.nodes > MAX_V2_GEOMETRY_NODES) fail('SPATIAL_V2_GEOMETRY_NODE_BUDGET');
  if (depth > MAX_V2_GEOMETRY_DEPTH) fail('SPATIAL_V2_GEOMETRY_TOO_DEEP');
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`SPATIAL_V2_NODE_INVALID:${path}`);
  const node = value as Record<string, unknown>;
  if (node.type === 'group') {
    if (!keysAre(node, ['type', 'key', 'transform', 'repeat', 'children']) || typeof node.key !== 'string' || !ID.test(node.key) || keys.has(node.key) || !Array.isArray(node.children) || node.children.length < 1 || node.children.length > 64) fail(`SPATIAL_V2_GROUP_INVALID:${path}`);
    const key = node.key as string, children = node.children as unknown[];
    keys.add(key); validateTransform(node.transform, path); validateRepeat(node.repeat, path); for (const [index, child] of children.entries()) validateNode(child, counters, depth + 1, `${path}.children.${index}`, keys);
    return;
  }
  if (node.type !== 'shape' || !keysAre(node, ['type', 'key', 'operator', 'parameters', 'transform', 'repeat', 'material']) || typeof node.key !== 'string' || !ID.test(node.key) || keys.has(node.key) || typeof node.operator !== 'string' || !GEOMETRY_KEYS.has(node.operator) || !node.parameters || typeof node.parameters !== 'object' || Array.isArray(node.parameters)) fail(`SPATIAL_V2_SHAPE_INVALID:${path}`);
  const key = node.key as string, operator = node.operator as string;
  keys.add(key); validateTransform(node.transform, path); validateRepeat(node.repeat, path); validateMaterial(node.material, path); validateParameters(operator, node.parameters as Record<string, unknown>, path);
}

function validateRepeat(value: unknown, path: string): asserts value is RepeatPatternV2 | null {
  if (value === null) return;
  if (!value || typeof value !== 'object' || Array.isArray(value) || !keysAre(value, ['kind', 'count', 'axis', 'spacingOrRadius'])) fail(`SPATIAL_V2_REPEAT_INVALID:${path}`);
  const repeat = value as RepeatPatternV2;
  if (!['radial', 'linear'].includes(repeat.kind) || !Number.isInteger(repeat.count) || repeat.count < 2 || repeat.count > 64 || !['x', 'y', 'z'].includes(repeat.axis) || !Number.isFinite(repeat.spacingOrRadius) || repeat.spacingOrRadius <= 0 || repeat.spacingOrRadius > 100) fail(`SPATIAL_V2_REPEAT_INVALID:${path}`);
}

function sourceValid(value: unknown): value is Source {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && keysAre(value, ['kind', 'sha256']) && ['text', 'image'].includes((value as Source).kind) && /^[a-f0-9]{64}$/.test((value as Source).sha256));
}

export function validateSpatialPlanV2(value: unknown, source?: Source): SpatialPlanV2 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('SPATIAL_V2_PLAN_INVALID_OBJECT');
  const raw = value as Record<string, unknown>;
  if (!keysAre(raw, ['title', 'units', 'presentationProfile', 'components', 'relations', 'constraints', 'unknowns', ...(Object.hasOwn(raw, 'contract') ? ['contract'] : []), ...(Object.hasOwn(raw, 'source') ? ['source'] : [])])) fail('SPATIAL_V2_PLAN_INVALID_FIELDS');
  if (raw.contract !== undefined && raw.contract !== SPATIAL_PLAN_V2_CONTRACT) fail('SPATIAL_V2_CONTRACT_INVALID');
  const resolvedSource = source ?? raw.source;
  if (!sourceValid(resolvedSource)) fail('SPATIAL_V2_SOURCE_INVALID');
  if (typeof raw.title !== 'string' || !raw.title.trim() || raw.title.length > 120 || !['m', 'unitless'].includes(String(raw.units)) || !['neutral', 'industrial', 'organic', 'educational'].includes(String(raw.presentationProfile)) || !Array.isArray(raw.components) || raw.components.length < 1 || raw.components.length > MAX_SPATIAL_ENTITIES || !Array.isArray(raw.relations) || raw.relations.length > 200 || !Array.isArray(raw.constraints) || raw.constraints.length > 200 || !Array.isArray(raw.unknowns) || raw.unknowns.length > 100 || !raw.unknowns.every((item) => typeof item === 'string' && item.length <= 300)) fail('SPATIAL_V2_PLAN_INVALID_FIELDS');
  const componentIds = new Set<string>(), geometryIds = new Set<string>(), componentById = new Map<string, SpatialPlanV2['components'][number]>();
  let nodes = 0, meshes = 0, triangles = 0;
  for (const component of raw.components as Record<string, unknown>[]) {
    if (!component || typeof component !== 'object' || Array.isArray(component) || !keysAre(component, ['id', 'label', 'parentId', 'geometry', 'transform', 'provenance']) || typeof component.id !== 'string' || !ID.test(component.id) || componentIds.has(component.id) || geometryIds.has(component.id) || typeof component.label !== 'string' || !component.label.trim() || component.label.length > 100 || component.parentId !== null && typeof component.parentId !== 'string') fail('SPATIAL_V2_COMPONENT_INVALID');
    const componentId = component.id as string;
    validateTransform(component.transform, componentId);
    const prov = component.provenance;
    if (!prov || typeof prov !== 'object' || Array.isArray(prov) || !keysAre(prov, ['geometry', 'transform', 'material', 'evidence']) || !ORIGINS.has((prov as SpatialPlanV2['components'][number]['provenance']).geometry) || !ORIGINS.has((prov as SpatialPlanV2['components'][number]['provenance']).transform) || !ORIGINS.has((prov as SpatialPlanV2['components'][number]['provenance']).material) || typeof (prov as SpatialPlanV2['components'][number]['provenance']).evidence !== 'string' || (prov as SpatialPlanV2['components'][number]['provenance']).evidence.length > 500) fail('SPATIAL_V2_PROVENANCE_INVALID');
    const componentKeys = new Set<string>(); validateNode(component.geometry, { get nodes() { return nodes; }, set nodes(value: number) { nodes = value; } }, 1, componentId, componentKeys);
    if (componentKeys.has(componentId)) fail(`SPATIAL_V2_DUPLICATE_GEOMETRY_KEY:${componentId}`);
    componentKeys.forEach((key) => { if (componentIds.has(key) || geometryIds.has(key)) fail(`SPATIAL_V2_DUPLICATE_GEOMETRY_KEY:${key}`); geometryIds.add(key); });
    const normalized = component as unknown as SpatialPlanV2['components'][number];
    componentIds.add(normalized.id); componentById.set(normalized.id, normalized);
    meshes += renderedMeshCount(normalized.geometry);
    triangles += estimatedTriangles(normalized.geometry);
  }
  if (meshes > MAX_V2_RENDERED_MESHES || nodes > MAX_V2_GEOMETRY_NODES) fail('SPATIAL_V2_RENDER_BUDGET_EXCEEDED');
  if (triangles > MAX_V2_TRIANGLES) fail('SPATIAL_V2_TRIANGLE_BUDGET_EXCEEDED');
  for (const component of componentById.values()) if (component.parentId !== null && (!componentIds.has(component.parentId) || component.parentId === component.id)) fail(`SPATIAL_V2_PARENT_INVALID:${component.id}`);
  for (const component of componentById.values()) { let parent = component.parentId, depth = 0; const seen = new Set([component.id]); while (parent !== null) { if (seen.has(parent)) fail('SPATIAL_V2_PARENT_CYCLE'); seen.add(parent); if (++depth > 16) fail('SPATIAL_V2_HIERARCHY_TOO_DEEP'); parent = componentById.get(parent)!.parentId; } }
  const relationIds = new Set<string>();
  for (const relation of raw.relations as Record<string, unknown>[]) {
    if (!relation || typeof relation !== 'object' || Array.isArray(relation) || !keysAre(relation, ['id', 'fromId', 'toId', 'kind', 'origin', 'evidence']) || typeof relation.id !== 'string' || !ID.test(relation.id) || relationIds.has(relation.id) || typeof relation.fromId !== 'string' || !componentIds.has(relation.fromId) || typeof relation.toId !== 'string' || !componentIds.has(relation.toId) || relation.fromId === relation.toId || !['attached_to', 'contains', 'adjacent_to', 'aligned_with', 'connected_to'].includes(String(relation.kind)) || !ORIGINS.has(relation.origin as ValueOrigin) || typeof relation.evidence !== 'string' || relation.evidence.length > 500) fail('SPATIAL_V2_RELATION_INVALID');
    relationIds.add(relation.id as string);
  }
  const constraintIds = new Set<string>();
  for (const constraint of raw.constraints as Record<string, unknown>[]) {
    if (!constraint || typeof constraint !== 'object' || Array.isArray(constraint) || !keysAre(constraint, ['id', 'kind', 'componentIds', 'axis', 'tolerance']) || typeof constraint.id !== 'string' || !ID.test(constraint.id) || constraintIds.has(constraint.id) || !['coaxial', 'aligned', 'attached_at', 'centered_on', 'symmetric', 'parallel', 'perpendicular', 'distributed_around', 'connected_by_curve', 'maintains_clearance'].includes(String(constraint.kind)) || !Array.isArray(constraint.componentIds) || constraint.componentIds.length < 1 || constraint.componentIds.length > 4 || new Set(constraint.componentIds).size !== constraint.componentIds.length || !constraint.componentIds.every((id) => typeof id === 'string' && componentIds.has(id)) || ![null, 'x', 'y', 'z'].includes(constraint.axis as null | string) || typeof constraint.tolerance !== 'number' || !Number.isFinite(constraint.tolerance) || constraint.tolerance <= 0 || constraint.tolerance > 100) fail('SPATIAL_V2_CONSTRAINT_INVALID');
    const kind = constraint.kind as ConstraintV2['kind'];
    const count = (constraint.componentIds as string[]).length;
    const needsAxis = ['coaxial', 'aligned', 'symmetric', 'parallel', 'perpendicular', 'distributed_around'].includes(kind);
    const validCount = kind === 'distributed_around' ? count === 2 : kind === 'connected_by_curve' ? count === 3 : count === 2;
    if (!validCount || needsAxis && !['x', 'y', 'z'].includes(String(constraint.axis)) || !needsAxis && constraint.axis !== null) fail('SPATIAL_V2_CONSTRAINT_SHAPE_INVALID');
    constraintIds.add(constraint.id as string);
  }
  return { ...raw, contract: SPATIAL_PLAN_V2_CONTRACT, source: resolvedSource, components: raw.components as SpatialPlanV2['components'] } as SpatialPlanV2;
}

function renderedMeshCount(node: GeometryNodeV2, factor = 1): number {
  const expanded = factor * (node.repeat?.count ?? 1);
  return node.type === 'group' ? node.children.reduce((sum, child) => sum + renderedMeshCount(child, expanded), 0) : expanded;
}
function estimatedLeafTriangles(node: Extract<GeometryNodeV2, { type: 'shape' }>): number {
  const p = node.parameters as Record<string, unknown>;
  switch (node.operator) {
    case 'box': return 300; // softened edges: RoundedBoxGeometry with 2 segments
    case 'rounded_box': return 12 * Number(p.segments) ** 2;
    case 'sphere': case 'ellipsoid': return Number(p.widthSegments) * Number(p.heightSegments) * 2;
    case 'cylinder': return Number(p.radialSegments) * 4;
    case 'cone': return Number(p.radialSegments) * 2;
    case 'torus': return Number(p.radialSegments) * Number(p.tubularSegments) * 2;
    case 'extrude': return (p.profile as unknown[]).length * (Number(p.curveSegments) + 4) * 8;
    case 'tube': return (Number(p.tubularSegments) + 1) * Number(p.radialSegments) * 2;
    case 'revolve': return (p.profile as unknown[]).length * Number(p.segments) * 2;
    case 'loft': return ((p.profile as unknown[]).length * ((p.sections as unknown[]).length - 1) * 2) + (p.capEnds as boolean[]).filter(Boolean).length * ((p.profile as unknown[]).length - 2);
  }
}
function estimatedTriangles(node: GeometryNodeV2, factor = 1): number {
  const expanded = factor * (node.repeat?.count ?? 1);
  return node.type === 'group' ? node.children.reduce((sum, child) => sum + estimatedTriangles(child, expanded), 0) : estimatedLeafTriangles(node) * expanded;
}

export function spatialPlanV1ToV2(plan: import('./contracts').SpatialPlan): SpatialPlanV2 {
  const components = plan.entities.map((entity) => {
    const material: MaterialV2 = { profile: entity.material.metalness > 0.65 ? 'metal' : 'neutral', color: entity.material.color, roughness: entity.material.roughness, metalness: entity.material.metalness, clearcoat: 0.15 };
    const transform: GeometryTransformV2 = structuredClone(entity.transform);
    const params: Record<string, unknown> = entity.geometry.operator === 'box' || entity.geometry.operator === 'rounded_box' || entity.geometry.operator === 'ellipsoid'
      ? { dimensions: entity.geometry.parameters }
      : entity.geometry.operator === 'sphere' ? { radius: entity.geometry.parameters[0], widthSegments: 24, heightSegments: 16 }
        : entity.geometry.operator === 'cylinder' ? { radiusTop: entity.geometry.parameters[0], radiusBottom: entity.geometry.parameters[0], height: entity.geometry.parameters[1], radialSegments: 32 }
          : entity.geometry.operator === 'cone' ? { radius: entity.geometry.parameters[0], height: entity.geometry.parameters[1], radialSegments: 32 }
            : entity.geometry.operator === 'torus' ? { majorRadius: entity.geometry.parameters[0], tubeRadius: entity.geometry.parameters[1], radialSegments: 12, tubularSegments: 40 }
              : entity.geometry.operator === 'extrude' ? { profile: entity.geometry.parameters.slice(1).reduce<number[][]>((out, n, i, arr) => { if (i % 2 === 0 && arr[i + 1] !== undefined) out.push([n, arr[i + 1]!]); return out; }, []), depth: entity.geometry.parameters[0], bevelM: 0, curveSegments: 8 }
                : entity.geometry.operator === 'tube' ? { radius: entity.geometry.parameters[0], points: entity.geometry.parameters.slice(1).reduce<number[][]>((out, n, i, arr) => { if (i % 3 === 0 && arr[i + 1] !== undefined && arr[i + 2] !== undefined) out.push([n, arr[i + 1]!, arr[i + 2]!]); return out; }, []), tubularSegments: 32, radialSegments: 10 }
                  : entity.geometry.operator === 'revolve' ? { segments: entity.geometry.parameters[0], profile: entity.geometry.parameters.slice(1).reduce<number[][]>((out, n, i, arr) => { if (i % 2 === 0 && arr[i + 1] !== undefined) out.push([n, arr[i + 1]!]); return out; }, []) }
                    : { dimensions: [0.2, 0.2, 0.2] };
    if (entity.geometry.operator === 'rounded_box') params.bevelM = Math.min(...entity.geometry.parameters) * 0.08, params.segments = 3;
    const node: GeometryNodeV2 = { type: 'shape', key: `${entity.id}-shape`.slice(0, 48), operator: entity.geometry.operator === 'revolve' ? 'revolve' : entity.geometry.operator, parameters: params, transform: { position: [0, 0, 0], rotationRad: [0, 0, 0], scale: [1, 1, 1] }, repeat: entity.repeat, material };
    return { id: entity.id, label: entity.label, parentId: entity.parentId, geometry: node, transform, provenance: { geometry: entity.origin, transform: entity.origin, material: entity.origin, evidence: entity.evidence } };
  });
  return validateSpatialPlanV2({ title: plan.title, units: plan.units, presentationProfile: 'neutral', components, relations: plan.relations, constraints: [], unknowns: plan.unknowns, source: plan.source });
}

export function applySpatialOperationV2(plan: SpatialPlanV2, operation: SpatialOperationV2, provenance: { origin: 'user_provided' | 'inferred'; evidence: string }): SpatialPlanV2 {
  if (STRUCTURAL_KINDS.has(operation.kind)) return applyStructuralOperationV2(plan, operation, provenance);
  if (operation.contract !== 'unfold.spatial-operation.v2' || !/^[a-zA-Z0-9-]{1,80}$/.test(operation.operationId) || !['set-transform', 'set-geometry', 'set-material', 'set-repeat'].includes(operation.kind) || !ID.test(operation.componentId) || ![null, ...plan.components.flatMap((component) => collectNodeKeys(component.geometry))].includes(operation.nodeKey)) fail('SPATIAL_V2_OPERATION_INVALID');
  if (!['user_provided', 'inferred'].includes(provenance.origin) || !provenance.evidence.trim() || provenance.evidence.length > 500) fail('SPATIAL_V2_OPERATION_PROVENANCE_INVALID');
  const component = plan.components.find((item) => item.id === operation.componentId);
  if (!component) fail('SPATIAL_V2_OPERATION_COMPONENT_NOT_FOUND');
  const targetComponent = component!;
  const evidence = provenance.evidence.slice(0, 500);
  const updated = plan.components.map((item) => {
    if (item.id !== targetComponent.id) return item;
    if (operation.kind === 'set-transform') {
      validateTransform(operation.value, `${targetComponent.id}.operation`);
      if (operation.nodeKey !== null) fail('SPATIAL_V2_OPERATION_NODE_KEY_INVALID');
      return { ...item, transform: operation.value as GeometryTransformV2, provenance: { ...item.provenance, transform: provenance.origin, evidence } };
    }
    const nodeKey = operation.nodeKey;
    if (!nodeKey) fail('SPATIAL_V2_OPERATION_NODE_KEY_REQUIRED');
    let changed = false;
    const walk = (node: GeometryNodeV2): GeometryNodeV2 => {
      if (node.key === nodeKey) {
        changed = true;
        if (operation.kind === 'set-geometry') {
          if (node.key !== (operation.value as GeometryNodeV2)?.key) fail('SPATIAL_V2_OPERATION_KEY_MUST_BE_STABLE');
          const counters = { nodes: 0 }, keys = new Set<string>(); validateNode(operation.value, counters, 1, `${targetComponent.id}.operation`, keys);
          if (operation.value && typeof operation.value === 'object' && 'type' in operation.value && operation.value.type === 'shape') return operation.value as GeometryNodeV2;
          return operation.value as GeometryNodeV2;
        }
        if (operation.kind === 'set-material') {
          if (node.type !== 'shape') throw new Error('SPATIAL_V2_OPERATION_MATERIAL_REQUIRES_SHAPE');
          const shape = node as Extract<GeometryNodeV2, { type: 'shape' }>;
          validateMaterial(operation.value, `${targetComponent.id}.${nodeKey}`);
          return { ...shape, material: operation.value as MaterialV2 };
        }
        validateRepeat(operation.value, `${targetComponent.id}.${nodeKey}`);
        return { ...node, repeat: operation.value as RepeatPatternV2 | null };
      }
      if (node.type === 'group') return { ...node, children: node.children.map(walk) };
      return node;
    };
    const geometry = walk(item.geometry);
    if (!changed) fail('SPATIAL_V2_OPERATION_NODE_NOT_FOUND');
    return { ...item, geometry, provenance: { ...item.provenance, geometry: operation.kind === 'set-geometry' || operation.kind === 'set-repeat' ? provenance.origin : item.provenance.geometry, material: operation.kind === 'set-material' || operation.kind === 'set-geometry' ? provenance.origin : item.provenance.material, evidence } };
  });
  return validateSpatialPlanV2({ ...plan, components: updated });
}

function collectNodeKeys(node: GeometryNodeV2): string[] { return [node.key, ...(node.type === 'group' ? node.children.flatMap(collectNodeKeys) : [])]; }


// ------------------------------------------------------------------------------------------------ structural operations
const STRUCTURAL_KINDS = new Set<string>(['add-component', 'remove-component', 'merge-components', 'split-component']);
type PlanComponent = SpatialPlanV2['components'][number];
/** how certain a value's origin is; a merged component is only as certain as its least certain member (merging never promotes) */
const ORIGIN_RANK: Record<ValueOrigin, number> = { unknown: 0, design_approximation: 1, inferred: 2, observed: 3, user_provided: 4 };
const weakest = (a: ValueOrigin, b: ValueOrigin): ValueOrigin => (ORIGIN_RANK[a]! <= ORIGIN_RANK[b]! ? a : b);
const matrixOf = (t: GeometryTransformV2) => new Matrix4().compose(new Vector3(...t.position), new Quaternion().setFromEuler(new Euler(...t.rotationRad, 'XYZ')), new Vector3(...t.scale));
function transformOf(m: Matrix4): GeometryTransformV2 {
  const p = new Vector3(), q = new Quaternion(), sc = new Vector3(); m.decompose(p, q, sc); const e = new Euler().setFromQuaternion(q, 'XYZ');
  const out: GeometryTransformV2 = { position: [p.x, p.y, p.z], rotationRad: [e.x, e.y, e.z], scale: [sc.x, sc.y, sc.z] };
  // a relative transform with shear (rotation under non-uniform scale) cannot be expressed as position/rotation/scale: refuse instead of distorting the part
  const back = matrixOf(out).elements; for (let i = 0; i < 16; i++) if (Math.abs(back[i]! - m.elements[i]!) > 1e-6) fail('SPATIAL_V2_MERGE_TRANSFORM_NOT_REPRESENTABLE');
  return out;
}
const rekey = (node: GeometryNodeV2, prefix: string, taken: Set<string>): GeometryNodeV2 => {
  let key = `${prefix}-${node.key}`.slice(0, 48).replace(/-+$/, ''); for (let n = 2; taken.has(key); n++) key = `${prefix}-${node.key}`.slice(0, 44) + `-${n}`; taken.add(key);
  return node.type === 'group' ? { ...node, key, children: node.children.map((c) => rekey(c, prefix, taken)) } : { ...node, key };
};
function reference(plan: SpatialPlanV2, from: string, into: string | null): Pick<SpatialPlanV2, 'relations' | 'constraints'> {
  const relations = plan.relations.map((r) => ({ ...r, fromId: r.fromId === from ? (into ?? '') : r.fromId, toId: r.toId === from ? (into ?? '') : r.toId })).filter((r) => r.fromId && r.toId && r.fromId !== r.toId);
  const seen = new Set<string>(), deduped = relations.filter((r) => { const k = `${r.fromId}|${r.toId}|${r.kind}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const constraints = plan.constraints.map((c) => ({ ...c, componentIds: c.componentIds.map((id) => (id === from ? (into ?? '') : id)).filter((id, i, a) => id && a.indexOf(id) === i) })).filter((c) => c.componentIds.length >= (c.kind === 'distributed_around' || c.kind === 'connected_by_curve' ? 3 : 2));
  return { relations: deduped, constraints };
}
export function applyStructuralOperationV2(plan: SpatialPlanV2, operation: SpatialOperationV2, provenance: { origin: 'user_provided' | 'inferred'; evidence: string }): SpatialPlanV2 {
  if (operation.contract !== 'unfold.spatial-operation.v2' || !/^[a-zA-Z0-9-]{1,80}$/.test(operation.operationId) || !STRUCTURAL_KINDS.has(operation.kind) || !ID.test(operation.componentId) || operation.nodeKey !== null) fail('SPATIAL_V2_OPERATION_INVALID');
  if (!['user_provided', 'inferred'].includes(provenance.origin) || !provenance.evidence.trim() || provenance.evidence.length > 500) fail('SPATIAL_V2_OPERATION_PROVENANCE_INVALID');
  const evidence = provenance.evidence.slice(0, 500), byId = new Map(plan.components.map((c) => [c.id, c])), value = operation.value as Record<string, unknown> | null;
  if (operation.kind === 'add-component') {
    if (byId.has(operation.componentId)) fail('SPATIAL_V2_STRUCTURE_ID_EXISTS');
    const c = value as PlanComponent | null; if (!c || typeof c !== 'object' || c.id !== operation.componentId) fail('SPATIAL_V2_STRUCTURE_VALUE_INVALID');
    if (c!.parentId !== null && !byId.has(c!.parentId)) fail('SPATIAL_V2_STRUCTURE_PARENT_NOT_FOUND');
    // a new component is what the operation's author says it is: its provenance is the operation's, never "observed"
    const origin = provenance.origin as ValueOrigin;
    return validateSpatialPlanV2({ ...plan, components: [...plan.components, { ...c!, provenance: { geometry: origin, transform: origin, material: origin, evidence } }] });
  }
  const target = byId.get(operation.componentId); if (!target) fail('SPATIAL_V2_OPERATION_COMPONENT_NOT_FOUND');
  const me = target!;
  if (operation.kind === 'remove-component') {
    const mode = (value as { children?: string } | null)?.children; if (mode !== 'reparent' && mode !== 'remove') fail('SPATIAL_V2_STRUCTURE_VALUE_INVALID');
    if (plan.components.length < 2) fail('SPATIAL_V2_STRUCTURE_LAST_COMPONENT');
    const doomed = new Set<string>([me.id]); if (mode === 'remove') { let grew = true; while (grew) { grew = false; for (const c of plan.components) if (c.parentId && doomed.has(c.parentId) && !doomed.has(c.id)) { doomed.add(c.id); grew = true; } } }
    let next: SpatialPlanV2 = { ...plan, components: plan.components.filter((c) => !doomed.has(c.id)).map((c) => (c.parentId === me.id ? { ...c, parentId: me.parentId } : c)) };
    for (const id of doomed) next = { ...next, ...reference(next, id, null) };
    return validateSpatialPlanV2(next);
  }
  if (operation.kind === 'merge-components') {
    const sourceIds = (value as { sourceIds?: unknown } | null)?.sourceIds;
    if (!Array.isArray(sourceIds) || !sourceIds.length || sourceIds.some((id) => typeof id !== 'string' || !byId.has(id) || id === me.id) || new Set(sourceIds).size !== sourceIds.length) fail('SPATIAL_V2_STRUCTURE_VALUE_INVALID');
    const sources = (sourceIds as string[]).map((id) => byId.get(id)!), inv = matrixOf(me.transform).invert(), taken = new Set<string>(), keep = rekey(me.geometry, 'a', taken);
    const parts: GeometryNodeV2[] = [keep, ...sources.map((s, i) => { const rel = transformOf(inv.clone().multiply(matrixOf(s.transform))); return { type: 'group' as const, key: `m${i + 1}-${s.id}`.slice(0, 48), transform: rel, repeat: null, children: [rekey(s.geometry, `m${i + 1}`, taken)] }; })];
    const merged: PlanComponent = { ...me, geometry: { type: 'group', key: `${me.id}-merged`.slice(0, 48), transform: { position: [0, 0, 0], rotationRad: [0, 0, 0], scale: [1, 1, 1] }, repeat: null, children: parts }, provenance: { geometry: sources.reduce((o, s) => weakest(o, s.provenance.geometry), me.provenance.geometry), transform: me.provenance.transform, material: sources.reduce((o, s) => weakest(o, s.provenance.material), me.provenance.material), evidence: `Fusão de ${sources.map((s) => s.id).join(', ')} em ${me.id}: ${evidence}`.slice(0, 500) } };
    const gone = new Set(sourceIds as string[]);
    let next: SpatialPlanV2 = { ...plan, components: plan.components.filter((c) => !gone.has(c.id)).map((c) => (c.id === me.id ? merged : gone.has(c.parentId ?? '') ? { ...c, parentId: me.id } : c)) };
    for (const id of gone) next = { ...next, ...reference(next, id, me.id) };
    return validateSpatialPlanV2(next);
  }
  // split-component
  const v = value as { newId?: unknown; label?: unknown; childKeys?: unknown } | null;
  if (!v || typeof v.newId !== 'string' || !ID.test(v.newId) || byId.has(v.newId) || typeof v.label !== 'string' || !v.label.trim() || v.label.length > 100 || !Array.isArray(v.childKeys) || !v.childKeys.length) fail('SPATIAL_V2_STRUCTURE_VALUE_INVALID');
  if (me.geometry.type !== 'group') fail('SPATIAL_V2_SPLIT_REQUIRES_GROUP');
  const group = me.geometry as Extract<GeometryNodeV2, { type: 'group' }>, move = new Set(v!.childKeys as string[]), moved = group.children.filter((c) => move.has(c.key)), stay = group.children.filter((c) => !move.has(c.key));
  if (moved.length !== move.size || !stay.length) fail('SPATIAL_V2_SPLIT_CHILDREN_INVALID');
  const born: PlanComponent = { ...me, id: v!.newId as string, label: String(v!.label), geometry: { ...group, key: `${v!.newId}-group`.slice(0, 48), children: moved }, provenance: { ...me.provenance, evidence: `Dividido de ${me.id}: ${evidence}`.slice(0, 500) } };
  const rest: PlanComponent = { ...me, geometry: { ...group, children: stay } };
  const components = plan.components.map((c) => (c.id === me.id ? rest : c)); components.splice(components.findIndex((c) => c.id === me.id) + 1, 0, born);
  return validateSpatialPlanV2({ ...plan, components, relations: [...plan.relations, { id: `split-${born.id}`.slice(0, 48), fromId: born.id, toId: me.id, kind: 'attached_to', origin: provenance.origin as ValueOrigin, evidence: `Dividido de ${me.id}; a ligação entre as duas metades é a da origem comum, não uma ligação observada.`.slice(0, 300) }] });
}
