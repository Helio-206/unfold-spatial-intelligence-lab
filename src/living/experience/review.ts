/**
 * Human review of a reconstruction. Pure state, no DOM.
 *
 * Categories never merge: what the reconstruction returned (observed / hypothesis / unknown) is kept as it was; a
 * person's decision is recorded beside it, never instead of it. Only a person's action changes how something is shown:
 *  - confirm: "confirmado por si" (human confirmation, not engineering validation);
 *  - correct: "corrigido por si" (the person replaced the interpretation; the original is kept for audit);
 *  - reject: "rejeitado" (not used);
 *  - enter a value for an unknown property: "introduzido por si · não verificado" (human-entered, never "confirmed").
 * Nothing is promoted by confidence, by default or by entering the lab. Engineering validation is a separate gate
 * that only the engine can pass; human review never sets it.
 */
import type { ExcavatorEntityKind, ExcavatorObservationV1, ObservationStatus } from '../reconstruction/contracts';

export type Decision = 'pending' | 'confirmed' | 'corrected' | 'rejected';
export type Correction = { kind: ExcavatorEntityKind; label: string };
export type PropertyRow = { name: string; value: string | null; status: ObservationStatus; evidence: string | null; entered: string | null };
export type ReviewItem = {
  id: string; label: string; kind: ExcavatorEntityKind; status: ObservationStatus; confidence: number; decision: Decision;
  evidence: string[]; correction: Correction | null; properties: PropertyRow[];
};
export type ReviewState = { items: ReviewItem[]; focusId: string | null; sourceUnknowns: string[] };

export type LabCategory =
  | 'confirmed'   // a person confirmed it
  | 'corrected'   // a person corrected the interpretation
  | 'observed'    // read from the source, not yet confirmed by a person
  | 'hypothesis'  // still a hypothesis (only while pending; blocks the lab)
  | 'rejected'    // a person rejected it: not used
  | 'unknown';    // not recoverable from the source

export function initialReview(obs: ExcavatorObservationV1): ReviewState {
  const dims = (id: string): PropertyRow[] => obs.dimensions.filter((d) => d.partId === id).map((d) => ({ name: d.label, value: d.value === null ? null : `${d.value} ${d.unit}`, status: d.status, evidence: d.evidence[0]?.detail ?? null, entered: null }));
  return {
    items: obs.entities.map((e) => ({
      id: e.id, label: e.label, kind: e.kind, status: e.status, confidence: e.confidence, decision: 'pending', evidence: e.evidence.map((x) => x.detail), correction: null,
      properties: [
        ...e.features.map((f) => ({ name: f.name, value: f.value, status: f.status, evidence: f.evidence[0]?.detail ?? null, entered: null })),
        // a dimension that restates a feature ("Massa do contrapeso" vs "massa") is the same property: show it once
        ...dims(e.id).filter((d) => !e.features.some((f) => d.name.toLowerCase().includes(f.name.toLowerCase()))),
      ],
    })),
    focusId: obs.entities.find((e) => e.status === 'hypothesis')?.id ?? obs.entities[0]?.id ?? null,
    sourceUnknowns: [...obs.unknowns],
  };
}

export type ReviewAction =
  | { type: 'focus'; id: string }
  | { type: 'decide'; id: string; decision: 'pending' | 'confirmed' | 'rejected' }
  | { type: 'correct'; id: string; correction: Correction }
  | { type: 'enter_property'; id: string; name: string; value: string | null }
  | { type: 'next' };

export function reduceReview(state: ReviewState, action: ReviewAction): ReviewState {
  const patch = (id: string, f: (i: ReviewItem) => ReviewItem | null): ReviewState => {
    let changed = false;
    const items = state.items.map((i) => { if (i.id !== id) return i; const n = f(i); if (!n) return i; changed = true; return n; });
    return changed ? { ...state, items } : state;
  };
  switch (action.type) {
    case 'focus': return state.items.some((i) => i.id === action.id) ? { ...state, focusId: action.id } : state;
    case 'decide':
      // an unknown cannot be "confirmed": there is nothing to confirm. It stays unknown, can be rejected, or corrected.
      return patch(action.id, (i) => (i.status === 'unknown' && action.decision === 'confirmed') ? null : { ...i, decision: action.decision, correction: action.decision === 'pending' ? null : i.correction });
    case 'correct': {
      const label = action.correction.label.trim();
      if (!label) return state;
      return patch(action.id, (i) => ({ ...i, decision: 'corrected', correction: { kind: action.correction.kind, label: label.slice(0, 120) } }));
    }
    case 'enter_property':
      // only unknown properties take a value from a person; a value read from the source is never overwritten here
      return patch(action.id, (i) => {
        const p = i.properties.find((x) => x.name === action.name);
        if (!p || p.status !== 'unknown') return null;
        const v = action.value?.trim() || null;
        return { ...i, properties: i.properties.map((x) => (x.name === action.name ? { ...x, entered: v ? v.slice(0, 60) : null } : x)) };
      });
    case 'next': {
      const pending = state.items.filter((i) => i.decision === 'pending' && i.status === 'hypothesis');
      const after = pending.find((i) => state.items.indexOf(i) > state.items.findIndex((x) => x.id === state.focusId)) ?? pending[0];
      return after ? { ...state, focusId: after.id } : state;
    }
  }
}

