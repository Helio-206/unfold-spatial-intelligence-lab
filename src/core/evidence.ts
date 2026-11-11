/**
 * UNFOLD Core — contrato de evidência.
 *
 * Cinco tipos de evidência, ortogonais à proveniência (de onde veio) e à validação
 * humana (quem confirmou):
 *   OBSERVED     lido directamente de uma fonte rastreável (vector, cota escrita, pixel).
 *   MEASURED     quantidade extraída da fonte com método, unidade, incerteza quantificada
 *                e calibrada (por construção ou validada contra referência).
 *   INFERRED     proposto por modelo, heurística sem medição, ou afirmação humana sem medição.
 *   APPROXIMATED valor com método e base declarados, mas com incerteza apenas declarada
 *                (não calibrada) ou aproximação de projecto.
 *   UNKNOWN      sem evidência. O valor é nulo: nunca se preenche o desconhecido.
 *
 * Regras (verificadas por propriedade em tests/core-evidence.test.ts):
 *   - nenhuma conversão promove acima do tecto da origem;
 *   - confirmação humana não altera o tipo (confirmar não é observar): fica em `humanConfirmed`;
 *   - derivados herdam o elo mais fraco das entradas;
 *   - fixture/synthetic/unknown nunca são evidência de um objecto real;
 *   - sem referência rastreável, "observado" degrada para UNKNOWN.
 * O Core não importa nada fora de src/core.
 */
import type { EvidenceRef, Provenance } from './provenance';

