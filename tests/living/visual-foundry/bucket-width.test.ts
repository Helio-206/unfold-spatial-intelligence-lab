import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EXCAVATOR_ASSEMBLY_V1 as BASE } from '../../../src/living/contracts/fixtures/excavator.assembly.v1';
import type { Assembly } from '../../../src/living/contracts';
import { createExcavatorProvider } from '../../../src/living/visual-foundry/provider';
import { BUCKET_HALF_WIDTH_RANGE_M } from '../../../src/living/visual-foundry/excavator/canonical';

const withHalfWidth = (half: number): Assembly => { const a = structuredClone(BASE) as Assembly; const box = a.parts.find((p) => p.id === 'bucket')!.shapes.find((s) => s.id === 'bucket-box')!; if (box.kind !== 'box') throw new Error('fixture'); box.halfExtentsM = [box.halfExtentsM[0], box.halfExtentsM[1], half]; return a; };
const meshes = (root: THREE.Object3D) => { const o: THREE.Mesh[] = []; root.traverse((m) => { if ((m as THREE.Mesh).isMesh) o.push(m as THREE.Mesh); }); return o; };
const bounds = (g: THREE.Object3D) => new THREE.Box3().setFromObject(g);
const tris = (g: THREE.Object3D) => meshes(g).reduce((s, m) => s + (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position!.count) / 3, 0);
const verts = (g: THREE.Object3D, keep: (x: number, y: number, z: number) => boolean) => { const out: string[] = []; for (const m of meshes(g)) { const p = m.geometry.attributes.position!; for (let i = 0; i < p.count; i += 1) if (keep(p.getX(i), p.getY(i), p.getZ(i))) out.push(`${m.name}|${p.getX(i).toFixed(6)},${p.getY(i).toFixed(6)},${p.getZ(i).toFixed(6)}`); } return out.sort(); };
const sig = (g: THREE.Object3D) => meshes(g).map((m) => `${m.name}:${m.geometry.attributes.position!.count}:${m.geometry.boundingSphere!.radius.toFixed(9)}`).join('|');

