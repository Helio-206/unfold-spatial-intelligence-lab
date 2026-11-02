import * as THREE from 'three';
import type { ArchitecturalAssets } from '../plan-three-adapter';
import type { Node, SpatialSceneV1 } from '../spatial-scene';
import { getMaterials, type MaterialLibrary } from './materials';
import { profileFor, type QualityProfile, type VisualQuality } from './quality';

/**
 * Architectural geometry from canonical scene nodes. This module only READS the scene: it never writes to it, never moves a
 * node and never changes a size. Anything it adds that the data does not literally contain is tagged in `userData` so it can be
 * told apart from source-derived geometry:
 *
 *   userData.derived = 'wall' | 'floor' | 'opening-frame' | 'opening-glass' | 'opening-leaf'   built from a node's own geometry
 *   userData.presentationOnly = true                                                              added for looks only (corner fillers)
 *   userData.provisional = 'unreviewed' | 'ambiguous'                                             geometry that is not human-confirmed
 */

export type BuildOptions = { quality?: VisualQuality };
export type Provisional = 'confirmed' | 'unreviewed' | 'ambiguous';

/** How much a node's geometry can be trusted, from its own provenance. Rendering reads it; it never changes it. */
export function provisionalOf(node: Node): Provisional {
  const validation = node.geometry?.provenance.validation;
  if (validation === 'verified' || validation === 'corrected') return 'confirmed';
  return validation === 'ambiguous' ? 'ambiguous' : 'unreviewed';
}

const FRAME = 0.05;        // frame member width (m)
const FRAME_PROUD = 0.006; // frames stand 6 mm proud of each wall face: no coplanar faces, so no z-fighting
const GLASS = 0.012;

function rectangle(x0: number, y0: number, x1: number, y1: number): THREE.Path {
  const path = new THREE.Path();
  path.moveTo(x0, y0); path.lineTo(x1, y0); path.lineTo(x1, y1); path.lineTo(x0, y1); path.lineTo(x0, y0);
  return path;
}

type Rect = { x0: number; x1: number; y0: number; y1: number };

/** Openings that really fit inside the wall; the same acceptance rule the original adapter used. */
export function openingRects(wall: Node, openings: Node[]): Rect[] {
  if (wall.geometry?.kind !== 'box') return [];
  const [length, height] = wall.geometry.sizeM;
  const rects: Rect[] = [];
  for (const opening of openings) {
    const offset = opening.component?.properties.offset?.value;
    const width = opening.component?.properties.width?.value;
    const h = opening.component?.properties.height?.value;
    const sill = opening.component?.properties.sill?.value;
    if (![offset, width, h, sill].every((value) => typeof value === 'number' && Number.isFinite(value))) continue;
    const x0 = -length / 2 + Number(offset); const x1 = x0 + Number(width);
    if (x0 < -length / 2 || x1 > length / 2 || Number(sill) < 0 || Number(sill) + Number(h) > height) continue;
    rects.push({ x0, x1, y0: Number(sill), y1: Number(sill) + Number(h) });
  }
  return rects;
}

/**
 * Wall solid: an extrusion of the wall face with real openings cut through the full thickness (so every opening has depth).
 * Material 0 = the two large faces (plaster), material 1 = top, ends and opening reveals (the exposed "cap" material).
 */
export function buildWallGeometry(length: number, height: number, thickness: number, rects: Rect[]): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-length / 2, 0); shape.lineTo(-length / 2, height); shape.lineTo(length / 2, height); shape.lineTo(length / 2, 0); shape.lineTo(-length / 2, 0);
  for (const r of rects) shape.holes.push(rectangle(r.x0, r.y0, r.x1, r.y1));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 1, steps: 1 });
  geometry.translate(0, 0, -thickness / 2);
  return geometry;
}

function box(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number, derived: string, profile: QualityProfile, castShadow = true): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.userData.derived = derived;
  mesh.castShadow = profile.shadows && castShadow; mesh.receiveShadow = profile.shadows;
  return mesh;
}

