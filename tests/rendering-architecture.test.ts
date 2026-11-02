import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FIXTURES, fixtureMultiRoom, fixtureProvisional, fixtureTwoRooms } from '../src/rendering/fixtures';
import { buildThreePlanGroup } from '../src/plan-three-adapter';
import { buildWallGeometry, openingRects, provisionalOf } from '../src/rendering/architecture';
import { disposeMaterials, getMaterials } from '../src/rendering/materials';
import { sceneStats } from '../src/rendering/metrics';
import type { Node, SpatialSceneV1 } from '../src/spatial-scene';

const walls = (scene: SpatialSceneV1) => scene.nodes.filter((n) => n.component?.kind === 'wall');
const MODES = ['technical', 'presentation'] as const;

describe('fixtures', () => {
  it('are deterministic scene-engine output', () => {
    for (const fixture of FIXTURES) expect(JSON.stringify(fixture.build())).toBe(JSON.stringify(fixture.build()));
  });
  it('cover two rooms, several joins with doors and windows, and provisional geometry', () => {
    expect(fixtureTwoRooms().nodes.filter((n) => n.component?.kind === 'room')).toHaveLength(2);
    const multi = fixtureMultiRoom();
    expect(multi.nodes.filter((n) => n.component?.kind === 'room').length).toBeGreaterThanOrEqual(5);
    expect(multi.nodes.filter((n) => n.component?.kind === 'door')).toHaveLength(3);
    expect(multi.nodes.filter((n) => n.component?.kind === 'window')).toHaveLength(4);
    const states = new Set(fixtureProvisional().nodes.map((n) => provisionalOf(n)));
    expect(states).toEqual(new Set(['confirmed', 'unreviewed', 'ambiguous']));
  });
});

describe('rendering never changes the canonical scene', () => {
  for (const fixture of FIXTURES) for (const quality of MODES) {
    it(`${fixture.id} / ${quality}`, () => {
      const scene = fixture.build();
      const before = JSON.stringify(scene);
      const group = buildThreePlanGroup(scene, {}, { quality });
      group.updateMatrixWorld(true);
      expect(JSON.stringify(scene)).toBe(before);
    });
  }
});

