import { AuthorizationLedger, type Actor, type CanonicalOperation } from '../../src/core';
import { createSceneTransaction, serializeSceneTransaction, validateSpatialScene, type SceneTransaction, type SpatialSceneV1, type VerificationState } from '../../src/spatial-scene';
import { CONFIRMED_LOCATIONS, at, makeScene, provenanceFor } from './scenes';

export const human: Actor & { kind: 'human' } = { kind: 'human', id: 'reviewer' };
export const model: Actor = { kind: 'model', id: 'muse-spark-1.3' };

export function newLedger(options: { ttlMs?: number; now?: () => Date } = {}) {
  let n = 0;
  return new AuthorizationLedger({ sessionId: 's1', clock: options.now ?? (() => new Date(at)), newId: () => `auth-${++n}`, ...(options.ttlMs ? { ttlMs: options.ttlMs } : {}) });
}

/** Cena com a parede/porta de `makeScene`, com os sítios pedidos marcados como confirmados. */
export function confirmedScene(spots: Array<{ name: string; validation: VerificationState } | string> = [], revision = 0): SpatialSceneV1 {
  const scene = makeScene('scene-1', revision);
  for (const spot of spots) {
    const { name, validation } = typeof spot === 'string' ? { name: spot, validation: 'verified' as const } : spot;
    CONFIRMED_LOCATIONS.find((location) => location.name === name)!.confirm(scene, validation);
  }
  return validateSpatialScene(scene);
}

export const transactionOf = (scene: SpatialSceneV1): SceneTransaction => createSceneTransaction(scene);
/** Identidade da cena: se isto não mudou, nada foi aplicado. */
export const snapshot = (transaction: SceneTransaction): string => serializeSceneTransaction(transaction);

export function failure(fn: () => unknown): string {
  try { fn(); } catch (error) { return error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : error instanceof Error ? error.message : String(error); }
  return 'NO_ERROR';
}
export type { CanonicalOperation };

/** Parede com a geometria confirmada e uma porta com a largura e a posição confirmadas. */
export function confirmDoorForNotice(): SceneTransaction {
  const scene = structuredClone(confirmedScene(['geometry']));
  const door = scene.nodes.find((node) => node.id === 'door-1')!;
  door.component!.properties.width!.provenance = provenanceFor('verified');
  door.transform.provenance.translationM = provenanceFor('verified');
  return transactionOf(validateSpatialScene(scene));
}