/** Frames, glass and (for doors) a closed leaf, built from the opening node's own box and the wall thickness. Group origin = opening centre. */
function openingDetail(node: Node, wallThickness: number, library: MaterialLibrary, profile: QualityProfile): THREE.Group | undefined {
  if (node.geometry?.kind !== 'box') return undefined;
  const [width, height] = node.geometry.sizeM;
  const depth = wallThickness + 2 * FRAME_PROUD;
  const group = new THREE.Group();
  group.name = `${node.id}:detail`;
  const m = library.m;
  const jamb = (side: number) => box(FRAME, height, depth, m.metal, side * (width / 2 - FRAME / 2), 0, 0, 'opening-frame', profile);
  group.add(jamb(-1), jamb(1));
  group.add(box(width - 2 * FRAME, FRAME, depth, m.metal, 0, height / 2 - FRAME / 2, 0, 'opening-frame', profile));
  if (node.component?.kind === 'window') {
    group.add(box(width - 2 * FRAME, FRAME, depth, m.metal, 0, -height / 2 + FRAME / 2, 0, 'opening-frame', profile));
    group.add(box(width - 2 * FRAME, height - 2 * FRAME, GLASS, m.glass, 0, 0, 0, 'opening-glass', profile, false));
    // stone sill, 30 mm deeper than the wall on each side
    group.add(box(width + 0.04, 0.04, wallThickness + 0.06, m.concrete, 0, -height / 2 - 0.02 + FRAME, 0, 'opening-frame', profile));
  } else if (node.component?.kind === 'door') {
    group.add(box(width - 2 * FRAME, height - FRAME, 0.04, m.timber, 0, -FRAME / 2, 0, 'opening-leaf', profile));
  }
  return group;
}

export type FloorConflict = { kind: 'duplicate' | 'partial'; ids: string[]; kept?: string; overlap: number };
type FloorEntry = { id: string; world: Array<[number, number]>; y: number; confirmed: boolean };