describe('geometry is exactly the canonical geometry', () => {
  for (const quality of MODES) it(`wall solids keep position, length, height and thickness (${quality})`, () => {
    const scene = fixtureMultiRoom();
    const group = buildThreePlanGroup(scene, {}, { quality });
    group.updateMatrixWorld(true);
    for (const wall of walls(scene)) {
      if (wall.geometry?.kind !== 'box') throw new Error('wall without box');
      const [length, height, thickness] = wall.geometry.sizeM;
      const object = group.getObjectByName(wall.id)!;
      const mesh = object.children[0] as THREE.Mesh;
      expect(mesh.geometry.type).toBe('ExtrudeGeometry');
      const local = new THREE.Box3().setFromObject(mesh).applyMatrix4(object.matrixWorld.clone().invert());
      const size = local.getSize(new THREE.Vector3());
      expect(size.x).toBeCloseTo(length, 5); expect(size.y).toBeCloseTo(height, 5); expect(size.z).toBeCloseTo(thickness, 5);
      expect(object.position.toArray()).toEqual(wall.transform.translationM);
    }
  });

  it('openings keep their position and size: a ray through the opening passes, one just outside hits the wall', () => {
    const scene = fixtureTwoRooms();
    const group = buildThreePlanGroup(scene, {}, { quality: 'technical' });
    group.updateMatrixWorld(true);
    const attached = (wall: Node) => scene.nodes.filter((n) => n.component?.dependsOn.includes(wall.id) && (n.component.kind === 'door' || n.component.kind === 'window'));
    let checked = 0;
    for (const wall of walls(scene)) {
      const openings = attached(wall);
      if (!openings.length || wall.geometry?.kind !== 'box') continue;
      const mesh = group.getObjectByName(wall.id)!.children[0] as THREE.Mesh;
      const [length] = wall.geometry.sizeM;
      const cast = (x: number, y: number) => new THREE.Raycaster(mesh.localToWorld(new THREE.Vector3(x, y, 1)), mesh.localToWorld(new THREE.Vector3(x, y, 0)).sub(mesh.localToWorld(new THREE.Vector3(x, y, 1))).normalize()).intersectObject(mesh).length;
      for (const r of openingRects(wall, openings)) {
        const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
        expect(cast(cx, cy)).toBe(0);
        expect(cast(r.x0 - 0.02, cy)).toBeGreaterThan(0); expect(cast(r.x1 + 0.02, cy)).toBeGreaterThan(0);
        expect(cast(cx, r.y1 + 0.02)).toBeGreaterThan(0);
        expect(cast(r.x0 + 0.02, cy)).toBe(0); expect(cast(r.x1 - 0.02, cy)).toBe(0);
        checked += 1;
      }
      void length;
    }
    expect(checked).toBe(3);
  });

  it('every opening of the scene yields frame detail sized by its own node, never more openings than the scene has', () => {
    const scene = fixtureMultiRoom();
    const group = buildThreePlanGroup(scene, {}, { quality: 'presentation' });
    group.updateMatrixWorld(true);
    const openings = scene.nodes.filter((n) => n.component?.kind === 'door' || n.component?.kind === 'window');
    for (const node of openings) {
      const detail = group.getObjectByName(node.id)!.getObjectByName(`${node.id}:mesh`)!;
      const host = group.getObjectByName(node.id)!;
      const size = new THREE.Box3().setFromObject(detail).applyMatrix4(host.matrixWorld.clone().invert()).getSize(new THREE.Vector3());
      if (node.geometry?.kind !== 'box') throw new Error('opening without box');
      expect(size.x).toBeCloseTo(node.geometry.sizeM[0] + (node.component?.kind === 'window' ? 0.04 : 0), 2);
      expect(size.y).toBeGreaterThanOrEqual(node.geometry.sizeM[1] - 1e-6);
    }
    let derivedGlass = 0; group.traverse((o) => { if (o.userData.derived === 'opening-glass') derivedGlass += 1; });
    expect(derivedGlass).toBe(scene.nodes.filter((n) => n.component?.kind === 'window').length);
  });

  it('floors face up and cover the canonical polygon', () => {
    const scene = fixtureTwoRooms();
    const group = buildThreePlanGroup(scene, {}, { quality: 'technical' });
    for (const room of scene.nodes.filter((n) => n.component?.kind === 'room')) {
      if (room.geometry?.kind !== 'polygon') throw new Error('room without polygon');
      const mesh = group.getObjectByName(room.id)!.children[0] as THREE.Mesh;
      const normal = mesh.geometry.getAttribute('normal');
      for (let i = 0; i < normal.count; i += 1) expect(normal.getY(i)).toBeGreaterThan(0.99);
      const box = new THREE.Box3().setFromObject(mesh);
      const xs = room.geometry.verticesM.map((v) => v[0]); const zs = room.geometry.verticesM.map((v) => v[2]);
      expect(box.min.x).toBeCloseTo(Math.min(...xs), 5); expect(box.max.x).toBeCloseTo(Math.max(...xs), 5);
      expect(box.min.z).toBeCloseTo(Math.min(...zs), 5); expect(box.max.z).toBeCloseTo(Math.max(...zs), 5);
    }
  });

  it('wall solids have a separate cap material and no coplanar duplicate faces at opening reveals', () => {
    const geometry = buildWallGeometry(4, 2.7, 0.2, [{ x0: -1, x1: 0, y0: 0, y1: 2.1 }]);
    expect(geometry.groups.map((g) => g.materialIndex).sort()).toEqual([0, 1]);
    expect(geometry.getAttribute('normal').count).toBeGreaterThan(24);
  });
});

