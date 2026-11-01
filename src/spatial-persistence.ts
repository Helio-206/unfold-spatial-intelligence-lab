import { deserializeSceneTransaction, serializeSceneTransaction, type SceneTransaction } from './spatial-scene';

export interface SpatialKeyValueStorage {
  getItem?(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SpatialLockManager {
  request<T>(name: string, options: { mode: 'exclusive' }, callback: () => Promise<T> | T): Promise<T>;
}

function persistUnderLock(storage: SpatialKeyValueStorage, transaction: SceneTransaction, key: string, options: { allowReplace?: boolean; expectedRevisionId?: string | null }): string {
  const serialized = serializeSceneTransaction(transaction);
  const current = storage.getItem?.(key);
  if (current) {
    let stored: SceneTransaction;
    try { stored = deserializeSceneTransaction(current); }
    catch { throw new Error('SCENE_PERSISTENCE_EXISTING_STATE_INVALID'); }
    if (options.allowReplace) {
      if (options.expectedRevisionId === undefined || stored.scene.revision.id !== options.expectedRevisionId) throw new Error('SCENE_PERSISTENCE_CONFLICT');
      if (stored.scene.id !== transaction.scene.id && options.expectedRevisionId === null) throw new Error('SCENE_PERSISTENCE_CONFLICT');
    } else if (stored.scene.id !== transaction.scene.id) {
      throw new Error('SCENE_PERSISTENCE_REPLACEMENT_REQUIRES_CONFIRMATION');
    } else if (current !== serialized && transaction.scene.revision.parentId !== stored.scene.revision.id) {
      throw new Error('SCENE_PERSISTENCE_CONFLICT');
    }
  } else if (transaction.scene.revision.parentId !== null || options.allowReplace && options.expectedRevisionId !== null) throw new Error('SCENE_PERSISTENCE_CONFLICT');
  storage.setItem(key, serialized);
  return serialized;
}

/**
 * Serialize the read/validate/write sequence across tabs. localStorage alone
 * has no compare-and-swap; all application writers must hold this Web Lock.
 * Fail closed on browsers without Web Locks instead of risking lost revisions.
 */
export async function persistSceneTransaction(storage: SpatialKeyValueStorage, transaction: SceneTransaction, key = 'unfold-spatial-scene.v1', options: { allowReplace?: boolean; expectedRevisionId?: string | null } = {}, lockManager: SpatialLockManager | null | undefined = globalThis.navigator?.locks): Promise<string> {
  if (!lockManager) throw new Error('SCENE_PERSISTENCE_CROSS_TAB_LOCK_UNAVAILABLE');
  return lockManager.request(`unfold:scene:${key}`, { mode: 'exclusive' }, () => persistUnderLock(storage, transaction, key, options));
}