function inside(point: [number, number], polygon: Array<[number, number]>): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, zi] = polygon[i]!, [xj, zj] = polygon[j]!;
    if ((zi > point[1]) !== (zj > point[1]) && point[0] < ((xj - xi) * (point[1] - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

/** Intersection over union of two floor polygons, estimated on a fixed grid (deterministic). 1 = same surface, 0 = disjoint. */
export function floorOverlap(a: Array<[number, number]>, b: Array<[number, number]>, grid = 96): number {
  const xs = [...a, ...b].map((p) => p[0]), zs = [...a, ...b].map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  let both = 0, either = 0;
  for (let i = 0; i < grid; i += 1) for (let j = 0; j < grid; j += 1) {
    const p: [number, number] = [x0 + ((i + 0.5) / grid) * (x1 - x0), z0 + ((j + 0.5) / grid) * (z1 - z0)];
    const ia = inside(p, a), ib = inside(p, b);
    if (ia && ib) both += 1; if (ia || ib) either += 1;
  }
  return either === 0 ? 0 : both / either;
}

const SAME_SURFACE = 0.985; // a grid estimate; a polygon pair this close is the same surface
const ANY_OVERLAP = 0.02;

/**
 * Decides how overlapping room polygons are DRAWN. It never edits the scene and never decides which room is "right":
 *   - identical surface at the same elevation (a room proposed twice) -> one is drawn (a confirmed one if there is one, otherwise the first by id); the others are
 *     reported as `duplicate` and left out of the drawing only; their nodes stay canonical and selectable from the component list.
 *   - partial overlap at the same elevation -> a real conflict: both are drawn translucent and hatched, in a fixed order, and reported as `partial`.
 *   - different elevations, or no overlap -> nothing to do.
 * Nothing is hidden by a depth offset.
 */
export function planFloors(entries: readonly FloorEntry[]): { suppressed: Map<string, string>; ambiguous: Set<string>; conflicts: FloorConflict[] } {
  const suppressed = new Map<string, string>(), ambiguous = new Set<string>(), conflicts: FloorConflict[] = [];
  const sorted = [...entries].sort((a, b) => a.id.localeCompare(b.id));
  const pairs: Array<{ a: FloorEntry; b: FloorEntry; overlap: number }> = [];
  for (let i = 0; i < sorted.length; i += 1) for (let j = i + 1; j < sorted.length; j += 1) {
    const a = sorted[i]!, b = sorted[j]!;
    if (Math.abs(a.y - b.y) > 1e-3) continue;
    const overlap = floorOverlap(a.world, b.world);
    if (overlap > ANY_OVERLAP) pairs.push({ a, b, overlap });
  }
  // duplicates form groups (an identical surface proposed two or more times)
  const parent = new Map<string, string>(); const find = (id: string): string => { let r = id; while (parent.get(r) && parent.get(r) !== r) r = parent.get(r)!; return r; };
  for (const e of sorted) parent.set(e.id, e.id);
  for (const p of pairs) if (p.overlap >= SAME_SURFACE) parent.set(find(p.b.id), find(p.a.id));
  const groups = new Map<string, FloorEntry[]>();
  for (const e of sorted) { const r = find(e.id); groups.set(r, [...(groups.get(r) ?? []), e]); }
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const kept = members.find((m) => m.confirmed) ?? members[0]!;
    for (const m of members) if (m !== kept) suppressed.set(m.id, kept.id);
    conflicts.push({ kind: 'duplicate', ids: members.map((m) => m.id), kept: kept.id, overlap: 1 });
  }
  for (const p of pairs) {
    if (p.overlap >= SAME_SURFACE || find(p.a.id) === find(p.b.id)) continue;
    const ra = find(p.a.id), rb = find(p.b.id);
    ambiguous.add(groups.get(ra)!.find((m) => !suppressed.has(m.id))!.id); ambiguous.add(groups.get(rb)!.find((m) => !suppressed.has(m.id))!.id);
    conflicts.push({ kind: 'partial', ids: [p.a.id, p.b.id], overlap: +p.overlap.toFixed(3) });
  }
  return { suppressed, ambiguous, conflicts };
}

function floorMesh(node: Node, library: MaterialLibrary, profile: QualityProfile, conflict: 'none' | 'partial', order: number): THREE.Mesh | undefined {
  if (node.geometry?.kind !== 'polygon' || node.geometry.verticesM.length < 3) return undefined;
  // (x, -z) shape + rotateX(-90 deg) puts the polygon on (x, z) with the face normal pointing UP.
  const shape = new THREE.Shape();
  const v = node.geometry.verticesM;
  shape.moveTo(v[0]![0], -v[0]![2]);
  for (const p of v.slice(1)) shape.lineTo(p[0], -p[2]);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, conflict === 'partial' ? library.m.floorAmbiguous : library.m.floor);
  mesh.receiveShadow = profile.shadows && conflict === 'none';
  mesh.userData.derived = 'floor';
  if (conflict === 'partial') { mesh.userData.conflict = 'partial'; mesh.renderOrder = 1 + order; }
  return mesh;
}

function applyTransform(object: THREE.Object3D, node: Node): void {
  object.position.fromArray(node.transform.translationM);
  object.quaternion.fromArray(node.transform.rotation);
  object.scale.fromArray(node.transform.scale);
  object.updateMatrix();
}

function markShared(object: THREE.Object3D): THREE.Object3D { object.userData.sharedAsset = true; return object; }

/** Modules from the Blender library: keep their geometry and placement, share the application's materials. */
function remap(module: THREE.Object3D, library: MaterialLibrary, profile: QualityProfile): void {
  module.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const material = Array.isArray(child.material) ? child.material[0] : child.material;
    const mapped = material && library.byGltfName[material.name];
    if (mapped) child.material = mapped;
    child.castShadow = profile.shadows && child.material !== library.m.glass; child.receiveShadow = profile.shadows;
  });
}

function outline(geometry: THREE.BufferGeometry, library: MaterialLibrary, level: Provisional): THREE.LineSegments {
  const lines = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 25), library.provisionalLine);
  lines.computeLineDistances();
  lines.userData.provisional = level;
  lines.raycast = () => undefined; // an outline is never a pick target
  return lines;
}

