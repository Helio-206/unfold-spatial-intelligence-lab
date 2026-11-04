import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture, DataTexture, type Object3D } from 'three';
import { validateSpatialPlanV2, type SpatialPlanV2 } from '../src/universal-spatial/contracts-v2';
import { disposeCompiledSpatialPlan } from '../src/universal-spatial/geometry-compiler-v2';
import { compileWithRouter } from '../src/universal-spatial/fidelity/router';
import type { AssetApproval, AssetProposal } from '../src/universal-spatial/fidelity/types';

type V3 = [number, number, number];
const T = (position: V3 = [0, 0, 0], rotationRad: V3 = [0, 0, 0]) => ({ position, rotationRad, scale: [1, 1, 1] as V3 });
const mat = (color = '#a07040', profile: 'neutral' | 'organic' | 'metal' = 'neutral') => ({ profile, color, roughness: 0.5, metalness: 0.1, clearcoat: 0 });
const prov = (origin: 'design_approximation' | 'observed' = 'design_approximation') => ({ geometry: origin, transform: origin, material: origin, evidence: 'test' });
const shape = (key: string, operator: string, parameters: object, transform = T(), material = mat()) => ({ type: 'shape' as const, key, operator, parameters, transform, repeat: null, material });
const component = (id: string, geometry: object, position: V3, parentId: string | null = null, origin: 'design_approximation' | 'observed' = 'design_approximation') => ({ id, label: id, parentId, transform: T(position), geometry, provenance: prov(origin) });
const plan = (components: object[]): SpatialPlanV2 => validateSpatialPlanV2({ contract: 'unfold.spatial-plan.v2', source: { kind: 'image', sha256: 'b'.repeat(64) }, title: 'router test', units: 'unitless', presentationProfile: 'organic', components, relations: [], constraints: [], unknowns: ['Physical scale is unknown.'] });

// a body (ellipsoid) with a tube that enters it, a flat slab, and a part using an operator without a distance field
const sample = () => plan([
  component('body', shape('body-shape', 'ellipsoid', { radii: [1.2, 1.6, 0.9], widthSegments: 24, heightSegments: 16 }), [0, 1.6, 0]),
  component('duct', shape('duct-shape', 'tube', { points: [[0, 0.5, 0], [0, 1.4, 0.2], [0.8, 2.2, 0.2]], radius: 0.12, tubularSegments: 24, radialSegments: 10 }), [0, 0, 0], 'body'),
  component('slab', shape('slab-shape', 'box', { dimensions: [3, 0.2, 2] }), [8, 0.1, 0]),
  component('profile', shape('profile-shape', 'revolve', { profile: [[0.3, 0], [0.3, 0.6]], segments: 16 }), [12, 0, 0]),
]);

const ownMeshes = (root: Object3D, id: string) => { const out: Mesh[] = []; const walk = (o: Object3D) => { for (const c of o.children) { if (c.userData.spatialComponentRoot) continue; if (c instanceof Mesh) out.push(c); walk(c); } }; walk(group(root, id)); return out; };
const group = (root: Object3D, id: string) => { let found: Object3D | undefined; root.traverse((o) => { if (o.userData.spatialComponentRoot && o.userData.spatialEntityId === id) found = o; }); return found!; };
const meshFamilies = (root: Object3D, id: string) => { return ownMeshes(root, id).map((o) => String(o.userData.geometryFamily ?? 'procedural_v2')); };

