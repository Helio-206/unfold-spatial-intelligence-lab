import * as THREE from 'three';
import type { PartRole } from '../contracts';

/**
 * PBR materials for the studio. Painted parts use a clear-coated lacquer (this is where soft-box reflections read as depth), rods are polished chrome,
 * the bucket is brushed steel (anisotropic highlights). The accent is the UNFOLD fold colour from the design tokens (#FF5A1F), the rest is graphite and steel.
 * Everything is created once per runtime and disposed with it; geometries never own materials.
 */
export type StudioMaterials = {
  forRole(role: PartRole): THREE.Material;
  /** all materials, for env intensity changes and disposal */
  all(): THREE.MeshPhysicalMaterial[];
  setEnvIntensity(value: number): void;
  dispose(): void;
};

export function createStudioMaterials(): StudioMaterials {
  const physical = (p: THREE.MeshPhysicalMaterialParameters) => new THREE.MeshPhysicalMaterial(p);
  const paintAccent = physical({ color: '#FF5A1F', metalness: 0.35, roughness: 0.36, clearcoat: 1, clearcoatRoughness: 0.07 });
  const paintGraphite = physical({ color: '#3a4047', metalness: 0.6, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.09 });
  const undercarriage = physical({ color: '#262a30', metalness: 0.5, roughness: 0.5, clearcoat: 0.5, clearcoatRoughness: 0.3 });
  const bucketSteel = physical({ color: '#9aa0a8', metalness: 1, roughness: 0.34, anisotropy: 0.7, anisotropyRotation: Math.PI / 2 });
  const cylinderBarrel = physical({ color: '#2b2f34', metalness: 0.9, roughness: 0.28, clearcoat: 0.4, clearcoatRoughness: 0.2 });
  const chromeRod = physical({ color: '#e4e8ed', metalness: 1, roughness: 0.055, anisotropy: 0.25 });
  const linkSteel = physical({ color: '#b8bec6', metalness: 1, roughness: 0.22, anisotropy: 0.4 });
  const byRole: Record<PartRole, THREE.MeshPhysicalMaterial> = {
    chassis: undercarriage, upper_body: paintGraphite, boom: paintAccent, stick: paintAccent, bucket: bucketSteel,
    cylinder_barrel: cylinderBarrel, cylinder_rod: chromeRod, link: linkSteel, other: paintGraphite,
  };
  const list = [...new Set(Object.values(byRole))];
  return {
    forRole: (role) => byRole[role] ?? paintGraphite,
    all: () => list,
    setEnvIntensity(value) { for (const m of list) m.envMapIntensity = value; },
    dispose() { for (const m of list) m.dispose(); },
  };
}
