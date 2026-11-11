/**
 * Reconstruction strategy selection. The product does not apply one technique to everything: it looks at the KIND of input and the evidence actually available
 * (view count, coverage, credible outlines) and picks the strategy whose measured behaviour fits, says why, states its limits and the best fidelity class it can
 * reach. Strategies that are not available or not justified are refused with the reason (never replaced silently by a prettier fallback).
 *
 * Considered and NOT adopted (evidence in reports/reality-engine/INVESTIGATION.md): Structure-from-Motion as a product dependency (COLMAP registered 15 of 24
 * well-textured views of one object and gave irregular steps), dense MVS / neural radiance fields (need registered cameras, minutes of GPU, and do not produce
 * editable parts).
 */
import type { FidelityClass } from '../../core';
import type { CaptureAssessment } from './capture-quality';

export type InputKind = 'text' | 'single-image' | 'multi-image' | 'video' | 'drawing-3view' | 'floor-plan';
export type StrategyId = 'ai-interpretation' | 'vehicle-fitting' | 'silhouette-hull' | 'orthographic-hull' | 'plan-reconstruction' | 'needs-input';
export type StrategyInput = {
  kind: InputKind;
  views: number;
  /** every outline is credible or confirmed by the person */
  outlinesCredible: boolean;
  /** single image: the picture shows a vehicle in side or three-quarter view (from the existing wheel landmarks) */
  vehicleSideView?: boolean;
  capture?: CaptureAssessment | null;
  /** poses were declared by the person (vs assumed) */
  posesDeclared?: boolean;
};
export type Strategy = {
  id: StrategyId;
  ceiling: FidelityClass;
  reasons: string[];
  limits: string[];
  /** what the person must do for a better strategy to apply */
  requires: string[];
  /** whether this strategy has been certified on measured evidence in this phase */
  certified: boolean;
};

const HULL_LIMITS = [
  'O casco é um limite superior: concavidades e cavidades que nenhuma silhueta mostra ficam preenchidas.',
  'Estruturas mais finas que ~2 voxels perdem-se; transparências e reflexos pioram o resultado.',
  'As partes são separadas pela forma (hipótese de estrutura), não reconhecidas.',
];

export function selectStrategy(i: StrategyInput): Strategy {
  switch (i.kind) {
    case 'text':
      return { id: 'ai-interpretation', ceiling: 'conceptual_approximation', certified: false, reasons: ['Só texto: não há evidência visual de geometria.'], limits: ['Concepção da IA; nenhuma forma é observada.'], requires: ['Forneça fotografias do objecto para uma reconstrução baseada em evidência.'] };
    case 'single-image':
      return i.vehicleSideView
        ? { id: 'vehicle-fitting', ceiling: 'partially_verified', certified: false, reasons: ['Uma só fotografia de veículo em perfil/três-quartos: ajuste paramétrico à silhueta com câmara estimada pelas rodas.'], limits: ['Só azimute estimado; vistas frontais/traseiras recusadas; IoU 0.69–0.81 numa referência de um só anotador.'], requires: ['Várias vistas dão profundidade observada e melhor fidelidade.'] }
        : { id: 'ai-interpretation', ceiling: 'conceptual_approximation', certified: false, reasons: ['Uma só fotografia fora de veículos: a profundidade não é observável.'], limits: ['Concepção da IA a rever; nada do que não se vê é observado.'], requires: ['Acrescente pelo menos mais 1 vista (de preferência 6 a 8 à volta) para usar reconstrução por evidência.'] };
    case 'multi-image':
    case 'video': {
      if (i.views < 2) return { id: 'needs-input', ceiling: 'unvalidated', certified: false, reasons: ['Menos de 2 vistas utilizáveis.'], limits: [], requires: ['Acrescente vistas do mesmo objecto.'] };
      if (!i.outlinesCredible) return { id: 'needs-input', ceiling: 'unvalidated', certified: false, reasons: ['Pelo menos um contorno não é credível (fundo complexo, objecto cortado ou fragmentado).'], limits: [], requires: ['Use «Ajustar contorno» nessa vista (caixa + pincéis) ou fotografe sobre fundo liso.'] };
      const gaps = i.capture?.issues.filter((x) => x.code === 'ANGULAR_GAP' || x.code === 'NO_ELEVATION_VARIETY' || x.code === 'OBJECT_CUT_OFF') ?? [];
      const ceiling: FidelityClass = i.views >= 4 ? 'partially_verified' : 'conceptual_approximation';
      return {
        id: 'silhouette-hull', ceiling, certified: i.kind === 'multi-image' && (i.views ?? 0) >= 8 && i.posesDeclared !== true ? true : false,
        reasons: [`${i.views} vistas com contornos credíveis: casco visual contínuo a partir das silhuetas${i.kind === 'video' ? ' (fotogramas-chave de um vídeo de uma volta)' : ''}.`, ...(i.views >= 4 ? ['Com ≥ 4 vistas há vistas de controlo (concordância retida).'] : ['Com < 4 vistas não há vista de controlo: nada fica verificado.'])],
        limits: [...HULL_LIMITS, ...gaps.map((g) => g.message)], requires: gaps.map((g) => g.advice),
      };
    }
    case 'drawing-3view':
      return { id: 'orthographic-hull', ceiling: 'conceptual_approximation', certified: false, reasons: ['Três vistas ortogonais à mesma escala: casco ortográfico com dimensões partilhadas verificadas entre vistas.'], limits: [...HULL_LIMITS, 'Só validado em sólidos sintéticos; sem desenhos reais.'], requires: [] };
    case 'floor-plan':
      return { id: 'plan-reconstruction', ceiling: 'unvalidated', certified: false, reasons: ['Planta: caminho de reconstrução de plantas existente.'], limits: ['Não coberto pelo benchmark desta fase.'], requires: [] };
  }
}