function componentMesh(node: Node, assets: ArchitecturalAssets, library: MaterialLibrary, profile: QualityProfile, wallThickness: number | undefined): THREE.Object3D | undefined {
  if (!node.geometry) return undefined;
  if (node.geometry.kind === 'mesh_reference') {
    const template = assets[node.geometry.assetId as keyof ArchitecturalAssets];
    const nominal = ASSET_NOMINAL[node.geometry.assetId];
    if (!template || !nominal) return undefined;
    const module = markShared(template.clone(true));
    module.scale.set(node.geometry.boundsM[0] / nominal[0], node.geometry.boundsM[1] / nominal[1], node.geometry.boundsM[2] / nominal[2]);
    remap(module, library, profile);
    return module;
  }
  if (node.component?.kind === 'door' && assets.door_single_900) {
    const [width, height] = node.geometry.kind === 'box' ? node.geometry.sizeM : [0.9, 2.2];
    const door = markShared(assets.door_single_900.clone(true));
    const sx = width / 0.97; const sy = height / 2.2;
    door.scale.set(sx, sy, 1); door.position.set(-0.45 * sx, -1.1 * sy, 0);
    remap(door, library, profile);
    return door;
  }
  if (node.component?.kind === 'window' && assets.window_double_1200) {
    const [width, height] = node.geometry.kind === 'box' ? node.geometry.sizeM : [1.2, 1.25];
    const window = markShared(assets.window_double_1200.clone(true));
    const sx = width / 1.16; const sy = height / 1.25;
    window.scale.set(sx, sy, 1); window.position.set(-0.6 * sx, -1.455 * sy, 0);
    remap(window, library, profile);
    return window;
  }
  if (node.component?.kind === 'door' || node.component?.kind === 'window') return profile.openingDetail && wallThickness !== undefined ? openingDetail(node, wallThickness, library, profile) : undefined;
  if (node.geometry.kind === 'polygon') return undefined; // floors are planned and built in buildArchitecturalGroup
  let geometry: THREE.BufferGeometry;
  if (node.geometry.kind === 'box') geometry = new THREE.BoxGeometry(...node.geometry.sizeM);
  else if (node.geometry.kind === 'segment') geometry = new THREE.CylinderGeometry(node.geometry.radiusM, node.geometry.radiusM, node.geometry.lengthM, 12);
  else if (node.geometry.kind === 'point') geometry = new THREE.SphereGeometry(node.geometry.radiusM, 12, 8);
  else if (node.geometry.kind === 'circle') geometry = new THREE.CylinderGeometry(node.geometry.radiusM, node.geometry.radiusM, node.geometry.thicknessM, 16);
  else return undefined;
  const mesh = new THREE.Mesh(geometry, library.m.neutral);
  mesh.castShadow = profile.shadows; mesh.receiveShadow = profile.shadows;
  return mesh;
}

// nominal sizes of the Blender modules (kept identical to plan-three-adapter's table)
const ASSET_NOMINAL: Record<string, [number, number, number]> = {
  wall_ext_3000: [3, 2.8, 0.2], partition_int_3000: [3, 2.7, 0.1], door_single_900: [1, 2.2, 0.14], window_double_1200: [1.28, 2.12, 0.22],
  connector_corner_90: [0.1, 0.24, 0.16], connector_isolated_foot: [0.11, 0.28, 0.11], mechanical_frame_1000: [1, 0.6, 0.12],
};

type WorldWall = { id: string; origin: THREE.Vector3; x: THREE.Vector3; length: number; height: number; thickness: number; baseY: number };

/**
 * A wall's pose in world space, or undefined when it cannot be read safely. Safe means: the wall stands upright (its local Y is world up), its
 * length axis is horizontal, and the transform chain has no shear (axes stay perpendicular). Rotations about the vertical, translations at any
 * height and uniform or per-axis scales are all fine; anything else is left without a filler rather than guessed at.
 */
export function worldWall(object: THREE.Object3D, size: [number, number, number], id: string): WorldWall | undefined {
  const m = object.matrixWorld;
  const ax = new THREE.Vector3().setFromMatrixColumn(m, 0), ay = new THREE.Vector3().setFromMatrixColumn(m, 1), az = new THREE.Vector3().setFromMatrixColumn(m, 2);
  const sx = ax.length(), sy = ay.length(), sz = az.length();
  if (sx < 1e-9 || sy < 1e-9 || sz < 1e-9) return undefined;
  ax.divideScalar(sx); ay.divideScalar(sy); az.divideScalar(sz);
  const upright = ay.y > 1 - 1e-6 && Math.abs(ax.y) < 1e-6 && Math.abs(az.y) < 1e-6;
  const orthogonal = Math.abs(ax.dot(az)) < 1e-6 && Math.abs(ax.dot(ay)) < 1e-6;
  if (!upright || !orthogonal || m.determinant() <= 0) return undefined;
  return { id, origin: new THREE.Vector3().setFromMatrixPosition(m), x: ax, length: size[0] * sx, height: size[1] * sy, thickness: size[2] * sz, baseY: m.elements[13]! };
}

/**
 * Closes the outer notch where two walls of equal world thickness meet at a right angle with matching endpoints. Everything is computed in world
 * space (so elevated walls, translated and rotated parents and scaled nodes land where the walls are) and then expressed in the group's own frame.
 * Returns presentation-only blocks, tagged and not pickable. Cases that cannot be placed safely produce nothing.
 */
