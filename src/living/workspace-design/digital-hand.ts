/**
 * Digital Hand: the assistant's attention in the scene, always grounded on a canonical component.
 *
 * The hand never points at a screen coordinate on its own. It is given a canonical id, resolves it through the
 * component registry to world-space anchors on the canonical part frames, and re-projects every frame so it tracks
 * camera moves and part motion. When it cannot resolve the target confidently it says so (missing, behind the camera,
 * occluded, no display geometry) instead of inventing a location.
 */
import { Box3, Raycaster, Sphere, Vector3, type Camera, type Group, type Object3D } from 'three';
import type { CanonicalComponent, ComponentRegistry } from '../visual-foundry/component-registry';

export type HandState = 'hidden' | 'attention' | 'inspect' | 'point' | 'select' | 'proposal' | 'blocked' | 'awaiting';
/** Shown with the state, in Geist Mono; shape and motion carry the rest, never a new colour. */
export const HAND_STATE_LABEL: Record<HandState, string> = {
  hidden: '', attention: 'atenção', inspect: 'inspeccionar', point: 'aponta', select: 'seleccionado', proposal: 'proposta', blocked: 'bloqueado', awaiting: 'aguarda confirmação',
};
/** Whether the assistant is only observing, suggesting, or doing something the person approved. */
export const HAND_AGENCY: Record<HandState, 'observing' | 'suggesting' | 'performing_approved' | 'none'> = {
  hidden: 'none', attention: 'observing', inspect: 'observing', point: 'observing', select: 'observing', proposal: 'suggesting', blocked: 'none', awaiting: 'suggesting',
};

export type Viewport = { width: number; height: number };
export type SafeInsets = { top: number; right: number; bottom: number; left: number };

export type Projection = {
  x: number; y: number;
  /** NDC depth; > 1 means beyond the far plane. */
  ndcZ: number;
  behind: boolean;
  onScreen: boolean;
  /** Position clamped into the safe area, and the direction to the real target, for an edge indicator. */
  edge: { x: number; y: number; angle: number } | null;
};

const v = new Vector3();

/** World point → CSS pixels in the viewport. Points behind the camera are mirrored so the edge arrow points the right way. */
export function projectToScreen(world: Vector3, camera: Camera, viewport: Viewport, safe: SafeInsets = { top: 0, right: 0, bottom: 0, left: 0 }): Projection {
  camera.updateMatrixWorld();
  const view = v.copy(world).applyMatrix4(camera.matrixWorldInverse);
  const behind = view.z > 0; // camera looks down -Z
  const ndc = world.clone().project(camera);
  let nx = ndc.x, ny = ndc.y;
  if (behind) { nx = -nx; ny = -ny; }
  const x = (nx * 0.5 + 0.5) * viewport.width, y = (-ny * 0.5 + 0.5) * viewport.height;
  const inside = !behind && ndc.z <= 1 && x >= safe.left && x <= viewport.width - safe.right && y >= safe.top && y <= viewport.height - safe.bottom;
  if (inside) return { x, y, ndcZ: ndc.z, behind, onScreen: true, edge: null };
  // clamp along the ray from the safe-area centre so the indicator sits on the safe-area border
  const cx = (safe.left + viewport.width - safe.right) / 2, cy = (safe.top + viewport.height - safe.bottom) / 2;
  let dx = x - cx, dy = y - cy;
  if (behind && Math.hypot(dx, dy) < 1e-6) { dx = 0; dy = 1; }
  const hw = (viewport.width - safe.left - safe.right) / 2 - 24, hh = (viewport.height - safe.top - safe.bottom) / 2 - 24;
  const k = Math.min(Math.abs(hw / (dx || 1e-9)), Math.abs(hh / (dy || 1e-9)));
  return { x, y, ndcZ: ndc.z, behind, onScreen: false, edge: { x: cx + dx * k, y: cy + dy * k, angle: Math.atan2(dy, dx) } };
}

export type Resolution =
  | { status: 'resolved'; component: CanonicalComponent; anchorWorld: Vector3; bounds: Sphere }
  | { status: 'missing'; id: string; message: string }
  | { status: 'no_display_geometry'; id: string; component: CanonicalComponent; message: string };

/** Canonical id → world anchor and bounds, from the current part transforms. */
export function resolveTarget(id: string, registry: ComponentRegistry, parts: Map<string, Group>): Resolution {
  const component = registry.get(id);
  if (!component) return { status: 'missing', id, message: `Não existe o componente «${id}» na montagem ${registry.assemblyId}.` };
  const groups = component.partIds.map((p) => parts.get(p)).filter((g): g is Group => !!g && !g.userData.noDisplayGeometry);
  if (!groups.length) return { status: 'no_display_geometry', id, component, message: `«${component.label}» não tem geometria de visualização.` };
  const anchor = new Vector3();
  let n = 0;
  for (const a of component.anchors) {
    const g = parts.get(a.partId); if (!g) continue;
    g.updateWorldMatrix(true, false);
    anchor.add(new Vector3(...a.localM).applyMatrix4(g.matrixWorld)); n++;
  }
  if (!n) return { status: 'missing', id, message: `As âncoras de «${component.label}» não têm parte no modelo.` };
  anchor.divideScalar(n);
  const box = new Box3();
  for (const g of groups) box.expandByObject(g);
  return { status: 'resolved', component, anchorWorld: anchor, bounds: box.getBoundingSphere(new Sphere()) };
}

