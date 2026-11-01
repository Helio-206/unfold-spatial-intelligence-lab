import { AuthorizationLedger, type CanonicalOperation, type CommandOrigin } from './core';
import type { SceneCommitOptions } from './spatial-scene';

/**
 * O emissor de autorizações da interface. Fica fora do editor para se poder testar sem DOM nem Three.js.
 *
 * LIMITE DE SEGURANÇA: o ledger vive em memória na página. Impede autorizar uma coisa e aplicar outra, e reutilizar uma
 * autorização, mas não é uma fronteira contra código malicioso na mesma página. Com utilizadores remotos, a emissão e o
 * consumo têm de passar para o servidor.
 */
export type ShownOperation = { requiresAuthorization: boolean; operation: CanonicalOperation | null };

export function createSceneAuthorizer(sessionId: string = globalThis.crypto.randomUUID(), humanId = 'local-user-input') {
  const ledger = new AuthorizationLedger({ sessionId });
  return {
    ledger,
    /**
     * Chamar no handler do botão de confirmação, depois de o utilizador ter visto o preview: emite a autorização para a
     * operação mostrada e devolve as opções do commit. Não emite nada se o preview não toca valores confirmados.
     */
    authorize(shown: ShownOperation, origin: CommandOrigin = 'ui_direct'): SceneCommitOptions {
      if (!shown.requiresAuthorization) return {};
      if (!shown.operation) throw new Error('PREVIEW_BLOCKED');
      const authorization = ledger.issue(shown.operation, { kind: 'human', id: humanId }, origin);
      return { ledger, authorizationId: authorization.id };
    },
  };
}