export function cornerFillers(group: THREE.Group, scene: SpatialSceneV1, library: MaterialLibrary, profile: QualityProfile, tolerance = 0.02): THREE.Mesh[] {
  group.updateMatrixWorld(true);
  const walls: WorldWall[] = [];
  for (const node of scene.nodes) {
    if (node.component?.kind !== 'wall' || node.geometry?.kind !== 'box') continue;
    const object = group.getObjectByName(node.id);
    const wall = object && worldWall(object, node.geometry.sizeM, node.id);
    if (wall) walls.push(wall);
  }
  type End = { wall: WorldWall; p: THREE.Vector3; toward: THREE.Vector3 };
  const ends: End[] = [];
  for (const wall of walls) {
    const half = wall.x.clone().multiplyScalar(wall.length / 2);
    const a = wall.origin.clone().sub(half), b = wall.origin.clone().add(half);
    ends.push({ wall, p: a, toward: wall.x.clone() }, { wall, p: b, toward: wall.x.clone().negate() });
  }
  const sameLevel = (p: THREE.Vector3, q: THREE.Vector3, tol: number) => Math.hypot(p.x - q.x, p.z - q.z) <= tol && Math.abs(p.y - q.y) < 1e-3;
  // a corner is a point where exactly two wall ends meet and no other wall (at the same level) passes through it: at a T-junction the notch is already covered
  const throughPoint = (point: THREE.Vector3, except: string[]) => walls.some((wall) => {
    if (except.includes(wall.id) || Math.abs(wall.baseY - point.y) > 1e-3) return false;
    const a = wall.origin.clone().sub(wall.x.clone().multiplyScalar(wall.length / 2)), ab = wall.x.clone().multiplyScalar(wall.length);
    const u = Math.max(0, Math.min(1, new THREE.Vector3(point.x - a.x, 0, point.z - a.z).dot(ab) / ab.lengthSq()));
    return Math.hypot(a.x + ab.x * u - point.x, a.z + ab.z * u - point.z) < wall.thickness / 2 + tolerance;
  });
  const toGroup = group.matrixWorld.clone().invert();
  const out: THREE.Mesh[] = [];
  for (let i = 0; i < ends.length; i += 1) for (let j = i + 1; j < ends.length; j += 1) {
    const e1 = ends[i]!, e2 = ends[j]!;
    if (e1.wall.id === e2.wall.id) continue;
    const pa = new THREE.Vector3(e1.p.x, e1.wall.baseY, e1.p.z), pb = new THREE.Vector3(e2.p.x, e2.wall.baseY, e2.p.z);
    if (!sameLevel(pa, pb, tolerance) || Math.abs(e1.wall.thickness - e2.wall.thickness) > 1e-3) continue;
    if (Math.abs(e1.toward.dot(e2.toward)) > 0.02) continue; // not perpendicular
    if (ends.filter((e) => sameLevel(new THREE.Vector3(e.p.x, e.wall.baseY, e.p.z), pa, tolerance)).length !== 2 || throughPoint(pa, [e1.wall.id, e2.wall.id])) continue;
    const side = e1.wall.thickness / 2; const height = Math.min(e1.wall.height, e2.wall.height);
    const centre = new THREE.Vector3(pa.x, pa.y + height / 2, pa.z).sub(e1.toward.clone().add(e2.toward).multiplyScalar(e1.wall.thickness / 4).setY(0));
    // world pose: yaw from the first wall's direction, then into the group's frame
    const yaw = Math.atan2(-e1.toward.z, e1.toward.x);
    const world = new THREE.Matrix4().compose(centre, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
    const local = toGroup.clone().multiply(world);
    const materials = [library.m.wallFace, library.m.wallFace, library.m.wallCap, library.m.wallCap, library.m.wallFace, library.m.wallFace];
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(side, height, side), materials);
    local.decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.name = `${e1.wall.id}+${e2.wall.id}:corner-filler`;
    mesh.userData.presentationOnly = true; mesh.userData.derived = 'corner-filler';
    mesh.castShadow = profile.shadows; mesh.receiveShadow = profile.shadows;
    mesh.raycast = () => undefined;
    out.push(mesh);
  }
  return out;
}