/** Pixel radius of a world sphere on screen (for small parts: the hand keeps a minimum size and adds a leader). */
export function screenRadius(sphere: Sphere, camera: Camera & { fov?: number }, viewport: Viewport): number {
  const dist = sphere.center.distanceTo(new Vector3().setFromMatrixPosition(camera.matrixWorld));
  const fov = ((camera.fov ?? 30) * Math.PI) / 180;
  return (sphere.radius / Math.max(1e-6, dist * Math.tan(fov / 2))) * (viewport.height / 2);
}

export type Occlusion = { status: 'visible' | 'occluded'; blockerPartId: string | null };

/**
 * Is the anchor hidden behind another canonical part? Ray from the camera to the anchor against canonical meshes only
 * (display-only meshes such as hoses never block, never resolve).
 */
export function occlusion(anchor: Vector3, targetPartIds: string[], camera: Camera, meshes: Object3D[], raycaster = new Raycaster()): Occlusion {
  const origin = new Vector3().setFromMatrixPosition(camera.matrixWorld);
  const dir = anchor.clone().sub(origin); const dist = dir.length(); dir.normalize();
  raycaster.set(origin, dir); raycaster.near = 0; raycaster.far = dist - 0.05;
  for (const hit of raycaster.intersectObjects(meshes, false)) {
    const pid = partIdOf(hit.object);
    if (!pid) continue;
    if (targetPartIds.includes(pid)) return { status: 'visible', blockerPartId: null };
    return { status: 'occluded', blockerPartId: pid };
  }
  return { status: 'visible', blockerPartId: null };
}

/** The canonical part id a mesh belongs to, or null for display-only geometry. */
export function partIdOf(object: Object3D | null): string | null {
  for (let o: Object3D | null = object; o; o = o.parent) {
    if (o.userData.displayOnly) return null;
    if (typeof o.userData.partId === 'string') return o.userData.partId;
  }
  return null;
}

/** Short, honest status of a component's data, shown next to the hand label. */
export function uncertaintyLabel(component: CanonicalComponent): { text: string; uncertain: boolean } {
  if (component.validation === 'verified' || component.validation === 'corrected') return { text: `${component.origin} · confirmado`, uncertain: false };
  if (component.validation === 'rejected') return { text: `${component.origin} · rejeitado`, uncertain: true };
  if (component.validation === 'ambiguous') return { text: `${component.origin} · ambíguo`, uncertain: true };
  if (component.origin === 'fixture' || component.origin === 'synthetic') return { text: `${component.origin} · não verificado`, uncertain: true };
  if (component.origin === 'model_inferred') return { text: 'reconstruído · não verificado', uncertain: true };
  return { text: `${component.origin} · não verificado`, uncertain: true };
}

export type HandView = {
  state: HandState;
  targetId: string | null;
  label: string;
  stateLabel: string;
  uncertainty: { text: string; uncertain: boolean } | null;
  /** Pixel position of the reticle, or null when it is not drawn. */
  x: number | null; y: number | null;
  radiusPx: number;
  offscreen: Projection['edge'];
  occluded: boolean;
  problem: string | null;
};

/** The hand's model: what it is attending to and how. Rendering is the view's job. */
export class DigitalHand {
  private stateValue: HandState = 'hidden';
  private target: string | null = null;
  private note: string | null = null;
  constructor(private readonly registry: ComponentRegistry, private readonly parts: Map<string, Group>) {}

  get state(): HandState { return this.stateValue; }
  get targetId(): string | null { return this.target; }

  /** Point at a canonical component. Unknown ids leave the hand in `blocked` with the reason, not at a guessed spot. */
  attend(id: string, state: Exclude<HandState, 'hidden'> = 'point', note: string | null = null): Resolution {
    const r = resolveTarget(id, this.registry, this.parts);
    this.target = id; this.note = note;
    this.stateValue = r.status === 'resolved' ? state : 'blocked';
    return r;
  }

  setState(state: HandState, note: string | null = this.note): void { this.stateValue = state; this.note = note; if (state === 'hidden') this.target = null; }

  release(): void { this.stateValue = 'hidden'; this.target = null; this.note = null; }

  view(camera: Camera, viewport: Viewport, safe: SafeInsets, meshes: Object3D[]): HandView {
    const empty: HandView = { state: this.stateValue, targetId: this.target, label: '', stateLabel: HAND_STATE_LABEL[this.stateValue], uncertainty: null, x: null, y: null, radiusPx: 0, offscreen: null, occluded: false, problem: this.note };
    if (this.stateValue === 'hidden' || !this.target) return { ...empty, state: 'hidden', stateLabel: '' };
    const r = resolveTarget(this.target, this.registry, this.parts);
    if (r.status !== 'resolved') return { ...empty, state: 'blocked', stateLabel: HAND_STATE_LABEL.blocked, label: r.status === 'missing' ? r.id : r.component.label, problem: r.message };
    const p = projectToScreen(r.anchorWorld, camera, viewport, safe);
    const occ = p.onScreen ? occlusion(r.anchorWorld, r.component.partIds, camera, meshes) : { status: 'visible' as const, blockerPartId: null };
    const radius = Math.max(14, Math.min(120, screenRadius(r.bounds, camera, viewport) * 0.55));
    const occluded = occ.status === 'occluded';
    return {
      ...empty, label: r.component.label, uncertainty: uncertaintyLabel(r.component),
      x: p.onScreen ? p.x : null, y: p.onScreen ? p.y : null, radiusPx: radius, offscreen: p.edge, occluded,
      problem: !p.onScreen ? (p.behind ? 'Fora de vista (atrás da câmara).' : 'Fora de vista.') : occluded ? `Oculto por ${occ.blockerPartId}.` : this.note,
    };
  }
}
