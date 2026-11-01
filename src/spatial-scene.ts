import type { TechnicalDocumentV1 } from './technical-document';
import { parseSpatialCommand, type SpatialAction } from './spatial-command';
import type { BarName } from './kinematics';
import { AuthorizationError, operationDigest, type Actor, type AuthorizationLedger, type CanonicalOperation, type CommandOrigin } from './core';
import { PENDING_AUTHORIZATION_EVIDENCE, isConfirmedValidation, sceneOperation, stampAuthorization, touchedConfirmed, withoutProvenance, type ConfirmedReference } from './scene-authorization';

export const SPATIAL_SCENE_SCHEMA = 'spatial_scene.v1' as const;
export type VerificationState = 'unreviewed' | 'ambiguous' | 'verified' | 'rejected' | 'corrected';
export type PropertyProvenance = {
  source: 'technical_document' | 'user' | 'solver' | 'derived' | 'system';
  validation: VerificationState;
  documentRef?: { documentId: string; schema: TechnicalDocumentV1['schema']; elementId?: string; relationId?: string };
  sourceValue?: unknown;
  sourceUnit?: string;
  evidence?: string;
  actor?: string;
  /** Presente quando um valor confirmado foi alterado com uma autorização humana do ledger. */
  authorizationId?: string;
  recordedAt: string;
};
export type SpatialProperty = { value: string | number | boolean | null; unit?: string; provenance: PropertyProvenance };
export type Transform = { translationM: [number, number, number]; rotation: [number, number, number, number]; scale: [number, number, number]; provenance: { translationM: PropertyProvenance; rotation: PropertyProvenance; scale: PropertyProvenance } };
export type Geometry =
  | { kind: 'point'; radiusM: number; provenance: PropertyProvenance }
  | { kind: 'segment'; lengthM: number; radiusM: number; provenance: PropertyProvenance }
  | { kind: 'box'; sizeM: [number, number, number]; provenance: PropertyProvenance }
  | { kind: 'circle'; radiusM: number; thicknessM: number; provenance: PropertyProvenance }
  | { kind: 'polygon'; verticesM: Array<[number, number, number]>; provenance: PropertyProvenance }
  | { kind: 'mesh_reference'; assetId: string; boundsM: [number, number, number]; provenance: PropertyProvenance };
export type Component = {
  kind: string;
  properties: Record<string, SpatialProperty>;
  dependsOn: string[];
};
export type Node = {
  id: string;
  label: string;
  nodeType: 'component' | 'group' | 'annotation';
  parentId: string | null;
  transform: Transform;
  geometry: Geometry | null;
  component: Component | null;
  properties: Record<string, SpatialProperty>;
};
export type SceneRelation = { id: string; fromNodeId: string; toNodeId: string; kind: string; properties: Record<string, SpatialProperty>; provenance: PropertyProvenance };
export type GeometricConstraint = { id: string; kind: 'coincident' | 'parallel' | 'perpendicular' | 'distance' | 'angle' | 'fixed' | 'custom'; nodeIds: string[]; value: number | null; unit: 'm' | 'rad' | null; provenance: PropertyProvenance };
export type ImageWorldMapping = {
  sourceImageSha256: string;
  imageSizePx: { width: number; height: number };
  /** Affine map from pixel (u,v) to floor-plane world (x,z), in metres: [x,z] = [a*u+b*v+c, d*u+e*v+f]. */
  pixelToWorldXZ: [number, number, number, number, number, number];
  worldY: number;
  provenance: PropertyProvenance;
};
export type SceneRevision = { id: string; number: number; parentId: string | null; operationId: string | null; createdAt: string; createdBy: string };
export type SpatialSceneV1 = {
  schema: typeof SPATIAL_SCENE_SCHEMA;
  id: string;
  title: string;
  coordinateSystem: { handedness: 'right'; upAxis: 'Y'; horizontalPlane: ['X', 'Z']; unit: 'm' };
  sourceDocuments: Array<{ documentId: string; schema: TechnicalDocumentV1['schema']; sha256: string; immutable: true }>;
  imageWorldMapping: ImageWorldMapping | null;
  nodes: Node[];
  relations: SceneRelation[];
  constraints: GeometricConstraint[];
  revision: SceneRevision;
};

export type SpatialCommand =
  | { type: 'AddComponent'; node: Node }
  | { type: 'UpdateGeometry'; nodeId: string; geometry: Geometry }
  | { type: 'RemoveComponent'; nodeId: string }
  | { type: 'MoveComponent'; nodeId: string; translationM: [number, number, number] }
  | { type: 'RotateComponent'; nodeId: string; axis: [number, number, number]; angleRad: number }
  | { type: 'ResizeComponent'; nodeId: string; scale: [number, number, number] }
  | { type: 'UpdateParameter'; nodeId: string; property: string; value: string | number | boolean | null; unit?: string; acknowledgeVerifiedChange?: boolean }
  | { type: 'ConfirmParameter'; nodeId: string; property: string; note: string }
  | { type: 'ConnectComponents'; relation: SceneRelation }
  | { type: 'DisconnectComponents'; relationId: string }
  | { type: 'Undo' }
  | { type: 'Redo' };
