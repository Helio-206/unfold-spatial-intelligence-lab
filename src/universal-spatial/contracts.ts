export const SPATIAL_PLAN_CONTRACT = 'unfold.spatial-plan.v1' as const;
export const MAX_SPATIAL_ENTITIES = 80;
export const MAX_SPATIAL_RELATIONS = 200;
export const MAX_SPATIAL_DEPTH = 16;
export const MAX_SPATIAL_MESHES = 1_000;

export type ValueOrigin = 'observed' | 'inferred' | 'user_provided' | 'design_approximation' | 'unknown';
export type Source = { kind: 'text' | 'image'; sha256: string };
export type SpatialPlan = {
  contract: typeof SPATIAL_PLAN_CONTRACT;
  source: Source;
  title: string;
  units: 'm' | 'unitless';
  entities: Array<{
    id: string;
    label: string;
    parentId: string | null;
    geometry: { operator: 'box' | 'rounded_box' | 'sphere' | 'ellipsoid' | 'cylinder' | 'cone' | 'torus' | 'extrude' | 'tube' | 'revolve'; parameters: number[] };
    repeat: null | { kind: 'radial' | 'linear'; count: number; axis: 'x' | 'y' | 'z'; spacingOrRadius: number };
    transform: { position: [number, number, number]; rotationRad: [number, number, number]; scale: [number, number, number] };
    material: { color: string; roughness: number; metalness: number };
    origin: ValueOrigin;
    evidence: string;
  }>;
  relations: Array<{ id: string; fromId: string; toId: string; kind: 'attached_to' | 'contains' | 'adjacent_to' | 'aligned_with' | 'connected_to'; origin: ValueOrigin; evidence: string }>;
  unknowns: string[];
};

export const SPATIAL_PLAN_JSON_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['title', 'units', 'entities', 'relations', 'unknowns'], properties: {
    title: { type: 'string', minLength: 1, maxLength: 120 }, units: { type: 'string', enum: ['m', 'unitless'] },
    entities: { type: 'array', minItems: 1, maxItems: 80, items: { type: 'object', additionalProperties: false, required: ['id', 'label', 'parentId', 'geometry', 'repeat', 'transform', 'material', 'origin', 'evidence'], properties: {
      id: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,47}$' }, label: { type: 'string', minLength: 1, maxLength: 100 }, parentId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      geometry: { type: 'object', additionalProperties: false, required: ['operator', 'parameters'], properties: { operator: { type: 'string', enum: ['box', 'rounded_box', 'sphere', 'ellipsoid', 'cylinder', 'cone', 'torus', 'extrude', 'tube', 'revolve'], description: 'box/rounded_box/ellipsoid=3 dims; sphere=1 radius; cylinder/cone=radius,height; torus=major,tube radius; extrude=depth then xy pairs; tube=radius then xyz triples; revolve=segments then radius/axial pairs.' }, parameters: { type: 'array', minItems: 1, maxItems: 256, items: { type: 'number' }, description: 'Follow exactly the parameter count/order for the selected operator. For cylinder/cone/torus return exactly 2 positive values; box/rounded_box/ellipsoid exactly 3 positive values; sphere exactly 1 positive value.' } } },
      repeat: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false, required: ['kind', 'count', 'axis', 'spacingOrRadius'], properties: { kind: { type: 'string', enum: ['radial', 'linear'] }, count: { type: 'integer', minimum: 2, maximum: 64 }, axis: { type: 'string', enum: ['x', 'y', 'z'] }, spacingOrRadius: { type: 'number', exclusiveMinimum: 0, maximum: 100 } } }] },
      transform: { type: 'object', additionalProperties: false, required: ['position', 'rotationRad', 'scale'], properties: { position: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } }, rotationRad: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } }, scale: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } } } },
      material: { type: 'object', additionalProperties: false, required: ['color', 'roughness', 'metalness'], properties: { color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }, roughness: { type: 'number', minimum: 0, maximum: 1 }, metalness: { type: 'number', minimum: 0, maximum: 1 } } },
      origin: { type: 'string', enum: ['observed', 'inferred', 'user_provided', 'design_approximation', 'unknown'] }, evidence: { type: 'string', maxLength: 500 },
    } } }, relations: { type: 'array', maxItems: 200, items: { type: 'object', additionalProperties: false, required: ['id', 'fromId', 'toId', 'kind', 'origin', 'evidence'], properties: { id: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,47}$' }, fromId: { type: 'string', minLength: 1, maxLength: 48 }, toId: { type: 'string', minLength: 1, maxLength: 48 }, kind: { type: 'string', enum: ['attached_to', 'contains', 'adjacent_to', 'aligned_with', 'connected_to'] }, origin: { type: 'string', enum: ['observed', 'inferred', 'user_provided', 'design_approximation', 'unknown'] }, evidence: { type: 'string', maxLength: 500 } } } }, unknowns: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 300 } },
  },
} as const;

