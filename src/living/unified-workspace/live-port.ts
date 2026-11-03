import { classifyObservation, failureMessage, type IntakeInput, type ReconstructionOutcome, type ReconstructionPort } from '../experience/intake';
import type { ReconstructionClient } from './reconstruction-client';
import { ReconstructionSession } from './reconstruction-session';
import { canvasTranscoder, prepareImage, TranscodeError, type Transcoder } from './image-transcode';
import type { ProposeRequest, ReconstructionFailure } from './types';

export type LivePortOptions = { client: ReconstructionClient; transcode?: Transcoder; now?: () => number };

const cancelled = () => new DOMException('cancelled', 'AbortError');
const failed = (code: string, message: string, retryable: boolean): ReconstructionOutcome => ({ kind: 'failed', code, message, retryable });

/** Maps a typed failure to the outcome the experience already knows how to show. */
export function outcomeFromFailure(failure: ReconstructionFailure): ReconstructionOutcome {
  switch (failure.kind) {
    case 'invalid_input': return failed('INVALID_INPUT', `A fonte não foi aceite: ${failure.reasons.join('; ')}.`, false);
    case 'blocked': return failed('RECONSTRUCTION_BLOCKED', `A proposta foi bloqueada: ${failure.reasons.join('; ')}.`, false);
    case 'session_expired': return failed('RECONSTRUCTION_SESSION_NOT_FOUND', 'A sessão expirou. Envie a fonte de novo.', true);
    case 'rate_limited': return failed('RECONSTRUCTION_RATE_LIMITED', 'Demasiados pedidos seguidos. Aguarde um minuto e tente de novo.', true);
    case 'budget_exhausted': return failed('META_CALL_BUDGET_EXHAUSTED', failureMessage('META_CALL_BUDGET_EXHAUSTED').message, false);
    case 'capacity': return failed('RECONSTRUCTION_SESSION_CAPACITY', 'O servidor atingiu o limite de sessões. Tente mais tarde.', true);
    // The server refused this page itself (origin/host/token): the feature is not available *here*, which is not the person's fault.
    case 'guard_rejected': return { kind: 'unavailable', reason: `O servidor local não aceita pedidos desta página (${failure.code}).` };
    case 'upstream':
      if (failure.code === 'MODEL_API_KEY_MISSING') return { kind: 'unavailable', reason: failureMessage('MODEL_API_KEY_MISSING').message };
      // The server answers RECONSTRUCTION_FAILED both for internal errors and for a source that is not an excavator; it cannot be told apart here.
      if (failure.code === 'RECONSTRUCTION_FAILED') return failed(failure.code, 'O servidor não aceitou a proposta. A fonte pode não mostrar uma escavadora: tente outra fonte.', false);
      return failed(failure.code, failureMessage(failure.code).message, failure.status >= 500 || failure.status === 429);
    case 'network': return failure.message === 'tempo esgotado' ? failed('TIMEOUT', failureMessage('TIMEOUT').message, true) : failed('NETWORK', failureMessage('NETWORK').message, true);
    case 'bad_response': return failed('RECONSTRUCTION_INVALID_RESULT', failureMessage('RECONSTRUCTION_INVALID_RESULT').message, true);
    case 'aborted': throw cancelled();
  }
}

const referenceFor = (input: IntakeInput): string => input.kind === 'text' ? 'user-instruction' : (input.name.trim().slice(0, 200) || 'submitted-image');

/**
 * The real `ReconstructionPort`. Always asks for `mode: 'live'`; the server's reply is checked, and an offline (fixture)
 * answer to a live request is refused rather than shown as the model's. It owns the `ReconstructionSession`, so the
 * review that follows talks to the same server session that produced the observation.
 */
export class LiveReconstructionPort implements ReconstructionPort {
  readonly mode = 'live' as const;
  readonly session: ReconstructionSession;
  private readonly transcode: Transcoder;

  constructor(options: LivePortOptions) {
    this.session = new ReconstructionSession({ client: options.client, now: options.now });
    this.transcode = options.transcode ?? canvasTranscoder;
  }

  async submit(input: IntakeInput, signal: AbortSignal): Promise<ReconstructionOutcome> {
    if (signal.aborted) throw cancelled();
    let request: ProposeRequest;
    try { request = await this.requestFor(input, signal); }
    catch (error) {
      if ((error as DOMException).name === 'AbortError' || signal.aborted) throw cancelled();
      const message = error instanceof TranscodeError ? error.message : 'a imagem não pôde ser preparada';
      return failed('IMAGE_CONVERSION_FAILED', `Não foi possível converter a imagem para PNG (${message}). Exporte-a em PNG ou JPEG.`, false);
    }
    const onAbort = () => this.session.cancel();
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      const state = await this.session.propose(request);
      if (signal.aborted) throw cancelled();
      switch (state.phase) {
        case 'awaiting_review': {
          const { proposal } = state;
          if (proposal.mode !== 'live') return failed('RECONSTRUCTION_INVALID_RESULT', 'O servidor devolveu uma reconstrução de fixture a um pedido real; nada foi usado.', true);
          const provenance = { mode: 'live' as const, model: proposal.meta.model ?? 'desconhecido', requestId: proposal.meta.requestId };
          const outcome = classifyObservation(proposal.observation, provenance);
          return outcome.kind === 'observation' ? { ...outcome, sessionId: proposal.sessionId } : outcome;
        }
        case 'proposal_blocked': return failed('RECONSTRUCTION_BLOCKED', `A proposta foi bloqueada: ${state.reasons.join('; ')}.`, false);
        case 'proposal_failed': return outcomeFromFailure(state.failure);
        default: throw cancelled();
      }
    } finally { signal.removeEventListener('abort', onAbort); }
  }

  private async requestFor(input: IntakeInput, signal: AbortSignal): Promise<ProposeRequest> {
    const sourceReference = referenceFor(input);
    if (input.kind === 'text') return { sourceKind: 'text', instruction: input.text, sourceReference, mode: 'live' };
    const image = await prepareImage(input.dataUrl, this.transcode, signal);
    return { sourceKind: input.kind === 'drawing' ? 'technical_drawing' : 'image', imageDataUrl: image.dataUrl, sourceReference, mode: 'live' };
  }
}