export type SceneIssue = { code: string; path: string; message: string };
export type SceneTransaction = { scene: SpatialSceneV1; undoStack: SpatialSceneV1[]; redoStack: SpatialSceneV1[] };
/** Quem pede o comando e com que origem. Sem isto, os chamadores antigos contam como um humano a usar a interface. */
export type SceneCommandContext = { origin: CommandOrigin; actor: Actor };
export type SceneCommitOptions = { ledger?: AuthorizationLedger; authorizationId?: string };
export type ScenePreview = {
  status: 'ready' | 'blocked'; baseRevisionId: string; evaluatedAt: string; actor: string; command: SpatialCommand; candidate: SpatialSceneV1 | null; issues: SceneIssue[];
  context: SceneCommandContext;
  /** A operação canónica que o humano vê e autoriza; `null` se o preview está bloqueado. */
  operation: CanonicalOperation | null;
  operationDigest: string | null;
  touchesConfirmed: ConfirmedReference[];
  requiresAuthorization: boolean;
};
export type ConversationSceneCommand = { status: 'ready'; command: Extract<SpatialCommand, { type: 'UpdateParameter' }> } | { status: 'blocked'; reason: string };

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const vector = (value: unknown, size: number): value is number[] => Array.isArray(value) && value.length === size && value.every(finite);
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const unitSet = new Set(['m', 'cm', 'mm', 'km', 'rad', 'deg', 'm2', 'mm2', 'm²', 'mm²', 'ft2', 'ft²', 'kg', 'N', 'Pa', 'W', 'kW', 'VA', 'kVA', 'V', 'A', 's', 'Hz', '']);

function validateProvenance(value: unknown): value is PropertyProvenance {
  if (!object(value) || !['technical_document', 'user', 'solver', 'derived', 'system'].includes(String(value.source)) || !['unreviewed', 'ambiguous', 'verified', 'rejected', 'corrected'].includes(String(value.validation)) || typeof value.recordedAt !== 'string' || !Number.isFinite(Date.parse(value.recordedAt))) return false;
  if (value.documentRef !== undefined && (!object(value.documentRef) || !idPattern.test(String(value.documentRef.documentId)) || value.documentRef.schema !== 'technical_document.v1' || value.documentRef.elementId !== undefined && !idPattern.test(String(value.documentRef.elementId)) || value.documentRef.relationId !== undefined && !idPattern.test(String(value.documentRef.relationId)))) return false;
  if (value.source === 'technical_document' && value.documentRef === undefined) return false;
  if (['verified', 'corrected'].includes(String(value.validation)) && (value.source !== 'user' || typeof value.actor !== 'string' || !value.actor.trim() || typeof value.evidence !== 'string' || !value.evidence.trim())) return false;
  if (value.validation === 'corrected' && !Object.hasOwn(value, 'sourceValue')) return false;
  if (value.authorizationId !== undefined && (typeof value.authorizationId !== 'string' || !idPattern.test(value.authorizationId))) return false;
  return value.evidence === undefined || typeof value.evidence === 'string' && value.evidence.length <= 1000;
}
function validateProperty(value: unknown): value is SpatialProperty {
  return object(value) && (value.value === null || ['string', 'number', 'boolean'].includes(typeof value.value) && (typeof value.value !== 'number' || finite(value.value))) && (value.unit === undefined || typeof value.unit === 'string' && unitSet.has(value.unit)) && validateProvenance(value.provenance);
}
function validateGeometry(value: unknown): value is Geometry | null {
  if (value === null) return true;
  if (!object(value) || !validateProvenance(value.provenance)) return false;
  switch (value.kind) {
    case 'point': return finite(value.radiusM) && value.radiusM >= 0;
    case 'segment': return finite(value.lengthM) && value.lengthM > 0 && finite(value.radiusM) && value.radiusM >= 0;
    case 'box': return vector(value.sizeM, 3) && value.sizeM.every((item) => item > 0);
    case 'circle': return finite(value.radiusM) && value.radiusM > 0 && finite(value.thicknessM) && value.thicknessM > 0;
    case 'polygon': return Array.isArray(value.verticesM) && value.verticesM.length >= 3 && value.verticesM.length <= 10_000 && value.verticesM.every((point) => vector(point, 3));
    case 'mesh_reference': return typeof value.assetId === 'string' && idPattern.test(value.assetId) && vector(value.boundsM, 3) && value.boundsM.every((item) => item > 0);
    default: return false;
  }
}
function validateNode(value: unknown): value is Node {
  if (!object(value)) return false;
  const transform = value.transform;
  if (!object(transform) || !vector(transform.translationM, 3) || !vector(transform.rotation, 4) || !vector(transform.scale, 3) || transform.scale.some((item) => item <= 0) || !object(transform.provenance)) return false;
  const transformProvenance = transform.provenance;
  if (!['translationM', 'rotation', 'scale'].every((key) => validateProvenance(transformProvenance[key])) || !idPattern.test(String(value.id)) || typeof value.label !== 'string' || value.label.length > 200 || !['component', 'group', 'annotation'].includes(String(value.nodeType)) || !(value.parentId === null || typeof value.parentId === 'string') || !validateGeometry(value.geometry) || !object(value.properties) || !Object.values(value.properties).every(validateProperty)) return false;
  const norm = Math.hypot(...transform.rotation);
  if (norm < 0.999 || norm > 1.001) return false;
  if (value.nodeType === 'component') {
    if (!object(value.component) || typeof value.component.kind !== 'string' || !idPattern.test(value.component.kind) || !Array.isArray(value.component.dependsOn) || !value.component.dependsOn.every((id) => typeof id === 'string' && idPattern.test(id)) || !object(value.component.properties) || !Object.values(value.component.properties).every(validateProperty)) return false;
  } else if (value.component !== null) return false;
  return true;
}
function nodeContainsConfirmedProperty(node: Node): boolean {
  const properties = [...Object.values(node.properties), ...Object.values(node.component?.properties ?? {})];
  return properties.some((property) => property.provenance.validation === 'verified' || property.provenance.validation === 'corrected') || Object.values(node.transform.provenance).some((item) => item.validation === 'verified' || item.validation === 'corrected') || node.geometry?.provenance.validation === 'verified' || node.geometry?.provenance.validation === 'corrected';
}

