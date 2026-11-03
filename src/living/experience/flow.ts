/**
 * The experience as a state machine. Pure: the page renders `FlowState`, the port's outcome comes in as an action.
 *
 *   empty ──select──▶ selected ──submit──▶ waiting ──outcome──▶ review | not_identified | failed | unavailable
 *     ▲                  │ clear             │ cancel                   │ open_lab (gate 1 ready)
 *     └──────────────────┴───────────────────┘                          ▼
 *                                                               transition ──▶ lab ──back──▶ review
 * Any "restart" returns to empty and discards the input. `review` also covers the insufficient-data case (readiness),
 * so a person can still read what was observed.
 */
import type { IntakeInput, InputProblem, ReconstructionOutcome, ResultProvenance } from './intake';
import type { ExcavatorObservationV1 } from '../reconstruction/contracts';

export type Phase = 'empty' | 'selected' | 'waiting' | 'review' | 'not_identified' | 'failed' | 'unavailable' | 'transition' | 'lab';

export type FlowState = {
  phase: Phase;
  input: IntakeInput | null;
  problem: InputProblem | null;
  /** epoch ms when the request started (for the elapsed-time display) */
  startedAt: number | null;
  observation: ExcavatorObservationV1 | null;
  provenance: ResultProvenance | null;
  /** Server session of a live reconstruction; null for the demo port. Kept across review <-> lab. */
  sessionId: string | null;
  message: string | null;
  failure: { code: string; retryable: boolean } | null;
};

export type FlowAction =
  | { type: 'select'; input: IntakeInput }
  | { type: 'reject_input'; problem: InputProblem }
  | { type: 'clear' }
  | { type: 'submit'; at: number }
  | { type: 'cancel' }
  | { type: 'outcome'; outcome: ReconstructionOutcome }
  | { type: 'retry'; at: number }
  | { type: 'open_lab' }
  | { type: 'lab_ready' }
  | { type: 'back_to_review' }
  /** Embedded host: the example machine was opened straight from the empty lab. Nothing was reconstructed. */
  | { type: 'enter_example' }
  | { type: 'restart' };

export const initialFlow = (): FlowState => ({ phase: 'empty', input: null, problem: null, startedAt: null, observation: null, provenance: null, sessionId: null, message: null, failure: null });

export function reduceFlow(s: FlowState, a: FlowAction): FlowState {
  switch (a.type) {
    case 'select': return s.phase === 'waiting' ? s : { ...initialFlow(), phase: 'selected', input: a.input };
    case 'reject_input': return s.phase === 'waiting' ? s : { ...s, problem: a.problem };
    case 'clear': return s.phase === 'waiting' ? s : initialFlow();
    case 'submit': return s.phase === 'selected' && s.input ? { ...s, phase: 'waiting', startedAt: a.at, problem: null, message: null, failure: null } : s;
    case 'cancel': return s.phase === 'waiting' ? { ...s, phase: 'selected', startedAt: null, message: 'Pedido cancelado. Nada foi enviado para revisão.' } : s;
    case 'outcome': {
      if (s.phase !== 'waiting') return s; // a late answer after cancel or restart is ignored
      const o = a.outcome;
      if (o.kind === 'observation') return { ...s, phase: 'review', observation: o.observation, provenance: o.provenance, sessionId: o.sessionId ?? null, startedAt: null };
      if (o.kind === 'not_identified') return { ...s, phase: 'not_identified', provenance: o.provenance, message: o.reason, startedAt: null };
      if (o.kind === 'failed') return { ...s, phase: 'failed', message: o.message, failure: { code: o.code, retryable: o.retryable }, startedAt: null };
      return { ...s, phase: 'unavailable', message: o.reason, startedAt: null };
    }
    case 'retry': return (s.phase === 'failed' && s.failure?.retryable) || s.phase === 'not_identified' ? (s.input ? { ...s, phase: 'waiting', startedAt: a.at, message: null, failure: null } : s) : s;
    case 'open_lab': return s.phase === 'review' ? { ...s, phase: 'transition' } : s;
    case 'lab_ready': return s.phase === 'transition' ? { ...s, phase: 'lab' } : s;
    case 'back_to_review': return s.phase === 'lab' || s.phase === 'transition' ? { ...s, phase: 'review' } : s;
    case 'enter_example': return s.phase === 'empty' || s.phase === 'selected' ? { ...initialFlow(), phase: 'lab' } : s;
    case 'restart': return initialFlow();
  }
}

/** Plain-language headline per phase: what a non-technical person needs to read first. */
export const PHASE_HEADLINE: Record<Phase, string> = {
  empty: 'Comece por uma máquina.',
  selected: 'Pronto para reconstruir.',
  waiting: 'A reconstruir a máquina.',
  review: 'Reveja o que foi observado.',
  not_identified: 'Não foi possível identificar a máquina.',
  failed: 'A reconstrução falhou.',
  unavailable: 'A reconstrução não está disponível aqui.',
  transition: 'A abrir o laboratório.',
  lab: 'Laboratório.',
};
