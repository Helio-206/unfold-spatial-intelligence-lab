/**
 * V4 reconstruction contracts (TYPES ONLY, nothing here is wired into the workspace). Prose: `reports/fidelity-v4/PHASE-A.md`.
 *
 * The reviewed SpatialPlan stays the single source of truth for WHAT exists (component ids, hierarchy, relations, provenance, source hash). Every stage of the
 * Adaptive Reconstruction Engine proposes; none writes the plan. A proposal reaches the plan only as typed operations through preview -> authorisation -> commit.
 */

/** How the geometry of one component was obtained. Never promoted by a later stage without new evidence. */
export type GeometryBasis =
  | 'generated'      // produced by a deterministic engine from the plan's own parameters (V2 primitives, V3 surfaces, CAD): exact to the parameters, silent about the real object
  | 'inferred'       // estimated from the source by a model or a fit (silhouette fitting, a model's mesh): a hypothesis
  | 'external_asset' // a mesh made outside UNFOLD (licensed library, upload, provider): needs a recorded approval and a verified licence
  | 'validated'      // checked against evidence (views, measurements, a person): carries the evidence and its limits
  | 'approximate';   // stand-in with a stated reason (placeholder primitive, unresolved structure)

export type Evidence =
  | { kind: 'silhouette_views'; views: number; heldOutViews: number; iou: number; heldOutIou: number | null }
  | { kind: 'human_review'; reviewerAuthenticated: false; at: string }
  | { kind: 'measurement'; quantity: string; value: number; unit: string }
  | { kind: 'none' };

/** What the Structural Reconstruction stage may propose for one component: values, never a write. */
export type StructuralProposal = {
  componentId: string;
  basis: Extract<GeometryBasis, 'inferred' | 'approximate'>;
  /** typed operations of the existing SpatialOperationV2 contract, in application order */
  operations: unknown[];
  evidence: Evidence;
  /** parts of the source this proposal could not explain; never silently dropped */
  unexplained: string[];
};

/** One engine of the Geometry Generation stage. The router chooses per component; V2 is always the return path. */
export interface GeometryEngine {
  readonly id: string;
  readonly basis: GeometryBasis;
  /** cheap, side-effect free: can this engine draw this component, and at what bounded cost? */
  canDraw(componentId: string): { ok: true; estimatedTriangles: number } | { ok: false; code: string };
}

/** Result of the Visual Verification stage: measured against the SOURCE, with uncertainty kept. */
export type VerificationReport = {
  planSourceSha256: string;
  views: Array<{ label: string; silhouetteIou: number | null; note: string }>;
  /** metrics computed from geometry and images; a perceptual or AI judgement is recorded separately and never replaces human recognition */
  objective: Record<string, number>;
  perceptual: Array<{ judge: 'model' | 'person'; verdict: string; authenticated: boolean }>;
  discrepancies: Array<{ componentId: string | null; description: string }>;
};
