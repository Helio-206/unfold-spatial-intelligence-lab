// FROZEN COPY of src/plan-three-adapter.ts at origin/main f090210, used only as the "before" in rendering comparisons. Do not edit.
import * as THREE from 'three';
import type { Node, SpatialSceneV1 } from '../../../src/spatial-scene';
import { gsap } from 'gsap';
import { DURATION, EASE } from '../../../src/motion/tokens';
import { prefersReducedMotion } from '../../../src/motion';

const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xc9c5b8, roughness: 0.88 });
const doorMaterial = new THREE.MeshStandardMaterial({ color: 0x765237, roughness: 0.64 });
const windowMaterial = new THREE.MeshStandardMaterial({ color: 0x597f89, metalness: 0.18, roughness: 0.18, transparent: true, opacity: 0.72 });
const genericMaterial = new THREE.MeshStandardMaterial({ color: 0x777d78, roughness: 0.72 });

export const ARCHITECTURAL_MODULE_DIMENSIONS: Record<string, [number, number, number]> = {
  wall_ext_3000: [3, 2.8, 0.2],
  partition_int_3000: [3, 2.7, 0.1],
  door_single_900: [1, 2.2, 0.14],
  window_double_1200: [1.28, 2.12, 0.22],
  connector_corner_90: [0.1, 0.24, 0.16],
  connector_isolated_foot: [0.11, 0.28, 0.11],
  mechanical_frame_1000: [1, 0.6, 0.12],
};
export type ArchitecturalAssets = Partial<Record<keyof typeof ARCHITECTURAL_MODULE_DIMENSIONS, THREE.Object3D>>;

function markSharedAsset(object: THREE.Object3D): THREE.Object3D {
  object.userData.sharedAsset = true;
  return object;
}

function rectangle(x0: number, y0: number, x1: number, y1: number): THREE.Path {
  const path = new THREE.Path();
  path.moveTo(x0, y0);
  path.lineTo(x1, y0);
  path.lineTo(x1, y1);
  path.lineTo(x0, y1);
  path.lineTo(x0, y0);
  return path;
}

function wallMesh(node: Node, openings: Node[], assets: ArchitecturalAssets): THREE.Object3D | undefined {
  if (node.geometry?.kind !== 'box') return undefined;
  const [length, height, thickness] = node.geometry.sizeM;
  if (openings.length === 0 && assets.wall_ext_3000) {
    const wall = markSharedAsset(assets.wall_ext_3000.clone(true));
    const scale = [length / 3, height / 2.8, thickness / 0.2];
    wall.scale.set(scale[0]!, scale[1]!, scale[2]!);
    wall.position.set(-1.5 * scale[0]!, 0, 0);
    return wall;
  }
  const shape = new THREE.Shape();
  shape.moveTo(-length / 2, 0);
  shape.lineTo(-length / 2, height);
  shape.lineTo(length / 2, height);
  shape.lineTo(length / 2, 0);
  shape.lineTo(-length / 2, 0);
  for (const opening of openings) {
    const offset = opening.component?.properties.offset?.value;
    const width = opening.component?.properties.width?.value;
    const openingHeight = opening.component?.properties.height?.value;
    const sill = opening.component?.properties.sill?.value;
    if (![offset, width, openingHeight, sill].every((value) => typeof value === 'number' && Number.isFinite(value))) continue;
    const x0 = -length / 2 + Number(offset);
    const x1 = x0 + Number(width);
    if (x0 < -length / 2 || x1 > length / 2 || Number(sill) < 0 || Number(sill) + Number(openingHeight) > height) continue;
    shape.holes.push(rectangle(x0, Number(sill), x1, Number(sill) + Number(openingHeight)));
  }
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 1, steps: 1 });
  geometry.translate(0, 0, -thickness / 2);
  return new THREE.Mesh(geometry, wallMaterial);
}

