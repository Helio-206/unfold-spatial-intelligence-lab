import {
  AuthorizationError,
  canonicalize,
  isConfirmed,
  operationDigest,
  type Actor,
  type AuthorizationLedger,
  type CanonicalOperation,
  type CommandOrigin,
  type FieldRef,
  type InferenceRecord,
  type Provenance,
} from '../../core';
import { solveDc, type DcResult } from './mna';
import { VALUE_FIELD, validateCircuit, type CircuitIssue, type CircuitV1 } from './model';

/**
 * "Altera R2 para 220 Ω": preview → (autorização se tocar valores confirmados) → commit.
 * A operação nunca escreve directamente no circuito; o commit refaz o preview e só aceita
 * se o conteúdo for exactamente o que foi mostrado e autorizado.
 */

export type ValueChangeRequest = {
  componentId: string;
  value: number;
  origin: CommandOrigin;
  actor: Actor;
  /** Presente quando o pedido foi interpretado por um modelo (por exemplo, a partir de linguagem natural). */
  inference?: InferenceRecord;
};

export type ValueChangePreview = {
  status: 'ready' | 'blocked';
  evaluatedAt: string;
  operation: CanonicalOperation;
  digest: string;
  requiresAuthorization: boolean;
  touchesConfirmed: FieldRef[];
  candidate: CircuitV1 | null;
  before: DcResult;
  after: DcResult | null;
  issues: CircuitIssue[];
};

export type CommitOptions = {
  ledger: AuthorizationLedger;
  authorizationId?: string;
  clock?: () => Date;
};

const blockedIssue = (code: string, message: string, subject: string[] = []): CircuitIssue => ({ code, path: 'request', message, subject });

export function previewValueChange(circuit: CircuitV1, request: ValueChangeRequest, clock: () => Date = () => new Date()): ValueChangePreview {
  const at = clock();
  const fixedClock = () => at;
  const component = circuit.components.find((item) => item.id === request.componentId);
  const field = component ? VALUE_FIELD[component.kind] : 'value';
  const operation: CanonicalOperation = {
    domain: 'electrical',
    name: 'setComponentValue',
    subjectId: circuit.id,
    baseRevisionId: circuit.revision.id,
    changes: [{ entityId: request.componentId, field, from: component?.value.value ?? null, to: request.value }],
    affected: [request.componentId],
  };
  const before = solveDc(circuit, { clock: fixedClock });
  const touchesConfirmed = component && isConfirmed(component.value.provenance) ? [{ entityId: component.id, field }] : [];
  const base = { evaluatedAt: at.toISOString(), operation, digest: operationDigest(operation), requiresAuthorization: touchesConfirmed.length > 0, touchesConfirmed, before };

  if (!component) return { ...base, status: 'blocked', candidate: null, after: null, issues: [blockedIssue('COMPONENT_NOT_FOUND', `Não existe o componente ${request.componentId}.`)] };
  if (typeof request.value !== 'number' || !Number.isFinite(request.value)) return { ...base, status: 'blocked', candidate: null, after: null, issues: [blockedIssue('VALUE_INVALID', 'O novo valor tem de ser um número finito.', [component.id])] };

  const previous = component.value;
  const provenance: Provenance = {
    origin: 'human_entered',
    validation: isConfirmed(previous.provenance) ? 'corrected' : 'unreviewed',
    recordedAt: at.toISOString(),
    actor: request.actor,
    ...(request.inference ? { inference: request.inference } : {}),
    ...(isConfirmed(previous.provenance) ? { previous: { value: previous.value, provenance: previous.provenance } } : {}),
  };
  const nextNumber = circuit.revision.number + 1;
  const candidate: CircuitV1 = {
    ...structuredClone(circuit),
    revision: { id: `${circuit.id}:r${nextNumber}`, number: nextNumber, parentId: circuit.revision.id },
    components: circuit.components.map((item) => (item.id === component.id ? { ...structuredClone(item), value: { value: request.value, unit: previous.unit, provenance } } : structuredClone(item))),
  };
  const issues = validateCircuit(candidate);
  if (issues.length) return { ...base, status: 'blocked', candidate: null, after: null, issues };
  return { ...base, status: 'ready', candidate, after: solveDc(candidate, { clock: fixedClock }), issues: [] };
}

/**
 * Aplica um preview. Refaz-o com o mesmo pedido e o mesmo instante; recusa se o resultado
 * mudou entretanto. Pedidos com origem num modelo nunca são aplicados directamente.
 */
export function commitValueChange(circuit: CircuitV1, preview: ValueChangePreview, request: ValueChangeRequest, options: CommitOptions): CircuitV1 {
  if (request.origin === 'model_proposal' || request.origin === 'system') throw new AuthorizationError('MODEL_CANNOT_AUTHORIZE');
  if (preview.status !== 'ready' || !preview.candidate) throw new Error('PREVIEW_BLOCKED');
  if (preview.operation.baseRevisionId !== circuit.revision.id) throw new Error('STALE_PREVIEW');

  const evaluatedAt = new Date(preview.evaluatedAt);
  const replay = previewValueChange(circuit, request, () => evaluatedAt);
  if (replay.digest !== preview.digest || canonicalize(replay.candidate) !== canonicalize(preview.candidate)) throw new Error('PREVIEW_TAMPERED');

  if (replay.requiresAuthorization) {
    const authorization = options.ledger.consume(options.authorizationId, replay.operation);
    const candidate = structuredClone(replay.candidate!);
    for (const component of candidate.components) {
      if (component.id === request.componentId) component.value.provenance = { ...component.value.provenance, authorizationId: authorization.id };
    }
    return candidate;
  }
  return replay.candidate!;
}
