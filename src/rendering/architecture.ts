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

function floorMesh(node: Node, library: MaterialLibrary, profile: QualityProfile): THREE.Mesh | undefined {
  if (node.geometry?.kind !== 'polygon' || node.geometry.verticesM.length < 3) return undefined;
  // (x, -z) shape + rotateX(-90 deg) puts the polygon on (x, z) with the face normal pointing UP.
  const shape = new THREE.Shape();
  const v = node.geometry.verticesM;
  shape.moveTo(v[0]![0], -v[0]![2]);
  for (const p of v.slice(1)) shape.lineTo(p[0], -p[2]);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, library.m.floor);
  mesh.receiveShadow = profile.shadows;
  mesh.userData.derived = 'floor';
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
  if (node.component?.kind === 'room' || node.geometry.kind === 'polygon') return floorMesh(node, library, profile);
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

/** Closes the outer notch where two walls of equal thickness meet at a right angle with matching endpoints. Returns presentation-only blocks. */
export function cornerFillers(group: THREE.Group, scene: SpatialSceneV1, library: MaterialLibrary, profile: QualityProfile, tolerance = 0.02): THREE.Mesh[] {
  const walls = scene.nodes.filter((node) => node.component?.kind === 'wall' && node.geometry?.kind === 'box');
  group.updateMatrixWorld(true);
  type End = { id: string; p: THREE.Vector3; toward: THREE.Vector3; t: number; h: number };
  const ends: End[] = [];
  for (const wall of walls) {
    const object = group.getObjectByName(wall.id);
    if (!object || wall.geometry?.kind !== 'box') continue;
    const [length, height, thickness] = wall.geometry.sizeM;
    const a = new THREE.Vector3(-length / 2, 0, 0).applyMatrix4(object.matrixWorld);
    const b = new THREE.Vector3(length / 2, 0, 0).applyMatrix4(object.matrixWorld);
    ends.push({ id: wall.id, p: a, toward: b.clone().sub(a).setY(0).normalize(), t: thickness, h: height });
    ends.push({ id: wall.id, p: b, toward: a.clone().sub(b).setY(0).normalize(), t: thickness, h: height });
  }
  const out: THREE.Mesh[] = [];
  // a corner is a point where exactly two wall ends meet and no other wall passes through it; at a T-junction the notch is already covered
  const segments = ends.filter((_, k) => k % 2 === 0).map((e, k) => ({ id: e.id, a: e.p, b: ends[k * 2 + 1]!.p, t: e.t }));
  const throughPoint = (point: THREE.Vector3, except: string[]) => segments.some((seg) => {
    if (except.includes(seg.id)) return false;
    const ab = seg.b.clone().sub(seg.a); const u = Math.max(0, Math.min(1, point.clone().sub(seg.a).dot(ab) / ab.lengthSq()));
    return seg.a.clone().addScaledVector(ab, u).distanceTo(point) < seg.t / 2 + tolerance;
  });
  for (let i = 0; i < ends.length; i += 1) for (let j = i + 1; j < ends.length; j += 1) {
    const e1 = ends[i]!, e2 = ends[j]!;
    if (e1.id === e2.id || e1.p.distanceTo(e2.p) > tolerance || Math.abs(e1.t - e2.t) > 1e-3) continue;
    if (ends.filter((e) => e.p.distanceTo(e1.p) <= tolerance).length !== 2 || throughPoint(e1.p, [e1.id, e2.id])) continue;
    if (Math.abs(e1.toward.dot(e2.toward)) > 0.02) continue; // not perpendicular
    const side = e1.t / 2; const height = Math.min(e1.h, e2.h);
    const centre = e1.p.clone().sub(e1.toward.clone().add(e2.toward).multiplyScalar(e1.t / 4));
    const materials = [library.m.wallFace, library.m.wallFace, library.m.wallCap, library.m.wallCap, library.m.wallFace, library.m.wallFace];
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(side, height, side), materials);
    // the box must be axis-aligned with the walls, not with the world
    mesh.rotation.y = Math.atan2(-e1.toward.z, e1.toward.x);
    mesh.position.set(centre.x, height / 2, centre.z);
    mesh.name = `${e1.id}+${e2.id}:corner-filler`;
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

  for (const node of components) {
    const object = objects.get(node.id)!;
    const level = provisionalOf(node);
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
