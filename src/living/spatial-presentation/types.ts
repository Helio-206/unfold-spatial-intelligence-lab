import type { Object3D } from 'three';
import type { SpatialPlanV2 } from '../../universal-spatial/contracts-v2';

/**
 * Public contract of the Universal Spatial Presentation Director (`src/living/spatial-presentation/`). STABLE: the SpatialWorkspace integration
 * (owned by the Terminal) consumes only what is exported here and from `./index`. Behaviour and rules: `./API.md`.
 *
 * Ownership, once and for all:
 *  - the workspace owns the renderer, the camera, the camera arbiter, the rail, the inspector, the selection and the plan;
 *  - the Director owns nothing of those. It receives the plan and the already compiled objects, animates presentation-only state on them
 *    (visibility, local offsets of component groups, a dim factor on colours) and emits camera CUES that the host may honour or ignore;
 *  - it never writes the plan, never creates a renderer, a scene, a camera or a loop, and restores every property it touched.
 */

/** Same shape as `SpatialWorkspace.setView` (azimuth in the WORKSPACE director's convention, which is the mirror of the Cinema's). */
export type CueView = { target: [number, number, number]; azimuthDeg: number; elevationDeg: number; distance: number };
export type CueKind = 'establish' | 'follow' | 'focus' | 'poi' | 'overview' | 'explode' | 'restore';
export type CameraCue = {
  /** Stable within one run, e.g. `entrance:2`. */
  readonly id: string;
  readonly kind: CueKind;
  /** Plain-language reason a person can read ("frames the largest part"). */
  readonly reason: string;
  readonly view: CueView;
  /** 0 under reduced motion: the host should jump. */
  readonly durationMs: number;
  /** Component the cue is about, if any. */
  readonly componentId: string | null;
  /** The host decides (CameraArbiter): a cue is a request, never a command, and a person's input always wins. */
  readonly interruptible: true;
};

/** What the host knows about the usable area; needed to turn boxes into distances. Same types as `workspace-design/framing`. */
export type ViewContext = { viewport: { width: number; height: number }; insets: { top: number; right: number; bottom: number; left: number }; baseFovDeg: number };

export type PresentationPhase = 'idle' | 'entering' | 'exploring' | 'touring' | 'exploded' | 'editing' | 'disposed';
export type PresentationState = {
  readonly phase: PresentationPhase;
  /** 0..1 of the running sequence (entrance) or transition (explode); 1 when nothing runs. */
  readonly progress: number;
  /** Component currently focused by the Director (not the workspace selection). */
  readonly focusId: string | null;
  /** 0 = assembled as planned, 1 = fully exploded. */
  readonly exploded: number;
  readonly poiIndex: number | null;
  /** Components shown so far during the entrance. */
  readonly shown: number;
  readonly total: number;
  readonly reducedMotion: boolean;
  /** Text the host MUST show while it is non-null (an exploded view is a visualisation, not a movement of the object). */
  readonly notice: string | null;
  /** Presentation-only changes currently active, for the inspector ("entrance offsets", "dim", "exploded view", "finish", "edge softening"). */
  readonly active: readonly string[];
};

export type PointOfInterestKind = 'overview' | 'component' | 'joint';
export type PointOfInterest = {
  readonly id: string;
  readonly kind: PointOfInterestKind;
  readonly label: string;
  /** Structural reason, derived from the plan: never a claim about what the object is. */
  readonly why: string;
  readonly componentIds: readonly string[];
  /** World-space centre and radius at presentation time. */
  readonly centre: [number, number, number];
  readonly radius: number;
};

export type SequenceStep = { readonly componentId: string; readonly label: string; readonly order: number; readonly reason: string };

export type PresentationOptions = {
  /** The reviewed plan. Read only. Never mutated. */
  plan: SpatialPlanV2;
  /** Root of the compiled objects (the layer's wrapper or `compileSpatialPlanV2().root`). Owned by the caller; component groups carry `userData.spatialComponentRoot`. */
  root: Object3D;
  /** Called when something visible changed. The host renders (its own loop). */
  requestRender(): void;
  /** Camera requests. Optional: without it the Director still animates the object. */
  onCue?(cue: CameraCue): void;
  onState?(state: PresentationState): void;
  /** `'auto'` follows `prefers-reduced-motion` (listener removed on dispose). Default `'auto'`. */
  reducedMotion?: boolean | 'auto';
  view?: ViewContext;
  /** PBR finishes per material profile on the compiled materials (reversible). Default true. */
  finish?: boolean;
  /** Longest-side-relative sizes; defaults are in `API.md`. */
  tuning?: Partial<PresentationTuning>;
};

export type PresentationTuning = {
  /** total entrance duration in ms at normal motion, spread over the components (capped) */
  entranceMs: number;
  explodeMs: number;
  /** 0..1 how far a fully exploded view pushes parts, relative to the assembly's longest side */
  explodeSpread: number;
  /** colour/reflection multiplier of non-focused components while one is focused */
  dim: number;
  maxPois: number;
};

export type SequenceHandle = {
  /** Resolves when the sequence ends, whichever way: `completed` or `cancelled`. Never rejects. */
  readonly done: Promise<'completed' | 'cancelled'>;
  cancel(): void;
};

export interface PresentationDirector {
  readonly state: PresentationState;
  readonly pointsOfInterest: readonly PointOfInterest[];
  /** Order in which the entrance will build the object, with a structural reason per step. */
  readonly sequence: readonly SequenceStep[];

  /** Advance by `dtMs` of real time. Call from the host's frame loop; returns true while another frame is needed. No timers inside. */
  update(dtMs: number): boolean;
  setViewContext(view: ViewContext): void;
  setReducedMotion(value: boolean | 'auto'): void;

  /** Cinematic entrance: establishing cue, parts arrive in structural order, settle on the planned positions, hero cue. */
  playEntrance(): SequenceHandle;
  /** Dim everything but `componentId` and emit a focus cue. `null` clears. Does not touch the workspace selection. */
  focus(componentId: string | null, options?: { cue?: boolean }): void;
  /** Point-of-interest tour. */
  startTour(): SequenceHandle;
  nextPoi(): void;
  previousPoi(): void;
  stopTour(): void;
  /** Reversible exploded view (0 = as planned, 1 = fully). Always sets `state.notice` while exploded. */
  setExploded(amount: number, options?: { animate?: boolean; cue?: boolean }): void;
  toggleExploded(): void;

  /** The person is editing: stop everything, restore exact planned transforms and colours, keep PBR finish. The host edits the real plan. */
  enterEditing(): void;
  /** Back to exploring after an edit. */
  resumeExploring(): void;
  /** The plan or the compiled objects changed (edit, undo, solver): drop saved state of the old objects, re-analyse, keep the phase sensible. */
  rebind(next: { plan: SpatialPlanV2; root: Object3D }): void;
  /** The meshes inside these component groups were replaced (same groups, same plan). Re-reads them and re-applies the finish and the dimming; nothing else is reset: no sequence, focus or exploded state. */
  refreshComponents(ids: readonly string[]): void;

  /** Stop any motion and restore everything to the planned state (does not dispose). */
  cancel(): void;
  /** Cancel, restore, release textures and listeners. Idempotent. */
  dispose(): void;
}

export type { Object3D, SpatialPlanV2 };
