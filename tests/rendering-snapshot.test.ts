import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { snapshotScene } from '../src/rendering/snapshot';

function liveScene() {
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#102030');
  const root = new THREE.Group(); root.name = 'root'; scene.add(root);
  const shared = new THREE.MeshStandardMaterial({ color: '#cccccc' });
  const wall = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 0.1), shared); wall.name = 'wall'; wall.position.set(1, 1, 0); root.add(wall);
  const twin = new THREE.Mesh(wall.geometry, shared); twin.name = 'twin'; twin.position.set(-1, 1, 0); root.add(twin);
  const ghost = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.8 })); ghost.name = 'ghost'; root.add(ghost);
  const lines = new THREE.LineSegments(new THREE.EdgesGeometry(wall.geometry), new THREE.LineBasicMaterial()); lines.name = 'edges'; root.add(lines);
  const rig = new THREE.Group(); const key = new THREE.DirectionalLight('#fff', 2); key.castShadow = true; key.position.set(5, 8, 3); key.target.position.set(1, 0, 1); rig.add(key, key.target); scene.add(rig);
  const chrome = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()); chrome.name = 'gizmo'; scene.add(chrome);
  const outline = new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(), new THREE.Vector3(1, 1, 1))); scene.add(outline);
  return { scene, root, wall, twin, ghost, lines, key, chrome, outline, shared };
}

describe('snapshotScene', () => {
  it('is independent of later changes to the live scene', () => {
    const s = liveScene(); const snap = snapshotScene(s.scene, { exclude: [s.chrome, s.outline] });
    const copyWall = snap.scene.getObjectByName('wall') as THREE.Mesh; const copyGhost = snap.scene.getObjectByName('ghost') as THREE.Mesh;
    // everything the editor can do mid-export
    s.wall.position.set(9, 9, 9); s.root.remove(s.twin); s.wall.geometry.dispose(); s.wall.geometry = new THREE.BoxGeometry(5, 5, 5);
    (s.ghost.material as THREE.MeshBasicMaterial).opacity = 0; s.shared.color.set('#ff0000'); s.scene.background = new THREE.Color('#ffffff'); s.key.intensity = 0; s.key.target.position.set(50, 0, 0);
    snap.scene.updateMatrixWorld(true);
    expect(copyWall.position.toArray()).toEqual([1, 1, 0]);
    expect((copyWall.geometry as THREE.BoxGeometry).parameters.width).toBe(2);
    expect(snap.scene.getObjectByName('twin')).toBeTruthy();
    expect((copyGhost.material as THREE.MeshBasicMaterial).opacity).toBe(0.8);
    expect(((copyWall.material as THREE.MeshStandardMaterial).color.getHexString())).toBe('cccccc');
    expect((snap.scene.background as THREE.Color).getHexString()).toBe('102030');
    const light = snap.scene.getObjectByProperty('isDirectionalLight', true) as THREE.DirectionalLight;
    expect(light.intensity).toBe(2); expect(light.target.position.toArray()).toEqual([1, 0, 1]);
  });

  it('shares nothing disposable with the live scene and keeps duplicates shared inside the copy', () => {
    const s = liveScene(); const snap = snapshotScene(s.scene, { exclude: [s.chrome, s.outline] });
    const a = snap.scene.getObjectByName('wall') as THREE.Mesh; const b = snap.scene.getObjectByName('twin') as THREE.Mesh;
    expect(a.geometry).not.toBe(s.wall.geometry); expect(a.material).not.toBe(s.shared);
    expect(a.geometry).toBe(b.geometry); expect(a.material).toBe(b.material);
    let disposed = 0; s.wall.geometry.addEventListener('dispose', () => { disposed += 1; });
    snap.dispose(); expect(disposed).toBe(0);
  });

  it('leaves out excluded chrome and re-links the light target inside the copy', () => {
    const s = liveScene(); const snap = snapshotScene(s.scene, { exclude: [s.chrome, s.outline] });
    expect(snap.scene.getObjectByName('gizmo')).toBeUndefined();
    let helpers = 0; snap.scene.traverse((o) => { if ((o as { isBox3Helper?: boolean }).isBox3Helper) helpers += 1; }); expect(helpers).toBe(0);
    const light = snap.scene.getObjectByProperty('isDirectionalLight', true) as THREE.DirectionalLight;
    expect(light).not.toBe(s.key); expect(light.target).not.toBe(s.key.target);
    let inside = false; snap.scene.traverse((o) => { if (o === light.target) inside = true; }); expect(inside).toBe(true);
  });

  it('copies line geometry and disposes only what it created, once', () => {
    const s = liveScene(); const snap = snapshotScene(s.scene, { exclude: [s.chrome, s.outline] });
    const lines = snap.scene.getObjectByName('edges') as THREE.LineSegments; expect(lines.geometry).not.toBe(s.lines.geometry);
    let copies = 0; for (const name of ['wall', 'ghost', 'edges']) (snap.scene.getObjectByName(name) as THREE.Mesh).geometry.addEventListener('dispose', () => { copies += 1; });
    snap.dispose(); snap.dispose(); expect(copies).toBe(3);
  });

  it('does not touch the live scene graph', () => {
    const s = liveScene(); const before = JSON.stringify(s.scene.toJSON()); const snap = snapshotScene(s.scene, { exclude: [s.chrome, s.outline] });
    expect(JSON.stringify(s.scene.toJSON())).toBe(before); snap.dispose(); expect(JSON.stringify(s.scene.toJSON())).toBe(before);
  });
});
