import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { fixtureTwoRooms } from '../src/rendering/fixtures';
import { buildThreePlanGroup } from '../src/plan-three-adapter';
import { floorOverlap, planFloors } from '../src/rendering/architecture';
import type { Node, SpatialSceneV1 } from '../src/spatial-scene';

/** Two walls (built from a real wall node) forming a corner at P: A runs +x from P, B runs along directionB from P. */
function corner(opts: { thickness?: number; thicknessB?: number; angleDeg?: number; gap?: number; baseY?: number; heightB?: number } = {}): { scene: SpatialSceneV1; centre: THREE.Vector3 } {
  const template = fixtureTwoRooms().nodes.find((n) => n.component?.kind === 'wall')!;
  const wall = (id: string, from: THREE.Vector3, dir: THREE.Vector3, length: number, thickness: number, height: number): Node => {
    const n = structuredClone(template); n.id = id; n.label = id; n.parentId = null;
    if (n.geometry?.kind !== 'box') throw new Error('x'); n.geometry.sizeM = [length, height, thickness]; n.component!.dependsOn = [];
    const middle = from.clone().addScaledVector(dir, length / 2); const theta = Math.atan2(-dir.z, dir.x);
    n.transform.translationM = [middle.x, middle.y, middle.z]; n.transform.rotation = [0, Math.sin(theta / 2), 0, Math.cos(theta / 2)]; n.transform.scale = [1, 1, 1];
    return n;
  };
  const t = opts.thickness ?? 0.2; const y = opts.baseY ?? 0; const a = (opts.angleDeg ?? 90) * Math.PI / 180;
  const P = new THREE.Vector3(0, y, 0);
  const dA = new THREE.Vector3(1, 0, 0); const dB = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)); // 90 deg: (0,0,-1)
  const A = wall('wall-a', P, dA, 3, t, 2.7);
  const B = wall('wall-b', P.clone().add(new THREE.Vector3(opts.gap ?? 0, 0, 0)), dB, 3, opts.thicknessB ?? t, opts.heightB ?? 2.7);
  const scene = structuredClone(fixtureTwoRooms()); scene.nodes = [A, B];
  return { scene, centre: P.clone().sub(dA.clone().add(dB).multiplyScalar(t / 4)).setY(y + 1.35) };
}
const fillers = (g: THREE.Object3D) => { const out: THREE.Mesh[] = []; g.traverse((o) => { if (o.userData.presentationOnly) out.push(o as THREE.Mesh); }); return out; };
const worldCentre = (m: THREE.Object3D) => new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3());

