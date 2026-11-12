import type { ValidationRecord } from '../../core';
import type { SpatialPlanV2 } from '../../universal-spatial/contracts-v2';
import { buildRealityLedger, type RealityLedger } from '../../universal-spatial/reality-ledger';
import { CALIBRATION_SOURCE, CONSISTENCY_THRESHOLD, HULL_ERROR_BY_VIEW_COUNT, PRODUCT_PATH_ASSISTED_ERROR, PRODUCT_PATH_ERROR } from './calibration';
import type { RealityModel } from './model';

/**
 * What the Reality Engine can honestly say about a reconstruction, in the Core's vocabulary. The only validation available for user-supplied views is
 * held-out agreement between the views themselves (each view checked against the hull of the others). It is a real hold-out for those views and it is
 * never independent of the capture, so a reconstruction from a person's own photographs can reach "parcialmente verificada" and never "fiel".
 */
/**
 * Three different things that used to be one word. (1) INTERNAL CONSISTENCY: the views agree with the hull of the others — a property of the engine's own output.
 * (2) INDEPENDENT VISUAL EVIDENCE: the outlines the hull is built from were checked by a person or come from a gate measured on clean backgrounds, so the views
 * are not merely agreeing with one another's mistakes (a wrong outline repeated consistently in every view passes consistency perfectly: AntiqueCamera, 6% error).
 * (3) GEOMETRIC FIDELITY: only a 3D reference independent of the capture can show it; user photographs never can, so it is never claimed here.
 */
export type FidelityAxes = {
  internalConsistency: { value: number | null; threshold: number; pass: boolean };
  independentVisualEvidence: { confirmedByPerson: number; cleanBackgroundGate: number; automaticUnconfirmed: number; views: number; groundedShare: number; required: number; pass: boolean };
  geometricFidelity: { status: 'not_demonstrated'; reason: string };
};
export const GROUNDED_SHARE_REQUIRED = 0.75;
export type RealityAssessment = {
  axes: FidelityAxes;
  ledger: RealityLedger;
  validations: ValidationRecord[];
  /** typical surface error measured on the benchmark for this number of views, or null when the benchmark has nothing for it */
  benchmarkTolerance: { chamferPctMedian: number; chamferPctMax: number; p95AccuracyPctMax: number; views: number; source: string } | null;
  statements: string[];
};

