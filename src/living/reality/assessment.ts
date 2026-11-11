import type { ValidationRecord } from '../../core';
import type { SpatialPlanV2 } from '../../universal-spatial/contracts-v2';
import { buildRealityLedger, type RealityLedger } from '../../universal-spatial/reality-ledger';
import { CALIBRATION_SOURCE, CONSISTENCY_THRESHOLD, HULL_ERROR_BY_VIEW_COUNT, PRODUCT_PATH_ERROR } from './calibration';
import type { RealityModel } from './model';

/**
 * What the Reality Engine can honestly say about a reconstruction, in the Core's vocabulary. The only validation available for user-supplied views is
 * held-out agreement between the views themselves (each view checked against the hull of the others). It is a real hold-out for those views and it is
 * never independent of the capture, so a reconstruction from a person's own photographs can reach "parcialmente verificada" and never "fiel".
 */
export type RealityAssessment = {
  ledger: RealityLedger;
  validations: ValidationRecord[];
  /** typical surface error measured on the benchmark for this number of views, or null when the benchmark has nothing for it */
  benchmarkTolerance: { chamferPctMedian: number; chamferPctMax: number; p95AccuracyPctMax: number; views: number; source: string } | null;
  statements: string[];
};

export function benchmarkToleranceFor(viewCount: number, mode: 'orthographic' | 'photographic' = 'orthographic'): RealityAssessment['benchmarkTolerance'] {
  if (mode === 'photographic') {
    // photos and video: the product-path measurement, with 8 turntable views; fewer views than that are NOT covered by it (reported as such)
    return viewCount >= PRODUCT_PATH_ERROR.views ? { chamferPctMedian: PRODUCT_PATH_ERROR.chamferPctMedian, chamferPctMax: PRODUCT_PATH_ERROR.chamferPctMax, p95AccuracyPctMax: PRODUCT_PATH_ERROR.accuracyPctMax, views: PRODUCT_PATH_ERROR.views, source: 'caminho do produto: renders em perspectiva, contornos automáticos, azimutes assumidos (conjunto de desenvolvimento)' } : null;
  }
  const rows = [...HULL_ERROR_BY_VIEW_COUNT].filter((r) => r.views <= viewCount).sort((a, b) => b.views - a.views);
  const row = rows[0]; if (!row) return null;
  return { chamferPctMedian: row.chamferPctMedian, chamferPctMax: row.chamferPctMax, p95AccuracyPctMax: row.p95AccuracyPctMax, views: row.views, source: CALIBRATION_SOURCE };
}

export function assessReconstruction(plan: SpatialPlanV2, model: RealityModel, sourceSha256: string): RealityAssessment {
  const validations: ValidationRecord[] = [];
  const loo = model.heldOutIoU;
  if (loo && loo.length >= 3) {
    const value = loo.reduce((s, x) => s + x.iou, 0) / loo.length;
    validations.push({ id: 'held-out-views', metric: 'multiview_consistency', views: loo.length, value, threshold: CONSISTENCY_THRESHOLD, direction: 'min', heldOut: true, independent: false, groundTruth3d: false });
  }
  const byComponent: Record<string, number> = Object.fromEntries(model.parts.map((p) => [p.id, p.observedFraction]));
  const ledger = buildRealityLedger(plan, {
    validations,
    reconstruction: { sourceSha256, geometry: 'approximated', observedFraction: model.observedFraction, observedByComponent: byComponent, basis: 'Casco visual de silhuetas (limite superior da forma)' },
  });
  const tolerance = benchmarkToleranceFor(model.evidence.views.length, model.evidence.mode === 'orthographic' ? 'orthographic' : 'photographic');
  const statements = [
    `${model.evidence.views.length} vistas; profundidade ${model.hull.depthObserved ? 'observada por vistas distintas' : 'NÃO observada (vistas quase paralelas)'}.`,
    `${(model.observedFraction * 100).toFixed(0)}% da superfície é vista por alguma vista; o resto (azul-acinzentado) é hipótese.`,
    tolerance
      ? `Medido contra activos 3D independentes (${tolerance.source}), com ≥ ${tolerance.views} vistas: erro médio de superfície tipicamente ${tolerance.chamferPctMedian}% da diagonal (máx. ${tolerance.chamferPctMax}%; p95 até ${tolerance.p95AccuracyPctMax}%). Não validado em fotografias de câmara.`
      : 'Sem medição de erro para este número de vistas e este tipo de entrada: o erro é desconhecido.',
    loo ? `Concordância entre vistas (cada vista contra as restantes): ${((loo.reduce((s, x) => s + x.iou, 0) / loo.length) * 100).toFixed(0)}% IoU. Prova coerência entre vistas, não forma 3D.` : 'Menos de 3 vistas: não há vista de controlo; a forma não foi verificada contra nenhuma vista retida.',
    ...(model.degraded ? [`Resolução reduzida de ${model.degraded.fromCells} para ${model.degraded.toCells} células para caber no orçamento de triângulos (${model.degraded.triangles.toLocaleString('pt-PT')} triângulos): detalhe fino perdido, declarado.`] : []),
    ...(model.hull.clippedByFrame ? ['A silhueta tocou a janela de reconstrução: a forma pode estar cortada.'] : []),
    ...(model.discardedVoxels ? [`${model.discardedVoxels} voxels soltos foram descartados (ruído entre vistas inconsistentes).`] : []),
  ];
  return { ledger, validations, benchmarkTolerance: tolerance, statements };
}
