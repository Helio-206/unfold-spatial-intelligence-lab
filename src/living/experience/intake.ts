/**
 * Intake: what a person gives UNFOLD (photo, technical drawing or text) and the seam where the real reconstruction
 * plugs in. Pure validation and types, plus a DEMO port that never pretends to be the model.
 *
 * The real port belongs to the integration (Claude Terminal): it calls the existing reconstruction route
 * (`observeExcavatorImage` / `observeExcavatorText` on the server) and maps its result to `ReconstructionOutcome`.
 * Nothing here calls Meta.
 */
import { validateExcavatorObservation, type ExcavatorObservationV1 } from '../reconstruction/contracts';
import { insufficientObservation, notIdentifiedObservation, reconstructionFixture } from './reconstruction-fixture';

export type InputKind = 'image' | 'drawing' | 'text';
export type IntakeInput =
  | { kind: 'image' | 'drawing'; name: string; size: number; mime: string; dataUrl: string }
  | { kind: 'text'; text: string };

export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
/** Same ceiling as the server's image input (src/image-input.ts MAX_IMAGE_BYTES). */
export const MAX_INPUT_BYTES = 10_000_000;
export const TEXT_LIMITS = { min: 12, max: 2000 } as const;

export type InputProblem = { code: 'UNSUPPORTED_TYPE' | 'TOO_LARGE' | 'EMPTY_FILE' | 'TEXT_TOO_SHORT' | 'TEXT_TOO_LONG'; message: string };

export function checkFile(file: { name: string; size: number; type: string }): InputProblem | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_IMAGE_TYPES)[number])) return { code: 'UNSUPPORTED_TYPE', message: `«${file.name}» não é PNG, JPEG nem WebP. Exporte o desenho ou a fotografia num destes formatos.` };
  if (file.size === 0) return { code: 'EMPTY_FILE', message: `«${file.name}» está vazio.` };
  if (file.size > MAX_INPUT_BYTES) return { code: 'TOO_LARGE', message: `«${file.name}» tem ${(file.size / 1e6).toFixed(1)} MB; o máximo é ${MAX_INPUT_BYTES / 1e6} MB.` };
  return null;
}

export function checkText(text: string): InputProblem | null {
  const t = text.trim();
  if (t.length < TEXT_LIMITS.min) return { code: 'TEXT_TOO_SHORT', message: `Descreva a máquina com pelo menos ${TEXT_LIMITS.min} caracteres: tipo, partes e medidas que conhece.` };
  if (t.length > TEXT_LIMITS.max) return { code: 'TEXT_TOO_LONG', message: `O texto tem ${t.length} caracteres; o máximo é ${TEXT_LIMITS.max}.` };
  return null;
}

/** Who produced a result. `demo` is never shown as the model. */
export type ResultProvenance = { mode: 'live'; model: string; requestId: string | null } | { mode: 'demo'; scenario: DemoScenario };

export type ReconstructionOutcome =
  /** `sessionId` is set by the live port: it ties the later review to the server session that produced this observation. */
  | { kind: 'observation'; observation: ExcavatorObservationV1; provenance: ResultProvenance; sessionId?: string }
  /** The model answered but did not recognise an excavator (machineType unknown, or no entities). */
  | { kind: 'not_identified'; reason: string; provenance: ResultProvenance }
  /** The request failed: network, budget, contract violation, timeout. */
  | { kind: 'failed'; code: string; message: string; retryable: boolean }
  /** Reconstruction is not available in this environment (no backend, no key). Not an error of the input. */
  | { kind: 'unavailable'; reason: string };

export interface ReconstructionPort {
  readonly mode: 'live' | 'demo';
  submit(input: IntakeInput, signal: AbortSignal): Promise<ReconstructionOutcome>;
}

/** Classify a valid observation the way the UI needs it. Pure: the real port must use the same rule. */
export function classifyObservation(observation: ExcavatorObservationV1, provenance: ResultProvenance): ReconstructionOutcome {
  if (observation.machineType !== 'excavator' || observation.entities.length === 0) {
    return { kind: 'not_identified', reason: observation.unknowns[0] ?? 'Não foi reconhecida uma escavadora nesta fonte.', provenance };
  }
  return { kind: 'observation', observation: validateExcavatorObservation(observation), provenance };
}

/** Error codes from the existing backend mapped to plain language. Unknown codes are shown as they are. */
export function failureMessage(code: string): { message: string; retryable: boolean } {
  const table: Record<string, { message: string; retryable: boolean }> = {
    MODEL_API_KEY_MISSING: { message: 'A reconstrução não está configurada neste servidor.', retryable: false },
    META_CALL_BUDGET_EXHAUSTED: { message: 'O limite de pedidos ao modelo foi atingido. Tente mais tarde.', retryable: false },
    TIMEOUT: { message: 'O modelo demorou demasiado a responder. Pode tentar de novo.', retryable: true },
    NETWORK: { message: 'Não foi possível contactar o servidor. Verifique a ligação e tente de novo.', retryable: true },
    RECONSTRUCTION_INVALID_RESULT: { message: 'A resposta do modelo não cumpria o contrato; nada foi usado.', retryable: true },
  };
  return table[code] ?? { message: `O pedido falhou (${code}).`, retryable: true };
}

export const DEMO_SCENARIOS = ['observation', 'insufficient', 'not_identified', 'failed', 'unavailable'] as const;
export type DemoScenario = (typeof DEMO_SCENARIOS)[number];
export const DEMO_SCENARIO_LABEL: Record<DemoScenario, string> = {
  observation: 'Reconstrução com dúvidas', insufficient: 'Dados insuficientes', not_identified: 'Máquina não identificada', failed: 'Erro do serviço', unavailable: 'Serviço indisponível',
};

/**
 * Demo port: returns a chosen scenario after a short, labelled wait. It ignores the content of the input on purpose,
 * and the interface says so ("o resultado não vem do seu ficheiro"). It exists so every state can be seen and tested.
 */
export class DemoReconstructionPort implements ReconstructionPort {
  readonly mode = 'demo' as const;
  constructor(public scenario: DemoScenario = 'observation', private readonly delayMs = 1200) {}
  submit(_input: IntakeInput, signal: AbortSignal): Promise<ReconstructionOutcome> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const provenance: ResultProvenance = { mode: 'demo', scenario: this.scenario };
        switch (this.scenario) {
          case 'observation': resolve(classifyObservation(reconstructionFixture(), provenance)); break;
          case 'insufficient': resolve(classifyObservation(insufficientObservation(), provenance)); break;
          case 'not_identified': resolve(classifyObservation(notIdentifiedObservation(), provenance)); break;
          case 'failed': resolve({ kind: 'failed', code: 'META_CALL_BUDGET_EXHAUSTED', ...failureMessage('META_CALL_BUDGET_EXHAUSTED') }); break;
          case 'unavailable': resolve({ kind: 'unavailable', reason: 'Não há servidor de reconstrução neste ambiente.' }); break;
        }
      }, this.delayMs);
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('cancelled', 'AbortError')); }, { once: true });
    });
  }
}