export function benchmarkToleranceFor(viewCount: number, mode: 'orthographic' | 'photographic' | 'photographic-assisted' = 'orthographic'): RealityAssessment['benchmarkTolerance'] {
  if (mode === 'photographic-assisted') {
    return viewCount >= PRODUCT_PATH_ASSISTED_ERROR.views ? { chamferPctMedian: PRODUCT_PATH_ASSISTED_ERROR.chamferPctMedian, chamferPctMax: PRODUCT_PATH_ASSISTED_ERROR.chamferPctMax, p95AccuracyPctMax: PRODUCT_PATH_ASSISTED_ERROR.accuracyPctMax, views: PRODUCT_PATH_ASSISTED_ERROR.views, source: 'contornos ajustados à mão sobre fundos de fotografias reais, azimutes assumidos (conjunto de desenvolvimento; a pessoa simulada usa o alfa exacto como oráculo)' } : null;
  }
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
  // The measured tolerances come from plain-background automatic outlines (classical colour) or hand-confirmed ones. Outlines from the salient network or the static
  // background were validated separately on cluttered composites (most of the learned ones were wrong there): they carry NO error tolerance until the person confirms them.
  const nViews = model.evidence.views.length, confirmed = model.evidence.views.filter((v) => v.outline === 'confirmed').length;
  const ungrounded = model.evidence.views.filter((v) => v.outline === 'automatic' && v.outlineMethod !== undefined && v.outlineMethod !== 'classical-colour').length;
  const tolerance = model.evidence.mode !== 'orthographic' && ungrounded > nViews / 2 && confirmed <= nViews / 2 ? null : benchmarkToleranceFor(nViews, model.evidence.mode === 'orthographic' ? 'orthographic' : confirmed > nViews / 2 ? 'photographic-assisted' : 'photographic');
  const views = model.evidence.views, photographic = model.evidence.mode !== 'orthographic';
  const cleanGate = views.filter((v) => v.outline === 'automatic' && (v.outlineMethod === undefined || v.outlineMethod === 'classical-colour')).length, byPerson = views.filter((v) => v.outline === 'confirmed').length, unconfirmed = views.length - byPerson - cleanGate;
  const groundedShare = views.length ? (byPerson + cleanGate) / views.length : 0, looMean = loo && loo.length >= 3 ? loo.reduce((a, b) => a + b.iou, 0) / loo.length : null;
  const axes: FidelityAxes = {
    internalConsistency: { value: looMean, threshold: CONSISTENCY_THRESHOLD, pass: looMean !== null && looMean >= CONSISTENCY_THRESHOLD },
    independentVisualEvidence: { confirmedByPerson: byPerson, cleanBackgroundGate: cleanGate, automaticUnconfirmed: unconfirmed, views: views.length, groundedShare, required: GROUNDED_SHARE_REQUIRED, pass: !photographic || groundedShare >= GROUNDED_SHARE_REQUIRED },
    geometricFidelity: { status: 'not_demonstrated', reason: 'Só um ground truth 3D independente da captura demonstra fidelidade geométrica; vistas do próprio utilizador provam no máximo consistência e contornos verificados.' },
  };
  // Consistency alone never lifts the class: "partially verified" needs the outlines themselves to be grounded.
  if (ledger.fidelity.class === 'partially_verified' && !axes.independentVisualEvidence.pass) {
    ledger.fidelity = { ...ledger.fidelity, class: 'unvalidated', label: 'Resultado não validado', reasons: [...ledger.fidelity.reasons, `Concordância entre vistas ${(looMean! * 100).toFixed(0)}% passa, mas só ${(groundedShare * 100).toFixed(0)}% dos contornos são verificados (confirmados por si ou de fundo liso); o resto são propostas automáticas. Vistas que repetem o mesmo erro concordam entre si: concordância não é evidência.`], blockers: [...ledger.fidelity.blockers, `Confirme os contornos (botão «O contorno está certo» ou «Ajustar contorno») em pelo menos ${Math.ceil(GROUNDED_SHARE_REQUIRED * views.length)} de ${views.length} vistas.`] };
  }
  const cam = model.evidence.camera, cameraStatement = cam ? (cam.source === 'declared' ? `Câmara: campo de visão ${cam.fovDeg}° INDICADO por si, não verificado (sem EXIF nem calibração).` : `Câmara: campo de visão ESTIMADO em ${cam.fovDeg}° pelas próprias vistas, não medido; o ganho de concordância sobre a hipótese ortográfica foi ${((cam.gain ?? 0) * 100).toFixed(1)} pontos.`) : 'Câmara: projecção ortográfica assumida (campo de visão desconhecido).';
  const statements = [
    cameraStatement,
    `${model.evidence.views.length} vistas; profundidade ${model.hull.depthObserved ? 'observada por vistas distintas' : 'NÃO observada (vistas quase paralelas)'}.`,
    `${(model.observedFraction * 100).toFixed(0)}% da superfície é vista por alguma vista; o resto (azul-acinzentado) é hipótese.`,
    tolerance
      ? `Medido contra activos 3D independentes (${tolerance.source}), com ≥ ${tolerance.views} vistas: erro médio de superfície tipicamente ${tolerance.chamferPctMedian}% da diagonal (máx. ${tolerance.chamferPctMax}%; p95 até ${tolerance.p95AccuracyPctMax}%). Não validado em fotografias de câmara.`
      : ungrounded > nViews / 2 && confirmed <= nViews / 2 ? 'Os contornos são automáticos (rede de saliência / fundo estático) e não foram confirmados: nos testes com fundos reais mais de metade destes contornos estavam errados, por isso nenhuma tolerância de erro é afirmada. Confirme os contornos vista a vista.' : 'Sem medição de erro para este número de vistas e este tipo de entrada: o erro é desconhecido.',
    loo ? `Concordância entre vistas (cada vista contra as restantes): ${((loo.reduce((s, x) => s + x.iou, 0) / loo.length) * 100).toFixed(0)}% IoU. Prova coerência entre vistas, não forma 3D.` : 'Menos de 3 vistas: não há vista de controlo; a forma não foi verificada contra nenhuma vista retida.',
    ...(model.degraded ? [`Resolução reduzida de ${model.degraded.fromCells} para ${model.degraded.toCells} células para caber no orçamento de triângulos (${model.degraded.triangles.toLocaleString('pt-PT')} triângulos): detalhe fino perdido, declarado.`] : []),
    ...(model.hull.clippedByFrame ? ['A silhueta tocou a janela de reconstrução: a forma pode estar cortada.'] : []),
    ...(model.discardedVoxels ? [`${model.discardedVoxels} voxels soltos foram descartados (ruído entre vistas inconsistentes).`] : []),
  ];
  return { axes, ledger, validations, benchmarkTolerance: tolerance, statements };
}