describe('adaptive geometry router', () => {
  it('keeps the plan, the components, their ids and the hierarchy exactly as V2 builds them', () => {
    const p = sample(), before = structuredClone(p), routed = compileWithRouter(p, { limits: { maxGridCells: 48 } });
    expect(p).toEqual(before);
    const ids = (root: Object3D) => { const out: string[] = []; root.traverse((o) => { if (o.userData.spatialComponentRoot) out.push(`${o.userData.spatialEntityId}<${o.parent?.userData.spatialEntityId ?? 'root'}`); }); return out; };
    expect(ids(routed.root)).toEqual(['body<root', 'duct<body', 'slab<root', 'profile<root']); expect(routed.report.decisions.map((d) => d.componentId)).toEqual(['body', 'duct', 'slab', 'profile']);
    disposeCompiledSpatialPlan(routed.root);
  });

  it('draws curved and joined components as continuous surfaces and leaves the rest on V2, saying why', () => {
    const routed = compileWithRouter(sample(), { limits: { maxGridCells: 48 } }), d = Object.fromEntries(routed.report.decisions.map((x) => [x.componentId, x]));
    expect(d.body!.used).toBe('continuous_surface'); expect(d.duct!.used).toBe('continuous_surface'); expect(d.duct!.reason).toMatch(/joins to body/);
    expect(d.slab!.used).toBe('procedural_v2'); expect(d.slab!.reason).toMatch(/nothing to blend/); expect(d.profile!.used).toBe('procedural_v2'); expect(d.profile!.reason).toMatch(/revolve/);
    expect(meshFamilies(routed.root, 'body')).toEqual(['continuous_surface']); expect(meshFamilies(routed.root, 'slab')).toEqual(['procedural_v2']);
    disposeCompiledSpatialPlan(routed.root);
  });

  it('draws a junction fillet on one side only: the thinner part flares into the thicker one, never both', () => {
    const routed = compileWithRouter(sample(), { limits: { maxGridCells: 48 } }), meshes = (id: string) => ownMeshes(routed.root, id);
    const blend = (id: string) => Math.max(0, ...meshes(id).map((m) => Number(m.userData.blendRadius ?? 0)));
    expect(blend('duct')).toBeGreaterThan(0); // thin tube into the large body
    expect(blend('body')).toBe(0);            // the body keeps its own surface where the tube enters it
    const d = Object.fromEntries(routed.report.decisions.map((x) => [x.componentId, x])); expect(d.duct!.reason).toMatch(/joins to body/); expect(d.body!.reason).not.toMatch(/joins to duct/);
    disposeCompiledSpatialPlan(routed.root);
  });

  it('keeps every component selectable with the same entity id, subcomponent key and material profile', () => {
    const routed = compileWithRouter(sample(), { limits: { maxGridCells: 48 } });
    for (const id of ['body', 'duct', 'slab', 'profile']) { const meshes = ownMeshes(routed.root, id); expect(meshes.length).toBeGreaterThan(0); for (const o of meshes) { expect(o.userData.spatialEntityId).toBe(id); expect(typeof o.userData.spatialSubcomponentKey).toBe('string'); expect(typeof o.userData.materialProfile).toBe('string'); } }
    disposeCompiledSpatialPlan(routed.root);
  });

  it('copies the plan provenance and source hash into the report and never promotes them', () => {
    const p = plan([component('part', shape('s', 'sphere', { radius: 0.5, widthSegments: 16, heightSegments: 12 }), [0, 0.5, 0], null, 'observed')]), routed = compileWithRouter(p, { limits: { maxGridCells: 40 } });
    expect(routed.report.planSource).toEqual({ kind: 'image', sha256: 'b'.repeat(64) }); expect(routed.report.decisions[0]!.planGeometryOrigin).toBe('observed'); expect(routed.report.decisions[0]!.representation).toBe('derived_from_plan');
    disposeCompiledSpatialPlan(routed.root);
  });

  it('v2_only reproduces V2 and a failing component returns to V2 without touching the others', () => {
    const p = sample(), v2 = compileWithRouter(p, { policy: 'v2_only' }); expect(v2.report.decisions.every((d) => d.used === 'procedural_v2')).toBe(true); disposeCompiledSpatialPlan(v2.root);
    const thin = plan([component('wide', shape('w', 'box', { dimensions: [40, 40, 40] }), [0, 20, 0]), component('hair', shape('h', 'tube', { points: [[0, 0, 0], [0, 30, 0]], radius: 0.01, tubularSegments: 8, radialSegments: 6 }), [10, 0, 0], 'wide')]);
    const routed = compileWithRouter(thin, { requests: { hair: 'continuous_surface', wide: 'continuous_surface' }, limits: { maxGridCells: 30 } }), d = Object.fromEntries(routed.report.decisions.map((x) => [x.componentId, x]));
    expect(d.hair!.used).toBe('procedural_v2'); expect(d.hair!.fallback).toEqual({ from: 'continuous_surface', code: 'FEATURE_BELOW_RESOLUTION' }); expect(routed.report.fallbacks).toBeGreaterThanOrEqual(1); expect(meshFamilies(routed.root, 'hair')).toEqual(['procedural_v2']);
    disposeCompiledSpatialPlan(routed.root);
  });

  it('respects a scene triangle budget by sending the most expensive replacements back to V2', () => {
    const p = sample(), free = compileWithRouter(p, { limits: { maxGridCells: 64 } }), tight = compileWithRouter(p, { limits: { maxGridCells: 64, maxTriangles: free.report.totals.triangles - 1 } });
    expect(tight.report.totals.triangles).toBeLessThanOrEqual(free.report.totals.triangles - 1); expect(tight.report.decisions.some((d) => d.fallback && ['SCENE_BUDGET', 'GRID_LIMIT'].includes(d.fallback.code))).toBe(true);
    disposeCompiledSpatialPlan(free.root); disposeCompiledSpatialPlan(tight.root);
  });

  it('propagates V2 failures unchanged (the router adds no new way for an invalid plan to render)', () => {
    expect(() => compileWithRouter({ ...sample(), contract: 'wrong' } as unknown as SpatialPlanV2)).toThrow();
  });
});

