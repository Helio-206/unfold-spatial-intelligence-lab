/**
 * High-fidelity geometry provider: the integration surface for the cinematic stage (Claude Cloud).
 *
 * Gives a scene graph of display meshes, one Group per canonical part, and accepts only validated
 * `unfold.motion-frame.v1` frames (or the reference pose). It never solves engineering relations and never invents
 * poses: a frame whose status is not `ok`, or that fails validation, is refused and the current pose is kept.
 *
 * The stage owns the renderer, camera, lights and post-processing. This provider owns display geometry and materials.
 * It does not import the workspace, the studio or the renderer.
 */
import type { Group } from 'three';
import { validateMotionFrame, type Assembly, type MotionFrame } from '../contracts';
import { buildComponentRegistry, type ComponentRegistry } from './component-registry';
import { buildExcavator } from './excavator/build';
import { createMaterialLibrary, type MaterialKey } from './materials';
import { framePoses, referencePoses } from './poses';

export const PROVIDER_ID = 'unfold.visual-foundry.excavator' as const;
export const PROVIDER_VERSION = '1' as const;

export type FrameApplication =
  | { status: 'applied'; poseBasis: MotionFrame['poseBasis'] | 'reference'; source: 'engine' | 'fixture' | 'reference'; unknownPartIds: string[] }
  | { status: 'refused'; reason: string };

export type GeometryProvider = {
  id: typeof PROVIDER_ID;
  version: typeof PROVIDER_VERSION;
  assemblyId: string;
  /** Add to the stage scene. World frame = assembly world frame: +X forward, +Y up, +Z right, metres. */
  root: Group;
  /** canonical part id → Group. Meshes carry `userData.partId`; display-only meshes carry `userData.displayOnly`. */
  parts: ReadonlyMap<string, Group>;
  registry: ComponentRegistry;
  /** Material keys in use (for stage-side overrides such as ghosting); never redefine the library itself. */
  materialKeys: readonly MaterialKey[];
  applyReferencePose(): FrameApplication;
  /** Validated frames only. Frames carrying FIXTURE_NOT_ENGINE are applied but reported as `source: 'fixture'`. */
  applyFrame(frame: unknown): FrameApplication;
  stats(): { meshes: number; triangles: number; materials: number; textures: number };
  dispose(): void;
};

export function createExcavatorProvider(assembly: Assembly): GeometryProvider {
  const lib = createMaterialLibrary();
  const model = buildExcavator(assembly, lib);
  const registry = buildComponentRegistry(assembly);
  let disposed = false;
  const apply = (poses: Parameters<typeof model.applyPoses>[0]) => model.applyPoses(poses).unknown;
  return {
    id: PROVIDER_ID, version: PROVIDER_VERSION, assemblyId: assembly.id, root: model.root, parts: model.parts, registry,
    materialKeys: lib.materials().map((m) => m.userData.materialKey as MaterialKey),
    applyReferencePose() {
      if (disposed) return { status: 'refused', reason: 'PROVIDER_DISPOSED' };
      return { status: 'applied', poseBasis: 'reference', source: 'reference', unknownPartIds: apply(referencePoses().poses) };
    },
    applyFrame(frame) {
      if (disposed) return { status: 'refused', reason: 'PROVIDER_DISPOSED' };
      const v = validateMotionFrame(frame);
      if (!v.ok) return { status: 'refused', reason: `INVALID_MOTION_FRAME:${v.issues[0]?.path ?? '$'}` };
      const f = frame as MotionFrame;
      if (f.assemblyId !== assembly.id) return { status: 'refused', reason: 'ASSEMBLY_MISMATCH' };
      if (f.status !== 'ok' || f.parts.length === 0) return { status: 'refused', reason: `FRAME_STATUS_${f.status.toUpperCase()}` };
      const fixture = f.warnings.some((w) => w.code === 'FIXTURE_NOT_ENGINE');
      return { status: 'applied', poseBasis: f.poseBasis, source: fixture ? 'fixture' : 'engine', unknownPartIds: apply(framePoses(f)) };
    },
    stats() {
      let meshes = 0, triangles = 0;
      model.root.traverse((o) => { const m = o as import('three').Mesh; if (!m.isMesh) return; meshes++; const g = m.geometry; triangles += (g.index ? g.index.count : g.attributes.position!.count) / 3; });
      return { meshes, triangles: Math.round(triangles), materials: lib.materials().length, textures: lib.textures().length };
    },
    dispose() { if (disposed) return; disposed = true; model.dispose(); lib.dispose(); },
  };
}