export function labCategory(item: ReviewItem): LabCategory {
  if (item.decision === 'rejected') return 'rejected';
  if (item.decision === 'corrected') return 'corrected';
  if (item.decision === 'confirmed') return 'confirmed';
  return item.status;
}

/** How a property is shown. A person's value is labelled as such and stays unverified. */
export function propertyState(p: PropertyRow): 'observed' | 'hypothesis' | 'unknown' | 'entered' {
  if (p.status === 'unknown' && p.entered) return 'entered';
  return p.status;
}

export type ReviewSummary = {
  total: number; confirmed: number; corrected: number; observed: number; pendingHypotheses: number; rejected: number; unknown: number;
  decided: number; blockingIds: string[];
};

export function summarize(state: ReviewState): ReviewSummary {
  const cats = state.items.map(labCategory);
  const blockingIds = state.items.filter((i) => labCategory(i) === 'hypothesis').map((i) => i.id);
  const n = (c: LabCategory) => cats.filter((x) => x === c).length;
  return { total: state.items.length, confirmed: n('confirmed'), corrected: n('corrected'), observed: n('observed'), pendingHypotheses: blockingIds.length, rejected: n('rejected'), unknown: n('unknown'),
    decided: state.items.filter((i) => i.decision !== 'pending').length, blockingIds };
}

/** Structure a valid assembly needs. Kinds, after any correction by the person. */
export const REQUIRED_STRUCTURE: ReadonlyArray<{ kinds: ExcavatorEntityKind[]; label: string }> = [
  { kinds: ['track', 'chassis'], label: 'material circulante' },
  { kinds: ['house'], label: 'corpo superior' },
  { kinds: ['boom'], label: 'lança' },
  { kinds: ['stick'], label: 'braço' },
  { kinds: ['bucket'], label: 'caçamba' },
];

export type Readiness =
  | { status: 'review_pending'; pending: number }
  | { status: 'insufficient'; missing: string[] }
  | { status: 'ready_for_engine' };

/**
 * Gate 1, human review: can this reconstruction be handed to the engine? Never says "valid": only the engine can.
 * Usable = observed, confirmed or corrected (not hypothesis, unknown or rejected); a pending hypothesis is only "possible".
 */
export function readiness(state: ReviewState): Readiness {
  const s = summarize(state);
  // "Insufficient" means that even confirming every pending hypothesis would not give a machine. A hypothesis still
  // awaiting a decision can yet become usable, so it counts as possible structure here (and keeps the gate at "review pending").
  const possible = state.items.filter((i) => ['observed', 'confirmed', 'corrected', 'hypothesis'].includes(labCategory(i)));
  const kindOf = (i: ReviewItem) => i.correction?.kind ?? i.kind;
  const missing = REQUIRED_STRUCTURE.filter((r) => !possible.some((i) => r.kinds.includes(kindOf(i)))).map((r) => r.label);
  if (missing.length) return { status: 'insufficient', missing };
  if (s.pendingHypotheses) return { status: 'review_pending', pending: s.pendingHypotheses };
  return { status: 'ready_for_engine' };
}

/** Gate 2, engineering validation: owned by the engine. The UI only displays it; review never changes it. */
export type EngineGate = { status: 'not_run' } | { status: 'running' } | { status: 'valid'; solverId: string } | { status: 'blocked'; reasons: string[] };
export const ENGINE_GATE_LABEL: Record<EngineGate['status'], string> = {
  not_run: 'por executar · o motor valida depois da sua revisão', running: 'a validar no motor', valid: 'validada pelo motor', blocked: 'bloqueada pelo motor',
};

/** Per canonical part: the weakest category among the entities that cover it. */
const RANK: Record<LabCategory, number> = { unknown: 0, rejected: 1, hypothesis: 2, observed: 3, corrected: 4, confirmed: 5 };
export function partCategories(state: ReviewState, entityParts: Readonly<Record<string, readonly string[]>>): Map<string, LabCategory> {
  const out = new Map<string, LabCategory>();
  for (const item of state.items) {
    if (item.id === 'e_counterweight') continue; // a property-level unknown (mass) does not hide the house geometry
    for (const part of entityParts[item.id] ?? []) {
      const c = labCategory(item); const prev = out.get(part);
      if (!prev || RANK[c] < RANK[prev]) out.set(part, c);
    }
  }
  return out;
}

export const CATEGORY_LABEL: Record<LabCategory, string> = {
  confirmed: 'confirmado por si', corrected: 'corrigido por si', observed: 'observado · por confirmar', hypothesis: 'hipótese · por rever', rejected: 'rejeitado · não usado', unknown: 'desconhecido',
};
export const PROPERTY_LABEL: Record<ReturnType<typeof propertyState>, string> = {
  observed: 'observado', hypothesis: 'hipótese', unknown: 'desconhecido', entered: 'introduzido por si · não verificado',
};
