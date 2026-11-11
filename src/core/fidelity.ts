/**
 * UNFOLD Core — classificação de fidelidade (quatro classes) a partir de evidência e validação.
 *
 * Princípios:
 *  - A classe é calculada, nunca declarada: depende dos tipos de evidência dos componentes e de
 *    validações explícitas.
 *  - Um resíduo do próprio fitting não é validação (a referência foi usada para ajustar).
 *  - IoU de silhueta numa só vista prova consistência de projecção, não exactidão 3D: no máximo
 *    "parcialmente verificada". "Fiel" exige ground truth 3D, ou consistência multivista
 *    independente, e suporte observacional suficiente.
 *  - Limiares da política por defeito são PROVISÓRIOS até o CP2 os derivar do benchmark.
 */
import { kindRank, type EvidenceKind } from './evidence';

export type FidelityClass = 'faithful' | 'partially_verified' | 'conceptual_approximation' | 'unvalidated';
export const FIDELITY_LABEL: Record<FidelityClass, string> = {
  faithful: 'Reconstrução fiel',
  partially_verified: 'Reconstrução parcialmente verificada',
  conceptual_approximation: 'Aproximação conceptual',
  unvalidated: 'Resultado não validado',
};

export type ValidationMetric = 'silhouette_iou' | 'multiview_consistency' | 'landmark_error' | 'proportion_error' | 'dimension_error' | 'surface_distance' | 'component_completeness';

export type ValidationRecord = {
  id: string;
  metric: ValidationMetric;
  /** Número de vistas independentes envolvidas. */
  views: number;
  value: number;
  threshold: number;
  /** 'min': passa se value >= threshold (IoU). 'max': passa se value <= threshold (erro). */
  direction: 'min' | 'max';
  /** A referência NÃO foi usada para ajustar o resultado. */
  heldOut: boolean;
  /** A referência foi produzida independentemente do pipeline e do anotador. */
  independent: boolean;
  /** A referência é geometria 3D real (scan, CAD, medição). */
  groundTruth3d: boolean;
};
export const passed = (v: ValidationRecord): boolean => Number.isFinite(v.value) && (v.direction === 'min' ? v.value >= v.threshold : v.value <= v.threshold);

export type FidelityPolicy = { provisional: boolean; faithfulSupportedFraction: number; minViewsForFaithful: number };
export const DEFAULT_FIDELITY_POLICY: FidelityPolicy = { provisional: true, faithfulSupportedFraction: 0.8, minViewsForFaithful: 3 };

export type FidelityInput = {
  components: ReadonlyArray<{ id: string; geometry: EvidenceKind }>;
  validations: readonly ValidationRecord[];
  /** Fracção [0,1] da geometria sustentada por observação/medição. Omitido: deriva da fracção de componentes. */
  supportedFraction?: number;
};
export type FidelityAssessment = { class: FidelityClass; label: string; reasons: string[]; blockers: string[]; unvalidatable: string[]; supportedFraction: number; policy: FidelityPolicy };

export function classifyFidelity(input: FidelityInput, policy: FidelityPolicy = DEFAULT_FIDELITY_POLICY): FidelityAssessment {
  const reasons: string[] = [], blockers: string[] = [], unvalidatable: string[] = [];
  const comps = input.components;
  const backed = comps.filter((c) => kindRank(c.geometry) >= kindRank('measured') || c.geometry === 'observed').length;
  const derived = comps.length ? backed / comps.length : 0;
  const supported = input.supportedFraction === undefined ? derived : (Number.isFinite(input.supportedFraction) && input.supportedFraction >= 0 && input.supportedFraction <= 1 ? input.supportedFraction : 0);
  if (input.supportedFraction !== undefined && supported === 0 && input.supportedFraction !== 0) reasons.push('Fracção sustentada inválida: tratada como desconhecida (0).');
  const unknownComps = comps.filter((c) => c.geometry === 'unknown').length;
  const usable = input.validations.filter((v) => v.heldOut);
  if (input.validations.length > usable.length) reasons.push(`${input.validations.length - usable.length} validação(ões) usam a mesma referência do fitting (resíduo do ajuste, não held-out): ignoradas.`);
  const failed = usable.filter((v) => !passed(v));
  const ok = usable.filter(passed);
  const withGroundTruth = ok.some((v) => v.groundTruth3d && v.independent);
  if (!withGroundTruth) unvalidatable.push('Exactidão geométrica 3D absoluta (superfície, dimensões): não verificável sem ground truth 3D. IoU de silhueta e consistência de vistas provam coerência de projecção, não forma.');
  const make = (cls: FidelityClass): FidelityAssessment => ({ class: cls, label: FIDELITY_LABEL[cls], reasons, blockers, unvalidatable, supportedFraction: supported, policy });

  if (!comps.length || unknownComps === comps.length) { reasons.push('Sem componentes com geometria sustentada por evidência.'); blockers.push('Fornecer evidência (imagem, desenho, medição) para os componentes.'); return make('unvalidated'); }
  if (failed.length) { reasons.push(`Validação falhada: ${failed.map((v) => `${v.metric}=${v.value} (limiar ${v.direction === 'min' ? '≥' : '≤'} ${v.threshold})`).join('; ')}.`); blockers.push('Corrigir a reconstrução até as validações falhadas passarem.'); return make('unvalidated'); }
  if (!ok.length) {
    if (backed === 0) { reasons.push('Toda a geometria é inferida ou aproximada e não existe validação: aproximação conceptual declarada.'); blockers.push('Fornecer evidência observável e uma validação held-out.'); return make('conceptual_approximation'); }
    reasons.push('Geometria sustentada por evidência mas sem validação held-out.'); blockers.push('Executar uma validação com referência não usada no ajuste.'); return make('unvalidated');
  }
  if (supported <= 0) { reasons.push('Validações passam, mas nenhuma região está sustentada por observação/medição.'); blockers.push('Associar regiões a observações antes de reivindicar verificação.'); return make('conceptual_approximation'); }

  const mvOk = ok.some((v) => v.metric === 'multiview_consistency' && v.independent && v.views >= policy.minViewsForFaithful);
  const faithfulEvidence = withGroundTruth || mvOk;
  if (faithfulEvidence && supported >= policy.faithfulSupportedFraction && unknownComps === 0) {
    reasons.push(withGroundTruth ? 'Validada contra ground truth 3D independente.' : `Consistência multivista independente com ≥ ${policy.minViewsForFaithful} vistas.`);
    reasons.push(`Suporte observacional ${(supported * 100).toFixed(0)}% ≥ ${(policy.faithfulSupportedFraction * 100).toFixed(0)}%${policy.provisional ? ' (limiar provisório)' : ''}.`);
    return make('faithful');
  }
  reasons.push(`Validações passadas: ${ok.map((v) => v.metric).join(', ')}.`);
  if (!faithfulEvidence) blockers.push(`Para "fiel": ground truth 3D independente, ou consistência multivista independente com ≥ ${policy.minViewsForFaithful} vistas.`);
  if (supported < policy.faithfulSupportedFraction) blockers.push(`Suporte observacional ${(supported * 100).toFixed(0)}% < ${(policy.faithfulSupportedFraction * 100).toFixed(0)}%.`);
  if (unknownComps) blockers.push(`${unknownComps} componente(s) sem evidência (UNKNOWN).`);
  return make('partially_verified');
}
