import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { Box3, Vector3 } from 'three';
import { addOpeningToScene, createPlanScene } from '../src/plan-scene';
import { traceWallCandidate } from '../src/plan-reconstruction';
import { buildThreePlanGroup, type ArchitecturalAssets } from '../src/plan-three-adapter';

describe('architectural Blender library export', () => {
  it('loads through Three.js with modular roots and unit-scale transforms', async () => {
    const bytes = readFileSync(new URL('../public/assets/architectural_library.glb', import.meta.url));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const gltf = await new Promise<GLTF>((resolve, reject) => {
      new GLTFLoader().parse(buffer, '', resolve, reject);
    });
    const roots = gltf.scene.children;
    expect(roots.map((root) => root.name).sort()).toEqual([
      'connector_corner_90', 'connector_isolated_foot', 'door_single_900',
      'mechanical_frame_1000', 'partition_int_3000', 'wall_ext_3000', 'window_double_1200',
    ]);
    for (const root of roots) {
      expect(root.position.toArray()).toEqual([0, 0, 0]);
      expect(root.scale.toArray()).toEqual([1, 1, 1]);
      expect(root.children.some((child) => (child as import('three').Mesh).isMesh)).toBe(true);
    }
    const wall = gltf.scene.getObjectByName('wall_ext_3000')!;
    const size = new Box3().setFromObject(wall).getSize(new Vector3());
    expect(size.x).toBeCloseTo(3, 2);
    expect(size.y).toBeCloseTo(2.8, 2);
    expect(size.z).toBeCloseTo(0.2, 2);

    const source = traceWallCandidate('asset-wall', { x: 0, y: 0 }, { x: 300, y: 0 }, 5);
    const scene = createPlanScene({ sceneId: 'wall-pivot-proof', title: 'Wall pivot', image: { sha256: 'b'.repeat(64), width: 300, height: 100 }, calibration: { pixelDistance: 300, realDistanceMetres: 3, evidence: 'test only', actor: 'fixture' }, confirmedCandidateIds: [source.id], candidates: [source], wall: { heightM: 2.8, thicknessM: 0.2 } });
    const assets = { wall_ext_3000: wall } as ArchitecturalAssets;
    const rendered = buildThreePlanGroup(scene.scene, assets);
    rendered.updateMatrixWorld(true);
    const renderedBounds = new Box3().setFromObject(rendered.getObjectByName('wall-asset-wall')!);
    expect(renderedBounds.min.y).toBeCloseTo(0, 4);
    expect(renderedBounds.max.y).toBeCloseTo(2.8, 2);
  });

  it('uses actual Blender door and window meshes for dependent openings', async () => {
    const bytes = readFileSync(new URL('../public/assets/architectural_library.glb', import.meta.url));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const gltf = await new Promise<GLTF>((resolve, reject) => new GLTFLoader().parse(buffer, '', resolve, reject));
    const assets = Object.fromEntries([
      'wall_ext_3000', 'partition_int_3000', 'door_single_900', 'window_double_1200',
      'connector_corner_90', 'connector_isolated_foot', 'mechanical_frame_1000',
    ].map((name) => [name, gltf.scene.getObjectByName(name)])) as ArchitecturalAssets;
    const wall = traceWallCandidate('trace', { x: 0, y: 0 }, { x: 300, y: 0 }, 5);
    const scene = createPlanScene({ sceneId: 'asset-proof', title: 'Asset proof', image: { sha256: 'a'.repeat(64), width: 300, height: 100 }, calibration: { pixelDistance: 300, realDistanceMetres: 3, evidence: 'test only', actor: 'fixture' }, confirmedCandidateIds: [wall.id], candidates: [wall], wall: { heightM: 2.8, thicknessM: 0.2 } });
    let withDoor = addOpeningToScene(scene, 'wall-trace', { id: 'door-test', kind: 'door', offsetM: 0.2, widthM: 0.9, heightM: 2.1, sillM: 0 });
    withDoor = addOpeningToScene(withDoor, 'wall-trace', { id: 'window-test', kind: 'window', offsetM: 1.7, widthM: 0.9, heightM: 0.9, sillM: 0.8 });
    const group = buildThreePlanGroup(withDoor.scene, assets);
    const wallGeometry = group.getObjectByName('wall-trace')?.children.find((child) => (child as import('three').Mesh).isMesh) as import('three').Mesh;
    expect(wallGeometry.geometry.type).toBe('ExtrudeGeometry');
    expect(group.getObjectByName('door-test')?.userData.assetModule).toBe('door_single_900');
    expect(group.getObjectByName('window-test')?.userData.assetModule).toBe('window_double_1200');
    const hasMesh = (name: string) => { let result = false; group.getObjectByName(name)?.traverse((child) => { if ((child as import('three').Mesh).isMesh) result = true; }); return result; };
    expect(hasMesh('door-test')).toBe(true);
    expect(hasMesh('window-test')).toBe(true);
  });
});
