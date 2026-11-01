import { validateSpatialScene, type Node, type PropertyProvenance, type SpatialSceneV1, type VerificationState } from '../../src/spatial-scene';

export const at = '2026-01-01T00:00:00.000Z';
export const later = '2026-02-02T00:00:00.000Z';
export const clock = () => new Date(later);

const base: PropertyProvenance = { source: 'user', validation: 'unreviewed', recordedAt: at };

/** Proveniência válida para cada estado; verified/corrected exigem actor, evidência e (corrected) sourceValue. */
export function provenanceFor(validation: VerificationState): PropertyProvenance {
  if (validation === 'verified') return { source: 'user', validation, actor: 'reviewer', evidence: 'Confirmado em obra.', recordedAt: at };
  if (validation === 'corrected') return { source: 'user', validation, actor: 'reviewer', evidence: 'Corrigido em obra.', sourceValue: 0.15, sourceUnit: 'm', recordedAt: at };
  return { ...base, validation };
}

const quantity = (value: number, validation: VerificationState = 'unreviewed') => ({ value, unit: 'm', provenance: provenanceFor(validation) });

export function wallNode(id = 'wall-1'): Node {
  const p = provenanceFor('unreviewed');
  return {
    id, label: 'Parede 1', nodeType: 'component', parentId: null,
    transform: { translationM: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], provenance: { translationM: p, rotation: p, scale: p } },
    geometry: { kind: 'box', sizeM: [4, 2.7, 0.2], provenance: p },
    component: { kind: 'wall', dependsOn: [], properties: { thickness: quantity(0.2), length: quantity(4) } },
    properties: { note: { value: 'reboco', provenance: p } },
  };
}

export function doorNode(id = 'door-1', wallId = 'wall-1'): Node {
  const p = provenanceFor('unreviewed');
  return {
    id, label: 'Porta', nodeType: 'component', parentId: null,
    transform: { translationM: [1, 1, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], provenance: { translationM: p, rotation: p, scale: p } },
    geometry: { kind: 'box', sizeM: [0.9, 2.1, 0.04], provenance: p },
    component: { kind: 'door', dependsOn: [wallId], properties: { offset: quantity(0.5), width: quantity(0.9), height: quantity(2.1), sill: quantity(0) } },
    properties: {},
  };
}

/** Parede com uma porta que depende dela; tudo `unreviewed`. */
export function makeScene(id = 'scene-1', revision = 0): SpatialSceneV1 {
  return validateSpatialScene({
    schema: 'spatial_scene.v1', id, title: 'Cena de teste',
    coordinateSystem: { handedness: 'right', upAxis: 'Y', horizontalPlane: ['X', 'Z'], unit: 'm' },
    sourceDocuments: [], imageWorldMapping: null,
    nodes: [wallNode(), doorNode()], relations: [], constraints: [],
    revision: { id: `${id}:r${revision}`, number: revision, parentId: revision === 0 ? null : `${id}:r${revision - 1}`, operationId: null, createdAt: at, createdBy: 'fixture' },
  });
}

/** Os sítios onde `spatial_scene.v1` guarda valores que podem estar confirmados. */
export type ConfirmedLocation = {
  name: string;
  nodeId: string;
  field: string;
  /** Marca o valor nesse sítio como `validation`. */
  confirm(scene: SpatialSceneV1, validation: VerificationState): void;
  /** Altera o valor nesse sítio como um comando o faria (valor novo, proveniência `unreviewed`). */
  change(scene: SpatialSceneV1): void;
};
const node = (scene: SpatialSceneV1, id: string) => scene.nodes.find((item) => item.id === id)!;
export const CONFIRMED_LOCATIONS: ConfirmedLocation[] = [
  { name: 'component.properties', nodeId: 'wall-1', field: 'component.properties.thickness',
    confirm: (s, v) => { node(s, 'wall-1').component!.properties.thickness!.provenance = provenanceFor(v); },
    change: (s) => { node(s, 'wall-1').component!.properties.thickness = quantity(0.3); } },
  { name: 'node.properties', nodeId: 'wall-1', field: 'properties.note',
    confirm: (s, v) => { node(s, 'wall-1').properties.note!.provenance = provenanceFor(v); },
    change: (s) => { node(s, 'wall-1').properties.note = { value: 'tijolo', provenance: provenanceFor('unreviewed') }; } },
  { name: 'geometry', nodeId: 'wall-1', field: 'geometry',
    confirm: (s, v) => { node(s, 'wall-1').geometry!.provenance = provenanceFor(v); },
    change: (s) => { const g = node(s, 'wall-1').geometry; if (g?.kind === 'box') { g.sizeM = [5, 2.7, 0.2]; g.provenance = provenanceFor('unreviewed'); } } },
  { name: 'transform.translationM', nodeId: 'wall-1', field: 'transform.translationM',
    confirm: (s, v) => { node(s, 'wall-1').transform.provenance.translationM = provenanceFor(v); },
    change: (s) => { const n = node(s, 'wall-1'); n.transform.translationM = [1, 0, 0]; n.transform.provenance.translationM = provenanceFor('unreviewed'); } },
  { name: 'transform.rotation', nodeId: 'wall-1', field: 'transform.rotation',
    confirm: (s, v) => { node(s, 'wall-1').transform.provenance.rotation = provenanceFor(v); },
    change: (s) => { const n = node(s, 'wall-1'); n.transform.rotation = [0, Math.SQRT1_2, 0, Math.SQRT1_2]; n.transform.provenance.rotation = provenanceFor('unreviewed'); } },
  { name: 'transform.scale', nodeId: 'wall-1', field: 'transform.scale',
    confirm: (s, v) => { node(s, 'wall-1').transform.provenance.scale = provenanceFor(v); },
    change: (s) => { const n = node(s, 'wall-1'); n.transform.scale = [2, 1, 1]; n.transform.provenance.scale = provenanceFor('unreviewed'); } },
];