describe('both profiles draw the same scene', () => {
  it('same node groups, same wall solids, same world bounds for the source geometry', () => {
    const scene = fixtureMultiRoom();
    const technical = buildThreePlanGroup(scene, {}, { quality: 'technical' }); const presentation = buildThreePlanGroup(scene, {}, { quality: 'presentation' });
    technical.updateMatrixWorld(true); presentation.updateMatrixWorld(true);
    for (const node of scene.nodes) {
      const a = technical.getObjectByName(node.id)!, b = presentation.getObjectByName(node.id)!;
      expect(a.matrixWorld.toArray()).toEqual(b.matrixWorld.toArray());
      const bounds = (o: THREE.Object3D) => { const box = new THREE.Box3(); o.traverse((c) => { if (c instanceof THREE.Mesh && c.userData.derived === 'wall' || c.userData.derived === 'floor') box.expandByObject(c); }); return box; };
      const boxA = bounds(a), boxB = bounds(b);
      expect(boxA.isEmpty()).toBe(boxB.isEmpty());
      if (!boxA.isEmpty()) { expect(boxA.min.toArray()).toEqual(boxB.min.toArray()); expect(boxA.max.toArray()).toEqual(boxB.max.toArray()); }
    }
  });

  it('presentation adds distinguishable, non-pickable corner fillers; technical adds none', () => {
    const scene = fixtureMultiRoom();
    const technical = sceneStats(buildThreePlanGroup(scene, {}, { quality: 'technical' }));
    const presentation = sceneStats(buildThreePlanGroup(scene, {}, { quality: 'presentation' }));
    expect(technical.presentationOnlyMeshes).toBe(0);
    expect(presentation.presentationOnlyMeshes).toBeGreaterThan(0);
    const group = buildThreePlanGroup(scene, {}, { quality: 'presentation' });
    group.traverse((o) => { if (o.userData.presentationOnly) { expect(o.userData.derived).toBe('corner-filler'); expect(new THREE.Raycaster().intersectObject(o)).toEqual([]); } });
  });

  it('corner fillers close exactly the missing quadrant: half a wall thickness square, wall height', () => {
    const scene = fixtureTwoRooms();
    const group = buildThreePlanGroup(scene, {}, { quality: 'presentation' });
    const fillers: THREE.Mesh[] = []; group.traverse((o) => { if (o.userData.presentationOnly) fillers.push(o as THREE.Mesh); });
    expect(fillers.length).toBe(4); // the four outer corners; the T-junctions need none
    for (const filler of fillers) { const size = new THREE.Box3().setFromObject(filler).getSize(new THREE.Vector3()); expect(size.x).toBeCloseTo(0.1, 5); expect(size.y).toBeCloseTo(2.7, 5); expect(size.z).toBeCloseTo(0.1, 5); }
  });
});

describe('provisional geometry stays visibly provisional', () => {
  for (const quality of MODES) it(`confirmed walls are plain, unreviewed ones are outlined, ambiguous ones are outlined and hatched (${quality})`, () => {
    const scene = fixtureProvisional();
    const group = buildThreePlanGroup(scene, {}, { quality });
    const library = getMaterials(quality);
    const unreviewed = group.getObjectByName('wall-edge-400-400-800-400')!; const ambiguous = group.getObjectByName('wall-edge-400-0-400-400')!; const confirmedWall = group.getObjectByName('wall-edge-0-0-400-0')!;
    const lines = (o: THREE.Object3D) => o.children.filter((c) => (c as THREE.Line).isLine);
    expect(lines(confirmedWall)).toHaveLength(0);
    expect(lines(unreviewed)).toHaveLength(1); expect(lines(ambiguous)).toHaveLength(1);
    expect((unreviewed.children[0] as THREE.Mesh).material).toEqual([library.m.wallFace, library.m.wallCap]);
    expect((ambiguous.children[0] as THREE.Mesh).material).toEqual([library.m.wallFaceAmbiguous, library.m.wallCapAmbiguous]);
    expect((confirmedWall.children[0] as THREE.Mesh).userData.provisional).toBeUndefined();
    expect((ambiguous.children[0] as THREE.Mesh).userData.provisional).toBe('ambiguous');
    // outlines are never pick targets
    expect(new THREE.Raycaster().intersectObject(lines(unreviewed)[0]!)).toEqual([]);
  });
  it('a scene with nothing provisional has no outlines at all', () => {
    expect(sceneStats(buildThreePlanGroup(fixtureTwoRooms(), {}, { quality: 'technical' })).lines).toBe(0);
  });
});