/** The whole architectural group. Same node/parent structure, names and `userData.id` conventions as the original adapter. */
export function buildArchitecturalGroup(scene: SpatialSceneV1, assets: ArchitecturalAssets = {}, options: BuildOptions = {}): THREE.Group {
  const quality = options.quality ?? 'technical';
  const profile = profileFor(quality);
  const library = getMaterials(quality);
  const group = new THREE.Group();
  group.name = scene.id;
  group.userData.visualQuality = quality;
  const components = scene.nodes.filter((node) => node.nodeType === 'component');
  const objects = new Map<string, THREE.Group>();
  for (const node of scene.nodes) {
    const object = new THREE.Group();
    object.name = node.id; object.userData.id = node.id;
    applyTransform(object, node);
    objects.set(node.id, object);
  }
  for (const node of scene.nodes) (node.parentId ? objects.get(node.parentId) : group)?.add(objects.get(node.id)!);

  // floors: decide, from the world-space polygons, which are the same surface and which genuinely conflict
  group.updateMatrixWorld(true);
  const floorNodes = components.filter((node) => node.geometry?.kind === 'polygon' && node.geometry.verticesM.length >= 3);
  const floorPlan = planFloors(floorNodes.map((node) => {
    const matrix = objects.get(node.id)!.matrixWorld; const vertices = node.geometry!.kind === 'polygon' ? node.geometry!.verticesM : [];
    const world = vertices.map((vtx) => new THREE.Vector3(...vtx).applyMatrix4(matrix));
    return { id: node.id, world: world.map((p) => [p.x, p.z] as [number, number]), y: world.reduce((sum, p) => sum + p.y, 0) / Math.max(1, world.length), confirmed: provisionalOf(node) === 'confirmed' };
  }));
  group.userData.floorConflicts = floorPlan.conflicts;
  let floorOrder = 0;
  for (const node of components) {
    const object = objects.get(node.id)!;
    const level = provisionalOf(node);
    if (floorNodes.includes(node)) {
      const keptBy = floorPlan.suppressed.get(node.id);
      if (keptBy) { object.userData.renderSuppressed = `duplicate-of:${keptBy}`; continue; }
      const floor = floorMesh(node, library, profile, floorPlan.ambiguous.has(node.id) ? 'partial' : 'none', floorOrder++);
      if (floor) { floor.name = `${node.id}:mesh`; if (level !== 'confirmed') floor.userData.provisional = level; object.add(floor); }
      continue;
    }
    if (node.component?.kind === 'wall' && node.geometry?.kind === 'box') {
      const attached = components.filter((item) => item.component?.dependsOn.includes(node.id) && (item.component.kind === 'door' || item.component.kind === 'window'));
      const [length, height, thickness] = node.geometry.sizeM;
      const geometry = buildWallGeometry(length, height, thickness, openingRects(node, attached));
      const face = level === 'ambiguous' ? library.m.wallFaceAmbiguous : library.m.wallFace;
      const cap = level === 'ambiguous' ? library.m.wallCapAmbiguous : library.m.wallCap;
      const mesh = new THREE.Mesh(geometry, [face, cap]);
      mesh.userData.derived = 'wall'; mesh.castShadow = profile.shadows; mesh.receiveShadow = profile.shadows;
      object.add(mesh);
      if (level !== 'confirmed') { mesh.userData.provisional = level; if (profile.provisionalOutline) object.add(outline(geometry, library, level)); }
      continue;
    }
    const wallId = node.component?.dependsOn.find((id) => scene.nodes.find((item) => item.id === id)?.component?.kind === 'wall');
    const wall = wallId ? scene.nodes.find((item) => item.id === wallId) : undefined;
    const thickness = wall?.geometry?.kind === 'box' ? wall.geometry.sizeM[2] : undefined;
    const mesh = componentMesh(node, assets, library, profile, thickness);
    if (!mesh) continue;
    mesh.name = `${node.id}:mesh`;
    if (mesh instanceof THREE.Mesh && level !== 'confirmed') mesh.userData.provisional = level;
    object.add(mesh);
    if (node.component?.kind === 'door' && assets.door_single_900) object.userData.assetModule = 'door_single_900';
    if (node.component?.kind === 'window' && assets.window_double_1200) object.userData.assetModule = 'window_double_1200';
  }
  if (profile.cornerFillers) for (const filler of cornerFillers(group, scene, library, profile)) group.add(filler);
  return group;
}