function componentMesh(node: Node, assets: ArchitecturalAssets): THREE.Object3D | undefined {
  if (!node.geometry) return undefined;
  if (node.geometry.kind === 'mesh_reference') {
    const template = assets[node.geometry.assetId as keyof ArchitecturalAssets];
    const nominal = ARCHITECTURAL_MODULE_DIMENSIONS[node.geometry.assetId];
    if (!template || !nominal) return undefined;
    const module = markSharedAsset(template.clone(true));
    module.scale.set(node.geometry.boundsM[0] / nominal[0], node.geometry.boundsM[1] / nominal[1], node.geometry.boundsM[2] / nominal[2]);
    return module;
  }
  if (node.component?.kind === 'door' && assets.door_single_900) {
    const [width, height] = node.geometry.kind === 'box' ? node.geometry.sizeM : [0.9, 2.2];
    const door = markSharedAsset(assets.door_single_900.clone(true));
    const sx = width / 0.97;
    const sy = height / 2.2;
    door.scale.set(sx, sy, 1);
    door.position.set(-0.45 * sx, -1.1 * sy, 0);
    return door;
  }
  if (node.component?.kind === 'window' && assets.window_double_1200) {
    const [width, height] = node.geometry.kind === 'box' ? node.geometry.sizeM : [1.2, 1.25];
    const window = markSharedAsset(assets.window_double_1200.clone(true));
    const sx = width / 1.16;
    const sy = height / 1.25;
    window.scale.set(sx, sy, 1);
    window.position.set(-0.6 * sx, -1.455 * sy, 0);
    return window;
  }
  if (node.component?.kind === 'door' || node.component?.kind === 'window') return undefined;
  let geometry: THREE.BufferGeometry;
  if (node.geometry.kind === 'box') geometry = new THREE.BoxGeometry(...node.geometry.sizeM);
  else if (node.geometry.kind === 'segment') geometry = new THREE.CylinderGeometry(node.geometry.radiusM, node.geometry.radiusM, node.geometry.lengthM, 12);
  else if (node.geometry.kind === 'point') geometry = new THREE.SphereGeometry(node.geometry.radiusM, 12, 8);
  else if (node.geometry.kind === 'circle') geometry = new THREE.CylinderGeometry(node.geometry.radiusM, node.geometry.radiusM, node.geometry.thicknessM, 16);
  else if (node.geometry.kind === 'polygon') {
    const shape = new THREE.Shape();
    const vertices = node.geometry.verticesM;
    shape.moveTo(vertices[0]![0], vertices[0]![2]);
    for (const vertex of vertices.slice(1)) shape.lineTo(vertex[0], vertex[2]);
    shape.closePath();
    geometry = new THREE.ShapeGeometry(shape);
    geometry.rotateX(Math.PI / 2);
  } else return undefined;
  const material = node.component?.kind === 'door' ? doorMaterial : node.component?.kind === 'window' ? windowMaterial : genericMaterial;
  return new THREE.Mesh(geometry, material);
}

function applyTransform(object: THREE.Object3D, node: Node): void {
  object.position.fromArray(node.transform.translationM);
  object.quaternion.fromArray(node.transform.rotation);
  object.scale.fromArray(node.transform.scale);
  object.updateMatrix();
}

export function buildThreePlanGroup(scene: SpatialSceneV1, assets: ArchitecturalAssets = {}): THREE.Group {
  const group = new THREE.Group();
  group.name = scene.id;
  const components = scene.nodes.filter((node) => node.nodeType === 'component');
  const objects = new Map<string, THREE.Group>();
  for (const node of scene.nodes) {
    const object = new THREE.Group();
    object.name = node.id;
    object.userData.id = node.id;
    applyTransform(object, node);
    objects.set(node.id, object);
  }
  for (const node of scene.nodes) {
    const object = objects.get(node.id)!;
    (node.parentId ? objects.get(node.parentId) : group)?.add(object);
  }
  for (const node of components) {
    const object = objects.get(node.id)!;
    if (node.component?.kind === 'wall') {
      const attached = components.filter((item) => item.component?.dependsOn.includes(node.id) && (item.component.kind === 'door' || item.component.kind === 'window'));
      const mesh = wallMesh(node, attached, assets);
      if (mesh) object.add(mesh);
      continue;
    }
    const mesh = componentMesh(node, assets);
    if (!mesh) continue;
    mesh.name = `${node.id}:mesh`;
    object.add(mesh);
    if (node.component?.kind === 'door' && assets.door_single_900) object.userData.assetModule = 'door_single_900';
    if (node.component?.kind === 'window' && assets.window_double_1200) object.userData.assetModule = 'window_double_1200';
  }
  return group;
}

