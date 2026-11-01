/**
 * UNFOLD Core v0 — proveniência partilhada por todos os domínios.
 *
 * Regra de produto: o UNFOLD nunca confunde dados extraídos, hipóteses da IA,
 * confirmação humana e resultados de cálculo. Dois eixos independentes:
 *   - origin: de onde veio o valor;
 *   - validation: quem o confirmou.
 * Uma conversão nunca promove um valor para uma categoria mais forte sem evidência.
 */

export const ORIGINS = [
  'observed', //       lido directamente da fonte (vector, cota escrita, documento)
  'heuristic', //      detectado por um algoritmo clássico (limiares de pixels, por exemplo)
  'model_inferred', // proposto por um modelo de IA
  'human_entered', //  escrito por uma pessoa
  'derived', //        calculado deterministicamente a partir de outros campos
  'solver', //         resultado de um solver
  'fixture', //        dado de teste
  'synthetic', //      dado de exemplo criado para demonstração
  'unknown', //        origem não recuperável (por exemplo, numa migração)
] as const;
export type Origin = (typeof ORIGINS)[number];

export const VALIDATIONS = ['unreviewed', 'ambiguous', 'verified', 'corrected', 'rejected'] as const;
export type Validation = (typeof VALIDATIONS)[number];

export type Actor = { kind: 'human' | 'model' | 'system'; id: string };

export type EvidenceRef = { sourceId: string; locator?: string; excerpt?: string };

export type InferenceRecord = {
  provider: string; // 'meta'
  model: string; //    'muse-spark-1.3'
  requestId?: string;
  cached: boolean;
};

export type FieldRef = { entityId: string; field: string };

export type Provenance = {
  origin: Origin;
  validation: Validation;
  recordedAt: string;
  actor?: Actor;
  evidence?: EvidenceRef[];
  inference?: InferenceRecord;
  derivedFrom?: FieldRef[];
  /** Obrigatório quando validation é 'verified' ou 'corrected' em dados novos. */
  authorizationId?: string;
  /** Valor e proveniência anteriores quando um valor confirmado foi corrigido. */
  previous?: { value: unknown; provenance: Provenance };
  /** Proveniência original intacta quando o valor veio de um formato antigo. */
  legacy?: unknown;
};

/** As categorias que a interface mostra ao utilizador. */
export type InformationCategory =
  | 'extracted' //       dados extraídos
  | 'ai_hypothesis' //   hipótese da IA
  | 'human_confirmed' // confirmação humana
  | 'calculated' //      resultado de cálculo
  | 'example' //         fixture ou sintético
  | 'unknown';

export function isConfirmed(provenance: Provenance): boolean {
  return provenance.validation === 'verified' || provenance.validation === 'corrected';
}

/**
 * Categoria visível de um valor. 'verified' e 'corrected' exigem uma acção humana explícita,
 * por isso passam à frente da origem. Um valor rejeitado mantém a categoria da sua origem.
 */
export function categoryOf(provenance: Provenance): InformationCategory {
  if (isConfirmed(provenance)) return 'human_confirmed';
  switch (provenance.origin) {
    case 'observed':
    case 'heuristic':
      return 'extracted';
    case 'model_inferred':
      return 'ai_hypothesis';
    case 'human_entered':
      // Um valor escrito por uma pessoa é uma afirmação humana: entra na mesma categoria que a confirmação.
      return provenance.validation === 'rejected' ? 'unknown' : 'human_confirmed';
    case 'derived':
    case 'solver':
      return 'calculated';
    case 'fixture':
    case 'synthetic':
      return 'example';
    case 'unknown':
      return 'unknown';
  }
}

export function isOrigin(value: unknown): value is Origin {
  return typeof value === 'string' && (ORIGINS as readonly string[]).includes(value);
}

export function isValidation(value: unknown): value is Validation {
  return typeof value === 'string' && (VALIDATIONS as readonly string[]).includes(value);
}
