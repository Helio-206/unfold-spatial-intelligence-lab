/**
 * Reality ledger — leitura de evidência e fidelidade sobre o SpatialPlanV2 existente.
 *
 * Não é um segundo grafo de cena: é uma função pura que lê o plano do Spatial Core, mapeia a
 * proveniência dos seus valores para os tipos de evidência do Core e classifica a fidelidade.
 * Não escreve no plano; o plano continua a mudar só por transacções.
 */
import { evidenceKindOf, classifyFidelity, kindRank, type EvidenceKind, type FidelityAssessment, type FidelityPolicy, type ValidationRecord, type Provenance } from '../core';
import type { SpatialPlanV2 } from './contracts-v2';
import type { ValueOrigin } from './contracts';

export type FieldEvidence = { kind: EvidenceKind; humanConfirmed: boolean; reason: string };
export type ComponentEvidence = { id: string; label: string; geometry: FieldEvidence; transform: FieldEvidence; material: FieldEvidence };
export type RealityLedger = {
  sourceKind: 'text' | 'image'; sourceSha256: string;
  components: ComponentEvidence[];
  unknownComponentIds: string[];
  planUnknowns: string[];
  supportedFraction: number;
  fidelity: FidelityAssessment;
};

function fieldEvidence(origin: ValueOrigin, evidenceText: string, plan: SpatialPlanV2, componentId: string): FieldEvidence {
  const stamp: Pick<Provenance, 'validation' | 'recordedAt'> = { validation: 'unreviewed', recordedAt: '' };
  switch (origin) {
    case 'observed': {
      if (plan.source.kind === 'text') return { kind: 'inferred', humanConfirmed: false, reason: 'Fonte só de texto: uma descrição não pode ser observação da geometria.' };
      const ref = evidenceText.trim() ? [{ sourceId: plan.source.sha256, locator: componentId, excerpt: evidenceText.slice(0, 200) }] : [];
      const a = evidenceKindOf({ origin: 'observed', ...stamp, evidence: ref });
      return { kind: a.kind, humanConfirmed: a.humanConfirmed, reason: a.reason };
    }
    case 'inferred': { const a = evidenceKindOf({ origin: 'model_inferred', ...stamp }); return { kind: a.kind, humanConfirmed: false, reason: a.reason }; }
    case 'user_provided': { const a = evidenceKindOf({ origin: 'human_entered', ...stamp }); return { kind: a.kind, humanConfirmed: false, reason: `${a.reason} (autorização não verificada pelo ledger)` }; }
    case 'design_approximation': return { kind: 'approximated', humanConfirmed: false, reason: 'Aproximação de projecto declarada; tolerância não quantificada.' };
    case 'unknown': return { kind: 'unknown', humanConfirmed: false, reason: 'Sem evidência.' };
  }
}

export function buildRealityLedger(plan: SpatialPlanV2, opts: { validations?: readonly ValidationRecord[]; policy?: FidelityPolicy } = {}): RealityLedger {
  const components: ComponentEvidence[] = plan.components.map((c) => ({
    id: c.id, label: c.label,
    geometry: fieldEvidence(c.provenance.geometry, c.provenance.evidence, plan, c.id),
    transform: fieldEvidence(c.provenance.transform, c.provenance.evidence, plan, c.id),
    material: fieldEvidence(c.provenance.material, c.provenance.evidence, plan, c.id),
  }));
  // Suporte = geometria E posição sustentadas por observação/medição (a forma sem a posição não localiza a parte).
  const supportedCount = components.filter((c) => kindRank(c.geometry.kind) >= kindRank('measured') && kindRank(c.transform.kind) >= kindRank('measured')).length;
  const supportedFraction = components.length ? supportedCount / components.length : 0;
  const fidelity = classifyFidelity({ components: components.map((c) => ({ id: c.id, geometry: c.geometry.kind })), validations: opts.validations ?? [], supportedFraction }, opts.policy);
  return {
    sourceKind: plan.source.kind, sourceSha256: plan.source.sha256, components,
    unknownComponentIds: components.filter((c) => c.geometry.kind === 'unknown').map((c) => c.id),
    planUnknowns: [...plan.unknowns], supportedFraction, fidelity,
  };
}
