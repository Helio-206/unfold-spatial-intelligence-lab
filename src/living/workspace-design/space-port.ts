import type { SpatialPlanV2 } from '../../universal-spatial/contracts-v2';
import type { Box3, Camera, Object3D, Vector2 } from 'three';

/**
 * What the SpatialWorkspace needs from a "space" (a scene that is not the excavator). The workspace keeps owning the renderer, the camera,
 * the rail, the composer, the inspector shell and the notices; a space only brings its objects, its picking and the content of the inspector.
 * Nothing here knows about plans, Meta or the review: that lives in `living/spatial-space/`.
 */
export interface SpaceLayer {
  /** Added to the Foundry scene on show and removed on clear. The layer owns what is below it and frees it in `dispose`. */
  readonly root: Object3D;
  /** Optional reviewed plan and visual generation for explanation, owned by the layer. */
  readonly currentPlan?: SpatialPlanV2;
  readonly explanationVersion?: number;
  /** World box of everything shown, or of one component. Null when there is nothing to frame. */
  box(id?: string | null): Box3 | null;
  /** Azimuth (degrees, Cinema convention: from +X toward +Z) of the best three-quarter view, or null when the layer has no opinion. */
  heroAzimuthDeg?(): number | null;
  /** The id of the component under `ndc`, or null. */
  pick(ndc: Vector2, camera: Camera): string | null;
  /** Advance presentation state by the real elapsed time of this frame; true while another frame is needed. */
  update?(dtMs: number): boolean;
  /** A successful renderer frame has completed. */
  afterRender?(): void;
  highlight(id: string | null): void;
  /** Generic exploded view (display only). Absent when the layer cannot do it. */
  setExploded?(on: boolean): boolean;
  readonly isExploded?: boolean;
  isolate(id: string | null): void;
  readonly isolatedId: string | null;
  /** Fills the inspector body for the selected component and wires its own controls. `invalidate` is called when the layer changes anything visible. */
  renderInspector(host: HTMLElement, id: string, evidenceOpen: boolean): void;
  /** Short label for the inspector header ("componente · id"). */
  describe(id: string): { kind: string; label: string } | null;
  has(id: string): boolean;
  /** Nothing is selected any more (the person cleared it or the component disappeared). */
  onSelectionCleared?(): void;
  dispose(): void;
}
