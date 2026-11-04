import { validateSpatialPlanV2, type SpatialPlanV2 } from '../../universal-spatial/contracts-v2';

/**
 * Human review of a plan that a model proposed. The person keeps or rejects whole components; nothing else about the plan changes, and keeping
 * a component never turns an inferred value into a confirmed one (that is what an explicit edit is for).
 */
export type ReviewDecision = 'keep' | 'reject';
export type SpaceReview = { decisions: Record<string, ReviewDecision | undefined>; acknowledged: boolean };

export const initialSpaceReview = (): SpaceReview => ({ decisions: {}, acknowledged: false });

export function decide(review: SpaceReview, id: string, decision: ReviewDecision | undefined): SpaceReview {
  const decisions = { ...review.decisions };
  if (decision === undefined) delete decisions[id]; else decisions[id] = decision;
  return { ...review, decisions };
}

export function decideAll(plan: SpatialPlanV2, review: SpaceReview, decision: ReviewDecision): SpaceReview {
  return { ...review, decisions: Object.fromEntries(plan.components.map((component) => [component.id, decision])) };
}

/** Every component needs a decision, and the person must have acknowledged what the plan is. Plain-language reasons; empty means it can be built. */
export function reviewBlockers(plan: SpatialPlanV2, review: SpaceReview): string[] {
  const out: string[] = [];
  const undecided = plan.components.filter((component) => review.decisions[component.id] === undefined).length;
  if (undecided) out.push(`${undecided} componente${undecided > 1 ? 's' : ''} sem decisão`);
  const kept = plan.components.filter((component) => review.decisions[component.id] === 'keep').length;
  if (!undecided && kept === 0) out.push('é preciso manter pelo menos um componente');
  if (!review.acknowledged) out.push('falta confirmar que é uma concepção da IA, não uma medição');
  return out;
}

/** A component whose ancestor is rejected goes with it: a part cannot hang from something that is not there. */
export function removedIds(plan: SpatialPlanV2, review: SpaceReview): Set<string> {
  const rejected = new Set(plan.components.filter((component) => review.decisions[component.id] === 'reject').map((component) => component.id));
  const parent = new Map(plan.components.map((component) => [component.id, component.parentId] as const));
  const removed = new Set(rejected);
  for (const component of plan.components) {
    for (let at: string | null | undefined = component.parentId, hops = 0; at && hops < 64; at = parent.get(at), hops++) if (rejected.has(at)) { removed.add(component.id); break; }
  }
  return removed;
}

/** The plan with the rejected components (and what hangs from them) removed, together with the relations and constraints that named them. Re-validated. */
export function pruneSpatialPlan(plan: SpatialPlanV2, removed: ReadonlySet<string>): SpatialPlanV2 {
  if (!removed.size) return plan;
  const dropped = plan.components.filter((component) => removed.has(component.id)).map((component) => component.label);
  const unknowns = [...plan.unknowns, ...(dropped.length ? [`Revisão humana: removido${dropped.length > 1 ? 's' : ''} ${dropped.join(', ')}.`] : [])].slice(0, 100);
  return validateSpatialPlanV2({
    ...plan,
    components: plan.components.filter((component) => !removed.has(component.id)),
    relations: plan.relations.filter((relation) => !removed.has(relation.fromId) && !removed.has(relation.toId)),
    constraints: plan.constraints.filter((constraint) => !constraint.componentIds.some((id) => removed.has(id))),
    unknowns,
  });
}

/** What the review recorded, for the evidence file. The identity is the browser's claim, never proof of a person. */
export function reviewRecord(plan: SpatialPlanV2, review: SpaceReview) {
  return {
    contract: 'unfold.space-review.v1' as const,
    reviewer: 'client_asserted_unverified' as const,
    acknowledgedConceptualPlan: review.acknowledged,
    kept: plan.components.filter((component) => review.decisions[component.id] === 'keep').map((component) => component.id),
    rejected: plan.components.filter((component) => review.decisions[component.id] === 'reject').map((component) => component.id),
    removedWithAncestor: [...removedIds(plan, review)].filter((id) => review.decisions[id] !== 'reject'),
  };
}