export const EVIDENCE_KINDS = ['observed', 'measured', 'inferred', 'approximated', 'unknown'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
export const EVIDENCE_LABEL: Record<EvidenceKind, string> = { observed: 'OBSERVED', measured: 'MEASURED', inferred: 'INFERRED', approximated: 'APPROXIMATED', unknown: 'UNKNOWN' };

/** Ordem de força: unknown < inferred < approximated < measured < observed. */
const RANK: Record<EvidenceKind, number> = { unknown: 0, inferred: 1, approximated: 2, measured: 3, observed: 4 };
export const kindRank = (k: EvidenceKind): number => RANK[k];
export function weakestKind(kinds: readonly EvidenceKind[]): EvidenceKind {
  if (!kinds.length) return 'unknown';
  return kinds.reduce((a, b) => (RANK[b] < RANK[a] ? b : a));
}

/**
 * by_construction: exacta por definição do método (contagem de píxeis).
 * validated: incerteza verificada contra uma referência independente.
 * declared: declarada pelo método, ainda não verificada — nunca basta para MEASURED.
 */
export type Calibration = 'by_construction' | 'validated' | 'declared';
export type Uncertainty = { quantified: true; plusMinus: number; unit: string; calibration: Calibration } | { quantified: false };

export type Measurement = {
  method: string;
  unit: string;
  uncertainty: Uncertainty;
  evidence: EvidenceRef[];
  /** Pressupostos do método (projecção ortográfica, roda circular…). */
  assumptions: string[];
};

export type EvidenceContext = { measurement?: Measurement; inputs?: readonly EvidenceKind[]; basis?: string };
export type EvidenceAssessment = { kind: EvidenceKind; humanConfirmed: boolean; reason: string };

const calibrated = (m: Measurement | undefined): boolean => !!m && m.evidence.length > 0 && m.uncertainty.quantified && m.uncertainty.calibration !== 'declared' && m.unit.trim() !== '';
const declaredOnly = (m: Measurement | undefined): boolean => !!m && m.evidence.length > 0 && m.uncertainty.quantified && m.uncertainty.calibration === 'declared' && m.unit.trim() !== '';
const hasRef = (p: Provenance): boolean => !!p.evidence && p.evidence.length > 0;

/** Tipo de evidência de um valor, a partir da sua proveniência e (opcionalmente) de uma medição ou das entradas. */
export function evidenceKindOf(p: Provenance, ctx: EvidenceContext = {}): EvidenceAssessment {
  const humanConfirmed = p.validation === 'verified' || p.validation === 'corrected';
  const out = (kind: EvidenceKind, reason: string): EvidenceAssessment => ({ kind, humanConfirmed, reason });
  if (p.validation === 'rejected') return out('unknown', 'Rejeitado por revisão humana.');
  switch (p.origin) {
    case 'fixture':
    case 'synthetic':
      return out('unknown', 'Dado de exemplo: não é evidência de um objecto real.');
    case 'unknown':
      return out('unknown', 'Origem não recuperável.');
    case 'observed':
      return hasRef(p) ? out('observed', 'Lido de uma fonte rastreável.') : out('unknown', 'Declarado observado mas sem referência rastreável.');
    case 'heuristic':
    case 'human_entered':
      if (calibrated(ctx.measurement)) return out('measured', `Medição calibrada (${ctx.measurement!.method}).`);
      if (p.origin === 'heuristic' && declaredOnly(ctx.measurement)) return out('approximated', `Incerteza apenas declarada (${ctx.measurement!.method}).`);
      return out('inferred', p.origin === 'heuristic' ? 'Heurística sem medição calibrada.' : 'Afirmação humana sem medição.');
    case 'model_inferred':
      return out('inferred', 'Proposto por modelo.');
    case 'derived':
    case 'solver': {
      if (!ctx.inputs?.length) return out('unknown', 'Resultado derivado sem entradas rastreáveis.');
      const kind = weakestKind(ctx.inputs);
      return out(kind, `Herda o elo mais fraco das entradas (${kind}).`);
    }
  }
}

export type EvidencedValue<T> = {
  value: T | null;
  kind: EvidenceKind;
  humanConfirmed: boolean;
  uncertainty: Uncertainty;
  provenance: Provenance;
  measurement?: Measurement;
  basis?: string;
  reason: string;
};

export function makeEvidenced<T>(value: T | null, provenance: Provenance, ctx: EvidenceContext = {}): EvidencedValue<T> {
  const a = evidenceKindOf(provenance, ctx);
  const result: EvidencedValue<T> = {
    value: a.kind === 'unknown' ? null : value, kind: a.kind, humanConfirmed: a.humanConfirmed,
    uncertainty: ctx.measurement && a.kind !== 'inferred' && a.kind !== 'unknown' ? ctx.measurement.uncertainty : { quantified: false },
    provenance, reason: a.reason,
  };
  if (ctx.measurement && (a.kind === 'measured' || a.kind === 'approximated')) result.measurement = ctx.measurement;
  if (ctx.basis !== undefined) result.basis = ctx.basis;
  else if (a.kind === 'approximated' && ctx.measurement) result.basis = ctx.measurement.method;
  return result;
}

export type EvidenceViolation =
  | 'UNKNOWN_WITH_VALUE' | 'VALUE_WITHOUT_KIND' | 'KIND_PROMOTED_ABOVE_PROVENANCE' | 'OBSERVED_WITHOUT_EVIDENCE'
  | 'MEASURED_WITHOUT_MEASUREMENT' | 'MEASURED_UNCALIBRATED' | 'MEASUREMENT_WITHOUT_UNIT' | 'APPROXIMATED_WITHOUT_BASIS';

/** Verifica as invariantes de um valor com evidência; devolve a lista de violações (vazia = válido). */
export function validateEvidenced<T>(v: EvidencedValue<T>): EvidenceViolation[] {
  const issues: EvidenceViolation[] = [];
  if (v.kind === 'unknown' && v.value !== null) issues.push('UNKNOWN_WITH_VALUE');
  if (v.kind !== 'unknown' && v.value === null) issues.push('VALUE_WITHOUT_KIND');
  const ceiling = evidenceKindOf(v.provenance, { ...(v.measurement ? { measurement: v.measurement } : {}) });
  // derivados: o tecto depende das entradas, que o valor não guarda; só se compara a origens não derivadas.
  if (v.provenance.origin !== 'derived' && v.provenance.origin !== 'solver' && kindRank(v.kind) > kindRank(ceiling.kind)) issues.push('KIND_PROMOTED_ABOVE_PROVENANCE');
  if (v.kind === 'observed' && !hasRef(v.provenance)) issues.push('OBSERVED_WITHOUT_EVIDENCE');
  if (v.kind === 'measured') {
    if (!v.measurement) issues.push('MEASURED_WITHOUT_MEASUREMENT');
    else {
      if (v.measurement.unit.trim() === '') issues.push('MEASUREMENT_WITHOUT_UNIT');
      if (!calibrated({ ...v.measurement, unit: v.measurement.unit || 'x' })) issues.push('MEASURED_UNCALIBRATED');
    }
  }
  if (v.kind === 'approximated' && !(v.basis && v.basis.trim())) issues.push('APPROXIMATED_WITHOUT_BASIS');
  return issues;
}
