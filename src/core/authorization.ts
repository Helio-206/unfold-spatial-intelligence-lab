import { canonicalize, sha256Hex } from './canonical';
import type { Actor } from './provenance';

/**
 * Autorização humana ligada ao conteúdo exacto de uma operação.
 *
 * LIMITE DE SEGURANÇA: no browser, o ledger é uma protecção de fluxo (impede autorizar uma coisa e
 * aplicar outra, ou reutilizar uma autorização). Não é uma fronteira de segurança contra código
 * malicioso na mesma página. Com utilizadores remotos, a emissão e o consumo têm de passar para o servidor.
 */

export type CommandOrigin = 'ui_direct' | 'ui_confirmed_proposal' | 'model_proposal' | 'system';

/** Uma alteração tal como foi mostrada no preview. */
export type CanonicalChange = { entityId: string; field: string; from: unknown; to: unknown };

/** A operação canonizada: é isto que o humano aprova e é isto que o commit volta a verificar. */
export type CanonicalOperation = {
  domain: string;
  name: string;
  subjectId: string;
  baseRevisionId: string;
  changes: CanonicalChange[];
  /** Todas as entidades afectadas, incluindo dependentes alterados ou removidos em cascata. */
  affected: string[];
};

export function operationDigest(operation: CanonicalOperation): string {
  const normalized: CanonicalOperation = {
    ...operation,
    changes: [...operation.changes].sort((a, b) => `${a.entityId}\u0000${a.field}`.localeCompare(`${b.entityId}\u0000${b.field}`)),
    affected: [...new Set(operation.affected)].sort(),
  };
  return sha256Hex(canonicalize(normalized));
}

export type HumanAuthorization = {
  id: string;
  digest: string;
  baseRevisionId: string;
  sessionId: string;
  actor: Actor & { kind: 'human' };
  issuedAt: string;
};

export type AuthorizationFailure =
  | 'AUTHORIZATION_REQUIRED'
  | 'AUTHORIZATION_UNKNOWN'
  | 'AUTHORIZATION_ALREADY_USED'
  | 'AUTHORIZATION_EXPIRED'
  | 'AUTHORIZATION_DIGEST_MISMATCH'
  | 'AUTHORIZATION_REVISION_MISMATCH'
  | 'AUTHORIZATION_SESSION_MISMATCH'
  | 'MODEL_CANNOT_AUTHORIZE';

export class AuthorizationError extends Error {
  constructor(readonly code: AuthorizationFailure) {
    super(code);
    this.name = 'AuthorizationError';
  }
}

/** Só pedidos que nasceram de uma acção humana na interface podem pedir autorização. */
export function assertMayAuthorize(origin: CommandOrigin): void {
  if (origin === 'model_proposal' || origin === 'system') throw new AuthorizationError('MODEL_CANNOT_AUTHORIZE');
}

type LedgerOptions = {
  sessionId: string;
  clock?: () => Date;
  newId?: () => string;
  ttlMs?: number;
};

export class AuthorizationLedger {
  private readonly issued = new Map<string, HumanAuthorization>();
  private readonly used = new Set<string>();
  private readonly clock: () => Date;
  private readonly newId: () => string;
  private readonly ttlMs: number;
  readonly sessionId: string;

  constructor(options: LedgerOptions) {
    this.sessionId = options.sessionId;
    this.clock = options.clock ?? (() => new Date());
    this.newId = options.newId ?? (() => globalThis.crypto.randomUUID());
    this.ttlMs = options.ttlMs ?? 5 * 60_000;
  }

  /** Chamado apenas pelo handler do botão de confirmação na interface. */
  issue(operation: CanonicalOperation, actor: Actor & { kind: 'human' }, origin: CommandOrigin): HumanAuthorization {
    assertMayAuthorize(origin);
    const authorization: HumanAuthorization = {
      id: this.newId(),
      digest: operationDigest(operation),
      baseRevisionId: operation.baseRevisionId,
      sessionId: this.sessionId,
      actor,
      issuedAt: this.clock().toISOString(),
    };
    this.issued.set(authorization.id, authorization);
    return authorization;
  }

  /**
   * Verifica e consome numa só operação. Só marca como usada se todas as verificações passarem,
   * por isso uma tentativa falhada não queima uma autorização legítima.
   */
  consume(authorizationId: string | undefined, operation: CanonicalOperation): HumanAuthorization {
    if (!authorizationId) throw new AuthorizationError('AUTHORIZATION_REQUIRED');
    const authorization = this.issued.get(authorizationId);
    if (!authorization) throw new AuthorizationError('AUTHORIZATION_UNKNOWN');
    if (this.used.has(authorizationId)) throw new AuthorizationError('AUTHORIZATION_ALREADY_USED');
    if (authorization.sessionId !== this.sessionId) throw new AuthorizationError('AUTHORIZATION_SESSION_MISMATCH');
    if (this.clock().getTime() - Date.parse(authorization.issuedAt) > this.ttlMs) throw new AuthorizationError('AUTHORIZATION_EXPIRED');
    if (authorization.baseRevisionId !== operation.baseRevisionId) throw new AuthorizationError('AUTHORIZATION_REVISION_MISMATCH');
    if (authorization.digest !== operationDigest(operation)) throw new AuthorizationError('AUTHORIZATION_DIGEST_MISMATCH');
    this.used.add(authorizationId);
    return authorization;
  }
}
