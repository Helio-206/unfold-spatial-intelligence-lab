import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildPlanVectorModel } from '../src/plan-reconstruction';
import { addOpeningToScene, createPlanScene, removeWallFromScene } from '../src/plan-scene';
import { buildRemovalGhost } from '../src/plan-three-adapter';
import { describeWallRemoval, polygonAreaM2 } from '../src/removal-preview';

const line = (id: string, x1: number, y1: number, x2: number, y2: number) => ({ id, orientation: (y1 === y2 ? 'horizontal' : 'vertical') as 'horizontal' | 'vertical', start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thicknessPx: 6, confidence: 1, origin: 'automatic_detection' as const });

function twoRooms() {
  const candidates = [line('a', 0, 0, 300, 0), line('b', 300, 0, 300, 200), line('c', 300, 200, 0, 200), line('d', 0, 200, 0, 0), line('e', 120, 0, 120, 200)];
  const model = buildPlanVectorModel(candidates as never, { tolerancePx: 6, imageSize: { width: 300, height: 200 }, scale: { pixelsPerMetre: 30, source: 'known_measurement' } } as never);
  const regions = model.regions.filter((r) => r.eligibility === 'construction_candidate');
  return createPlanScene({ sceneId: 's', title: 't', image: { sha256: 'a'.repeat(64), width: 300, height: 200 }, calibration: { pixelDistance: 300, realDistanceMetres: 10, evidence: 'cota de 10 m', actor: 'u' }, confirmedCandidateIds: candidates.map((c) => c.id), confirmedRegionIds: regions.map((r) => r.id), candidates: candidates as never, regions: model.regions as never, wall: { heightM: 2.7, thicknessM: 0.15 } });
}

describe('wall removal preview', () => {
  it('the engine refuses to remove a wall that bounds rooms, and says which rooms', () => {
    const t = twoRooms();
    const shared = t.scene.nodes.find((n) => n.id.startsWith('wall-edge-120-0-120-200'))!;
    const before = JSON.stringify(t.scene);
    expect(() => removeWallFromScene(t, shared.id)).toThrow('REMOVE_HAS_DEPENDENCIES');
    expect(JSON.stringify(t.scene)).toBe(before);
    const info = describeWallRemoval(t.scene, shared.id)!;
    expect(info.rooms.map((r) => r.id).sort()).toEqual(['region-1', 'region-2']);
    // areas come from the room polygons in the scene, not from the drawing
    expect(info.rooms.every((r) => typeof r.areaM2 === 'number' && r.areaM2 > 0)).toBe(true);
    expect(info.structure).toBe('unknown');
  });

  it('a wall with no dependants can be removed; its openings are listed and go with it', () => {
    const t = twoRooms();
    const withDoor = addOpeningToScene(t, 'wall-a', { id: 'door-1', kind: 'door', offsetM: 1, widthM: 0.9, heightM: 2.05, sillM: 0, actor: 'u' });
    const info = describeWallRemoval(withDoor.scene, 'wall-a')!;
    expect(info.rooms).toEqual([]);
    expect(info.openings.map((o) => o.id)).toEqual(['door-1']);
    const next = removeWallFromScene(withDoor, 'wall-a');
    expect(next.scene.nodes.some((n) => n.id === 'wall-a' || n.id === 'door-1')).toBe(false);
  });

  it('describes nothing for a node that is not a wall', () => {
    const t = twoRooms();
    expect(describeWallRemoval(t.scene, 'region-1')).toBeUndefined();
    expect(describeWallRemoval(t.scene, 'nope')).toBeUndefined();
  });

  it('room area is the polygon area', () => {
    const t = twoRooms();
    const room = t.scene.nodes.find((n) => n.id === 'region-1')!;
    const area = polygonAreaM2(room)!;
    expect(area).toBeGreaterThan(0);
    expect(polygonAreaM2(t.scene.nodes.find((n) => n.id === 'wall-a')!)).toBeNull();
  });

  it('the ghost is drawn over the wall without touching the scene; dissolve fades the fill, blocked keeps the wall as it is', () => {
    const t = twoRooms();
    const before = JSON.stringify(t.scene);
    const ghost = buildRemovalGhost(t.scene, 'wall-a', 0xff5a1f)!;
    expect(ghost).toBeDefined();
    const fills: THREE.MeshStandardMaterial[] = [];
    ghost.group.traverse((o) => { if (o instanceof THREE.Mesh) fills.push(o.material as THREE.MeshStandardMaterial); });
    expect(fills.length).toBeGreaterThan(0);
    expect(fills[0]!.opacity).toBeGreaterThan(0.5);
    ghost.settle('blocked', () => undefined);
    expect(fills[0]!.opacity).toBe(0);
    ghost.dispose();
    expect(JSON.stringify(t.scene)).toBe(before);
    expect(buildRemovalGhost(t.scene, 'region-1', 0)).toBeUndefined();
  });
});