describe('corner fillers are placed in world space', () => {
  it('ground-level corner: at the missing quadrant, half a thickness square, wall height', () => {
    const { scene, centre } = corner(); const group = buildThreePlanGroup(scene, {}, { quality: 'presentation' }); group.updateMatrixWorld(true);
    const [filler] = fillers(group); expect(fillers(group)).toHaveLength(1);
    expect(worldCentre(filler!).distanceTo(centre)).toBeLessThan(1e-6);
    const size = new THREE.Box3().setFromObject(filler!).getSize(new THREE.Vector3()); expect(size.toArray().map((v) => +v.toFixed(5))).toEqual([0.1, 2.7, 0.1]);
  });

  it('elevated walls: the filler sits on the walls, not on the ground', () => {
    const { scene, centre } = corner({ baseY: 1.5 }); const group = buildThreePlanGroup(scene, {}, { quality: 'presentation' }); group.updateMatrixWorld(true);
    const [filler] = fillers(group); expect(filler).toBeDefined();
    expect(worldCentre(filler!).distanceTo(centre)).toBeLessThan(1e-6);
    expect(new THREE.Box3().setFromObject(filler!).min.y).toBeCloseTo(1.5, 6);
  });

  it('translated and rotated parent groups: the filler follows the walls', () => {
    const { scene, centre } = corner(); const rig = structuredClone(scene.nodes[0]!); rig.id = 'rig'; rig.nodeType = 'group'; rig.geometry = null; rig.component = undefined as never;
    rig.transform.translationM = [5, 0.5, -3]; const yaw = 0.6; rig.transform.rotation = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)]; rig.transform.scale = [1, 1, 1];
    for (const n of scene.nodes) n.parentId = 'rig'; scene.nodes.unshift(rig);
    const group = buildThreePlanGroup(scene, {}, { quality: 'presentation' }); group.updateMatrixWorld(true);
    const [filler] = fillers(group); expect(filler).toBeDefined();
    const expected = centre.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(new THREE.Vector3(5, 0.5, -3));
    expect(worldCentre(filler!).distanceTo(expected)).toBeLessThan(1e-6);
    // and it is aligned with the walls: its local x axis points along a wall in world space
    const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(filler!.getWorldQuaternion(new THREE.Quaternion()));
    expect(Math.abs(axis.y)).toBeLessThan(1e-9); expect(Math.min(Math.abs(axis.dot(new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw))), 1)).toBeGreaterThan(0.9999);
  });

  it('a rotated root group is handled too (the filler is expressed in the group frame)', () => {
    const { scene, centre } = corner(); const group = buildThreePlanGroup(scene, {}, { quality: 'presentation' });
    const holder = new THREE.Group(); holder.position.set(2, 1, 4); holder.rotation.y = 1.1; holder.add(group); holder.updateMatrixWorld(true);
    // build again with the holder in place so cornerFillers sees real world matrices
    const f = fillers(group); expect(f).toHaveLength(1);
    expect(worldCentre(f[0]!).distanceTo(centre.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), 1.1).add(new THREE.Vector3(2, 1, 4)))).toBeLessThan(1e-3);
  });

  it('different thicknesses: scaled equally -> filler of the matching size; unequal -> none', () => {
    const wide = corner({ thickness: 0.3 }); const group = buildThreePlanGroup(wide.scene, {}, { quality: 'presentation' });
    expect(new THREE.Box3().setFromObject(fillers(group)[0]!).getSize(new THREE.Vector3()).x).toBeCloseTo(0.15, 6);
    expect(fillers(buildThreePlanGroup(corner({ thickness: 0.3, thicknessB: 0.2 }).scene, {}, { quality: 'presentation' }))).toHaveLength(0);
  });

  it('T-junctions and non-perpendicular walls get no filler', () => {
    expect(fillers(buildThreePlanGroup(fixtureTwoRooms(), {}, { quality: 'presentation' }))).toHaveLength(4); // 4 outer corners, 2 T-junctions untouched
    expect(fillers(buildThreePlanGroup(corner({ angleDeg: 60 }).scene, {}, { quality: 'presentation' }))).toHaveLength(0);
  });

  it('ends outside the tolerance get no filler; inside they do', () => {
    expect(fillers(buildThreePlanGroup(corner({ gap: 0.05 }).scene, {}, { quality: 'presentation' }))).toHaveLength(0);
    expect(fillers(buildThreePlanGroup(corner({ gap: 0.01 }).scene, {}, { quality: 'presentation' }))).toHaveLength(1);
  });

  it('walls of different heights: the filler is as tall as the lower one', () => {
    const [filler] = fillers(buildThreePlanGroup(corner({ heightB: 2.0 }).scene, {}, { quality: 'presentation' }));
    expect(new THREE.Box3().setFromObject(filler!).getSize(new THREE.Vector3()).y).toBeCloseTo(2.0, 6);
  });

  it('tilted or sheared transforms cannot be placed safely, so nothing is placed', () => {
    const tilted = corner(); tilted.scene.nodes[0]!.transform.rotation = [Math.sin(0.2), 0, 0, Math.cos(0.2)];
    expect(fillers(buildThreePlanGroup(tilted.scene, {}, { quality: 'presentation' }))).toHaveLength(0);
    const rig = structuredClone(tilted.scene.nodes[1]!); rig.id = 'rig'; rig.nodeType = 'group'; rig.geometry = null; rig.component = undefined as never; rig.transform.rotation = [Math.sin(0.3), 0, 0, Math.cos(0.3)];
    const c = corner(); for (const n of c.scene.nodes) n.parentId = 'rig'; c.scene.nodes.unshift(rig);
    expect(fillers(buildThreePlanGroup(c.scene, {}, { quality: 'presentation' }))).toHaveLength(0);
  });

  it('fillers are tagged, unpickable and leave the scene untouched; technical has none', () => {
    const { scene } = corner(); const before = JSON.stringify(scene);
    const group = buildThreePlanGroup(scene, {}, { quality: 'presentation' });
    for (const f of fillers(group)) { expect(f.userData.derived).toBe('corner-filler'); expect(new THREE.Raycaster(new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, -1, 0)).intersectObject(f)).toEqual([]); }
    expect(JSON.stringify(scene)).toBe(before);
    expect(fillers(buildThreePlanGroup(scene, {}, { quality: 'technical' }))).toHaveLength(0);
  });
});

const sq = (x0: number, z0: number, x1: number, z1: number): Array<[number, number]> => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