/**
 * Visual treatment of a wall-removal preview. Draws only: the scene data, the commands and the engine's
 * verdict are not touched. In `dissolve` mode (the engine accepted the removal and the candidate scene is on
 * screen) the removed wall fades out and leaves a dashed edge behind. In `blocked` mode (the engine refused)
 * the wall stays exactly as it is and only gets a dashed outline.
 */
export type RemovalGhost = {
  group: THREE.Group;
  settle(mode: 'dissolve' | 'blocked', onFrame: () => void): void;
  dispose(): void;
};

export function buildRemovalGhost(scene: SpatialSceneV1, wallId: string, edgeColor: number, assets: ArchitecturalAssets = {}): RemovalGhost | undefined {
  const node = scene.nodes.find((item) => item.id === wallId);
  if (!node || node.component?.kind !== 'wall') return undefined;
  const attached = scene.nodes.filter((item) => item.nodeType === 'component' && item.component?.dependsOn.includes(node.id) && (item.component.kind === 'door' || item.component.kind === 'window'));
  const mesh = wallMesh(node, attached, assets);
  if (!mesh) return undefined;

  const chain: Node[] = [];
  for (let current: Node | undefined = node; current; current = current.parentId ? scene.nodes.find((item) => item.id === current!.parentId) : undefined) chain.unshift(current);
  const group = new THREE.Group();
  group.name = `${wallId}:removal-ghost`;
  let parent: THREE.Object3D = group;
  for (const link of chain) { const holder = new THREE.Group(); applyTransform(holder, link); parent.add(holder); parent = holder; }
  parent.add(mesh);

  const fill = new THREE.MeshStandardMaterial({ color: 0xc9c5b8, roughness: 0.88, transparent: true, opacity: 0.92, depthWrite: false });
  const edge = new THREE.LineDashedMaterial({ color: edgeColor, dashSize: 0.16, gapSize: 0.1, transparent: true, opacity: 0, depthTest: false });
  const ownGeometry: THREE.BufferGeometry[] = [];
  const meshes: THREE.Mesh[] = [];
  mesh.traverse((object) => { if (object instanceof THREE.Mesh) meshes.push(object); });
  for (const item of meshes) {
    item.material = fill;
    item.renderOrder = 2;
    const lines = new THREE.LineSegments(new THREE.EdgesGeometry(item.geometry, 30), edge);
    lines.computeLineDistances();
    lines.renderOrder = 3;
    item.add(lines);
    ownGeometry.push(lines.geometry);
  }

  return {
    group,
    settle(mode, onFrame) {
      const solid = mode === 'blocked' ? 0 : 0.12;
      if (mode === 'blocked') fill.opacity = 0;
      if (prefersReducedMotion()) {
        fill.opacity = solid; edge.opacity = 1; onFrame();
        return;
      }
      const timeline = gsap.timeline({ onUpdate: onFrame });
      if (mode === 'dissolve') timeline.to(fill, { opacity: solid, duration: DURATION.slow, ease: EASE.inOut }, 0);
      timeline.to(edge, { opacity: 1, duration: DURATION.base, ease: EASE.out }, 0);
    },
    dispose() {
      gsap.killTweensOf([fill, edge]);
      fill.dispose(); edge.dispose();
      ownGeometry.forEach((geometry) => geometry.dispose());
      for (const item of meshes) if (!item.parent?.userData.sharedAsset && !item.userData.sharedAsset) item.geometry.dispose();
    },
  };
}