describe('mesh assets: proposals, approval, disposal', () => {
  const asset = () => { const scene = new Group(); const a = new Mesh(new BoxGeometry(2, 2, 2), new MeshStandardMaterial({ map: new DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1) })); a.name = 'Hull'; scene.add(a); return scene; };
  const proposal = (): AssetProposal => ({ id: 'asset-1', sha256: 'c'.repeat(64), source: { kind: 'licensed_library', library: 'test' }, license: { spdx: 'CC0-1.0', attribution: null, sourceUrl: null, verified: true }, mapping: [{ componentId: 'slab', nodePaths: ['Hull'], method: 'manual', confidence: 1 }], stats: { triangles: 12, nodes: 1, materials: 1, textures: 1, textureBytes: 4, bytes: 100 }, status: 'proposed' });
  const approval = (): AssetApproval => ({ proposalId: 'asset-1', componentIds: ['slab'], decidedBy: 'human_review', reviewerAuthenticated: false, at: '2026-11-04T00:00:00Z' });

  it('a mesh on offer draws nothing until a person approves it, and says so', () => {
    const routed = compileWithRouter(sample(), { assets: [{ proposal: proposal(), scene: asset() }], requests: { slab: 'mesh_asset' }, limits: { maxGridCells: 32 } });
    expect(meshFamilies(routed.root, 'slab')).toEqual(['procedural_v2']); expect(routed.report.proposalsNotApproved).toEqual(['asset-1']);
    const d = routed.report.decisions.find((x) => x.componentId === 'slab')!; expect(d.fallback).toEqual({ from: 'mesh_asset', code: 'ASSET_NOT_APPROVED' }); disposeCompiledSpatialPlan(routed.root);
  });

  it('an approved mesh replaces only the named component, is fitted to its bounds and is marked as an external asset', () => {
    const routed = compileWithRouter(sample(), { assets: [{ proposal: proposal(), scene: asset() }], approvals: [approval()], limits: { maxGridCells: 32 } }), d = routed.report.decisions.find((x) => x.componentId === 'slab')!;
    expect(d.used).toBe('mesh_asset'); expect(d.representation).toBe('external_asset'); expect(d.assetId).toBe('asset-1'); expect(d.planGeometryOrigin).toBe('design_approximation');
    expect(meshFamilies(routed.root, 'slab')).toEqual(['mesh_asset']); expect(meshFamilies(routed.root, 'body')).toEqual(['continuous_surface']); expect(routed.report.proposalsNotApproved).toEqual([]);
    disposeCompiledSpatialPlan(routed.root);
  });

  it('a mapping to a node the mesh does not have returns the component to V2', () => {
    const bad = { ...proposal(), mapping: [{ componentId: 'slab', nodePaths: ['Missing'], method: 'manual' as const, confidence: 1 }] }, routed = compileWithRouter(sample(), { assets: [{ proposal: bad, scene: asset() }], approvals: [approval()] });
    expect(meshFamilies(routed.root, 'slab')).toEqual(['procedural_v2']); expect(routed.report.decisions.find((x) => x.componentId === 'slab')!.fallback!.code).toBe('ASSET_NODE_MISSING'); disposeCompiledSpatialPlan(routed.root);
  });

  it('disposing the compiled plan frees external materials and their textures too (no GPU leak)', () => {
    const routed = compileWithRouter(sample(), { assets: [{ proposal: proposal(), scene: asset() }], approvals: [approval()] }), textures: Texture[] = [], materials: MeshStandardMaterial[] = [];
    routed.root.traverse((o) => { if (o instanceof Mesh && o.userData.geometryFamily === 'mesh_asset') { const m = o.material as MeshStandardMaterial; materials.push(m); if (m.map) textures.push(m.map); } });
    expect(textures.length).toBeGreaterThan(0); let disposedTextures = 0, disposedMaterials = 0; for (const t of textures) t.addEventListener('dispose', () => disposedTextures++); for (const m of materials) m.addEventListener('dispose', () => disposedMaterials++);
    disposeCompiledSpatialPlan(routed.root); expect(disposedMaterials).toBe(materials.length); expect(disposedTextures).toBe(textures.length);
  });
});
