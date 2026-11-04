import { evidenceFromJSON, type EvidenceJSON } from './evidence';
import { independentViews, reconstructStructure } from './engine';
import { proposeShapeAlternatives } from './shapes';
import type { SpatialPlanV2 } from '../contracts-v2';

self.onmessage = (event: MessageEvent<{ plan: SpatialPlanV2; evidence: EvidenceJSON; allowContradicted: boolean; confirmed: string[]; mode: 'structure' | 'shapes' }>) => {
  try {
    const { plan, evidence, allowContradicted, confirmed, mode } = event.data;
    const views = evidenceFromJSON(evidence);
    if (mode === 'shapes' && independentViews(views, 20).length < 4) throw new Error('V4_SHAPES_NEED_INDEPENDENT_VIEWS');
    const outcome = mode === 'shapes' ? proposeShapeAlternatives(plan, views) : reconstructStructure(plan, views, { allowContradicted, confirmed: new Set(confirmed) });
    self.postMessage({ ok: true, outcome });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : 'WORKER_FAILED' });
  }
};
