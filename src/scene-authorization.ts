import { canonicalize, type CanonicalChange, type CanonicalOperation } from './core';
import type { PropertyProvenance, SpatialSceneV1, VerificationState } from './spatial-scene';

/**
 * Ponte entre a cena espacial e o Core: transforma "cena base → cena candidata" numa operação canónica
 * (a que o humano autoriza e o commit volta a verificar) e diz que valores confirmados essa mudança toca.
 *
 * Só há uma guarda: a diferença entre as duas cenas. Qualquer valor que era `verified` ou `corrected` na base
 * e que no candidato mudou, mudou de proveniência ou desapareceu conta como tocado, seja qual for o comando
 * (ou a sequência de comandos) que o provocou, incluindo dependentes removidos ou alterados em cascata.
 *
 * Este módulo importa o Core; o Core não conhece nada daqui. Só importa tipos de `spatial-scene`.
 */

export type ConfirmedValidation = Extract<VerificationState, 'verified' | 'corrected'>;
/** Um valor confirmado que uma operação toca. `field` é um caminho dentro da entidade, por exemplo `geometry`. */
export type ConfirmedReference = { entityId: string; field: string; validation: ConfirmedValidation };

type FieldState = {
  entityId: string;
  field: string;
  /** O valor sem proveniência; é o que entra no digest. */
  value: unknown;
  validation: VerificationState | null;
  /** A proveniência inteira, só para detectar que foi reescrita. Nunca entra no digest. */
  provenance: unknown;
};

export function isConfirmedValidation(validation: unknown): validation is ConfirmedValidation {
  return validation === 'verified' || validation === 'corrected';
}

const quantity = (property: { value: unknown; unit?: string }) => ({ value: property.value, unit: property.unit ?? null });
const withoutProvenance = <T extends { provenance: PropertyProvenance }>(item: T): Omit<T, 'provenance'> => {
  const { provenance: _provenance, ...rest } = item;
  return rest;
};

/** Todos os campos da cena que uma operação pode alterar ou apagar, um a um. */
function fieldStates(scene: SpatialSceneV1): Map<string, FieldState> {
  const states = new Map<string, FieldState>();
  const add = (entityId: string, field: string, value: unknown, provenance: PropertyProvenance | null) => {
    states.set(`${entityId}\u0000${field}`, { entityId, field, value, validation: provenance?.validation ?? null, provenance });
  };
  for (const node of scene.nodes) {
    add(node.id, 'node', { nodeType: node.nodeType, label: node.label, kind: node.component?.kind ?? null }, null);
    add(node.id, 'parentId', node.parentId, null);
    if (node.component) add(node.id, 'component.dependsOn', [...node.component.dependsOn].sort(), null);
    for (const key of ['translationM', 'rotation', 'scale'] as const) add(node.id, `transform.${key}`, node.transform[key], node.transform.provenance[key]);
    add(node.id, 'geometry', node.geometry ? withoutProvenance(node.geometry) : null, node.geometry?.provenance ?? null);
    for (const [key, property] of Object.entries(node.properties)) add(node.id, `properties.${key}`, quantity(property), property.provenance);
    for (const [key, property] of Object.entries(node.component?.properties ?? {})) add(node.id, `component.properties.${key}`, quantity(property), property.provenance);
  }
  for (const relation of scene.relations) {
    add(relation.id, 'relation', { fromNodeId: relation.fromNodeId, toNodeId: relation.toNodeId, kind: relation.kind }, relation.provenance);
    for (const [key, property] of Object.entries(relation.properties)) add(relation.id, `properties.${key}`, quantity(property), property.provenance);
  }
  for (const constraint of scene.constraints) {
    add(constraint.id, 'constraint', { kind: constraint.kind, nodeIds: [...constraint.nodeIds].sort(), value: constraint.value, unit: constraint.unit }, constraint.provenance);
  }
  return states;
}

const byEntityThenField = (a: { entityId: string; field: string }, b: { entityId: string; field: string }) =>
  a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : a.field < b.field ? -1 : a.field > b.field ? 1 : 0;

type Difference = { before: FieldState | undefined; after: FieldState | undefined };
function differences(base: SpatialSceneV1, candidate: SpatialSceneV1): Difference[] {
  const before = fieldStates(base);
  const after = fieldStates(candidate);
  const result: Difference[] = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(key);
    const b = after.get(key);
    if (!a || !b || canonicalize(a.value) !== canonicalize(b.value) || canonicalize(a.provenance) !== canonicalize(b.provenance)) result.push({ before: a, after: b });
  }
  return result.sort((x, y) => byEntityThenField((x.before ?? x.after)!, (y.before ?? y.after)!));
}

/** Os valores confirmados na base que a cena candidata altera, reescreve ou apaga. */
export function touchedConfirmed(base: SpatialSceneV1, candidate: SpatialSceneV1): ConfirmedReference[] {
  return differences(base, candidate).flatMap(({ before }) =>
    before && isConfirmedValidation(before.validation) ? [{ entityId: before.entityId, field: before.field, validation: before.validation }] : []);
}