describe('duplicate and conflicting floors', () => {
  it('overlap estimate: identical, partial and disjoint', () => {
    expect(floorOverlap(sq(0, 0, 4, 3), sq(0, 0, 4, 3))).toBeCloseTo(1, 3);
    expect(floorOverlap(sq(0, 0, 4, 3), sq(2, 0, 6, 3))).toBeCloseTo(1 / 3, 1);
    expect(floorOverlap(sq(0, 0, 4, 3), sq(5, 0, 8, 3))).toBe(0);
  });

  it('identical surfaces: one is drawn, the duplicate is reported, and a confirmed one wins', () => {
    const plan = planFloors([{ id: 'room-b', world: sq(0, 0, 4, 3), y: 0, confirmed: true }, { id: 'region-a', world: sq(0, 0, 4, 3), y: 0, confirmed: false }]);
    expect(plan.suppressed.get('region-a')).toBe('room-b'); expect(plan.suppressed.has('room-b')).toBe(false);
    expect(plan.conflicts).toEqual([{ kind: 'duplicate', ids: ['region-a', 'room-b'], kept: 'room-b', overlap: 1 }]);
  });

  it('partial overlap is a real conflict: nothing is suppressed, both are marked ambiguous', () => {
    const plan = planFloors([{ id: 'a', world: sq(0, 0, 4, 3), y: 0, confirmed: true }, { id: 'b', world: sq(2, 0, 6, 3), y: 0, confirmed: true }]);
    expect(plan.suppressed.size).toBe(0); expect([...plan.ambiguous].sort()).toEqual(['a', 'b']); expect(plan.conflicts[0]).toMatchObject({ kind: 'partial', ids: ['a', 'b'] });
  });

  it('separate elevations and disjoint rooms are not conflicts', () => {
    expect(planFloors([{ id: 'a', world: sq(0, 0, 4, 3), y: 0, confirmed: false }, { id: 'b', world: sq(0, 0, 4, 3), y: 3, confirmed: false }]).conflicts).toEqual([]);
    expect(planFloors([{ id: 'a', world: sq(0, 0, 4, 3), y: 0, confirmed: false }, { id: 'b', world: sq(4, 0, 8, 3), y: 0, confirmed: false }]).conflicts).toEqual([]);
  });

  const withRooms = (rooms: Array<{ id: string; x: [number, number]; z: [number, number]; y?: number; validation?: 'verified' | 'unreviewed' }>): SpatialSceneV1 => {
    const scene = structuredClone(fixtureTwoRooms()); const room = scene.nodes.find((n) => n.component?.kind === 'room')!;
    scene.nodes = rooms.map((r) => { const n = structuredClone(room); n.id = r.id; n.label = r.id; n.transform.translationM = [0, 0, 0]; n.transform.rotation = [0, 0, 0, 1]; n.parentId = null;
      n.geometry = { kind: 'polygon', verticesM: [[r.x[0], r.y ?? 0, r.z[0]], [r.x[1], r.y ?? 0, r.z[0]], [r.x[1], r.y ?? 0, r.z[1]], [r.x[0], r.y ?? 0, r.z[1]]], provenance: { ...room.geometry!.provenance, validation: r.validation ?? 'verified' } }; return n; });
    return scene;
  };
  const floorsDrawn = (g: THREE.Object3D) => { const out: THREE.Mesh[] = []; g.traverse((o) => { if (o.userData.derived === 'floor') out.push(o as THREE.Mesh); }); return out; };

  it('in the built group: duplicates are drawn once, the canonical nodes stay, the report is on the group', () => {
    const scene = withRooms([{ id: 'region-1', x: [0, 4], z: [0, 3], validation: 'unreviewed' }, { id: 'room-0-0-4-3', x: [0, 4], z: [0, 3], validation: 'verified' }]); const before = JSON.stringify(scene);
    const group = buildThreePlanGroup(scene, {}, { quality: 'presentation' });
    expect(floorsDrawn(group)).toHaveLength(1);
    expect(group.getObjectByName('region-1')!.userData.renderSuppressed).toBe('duplicate-of:room-0-0-4-3');
    expect(group.userData.floorConflicts).toEqual([{ kind: 'duplicate', ids: ['region-1', 'room-0-0-4-3'], kept: 'room-0-0-4-3', overlap: 1 }]);
    expect(JSON.stringify(scene)).toBe(before); expect(scene.nodes).toHaveLength(2);
  });

  it('in the built group: a partial overlap draws both, translucent and ordered, without a depth offset trick', () => {
    const group = buildThreePlanGroup(withRooms([{ id: 'a', x: [0, 4], z: [0, 3] }, { id: 'b', x: [2, 6], z: [0, 3] }]), {}, { quality: 'technical' });
    const floors = floorsDrawn(group); expect(floors).toHaveLength(2);
    for (const f of floors) { expect(f.userData.conflict).toBe('partial'); const m = f.material as THREE.MeshStandardMaterial; expect(m.transparent).toBe(true); expect(m.depthWrite).toBe(false); expect(m.polygonOffset).toBe(false); }
    expect(floors[0]!.renderOrder).not.toBe(floors[1]!.renderOrder);
  });

  it('in the built group: floors at different elevations are both drawn normally', () => {
    const group = buildThreePlanGroup(withRooms([{ id: 'ground', x: [0, 4], z: [0, 3] }, { id: 'upper', x: [0, 4], z: [0, 3], y: 3 }]), {}, { quality: 'technical' });
    expect(floorsDrawn(group)).toHaveLength(2); expect(group.userData.floorConflicts).toEqual([]);
    expect(floorsDrawn(group).every((f) => f.userData.conflict === undefined)).toBe(true);
  });
});