export function validateSpatialScene(value: unknown): SpatialSceneV1 {
  if (!object(value) || value.schema !== SPATIAL_SCENE_SCHEMA || !idPattern.test(String(value.id)) || typeof value.title !== 'string' || value.title.length > 200 || !object(value.coordinateSystem) || value.coordinateSystem.handedness !== 'right' || value.coordinateSystem.upAxis !== 'Y' || value.coordinateSystem.unit !== 'm' || JSON.stringify(value.coordinateSystem.horizontalPlane) !== '["X","Z"]' || !Array.isArray(value.sourceDocuments) || !Array.isArray(value.nodes) || !Array.isArray(value.relations) || !Array.isArray(value.constraints) || !object(value.revision)) throw new Error('SCENE_SCHEMA_INVALID');
  if (!value.sourceDocuments.every((doc) => object(doc) && idPattern.test(String(doc.documentId)) && doc.schema === 'technical_document.v1' && /^[a-f0-9]{64}$/i.test(String(doc.sha256)) && doc.immutable === true) || new Set(value.sourceDocuments.map((doc) => object(doc) ? doc.documentId : null)).size !== value.sourceDocuments.length) throw new Error('SCENE_SOURCE_DOCUMENT_INVALID');
  const sourceDocumentIds = new Set(value.sourceDocuments.map((doc) => object(doc) ? String(doc.documentId) : ''));
  const provenanceReferencesValid = (candidate: unknown): boolean => validateProvenance(candidate) && (candidate.documentRef === undefined || sourceDocumentIds.has(candidate.documentRef.documentId));
  const nodeIds = value.nodes.map((node) => object(node) ? node.id : undefined);
  if (!value.nodes.every(validateNode) || new Set(nodeIds).size !== nodeIds.length) throw new Error('SCENE_NODE_INVALID_OR_DUPLICATE');
  for (const node of value.nodes as Node[]) {
    const properties = [...Object.values(node.properties), ...Object.values(node.component?.properties ?? {})];
    if (properties.some((item) => !provenanceReferencesValid(item.provenance))) throw new Error('SCENE_PROVENANCE_REFERENCE_INVALID');
    if (!Object.values(node.transform.provenance).every(provenanceReferencesValid) || node.geometry && !provenanceReferencesValid(node.geometry.provenance)) throw new Error('SCENE_PROVENANCE_REFERENCE_INVALID');
  }
  const known = new Set(nodeIds as string[]);
  for (const node of value.nodes as Node[]) {
    if (node.parentId && !known.has(node.parentId) || node.component?.dependsOn.some((id) => !known.has(id) || id === node.id)) throw new Error('SCENE_NODE_REFERENCE_INVALID');
  }
  const dependencyGraph = new Map((value.nodes as Node[]).map((node) => [node.id, [...(node.parentId ? [node.parentId] : []), ...(node.component?.dependsOn ?? [])]]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const hasCycle = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    if ((dependencyGraph.get(id) ?? []).some(hasCycle)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  if ([...dependencyGraph.keys()].some(hasCycle)) throw new Error('SCENE_DEPENDENCY_CYCLE');
  const relationIds = value.relations.map((relation) => object(relation) ? relation.id : undefined);
  if (!value.relations.every((relation) => object(relation) && idPattern.test(String(relation.id)) && typeof relation.kind === 'string' && idPattern.test(relation.kind) && known.has(String(relation.fromNodeId)) && known.has(String(relation.toNodeId)) && relation.fromNodeId !== relation.toNodeId && object(relation.properties) && Object.values(relation.properties).every(validateProperty) && validateProvenance(relation.provenance)) || new Set(relationIds).size !== relationIds.length) throw new Error('SCENE_RELATION_INVALID_OR_DUPLICATE');
  if ((value.relations as SceneRelation[]).some((relation) => !provenanceReferencesValid(relation.provenance) || Object.values(relation.properties).some((item) => !provenanceReferencesValid(item.provenance)))) throw new Error('SCENE_PROVENANCE_REFERENCE_INVALID');
  if (!value.constraints.every((constraint) => object(constraint) && idPattern.test(String(constraint.id)) && ['coincident', 'parallel', 'perpendicular', 'distance', 'angle', 'fixed', 'custom'].includes(String(constraint.kind)) && Array.isArray(constraint.nodeIds) && constraint.nodeIds.length >= 1 && constraint.nodeIds.every((id) => known.has(String(id))) && (constraint.value === null || finite(constraint.value)) && (constraint.unit === null || constraint.unit === 'm' || constraint.unit === 'rad') && validateProvenance(constraint.provenance))) throw new Error('SCENE_CONSTRAINT_INVALID');
  if ((value.constraints as GeometricConstraint[]).some((constraint) => !provenanceReferencesValid(constraint.provenance))) throw new Error('SCENE_PROVENANCE_REFERENCE_INVALID');
  const allEntityIds = [...nodeIds, ...relationIds, ...value.constraints.map((constraint) => object(constraint) ? constraint.id : undefined)];
  if (new Set(allEntityIds).size !== allEntityIds.length) throw new Error('SCENE_ENTITY_ID_DUPLICATE');
  if (value.imageWorldMapping !== null) {
    const mapping = value.imageWorldMapping;
    if (!object(mapping) || !/^[a-f0-9]{64}$/i.test(String(mapping.sourceImageSha256)) || !object(mapping.imageSizePx) || !Number.isInteger(mapping.imageSizePx.width) || Number(mapping.imageSizePx.width) <= 0 || !Number.isInteger(mapping.imageSizePx.height) || Number(mapping.imageSizePx.height) <= 0 || !vector(mapping.pixelToWorldXZ, 6) || Math.abs(mapping.pixelToWorldXZ[0]! * mapping.pixelToWorldXZ[4]! - mapping.pixelToWorldXZ[1]! * mapping.pixelToWorldXZ[3]!) < 1e-12 || !finite(mapping.worldY) || !validateProvenance(mapping.provenance)) throw new Error('SCENE_IMAGE_MAPPING_INVALID');
  }
  const revision = value.revision;
  if (!idPattern.test(String(revision.id)) || !Number.isSafeInteger(revision.number) || Number(revision.number) < 0 || !(revision.parentId === null || idPattern.test(String(revision.parentId))) || !(revision.operationId === null || idPattern.test(String(revision.operationId))) || !Number.isFinite(Date.parse(String(revision.createdAt))) || typeof revision.createdBy !== 'string' || !revision.createdBy.trim()) throw new Error('SCENE_REVISION_INVALID');
  return structuredClone(value) as unknown as SpatialSceneV1;
}

export function serializeSpatialScene(scene: SpatialSceneV1): string { return JSON.stringify(validateSpatialScene(scene)); }
export function deserializeSpatialScene(serialized: string): SpatialSceneV1 {
  let parsed: unknown;
  try { parsed = JSON.parse(serialized); } catch { throw new Error('SCENE_JSON_INVALID'); }
  return validateSpatialScene(parsed);
}

function sceneWithRevision(scene: SpatialSceneV1, operationId: string, createdBy: string, clock: () => Date = () => new Date()): SpatialSceneV1 {
  const at = clock().toISOString();
  const number = scene.revision.number + 1;
  return { ...scene, revision: { id: `${scene.id}:r${number}`, number, parentId: scene.revision.id, operationId: `${scene.id}:op${number}:${operationId}`, createdAt: at, createdBy } };
}
function restoreRevision(snapshot: SpatialSceneV1, current: SpatialSceneV1, operationId: 'Undo' | 'Redo', clock: () => Date = () => new Date()): SpatialSceneV1 {
  const at = clock().toISOString();
  const number = current.revision.number + 1;
  return { ...structuredClone(snapshot), revision: { id: `${current.id}:r${number}`, number, parentId: current.revision.id, operationId: `${current.id}:op${number}:${operationId}`, createdAt: at, createdBy: 'user' } };
}
function multiplyQuaternion(left: number[], right: number[]): [number, number, number, number] {
  const [x1, y1, z1, w1] = left as [number, number, number, number];
  const [x2, y2, z2, w2] = right as [number, number, number, number];
  return [w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2, w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2];
}
/**
 * Proveniência de um valor que um comando acabou de reescrever. Um valor confirmado (verified ou corrected) nunca passa a
 * unreviewed: fica corrected com o valor anterior; o id da autorização e a evidência definitiva entram no commit.
 */
function rewrittenProvenance(current: PropertyProvenance, previousValue: unknown, actor: string, clock: () => Date): PropertyProvenance {
  const recordedAt = clock().toISOString();
  return isConfirmedValidation(current.validation)
    ? { source: 'user', validation: 'corrected', sourceValue: previousValue, evidence: PENDING_AUTHORIZATION_EVIDENCE, actor, recordedAt }
    : { source: 'user', validation: 'unreviewed', actor, recordedAt };
}
function applyCommand(scene: SpatialSceneV1, command: SpatialCommand, actor: string, clock: () => Date): SpatialSceneV1 {
  const nodes = scene.nodes.map((node) => structuredClone(node));
  let relations = structuredClone(scene.relations);
  let constraints = structuredClone(scene.constraints);
  const node = 'nodeId' in command ? nodes.find((item) => item.id === command.nodeId) : undefined;
  switch (command.type) {
    case 'AddComponent': nodes.push(structuredClone(command.node)); break;
    case 'UpdateGeometry': {
      if (!node!.geometry) throw new Error('CONFIRMED_GEOMETRY_LOCKED');
      // Geometria confirmada já não é um bloqueio absoluto: altera-se com autorização e fica corrected, como o resto.
      node!.geometry = isConfirmedValidation(node!.geometry.provenance.validation)
        ? { ...structuredClone(command.geometry), provenance: rewrittenProvenance(node!.geometry.provenance, structuredClone(withoutProvenance(node!.geometry)), actor, clock) }
        : structuredClone(command.geometry);
      break;
    }
    case 'RemoveComponent': {
      const target = nodes.find((item) => item.id === command.nodeId)!;
      const dependent = nodes.some((item) => item.parentId === target.id || item.component?.dependsOn.includes(target.id));
      const referenced = relations.some((item) => item.fromNodeId === target.id || item.toNodeId === target.id) || constraints.some((item) => item.nodeIds.includes(target.id));
      if (dependent || referenced) throw new Error('REMOVE_HAS_DEPENDENCIES');
      return sceneWithRevision({ ...scene, nodes: nodes.filter((item) => item.id !== target.id) }, command.type, actor, clock);
    }
    case 'MoveComponent': node!.transform.provenance.translationM = rewrittenProvenance(node!.transform.provenance.translationM, [...node!.transform.translationM], actor, clock); node!.transform.translationM = [...command.translationM]; break;
    case 'RotateComponent': {
      const previousRotation = [...node!.transform.rotation];
      const norm = Math.hypot(...command.axis);
      const half = command.angleRad / 2;
      const delta = command.axis.map((value) => value / norm * Math.sin(half)).concat(Math.cos(half));
      const rotated = multiplyQuaternion(delta, node!.transform.rotation);
      const length = Math.hypot(...rotated);
      node!.transform.rotation = rotated.map((item) => item / length) as Transform['rotation'];
      node!.transform.provenance.rotation = rewrittenProvenance(node!.transform.provenance.rotation, previousRotation, actor, clock);
      break;
    }
    case 'ResizeComponent': {
      if (!node!.geometry) throw new Error('RESIZE_GEOMETRY_REQUIRED');
      const previousGeometry = structuredClone(withoutProvenance(node!.geometry));
      if (node!.geometry.kind === 'box') node!.geometry.sizeM = node!.geometry.sizeM.map((item, index) => item * command.scale[index]!) as [number, number, number];
      else if (node!.geometry.kind === 'segment') {
        if (command.scale[1] !== 1 || command.scale[2] !== 1) throw new Error('SEGMENT_RESIZE_AXIS_UNSUPPORTED');
        node!.geometry.lengthM *= command.scale[0];
      }
      else if (node!.geometry.kind === 'mesh_reference') node!.geometry.boundsM = node!.geometry.boundsM.map((item, index) => item * command.scale[index]!) as [number, number, number];
      else throw new Error('RESIZE_GEOMETRY_UNSUPPORTED');
      node!.geometry.provenance = rewrittenProvenance(node!.geometry.provenance, previousGeometry, actor, clock);
      break;
    }
    case 'UpdateParameter': {
      const current = node!.component?.properties[command.property] ?? node!.properties[command.property];
      if (typeof command.value === 'number' && !finite(command.value) || command.unit !== undefined && !unitSet.has(command.unit)) throw new Error('PARAMETER_VALUE_INVALID');
      // Um valor confirmado (verified ou corrected) nunca passa a unreviewed: fica corrected, com o valor anterior.
      // A autorização em si é verificada no commit, que é quem acrescenta o id e a evidência definitiva.
      const confirmed = !!current && isConfirmedValidation(current.provenance.validation);
      const next: SpatialProperty = { value: command.value, ...(command.unit ? { unit: command.unit } : {}), provenance: { source: 'user', validation: confirmed ? 'corrected' : 'unreviewed', ...(confirmed ? { sourceValue: current.value, sourceUnit: current.unit, evidence: PENDING_AUTHORIZATION_EVIDENCE } : {}), actor, recordedAt: clock().toISOString() } };
      if (node!.component && Object.hasOwn(node!.component.properties, command.property)) node!.component.properties[command.property] = next;
      else node!.properties[command.property] = next;
      break;
    }
    case 'ConfirmParameter': {
      const current = node!.component?.properties[command.property] ?? node!.properties[command.property];
      if (!current || !command.note.trim() || command.note.length > 500 || current.provenance.validation === 'rejected') throw new Error('PARAMETER_CONFIRMATION_INVALID');
      const confirmed: SpatialProperty = { ...current, provenance: { source: 'user', validation: 'verified', ...(current.provenance.documentRef ? { documentRef: current.provenance.documentRef } : {}), sourceValue: current.value, sourceUnit: current.unit, evidence: command.note.trim(), actor, recordedAt: clock().toISOString() } };
      if (node!.component && Object.hasOwn(node!.component.properties, command.property)) node!.component.properties[command.property] = confirmed;
      else node!.properties[command.property] = confirmed;
      break;
    }
    case 'ConnectComponents': relations.push(structuredClone(command.relation)); break;
    case 'DisconnectComponents': relations = relations.filter((relation) => relation.id !== command.relationId); break;
    case 'Undo': case 'Redo': throw new Error('HISTORY_COMMAND_REQUIRES_TRANSACTION');
  }
  return sceneWithRevision({ ...scene, nodes, relations, constraints }, command.type, actor, clock);
}

export function createSceneTransaction(scene: unknown): SceneTransaction {
  return { scene: validateSpatialScene(scene), undoStack: [], redoStack: [] };
}
export function serializeSceneTransaction(transaction: SceneTransaction): string {
  const scenes = [transaction.scene, ...transaction.undoStack, ...transaction.redoStack].map(validateSpatialScene);
  if (transaction.undoStack.length > 100 || transaction.redoStack.length > 100 || scenes.some((scene) => scene.id !== transaction.scene.id)) throw new Error('SCENE_TRANSACTION_INVALID');
  const serialized = JSON.stringify({ schema: 'spatial_scene_transaction.v1', scene: scenes[0], undoStack: scenes.slice(1, transaction.undoStack.length + 1), redoStack: scenes.slice(transaction.undoStack.length + 1) });
  if (new TextEncoder().encode(serialized).byteLength > 16 * 1024 * 1024) throw new Error('SCENE_TRANSACTION_TOO_LARGE');
  return serialized;
}
export function deserializeSceneTransaction(serialized: string): SceneTransaction {
  if (new TextEncoder().encode(serialized).byteLength > 16 * 1024 * 1024) throw new Error('SCENE_TRANSACTION_TOO_LARGE');
  let candidate: unknown;
  try { candidate = JSON.parse(serialized); } catch { throw new Error('SCENE_TRANSACTION_JSON_INVALID'); }
  if (!object(candidate) || candidate.schema !== 'spatial_scene_transaction.v1' || !Array.isArray(candidate.undoStack) || !Array.isArray(candidate.redoStack) || candidate.undoStack.length > 100 || candidate.redoStack.length > 100) throw new Error('SCENE_TRANSACTION_INVALID');
  const transaction = { scene: validateSpatialScene(candidate.scene), undoStack: candidate.undoStack.map(validateSpatialScene), redoStack: candidate.redoStack.map(validateSpatialScene) };
  if ([transaction.scene, ...transaction.undoStack, ...transaction.redoStack].some((scene) => scene.id !== transaction.scene.id)) throw new Error('SCENE_TRANSACTION_INVALID');
  return transaction;
}

/** Converts only an explicit, matching four-bar length instruction; the result is still preview-only. */
export function conversationEditToSceneCommand(message: string, selected: BarName | undefined, action: SpatialAction): ConversationSceneCommand {
  const parsed = parseSpatialCommand(message.replace(/^\s*(?:por favor|podes|pode)\s*[, ]+\s*/i, ''), selected);
  if (parsed.status !== 'recognized' || parsed.action.kind !== 'update_length' || action.kind !== 'update_length' || parsed.action.componentId !== action.componentId || parsed.action.value !== action.value || parsed.action.unit !== action.unit) return { status: 'blocked', reason: 'A proposta não corresponde a uma instrução explícita de alteração de comprimento.' };
  return { status: 'ready', command: { type: 'UpdateParameter', nodeId: action.componentId, property: 'length', value: action.value, unit: action.unit } };
}
/** Comandos cuja alteração de valores confirmados já passa pela guarda. */
const GUARDED_COMMANDS = new Set<SpatialCommand['type']>(['UpdateParameter', 'MoveComponent', 'RotateComponent', 'ResizeComponent', 'UpdateGeometry', 'RemoveComponent', 'DisconnectComponents']);

export function previewSceneCommand(transaction: SceneTransaction, command: SpatialCommand, actor = 'user', clock: () => Date = () => new Date(), context?: SceneCommandContext): ScenePreview {
  const resolved: SceneCommandContext = context ?? { origin: 'ui_direct', actor: { kind: 'human', id: actor } };
  const blocked: Pick<ScenePreview, 'operation' | 'operationDigest' | 'touchesConfirmed' | 'requiresAuthorization'> = { operation: null, operationDigest: null, touchesConfirmed: [], requiresAuthorization: false };
  const issues: SceneIssue[] = [];
  const evaluatedAt = clock().toISOString();
  const fixedClock = () => new Date(evaluatedAt);
  try {
    if (command.type === 'Undo' || command.type === 'Redo') {
      const available = command.type === 'Undo' ? transaction.undoStack.length : transaction.redoStack.length;
      if (!available) throw new Error(command.type === 'Undo' ? 'UNDO_EMPTY' : 'REDO_EMPTY');
      const restored = validateSpatialScene(transaction[command.type === 'Undo' ? 'undoStack' : 'redoStack'][available - 1]);
      const historyOperation = sceneOperation(transaction.scene, restored, command.type);
      return { status: 'ready', baseRevisionId: transaction.scene.revision.id, evaluatedAt, actor, command, candidate: restored, issues, context: resolved, operation: historyOperation, operationDigest: operationDigest(historyOperation), touchesConfirmed: [], requiresAuthorization: false };
    }
    if ('nodeId' in command && !transaction.scene.nodes.some((node) => node.id === command.nodeId)) throw new Error('NODE_NOT_FOUND');
    if (command.type === 'AddComponent' && transaction.scene.nodes.some((node) => node.id === command.node.id)) throw new Error('DUPLICATE_NODE_ID');
    if (command.type === 'AddComponent' && !validateNode(command.node)) throw new Error('COMPONENT_INVALID');
    if (command.type === 'AddComponent' && nodeContainsConfirmedProperty(command.node)) throw new Error('NEW_COMPONENT_CANNOT_CLAIM_HUMAN_VERIFICATION');
    if (command.type === 'UpdateGeometry' && (!validateGeometry(command.geometry) || command.geometry === null)) throw new Error('GEOMETRY_INVALID');
    if (command.type === 'UpdateGeometry' && isConfirmedValidation(command.geometry.provenance.validation)) throw new Error('NEW_GEOMETRY_CANNOT_CLAIM_HUMAN_VERIFICATION');
    if (command.type === 'MoveComponent' && !vector(command.translationM, 3)) throw new Error('TRANSLATION_INVALID');
    if (command.type === 'RotateComponent' && (!vector(command.axis, 3) || Math.hypot(...command.axis) < 1e-9 || !finite(command.angleRad) || Math.abs(command.angleRad) > Math.PI * 100)) throw new Error('ROTATION_INVALID');
    if (command.type === 'ResizeComponent' && (!vector(command.scale, 3) || command.scale.some((value) => value <= 0))) throw new Error('SCALE_INVALID');
    if (command.type === 'UpdateParameter' && (!idPattern.test(command.property) || !['string', 'number', 'boolean'].includes(typeof command.value) && command.value !== null || command.unit !== undefined && !unitSet.has(command.unit))) throw new Error('PARAMETER_INVALID');
    if (command.type === 'ConfirmParameter' && (!idPattern.test(command.property) || typeof command.note !== 'string' || !command.note.trim() || command.note.length > 500)) throw new Error('PARAMETER_CONFIRMATION_INVALID');
    if (command.type === 'ConnectComponents' && (!transaction.scene.nodes.some((node) => node.id === command.relation.fromNodeId) || !transaction.scene.nodes.some((node) => node.id === command.relation.toNodeId))) throw new Error('RELATION_ENDPOINT_NOT_FOUND');
    if (command.type === 'DisconnectComponents' && !transaction.scene.relations.some((relation) => relation.id === command.relationId)) throw new Error('RELATION_NOT_FOUND');
    if (command.type === 'ConnectComponents' && (command.relation.provenance.validation === 'verified' || Object.values(command.relation.properties).some((property) => property.provenance.validation === 'verified' || property.provenance.validation === 'corrected'))) throw new Error('NEW_RELATION_CANNOT_CLAIM_HUMAN_VERIFICATION');
    const candidate = validateSpatialScene(applyCommand(transaction.scene, command, resolved.actor.id, fixedClock));
    const touchesConfirmed = GUARDED_COMMANDS.has(command.type) ? touchedConfirmed(transaction.scene, candidate) : [];
    const operation = sceneOperation(transaction.scene, candidate, command.type);
    return { status: 'ready', baseRevisionId: transaction.scene.revision.id, evaluatedAt, actor, command: structuredClone(command), candidate, issues, context: resolved, operation, operationDigest: operationDigest(operation), touchesConfirmed, requiresAuthorization: touchesConfirmed.length > 0 };
  } catch (error) {
    issues.push({ code: error instanceof Error ? error.message : 'COMMAND_INVALID', path: 'command', message: error instanceof Error ? error.message : 'Comando inválido.' });
    return { status: 'blocked', baseRevisionId: transaction.scene.revision.id, evaluatedAt, actor, command: structuredClone(command), candidate: null, issues, context: resolved, ...blocked };
  }
}
export function commitScenePreview(transaction: SceneTransaction, preview: ScenePreview, options: SceneCommitOptions = {}): SceneTransaction {
  if (preview.status !== 'ready' || !preview.candidate) throw new Error('PREVIEW_BLOCKED');
  if (preview.baseRevisionId !== transaction.scene.revision.id) throw new Error('STALE_PREVIEW');
  const replay = previewSceneCommand(transaction, preview.command, preview.actor, () => new Date(preview.evaluatedAt), preview.context);
  if (replay.status !== 'ready' || !replay.candidate || JSON.stringify(validateSpatialScene(replay.candidate)) !== JSON.stringify(validateSpatialScene(preview.candidate))) throw new Error('PREVIEW_TAMPERED');
  // O que foi mostrado (operação e digest) tem de ser o que se obtém ao refazer o preview agora.
  if (!replay.operation || replay.operationDigest !== preview.operationDigest || JSON.stringify(replay.operation) !== JSON.stringify(preview.operation)) throw new Error('PREVIEW_TAMPERED');
  if (preview.command.type === 'Undo') {
    const prior = transaction.undoStack.at(-1);
    if (!prior) throw new Error('UNDO_EMPTY');
    const restored = restoreRevision(prior, transaction.scene, 'Undo', () => new Date(preview.evaluatedAt));
    return { scene: restored, undoStack: transaction.undoStack.slice(0, -1), redoStack: [...transaction.redoStack.slice(-99), transaction.scene] };
  }
  if (preview.command.type === 'Redo') {
    const next = transaction.redoStack.at(-1);
    if (!next) throw new Error('REDO_EMPTY');
    const restored = restoreRevision(next, transaction.scene, 'Redo', () => new Date(preview.evaluatedAt));
    return { scene: restored, undoStack: [...transaction.undoStack.slice(-99), transaction.scene], redoStack: transaction.redoStack.slice(0, -1) };
  }
  let scene = validateSpatialScene(preview.candidate);
  // O que exige autorização é o que o replay diz, nunca o que o preview traz.
  if (replay.requiresAuthorization) {
    if (!options.ledger) throw new AuthorizationError('AUTHORIZATION_REQUIRED');
    const authorization = options.ledger.consume(options.authorizationId, replay.operation);
    scene = validateSpatialScene(stampAuthorization(transaction.scene, scene, replay.touchesConfirmed, authorization.id));
  }
  return { scene, undoStack: [...transaction.undoStack.slice(-99), transaction.scene], redoStack: [] };
}
export function executeSceneCommand(transaction: SceneTransaction, command: SpatialCommand, actor = 'user', clock?: () => Date, options: SceneCommitOptions & { context?: SceneCommandContext } = {}): { transaction: SceneTransaction; preview: ScenePreview } {
  const preview = previewSceneCommand(transaction, command, actor, clock, options.context);
  if (preview.status === 'blocked') throw new Error(preview.issues[0]?.code ?? 'COMMAND_BLOCKED');
  return { transaction: commitScenePreview(transaction, preview, options), preview };
}

/**
 * Passo interno de uma operação composta (editar uma parede, remover uma parede e os seus dependentes): valida e aplica o
 * comando mas NÃO pede autorização. Quem a usa tem de calcular o agregado e autorizá-lo de uma vez (ver `plan-scene.ts`);
 * os bloqueios por origem continuam a valer porque vêm do preview.
 */
export function stageSceneCommand(transaction: SceneTransaction, command: SpatialCommand, actor: string, clock: () => Date, context?: SceneCommandContext): SceneTransaction {
  const preview = previewSceneCommand(transaction, command, actor, clock, context);
  if (preview.status === 'blocked' || !preview.candidate) throw new Error(preview.issues[0]?.code ?? 'COMMAND_BLOCKED');
  return { scene: validateSpatialScene(preview.candidate), undoStack: [...transaction.undoStack.slice(-99), transaction.scene], redoStack: [] };
}