/** O que muda, campo a campo, com o valor e o estado de validação antes e depois. Sem datas nem actores. */
export function sceneChanges(base: SpatialSceneV1, candidate: SpatialSceneV1): CanonicalChange[] {
  const describe = (state: FieldState | undefined) => (state ? { value: state.value, validation: state.validation } : null);
  return differences(base, candidate).map(({ before, after }) => ({ entityId: (before ?? after)!.entityId, field: (before ?? after)!.field, from: describe(before), to: describe(after) }));
}

/** Tudo o que depende, directa ou indirectamente, das entidades dadas (filhos, `dependsOn` e relações ligadas). */
function withDependents(ids: Set<string>, ...scenes: SpatialSceneV1[]): string[] {
  const affected = new Set(ids);
  for (let grew = true; grew;) {
    grew = false;
    for (const scene of scenes) {
      for (const node of scene.nodes) {
        if (!affected.has(node.id) && ((node.parentId && affected.has(node.parentId)) || node.component?.dependsOn.some((id) => affected.has(id)))) { affected.add(node.id); grew = true; }
      }
      for (const relation of scene.relations) {
        if (!affected.has(relation.id) && (affected.has(relation.fromNodeId) || affected.has(relation.toNodeId))) { affected.add(relation.id); grew = true; }
      }
    }
  }
  return [...affected];
}

/**
 * A operação que o humano vê e autoriza. `affected` inclui os dependentes em cascata: se a lista deles mudar
 * entre o preview e o commit, o digest muda e a autorização deixa de servir.
 */
export function sceneOperation(base: SpatialSceneV1, candidate: SpatialSceneV1, name: string): CanonicalOperation {
  const changes = sceneChanges(base, candidate);
  return {
    domain: 'architecture',
    name,
    subjectId: base.id,
    baseRevisionId: base.revision.id,
    changes,
    affected: withDependents(new Set(changes.map((change) => change.entityId)), base, candidate).sort(),
  };
}

type ProvenanceHolder = { get(): PropertyProvenance; set(next: PropertyProvenance): void };

function holderAt(scene: SpatialSceneV1, entityId: string, field: string): ProvenanceHolder | undefined {
  const node = scene.nodes.find((item) => item.id === entityId);
  if (node) {
    if (field === 'geometry' && node.geometry) { const geometry = node.geometry; return { get: () => geometry.provenance, set: (next) => { geometry.provenance = next; } }; }
    const transform = /^transform\.(translationM|rotation|scale)$/.exec(field);
    if (transform) { const key = transform[1] as 'translationM' | 'rotation' | 'scale'; return { get: () => node.transform.provenance[key], set: (next) => { node.transform.provenance[key] = next; } }; }
    const property = /^(component\.properties|properties)\.(.+)$/.exec(field);
    const bag = property ? (property[1] === 'properties' ? node.properties : node.component?.properties) : undefined;
    const item = bag && property ? bag[property[2]!] : undefined;
    return item ? { get: () => item.provenance, set: (next) => { item.provenance = next; } } : undefined;
  }
  const relation = scene.relations.find((item) => item.id === entityId);
  if (relation) {
    if (field === 'relation') return { get: () => relation.provenance, set: (next) => { relation.provenance = next; } };
    const item = /^properties\.(.+)$/.exec(field) ? relation.properties[field.slice('properties.'.length)] : undefined;
    return item ? { get: () => item.provenance, set: (next) => { item.provenance = next; } } : undefined;
  }
  const constraint = scene.constraints.find((item) => item.id === entityId);
  return constraint && field === 'constraint' ? { get: () => constraint.provenance, set: (next) => { constraint.provenance = next; } } : undefined;
}

/**
 * Marca no candidato que os valores confirmados tocados foram alterados com autorização humana: id da autorização e,
 * nos que ficaram `corrected`, o valor original em `sourceValue` e a evidência. O que desapareceu não tem nada a marcar.
 * Se um valor tocado ficou noutro estado que não `corrected`/`verified`, algo promoveu ou despromoveu sem passar pela
 * regra e a operação é recusada.
 */
export function stampAuthorization(base: SpatialSceneV1, candidate: SpatialSceneV1, touched: ConfirmedReference[], authorizationId: string): SpatialSceneV1 {
  const stamped = structuredClone(candidate);
  const originals = fieldStates(base);
  for (const ref of touched) {
    const holder = holderAt(stamped, ref.entityId, ref.field);
    if (!holder) continue;
    const provenance = holder.get();
    if (provenance.validation === 'verified') { holder.set({ ...provenance, authorizationId }); continue; }
    if (provenance.validation !== 'corrected') throw new Error('AUTHORIZED_VALUE_NOT_CORRECTED');
    const original = originals.get(`${ref.entityId}\u0000${ref.field}`)!;
    const isProperty = /^(component\.)?properties\./.test(ref.field);
    const quantityValue = isProperty ? (original.value as { value: unknown; unit: string | null }) : undefined;
    holder.set({
      ...provenance,
      sourceValue: quantityValue ? quantityValue.value : original.value,
      ...(quantityValue?.unit ? { sourceUnit: quantityValue.unit } : {}),
      evidence: `Alteração de um valor confirmado autorizada por um humano (autorização ${authorizationId}); o valor anterior ficou em sourceValue.`,
      authorizationId,
    });
  }
  return stamped;
}

export const PENDING_AUTHORIZATION_EVIDENCE = 'Alteração de um valor confirmado, a aguardar autorização humana.';
