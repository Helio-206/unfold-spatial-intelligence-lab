/**
 * Human review of a reconstruction. Pure state, no DOM.
 *
 * The four categories never merge: what the reconstruction returned (observed / hypothesis / unknown) is kept as it was;
 * a person's decision is recorded beside it, never instead of it. Only a person's decision can make something
 * "confirmado"; nothing is promoted by default, by confidence or by entering the lab.
 */
import type { ExcavatorObservationV1, ObservationStatus } from '../reconstruction/contracts';

export type Decision = 'pending' | 'confirmed' | 'rejected';
export type ReviewItem = { id: string; label: string; status: ObservationStatus; confidence: number; decision: Decision; evidence: string[] };
export type ReviewState = { items: ReviewItem[]; focusId: string | null };

/** How a component appears in the lab after review. */
export type LabCategory =
  | 'confirmed'        // a person confirmed it (from observed or hypothesis)
  | 'observed'         // read from the source, not yet confirmed by a person
  | 'hypothesis'       // still a hypothesis (only possible while pending; blocks the lab)
  | 'rejected'         // a person rejected it: not used
  | 'unknown';         // not recoverable from the source

export function initialReview(obs: ExcavatorObservationV1): ReviewState {
  return {
    items: obs.entities.map((e) => ({ id: e.id, label: e.label, status: e.status, confidence: e.confidence, decision: 'pending', evidence: e.evidence.map((x) => x.detail) })),
    focusId: obs.entities.find((e) => e.status === 'hypothesis')?.id ?? obs.entities[0]?.id ?? null,
  };
}

export type ReviewAction = { type: 'focus'; id: string } | { type: 'decide'; id: string; decision: Decision } | { type: 'next' };

export function reduceReview(state: ReviewState, action: ReviewAction): ReviewState {
  switch (action.type) {
    case 'focus': return state.items.some((i) => i.id === action.id) ? { ...state, focusId: action.id } : state;
    case 'decide': {
      const item = state.items.find((i) => i.id === action.id);
      // unknown cannot be "confirmed": there is nothing to confirm. It can only stay unknown or be rejected.
      if (!item || (item.status === 'unknown' && action.decision === 'confirmed')) return state;
      const items = state.items.map((i) => (i.id === action.id ? { ...i, decision: action.decision } : i));
      return { ...state, items };
    }
    case 'next': {
      const pending = state.items.filter((i) => i.decision === 'pending' && i.status === 'hypothesis');
      const after = pending.find((i) => state.items.indexOf(i) > state.items.findIndex((x) => x.id === state.focusId)) ?? pending[0];
      return after ? { ...state, focusId: after.id } : state;
    }
  }
}

export function labCategory(item: ReviewItem): LabCategory {
  if (item.decision === 'rejected') return 'rejected';
  if (item.decision === 'confirmed') return 'confirmed';
  return item.status; // observed, hypothesis or unknown, unchanged
}

export type ReviewSummary = { total: number; confirmed: number; observed: number; pendingHypotheses: number; rejected: number; unknown: number; canEnterLab: boolean; blockingIds: string[] };

/** The lab opens only when no hypothesis is left undecided. Unknowns may stay unknown: they are shown as such. */
export function summarize(state: ReviewState): ReviewSummary {
  const cats = state.items.map((i) => labCategory(i));
  const blockingIds = state.items.filter((i) => labCategory(i) === 'hypothesis').map((i) => i.id);
  return {
    total: state.items.length,
    confirmed: cats.filter((c) => c === 'confirmed').length,
    observed: cats.filter((c) => c === 'observed').length,
    pendingHypotheses: blockingIds.length,
    rejected: cats.filter((c) => c === 'rejected').length,
    unknown: cats.filter((c) => c === 'unknown').length,
    canEnterLab: blockingIds.length === 0,
    blockingIds,
  };
}

/** Per canonical part: the weakest category among the entities that cover it (unknown < rejected < hypothesis < observed < confirmed). */
const RANK: Record<LabCategory, number> = { unknown: 0, rejected: 1, hypothesis: 2, observed: 3, confirmed: 4 };
export function partCategories(state: ReviewState, entityParts: Readonly<Record<string, readonly string[]>>): Map<string, LabCategory> {
  const out = new Map<string, LabCategory>();
  for (const item of state.items) {
    // an entity that adds a property to a part (the counterweight's unknown mass) does not hide the part's geometry
    if (item.id === 'e_counterweight') continue;
    for (const part of entityParts[item.id] ?? []) {
      const c = labCategory(item); const prev = out.get(part);
      if (!prev || RANK[c] < RANK[prev]) out.set(part, c);
    }
  }
  return out;
}

export const CATEGORY_LABEL: Record<LabCategory, string> = {
  confirmed: 'confirmado por si', observed: 'observado · por confirmar', hypothesis: 'hipótese · por rever', rejected: 'rejeitado · não usado', unknown: 'desconhecido',
};
