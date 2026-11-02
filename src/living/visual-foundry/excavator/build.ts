/**
 * Assembles the excavator display model: one Group per canonical part (named `part:<id>`, `userData.partId`), plus
 * display-only flexible hoses that cross joints and are re-routed from the current part poses. Poses always come from
 * outside (reference pose, a motion frame); this module never resolves engineering relations.
 */
import { Group, Matrix4, Mesh, Quaternion, Vector3, type BufferGeometry } from 'three';
import type { Assembly } from '../../contracts';
import { latheZ, merge, pipe } from '../geometry';
import type { MaterialLibrary } from '../materials';
import { buildBoom, buildBucket, buildBucketLink, buildCylinder, buildIdlerLink, buildStick } from './arm';
import { canonicalView } from './canonical';
import { buildUndercarriage } from './undercarriage';
import { buildUpperStructure } from './upper';

export type PartPose = { partId: string; translationM: [number, number, number]; rotation: [number, number, number, number] };

type HoseEnd = { partId: string; at: [number, number, number]; dir: [number, number, number] };
type HoseSpec = { id: string; a: HoseEnd; b: HoseEnd; radius: number; slack: number };

export type ExcavatorModel = {
  root: Group;
  parts: Map<string, Group>;
  /** Applies part poses (world frame, SI, unit quaternions). Unknown part ids are reported, never invented. */
  applyPoses(poses: PartPose[]): { applied: string[]; unknown: string[]; missing: string[] };
  dispose(): void;
};

function hoseSpecs(): HoseSpec[] {
  const H: HoseSpec[] = [];
  for (const s of [-1, 1]) {
    // upper-structure supply blocks → boom tube runs (cross the boom foot)
    H.push({ id: `hose.boom_supply.${s}`, a: { partId: 'upper_body', at: [0.5, 0.2, s * 0.2], dir: [0.3, 1, 0] }, b: { partId: 'boom', at: [0.56, 0.38, s * 0.165], dir: [-1, 0.2, 0] }, radius: 0.022, slack: 0.25 });
    H.push({ id: `hose.boom_supply_outer.${s}`, a: { partId: 'upper_body', at: [0.42, 0.2, s * 0.2], dir: [0.2, 1, 0] }, b: { partId: 'boom', at: [0.56, 0.38, s * 0.205], dir: [-1, 0.2, 0] }, radius: 0.022, slack: 0.3 });
    // upper-structure → boom cylinder ports
    H.push({ id: `hose.boom_cyl.${s}`, a: { partId: 'upper_body', at: [0.45, 0.17, s * 0.2], dir: [0.4, 0.4, -s * 0.3] }, b: { partId: 'boom_cyl_barrel', at: [0.34, 0.14, s * 0.02], dir: [0, 1, 0] }, radius: 0.019, slack: 0.18 });
  }
  return H;
}

export function buildExcavator(assembly: Assembly, lib: MaterialLibrary): ExcavatorModel {
  const view = canonicalView(assembly);
  const builders = [
    buildUndercarriage(view), buildUpperStructure(view), buildBoom(view), buildStick(view), buildBucket(view), buildIdlerLink(view), buildBucketLink(view),
    ...(['boom_cylinder', 'stick_cylinder', 'bucket_cylinder'] as const).flatMap((id) => { const c = buildCylinder(view, id); return [c.barrel, c.rod]; }),
  ];
  const root = new Group(); root.name = `assembly:${assembly.id}`; root.userData.assemblyId = assembly.id;
  const parts = new Map<string, Group>();
  for (const b of builders) { const g = b.build(lib); parts.set(b.partId, g); root.add(g); }
  for (const p of assembly.parts) if (!parts.has(p.id)) { const g = new Group(); g.name = `part:${p.id}`; g.userData.partId = p.id; g.userData.noDisplayGeometry = true; parts.set(p.id, g); root.add(g); }

  const hoses = new Group(); hoses.name = 'display-only:hoses'; hoses.userData.displayOnly = true; root.add(hoses);
  const specs = hoseSpecs();
  const hoseMeshes = new Map<string, Mesh>();
  const tmp = new Vector3(), tmpDir = new Vector3();
  const world = (end: HoseEnd) => {
    const g = parts.get(end.partId)!;
    const p = tmp.set(...end.at).applyMatrix4(g.matrixWorld).clone();
    const d = tmpDir.set(...end.dir).normalize().transformDirection(g.matrixWorld).clone();
    return { p, d };
  };
  const routeHoses = () => {
    root.updateMatrixWorld(true);
    const inv = new Matrix4().copy(root.matrixWorld).invert();
    for (const spec of specs) {
      const A = world(spec.a), B = world(spec.b);
      const pts = [A.p, A.p.clone().addScaledVector(A.d, spec.slack), B.p.clone().addScaledVector(B.d, spec.slack), B.p].map((v) => v.applyMatrix4(inv));
      const geometry = merge([pipe(pts, spec.radius, 36, 8), ferrule(pts[0]!, pts[1]!, spec.radius), ferrule(pts[3]!, pts[2]!, spec.radius)]);
      let mesh = hoseMeshes.get(spec.id);
      if (!mesh) { mesh = new Mesh(geometry, lib.get('rubber')); mesh.name = spec.id; mesh.userData.displayOnly = true; mesh.castShadow = true; mesh.receiveShadow = true; hoses.add(mesh); hoseMeshes.set(spec.id, mesh); }
      else { mesh.geometry.dispose(); mesh.geometry = geometry; }
      mesh.geometry.computeBoundingSphere();
    }
  };

  return {
    root, parts,
    applyPoses(poses) {
      const applied: string[] = [], unknown: string[] = [];
      for (const pose of poses) {
        const g = parts.get(pose.partId);
        if (!g) { unknown.push(pose.partId); continue; }
        g.position.set(...pose.translationM);
        g.quaternion.copy(new Quaternion(...pose.rotation).normalize());
        applied.push(pose.partId);
      }
      const missing = [...parts.keys()].filter((id) => !applied.includes(id));
      routeHoses();
      return { applied, unknown, missing };
    },
    dispose() {
      root.traverse((o) => { if ((o as Mesh).isMesh) (o as Mesh).geometry.dispose(); });
      root.removeFromParent();
    },
  };
}

function ferrule(at: Vector3, toward: Vector3, r: number): BufferGeometry {
  const g = latheZ([[0, 0], [r * 1.45, 0], [r * 1.45, 0.05], [r * 1.25, 0.06], [r * 1.25, 0.075], [0, 0.075]], 12);
  const d = toward.clone().sub(at).normalize();
  g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), d));
  g.translate(at.x, at.y, at.z);
  return g;
}