describe('materials are shared and survive scene rebuilds', () => {
  it('rebuilding does not create materials or textures', () => {
    disposeMaterials();
    const scene = fixtureMultiRoom();
    const first = sceneStats(buildThreePlanGroup(scene, {}, { quality: 'presentation' }));
    for (let i = 0; i < 5; i += 1) buildThreePlanGroup(scene, {}, { quality: 'presentation' });
    const again = sceneStats(buildThreePlanGroup(scene, {}, { quality: 'presentation' }));
    expect(again.materials).toBe(first.materials); expect(again.textures).toBe(first.textures);
    expect(first.textures).toBeGreaterThan(0);
    expect(sceneStats(buildThreePlanGroup(scene, {}, { quality: 'technical' })).textures).toBe(0);
  });
  it('every wall solid uses the same shared material instances', () => {
    const group = buildThreePlanGroup(fixtureMultiRoom(), {}, { quality: 'presentation' });
    const used = new Set<THREE.Material>(); group.traverse((o) => { if (o.userData.derived === 'wall') for (const m of (o as THREE.Mesh).material as THREE.Material[]) used.add(m); });
    expect(used.size).toBe(2);
  });
  it('presentation materials are physically based and have maps; technical ones are flat', () => {
    const p = getMaterials('presentation').m; const t = getMaterials('technical').m;
    expect(p.wallFace.normalMap).toBeTruthy(); expect(p.floor.map).toBeTruthy(); expect(p.metal.metalness).toBeGreaterThan(0.5); expect(p.glass.transparent).toBe(true);
    expect(t.wallFace.normalMap).toBeNull(); expect(t.floor.map).toBeNull();
    expect(t.wallFace.map).toBeNull(); expect(t.wallFaceAmbiguous.map).toBeTruthy(); // only ambiguous geometry is hatched in technical
  });
  it('disposeMaterials releases and rebuilds cleanly', () => {
    const before = getMaterials('technical'); disposeMaterials(); const after = getMaterials('technical');
    expect(after).not.toBe(before);
  });
});

describe('parent relationships and reconstruction', () => {
  it('children follow their parent group; rebuilding after a change reflects it', () => {
    const scene = structuredClone(fixtureTwoRooms());
    const rig = structuredClone(scene.nodes[0]!); rig.id = 'rig'; rig.label = 'rig'; rig.nodeType = 'group'; rig.geometry = null; rig.component = undefined as never;
    rig.transform.translationM = [10, 0, 0]; rig.transform.rotation = [0, 0, 0, 1]; rig.transform.scale = [1, 1, 1];
    scene.nodes.unshift(rig);
    const wall = scene.nodes.find((n) => n.id === 'wall-edge-0-0-400-0')!;
    wall.parentId = 'rig';
    const group = buildThreePlanGroup(scene, {}, { quality: 'technical' });
    group.updateMatrixWorld(true);
    const world = new THREE.Vector3().setFromMatrixPosition(group.getObjectByName(wall.id)!.matrixWorld);
    expect(world.x).toBeCloseTo(wall.transform.translationM[0] + 10, 6);
    // a rebuild from a changed scene shows the change, from the data alone
    const moved = structuredClone(scene); moved.nodes.find((n) => n.id === 'rig')!.transform.translationM = [20, 0, 0];
    const again = buildThreePlanGroup(moved, {}, { quality: 'technical' }); again.updateMatrixWorld(true);
    expect(new THREE.Vector3().setFromMatrixPosition(again.getObjectByName(wall.id)!.matrixWorld).x).toBeCloseTo(wall.transform.translationM[0] + 20, 6);
  });
  it('selection pick mapping: every drawn mesh sits under a node group carrying the node id', () => {
    const group = buildThreePlanGroup(fixtureMultiRoom(), {}, { quality: 'presentation' });
    group.traverse((o) => { if (o instanceof THREE.Mesh && !o.userData.presentationOnly) { let p: THREE.Object3D | null = o; let id: string | undefined; while (p && !id) { id = p.userData.id as string | undefined; p = p.parent; } expect(id).toBeTruthy(); } });
  });
});
