/**
 * Turns an agent outcome into what the workspace may do with it. The rules:
 *  - Targets come only from canonical ids (evidenceIds) or a label that matches exactly one canonical component.
 *  - Allowed spatial acts: point, highlight, select, inspect, focus. Nothing that changes geometry.
 *  - An action the workspace cannot perform is reported as blocked; it is never animated or claimed.
 */
import type { SpatialAgentResultV1 } from '../../spatial-agent';
import type { CanonicalComponent, ComponentRegistry } from '../visual-foundry/component-registry';
import type { AgentOutcome } from './agent-client';

export type SpatialAct = 'point' | 'select' | 'inspect' | 'focus';
export type GroundedTarget = { id: string; status: 'resolved'; component: CanonicalComponent } | { id: string; status: 'missing' };

export type Grounded = {
  text: string;
  source: 'live' | 'fixture' | 'none';
  sourceNote: string;
  targets: GroundedTarget[];
  /** The component the hand should attend to first (actuator before part), or null. */
  primary: CanonicalComponent | null;
  act: SpatialAct | null;
  clarification: string | null;
  blocked: { code: string; message: string } | null;
};

const ACT: Record<string, SpatialAct> = { Select: 'select', Inspect: 'inspect', Focus: 'focus' };

export function groundOutcome(outcome: AgentOutcome, registry: ComponentRegistry, selectedId: string | null = null): Grounded {
  if (outcome.status === 'error') {
    const unsupported = outcome.code === 'SPATIAL_AGENT_ACTION_NOT_ALLOWED' || outcome.code === 'SPATIAL_AGENT_ACTION_NOT_AUTHORIZED';
    return {
      text: unsupported ? 'O assistente propôs uma acção que não é suportada ou não foi pedida. Não foi executada.' : outcome.message,
      source: 'none', sourceNote: outcome.code, targets: [], primary: null, act: null, clarification: null,
      blocked: { code: outcome.code, message: unsupported ? 'Acção não suportada neste modo: só seleccionar, inspeccionar e enquadrar.' : outcome.message },
    };
  }
  const r: SpatialAgentResultV1 = outcome.result;
  const sourceNote = outcome.source === 'live'
    ? `Muse Spark${outcome.meta.model ? ` · ${outcome.meta.model}` : ''}`
    : `Fixture · sem chamada ao modelo${outcome.reason === 'FIXTURE_MODE' ? '' : ` (${outcome.reason})`}`;
  const targets: GroundedTarget[] = r.evidenceIds.map((id) => { const c = registry.get(id); return c ? { id, status: 'resolved', component: c } : { id, status: 'missing' }; });
  let primary: CanonicalComponent | null = null;
  let act: SpatialAct | null = null;
  let blocked: Grounded['blocked'] = null;
  if (r.kind === 'PROPOSE_ACTION') {
    act = ACT[r.action.kind] ?? null;
    if (!act) blocked = { code: 'UNSUPPORTED_ACTION', message: `«${r.action.kind}» não é suportado neste espaço de trabalho.` };
    else if (r.action.target.reference === 'selected') {
      const selected = selectedId ? registry.get(selectedId) : undefined;
      if (selected && r.evidenceIds.every((id) => id === selected.id || selected.partIds.includes(id))) primary = selected;
      else blocked = { code: 'UNGROUNDED_TARGET', message: 'A selecção do pedido está ausente ou não corresponde à evidência.' };
    } else if (r.action.target.reference === 'label' && r.action.target.label) {
      const matches = registry.byLabel(r.action.target.label);
      if (matches.length === 1) primary = matches[0]!;
      else blocked = { code: matches.length ? 'AMBIGUOUS_TARGET' : 'TARGET_NOT_FOUND', message: matches.length ? `Há vários componentes chamados «${r.action.target.label}».` : `Não encontrei «${r.action.target.label}» na montagem.` };
    } else blocked = { code: 'UNGROUNDED_TARGET', message: 'A proposta não indica um componente canónico.' };
  }
  if (!primary && !blocked) {
    const resolved = targets.filter((t): t is Extract<GroundedTarget, { status: 'resolved' }> => t.status === 'resolved').map((t) => t.component);
    primary = resolved.find((c) => c.kind === 'actuator') ?? resolved[0] ?? null;
    if (primary && !act) act = 'point';
  }
  return {
    text: r.text, source: outcome.source, sourceNote, targets, primary, act: blocked ? null : act,
    clarification: r.kind === 'REQUEST_CLARIFICATION' ? r.question : null, blocked,
  };
}
