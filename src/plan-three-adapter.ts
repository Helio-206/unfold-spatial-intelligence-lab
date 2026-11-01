import * as THREE from 'three';
import type { Node, SpatialSceneV1 } from './spatial-scene';

const wallFallbackMaterial = new THREE.MeshStandardMaterial({ color: 0xd2cdc1, roughness: 0.91 });
const doorMaterial = new THREE.MeshStandardMaterial({ color: 0x765237, roughness: 0.64 });
const windowMaterial = new THREE.MeshPhysicalMaterial({ color: 0xa9c3c4, metalness: 0.08, roughness: 0.16, transparent: true, opacity: 0.48, transmission: 0.16, thickness: 0.025 });
const floorMaterial = new THREE.MeshStandardMaterial({ color: 0xb9b09f, roughness: 0.91, side: THREE.DoubleSide });
const genericMaterial = new THREE.MeshStandardMaterial({ color: 0x9d9b92, roughness: 0.78 });

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
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) { child.castShadow = true; child.receiveShadow = true; }
  });
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

function assetSurfaceMaterial(asset: THREE.Object3D | undefined): THREE.Material | undefined {
  let result: THREE.Material | undefined;
  asset?.traverse((object) => {
    if (result || !(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    result = materials.find((material) => material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial);
  });
  return result;
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
  const bevel = openings.length ? 0 : Math.min(0.005, thickness * 0.04, length * 0.0015, height * 0.0015);
  const shape = new THREE.Shape();
  shape.moveTo(-length / 2 + bevel, bevel);
  shape.lineTo(-length / 2 + bevel, height - bevel);
  shape.lineTo(length / 2 - bevel, height - bevel);
  shape.lineTo(length / 2 - bevel, bevel);
  shape.lineTo(-length / 2 + bevel, bevel);
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
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness - 2 * bevel, bevelEnabled: bevel > 0.001, bevelSegments: 1, bevelThickness: bevel, bevelSize: bevel, curveSegments: 1, steps: 1 });
  geometry.translate(0, 0, -thickness / 2 + bevel);
  const material = assetSurfaceMaterial(assets.wall_ext_3000) ?? wallFallbackMaterial;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
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
    geometry = node.component?.kind === 'room'
      ? new THREE.ExtrudeGeometry(shape, { depth: 0.025, bevelEnabled: true, bevelSegments: 1, bevelSize: 0.004, bevelThickness: 0.004, curveSegments: 1, steps: 1 })
      : new THREE.ShapeGeometry(shape);
    geometry.rotateX(Math.PI / 2);
  } else return undefined;
  const material = node.component?.kind === 'door' ? doorMaterial
    : node.component?.kind === 'window' ? windowMaterial
      : node.component?.kind === 'room' ? floorMaterial : genericMaterial;
  const mesh = new THREE.Mesh(geometry, material);
  if (node.component?.kind === 'room') mesh.userData.visualClassification = 'suggested_finish';
  mesh.castShadow = node.component?.kind !== 'room';
  mesh.receiveShadow = true;
  return mesh;
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
