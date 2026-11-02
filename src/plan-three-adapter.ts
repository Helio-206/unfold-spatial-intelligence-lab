import * as THREE from 'three';
import type { Node, SpatialSceneV1 } from './spatial-scene';
import { getMaterials } from './rendering/materials';
import { disposeOwnedGeometries } from './rendering/lifecycle';
import type { VisualQuality } from './rendering/quality';
import { buildArchitecturalGroup, buildWallGeometry, openingRects, type BuildOptions } from './rendering/architecture';
import { gsap } from 'gsap';
import { DURATION, EASE } from './motion/tokens';
import { prefersReducedMotion } from './motion';

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

/** The same wall solid the architectural group draws (same extrusion, same openings), so a removal preview never differs from the wall it previews. */
function wallMesh(node: Node, openings: Node[]): THREE.Mesh | undefined {
  if (node.geometry?.kind !== 'box') return undefined;
  const [length, height, thickness] = node.geometry.sizeM;
  return new THREE.Mesh(buildWallGeometry(length, height, thickness, openingRects(node, openings)));
}

function applyTransform(object: THREE.Object3D, node: Node): void {
  object.position.fromArray(node.transform.translationM);
  object.quaternion.fromArray(node.transform.rotation);
  object.scale.fromArray(node.transform.scale);
  object.updateMatrix();
}

/**
 * The architectural group for a scene. Geometry, materials and detail live in `src/rendering/`; this function keeps the
 * adapter's public signature. `options.quality` selects the profile ('technical' by default, 'presentation' for PBR detail);
 * both draw exactly the same scene data.
 */
export function buildThreePlanGroup(scene: SpatialSceneV1, assets: ArchitecturalAssets = {}, options: BuildOptions = {}): THREE.Group {
  return buildArchitecturalGroup(scene, assets, options);
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

export function buildRemovalGhost(scene: SpatialSceneV1, wallId: string, edgeColor: number, _assets: ArchitecturalAssets = {}, quality: VisualQuality = 'technical'): RemovalGhost | undefined {
  const node = scene.nodes.find((item) => item.id === wallId);
  if (!node || node.component?.kind !== 'wall') return undefined;
  const attached = scene.nodes.filter((item) => item.nodeType === 'component' && item.component?.dependsOn.includes(node.id) && (item.component.kind === 'door' || item.component.kind === 'window'));
  const mesh = wallMesh(node, attached);
  if (!mesh) return undefined;

  const chain: Node[] = [];
  for (let current: Node | undefined = node; current; current = current.parentId ? scene.nodes.find((item) => item.id === current!.parentId) : undefined) chain.unshift(current);
  const group = new THREE.Group();
  group.name = `${wallId}:removal-ghost`;
  let parent: THREE.Object3D = group;
  for (const link of chain) { const holder = new THREE.Group(); applyTransform(holder, link); parent.add(holder); parent = holder; }
  parent.add(mesh);

  const wall = getMaterials(quality).m.wallFace; // the ghost wears the same plaster as the wall it previews
  const fill = new THREE.MeshStandardMaterial({ color: wall.color.clone(), roughness: wall.roughness, transparent: true, opacity: 0.92, depthWrite: false });
  const edge = new THREE.LineDashedMaterial({ color: edgeColor, dashSize: 0.16, gapSize: 0.1, transparent: true, opacity: 0, depthTest: false });
  const meshes: THREE.Mesh[] = [];
  mesh.traverse((object) => { if (object instanceof THREE.Mesh) meshes.push(object); });
  for (const item of meshes) {
    item.material = fill;
    item.renderOrder = 2;
    const lines = new THREE.LineSegments(new THREE.EdgesGeometry(item.geometry, 30), edge);
    lines.computeLineDistances();
    lines.renderOrder = 3;
    item.add(lines);
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
      disposeOwnedGeometries(group); // the wall solid and its edge lines, once
    },
  };
}
