import { describe, expect, it } from 'vitest';
import { BoxGeometry, DataTexture, Group, Mesh, MeshStandardMaterial, type BufferGeometry, type Material, type Object3D, type Texture } from 'three';
import { validateSpatialPlanV2, type SpatialPlanV2 } from '../src/universal-spatial/contracts-v2';
import { disposeCompiledSpatialPlan } from '../src/universal-spatial/geometry-compiler-v2';
import { compileWithRouter } from '../src/universal-spatial/fidelity/router';
import { createAssetOffer } from '../src/universal-spatial/fidelity/assets';
import type { AssetApproval, AssetProposal } from '../src/universal-spatial/fidelity/types';

const T = { position: [0, 0, 0], rotationRad: [0, 0, 0], scale: [1, 1, 1] };
const plan = (): SpatialPlanV2 => validateSpatialPlanV2({
  contract: 'unfold.spatial-plan.v2', source: { kind: 'image', sha256: 'e'.repeat(64) }, title: 'T', units: 'unitless', presentationProfile: 'neutral', relations: [], constraints: [], unknowns: [],
  components: [{ id: 'part', label: 'Part', parentId: null, transform: { ...T, position: [0, 1, 0] }, provenance: { geometry: 'design_approximation', transform: 'design_approximation', material: 'design_approximation', evidence: 't' },
    geometry: { type: 'shape', key: 'part-shape', operator: 'box', parameters: { dimensions: [1, 1, 1] }, transform: T, repeat: null, material: { profile: 'neutral', color: '#999999', roughness: 0.5, metalness: 0, clearcoat: 0 } } }],
});
const proposal = (): AssetProposal => ({ id: 'a1', sha256: 'f'.repeat(64), source: { kind: 'licensed_library', library: 'test' }, license: { spdx: 'CC0-1.0', attribution: null, sourceUrl: null, verified: true }, mapping: [{ componentId: 'part', nodePaths: ['Hull', 'Door'], method: 'manual', confidence: 1 }], stats: { triangles: 24, nodes: 2, materials: 2, textures: 1, textureBytes: 4, bytes: 10 }, status: 'proposed' });
const approval = (): AssetApproval => ({ proposalId: 'a1', componentIds: ['part'], decidedBy: 'human_review', reviewerAuthenticated: false, at: '2026-11-04T00:00:00Z' });

/** A source scene of two meshes that share ONE texture, like a real GLB. Counts every dispose event by object. */
function source() {
  const texture = new DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1), scene = new Group(), counts = new Map<object, number>();
  const watch = (o: Texture | BufferGeometry | Material) => { counts.set(o, 0); o.addEventListener('dispose' as never, () => counts.set(o, (counts.get(o) ?? 0) + 1)); return o; };
  watch(texture);
  const meshes = ['Hull', 'Door'].map((name) => { const g = watch(new BoxGeometry(1, 1, 1)) as BoxGeometry, m = watch(new MeshStandardMaterial({ map: texture })) as MeshStandardMaterial, mesh = new Mesh(g, m); mesh.name = name; scene.add(mesh); return mesh; });
  return { scene, texture, geometries: meshes.map((m) => m.geometry), materials: meshes.map((m) => m.material as MeshStandardMaterial), count: (o: object) => counts.get(o) ?? 0 };
}
const compiledAssetMeshes = (root: Object3D) => { const out: Mesh[] = []; root.traverse((o) => { if (o instanceof Mesh && o.userData.geometryFamily === 'mesh_asset') out.push(o); }); return out; };

describe('ownership and disposal of external meshes', () => {
  it('a compiled plan frees only what it owns (its cloned materials) and never the source geometry or textures', () => {
    const s = source(), offer = createAssetOffer(proposal(), s.scene), routed = compileWithRouter(plan(), { assets: [offer], approvals: [approval()], policy: 'v2_only' });
    const meshes = compiledAssetMeshes(routed.root), clones = meshes.map((m) => m.material as MeshStandardMaterial); expect(meshes.length).toBe(2); for (const c of clones) expect(s.materials).not.toContain(c); // clones, not the originals
    const cloneCounts = new Map<Material, number>(); for (const c of clones) { cloneCounts.set(c, 0); c.addEventListener('dispose', () => cloneCounts.set(c, cloneCounts.get(c)! + 1)); }
    disposeCompiledSpatialPlan(routed.root);
    for (const c of clones) expect(cloneCounts.get(c)).toBe(1);
    for (const g of s.geometries) expect(s.count(g)).toBe(0); expect(s.count(s.texture)).toBe(0); for (const m of s.materials) expect(s.count(m)).toBe(0);
  });

  it('can be rebuilt any number of times from the same offer: edits and undo never reuse a freed resource', () => {
    const s = source(), offer = createAssetOffer(proposal(), s.scene);
    for (let i = 0; i < 4; i++) { const routed = compileWithRouter(plan(), { assets: [offer], approvals: [approval()], policy: 'v2_only' }); expect(compiledAssetMeshes(routed.root).length).toBe(2); disposeCompiledSpatialPlan(routed.root); }
    for (const g of s.geometries) expect(s.count(g)).toBe(0); expect(s.count(s.texture)).toBe(0);
  });

  it('disposing the offer frees the source exactly once (the shared texture once, not once per mesh), and a second call does nothing', () => {
    const s = source(), offer = createAssetOffer(proposal(), s.scene);
    offer.dispose(); offer.dispose();
    for (const g of s.geometries) expect(s.count(g)).toBe(1); for (const m of s.materials) expect(s.count(m)).toBe(1); expect(s.count(s.texture)).toBe(1); expect(offer.disposed).toBe(true);
  });

  it('a disposed offer is never drawn: the component stays on V2 with a coded reason', () => {
    const s = source(), offer = createAssetOffer(proposal(), s.scene); offer.dispose();
    const routed = compileWithRouter(plan(), { assets: [offer], approvals: [approval()], policy: 'v2_only' }), d = routed.report.decisions[0]!;
    expect(d.used).toBe('procedural_v2'); expect(d.fallback).toEqual({ from: 'mesh_asset', code: 'ASSET_DISPOSED' }); expect(compiledAssetMeshes(routed.root).length).toBe(0); disposeCompiledSpatialPlan(routed.root);
  });

  it('any order of teardown is safe: plan first then offer, or offer first then plan', () => {
    for (const planFirst of [true, false]) {
      const s = source(), offer = createAssetOffer(proposal(), s.scene), routed = compileWithRouter(plan(), { assets: [offer], approvals: [approval()], policy: 'v2_only' });
      if (planFirst) { disposeCompiledSpatialPlan(routed.root); offer.dispose(); } else { offer.dispose(); disposeCompiledSpatialPlan(routed.root); }
      for (const g of s.geometries) expect(s.count(g), `planFirst=${planFirst}`).toBe(1); expect(s.count(s.texture), `planFirst=${planFirst}`).toBe(1);
    }
  });

  it('disposing a compiled plan twice does nothing the second time', () => {
    const s = source(), routed = compileWithRouter(plan(), { assets: [createAssetOffer(proposal(), s.scene)], approvals: [approval()], policy: 'v2_only' }), clones = compiledAssetMeshes(routed.root).map((m) => m.material as MeshStandardMaterial);
    const counts = clones.map((c) => { let n = 0; c.addEventListener('dispose', () => n++); return () => n; }); disposeCompiledSpatialPlan(routed.root); disposeCompiledSpatialPlan(routed.root); for (const n of counts) expect(n()).toBe(1);
  });
});
