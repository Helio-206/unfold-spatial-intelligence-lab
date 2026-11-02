import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Assembly, Part, Shape } from '../contracts';
import type { PoseSample } from './pose-source';
import type { StudioMaterials } from './studio-materials';

/**
 * The seam between the cinema and whoever owns the machine's geometry.
 *
 * The detailed excavator belongs to the Visual Foundry (`src/living/visual-foundry/`). The cinema asks a provider for one Object3D per assembly part, in that
 * part's local frame, and positions it from a pose source. A provider returns `parts` keyed by `partId`; the cinema never looks inside them except to
 * enable shadows and reflections on their meshes.
 *
 * `createProxyVisuals` is the stand-in used until the Foundry deliverable is integrated: it draws the assembly's own `shapes` (boxes and cylinders, as
 * given by the contract) with bevels and studio materials, so lighting, reflections and camera work can be built and measured on a real articulated
 * silhouette. It does NOT add detail, it is not the final model, and it is labelled as a proxy everywhere it is shown.
 */
export type MachineVisuals = {
  readonly source: 'proxy' | 'visual-foundry';
  readonly root: THREE.Group;
  readonly parts: ReadonlyMap<string, THREE.Object3D>;
  dispose(): void;
};
export interface MachineVisualProvider { readonly id: string; load(assembly: Assembly): Promise<MachineVisuals> | MachineVisuals }

const q = (v: [number, number, number, number]) => new THREE.Quaternion(v[0], v[1], v[2], v[3]);

function shapeMesh(shape: Shape, part: Part, materials: StudioMaterials): THREE.Mesh {
  let geometry: THREE.BufferGeometry;
  if (shape.kind === 'box') {
    const [hx, hy, hz] = shape.halfExtentsM;
    geometry = new RoundedBoxGeometry(hx * 2, hy * 2, hz * 2, 4, Math.min(0.07, hx * 0.5, hy * 0.5, hz * 0.5));
  } else {
    geometry = new THREE.CylinderGeometry(shape.radiusM, shape.radiusM, shape.halfLengthM * 2, 48, 1, false);
    geometry.rotateZ(Math.PI / 2); // the contract puts a cylinder's axis along the shape's local X
  }
  const mesh = new THREE.Mesh(geometry, materials.forRole(part.role));
  mesh.position.fromArray(shape.pose.translationM); mesh.quaternion.copy(q(shape.pose.rotation));
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.name = `${part.id}:${shape.id}`; mesh.userData = { partId: part.id, shapeId: shape.id, proxy: true };
  return mesh;
}

export const proxyVisualProvider = (materials: StudioMaterials): MachineVisualProvider => ({
  id: 'cinema-proxy',
  load(assembly) {
    const root = new THREE.Group(); root.name = 'machine'; root.userData.proxy = true;
    const parts = new Map<string, THREE.Object3D>();
    for (const part of assembly.parts) {
      const group = new THREE.Group(); group.name = part.id; group.userData = { partId: part.id, role: part.role };
      for (const shape of part.shapes) group.add(shapeMesh(shape, part, materials));
      root.add(group); parts.set(part.id, group);
    }
    return { source: 'proxy' as const, root, parts, dispose() { const seen = new Set<THREE.BufferGeometry>(); root.traverse((o) => { const g = (o as THREE.Mesh).geometry; if (g && !seen.has(g)) { seen.add(g); g.dispose(); } }); root.clear(); parts.clear(); } };
  },
});

/** Writes a pose sample onto the part objects. Parts the sample does not mention keep their previous pose; unknown ids are reported, not invented. */
export function applyPose(visuals: Pick<MachineVisuals, 'parts'>, sample: Pick<PoseSample, 'parts'>): { applied: number; unknown: string[] } {
  let applied = 0; const unknown: string[] = [];
  for (const p of sample.parts) {
    const object = visuals.parts.get(p.partId);
    if (!object) { unknown.push(p.partId); continue; }
    object.position.fromArray(p.translationM); object.quaternion.fromArray(p.rotation); object.updateMatrix(); applied += 1;
  }
  return { applied, unknown };
}

export function machineBounds(visuals: Pick<MachineVisuals, 'root'>): THREE.Box3 { visuals.root.updateWorldMatrix(true, true); return new THREE.Box3().setFromObject(visuals.root); }
