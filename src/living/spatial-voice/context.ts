import { validateSpatialPlanV2, type SpatialPlanV2 } from '../../universal-spatial/contracts-v2';

/** A snapshot, never a reference to a mutable plan. The caller owns the revision token. */
export type SpatialExplanationContext = {
  revision: string;
  plan: SpatialPlanV2;
  componentId: string | null;
};

export function createSpatialExplanationContext(plan: SpatialPlanV2, componentId: string | null, revision: string): SpatialExplanationContext {
  if (!revision.trim()) throw new Error('EXPLANATION_REVISION_REQUIRED');
  const snapshot = structuredClone(plan);
  validateSpatialPlanV2(snapshot);
  if (componentId !== null && !snapshot.components.some((component) => component.id === componentId)) throw new Error('EXPLANATION_COMPONENT_NOT_FOUND');
  return { revision, plan: snapshot, componentId };
}
