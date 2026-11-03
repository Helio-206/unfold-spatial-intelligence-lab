import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EXCAVATOR_ASSEMBLY_V1 as A } from '../../../src/living/contracts/fixtures/excavator.assembly.v1';
import { createExcavatorProvider } from '../../../src/living/visual-foundry/provider';
import { MATERIAL_KEYS } from '../../../src/living/visual-foundry/materials';

const BASELINE_TRIANGLES = 253_744; // before the cab and hood refinement (reports/cinema/geometry/evidence-before.json)
const meshes = (root: THREE.Object3D) => { const out: THREE.Mesh[] = []; root.traverse((o) => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh); }); return out; };
const tris = (m: THREE.Mesh) => (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position!.count) / 3;

describe('cab and hood refinement is visual-only and stays on the canonical part', () => {
  const p = createExcavatorProvider(A); const all = meshes(p.root);
  it('the 13 canonical parts are unchanged and every mesh still belongs to a canonical part or is a display-only hose', () => {
    expect([...p.parts.keys()].sort()).toEqual(A.parts.map((x) => x.id).sort()); expect(p.parts.size).toBe(13);
    for (const m of all) expect(typeof m.userData.partId === 'string' || m.userData.displayOnly === true).toBe(true);
  });
  it('the new detail lives in the upper_body part group (it moves with the part), under existing material keys only', () => {
    const upper = p.parts.get('upper_body')!; const keys = new Set(meshes(upper).map((m) => m.userData.materialKey)); expect(keys.size).toBeGreaterThanOrEqual(10);
    for (const k of keys) expect(MATERIAL_KEYS as readonly string[]).toContain(k);
    expect(new Set(all.map((m) => (m.material as THREE.Material).uuid)).size).toBeLessThanOrEqual(12); // no new material was created
    for (const m of meshes(upper)) expect(m.userData.partId).toBe('upper_body');
  });
  it('a pose applied to upper_body moves all of its detail rigidly (details share the part group)', () => {
    const upper = p.parts.get('upper_body')!; const probe = meshes(upper).find((m) => m.name === 'upper_body:chrome')!; expect(probe).toBeTruthy();
    const a = new THREE.Box3().setFromObject(probe).getCenter(new THREE.Vector3());
    upper.position.add(new THREE.Vector3(1, 2, 3)); upper.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(probe).getCenter(new THREE.Vector3()); expect(b.distanceTo(a.clone().add(new THREE.Vector3(1, 2, 3)))).toBeLessThan(1e-9);
    upper.position.set(0, 0, 0); upper.updateMatrixWorld(true);
  });
  it('picking: a ray at a cab window frame and at a hood louvre hits upper_body, never another part', () => {
    p.root.updateMatrixWorld(true); const ray = new THREE.Raycaster();
    for (const [origin, target] of [[[2.2, 1.6, -4], [0.6, 1.7, -1.2]], [[-1.6, 1.0, -4], [-1.1, 0.62, -1.2]]] as const) {
      ray.set(new THREE.Vector3(...origin), new THREE.Vector3(...target).sub(new THREE.Vector3(...origin)).normalize());
      const hit = ray.intersectObject(p.root, true)[0]; expect(hit).toBeTruthy(); expect(hit!.object.userData.partId).toBe('upper_body');
    }
  });
  it('triangle growth is bounded (about 7 %), the mesh budget holds and the model stays inside the foundry budget', () => {
    const total = all.reduce((s, m) => s + tris(m), 0); expect(total).toBeGreaterThan(BASELINE_TRIANGLES); expect(total).toBeLessThan(BASELINE_TRIANGLES * 1.1); expect(total).toBeLessThan(300_000); expect(all.length).toBeLessThan(90);
  });
  it('the detail stays near the original envelope of the upper structure (no stray geometry)', () => {
    const box = new THREE.Box3(); for (const m of meshes(p.parts.get('upper_body')!)) box.expandByObject(m);
    expect(box.min.x).toBeGreaterThan(-2.2); expect(box.max.x).toBeLessThan(1.7); expect(box.min.z).toBeGreaterThan(-1.5); expect(box.max.z).toBeLessThan(1.5); expect(box.max.y).toBeLessThan(2.2); expect(box.min.y).toBeGreaterThan(-0.1);
  });
  it('building is deterministic: two builds give identical geometry', () => {
    const q = createExcavatorProvider(A); const sig = (root: THREE.Object3D) => meshes(root).map((m) => `${m.name}:${m.geometry.attributes.position!.count}:${m.geometry.boundingSphere!.radius.toFixed(9)}`).join('|');
    expect(sig(q.root)).toBe(sig(p.root)); q.dispose();
  });
});