describe('the bucket is built from the contract width (bucket-box.halfExtentsM[2])', () => {
  const narrow = createExcavatorProvider(withHalfWidth(0.55)); const wide = createExcavatorProvider(withHalfWidth(0.7)); const base = createExcavatorProvider(BASE);
  const bn = narrow.parts.get('bucket')!; const bw = wide.parts.get('bucket')!;
  it('the fixture width (1.10 m) gives exactly the original bucket', () => { expect(sig(bn)).toBe(sig(base.parts.get('bucket')!)); expect(base.stats().triangles).toBe(narrow.stats().triangles); });
  it('1.10 m and 1.40 m differ visibly and measurably: the width follows the contract', () => {
    const wn = bounds(bn).getSize(new THREE.Vector3()).z; const ww = bounds(bw).getSize(new THREE.Vector3()).z;
    expect(wn).toBeGreaterThan(1.10); expect(wn).toBeLessThan(1.16); expect(ww - wn).toBeCloseTo(0.30, 2); // +0.15 m per side
    expect(tris(bw)).toBeGreaterThan(tris(bn)); // an extra tooth on the wider bucket
    expect(verts(bn, () => true)).not.toEqual(verts(bw, () => true));
  });
  it('teeth scale with the width and sit inside the edge on both sides', () => {
    const count = (g: THREE.Object3D) => meshes(g).find((m) => m.name === 'bucket:machined')!.geometry.attributes.position!.count;
    expect(count(bw)).toBeGreaterThan(count(bn));
    for (const g of [bn, bw]) { const half = g === bn ? 0.55 : 0.7; const z = bounds(g).max.z; expect(z).toBeLessThan(half + 0.06); expect(z).toBeGreaterThan(half); }
  });
  it('no distortion: the profile in the XY plane is the same at both widths; only the width changes', () => {
    const a = bounds(bn); const b = bounds(bw); for (const axis of ['x', 'y'] as const) { expect(b.min[axis]).toBeCloseTo(a.min[axis], 6); expect(b.max[axis]).toBeCloseTo(a.max[axis], 6); }
  });
  it('the hinge, link pin and ears (canonical points, near the pins) are identical at both widths', () => {
    const near = (x: number, y: number, z: number) => Math.abs(x) < 0.5 && Math.abs(y) < 0.5 && Math.abs(z) < 0.28;
    const a = verts(bn, near); const b = verts(bw, near); expect(a.length).toBeGreaterThan(200); expect(b).toEqual(a);
    const link = BASE.parts.find((p) => p.id === 'bucket')!.points.find((p) => p.id === 'link_pin')!.positionM; const nearLink = (x: number, y: number, z: number) => Math.hypot(x - link[0], y - link[1]) < 0.12 && Math.abs(z) < 0.28;
    expect(verts(bw, nearLink)).toEqual(verts(bn, nearLink)); expect(verts(bn, nearLink).length).toBeGreaterThan(100);
  });
  it('every other component is untouched: 12 other canonical parts, same ids, same geometry signatures', () => {
    expect([...wide.parts.keys()].sort()).toEqual([...narrow.parts.keys()].sort()); expect(wide.parts.size).toBe(13);
    for (const [id, g] of narrow.parts) if (id !== 'bucket') expect(sig(wide.parts.get(id)!)).toBe(sig(g));
    expect(wide.stats().materials).toBe(narrow.stats().materials);
  });
  it('picking and articulation are intact: a ray at the side plate hits the bucket, and an engine-style pose is applied exactly', () => {
    wide.root.updateMatrixWorld(true); const ray = new THREE.Raycaster(); const c = bounds(bw).getCenter(new THREE.Vector3());
    ray.set(new THREE.Vector3(c.x, c.y, c.z + 5), new THREE.Vector3(0, 0, -1)); const hit = ray.intersectObject(wide.root, true)[0]; expect(hit?.object.userData.partId).toBe('bucket');
    const ref = wide.applyReferencePose(); expect(ref.status).toBe('applied'); const q = new THREE.Quaternion(); const p = new THREE.Vector3(); bw.getWorldPosition(p); bw.getWorldQuaternion(q);
    const pose = BASE.parts.length; expect(pose).toBe(13); expect(p.length()).toBeGreaterThan(1); // placed by the canonical pose, not by the width
    const refBucket = createExcavatorProvider(withHalfWidth(0.55)); refBucket.applyReferencePose(); const p0 = new THREE.Vector3(); refBucket.parts.get('bucket')!.getWorldPosition(p0); expect(p.distanceTo(p0)).toBe(0);
  });
  it('incompatible widths are rejected explicitly, never adjusted', () => {
    const bad = [0.2, 0.29, 1.25, 2, 0, -0.5, Number.NaN, Number.POSITIVE_INFINITY];
    for (const w of bad) expect(() => createExcavatorProvider(withHalfWidth(w)), String(w)).toThrow(/FOUNDRY_BUCKET_WIDTH_(OUT_OF_RANGE|NOT_FINITE)/);
    expect(() => createExcavatorProvider(withHalfWidth(BUCKET_HALF_WIDTH_RANGE_M.min))).not.toThrow(); expect(() => createExcavatorProvider(withHalfWidth(BUCKET_HALF_WIDTH_RANGE_M.max))).not.toThrow();
    const noBox = structuredClone(BASE) as Assembly; noBox.parts.find((p) => p.id === 'bucket')!.shapes = []; expect(() => createExcavatorProvider(noBox)).toThrow(/FOUNDRY_BUCKET_WIDTH_MISSING/);
    const cyl = structuredClone(BASE) as Assembly; const sh = cyl.parts.find((p) => p.id === 'bucket')!.shapes[0]!; Object.assign(sh, { kind: 'cylinder', radiusM: 0.3, halfLengthM: 0.5 }); expect(() => createExcavatorProvider(cyl)).toThrow(/FOUNDRY_BUCKET_WIDTH_NOT_A_BOX/);
  });
  it('the contract width is the only source: changing only the shape changes the mesh, and nothing else in the assembly was edited', () => {
    expect(withHalfWidth(0.7).parts.find((p) => p.id === 'bucket')!.points).toEqual(BASE.parts.find((p) => p.id === 'bucket')!.points);
  });
});