const OPERATORS = new Set<SpatialPlan['entities'][number]['geometry']['operator']>(['box', 'rounded_box', 'sphere', 'ellipsoid', 'cylinder', 'cone', 'torus', 'extrude', 'tube', 'revolve']);
const exactKeys = (value: object, keys: string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

export function validateSpatialPlan(value: unknown, source?: Source): SpatialPlan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PLAN_INVALID_OBJECT');
  const raw = value as Partial<SpatialPlan>;
  if (!exactKeys(value, ['title', 'units', 'entities', 'relations', 'unknowns', ...(Object.hasOwn(value, 'contract') ? ['contract'] : []), ...(Object.hasOwn(value, 'source') ? ['source'] : [])])) throw new Error('PLAN_INVALID_FIELDS');
  if (raw.contract !== undefined && raw.contract !== SPATIAL_PLAN_CONTRACT) throw new Error('PLAN_INVALID_CONTRACT');
  if (typeof raw.title !== 'string' || !raw.title.trim() || raw.title.length > 120 || !['m', 'unitless'].includes(raw.units ?? '') || !Array.isArray(raw.entities) || raw.entities.length < 1 || raw.entities.length > MAX_SPATIAL_ENTITIES || !Array.isArray(raw.relations) || raw.relations.length > MAX_SPATIAL_RELATIONS || !Array.isArray(raw.unknowns) || raw.unknowns.length > 100 || !raw.unknowns.every((x) => typeof x === 'string' && x.length <= 300)) throw new Error('PLAN_INVALID_FIELDS');
  const ids = new Set<string>();
  for (const entity of raw.entities) {
    if (!entity || typeof entity !== 'object' || !exactKeys(entity, ['id', 'label', 'parentId', 'geometry', 'repeat', 'transform', 'material', 'origin', 'evidence']) || !entity.geometry || !exactKeys(entity.geometry, ['operator', 'parameters']) || !entity.transform || !exactKeys(entity.transform, ['position', 'rotationRad', 'scale']) || !entity.material || !exactKeys(entity.material, ['color', 'roughness', 'metalness']) || (entity.repeat !== null && (!entity.repeat || !exactKeys(entity.repeat, ['kind', 'count', 'axis', 'spacingOrRadius'])))) throw new Error('PLAN_INVALID_ENTITY_SHAPE');
    if (!entity || typeof entity !== 'object' || typeof entity.id !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(entity.id) || ids.has(entity.id) || typeof entity.label !== 'string' || !entity.label.trim() || entity.label.length > 100 || !entity.geometry || !OPERATORS.has(entity.geometry.operator) || !Array.isArray(entity.geometry.parameters) || entity.geometry.parameters.length < 1 || entity.geometry.parameters.length > 256 || entity.geometry.parameters.some((x) => !Number.isFinite(x) || Math.abs(x) > 1000) || !entity.transform || !['position', 'rotationRad', 'scale'].every((key) => Array.isArray(entity.transform[key as keyof typeof entity.transform]) && (entity.transform[key as keyof typeof entity.transform] as number[]).length === 3 && (entity.transform[key as keyof typeof entity.transform] as number[]).every(Number.isFinite)) || entity.transform.position.some((x) => Math.abs(x) > 1000) || entity.transform.scale.some((x) => x <= 0 || x > 100) || !entity.material || !/^#[0-9a-fA-F]{6}$/.test(entity.material.color) || !Number.isFinite(entity.material.roughness) || entity.material.roughness < 0 || entity.material.roughness > 1 || !Number.isFinite(entity.material.metalness) || entity.material.metalness < 0 || entity.material.metalness > 1 || !['observed', 'inferred', 'user_provided', 'design_approximation', 'unknown'].includes(entity.origin) || typeof entity.evidence !== 'string' || entity.evidence.length > 500 || (entity.repeat !== null && (!entity.repeat || !['radial', 'linear'].includes(entity.repeat.kind) || !Number.isInteger(entity.repeat.count) || entity.repeat.count < 2 || entity.repeat.count > 64 || !['x', 'y', 'z'].includes(entity.repeat.axis) || !Number.isFinite(entity.repeat.spacingOrRadius) || entity.repeat.spacingOrRadius <= 0 || entity.repeat.spacingOrRadius > 100))) throw new Error(`PLAN_INVALID_ENTITY:${entity?.id ?? 'unknown'}`);
    const p = entity.geometry.parameters;
    const validGeometry = entity.geometry.operator === 'box' || entity.geometry.operator === 'rounded_box' || entity.geometry.operator === 'ellipsoid' ? p.length === 3 && p.every((n) => n > 0)
      : entity.geometry.operator === 'sphere' ? p.length === 1 && p[0]! > 0
        : entity.geometry.operator === 'cylinder' || entity.geometry.operator === 'cone' || entity.geometry.operator === 'torus' ? p.length === 2 && p.every((n) => n > 0) && (entity.geometry.operator !== 'torus' || p[1]! < p[0]!)
          : entity.geometry.operator === 'extrude' ? p.length >= 7 && p.length % 2 === 1 && p[0]! > 0
            : entity.geometry.operator === 'tube' ? p.length >= 10 && (p.length - 1) % 3 === 0 && p[0]! > 0
              : p.length >= 7 && p.length % 2 === 1 && Number.isInteger(p[0]) && p[0]! >= 8 && p[0]! <= 64 && p.slice(1).some((_, i) => i % 2 === 0 && p[i + 1]! > 0);
    if (!validGeometry) throw new Error(`PLAN_INVALID_GEOMETRY:${entity.id}`);
    ids.add(entity.id);
  }
  for (const entity of raw.entities) if (entity.parentId !== null && (typeof entity.parentId !== 'string' || !ids.has(entity.parentId) || entity.parentId === entity.id)) throw new Error(`PLAN_INVALID_PARENT:${entity.id}`);
  if (raw.entities.some((entity) => entity.parentId !== null && !ids.has(entity.parentId))) throw new Error('PLAN_INVALID_PARENT');
  const sourceValue = source ?? (raw as SpatialPlan).source;
  if (!sourceValue || typeof sourceValue !== 'object' || !exactKeys(sourceValue, ['kind', 'sha256']) || !['text', 'image'].includes(sourceValue.kind) || !/^[a-f0-9]{64}$/.test(sourceValue.sha256)) throw new Error('PLAN_INVALID_SOURCE');
  const relationIds = new Set<string>();
  for (const relation of raw.relations) if (!relation || !exactKeys(relation, ['id', 'fromId', 'toId', 'kind', 'origin', 'evidence']) || !/^[a-z][a-z0-9-]{0,47}$/.test(relation.id) || relationIds.has(relation.id) || !ids.has(relation.fromId) || !ids.has(relation.toId) || relation.fromId === relation.toId || !['attached_to', 'contains', 'adjacent_to', 'aligned_with', 'connected_to'].includes(relation.kind) || !['observed', 'inferred', 'user_provided', 'design_approximation', 'unknown'].includes(relation.origin) || typeof relation.evidence !== 'string' || relation.evidence.length > 500) throw new Error('PLAN_INVALID_RELATION'); else relationIds.add(relation.id);
  const normalized = { ...raw, contract: SPATIAL_PLAN_CONTRACT, source: sourceValue } as SpatialPlan;
  const byId = new Map(normalized.entities.map((item) => [item.id, item]));
  for (const entity of normalized.entities) {
    let parent = entity.parentId;
    const seen = new Set([entity.id]);
    while (parent !== null) { if (seen.has(parent)) throw new Error('PLAN_PARENT_CYCLE'); seen.add(parent); if (seen.size - 1 > MAX_SPATIAL_DEPTH) throw new Error('PLAN_HIERARCHY_TOO_DEEP'); parent = byId.get(parent)!.parentId; }
  }
  const meshCount = normalized.entities.reduce((sum, entity) => sum + (entity.repeat?.count ?? 1), 0);
  if (meshCount > MAX_SPATIAL_MESHES) throw new Error('PLAN_MESH_BUDGET_EXCEEDED');
  return normalized;
}

export type SpatialOperation = { contract: 'unfold.spatial-operation.v1'; operationId: string; kind: 'set-transform' | 'set-material' | 'set-geometry' | 'set-repeat'; entityId: string; value: unknown };
export function applySpatialOperation(plan: SpatialPlan, operation: SpatialOperation, provenance: { origin: 'user_provided' | 'inferred'; evidence: string } = { origin: 'user_provided', evidence: 'Operation submitted by client; human identity and review are unverified.' }): SpatialPlan {
  if (operation.contract !== 'unfold.spatial-operation.v1' || !/^[a-zA-Z0-9-]{1,80}$/.test(operation.operationId)) throw new Error('OPERATION_INVALID');
  if (!['set-transform', 'set-material', 'set-geometry', 'set-repeat'].includes(operation.kind)) throw new Error('OPERATION_KIND_NOT_ALLOWED');
  const index = plan.entities.findIndex((item) => item.id === operation.entityId);
  if (index < 0) throw new Error('OPERATION_ENTITY_NOT_FOUND');
  if (!['user_provided', 'inferred'].includes(provenance.origin) || !provenance.evidence.trim() || provenance.evidence.length > 500) throw new Error('OPERATION_PROVENANCE_INVALID');
  const updated = { origin: provenance.origin, evidence: provenance.evidence.slice(0, 500) };
  const entities = plan.entities.map((entity, i) => i !== index ? entity : operation.kind === 'set-transform' ? { ...entity, transform: operation.value as typeof entity.transform, ...updated } : operation.kind === 'set-material' ? { ...entity, material: operation.value as typeof entity.material, ...updated } : operation.kind === 'set-repeat' ? { ...entity, repeat: operation.value as typeof entity.repeat, ...updated } : { ...entity, geometry: operation.value as typeof entity.geometry, ...updated });
  return validateSpatialPlan({ ...plan, entities });
}

export function spatialConstructionEvents(plan: SpatialPlan) {
  return [
    { type: 'scene_created' as const, at: 0, entityId: null, transform: null },
    ...plan.entities.map((entity, index) => ({ type: 'component_placed' as const, at: index + 1, entityId: entity.id, transform: entity.transform })),
    ...plan.relations.map((relation, index) => ({ type: 'relationship_established' as const, at: plan.entities.length + index + 1, entityId: relation.fromId, targetEntityId: relation.toId, relationId: relation.id })),
    { type: 'assembly_ready' as const, at: plan.entities.length + plan.relations.length + 1, entityId: null, transform: null },
    { type: 'scene_revealed' as const, at: plan.entities.length + plan.relations.length + 2, entityId: null, transform: null },
  ];
}
