/**
 * Worker do fitting: a grelha completa (compilações + rasterização de silhuetas) corre
 * fora da main thread. O plano e a evidência chegam serializados; o resultado é o mesmo
 * objecto determinístico da versão síncrona. Sem DOM: o caminho de compilação do Foundry
 * só usa three.js (verificado por grep: sem `document` em foundry/materials/ops).
 */
import { fitGeometryToEvidence, type FittingResult } from './fitting';
import type { ImageEvidence } from './evidence';
import type { SpatialPlanV2 } from '../../universal-spatial/contracts-v2';

type Request = { id: string; plan: SpatialPlanV2; evidence: Omit<ImageEvidence, 'mask'> & { mask: number[] } };
type Response = { id: string; result: FittingResult } | { id: string; error: string };

const scope = self as unknown as { onmessage: ((e: MessageEvent<Request>) => void) | null; postMessage(m: Response): void };
scope.onmessage = (e) => {
  const { id, plan, evidence } = e.data;
  try {
    const result = fitGeometryToEvidence(plan, { ...evidence, mask: new Uint8Array(evidence.mask) });
    scope.postMessage({ id, result });
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
